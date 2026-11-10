/**
 * IndexedDB, резервные копии, экспорт/импорт и миграция localStorage.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
export const DB_NAME = "phonebooks",
  DB_VERSION = 1,
  STORE_STATE = "state",
  STORE_BACKUPS = "backups",
  STORE_META = "meta",
  KEY_CURRENT = "current",
  MAX_BACKUPS = 10,
  LEGACY_STORAGE_KEY = "phonebooks.data.v1";
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
export function runStore(s, t, n) {
  return openDatabase().then(
    (a) =>
      new Promise((c, r) => {
        const i = a.transaction(s, t),
          o = n(i.objectStore(s));
        ((o.onsuccess = () => c(o.result)),
          (o.onerror = () => r(o.error ?? new Error("Ошибка записи в базу"))),
          (i.onabort = () => r(i.error ?? new Error("Транзакция прервана"))));
      }),
  );
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
export async function loadState() {
  try {
    const s = await runStore(STORE_STATE, "readonly", (n) =>
      n.get(KEY_CURRENT),
    );
    if (isValidState(s)) return s;
    const t = (await listBackups())[0];
    if (t) {
      const n = JSON.parse(t.payload);
      if (isValidState(n)) return n;
    }
    return null;
  } catch {
    return null;
  }
}
export async function persistState(s) {
  const t = s;
  (await runStore(STORE_STATE, "readwrite", (n) => n.put(t, KEY_CURRENT)),
    await runStore(STORE_META, "readwrite", (n) =>
      n.put(
        {
          at: new Date().toISOString(),
        },
        "lastSaved",
      ),
    ));
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
  try {
    return (await runStore(STORE_BACKUPS, "readonly", (t) => t.getAll())).sort(
      (t, n) => n.at.localeCompare(t.at),
    );
  } catch {
    return [];
  }
}
export async function createBackup(s, t = "auto") {
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
  try {
    const s = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!s) return null;
    const t = JSON.parse(s);
    return isValidState(t)
      ? (await persistState(t),
        await createBackup(t, "manual"),
        localStorage.removeItem(LEGACY_STORAGE_KEY),
        t)
      : null;
  } catch {
    return null;
  }
}
export function buildExportFile(s) {
  return {
    app: "PhoneBooks",
    version: s.schemaVersion ?? 1,
    exportedAt: new Date().toISOString(),
    data: s,
  };
}
export function parseImportFile(s) {
  let t;
  try {
    t = JSON.parse(s);
  } catch {
    return {
      data: null,
      error: "Файл повреждён: это не JSON",
    };
  }
  const n = t && typeof t == "object" && "data" in t ? t.data : t;
  return isValidState(n)
    ? {
        data: n,
        error: null,
      }
    : {
        data: null,
        error: "В файле нет данных PhoneBooks",
      };
}
export function downloadJson(s, t) {
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
