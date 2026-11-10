/**
 * Переводы между счетами.
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
export function buildTransfer(state, t) {
  const n = t.id ? state.transfers.find((i) => i.id === t.id) : void 0;
  (t.id && assert(n, "Перевод не найден"),
    assert(
      t.fromAccountId && t.toAccountId,
      "Выберите счёт списания и счёт зачисления",
      "fromAccountId",
    ),
    assert(
      t.fromAccountId !== t.toAccountId,
      "Счета должны отличаться",
      "toAccountId",
    ));
  const a = getActiveAccount(state, t.fromAccountId);
  getActiveAccount(state, t.toAccountId);
  const c = toNumber(t.amount);
  (assertPositive(c, "Перевод", "amount"),
    assert(t.date, "Укажите дату перевода", "date"),
    assert(t.date <= today(), "Дата не может быть в будущем", "date"));
  const r =
    getAccountBalance(state, a.id) +
    (n && n.fromAccountId === a.id ? n.amount : 0);
  if (r + 0.001 < c)
    throw new DomainError(
      `Недостаточно средств в «${a.name}»: доступно ${formatMoney(r)}`,
      "amount",
    );
  return {
    id: (n == null ? void 0 : n.id) ?? makeId("tr"),
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    amount: round2(c),
    date: t.date,
    comment: clean(t.comment),
    createdAt: (n == null ? void 0 : n.createdAt) ?? nowISO(),
  };
}
export function saveTransfer(state, t) {
  var o, l;
  const n = buildTransfer(state, t),
    a = state.transfers.some((d) => d.id === n.id),
    c = a
      ? state.transfers.map((d) => (d.id === n.id ? n : d))
      : [n, ...state.transfers],
    r =
      (o = state.accounts.find((d) => d.id === n.fromAccountId)) == null
        ? void 0
        : o.name,
    i =
      (l = state.accounts.find((d) => d.id === n.toAccountId)) == null
        ? void 0
        : l.name;
  return withAudit(
    {
      ...state,
      transfers: c,
    },
    makeAuditEntry(
      state,
      a ? "update" : "create",
      "transfer",
      n.id,
      `Перевод ${formatMoney(n.amount)}: ${r} → ${i}`,
      "Перевод не влияет на выручку и прибыль",
    ),
  );
}
export function deleteTransfer(state, t) {
  const n = state.transfers.find((a) => a.id === t);
  return (
    assert(n, "Перевод не найден"),
    withAudit(
      {
        ...state,
        transfers: state.transfers.filter((a) => a.id !== t),
      },
      makeAuditEntry(
        state,
        "delete",
        "transfer",
        t,
        `Удалён перевод ${formatMoney(n.amount)}`,
      ),
    )
  );
}
