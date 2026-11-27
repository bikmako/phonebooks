import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asUser, seedUser, seedSession, teamDatabase } from './support/team-database.js';
import { guessMapping, previewSpreadsheet, spreadsheetTemplate } from '../src/domain/spreadsheet.js';

let db, owner, staff, outsider, space;
const accountId = 'ac_default_cash';
const user = role => seedUser(db, role + '@sheet.test').then(id => seedSession(db, id));
before(async () => {
  db = await teamDatabase();
  owner = await user('owner'); staff = await user('staff'); outsider = await user('outsider');
  space = await newWorkspace();
  await db.query("insert into phonebooks_team_private.memberships(workspace_id,user_id,role) values($1,$2,'employee')", [space, staff.sub]);
  await db.query("insert into phonebooks_team_private.member_overrides values($1,$2,'data.export',true),($1,$2,'finance.history.read',true)", [space, staff.sub]);
});
after(() => db?.close());
async function newWorkspace() {
  const [row] = await asUser(db, owner, 'select * from public.phonebooks_team_create_workspace($1,$2)', ['Таблицы',randomUUID()]);
  return row.id;
}
async function rpc(user, name, args, workspace = space) {
  const params = [workspace, user.sub, ...args];
  const [result] = await asUser(db, user, `select public.phonebooks_team_${name}(${params.map((_, index) => '$' + (index+1))}) as value`, params);
  return result.value;
}
async function file(rows) {
  const plan = await previewSpreadsheet({ rows: rows.map((values, index) => ({ number: index+1, values })) },
    guessMapping(rows[0]), { defaultType:'opening',today:'2026-11-27',accountId });
  assert.deepEqual(plan.errors, []);
  return { rows: plan.rows, categories: plan.categories, products: plan.products };
}

test('Team restricts access, preserves cash, validates a stale revision, avoids replay and restores pre-import records', async () => {
  const plan = await file(spreadsheetTemplate);
  const request = randomUUID();
  await assert.rejects(rpc(staff, 'sheet_import', [request,'0',plan]), { code: 'PT403' });
  await assert.rejects(rpc(outsider, 'sheet_export', ['stock',{},null,null]), { code: 'PT403' });
  await assert.rejects(rpc(owner, 'sheet_import', [request,'2',plan]), { code: 'PT409' });
  const first = await rpc(owner,'sheet_import',[request,'0',plan]);
  assert.equal(first.rows,2);
  assert.deepEqual((await rpc(owner,'sheet_check',[first.revision,plan])).duplicates.sort(),[2,3]);
  assert.equal((await rpc(owner,'sheet_import',[request,'0',plan])).replayed,true);
  await assert.rejects(rpc(owner,'sheet_import',[randomUUID(),first.revision,plan]), { code:'PT409' });
  const financial = await rpc(owner,'sheet_export',['finance',{},null,null]);
  assert.equal(financial.rows[0].cashMinor,'0');
  assert.equal(financial.rows[0].revenueMinor,'140000');
  const warehouse = await rpc(owner,'sheet_export',['stock',{query:'смартфон'},null,null]);
  assert.deepEqual([warehouse.rows.length,warehouse.rows[0].quantity,warehouse.rows[0].costMinor],[1,1,'1200000']);
  const history = await rpc(staff,'sheet_export',['sale',{},null,null]);
  for (const key of ['revenueMinor','costMinor','cashMinor','actorId']) assert.ok(!Object.hasOwn(history.rows[0],key));
  assert.equal((await rpc(staff,'sheet_export',['stock',{},null,null])).rows.some(row => 'costMinor' in row),false);
  assert.equal((await rpc(staff,'sheet_export',['employees',{},null,null])).rows.length,1);
  await assert.rejects(rpc(owner,'cloud_command',[randomUUID(),{type:'customer_return',originalId:history.rows[0].id,
    productId:plan.rows[1].productId,expectedVersion:1,quantity:1,amountMinor:70000,reason:'Нет товара к возврату',accountId}]), { code:'PT409' });
  const restored = await rpc(owner,'sheet_revert',[request]);
  assert.equal(restored.replayed,false);
  assert.equal((await rpc(owner,'sheet_revert',[request])).replayed,true);
  assert.equal((await rpc(owner,'sheet_export',['stock',{},null,null])).rows.length,0);
  await assert.rejects(rpc(owner,'cloud_page',[{since:first.revision}]), { code:'PT409' });
  assert.equal((await rpc(owner,'cloud_page',[{since:null}])).products.length,0);
});

test('Team checks aggregate debits and rolls back products on a failed row, then refuses to undo after another write', async () => {
  const workspace = await newWorkspace();
  const rows = [spreadsheetTemplate[0], ['Текущая закупка','Количественный товар','Прочее','SKU','',
    'Количественный',1,20,'','','2026-01-03','1']];
  const plan = await file(rows);
  await assert.rejects(rpc(owner,'sheet_import',[randomUUID(),'0',plan],workspace),{code:'PT409'});
  assert.equal((await rpc(owner,'sheet_export',['stock',{},null,null],workspace)).rows.length,0);
  const deposit = () => rpc(owner,'cloud_command',[randomUUID(),{type:'deposit',amountMinor:4000,accountId}],workspace);
  await deposit();
  const request = randomUUID();
  await rpc(owner,'sheet_import',[request,'1',plan],workspace);
  assert.equal((await rpc(owner,'sheet_export',['finance',{},null,null],workspace)).rows[0].cashMinor,'2000');
  await deposit();
  await assert.rejects(rpc(owner,'sheet_revert',[request],workspace),{code:'PT409'});
});

test('Team imports and exports 100, 1000 and 10000 rows with a bounded page', { timeout: 180000 }, async t => {
  for (const count of [100,1000,10000]) {
    const workspace = await newWorkspace();
    const plan = await file([['Товар','Количество','Себестоимость, ₽','Номер записи'], ...Array.from({length:count}, (_, i) =>
      ['Тестовый товар ' + i,1,12,'ID-' + i])]);
    const started = performance.now();
    const committed = await rpc(owner,'sheet_import',[randomUUID(),'0',plan],workspace);
    const imported = performance.now();
    const ids = new Set();
    let cursor = null, pages = 0;
    do {
      const response = await rpc(owner,'sheet_export',['stock',{},cursor,committed.revision],workspace);
      assert.ok(response.rows.length <= 500);
      for (const row of response.rows) ids.add(row.id);
      cursor = response.next;
      pages++;
    } while (cursor);
    assert.equal(ids.size, count);
    t.diagnostic(JSON.stringify({count, pages, teamCommitMs: Math.round(imported-started), teamExportMs: Math.round(performance.now()-imported)}));
  }
});
