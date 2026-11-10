/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { saveTransfer } from "../../domain/transfers.js";
import { useStore } from "../../hooks/useStore.jsx";
import { getAccountBalance } from "../../utils/calculations.js";
import { formatMoney, today } from "../../utils/format.js";
import { Button, Field, Input, Modal, Select } from "../ui.jsx";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function TransferModal({
  open: s,
  transfer: t,
  onClose: n,
  onSaved: a,
}) {
  var C, S;
  const { data: c, mutate: r } = useStore(),
    i = c.accounts.filter((g) => !g.archived),
    [o, l] = React.useState({
      fromAccountId: ((C = i[0]) == null ? void 0 : C.id) ?? "",
      toAccountId: ((S = i[1]) == null ? void 0 : S.id) ?? "",
      amount: "",
      date: today(),
      comment: "",
    }),
    [d, x] = React.useState({}),
    [v, p] = React.useState(0);
  React.useEffect(() => {
    var g, b;
    s &&
      (l({
        id: t == null ? void 0 : t.id,
        fromAccountId:
          (t == null ? void 0 : t.fromAccountId) ??
          ((g = i[0]) == null ? void 0 : g.id) ??
          "",
        toAccountId:
          (t == null ? void 0 : t.toAccountId) ??
          ((b = i[1]) == null ? void 0 : b.id) ??
          "",
        amount: (t == null ? void 0 : t.amount) ?? "",
        date: (t == null ? void 0 : t.date) ?? today(),
        comment: (t == null ? void 0 : t.comment) ?? "",
      }),
      x({}),
      p((B) => B + 1));
  }, [s, t]);
  const w = o.fromAccountId ? getAccountBalance(c, o.fromAccountId) : 0,
    A = Number(o.amount) || 0,
    L = w + (t && t.fromAccountId === o.fromAccountId ? t.amount : 0),
    O = A > L,
    m = o.fromAccountId === o.toAccountId,
    f = () => {
      var b;
      const g = r((B) => saveTransfer(B, o));
      g.ok
        ? a()
        : (b = g.error) != null &&
          b.field &&
          x({
            [g.error.field]: g.error.message,
          });
    };
  return (
    <Modal
      open={s}
      onClose={n}
      title={t ? "Редактировать перевод" : "Перевод между счетами"}
      description="Перевод не влияет на прибыль — деньги просто меняют место"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={n}>
            Отмена
          </Button>
          <Button className="flex-[1.6]" onClick={f} disabled={!A || O || m}>
            {t ? "Сохранить" : "Перевести"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5" key={v}>
        <Field
          label="Со счёта"
          required={!0}
          hint={
            o.fromAccountId
              ? `Доступно: ${formatMoney(getAccountBalance(c, o.fromAccountId))}`
              : void 0
          }
        >
          <Select
            value={o.fromAccountId}
            onChange={(g) =>
              l((b) => ({
                ...b,
                fromAccountId: g.target.value,
              }))
            }
          >
            {i.map((g) => (
              <option value={g.id} key={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="На счёт"
          required={!0}
          error={m ? "Выберите разные счета" : d.toAccountId}
        >
          <Select
            value={o.toAccountId}
            onChange={(g) =>
              l((b) => ({
                ...b,
                toAccountId: g.target.value,
              }))
            }
          >
            {i.map((g) => (
              <option value={g.id} key={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Сумма"
          required={!0}
          error={O ? `Недостаточно: доступно ${formatMoney(L)}` : d.amount}
        >
          <div className="relative">
            <Input
              value={o.amount}
              onChange={(g) =>
                l((b) => ({
                  ...b,
                  amount: g.target.value.replace(/[^\d]/g, ""),
                }))
              }
              inputMode="numeric"
              placeholder="0"
              className="pr-8 text-[17px] font-semibold"
              invalid={O}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400">
              ₽
            </span>
          </div>
        </Field>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12px] text-ink-500">
          <span>Доступно к переводу</span>
          <span className="font-semibold tabular-nums text-ink-900">
            {formatMoney(L)}
          </span>
        </div>
        <Field label="Дата" required={!0}>
          <Input
            type="date"
            value={o.date}
            max={today()}
            onChange={(g) =>
              l((b) => ({
                ...b,
                date: g.target.value,
              }))
            }
          />
        </Field>
        <Field label="Комментарий">
          <Input
            value={o.comment}
            onChange={(g) =>
              l((b) => ({
                ...b,
                comment: g.target.value,
              }))
            }
            placeholder="Например: снятие на закупки"
          />
        </Field>
      </div>
    </Modal>
  );
}
