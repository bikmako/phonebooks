/**
 * Продажи телефонов: проведение, правка, отмена, восстановление.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { findCompletedSale, getSaleRevenue } from "../utils/calculations.js";
import { formatMoney, today } from "../utils/format.js";
import { normalizePhone } from "./phones.js";
import {
  assert,
  assertNonNegative,
  clean,
  getActiveAccount,
  makeAuditEntry,
  makeId,
  nowISO,
  round2,
  toNumber,
  withAudit,
} from "./shared.js";
export function buildSale(state, t) {
  const n = state.phones.find((d) => d.id === t.phoneId);
  assert(n, "Выберите телефон со склада", "phoneId");
  const a = t.id ? state.sales.find((d) => d.id === t.id) : void 0;
  if (
    (t.id && assert(a, "Продажа не найдена"),
    !(
      (a == null ? void 0 : a.phoneId) === n.id &&
      (a == null ? void 0 : a.status) === "completed"
    ))
  ) {
    (assert(n.status !== "sold", "Этот телефон уже продан", "phoneId"),
      assert(
        n.status !== "repair",
        "Телефон в ремонте — продажа недоступна. Переведите его на склад.",
        "phoneId",
      ));
    const d = findCompletedSale(state, n.id);
    assert(
      !d || d.id === t.id,
      "Этот телефон уже продан другой операцией",
      "phoneId",
    );
  }
  (assert(t.accountId, "Выберите счёт для зачисления денег", "accountId"),
    getActiveAccount(state, t.accountId),
    assert(t.date, "Укажите дату продажи", "date"),
    assert(t.date <= today(), "Дата продажи не может быть в будущем", "date"),
    assert(
      t.date >= n.purchaseDate,
      "Дата продажи не может быть раньше даты закупки",
      "date",
    ));
  const r = toNumber(t.price);
  assert(r > 0, "Цена продажи должна быть больше нуля", "price");
  const i = toNumber(t.discount);
  (assertNonNegative(i, "Скидка", "discount"),
    assert(i <= r, "Скидка не может быть больше цены продажи", "discount"));
  const o = clean(t.buyerPhone);
  return (
    o &&
      assert(
        o.replace(/\D/g, "").length >= 10,
        "Проверьте телефон покупателя",
        "buyerPhone",
      ),
    {
      id: (a == null ? void 0 : a.id) ?? makeId("sl"),
      phoneId: n.id,
      buyerName: clean(t.buyerName) || "Без имени",
      buyerPhone: o ? normalizePhone(o) : "",
      price: round2(r),
      discount: round2(i),
      paymentMethod: t.paymentMethod,
      accountId: t.accountId,
      date: t.date,
      comment: clean(t.comment),
      status: "completed",
      createdAt: (a == null ? void 0 : a.createdAt) ?? nowISO(),
      cancelledAt: null,
    }
  );
}
export function createSale(state, t) {
  const n = buildSale(state, t);
  assert(
    !n.id || !state.sales.some((r) => r.id === n.id),
    "Продажа уже проведена",
  );
  const a = state.phones.find((r) => r.id === n.phoneId),
    c = {
      ...state,
      sales: [n, ...state.sales],
      phones: state.phones.map((r) =>
        r.id === a.id
          ? {
              ...r,
              status: "sold",
              updatedAt: nowISO(),
            }
          : r,
      ),
    };
  return withAudit(
    c,
    makeAuditEntry(
      state,
      "create",
      "sale",
      n.id,
      `Продан ${a.model} за ${formatMoney(getSaleRevenue(n))}`,
      `Покупатель: ${n.buyerName}; себестоимость ${formatMoney(a.purchasePrice)}; прибыль ${formatMoney(getSaleRevenue(n) - a.purchasePrice)}`,
    ),
  );
}
export function updateSale(state, t) {
  assert(t.id, "Не указана продажа");
  const n = state.sales.find((o) => o.id === t.id);
  (assert(n, "Продажа не найдена"),
    assert(
      n.status === "completed",
      "Отменённую продажу нельзя редактировать — создайте новую",
    ));
  const a = buildSale(state, t),
    c = state.phones.map((o) =>
      o.id === n.phoneId && n.phoneId !== a.phoneId
        ? {
            ...o,
            status: "in_stock",
            updatedAt: nowISO(),
          }
        : o.id === a.phoneId
          ? {
              ...o,
              status: "sold",
              updatedAt: nowISO(),
            }
          : o,
    ),
    r = {
      ...state,
      sales: state.sales.map((o) => (o.id === a.id ? a : o)),
      phones: c,
    },
    i = state.phones.find((o) => o.id === a.phoneId);
  return withAudit(
    r,
    makeAuditEntry(
      state,
      "update",
      "sale",
      a.id,
      `Изменена продажа ${(i == null ? void 0 : i.model) ?? ""} · ${formatMoney(getSaleRevenue(n))} → ${formatMoney(getSaleRevenue(a))}`,
      `Было: цена ${formatMoney(n.price)}, скидка ${formatMoney(n.discount)}`,
    ),
  );
}
export function cancelSale(state, t) {
  const n = state.sales.find((r) => r.id === t);
  (assert(n, "Продажа не найдена"),
    assert(n.status === "completed", "Продажа уже отменена"));
  const a = state.phones.find((r) => r.id === n.phoneId),
    c = {
      ...state,
      sales: state.sales.map((r) =>
        r.id === t
          ? {
              ...r,
              status: "cancelled",
              cancelledAt: nowISO(),
            }
          : r,
      ),
      phones: state.phones.map((r) =>
        r.id === n.phoneId
          ? {
              ...r,
              status: "in_stock",
              updatedAt: nowISO(),
            }
          : r,
      ),
    };
  return withAudit(
    c,
    makeAuditEntry(
      state,
      "cancel",
      "sale",
      t,
      `Отменена продажа ${(a == null ? void 0 : a.model) ?? ""} на ${formatMoney(getSaleRevenue(n))}`,
      "Телефон возвращён на склад, деньги списаны со счёта",
    ),
  );
}
export function restoreSale(state, t) {
  const n = state.sales.find((i) => i.id === t);
  (assert(n, "Продажа не найдена"),
    assert(n.status === "cancelled", "Продажа не отменена"));
  const a = state.phones.find((i) => i.id === n.phoneId);
  assert(a, "Телефон не найден");
  const c = findCompletedSale(state, n.phoneId);
  assert(
    !c,
    "Телефон уже продан другой операцией — восстановление невозможно",
    "phoneId",
  );
  const r = {
    ...state,
    sales: state.sales.map((i) =>
      i.id === t
        ? {
            ...i,
            status: "completed",
            cancelledAt: null,
          }
        : i,
    ),
    phones: state.phones.map((i) =>
      i.id === n.phoneId
        ? {
            ...i,
            status: "sold",
            updatedAt: nowISO(),
          }
        : i,
    ),
  };
  return withAudit(
    r,
    makeAuditEntry(
      state,
      "restore",
      "sale",
      t,
      `Восстановлена продажа ${a.model}`,
    ),
  );
}
