/**
 * Аксессуары: партии, FIFO, продажи, списания, статистика.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { inPeriod, roundMoney, today } from "../utils/format.js";
import { createSale } from "./sales.js";
import {
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
export const ACCESSORY_CATEGORY_KEYS = [
  "case",
  "glass",
  "film",
  "charger",
  "cable",
  "headphones",
  "powerbank",
  "holder",
  "other",
];
export function buildAccessoryItem(state, t) {
  const n = clean(t.name);
  (assert(n.length >= 2, "Название слишком короткое", "name"),
    assert(
      ACCESSORY_CATEGORY_KEYS.includes(t.category),
      "Выберите категорию",
      "category",
    ));
  const a = toNumber(t.salePrice),
    c = toNumber(t.minStock);
  (assertNonNegative(a, "Цена продажи", "salePrice"),
    assertNonNegative(c, "Минимальный остаток", "minStock"));
  const r = t.id ? state.accessoryItems.find((i) => i.id === t.id) : void 0;
  return (
    t.id && assert(r, "Товар не найден"),
    {
      item: {
        id: (r == null ? void 0 : r.id) ?? makeId("ai"),
        name: n,
        category: t.category,
        compatibility: clean(t.compatibility),
        color: clean(t.color),
        salePrice: round2(a),
        minStock: Math.round(c),
        createdAt: (r == null ? void 0 : r.createdAt) ?? nowISO(),
        updatedAt: nowISO(),
      },
      isNew: !r,
    }
  );
}
export function saveAccessoryItem(state, t) {
  const { item: n, isNew: a } = buildAccessoryItem(state, t),
    c = a
      ? [n, ...state.accessoryItems]
      : state.accessoryItems.map((r) => (r.id === n.id ? n : r));
  return withAudit(
    {
      ...state,
      accessoryItems: c,
    },
    makeAuditEntry(
      state,
      a ? "create" : "update",
      "accessory",
      n.id,
      `${a ? "Добавлен товар" : "Изменён товар"} «${n.name}»`,
      `Цена продажи: ${n.salePrice} ₽`,
    ),
  );
}
export function deleteAccessoryItem(state, t) {
  const n = state.accessoryItems.find((r) => r.id === t);
  assert(n, "Товар не найден");
  const a = getAccessoryStock(state, t);
  assert(
    a <= 0,
    `«${n.name}»: есть остаток ${a} шт. Сначала продайте или спишите товар.`,
    "id",
  );
  const c = state.accessorySales.some((r) =>
    r.items.some((i) => i.itemId === t),
  );
  return (
    assert(
      !c,
      "По товару есть продажи — удаление невозможно. Используйте архивацию остатков.",
      "id",
    ),
    withAudit(
      {
        ...state,
        accessoryItems: state.accessoryItems.filter((r) => r.id !== t),
        accessoryBatches: state.accessoryBatches.filter((r) => r.itemId !== t),
      },
      makeAuditEntry(
        state,
        "delete",
        "accessory",
        t,
        `Удалён товар «${n.name}»`,
      ),
    )
  );
}
export function getAccessoryStock(state, t) {
  return state.accessoryBatches.reduce(
    (n, a) => (a.itemId === t ? n + a.qtyLeft : n),
    0,
  );
}
export function getAvailableBatches(s, t) {
  return s.accessoryBatches
    .filter((n) => n.itemId === t && n.qtyLeft > 0)
    .reverse()
    .sort((n, a) =>
      n.date === a.date
        ? n.createdAt.localeCompare(a.createdAt)
        : n.date.localeCompare(a.date),
    );
}
export function applyAllocations(s, t, n) {
  const a = new Map(t.map((c) => [c.batchId, c.qty]));
  return s.map((c) => {
    const r = a.get(c.id);
    return r
      ? {
          ...c,
          qtyLeft: round2(c.qtyLeft + n * r),
        }
      : c;
  });
}
export function allocateStock(state, t, n, a) {
  const c = [];
  let r = n;
  for (const i of getAvailableBatches(state, t)) {
    if (r <= 0) break;
    const o = Math.min(i.qtyLeft, r);
    (c.push({
      batchId: i.id,
      qty: o,
    }),
      (r = round2(r - o)));
  }
  return (
    assert(r <= 0, `${a}: недостаточно остатка (не хватает ${r} шт.)`, "qty"),
    c
  );
}
export function createAccessoryBatch(state, t) {
  let n,
    a = state.accessoryItems,
    c = state;
  t.itemId
    ? ((n = state.accessoryItems.find((x) => x.id === t.itemId)),
      assert(n, "Выберите товар", "itemId"))
    : t.newItem
      ? ((n = buildAccessoryItem(state, t.newItem).item),
        (a = [n, ...a]),
        (c = {
          ...state,
          accessoryItems: a,
        }))
      : assert(!1, "Выберите товар или создайте новый", "itemId");
  const r = toNumber(t.qty);
  assert(
    r > 0 && Number.isInteger(r),
    "Количество должно быть целым числом больше нуля",
    "qty",
  );
  const i = toNumber(t.unitCost);
  (assertNonNegative(i, "Закупочная цена", "unitCost"),
    assert(t.date, "Укажите дату", "date"),
    assert(t.date <= todayLocal(), "Дата не может быть в будущем", "date"));
  const o = getActiveAccount(state, t.accountId),
    l = round2(r * i);
  assertSufficientFunds(state, t.accountId, l, "Закупка аксессуаров");
  const d = {
    id: makeId("ab"),
    itemId: n.id,
    kind: "purchase",
    qty: r,
    qtyLeft: r,
    unitCost: round2(i),
    accountId: t.accountId,
    paymentMethod: t.paymentMethod,
    date: t.date,
    supplierName: clean(t.supplierName),
    comment: clean(t.comment),
    createdAt: nowISO(),
  };
  return withAudit(
    {
      ...c,
      accessoryBatches: [d, ...c.accessoryBatches],
    },
    makeAuditEntry(
      state,
      "create",
      "acc_batch",
      d.id,
      `Закупка аксессуаров · ${n.name} × ${r} шт · ${l} ₽`,
      `Счёт: ${o.name}${d.supplierName ? `; поставщик: ${d.supplierName}` : ""}`,
    ),
  );
}
export function todayLocal() {
  return today();
}
export function adjustAccessoryStock(state, t) {
  const n = state.accessoryItems.find((x) => x.id === t.itemId);
  assert(n, "Товар не найден", "itemId");
  const a = Number(t.delta);
  assert(
    Number.isFinite(a) && a !== 0 && Number.isInteger(a),
    "Укажите целое ненулевое изменение",
    "delta",
  );
  const c = getAccessoryStock(state, n.id);
  if (a > 0) {
    const x = toNumber(t.unitCost);
    assertNonNegative(x, "Себестоимость", "unitCost");
    const v = {
      id: makeId("ab"),
      itemId: n.id,
      kind: "adjust",
      qty: a,
      qtyLeft: a,
      unitCost: round2(x),
      accountId: "",
      paymentMethod: "cash",
      date: todayLocal(),
      supplierName: "",
      comment: clean(t.comment),
      createdAt: nowISO(),
    };
    return withAudit(
      {
        ...state,
        accessoryBatches: [v, ...state.accessoryBatches],
      },
      makeAuditEntry(
        state,
        "create",
        "acc_batch",
        v.id,
        `Корректировка склада · ${n.name}: +${a} шт`,
        v.comment || void 0,
      ),
    );
  }
  const r = Math.abs(a);
  assert(
    c >= r,
    `«${n.name}»: недостаточно остатка (есть ${c} шт., нужно ${r} шт.)`,
    "delta",
  );
  const i = allocateStock(state, n.id, r, `Списание «${n.name}»`);
  let o = 0;
  for (const x of i) {
    const v = state.accessoryBatches.find((p) => p.id === x.batchId);
    o += ((v == null ? void 0 : v.unitCost) ?? 0) * x.qty;
  }
  const l = {
      id: makeId("ab"),
      itemId: n.id,
      kind: "writeoff",
      qty: r,
      qtyLeft: 0,
      unitCost: r ? o / r : 0,
      accountId: "",
      paymentMethod: "cash",
      date: todayLocal(),
      supplierName: "",
      comment: clean(t.comment),
      createdAt: nowISO(),
    },
    d = applyAllocations([l, ...state.accessoryBatches], i, -1);
  return withAudit(
    {
      ...state,
      accessoryBatches: d,
    },
    makeAuditEntry(
      state,
      "create",
      "acc_batch",
      l.id,
      `Списание · ${n.name} × ${r} шт`,
      l.comment || void 0,
    ),
  );
}
export function getAccessorySaleTotals(s) {
  const t = roundMoney(s.items.reduce((c, r) => c + r.qty * r.unitPrice, 0)),
    n = roundMoney(s.items.reduce((c, r) => c + r.qty * r.unitCost, 0)),
    a = roundMoney(Math.max(0, t - (s.discount || 0)));
  return {
    gross: t,
    revenue: a,
    cost: n,
    profit: roundMoney(a - n),
    qty: s.items.reduce((c, r) => c + r.qty, 0),
  };
}
export function buildAccessorySale(state, t) {
  (assert(t.items.length > 0, "Добавьте хотя бы одну позицию", "items"),
    assert(t.accountId, "Выберите счёт", "accountId"),
    getActiveAccount(state, t.accountId),
    assert(t.date, "Укажите дату", "date"),
    assert(t.date <= todayLocal(), "Дата не может быть в будущем", "date"));
  const n = new Set(),
    a = [];
  for (const i of t.items) {
    const o = state.accessoryItems.find((p) => p.id === i.itemId);
    (assert(o, "Товар не найден — обновите список", "items"),
      assert(!n.has(o.id), `«${o.name}» уже добавлен в чек`, "items"),
      n.add(o.id));
    const l = toNumber(i.qty);
    assert(
      l > 0 && Number.isInteger(l),
      `«${o.name}»: количество должно быть целым числом больше нуля`,
      "items",
    );
    const d =
      i.unitPrice === void 0 || i.unitPrice === ""
        ? o.salePrice
        : toNumber(i.unitPrice);
    assertNonNegative(d, `«${o.name}»: цена`, "items");
    const x = allocateStock(state, o.id, l, `Продажа «${o.name}»`);
    let v = 0;
    for (const p of x) {
      const w = state.accessoryBatches.find((A) => A.id === p.batchId);
      v += ((w == null ? void 0 : w.unitCost) ?? 0) * p.qty;
    }
    a.push({
      itemId: o.id,
      name: o.name,
      category: o.category,
      qty: l,
      unitPrice: round2(d),
      unitCost: l ? v / l : 0,
      allocations: x,
    });
  }
  const c = toNumber(t.discount);
  assertNonNegative(c, "Скидка", "discount");
  const r = roundMoney(a.reduce((i, o) => i + o.qty * o.unitPrice, 0));
  return (
    assert(c <= r + 0.001, "Скидка больше суммы чека", "discount"),
    {
      id: makeId("as"),
      items: a,
      discount: round2(c),
      accountId: t.accountId,
      paymentMethod: t.paymentMethod,
      buyerName: clean(t.buyerName),
      date: t.date,
      comment: clean(t.comment),
      status: "completed",
      groupId: t.groupId ?? "",
      createdAt: nowISO(),
      cancelledAt: null,
    }
  );
}
export function createAccessorySale(state, t) {
  const n = buildAccessorySale(state, t),
    a = n.items.reduce(
      (r, i) => applyAllocations(r, i.allocations, -1),
      state.accessoryBatches,
    ),
    c = getAccessorySaleTotals(n);
  return withAudit(
    {
      ...state,
      accessorySales: [n, ...state.accessorySales],
      accessoryBatches: a,
    },
    makeAuditEntry(
      state,
      "create",
      "acc_sale",
      n.id,
      `Продажа аксессуаров · ${n.items[0].name}${n.items.length > 1 ? ` +${n.items.length - 1}` : ""} · ${c.revenue} ₽`,
      `${c.qty} шт.${n.buyerName ? `; покупатель: ${n.buyerName}` : ""}`,
    ),
  );
}
export function createCombinedSale(state, t) {
  var c;
  assert(t.sale || (t.acc && t.acc.items.length > 0), "Пустая продажа");
  let n = state,
    a = "";
  return (
    t.sale &&
      ((n = createSale(n, t.sale)),
      t.acc &&
        t.acc.items.length > 0 &&
        (a = ((c = n.sales[0]) == null ? void 0 : c.id) ?? "")),
    t.acc &&
      t.acc.items.length > 0 &&
      (n = createAccessorySale(n, {
        ...t.acc,
        groupId: a,
      })),
    n
  );
}
export function cancelAccessorySale(state, t) {
  const n = state.accessorySales.find((r) => r.id === t);
  (assert(n, "Продажа не найдена"),
    assert(n.status === "completed", "Продажа уже отменена"));
  let a = state.accessoryBatches;
  for (const r of n.items) a = applyAllocations(a, r.allocations, 1);
  const c = {
    ...n,
    status: "cancelled",
    cancelledAt: nowISO(),
  };
  return withAudit(
    {
      ...state,
      accessoryBatches: a,
      accessorySales: state.accessorySales.map((r) => (r.id === t ? c : r)),
    },
    makeAuditEntry(
      state,
      "cancel",
      "acc_sale",
      t,
      `Отмена продажи аксессуаров · ${n.items[0].name}${n.items.length > 1 ? ` +${n.items.length - 1}` : ""}`,
      "Остатки возвращены на склад",
    ),
  );
}
export function getAccessoryStockValue(state) {
  return roundMoney(
    state.accessoryBatches.reduce((t, n) => t + n.qtyLeft * n.unitCost, 0),
  );
}
export function estimateAccessoryCost(state, t) {
  let n = 0;
  for (const a of t) {
    let c = a.qty;
    for (const r of getAvailableBatches(state, a.itemId)) {
      if (c <= 0) break;
      const i = Math.min(r.qtyLeft, c);
      ((n += i * r.unitCost), (c -= i));
    }
  }
  return roundMoney(n);
}
export function getAccessoryStockQty(state) {
  return state.accessoryBatches.reduce((t, n) => t + n.qtyLeft, 0);
}
export function getLowStockItems(state) {
  return state.accessoryItems
    .map((t) => ({
      item: t,
      stock: getAccessoryStock(state, t.id),
    }))
    .filter(({ item: t, stock: n }) => n <= t.minStock)
    .sort((t, n) => t.stock - n.stock)
    .map(({ item: t }) => t);
}
export function getAccessoryStats(state, t) {
  var l;
  const n = state.accessorySales.filter(
      (d) => d.status === "completed" && (!t || inPeriod(d.date, t)),
    ),
    a = {};
  let c = 0,
    r = 0,
    i = 0;
  for (const d of n) {
    const x = getAccessorySaleTotals(d);
    ((c += x.revenue), (r += x.cost), (i += x.qty));
    for (const v of d.items) {
      const p =
          a[(l = v.category)] ??
          (a[l] = {
            revenue: 0,
            cost: 0,
            profit: 0,
            qty: 0,
          }),
        w = roundMoney(
          v.qty * v.unitPrice * (x.gross ? x.revenue / x.gross : 1),
        ),
        A = roundMoney(v.qty * v.unitCost);
      ((p.revenue = roundMoney(p.revenue + w)),
        (p.cost = roundMoney(p.cost + A)),
        (p.profit = roundMoney(p.profit + w - A)),
        (p.qty += v.qty));
    }
  }
  const o = roundMoney(
    state.accessoryBatches
      .filter((d) => d.kind === "writeoff" && (!t || inPeriod(d.date, t)))
      .reduce((d, x) => d + x.qty * x.unitCost, 0),
  );
  return {
    revenue: roundMoney(c),
    cost: roundMoney(r),
    profit: roundMoney(c - r),
    soldQty: i,
    receipts: n.length,
    stockValue: getAccessoryStockValue(state),
    stockQty: getAccessoryStockQty(state),
    itemsCount: state.accessoryItems.length,
    lowStockCount: getLowStockItems(state).length,
    writeOffCost: o,
    byCategory: a,
  };
}
export function getTopAccessories(state, t, n = 5) {
  const a = new Map();
  for (const c of state.accessorySales)
    if (!(c.status !== "completed" || (t && !inPeriod(c.date, t))))
      for (const r of c.items) {
        const i = a.get(r.itemId) ?? {
          itemId: r.itemId,
          name: r.name,
          qty: 0,
          revenue: 0,
          profit: 0,
        };
        ((i.qty += r.qty),
          (i.revenue = roundMoney(i.revenue + r.qty * r.unitPrice)),
          (i.profit = roundMoney(
            i.profit + r.qty * (r.unitPrice - r.unitCost),
          )),
          a.set(r.itemId, i));
      }
  return Array.from(a.values())
    .sort((c, r) => r.qty - c.qty || r.revenue - c.revenue)
    .slice(0, n);
}
