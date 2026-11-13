/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { createPhone, updatePhone } from "../../domain/phones.js";
import { useStore } from "../../hooks/useStore.jsx";
import { getAccountBalance } from "../../utils/calculations.js";
import {
  MODEL_SUGGESTIONS,
  PAYMENT_METHODS,
  PHONE_CONDITIONS,
  STORAGE_OPTIONS,
} from "../../utils/constants.js";
import {
  PURCHASE_DRAFT_KEY,
  clearDraft,
  emptyPurchaseForm,
  readDraft,
  saveDraft,
  registerUpdateDraft,
} from "../../utils/drafts.js";
import {
  formatAmount,
  formatMoney,
  formatPhoneInput,
  today,
} from "../../utils/format.js";
import { Button, Field, Input, Select, Textarea, cx } from "../ui.jsx";
import { Camera, Check, CircleAlert, Package, Smartphone } from "lucide-react";
import { ImeiScanner } from "./ImeiScanner.jsx";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function PurchaseForm({ phone: s, onDone: t, onCancel: n }) {
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const { data: a, mutate: c, notify: r } = useStore(),
    i = a.accounts.filter((j) => !j.archived),
    o = React.useRef(!1),
    [l, d] = React.useState(() => {
      var j;
      return s
        ? {
            id: s.id,
            model: s.model,
            storage: s.storage,
            color: s.color,
            imei: s.imei,
            condition: s.condition,
            kit: s.kit,
            purchasePrice: s.purchasePrice,
            plannedPrice: s.plannedPrice,
            purchaseDate: s.purchaseDate,
            supplierName: s.supplierName,
            supplierPhone: s.supplierPhone,
            purchaseAccountId: s.purchaseAccountId,
            purchasePaymentMethod: s.purchasePaymentMethod,
            purchaseComment: s.purchaseComment,
            status: s.status,
          }
        : (readDraft(PURCHASE_DRAFT_KEY) ??
            emptyPurchaseForm(((j = i[0]) == null ? void 0 : j.id) ?? ""));
    }),
    [x, v] = React.useState({}),
    [p, w] = React.useState(() => {
      var u;
      const j = (
        (s == null ? void 0 : s.kit) ??
        ((u = readDraft(PURCHASE_DRAFT_KEY)) == null ? void 0 : u.kit) ??
        ""
      )
        .trim()
        .toLowerCase();
      return !!j && !j.startsWith("без комплект") && j !== "нет" && j !== "—";
    }),
    [A, L] = React.useState(!1),
    [O, m] = React.useState(!1);
  React.useEffect(() => {
    if (!s) return registerUpdateDraft(PURCHASE_DRAFT_KEY, l);
  }, [l, s]);
  (React.useEffect(() => {
    if (s || !!!(l.model || l.imei || l.purchasePrice || l.supplierName))
      return;
    const u = setTimeout(() => saveDraft(PURCHASE_DRAFT_KEY, l), 400);
    return () => clearTimeout(u);
  }, [l, s]),
    React.useEffect(() => {
      if (s || o.current) return;
      const j = readDraft(PURCHASE_DRAFT_KEY);
      j &&
        (j.model || j.imei) &&
        ((o.current = !0),
        r({
          title: "Черновик восстановлен",
          description: "Данные последней незавершённой закупки",
          tone: "info",
        }));
    }, [s, r]),
    React.useEffect(() => {
      !s &&
        !l.purchaseAccountId &&
        i[0] &&
        d((j) => ({
          ...j,
          purchaseAccountId: i[0].id,
        }));
    }, [i, l.purchaseAccountId, s]));
  const f = l.purchaseAccountId ? getAccountBalance(a, l.purchaseAccountId) : 0,
    C = Number(l.purchasePrice) || 0,
    S = f + (s ? s.purchasePrice : 0) - C,
    g = C > 0 && S < 0,
    b = (j, u) => {
      (d((N) => ({
        ...N,
        [j]: u,
      })),
        x[j] &&
          v((N) => ({
            ...N,
            [j]: "",
          })));
    },
    B = React.useMemo(() => {
      const j = Array.from(new Set(a.phones.map((u) => u.model)));
      return Array.from(new Set([...j, ...MODEL_SUGGESTIONS])).slice(0, 30);
    }, [a.phones]),
    y = () => {
      var u;
      m(!0);
      const j = c((N) => (s ? updatePhone(N, l) : createPhone(N, l)));
      (m(!1),
        j.ok
          ? (s || clearDraft(PURCHASE_DRAFT_KEY), t())
          : (u = j.error) != null &&
            u.field &&
            v({
              [j.error.field]: j.error.message,
            }));
    };
  return (
    <div className="space-y-4" data-update-dirty="true">
      {g && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Недостаточно денег на счёте</p>
            <p className="mt-0.5 text-amber-700">
              {"Доступно "}
              {formatMoney(f)}. Уменьшите закупочную цену, выберите другой счёт
              или пополните его в разделе «Финансы».
            </p>
          </div>
        </div>
      )}
      <div className="rounded-2xl bg-slate-50/80 p-3.5">
        <p className="mb-2.5 text-[12px] font-semibold text-ink-500">
          Продавец
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Имя продавца"
            htmlFor="seller-name"
            error={x.supplierName}
          >
            <Input
              id="seller-name"
              value={l.supplierName}
              onChange={(j) => b("supplierName", j.target.value)}
              placeholder="Иван Петров"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Телефон продавца"
            htmlFor="seller-phone"
            error={x.supplierPhone}
          >
            <Input
              id="seller-phone"
              value={l.supplierPhone}
              onChange={(j) =>
                b("supplierPhone", formatPhoneInput(j.target.value))
              }
              placeholder="+7 900 000-00-00"
              inputMode="tel"
            />
          </Field>
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-[12px] font-semibold text-ink-500">Телефон</p>
        <Field
          label="Модель смартфона"
          required={!0}
          htmlFor="model"
          error={x.model}
        >
          <div className="relative">
            <Input
              id="model"
              value={l.model}
              onChange={(j) => {
                (b("model", j.target.value), L(!0));
              }}
              onFocus={() => L(!0)}
              onBlur={() => setTimeout(() => L(!1), 150)}
              placeholder="iPhone 13"
              autoComplete="off"
            />
            {A && B.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-float animate-fade-in">
                {B.filter(
                  (j) =>
                    j.toLowerCase().includes(l.model.toLowerCase()) &&
                    j !== l.model,
                )
                  .slice(0, 8)
                  .map((j) => (
                    <button
                      type="button"
                      onMouseDown={(u) => u.preventDefault()}
                      onClick={() => {
                        (b("model", j), L(!1));
                      }}
                      className="flex w-full items-center px-3.5 py-2.5 text-left text-[13.5px] text-ink-700 hover:bg-slate-50"
                      key={j}
                    >
                      {j}
                    </button>
                  ))}
                {!B.some((j) =>
                  j.toLowerCase().includes(l.model.toLowerCase()),
                ) && (
                  <p className="px-3.5 py-2.5 text-[12.5px] text-ink-400">
                    Новая модель — она сохранится в справочнике
                  </p>
                )}
              </div>
            )}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Объём памяти" htmlFor="storage">
            <div className="relative">
              <Select
                id="storage"
                value={l.storage}
                onChange={(j) => b("storage", j.target.value)}
              >
                {STORAGE_OPTIONS.map((j) => (
                  <option value={j} key={j}>
                    {j}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="Цвет" htmlFor="color">
            <Input
              id="color"
              value={l.color}
              onChange={(j) => b("color", j.target.value)}
              placeholder="Чёрный"
            />
          </Field>
        </div>
        <Field label="IMEI" htmlFor="imei" error={x.imei}>
          <div className="imei-input-row">
            <Input
              id="imei"
              value={l.imei}
              onChange={(j) =>
                b("imei", j.target.value.replace(/\D/g, "").slice(0, 15))
              }
              placeholder="356789012345671"
              inputMode="numeric"
              className={cx("font-mono tracking-wide")}
            />
            <Button type="button" variant="secondary" aria-label="Сканировать IMEI" title="Сканировать IMEI" onClick={() => setScannerOpen(true)}>
              <Camera size={20} />
            </Button>
          </div>
        </Field>
        <Field label="Состояние" htmlFor="condition">
          <Select
            id="condition"
            value={l.condition}
            onChange={(j) => b("condition", j.target.value)}
          >
            {Object.keys(PHONE_CONDITIONS).map((j) => (
              <option value={j} key={j}>
                {PHONE_CONDITIONS[j]}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <span className="label">Комплектация</span>
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="Комплектация"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!p}
              onClick={() => {
                (w(!1), b("kit", "Без комплекта"));
              }}
              className={cx(
                "relative flex h-11 items-center gap-2 rounded-xl border px-3 text-[12.5px] font-medium transition-all active:scale-[.99]",
                p
                  ? "border-slate-200 bg-white text-ink-600"
                  : "border-brand-500 bg-brand-50 text-brand-700",
              )}
            >
              <Smartphone
                className={cx(
                  "h-4 w-4 shrink-0",
                  p ? "text-ink-400" : "text-brand-600",
                )}
              />
              <span className="truncate">Без комплекта</span>
              {!p && (
                <Check className="absolute right-2 top-2 h-3 w-3 text-brand-600" />
              )}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={p}
              onClick={() => {
                (w(!0),
                  (!l.kit || l.kit === "Без комплекта") &&
                    b("kit", "Коробка, кабель"));
              }}
              className={cx(
                "relative flex h-11 items-center gap-2 rounded-xl border px-3 text-[12.5px] font-medium transition-all active:scale-[.99]",
                p
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-white text-ink-600",
              )}
            >
              <Package
                className={cx(
                  "h-4 w-4 shrink-0",
                  p ? "text-brand-600" : "text-ink-400",
                )}
              />
              <span className="truncate">С комплектом</span>
              {p && (
                <Check className="absolute right-2 top-2 h-3 w-3 text-brand-600" />
              )}
            </button>
          </div>
          {p && (
            <div className="mt-2 animate-fade-in">
              <div className="no-scrollbar -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
                {["Коробка", "Зарядка", "Чехол", "Наушники", "Документы"].map(
                  (j) => {
                    const u = l.kit
                        .split(/,\s*/)
                        .map((E) => E.trim())
                        .filter(Boolean),
                      N = u.includes(j);
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          const E = N ? u.filter((R) => R !== j) : [...u, j];
                          b("kit", E.length ? E.join(", ") : "Коробка");
                        }}
                        className={cx(
                          "h-8 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors",
                          N
                            ? "bg-brand-600 text-white"
                            : "bg-slate-100 text-ink-600 active:bg-slate-200",
                        )}
                        key={j}
                      >
                        {j}
                      </button>
                    );
                  },
                )}
              </div>
              <Input
                id="kit"
                value={l.kit}
                onChange={(j) => b("kit", j.target.value)}
                placeholder="Коробка, кабель"
                className="mt-2 h-10 text-[13px]"
              />
            </div>
          )}
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 p-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Закупочная цена"
            required={!0}
            htmlFor="price"
            error={x.purchasePrice}
          >
            <div className="relative">
              <Input
                id="price"
                value={l.purchasePrice}
                onChange={(j) =>
                  b("purchasePrice", j.target.value.replace(/[^\d]/g, ""))
                }
                placeholder="30 000"
                inputMode="numeric"
                className="pr-8 font-semibold"
                invalid={g}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400">
                ₽
              </span>
            </div>
          </Field>
          <Field label="Цена продажи" htmlFor="planned">
            <div className="relative">
              <Input
                id="planned"
                value={l.plannedPrice}
                onChange={(j) =>
                  b("plannedPrice", j.target.value.replace(/[^\d]/g, ""))
                }
                placeholder="38 000"
                inputMode="numeric"
                className="pr-8"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400">
                ₽
              </span>
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Счёт списания"
            required={!0}
            htmlFor="account"
            error={x.accountId}
          >
            <Select
              id="account"
              value={l.purchaseAccountId}
              onChange={(j) => b("purchaseAccountId", j.target.value)}
            >
              {i.map((j) => (
                <option value={j.id} key={j.id}>
                  {j.name}
                  {" · "}
                  {formatMoney(getAccountBalance(a, j.id))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Способ оплаты" htmlFor="paymethod">
            <Select
              id="paymethod"
              value={l.purchasePaymentMethod}
              onChange={(j) => b("purchasePaymentMethod", j.target.value)}
            >
              {Object.keys(PAYMENT_METHODS).map((j) => (
                <option value={j} key={j}>
                  {PAYMENT_METHODS[j]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Дата покупки"
          required={!0}
          htmlFor="date"
          error={x.purchaseDate}
        >
          <Input
            id="date"
            type="date"
            value={l.purchaseDate}
            max={today()}
            onChange={(j) => b("purchaseDate", j.target.value)}
          />
        </Field>
      </div>
      <Field label="Комментарий" htmlFor="comment">
        <Textarea
          id="comment"
          value={l.purchaseComment}
          onChange={(j) => b("purchaseComment", j.target.value)}
          placeholder="Состояние, торг, особенности устройства…"
          rows={2}
        />
      </Field>
      <div className="flex items-center justify-between rounded-xl bg-brand-50/70 px-4 py-2.5">
        <span className="text-[12.5px] text-ink-600">Спишется со счёта</span>
        <span
          className={cx(
            "text-[14px] font-bold tabular-nums",
            g ? "text-red-600" : "text-red-500",
          )}
        >
          −{formatAmount(C)}
          {" ₽ "}
          <span className="text-[11px] font-normal text-ink-400">
            {"· останется "}
            {formatMoney(S)}
          </span>
        </span>
      </div>
      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-slate-100 bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 sm:-mx-5">
        <Button variant="secondary" className="flex-1" onClick={n}>
          Отмена
        </Button>
        <Button
          className="flex-[1.6]"
          onClick={y}
          loading={O}
          disabled={g || !l.model || !C}
        >
          {s ? "Сохранить" : "Купить телефон"}
        </Button>
      </div>
      {scannerOpen && <ImeiScanner
        onClose={() => setScannerOpen(false)}
        onConfirm={imei => { b("imei", imei); setScannerOpen(false); }}
      />}
    </div>
  );
}
