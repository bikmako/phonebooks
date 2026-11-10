/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { cx } from "../ui.jsx";
import { jsx, jsxs } from "react/jsx-runtime";
export function DetailStat({ label: s, value: t, tone: n }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
      <p className="text-[10.5px] text-ink-400">{s}</p>
      <p
        className={cx(
          "mt-0.5 text-[13px] font-semibold tabular-nums",
          n === "green" ? "text-emerald-600" : "text-ink-900",
        )}
      >
        {t}
      </p>
    </div>
  );
}
export function DetailRow({ label: s, value: t, mono: n }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-ink-400">{s}</span>
      <span
        className={cx(
          "text-right text-ink-700",
          n && "font-mono text-[11.5px] tracking-wide",
        )}
      >
        {t}
      </span>
    </div>
  );
}
export const PHONE_STATUS_TABS = [
  {
    id: "all",
    label: "Все",
  },
  {
    id: "in_stock",
    label: "На складе",
  },
  {
    id: "reserved",
    label: "Резерв",
  },
  {
    id: "repair",
    label: "Ремонт",
  },
  {
    id: "sold",
    label: "Проданы",
  },
];
