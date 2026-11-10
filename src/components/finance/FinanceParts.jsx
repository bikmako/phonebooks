/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { EXPENSE_CATEGORY_ICONS } from "../../utils/constants.js";
import { jsx, jsxs } from "react/jsx-runtime";
export function ExpenseCategoryIcon({ category: s, className: t }) {
  const n = EXPENSE_CATEGORY_ICONS[s];
  return jsx(n, {
    className: t,
  });
}
export function QuickFinanceAction({ icon: s, label: t, onClick: n }) {
  return (
    <button
      onClick={n}
      className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-slate-50 text-[12.5px] font-semibold text-ink-700 transition-colors active:bg-slate-100"
    >
      <span className="text-brand-600">{s}</span>
      {t}
    </button>
  );
}
