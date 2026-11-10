/**
 * Скупка и склад телефонов.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { PHONE_STATUS_TABS } from "../components/purchase/PhoneDetailParts.jsx";
import { PhoneDetails } from "../components/purchase/PhoneDetails.jsx";
import { PurchaseForm } from "../components/purchase/PurchaseForm.jsx";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  EmptyState,
  SearchInput,
  cx,
} from "../components/ui.jsx";
import { deletePhone } from "../domain/phones.js";
import { useStore } from "../hooks/useStore.jsx";
import {
  findCompletedSale,
  getStockAge,
  getStockValue,
} from "../utils/calculations.js";
import {
  PHONE_CONDITIONS,
  PHONE_STATUS_LABELS,
  PHONE_STATUS_TONES,
} from "../utils/constants.js";
import { clearDraft, readDraft } from "../utils/drafts.js";
import {
  formatAmount,
  formatDate,
  formatMoney,
  plural,
} from "../utils/format.js";
import { ChevronRight, Plus, Search, ShoppingBag, X } from "lucide-react";
import React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export function PurchasePage({
  formOpen: s,
  onOpenForm: t,
  onCloseForm: n,
  onSell: a,
}) {
  const { data: c, mutate: r, notify: i } = useStore(),
    [o, l] = React.useState(""),
    [d, x] = React.useState("all"),
    [v, p] = React.useState(null),
    [w, A] = React.useState(null),
    [L, O] = React.useState(null),
    [m, f] = React.useState(20),
    [C, S] = React.useState(null);
  React.useEffect(() => {
    if (s || w) {
      S(null);
      return;
    }
    const y = readDraft("phone-new");
    y != null && y.model
      ? S(
          `${y.model}${y.purchasePrice ? ` · ${formatAmount(Number(y.purchasePrice))} ₽` : ""}`,
        )
      : S(null);
  }, [s, w]);
  const g = React.useMemo(() => {
      const y = {
        all: c.phones.length,
        in_stock: 0,
        reserved: 0,
        repair: 0,
        sold: 0,
      };
      for (const j of c.phones) y[j.status]++;
      return y;
    }, [c.phones]),
    b = React.useMemo(() => {
      const y = o.trim().toLowerCase(),
        j = y.replace(/\D/g, ""),
        u = {
          in_stock: 0,
          reserved: 1,
          repair: 2,
          sold: 3,
        };
      return [...c.phones]
        .filter((N) => (d === "all" ? !0 : N.status === d))
        .filter((N) =>
          y
            ? N.model.toLowerCase().includes(y) ||
              (j.length >= 3 && N.imei.includes(j)) ||
              N.supplierName.toLowerCase().includes(y) ||
              N.color.toLowerCase().includes(y)
            : !0,
        )
        .sort((N, E) =>
          d === "all" && u[N.status] !== u[E.status]
            ? u[N.status] - u[E.status]
            : E.purchaseDate.localeCompare(N.purchaseDate),
        );
    }, [c.phones, d, o]),
    B = () => {
      if (!L) return;
      (r((j) => deletePhone(j, L.id)).ok &&
        i({
          title: "Закупка удалена",
          description: "Деньги вернулись на счёт",
          tone: "info",
        }),
        O(null),
        p(null));
    };
  return (
    <div className="space-y-4">
      <Card className="p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-900">
              {g.in_stock}{" "}
              {plural(g.in_stock, "телефон", "телефона", "телефонов")}
              {" на складе"}
            </p>
            <p className="text-[11.5px] text-ink-500">
              {"закуплено на "}
              {formatMoney(getStockValue(c))}
            </p>
          </div>
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={t}
            className="shrink-0"
          >
            Скупка
          </Button>
        </div>
      </Card>
      {C && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50/60 px-4 py-3 animate-fade-in">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600">
            <ShoppingBag className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink-900">
              Есть незавершённая закупка
            </p>
            <p className="truncate text-[11.5px] text-ink-500">{C}</p>
          </div>
          <Button size="sm" onClick={t}>
            Продолжить
          </Button>
          <button
            onClick={() => {
              (clearDraft("phone-new"), S(null));
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-400 active:bg-white"
            aria-label="Удалить черновик"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {s && (
        <Card className="border-brand-200 p-4 sm:p-5 animate-fade-up">
          <CardHeader
            title="Новая скупка"
            subtitle="Телефон попадёт на склад, деньги спишутся со счёта"
            className="mb-4"
          />
          <PurchaseForm onDone={n} onCancel={n} />
        </Card>
      )}
      {w && (
        <Card className="border-brand-200 p-4 sm:p-5 animate-fade-up">
          <CardHeader
            title="Редактирование"
            subtitle="Изменения пересчитают деньги на счёте"
            className="mb-4"
          />
          <PurchaseForm
            phone={w}
            onDone={() => A(null)}
            onCancel={() => A(null)}
          />
        </Card>
      )}
      <Card>
        <div className="card-pad pb-3">
          <CardHeader
            title="Телефоны"
            subtitle={`${b.length} ${plural(b.length, "запись", "записи", "записей")}`}
          />
          <div className="mt-3">
            <SearchInput
              value={o}
              onChange={l}
              placeholder="IMEI, модель или продавец"
            />
          </div>
          <div className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {PHONE_STATUS_TABS.map((y) => (
              <button
                onClick={() => x(y.id)}
                className={cx(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-colors",
                  d === y.id
                    ? "chip-active"
                    : "bg-slate-100 text-ink-600 active:bg-slate-200",
                )}
                key={y.id}
              >
                {y.label}
                <span
                  className={cx(
                    "rounded-full px-1.5 text-[10.5px]",
                    d === y.id ? "bg-white/20" : "bg-white text-ink-400",
                  )}
                >
                  {g[y.id]}
                </span>
              </button>
            ))}
          </div>
        </div>
        {b.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title={
              o
                ? "Ничего не найдено"
                : c.phones.length === 0
                  ? "Пока пусто"
                  : "Нет телефонов с этим статусом"
            }
            description={
              o
                ? "Проверьте IMEI или модель"
                : c.phones.length === 0
                  ? "Оформите первую скупку — телефон появится на складе"
                  : "Измените фильтр"
            }
            action={
              !o && c.phones.length === 0 ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={t}>
                  Оформить скупку
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
                    <th className="px-5 py-2.5 font-medium">Модель</th>
                    <th className="px-3 py-2.5 font-medium">IMEI</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      Закупка
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">План</th>
                    <th className="px-3 py-2.5 font-medium">Дата</th>
                    <th className="px-3 py-2.5 font-medium">Статус</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {b.slice(0, m).map((y) => {
                    var j;
                    return (
                      <tr
                        className="group cursor-pointer transition-colors hover:bg-slate-50/60"
                        onClick={() => p(y)}
                        key={y.id}
                      >
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink-900">
                            {y.model}{" "}
                            <span className="font-normal text-ink-400">
                              {"· "}
                              {y.storage}
                            </span>
                          </p>
                          <p className="text-[11px] text-ink-400">
                            {y.color}
                            {" · "}
                            {PHONE_CONDITIONS[y.condition]}
                          </p>
                        </td>
                        <td className="px-3 py-3 font-mono text-[11.5px] tracking-wide text-ink-500">
                          {y.imei || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-ink-900">
                          {formatAmount(y.purchasePrice)}
                          {" ₽"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-500">
                          {y.plannedPrice
                            ? `${formatAmount(y.plannedPrice)} ₽`
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-ink-500">
                          {formatDate(y.purchaseDate)}
                          <span className="ml-1 text-[10.5px] text-ink-400">
                            (
                            {getStockAge(
                              y,
                              (j = findCompletedSale(c, y.id)) == null
                                ? void 0
                                : j.date,
                            )}
                            )
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <Chip tone={PHONE_STATUS_TONES[y.status]}>
                            {PHONE_STATUS_LABELS[y.status]}
                          </Chip>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <ChevronRight className="ml-auto h-4 w-4 text-ink-300 transition-transform group-hover:translate-x-0.5" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 p-3 lg:hidden">
              {b.slice(0, m).map((y) => {
                const j = findCompletedSale(c, y.id);
                return (
                  <div
                    onClick={() => p(y)}
                    className="rounded-xl border border-slate-100 bg-white p-3 transition-colors active:bg-slate-50"
                    key={y.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-ink-900">
                          {y.model}
                        </p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
                          {y.storage}
                          {" · "}
                          {y.color}
                          {" · "}
                          {y.supplierName}
                        </p>
                      </div>
                      <Chip
                        tone={PHONE_STATUS_TONES[y.status]}
                        className="shrink-0"
                      >
                        {y.status === "in_stock"
                          ? "Склад"
                          : PHONE_STATUS_LABELS[y.status]}
                      </Chip>
                    </div>
                    <div className="mt-2 flex items-end justify-between">
                      <div>
                        <p className="text-[10.5px] text-ink-400">
                          Закупка / план
                        </p>
                        <p className="text-[12.5px] font-semibold tabular-nums text-ink-900">
                          {formatAmount(y.purchasePrice)}
                          {" ₽ "}
                          <span className="font-normal text-ink-400">
                            {"/ "}
                            {y.plannedPrice
                              ? formatAmount(y.plannedPrice)
                              : "—"}
                          </span>
                        </p>
                      </div>
                      <span className="text-[10.5px] text-ink-400">
                        {getStockAge(y, j == null ? void 0 : j.date)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {b.length > m && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button variant="secondary" onClick={() => f((y) => y + 30)}>
                  {"Показать ещё (осталось "}
                  {b.length - m})
                </Button>
              </div>
            )}
          </Fragment>
        )}
      </Card>
      <p className="px-1 text-[11.5px] text-ink-400">
        {g.reserved}
        {" в резерве · "}
        {g.repair}
        {" в ремонте · "}
        {g.sold}
        {
          " продано. Проданный телефон нельзя удалить — сначала отмените продажу."
        }
      </p>
      {v && (
        <PhoneDetails
          phone={v}
          onClose={() => p(null)}
          onEdit={(y) => {
            (A(y), p(null));
          }}
          onSell={(y) => {
            (p(null), a(y));
          }}
          onDelete={(y) => O(y)}
        />
      )}
      {w && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 animate-fade-in"
            onClick={() => A(null)}
          />
          <div className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white animate-slide-up sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <p className="text-[16px] font-semibold text-ink-900">
                Редактирование
              </p>
              <button
                onClick={() => A(null)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-400"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <PurchaseForm
                phone={w}
                onDone={() => A(null)}
                onCancel={() => A(null)}
              />
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!L}
        onClose={() => O(null)}
        onConfirm={B}
        title="Удалить закупку?"
        description={
          L
            ? `«${L.model}» будет удалён из базы, ${formatMoney(L.purchasePrice)} вернутся на счёт.`
            : void 0
        }
        confirmLabel="Удалить"
      />
    </div>
  );
}
