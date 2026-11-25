import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { readCloudFeed } from '../team/cloudFeed.js';
import { asUser, seedSession, seedUser, teamDatabase } from './support/team-database.js';

let db;
before(async () => { db = await teamDatabase(); });
after(() => db?.close());
async function account() {
  return seedSession(db, await seedUser(db, randomUUID() + '@phonebooks.test'));
}
async function workspace(user) {
  const [row] = await asUser(db, user, 'select id from public.phonebooks_team_create_workspace($1,$2)', ['Склад',randomUUID()]);
  return row.id;
}
async function page(user, space, position) {
  const [row] = await asUser(db, user, 'select public.phonebooks_team_cloud_page($1,$2,$3) as result',[space,user.sub,position]);
  return row.result;
}
const totalRows = result => ['products','categories','accounts','operations']
  .reduce((total, name) => total + result[name].length, 0);

test('bounded pages resume within one revision and a following sweep catches updates during pagination', async () => {
  const user = await account();
  const staff = await account();
  const space = await workspace(user);
  const other = await workspace(staff);
  for (const id of [space, other]) await db.query('update phonebooks_team_private.workspaces set cloud_revision=1 where id=$1',[id]);
  await db.query(`insert into phonebooks_team_private.inventory_products(workspace_id,id,category_id,name,tracking,cloud_revision)
    select $1::uuid,'item:'||lpad(seq::text,3,'0'),'other','Товар '||seq,'quantity',1 from generate_series(1,230) seq
    union all select $2::uuid,'secret','other','Другой склад','quantity',1`,[space,other]);
  await db.query("insert into phonebooks_team_private.memberships(workspace_id,user_id,role) values($1,$2,'employee')",[space,staff.sub]);

  const first = await page(user,space,{since:null});
  assert.equal(totalRows(first),100);
  assert.equal(first.cursor,'1');
  assert.ok(first.next);
  assert.equal(Object.hasOwn(first,'totals'),false);
  await db.query('update phonebooks_team_private.workspaces set cloud_revision=2 where id=$1',[space]);
  await db.query("update phonebooks_team_private.inventory_products set cloud_revision=2,quantity=1 where workspace_id=$1 and id='item:179'",[space]);
  const result = [...first.products];
  let pointer = first.next;
  do {
    const next = await page(user,space,pointer);
    assert.ok(totalRows(next)<=100);
    assert.equal(next.cursor,'1');
    result.push(...next.products);
    pointer = next.next;
  } while (pointer);
  assert.equal(result.length,229);
  assert.equal(new Set(result.map(item => item.id)).size,229);
  assert.equal(result.some(item => item.id==='secret'),false);
  const delta = await page(user,space,{since:'1'});
  assert.equal(delta.cursor,'2');
  assert.deepEqual(delta.products.map(item => item.id),['item:179']);
  const idle = await page(user,space,{since:'2'});
  assert.equal(totalRows(idle),0);
  assert.equal(Object.hasOwn(idle,'totals'),false);
  const redacted = await page(staff,space,{since:null});
  assert.ok(redacted.products.every(item => !Object.hasOwn(item,'stockCostMinor') && !Object.hasOwn(item,'lastPurchasePriceMinor')));
  assert.ok(redacted.accounts.every(item => !Object.hasOwn(item,'balanceMinor')));
  assert.equal(redacted.totals,undefined);
  await assert.rejects(page(user,other,{since:null}),{code:'PT403'});
  await assert.rejects(page(user,space,{since:'33'}),{code:'PT409'});
});

test('client drops all partial rows when access changes between pages', async () => {
  const stub = (permissions, products, next = null) => ({ role:'employee',permissions,products,next,cursor:'2',
    categories:[],accounts:[],operations:[] });
  const requests = [];
  const sequence = [
    stub(['stock.read','stock.cost.read'],[{id:'first',stockCostMinor:'300'}],{since:null,upper:'2'}),
    stub(['stock.read'],[{id:'second'}]),
    stub(['stock.read'],[{id:'first'},{id:'second'}]),
  ];
  let cleared = 0;
  const result = await readCloudFeed(async (_path, params) => {
    requests.push(params.p_position);
    return sequence.shift();
  },{},null,() => { cleared++; });
  assert.equal(cleared,1);
  assert.equal(requests[2].since,null);
  assert.deepEqual(result.products,[{id:'first'},{id:'second'}]);
});
