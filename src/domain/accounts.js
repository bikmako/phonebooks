/**
 * Счета: создание, правка, архивация.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { getAccountBalance } from "../utils/calculations.js";
import { formatMoney } from "../utils/format.js";
import {
  assert,
  clean,
  makeAuditEntry,
  makeId,
  nowISO,
  round2,
  toNumber,
  withAudit,
} from "./shared.js";
export function saveAccount(state, t) {
  const n = clean(t.name);
  assert(n.length >= 2, "Название счёта слишком короткое", "name");
  const a = t.id ? state.accounts.find((l) => l.id === t.id) : void 0;
  t.id && assert(a, "Счёт не найден");
  const c = state.accounts.find(
    (l) => l.name.toLowerCase() === n.toLowerCase() && l.id !== t.id,
  );
  assert(!c, "Счёт с таким названием уже есть", "name");
  const r = toNumber(t.openingBalance);
  if (a && a.openingBalance !== r) {
    const l =
      state.phones.some((d) => d.purchaseAccountId === a.id || (d.repairs ?? []).some(repair => repair.accountId === a.id)) ||
      state.sales.some((d) => d.accountId === a.id) ||
      state.expenses.some((d) => d.accountId === a.id) ||
      state.transfers.some(
        (d) => d.fromAccountId === a.id || d.toAccountId === a.id,
      ) ||
      state.cashOps.some((d) => d.accountId === a.id) ||
      state.accessoryBatches.some((d) => d.accountId === a.id) ||
      state.accessorySales.some((d) => d.accountId === a.id);
    assert(
      !l,
      "По счёту уже есть операции. Измените остаток через «Пополнение» или «Снятие» — так история сохранится.",
      "openingBalance",
    );
  }
  const i = {
      id: (a == null ? void 0 : a.id) ?? makeId("ac"),
      name: n,
      type: t.type,
      openingBalance: round2(r),
      color: t.color,
      archived: (a == null ? void 0 : a.archived) ?? !1,
      createdAt: (a == null ? void 0 : a.createdAt) ?? nowISO(),
    },
    o = a
      ? state.accounts.map((l) => (l.id === i.id ? i : l))
      : [...state.accounts, i];
  return withAudit(
    {
      ...state,
      accounts: o,
    },
    makeAuditEntry(
      state,
      a ? "update" : "create",
      "account",
      i.id,
      a ? `Изменён счёт «${n}»` : `Добавлен счёт «${n}»`,
    ),
  );
}
export function setAccountArchived(state, t, n) {
  const a = state.accounts.find((c) => c.id === t);
  if ((assert(a, "Счёт не найден"), n)) {
    const c = getAccountBalance(state, t);
    assert(
      Math.abs(c) < 0.01,
      `Нельзя архивировать счёт с остатком ${formatMoney(c)}. Переведите деньги на другой счёт.`,
      "accountId",
    );
  }
  return withAudit(
    {
      ...state,
      accounts: state.accounts.map((c) =>
        c.id === t
          ? {
              ...c,
              archived: n,
            }
          : c,
      ),
    },
    makeAuditEntry(
      state,
      "update",
      "account",
      t,
      `${n ? "Архивирован" : "Возвращён"} счёт «${a.name}»`,
    ),
  );
}
