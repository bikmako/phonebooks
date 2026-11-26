import { warehouseStock } from './warehouse.js';
import { legacyHeld, phoneUnavailable } from './legacyTradeState.js';

export const INVENTORY_VERSION = 2;
export const INVENTORY_KEY = 'inventoryModel';

const textFields = entries => entries.map(([id, name]) => ({ id, name, type: 'text' }));
const standard = [
  ['smartphones', 'Смартфоны', textFields([
    ['imei', 'IMEI'], ['storage', 'Память'], ['color', 'Цвет'], ['condition', 'Состояние'], ['kit', 'Комплект'],
  ])],
  ['laptops', 'Ноутбуки', textFields([['serial', 'Серийный номер'], ['processor', 'Процессор'], ['ram', 'Оперативная память'], ['storage', 'Накопитель']])],
  ['tablets', 'Планшеты', textFields([['serial', 'Серийный номер'], ['storage', 'Память'], ['screen', 'Экран']])],
  ['consoles', 'Игровые приставки', textFields([['serial', 'Серийный номер'], ['edition', 'Версия'], ['storage', 'Накопитель']])],
  ['watches', 'Умные часы', textFields([['serial', 'Серийный номер'], ['size', 'Размер корпуса']])],
  ['computers', 'Компьютеры', textFields([['serial', 'Серийный номер'], ['processor', 'Процессор'], ['ram', 'Оперативная память'], ['storage', 'Накопитель']])],
  ['components', 'Комплектующие', textFields([['article', 'Артикул'], ['compatibility', 'Совместимость']])],
  ['accessories', 'Аксессуары', textFields([
    ['type', 'Вид'], ['compatibility', 'Совместимость'], ['color', 'Цвет'],
  ])],
  ['other', 'Прочее', []],
];
export const STANDARD_CATEGORIES = Object.freeze(standard.map(([id, name, attributes]) => Object.freeze({
  id, name, attributes: Object.freeze(attributes.map(Object.freeze)),
})));

export const phoneProductId = id => 'phone:' + id;
export const accessoryProductId = id => 'accessory:' + id;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
const validVersion = value => Number.isSafeInteger(value) && value > 0;
const validRevisionId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const attributeTypes = {
  text: value => typeof value === 'string',
  number: Number.isFinite,
  boolean: value => typeof value === 'boolean',
};
const requireValid = (condition, message) => { if (!condition) throw new Error(message); };
export const emptyInventory = () => ({ version: INVENTORY_VERSION, revision: 0, revisionId: null, categories: [], products: [] });

function validateCategory(category) {
  requireValid(object(category) && validId(category.id) && validName(category.name) &&
    Array.isArray(category.attributes), 'Неверная категория товара');
  const ids = new Set();
  for (const field of category.attributes) {
    requireValid(object(field) && validId(field.id) && !['__proto__', 'prototype', 'constructor'].includes(field.id) &&
      validName(field.name) && Object.hasOwn(attributeTypes, field.type) && !ids.has(field.id),
    'Неверная или повторная характеристика категории');
    ids.add(field.id);
  }
}

function validateProduct(product, categories) {
  requireValid(object(product) && typeof product.id === 'string' && product.id.startsWith('product:') &&
    validId(product.id.slice('product:'.length)) && validName(product.name) &&
    ['unit', 'quantity'].includes(product.tracking) && validVersion(product.version), 'Неверная карточка товара');
  requireValid(product.plannedPriceMinor == null || Number.isSafeInteger(product.plannedPriceMinor) &&
    product.plannedPriceMinor >= 0 && product.plannedPriceMinor <= 10_000_000_000, 'Неверная плановая цена.');
  const category = categories.get(product.categoryId);
  requireValid(category && object(product.attributes), 'Неизвестная категория или характеристики товара');
  const fields = new Map(category.attributes.map(field => [field.id, field]));
  for (const [id, value] of Object.entries(product.attributes)) {
    const field = fields.get(id);
    requireValid(field && attributeTypes[field.type](value), 'Неверное значение характеристики: ' + id);
  }
}

export function validateInventory(data) {
  requireValid(object(data) && data.version === INVENTORY_VERSION &&
    Number.isSafeInteger(data.revision) && data.revision >= 0 &&
    (data.revision === 0 ? data.revisionId === null : validRevisionId(data.revisionId)) &&
    Array.isArray(data.categories) && Array.isArray(data.products), 'Неподдерживаемая версия или неверная структура каталога');
  const categories = new Map(STANDARD_CATEGORIES.map(category => [category.id, category]));
  for (const category of data.categories) {
    validateCategory(category);
    requireValid(!categories.has(category.id), 'Повторный идентификатор категории');
    categories.set(category.id, category);
  }
  const products = new Set();
  for (const product of data.products) {
    validateProduct(product, categories);
    requireValid(!products.has(product.id), 'Повторный идентификатор товара');
    products.add(product.id);
  }
  return data;
}

export function saveInventoryCategory(inventory, category) {
  const previous = inventory.categories.find(item => item.id === category.id);
  const categories = previous
    ? inventory.categories.map(item => item.id === category.id ? category : item)
    : [...inventory.categories, category];
  return validateInventory({ ...inventory, categories });
}

export function saveInventoryProduct(inventory, product, expectedVersion = 0) {
  const previous = inventory.products.find(item => item.id === product.id);
  requireValid((previous?.version ?? 0) === expectedVersion, 'Карточка товара изменилась');
  const next = { ...product, version: expectedVersion + 1 };
  const products = previous
    ? inventory.products.map(item => item.id === product.id ? next : item)
    : [...inventory.products, next];
  return validateInventory({ ...inventory, products });
}

export function projectInventory(state, catalog = state.catalog ?? emptyInventory()) {
  const quantities = new Map();
  for (const batch of state.accessoryBatches) {
    quantities.set(batch.itemId, (quantities.get(batch.itemId) ?? 0) + batch.qtyLeft);
  }
  const phones = state.phones.map(phone => ({
    id: phoneProductId(phone.id), name: phone.model, categoryId: 'smartphones', tracking: 'unit',
    attributes: Object.fromEntries(STANDARD_CATEGORIES[0].attributes.map(({ id }) => [id, phone[id]])),
    quantity: phoneUnavailable(phone) ? 0 : 1, reservedQuantity: legacyHeld(state, phoneProductId(phone.id)) || Number(phone.status === 'reserved'),
    status: phone.status, ...(phone.plannedPrice > 0 ? { plannedPriceMinor: Math.round(phone.plannedPrice * 100) } : {}),
  }));
  const accessories = state.accessoryItems.map(item => ({
    id: accessoryProductId(item.id), name: item.name, categoryId: 'accessories', tracking: 'quantity',
    attributes: { type: item.category, compatibility: item.compatibility, color: item.color },
    quantity: quantities.get(item.id) ?? 0, reservedQuantity: legacyHeld(state, accessoryProductId(item.id)),
    status: item.archived ? 'archived' : 'active', ...(item.salePrice > 0 ? { plannedPriceMinor: Math.round(item.salePrice * 100) } : {}),
  }));
  return {
    version: catalog.version, revision: catalog.revision, revisionId: catalog.revisionId,
    categories: [...STANDARD_CATEGORIES, ...catalog.categories],
    products: [...phones, ...accessories, ...catalog.products.map(product => {
      const { quantity, inRepair, stockCostMinor, purchased, reservedQuantity } = warehouseStock(state, product.id);
      return { ...product, quantity, inRepair, stockCostMinor, purchased, reservedQuantity,
        status: inRepair ? 'repair' : 'active' };
    })],
  };
}
