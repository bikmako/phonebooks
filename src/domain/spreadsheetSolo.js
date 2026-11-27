import { emptyInventory, projectInventory, validateInventory } from './inventory.js';
import { assert, assertSufficientFunds, getActiveAccount, makeAuditEntry, withAudit } from './shared.js';
import { warehouseProjection } from './warehouse.js';
import { importTypes } from './spreadsheet.js';

export function applySoloSpreadsheet(state, plan) {
  assert(plan.rows.length && !plan.errors.length, 'Исправьте ошибки таблицы до подтверждения.');
  const saved = state.catalog ?? emptyInventory();
  const categories = new Map(saved.categories.map(row => [row.id, row]));
  const products = new Map(saved.products.map(row => [row.id, row]));
  const known = new Set(state.sheetImports ?? []);
  const imeis = new Map(projectInventory(state, saved).products.filter(row => row.attributes.imei).map(row => [row.attributes.imei, row.id]));
  for (const category of plan.categories) {
    const existing = categories.get(category.id);
    if (existing) assert(existing.name === category.name &&
      category.attributes.every(field => existing.attributes.some(before => JSON.stringify(before) === JSON.stringify(field))),
    'Схема категории изменилась. Проверьте файл повторно.');
    else categories.set(category.id, category);
  }
  for (const product of plan.products) {
    const existing = products.get(product.id);
    const imei = product.attributes.imei;
    assert(!imei || !imeis.has(imei) || imeis.get(imei) === product.id, 'IMEI уже зарегистрирован в другой карточке.');
    if (imei) imeis.set(imei, product.id);
    if (existing) assert(existing.tracking === product.tracking && existing.categoryId === product.categoryId && existing.name === product.name &&
      Object.entries(product.attributes).every(([id, value]) => existing.attributes[id] === value), 'Карточка уже существует с другими данными.');
    else products.set(product.id, { ...product, version: 1 });
  }
  const accounts = new Map();
  const createdAt = new Date().toISOString();
  const additions = plan.rows.map(row => {
    assert(!known.has(row.fingerprint), 'Строка ' + row.sourceRow + ': импорт уже выполнен.');
    assert(Object.hasOwn(importTypes, row.type), 'Неизвестная операция таблицы.');
    known.add(row.fingerprint);
    if (row.accountId) {
      getActiveAccount(state, row.accountId);
      accounts.set(row.accountId, (accounts.get(row.accountId) ?? 0) + row.amountMinor);
    }
    return { id: 'warehouse:' + crypto.randomUUID(), type: row.type, productId: row.productId,
      name: row.name, tracking: products.get(row.productId)?.tracking ?? null, units: row.quantity,
      amountMinor: row.amountMinor, sourceCostMinor: row.costMinor, accountId: row.amountMinor ? row.accountId : null,
      date: row.date, createdAt, ...(row.type === 'historical_sale' && row.external ? { groupId: 'sheet:receipt:' + row.external.trim().toLowerCase() } : {}) };
  });
  for (const [id, cost] of accounts) assertSufficientFunds(state, id, cost / 100, 'Импорт');
  const catalog = validateInventory({ ...saved, categories: [...categories.values()], products: [...products.values()],
    revision: saved.revision + 1, revisionId: crypto.randomUUID() });
  const next = { ...state, catalog, warehouse: [...(state.warehouse ?? []), ...additions], sheetImports: [...known] };
  warehouseProjection(next);
  return withAudit(next, makeAuditEntry(state, 'import', 'warehouse', catalog.revisionId, 'Импорт таблицы · ' + additions.length + ' строк.'));
}
