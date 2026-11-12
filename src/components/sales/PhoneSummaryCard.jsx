import { getPhoneTotalCost } from "../../utils/calculations.js";
/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { findCompletedSale } from "../../utils/calculations.js";
import {
  PHONE_CONDITIONS,
  PHONE_STATUS_LABELS,
  PHONE_STATUS_TONES,
} from "../../utils/constants.js";
import { formatMoney } from "../../utils/format.js";
import { Chip, cx } from "../ui.jsx";
import { jsx, jsxs } from "react/jsx-runtime";
export function PhoneSummaryCard({ data: s, phone: t, price: n }) {
  const a = findCompletedSale(s, t.id),
    c = n - getPhoneTotalCost(t);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold text-ink-900">
            {t.model}
            {" · "}
            {t.storage}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-500">
            {t.color}
            {" · "}
            {PHONE_CONDITIONS[t.condition]}
            {" · "}
            {t.kit}
          </p>
          {t.imei && (
            <p className="mt-1 font-mono text-[11.5px] tracking-wide text-ink-400">
              {"IMEI "}
              {t.imei}
            </p>
          )}
        </div>
        <Chip tone={PHONE_STATUS_TONES[t.status]}>
          {PHONE_STATUS_LABELS[t.status]}
        </Chip>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200/60">
          <p className="text-[10px] uppercase tracking-wide text-ink-400">
            Закупка
          </p>
          <p className="text-[12.5px] font-semibold tabular-nums text-ink-900">
            {formatMoney(t.purchasePrice)}
          </p>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200/60">
          <p className="text-[10px] uppercase tracking-wide text-ink-400">
            План
          </p>
          <p className="text-[12.5px] font-semibold tabular-nums text-ink-900">
            {formatMoney(t.plannedPrice || 0)}
          </p>
        </div>
        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200/60">
          <p className="text-[10px] uppercase tracking-wide text-ink-400">
            Прибыль
          </p>
          <p
            className={cx(
              "text-[12.5px] font-bold tabular-nums",
              c >= 0 ? "text-emerald-600" : "text-red-500",
            )}
          >
            {n > 0 ? `${c >= 0 ? "+" : ""}${Math.round(c)} ₽` : "—"}
          </p>
        </div>
      </div>
      {a && (
        <p className="mt-2 text-[11.5px] font-medium text-red-500">
          Внимание: по этому телефону уже есть продажа
        </p>
      )}
    </div>
  );
}
