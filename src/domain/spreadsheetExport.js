import { projectInventory } from './inventory.js';
import { projectInventoryOperations } from './inventoryOperations.js';
import { warehouseProjection } from './warehouse.js';
import { getStats, getTotalMoney } from '../utils/calculations.js';
import { getAllOperations } from '../utils/operations.js';
import { legacyPhoneCost } from './legacyTradeState.js';

export const exportTypes = {
  all: 'Все данные', stock: 'Склад', purchase: 'Закупки', sale: 'Продажи', returns: 'Возвраты',
  reservation: 'Бронирования', repair: 'Ремонты', expense: 'Расходы', history: 'История операций',
  finance: 'Финансовая статистика', employees: 'Статистика сотрудников',
};
const labels = {
  id: 'ID', name: 'Название', category: 'Категория', tracking: 'Учёт', quantity: 'Количество', reserved: 'В резерве',
  status: 'Статус', type: 'Операция', date: 'Дата', historical: 'История', relatedId: 'Исходная операция',
  originalLine: 'Строка чека', actorId: 'Сотрудник', buyer: 'Покупатель', contact: 'Контакт', expiresAt: 'Срок',
  unitMinor: 'Цена брони, ₽', plannedPriceMinor: 'Плановая цена, ₽', costMinor: 'Себестоимость, ₽',
  cashMinor: 'Движение кассы, ₽', revenueMinor: 'Выручка, ₽', amountMinor: 'Сумма, ₽', expensesMinor: 'Расходы, ₽',
  grossMinor: 'Валовая прибыль, ₽', netMinor: 'Чистая прибыль, ₽', stockMinor: 'Стоимость остатков, ₽',
  purchaseMinor: 'Сумма закупок, ₽', purchases: 'Закупки', sales: 'Продажи', expenses: 'Расходы (число)',
  repairs: 'Ремонты', returns: 'Возвраты', reservations: 'Бронирования',
  purchasedUnits: 'Закуплено, шт.', soldUnits: 'Продано, шт.', averageMinor: 'Средний чек, ₽', operations: 'Операции (число)',
};
const kinds = { purchase: 'Закупка', sale: 'Продажа', expense: 'Расход', repair: 'Ремонт', repair_start: 'Начало ремонта',
  customer_return: 'Возврат покупателя', supplier_return: 'Возврат поставщику', reservation: 'Бронь',
  stock_adjustment: 'Корректировка остатков', transfer: 'Перевод', deposit: 'Пополнение', withdrawal: 'Снятие' };
const fromRange = ({ from, to }, date) => (!from || date >= from) && (!to || date <= to);
const match = (query, ...fields) => !query || fields.join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));

export function soloExport(state, kind, filter) {
  const projection = projectInventory(state);
  const products = new Map(projection.products.map(row => [row.id, row]));
  const categories = new Map(projection.categories.map(row => [row.id, row]));
  if (kind === 'stock') {
    const costs = new Map(state.phones.filter(row => !['sold','supplier_returned'].includes(row.status)).map(row =>
      ['phone:' + row.id, legacyPhoneCost({}, row)]));
    for (const lot of state.accessoryBatches) {
      const id = 'accessory:' + lot.itemId;
      costs.set(id, (costs.get(id) ?? 0) + Math.round(lot.qtyLeft * lot.unitCost * 100));
    }
    return projection.products.filter(row => (!filter.category || row.categoryId === filter.category) &&
    match(filter.query, row.name, ...Object.values(row.attributes)) &&
    (!filter.status || row.status !== 'archived' && (filter.status === 'all' || filter.status === 'repair' && (row.inRepair || row.status === 'repair') ||
      filter.status === 'reserved' && row.reservedQuantity > 0 || filter.status === 'stock' && row.quantity > row.reservedQuantity && row.status !== 'repair' ||
      filter.status === 'empty' && row.quantity === 0))).map(row => {
    const category = categories.get(row.categoryId);
    return { id: row.id, name: row.name, category: category?.name, tracking: row.tracking, quantity: row.quantity,
      reserved: row.reservedQuantity, status: row.status, plannedPriceMinor: row.plannedPriceMinor, costMinor: row.stockCostMinor ?? costs.get(row.id),
      attributes: Object.fromEntries(Object.entries(row.attributes).map(([id, value]) => [category?.attributes.find(field => field.id === id)?.name ?? id, value])) };
  });
  }
  if (kind === 'finance') {
    const totals = getStats(state, { from: filter.from ?? '1900-01-01', to: filter.to ?? '2999-12-31' });
    return [{ revenueMinor: Math.round(totals.revenue * 100), costMinor: Math.round(totals.cogs * 100),
      grossMinor: Math.round(totals.grossProfit * 100), netMinor: Math.round(totals.netProfit * 100),
      expensesMinor: Math.round(totals.expensesTotal * 100), cashMinor: Math.round(getTotalMoney(state) * 100),
      sales: totals.salesCount, purchases: totals.purchasesCount, expenses: totals.expensesCount }];
  }
  if (kind === 'reservation') return [...warehouseProjection(state).bookings.values(),
    ...(state.legacyTrade ?? []).filter(item => item.type === 'reserve')].map(item => {
    const created = item.date ?? warehouseProjection(state).byId.get(item.id)?.date;
    return { id: item.id, name: products.get(item.productId)?.name, date: created, quantity: item.quantity,
      status: item.status === 'active' && Date.parse(item.expiresAt) <= Date.now() ? 'Истекла' : item.status,
      buyer: item.buyer, contact: item.contact, expiresAt: item.expiresAt, unitMinor: item.unitMinor };
  }).filter(row => fromRange(filter, row.date) && match(filter.query, row.name, row.buyer));
  const history = new Map(getAllOperations(state).map(row => [row.id, row]));
  const chosen = filter.ids && new Set(filter.ids);
  return projectInventoryOperations(state).filter(row => fromRange(filter, row.date) && (!chosen || chosen.has(row.id)) &&
    (!filter.operationStatus || row.status === filter.operationStatus) &&
    (kind === 'history' || row.type === kind || kind === 'returns' && ['customer_return','supplier_return'].includes(row.type) ||
      kind === 'repair' && row.type === 'repair_start')).flatMap(row => {
    const source = history.get(row.id);
    const name = row.lines.map(line => products.get(line.productId)?.name ?? line.productId).join(', ') || source?.title;
    if (!chosen && !match(filter.query, name, kinds[row.type], row.id, source?.title, source?.subtitle)) return [];
    const cashMinor = row.postings.reduce((sum, entry) => sum + entry.amountMinor, 0);
    return [{ id: row.id, type: row.type, name, date: row.date, status: row.status, relatedId: row.relatedId,
      originalLine: row.originalLine, quantity: row.lines.reduce((sum, item) => sum + item.quantity, 0),
      historical: warehouseProjection(state).byId.get(row.id)?.type.startsWith('historical_') || undefined,
      amountMinor: ['purchase','repair'].includes(row.type) ? Math.abs(cashMinor) : undefined,
      cashMinor, revenueMinor: row.revenueMinor, costMinor: row.costMinor, expensesMinor: row.expenseMinor }];
  });
}

export function exportGrid(tables) {
  const combined = tables.flatMap(table => table.rows.map(row => ({ ...row, ...(tables.length > 1 ? { dataset: table.name } : {}) })));
  const present = new Set(combined.flatMap(row => Object.keys(row).filter(key => row[key] !== undefined)));
  const keys = [...(tables.length > 1 ? ['dataset'] : []), ...Object.keys(labels).filter(key => present.has(key))];
  const attributes = [...new Set(combined.flatMap(row => Object.keys(row.attributes ?? {})))].sort((a, b) => a.localeCompare(b, 'ru'));
  const cell = (row, key) => {
    const value = row[key];
    if (value == null) return '';
    if (key.endsWith('Minor') && Number.isSafeInteger(Number(value))) return Number(value) / 100;
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    if (key === 'type') return kinds[value] ?? value;
    if (key === 'tracking') return value === 'unit' ? 'Поштучный' : 'Количественный';
    return value;
  };
  return [[...keys.map(key => labels[key] ?? 'Раздел'), ...attributes.map(name => 'Характеристика: ' + name)],
    ...combined.map(row => [...keys.map(key => cell(row, key)), ...attributes.map(key => row.attributes?.[key] ?? '')])];
}
