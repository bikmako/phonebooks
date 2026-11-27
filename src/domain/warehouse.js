import { assert, makeAuditEntry, withAudit } from './shared.js';
import { legacyFinancialEvents } from './legacyTradeState.js';
import { activeReservations, assertReturn, portion, reservationTypes, returnTypes } from './warehouseTrade.js';
import { today } from '../utils/format.js';

export const warehouseLabels = {
  opening: 'Начальный остаток', historical_sale: 'Историческая продажа', historical_expense: 'Исторический расход', expense: 'Расход',
  purchase: 'Закупка товара', sale: 'Продажа товара', repair_start: 'Передача в ремонт', repair: 'Завершение ремонта',
  customer_return: 'Возврат покупателя', supplier_return: 'Возврат поставщику', compensation: 'Денежная компенсация',
  void_sale: 'Отмена продажи', reserve: 'Бронирование', extend_reserve: 'Продление бронирования', cancel_reserve: 'Отмена бронирования',
};
export function parseMinor(value) {
  const match = /^(\d{1,9})(?:[,.](\d{1,2}))?$/.exec(String(value).trim());
  assert(match, 'Введите сумму в рублях с точностью до копеек.');
  const result = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  assert(result <= 10_000_000_000, 'Сумма превышает поддерживаемый предел.');
  return result;
}
const safe = value => {
  assert(Number.isSafeInteger(value), 'Сумма или остаток вне поддерживаемого диапазона.');
  return value;
};
const empty = { lots: [], quantity: 0, inRepair: false, purchased: false, stockCostMinor: 0 };
const cache = new WeakMap();
const noEntries = [];

function takeLots(item, count, eligible = () => true) {
  let units = count;
  const allocations = [];
  for (const lot of item.lots) {
    if (!eligible(lot) || units === 0) continue;
    const quantity = Math.min(units, lot.quantity);
    const costMinor = portion(lot.costMinor, quantity, lot.quantity);
    allocations.push({ sourceId: lot.sourceId, quantity, costMinor });
    lot.quantity -= quantity;
    lot.costMinor -= costMinor;
    units -= quantity;
  }
  assert(units === 0, 'В указанной партии недостаточно товара.');
  item.lots = item.lots.filter(lot => lot.quantity > 0);
  return allocations;
}
const totalCost = allocations => safe(allocations.reduce((sum, item) => sum + item.costMinor, 0));

function addLot(item, event, quantity, costMinor, sourceId = event.id, index = 0) {
  item.lots.push({ id: index ? event.id + ':' + index : event.id, sourceId, productId: event.productId,
    quantity, costMinor, date: event.date, createdAt: event.createdAt });
}

function restoreLots(item, event, original, skipped) {
  let remaining = event.units;
  let index = 0;
  const restored = [];
  for (const allocation of original.allocations) {
    const from = Math.min(skipped, allocation.quantity);
    const count = Math.min(remaining, allocation.quantity - from);
    skipped -= from;
    if (!count) continue;
    const costMinor = portion(allocation.costMinor, from + count, allocation.quantity) -
      portion(allocation.costMinor, from, allocation.quantity);
    addLot(item, event, count, costMinor, allocation.sourceId, ++index);
    restored.push({ quantity: count, costMinor, sourceId: allocation.sourceId });
    remaining -= count;
  }
  assert(remaining === 0, 'Себестоимость исходной продажи недоступна.');
  return restored;
}

function apply(context, event) {
  const { products, operations, byId, bookings, corrected } = context;
  const { productId, type, tracking, units, amountMinor } = event;
  if (['historical_expense', 'expense', 'historical_sale'].includes(type)) {
    const historySale = type === 'historical_sale';
    const detail = { ...event, cashMinor: type === 'expense' ? -amountMinor : 0, stockDelta: 0,
      revenueMinor: historySale ? amountMinor : 0, costMinor: historySale ? event.sourceCostMinor : 0,
      expenseMinor: historySale ? 0 : amountMinor, allocations: [] };
    operations.push(detail);
    byId.set(event.id, detail);
    return;
  }
  const item = products.get(productId) ?? { ...empty, lots: [] };
  const unit = tracking === 'unit';
  const at = Date.parse(event.createdAt);
  const active = activeReservations(bookings, productId, at);
  const reserved = active.reduce((sum, booking) => sum + booking.quantity, 0);
  let stockDelta = 0;
  let costMinor = 0;
  let cashMinor = 0;
  let revenueMinor = 0;
  let expenseMinor = 0;
  let allocations = [];
  if (type === 'purchase' || type === 'opening') {
    assert(!unit || (!item.purchased && units === 1), 'Для следующего поштучного товара создайте отдельную карточку.');
    stockDelta = units;
    cashMinor = type === 'purchase' ? -amountMinor : 0;
    item.purchased = true;
    addLot(item, event, units, amountMinor);
  } else if (type === 'sale') {
    const booking = active.find(entry => entry.id === event.reservationId);
    if (event.reservationId) {
      assert(booking && units <= booking.quantity && amountMinor === safe(booking.unitMinor * units),
        'Бронирование истекло, изменилось или указана другая цена.');
    }
    assert(!item.inRepair && item.quantity - reserved + (booking?.quantity ?? 0) >= units, 'Недостаточный доступный остаток.');
    allocations = takeLots(item, units);
    costMinor = totalCost(allocations);
    stockDelta = -units;
    cashMinor = revenueMinor = amountMinor;
    if (booking) bookings.set(booking.id, { ...booking, quantity: booking.quantity - units,
      status: booking.quantity === units ? 'sold' : 'active' });
  } else if (type === 'repair_start') {
    assert(unit && units === 1 && item.quantity === 1 && !item.inRepair && !reserved, 'В ремонт можно передать доступный поштучный товар.');
    item.inRepair = true;
  } else if (type === 'repair') {
    assert(unit && units === 1 && item.quantity === 1 && item.inRepair, 'У товара нет открытого ремонта.');
    item.lots[0].costMinor = safe(item.lots[0].costMinor + amountMinor);
    item.inRepair = false;
    cashMinor = -amountMinor;
  } else if (type === 'reserve') {
    assert(!item.inRepair && item.quantity - reserved >= units, 'Недостаточный доступный остаток.');
    assert(Date.parse(event.expiresAt) > at, 'Срок бронирования должен быть в будущем.');
    bookings.set(event.id, { id: event.id, productId, status: 'active', quantity: units, expiresAt: event.expiresAt,
      buyer: event.buyer, contact: event.contact, note: event.note, unitMinor: event.agreedMinor });
  } else if (reservationTypes.includes(type)) {
    const booking = active.find(entry => entry.id === event.reservationId);
    assert(booking, 'Активное бронирование не найдено.');
    if (type === 'extend_reserve') {
      assert(Date.parse(event.expiresAt) > Date.parse(booking.expiresAt), 'Новый срок должен быть позже текущего.');
      bookings.set(booking.id, { ...booking, expiresAt: event.expiresAt });
    } else bookings.set(booking.id, { ...booking, status: 'cancelled' });
  } else {
    const original = byId.get(event.originalId);
    const supplier = type === 'supplier_return';
    assert(original && original.type === (supplier ? 'purchase' : 'sale') && original.productId === productId,
      'Исходная операция не найдена.');
    const earlier = corrected.get(original.id) ?? [];
    assertReturn(original, earlier, event);
    if (supplier) {
      assert(!item.inRepair && item.quantity - reserved >= units, 'В партии недостаточно свободного остатка.');
      allocations = takeLots(item, units, lot => lot.sourceId === original.id);
      stockDelta = -units;
      cashMinor = amountMinor;
      expenseMinor = safe(totalCost(allocations) - amountMinor);
    } else {
      if (units) {
        assert(!unit || !item.quantity, 'Поштучный товар уже есть на складе.');
        allocations = restoreLots(item, event, original, earlier.reduce((sum, row) => sum + row.units, 0));
        costMinor = -totalCost(allocations);
        stockDelta = units;
        if (event.toRepair) {
          assert(unit, 'В ремонт можно вернуть только поштучный товар.');
          item.inRepair = true;
        }
      }
      cashMinor = revenueMinor = -amountMinor;
    }
    corrected.set(original.id, [...earlier, event]);
  }
  item.quantity = safe(item.quantity + stockDelta);
  item.stockCostMinor = totalCost(item.lots);
  assert(item.quantity <= 2147483647, 'Достигнут предел остатка.');
  products.set(productId, item);
  const detail = { ...event, cashMinor, stockDelta, costMinor, revenueMinor, expenseMinor, allocations };
  operations.push(detail);
  byId.set(event.id, detail);
}

export function warehouseProjection(state) {
  const entries = state.warehouse ?? noEntries;
  if (cache.has(entries)) return cache.get(entries);
  const result = { products: new Map(), operations: [], bookings: new Map(), byId: new Map(), corrected: new Map() };
  for (const event of entries) apply(result, event);
  cache.set(entries, result);
  return result;
}
export function warehouseStock(state, id, now) {
  const { products, bookings } = warehouseProjection(state);
  const reservations = activeReservations(bookings, id, now);
  return { ...(products.get(id) ?? empty), reservations, reservedQuantity: reservations.reduce((sum, item) => sum + item.quantity, 0) };
}
export function warehouseEvents(state) {
  return [...warehouseProjection(state).operations, ...legacyFinancialEvents(state)];
}
function validateTradeEvent(event) {
  const { type, units, amountMinor } = event;
  assert(Number.isSafeInteger(units) && units >= 0 && units <= 100000 &&
    (units > 0 || ['compensation', 'extend_reserve', 'cancel_reserve', 'historical_expense', 'expense'].includes(type)) &&
    (!['compensation', 'extend_reserve', 'cancel_reserve'].includes(type) || units === 0) &&
    Number.isSafeInteger(amountMinor) && amountMinor >= 0 &&
    (!['sale', 'compensation'].includes(type) || amountMinor > 0) &&
    (!['repair_start', ...reservationTypes].includes(type) || amountMinor === 0), 'Неверная сумма или количество.');
  if (type === 'historical_sale') assert(Number.isSafeInteger(event.sourceCostMinor) && event.sourceCostMinor >= 0, 'Не указана себестоимость продажи.');
  if (returnTypes.includes(type)) {
    assert(typeof event.originalId === 'string' && typeof event.reason === 'string' && event.reason.trim().length > 0 &&
      event.reason.length <= 500 && typeof event.toRepair === 'boolean' &&
      (!event.toRepair || ['customer_return', 'void_sale'].includes(type)), 'Выберите исходную операцию и укажите причину.');
  }
  if (type === 'reserve') {
    assert(typeof event.buyer === 'string' && event.buyer.trim().length > 0 && event.buyer.length <= 100 &&
      typeof event.contact === 'string' && event.contact.length <= 100 && typeof event.note === 'string' && event.note.length <= 500 &&
      Number.isSafeInteger(event.agreedMinor) && event.agreedMinor > 0 && event.agreedMinor <= 10000000000,
      'Укажите покупателя и согласованную цену.');
  }
  if (['reserve', 'extend_reserve'].includes(type)) assert(typeof event.expiresAt === 'string' && Number.isFinite(Date.parse(event.expiresAt)), 'Укажите срок бронирования.');
}

export function recordWarehouse(state, productId, type, input, balanceMinor) {
  const product = state.catalog?.products.find(item => item.id === productId);
  assert(product, 'Карточка товара недоступна.');
  assert(product.version === input.version, 'Карточка изменилась. Откройте её заново.');
  assert((state.warehouse?.length ?? 0) === input.position, 'Склад изменился. Повторите действие после обновления.');
  assert(Object.hasOwn(warehouseLabels, type), 'Неизвестная операция.');
  const returns = returnTypes.includes(type);
  const units = ['repair', 'repair_start'].includes(type) ? 1 : ['compensation', 'extend_reserve', 'cancel_reserve'].includes(type) ? 0 : input.units;
  const amountMinor = reservationTypes.includes(type) || type === 'repair_start' ? 0 : returns ? input.amountMinor : safe(input.unitMinor * units);
  const accountId = amountMinor ? input.accountId : null;
  const event = { id: 'warehouse:' + crypto.randomUUID(), productId, name: product.name, tracking: product.tracking,
    type, units, amountMinor, accountId, date: today(), createdAt: new Date().toISOString() };
  if (returns) Object.assign(event, { originalId: input.originalId, reason: input.reason?.trim(), toRepair: Boolean(input.toRepair) });
  if (type === 'reserve') Object.assign(event, { agreedMinor: input.unitMinor, buyer: input.buyer?.trim(), contact: input.contact?.trim() ?? '', note: input.note?.trim() ?? '' });
  if (['reserve', 'extend_reserve'].includes(type)) event.expiresAt = input.expiresAt;
  if (input.reservationId) event.reservationId = input.reservationId;
  validateTradeEvent(event);
  if (amountMinor) {
    assert(state.accounts.some(account => account.id === accountId && !account.archived), 'Выберите действующий счёт.');
    assert(['sale', 'supplier_return'].includes(type) || balanceMinor >= amountMinor, 'Недостаточно денег на счёте.');
  }
  const next = { ...state, warehouse: [...(state.warehouse ?? noEntries), event] };
  warehouseProjection(next);
  return withAudit(next, makeAuditEntry(state, 'create', 'warehouse', productId, warehouseLabels[type] + ' · ' + product.name));
}

export function validateWarehouse(state) {
  if (state.warehouse === undefined) return;
  assert(Array.isArray(state.warehouse), 'Неверный журнал склада.');
  const products = new Map((state.catalog?.products ?? []).map(item => [item.id, item]));
  const accounts = new Set(state.accounts.map(item => item.id));
  const ids = new Set();
  for (const event of state.warehouse) {
    assert(event && typeof event.id === 'string' && /^warehouse:[a-f0-9-]{36}$/.test(event.id) && !ids.has(event.id) &&
      (['historical_expense','expense'].includes(event.type) ? event.productId === null : products.get(event.productId)?.tracking === event.tracking) &&
      typeof event.name === 'string' && event.name.length > 0 && Object.hasOwn(warehouseLabels, event.type) &&
      (event.amountMinor && !['opening','historical_sale','historical_expense'].includes(event.type) ? accounts.has(event.accountId) : event.accountId === null) &&
      validDate(event.date) && typeof event.createdAt === 'string' && Number.isFinite(Date.parse(event.createdAt)), 'Неверная операция склада в копии.');
    validateTradeEvent(event);
    ids.add(event.id);
  }
  warehouseProjection(state);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
