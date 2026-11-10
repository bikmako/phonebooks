/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { saveCashOp } from "../../domain/cashOps.js";
import { useStore } from "../../hooks/useStore.jsx";
import { getAccountBalance } from "../../utils/calculations.js";
import { formatMoney, today } from "../../utils/format.js";
import { Button, Field, Input, Modal, Select, cx } from "../ui.jsx";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function CashOpModal({ open: s, op: t, onClose: n, onSaved: a }) {
  var m;
  const { data: c, mutate: r } = useStore(),
    i = c.accounts.filter((f) => !f.archived),
    [o, l] = React.useState({
      kind: "deposit",
      accountId: ((m = i[0]) == null ? void 0 : m.id) ?? "",
      amount: "",
      date: today(),
      comment: "",
    }),
    [d, x] = React.useState({}),
    [v, p] = React.useState(0);
  React.useEffect(() => {
    var f;
    s &&
      (l({
        id: t == null ? void 0 : t.id,
        kind: (t == null ? void 0 : t.kind) ?? "deposit",
        accountId:
          (t == null ? void 0 : t.accountId) ??
          ((f = i[0]) == null ? void 0 : f.id) ??
          "",
        amount: (t == null ? void 0 : t.amount) ?? "",
        date: (t == null ? void 0 : t.date) ?? today(),
        comment: (t == null ? void 0 : t.comment) ?? "",
      }),
      x({}),
      p((C) => C + 1));
  }, [s, t]);
  const w = o.accountId ? getAccountBalance(c, o.accountId) : 0,
    A = Number(o.amount) || 0,
    L =
      o.kind === "withdrawal" &&
      A > w + (t && t.accountId === o.accountId ? t.amount : 0),
    O = () => {
      var C;
      const f = r((S) => saveCashOp(S, o));
      f.ok
        ? a()
        : (C = f.error) != null &&
          C.field &&
          x({
            [f.error.field]: f.error.message,
          });
    };
  return (
    <Modal
      open={s}
      onClose={n}
      title={
        t
          ? "Редактировать операцию"
          : o.kind === "deposit"
            ? "Пополнение счёта"
            : "Снятие со счёта"
      }
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={n}>
            Отмена
          </Button>
          <Button className="flex-[1.6]" onClick={O} disabled={!A || L}>
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5" key={v}>
        <div className="grid grid-cols-2 gap-2">
          {["deposit", "withdrawal"].map((f) => (
            <button
              type="button"
              onClick={() =>
                l((C) => ({
                  ...C,
                  kind: f,
                }))
              }
              className={cx(
                "flex min-h-[52px] items-center justify-center gap-2 rounded-xl border text-[13px] font-semibold transition-colors",
                o.kind === f
                  ? f === "deposit"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-slate-200 text-ink-500",
              )}
              key={f}
            >
              {f === "deposit" ? (
                <ArrowDownLeft className="h-4 w-4" />
              ) : (
                <ArrowUpRight className="h-4 w-4" />
              )}
              {f === "deposit" ? "Пополнение" : "Снятие"}
            </button>
          ))}
        </div>
        <Field label="Счёт" required={!0}>
          <Select
            value={o.accountId}
            onChange={(f) =>
              l((C) => ({
                ...C,
                accountId: f.target.value,
              }))
            }
          >
            {i.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Сумма"
          required={!0}
          error={
            L ? `Недостаточно средств: доступно ${formatMoney(w)}` : d.amount
          }
        >
          <div className="relative">
            <Input
              value={o.amount}
              onChange={(f) =>
                l((C) => ({
                  ...C,
                  amount: f.target.value.replace(/[^\d]/g, ""),
                }))
              }
              inputMode="numeric"
              placeholder="0"
              className="pr-8 text-[17px] font-semibold"
              invalid={L}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400">
              ₽
            </span>
          </div>
        </Field>
        <Field label="Дата" required={!0}>
          <Input
            type="date"
            value={o.date}
            max={today()}
            onChange={(f) =>
              l((C) => ({
                ...C,
                date: f.target.value,
              }))
            }
          />
        </Field>
        <Field label="Комментарий">
          <Input
            value={o.comment}
            onChange={(f) =>
              l((C) => ({
                ...C,
                comment: f.target.value,
              }))
            }
            placeholder={
              o.kind === "deposit" ? "Внесение капитала" : "Вывод прибыли"
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
