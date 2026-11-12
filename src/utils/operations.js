/**
 * Единый журнал операций из всех сущностей.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { getSaleProfit, getSaleRevenue } from "./calculations.js";
import { roundMoney } from "./format.js";
export function getAllOperations(state) {
  var i, o, l, d, x, v, p, w, A, L, O;
  const t = new Map(state.phones.map((m) => [m.id, m])),
    n = new Map(state.accounts.map((m) => [m.id, m])),
    a = (m, f) => [m || "Без имени", f].filter(Boolean).join(" · "),
    c = [];
  for (const m of state.phones)
    c.push({
      id: `phone:${m.id}`,
      kind: "phone",
      type: "purchase",
      date: m.purchaseDate,
      createdAt: m.createdAt,
      title: `Закупка · ${m.model}`,
      subtitle: `${a(m.supplierName, m.supplierPhone)} · ${m.storage || "—"}${m.imei ? ` · IMEI ${m.imei}` : ""}`,
      amount: -m.purchasePrice,
      moneyEffect: -m.purchasePrice,
      accountId: m.purchaseAccountId,
      status: m.status,
      icon: "phone",
      meta: {
        account:
          ((i = n.get(m.purchaseAccountId)) == null ? void 0 : i.name) ?? "—",
        phoneId: m.id,
      },
    });
  for (const phone of state.phones) for (const repair of phone.repairs ?? [])
    c.push({
      id: `repair:${repair.id}`, kind: "repair", type: "expense",
      date: repair.date, createdAt: repair.createdAt,
      title: `Ремонт · ${phone.model}`, subtitle: repair.comment || "Ремонт завершён",
      amount: -repair.amount, moneyEffect: -repair.amount, accountId: repair.accountId,
      icon: "expense", meta: { phoneId: phone.id, account: n.get(repair.accountId)?.name ?? "—" },
    });
  for (const m of state.sales) {
    const f = t.get(m.phoneId);
    c.push({
      id: `sale:${m.id}`,
      kind: "sale",
      type: "sale",
      date: m.date,
      createdAt: m.createdAt,
      title: `Продажа · ${(f == null ? void 0 : f.model) ?? "Телефон"}`,
      subtitle: `${a(m.buyerName, m.buyerPhone)}${m.discount ? ` · скидка ${m.discount} ₽` : ""}`,
      amount: getSaleRevenue(m),
      moneyEffect: m.status === "completed" ? getSaleRevenue(m) : 0,
      accountId: m.accountId,
      status: m.status,
      icon: "sale",
      meta: {
        account: ((o = n.get(m.accountId)) == null ? void 0 : o.name) ?? "—",
        profit: getSaleProfit(m, state.phones),
        phoneId: m.phoneId,
        saleId: m.id,
      },
    });
  }
  for (const m of state.expenses)
    c.push({
      id: `expense:${m.id}`,
      kind: "expense",
      type: "expense",
      date: m.date,
      createdAt: m.createdAt,
      title: `Расход · ${EXPENSE_CATEGORY_LABELS[m.category] ?? "Прочее"}`,
      subtitle:
        [m.vendor, m.comment].filter(Boolean).join(" · ") || "Без комментария",
      amount: -m.amount,
      moneyEffect: -m.amount,
      accountId: m.accountId,
      icon: "expense",
      meta: {
        account: ((l = n.get(m.accountId)) == null ? void 0 : l.name) ?? "—",
      },
    });
  for (const m of state.transfers)
    c.push({
      id: `transfer:${m.id}`,
      kind: "transfer",
      type: "transfer",
      date: m.date,
      createdAt: m.createdAt,
      title: `Перевод · ${((d = n.get(m.fromAccountId)) == null ? void 0 : d.name) ?? "—"} → ${((x = n.get(m.toAccountId)) == null ? void 0 : x.name) ?? "—"}`,
      subtitle: m.comment || "Перевод между своими счетами",
      amount: m.amount,
      moneyEffect: 0,
      icon: "transfer",
      meta: {
        from: (v = n.get(m.fromAccountId)) == null ? void 0 : v.name,
        to: (p = n.get(m.toAccountId)) == null ? void 0 : p.name,
      },
    });
  for (const m of state.cashOps) {
    const f = m.kind === "deposit";
    c.push({
      id: `cash:${m.id}`,
      kind: "cashOp",
      type: f ? "deposit" : "withdrawal",
      date: m.date,
      createdAt: m.createdAt,
      title: f ? "Пополнение счёта" : "Снятие со счёта",
      subtitle: `${((w = n.get(m.accountId)) == null ? void 0 : w.name) ?? "—"}${m.comment ? ` · ${m.comment}` : ""}`,
      amount: f ? m.amount : -m.amount,
      moneyEffect: f ? m.amount : -m.amount,
      accountId: m.accountId,
      icon: f ? "deposit" : "withdrawal",
      meta: {
        account: ((A = n.get(m.accountId)) == null ? void 0 : A.name) ?? "—",
      },
    });
  }
  const r = new Map(state.accessoryItems.map((m) => [m.id, m]));
  for (const m of state.accessoryBatches) {
    const f = r.get(m.itemId),
      C = (f == null ? void 0 : f.name) ?? "Товар";
    m.kind === "purchase"
      ? c.push({
          id: `acc_batch:${m.id}`,
          kind: "acc_batch",
          type: "acc_purchase",
          date: m.date,
          createdAt: m.createdAt,
          title: `Закупка аксессуаров · ${C}`,
          subtitle: `${m.qty} шт. × ${m.unitCost} ₽${m.supplierName ? ` · ${m.supplierName}` : ""}${m.comment ? ` · ${m.comment}` : ""}`,
          amount: -roundMoney(m.qty * m.unitCost),
          moneyEffect: -roundMoney(m.qty * m.unitCost),
          accountId: m.accountId || void 0,
          icon: "package",
          meta: {
            account:
              ((L = n.get(m.accountId ?? "")) == null ? void 0 : L.name) ?? "—",
            itemId: m.itemId,
          },
        })
      : m.kind === "adjust"
        ? c.push({
            id: `acc_batch:${m.id}`,
            kind: "acc_batch",
            type: "acc_adjust",
            date: m.date,
            createdAt: m.createdAt,
            title: `Корректировка склада · ${C}`,
            subtitle: `+${m.qty} шт.${m.comment ? ` · ${m.comment}` : ""}`,
            amount: 0,
            moneyEffect: 0,
            icon: "package",
            meta: {
              itemId: m.itemId,
            },
          })
        : c.push({
            id: `acc_batch:${m.id}`,
            kind: "acc_batch",
            type: "acc_writeoff",
            date: m.date,
            createdAt: m.createdAt,
            title: `Списание · ${C}`,
            subtitle: `−${m.qty} шт.${m.comment ? ` · ${m.comment}` : ""}`,
            amount: 0,
            moneyEffect: 0,
            icon: "expense",
            meta: {
              itemId: m.itemId,
            },
          });
  }
  for (const m of state.accessorySales) {
    const f = m.items.reduce((b, B) => b + B.qty * B.unitPrice, 0),
      C = Math.max(0, f - m.discount),
      S = m.items.reduce((b, B) => b + B.qty, 0),
      g = m.items
        .map((b) => (m.items.length > 1 ? `${b.name} ×${b.qty}` : b.name))
        .join(", ");
    c.push({
      id: `acc_sale:${m.id}`,
      kind: "acc_sale",
      type: m.status === "completed" ? "acc_sale" : "acc_refund",
      date: m.date,
      createdAt: m.createdAt,
      title: `Продажа аксессуаров · ${g}`,
      subtitle: `${S} шт.${m.discount ? ` · скидка ${m.discount} ₽` : ""}${m.buyerName ? ` · ${m.buyerName}` : ""}`,
      amount: C,
      moneyEffect: m.status === "completed" ? C : 0,
      accountId: m.accountId,
      status: m.status,
      icon: m.status === "completed" ? "sale" : "refund",
      meta: {
        account: ((O = n.get(m.accountId)) == null ? void 0 : O.name) ?? "—",
        profit: roundMoney(
          m.items.reduce((b, B) => b + B.qty * (B.unitPrice - B.unitCost), 0) -
            m.discount,
        ),
        saleId: m.id,
      },
    });
  }
  return c.sort((m, f) =>
    m.date === f.date
      ? f.createdAt.localeCompare(m.createdAt)
      : f.date.localeCompare(m.date),
  );
}
export const EXPENSE_CATEGORY_LABELS = {
  rent: "Аренда",
  salary: "Зарплата",
  repair: "Ремонт телефона",
  tax: "Налоги",
  marketing: "Реклама",
  other: "Прочие расходы",
};
