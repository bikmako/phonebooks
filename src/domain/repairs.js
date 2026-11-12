import { getAccountBalance, getPhoneTotalCost } from "../utils/calculations.js";
import { formatAmount, today } from "../utils/format.js";
import { assert, clean, getActiveAccount, makeAuditEntry, nowISO, withAudit } from "./shared.js";
const formatMoney = amount => `${formatAmount(amount)} ₽`;

// Old records already in repair need no destructive migration.
export const getRepairSessionId = phone => phone.repairSessionId || `legacy_repair_${phone.id}`;

function repairAmount(value) {
  assert(typeof value === "number" || typeof value === "string", "Укажите стоимость ремонта", "amount");
  const source = String(value).trim().replace(",", ".");
  assert(/^\d+(?:\.\d{1,2})?$/.test(source), "Стоимость ремонта: укажите сумму от 0 с точностью до копеек", "amount");
  const amount = Number(source);
  assert(Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount * 100)), "Некорректная стоимость ремонта", "amount");
  return Math.round(amount * 100) / 100;
}

function buildRepair(state, phone, input, previous) {
  const amount = repairAmount(input.amount);
  const accountId = amount > 0 ? input.accountId : null;
  if (amount > 0) {
    const account = state.accounts.find(account => account.id === accountId);
    // An existing debit may stay on an archived account; new debits may not.
    if (!(previous?.accountId === accountId && amount <= previous.amount && account?.archived)) getActiveAccount(state, accountId);
    const available = getAccountBalance(state, accountId) + (previous?.accountId === accountId ? previous.amount : 0);
    assert(available + 0.001 >= amount, `Недостаточно средств: доступно ${formatMoney(available)}`, "amount");
  }
  assert(Number.isSafeInteger(Math.round((getPhoneTotalCost(phone) - (previous?.amount ?? 0) + amount) * 100)), "Слишком большая себестоимость", "amount");
  return {
    ...previous,
    id: previous?.id ?? getRepairSessionId(phone),
    amount,
    accountId,
    comment: clean(input.comment),
    date: previous?.date ?? today(),
    createdAt: previous?.createdAt ?? nowISO(),
    updatedAt: nowISO(),
  };
}

function replacePhone(state, phone, action, repair, summary, details) {
  return withAudit({ ...state, phones: state.phones.map(item => item.id === phone.id ? phone : item) },
    makeAuditEntry(state, action, "phone", phone.id, summary, `Ремонт ${repair.id}; ${repair.date}; счёт ${repair.accountId ?? "—"}; ${repair.comment}${details ? `; ${details}` : ""}`));
}

export function completeRepair(state, phoneId, input) {
  const phone = state.phones.find(phone => phone.id === phoneId);
  assert(phone, "Телефон не найден");
  assert(phone.status === "repair", "Ремонт уже завершён или телефон не в ремонте");
  assert(input.sessionId === getRepairSessionId(phone), "Этот ремонт уже закрыт. Откройте карточку заново");
  assert(!(phone.repairs ?? []).some(repair => repair.id === input.sessionId), "Ремонт уже завершён");
  const repair = buildRepair(state, phone, input);
  return replacePhone(state, { ...phone, repairs: [...(phone.repairs ?? []), repair], status: "in_stock", repairSessionId: null, updatedAt: nowISO() },
    "create", repair, `Завершён ремонт ${phone.model} · ${formatMoney(repair.amount)}`, repair.comment);
}

export function updateRepair(state, phoneId, repairId, input) {
  const phone = state.phones.find(phone => phone.id === phoneId);
  assert(phone, "Телефон не найден");
  const previous = (phone.repairs ?? []).find(repair => repair.id === repairId);
  assert(previous, "Ремонт не найден");
  const repair = buildRepair(state, phone, input, previous);
  return replacePhone(state, { ...phone, repairs: phone.repairs.map(item => item.id === repairId ? repair : item), updatedAt: nowISO() },
    "update", repair, `Исправлен ремонт ${phone.model} · ${formatMoney(previous.amount)} → ${formatMoney(repair.amount)}`,
    `Было: счёт ${previous.accountId ?? "—"}, ${previous.comment}; стало: счёт ${repair.accountId ?? "—"}, ${repair.comment}`);
}

export function deleteRepair(state, phoneId, repairId) {
  const phone = state.phones.find(phone => phone.id === phoneId);
  assert(phone, "Телефон не найден");
  const repair = (phone.repairs ?? []).find(repair => repair.id === repairId);
  assert(repair, "Ремонт не найден");
  return replacePhone(state, { ...phone, repairs: phone.repairs.filter(item => item.id !== repairId), updatedAt: nowISO() },
    "delete", repair, `Удалён ремонт ${phone.model} · ${formatMoney(repair.amount)}`, "Сумма возвращена на исходный счёт");
}
