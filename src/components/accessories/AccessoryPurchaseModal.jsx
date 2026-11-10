/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import {
  createAccessoryBatch,
  getAccessoryStock,
} from "../../domain/accessories.js";
import { useStore } from "../../hooks/useStore.jsx";
import {
  ACCESSORY_CATEGORY_LABELS,
  PAYMENT_METHODS,
} from "../../utils/constants.js";
import { formatMoney, today } from "../../utils/format.js";
import { Button, Field, Input, Modal, Select } from "../ui.jsx";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function AccessoryPurchaseModal({
  open: s,
  presetItemId: t,
  onClose: n,
}) {
  const { data: a, mutate: c } = useStore(),
    r = a.accounts.filter((M) => !M.archived),
    i = "__new__",
    [o, l] = React.useState(""),
    [d, x] = React.useState({
      name: "",
      category: "case",
      compatibility: "",
      color: "",
      salePrice: "",
    }),
    [v, p] = React.useState(""),
    [w, A] = React.useState(""),
    [L, O] = React.useState(today()),
    [m, f] = React.useState(""),
    [C, S] = React.useState(""),
    [g, b] = React.useState(""),
    [B, y] = React.useState("cash"),
    [j, u] = React.useState({});
  React.useEffect(() => {
    var M, G;
    s &&
      (l(t ?? ((M = a.accessoryItems[0]) == null ? void 0 : M.id) ?? i),
      x({
        name: "",
        category: "case",
        compatibility: "",
        color: "",
        salePrice: "",
      }),
      p(""),
      A(""),
      O(today()),
      f(""),
      S(""),
      b(((G = r[0]) == null ? void 0 : G.id) ?? ""),
      y("cash"),
      u({}));
  }, [s, t]);
  const N = o === i,
    E = (Number(v) || 0) * (Number(w) || 0),
    R = () => {
      var ee;
      const M = {
          itemId: N ? "" : o,
          newItem: N
            ? {
                name: d.name,
                category: d.category,
                compatibility: d.compatibility,
                color: d.color,
                salePrice: d.salePrice,
                minStock: 0,
              }
            : void 0,
          qty: v,
          unitCost: w,
          date: L,
          supplierName: m,
          comment: C,
          accountId: g,
          paymentMethod: B,
        },
        G = c((W) => createAccessoryBatch(W, M));
      G.ok
        ? n()
        : (ee = G.error) != null &&
          ee.field &&
          u({
            [G.error.field]: G.error.message,
          });
    };
  return (
    <Modal
      open={s}
      onClose={n}
      title="Поступление аксессуаров"
      description="Закупка партии: деньги спишутся со счёта, остатки увеличатся"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={n}>
            Отмена
          </Button>
          <Button
            className="flex-[1.6]"
            onClick={R}
            disabled={!v || (!N && !o)}
          >
            {E > 0 ? `Купить · ${formatMoney(E)}` : "Провести"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <Field label="Товар" required={!0} error={j.itemId}>
          <Select value={o} onChange={(M) => l(M.target.value)}>
            {a.accessoryItems.map((M) => (
              <option value={M.id} key={M.id}>
                {M.name}
                {" · остаток "}
                {getAccessoryStock(a, M.id)}
                {" шт."}
              </option>
            ))}
            <option value={i}>＋ Новый товар…</option>
          </Select>
        </Field>
        {N && (
          <div className="space-y-3 rounded-2xl bg-slate-50/80 p-3.5">
            <p className="text-[12px] font-semibold text-ink-500">
              Новый товар
            </p>
            <Field label="Название" required={!0} error={j.name}>
              <Input
                value={d.name}
                onChange={(M) =>
                  x((G) => ({
                    ...G,
                    name: M.target.value,
                  }))
                }
                placeholder="Например: Чехол iPhone 15"
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Категория">
                <Select
                  value={d.category}
                  onChange={(M) =>
                    x((G) => ({
                      ...G,
                      category: M.target.value,
                    }))
                  }
                >
                  {Object.keys(ACCESSORY_CATEGORY_LABELS).map((M) => (
                    <option value={M} key={M}>
                      {ACCESSORY_CATEGORY_LABELS[M]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Совместимость">
                <Input
                  value={d.compatibility}
                  onChange={(M) =>
                    x((G) => ({
                      ...G,
                      compatibility: M.target.value,
                    }))
                  }
                  placeholder="iPhone 15"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Цвет">
                <Input
                  value={d.color}
                  onChange={(M) =>
                    x((G) => ({
                      ...G,
                      color: M.target.value,
                    }))
                  }
                  placeholder="Чёрный"
                />
              </Field>
              <Field label="Цена продажи">
                <Input
                  value={d.salePrice}
                  onChange={(M) =>
                    x((G) => ({
                      ...G,
                      salePrice: M.target.value.replace(/[^\d]/g, ""),
                    }))
                  }
                  placeholder="0"
                  inputMode="numeric"
                />
              </Field>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Количество" required={!0} error={j.qty}>
            <Input
              value={v}
              onChange={(M) => p(M.target.value.replace(/[^\d]/g, ""))}
              placeholder="0"
              inputMode="numeric"
            />
          </Field>
          <Field
            label="Закупочная цена за шт."
            required={!0}
            error={j.unitCost}
          >
            <div className="relative">
              <Input
                value={w}
                onChange={(M) => A(M.target.value.replace(/[^\d]/g, ""))}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Счёт списания" required={!0} error={j.accountId}>
            <Select value={g} onChange={(M) => b(M.target.value)}>
              {r.map((M) => (
                <option value={M.id} key={M.id}>
                  {M.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Способ оплаты">
            <Select value={B} onChange={(M) => y(M.target.value)}>
              {Object.keys(PAYMENT_METHODS).map((M) => (
                <option value={M} key={M}>
                  {PAYMENT_METHODS[M]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Дата" required={!0} error={j.date}>
          <Input
            type="date"
            value={L}
            max={today()}
            onChange={(M) => O(M.target.value)}
          />
        </Field>
        <Field label="Поставщик">
          <Input
            value={m}
            onChange={(M) => f(M.target.value)}
            placeholder="Название или телефон"
          />
        </Field>
        <Field label="Комментарий">
          <Input
            value={C}
            onChange={(M) => S(M.target.value)}
            placeholder="Необязательно"
          />
        </Field>
      </div>
    </Modal>
  );
}
