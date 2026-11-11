/**
 * Контекст состояния приложения и хук useStore.
 *
 * Сохранения сериализованы; перенос блокирует изменения до отмены или завершения.
 */
import { checkDataIntegrity } from "../domain/integrity.js";
import { DomainError } from "../domain/shared.js";
import {
  downloadJson,
  acceptPersistedState,
  createBackup,
  getLastSaved,
  getStorageEstimate,
  listBackups,
  loadState,
  migrateLegacyState,
  persistState,
} from "../storage/db.js";
import { captureSnapshot, prepareImport, exportFullBackup, recoverInterruptedImport } from "../storage/fullBackup.js";
import { createInitialState } from "../storage/initialState.js";
import React from "react";
import { jsx } from "react/jsx-runtime";
export const StoreContext = React.createContext(null);
export function normalizeState(s) {
  var n;
  const t = createInitialState();
  return {
    ...s,
    schemaVersion: s.schemaVersion ?? 1,
    accounts: (n = s.accounts) != null && n.length ? s.accounts : t.accounts,
    phones: s.phones ?? [],
    sales: s.sales ?? [],
    expenses: s.expenses ?? [],
    transfers: s.transfers ?? [],
    cashOps: s.cashOps ?? [],
    audit: s.audit ?? [],
    settings: {
      ...t.settings,
      ...(s.settings ?? {}),
    },
    accessoryItems: s.accessoryItems ?? [],
    accessoryBatches: s.accessoryBatches ?? [],
    accessorySales: s.accessorySales ?? [],
  };
}
export function StoreProvider({ children: s }) {
  const [t, n] = React.useState(() => createInitialState()),
    [a, c] = React.useState(!1),
    [r, i] = React.useState("idle"),
    [o, l] = React.useState(null),
    [d, x] = React.useState(null),
    [v, p] = React.useState([]),
    [w, A] = React.useState(null),
    [L, O] = React.useState("month"),
    [m, f] = React.useState([]),
    C = React.useRef(t),
    S = React.useRef(null),
    g = React.useRef(null),
    transferBusy = React.useRef(false),
    writeQueue = React.useRef(Promise.resolve()),
    [startupError, setStartupError] = React.useState(null);
  C.current = t;
  const b = React.useCallback((Q) => {
      const V = Math.random().toString(36).slice(2);
      (f((_) => [
        ..._.slice(-2),
        {
          ...Q,
          id: V,
        },
      ]),
        setTimeout(() => {
          f((_) => _.filter((k) => k.id !== V));
        }, 4200));
    }, []),
    B = React.useCallback((Q) => {
      f((V) => V.filter((_) => _.id !== Q));
    }, []),
    y = React.useCallback(async () => {
      p(await listBackups());
    }, []);
  React.useEffect(() => {
    let Q = !1;
    return (
      (async () => {
        try {
        await recoverInterruptedImport();
        const _ = (await loadState()) ?? (await migrateLegacyState());
        if (!Q) {
          if (_) {
            const k = normalizeState(_);
            ((C.current = k), n(k));
          } else {
            const k = createInitialState();
            ((C.current = k), n(k), await persistState(k));
          }
          (l(await getLastSaved()),
            A(await getStorageEstimate()),
            p(await listBackups()),
            Q || c(!0));
        }
        } catch (error) { if (!Q) setStartupError(error.message); }
      })(),
      () => {
        Q = !0;
      }
    );
  }, []);
  const j = React.useCallback(async () => {
      const Q = g.current;
      if (Q) {
        ((g.current = null), i("saving"));
        try {
          (await (writeQueue.current = writeQueue.current.catch(() => {}).then(() => persistState(Q))),
            l(new Date().toISOString()),
            i("saved"),
            x(null));
        } catch (V) {
          (g.current = g.current ?? Q, i("error"),
            x(
              V instanceof Error
                ? V.message
                : "Не удалось сохранить на устройство",
            ));
        }
      }
    }, []),
    u = React.useCallback(
      (Q) => {
        ((g.current = Q),
          S.current && clearTimeout(S.current),
          (S.current = setTimeout(() => void j(), 250)));
      },
      [j],
    );
  React.useEffect(() => {
    const Q = () => {
      g.current && j();
    };
    return (
      document.addEventListener("visibilitychange", Q),
      window.addEventListener("pagehide", Q),
      () => { window.removeEventListener("pagehide", Q); document.removeEventListener("visibilitychange", Q); }
    );
  }, [j]);
  const N = React.useCallback(
      (Q) => {
        ((C.current = Q), n(Q), u(Q));
      },
      [u],
    ),
    E = React.useCallback(
      (Q) => {
        if (transferBusy.current) return { ok: false };
        const V = C.current;
        try {
          const _ = Q(V);
          return _ === V
            ? {
                ok: !0,
              }
            : (N(_),
              {
                ok: !0,
              });
        } catch (_) {
          return _ instanceof DomainError
            ? (b({
                title: "Не удалось выполнить",
                description: _.message,
                tone: "error",
              }),
              {
                ok: !1,
                error: _,
              })
            : (console.error(_),
              b({
                title: "Ошибка",
                description:
                  _ instanceof Error ? _.message : "Неизвестная ошибка",
                tone: "error",
              }),
              {
                ok: !1,
                error: new DomainError("Неизвестная ошибка"),
              });
        }
      },
      [N, b],
    ),
    R = React.useCallback(
      async (Q = "manual") => {
        try {
          (await createBackup(C.current, Q), await y());
        } catch (error) { b({ title: "Копия не создана", description: error.message, tone: "error" }); }
      },
      [y, b],
    ),
    G = React.useCallback(async () => {
      if (transferBusy.current) return;
      transferBusy.current = true;
      try {
        await j(); await writeQueue.current;
        await createBackup(C.current, "manual");
        const next = createInitialState(); await persistState(next);
        C.current = next; n(next); await y();
      } catch (error) { b({ title: "Очистка остановлена", description: error.message, tone: "error" }); }
      finally { transferBusy.current = false; }
    }, [j, b, y]);
  const beginImport = React.useCallback(async parsed => {
    if (transferBusy.current) throw new Error("Другая операция уже выполняется");
    transferBusy.current = true;
    try {
      await j(); await writeQueue.current;
      if (g.current) throw new Error("Сначала сохраните текущие изменения");
      return await prepareImport(parsed);
    } catch (error) { transferBusy.current = false; throw error; }
  }, [j]);
  const cancelImport = React.useCallback(plan => {
    plan?.cancel(); transferBusy.current = false;
  }, []);
  const finishImport = React.useCallback(async (plan, options) => {
    const next = await plan.commit(options);
    acceptPersistedState(next);
    C.current = next; n(next); l(new Date().toISOString()); i("saved");
    await y();
    transferBusy.current = false;
  }, [y]);
  const exportBackup = React.useCallback(async () => {
    await j(); await writeQueue.current;
    if (g.current) throw new Error("Сначала сохраните текущие изменения");
    return exportFullBackup();
  }, [j]);
  React.useEffect(() => {
    const Q = (V) => {
      if (V.key === "phonebooks.ping") b({ title: "Данные изменены другой вкладкой", description: "Перезагрузите приложение перед редактированием", tone: "info" });
    };
    return (
      window.addEventListener("storage", Q),
      () => window.removeEventListener("storage", Q)
    );
  }, []);
  const W = React.useMemo(() => (a ? checkDataIntegrity(t) : []), [t, a]),
    ie = React.useMemo(
      () => ({
        data: t,
        ready: a,
        saveState: r,
        savedAt: o,
        saveError: d,
        backups: v,
        period: L,
        setPeriod: O,
        toasts: m,
        notify: b,
        dismissToast: B,
        mutate: E,
        startupError,
        beginImport, cancelImport, finishImport, exportBackup,
        resetData: G,
        makeBackup: R,

        refreshBackups: y,
        storage: w,
        issues: W,
      }),
      [t, a, r, o, d, v, L, m, b, B, E, G, R, y, w, W, startupError, beginImport, cancelImport, finishImport, exportBackup],
    );
  if (startupError) return <div className="card card-pad" role="alert">
    <h1>Не удалось открыть данные</h1><p>{startupError}</p>
    <p>Запись заблокирована. Существующая база сохранена. Закройте другие вкладки и повторите запуск.</p>
    <button onClick={() => location.reload()}>Повторить запуск</button>
    <button onClick={async () => {
      try { downloadJson("phonebooks-diagnostic-recovery.json", { app: "PhoneBooks", diagnostic: true, snapshot: await captureSnapshot() }); }
      catch (error) { setStartupError(error.message); }
    }}>Скачать исходные данные для восстановления</button>
  </div>;
  return <StoreContext.Provider value={ie}>{s}</StoreContext.Provider>;
}
export function useStore() {
  const s = React.useContext(StoreContext);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
