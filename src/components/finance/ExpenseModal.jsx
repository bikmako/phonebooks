/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { saveExpense } from "../../domain/expenses.js";
import { useStore } from "../../hooks/useStore.jsx";
import { getAccountBalance } from "../../utils/calculations.js";
import { EXPENSE_CATEGORY_SHORT } from "../../utils/constants.js";
import { formatMoney, today } from "../../utils/format.js";
import { Button, Field, Input, Modal, Select, Textarea, cx } from "../ui.jsx";
import { ExpenseCategoryIcon } from "./FinanceParts.jsx";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function ExpenseModal({
  open: s,
  expense: t,
  preset: n,
  presetAmount: a,
  onClose: c,
  onSaved: r,
}) {
  var C;
  const { data: i, mutate: o } = useStore(),
    l = i.accounts.filter((S) => !S.archived),
    [d, x] = React.useState({
      category: n ?? "rent",
      amount: a || "",
      accountId: ((C = l[0]) == null ? void 0 : C.id) ?? "",
      date: today(),
      vendor: "",
      comment: "",
    }),
    [v, p] = React.useState({}),
    [w, A] = React.useState(0);
  React.useEffect(() => {
    var S;
    s &&
      (x({
        id: t == null ? void 0 : t.id,
        category: (t == null ? void 0 : t.category) ?? n ?? "rent",
        amount: (t == null ? void 0 : t.amount) ?? (a || ""),
        accountId:
          (t == null ? void 0 : t.accountId) ??
          ((S = l[0]) == null ? void 0 : S.id) ??
          "",
        date: (t == null ? void 0 : t.date) ?? today(),
        vendor: (t == null ? void 0 : t.vendor) ?? "",
        comment: (t == null ? void 0 : t.comment) ?? "",
      }),
      p({}),
      A((g) => g + 1));
  }, [s, t, n]);
  const L = d.accountId ? getAccountBalance(i, d.accountId) : 0,
    O = Number(d.amount) || 0,
    m = O > L + (t && t.accountId === d.accountId ? t.amount : 0),
    f = () => {
      var g;
      const S = o((b) => saveExpense(b, d));
      S.ok
        ? r()
        : (g = S.error) != null &&
          g.field &&
          p({
            [S.error.field]: S.error.message,
          });
    };
  return (
    <Modal
      open={s}
      onClose={c}
      title={t ? "Редактировать расход" : "Новый расход"}
      description="Деньги спишутся с выбранного счёта"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={c}>
            Отмена
          </Button>
          <Button className="flex-[1.6]" onClick={f} disabled={!O || m}>
            {t ? "Сохранить" : "Добавить расход"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5" key={w}>
        <Field label="Категория">
          <div className="grid grid-cols-3 gap-2">
            {Object.keys(EXPENSE_CATEGORY_SHORT).map((S) => (
              <button
                type="button"
                onClick={() =>
                  x((g) => ({
                    ...g,
                    category: S,
                  }))
                }
                className={cx(
                  "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[10.5px] font-medium leading-tight transition-colors",
                  d.category === S
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-ink-600",
                )}
                key={S}
              >
                <ExpenseCategoryIcon
                  category={S}
                  className="h-4.5 w-4.5 shrink-0"
                />
                <span className="text-center">{EXPENSE_CATEGORY_SHORT[S]}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Сумма"
          required={!0}
          error={
            m ? `Недостаточно средств: доступно ${formatMoney(L)}` : v.amount
          }
        >
          <div className="relative">
            <Input
              value={d.amount}
              onChange={(S) =>
                x((g) => ({
                  ...g,
                  amount: S.target.value.replace(/[^\d]/g, ""),
                }))
              }
              inputMode="numeric"
              placeholder="0"
              className="pr-8 text-[17px] font-semibold"
              invalid={m}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400">
              ₽
            </span>
          </div>
        </Field>
        <Field
          label="Счёт списания"
          required={!0}
          hint={
            d.accountId
              ? `Доступно: ${formatMoney(getAccountBalance(i, d.accountId))}`
              : void 0
          }
        >
          <Select
            value={d.accountId}
            onChange={(S) =>
              x((g) => ({
                ...g,
                accountId: S.target.value,
              }))
            }
          >
            {l.map((S) => (
              <option value={S.id} key={S.id}>
                {S.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Дата" required={!0}>
          <Input
            type="date"
            value={d.date}
            max={today()}
            onChange={(S) =>
              x((g) => ({
                ...g,
                date: S.target.value,
              }))
            }
          />
        </Field>
        <Field label="Контрагент / получатель">
          <Input
            value={d.vendor}
            onChange={(S) =>
              x((g) => ({
                ...g,
                vendor: S.target.value,
              }))
            }
            placeholder="ИП Смирнов"
          />
        </Field>
        <Field label="Комментарий">
          <Textarea
            value={d.comment}
            onChange={(S) =>
              x((g) => ({
                ...g,
                comment: S.target.value,
              }))
            }
            rows={2}
            placeholder="За что расход"
          />
        </Field>
      </div>
    </Modal>
  );
}
