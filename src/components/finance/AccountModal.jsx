/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { saveAccount, setAccountArchived } from "../../domain/accounts.js";
import { useStore } from "../../hooks/useStore.jsx";
import { ACCOUNT_COLORS } from "../../utils/constants.js";
import { Button, Field, Input, Modal, Switch, cx } from "../ui.jsx";
import { Landmark, Wallet } from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function AccountModal({ open: s, account: t, onClose: n, onSaved: a }) {
  const { data: c, mutate: r } = useStore(),
    [i, o] = React.useState({
      name: "",
      type: "cash",
      openingBalance: "",
      color: ACCOUNT_COLORS[0],
    }),
    [l, d] = React.useState(0);
  React.useEffect(() => {
    s &&
      (o({
        id: t == null ? void 0 : t.id,
        name: (t == null ? void 0 : t.name) ?? "",
        type: (t == null ? void 0 : t.type) ?? "cash",
        openingBalance: (t == null ? void 0 : t.openingBalance) ?? "",
        color: (t == null ? void 0 : t.color) ?? ACCOUNT_COLORS[0],
      }),
      d((p) => p + 1));
  }, [s, t]);
  const x = () => {
      r((w) => saveAccount(w, i)).ok && a();
    },
    v = t
      ? c.phones.some((p) => p.purchaseAccountId === t.id) ||
        c.sales.some((p) => p.accountId === t.id) ||
        c.expenses.some((p) => p.accountId === t.id) ||
        c.transfers.some(
          (p) => p.fromAccountId === t.id || p.toAccountId === t.id,
        ) ||
        c.cashOps.some((p) => p.accountId === t.id)
      : !1;
  return (
    <Modal
      open={s}
      onClose={n}
      title={t ? "Изменить счёт" : "Новый счёт"}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={n}>
            Отмена
          </Button>
          <Button
            className="flex-[1.6]"
            onClick={x}
            disabled={i.name.trim().length < 2}
          >
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5" key={l}>
        <Field label="Название" required={!0}>
          <Input
            value={i.name}
            onChange={(p) =>
              o((w) => ({
                ...w,
                name: p.target.value,
              }))
            }
            placeholder="Например: Сбербанк"
          />
        </Field>
        <Field label="Тип">
          <div className="grid grid-cols-2 gap-2">
            {["cash", "bank"].map((p) => (
              <button
                type="button"
                onClick={() =>
                  o((w) => ({
                    ...w,
                    type: p,
                  }))
                }
                className={cx(
                  "flex min-h-[48px] items-center justify-center gap-2 rounded-xl border text-[13px] font-medium",
                  i.type === p
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-ink-600",
                )}
                key={p}
              >
                {p === "cash" ? (
                  <Wallet className="h-4 w-4" />
                ) : (
                  <Landmark className="h-4 w-4" />
                )}
                {p === "cash" ? "Касса" : "Банковский счёт"}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Стартовый остаток"
          hint={
            v
              ? "По счёту есть операции — остаток меняется через «Пополнение»"
              : "Сколько денег на счёте сейчас"
          }
        >
          <div className="relative">
            <Input
              value={
                v
                  ? String((t == null ? void 0 : t.openingBalance) ?? 0)
                  : i.openingBalance
              }
              onChange={(p) =>
                o((w) => ({
                  ...w,
                  openingBalance: p.target.value
                    .replace(/^\D*-/, "-")
                    .replace(/[^\d-]/g, ""),
                }))
              }
              inputMode="numeric"
              placeholder="0"
              className="pr-8"
              disabled={v}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400">
              ₽
            </span>
          </div>
        </Field>
        <Field label="Цвет">
          <div className="flex gap-2">
            {ACCOUNT_COLORS.map((p) => (
              <button
                type="button"
                onClick={() =>
                  o((w) => ({
                    ...w,
                    color: p,
                  }))
                }
                className={cx(
                  "h-9 w-9 rounded-full transition-transform",
                  i.color === p
                    ? "scale-110 ring-2 ring-offset-2 ring-ink-900"
                    : "",
                )}
                style={{
                  background: p,
                }}
                aria-label={`Цвет ${p}`}
                key={p}
              />
            ))}
          </div>
        </Field>
        {t && (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3">
            <div>
              <p className="text-[12.5px] font-medium text-ink-700">
                Скрыть из выбора
              </p>
              <p className="text-[11px] text-ink-400">
                Архивировать можно только счёт с нулевым остатком
              </p>
            </div>
            <Switch
              checked={t.archived}
              onChange={(p) => {
                r((A) => setAccountArchived(A, t.id, p)).ok && n();
              }}
            />
          </div>
        )}
        <p className="text-[11.5px] text-ink-400">
          Итоговый баланс = стартовый остаток + продажи + пополнения − закупки −
          расходы − переводы.
        </p>
      </div>
    </Modal>
  );
}
