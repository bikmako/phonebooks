/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { PHONE_CONDITIONS } from "../../utils/constants.js";
import { formatMoney } from "../../utils/format.js";
import { Chip, Input, cx } from "../ui.jsx";
import { Check, ChevronDown, Search, Smartphone } from "lucide-react";
import React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export function PhonePicker({
  data: s,
  selectedId: t,
  onSelect: n,
  includeReserved: a = !0,
}) {
  const [c, r] = React.useState(!1),
    [i, o] = React.useState(""),
    l = React.useMemo(
      () =>
        s.phones
          .filter(
            (x) => x.status === "in_stock" || (a && x.status === "reserved"),
          )
          .filter((x) => {
            if (!i.trim()) return !0;
            const v = i.trim().toLowerCase();
            return (
              x.model.toLowerCase().includes(v) ||
              x.imei.includes(v.replace(/\D/g, "") || "§")
            );
          })
          .sort((x, v) => v.purchaseDate.localeCompare(x.purchaseDate)),
      [s.phones, i, a],
    ),
    d = s.phones.find((x) => x.id === t);
  return (
    <div>
      <button
        type="button"
        onClick={() => r((x) => !x)}
        className={cx(
          "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
          d
            ? "border-brand-300 bg-brand-50/50"
            : "border-slate-200 bg-white hover:bg-slate-50",
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 ring-1 ring-slate-200">
          <Smartphone className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          {d ? (
            <Fragment>
              <span className="block truncate text-[14px] font-semibold text-ink-900">
                {d.model}
                {" · "}
                {d.storage}
              </span>
              <span className="block truncate text-[11.5px] text-ink-500">
                {d.color}
                {" · закупка "}
                {formatMoney(d.purchasePrice)}
                {d.imei ? ` · IMEI ${d.imei}` : ""}
              </span>
            </Fragment>
          ) : (
            <Fragment>
              <span className="block text-[14px] font-semibold text-ink-900">
                Выберите телефон со склада
              </span>
              <span className="block text-[11.5px] text-ink-500">
                {l.length}
                {" доступно к продаже"}
              </span>
            </Fragment>
          )}
        </span>
        <ChevronDown
          className={cx(
            "h-4 w-4 shrink-0 text-ink-400 transition-transform",
            c && "rotate-180",
          )}
        />
      </button>
      {c && (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white animate-fade-in">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                value={i}
                onChange={(x) => o(x.target.value)}
                placeholder="Поиск по модели или IMEI"
                className="h-10 pl-9"
                autoFocus={!0}
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto overscroll-contain">
            {l.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-ink-400">
                Нет свободных телефонов. Оформите скупку или снимите телефон с
                резерва.
              </p>
            ) : (
              l.map((x) => {
                const v = x.id === t;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      (n(x), r(!1), o(""));
                    }}
                    className={cx(
                      "flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left transition-colors last:border-0",
                      v ? "bg-brand-50" : "hover:bg-slate-50",
                    )}
                    key={x.id}
                  >
                    <span
                      className={cx(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        v
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-slate-300",
                      )}
                    >
                      {v && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-medium text-ink-900">
                          {x.model}
                          {" · "}
                          {x.storage}
                        </span>
                        {x.status === "reserved" && (
                          <Chip tone="warning">Резерв</Chip>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-ink-400">
                        {x.color}
                        {" · "}
                        {PHONE_CONDITIONS[x.condition]}
                        {" · закупка "}
                        {formatMoney(x.purchasePrice)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] font-semibold text-ink-500">
                      {formatMoney(x.plannedPrice || 0)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
