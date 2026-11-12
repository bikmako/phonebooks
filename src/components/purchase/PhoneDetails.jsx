/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { setPhoneStatus } from "../../domain/phones.js";
import { useStore } from "../../hooks/useStore.jsx";
import { findCompletedSale, getStockAge, getPhoneTotalCost, getRepairTotal } from "../../utils/calculations.js";
import {
  PHONE_CONDITIONS,
  PHONE_STATUS_LABELS,
  PHONE_STATUS_TONES,
} from "../../utils/constants.js";
import { formatAmount, formatDate, formatMoney } from "../../utils/format.js";
import { Button, Chip, cx } from "../ui.jsx";
import { DetailRow, DetailStat } from "./PhoneDetailParts.jsx";
import { RepairModal } from "./RepairModal.jsx";
import React from "react";
import { createPortal } from "react-dom";
import { PackageCheck, Smartphone, Tag, Wrench, X } from "lucide-react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export function PhoneDetails({
  phone: initialPhone,
  onClose: t,
  onEdit: n,
  onSell: a,
  onDelete: c,
}) {
  var x;
  const { data: r, mutate: i, notify: o } = useStore(),
    s = r.phones.find(phone => phone.id === initialPhone.id) ?? initialPhone,
    [repairDialog, setRepairDialog] = React.useState(null),
    l = findCompletedSale(r, s.id),
    d = (v) => {
      i((w) => setPhoneStatus(w, s.id, v)).ok &&
        (o({
          title: `Статус: ${PHONE_STATUS_LABELS[v].toLowerCase()}`,
          tone: "success",
        }),
        t());
    };
  return createPortal(
    <Fragment>
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 animate-fade-in"
        onClick={t}
      />
      <div className="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white animate-slide-up sm:max-w-md sm:rounded-2xl sm:animate-pop">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-ink-900">
              {s.model}
              {" · "}
              {s.storage}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {s.color}
              {" · "}
              {PHONE_CONDITIONS[s.condition]}
            </p>
          </div>
          <button
            onClick={t}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-400 active:bg-slate-100"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-center gap-2">
            <Chip tone={PHONE_STATUS_TONES[s.status]}>
              {PHONE_STATUS_LABELS[s.status]}
            </Chip>
            <span className="text-[11.5px] text-ink-400">
              {getStockAge(s, l == null ? void 0 : l.date)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <DetailStat
              label="Закупка"
              value={`${formatAmount(s.purchasePrice)} ₽`}
            />
            <DetailStat
              label="План продажи"
              value={s.plannedPrice ? `${formatAmount(s.plannedPrice)} ₽` : "—"}
              tone="green"
            />
            <DetailStat
              label="Дата закупки"
              value={formatDate(s.purchaseDate)}
            />
            <DetailStat
              label="Потенциальная прибыль"
              value={
                s.plannedPrice
                  ? `${s.plannedPrice >= getPhoneTotalCost(s) ? "+" : ""}${formatAmount(s.plannedPrice - getPhoneTotalCost(s))} ₽`
                  : "—"
              }
              tone="green"
            />
          </div>
          <section aria-label="Финансовая информация" className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3.5 text-[12.5px]">
            <p className="font-semibold text-ink-900">Финансовая информация</p>
            <DetailRow label="Закупка" value={`${formatAmount(s.purchasePrice)} ₽`} />
            <DetailRow label="Ремонт" value={`${formatAmount(getRepairTotal(s))} ₽`} />
            <DetailRow label="Себестоимость" value={`${formatAmount(getPhoneTotalCost(s))} ₽`} />
          </section>
          {!!s.repairs?.length && <section aria-label="История ремонтов" className="mt-3 text-[12.5px]">
            <p className="mb-2 font-semibold text-ink-900">История ремонтов</p>
            <div className="divide-y divide-slate-100">
              {s.repairs.map((repair, index) => <div key={repair.id} className="py-2">
                <div className="flex flex-wrap justify-between gap-1"><span>{formatDate(repair.date)}</span><strong>{formatAmount(repair.amount)} ₽</strong></div>
                {repair.accountId && <p className="text-ink-500">{r.accounts.find(account => account.id === repair.accountId)?.name ?? "—"}</p>}
                {repair.comment && <p className="text-ink-500" style={{ overflowWrap: "anywhere" }}>{repair.comment}</p>}
                <div className="flex gap-4">
                  <button className="min-h-[44px] text-brand-700" aria-label={`Исправить ремонт ${index + 1}`} onClick={() => setRepairDialog({ repair })}>Исправить</button>
                  <button className="min-h-[44px] text-red-500" aria-label={`Удалить ремонт ${index + 1}`} onClick={() => setRepairDialog({ repair, deleting: true })}>Удалить</button>
                </div>
              </div>)}
            </div>
          </section>}
          <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3.5 text-[12.5px]">
            <DetailRow label="IMEI" value={s.imei || "—"} mono={!0} />
            <DetailRow label="Комплектация" value={s.kit} />
            <DetailRow
              label="Продавец"
              value={`${s.supplierName}${s.supplierPhone ? ` · ${s.supplierPhone}` : ""}`}
            />
            <DetailRow
              label="Счёт закупки"
              value={
                ((x = r.accounts.find((v) => v.id === s.purchaseAccountId)) ==
                null
                  ? void 0
                  : x.name) ?? "—"
              }
            />
            {s.purchaseComment && (
              <DetailRow label="Комментарий" value={s.purchaseComment} />
            )}
          </div>
          {l && (
            <div className="mt-3 rounded-xl bg-emerald-50 p-3.5 text-[12.5px] text-emerald-800">
              <p className="font-semibold">
                {"Продан "}
                {formatDate(l.date)}
              </p>
              <p className="mt-0.5">
                {"Покупатель: "}
                {l.buyerName}
                {" · "}
                {formatMoney(l.price - l.discount)}
              </p>
            </div>
          )}
          {s.status !== "sold" && (
            <div className="mt-4">
              <p className="label">Статус</p>
              <div className="grid grid-cols-3 gap-2">
                {["in_stock", "reserved", "repair"].map((v) => (
                  <button
                    onClick={() => d(v)}
                    disabled={s.status === "repair" && v !== "repair"}
                    className={cx(
                      "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border text-[12px] font-medium transition-colors active:scale-[.98]",
                      s.status === v
                        ? "border-brand-300 bg-brand-50 text-brand-700"
                        : "border-slate-200 bg-white text-ink-600",
                    )}
                    key={v}
                  >
                    {v === "reserved" && <Tag className="h-4 w-4" />}
                    {v === "repair" && <Wrench className="h-4 w-4" />}
                    {v === "in_stock" && <PackageCheck className="h-4 w-4" />}
                    {PHONE_STATUS_LABELS[v]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div
          className="border-t border-slate-100 px-5 pt-3"
          style={{
            paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          }}
        >
          {s.status !== "sold" ? (
            <Fragment>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => n(s)}
                >
                  Изменить
                </Button>
                {s.status === "repair" ? <Button className="flex-[1.4]" icon={<Wrench className="h-4 w-4" />} onClick={() => setRepairDialog({})}>
                  Завершить ремонт
                </Button> : <Button
                  className="flex-[1.4]"
                  icon={<Smartphone className="h-4 w-4" />}
                  onClick={() => a(s.id)}
                >
                  Продать
                </Button>}
              </div>
              <button
                onClick={() => c(s)}
                className="mt-2 w-full py-2 text-[12px] font-medium text-red-500 active:opacity-70"
              >
                Удалить
              </button>
            </Fragment>
          ) : (
            <p className="pb-1 text-center text-[12px] text-ink-400">
              Проданный телефон не редактируется. Чтобы исправить — отмените
              продажу в разделе «Продажи».
            </p>
          )}
        </div>
      </div>
    </div>
    {repairDialog && <RepairModal phone={s} {...repairDialog} onClose={() => setRepairDialog(null)} />}
    </Fragment>, document.body
  );
}
