/**
 * Построение рядов для графика и рейтинг моделей.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { getSaleProfit, getSaleRevenue, getPhoneTotalCost } from "./calculations.js";
import {
  addDays,
  daysBetween,
  getPeriod,
  inPeriod,
  parseDate,
  roundMoney,
  toISODate,
  today,
} from "./format.js";
export function bucketKey(s, t) {
  const n = parseDate(s) ?? new Date();
  if (t === "month")
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  if (t === "week") {
    const a = (n.getDay() + 6) % 7;
    return toISODate(addDays(n, -a));
  }
  return toISODate(n);
}
export function bucketLabel(s, t) {
  if (t === "month") {
    const [a, c] = s.split("-").map(Number);
    return new Date(a, c - 1, 1)
      .toLocaleDateString("ru-RU", {
        month: "short",
      })
      .replace(".", "");
  }
  if (t === "week") {
    const a = parseDate(s);
    if (!a) return s;
    const c = addDays(a, 6);
    return `${a.getDate()}–${c.getDate()} ${c
      .toLocaleDateString("ru-RU", {
        month: "short",
      })
      .replace(".", "")}`;
  }
  const n = parseDate(s);
  return n
    ? n
        .toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "short",
        })
        .replace(".", "")
    : s;
}
export function getChartData(state, t, n = today()) {
  const a = getPeriod(t, n),
    c = t === "day" || t === "month" || t === "week" ? "day" : "month",
    r = new Map(),
    i = (d) => {
      const x = bucketKey(d, c);
      let v = r.get(x);
      return (
        v ||
          ((v = {
            key: x,
            label: bucketLabel(x, c),
            income: 0,
            expense: 0,
            profit: 0,
          }),
          r.set(x, v)),
        v
      );
    };
  if (t !== "all" && c === "day") {
    const d = parseDate(a.from),
      x = parseDate(a.to),
      v = parseDate(n) ?? new Date(),
      p = x && x < v ? x : v;
    if (d && p && p >= d) {
      const w = Math.min(daysBetween(a.from, toISODate(p)), 62);
      for (let A = 0; A <= w; A++) i(toISODate(addDays(d, A)));
    }
  }
  const o = (d, x, v) => {
    const p = i(d);
    ((p.income = roundMoney(p.income + x)),
      (p.expense = roundMoney(p.expense + v)),
      (p.profit = roundMoney(p.profit + x - v)));
  };
  for (const d of state.sales) {
    if (d.status !== "completed" || !inPeriod(d.date, a)) continue;
    const x = state.phones.find((v) => v.id === d.phoneId);
    (o(d.date, getSaleRevenue(d), 0), x && o(d.date, 0, getPhoneTotalCost(x)));
  }
  for (const d of state.accessorySales) {
    if (d.status !== "completed" || !inPeriod(d.date, a)) continue;
    const x = Math.max(
        0,
        d.items.reduce((p, w) => p + w.qty * w.unitPrice, 0) - d.discount,
      ),
      v = d.items.reduce((p, w) => p + w.qty * w.unitCost, 0);
    o(d.date, x, v);
  }
  for (const d of state.accessoryBatches)
    d.kind === "writeoff" &&
      inPeriod(d.date, a) &&
      o(d.date, 0, d.qty * d.unitCost);
  for (const d of state.expenses) inPeriod(d.date, a) && o(d.date, 0, d.amount);
  const l = Array.from(r.values()).sort((d, x) => d.key.localeCompare(x.key));
  if (t === "all" && l.length > 12) {
    const d = new Map();
    for (const x of l) {
      const v = x.key,
        p = bucketKey(v, "month"),
        w = d.get(p) ?? {
          key: p,
          label: bucketLabel(p, "month"),
          income: 0,
          expense: 0,
          profit: 0,
        };
      ((w.income = roundMoney(w.income + x.income)),
        (w.expense = roundMoney(w.expense + x.expense)),
        (w.profit = roundMoney(w.profit + x.profit)),
        d.set(p, w));
    }
    return Array.from(d.values())
      .sort((x, v) => x.key.localeCompare(v.key))
      .slice(-12);
  }
  return l.slice(-62);
}
export function getTopModels(state, t, n = 5) {
  const a = new Map();
  for (const r of state.sales) {
    if (r.status !== "completed" || !inPeriod(r.date, t)) continue;
    const i = state.phones.find((d) => d.id === r.phoneId);
    if (!i) continue;
    const o = normalizeModel(i.model),
      l = a.get(o) ?? {
        model: i.model,
        count: 0,
        revenue: 0,
        profit: 0,
        margin: 0,
      };
    (l.count++,
      (l.revenue = roundMoney(l.revenue + getSaleRevenue(r))),
      (l.profit = roundMoney(l.profit + getSaleProfit(r, state.phones))),
      a.set(o, l));
  }
  return Array.from(a.values())
    .map((r) => ({
      ...r,
      margin: r.revenue > 0 ? Math.round((r.profit / r.revenue) * 100) : 0,
    }))
    .sort((r, i) => i.count - r.count || i.profit - r.profit)
    .slice(0, n);
}
export function normalizeModel(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
