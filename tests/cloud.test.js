import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asUser, seedSession, seedUser, teamDatabase, testImportKey } from './support/team-database.js';
import { buildExportFile } from '../src/storage/backupFormat.js';
import { prepareSoloTransfer, transferSource } from '../src/domain/soloTransfer.js';
import { realisticSnapshot } from './fixtures/realistic.js';

let db;
let importKey;
before(async () => { db = await teamDatabase(); importKey = await testImportKey(db); });
after(() => db?.close());
const accountId = 'ac_default_cash';
async function employee() {
  return seedSession(db, await seedUser(db, randomUUID() + '@phonebooks.test'));
}
async function workspace(owner) {
  const [workspace] = await asUser(db, owner, 'select * from public.phonebooks_team_create_workspace($1,$2)', ['Облачный склад', randomUUID()]);
  return workspace.id;
}
async function command(user, space, input, request = randomUUID(), actor = user.sub) {
  const [row] = await asUser(db, user, 'select public.phonebooks_team_cloud_command($1,$2,$3,$4) as result', [space, actor, request, input]);
  return row.result;
}
async function feed(user, space, cursor = null) {
  const [row] = await asUser(db, user, 'select public.phonebooks_team_cloud_feed($1,$2,$3) as result', [space, user.sub, cursor]);
  return row.result;
}
const funding = amountMinor => ({ type: 'deposit', amountMinor, accountId });
const purchase = (tracking, quantity, unitPriceMinor) => ({
  type: 'purchase', name: 'Товар', categoryId: 'other', tracking, quantity, unitPriceMinor, accountId,
});

test('server computes cash, FIFO cost, repairs and write-offs; a delta contains only changed records', async () => {
  const owner = await employee();
  const space = await workspace(owner);
  assert.equal((await feed(owner, space)).accounts[0].balanceMinor, '0');
  await command(owner, space, funding(10000));
  const { revision } = await command(owner, space, purchase('quantity', 3, 1000));
  const [batch] = (await feed(owner, space)).products;
  await command(owner, space, { type: 'purchase', productId: batch.id, expectedVersion: batch.version, quantity: 2, unitPriceMinor: 3000, accountId });
  const change = await feed(owner, space, revision);
  const [{ id, version }] = change.products;
  assert.equal(change.categories.length, 0);
  assert.equal(change.operations.length, 1);
  await command(owner, space, { type: 'sale', productId: id, expectedVersion: version, quantity: 4, unitPriceMinor: 2500, accountId });
  let data = await feed(owner, space);
  assert.equal(data.products[0].quantity, 1);
  assert.deepEqual(data.totals, { revenue_minor: 10000, cost_minor: 6000, expense_minor: 0, sales_count: 1 });
  assert.equal(data.accounts[0].balanceMinor, '11000');
  await command(owner, space, { type: 'stock_adjustment', productId: id, expectedVersion: data.products[0].version, quantity: -1 });
  await command(owner, space, purchase('unit', 1, 700));
  const unit = (await feed(owner, space)).products.find(item => item.tracking === 'unit');
  await command(owner, space, { type: 'repair', productId: unit.id, expectedVersion: unit.version, amountMinor: 300, accountId });
  data = await feed(owner, space);
  await command(owner, space, { type: 'sale', productId: unit.id, expectedVersion: data.products.find(item => item.id === unit.id).version,
    quantity: 1, unitPriceMinor: 1500, accountId });
  await command(owner, space, { type: 'expense', amountMinor: 150, accountId });
  data = await feed(owner, space);
  assert.equal(data.accounts[0].balanceMinor, '11350');
  assert.deepEqual(data.totals, { revenue_minor: 11500, cost_minor: 7000, expense_minor: 3150, sales_count: 2 });
});

test('two staff requests cannot sell one unit, exact retry succeeds and permissions are checked before replay', async () => {
  const [owner, staff, stranger] = await Promise.all([employee(), employee(), employee()]);
  const space = await workspace(owner);
  await db.query("insert into phonebooks_team_private.memberships(workspace_id,user_id,role) values($1,$2,'employee')", [space, staff.sub]);
  await command(owner, space, funding(2000));
  await command(owner, space, purchase('unit', 1, 500));
  const [product] = (await feed(staff, space)).products;
  const sell = { type: 'sale', productId: product.id, expectedVersion: product.version, quantity: 1, unitPriceMinor: 1200, accountId };
  const requests = [randomUUID(), randomUUID()];
  const attempts = await Promise.allSettled([command(staff, space, sell, requests[0]), command(owner, space, sell, requests[1])]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const winner = attempts.findIndex(result => result.status === 'fulfilled');
  const seller = [staff, owner][winner];
  assert.equal(attempts[1 - winner].reason.code, 'PT409');
  assert.deepEqual(await command(seller, space, sell, requests[winner]), attempts[winner].value);
  await assert.rejects(command(seller, space, { ...sell, unitPriceMinor: 1201 }, requests[winner]), { code: 'PT409' });
  await assert.rejects(command(staff, space, funding(200)), { code: 'PT403' });
  await assert.rejects(command(owner, space, { ...sell, costMinor: 0 }), { code: 'PT400' });
  await assert.rejects(command(owner, space, sell, randomUUID(), staff.sub), { code: 'PT403' });
  await assert.rejects(feed(stranger, space), { code: 'PT403' });
  const view = await feed(staff, space);
  assert.equal(view.accounts[0].balanceMinor, undefined);
  assert.equal(view.totals, null);
  assert.deepEqual(view.operations, []);
  assert.equal(view.products[0].quantity, 0);
  assert.equal((await feed(owner, space)).totals.sales_count, 1);
  await db.query('update phonebooks_team_private.memberships set revoked_at=now() where workspace_id=$1 and user_id=$2', [space, staff.sub]);
  await assert.rejects(command(staff, space, sell, requests[0]), { code: 'PT403' });
  await assert.rejects(feed(staff, space), { code: 'PT403' });
});

test('failure rolls back stock, cash, revision and receipt and permits a corrected retry', async () => {
  const owner = await employee();
  const space = await workspace(owner);
  const request = randomUUID();
  const input = purchase('quantity', 2, 300);
  await assert.rejects(command(owner, space, input, request), { code: 'PT409' });
  assert.deepEqual((await feed(owner, space)).products, []);
  assert.equal((await feed(owner, space)).cursor, '0');
  await command(owner, space, funding(900));
  await command(owner, space, input, request);
  const before = await feed(owner, space);
  const [product] = before.products;
  await assert.rejects(command(owner, space, { type: 'stock_adjustment', productId: product.id, expectedVersion: product.version, quantity: -3 }), { code: 'PT409' });
  assert.deepEqual(await feed(owner, space), before);
});

test('Solo preview and import preserve legacy stock and financial totals, with rollback and one durable receipt', async () => {
  const [owner, staff] = await Promise.all([employee(), employee()]);
  const space = await workspace(owner);
  await db.query("insert into phonebooks_team_private.memberships(workspace_id,user_id,role) values($1,$2,'manager')", [space, staff.sub]);
  const original = realisticSnapshot();
  const asFile = JSON.stringify(buildExportFile(original));
  const material = prepareSoloTransfer(transferSource(asFile));
  const transfer = async (user, key, data = material, fingerprint = 'a'.repeat(64)) => {
    const [row] = await asUser(db, user, 'select public.phonebooks_team_solo_import($1,$2,$3,$4,$5) as result', [space, user.sub, key, fingerprint, data]);
    return row.result;
  };
  await assert.rejects(transfer(owner, 'public-client-cannot-write'), { code: 'PT403' });
  await assert.rejects(transfer(staff, importKey), { code: 'PT403' });
  const mismatched = structuredClone(material);
  mismatched.accounts[0].balanceMinor++;
  await assert.rejects(transfer(owner, importKey, mismatched), { code: 'PT409' });
  assert.equal((await feed(owner, space)).cursor, '0');
  assert.deepEqual((await feed(owner, space)).products, []);
  assert.deepEqual(await transfer(owner, importKey), { summary: material.summary, replayed: false });
  assert.deepEqual(await transfer(owner, importKey), { summary: material.summary, replayed: true });
  await assert.rejects(transfer(owner, importKey, material, 'b'.repeat(64)), { code: 'PT409' });
  const data = await feed(owner, space, '0');
  assert.equal(data.products.reduce((sum, item) => sum + item.quantity, 0), material.summary.units);
  assert.equal(data.accounts.reduce((sum, item) => sum + Number(item.balanceMinor), 0), material.summary.cashMinor);
  assert.equal(data.totals.revenue_minor, material.summary.revenueMinor);
  assert.equal(data.operations.length, material.summary.operations);
  assert.ok(data.operations.every(item => item.actorId === null));
  const individual = await db.query("select * from phonebooks_team_private.inventory_totals($1,$2)", [space, owner.sub]);
  assert.equal(Number(individual.rows[0].revenue_minor), 0);
  assert.deepEqual(JSON.parse(asFile).snapshot, original);

  const accessory = data.products.find(item => item.tracking === 'quantity' && item.quantity > 0);
  await command(owner, space, { type: 'sale', productId: accessory.id, expectedVersion: accessory.version,
    quantity: 1, unitPriceMinor: 1500, accountId: data.accounts.find(item => !item.archived).id });
  assert.equal((await feed(owner, space)).totals.revenue_minor, material.summary.revenueMinor + 1500);
});
