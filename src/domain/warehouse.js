import { assert, makeAuditEntry, withAudit } from './shared.js';
import { today } from '../utils/format.js';

export const warehouseLabels = {
  purchase: 'Закупка товара', sale: 'Продажа товара', repair_start: 'Передача в ремонт', repair: 'Завершение ремонта',
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

function apply(products, event, details) {
  const { productId, type, tracking, units, amountMinor } = event;
  const item = products.get(productId) ?? { ...empty, lots: [] };
  const unit = tracking === 'unit';
  let stockDelta = 0;
  let costMinor = 0;
  if (type === 'purchase') {
    assert(!unit || (!item.purchased && units === 1), 'Для следующего поштучного товара создайте отдельную карточку.');
    stockDelta = units;
    item.purchased = true;
    item.lots.push({ id: event.id, productId, quantity: units, costMinor: amountMinor, date: event.date, createdAt: event.createdAt });
    item.stockCostMinor = safe(item.stockCostMinor + amountMinor);
  } else if (type === 'sale') {
    assert(!item.inRepair && item.quantity >= units, 'Недостаточный доступный остаток.');
    let remaining = units;
    while (remaining > 0) {
      const lot = item.lots[0];
      const take = Math.min(remaining, lot.quantity);
      const cost = Number((BigInt(lot.costMinor) * BigInt(take)) / BigInt(lot.quantity));
      costMinor = safe(costMinor + cost);
      lot.costMinor -= cost;
      lot.quantity -= take;
      if (!lot.quantity) item.lots.shift();
      remaining -= take;
    }
    item.stockCostMinor -= costMinor;
    stockDelta = -units;
  } else if (type === 'repair_start') {
    assert(unit && units === 1 && item.quantity === 1 && !item.inRepair, 'В ремонт можно передать доступный поштучный товар.');
    item.inRepair = true;
  } else {
    assert(unit && units === 1 && item.quantity === 1 && item.inRepair, 'У товара нет открытого ремонта.');
    item.lots[0].costMinor = safe(item.lots[0].costMinor + amountMinor);
    item.stockCostMinor = safe(item.stockCostMinor + amountMinor);
    item.inRepair = false;
  }
  item.quantity = safe(item.quantity + stockDelta);
  assert(item.quantity <= 2147483647, 'Достигнут предел остатка.');
  products.set(productId, item);
  const cashMinor = type === 'sale' ? amountMinor : -amountMinor;
  details.push({ ...event, cashMinor, stockDelta, costMinor, revenueMinor: type === 'sale' ? amountMinor : 0 });
}

export function warehouseProjection(state) {
  const entries = state.warehouse ?? noEntries;
  if (cache.has(entries)) return cache.get(entries);
  const products = new Map();
  const operations = [];
  for (const event of entries) apply(products, event, operations);
  const result = { products, operations };
  cache.set(entries, result);
  return result;
}
export function warehouseStock(state, id) {
  return warehouseProjection(state).products.get(id) ?? empty;
}

export function recordWarehouse(state, productId, type, input, balanceMinor) {
  const product = state.catalog?.products.find(item => item.id === productId);
  assert(product, 'Карточка товара недоступна.');
  assert(product.version === input.version, 'Карточка изменилась. Откройте её заново.');
  assert((state.warehouse?.length ?? 0) === input.position, 'Склад изменился. Повторите действие после обновления.');
  assert(Object.hasOwn(warehouseLabels, type), 'Неизвестная операция.');
  const units = ['purchase', 'sale'].includes(type) ? input.units : 1;
  assert(Number.isSafeInteger(units) && units >= 1 && units <= 100000, 'Укажите целое количество от 1 до 100 000.');
  const amountMinor = type === 'repair_start' ? 0 : safe(input.unitMinor * units);
  assert(amountMinor >= 0 && (type !== 'sale' || amountMinor > 0), 'Укажите допустимую сумму.');
  const accountId = amountMinor ? input.accountId : null;
  if (amountMinor) {
    assert(state.accounts.some(account => account.id === accountId && !account.archived), 'Выберите действующий счёт.');
    assert(type === 'sale' || balanceMinor >= amountMinor, 'Недостаточно денег на счёте.');
  }
  const id = 'warehouse:' + crypto.randomUUID();
  const event = { id, productId, name: product.name, tracking: product.tracking, type, units, amountMinor, accountId,
    date: today(), createdAt: new Date().toISOString() };
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
      products.get(event.productId)?.tracking === event.tracking && typeof event.name === 'string' && event.name.length > 0 &&
      Object.hasOwn(warehouseLabels, event.type) && Number.isSafeInteger(event.units) && event.units >= 1 && event.units <= 100000 &&
      Number.isSafeInteger(event.amountMinor) && event.amountMinor >= 0 &&
      (event.amountMinor ? accounts.has(event.accountId) : event.accountId === null) &&
      (event.type !== 'sale' || event.amountMinor > 0) &&
      (event.type !== 'repair_start' || event.amountMinor === 0) &&
      validDate(event.date) && typeof event.createdAt === 'string' && Number.isFinite(Date.parse(event.createdAt)), 'Неверная операция склада в копии.');
    ids.add(event.id);
  }
  warehouseProjection(state);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
