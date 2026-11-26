import { reservationTypes, returnTypes } from './warehouseTrade.js';
import { warehouseProjection } from './warehouse.js';
import { getAccessorySaleTotals } from './accessories.js';
import { getPhoneTotalCost, getSaleRevenue } from '../utils/calculations.js';
import { roundMoney } from '../utils/format.js';
import { accessoryProductId, phoneProductId } from './inventory.js';

export const OPERATION_VERSION = 1;
export const OPERATION_TYPES = Object.freeze([
  'purchase', 'sale', 'expense', 'repair', 'repair_start', 'customer_return', 'supplier_return',
  'reservation', 'stock_adjustment', 'transfer', 'deposit', 'withdrawal',
]);
const money = value => {
  if (!Number.isFinite(value)) throw new Error('Сумма вне поддерживаемого диапазона');
  const minor = Math.round(roundMoney(value) * 100);
  if (!Number.isSafeInteger(minor)) throw new Error('Сумма вне поддерживаемого диапазона');
  return minor;
};
const line = (productId, quantity, stockDelta = 0, allocations = []) => ({ productId, quantity, stockDelta, allocations });
const posting = (accountId, amount) => amount === 0 ? [] : [{ accountId, amountMinor: amount }];
const identifier = value => typeof value === 'string' && value.length > 0;
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function makeInventoryOperation({
  id, type, date, workspaceId = null, actorId = null, status = 'posted',
  relatedId = null, groupId = null, lines = [], postings = [],
  revenueMinor = 0, costMinor = 0, expenseMinor = 0,
}) {
  const relatedRequired = ['customer_return', 'supplier_return'].includes(type);
  const noMoney = type === 'reservation' || status === 'cancelled';
  if (!identifier(id) || !OPERATION_TYPES.includes(type) || !validDate(date) || !['posted', 'cancelled'].includes(status) ||
    (workspaceId !== null || actorId !== null) && (!identifier(workspaceId) || !identifier(actorId)) ||
    (relatedId !== null && (!identifier(relatedId) || relatedId === id)) || (relatedRequired && relatedId === null) ||
    (groupId !== null && !identifier(groupId)) ||
    ![revenueMinor, costMinor, expenseMinor].every(Number.isSafeInteger) ||
    !Array.isArray(lines) || lines.some(item => !identifier(item?.productId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
      !Number.isSafeInteger(item.stockDelta ?? 0) || Math.abs(item.stockDelta ?? 0) > item.quantity) ||
    !Array.isArray(postings) || postings.some(item => !identifier(item?.accountId) || !Number.isSafeInteger(item.amountMinor) || item.amountMinor === 0) ||
    new Set(postings.map(item => item.accountId)).size !== postings.length ||
    (noMoney && (postings.length || revenueMinor || costMinor || expenseMinor || lines.some(item => item.stockDelta)))) {
    throw new Error('Неверная операция');
  }
  return { version: OPERATION_VERSION, id, type, date, workspaceId, actorId, status, relatedId, groupId,
    lines, postings, revenueMinor, costMinor, expenseMinor };
}

export function projectInventoryOperations(state) {
  const operations = [];
  const add = operation => operations.push(makeInventoryOperation({ ...operation, date: operation.date.slice(0, 10) }));
  const phones = new Map(state.phones.map(phone => [phone.id, phone]));

  for (const phone of state.phones) {
    const lines = [line(phoneProductId(phone.id), 1)];
    add({ id: 'phone:' + phone.id, type: 'purchase', date: phone.purchaseDate, lines: [line(phoneProductId(phone.id), 1, 1)],
      postings: posting(phone.purchaseAccountId, -money(phone.purchasePrice)) });
    for (const repair of phone.repairs ?? []) {
      add({ id: 'repair:' + repair.id, type: 'repair', date: repair.date, lines,
        postings: posting(repair.accountId, -money(repair.amount)) });
    }
    if (phone.status === 'reserved') {
      add({ id: 'reservation:' + phone.id, type: 'reservation', date: (phone.updatedAt ?? phone.createdAt).slice(0, 10), lines });
    }
  }
  for (const sale of state.sales) {
    const revenueMinor = money(getSaleRevenue(sale));
    const phone = phones.get(sale.phoneId);
    const posted = sale.status === 'completed';
    add({ id: 'sale:' + sale.id, type: 'sale', date: sale.date, groupId: 'sale:' + sale.id,
      status: posted ? 'posted' : 'cancelled', lines: [line(phoneProductId(sale.phoneId), 1, posted ? -1 : 0)],
      postings: posting(sale.accountId, revenueMinor), revenueMinor,
      costMinor: posted && phone ? money(getPhoneTotalCost(phone)) : 0 });
  }
  for (const batch of state.accessoryBatches) {
    const purchase = batch.kind === 'purchase';
    add({ id: 'acc_batch:' + batch.id, type: purchase ? 'purchase' : 'stock_adjustment', date: batch.date,
      lines: [line(accessoryProductId(batch.itemId), batch.qty, batch.qty * (batch.kind === 'writeoff' ? -1 : 1))],
      postings: purchase ? posting(batch.accountId, -money(batch.qty * batch.unitCost)) : [],
      expenseMinor: batch.kind === 'writeoff' ? money(batch.qty * batch.unitCost) : 0 });
  }
  for (const sale of state.accessorySales) {
    const posted = sale.status === 'completed';
    const totals = getAccessorySaleTotals(sale);
    const revenueMinor = posted ? money(totals.revenue) : 0;
    add({ id: 'acc_sale:' + sale.id, type: 'sale', date: sale.date,
      groupId: sale.groupId ? 'sale:' + sale.groupId : 'acc_sale:' + sale.id,
      status: posted ? 'posted' : 'cancelled',
      lines: sale.items.map(item => line(accessoryProductId(item.itemId), item.qty, posted ? -item.qty : 0, item.allocations)),
      postings: posting(sale.accountId, revenueMinor), revenueMinor, costMinor: posted ? money(totals.cost) : 0 });
  }
  for (const expense of state.expenses) {
    const expenseMinor = money(expense.amount);
    add({ id: 'expense:' + expense.id, type: 'expense', date: expense.date, expenseMinor,
      postings: posting(expense.accountId, -expenseMinor) });
  }
  for (const transfer of state.transfers) {
    const amount = money(transfer.amount);
    add({ id: 'transfer:' + transfer.id, type: 'transfer', date: transfer.date,
      postings: [...posting(transfer.fromAccountId, -amount), ...posting(transfer.toAccountId, amount)] });
  }
  for (const cash of state.cashOps) {
    add({ id: 'cash:' + cash.id, type: cash.kind, date: cash.date,
      postings: posting(cash.accountId, money(cash.amount) * (cash.kind === 'deposit' ? 1 : -1)) });
  }
  for (const operation of warehouseProjection(state).operations) {
    const correction = returnTypes.includes(operation.type);
    const reservation = reservationTypes.includes(operation.type);
    add({ id: operation.id,
      type: reservation ? 'reservation' : ['compensation', 'void_sale'].includes(operation.type) ? 'customer_return' : operation.type,
      date: operation.date, relatedId: correction ? operation.originalId : null,
      lines: [line(operation.productId, Math.max(operation.units, 1), operation.stockDelta, operation.allocations)],
      postings: posting(operation.accountId, operation.cashMinor), revenueMinor: operation.revenueMinor,
      costMinor: operation.costMinor, expenseMinor: operation.expenseMinor });
    if (correction || reservation) Object.assign(operations.at(-1), {
      tradeMode: operation.type, returnMinor: correction ? operation.amountMinor : 0, reason: operation.reason ?? null,
    });
  }
  return operations;
}

export function summarizeInventoryOperations(operations, { workspaceId = null, actorId } = {}) {
  const accounts = new Map();
  const seen = new Set();
  const saleGroups = new Set();
  let revenueMinor = 0;
  let costMinor = 0;
  let expenseMinor = 0;
  for (const operation of operations) {
    if (operation.workspaceId !== workspaceId || (actorId !== undefined && operation.actorId !== actorId) ||
      operation.status !== 'posted') continue;
    if (seen.has(operation.id)) throw new Error('Повторная операция: ' + operation.id);
    seen.add(operation.id);
    if (operation.type === 'sale') saleGroups.add(operation.groupId ?? operation.id);
    revenueMinor += operation.revenueMinor;
    costMinor += operation.costMinor;
    expenseMinor += operation.expenseMinor;
    for (const { accountId, amountMinor } of operation.postings) {
      accounts.set(accountId, (accounts.get(accountId) ?? 0) + amountMinor);
    }
  }
  const grossProfitMinor = revenueMinor - costMinor;
  const netProfitMinor = grossProfitMinor - expenseMinor;
  if (![revenueMinor, costMinor, expenseMinor, grossProfitMinor, netProfitMinor, ...accounts.values()].every(Number.isSafeInteger)) {
    throw new Error('Итоги вне поддерживаемого диапазона');
  }
  return { accounts, salesCount: saleGroups.size, revenueMinor, costMinor, expenseMinor, grossProfitMinor, netProfitMinor };
}
