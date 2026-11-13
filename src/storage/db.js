import { IS_DEMO, STORAGE_PREFIX, requireDataTransfer } from "../config.js";
import { parseImportFile, validateState } from "./backupFormat.js";
/**
 * IndexedDB, резервные копии, экспорт/импорт и миграция localStorage.
 *
 * Совместимая схема v1; завершение записи подтверждается транзакцией IndexedDB.
 */
export const DB_NAME = IS_DEMO ? "phonebooks-demo" : "phonebooks",
  DB_VERSION = 1,
  STORE_STATE = "state",
  STORE_BACKUPS = "backups",
  STORE_META = "meta",
  KEY_CURRENT = "current",
  MAX_BACKUPS = 10,
  LEGACY_STORAGE_KEY = STORAGE_PREFIX + "data.v1";
export let dbPromise = null;
export function openDatabase() {
  return (
    dbPromise ||
    ((dbPromise = new Promise((s, t) => {
      if (typeof indexedDB > "u") {
        t(new Error("IndexedDB недоступен"));
        return;
      }
      const n = indexedDB.open(DB_NAME, DB_VERSION);
      ((n.onupgradeneeded = () => {
        const a = n.result;
        (a.objectStoreNames.contains(STORE_STATE) ||
          a.createObjectStore(STORE_STATE),
          a.objectStoreNames.contains(STORE_BACKUPS) ||
            a.createObjectStore(STORE_BACKUPS, {
              keyPath: "id",
            }),
          a.objectStoreNames.contains(STORE_META) ||
            a.createObjectStore(STORE_META));
      }),
        (n.onsuccess = () => {
          const a = n.result;
          ((a.onversionchange = () => a.close()), s(a));
        }),
        (n.onerror = () =>
          t(n.error ?? new Error("Не удалось открыть базу данных"))),
        (n.onblocked = () =>
          t(new Error("База данных занята другой вкладкой"))));
    })),
    dbPromise)
  );
}
export function runStore(name, mode, operation) {
  if (name === STORE_BACKUPS) requireDataTransfer();
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    let request;
    try { request = operation(tx.objectStore(name)); }
    catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error("Транзакция прервана"));
  }));
}
export function isValidState(s) {
  if (!s || typeof s != "object") return !1;
  const t = s;
  return (
    Array.isArray(t.accounts) &&
    t.accounts.length > 0 &&
    Array.isArray(t.phones)
  );
}
let expectedState;
export function acceptPersistedState(state) { expectedState = JSON.stringify(state); }
export async function loadState() {
  const state = await runStore(STORE_STATE, "readonly", store => store.get(KEY_CURRENT));
  if (state === undefined) {
    const backups = IS_DEMO ? 0 : await runStore(STORE_BACKUPS, "readonly", store => store.count());
    if (backups) throw new Error("Текущее состояние отсутствует, но есть резервные копии. Автоматическое создание пустой базы заблокировано");
    expectedState = undefined; return null;
  }
  if (!isValidState(state)) throw new Error("Текущее состояние повреждено. Автоматическая перезапись заблокирована");
  const checked = validateState(state, { legacy: true });
  acceptPersistedState(state);
  return checked;
}
export async function persistState(state) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STATE, STORE_META], "readwrite");
    let failure;
    const request = tx.objectStore(STORE_STATE).get(KEY_CURRENT);
    request.onsuccess = () => {
      if (JSON.stringify(request.result) !== expectedState) {
        failure = new Error("База изменена другой вкладкой. Перезагрузите приложение"); tx.abort(); return;
      }
      const pending = tx.objectStore(STORE_META).get("pendingImport");
      pending.onsuccess = () => {
        if (pending.result) { failure = new Error("Выполняется импорт в другой вкладке"); tx.abort(); return; }
        tx.objectStore(STORE_STATE).put(state, KEY_CURRENT);
        tx.objectStore(STORE_META).put({ at: new Date().toISOString() }, "lastSaved");
      };
    };
    tx.oncomplete = () => { acceptPersistedState(state); resolve(); };
    tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error("Ошибка сохранения"));
  });
}
export async function getLastSaved() {
  try {
    const s = await runStore(STORE_META, "readonly", (t) => t.get("lastSaved"));
    return (s == null ? void 0 : s.at) ?? null;
  } catch {
    return null;
  }
}
export async function listBackups() {
  requireDataTransfer();
  try {
    return (await runStore(STORE_BACKUPS, "readonly", (t) => t.getAll())).sort(
      (t, n) => n.at.localeCompare(t.at),
    );
  } catch {
    return [];
  }
}
export async function createBackup(s, t = "auto") {
  requireDataTransfer();
  const n = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    payload: JSON.stringify(s),
    phones: s.phones.length,
    sales: s.sales.length,
    reason: t,
  };
  await runStore(STORE_BACKUPS, "readwrite", (r) => r.put(n));
  const c = (await listBackups()).slice(MAX_BACKUPS);
  for (const r of c)
    await runStore(STORE_BACKUPS, "readwrite", (i) => i.delete(r.id));
  return n;
}
export async function readBackup(s) {
  requireDataTransfer();
  const t = await runStore(STORE_BACKUPS, "readonly", (n) => n.get(s));
  if (!t) return null;
  try {
    const n = JSON.parse(t.payload);
    return isValidState(n) ? n : null;
  } catch {
    return null;
  }
}
export async function migrateLegacyState() {
  if (IS_DEMO) return null;
  const source = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!source) return null;
  const parsed = parseImportFile(source);
  if (!parsed.data) throw new Error(parsed.error);
  await persistState(parsed.data);
  await createBackup(parsed.data, "manual");
  // Retain the legacy source as an additional recovery route.
  return parsed.data;
}
export { buildExportFile, parseImportFile } from "./backupFormat.js";
export function downloadJson(s, t) {
  requireDataTransfer();
  const n = JSON.stringify(t, null, 2),
    a = new Blob([n], {
      type: "application/json",
    }),
    c = URL.createObjectURL(a),
    r = document.createElement("a");
  ((r.href = c),
    (r.download = s),
    (r.rel = "noopener"),
    document.body.appendChild(r),
    r.click(),
    r.remove(),
    setTimeout(() => URL.revokeObjectURL(c), 4e3));
}
export async function getStorageEstimate() {
  var s;
  try {
    if (!((s = navigator.storage) != null && s.estimate)) return null;
    const t = await navigator.storage.estimate();
    return {
      used: t.usage ?? 0,
      quota: t.quota ?? 0,
    };
  } catch {
    return null;
  }
}
