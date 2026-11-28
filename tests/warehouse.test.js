import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyInventory, saveInventoryCategory, saveInventoryProduct } from '../src/domain/inventory.js';
import { prepareSoloTransfer } from '../src/domain/soloTransfer.js';
import { recordWarehouse, warehouseStock } from '../src/domain/warehouse.js';
import { buildExportFile, parseImportFile } from '../src/storage/backupFormat.js';
import { createInitialState } from '../src/storage/initialState.js';
import { getAccountBalance, getStats } from '../src/utils/calculations.js';
import { getAllOperations } from '../src/utils/operations.js';
import { getPeriod } from '../src/utils/format.js';

const unit = 'product:laptop';
const bulk = 'product:module';
const cash = 'ac_default_cash';
function setup() {
  const state = createInitialState();
  state.accounts[0].openingBalance = 10000;
  let catalog = saveInventoryCategory(emptyInventory(), { id: 'upgrades', name: 'Модули', attributes: [{ id: 'size', name: 'Объём', type: 'number' }] });
  catalog = saveInventoryProduct(catalog, { id: unit, name: 'Ноутбук', categoryId: 'laptops', tracking: 'unit', attributes: { serial: 'test' }, plannedPriceMinor: 240000 });
  state.catalog = saveInventoryProduct(catalog, { id: bulk, name: 'Модули', categoryId: 'upgrades', tracking: 'quantity', attributes: { size: 16 } });
  return state;
}
function record(state, id, type, units, unitMinor, position = state.warehouse?.length ?? 0) {
  return recordWarehouse(state, id, type, { units, unitMinor, accountId: cash, position, version: 1 },
    Math.round(getAccountBalance(state, cash) * 100));
}

test('universal Solo ledger reconciles FIFO, capitalized repair, dashboard, backup and transfer', () => {
  let state = setup();
  state = record(state, unit, 'purchase', 1, 110000);
  state = record(state, unit, 'repair_start', 1, 0);
  assert.throws(() => record(state, unit, 'sale', 1, 240000), /остаток/);
  state = record(state, unit, 'repair', 1, 20000);
  assert.throws(() => record(state, unit, 'repair', 1, 20000), /открытого ремонта/);
  state = record(state, unit, 'sale', 1, 240000);
  state = record(state, bulk, 'purchase', 3, 100);
  state = record(state, bulk, 'purchase', 2, 200);
  assert.throws(() => record(state, bulk, 'sale', 6, 300), /остаток/);
  state = record(state, bulk, 'sale', 4, 300);
  assert.throws(() => record(state, bulk, 'sale', 1, 300, state.warehouse.length - 1), /Склад изменился/);
  assert.throws(() => record(state, bulk, 'purchase', 1, 10000000000), /Недостаточно/);
  assert.equal(getAccountBalance(state, cash), 11105);
  assert.equal(warehouseStock(state, bulk).stockCostMinor, 200);
  assert.equal(getStats(state, getPeriod('all')).cogs, 1305);
  assert.equal(getStats(state, getPeriod('all')).netProfit, 1107);
  assert.equal(getAllOperations(state).filter(item => item.kind === 'warehouse').length, 7);
  const material = prepareSoloTransfer({ state });
  assert.equal(material.summary.netProfitMinor, 110700);
  assert.equal(material.summary.cashMinor, 1110500);
  assert.equal(material.products.find(item => item.id === unit).plannedPriceMinor, 240000);
  assert.equal(material.lots[0].quantity, 1);
  const snapshot = { indexedDB: { name: 'phonebooks', version: 1, state: [{ key: 'current', value: state }], backups: [], meta: [] }, localStorage: [] };
  assert.equal(parseImportFile(JSON.stringify(buildExportFile(snapshot))).data.warehouse.length, 7);
  const bad = structuredClone(snapshot);
  bad.indexedDB.state[0].value.warehouse[0].accountId = 'unknown';
  assert.throws(() => buildExportFile(bad), /Неверная операция/);
});

function trade(state, productId, type, input) {
  return recordWarehouse(state, productId, type, { accountId: cash, position: state.warehouse.length, version: 1, ...input },
    Math.round(getAccountBalance(state, cash) * 100));
}
const refund = (event, units, amountMinor, extra) => ({ originalId: event.id, units, amountMinor, reason: 'Проверка возврата', ...extra });

test('Solo returns preserve the source, restore FIFO allocation costs, enforce limits and survive backup', () => {
  let state = record(setup(), bulk, 'purchase', 3, 100);
  const first = state.warehouse.at(-1);
  state = record(state, bulk, 'purchase', 2, 210);
  state = record(state, bulk, 'sale', 4, 350);
  const sale = state.warehouse.at(-1);
  state = trade(state, bulk, 'customer_return', refund(sale, 2, 700));
  assert.equal(warehouseStock(state, bulk).stockCostMinor, 410);
  assert.throws(() => trade(state, bulk, 'customer_return', refund(sale, 1, 351)), /стоимость/);
  state = trade(state, bulk, 'compensation', refund(sale, 0, 30));
  assert.equal(warehouseStock(state, bulk).quantity, 3);
  assert.throws(() => trade(state, bulk, 'void_sale', refund(sale, 4, 1400)), /превышает/);
  state = trade(state, bulk, 'customer_return', refund(sale, 2, 670));
  assert.equal(warehouseStock(state, bulk).stockCostMinor, 720);
  assert.throws(() => trade(state, bulk, 'customer_return', refund(sale, 1, 0)), /превышает/);
  state = trade(state, bulk, 'supplier_return', refund(first, 1, 80));
  assert.equal(warehouseStock(state, bulk).stockCostMinor, 620);
  assert.equal(getStats(state, getPeriod('all')).revenue, 0);
  assert.equal(getStats(state, getPeriod('all')).cogs, 0);
  assert.equal(getStats(state, getPeriod('all')).netProfit, -.2);
  assert.equal(getAccountBalance(state, cash), 9993.6);
  assert.equal(state.warehouse[2], sale);
  const snapshot = { indexedDB: { name: 'phonebooks', version: 1, state: [{ key: 'current', value: state }], backups: [], meta: [] }, localStorage: [] };
  const restored = parseImportFile(JSON.stringify(buildExportFile(snapshot))).data;
  assert.equal(warehouseStock(restored, bulk).stockCostMinor, 620);
  assert.equal(prepareSoloTransfer({ state: restored }).summary.netProfitMinor, -20);
});

test('Solo holds affect availability, expire automatically, and allow negotiated sale and corrective void to repair', () => {
  let state = record(setup(), unit, 'purchase', 1, 1100);
  const expiry = new Date(Date.now() + 3600000).toISOString();
  state = trade(state, unit, 'reserve', { units: 1, unitMinor: 2100, buyer: 'Тест', expiresAt: expiry });
  const reservationId = state.warehouse.at(-1).id;
  assert.equal(warehouseStock(state, unit).reservedQuantity, 1);
  assert.equal(warehouseStock(state, unit, Date.parse(expiry)).reservedQuantity, 0);
  assert.equal(getAccountBalance(state, cash), 9989);
  assert.throws(() => record(state, unit, 'sale', 1, 2100), /остаток/);
  assert.throws(() => trade(state, unit, 'sale', { units: 1, unitMinor: 2000, reservationId }), /другая цена/);
  state = trade(state, unit, 'extend_reserve', { reservationId, expiresAt: new Date(Date.parse(expiry) + 3600000).toISOString() });
  assert.equal(warehouseStock(state, unit, Date.parse(expiry)).reservedQuantity, 1);
  state = trade(state, unit, 'cancel_reserve', { reservationId });
  assert.equal(warehouseStock(state, unit).reservedQuantity, 0);
  state = trade(state, unit, 'reserve', { units: 1, unitMinor: 2100, buyer: 'Тест', expiresAt: expiry });
  assert.equal(prepareSoloTransfer({ state }).reservations[0].buyer, 'Тест');
  state = trade(state, unit, 'sale', { units: 1, unitMinor: 2100, reservationId: state.warehouse.at(-1).id });
  const sale = state.warehouse.at(-1);
  state = trade(state, unit, 'void_sale', refund(sale, 1, 2100, { toRepair: true }));
  assert.equal(warehouseStock(state, unit).inRepair, true);
  assert.equal(warehouseStock(state, unit).stockCostMinor, 1100);
  assert.equal(getAccountBalance(state, cash), 9989);
});
