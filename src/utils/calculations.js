/**
 * Расчёт остатков счетов, выручки, прибыли и показателей за период.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { daysBetween, inPeriod, roundMoney, today } from "./format.js";
export function getAccountBalances(state, t) {
  return state.accounts.map((n) => {
    const a = (l) => !0;
    let c = 0,
      r = 0,
      i = 0;
    for (const l of state.sales)
      l.status !== "completed" ||
        l.accountId !== n.id ||
        (a(l.date), (c += getSaleRevenue(l)), i++);
    for (const l of state.phones)
      l.purchaseAccountId === n.id &&
        (a(l.purchaseDate), (r += l.purchasePrice), i++);
    for (const l of state.expenses)
      l.accountId === n.id && (a(l.date), (r += l.amount), i++);
    for (const l of state.transfers)
      (a(l.date),
        l.fromAccountId === n.id && ((r += l.amount), i++),
        l.toAccountId === n.id && ((c += l.amount), i++));
    for (const l of state.cashOps)
      l.accountId === n.id &&
        (a(l.date),
        l.kind === "deposit" ? (c += l.amount) : (r += l.amount),
        i++);
    for (const l of state.accessoryBatches)
      l.kind !== "purchase" ||
        l.accountId !== n.id ||
        (a(l.date), (r += l.qty * l.unitCost), i++);
    for (const l of state.accessorySales)
      l.status !== "completed" ||
        l.accountId !== n.id ||
        (a(l.date),
        (c += roundMoney(
          Math.max(
            0,
            l.items.reduce((d, x) => d + x.qty * x.unitPrice, 0) - l.discount,
          ),
        )),
        i++);
    const o = roundMoney(n.openingBalance + c - r);
    return {
      account: n,
      balance: o,
      inflow: roundMoney(c),
      outflow: roundMoney(r),
      movements: i,
    };
  });
}
export function getAccountBalance(state, t) {
  const n = state.accounts.find((a) => a.id === t);
  return n ? roundMoney(n.openingBalance + getAccountDelta(state, t)) : 0;
}
export function getAccountDelta(state, t) {
  let n = 0;
  for (const a of state.sales)
    a.status === "completed" && a.accountId === t && (n += getSaleRevenue(a));
  for (const a of state.phones)
    a.purchaseAccountId === t && (n -= a.purchasePrice);
  for (const a of state.expenses) a.accountId === t && (n -= a.amount);
  for (const a of state.transfers)
    (a.fromAccountId === t && (n -= a.amount),
      a.toAccountId === t && (n += a.amount));
  for (const a of state.cashOps)
    a.accountId === t && (n += a.kind === "deposit" ? a.amount : -a.amount);
  for (const a of state.accessoryBatches)
    a.kind === "purchase" && a.accountId === t && (n -= a.qty * a.unitCost);
  for (const a of state.accessorySales)
    a.status === "completed" &&
      a.accountId === t &&
      (n += Math.max(
        0,
        a.items.reduce((c, r) => c + r.qty * r.unitPrice, 0) - a.discount,
      ));
  return roundMoney(n);
}
export function getTotalMoney(state, t) {
  return roundMoney(
    getAccountBalances(state).reduce((n, a) => n + a.balance, 0),
  );
}
export function getSaleRevenue(s) {
  return s.status !== "completed"
    ? 0
    : roundMoney(Math.max(0, s.price - s.discount));
}
export function getSaleProfit(s, t) {
  if (s.status !== "completed") return 0;
  const n = t.find((a) => a.id === s.phoneId);
  return n ? roundMoney(getSaleRevenue(s) - n.purchasePrice) : 0;
}
export function getSaleMargin(s, t) {
  const n = getSaleRevenue(s);
  return n <= 0 ? 0 : Math.round((getSaleProfit(s, t) / n) * 100);
}
export function findCompletedSale(state, t) {
  return state.sales.find((n) => n.phoneId === t && n.status === "completed");
}
export function getStockAge(s, t) {
  const n = t ?? today(),
    a = daysBetween(s.purchaseDate, n),
    c = (r) => {
      const i = r % 10,
        o = r % 100;
      return i === 1 && o !== 11
        ? `${r} день`
        : i >= 2 && i <= 4 && (o < 12 || o > 14)
          ? `${r} дня`
          : `${r} дней`;
    };
  return t ? `${c(Math.max(0, a))} · продан` : a <= 0 ? "сегодня" : c(a);
}
export function getPhonesInStock(state) {
  return state.phones.filter((t) => t.status !== "sold");
}
export function getStockValue(state) {
  return roundMoney(
    getPhonesInStock(state).reduce((t, n) => t + n.purchasePrice, 0),
  );
}
export function getStats(state, t) {
  const n = state.sales.filter(
      (u) => u.status === "completed" && inPeriod(u.date, t),
    ),
    a = new Map(state.phones.map((u) => [u.id, u])),
    c = state.phones.filter((u) => inPeriod(u.purchaseDate, t)),
    r = state.expenses.filter((u) => inPeriod(u.date, t)),
    i = roundMoney(n.reduce((u, N) => u + getSaleRevenue(N), 0)),
    o = roundMoney(
      n.reduce((u, N) => {
        const E = a.get(N.phoneId);
        return u + ((E == null ? void 0 : E.purchasePrice) ?? 0);
      }, 0),
    ),
    l = state.accessorySales.filter(
      (u) => u.status === "completed" && inPeriod(u.date, t),
    ),
    d = roundMoney(
      l.reduce(
        (u, N) =>
          u +
          Math.max(
            0,
            N.items.reduce((E, R) => E + R.qty * R.unitPrice, 0) - N.discount,
          ),
        0,
      ),
    ),
    x = roundMoney(
      l.reduce(
        (u, N) => u + N.items.reduce((E, R) => E + R.qty * R.unitCost, 0),
        0,
      ),
    ),
    v = l.reduce((u, N) => u + N.items.reduce((E, R) => E + R.qty, 0), 0),
    p = roundMoney(
      state.accessoryBatches
        .filter((u) => u.kind === "writeoff" && inPeriod(u.date, t))
        .reduce((u, N) => u + N.qty * N.unitCost, 0),
    ),
    w = roundMoney(
      state.accessoryBatches
        .filter((u) => u.kind === "purchase" && inPeriod(u.date, t))
        .reduce((u, N) => u + N.qty * N.unitCost, 0),
    ),
    A = roundMoney(i + d),
    L = roundMoney(o + x),
    O = roundMoney(A - L),
    m = roundMoney(r.reduce((u, N) => u + N.amount, 0)),
    f = roundMoney(O - m - p),
    C = {};
  for (const u of r)
    C[u.category] = roundMoney((C[u.category] ?? 0) + u.amount);
  const S = roundMoney(
      state.cashOps
        .filter((u) => u.kind === "deposit" && inPeriod(u.date, t))
        .reduce((u, N) => u + N.amount, 0),
    ),
    g = roundMoney(
      state.cashOps
        .filter((u) => u.kind === "withdrawal" && inPeriod(u.date, t))
        .reduce((u, N) => u + N.amount, 0),
    ),
    b = roundMoney(
      state.transfers
        .filter((u) => inPeriod(u.date, t))
        .reduce((u, N) => u + N.amount, 0),
    ),
    B = b,
    y = roundMoney(c.reduce((u, N) => u + N.purchasePrice, 0)),
    j = n
      .map((u) => {
        const N = getSaleRevenue(u),
          E = a.get(u.phoneId);
        return N > 0 && E ? (N - E.purchasePrice) / N : 0;
      })
      .filter((u) => Number.isFinite(u));
  return {
    revenue: A,
    cogs: L,
    grossProfit: O,
    opex: m,
    netProfit: f,
    purchases: y,
    salesCount: n.length + l.length,
    purchasesCount: c.length,
    expensesCount: r.length,
    averageCheck:
      n.length + l.length ? roundMoney(A / (n.length + l.length)) : 0,
    averageMargin: j.length
      ? Math.round((j.reduce((u, N) => u + N, 0) / j.length) * 100)
      : 0,
    expensesByCategory: C,
    deposits: S,
    withdrawals: g,
    transfersIn: b,
    transfersOut: B,
    cashFlow: roundMoney(A - y - w - m + S - g),
    phoneRevenue: i,
    phoneCogs: o,
    accRevenue: d,
    accCogs: x,
    accProfit: roundMoney(d - x),
    accSoldQty: v,
    accSalesCount: l.length,
    accPurchases: w,
    writeOff: p,
  };
}
