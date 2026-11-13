import { IS_DEMO, STORAGE_PREFIX } from '../config.js';
import { openDatabase, acceptPersistedState, KEY_CURRENT, STORE_STATE, STORE_BACKUPS, STORE_META } from '../storage/db.js';

// One transaction replaces the complete demo DB; stale tabs retain their old
// expectedState and cannot overwrite a reset. Production storage is never opened.
export async function resetDemoStorage(state, { recover = false } = {}) {
  if (!IS_DEMO) throw new Error('Сброс демо недоступен в полной версии');
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STATE, STORE_BACKUPS, STORE_META], 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Не удалось сбросить демо'));
    try {
      for (const name of [STORE_STATE, STORE_BACKUPS, STORE_META]) tx.objectStore(name).clear();
      tx.objectStore(STORE_STATE).put(state, KEY_CURRENT);
      tx.objectStore(STORE_META).put({ at: new Date().toISOString() }, 'lastSaved');
    } catch (error) { tx.abort(); reject(error); }
  });
  acceptPersistedState(state);
  // Settings and drafts are disposable too. A successful reset reloads the UI
  // only on the explicit corruption-recovery path; normal reset stays in place.
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
  }
  if (!recover && typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.style.colorScheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', matchMedia('(prefers-color-scheme: dark)').matches ? '#0b1220' : '#f5f7fb');
  }
}
