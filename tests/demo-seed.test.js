import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState } from '../src/demo/seed.js';
import { validateState } from '../src/storage/backupFormat.js';
import { checkDataIntegrity } from '../src/domain/integrity.js';
import { getStats, getAccountBalances, getTotalMoney, getSaleProfit } from '../src/utils/calculations.js';
import { getPeriod } from '../src/utils/format.js';
import { getAccessoryStockQty } from '../src/domain/accessories.js';
import { DB_NAME, LEGACY_STORAGE_KEY } from '../src/storage/db.js';
import { IS_DEMO, STORAGE_PREFIX, sellerContact, assertDemoOrigin } from '../src/config.js';
import { DRAFT_PREFIX } from '../src/utils/drafts.js';

test('production names and behavior remain the defaults', () => {
  assert.equal(IS_DEMO, false); assert.equal(DB_NAME, 'phonebooks');
  assert.equal(LEGACY_STORAGE_KEY, 'phonebooks.data.v1');
  assert.equal(DRAFT_PREFIX, 'phonebooks.draft.'); assert.equal(STORAGE_PREFIX, 'phonebooks.');
  assert.doesNotThrow(() => assertDemoOrigin('https://bikmako.github.io'));
});
test('demo domain data reconciles independently computed revenue, profit, inventory and balances', () => {
  const s = createDemoState();
  assert.deepEqual(validateState(s), s); assert.deepEqual(checkDataIntegrity(s), []);
  assert.equal(s.phones.length, 14); assert.equal(s.phones.filter(p => p.status === 'sold').length, 7);
  assert.equal(s.sales.filter(s => s.status === 'cancelled').length, 1);
  assert.ok(s.phones.every(p => p.imei === '' && p.supplierPhone === ''));
  assert.ok(s.sales.every(s => s.buyerPhone === ''));
  assert.equal(s.accessoryItems.length, 5); assert.equal(getAccessoryStockQty(s), 72);
  const stats = getStats(s, getPeriod('month'));
  for (const [key, value] of Object.entries({ revenue: 328820, cogs: 261540, grossProfit: 67280, opex: 15350, netProfit: 51370, purchases: 404500, writeOff: 560, phoneRevenue: 320800, accRevenue: 8020 })) assert.equal(stats[key], value, key);
  // 1,100,000 opening + 328,820 sales + 50,000 deposit - 15,000 withdrawal
  // - 404,500 phones - 21,700 accessories - 1,500 repairs - 15,350 expenses.
  assert.equal(getTotalMoney(s), 1020770);
  assert.deepEqual(getAccountBalances(s).map(a => a.balance), [653660, 367110]);
  const repaired = s.phones.find(p => p.repairs?.length);
  const repairedSale = s.sales.find(s => s.phoneId === repaired.id);
  assert.equal(getSaleProfit(repairedSale, s.phones), 4400);
  assert.ok(repairedSale.date >= repaired.repairs[0].date);
  assert.ok(repaired.repairs[0].date >= repaired.purchaseDate);
  assert.ok(s.audit.length > 30);
});
test('seed dates follow first launch/reset and do not leave default analytics empty at month/year boundaries', t => {
  for (const reference of ['2025-01-01T12:00:00', '2026-03-01T12:00:00', '2026-12-31T12:00:00']) {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(reference) });
    const s = createDemoState(new Date(reference));
    assert.deepEqual(checkDataIntegrity(s), []);
    assert.equal(getStats(s, getPeriod('month', reference.slice(0,10))).netProfit, 51370);
    t.mock.timers.reset();
  }
});
test('seller links accept explicit contacts and reject unsafe/missing configuration', () => {
  for (const value of ['', 'not-a-link', 'javascript:alert(1)', 'data:text/html,hi', 'http://example.com', 'https://user:pass@example.com', 'mailto:test@example.com?body=hello']) assert.equal(sellerContact(value), null);
  for (const value of ['https://example.com/contact', 'mailto:sales@example.com', 'tel:+79990000000']) assert.equal(sellerContact(value), value);
});
