/**
 * Продажи.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { WarehouseActivity } from "../components/WarehouseActivity.jsx";
import { SaleForm } from "../components/sales/SaleForm.jsx";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  EmptyState,
  SearchInput,
  SegmentedTabs,
  cx,
} from "../components/ui.jsx";
import {
  cancelAccessorySale,
  getAccessorySaleTotals,
} from "../domain/accessories.js";
import { cancelSale, restoreSale } from "../domain/sales.js";
import { useStore } from "../hooks/useStore.jsx";
import { Metrics, PeriodSelect } from "../product/ui.jsx";
import {
  getSaleMargin,
  getSaleProfit,
  getSaleRevenue,
  getStats,
} from "../utils/calculations.js";
import { PAYMENT_METHODS } from "../utils/constants.js";
import {
  formatAmount,
  formatDate,
  formatMoney,
  formatPreciseMoney,
  plural,
  getPeriod,
  inPeriod,
} from "../utils/format.js";
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Coins,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  TrendingUp,
  Undo2,
  X,
} from "lucide-react";
import React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export function SalesPage({
  formOpen: s,
  onOpenForm: t,
  onCloseForm: n,
  presetPhoneId: a,
  onOpenWarehouse,
}) {
  const { data: c, mutate: r, notify: i } = useStore(),
    [period, setPeriod] = React.useState("all"),
    range = React.useMemo(() => getPeriod(period), [period]),
    stats = React.useMemo(() => getStats(c, range), [c, range]),
    [o, l] = React.useState(""),
    [d, x] = React.useState("completed"),
    [v, p] = React.useState(null),
    [w, A] = React.useState(null),
    [L, O] = React.useState(null),
    [m, f] = React.useState(20),
    accessorySales = React.useMemo(() => c.accessorySales.filter(sale =>
      (d === "all" || sale.status === d) && inPeriod(sale.date, range) &&
      [sale.buyerName, ...sale.items.map(item => item.name)].join(" ").toLocaleLowerCase("ru").includes(o.trim().toLocaleLowerCase("ru"))),
      [c.accessorySales, range, d, o]),
    C = React.useMemo(
      () => new Map(c.phones.map((u) => [u.id, u])),
      [c.phones],
    ),
    S = React.useMemo(() => {
      const u = o.trim().toLowerCase();
      return [...c.sales]
        .filter((N) => (d === "all" || N.status === d) && inPeriod(N.date, range))
        .filter((N) => {
          if (!u) return !0;
          const E = C.get(N.phoneId);
          return (
            ((E == null ? void 0 : E.model.toLowerCase().includes(u)) ?? !1) ||
            ((E == null
              ? void 0
              : E.imei.includes(u.replace(/\D/g, "") || "§")) ??
              !1) ||
            N.buyerName.toLowerCase().includes(u) ||
            N.buyerPhone
              .replace(/\D/g, "")
              .includes(u.replace(/\D/g, "") || "§")
          );
        })
        .sort((N, E) =>
          N.date === E.date
            ? E.createdAt.localeCompare(N.createdAt)
            : E.date.localeCompare(N.date),
        );
    }, [c.sales, d, o, C, range]),
    B = () => {
      if (!w) return;
      (r((N) => cancelSale(N, w.id)).ok &&
        i({
          title: "Продажа отменена",
          description: "Телефон вернулся на склад, деньги списаны со счёта",
          tone: "info",
        }),
        A(null));
    },
    y = () => {
      if (!L) return;
      r((N) => cancelAccessorySale(N, L.id)).ok &&
        (i({
          title: "Продажа аксессуаров отменена",
          description: "Остатки возвращены на склад, деньги списаны со счёта",
          tone: "info",
        }),
        O(null));
    },
    j = (u) => {
      r((E) => restoreSale(E, u.id)).ok &&
        i({
          title: "Продажа восстановлена",
          description: "Телефон снова продан",
          tone: "success",
        });
    };
  return (
    <div className="space-y-4">

      <div className="pb-actions pb-sales-toolbar">
        <PeriodSelect value={period} onChange={setPeriod} />
        <Button icon={<Plus className="h-4 w-4" />} onClick={t}>Продажа</Button>
      </div>
      <Metrics items={[
        { label: "Продажи", value: stats.salesCount, Icon: TrendingUp },
        { label: "Выручка", value: formatPreciseMoney(stats.revenue), Icon: Coins },
        { label: "Валовая прибыль", value: formatPreciseMoney(stats.grossProfit), Icon: ChartNoAxesCombined },
      ]} />
      {s && (
        <Card className="border-emerald-200 p-4 sm:p-5 animate-fade-up">
          <CardHeader
            title="Новая продажа"
            subtitle="Выберите телефон со склада — прибыль рассчитается сама"
            className="mb-4"
          />
          <SaleForm presetPhoneId={a} onDone={n} onCancel={n} />
        </Card>
      )}
      {v && (
        <Card className="border-brand-200 p-4 sm:p-5 animate-fade-up">
          <CardHeader
            title="Редактирование продажи"
            subtitle="Изменения пересчитают прибыль и остаток счёта"
            className="mb-4"
          />
          <SaleForm sale={v} onDone={() => p(null)} onCancel={() => p(null)} />
        </Card>
      )}
      <Card>
        <div className="card-pad pb-3">
          <CardHeader
            title="Продажи"
            subtitle={`${S.length} ${plural(S.length, "запись", "записи", "записей")}`}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={o}
              onChange={l}
              placeholder="Модель, IMEI или покупатель"
              className="flex-1"
            />
            <SegmentedTabs
              options={[
                {
                  value: "completed",
                  label: "Проведённые",
                },
                {
                  value: "cancelled",
                  label: "Отменённые",
                },
                {
                  value: "all",
                  label: "Все",
                },
              ]}
              value={d}
              onChange={x}
              fullWidth={!0}
              className="sm:w-auto"
            />
          </div>
        </div>
        {S.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="h-5 w-5" />}
            title={
              o
                ? "Ничего не найдено"
                : d === "cancelled"
                  ? "Отменённых продаж нет"
                  : "Продаж пока нет"
            }
            description={
              o
                ? "Попробуйте другой запрос"
                : "Оформите продажу — телефон уйдёт со склада, деньги придут на счёт"
            }
            action={
              !o && d !== "cancelled" ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={t}>
                  Оформить продажу
                </Button>
              ) : (
                void 0
              )
            }
          />
        ) : (
          <Fragment>
            <div className="hidden lg:block">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-y border-slate-100 bg-slate-50/60 text-[11.5px] uppercase tracking-wide text-ink-400">
                    <th className="px-5 py-2.5 font-medium">Устройство</th>
                    <th className="px-3 py-2.5 font-medium">Покупатель</th>
                    <th className="px-3 py-2.5 font-medium">Дата</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      Сумма
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      Прибыль
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody className="stagger divide-y divide-slate-50">
                  {S.slice(0, m).map((u) => {
                    const N = C.get(u.phoneId),
                      E = getSaleProfit(u, c.phones),
                      R = getSaleMargin(u, c.phones),
                      M = u.status === "cancelled";
                    return (
                      <tr
                        className={cx(
                          "group transition-colors hover:bg-slate-50/60",
                          M && "opacity-60",
                        )}
                        key={u.id}
                      >
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink-900">
                            {(N == null ? void 0 : N.model) ?? "Удалён"}{" "}
                            <span className="font-normal text-ink-400">
                              {"· "}
                              {N == null ? void 0 : N.storage}
                            </span>
                          </p>
                          <p className="text-[11px] text-ink-400">
                            {N != null && N.imei
                              ? `IMEI ${N.imei}`
                              : "без IMEI"}
                            {" · "}
                            {PAYMENT_METHODS[u.paymentMethod]}
                            {M && " · отменена"}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-ink-700">{u.buyerName}</p>
                          <p className="text-[11px] text-ink-400">
                            {u.buyerPhone || "—"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-ink-500">
                          {formatDate(u.date)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <p
                            className={cx(
                              "font-semibold tabular-nums",
                              M
                                ? "text-ink-400 line-through"
                                : "text-emerald-600",
                            )}
                          >
                            +{formatAmount(getSaleRevenue(u))}
                            {" ₽"}
                          </p>
                          {u.discount > 0 && (
                            <p className="text-[10.5px] text-ink-400">
                              {"скидка "}
                              {formatAmount(u.discount)}
                              {" ₽"}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          {M ? (
                            <Chip tone="neutral">Отменена</Chip>
                          ) : (
                            <Fragment>
                              <p
                                className={cx(
                                  "font-semibold tabular-nums",
                                  E >= 0 ? "text-emerald-600" : "text-red-500",
                                )}
                              >
                                {E >= 0 ? "+" : ""}
                                {formatAmount(E)}
                                {" ₽"}
                              </p>
                              <p className="text-[10.5px] text-ink-400">{R}%</p>
                            </Fragment>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                            {M ? (
                              <button
                                onClick={() => j(u)}
                                className="btn-icon flex items-center justify-center text-ink-400 hover:bg-emerald-50 hover:text-emerald-600"
                                aria-label="Восстановить"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            ) : (
                              <Fragment>
                                <button
                                  onClick={() => p(u)}
                                  className="btn-icon flex items-center justify-center text-ink-400 hover:bg-brand-50 hover:text-brand-600"
                                  aria-label="Редактировать"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => A(u)}
                                  className="btn-icon flex items-center justify-center text-ink-400 hover:bg-red-50 hover:text-red-500"
                                  aria-label="Отменить продажу"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </Fragment>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="stagger space-y-2 p-3 lg:hidden">
              {S.slice(0, m).map((u) => {
                const N = C.get(u.phoneId),
                  E = getSaleProfit(u, c.phones),
                  R = u.status === "cancelled";
                return (
                  <div
                    className={cx(
                      "rounded-xl border border-slate-100 bg-white p-3",
                      R && "opacity-70",
                    )}
                    key={u.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-ink-900">
                          {(N == null ? void 0 : N.model) ?? "Удалён"}
                          {" · "}
                          {N == null ? void 0 : N.storage}
                        </p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
                          {u.buyerName}
                          {" · "}
                          {formatDate(u.date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={cx(
                            "text-[14px] font-bold tabular-nums",
                            R
                              ? "text-ink-400 line-through"
                              : "text-emerald-600",
                          )}
                        >
                          +{formatAmount(getSaleRevenue(u))}
                          {" ₽"}
                        </p>
                        {!R && (
                          <p
                            className={cx(
                              "text-[11px] font-medium tabular-nums",
                              E >= 0 ? "text-emerald-600" : "text-red-500",
                            )}
                          >
                            {E >= 0 ? "+" : ""}
                            {formatAmount(E)}
                            {" ₽ прибыль"}
                          </p>
                        )}
                      </div>
                    </div>
                    {R ? (
                      <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2">
                        <Chip tone="neutral">Отменена</Chip>
                        <button
                          onClick={() => j(u)}
                          className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-50 px-3 text-[12px] font-medium text-ink-600 active:bg-slate-100"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {" Восстановить"}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2">
                        <span className="flex items-center gap-1 text-[11px] text-ink-400">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {PAYMENT_METHODS[u.paymentMethod]}
                          {u.discount > 0 &&
                            ` · скидка ${formatAmount(u.discount)} ₽`}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => p(u)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 active:bg-slate-100"
                            aria-label="Редактировать"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => A(u)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 active:bg-red-50"
                            aria-label="Отменить"
                          >
                            <Undo2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {S.length > m && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button variant="secondary" onClick={() => f((u) => u + 30)}>
                  {"Показать ещё (осталось "}
                  {S.length - m})
                </Button>
              </div>
            )}
          </Fragment>
        )}
      </Card>
      {d !== "cancelled" && <WarehouseActivity range={range} query={o} onOpen={onOpenWarehouse} />}
      {accessorySales.length > 0 && (
        <Card>
          <div className="card-pad pb-3">
            <CardHeader
              title="Продажи аксессуаров"
              subtitle={`${accessorySales.length} ${plural(accessorySales.length, "чек", "чека", "чеков")}`}
            />
          </div>
          <ul className="stagger divide-y divide-slate-50">
            {accessorySales.map((u) => {
              const N = getAccessorySaleTotals(u),
                E = u.status === "cancelled";
              return (
                <li
                  className={cx(
                    "card-pad flex items-start justify-between gap-3 py-3",
                    E && "opacity-60",
                  )}
                  key={u.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink-900">
                      <Package className="mr-1 inline h-3.5 w-3.5 text-ink-400" />
                      {u.items
                        .map((R) =>
                          u.items.length > 1 ? `${R.name} ×${R.qty}` : R.name,
                        )
                        .join(", ")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {u.buyerName || "—"}
                      {" · "}
                      {formatDate(u.date)}
                      {" · "}
                      {PAYMENT_METHODS[u.paymentMethod]}
                      {u.discount > 0 &&
                        ` · скидка ${formatAmount(u.discount)} ₽`}
                      {u.groupId && " · вместе с телефоном"}
                      {E && " · отменена"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <p
                        className={cx(
                          "text-[13.5px] font-bold tabular-nums",
                          E ? "text-ink-400 line-through" : "text-emerald-600",
                        )}
                      >
                        +{formatAmount(N.revenue)}
                        {" ₽"}
                      </p>
                      {!E && (
                        <p
                          className={cx(
                            "text-[11px] tabular-nums",
                            N.profit >= 0 ? "text-emerald-600" : "text-red-500",
                          )}
                        >
                          {N.profit >= 0 ? "+" : ""}
                          {formatAmount(N.profit)}
                          {" ₽ · "}
                          {N.qty}
                          {" шт."}
                        </p>
                      )}
                    </div>
                    {!E && (
                      <button
                        onClick={() => O(u)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 active:bg-red-50"
                        aria-label="Отменить продажу аксессуаров"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <ConfirmDialog
        open={!!L}
        onClose={() => O(null)}
        onConfirm={y}
        title="Отменить продажу аксессуаров?"
        description={
          L
            ? `Товары вернутся на склад, ${formatMoney(getAccessorySaleTotals(L).revenue)} будут списаны со счёта.`
            : void 0
        }
        confirmLabel="Отменить продажу"
      />
      <ConfirmDialog
        open={!!w}
        onClose={() => A(null)}
        onConfirm={B}
        title="Отменить продажу?"
        description={
          w
            ? `Телефон вернётся на склад, ${formatMoney(getSaleRevenue(w))} будут списаны со счёта. Операция сохранится в истории как отменённая, её можно восстановить.`
            : void 0
        }
        confirmLabel="Отменить продажу"
      />
    </div>
  );
}
