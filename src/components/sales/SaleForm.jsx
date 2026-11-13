import { getPhoneTotalCost } from "../../utils/calculations.js";
/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import {
  createCombinedSale,
  estimateAccessoryCost,
  getAccessoryStock,
} from "../../domain/accessories.js";
import { updateSale } from "../../domain/sales.js";
import { useStore } from "../../hooks/useStore.jsx";
import { PAYMENT_METHODS } from "../../utils/constants.js";
import { clearDraft, readDraft, saveDraft, registerUpdateDraft } from "../../utils/drafts.js";
import {
  formatAmount,
  formatMoney,
  formatPhoneInput,
  today,
} from "../../utils/format.js";
import {
  Button,
  Field,
  Input,
  SegmentedTabs,
  Select,
  Textarea,
  cx,
} from "../ui.jsx";
import { PhonePicker } from "./PhonePicker.jsx";
import { PhoneSummaryCard } from "./PhoneSummaryCard.jsx";
import { Calculator, Plus, X as XIcon } from "lucide-react";
import React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
export const SALE_DRAFT_KEY = "sale-new";
export function SaleForm({
  sale: s,
  presetPhoneId: t,
  onDone: n,
  onCancel: a,
}) {
  const { data: c, mutate: r, notify: i } = useStore(),
    o = c.accounts.filter((P) => !P.archived),
    l = c.phones.find((P) => P.id === t),
    d = React.useRef(!1),
    [x, v] = React.useState(() => {
      var P;
      return {
        id: s == null ? void 0 : s.id,
        phoneId: (s == null ? void 0 : s.phoneId) ?? t ?? "",
        buyerName: (s == null ? void 0 : s.buyerName) ?? "",
        buyerPhone: (s == null ? void 0 : s.buyerPhone) ?? "",
        price:
          (s == null ? void 0 : s.price) ??
          ((l == null ? void 0 : l.plannedPrice) || ""),
        discount: (s == null ? void 0 : s.discount) ?? "",
        paymentMethod: (s == null ? void 0 : s.paymentMethod) ?? "cash",
        accountId:
          (s == null ? void 0 : s.accountId) ??
          ((P = o[0]) == null ? void 0 : P.id) ??
          "",
        date: (s == null ? void 0 : s.date) ?? today(),
        comment: (s == null ? void 0 : s.comment) ?? "",
      };
    }),
    [p, w] = React.useState({}),
    [A, L] = React.useState(!1),
    O = !s && !t ? readDraft(SALE_DRAFT_KEY) : null,
    [m, f] = React.useState("phone"),
    [C, S] = React.useState(() => (O == null ? void 0 : O.accLines) ?? []),
    [g, b] = React.useState(() => (O == null ? void 0 : O.accDiscount) ?? ""),
    [B, y] = React.useState(""),
    [j, u] = React.useState(""),
    [N, E] = React.useState("");
  React.useEffect(() => {
    if (!s) return registerUpdateDraft(SALE_DRAFT_KEY, { ...x, accLines: C, accDiscount: g });
  }, [x, s, C, g]);
  (React.useEffect(() => {
    var P, H;
    if (
      !(s || t || d.current || !O) &&
      ((d.current = !0), O.phoneId || ((P = O.accLines) != null && P.length))
    ) {
      const { accLines: me, accDiscount: je, ...tt } = O;
      (v((ge) => ({
        ...ge,
        ...tt,
        id: void 0,
      })),
        (H = O.accLines) != null && H.length && S(O.accLines),
        O.accDiscount && b(O.accDiscount),
        i({
          title: "Черновик продажи восстановлен",
          tone: "info",
        }));
    }
  }, []),
    React.useEffect(() => {
      if (s || !!!(x.phoneId || x.buyerName || x.price || C.length)) return;
      const H = setTimeout(
        () =>
          saveDraft(SALE_DRAFT_KEY, {
            ...x,
            accLines: C,
            accDiscount: g,
          }),
        400,
      );
      return () => clearTimeout(H);
    }, [x, s, C, g]));
  const R = c.phones.find((P) => P.id === x.phoneId),
    M = Number(x.price) || 0,
    G = Number(x.discount) || 0,
    ee = Math.max(0, M - G),
    W = R ? ee - getPhoneTotalCost(R) : 0,
    ie = G > M,
    Q = c.accessoryItems.find((P) => P.id === B),
    V = C.reduce((P, H) => P + H.qty * H.unitPrice, 0),
    _ = Number(g) || 0,
    k = _ > V,
    F = Math.max(0, V - _),
    le = estimateAccessoryCost(c, C),
    X = F - le,
    Me = C.reduce((P, H) => P + H.qty, 0),
    we = ee + F,
    mt = (R && M ? W : 0) + X,
    tn = we > 0 ? Math.round((mt / we) * 100) : 0,
    qt = !!x.phoneId && M > 0 && !ie,
    cs = C.length > 0 && !k,
    Se = (P, H) => {
      (v((me) => ({
        ...me,
        [P]: H,
      })),
        p[P] &&
          w((me) => ({
            ...me,
            [P]: "",
          })));
    },
    ut = React.useMemo(
      () => (R != null && R.plannedPrice ? R.plannedPrice : 0),
      [R],
    ),
    sn = () => {
      var tt;
      const P = Number(j) || 0,
        H = c.accessoryItems.find((ge) => ge.id === B);
      if (!H || P <= 0) return;
      const me = getAccessoryStock(c, H.id),
        je =
          ((tt = C.find((ge) => ge.itemId === H.id)) == null
            ? void 0
            : tt.qty) ?? 0;
      if (P + je > me) {
        w((ge) => ({
          ...ge,
          items: `«${H.name}»: доступно ${me - je} шт.`,
        }));
        return;
      }
      (S((ge) =>
        ge.find((Ye) => Ye.itemId === H.id)
          ? ge.map((Ye) =>
              Ye.itemId === H.id
                ? {
                    ...Ye,
                    qty: Ye.qty + P,
                  }
                : Ye,
            )
          : [
              ...ge,
              {
                itemId: H.id,
                qty: P,
                unitPrice: Number(N) || H.salePrice || 0,
              },
            ],
      ),
        u(""),
        w((ge) => ({
          ...ge,
          items: "",
        })));
    },
    nn = s
      ? !!x.phoneId && M > 0 && !ie && !!x.accountId && ee > 0
      : ((qt && ee > 0) || cs) && !!x.accountId,
    an = () => {
      var H;
      L(!0);
      const P = r(
        s
          ? (me) => updateSale(me, x)
          : (me) =>
              createCombinedSale(me, {
                sale: qt ? x : void 0,
                acc: cs
                  ? {
                      items: C.map((je) => ({
                        itemId: je.itemId,
                        qty: je.qty,
                        unitPrice: je.unitPrice,
                      })),
                      discount: g || 0,
                      accountId: x.accountId,
                      paymentMethod: x.paymentMethod,
                      buyerName: x.buyerName,
                      date: x.date,
                      comment: x.comment,
                    }
                  : void 0,
              }),
      );
      (L(!1),
        P.ok
          ? (s || clearDraft(SALE_DRAFT_KEY), n())
          : (H = P.error) != null &&
            H.field &&
            w({
              [P.error.field]: P.error.message,
            }));
    };
  return (
    <div className="space-y-4" data-update-dirty="true">
      {!s && (
        <SegmentedTabs
          fullWidth={!0}
          value={m}
          onChange={f}
          options={[
            {
              value: "phone",
              label: "Телефон",
            },
            {
              value: "acc",
              label: C.length ? `Аксессуары · ${C.length}` : "Аксессуары",
            },
          ]}
        />
      )}
      {(s || m === "phone") && (
        <Fragment>
          <Field label="Телефон со склада" required={!s} error={p.phoneId}>
            <PhonePicker
              data={c}
              selectedId={x.phoneId}
              onSelect={(P) => {
                (v((H) => ({
                  ...H,
                  phoneId: P.id,
                  price: H.price || P.plannedPrice || "",
                })),
                  w((H) => ({
                    ...H,
                    phoneId: "",
                  })));
              }}
            />
          </Field>
          {R && <PhoneSummaryCard data={c} phone={R} price={ee} />}
          <div className="rounded-2xl bg-slate-50/80 p-3.5">
            <p className="mb-2.5 text-[12px] font-semibold text-ink-500">
              Покупатель
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Имя покупателя" htmlFor="buyer">
                <Input
                  id="buyer"
                  value={x.buyerName}
                  onChange={(P) => Se("buyerName", P.target.value)}
                  placeholder="Клиент"
                />
              </Field>
              <Field
                label="Телефон покупателя"
                htmlFor="buyer-phone"
                error={p.buyerPhone}
              >
                <Input
                  id="buyer-phone"
                  value={x.buyerPhone}
                  onChange={(P) =>
                    Se("buyerPhone", formatPhoneInput(P.target.value))
                  }
                  placeholder="+7 900 000-00-00"
                  inputMode="tel"
                />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Цена продажи"
              required={!0}
              htmlFor="sale-price"
              error={p.price}
            >
              <div className="relative">
                <Input
                  id="sale-price"
                  value={x.price}
                  onChange={(P) =>
                    Se("price", P.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="0"
                  inputMode="numeric"
                  className="pr-8 font-semibold"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400">
                  ₽
                </span>
              </div>
            </Field>
            <Field
              label="Скидка"
              htmlFor="sale-discount"
              error={ie ? "Скидка больше цены" : p.discount}
            >
              <div className="relative">
                <Input
                  id="sale-discount"
                  value={x.discount}
                  onChange={(P) =>
                    Se("discount", P.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="0"
                  inputMode="numeric"
                  className="pr-8"
                  invalid={ie}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400">
                  ₽
                </span>
              </div>
            </Field>
          </div>
          {ut > 0 && M !== ut && (
            <button
              type="button"
              onClick={() => Se("price", ut)}
              className="-mt-2 text-left text-[12px] font-medium text-brand-600"
            >
              {"Вернуть плановую цену "}
              {formatMoney(ut)}
            </button>
          )}
        </Fragment>
      )}
      {!s && m === "acc" && (
        <div className="space-y-3">
          <Field
            label="Товар"
            hint={
              Q
                ? `Доступно ${getAccessoryStock(c, Q.id)} шт. · цена ${formatMoney(Q.salePrice)}`
                : "Выберите аксессуар со склада"
            }
            error={p.items}
          >
            <Select
              value={B}
              onChange={(P) => {
                const H = P.target.value;
                y(H);
                const me = c.accessoryItems.find((je) => je.id === H);
                (me && E(String(me.salePrice || "")),
                  w((je) => ({
                    ...je,
                    items: "",
                  })));
              }}
            >
              <option value="">— Выберите товар —</option>
              {c.accessoryItems.map((P) => (
                <option
                  value={P.id}
                  disabled={getAccessoryStock(c, P.id) <= 0}
                  key={P.id}
                >
                  {P.name}
                  {" · "}
                  {getAccessoryStock(c, P.id)}
                  {" шт."}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Количество" htmlFor="acc-qty">
              <Input
                id="acc-qty"
                value={j}
                onChange={(P) => u(P.target.value.replace(/[^\d]/g, ""))}
                placeholder="1"
                inputMode="numeric"
              />
            </Field>
            <Field label="Цена за шт." htmlFor="acc-price">
              <div className="relative">
                <Input
                  id="acc-price"
                  value={N}
                  onChange={(P) => E(P.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  inputMode="numeric"
                  className="pr-8"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400">
                  ₽
                </span>
              </div>
            </Field>
          </div>
          <Button
            variant="secondary"
            className="w-full"
            icon={<Plus className="h-4 w-4" />}
            disabled={!B || !(Number(j) > 0)}
            onClick={sn}
          >
            Добавить в чек
          </Button>
          {C.length > 0 && (
            <ul className="space-y-1.5">
              {C.map((P, H) => {
                const me = c.accessoryItems.find((je) => je.id === P.itemId);
                return (
                  <li
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2"
                    key={P.itemId}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink-900">
                        {(me == null ? void 0 : me.name) ?? P.itemId}
                      </p>
                      <p className="text-[11px] tabular-nums text-ink-400">
                        {P.qty}
                        {" шт. × "}
                        {formatAmount(P.unitPrice)}
                        {" ₽"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold tabular-nums text-ink-900">
                        {formatAmount(P.qty * P.unitPrice)}
                        {" ₽"}
                      </span>
                      <button
                        type="button"
                        aria-label="Убрать позицию"
                        onClick={() =>
                          S((je) => je.filter((tt, ge) => ge !== H))
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-400 active:bg-slate-100"
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Скидка на аксессуары"
              htmlFor="acc-discount"
              error={k ? "Скидка больше суммы" : ""}
            >
              <div className="relative">
                <Input
                  id="acc-discount"
                  value={g}
                  onChange={(P) => b(P.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  inputMode="numeric"
                  className="pr-8"
                  invalid={k}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400">
                  ₽
                </span>
              </div>
            </Field>
            <Field label="Покупатель" htmlFor="acc-buyer">
              <Input
                id="acc-buyer"
                value={x.buyerName}
                onChange={(P) => Se("buyerName", P.target.value)}
                placeholder="Клиент"
              />
            </Field>
          </div>
          {C.length > 0 && (
            <p className="text-[11.5px] text-ink-400">
              {"Аксессуары: "}
              {Me}
              {" шт. · себестоимость "}
              {formatMoney(le)}
              {" · прибыль "}
              {formatMoney(X)}
            </p>
          )}
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 p-3.5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-ink-600">
            К получению{C.length && qt ? " (телефон + аксессуары)" : ""}
          </span>
          <span className="text-[16px] font-bold tabular-nums text-ink-900">
            {formatMoney(we)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-1.5 text-ink-600">
            <Calculator className="h-3.5 w-3.5" />{" "}
            {C.length ? "Прибыль" : "Прибыль с устройства"}
          </span>
          <span
            className={cx(
              "font-bold tabular-nums",
              mt >= 0 ? "text-emerald-600" : "text-red-500",
            )}
          >
            {(R && ee > 0) || C.length > 0
              ? `${mt >= 0 ? "+" : ""}${formatAmount(mt)} ₽ · ${tn}%`
              : "—"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Счёт зачисления"
          required={!0}
          htmlFor="sale-account"
          error={p.accountId}
        >
          <Select
            id="sale-account"
            value={x.accountId}
            onChange={(P) => Se("accountId", P.target.value)}
          >
            {o.map((P) => (
              <option value={P.id} key={P.id}>
                {P.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Способ оплаты" htmlFor="sale-pay">
          <Select
            id="sale-pay"
            value={x.paymentMethod}
            onChange={(P) => Se("paymentMethod", P.target.value)}
          >
            {Object.keys(PAYMENT_METHODS).map((P) => (
              <option value={P} key={P}>
                {PAYMENT_METHODS[P]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Дата продажи"
        required={!0}
        htmlFor="sale-date"
        error={p.date}
      >
        <Input
          id="sale-date"
          type="date"
          value={x.date}
          max={today()}
          onChange={(P) => Se("date", P.target.value)}
        />
      </Field>
      <Field label="Комментарий" htmlFor="sale-comment">
        <Textarea
          id="sale-comment"
          value={x.comment}
          onChange={(P) => Se("comment", P.target.value)}
          placeholder="Гарантия, проверка, договорённости…"
          rows={2}
        />
      </Field>
      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-slate-100 bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <Button variant="secondary" className="flex-1" onClick={a}>
          Отмена
        </Button>
        <Button className="flex-[1.6]" onClick={an} loading={A} disabled={!nn}>
          {s ? "Сохранить" : "Продать"}
        </Button>
      </div>
    </div>
  );
}
