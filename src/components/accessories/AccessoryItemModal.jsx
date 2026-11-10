/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import {
  deleteAccessoryItem,
  saveAccessoryItem,
} from "../../domain/accessories.js";
import { useStore } from "../../hooks/useStore.jsx";
import { ACCESSORY_CATEGORY_LABELS } from "../../utils/constants.js";
import { Button, Field, Input, Modal, Select } from "../ui.jsx";
import { Trash2 } from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function AccessoryItemModal({ open: s, item: t, onClose: n }) {
  const { mutate: a } = useStore(),
    [c, r] = React.useState({
      name: "",
      category: "case",
      compatibility: "",
      color: "",
      salePrice: "",
      minStock: 0,
    }),
    [i, o] = React.useState({});
  React.useEffect(() => {
    s &&
      (r({
        id: t == null ? void 0 : t.id,
        name: (t == null ? void 0 : t.name) ?? "",
        category: (t == null ? void 0 : t.category) ?? "case",
        compatibility: (t == null ? void 0 : t.compatibility) ?? "",
        color: (t == null ? void 0 : t.color) ?? "",
        salePrice: (t == null ? void 0 : t.salePrice) ?? "",
        minStock: (t == null ? void 0 : t.minStock) ?? 0,
      }),
      o({}));
  }, [s, t]);
  const l = () => {
    var x;
    const d = a((v) => saveAccessoryItem(v, c));
    d.ok
      ? n()
      : (x = d.error) != null &&
        x.field &&
        o({
          [d.error.field]: d.error.message,
        });
  };
  return (
    <Modal
      open={s}
      onClose={n}
      title={t ? "Изменить товар" : "Новый товар"}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={n}>
            Отмена
          </Button>
          <Button className="flex-[1.6]" onClick={l}>
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <Field label="Название" required={!0} error={i.name}>
          <Input
            value={c.name}
            onChange={(d) =>
              r((x) => ({
                ...x,
                name: d.target.value,
              }))
            }
            placeholder="Например: Чехол iPhone 15"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Категория" required={!0} error={i.category}>
            <Select
              value={c.category}
              onChange={(d) =>
                r((x) => ({
                  ...x,
                  category: d.target.value,
                }))
              }
            >
              {Object.keys(ACCESSORY_CATEGORY_LABELS).map((d) => (
                <option value={d} key={d}>
                  {ACCESSORY_CATEGORY_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Совместимость" hint="Например: iPhone 15, Samsung A55">
            <Input
              value={c.compatibility}
              onChange={(d) =>
                r((x) => ({
                  ...x,
                  compatibility: d.target.value,
                }))
              }
              placeholder="iPhone 15"
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Цвет">
            <Input
              value={c.color}
              onChange={(d) =>
                r((x) => ({
                  ...x,
                  color: d.target.value,
                }))
              }
              placeholder="Чёрный"
            />
          </Field>
          <Field label="Цена продажи" required={!0} error={i.salePrice}>
            <div className="relative">
              <Input
                value={c.salePrice}
                onChange={(d) =>
                  r((x) => ({
                    ...x,
                    salePrice: d.target.value.replace(/[^\d]/g, ""),
                  }))
                }
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
        <Field
          label="Минимальный остаток"
          hint="Ниже этого количества товар помечается «заканчивается»"
          error={i.minStock}
        >
          <Input
            value={String(c.minStock ?? "")}
            onChange={(d) =>
              r((x) => ({
                ...x,
                minStock: d.target.value.replace(/[^\d]/g, ""),
              }))
            }
            placeholder="0"
            inputMode="numeric"
          />
        </Field>
        {t && (
          <button
            type="button"
            onClick={() => {
              (a((d) => deleteAccessoryItem(d, t.id)), n());
            }}
            className="flex items-center gap-1.5 text-[12px] font-medium text-red-500 active:opacity-70"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {" Удалить товар"}
          </button>
        )}
        {!t && (
          <p className="text-[11.5px] text-ink-400">
            После сохранения можно добавить поступление и продавать товар.
          </p>
        )}
      </div>
    </Modal>
  );
}
