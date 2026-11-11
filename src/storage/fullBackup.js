import { openDatabase, DB_NAME, DB_VERSION } from './db.js';
import { buildExportFile, validateSnapshot, validateLocal, isLocalKey, validateState } from './backupFormat.js';
async function exclusive(operation) {
  if (!globalThis.navigator?.locks?.request) throw new Error('Для безопасного импорта нужен браузер с Web Locks (HTTPS или localhost)');
  return navigator.locks.request('phonebooks-storage-import', operation);
}
const STORES = ['state', 'backups', 'meta'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function captureLocal(storage = localStorage) {
  return Object.keys(storage).filter(isLocalKey).sort().map(key => ({ key, value: storage.getItem(key) }));
}
function writeLocal(entries, storage = localStorage) {
  for (const key of Object.keys(storage).filter(isLocalKey)) storage.removeItem(key);
  for (const { key, value } of entries) storage.setItem(key, value);
}
function readStores(tx) {
  return Promise.all(STORES.map(name => new Promise((resolve, reject) => {
    const entries = [], request = tx.objectStore(name).openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { entries.push({ key: cursor.key, value: cursor.value }); cursor.continue(); }
      else resolve([name, entries]);
    };
  }))).then(Object.fromEntries);
}
function completion(tx) {
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Транзакция прервана'));
  });
  done.catch(() => {}); // A cursor may reject before the transaction abort event.
  return done;
}
export async function captureSnapshot(storage = localStorage) {
  const local = captureLocal(storage);
  const db = await openDatabase(), tx = db.transaction(STORES, 'readonly'), done = completion(tx);
  const stores = await readStores(tx); await done;
  if (!same(local, captureLocal(storage))) throw new Error('Настройки или черновики изменились во время чтения. Повторите операцию');
  if (stores.meta.some(x => x.key === 'pendingImport')) throw new Error('Сначала завершите восстановление прерванного импорта');
  return { indexedDB: { name: DB_NAME, version: DB_VERSION, ...stores }, localStorage: local };
}
export async function exportFullBackup(storage = localStorage) { return buildExportFile(await captureSnapshot(storage)); }

// A durable journal bridges two APIs that cannot share a transaction. Startup rolls
// back localStorage when the final IndexedDB transaction did not commit.
async function recoverJournal(storage = localStorage) {
  const db = await openDatabase(), tx = db.transaction('meta', 'readonly'), done = completion(tx);
  const request = tx.objectStore('meta').get('pendingImport');
  const journal = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await done;
  if (!journal) return;
  writeLocal(journal.localStorage, storage);
  const cleanup = db.transaction('meta', 'readwrite'), cleaned = completion(cleanup);
  cleanup.objectStore('meta').delete('pendingImport'); await cleaned;
}
export async function recoverInterruptedImport(storage = localStorage) {
  if (!globalThis.navigator?.locks?.request) {
    const db = await openDatabase();
    const tx = db.transaction('meta', 'readonly'), done = completion(tx);
    const request = tx.objectStore('meta').get('pendingImport');
    const journal = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await done;
    if (journal) throw new Error('Для восстановления прерванного импорта нужен браузер с Web Locks');
    return;
  }
  return exclusive(() => recoverJournal(storage));
}
export async function listRecoveryCopies() {
  const snapshot = await captureSnapshot();
  return snapshot.indexedDB.meta.filter(x => x.key.startsWith('recovery:')).map(x => ({ id: x.key, at: x.key.slice(9), snapshot: x.value }));
}
export async function prepareImport(parsed, storage = localStorage) {
  const before = await captureSnapshot(storage);
  // Recovery copies are retained separately, never recursively copied into backups.
  const snapshot = parsed.snapshot ? structuredClone(parsed.snapshot) : {
    indexedDB: { name: DB_NAME, version: DB_VERSION, state: [{ key: 'current', value: validateState(parsed.data, { legacy: true }) }], backups: before.indexedDB.backups, meta: before.indexedDB.meta.filter(x => !x.key.startsWith('recovery:')) },
    localStorage: before.localStorage.filter(x => x.key === 'phonebooks.theme'),
  };
  validateSnapshot(snapshot);
  let cancelled = false, used = false;
  return Object.freeze({
    snapshot: structuredClone(snapshot), before: structuredClone(before),
    legacy: !!parsed.legacy,
    cancel() { cancelled = true; },
    async commit(options = {}) { return exclusive(async () => {
      const { confirmed = false, overwriteConfirmed = false, saveBackup } = options;
      if (cancelled || used) throw new Error('Импорт отменён или уже выполнен');
      if (!confirmed || !overwriteConfirmed) throw new Error('Нужно отдельно подтвердить импорт и замену существующих данных');
      if (typeof saveBackup !== 'function') throw new Error('Нужно сохранить предварительную копию');
      used = true;
      // Must complete before any storage mutation. A rejected download/save aborts.
      const recovery = structuredClone(before);
      recovery.indexedDB.meta = recovery.indexedDB.meta.filter(x => !x.key.startsWith('recovery:'));
      const backup = buildExportFile(before);
      await saveBackup(backup);
      if (cancelled) throw new Error('Импорт отменён');
      validateLocal(snapshot.localStorage);
      const db = await openDatabase();
      const journalTx = db.transaction(STORES, 'readwrite'), journalDone = completion(journalTx);
      try {
        const current = await readStores(journalTx);
        if (!same(current, Object.fromEntries(STORES.map(name => [name, before.indexedDB[name]]))) || !same(captureLocal(storage), before.localStorage)) throw new Error('Данные изменились после просмотра. Откройте файл заново');
        // Cursor callbacks keep this transaction active until this microtask.
        journalTx.objectStore('meta').put({ localStorage: before.localStorage }, 'pendingImport');
      } catch (error) { journalTx.abort(); await journalDone.catch(() => {}); throw error; }
      await journalDone;
      try {
        if (!same(captureLocal(storage), before.localStorage)) throw new Error('Другая вкладка изменила настройки или черновики');
        writeLocal(snapshot.localStorage, storage);
        const tx = db.transaction(STORES, 'readwrite'), done = completion(tx);
        try {
          const current = await readStores(tx);
          const withoutJournal = { ...current, meta: current.meta.filter(x => x.key !== 'pendingImport') };
          if (!same(withoutJournal, Object.fromEntries(STORES.map(name => [name, before.indexedDB[name]])))) throw new Error('Другая вкладка изменила базу. Импорт остановлен');
          for (const name of STORES) {
            const store = tx.objectStore(name); store.clear();
            for (const { key, value } of snapshot.indexedDB[name]) {
              name === 'backups' ? store.put(value) : store.put(value, key);
            }
          }
          const meta = tx.objectStore('meta');
          for (const entry of before.indexedDB.meta.filter(x => x.key.startsWith('recovery:'))) meta.put(entry.value, entry.key);
          const recoveryId = `recovery:${new Date().toISOString()}`;
          meta.put(recovery, recoveryId);
          meta.put({ at: new Date().toISOString() }, 'lastSaved');
        } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
        await done;
      } catch (error) {
        // Keep journal if rollback fails; startup will retry and block editing.
        await recoverJournal(storage);
        throw error;
      }
      return snapshot.indexedDB.state.find(x => x.key === 'current').value;
    }); },
  });
}
