/**
 * Шторка быстрых действий.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { cx } from "./ui.jsx";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  Plus,
  Receipt,
  ShoppingBag,
  TrendingUp,
  X,
} from "lucide-react";
import { jsx, jsxs } from "react/jsx-runtime";
export function QuickActionSheet({
  open: s,
  onClose: t,
  onPurchase: n,
  onSale: a,
  onGo: c,
}) {
  return s ? (
    <div className="fixed inset-0 z-[80]">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in"
        onClick={t}
      />
      <div
        className="absolute inset-x-0 bottom-0 animate-slide-up rounded-t-3xl bg-white px-4 pt-3 shadow-float lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-[420px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:animate-pop lg:rounded-3xl"
        style={{
          paddingBottom: "max(20px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 lg:hidden" />
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-[15px] font-semibold text-ink-900">
            Новая операция
          </p>
          <button
            onClick={t}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 active:bg-slate-100"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
          <QuickActionItem
            icon={<ShoppingBag className="h-5 w-5" />}
            title="Закупка телефона"
            subtitle="Телефон на склад, деньги со счёта"
            tone="blue"
            onClick={n}
          />
          <QuickActionItem
            icon={<TrendingUp className="h-5 w-5" />}
            title="Продажа телефона"
            subtitle="Деньги на счёт, прибыль сразу"
            tone="green"
            onClick={a}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                (t(), c("finance"));
              }}
              className="flex min-h-[64px] flex-col justify-center gap-1 rounded-2xl bg-slate-50 px-3.5 text-left active:bg-slate-100"
            >
              <ArrowLeftRight className="h-5 w-5 text-brand-600" />
              <span className="text-[12.5px] font-semibold text-ink-900">
                Перевод
              </span>
              <span className="text-[10.5px] text-ink-400">между счетами</span>
            </button>
            <button
              onClick={() => {
                (t(), c("finance"));
              }}
              className="flex min-h-[64px] flex-col justify-center gap-1 rounded-2xl bg-slate-50 px-3.5 text-left active:bg-slate-100"
            >
              <Receipt className="h-5 w-5 text-red-500" />
              <span className="text-[12.5px] font-semibold text-ink-900">
                Расход
              </span>
              <span className="text-[10.5px] text-ink-400">
                аренда, зарплата
              </span>
            </button>
          </div>
          <button
            onClick={() => {
              (t(), c("finance"));
            }}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-50 py-2.5 text-[12.5px] font-semibold text-brand-700 active:bg-brand-100"
          >
            <ArrowDownLeft className="h-4 w-4" />
            {" Пополнить счёт"}
          </button>
        </div>
      </div>
    </div>
  ) : null;
}
export function QuickActionItem({
  icon: s,
  title: t,
  subtitle: n,
  tone: a,
  onClick: c,
}) {
  return (
    <button
      onClick={c}
      className="flex min-h-[72px] w-full items-center gap-3.5 rounded-2xl border border-slate-200 p-3.5 text-left transition-colors active:bg-slate-50"
    >
      <span
        className={cx(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white",
          a === "blue" ? "bg-brand-600" : "bg-emerald-600",
        )}
      >
        {s}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink-900">
          {t}
        </span>
        <span className="block text-[11.5px] text-ink-500">{n}</span>
      </span>
      <Plus className="h-5 w-5 shrink-0 text-ink-300" />
    </button>
  );
}
