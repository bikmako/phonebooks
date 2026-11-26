import { emptyInventory, INVENTORY_KEY, projectInventory, validateInventory } from '../domain/inventory.js';
import { safeJson, validateState } from './backupFormat.js';
import { KEY_CURRENT, openDatabase, STORE_META, STORE_STATE } from './db.js';

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function withInventoryTransaction(mode, action) {
  const db = await openDatabase();
  const tx = db.transaction([STORE_STATE, STORE_META], mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error('Транзакция каталога прервана'));
  });
  done.catch(() => {});
  try {
    const meta = tx.objectStore(STORE_META);
    const [current, stored, pending] = await Promise.all([
      requestResult(tx.objectStore(STORE_STATE).get(KEY_CURRENT)),
      requestResult(meta.get(INVENTORY_KEY)),
      requestResult(meta.get('pendingImport')),
    ]);
    if (pending) throw new Error('Сначала завершите восстановление прерванного импорта');
    const state = validateState(current, { legacy: true });
    const catalog = state.catalog ?? (stored === undefined ? emptyInventory() : validateInventory(stored));
    const result = action(state, catalog, meta);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction already ended. */ }
    await done.catch(() => {});
    throw error;
  }
}

export function readInventoryCatalog() {
  return withInventoryTransaction('readonly', (_, catalog) => catalog);
}

export function loadInventory() {
  return withInventoryTransaction('readonly', (state, catalog) => projectInventory(state, catalog));
}

export function updateInventory(expectedRevisionId, change) {
  return withInventoryTransaction('readwrite', (state, catalog, meta) => {
    if (catalog.revisionId !== expectedRevisionId) throw new Error('Каталог изменён другой вкладкой');
    const candidate = change(structuredClone(catalog));
    if (!candidate || typeof candidate.then === 'function') throw new Error('Изменение каталога должно быть синхронным');
    const next = { ...candidate, revision: catalog.revision + 1, revisionId: crypto.randomUUID() };
    safeJson(next);
    validateInventory(next);
    meta.put(next, INVENTORY_KEY);
    return projectInventory(state, next);
  });
}
