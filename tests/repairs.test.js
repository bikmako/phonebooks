import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createInitialState } from '../src/storage/initialState.js';
import { createPhone, updatePhone, setPhoneStatus, deletePhone } from '../src/domain/phones.js';
import { completeRepair, updateRepair, deleteRepair, getRepairSessionId } from '../src/domain/repairs.js';
import { createSale, cancelSale, restoreSale } from '../src/domain/sales.js';
import { saveAccount } from '../src/domain/accounts.js';
import { saveExpense } from '../src/domain/expenses.js';
import { getAccountBalance, getAccountBalances, getPhoneTotalCost, getRepairTotal, getStockValue, getSaleProfit, getStats, getSaleMargin } from '../src/utils/calculations.js';
import { getChartData, getTopModels } from '../src/utils/chartData.js';
import { getAllOperations } from '../src/utils/operations.js';
import { validateState, buildExportFile, parseImportFile } from '../src/storage/backupFormat.js';
import { openDatabase, runStore, acceptPersistedState, persistState, loadState, createBackup } from '../src/storage/db.js';
import { exportFullBackup, prepareImport } from '../src/storage/fullBackup.js';
const cash = 'ac_default_cash', bank = 'test_bank';
const period = { from: '2000-01-01', to: '2100-01-01' };
function purchased() {
  const initial = createInitialState(); initial.accounts[0].openingBalance = 100000;
  initial.accounts.push({ ...initial.accounts[0], id: bank, name: 'Банк', type: 'bank', openingBalance: 10000 });
  return createPhone(initial, { model: 'iPhone repair test', purchasePrice: 20000, plannedPrice: 28000, purchaseDate: '2026-01-01', purchaseAccountId: cash, purchasePaymentMethod: 'cash', condition: 'good' });
}
const phone = state => state.phones[0];
const start = state => setPhoneStatus(state, phone(state).id, 'repair');
const finish = (state, amount = 2000, accountId = cash) => completeRepair(state, phone(state).id, { sessionId: getRepairSessionId(phone(state)), amount, accountId, comment: 'Замена экрана' });
const sell = state => createSale(state, { phoneId: phone(state).id, price: 28000, discount: 0, date: '2026-01-02', paymentMethod: 'cash', accountId: cash });

test('20000 + 2000: single debit, stock 22000, sale profit 6000 across all reports', () => {
  const before = start(purchased()), state = finish(before), item = phone(state);
  assert.equal(phone(before).repairs, undefined);
  assert.equal(item.purchasePrice, 20000); assert.equal(item.status, 'in_stock');
  assert.equal(getRepairTotal(item), 2000); assert.equal(getPhoneTotalCost(item), 22000);
  assert.equal(getStockValue(state), 22000); assert.equal(getAccountBalance(state, cash), 78000);
  assert.equal(getAccountBalances(state)[0].outflow, 22000); assert.equal(state.expenses.length, 0);
  assert.equal(getStats(state, period).netProfit, 0); assert.equal(getStats(state, period).cashFlow, -22000);
  const sold = sell(state), sale = sold.sales[0];
  assert.equal(getSaleProfit(sale, sold.phones), 6000); assert.equal(getSaleMargin(sale, sold.phones), 21);
  assert.equal(getStats(sold, period).netProfit, 6000); assert.equal(getStats(sold, period).cogs, 22000);
  assert.equal(getChartData(sold, 'all').reduce((sum, row) => sum + row.profit, 0), 6000);
  assert.equal(getTopModels(sold, period)[0].profit, 6000);
  assert.equal(getStockValue(sold), 0); assert.equal(getAccountBalance(sold, cash), 106000);
  assert.equal(getAllOperations(sold).filter(row => row.kind === 'repair').length, 1);
  assert.equal(getAllOperations(sold).reduce((sum, row) => sum + row.moneyEffect, 0), 6000);
  assert.match(sold.audit.find(row => row.entity === 'sale').details, /22.000.*6.000/);
});

test('repeated cycles sum, survive edits/status changes, reject stale completion even during next cycle', () => {
  const started = start(purchased()), token = getRepairSessionId(phone(started));
  const first = finish(started), next = start(first);
  assert.throws(() => completeRepair(next, phone(next).id, { sessionId: token, amount: 900, accountId: cash }), /закрыт/);
  assert.throws(() => finish(first), /уже завершён/);
  let state = finish(next, 500, bank);
  assert.equal(getPhoneTotalCost(phone(state)), 22500); assert.equal(getAccountBalance(state, bank), 9500);
  state = updatePhone(state, { ...phone(state), color: 'Синий', repairs: [] });
  state = setPhoneStatus(state, phone(state).id, 'reserved');
  assert.equal(phone(state).repairs.length, 2); assert.equal(getPhoneTotalCost(phone(state)), 22500);
  assert.equal(getRepairSessionId(start(state).phones[0]) === token, false);
});

test('repair cannot be bypassed by status, purchase editing, sale or sale restoration', () => {
  let state = start(purchased());
  for (const status of ['in_stock', 'reserved', 'sold', 'unknown']) {
    assert.throws(() => setPhoneStatus(state, phone(state).id, status));
    assert.throws(() => updatePhone(state, { ...phone(state), status }));
  }
  assert.equal(setPhoneStatus(state, phone(state).id, 'repair'), state);
  assert.throws(() => sell(state), /ремонт/);
  state = sell(finish(state)); state = cancelSale(state, state.sales[0].id); state = start(state);
  assert.throws(() => restoreSale(state, state.sales[0].id), /ремонт/);
  assert.equal(phone(updatePhone(state, { ...phone(state), color: 'Белый' })).repairSessionId, phone(state).repairSessionId);
});

test('editing keeps one record and rebalances same and different accounts, including sold profit', () => {
  let state = finish(start(purchased())); const id = phone(state).repairs[0].id;
  state = updateRepair(state, phone(state).id, id, { amount: 1500, accountId: cash });
  assert.equal(getAccountBalance(state, cash), 78500); assert.equal(getPhoneTotalCost(phone(state)), 21500);
  state = updateRepair(state, phone(state).id, id, { amount: 2500, accountId: bank });
  assert.equal(getAccountBalance(state, cash), 80000); assert.equal(getAccountBalance(state, bank), 7500);
  assert.equal(phone(state).repairs.length, 1); assert.equal(phone(state).repairs[0].id, id);
  state = sell(state);
  state = updateRepair(state, phone(state).id, id, { amount: 2000, accountId: bank });
  assert.equal(getSaleProfit(state.sales[0], state.phones), 6000);
  state = deleteRepair(state, phone(state).id, id);
  assert.equal(getPhoneTotalCost(phone(state)), 20000); assert.equal(getAccountBalance(state, bank), 10000);
  assert.equal(getSaleProfit(state.sales[0], state.phones), 8000);
  assert.throws(() => deleteRepair(state, phone(state).id, id), /не найден/);
});

test('zero costs require no account, allow paid/zero corrections, do not create cash movements', () => {
  let state = finish(start(purchased()), 0, 'missing');
  const id = phone(state).repairs[0].id;
  assert.equal(phone(state).repairs[0].accountId, null); assert.equal(getAccountBalance(state, cash), 80000);
  assert.equal(getAccountBalances(state)[0].movements, 1);
  state = updateRepair(state, phone(state).id, id, { amount: '25,50', accountId: cash });
  assert.equal(getAccountBalance(state, cash), 79974.5);
  state = updateRepair(state, phone(state).id, id, { amount: 0 });
  assert.equal(getAccountBalance(state, cash), 80000); assert.equal(phone(state).repairs.length, 1);
});

test('invalid, negative, non-finite, missing, sub-cent and excessive amounts never mutate state', () => {
  const state = start(purchased()), snapshot = structuredClone(state);
  for (const value of ['', ' ', null, undefined, true, -1, '-1', 'NaN', NaN, Infinity, '1e3', '10abc', '0.001', '9007199254740992']) assert.throws(() => completeRepair(state, phone(state).id, { sessionId: getRepairSessionId(phone(state)), amount: value, accountId: cash }));
  assert.deepEqual(state, snapshot);
  assert.throws(() => finish(state, 80000.01), /Недостаточно/);
  assert.throws(() => finish(state, 1, 'missing'), /счёт/);
  const paid = finish(state); const id = phone(paid).repairs[0].id;
  assert.throws(() => updateRepair(paid, phone(paid).id, id, { amount: 10001, accountId: bank }), /Недостаточно/);
  const full = finish(state, 80000);
  assert.equal(getAccountBalance(full, cash), 0);
  assert.equal(getAccountBalance(updateRepair(full, phone(full).id, phone(full).repairs[0].id, { amount: 80000, accountId: cash }), cash), 0);
});

test('archived accounts reject new debits but support correction/refund of existing repairs', () => {
  let state = finish(start(purchased()), 10000, bank); state.accounts[1].archived = true;
  const id = phone(state).repairs[0].id;
  assert.throws(() => finish(start(state), 1, bank), /архив/);
  assert.throws(() => updateRepair(state, phone(state).id, id, { amount: 10001, accountId: bank }), /архив/);
  state = updateRepair(state, phone(state).id, id, { amount: 500, accountId: bank });
  assert.equal(getAccountBalance(state, bank), 9500);
  state = deleteRepair(state, phone(state).id, id); assert.equal(getAccountBalance(state, bank), 10000);
});

test('repair-only account cannot have its opening balance rewritten', () => {
  const state = finish(start(purchased()), 2000, bank);
  assert.throws(() => saveAccount(state, { ...state.accounts[1], openingBalance: 9999 }), /уже есть операции/);
});

test('phone deletion cascades repair debits on every source account, retaining audit', () => {
  let state = finish(start(purchased())); state = finish(start(state), 500, bank);
  const id = phone(state).id; state = deletePhone(state, id);
  assert.equal(state.phones.length, 0); assert.equal(getAccountBalance(state, cash), 100000); assert.equal(getAccountBalance(state, bank), 10000);
  assert.equal(getAllOperations(state).length, 0); assert.match(state.audit[0].details, /ремонтов: 2/);
  assert.equal(state.audit.filter(row => row.entityId === id && row.summary.startsWith('Завершён')).length, 2);
  validateState(state);
});

test('unlinked repair expense remains an ordinary operating expense and debit', () => {
  let state = finish(start(purchased()));
  state = saveExpense(state, { amount: 300, category: 'repair', accountId: cash, date: '2026-01-02' });
  assert.equal(getPhoneTotalCost(phone(state)), 22000); assert.equal(getStats(state, period).opex, 300);
  assert.equal(getAccountBalance(state, cash), 77700); assert.equal(getStats(sell(state), period).netProfit, 5700);
});

test('old records with no repair fields stay intact and legacy repair status can be completed', () => {
  const old = purchased(); delete phone(old).repairSessionId;
  assert.deepEqual(validateState(old), old); assert.equal(getPhoneTotalCost(phone(old)), 20000);
  phone(old).status = 'repair'; const state = finish(old);
  assert.equal(getPhoneTotalCost(phone(state)), 22000); validateState(state);
});

test('import validates nested repairs, rejects corrupt amounts, references, duplicate IDs and active sessions', () => {
  const state = finish(start(purchased())); assert.deepEqual(validateState(state), state);
  for (const mutate of [
    s => { phone(s).repairs = {}; }, s => { phone(s).repairs[0].amount = -1; },
    s => { phone(s).repairs[0].amount = Infinity; }, s => { phone(s).repairs[0].amount = 0.001; },
    s => { phone(s).repairs[0].accountId = 'missing'; }, s => { phone(s).repairs.push(phone(s).repairs[0]); },
    s => { phone(s).repairs[0].date = '2026-02-30'; }, s => { phone(s).repairSessionId = 'active'; },
    s => { phone(s).status = 'repair'; phone(s).repairSessionId = phone(s).repairs[0].id; },
    s => { phone(s).repairs[0].amount = 0; },
  ]) { const broken = structuredClone(state); mutate(broken); assert.throws(() => validateState(broken)); }
});

beforeEach(async () => {
  const db = await openDatabase();
  for (const store of ['state', 'backups', 'meta']) await runStore(store, 'readwrite', objectStore => objectStore.clear());
  acceptPersistedState(undefined);
  const local = {};
  globalThis.localStorage = Object.assign(local, { getItem: key => local[key] ?? null, setItem: (key, value) => { local[key] = String(value); }, removeItem: key => { delete local[key]; } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (name, callback) => callback() } } });
});

test('IndexedDB reload, full backup, restore and cancelled import retain every repair and exact balances', async () => {
  let state = finish(start(purchased())); state = finish(start(state), 500, bank);
  state.customExtension = { kept: true }; phone(state).customPhoneField = 'kept';
  await persistState(state); await createBackup(state);
  assert.deepEqual(await loadState(), state);
  const exported = await exportFullBackup(), parsed = parseImportFile(JSON.stringify(exported));
  assert.equal(parsed.error, null); assert.deepEqual(parsed.data, state);
  const cancelled = await prepareImport(parsed); cancelled.cancel(); await assert.rejects(cancelled.commit({}));
  assert.deepEqual(await loadState(), state);
  await persistState(createInitialState());
  const plan = await prepareImport(parsed);
  await plan.commit({ confirmed: true, overwriteConfirmed: true, saveBackup: async () => {} });
  const restored = await loadState(); assert.deepEqual(restored, state);
  assert.equal(getAccountBalance(restored, cash), 78000); assert.equal(getAccountBalance(restored, bank), 9500);
  assert.equal(getPhoneTotalCost(phone(restored)), 22500);
  assert.deepEqual(buildExportFile(exported.snapshot).snapshot, exported.snapshot);
});

test('aborted IndexedDB write commits neither status, repair, debit, nor audit; retry works', async () => {
  const before = start(purchased()); await persistState(before);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, ...args) {
    const request = originalPut.call(this, value, ...args);
    if (this.name === 'state' && value.phones[0]?.repairs?.length) this.transaction.abort();
    return request;
  };
  try { await assert.rejects(persistState(finish(before))); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert.deepEqual(await loadState(), before);
  await persistState(finish(before)); const after = await loadState();
  assert.equal(phone(after).repairs.length, 1); assert.equal(getAccountBalance(after, cash), 78000);
});

test('storage lease rejects concurrent stale tab repair completion', async () => {
  const before = start(purchased()); await persistState(before);
  const after = finish(before); await persistState(after);
  acceptPersistedState(before);
  await assert.rejects(persistState(finish(before)), /другой вкладкой/);
  assert.deepEqual(await loadState(), after);
});
