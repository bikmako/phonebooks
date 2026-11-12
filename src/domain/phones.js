/**
 * Закупка телефонов: валидация, создание, правка, статусы, удаление.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { findCompletedSale } from "../utils/calculations.js";
import { getRepairSessionId } from "./repairs.js";
import { formatMoney, today } from "../utils/format.js";
import {
  DomainError,
  assert,
  assertNonNegative,
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
export function buildPhone(state, t) {
  const n = !t.id,
    a = t.id ? state.phones.find((p) => p.id === t.id) : void 0;
  t.id && assert(a, "Телефон не найден");
  const c = clean(t.model);
  assert(c.length >= 2, "Укажите модель смартфона", "model");
  const r = (t.imei ?? "").replace(/\D/g, "");
  if (r) {
    assert(r.length === 15, "IMEI должен содержать 15 цифр", "imei");
    const p = state.phones.find((w) => w.imei === r && w.id !== t.id);
    assert(
      !p,
      `Телефон с IMEI ${r} уже есть на складе (${(p == null ? void 0 : p.model) ?? ""})`,
      "imei",
    );
  }
  const i = toNumber(t.purchasePrice);
  assert(i > 0, "Закупочная цена должна быть больше нуля", "purchasePrice");
  const o = toNumber(t.plannedPrice);
  (o > 0 && assertNonNegative(o, "Планируемая цена", "plannedPrice"),
    assert(
      t.purchaseAccountId,
      "Выберите счёт для списания денег",
      "accountId",
    ));
  const l = t.purchaseAccountId;
  (assert(t.purchaseDate, "Укажите дату покупки", "purchaseDate"),
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(t.purchaseDate),
      "Неверная дата покупки",
      "purchaseDate",
    ),
    assert(
      t.purchaseDate <= today(),
      "Дата покупки не может быть в будущем",
      "purchaseDate",
    ));
  const d = clean(t.supplierPhone);
  d &&
    assert(
      d.replace(/\D/g, "").length >= 10,
      "Проверьте номер телефона продавца",
      "supplierPhone",
    );
  const x = t.status ?? (a == null ? void 0 : a.status) ?? "in_stock";
  assert(["in_stock", "reserved", "repair"].includes(x), "Недопустимый статус", "status");
  assert(a?.status !== "repair" || x === "repair", "Сначала завершите ремонт", "status");
  if (
    (assert(
      x !== "sold",
      "Статус «Продан» устанавливается через раздел продаж",
      "status",
    ),
    n)
  ) {
    const p = state;
    (getActiveAccount(p, l),
      assertSufficientFunds(p, l, i, "Закупка"),
      assert(
        t.purchasePaymentMethod !== void 0,
        "Выберите способ оплаты",
        "purchasePaymentMethod",
      ));
  } else if (a) {
    const p = findCompletedSale(state, a.id);
    assert(
      !p,
      "Проданный телефон нельзя редактировать. Сначала отмените продажу.",
      "model",
    );
    const w = i - a.purchasePrice,
      A = a.purchaseAccountId === l ? w : 0;
    a.purchaseAccountId !== l
      ? (getActiveAccount(state, l),
        assertSufficientFunds(state, l, i, "Перенос закупки"),
        assert(l !== a.purchaseAccountId, "Выберите другой счёт", "accountId"))
      : A > 0 &&
        (getActiveAccount(state, l),
        assertSufficientFunds(state, l, A, "Изменение закупочной цены"));
  }
  return {
    phone: {
      ...a,
      repairSessionId: x === "repair" ? (a?.status === "repair" ? getRepairSessionId(a) : makeId("repair")) : null,
      id: (a == null ? void 0 : a.id) ?? makeId("ph"),
      model: c,
      storage: clean(t.storage) || "—",
      color: clean(t.color) || "—",
      imei: r,
      condition: t.condition,
      kit: clean(t.kit) || "Без комплекта",
      purchasePrice: round2(i),
      plannedPrice: round2(o),
      purchaseDate: t.purchaseDate,
      supplierName: clean(t.supplierName) || "Без имени",
      supplierPhone: d ? normalizePhone(d) : "",
      purchaseAccountId: l,
      purchasePaymentMethod: t.purchasePaymentMethod,
      purchaseComment: clean(t.purchaseComment),
      status: x,
      createdAt: (a == null ? void 0 : a.createdAt) ?? nowISO(),
      updatedAt: nowISO(),
    },
    isNew: n,
  };
}
export function normalizePhone(s) {
  const t = s.replace(/\D/g, "");
  if (t.length === 11 && (t[0] === "7" || t[0] === "8")) {
    const n = t.slice(1);
    return `+7 ${n.slice(0, 3)} ${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8, 10)}`;
  }
  return s.trim();
}
export function createPhone(state, t) {
  var c;
  const { phone: n, isNew: a } = buildPhone(state, t);
  return (
    assert(a, "Телефон уже существует"),
    withAudit(
      {
        ...state,
        phones: [n, ...state.phones],
      },
      makeAuditEntry(
        state,
        "create",
        "phone",
        n.id,
        `Закуплен ${n.model} за ${formatMoney(n.purchasePrice)}`,
        `Продавец: ${n.supplierName}; дыр. счёт: ${(c = state.accounts.find((r) => r.id === n.purchaseAccountId)) == null ? void 0 : c.name}`,
      ),
    )
  );
}
export function updatePhone(state, t) {
  assert(t.id, "Не указан телефон");
  const { phone: n, isNew: a } = buildPhone(state, t);
  assert(!a, "Телефон не найден");
  const c = state.phones.find((i) => i.id === t.id);
  assert(c, "Телефон не найден");
  const r =
    c.purchasePrice !== n.purchasePrice ||
    c.purchaseAccountId !== n.purchaseAccountId;
  return withAudit(
    {
      ...state,
      phones: state.phones.map((i) => (i.id === n.id ? n : i)),
    },
    makeAuditEntry(
      state,
      "update",
      "phone",
      n.id,
      `Изменена закупка ${n.model}${r ? ` · ${formatMoney(c.purchasePrice)} → ${formatMoney(n.purchasePrice)}` : ""}`,
      `Было: ${c.model}, ${c.storage}, ${formatMoney(c.purchasePrice)}`,
    ),
  );
}
export function setPhoneStatus(state, t, n) {
  const a = state.phones.find((i) => i.id === t);
  if ((assert(a, "Телефон не найден"), n === "sold"))
    throw new DomainError(
      "Статус «Продан» устанавливается через раздел продаж",
      "status",
    );
  assert(
    a.status !== "sold",
    "Проданный телефон нельзя вернуть в склад без отмены продажи",
    "status",
  );
  assert(["in_stock", "reserved", "repair"].includes(n), "Недопустимый статус", "status");
  assert(a.status !== "repair" || n === "repair", "Сначала завершите ремонт", "status");
  if (a.status === n) return state;
  const c = {
      ...a,
      repairSessionId: n === "repair" ? makeId("repair") : null,
      status: n,
      updatedAt: nowISO(),
    },
    r = {
      in_stock: "На складе",
      reserved: "Резерв",
      repair: "Ремонт",
      sold: "Продан",
    };
  return withAudit(
    {
      ...state,
      phones: state.phones.map((i) => (i.id === t ? c : i)),
    },
    makeAuditEntry(
      state,
      "update",
      "phone",
      t,
      `${a.model}: статус «${r[n]}»`,
      `Было: «${r[a.status]}»`,
    ),
  );
}
export function deletePhone(state, t) {
  const n = state.phones.find((c) => c.id === t);
  assert(n, "Телефон не найден");
  const a = findCompletedSale(state, t);
  return (
    assert(
      !a,
      "Нельзя удалить проданный телефон. Сначала отмените продажу.",
      "phone",
    ),
    withAudit(
      {
        ...state,
        phones: state.phones.filter((c) => c.id !== t),
      },
      makeAuditEntry(
        state,
        "delete",
        "phone",
        t,
        `Удалена закупка ${n.model}`,
        `Закупка ${formatMoney(n.purchasePrice)}; отменено ремонтов: ${(n.repairs ?? []).length}, возвращено ${formatMoney((n.repairs ?? []).reduce((sum, repair) => sum + repair.amount, 0))} на исходные счета`,
      ),
    )
  );
}
