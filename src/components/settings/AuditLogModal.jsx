/**
 * Восстановленный модуль PhoneBooks.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { useStore } from "../../hooks/useStore.jsx";
import { formatDateTime } from "../../utils/format.js";
import { Chip, Modal } from "../ui.jsx";
import { jsx, jsxs } from "react/jsx-runtime";
export function AuditLogModal({ open: s, onClose: t }) {
  const { data: n } = useStore();
  return (
    <Modal
      open={s}
      onClose={t}
      title="Журнал изменений"
      description="Все закупки, продажи, отмены и правки"
      size="lg"
    >
      <div className="space-y-2">
        {n.audit.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-400">
            Журнал пока пуст
          </p>
        )}
        {n.audit.slice(0, 100).map((a) => (
          <div
            className="rounded-xl border border-slate-100 px-3 py-2.5"
            key={a.id}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12.5px] font-medium text-ink-900">
                {a.summary}
              </p>
              <span className="shrink-0 text-[10.5px] text-ink-400">
                {formatDateTime(a.at)}
              </span>
            </div>
            {a.details && (
              <p className="mt-0.5 text-[11.5px] text-ink-400">{a.details}</p>
            )}
            <div className="mt-1">
              <Chip
                tone={
                  a.action === "delete" || a.action === "cancel"
                    ? "danger"
                    : a.action === "update"
                      ? "warning"
                      : "info"
                }
              >
                {a.action === "create"
                  ? "создание"
                  : a.action === "update"
                    ? "изменение"
                    : a.action === "cancel"
                      ? "отмена"
                      : a.action === "restore"
                        ? "восстановление"
                        : "удаление"}
              </Chip>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
