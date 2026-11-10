/**
 * Главная страница.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { IncomeExpenseChart } from "../components/IncomeExpenseChart.jsx";
import { StatCard, percentChange } from "../components/StatCard.jsx";
import {
  Card,
  CardHeader,
  EmptyState,
  SegmentedTabs,
  cx,
} from "../components/ui.jsx";
import { getAccessoryStockValue } from "../domain/accessories.js";
import { useStore } from "../hooks/useStore.jsx";
import {
  getAccountBalances,
  getPhonesInStock,
  getStats,
  getStockValue,
} from "../utils/calculations.js";
import { getChartData, getTopModels } from "../utils/chartData.js";
import { PERIOD_OPTIONS } from "../utils/constants.js";
import {
  formatAmount,
  formatCompactMoney,
  formatMoney,
  formatShortDate,
  getPeriod,
  getPreviousPeriod,
  plural,
} from "../utils/format.js";
import { getAllOperations } from "../utils/operations.js";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  ChevronRight,
  Package,
  Plus,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function DashboardPage({
  onNavigate: s,
  onNewPurchase: t,
  onNewSale: n,
}) {
  const { data: a, period: c, setPeriod: r } = useStore(),
    [i, o] = React.useState(!1),
    l = React.useMemo(() => getPeriod(c), [c]),
    d = React.useMemo(() => getStats(a, l), [a, l]),
    x = React.useMemo(() => {
      if (c === "all") return null;
      const f = getPreviousPeriod(l);
      return f ? getStats(a, f) : null;
    }, [a, l, c]),
    v = React.useMemo(() => getChartData(a, c), [a, c]),
    p = React.useMemo(() => getTopModels(a, l, 5), [a, l]),
    w = React.useMemo(() => getAllOperations(a).slice(0, i ? 40 : 5), [a, i]),
    A = React.useMemo(() => getPhonesInStock(a), [a]),
    L = React.useMemo(
      () => getAccountBalances(a).reduce((f, C) => f + C.balance, 0),
      [a],
    ),
    O = percentChange(d.revenue, x == null ? void 0 : x.revenue),
    m = percentChange(d.netProfit, x == null ? void 0 : x.netProfit);
  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <p className="text-[13px] font-semibold text-ink-900">{l.label}</p>
          <p className="truncate text-[11.5px] text-ink-400">
            {formatShortDate(l.from)}
            {" — "}
            {formatShortDate(l.to)}
          </p>
        </div>
        <SegmentedTabs
          options={PERIOD_OPTIONS}
          value={c}
          onChange={r}
          fullWidth={!0}
          className="sm:w-auto"
        />
      </div>
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Выручка"
          value={formatMoney(d.revenue)}
          icon={<TrendingUp className="h-[18px] w-[18px]" />}
          tone="blue"
          delta={O}
          hint={
            d.accRevenue > 0
              ? `${d.salesCount} ${plural(d.salesCount, "продажа", "продажи", "продаж")} · аксессуары ${formatMoney(d.accRevenue)}`
              : `${d.salesCount} ${plural(d.salesCount, "продажа", "продажи", "продаж")}`
          }
        />
        <StatCard
          label="Чистая прибыль"
          value={formatMoney(d.netProfit)}
          icon={<Banknote className="h-[18px] w-[18px]" />}
          tone={d.netProfit >= 0 ? "green" : "red"}
          valueClassName={
            d.netProfit >= 0 ? "text-emerald-600" : "text-red-500"
          }
          delta={m}
          hint={`маржа ${d.averageMargin}%`}
        />
        <StatCard
          label="Телефоны на складе"
          value={`${A.length} шт`}
          icon={<Package className="h-[18px] w-[18px]" />}
          tone="violet"
          hint={
            getAccessoryStockValue(a) > 0
              ? `на ${formatCompactMoney(getStockValue(a))} · + аксессуары ${formatCompactMoney(getAccessoryStockValue(a))}`
              : `на ${formatCompactMoney(getStockValue(a))}`
          }
          onClick={() => s("purchase")}
        />
        <StatCard
          label="Деньги в кассе"
          value={formatMoney(L)}
          icon={<Wallet className="h-[18px] w-[18px]" />}
          tone="emerald"
          hint={`${a.accounts.length} ${plural(a.accounts.length, "счёт", "счёта", "счетов")}`}
          onClick={() => s("finance")}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-900">
                Доходы и расходы
              </h2>
              <p className="mt-0.5 text-[12.5px] text-ink-500">
                {c === "day"
                  ? "Продажи и расходы за сегодня"
                  : `Динамика: ${l.label.toLowerCase()}`}
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11.5px] font-medium text-ink-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {" Доходы"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                {" Расходы"}
              </span>
            </div>
          </div>
          <IncomeExpenseChart data={v} height={230} />
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:gap-4">
          <button
            onClick={t}
            className="flex min-h-[76px] items-center gap-3 rounded-2xl bg-brand-600 p-3.5 text-left text-white shadow-card transition-transform hover:-translate-y-0.5 active:scale-[.98] lg:min-h-[104px] lg:flex-col lg:items-start lg:justify-between lg:self-start lg:p-4"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Plus className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight lg:text-[14px]">
                Оформить скупку
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-white/70">
                Телефон на склад, деньги −
              </span>
            </span>
          </button>
          <button
            onClick={n}
            className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-emerald-100 bg-white p-3.5 text-left shadow-card transition-transform hover:-translate-y-0.5 active:scale-[.98] lg:min-h-[104px] lg:flex-col lg:items-start lg:justify-between lg:self-start lg:p-4"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight text-ink-900 lg:text-[14px]">
                Оформить продажу
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                Деньги +, прибыль сразу
              </span>
            </span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <div className="card-pad pb-2">
            <CardHeader title="Топ моделей" subtitle={l.label.toLowerCase()} />
          </div>
          {p.length === 0 ? (
            <EmptyState
              icon={<Smartphone className="h-5 w-5" />}
              title="Пока нет продаж"
              description="Оформите первую продажу, чтобы увидеть популярные модели"
            />
          ) : (
            <div className="space-y-1 px-2 pb-3">
              {p.map((f, C) => {
                var g;
                const S = ((g = p[0]) == null ? void 0 : g.count) || 1;
                return (
                  <div
                    className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50"
                    key={f.model}
                  >
                    <span
                      className={cx(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold",
                        C === 0
                          ? "bg-brand-600 text-white"
                          : C === 1
                            ? "bg-brand-100 text-brand-700"
                            : "bg-slate-100 text-ink-500",
                      )}
                    >
                      {C + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[13px] font-medium text-ink-900">
                          {f.model}
                        </p>
                        <span className="shrink-0 text-[11.5px] text-ink-400">
                          {f.count}
                          {" шт"}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
                          style={{
                            width: `${Math.max(8, (f.count / S) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="w-[72px] shrink-0 text-right">
                      <p className="text-[12.5px] font-semibold tabular-nums text-emerald-600">
                        +{formatAmount(f.profit)}
                        {" ₽"}
                      </p>
                      <p className="text-[10.5px] text-ink-400">
                        {f.margin}% маржа
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between px-4 pb-2 pt-4 sm:px-5">
            <CardHeader
              title="Последние операции"
              subtitle="Закупки, продажи, расходы и переводы"
            />
            <button
              onClick={() => o((f) => !f)}
              className="-mr-2 flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold text-brand-600 hover:text-brand-700 active:bg-brand-50"
              aria-expanded={i}
            >
              {i ? "Свернуть" : "История"}
              <ChevronRight
                className={cx("h-4 w-4 transition-transform", i && "rotate-90")}
              />
            </button>
          </div>
          {w.length === 0 ? (
            <EmptyState
              icon={<Banknote className="h-5 w-5" />}
              title="Операций пока нет"
              description="Начните с оформления скупки телефона"
            />
          ) : (
            <div className="stagger divide-y divide-slate-100">
              {w.map((f) => (
                <div
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/70 sm:px-5"
                  key={f.id}
                >
                  <span
                    className={cx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      f.moneyEffect > 0
                        ? "bg-emerald-50 text-emerald-600"
                        : f.moneyEffect < 0
                          ? "bg-red-50 text-red-500"
                          : "bg-brand-50 text-brand-600",
                    )}
                  >
                    {f.moneyEffect > 0 ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : f.moneyEffect < 0 ? (
                      <ArrowDownRight className="h-4 w-4" />
                    ) : (
                      <TrendingUp className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink-900">
                      {f.title}
                    </p>
                    <p className="truncate text-[11.5px] text-ink-400">
                      {formatShortDate(f.date)}
                      {" · "}
                      {f.subtitle}
                    </p>
                  </div>
                  <span
                    className={cx(
                      "shrink-0 text-[13px] font-semibold tabular-nums",
                      f.moneyEffect > 0
                        ? "text-emerald-600"
                        : f.moneyEffect < 0
                          ? "text-red-500"
                          : "text-ink-500",
                    )}
                  >
                    {f.moneyEffect === 0
                      ? formatMoney(f.amount)
                      : `${f.moneyEffect > 0 ? "+" : "−"}${formatAmount(Math.abs(f.moneyEffect))} ₽`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-[12.5px] shadow-card">
        <span className="text-ink-500">
          {"Валовая прибыль "}
          <b
            className={cx(
              "tabular-nums",
              d.grossProfit >= 0 ? "text-emerald-600" : "text-red-500",
            )}
          >
            {formatMoney(d.grossProfit)}
          </b>
        </span>
        <span className="text-ink-500">
          {"Расходы "}
          <b className="tabular-nums text-red-500">
            −{formatAmount(d.opex)}
            {" ₽"}
          </b>
        </span>
        <span className="hidden text-ink-500 sm:inline">
          {"Закуплено "}
          <b className="tabular-nums text-red-500">
            −{formatAmount(d.purchases)}
            {" ₽"}
          </b>
        </span>
        {d.accProfit > 0 && (
          <span className="text-ink-500">
            {"Аксессуары "}
            <b className="tabular-nums text-emerald-600">
              +{formatAmount(d.accProfit)}
              {" ₽"}
            </b>
          </span>
        )}
        {d.writeOff > 0 && (
          <span className="text-ink-500">
            {"Списания "}
            <b className="tabular-nums text-red-500">
              −{formatAmount(d.writeOff)}
              {" ₽"}
            </b>
          </span>
        )}
        <span className="ml-auto hidden text-[11.5px] text-ink-400 lg:inline">
          Прибыль ≠ деньги в кассе — это разные вещи
        </span>
      </div>
    </div>
  );
}
