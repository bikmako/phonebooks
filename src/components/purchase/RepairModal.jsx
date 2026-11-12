import React from "react";
import { completeRepair, deleteRepair, getRepairSessionId, updateRepair } from "../../domain/repairs.js";
import { useStore } from "../../hooks/useStore.jsx";
import { getAccountBalance } from "../../utils/calculations.js";
import { formatAmount } from "../../utils/format.js";
import { Button, Field, Input, Modal, Select, Textarea } from "../ui.jsx";
const formatMoney = amount => `${formatAmount(amount)} ₽`;

export function RepairModal({ phone, repair, deleting = false, onClose }) {
  const { data, mutatePersisted, notify } = useStore();
  const [amount, setAmount] = React.useState(repair?.amount ?? "");
  const [accountId, setAccountId] = React.useState(repair?.accountId ?? data.accounts.find(account => !account.archived)?.id ?? "");
  const [comment, setComment] = React.useState(repair?.comment ?? "");
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const submitting = React.useRef(false);
  // Capture the session when the dialog opens, never a later repair cycle.
  const sessionId = React.useRef(getRepairSessionId(phone)).current;
  const close = React.useCallback(() => { if (!submitting.current) onClose(); }, [onClose]);
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    const result = await mutatePersisted(state => deleting
      ? deleteRepair(state, phone.id, repair.id)
      : repair
        ? updateRepair(state, phone.id, repair.id, { amount, accountId, comment })
        : completeRepair(state, phone.id, { amount, accountId, comment, sessionId }));
    submitting.current = false; setBusy(false);
    if (result.ok) {
      notify({ title: deleting ? "Ремонт удалён" : repair ? "Ремонт исправлен" : "Ремонт завершён. Телефон на складе", tone: "success" });
      onClose();
    } else setError(result.error?.message ?? "Не удалось сохранить ремонт");
  };
  return <Modal open onClose={close} size="sm"
    title={deleting ? "Удалить ремонт?" : repair ? "Исправить ремонт" : "Завершить ремонт"}
    footer={<div className="flex gap-2">
      <Button variant="secondary" className="flex-1" disabled={busy} onClick={close}>Отмена</Button>
      <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "Сохранение…" : deleting ? "Удалить" : repair ? "Сохранить" : "Завершить ремонт"}</Button>
    </div>}>
    {deleting ? <p className="text-[13px] text-ink-600">Стоимость уменьшится на {formatMoney(repair.amount)}. Сумма вернётся на исходный счёт.</p> : <div className="space-y-3.5">
      <Field label="Стоимость ремонта, ₽" htmlFor="repair-amount" required>
        <Input id="repair-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" disabled={busy} />
      </Field>
      {Number(String(amount).replace(",", ".")) > 0 && <Field label="Счёт списания" htmlFor="repair-account" required
        hint={`Доступно: ${formatMoney(getAccountBalance(data, accountId) + (repair?.accountId === accountId ? repair.amount : 0))}`}>
        <Select id="repair-account" value={accountId} onChange={event => setAccountId(event.target.value)} disabled={busy}>
          <option value="">Выберите счёт</option>
          {data.accounts.filter(account => !account.archived || account.id === repair?.accountId).map(account => <option key={account.id} value={account.id}>{account.name}{account.archived ? " (архив)" : ""}</option>)}
        </Select>
      </Field>}
      <Field label="Комментарий" htmlFor="repair-comment">
        <Textarea id="repair-comment" rows={2} value={comment} onChange={event => setComment(event.target.value)} disabled={busy} />
      </Field>
    </div>}
    {error && <p role="alert" className="mt-3 text-[12px] text-red-600">{error}</p>}
  </Modal>;
}
