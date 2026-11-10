/**
 * Расходы.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { getAccountBalance } from "../utils/calculations.js";
import { formatMoney, today } from "../utils/format.js";
import {
  DomainError,
  assert,
  assertPositive,
  assertSufficientFunds,
  clean,
  getActiveAccount,
  makeAuditEntry,
  makeId,
  nowISO,
  round2,
  toNumber,
  withAudit,
} from "./shared.js";
export function buildExpense(state, t) {
  const n = t.id ? state.expenses.find((r) => r.id === t.id) : void 0;
  t.id && assert(n, "Расход не найден");
  const a = toNumber(t.amount);
  (assertPositive(a, "Расход", "amount"),
    assert(t.accountId, "Выберите счёт списания", "accountId"),
    getActiveAccount(state, t.accountId),
    assert(t.date, "Укажите дату расхода", "date"),
    assert(t.date <= today(), "Дата не может быть в будущем", "date"));
  const c =
    getAccountBalance(state, t.accountId) +
    (n && n.accountId === t.accountId ? n.amount : 0);
  if (c + 0.001 < a) {
    const r = state.accounts.find((i) => i.id === t.accountId);
    throw new DomainError(
      `Недостаточно средств на счёте «${(r == null ? void 0 : r.name) ?? ""}»: доступно ${formatMoney(c)}`,
      "amount",
    );
  }
  return (
    n &&
      n.accountId !== t.accountId &&
      assertSufficientFunds(state, t.accountId, a, "Расход"),
    {
      id: (n == null ? void 0 : n.id) ?? makeId("ex"),
      category: t.category,
      amount: round2(a),
      accountId: t.accountId,
      date: t.date,
      vendor: clean(t.vendor),
      comment: clean(t.comment),
      createdAt: (n == null ? void 0 : n.createdAt) ?? nowISO(),
    }
  );
}
export const EXPENSE_CATEGORIES = {
  rent: "Аренда",
  salary: "Зарплата",
  repair: "Ремонт телефона",
  tax: "Налоги",
  marketing: "Реклама",
  other: "Прочие расходы",
};
export function saveExpense(state, t) {
  const n = buildExpense(state, t),
    a = state.expenses.some((r) => r.id === n.id),
    c = a
      ? state.expenses.map((r) => (r.id === n.id ? n : r))
      : [n, ...state.expenses];
  return withAudit(
    {
      ...state,
      expenses: c,
    },
    makeAuditEntry(
      state,
      a ? "update" : "create",
      "expense",
      n.id,
      `${EXPENSE_CATEGORIES[n.category]}: ${formatMoney(n.amount)}`,
      n.vendor ? `Контрагент: ${n.vendor}` : void 0,
    ),
  );
}
export function deleteExpense(state, t) {
  const n = state.expenses.find((a) => a.id === t);
  return (
    assert(n, "Расход не найден"),
    withAudit(
      {
        ...state,
        expenses: state.expenses.filter((a) => a.id !== t),
      },
      makeAuditEntry(
        state,
        "delete",
        "expense",
        t,
        `Удалён расход ${EXPENSE_CATEGORIES[n.category]} · ${formatMoney(n.amount)}`,
      ),
    )
  );
}
