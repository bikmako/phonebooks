/**
 * Контекст состояния приложения и хук useStore.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { checkDataIntegrity } from "../domain/integrity.js";
import { DomainError } from "../domain/shared.js";
import {
  createBackup,
  getLastSaved,
  getStorageEstimate,
  listBackups,
  loadState,
  migrateLegacyState,
  persistState,
  readBackup,
} from "../storage/db.js";
import { createInitialState } from "../storage/initialState.js";
import React from "react";
import { jsx } from "react/jsx-runtime";
export const StoreContext = React.createContext(null);
export function normalizeState(s) {
  var n;
  const t = createInitialState();
  return {
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
    g = React.useRef(null);
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
        const _ = (await migrateLegacyState()) ?? (await loadState());
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
          (await persistState(Q),
            l(new Date().toISOString()),
            i("saved"),
            x(null));
        } catch (V) {
          (i("error"),
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
      document.addEventListener("visibilitychange", () => {
        document.visibilityState === "hidden" && Q();
      }),
      window.addEventListener("pagehide", Q),
      () => window.removeEventListener("pagehide", Q)
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
        } catch {}
      },
      [y],
    ),
    M = React.useCallback(
      (Q) => {
        (R("manual"), N(normalizeState(Q)), j());
      },
      [N, R, j],
    ),
    G = React.useCallback(() => {
      (R("manual"),
        N(createInitialState()),
        b({
          title: "Данные очищены",
          description: "Остался один счёт «Касса» с нулевым остатком",
          tone: "info",
        }));
    }, [N, R, b]),
    ee = React.useCallback(
      async (Q) => {
        const V = await readBackup(Q);
        return V
          ? (await createBackup(C.current, "manual"),
            N(normalizeState(V)),
            await j(),
            await y(),
            b({
              title: "Данные восстановлены",
              description: "Из резервной копии",
              tone: "success",
            }),
            !0)
          : (b({
              title: "Копия не найдена",
              tone: "error",
            }),
            !1);
      },
      [N, j, b, y],
    );
  React.useEffect(() => {
    const Q = (V) => {
      V.key === "phonebooks.ping" &&
        loadState().then((_) => {
          _ &&
            JSON.stringify(_) !== JSON.stringify(C.current) &&
            ((C.current = _), n(_));
        });
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
        replaceAll: M,
        resetData: G,
        makeBackup: R,
        restoreBackup: ee,
        refreshBackups: y,
        storage: w,
        issues: W,
      }),
      [t, a, r, o, d, v, L, m, b, B, E, M, G, R, ee, y, w, W],
    );
  return <StoreContext.Provider value={ie}>{s}</StoreContext.Provider>;
}
export function useStore() {
  const s = React.useContext(StoreContext);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
