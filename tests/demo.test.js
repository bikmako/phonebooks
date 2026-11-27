import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState } from '../src/demo/seed.js';
import { prepareSoloTransfer } from '../src/domain/soloTransfer.js';
import { projectInventory } from '../src/domain/inventory.js';
import { getStats, getTotalMoney } from '../src/utils/calculations.js';
import { warehouseProjection } from '../src/domain/warehouse.js';
import { parseImportFile } from '../src/storage/backupFormat.js';
import { analyticsPeriod, prepareSoloAnalytics, soloAnalytics } from '../src/domain/analytics.js';
import { getPeriod, today } from '../src/utils/format.js';

test('demo ledger supplies stock, receipts, repairs, returns and reserved stock for both modes', () => {
  const state = createDemoState();
  const range = getPeriod('year');
  const report = soloAnalytics(prepareSoloAnalytics(state), analyticsPeriod(range.from, range.to), today());
  const material = prepareSoloTransfer({ state });
  const { summary } = material;
  assert.deepEqual([summary.revenueMinor, summary.costMinor, summary.netProfitMinor, summary.stockCostMinor, summary.salesCount],
    [report.current.revenueMinor, report.current.costMinor, report.current.netMinor, report.current.stockMinor, report.current.sales]);
  assert.equal(summary.cashMinor, Math.round(getTotalMoney(state) * 100));
  assert.equal(summary.salesCount, getStats(state, range).salesCount);
  assert.ok(report.stock.some(row => row.days >= 60));
  assert.equal(summary.reserved, 1);
  for (const category of ['smartphones','laptops','tablets','consoles','watches','accessories','demo-audio']) {
    assert.ok(projectInventory(state).products.some(row => row.categoryId === category), category);
  }
  const types = new Set(warehouseProjection(state).operations.map(row => row.type));
  for (const type of ['purchase','sale','repair','customer_return','compensation','reserve']) assert.ok(types.has(type), type);
});

test('working import and Solo to Team reject marked demo data', () => {
  const demo = { ...createDemoState(), demoData:true };
  assert.match(parseImportFile(JSON.stringify(demo)).error, /Демонстрационная/);
  assert.throws(() => prepareSoloTransfer({ state: demo }), /Демонстрационные/);
  const full = { app:'PhoneBooks', formatVersion:2, schemaVersion:1, exportedAt:new Date().toISOString(),
    snapshot:{ indexedDB:{ name:'phonebooks', version:1, state:[{ key:'current', value:demo }], backups:[], meta:[] }, localStorage:[] } };
  assert.match(parseImportFile(JSON.stringify(full)).error, /Демонстрационная/);
});
