import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asUser, seedSession, seedUser, teamDatabase, testImportKey } from './support/team-database.js';
import { buildExportFile } from '../src/storage/backupFormat.js';
import { emptyInventory, saveInventoryProduct } from '../src/domain/inventory.js';
import { recordWarehouse } from '../src/domain/warehouse.js';
import { createInitialState } from '../src/storage/initialState.js';
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

test('Team imports the new Solo warehouse with its repair history, price and reconciled balances', async () => {
  const owner = await employee();
  const space = await workspace(owner);
  const state = createInitialState();
  state.accounts[0].openingBalance = 500;
  const id = 'product:local-device';
  state.catalog = saveInventoryProduct(emptyInventory(), { id, name: 'Локальный ноутбук', categoryId: 'laptops',
    tracking: 'unit', attributes: { serial: 'TST' }, plannedPriceMinor: 17000 });
  const operation = (state, type, unitMinor, balance) => recordWarehouse(state, id, type,
    { units: 1, unitMinor, accountId, version: 1, position: state.warehouse?.length ?? 0 }, balance);
  const purchase = operation(state, 'purchase', 10000, 50000);
  const start = operation(purchase, 'repair_start', 0, 40000);
  const repaired = operation(start, 'repair', 2000, 40000);
  const material = prepareSoloTransfer({ state: repaired });
  await asUser(db, owner, 'select public.phonebooks_team_solo_import($1,$2,$3,$4,$5)', [
    space, owner.sub, importKey, 'c'.repeat(64), material,
  ]);
  const current = await feed(owner, space);
  assert.equal(current.products[0].plannedPriceMinor, '17000');
  assert.equal(current.products[0].stockCostMinor, '12000');
  assert.equal(current.products[0].purchased, true);
  assert.equal(current.accounts[0].balanceMinor, '38000');
  assert.ok(current.operations.some(item => item.type === 'repair_start'));
});

async function tradeContext(user, space, productId = null) {
  const [row] = await asUser(db, user, 'select public.phonebooks_team_trade_context($1,$2,$3) as result', [space, user.sub, productId]);
  return row.result;
}
async function tradeCommand(user, space, productId, type, attributes, request) {
  const product = (await feed(user, space)).products.find(item => item.id === productId);
  return command(user, space, { type, productId, expectedVersion: product.version, ...attributes }, request);
}

test('Team corrects source sales and purchases with exact FIFO, cash reconciliation and one receipt', async () => {
  const [owner, staff] = await Promise.all([employee(), employee()]);
  const space = await workspace(owner);
  await db.query("insert into phonebooks_team_private.memberships(workspace_id,user_id,role) values($1,$2,'employee')", [space, staff.sub]);
  await command(owner, space, funding(10000));
  const first = await command(owner, space, purchase('quantity', 3, 100));
  const [{ id }] = (await feed(owner, space)).products;
  await tradeCommand(owner, space, id, 'purchase', { quantity: 2, unitPriceMinor: 210, accountId });
  const sale = await tradeCommand(staff, space, id, 'sale', { quantity: 4, unitPriceMinor: 350, accountId });
  const reason = 'Корректировка';
  const correction = { type: 'customer_return', productId: id, originalId: sale.operationId, quantity: 2, amountMinor: 700,
    reason, accountId, expectedVersion: (await feed(owner, space)).products[0].version };
  const request = randomUUID();
  await assert.rejects(command(staff, space, correction), { code: 'PT403' });
  await db.query("insert into phonebooks_team_private.member_overrides(workspace_id,user_id,permission,allowed) values($1,$2,'trade.customer_return',true)", [space, staff.sub]);
  const limitedSale = (await tradeContext(staff, space, id)).originals.find(item => item.id === sale.operationId);
  assert.equal(limitedSale.amountMinor, null);
  assert.equal(limitedSale.canVoid, true);
  await db.query("update phonebooks_team_private.member_overrides set allowed=false where workspace_id=$1 and user_id=$2 and permission='trade.customer_return'", [space, staff.sub]);
  assert.deepEqual((await tradeContext(staff, space, id)).originals, []);
  await assert.rejects(command(staff, space, correction), { code: 'PT403' });
  const receipt = await command(owner, space, correction, request);
  assert.deepEqual(await command(owner, space, correction, request), receipt);
  const logged = await db.query('select actor_id,current_values,amount_minor from phonebooks_team_private.team_audit where workspace_id=$1 and target_id=$2', [space, receipt.operationId]);
  assert.equal(logged.rows.length, 1);
  assert.equal(logged.rows[0].actor_id, owner.sub);
  assert.equal(logged.rows[0].current_values.originalId, sale.operationId);
  assert.equal(Number(logged.rows[0].amount_minor), 700);
  assert.equal((await feed(owner, space)).products[0].stockCostMinor, '410');
  assert.equal((await tradeContext(owner, space, id)).originals.find(item => item.id === sale.operationId).leftUnits, 2);
  const compensate = { originalId: sale.operationId, quantity: 0, amountMinor: 30, reason, accountId };
  await tradeCommand(owner, space, id, 'compensation', compensate);
  await tradeCommand(owner, space, id, 'customer_return', { ...compensate, quantity: 2, amountMinor: 670 });
  await assert.rejects(tradeCommand(owner, space, id, 'customer_return', { ...compensate, quantity: 1, amountMinor: 0 }), { code: 'PT409' });
  await tradeCommand(owner, space, id, 'supplier_return', { ...compensate, originalId: first.operationId, quantity: 1, amountMinor: 80 });
  let data = await feed(owner, space);
  assert.equal(data.products[0].stockCostMinor, '620');
  assert.equal(data.accounts[0].balanceMinor, '9360');
  assert.deepEqual(data.totals, { revenue_minor: 0, cost_minor: 0, expense_minor: 20, sales_count: 1 });
  const [individual] = await asUser(db, owner, 'select public.phonebooks_team_stats($1,$2,$3,null,null) as result', [space, owner.sub, staff.sub]);
  assert.equal(individual.result.revenueMinor, '0');
  assert.equal(individual.result.returns, 0);

  await command(owner, space, purchase('unit', 1, 150));
  data = await feed(owner, space);
  const unit = data.products.find(item => item.tracking === 'unit');
  const unitSale = await tradeCommand(staff, space, unit.id, 'sale', { quantity: 1, unitPriceMinor: 320, accountId });
  await tradeCommand(owner, space, unit.id, 'void_sale', { quantity: 1, originalId: unitSale.operationId, reason, accountId, toRepair: true });
  assert.equal((await feed(owner, space)).products.find(item => item.id === unit.id).inRepair, true);
});

test('Team expires holds on server time and serializes reservation, sale and permission changes', async () => {
  const [owner, seller] = await Promise.all([employee(), employee()]);
  const space = await workspace(owner);
  await db.query("insert into phonebooks_team_private.memberships(workspace_id,user_id,role) values($1,$2,'employee')", [space, seller.sub]);
  await command(owner, space, funding(10000));
  await command(owner, space, purchase('quantity', 3, 100));
  const [{ id, version }] = (await feed(owner, space)).products;
  const reserve = { type: 'reserve', productId: id, expectedVersion: version, quantity: 2, unitPriceMinor: 350,
    buyer: 'Учебный покупатель', contact: 'тест', expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const sell = { type: 'sale', productId: id, expectedVersion: version, quantity: 2, unitPriceMinor: 400, accountId };
  await assert.rejects(command(seller, space, reserve), { code: 'PT403' });
  const [held, competing] = await Promise.allSettled([command(owner, space, reserve), command(seller, space, sell)]);
  assert.equal(held.status, 'fulfilled');
  assert.equal(competing.reason.code, 'PT409');
  const reservationId = held.value.operationId;
  assert.equal((await tradeContext(seller, space)).holds[0].quantity, 2);
  assert.equal((await tradeContext(seller, space, id)).reservations[0].contact, null);
  assert.equal((await feed(owner, space)).accounts[0].balanceMinor, '9700');
  await assert.rejects(tradeCommand(seller, space, id, 'sale', { ...sell, type: 'sale', expectedVersion: (await feed(owner, space)).products[0].version }), { code: 'PT409' });
  await tradeCommand(seller, space, id, 'sale', { reservationId, quantity: 1, unitPriceMinor: 350, accountId });
  assert.equal((await tradeContext(owner, space, id)).reservations[0].quantity, 1);
  const expiry = new Date(Date.now() + 7200000).toISOString();
  await tradeCommand(owner, space, id, 'extend_reserve', { reservationId, expiresAt: expiry });
  assert.equal(Date.parse((await tradeContext(owner, space, id)).reservations[0].expiresAt), Date.parse(expiry));
  await db.query("update phonebooks_team_private.stock_reservations set expires_at=clock_timestamp()-interval '1 second' where workspace_id=$1 and id=$2", [space, reservationId]);
  assert.deepEqual((await tradeContext(owner, space)).holds, []);
  await assert.rejects(tradeCommand(seller, space, id, 'sale', { reservationId, quantity: 1, unitPriceMinor: 350, accountId }), { code: 'PT409' });
  await tradeCommand(seller, space, id, 'sale', { quantity: 2, unitPriceMinor: 450, accountId });
  assert.equal((await feed(owner, space)).products[0].quantity, 0);
});

test('Solo transfers a live reservation and a corrected sale to the Team ledger once', async () => {
  const owner = await employee();
  const space = await workspace(owner);
  const id = 'product:transfer-trade';
  let state = createInitialState();
  state.accounts[0].openingBalance = 100;
  state.catalog = saveInventoryProduct(emptyInventory(), {
    id, name: 'Комплектующие', categoryId: 'components', tracking: 'quantity', attributes: {},
  });
  function record(type, input) {
    state = recordWarehouse(state, id, type, { accountId, position: state.warehouse?.length ?? 0, version: 1, ...input }, 10000);
  }
  record('purchase', { units: 3, unitMinor: 300 });
  record('sale', { units: 2, unitMinor: 500 });
  const sale = state.warehouse.at(-1).id;
  record('customer_return', { units: 1, amountMinor: 500, originalId: sale, reason: 'Обмен' });
  record('reserve', { units: 1, unitMinor: 700, buyer: 'Склад', expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const material = prepareSoloTransfer({ state });
  const [imported] = await asUser(db, owner, 'select public.phonebooks_team_solo_import($1,$2,$3,$4,$5) as result',
    [space, owner.sub, importKey, 'f'.repeat(64), material]);
  assert.equal(imported.result.summary.reserved, 1);
  const context = await tradeContext(owner, space, id);
  assert.equal(context.reservations[0].quantity, 1);
  assert.equal(context.originals.find(item => item.id === sale).leftUnits, 1);
  await tradeCommand(owner, space, id, 'customer_return', { quantity: 1, amountMinor: 500, originalId: sale, reason: 'Возврат', accountId });
  assert.equal((await feed(owner, space)).products[0].stockCostMinor, '900');
  assert.equal((await feed(owner, space)).totals.revenue_minor, 0);
});
