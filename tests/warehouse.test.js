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
