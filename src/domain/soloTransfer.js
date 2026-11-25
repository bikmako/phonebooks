import { parseImportFile, safeJson, validateState } from '../storage/backupFormat.js';
import { accessoryProductId, INVENTORY_KEY, phoneProductId, projectInventory, validateInventory } from './inventory.js';
import { projectInventoryOperations, summarizeInventoryOperations } from './inventoryOperations.js';
import { getAccountBalances, getPhoneTotalCost, getStats } from '../utils/calculations.js';
import { getAccessoryStockValue } from './accessories.js';
import { getPeriod } from '../utils/format.js';

export const TRANSFER_LIMIT = 4 * 1024 * 1024;
export function transferSource(file) {
  const parsed = parseImportFile(file);
  if (parsed.error) throw new Error(parsed.error);
  return {
    state: parsed.data,
    catalog: parsed.snapshot?.indexedDB.meta.find(entry => entry.key === INVENTORY_KEY)?.value ?? null,
  };
}

function minor(value) {
  const amount = Math.round(value * 100);
  if (!Number.isSafeInteger(amount)) throw new Error('Сумма вне поддерживаемого диапазона.');
  return amount;
}

export function prepareSoloTransfer(source) {
  const state = validateState(source?.state, { legacy: true });
  if (state.settings.currency !== 'RUB') throw new Error('Перенос пока поддерживает счета в рублях.');
  const catalog = source.catalog === null || source.catalog === undefined
    ? undefined : validateInventory(safeCatalog(source.catalog));
  const inventory = projectInventory(state, catalog);
  const products = new Map(inventory.products.map(item => [item.id, item]));
  const operations = projectInventoryOperations(state);
  for (const operation of operations) {
    for (const line of operation.lines) {
      if (products.has(line.productId)) continue;
      if (operation.status !== 'cancelled' || !line.productId.startsWith('phone:')) {
        throw new Error('Операция ссылается на отсутствующий товар: ' + operation.id);
      }
      products.set(line.productId, {
        id: line.productId, name: 'Удалённая карточка', categoryId: 'smartphones', tracking: 'unit',
        quantity: 0, reservedQuantity: 0, attributes: {}, status: 'archived',
      });
    }
  }
  const lots = [
    ...state.phones.filter(phone => phone.status !== 'sold').map(phone => ({
      id: 'phone:' + phone.id, productId: phoneProductId(phone.id), quantity: 1,
      costMinor: minor(getPhoneTotalCost(phone)), date: phone.purchaseDate, createdAt: phone.createdAt,
    })),
    ...state.accessoryBatches.filter(batch => batch.qtyLeft > 0).reverse().map(batch => ({
      id: batch.id, productId: accessoryProductId(batch.itemId), quantity: batch.qtyLeft,
      costMinor: minor(batch.qtyLeft * batch.unitCost), date: batch.date, createdAt: batch.createdAt,
    })),
  ].sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
  const stock = new Map();
  for (const lot of lots) {
    if (!Number.isSafeInteger(lot.quantity) || lot.quantity < 1 || lot.quantity > 2147483647) {
      throw new Error('Неподдерживаемый остаток партии: ' + lot.id);
    }
    stock.set(lot.productId, (stock.get(lot.productId) ?? 0) + lot.quantity);
  }
  for (const item of products.values()) {
    if ((stock.get(item.id) ?? 0) !== item.quantity) throw new Error('Остаток не сходится: ' + item.name);
    if (item.name.trim().length < 1 || item.name.trim().length > 100) throw new Error('Длина названия товара не подходит для переноса: ' + item.id);
  }
  const totals = summarizeInventoryOperations(operations);
  const legacy = getStats(state, getPeriod('all'));
  if (totals.revenueMinor !== minor(legacy.revenue) || totals.costMinor !== minor(legacy.cogs) ||
    totals.netProfitMinor !== minor(legacy.netProfit)) throw new Error('Не совпали выручка, себестоимость или прибыль.');
  const stockCostMinor = lots.reduce((sum, lot) => sum + lot.costMinor, 0);
  const legacyStockCost = state.phones.filter(phone => phone.status !== 'sold')
    .reduce((sum, phone) => sum + minor(getPhoneTotalCost(phone)), 0) + minor(getAccessoryStockValue(state));
  if (!Number.isSafeInteger(stockCostMinor) || stockCostMinor !== legacyStockCost) throw new Error('Не совпала себестоимость остатков.');

  const accounts = getAccountBalances(state).map(({ account, balance }) => {
    const openingMinor = minor(account.openingBalance);
    if (openingMinor + (totals.accounts.get(account.id) ?? 0) !== minor(balance)) {
      throw new Error('Не совпал остаток счёта: ' + account.name);
    }
    return { id: account.id, name: account.name, openingMinor, balanceMinor: minor(balance), archived: account.archived };
  });
  const summary = {
    products: products.size, units: [...stock.values()].reduce((sum, item) => sum + item, 0),
    reserved: [...products.values()].reduce((sum, item) => sum + item.reservedQuantity, 0),
    operations: operations.length, audit: state.audit.length, accounts: accounts.length, stockCostMinor,
    cashMinor: accounts.reduce((sum, item) => sum + item.balanceMinor, 0),
    revenueMinor: totals.revenueMinor, costMinor: totals.costMinor, expenseMinor: totals.expenseMinor,
    grossProfitMinor: totals.grossProfitMinor, netProfitMinor: totals.netProfitMinor, salesCount: totals.salesCount,
  };
  if (!Number.isSafeInteger(summary.cashMinor)) throw new Error('Сумма остатков счетов вне поддерживаемого диапазона.');
  return {
    summary, categories: catalog?.categories ?? [], products: [...products.values()], accounts, lots,
    operations, audit: state.audit, settings: { businessName: state.settings.businessName, currency: state.settings.currency },
    historicalDetails: Object.fromEntries([
      'accounts', 'phones', 'sales', 'expenses', 'transfers', 'cashOps', 'accessoryItems', 'accessoryBatches', 'accessorySales',
    ].map(name => [name, state[name]])),
  };
}

function safeCatalog(value) {
  safeJson(value);
  return value;
}
