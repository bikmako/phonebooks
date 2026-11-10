/**
 * Корневой компонент: маршруты, тосты, быстрые действия.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { AppLayout } from "./components/AppLayout.jsx";
import { QuickActionSheet } from "./components/QuickActionSheet.jsx";
import { cx } from "./components/ui.jsx";
import { useStore } from "./hooks/useStore.jsx";
import { AccessoriesPage } from "./pages/Accessories.jsx";
import { DashboardPage } from "./pages/Dashboard.jsx";
import { FinancePage } from "./pages/Finance.jsx";
import { HistoryPage } from "./pages/History.jsx";
import { PurchasePage } from "./pages/Purchase.jsx";
import { SalesPage } from "./pages/Sales.jsx";
import { SettingsPage } from "./pages/Settings.jsx";
import { navigateTo, parseHashRoute } from "./utils/router.js";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export function App() {
  const { ready: s, toasts: t, dismissToast: n } = useStore(),
    [a, c] = React.useState(parseHashRoute),
    [r, i] = React.useState(!1),
    [o, l] = React.useState(!1),
    [d, x] = React.useState(!1),
    [v, p] = React.useState(void 0);
  (React.useEffect(() => {
    const m = () => c(parseHashRoute());
    return (
      window.addEventListener("hashchange", m),
      window.location.hash || (window.location.hash = "/dashboard"),
      () => window.removeEventListener("hashchange", m)
    );
  }, []),
    React.useEffect(() => {
      a.action === "purchase" &&
        (l(!0), window.history.replaceState(null, "", `#/${a.route}`));
    }, [a]));
  const w = React.useCallback((m) => {
      (navigateTo(m),
        window.scrollTo({
          top: 0,
          behavior: "smooth",
        }));
    }, []),
    A = () => {
      (i(!1), l(!0), x(!1), a.route !== "purchase" && w("purchase"));
    },
    L = (m) => {
      (i(!1), p(m), x(!0), l(!1), a.route !== "sales" && w("sales"));
    },
    O = React.useMemo(() => {
      switch (a.route) {
        case "purchase":
          return (
            <PurchasePage
              formOpen={o}
              onOpenForm={() => l(!0)}
              onCloseForm={() => l(!1)}
              onSell={(m) => {
                (p(m), w("sales"), x(!0));
              }}
            />
          );
        case "accessories":
          return <AccessoriesPage />;
        case "sales":
          return (
            <SalesPage
              formOpen={d}
              presetPhoneId={v}
              onOpenForm={() => {
                (p(void 0), x(!0));
              }}
              onCloseForm={() => {
                (x(!1), p(void 0));
              }}
            />
          );
        case "finance":
          return <FinancePage />;
        case "history":
          return <HistoryPage />;
        case "settings":
          return <SettingsPage />;
        default:
          return (
            <DashboardPage
              onNavigate={w}
              onNewPurchase={A}
              onNewSale={() => L()}
            />
          );
      }
    }, [a.route, o, d, v]);
  return s ? (
    <Fragment>
      <AppLayout route={a.route} onNavigate={w} onQuickAction={() => i(!0)}>
        {O}
      </AppLayout>
      <QuickActionSheet
        open={r}
        onClose={() => i(!1)}
        onPurchase={A}
        onSale={() => L()}
        onGo={w}
      />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex flex-col items-center gap-2 px-3 pt-3 sm:inset-x-auto sm:right-4 sm:items-end"
        style={{
          paddingTop: "calc(var(--safe-top) + 12px)",
        }}
        aria-live="polite"
      >
        {t.map((m) => (
          <div
            className={cx(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border px-3.5 py-3 shadow-float animate-fade-up backdrop-blur-xl",
              m.tone === "success"
                ? "border-emerald-200 bg-white/95 text-emerald-800"
                : m.tone === "error"
                  ? "border-red-200 bg-white/95 text-red-700"
                  : "border-slate-200 bg-white/95 text-ink-700",
            )}
            key={m.id}
          >
            {m.tone === "success" ? (
              <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            ) : m.tone === "error" ? (
              <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            ) : (
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug">
                {m.title}
              </p>
              {m.description && (
                <p className="mt-0.5 text-[12px] leading-snug opacity-80">
                  {m.description}
                </p>
              )}
            </div>
            <button
              onClick={() => n(m.id)}
              className="shrink-0 rounded-lg p-1 text-ink-400 hover:bg-slate-100"
              aria-label="Скрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Fragment>
  ) : (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
        <p className="text-[13px] text-ink-500">Загружаем бухгалтерию…</p>
      </div>
    </div>
  );
}
