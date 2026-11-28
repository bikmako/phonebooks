import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { getAccessoryStock } from '../src/domain/accessories.js';
import { accessoryProductId, phoneProductId, projectInventory, STANDARD_CATEGORIES } from '../src/domain/inventory.js';
import { makeInventoryOperation, projectInventoryOperations, summarizeInventoryOperations } from '../src/domain/inventoryOperations.js';
import { completeRepair, getRepairSessionId } from '../src/domain/repairs.js';
import { setPhoneStatus } from '../src/domain/phones.js';
import { getAccountBalances, getStats } from '../src/utils/calculations.js';
import { getPeriod } from '../src/utils/format.js';
import { realisticSnapshot } from './fixtures/realistic.js';
import { asUser, seedSession, seedUser, teamDatabase } from './support/team-database.js';

const date = '2026-01-10';
const minor = value => Math.round(value * 100);
const fixture = () => realisticSnapshot().indexedDB.state[0].value;

test('legacy projection preserves inventory balances, cash and profit including repairs and cancellations', () => {
  let state = fixture();
  const phone = state.phones.find(item => item.status === 'in_stock');
  state = setPhoneStatus(state, phone.id, 'repair');
  const sessionId = getRepairSessionId(state.phones.find(item => item.id === phone.id));
  state = completeRepair(state, phone.id, { sessionId, amount: 1450, accountId: state.accounts[0].id, comment: 'Ремонт' });
  state = setPhoneStatus(state, phone.id, 'reserved');
  const before = structuredClone(state);
  const operations = projectInventoryOperations(state);
  const model = projectInventory(state);
  const totals = summarizeInventoryOperations(operations);
  const stats = getStats(state, getPeriod('all'));

  for (const { account, balance } of getAccountBalances(state)) {
    assert.equal(minor(account.openingBalance) + (totals.accounts.get(account.id) ?? 0), minor(balance));
  }
  for (const [actual, expected] of [
    [totals.revenueMinor, stats.revenue], [totals.costMinor, stats.cogs],
    [totals.grossProfitMinor, stats.grossProfit], [totals.netProfitMinor, stats.netProfit],
  ]) assert.equal(actual, minor(expected));
  for (const item of state.accessoryItems) {
    assert.equal(model.products.find(product => product.id === accessoryProductId(item.id)).quantity, getAccessoryStock(state, item.id));
  }
  assert.equal(model.products.find(product => product.id === phoneProductId(phone.id)).reservedQuantity, 1);
  assert.equal(operations.filter(op => op.type === 'repair').length, 1);
  assert.deepEqual(operations.find(op => op.type === 'repair').postings, [
    { accountId: state.accounts[0].id, amountMinor: -145000 },
  ]);
  assert.ok(operations.some(op => op.type === 'sale' && op.status === 'cancelled' && op.postings.length === 0));
  assert.ok(operations.some(op => op.type === 'reservation' && op.postings.length === 0));
  assert.deepEqual(state, before);
});

test('employee statistics use the same operations as workspace totals, grouped sales and returns', () => {
  const sale = { workspaceId: 'company', actorId: 'owner', date, type: 'sale', groupId: 'receipt' };
  const operations = [
    makeInventoryOperation({ ...sale, id: 'phone', revenueMinor: 10000, costMinor: 6000 }),
    makeInventoryOperation({ ...sale, id: 'case', revenueMinor: 1000, costMinor: 500 }),
    makeInventoryOperation({ ...sale, actorId: 'employee', id: 'employee-sale', groupId: 'employee-sale', revenueMinor: 2000 }),
    makeInventoryOperation({ ...sale, actorId: 'employee', id: 'refund', type: 'customer_return',
      relatedId: 'phone', revenueMinor: -500, postings: [{ accountId: 'cash', amountMinor: -500 }] }),
    makeInventoryOperation({ ...sale, workspaceId: 'other', id: 'outside', revenueMinor: 999999 }),
  ];
  const all = summarizeInventoryOperations(operations, { workspaceId: 'company' });
  const owner = summarizeInventoryOperations(operations, { workspaceId: 'company', actorId: 'owner' });
  const employee = summarizeInventoryOperations(operations, { workspaceId: 'company', actorId: 'employee' });
  assert.equal(all.revenueMinor, 12500);
  assert.equal(all.revenueMinor, owner.revenueMinor + employee.revenueMinor);
  assert.equal(all.salesCount, 2);
  assert.equal(owner.salesCount, 1);
  assert.equal(all.accounts.get('cash'), -500);
  assert.throws(() => summarizeInventoryOperations([...operations, operations[0]], { workspaceId: 'company' }), /Повторная/);
  assert.throws(() => makeInventoryOperation({ ...sale, id: 'booking', type: 'reservation', revenueMinor: 1 }), /операция/);
  assert.throws(() => makeInventoryOperation({ ...sale, id: 'refund', type: 'supplier_return' }), /операция/);
  assert.throws(() => makeInventoryOperation({ ...sale, id: 'bad-date', date: '2026-02-30' }), /операция/);
});

let db;
before(async () => { db = await teamDatabase(); });
after(() => db?.close());

async function workspace() {
  const claims = await seedSession(db, await seedUser(db, randomUUID() + '@phonebooks.test'));
  const [entry] = await asUser(db, claims, 'select * from public.phonebooks_team_create_workspace($1, $2)', ['Склад', randomUUID()]);
  return { claims, id: entry.id };
}

async function internal(claims, statement, args) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return (await tx.query(statement, args)).rows;
  });
}

const stockTable = 'phonebooks_team_private.inventory_products';
const operationTable = 'phonebooks_team_private.inventory_operations';
const record = (actor, workspaceId, requestId, document) => internal(actor,
  'select phonebooks_team_private.record_inventory_operation($1,$2,$3) as id', [workspaceId, requestId, document]);
const document = (id, options) => makeInventoryOperation({ id, type: 'sale', date, ...options });
const addAccount = (workspaceId, id) => db.query(
  'insert into phonebooks_team_private.inventory_accounts (workspace_id,id,name) values ($1,$2,$2) on conflict do nothing', [workspaceId, id],
);
const addProduct = (workspaceId, id, category, tracking, attrs = {}) => db.query(
  'insert into ' + stockTable + ' (workspace_id,id,name,category_id,tracking,attributes) values ($1,$2,$2,$3,$4,$5)',
  [workspaceId, id, category, tracking, attrs],
);

test('PostgreSQL catalogue seeds the same categories and constrains attributes and stock versions', async () => {
  const owner = await workspace();
  const { rows } = await db.query(
    'select id,name,attributes from phonebooks_team_private.inventory_categories where workspace_id=$1', [owner.id],
  );
  assert.deepEqual(new Map(rows.map(row => [row.id, row])), new Map(STANDARD_CATEGORIES.map(row => [row.id, row])));
  await db.query('insert into phonebooks_team_private.inventory_categories (workspace_id,id,name,attributes) values ($1,$2,$3,$4)',
    [owner.id, 'projectors', 'Проекторы', JSON.stringify([{ id: 'lumens', name: 'Люмены', type: 'number' }])]);
  await addProduct(owner.id, 'projector', 'projectors', 'quantity', { lumens: 2000 });
  await db.query("update phonebooks_team_private.inventory_categories set name='Прожекторы' where workspace_id=$1 and id='projectors'", [owner.id]);
  await assert.rejects(db.query("update phonebooks_team_private.inventory_categories set attributes='[]' where workspace_id=$1 and id='projectors'", [owner.id]), { code: '23514' });
  await assert.rejects(addProduct(owner.id, 'other', 'projectors', 'quantity', { lumens: '2000' }), { code: '23514' });
  await addProduct(owner.id, 'phone', 'smartphones', 'unit', { imei: '001' });
  const change = (id, version, quantity, reserved) => internal(owner.claims,
    'select phonebooks_team_private.change_inventory_quantity($1,$2,$3,$4,$5) as version', [owner.id, id, version, quantity, reserved]);
  assert.deepEqual(await change('phone', 1, 1, 0), [{ version: 2 }]);
  await assert.rejects(change('phone', 1, 0, 0), { code: 'PT409' });
  await assert.rejects(change('phone', 2, 2, 0), { code: '23514' });
  await assert.rejects(change('projector', 1, 1, 2), { code: '23514' });
  await assert.rejects(change('projector', 1, -1, 0), { code: '23514' });
});

test('team ledger rejects cross-workspace links, replays one time and rolls back an invalid posting', async () => {
  const owner = await workspace();
  const outsider = await workspace();
  await addAccount(owner.id, 'cash');
  await addAccount(outsider.id, 'remote-cash');
  await addProduct(owner.id, 'phone', 'smartphones', 'unit');
  await addProduct(outsider.id, 'foreign', 'smartphones', 'unit');
  const request = randomUUID();
  const sale = document('phone-sale', { revenueMinor: 10000, costMinor: 7000,
    lines: [{ productId: 'phone', quantity: 1, stockDelta: -1 }], postings: [{ accountId: 'cash', amountMinor: 10000 }] });
  const { workspaceId, actorId, ...payload } = sale;
  await assert.rejects(record(outsider.claims, owner.id, request, payload), { code: 'PT403' });
  await assert.rejects(record(owner.claims, owner.id, request, { ...payload, lines: [{ productId: 'foreign', quantity: 1 }] }), { code: '23502' });
  await assert.rejects(record(owner.claims, owner.id, request, { ...payload, postings: [{ accountId: 'remote-cash', amountMinor: 10000 }] }), { code: '23503' });
  assert.deepEqual((await db.query('select id from ' + operationTable + ' where workspace_id=$1', [owner.id])).rows, []);
  assert.deepEqual(await record(owner.claims, owner.id, request, payload), [{ id: sale.id }]);
  assert.deepEqual(await record(owner.claims, owner.id, request, payload), [{ id: sale.id }]);
  await assert.rejects(record(owner.claims, owner.id, request, { ...payload, revenueMinor: 10001 }), { code: 'PT409' });
  await assert.rejects(record(owner.claims, owner.id, randomUUID(), payload), { code: 'PT409' });
  await assert.rejects(record(owner.claims, owner.id, randomUUID(), { ...payload, id: 'spoof', actorId: outsider.claims.sub }), { code: 'PT400' });
  await assert.rejects(asUser(db, owner.claims, 'select * from ' + operationTable), { code: '42501' });
  await assert.rejects(asUser(db, owner.claims, 'select phonebooks_team_private.record_inventory_operation($1,$2,$3)', [owner.id, request, payload]), { code: '42501' });
  const postings = await db.query('select delta_minor::int as delta from phonebooks_team_private.inventory_account_movements where workspace_id=$1', [owner.id]);
  assert.deepEqual(postings.rows, [{ delta: 10000 }]);
});

test('team totals include owner and employee effects and preserve the original sale after a return', async () => {
  const owner = await workspace();
  const employee = await seedSession(db, await seedUser(db, randomUUID() + '@phonebooks.test'));
  await db.query("insert into phonebooks_team_private.memberships (workspace_id,user_id,role) values ($1,$2,'employee')", [owner.id, employee.sub]);
  await addAccount(owner.id, 'cash');
  const write = async (claims, id, options) => {
    const { workspaceId, actorId, ...payload } = document(id, options);
    return record(claims, owner.id, randomUUID(), payload);
  };
  await write(owner.claims, 'sale-a', { revenueMinor: 12000, costMinor: 5000, groupId: 'receipt', postings: [{ accountId: 'cash', amountMinor: 12000 }] });
  await write(owner.claims, 'sale-b', { revenueMinor: 1000, costMinor: 500, groupId: 'receipt', postings: [{ accountId: 'cash', amountMinor: 1000 }] });
  await write(employee, 'sale-c', { revenueMinor: 600, costMinor: 100, postings: [{ accountId: 'cash', amountMinor: 600 }] });
  await write(employee, 'return', { type: 'customer_return', relatedId: 'sale-a', revenueMinor: -150,
    postings: [{ accountId: 'cash', amountMinor: -150 }] });
  await assert.rejects(write(employee, 'missing-return', { type: 'supplier_return', relatedId: 'wrong' }), { code: '23503' });
  await assert.rejects(write(employee, 'wrong-kind', { type: 'supplier_return', relatedId: 'sale-a' }), { code: '23503' });
  const { workspaceId, actorId, ...booking } = document('booking', { type: 'reservation' });
  await assert.rejects(record(employee, owner.id, randomUUID(), {
    ...booking, postings: [{ accountId: 'cash', amountMinor: 1 }],
  }), { code: '23503' });
  const amounts = (actor = null) => db.query(
    'select revenue_minor::int, cost_minor::int, sales_count::int from phonebooks_team_private.inventory_totals($1,$2)', [owner.id, actor],
  ).then(result => result.rows[0]);
  assert.deepEqual(await amounts(), { revenue_minor: 13450, cost_minor: 5600, sales_count: 2 });
  assert.deepEqual(await amounts(owner.claims.sub), { revenue_minor: 13000, cost_minor: 5500, sales_count: 1 });
  assert.deepEqual(await amounts(employee.sub), { revenue_minor: 450, cost_minor: 100, sales_count: 1 });
  await db.query('update phonebooks_team_private.memberships set revoked_at=now() where workspace_id=$1 and user_id=$2', [owner.id, employee.sub]);
  await assert.rejects(write(employee, 'after-revocation', {}), { code: 'PT403' });
  assert.equal((await amounts()).revenue_minor, 13450);
});

test('PostgreSQL and Solo agree on monetary totals from the same legacy operation documents', async () => {
  const owner = await workspace();
  const state = fixture();
  const catalog = projectInventory(state);
  const operations = projectInventoryOperations(state);
  const expected = summarizeInventoryOperations(operations);
  for (const account of state.accounts) await addAccount(owner.id, account.id);
  for (const product of catalog.products) {
    await addProduct(owner.id, product.id, product.categoryId, product.tracking, product.attributes);
  }
  for (const operation of operations) {
    const { actorId, workspaceId, ...payload } = operation;
    await record(owner.claims, owner.id, randomUUID(), payload);
  }
  const { rows: [totals] } = await db.query(
    'select revenue_minor::int, cost_minor::int, expense_minor::int, sales_count::int from phonebooks_team_private.inventory_totals($1)',
    [owner.id],
  );
  assert.deepEqual(totals, {
    revenue_minor: expected.revenueMinor, cost_minor: expected.costMinor,
    expense_minor: expected.expenseMinor, sales_count: expected.salesCount,
  });
  const { rows: movements } = await db.query(
    'select account_id, delta_minor::int from phonebooks_team_private.inventory_account_movements where workspace_id=$1',
    [owner.id],
  );
  assert.deepEqual(new Map(movements.map(row => [row.account_id, row.delta_minor])), expected.accounts);
});
