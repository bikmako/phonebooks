/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import {
  adjustAccessoryStock,
  getAccessoryStock,
} from "../../domain/accessories.js";
import { useStore } from "../../hooks/useStore.jsx";
import { formatMoney } from "../../utils/format.js";
import { Button, Field, Input, Modal, cx } from "../ui.jsx";
import { Minus, Plus } from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function AccessoryAdjustModal({ open: s, item: t, onClose: n }) {
  var m;
  const { data: a, mutate: c } = useStore(),
    [r, i] = React.useState(""),
    [o, l] = React.useState(""),
    [d, x] = React.useState(""),
    [v, p] = React.useState({});
  if (
    (React.useEffect(() => {
      s && t && (i(""), l(""), x(""), p({}));
    }, [s, t]),
    !t)
  )
    return null;
  const w = getAccessoryStock(a, t.id),
    A = Number(r) || 0,
    L =
      ((m = a.accessoryBatches.find(
        (f) => f.itemId === t.id && f.unitCost > 0,
      )) == null
        ? void 0
        : m.unitCost) ?? 0,
    O = () => {
      var C;
      const f = c((S) =>
        adjustAccessoryStock(S, {
          itemId: t.id,
          delta: r,
          unitCost: o === "" && A > 0 ? String(L) : o,
          comment: d,
        }),
      );
      f.ok
        ? n()
        : (C = f.error) != null &&
          C.field &&
          p({
            [f.error.field]: f.error.message,
          });
    };
  return (
    <Modal
      open={s}
      onClose={n}
      title="Изменить количество"
      description={`${t.name} · сейчас ${w} шт. на складе`}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={n}>
            Отмена
          </Button>
          <Button
            className="flex-[1.6]"
            onClick={O}
            disabled={!A || (A < 0 && -A > w)}
          >
            Применить
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="flex flex-wrap gap-2">
          {[-10, -5, -1, 1, 5, 10].map((f) => (
            <button
              type="button"
              onClick={() => i((C) => String((Number(C) || 0) + f))}
              className={cx(
                "flex min-h-[44px] min-w-[56px] items-center justify-center gap-1 rounded-xl border text-[13px] font-semibold",
                f < 0
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}
              key={f}
            >
              {f < 0 ? (
                <Minus className="h-3.5 w-3.5" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {Math.abs(f)}
            </button>
          ))}
        </div>
        <Field
          label="Изменение, шт."
          required={!0}
          hint="+ добавить на склад, − списать"
          error={v.delta}
        >
          <Input
            value={r}
            onChange={(f) => i(f.target.value.replace(/[+-]?\D/g, ""))}
            placeholder="0"
            inputMode="numeric"
          />
        </Field>
        {A > 0 && (
          <Field
            label="Себестоимость за шт."
            hint={
              o === "" ? `Подставится последняя: ${formatMoney(L)}` : void 0
            }
            error={v.unitCost}
          >
            <div className="relative">
              <Input
                value={o}
                onChange={(f) => l(f.target.value.replace(/[^\d]/g, ""))}
                placeholder={String(L || 0)}
                inputMode="numeric"
                className="pr-8"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400">
                ₽
              </span>
            </div>
          </Field>
        )}
        {A < 0 && -A > w && (
          <p className="text-[12px] text-red-500">
            {"Недостаточно остатка: есть "}
            {w}
            {" шт., нужно "}
            {Math.abs(A)}
            {" шт."}
          </p>
        )}
        <Field label="Причина">
          <Input
            value={d}
            onChange={(f) => x(f.target.value)}
            placeholder="Инвентаризация, порча…"
          />
        </Field>
      </div>
    </Modal>
  );
}
