import { readFile } from 'node:fs/promises';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createInitialState } from '../src/storage/initialState.js';
import { buildExportFile, parseImportFile, validateState, MAX_FILE_BYTES } from '../src/storage/backupFormat.js';
import { openDatabase, persistState, loadState, runStore, createBackup, acceptPersistedState } from '../src/storage/db.js';
import { captureSnapshot, exportFullBackup, prepareImport, recoverInterruptedImport } from '../src/storage/fullBackup.js';
import { createPhone, deletePhone } from '../src/domain/phones.js';
import { createSale, cancelSale } from '../src/domain/sales.js';
import { createAccessoryBatch, createAccessorySale } from '../src/domain/accessories.js';

const storage = () => {
  const data = {};
  Object.defineProperties(data, {
    getItem: { value: key => data[key] ?? null, writable: true },
    setItem: { value: (key, value) => { data[key] = String(value); }, writable: true },
    removeItem: { value: key => { delete data[key]; }, writable: true },
  });
  return data;
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (name, callback) => callback() } } });
const options = (saved = []) => ({ confirmed: true, overwriteConfirmed: true, saveBackup: async value => saved.push(value) });
let original;
beforeEach(async () => {
  globalThis.localStorage = storage();
  const db = await openDatabase();
  for (const name of ['state', 'backups', 'meta']) await runStore(name, 'readwrite', store => store.clear());
  acceptPersistedState(undefined);
  original = createInitialState();
  await persistState(original);
  localStorage.setItem('phonebooks.theme', 'dark');
  localStorage.setItem('phonebooks.draft.purchase', JSON.stringify({ model: 'Draft', price: '100' }));
  localStorage.setItem('other.app', 'do not touch');
});
async function target(name = 'Перенос') {
  const snapshot = await captureSnapshot();
  snapshot.indexedDB.state[0].value.settings.businessName = name;
  snapshot.localStorage = [{ key: 'phonebooks.theme', value: 'light' }];
  return parseImportFile(JSON.stringify(buildExportFile(snapshot)));
}

test('full export includes all stores, audit, accessories, drafts, legacy, metadata and preserves unknown fields', async () => {
  const rich = createInitialState(); rich.settings.businessName = 'Тест'; rich.futureField = { kept: true };
  rich.accounts[0].openingBalance = 100000;
  let state = createPhone(rich, { model: 'iPhone', purchasePrice: 1000, plannedPrice: 1500, purchaseDate: '2026-01-01', purchaseAccountId: 'ac_default_cash', purchasePaymentMethod: 'cash', condition: 'good' });
  state = createSale(state, { phoneId: state.phones[0].id, price: 2000, discount: 100, accountId: 'ac_default_cash', date: '2026-01-02', paymentMethod: 'cash' });
  state = createAccessoryBatch(state, { newItem: { name: 'Чехол', category: 'case', salePrice: 300, minStock: 1 }, qty: 10, unitCost: 100, date: '2026-01-01', accountId: 'ac_default_cash', paymentMethod: 'cash' });
  state = createAccessorySale(state, { items: [{ itemId: state.accessoryItems[0].id, qty: 2, unitPrice: 300 }], discount: 0, accountId: 'ac_default_cash', date: '2026-01-02', paymentMethod: 'cash' });
  validateState(state); await persistState(state); await createBackup(state);
  localStorage.setItem('phonebooks.data.v1', JSON.stringify(state));
  await runStore('meta', 'readwrite', store => store.put({ extra: 'preserved' }, 'custom'));
  const before = await captureSnapshot(), exported = await exportFullBackup();
  assert.equal(exported.formatVersion, 2);
  assert.deepEqual(exported.snapshot, before);
  const result = parseImportFile(JSON.stringify(exported));
  assert.equal(result.error, null); assert.deepEqual(result.snapshot, before);
  assert.equal(result.data.futureField.kept, true);
  assert.equal(result.data.accessorySales.length, 1);
  assert.ok(!before.localStorage.some(x => x.key === 'other.app'));
});

test('preview and cancel perform zero writes, including metadata', async () => {
  const before = await captureSnapshot(); const plan = await prepareImport(await target());
  assert.deepEqual(await captureSnapshot(), before);
  plan.cancel(); await assert.rejects(plan.commit(options()), /отменён/);
  assert.deepEqual(await captureSnapshot(), before);
});

test('both confirmations and backup are mandatory; backup failure prevents all writes', async () => {
  const before = await captureSnapshot(), parsed = await target();
  for (const opts of [{}, { confirmed: true }, { overwriteConfirmed: true }, { confirmed: true, overwriteConfirmed: true }]) {
    const plan = await prepareImport(parsed); await assert.rejects(plan.commit(opts));
    assert.deepEqual(await captureSnapshot(), before);
  }
  const plan = await prepareImport(parsed);
  await assert.rejects(plan.commit({ ...options(), saveBackup: async () => { throw Error('disk failure'); } }), /disk failure/);
  assert.deepEqual(await captureSnapshot(), before);
});

test('import and full recovery restore state, backups, metadata and localStorage', async () => {
  await createBackup(original);
  await runStore('meta', 'readwrite', store => store.put({ marker: 'before' }, 'custom'));
  const before = await captureSnapshot(), saved = [];
  const parsed = await target();
  parsed.snapshot.indexedDB.backups = [];
  parsed.snapshot.indexedDB.meta.find(x => x.key === 'custom').value = { marker: 'incoming' };
  const plan = await prepareImport(parsed);
  const state = await plan.commit(options(saved)); acceptPersistedState(state);
  assert.equal((await loadState()).settings.businessName, 'Перенос');
  assert.equal(localStorage.getItem('phonebooks.theme'), 'light');
  assert.equal(localStorage.getItem('phonebooks.draft.purchase'), null);
  assert.equal(localStorage.getItem('other.app'), 'do not touch');
  assert.deepEqual(saved[0].snapshot, before);
  const after = await captureSnapshot();
  assert.equal(after.indexedDB.backups.length, 0);
  assert.deepEqual(after.indexedDB.meta.find(x => x.key === 'custom').value, { marker: 'incoming' });
  const recovery = after.indexedDB.meta.find(x => x.key.startsWith('recovery:'));
  assert.deepEqual(recovery.value, before);
  const restore = await prepareImport({ snapshot: recovery.value });
  await restore.commit(options());
  const restored = await captureSnapshot();
  assert.deepEqual(restored.indexedDB.state, before.indexedDB.state);
  assert.deepEqual(restored.indexedDB.backups, before.indexedDB.backups);
  assert.deepEqual(restored.indexedDB.meta.find(x => x.key === 'custom').value, { marker: 'before' });
  assert.deepEqual(restored.localStorage, before.localStorage);
  assert.equal(parseImportFile(JSON.stringify(await exportFullBackup())).error, null);
});

test('legacy envelope and raw state accepted, incomplete collections defaulted only for legacy', async () => {
  for (const file of [original, { app: 'PhoneBooks', version: 1, data: original }]) {
    const parsed = parseImportFile(JSON.stringify(file));
    assert.equal(parsed.legacy, true); assert.deepEqual(parsed.data, original);
  }
  const minimal = { accounts: original.accounts, phones: [] };
  assert.equal(parseImportFile(JSON.stringify(minimal)).error, null);
  const plan = await prepareImport(parseImportFile(JSON.stringify(minimal)));
  await plan.commit(options());
  assert.equal(localStorage.getItem('phonebooks.theme'), 'dark');
  assert.equal(localStorage.getItem('phonebooks.draft.purchase'), null);
});

test('malformed JSON, null, wrong app, unknown versions, missing arrays and poisoned keys rejected', async () => {
  const valid = await exportFullBackup();
  const cases = ['{', 'null', '[]', '{}', '{"__proto__":{}}', JSON.stringify({ app: 'Other', version: 1, data: original })];
  for (const mutate of [
    x => x.formatVersion = 999,
    x => x.schemaVersion = 2,
    x => x.snapshot.indexedDB.version = 2,
    x => delete x.snapshot.indexedDB.backups,
    x => delete x.snapshot.indexedDB.state[0].value.sales,
    x => x.snapshot.indexedDB.state[0].value.accounts[0].openingBalance = '100',
    x => x.snapshot.indexedDB.state[0].value.accounts.push(x.snapshot.indexedDB.state[0].value.accounts[0]),
    x => x.snapshot.localStorage.push({ key: 'other.app', value: 'bad' }),
    x => x.snapshot.localStorage[0].value = '{bad json',
    x => x.snapshot.indexedDB.backups.push({ key: 'bad', value: { id: 'bad', at: new Date().toISOString(), payload: '{' } }),
    x => x.snapshot.indexedDB.meta.push({ key: 'pendingImport', value: {} }),
  ]) { const file = structuredClone(valid); mutate(file); cases.push(JSON.stringify(file)); }
  const before = await captureSnapshot();
  for (const source of cases) assert.ok(parseImportFile(source).error, source.slice(0, 100));
  assert.deepEqual(await captureSnapshot(), before);
});

test('broken references, numeric overflow and malformed nested accessory data rejected', () => {
  const s = structuredClone(original);
  s.expenses.push({ id: 'bad', accountId: 'missing', date: '2026-01-01', category: 'other', amount: 1 });
  assert.ok(parseImportFile(JSON.stringify(s)).error);
  assert.ok(parseImportFile(JSON.stringify(original).replace('"openingBalance":0', '"openingBalance":1e999')).error);
  assert.ok(parseImportFile(' '.repeat(MAX_FILE_BYTES + 1)).error);
});

test('stale preview is rejected after state, metadata, backups or localStorage change', async () => {
  const changes = [
    () => persistState({ ...original, settings: { ...original.settings, businessName: 'Changed' } }),
    () => runStore('meta', 'readwrite', store => store.put('changed', 'extra')),
    () => createBackup(original),
    () => localStorage.setItem('phonebooks.theme', 'system'),
  ];
  for (const change of changes) {
    const plan = await prepareImport(await target()); await change();
    const current = await captureSnapshot();
    await assert.rejects(plan.commit(options()), /изменил|изменились/);
    assert.deepEqual(await captureSnapshot(), current);
  }
});

test('localStorage quota failure rolls back and leaves IndexedDB unchanged', async () => {
  const before = await captureSnapshot(), actual = localStorage.setItem;
  const plan = await prepareImport(await target());
  let failed = false;
  localStorage.setItem = (key, value) => { if (!failed) { failed = true; throw Error('QuotaExceededError'); } actual(key, value); };
  await assert.rejects(plan.commit(options()), /Quota/);
  assert.deepEqual(await captureSnapshot(), before);
});

test('aborted final IndexedDB transaction rolls back localStorage and retains original database', async () => {
  const before = await captureSnapshot(), db = await openDatabase(), transact = db.transaction.bind(db);
  const plan = await prepareImport(await target()); let writes = 0;
  db.transaction = (...args) => {
    const tx = transact(...args);
    if (args[1] === 'readwrite' && ++writes === 2) {
      const store = tx.objectStore('state'), put = store.put.bind(store);
      store.put = (...values) => { const result = put(...values); tx.abort(); return result; };
    }
    return tx;
  };
  try { await assert.rejects(plan.commit(options())); }
  finally { db.transaction = transact; }
  assert.deepEqual(await captureSnapshot(), before);
});

test('startup recovery after interruption restores localStorage and removes journal', async () => {
  const before = await captureSnapshot();
  await runStore('meta', 'readwrite', store => store.put({ localStorage: before.localStorage }, 'pendingImport'));
  localStorage.setItem('phonebooks.theme', 'light'); localStorage.removeItem('phonebooks.draft.purchase');
  await recoverInterruptedImport();
  assert.deepEqual(await captureSnapshot(), before);
});

test('failed startup rollback keeps journal and never writes empty initial state', async () => {
  const before = await captureSnapshot(), actual = localStorage.setItem;
  await runStore('meta', 'readwrite', store => store.put({ localStorage: before.localStorage }, 'pendingImport'));
  localStorage.setItem = () => { throw Error('storage blocked'); };
  await assert.rejects(recoverInterruptedImport(), /storage blocked/);
  const journal = await runStore('meta', 'readonly', store => store.get('pendingImport')); assert.ok(journal);
  localStorage.setItem = actual;
  await recoverInterruptedImport();
  assert.deepEqual(await captureSnapshot(), before);
});

test('state saves reject stale tab writes after import', async () => {
  const plan = await prepareImport(await target()); await plan.commit(options());
  await assert.rejects(persistState(original), /другой вкладкой/);
  assert.equal((await loadState()).settings.businessName, 'Перенос');
});

test('corrupt current state blocks startup without replacing data', async () => {
  await runStore('state', 'readwrite', store => store.put({ corrupt: true }, 'current'));
  await assert.rejects(loadState(), /повреждено/);
  assert.deepEqual(await runStore('state', 'readonly', store => store.get('current')), { corrupt: true });
});

test('preview objects cannot change the committed payload', async () => {
  const plan = await prepareImport(await target('Original plan'));
  plan.snapshot.indexedDB.state[0].value.settings.businessName = 'Tampered';
  plan.before.localStorage.length = 0;
  const imported = await plan.commit(options());
  assert.equal(imported.settings.businessName, 'Original plan');
});

test('cancel while awaiting external backup prevents the journal and all writes', async () => {
  const before = await captureSnapshot(), plan = await prepareImport(await target());
  let resume;
  const pending = plan.commit({ ...options(), saveBackup: () => new Promise(resolve => { resume = resolve; }) });
  while (!resume) await new Promise(resolve => setImmediate(resolve));
  plan.cancel(); resume();
  await assert.rejects(pending, /отменён/);
  assert.deepEqual(await captureSnapshot(), before);
});

test('nested accessory corruption and wrong scalar types rejected before preview', async () => {
  let state = createInitialState(); state.accounts[0].openingBalance = 10000;
  state = createAccessoryBatch(state, { newItem: { name: 'Чехол', category: 'case', salePrice: 300, minStock: 1 }, qty: 10, unitCost: 100, date: '2026-01-01', accountId: 'ac_default_cash', paymentMethod: 'cash' });
  state = createAccessorySale(state, { items: [{ itemId: state.accessoryItems[0].id, qty: 2, unitPrice: 300 }], discount: 0, accountId: 'ac_default_cash', date: '2026-01-02', paymentMethod: 'cash' });
  for (const mutate of [
    x => x.accessorySales[0].items = null,
    x => x.accessorySales[0].items[0].allocations = null,
    x => x.accessorySales[0].items[0].allocations[0].batchId = 'missing',
    x => x.accessorySales[0].items[0].qty = '2',
    x => x.accessoryItems[0].compatibility = {},
    x => x.accounts[0].archived = 'false',
    x => x.accessoryBatches[0].date = 'invalid date',
    x => x.accessorySales[0].status = 'unknown',
  ]) { const bad = structuredClone(state); mutate(bad); assert.ok(parseImportFile(JSON.stringify(bad)).error); }
});

test('missing current state with existing backups does not create an empty base', async () => {
  await createBackup(original);
  await runStore('state', 'readwrite', store => store.delete('current'));
  await assert.rejects(loadState(), /пустой базы заблокировано/);
  assert.equal(await runStore('state', 'readonly', store => store.get('current')), undefined);
});


test('cancelled sales of deleted phones remain portable as allowed by original domain logic', () => {
  let state = createInitialState(); state.accounts[0].openingBalance = 10000;
  state = createPhone(state, { model: 'iPhone', purchasePrice: 1000, plannedPrice: 1500, purchaseDate: '2026-01-01', purchaseAccountId: 'ac_default_cash', purchasePaymentMethod: 'cash', condition: 'good' });
  state = createSale(state, { phoneId: state.phones[0].id, price: 2000, discount: 100, accountId: 'ac_default_cash', date: '2026-01-02', paymentMethod: 'cash' });
  state = cancelSale(state, state.sales[0].id);
  state = deletePhone(state, state.phones[0].id);
  assert.equal(validateState(state).sales.length, 1);
  assert.equal(parseImportFile(JSON.stringify(state)).error, null);
});

test('subsequent external pre-import backups include earlier full recovery copies', async () => {
  const first = await prepareImport(await target('First')); const next = await first.commit(options()); acceptPersistedState(next);
  const before = await captureSnapshot(), saved = [];
  assert.ok(before.indexedDB.meta.some(x => x.key.startsWith('recovery:')));
  const second = await prepareImport(await target('Second')); await second.commit(options(saved));
  assert.deepEqual(saved[0].snapshot, before);
  assert.equal(parseImportFile(JSON.stringify(saved[0])).error, null);
});

test('malformed active form drafts and inconsistent backup counters rejected', async () => {
  const file = await exportFullBackup();
  for (const entry of [
    { key: 'phonebooks.draft.phone-new', value: '{"kit":{}}' },
    { key: 'phonebooks.draft.sale-new', value: '{"accLines":{}}' },
    { key: 'phonebooks.draft.sale-new', value: '{"accLines":[{"itemId":"a","qty":"2","unitPrice":100}]}' },
  ]) { const bad = structuredClone(file); bad.snapshot.localStorage.push(entry); assert.ok(parseImportFile(JSON.stringify(bad)).error); }
  await createBackup(original);
  const bad = await exportFullBackup(); bad.snapshot.indexedDB.backups[0].value.phones = 100;
  assert.ok(parseImportFile(JSON.stringify(bad)).error);
});

test('exports cannot exceed the parser byte limit, including UTF-8 and pretty-printing', async () => {
  const snapshot = await captureSnapshot(); snapshot.indexedDB.state[0].value.extension = 'я'.repeat(17 * 1024 * 1024);
  assert.throws(() => buildExportFile(snapshot), /32 МБ/);
});
test('invalid calendar dates are rejected consistently', async () => {
  for (const at of ['2026-02-30T12:00:00Z', '2026-13-01', '01/02/2026']) {
    const snapshot = await captureSnapshot(); snapshot.indexedDB.state[0].value.accounts[0].createdAt = at;
    assert.throws(() => buildExportFile(snapshot), /дата/);
  }
});
test('recovery key collisions preserve both incoming and existing copies', async () => {
  const existing = await captureSnapshot();
  const key = 'recovery:2026-01-01T00:00:00.000Z';
  await runStore('meta', 'readwrite', store => store.put(existing, key));
  const incoming = await captureSnapshot();
  incoming.indexedDB.meta.find(x => x.key === key).value.indexedDB.state[0].value.settings.businessName = 'Different recovery';
  const plan = await prepareImport({ snapshot: incoming }); await plan.commit(options());
  const copies = (await captureSnapshot()).indexedDB.meta.filter(x => x.key.startsWith('recovery:'));
  assert.ok(copies.some(x => JSON.stringify(x.value) === JSON.stringify(existing)));
  assert.ok(copies.some(x => x.value.indexedDB.state[0].value.settings.businessName === 'Different recovery'));
  assert.equal(copies.length, 3);
});

test('corrupt recovery journal cannot clear drafts or write unrelated keys', async () => {
  const before = localStorage.getItem('phonebooks.draft.purchase');
  await runStore('meta', 'readwrite', store => store.put({ localStorage: [{ key: 'other.app', value: 'overwrite' }] }, 'pendingImport'));
  await assert.rejects(recoverInterruptedImport(), /localStorage/);
  assert.equal(localStorage.getItem('phonebooks.draft.purchase'), before);
  assert.equal(localStorage.getItem('other.app'), 'do not touch');
  assert.ok(await runStore('meta', 'readonly', store => store.get('pendingImport')));
});


test('read-only migration bridge also refuses exports above the import size limit', async () => {
  const state = structuredClone(original); state.extension = 'я'.repeat(17 * 1024 * 1024);
  await persistState(state);
  const source = await readFile(new URL('../tools/export-netlify-backup.js', import.meta.url), 'utf8');
  const errors = [], previous = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try { await eval(source); } finally { console.error = previous; }
  assert.equal(errors.length, 1); assert.match(errors[0], /32 МБ/);
  assert.equal((await loadState()).extension.length, state.extension.length);
});
