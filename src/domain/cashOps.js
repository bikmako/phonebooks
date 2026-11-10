/**
 * Пополнения и снятия.
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
  clean,
  getActiveAccount,
  makeAuditEntry,
  makeId,
  nowISO,
  round2,
  toNumber,
  withAudit,
} from "./shared.js";
export function buildCashOp(state, t) {
  const n = t.id ? state.cashOps.find((c) => c.id === t.id) : void 0;
  (t.id && assert(n, "Операция не найдена"),
    assert(t.accountId, "Выберите счёт", "accountId"),
    getActiveAccount(state, t.accountId));
  const a = toNumber(t.amount);
  if (
    (assertPositive(
      a,
      t.kind === "deposit" ? "Пополнение" : "Снятие",
      "amount",
    ),
    assert(t.date, "Укажите дату", "date"),
    assert(t.date <= today(), "Дата не может быть в будущем", "date"),
    t.kind === "withdrawal")
  ) {
    const c =
      getAccountBalance(state, t.accountId) +
      (n && n.accountId === t.accountId ? n.amount : 0);
    if (c + 0.001 < a) {
      const r = state.accounts.find((i) => i.id === t.accountId);
      throw new DomainError(
        `Недостаточно средств в «${(r == null ? void 0 : r.name) ?? ""}»: доступно ${formatMoney(c)}`,
        "amount",
      );
    }
  }
  return {
    id: (n == null ? void 0 : n.id) ?? makeId("co"),
    kind: t.kind,
    accountId: t.accountId,
    amount: round2(a),
    date: t.date,
    comment: clean(t.comment),
    createdAt: (n == null ? void 0 : n.createdAt) ?? nowISO(),
  };
}
export function saveCashOp(state, t) {
  var i;
  const n = buildCashOp(state, t),
    a = state.cashOps.some((o) => o.id === n.id),
    c = a
      ? state.cashOps.map((o) => (o.id === n.id ? n : o))
      : [n, ...state.cashOps],
    r =
      (i = state.accounts.find((o) => o.id === n.accountId)) == null
        ? void 0
        : i.name;
  return withAudit(
    {
      ...state,
      cashOps: c,
    },
    makeAuditEntry(
      state,
      a ? "update" : "create",
      "cash_op",
      n.id,
      `${n.kind === "deposit" ? "Пополнение" : "Снятие"} ${formatMoney(n.amount)} · ${r}`,
    ),
  );
}
export function deleteCashOp(state, t) {
  const n = state.cashOps.find((a) => a.id === t);
  return (
    assert(n, "Операция не найдена"),
    withAudit(
      {
        ...state,
        cashOps: state.cashOps.filter((a) => a.id !== t),
      },
      makeAuditEntry(
        state,
        "delete",
        "cash_op",
        t,
        `Удалено ${n.kind === "deposit" ? "пополнение" : "снятие"} ${formatMoney(n.amount)}`,
      ),
    )
  );
}
