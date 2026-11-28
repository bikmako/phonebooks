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
      type="button"
      onClick={n}
      className="pb-action pb-action-secondary"
    >
      <span aria-hidden="true">{s}</span>
      {t}
    </button>
  );
}
