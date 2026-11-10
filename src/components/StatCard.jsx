/**
 * Карточка показателя на Главной.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { cx } from "./ui.jsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { jsx, jsxs } from "react/jsx-runtime";
export function percentChange(s, t) {
  if (t == null || t <= 0) return null;
  const n = Math.round(((s - t) / Math.abs(t)) * 100);
  return Number.isFinite(n) ? Math.max(-999, Math.min(999, n)) : null;
}
export function StatCard({
  label: s,
  value: t,
  icon: n,
  tone: a,
  delta: c,
  hint: r,
  onClick: i,
  valueClassName: o,
}) {
  const l = {
      blue: "from-brand-500 to-indigo-500 shadow-brand-500/30",
      green: "from-emerald-400 to-emerald-600 shadow-emerald-500/30",
      red: "from-rose-400 to-red-500 shadow-red-500/30",
      violet: "from-violet-400 to-purple-600 shadow-violet-500/30",
      emerald: "from-emerald-400 to-teal-500 shadow-emerald-500/30",
    },
    d = i ? "button" : "div";
  return jsxs(d, {
    onClick: i,
    className: cx(
      "card flex flex-col justify-between p-4 text-left transition-all",
      i && "hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0",
    ),
    children: [
      <div className="flex items-start justify-between">
        <span className="text-[12px] font-medium leading-tight text-ink-500">
          {s}
        </span>
        <span
          className={cx(
            "flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md",
            l[a],
          )}
        >
          {n}
        </span>
      </div>,
      <div className="mt-2.5">
        <p
          className={cx(
            "text-[20px] font-extrabold leading-tight tracking-tight tabular-nums sm:text-[23px]",
            o ?? "text-ink-900",
          )}
        >
          {t}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          {c != null && (
            <span
              className={cx(
                "flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[10.5px] font-semibold",
                c >= 0
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-red-50 text-red-500",
              )}
            >
              {c >= 0 ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(c)}%
            </span>
          )}
          {r && <span className="truncate text-[11px] text-ink-400">{r}</span>}
        </div>
      </div>,
    ],
  });
}
