/**
 * История операций.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import {
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Input,
  SearchInput,
  cx,
} from "../components/ui.jsx";
import { useStore } from "../hooks/useStore.jsx";
import {
  addDays,
  formatAmount,
  formatCompactMoney,
  formatDate,
  formatMoney,
  plural,
  toISODate,
  today,
} from "../utils/format.js";
import { getAllOperations } from "../utils/operations.js";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  Filter,
  History,
  Package,
  Receipt,
  ShoppingBag,
  TrendingUp,
  X,
} from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export const HISTORY_FILTERS = [
    {
      id: "all",
      label: "Все",
    },
    {
      id: "purchase",
      label: "Закупки",
    },
    {
      id: "sale",
      label: "Продажи",
    },
    {
      id: "expense",
      label: "Расходы",
    },
    {
      id: "transfer",
      label: "Переводы",
    },
    {
      id: "deposit",
      label: "Пополнения",
    },
    {
      id: "acc",
      label: "Аксессуары",
    },
  ],
  HISTORY_ICONS = {
    phone: ShoppingBag,
    package: Package,
    sale: TrendingUp,
    expense: Receipt,
    transfer: ArrowLeftRight,
    deposit: ArrowDownLeft,
    withdrawal: ArrowUpRight,
    refund: ArrowUpRight,
  };
export function getHistoryIcon(s) {
  return s.type === "withdrawal"
    ? ArrowUpRight
    : s.type === "deposit"
      ? ArrowDownLeft
      : (HISTORY_ICONS[s.icon] ?? Receipt);
}
export function HistoryPage() {
  const { data: s } = useStore(),
    t = React.useMemo(() => getAllOperations(s), [s]),
    [n, a] = React.useState("all"),
    [c, r] = React.useState(""),
    [i, o] = React.useState("30"),
    [l, d] = React.useState(toISODate(addDays(new Date(), -29))),
    [x, v] = React.useState(today()),
    [p, w] = React.useState(!1),
    [A, L] = React.useState(40),
    O = React.useMemo(() => {
      const g = new Date();
      return i === "7"
        ? {
            from: toISODate(addDays(g, -6)),
            to: today(),
          }
        : i === "30"
          ? {
              from: toISODate(addDays(g, -29)),
              to: today(),
            }
          : i === "all"
            ? {
                from: "2000-01-01",
                to: "2100-01-01",
              }
            : {
                from: l,
                to: x,
              };
    }, [i, l, x]),
    m = React.useMemo(() => {
      const g = c.trim().toLowerCase();
      return t
        .filter((b) =>
          n === "all"
            ? !0
            : n === "deposit"
              ? b.type === "deposit" || b.type === "withdrawal"
              : n === "acc"
                ? b.kind === "acc_batch" || b.kind === "acc_sale"
                : n === "purchase"
                  ? b.type === "purchase" || b.type === "acc_purchase"
                  : n === "sale"
                    ? b.type === "sale" || b.type === "acc_sale"
                    : n === "expense"
                      ? b.type === "expense" || b.type === "acc_writeoff"
                      : b.type === n,
        )
        .filter((b) => b.date >= O.from && b.date <= O.to)
        .filter((b) => {
          var B, y;
          return g
            ? b.title.toLowerCase().includes(g) ||
                b.subtitle.toLowerCase().includes(g) ||
                String(((B = b.meta) == null ? void 0 : B.account) ?? "")
                  .toLowerCase()
                  .includes(g) ||
                String(((y = b.meta) == null ? void 0 : y.phoneId) ?? "")
                  .toLowerCase()
                  .includes(g)
            : !0;
        });
    }, [t, n, O, c]),
    f = React.useMemo(() => {
      let g = 0,
        b = 0;
      for (const B of m)
        B.type !== "transfer" &&
          (B.moneyEffect > 0 && (g += B.moneyEffect),
          B.moneyEffect < 0 && (b += -B.moneyEffect));
      return {
        income: g,
        outcome: b,
      };
    }, [m]),
    C = React.useMemo(() => {
      const g = new Map();
      for (const b of m) {
        const B = g.get(b.date) ?? [];
        (B.push(b), g.set(b.date, B));
      }
      return Array.from(g.entries()).sort((b, B) => B[0].localeCompare(b[0]));
    }, [m]);
  let S = 0;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-emerald-50/70 px-3 py-2">
            <p className="text-[11px] text-emerald-700">Приход</p>
            <p className="text-[14px] font-bold tabular-nums leading-tight text-emerald-600">
              +{formatCompactMoney(f.income)}
            </p>
          </div>
          <div className="rounded-xl bg-red-50/70 px-3 py-2">
            <p className="text-[11px] text-red-600">Расход</p>
            <p className="text-[14px] font-bold tabular-nums leading-tight text-red-500">
              −{formatCompactMoney(f.outcome)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-100/70 px-3 py-2">
            <p className="text-[11px] text-ink-500">Операций</p>
            <p className="text-[14.5px] font-bold tabular-nums text-ink-900">
              {m.length}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-400">
          Переводы между счетами не входят в приход и расход
        </p>
      </Card>
      <Card>
        <div className="card-pad pb-3">
          <CardHeader
            title="История операций"
            subtitle={`${m.length} ${plural(m.length, "запись", "записи", "записей")} за период`}
            action={
              <button
                onClick={() => w((g) => !g)}
                className={cx(
                  "flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-medium transition-colors",
                  p || i === "custom"
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-ink-600",
                )}
              >
                <Filter className="h-4 w-4" />
                {" Даты"}
              </button>
            }
          />
          <div className="mt-3">
            <SearchInput
              value={c}
              onChange={r}
              placeholder="Поиск по операциям"
            />
          </div>
          {p && (
            <div className="mt-3 space-y-2.5 rounded-xl bg-slate-50 p-3 animate-fade-in">
              <div className="flex flex-wrap gap-1.5">
                {[
                  {
                    id: "7",
                    label: "7 дней",
                  },
                  {
                    id: "30",
                    label: "30 дней",
                  },
                  {
                    id: "all",
                    label: "Всё время",
                  },
                  {
                    id: "custom",
                    label: "Свой период",
                  },
                ].map((g) => (
                  <button
                    onClick={() => o(g.id)}
                    className={cx(
                      "h-9 rounded-lg px-3 text-[12px] font-medium transition-colors",
                      i === g.id
                        ? "chip-active"
                        : "bg-white text-ink-600 ring-1 ring-slate-200",
                    )}
                    key={g.id}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              {i === "custom" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-ink-500">
                      С
                    </span>
                    <Input
                      type="date"
                      value={l}
                      onChange={(g) => d(g.target.value)}
                      className="h-10"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-ink-500">
                      По
                    </span>
                    <Input
                      type="date"
                      value={x}
                      onChange={(g) => v(g.target.value)}
                      className="h-10"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
            {HISTORY_FILTERS.map((g) => (
              <button
                onClick={() => a(g.id)}
                className={cx(
                  "h-9 shrink-0 rounded-full px-3.5 text-[12.5px] font-medium transition-colors",
                  n === g.id
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-ink-600 active:bg-slate-200",
                )}
                key={g.id}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {m.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title="Операций не найдено"
            description="Измените фильтры или период — здесь собираются закупки, продажи, расходы, переводы и пополнения"
            action={
              (n !== "all" || c) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    (a("all"), r(""), o("all"));
                  }}
                >
                  <X className="h-4 w-4" />
                  {" Сбросить фильтры"}
                </Button>
              )
            }
          />
        ) : (
          <div>
            {C.map(([g, b]) => {
              if (S >= A) return null;
              const B = b.slice(0, Math.max(0, A - S));
              return (
                (S += B.length),
                (
                  <div key={g}>
                    <div className="sticky top-0 z-10 flex items-center justify-between border-y border-slate-100 bg-slate-50/95 px-4 py-1.5 backdrop-blur sm:px-5">
                      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-500">
                        <CalendarDays className="h-3.5 w-3.5" /> {formatDate(g)}
                      </span>
                      <span className="text-[11px] text-ink-400">
                        {b.length}{" "}
                        {plural(b.length, "операция", "операции", "операций")}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {B.map((y) => {
                        const j = getHistoryIcon(y);
                        return (
                          <div
                            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/60 sm:px-5"
                            key={y.id}
                          >
                            <span
                              className={cx(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                                y.type === "transfer"
                                  ? "bg-brand-50 text-brand-600"
                                  : y.moneyEffect > 0
                                    ? "bg-emerald-50 text-emerald-600"
                                    : y.moneyEffect < 0
                                      ? "bg-red-50 text-red-500"
                                      : "bg-slate-100 text-ink-500",
                              )}
                            >
                              {jsx(j, {
                                className: "h-4 w-4",
                              })}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-ink-900">
                                {y.title}
                              </p>
                              <p className="truncate text-[11px] text-ink-400">
                                {y.subtitle}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p
                                className={cx(
                                  "text-[13px] font-semibold tabular-nums",
                                  y.status === "cancelled"
                                    ? "text-ink-300 line-through"
                                    : y.type === "transfer"
                                      ? "text-ink-700"
                                      : y.moneyEffect > 0
                                        ? "text-emerald-600"
                                        : "text-red-500",
                                )}
                              >
                                {y.status === "cancelled"
                                  ? `${formatAmount(y.amount)} ₽`
                                  : y.type === "transfer"
                                    ? formatMoney(y.amount)
                                    : `${y.moneyEffect > 0 ? "+" : "−"}${formatAmount(Math.abs(y.moneyEffect))} ₽`}
                              </p>
                              {y.status === "cancelled" && (
                                <Chip tone="neutral">Отменена</Chip>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              );
            })}
            {m.length > A && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button variant="secondary" onClick={() => L((g) => g + 40)}>
                  Показать ещё ({m.length - A})
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
