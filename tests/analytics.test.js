import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { analyticsPeriod, prepareSoloAnalytics, saleMetrics, soloAnalytics } from '../src/domain/analytics.js';
import { analyticsGrid } from '../src/domain/analyticsExport.js';
import { guessMapping, previewSpreadsheet, spreadsheetTemplate } from '../src/domain/spreadsheet.js';
import { readSpreadsheet, writeSpreadsheet } from '../src/domain/spreadsheetFile.js';
import { createInitialState } from '../src/storage/initialState.js';
import { getStats } from '../src/utils/calculations.js';
import { asUser, seedSession, seedUser, teamDatabase } from './support/team-database.js';

const accountId = 'ac_default_cash';
const productId = 'product:fixture';
const from = '2026-11-15', to = '2026-11-24';
const time = 'T12:00:00Z';
const range = analyticsPeriod(from, to);
function warehouseFixture() {
  const state = createInitialState();
  state.catalog = { version: 2, revision: 0, revisionId: null,
    categories: [{ id: 'custom', name: 'Мониторы', attributes: [] }],
    products: [
      { id: productId, name: 'Монитор', tracking: 'unit', attributes: {}, categoryId: 'custom', plannedPriceMinor: 2200 },
      { id: 'product:batch', name: 'Кабель', tracking: 'quantity', attributes: {}, categoryId: 'accessories' },
    ] };
  function operation(id, type, date, units, amountMinor, extra = {}) {
    return { id, productId, tracking: 'unit', type, date, createdAt: date + time, units, amountMinor, accountId, ...extra };
  }
  state.warehouse = [
    operation('buy', 'purchase', '2026-11-09', 1, 1000),
    operation('start', 'repair_start', '2026-11-10', 1, 0),
    operation('repair', 'repair', '2026-11-11', 1, 200),
    operation('sale', 'sale', '2026-11-15', 1, 2000),
    operation('comp', 'compensation', '2026-11-16', 0, 100, { originalId: 'sale' }),
    operation('return', 'customer_return', '2026-11-17', 1, 1500, { originalId: 'sale' }),
    operation('expense', 'expense', '2026-11-18', 0, 100, { productId: null }),
    operation('batch', 'purchase', '2026-11-19', 3, 300, { productId: 'product:batch', tracking: 'quantity' }),
    operation('supplier', 'supplier_return', '2026-11-20', 1, 80,
      { productId: 'product:batch', tracking: 'quantity', originalId: 'batch' }),
    operation('history', 'historical_sale', '2026-11-21', 1, 900, { sourceCostMinor: 0 }),
    operation('historical-expense', 'historical_expense', '2026-11-22', 0, 50, { productId: null }),
    operation('resale', 'sale', '2026-11-23', 1, 1800),
  ];
  return state;
}

test('Solo reports capitalized repairs, partial refunds, supplier losses, historical imports and exact comparison', () => {
  const report = soloAnalytics(prepareSoloAnalytics(warehouseFixture()), range, to);
  assert.deepEqual(report.current, {
    from, to, revenueMinor: 3100, costMinor: 1200, expensesMinor: 170, grossMinor: 1900, netMinor: 1730,
    averageMinor: 1567, margin: 61.29, purchasedUnits: 3, soldUnits: 2, sales: 3, stockMinor: 200,
  });
  assert.equal(report.previous.purchasedUnits, 1);
  const overview = getStats(warehouseFixture(), range);
  assert.deepEqual([overview.revenue, overview.cogs, overview.expensesTotal, overview.netProfit, overview.averageCheck],
    [31, 12, 1.7, 17.3, 15.67]);
  assert.equal(report.previous.netMinor, 0);
  assert.equal(report.series.find(row => row.from === '2026-11-17').costMinor, -1200);
  assert.deepEqual(report.categories.find(row => row.id === 'custom'), {
    id: 'custom', name: 'Мониторы', revenueMinor: 3100, grossMinor: 1900, sales: 3,
    soldUnits: 2, averageMinor: 950, sellDays: 6, stockMinor: 0, turnover: null,
  });
  assert.equal(report.models[0].name, 'Монитор');
  assert.deepEqual(report.stock.map(row => [row.name,row.days,row.quantity,row.stockMinor]), [['Кабель',5,2,200]]);
  assert.equal(report.previous.from, '2026-11-05');
  assert.equal(report.previous.to, '2026-11-14');
  assert.equal(analyticsPeriod('2020-02-28','2020-03-01').previousFrom, '2020-02-25');
  assert.equal(analyticsPeriod(to, from), null);
});

test('Solo counts a legacy combined receipt once and exposes incomplete historical and FIFO fields', () => {
  const state = createInitialState();
  state.phones = [{ id: 'phone', model: 'Телефон', status: 'sold', purchaseDate: '2026-11-11', purchaseAccountId: accountId, purchasePrice: 100 }];
  state.sales = [{ id: 'receipt', phoneId: 'phone', status: 'completed', accountId, date: from, price: 200, discount: 0 }];
  state.accessoryItems = [{ id: 'cable', name: 'Кабель', salePrice: 30 }, { id: 'case', name: 'Чехол', salePrice: 30 }];
  state.accessorySales = [{ id: 'addon', groupId: 'receipt', status: 'completed', accountId, date: from, discount: 10,
    items: [{ itemId: 'cable', qty: 1, unitPrice: 30, unitCost: 5 }, { itemId: 'case', qty: 1, unitPrice: 30, unitCost: 5 }] }];
  const report = soloAnalytics(prepareSoloAnalytics(state), range, to);
  assert.equal(report.current.revenueMinor, 25000);
  assert.equal(report.current.sales, 1);
  assert.equal(report.current.averageMinor, 25000);
  assert.equal(getStats(state, range).salesCount, 1);
  assert.equal(getStats(state, range).averageCheck, 250);
  assert.equal(report.categories.find(row => row.name === 'Аксессуары').grossMinor, 4000);
  assert.equal(report.categories.find(row => row.name === 'Аксессуары').sellDays, null);
  assert.deepEqual(report.models.map(row => row.name), ['Телефон']);
  state.phones = [];
  const incomplete = soloAnalytics(prepareSoloAnalytics(state), range, to);
  assert.equal(incomplete.current.revenueMinor, 25000);
  assert.equal(incomplete.current.netMinor, null);
});

test('XLSX and CSV preserve numbers, date ranges and unavailable fields without exporting concealed keys', () => {
  const data = { current: { from, to, revenueMinor: '155030', netMinor: null },
    previous: { from: range.previousFrom, to: range.previousTo, revenueMinor: '8000', netMinor: '0' }, series: [] };
  for (const format of ['csv', 'xlsx']) {
    const bytes = writeSpreadsheet(format, analyticsGrid(data, 'finance'));
    const rows = readSpreadsheet('report.' + format, bytes)[0].rows.map(row => row.values);
    assert.equal(rows[0][1], from + ' — ' + to);
    assert.equal(Number(rows[1][1]), 1550.3);
    assert.ok(!rows[2][1]);
    assert.equal(Number(rows[2][2]), 0);
    assert.ok(!rows.some(row => row.some(cell => String(cell).startsWith('Себестоимость'))));
  }
  const totals = saleMetrics([Number.MAX_SAFE_INTEGER, 2].map((revenueMinor, index) => ({ id: index, type:'sale',
    revenueMinor, costMinor: 0, expenseMinor: 0, lines: [] })));
  assert.equal(totals.revenueMinor, '9007199254740993');
  assert.equal(analyticsGrid({ ...data, current:{ ...data.current, ...totals } }, 'finance')[1][1], '90071992547409,93');
});

test('Solo builds all reports for a warehouse of 10,000 products and lots', t => {
  const count = 10000;
  const state = createInitialState();
  state.phones = Array.from({ length: count }, (_, i) => ({ id: 'old-' + i, status: 'in_stock', model: 'Модель ' + i,
    plannedPrice: 20, purchaseDate: i % 2 ? '2026-10-01' : '2026-11-23', purchasePrice: 10, purchaseAccountId: accountId }));
  const start = performance.now();
  const large = soloAnalytics(prepareSoloAnalytics(state), range, to);
  assert.equal(large.stock.length, count);
  assert.equal(large.current.purchasedUnits, count / 2);
  assert.equal(large.categories[0].stockMinor, count * 1000);
  assert.equal(large.stock.filter(row => row.days >= 31).length, count / 2);
  t.diagnostic(JSON.stringify({ lots: count, allReportsMs: Math.round(performance.now() - start) }));
});

let db, owner, staff, space;
before(async () => {
  db = await teamDatabase();
  owner = await seedSession(db, await seedUser(db, 'owner@analytics.test'));
  staff = await seedSession(db, await seedUser(db, 'staff@analytics.test'));
  [{ id: space }] = await asUser(db, owner, 'select * from public.phonebooks_team_create_workspace($1,$2)', ['Аналитика', randomUUID()]);
  await db.query("insert into phonebooks_team_private.memberships(workspace_id,user_id,role) values($1,$2,'employee')", [space, staff.sub]);
});
after(() => db?.close());

async function rpc(caller, method, ...args) {
  const params = [space, caller.sub, ...args];
  const [row] = await asUser(db, caller, 'select public.phonebooks_team_' + method + '(' + params.map((_, i) => '$' + (i + 1)) + ') as report', params);
  return row.report;
}
const command = (caller, body) => rpc(caller, 'cloud_command', randomUUID(), { accountId, ...body });
const report = (caller, mode) => rpc(caller, 'analytics', mode, from, to);
async function version(id) {
  const [item] = (await rpc(owner, 'cloud_feed', null)).products.filter(item => item.id === id);
  return item.version;
}
async function dateOperation(id, date) {
  await db.query('update phonebooks_team_private.inventory_operations set occurred_on=$3 where workspace_id=$1 and id=$2', [space, id, date]);
}

test('Team splits employee attribution and guards every detailed report field on the database', async () => {
  const deposit = await command(owner, { type:'deposit', amountMinor:50000 });
  await dateOperation(deposit.operationId, '2026-11-08');
  const purchase = await command(owner, { type:'purchase', name:'Смартфон', categoryId:'smartphones', tracking:'unit', quantity:1, unitPriceMinor:1000 });
  const [{ id }] = (await rpc(owner, 'cloud_feed', null)).products;
  await dateOperation(purchase.operationId, '2026-11-09');
  const start = await command(owner, { type:'repair_start', accountId:undefined, productId:id, expectedVersion:await version(id) });
  await dateOperation(start.operationId, '2026-11-10');
  const repair = await command(owner, { type:'repair', productId:id, expectedVersion:await version(id), amountMinor:200 });
  await dateOperation(repair.operationId, '2026-11-11');
  const sale = await command(staff, { type:'sale', productId:id, expectedVersion:await version(id), quantity:1, unitPriceMinor:2000 });
  await dateOperation(sale.operationId, from);
  const compensation = await command(owner, { type:'compensation', productId:id, expectedVersion:await version(id),
    originalId:sale.operationId, amountMinor:100, quantity:0, reason:'Проверка' });
  await dateOperation(compensation.operationId, '2026-11-16');
  const correction = await command(owner, { type:'customer_return', productId:id, expectedVersion:await version(id),
    originalId:sale.operationId, amountMinor:1500, quantity:1, reason:'Проверка' });
  await dateOperation(correction.operationId, '2026-11-17');
  const expense = await command(owner, { type:'expense', amountMinor:100 });
  await dateOperation(expense.operationId, '2026-11-19');
  const reserve = await command(owner, { type:'reserve', accountId:undefined, productId:id, expectedVersion:await version(id), quantity:1,
    unitPriceMinor:2000, buyer:'Учебный покупатель', expiresAt:new Date(Date.now() + 3600000).toISOString() });
  await dateOperation(reserve.operationId, '2026-11-20');

  const ownerStats = await rpc(owner,'stats',owner.sub,from,to);
  const sellerStats = await rpc(owner,'stats',staff.sub,from,to);
  const company = await rpc(owner,'stats',null,from,to);
  assert.deepEqual([ownerStats.returns, ownerStats.reservations, ownerStats.operations], [2,1,4]);
  assert.deepEqual([sellerStats.sales,sellerStats.returns,sellerStats.revenueMinor,sellerStats.averageMinor,sellerStats.operations], [1,0,'400','2000',1]);
  assert.equal(company.operations, ownerStats.operations + sellerStats.operations);
  assert.deepEqual([company.purchases,(await rpc(owner,'stats',owner.sub,null,null)).purchases],[0,1]);

  const finance = await report(owner,'finance');
  assert.deepEqual([finance.current.revenueMinor,finance.current.costMinor,finance.current.netMinor,
    finance.current.stockMinor,finance.previous.purchasedUnits,finance.current.soldUnits], ['400','0','300','1200',1,0]);
  assert.equal(finance.series.length, 10);
  const categories = await report(owner,'categories');
  assert.equal(categories.categories[0].sellDays, 6);
  assert.equal(categories.categories[0].grossMinor, '400');
  assert.deepEqual((await report(owner,'aging')).stock.map(row => [row.days,row.stockMinor]), [[7,'1200']]);
  for (const section of ['finance','categories','aging']) await assert.rejects(report(staff,section), { code:'PT403' });

  await db.query(`insert into phonebooks_team_private.member_overrides(workspace_id,user_id,permission,allowed)
    values($1,$2,'analytics.company',true),($1,$2,'analytics.categories',true),($1,$2,'analytics.aging',true),
      ($1,$2,'finance.revenue.read',true),($1,$2,'finance.profit.read',true)`, [space, staff.sub]);
  const maskedFinance = await report(staff,'finance');
  assert.equal(maskedFinance.current.revenueMinor, '400');
  for (const row of [maskedFinance.current,maskedFinance.previous,...maskedFinance.series]) {
    for (const key of ['costMinor','expensesMinor','grossMinor','netMinor','stockMinor','margin']) assert.ok(!Object.hasOwn(row,key));
  }
  const maskedCategory = await report(staff,'categories');
  assert.ok(!Object.hasOwn(maskedCategory,'models'));
  assert.ok(!Object.hasOwn(maskedCategory.categories[0],'grossMinor'));
  assert.ok(!Object.hasOwn((await report(staff,'aging')).stock[0],'stockMinor'));
  await db.query(`insert into phonebooks_team_private.member_overrides(workspace_id,user_id,permission,allowed)
    values($1,$2,'stock.purchase_price.read',true),($1,$2,'stock.cost.read',true),($1,$2,'repair.cost.read',true)`, [space, staff.sub]);
  await db.query("update phonebooks_team_private.member_overrides set allowed=false where workspace_id=$1 and user_id=$2 and permission='finance.profit.read'", [space, staff.sub]);
  const profitDenied = await report(staff,'finance');
  assert.equal(profitDenied.current.stockMinor, '1200');
  assert.ok(!Object.hasOwn(profitDenied.current,'costMinor'));
  assert.ok(!Object.hasOwn(profitDenied.current,'grossMinor'));
  await db.query("update phonebooks_team_private.member_overrides set allowed=false where workspace_id=$1 and user_id=$2 and permission='analytics.aging'", [space, staff.sub]);
  await assert.rejects(report(staff,'aging'), { code:'PT403' });
});

test('Team preserves explicit zero-cost imports and benchmarks reporting for 10,000 active lots', { timeout:90000 }, async t => {
  const input = [spreadsheetTemplate[0],
    ['Историческая продажа', 'Мышь', 'Периферия', 'zero', '', 'Количественный', 1, 9, 0, '', '2026-11-22', 'zero'],
    ...Array.from({ length:10000 - 1 }, (_, i) => ['Начальный остаток', 'Модель ' + i, 'Периферия',
      'large-' + i, '', 'Количественный', 1, 12, '', '', '2026-11-21', 'initial-' + i]),
  ];
  const plan = await previewSpreadsheet({ rows: input.map((values, i) => ({ values, number:i+1 })) },
    guessMapping(input[0]), { defaultType:'opening', today:to, accountId });
  assert.deepEqual(plan.errors, []);
  const feed = await rpc(owner,'cloud_feed',null);
  await rpc(owner,'sheet_import',randomUUID(),feed.cursor,{ rows:plan.rows, categories:plan.categories, products:plan.products });
  const start = performance.now();
  const aging = await report(owner,'aging');
  const agingMs = Math.round(performance.now() - start);
  assert.equal(aging.stock.length, 10000);
  assert.equal(aging.stock.filter(row => row.days == null).length, 9999);
  const financial = await report(owner,'finance');
  assert.equal(financial.current.costMinor, '0');
  assert.equal(financial.current.netMinor, '1200');
  const categories = await report(owner,'categories');
  assert.equal(categories.categories.find(row => row.name === 'Периферия').grossMinor, '900');
  assert.equal(categories.categories.find(row => row.name === 'Периферия').sellDays, null);
  t.diagnostic(JSON.stringify({ lots:aging.stock.length, agingMs, allReportsMs:Math.round(performance.now() - start) }));
});
