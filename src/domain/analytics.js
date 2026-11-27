import { accessoryProductId, phoneProductId, projectInventory } from './inventory.js';
import { projectInventoryOperations } from './inventoryOperations.js';
import { legacyPhoneCost, phoneUnavailable } from './legacyTradeState.js';
import { warehouseProjection } from './warehouse.js';
import { getPhoneTotalCost } from '../utils/calculations.js';

const dayMs = 86400000;
const day = value => Date.parse(value?.slice(0, 10) + 'T00:00:00Z') / dayMs;
const iso = value => new Date(value * dayMs).toISOString().slice(0, 10);
const money = value => Math.round(value * 100);
const sum = (rows, fn) => rows.reduce((total, row) => total + fn(row), 0);
const round = value => Math.round(value * 100) / 100;
const ratio = (a, b) => a == null || !(b > 0) ? null : round(a / b);
const minorSum = (rows, fn) => rows.reduce((total, row) => total + BigInt(fn(row)), 0n);
const knownSum = (rows, key) => rows.some(row => row[key] == null) ? null : minorSum(rows, row => row[key]);
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
const minorValue = value => value == null ? null : value >= -maxSafe && value <= maxSafe ? Number(value) : value.toString();
function divideMinor(amount, units) {
  if (amount == null || !(units > 0)) return null;
  const denominator = BigInt(units);
  return amount >= 0n ? (amount + denominator / 2n) / denominator : -((-amount + denominator / 2n) / denominator);
}

export function analyticsPeriod(from, to) {
  const first = day(from), last = day(to);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last || iso(first) !== from || iso(last) !== to) return null;
  const length = last - first + 1;
  if (first - length < day('0001-01-01')) return null;
  const step = Math.ceil(length / 28);
  return {
    from, to, previousFrom: iso(first - length), previousTo: iso(first - 1), step,
    buckets: Array.from({ length: Math.ceil(length / step) }, (_, i) => ({
      from: iso(first + step * i), to: iso(Math.min(last, first + step * (i + 1) - 1)),
    })),
  };
}

export function saleMetrics(operations) {
  const sales = operations.filter(row => row.type === 'sale');
  const salesCount = new Set(sales.map(row => row.groupId ?? row.id)).size;
  const revenueMinor = minorSum(operations, row => row.revenueMinor);
  const costMinor = knownSum(operations, 'costMinor');
  const expensesMinor = minorSum(operations, row => row.expenseMinor);
  const grossMinor = costMinor == null ? null : revenueMinor - costMinor;
  return {
    revenueMinor: minorValue(revenueMinor), costMinor: minorValue(costMinor), expensesMinor: minorValue(expensesMinor), grossMinor: minorValue(grossMinor),
    netMinor: minorValue(grossMinor == null ? null : grossMinor - expensesMinor),
    averageMinor: minorValue(divideMinor(minorSum(sales, row => row.revenueMinor), salesCount)),
    margin: grossMinor == null || revenueMinor <= 0n ? null : Number(divideMinor(grossMinor * 10000n, revenueMinor)) / 100,
    purchasedUnits: sum(operations, row => row.type === 'purchase' ? sum(row.lines, line => line.quantity) : 0),
    soldUnits: sum(operations, row => row.type === 'sale' ? sum(row.lines, line => line.quantity) :
      row.type === 'customer_return' ? -sum(row.lines, line => line.stockDelta) : 0),
    sales: salesCount,
  };
}

function saleAge(date, quantity, allocations, dates) {
  if (sum(allocations, part => part.quantity) !== quantity) return null;
  const ages = allocations.map(part => ({ quantity: part.quantity,
    days: validAge(Object.hasOwn(part, 'receivedOn') ? part.receivedOn : dates.get(part.sourceId), date) }));
  return ages.some(part => part.days == null) ? null : sum(ages, part => part.days * part.quantity);
}

function validAge(from, to) {
  const days = day(to) - day(from);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

export function prepareSoloAnalytics(state) {
  const catalog = projectInventory(state);
  const categoryOf = new Map(catalog.products.map(product => [product.id, product.categoryId]));
  const operations = projectInventoryOperations(state).filter(row => row.status === 'posted');
  const projection = warehouseProjection(state);
  const phones = new Map(state.phones.map(phone => [phoneProductId(phone.id), phone]));
  const batches = new Map(state.accessoryBatches.map(batch => [batch.id, batch]));
  const accessorySales = new Map(state.accessorySales.map(sale => ['acc_sale:' + sale.id, sale]));
  const phoneSales = new Map(state.sales.map(sale => ['sale:' + sale.id, sale]));
  const dates = new Map(operations.filter(row => row.type === 'purchase').map(row => [row.id, row.date]));
  const returns = new Map();
  for (const row of state.legacyTrade ?? []) {
    if (row.productId.startsWith('phone:') && row.stockDelta > 0) addTo(returns, row.productId, row);
  }
  const lots = [];
  for (const [productId, phone] of phones) {
    if (phoneUnavailable(phone)) continue;
    const date = returns.get(productId)?.reduce((last, entry) => last > entry.date ? last : entry.date, phone.purchaseDate) ?? phone.purchaseDate;
    lots.push({ id: productId, productId, date, quantity: 1, stockMinor: money(getPhoneTotalCost(phone)) });
  }
  for (const batch of batches.values()) {
    if (batch.qtyLeft > 0) lots.push({ id: batch.id, productId: accessoryProductId(batch.itemId), date: batch.date,
      quantity: batch.qtyLeft, stockMinor: money(batch.qtyLeft * batch.unitCost) });
  }
  for (const [productId, stock] of projection.products) {
    for (const lot of stock.lots) lots.push({ id: lot.id, productId, date: lot.receivedOn,
      quantity: lot.quantity, stockMinor: lot.costMinor });
  }

  for (const row of operations) {
    const accessory = accessorySales.get(row.id);
    const phoneSale = phoneSales.get(row.id);
    const source = projection.byId.get(row.id);
    const withinCategory = row.lines.length > 1 && row.lines.every(line => categoryOf.get(line.productId) === categoryOf.get(row.lines[0].productId));
    if ((source?.type === 'historical_sale' && source.sourceCostMinor == null) ||
        (phoneSale && legacyPhoneCost(phoneSale, phones.get(row.lines[0].productId)) == null)) {
      row.costMinor = null;
    }
    row.lines = row.lines.map((line, index) => {
      if (row.type === 'customer_return') return { ...line, revenueMinor: row.revenueMinor, costMinor: row.costMinor };
      if (row.type !== 'sale') return line;
      const item = accessory?.items[index];
      const single = row.lines.length === 1;
      let days = null;
      if (phoneSale) {
        const latestReturn = returns.get(line.productId)?.filter(entry => entry.originalId !== row.id &&
          entry.date <= row.date && entry.createdAt <= phoneSale.createdAt).at(-1);
        days = validAge(latestReturn?.date ?? phones.get(line.productId)?.purchaseDate, row.date);
      } else if (item) {
        days = saleAge(row.date, line.quantity, (item.allocations ?? []).map(part => ({ quantity: part.qty,
          receivedOn: batches.get(part.batchId)?.date })), dates);
      } else if (source) days = saleAge(row.date, line.quantity, source.allocations, dates);
      return { ...line, days,
        ...(withinCategory ? { categoryRevenueMinor: index === 0 ? row.revenueMinor : 0 } : {}),
        revenueMinor: single ? row.revenueMinor : !accessory?.discount && item ? money(item.qty * item.unitPrice) : null,
        costMinor: single ? row.costMinor : item && Number.isFinite(item.unitCost) ? money(item.qty * item.unitCost) : null,
      };
    });
  }
  return { catalog, operations, lots };
}

export function soloAnalytics({ catalog, operations, lots }, period, asOf) {
  const products = new Map(catalog.products.map(product => [product.id, product]));
  const categories = new Map(catalog.categories.map(category => [category.id, category.name]));
  const { from, to, previousFrom, previousTo, step, buckets } = period;
  const firstDay = day(from);
  const current = [], previous = [], daily = buckets.map(() => []);
  const turnoverInputs = new Map(), categorySales = new Map(), modelSales = new Map(), productSales = new Map();
  const stockByCategory = new Map();
  const stock = lots.map(lot => {
    const product = products.get(lot.productId);
    const categoryId = product?.categoryId ?? 'other';
    addTo(stockByCategory, categoryId, lot);
    return { ...lot, name: product?.name ?? lot.productId, category: categories.get(categoryId),
      days: validAge(lot.date, asOf), plannedMinor: product?.plannedPriceMinor ?? null };
  });
  for (const row of operations) {
    const inPeriod = row.date >= from && row.date <= to;
    if (inPeriod) {
      current.push(row);
      daily[Math.floor((day(row.date) - firstDay) / step)].push(row);
    } else if (row.date >= previousFrom && row.date <= previousTo) previous.push(row);
    for (const line of row.lines) {
      const product = products.get(line.productId);
      const category = product?.categoryId ?? 'other';
      if (row.date >= from) addTo(turnoverInputs, category, { ...line, date: row.date, type: row.type });
      if (!inPeriod || !['sale', 'customer_return'].includes(row.type)) continue;
      const entry = { ...line, units: row.type === 'sale' ? line.quantity : -line.stockDelta,
        receipt: row.type === 'sale' ? row.groupId ?? row.id : null };
      addTo(categorySales, category, { ...entry, revenueMinor: entry.categoryRevenueMinor ?? entry.revenueMinor });
      addTo(modelSales, JSON.stringify([category, product?.name ?? line.productId]), entry);
      addTo(productSales, line.productId, entry);
    }
  }
  const group = rows => {
    const revenueMinor = knownSum(rows, 'revenueMinor'), cost = knownSum(rows, 'costMinor');
    const grossMinor = revenueMinor == null || cost == null ? null : revenueMinor - cost;
    const soldUnits = sum(rows, row => row.units);
    const timed = rows.filter(row => row.receipt && row.days != null);
    return { revenueMinor: minorValue(revenueMinor), grossMinor: minorValue(grossMinor), soldUnits,
      sales: new Set(rows.flatMap(row => row.receipt ? [row.receipt] : [])).size,
      averageMinor: minorValue(divideMinor(grossMinor, soldUnits)),
      sellDays: ratio(sum(timed, row => row.days), sum(timed, row => row.units)) };
  };
  const categoryRows = [...new Set([...categorySales.keys(), ...stockByCategory.keys()])].map(id => {
    const entries = categorySales.get(id) ?? [];
    const values = group(entries), remaining = stockByCategory.get(id) ?? [], changes = turnoverInputs.get(id) ?? [];
    const end = sum(remaining, lot => lot.quantity) - sum(changes.filter(row => row.date > to), row => row.stockDelta);
    const start = sum(remaining, lot => lot.quantity) - sum(changes, row => row.stockDelta);
    const incomplete = changes.some(row => row.type === 'sale' && row.stockDelta === 0) || remaining.some(lot => !lot.date);
    return { id, name: categories.get(id) ?? 'Прочее', ...values, stockMinor: minorValue(minorSum(remaining, lot => lot.stockMinor)),
      turnover: incomplete || start < 0 || end < 0 || values.soldUnits < 0 ? null : ratio(values.soldUnits, (start + end) / 2) };
  });
  const best = rows => rows.filter(row => row.grossMinor > 0)
    .sort((a, b) => BigInt(a.grossMinor) < BigInt(b.grossMinor) ? 1 : BigInt(a.grossMinor) > BigInt(b.grossMinor) ? -1 : 0).slice(0, 10);
  return { from, to, stockCostVisible: true,
    current: { from, to, ...saleMetrics(current), stockMinor: minorValue(minorSum(stock, lot => lot.stockMinor)) },
    previous: { from: previousFrom, to: previousTo, ...saleMetrics(previous) },
    series: buckets.map((bucket, i) => ({ ...bucket, ...saleMetrics(daily[i]) })), categories: categoryRows,
    models: best([...modelSales].map(([key, rows]) => ({ id: key, name: JSON.parse(key)[1], ...group(rows) }))),
    topProducts: best([...productSales].map(([id, rows]) => ({ id, name: products.get(id)?.name ?? id, ...group(rows) }))), stock };
}
