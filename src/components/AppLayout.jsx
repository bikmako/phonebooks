/**
 * Каркас приложения: сайдбар, шапка, нижняя навигация.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { useStore } from "../hooks/useStore.jsx";
import { ThemeToggle } from "../hooks/useTheme.jsx";
import { getTotalMoney } from "../utils/calculations.js";
import { formatMoney } from "../utils/format.js";
import { Chip, cx } from "./ui.jsx";
import {
  Banknote,
  ChartColumn,
  History,
  LayoutDashboard,
  Package,
  Plus,
  Settings2,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export const NAV_ITEMS = [
    {
      id: "dashboard",
      label: "Главная",
      short: "Главная",
      icon: LayoutDashboard,
    },
    {
      id: "purchase",
      label: "Скупка",
      short: "Скупка",
      icon: ShoppingBag,
    },
    {
      id: "accessories",
      label: "Аксессуары",
      short: "Аксесс.",
      icon: Package,
    },
    {
      id: "sales",
      label: "Продажи",
      short: "Продажи",
      icon: TrendingUp,
    },
    {
      id: "finance",
      label: "Финансы",
      short: "Финансы",
      icon: Wallet,
    },
    {
      id: "history",
      label: "История",
      short: "История",
      icon: History,
    },
    {
      id: "settings",
      label: "Настройки",
      short: "Ещё",
      icon: Settings2,
    },
  ],
  MOBILE_NAV_IDS = ["dashboard", "purchase", "accessories", "sales", "finance"];
export function AppLayout({
  route: s,
  onNavigate: t,
  children: n,
  onQuickAction: a,
}) {
  const { data: c, saveState: r } = useStore(),
    i = React.useMemo(() => getTotalMoney(c), [c]),
    o = NAV_ITEMS.find((l) => l.id === s);
  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-slate-200/70 bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Logo />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight text-ink-900">
              {c.settings.businessName}
            </p>
            <p className="text-[11.5px] text-ink-400">Бухгалтерия скупки</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.filter(
            (l) => l.id !== "settings" && l.id !== "history",
          ).map((l) => {
            const d = l.icon,
              x = s === l.id;
            return (
              <button
                onClick={() => t(l.id)}
                className={cx(
                  "group flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition-all",
                  x
                    ? "bg-gradient-to-r from-brand-600 to-indigo-500 text-white shadow-md shadow-brand-600/25"
                    : "text-ink-500 hover:bg-slate-50 hover:text-ink-900",
                )}
                key={l.id}
              >
                {jsx(d, {
                  className: cx(
                    "h-[18px] w-[18px]",
                    x ? "text-white" : "text-ink-400 group-hover:text-ink-500",
                  ),
                })}
                {l.label}
                {x && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/90" />
                )}
              </button>
            );
          })}
        </nav>
        <div className="px-3 pb-3">
          <button
            onClick={() => t("history")}
            className={cx(
              "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition-all",
              s === "history"
                ? "bg-gradient-to-r from-brand-600 to-indigo-500 text-white shadow-md shadow-brand-600/25"
                : "text-ink-500 hover:bg-slate-50 hover:text-ink-900",
            )}
          >
            <History
              className={cx(
                "h-[18px] w-[18px]",
                s === "history" ? "text-white" : "text-ink-400",
              )}
            />
            История
            {s === "history" && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />
            )}
          </button>
        </div>
        <div className="mx-3 mb-3 rounded-2xl bg-gradient-to-br from-brand-600 via-brand-600 to-indigo-600 p-4 text-white shadow-lg shadow-brand-600/25">
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/60">
            Деньги в кассе
          </p>
          <p className="mt-1 text-[19px] font-bold tabular-nums">
            {formatMoney(i)}
          </p>
          <button
            onClick={a}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white/20 text-[12.5px] font-semibold transition-colors hover:bg-white/30"
          >
            <Plus className="h-4 w-4" />
            {" Новая операция"}
          </button>
        </div>
        <button
          onClick={() => t("settings")}
          className={cx(
            "mx-3 mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors",
            s === "settings"
              ? "bg-slate-100 text-ink-900"
              : "text-ink-500 hover:bg-slate-50",
          )}
        >
          <Settings2 className="h-[17px] w-[17px]" />
          Настройки
          <span className="ml-auto">
            {r === "saving" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            ) : r === "error" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            )}
          </span>
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-40 border-b border-slate-200/60 bg-canvas/95 backdrop-blur-xl lg:hidden"
          style={{
            paddingTop: "var(--safe-top)",
          }}
        >
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <Logo size="sm" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold leading-tight text-ink-900">
                  {(o == null ? void 0 : o.label) ?? ""}
                </p>
                <p className="flex items-center gap-1 truncate text-[11px] text-ink-400">
                  {r === "error" ? (
                    <span className="text-red-500">не сохраняется</span>
                  ) : (
                    <Fragment>
                      <span
                        className={cx(
                          "h-1.5 w-1.5 rounded-full",
                          r === "saving" ? "bg-amber-400" : "bg-emerald-500",
                        )}
                      />
                      {c.settings.businessName}
                    </Fragment>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="mr-0.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold tabular-nums text-ink-700 shadow-sm ring-1 ring-slate-200/70">
                {formatMoney(i)}
              </div>
              <ThemeToggle />
              <button
                onClick={() => t("settings")}
                aria-label="Настройки"
                className="btn-icon flex items-center justify-center text-ink-500 active:bg-slate-100"
              >
                <Settings2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-28 pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-7">
          <div className="mb-5 hidden items-center justify-between lg:flex">
            <div>
              <h1 className="page-title">{o == null ? void 0 : o.label}</h1>
              <p className="mt-0.5 text-[13px] text-ink-500">
                {getPageSubtitle(s)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle className="h-9 w-9 rounded-lg" />
              {r === "error" && <Chip tone="danger">Не удалось сохранить</Chip>}
              <Chip tone="neutral" className="gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-emerald-500" />
                {formatMoney(i)}
                {" в обороте"}
              </Chip>
            </div>
          </div>
          <div className="page-enter" key={s}>
            {n}
          </div>
        </main>
      </div>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 shadow-[0_-10px_40px_-16px_rgba(15,23,42,0.18)] backdrop-blur-xl lg:hidden"
        style={{
          paddingBottom: "var(--safe-bottom)",
        }}
        aria-label="Основная навигация"
      >
        <div className="grid h-[62px] grid-cols-6 items-stretch px-1">
          {MOBILE_NAV_IDS.slice(0, 2).map((l) => (
            <MobileNavItem id={l} active={s === l} onClick={t} key={l} />
          ))}
          <div className="flex items-center justify-center">
            <button
              onClick={a}
              aria-label="Создать операцию"
              className="fab-glow flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 text-white transition-transform active:scale-95"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
          {MOBILE_NAV_IDS.slice(2).map((l) => (
            <MobileNavItem id={l} active={s === l} onClick={t} key={l} />
          ))}
        </div>
      </nav>
    </div>
  );
}
export function MobileNavItem({ id: s, active: t, onClick: n }) {
  const a = NAV_ITEMS.find((r) => r.id === s);
  if (!a) return null;
  const c = a.icon;
  return (
    <button
      onClick={() => n(s)}
      aria-current={t ? "page" : void 0}
      className={cx(
        "flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors",
        t ? "text-brand-600" : "text-ink-400",
      )}
    >
      <span
        className={cx(
          "flex h-7 items-center justify-center rounded-full px-3 transition-colors",
          t && "bg-brand-50",
        )}
      >
        {jsx(c, {
          className: cx("h-[22px] w-[22px]", t && "drop-shadow-sm"),
          strokeWidth: t ? 2.4 : 2,
        })}
      </span>
      {a.short}
    </button>
  );
}
export function Logo({ size: s = "md" }) {
  const t = s === "sm" ? "h-8 w-8 rounded-[10px]" : "h-10 w-10 rounded-xl";
  return (
    <span
      className={cx(
        "relative flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-600 text-white shadow-md shadow-brand-600/30",
        t,
      )}
    >
      <ChartColumn
        className={s === "sm" ? "h-4 w-4" : "h-5 w-5"}
        strokeWidth={2.4}
      />
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-white" />
    </span>
  );
}
export function getPageSubtitle(s) {
  switch (s) {
    case "dashboard":
      return "Ключевые показатели бизнеса на одной странице";
    case "purchase":
      return "Закупка и склад в одном месте";
    case "sales":
      return "Оформление продажи — прибыль считается автоматически";
    case "finance":
      return "Кассы, счета, расходы и переводы";
    case "history":
      return "Все операции в одном списке";
    case "accessories":
      return "Склад, остатки и продажи аксессуаров";
    case "settings":
      return "Профиль и настройки приложения";
    default:
      return "Ключевые показатели бизнеса на одной странице";
  }
}
