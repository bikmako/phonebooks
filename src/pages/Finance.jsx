/**
 * Финансы: счета, расходы, переводы, касса.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { AccountModal } from "../components/finance/AccountModal.jsx";
import { CashOpModal } from "../components/finance/CashOpModal.jsx";
import { ExpenseModal } from "../components/finance/ExpenseModal.jsx";
import {
  ExpenseCategoryIcon,
  QuickFinanceAction,
} from "../components/finance/FinanceParts.jsx";
import { TransferModal } from "../components/finance/TransferModal.jsx";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  EmptyState,
  SegmentedTabs,
  cx,
} from "../components/ui.jsx";
import { getAccessoryStats } from "../domain/accessories.js";
import { setAccountArchived } from "../domain/accounts.js";
import { deleteCashOp } from "../domain/cashOps.js";
import { deleteExpense } from "../domain/expenses.js";
import { deleteTransfer } from "../domain/transfers.js";
import { useStore } from "../hooks/useStore.jsx";
import { getAccountBalances, getStats } from "../utils/calculations.js";
import {
  ACCESSORY_CATEGORY_LABELS,
  EXPENSE_CATEGORY_SHORT,
} from "../utils/constants.js";
import {
  formatAmount,
  formatCompactMoney,
  formatDate,
  formatMoney,
  getPeriod,
  plural,
} from "../utils/format.js";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  Landmark,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export const EXPENSE_PRESETS = [
  {
    category: "rent",
    label: "Аренда",
    amount: 6e4,
  },
  {
    category: "salary",
    label: "Зарплата",
    amount: 95e3,
  },
  {
    category: "repair",
    label: "Ремонт",
    amount: 5e3,
  },
  {
    category: "tax",
    label: "Налоги",
    amount: 18e3,
  },
  {
    category: "marketing",
    label: "Реклама",
    amount: 1e4,
  },
  {
    category: "other",
    label: "Прочее",
    amount: 0,
  },
];
export function FinancePage({ initialTab: s }) {
  const { data: t, mutate: n, notify: a } = useStore(),
    [c, r] = React.useState(s ?? "accounts"),
    [i, o] = React.useState(null),
    [l, d] = React.useState(null),
    [x, v] = React.useState(null),
    [p, w] = React.useState(null),
    [A, L] = React.useState(null),
    [O, m] = React.useState(null),
    [f, C] = React.useState(null),
    [S, g] = React.useState(0),
    b = React.useMemo(() => getAccountBalances(t), [t]),
    B = b.reduce((k, F) => k + F.balance, 0),
    y = React.useMemo(() => getStats(t, getPeriod("month")), [t]),
    j = React.useMemo(() => getAccessoryStats(t, getPeriod("month")), [t]),
    u = React.useMemo(
      () =>
        [...t.expenses].sort((k, F) =>
          k.date === F.date
            ? F.createdAt.localeCompare(k.createdAt)
            : F.date.localeCompare(k.date),
        ),
      [t.expenses],
    ),
    N = React.useMemo(() => {
      const k = new Map();
      for (const F of u) {
        const le = k.get(F.category) ?? {
          total: 0,
          items: [],
        };
        ((le.total += F.amount), le.items.push(F), k.set(F.category, le));
      }
      return Array.from(k.entries())
        .map(([F, le]) => ({
          category: F,
          ...le,
        }))
        .sort((F, le) => le.total - F.total);
    }, [u]),
    E = React.useMemo(() => u.reduce((k, F) => k + F.amount, 0), [u]),
    [R, M] = React.useState({}),
    G = React.useMemo(
      () =>
        [...t.transfers].sort((k, F) =>
          k.date === F.date
            ? F.createdAt.localeCompare(k.createdAt)
            : F.date.localeCompare(k.date),
        ),
      [t.transfers],
    ),
    ee = React.useMemo(
      () =>
        [...t.cashOps].sort((k, F) =>
          k.date === F.date
            ? F.createdAt.localeCompare(k.createdAt)
            : F.date.localeCompare(k.date),
        ),
      [t.cashOps],
    ),
    W = (k, F = 0) => {
      (d(null), m(k ?? null), g(F), o("expense"));
    },
    ie = () => {
      (v(null), o("transfer"));
    },
    Q = (k) => {
      (w(k ?? null), o("cash"));
    },
    V = (k) => {
      (L(k ?? null), o("account"));
    },
    _ = () => {
      f &&
        (f.kind === "expense"
          ? n((F) => deleteExpense(F, f.id)).ok &&
            a({
              title: "Расход удалён",
              description: "Деньги вернулись на счёт",
              tone: "info",
            })
          : f.kind === "transfer"
            ? n((F) => deleteTransfer(F, f.id)).ok &&
              a({
                title: "Перевод удалён",
                description: "Остатки счетов пересчитаны",
                tone: "info",
              })
            : n((F) => deleteCashOp(F, f.id)).ok &&
              a({
                title: "Операция удалена",
                description: "Остаток счёта пересчитан",
                tone: "info",
              }),
        C(null));
    };
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-4 py-4 text-white sm:px-5">
          <p className="text-[11.5px] font-medium text-white/60">Всего денег</p>
          <p className="mt-1 text-[26px] font-bold tabular-nums leading-tight">
            {formatMoney(B)}
          </p>
          <div className="mt-2 flex gap-4 text-[11.5px] text-white/70">
            <span>
              {"Приход "}
              <b className="text-emerald-300">
                +{formatCompactMoney(y.revenue + y.deposits)}
              </b>
            </span>
            <span>
              {"Расход "}
              <b className="text-red-200">
                −
                {formatCompactMoney(
                  y.purchases + y.accPurchases + y.opex + y.withdrawals,
                )}
              </b>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
          <QuickFinanceAction
            icon={<Receipt className="h-4 w-4" />}
            label="Расход"
            onClick={() => W()}
          />
          <QuickFinanceAction
            icon={<ArrowLeftRight className="h-4 w-4" />}
            label="Перевод"
            onClick={ie}
          />
          <QuickFinanceAction
            icon={<ArrowDownLeft className="h-4 w-4" />}
            label="Пополнить"
            onClick={() => {
              (w(null), o("cash"));
            }}
          />
          <QuickFinanceAction
            icon={<Plus className="h-4 w-4" />}
            label="Новый счёт"
            onClick={() => V()}
          />
        </div>
      </Card>
      {(t.accessoryItems.length > 0 || y.accSalesCount > 0) && (
        <Card className="card-pad">
          <p className="text-[12px] font-semibold text-ink-500">
            Аксессуары · за месяц
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
            <span className="text-ink-500">
              {"Выручка "}
              <b className="tabular-nums text-ink-900">
                {formatMoney(y.accRevenue)}
              </b>
            </span>
            <span className="text-ink-500">
              {"Себестоимость "}
              <b className="tabular-nums text-ink-900">
                {formatMoney(y.accCogs)}
              </b>
            </span>
            <span className="text-ink-500">
              {"Прибыль "}
              <b
                className={cx(
                  "tabular-nums",
                  y.accProfit >= 0 ? "text-emerald-600" : "text-red-500",
                )}
              >
                {formatMoney(y.accProfit)}
              </b>
            </span>
            <span className="text-ink-500">
              {"Продано "}
              <b className="tabular-nums text-ink-900">
                {y.accSoldQty}
                {" шт."}
              </b>
            </span>
          </div>
          {(Object.keys(j.byCategory).length > 0 || y.writeOff > 0) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {Object.entries(j.byCategory).map(([k, F]) => (
                <Chip tone={F.profit >= 0 ? "success" : "danger"} key={k}>
                  {ACCESSORY_CATEGORY_LABELS[k] ?? k}
                  {": "}
                  {F.qty}
                  {" шт. · "}
                  {F.profit >= 0 ? "+" : ""}
                  {formatAmount(F.profit)}
                  {" ₽"}
                </Chip>
              ))}
              {y.writeOff > 0 && (
                <Chip tone="danger">
                  Списания −{formatAmount(y.writeOff)}
                  {" ₽"}
                </Chip>
              )}
            </div>
          )}
        </Card>
      )}
      <SegmentedTabs
        fullWidth={!0}
        options={[
          {
            value: "accounts",
            label: "Счета",
          },
          {
            value: "expenses",
            label: "Расходы",
          },
          {
            value: "transfers",
            label: "Переводы",
          },
          {
            value: "cash",
            label: "Касса",
          },
        ]}
        value={c}
        onChange={r}
      />
      {c === "accounts" && (
        <div className="space-y-3">
          <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {b.map(({ account: k, balance: F, inflow: le, outflow: X }) => (
              <div
                className={cx(
                  "relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card transition-shadow hover:shadow-lg",
                  k.archived && "opacity-60",
                )}
                key={k.id}
              >
                <div
                  className="absolute right-0 top-0 h-16 w-16 -translate-y-6 translate-x-6 rounded-full"
                  style={{
                    background: `${k.color}18`,
                  }}
                />
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                      style={{
                        background: k.color,
                      }}
                    >
                      {k.type === "cash" ? (
                        <Wallet className="h-4.5 w-4.5" />
                      ) : (
                        <Landmark className="h-[18px] w-[18px]" />
                      )}
                    </span>
                    <div>
                      <p className="text-[13.5px] font-semibold text-ink-900">
                        {k.name}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {k.type === "cash"
                          ? "Наличная касса"
                          : "Банковский счёт"}
                      </p>
                    </div>
                  </div>
                  {k.archived && <Chip tone="neutral">Архив</Chip>}
                </div>
                <p className="mt-3 text-[22px] font-bold tabular-nums leading-tight text-ink-900">
                  {formatMoney(F)}
                </p>
                <div className="mt-2 flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-0.5 text-emerald-600">
                    <ArrowDownLeft className="h-3 w-3" />
                    {" +"}
                    {formatAmount(le)}
                  </span>
                  <span className="flex items-center gap-0.5 text-red-500">
                    <ArrowUpRight className="h-3 w-3" />
                    {" −"}
                    {formatAmount(X)}
                  </span>
                </div>
                <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-2.5">
                  <button
                    onClick={() => V(k)}
                    className="flex h-11 flex-1 items-center justify-center gap-1 rounded-lg text-[11.5px] font-medium text-ink-500 active:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {" Изменить"}
                  </button>
                  <button
                    onClick={() => {
                      n((we) => setAccountArchived(we, k.id, !k.archived)).ok &&
                        a({
                          title: k.archived
                            ? "Счёт возвращён"
                            : "Счёт в архиве",
                          tone: "info",
                        });
                    }}
                    className="flex h-11 flex-1 items-center justify-center gap-1 rounded-lg text-[11.5px] font-medium text-ink-500 active:bg-slate-50"
                  >
                    {k.archived ? "Вернуть" : "В архив"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {c === "expenses" && (
        <Card>
          <div className="card-pad pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-ink-900">Расходы</h3>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {u.length > 0
                    ? `${formatAmount(E)} ₽ · ${u.length} ${plural(u.length, "запись", "записи", "записей")}`
                    : "аренда, зарплаты, налоги"}
                </p>
              </div>
              <Button
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => W()}
              >
                Расход
              </Button>
            </div>
            <div className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
              {EXPENSE_PRESETS.map((k) => (
                <button
                  onClick={() => W(k.category, k.amount)}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-[12px] font-medium text-ink-600 active:bg-slate-200"
                  key={k.category}
                >
                  <ExpenseCategoryIcon
                    category={k.category}
                    className="h-3.5 w-3.5"
                  />{" "}
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          {u.length === 0 ? (
            <EmptyState
              icon={<Receipt className="h-5 w-5" />}
              title="Расходов пока нет"
              description="Добавьте аренду, зарплату или другой расход"
            />
          ) : (
            <div className="border-t border-slate-100">
              {N.map((k) => {
                const F = R[k.category] ?? !0,
                  le = E > 0 ? Math.round((k.total / E) * 100) : 0;
                return (
                  <div
                    className="border-b border-slate-100 last:border-0"
                    key={k.category}
                  >
                    <button
                      onClick={() =>
                        M((X) => ({
                          ...X,
                          [k.category]: !F,
                        }))
                      }
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-50 sm:px-5"
                      aria-expanded={F}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-ink-500">
                        <ExpenseCategoryIcon
                          category={k.category}
                          className="h-4 w-4"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[13.5px] font-semibold text-ink-900">
                            {EXPENSE_CATEGORY_SHORT[k.category]}
                          </span>
                          <span className="shrink-0 text-[13.5px] font-bold tabular-nums text-red-500">
                            −{formatAmount(k.total)}
                            {" ₽"}
                          </span>
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-slate-100">
                            <span
                              className="block h-full rounded-full bg-red-300"
                              style={{
                                width: `${Math.max(4, le)}%`,
                              }}
                            />
                          </span>
                          <span className="text-[11px] text-ink-400">
                            {le}
                            {"% · "}
                            {k.items.length}{" "}
                            {plural(
                              k.items.length,
                              "операция",
                              "операции",
                              "операций",
                            )}
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        className={cx(
                          "h-4 w-4 shrink-0 text-ink-400 transition-transform",
                          F && "rotate-180",
                        )}
                      />
                    </button>
                    {F && (
                      <div className="animate-fade-in bg-slate-50/50">
                        {k.items.map((X) => {
                          const Me = t.accounts.find(
                            (we) => we.id === X.accountId,
                          );
                          return (
                            <div
                              className="flex items-center gap-2 py-2 pl-4 pr-2 sm:pl-[60px] sm:pr-5"
                              key={X.id}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-medium text-ink-700">
                                  {formatDate(X.date)}
                                  <span className="text-ink-400">
                                    {" · "}
                                    {Me == null ? void 0 : Me.name}
                                  </span>
                                </p>
                                <p className="truncate text-[11px] text-ink-400">
                                  {X.vendor ||
                                    X.comment ||
                                    EXPENSE_CATEGORY_SHORT[X.category]}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <span className="text-[12.5px] font-semibold tabular-nums text-red-500">
                                  −{formatAmount(X.amount)}
                                  {" ₽"}
                                </span>
                                <button
                                  onClick={() => {
                                    (d(X), m(null), g(0), o("expense"));
                                  }}
                                  className="flex h-8 w-7 items-center justify-center rounded-lg text-ink-400 active:bg-brand-50 active:text-brand-600"
                                  aria-label={`Изменить расход ${formatMoney(X.amount)}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() =>
                                    C({
                                      kind: "expense",
                                      id: X.id,
                                      label: `расход ${formatMoney(X.amount)}`,
                                    })
                                  }
                                  className="flex h-8 w-7 items-center justify-center rounded-lg text-ink-400 active:bg-red-50 active:text-red-500"
                                  aria-label={`Удалить расход ${formatMoney(X.amount)}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
      {c === "transfers" && (
        <Card>
          <div className="card-pad pb-2">
            <CardHeader
              title="Переводы между счетами"
              subtitle="Не влияют на выручку и прибыль — только перераспределяют деньги"
              action={
                <Button
                  size="sm"
                  icon={<ArrowLeftRight className="h-4 w-4" />}
                  onClick={ie}
                >
                  Перевод
                </Button>
              }
            />
          </div>
          {G.length === 0 ? (
            <EmptyState
              icon={<ArrowLeftRight className="h-5 w-5" />}
              title="Переводов пока нет"
              description="Переведите деньги между кассой и банком"
            />
          ) : (
            <div className="divide-y divide-slate-50">
              {G.map((k) => {
                var X, Me;
                const F =
                    ((X = t.accounts.find((we) => we.id === k.fromAccountId)) ==
                    null
                      ? void 0
                      : X.name) ?? "—",
                  le =
                    ((Me = t.accounts.find((we) => we.id === k.toAccountId)) ==
                    null
                      ? void 0
                      : Me.name) ?? "—";
                return (
                  <div
                    className="flex items-center gap-3 px-4 py-3 sm:px-5"
                    key={k.id}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                      <ArrowLeftRight className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink-900">
                        {F} <span className="text-ink-300">→</span> {le}
                      </p>
                      <p className="truncate text-[11.5px] text-ink-400">
                        {formatDate(k.date)}
                        {k.comment ? ` · ${k.comment}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-ink-900">
                      {formatAmount(k.amount)}
                      {" ₽"}
                    </span>
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        onClick={() => {
                          (v(k), o("transfer"));
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 active:bg-brand-50 active:text-brand-600"
                        aria-label="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() =>
                          C({
                            kind: "transfer",
                            id: k.id,
                            label: `перевод ${formatMoney(k.amount)}`,
                          })
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 active:bg-red-50 active:text-red-500"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
      {c === "cash" && (
        <Card>
          <div className="card-pad pb-2">
            <CardHeader
              title="Пополнения и снятия"
              subtitle="Внесение капитала и вывод денег — не выручка и не расход"
              action={
                <Button
                  size="sm"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => Q()}
                >
                  Операция
                </Button>
              }
            />
          </div>
          {ee.length === 0 ? (
            <EmptyState
              icon={<Banknote className="h-5 w-5" />}
              title="Операций пока нет"
              description="Пополните кассу или выведите прибыль"
            />
          ) : (
            <div className="divide-y divide-slate-50">
              {ee.map((k) => {
                var le;
                const F = k.kind === "deposit";
                return (
                  <div
                    className="flex items-center gap-3 px-4 py-3 sm:px-5"
                    key={k.id}
                  >
                    <span
                      className={cx(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                        F
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-amber-50 text-amber-600",
                      )}
                    >
                      {F ? (
                        <ArrowDownLeft className="h-[18px] w-[18px]" />
                      ) : (
                        <ArrowUpRight className="h-[18px] w-[18px]" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink-900">
                        {F ? "Пополнение" : "Снятие"}
                      </p>
                      <p className="truncate text-[11.5px] text-ink-400">
                        {(le = t.accounts.find((X) => X.id === k.accountId)) ==
                        null
                          ? void 0
                          : le.name}
                        {" · "}
                        {formatDate(k.date)}
                        {k.comment ? ` · ${k.comment}` : ""}
                      </p>
                    </div>
                    <span
                      className={cx(
                        "shrink-0 text-[13.5px] font-semibold tabular-nums",
                        F ? "text-emerald-600" : "text-amber-600",
                      )}
                    >
                      {F ? "+" : "−"}
                      {formatAmount(k.amount)}
                      {" ₽"}
                    </span>
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        onClick={() => Q(k)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 active:bg-brand-50 active:text-brand-600"
                        aria-label="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() =>
                          C({
                            kind: "cash",
                            id: k.id,
                            label: F ? "пополнение" : "снятие",
                          })
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 active:bg-red-50 active:text-red-500"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
      <ExpenseModal
        open={i === "expense"}
        expense={l}
        preset={O}
        presetAmount={S}
        onClose={() => o(null)}
        onSaved={() => {
          (o(null),
            a({
              title: l ? "Расход обновлён" : "Расход добавлен",
              description: "Остаток счёта пересчитан",
              tone: "success",
            }));
        }}
      />
      <TransferModal
        open={i === "transfer"}
        transfer={x}
        onClose={() => o(null)}
        onSaved={() => {
          (o(null),
            a({
              title: x ? "Перевод обновлён" : "Перевод выполнен",
              description: "Остатки обоих счетов пересчитаны",
              tone: "success",
            }));
        }}
      />
      <CashOpModal
        open={i === "cash"}
        op={p}
        onClose={() => o(null)}
        onSaved={() => {
          (o(null),
            a({
              title: "Операция сохранена",
              description: "Остаток счёта пересчитан",
              tone: "success",
            }));
        }}
      />
      <AccountModal
        open={i === "account"}
        account={A}
        onClose={() => o(null)}
        onSaved={() => {
          (o(null),
            a({
              title: A ? "Счёт обновлён" : "Счёт создан",
              tone: "success",
            }));
        }}
      />
      <ConfirmDialog
        open={!!f}
        onClose={() => C(null)}
        onConfirm={_}
        title="Удалить операцию?"
        description={
          f
            ? `Будет удалён ${f.label}. Остатки счетов и статистика пересчитаются автоматически.`
            : void 0
        }
        confirmLabel="Удалить"
      />
    </div>
  );
}
