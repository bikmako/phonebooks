/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { useStore } from "../../hooks/useStore.jsx";
import { formatAmount, formatMoney } from "../../utils/format.js";
import { Chip, Modal, cx } from "../ui.jsx";
import { jsx, jsxs } from "react/jsx-runtime";
export function AccessoryBatchHistoryModal({ open: s, item: t, onClose: n }) {
  const { data: a } = useStore();
  if (!t) return null;
  const c = a.accessoryBatches
      .filter((o) => o.itemId === t.id)
      .slice()
      .sort((o, l) =>
        o.date === l.date
          ? l.createdAt.localeCompare(o.createdAt)
          : l.date.localeCompare(o.date),
      ),
    r = a.accessorySales
      .filter((o) => o.items.some((l) => l.itemId === t.id))
      .slice()
      .sort((o, l) => l.date.localeCompare(o.date)),
    i = {
      purchase: "Поступление",
      adjust: "Корректировка",
      writeoff: "Списание",
    };
  return (
    <Modal
      open={s}
      onClose={n}
      title={t.name}
      description="История поступлений и продаж"
      size="lg"
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[12px] font-semibold text-ink-500">
            Движения склада
          </p>
          {c.length === 0 && (
            <p className="text-[12.5px] text-ink-400">Поступлений пока нет</p>
          )}
          <ul className="space-y-1.5">
            {c.map((o) => {
              var l;
              return (
                <li
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2"
                  key={o.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink-900">
                      {i[o.kind]}
                      {" · "}
                      {o.date}
                    </p>
                    <p className="truncate text-[11px] text-ink-400">
                      {o.supplierName ||
                        o.comment ||
                        (o.kind === "purchase"
                          ? `Счёт: ${((l = a.accounts.find((d) => d.id === o.accountId)) == null ? void 0 : l.name) ?? "—"}`
                          : "—")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cx(
                        "text-[12.5px] font-semibold tabular-nums",
                        o.kind === "writeoff" ? "text-red-500" : "text-ink-900",
                      )}
                    >
                      {o.kind === "writeoff" ? "−" : "+"}
                      {o.qty}
                      {" шт."}
                    </p>
                    <p className="text-[11px] tabular-nums text-ink-400">
                      {formatMoney(o.unitCost)}
                      {" / шт."}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-semibold text-ink-500">Продажи</p>
          {r.length === 0 && (
            <p className="text-[12.5px] text-ink-400">Продаж пока нет</p>
          )}
          <ul className="space-y-1.5">
            {r.map((o) => {
              const l = o.items.find((d) => d.itemId === t.id);
              return l ? (
                <li
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2"
                  key={o.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink-900">
                      {o.date}
                      {o.status === "cancelled" ? " · отменена" : ""}
                    </p>
                    <p className="truncate text-[11px] text-ink-400">
                      {o.buyerName || "—"}
                      {" · себест. "}
                      {formatMoney(l.unitCost)}/шт.
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12.5px] font-semibold tabular-nums text-ink-900">
                      {l.qty}
                      {" шт. × "}
                      {formatAmount(l.unitPrice)}
                      {" ₽"}
                    </p>
                    <Chip
                      tone={o.status === "completed" ? "success" : "neutral"}
                      className="mt-0.5"
                    >
                      {o.status === "completed"
                        ? `+${formatAmount(l.qty * l.unitPrice)} ₽`
                        : "отменена"}
                    </Chip>
                  </div>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
