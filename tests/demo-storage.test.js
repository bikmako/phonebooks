import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
globalThis.__PHONEBOOKS_DEMO__ = true;
const config = await import('../src/config.js');
const db = await import('../src/storage/db.js');
const full = await import('../src/storage/fullBackup.js');
const format = await import('../src/storage/backupFormat.js');
const { createDemoState } = await import('../src/demo/seed.js');
const { resetDemoStorage } = await import('../src/demo/storage.js');
const { saveDraft, readDraft, DRAFT_PREFIX } = await import('../src/utils/drafts.js');
const entries = new Map();
globalThis.localStorage = new Proxy({}, {
  get: (_, key) => key === 'getItem' ? k => entries.get(k) ?? null : key === 'setItem' ? (k, v) => entries.set(k, v) : key === 'removeItem' ? k => entries.delete(k) : undefined,
  ownKeys: () => [...entries.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});
test('demo names, legacy bypass and reset preserve paid data, drafts, theme and backup metadata', async () => {
  assert.equal(db.DB_NAME, 'phonebooks-demo'); assert.equal(config.STORAGE_PREFIX, 'phonebooks.demo.');
  assert.equal(DRAFT_PREFIX, 'phonebooks.demo.draft.');
  assert.throws(() => config.assertDemoOrigin('https://bikmako.github.io'), /отдельном домене/);
  const paid = await new Promise(resolve => { const r = indexedDB.open('phonebooks', 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => resolve(r.result); });
  await new Promise(resolve => { const t = paid.transaction('state', 'readwrite'); t.objectStore('state').put('paid sentinel', 'current'); t.oncomplete = resolve; });
  entries.set('phonebooks.data.v1', '{invalid legacy data that must never be read}');
  entries.set('phonebooks.theme', 'dark'); entries.set('phonebooks.draft.phone-new', 'paid draft'); entries.set('unrelated', 'keep');
  const before = new Map(entries);
  assert.equal(await db.migrateLegacyState(), null); assert.equal(await db.loadState(), null);
  const seed = createDemoState(); await db.persistState(seed);
  assert.deepEqual(await db.loadState(), seed);
  saveDraft('phone-new', { model: 'Demo draft' }); assert.equal(readDraft('phone-new').model, 'Demo draft');
  entries.set('phonebooks.demo.theme', 'light');
  await db.persistState({ ...seed, phones: [], sales: [] });
  const database = await db.openDatabase();
  await new Promise(resolve => { const t = database.transaction(['meta', 'backups'], 'readwrite'); t.objectStore('meta').put('sentinel', 'recovery:test'); t.objectStore('backups').put({ id: 'sentinel' }); t.oncomplete = resolve; });
  await resetDemoStorage(seed);
  assert.deepEqual(await db.loadState(), seed); assert.deepEqual(entries, before);
  for (const store of ['meta', 'backups']) {
    const rows = await new Promise(resolve => { const r = database.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); });
    assert.equal(rows.length, store === 'meta' ? 1 : 0);
  }
  assert.equal(await new Promise(resolve => { const r = paid.transaction('state').objectStore('state').get('current'); r.onsuccess = () => resolve(r.result); }), 'paid sentinel'); paid.close();
});
test('backup, download, import and recovery entry points reject before storage or callbacks', async () => {
  const blocked = /В ДЕМО перенос данных/;
  for (const call of [() => db.listBackups(), () => db.createBackup({}), () => db.readBackup('x'), () => full.captureSnapshot(), () => full.exportFullBackup(), () => full.recoverInterruptedImport(), () => full.listRecoveryCopies(), () => full.prepareImport({})]) await assert.rejects(call, blocked);
  for (const call of [() => db.downloadJson('x', {}), () => format.buildExportFile({}), () => format.parseImportFile('{}'), () => full.captureLocal(), () => db.runStore('backups', 'readonly', () => { throw new Error('should not run'); })]) assert.throws(call, blocked);
});
test('aborted reset keeps the entire previous demo database', async () => {
  const before = await db.loadState();
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) { if (this.name === 'state') { throw new Error('injected reset failure'); } return original.apply(this, args); };
  try { await assert.rejects(() => resetDemoStorage(createDemoState()), /injected reset failure/); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await db.loadState(), before);
});
