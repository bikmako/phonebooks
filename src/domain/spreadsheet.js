import { STANDARD_CATEGORIES } from './inventory.js';
import { isValidImei } from '../utils/imei.js';
import { sha256Hex } from './transferWire.js';

export const importTypes = {
  opening: 'Начальный остаток', purchase: 'Текущая закупка', historical_sale: 'Историческая продажа',
  historical_expense: 'Исторический расход', expense: 'Текущий расход',
};
export const importColumns = {
  type: ['Операция', 'тип', 'operation', 'type'],
  name: ['Товар', 'название', 'наименование', 'модель', 'product', 'name', 'описание'],
  category: ['Категория', 'category'],
  sku: ['Артикул', 'sku', 'код товара'],
  imei: ['IMEI', 'imei1', 'имей'],
  tracking: ['Учёт', 'tracking'],
  quantity: ['Количество', 'остаток', 'кол-во', 'qty', 'quantity'],
  amount: ['Сумма, ₽', 'сумма', 'итого', 'amount', 'выручка', 'цена продажи'],
  cost: ['Себестоимость, ₽', 'себестоимость', 'cost', 'сумма закупки', 'закупочная стоимость'],
  price: ['Цена за единицу', 'цена', 'unit price', 'unit cost', 'цена закупки'],
  date: ['Дата', 'date', 'дата операции'],
  external: ['Номер записи', 'id операции', 'external id', 'reference', 'номер документа'],
};
const normalize = value => String(value ?? '').trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
const typeAliases = new Map(Object.entries({
  остаток: 'opening', stock: 'opening', opening: 'opening', закупка: 'purchase', purchase: 'purchase',
  продажа: 'historical_sale', sale: 'historical_sale', historical_sale: 'historical_sale', historical_expense: 'historical_expense',
  расход: 'historical_expense', expense: 'expense',
}).concat(Object.entries(importTypes).map(([key, label]) => [normalize(label), key])));
const heading = value => String(value ?? '').trim();
const fail = message => { throw new Error(message); };
export function guessMapping(headers) {
  const used = new Set();
  return headers.map(value => {
    const name = normalize(value);
    const field = Object.entries(importColumns).find(([, names]) => names.some(alias => normalize(alias) === name))?.[0];
    if (field && !used.has(field)) { used.add(field); return field; }
    return /^(характеристика|атрибут|attribute)\s*:/i.test(name) ? 'attribute' : '';
  });
}
function externalDate(value, date1904) {
  if (typeof value === 'number') {
    const days = Math.floor(value);
    if (days === 60 && !date1904) fail('Дата Excel 29.02.1900 не существует.');
    value = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31) +
      (days - Number(!date1904 && days > 60)) * 86400000).toISOString().slice(0, 10);
  }
  let text = heading(value);
  const localized = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (localized) text = [localized[3], localized[2].padStart(2, '0'), localized[1].padStart(2, '0')].join('-');
  if (/^\d{4}-\d\d-\d\dT/.test(text)) text = text.slice(0, 10);
  const parsed = new Date(text + 'T00:00:00Z');
  if (!/^\d{4}-\d\d-\d\d$/.test(text) || text < '1900-01-01' ||
    !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail('Укажите корректную дату.');
  return text;
}
function numeric(value, money = false) {
  let text = heading(value).replace(/[\s\u00A0\u202F]/g, '').replace(/(?:₽|руб\.?|RUB)$/i, '');
  if (text.includes('.') && text.includes(',')) {
    const separator = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    text = text.replaceAll(separator === '.' ? ',' : '.', '');
  }
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text) && (!money || typeof value !== 'number')) text = text.replace(/[.,]/g, '');
  if (!(money ? /^\d+(?:[.,]\d{1,2})?$/ : /^\d+$/).test(text)) fail(money ? 'Неверная сумма с точностью до копеек.' : 'Количество должно быть целым числом.');
  const result = money ? Math.round(Number(text.replace(',', '.')) * 100) : Number(text);
  if (!Number.isSafeInteger(result) || result > (money ? 9000000000000 : 100000)) fail('Число больше поддерживаемого предела.');
  return result;
}
function amountFor(type, input, quantity) {
  const field = type === 'opening' ? (heading(input.cost) ? input.cost : input.amount) :
    (heading(input.amount) ? input.amount : type === 'purchase' ? input.cost : '');
  if (field !== '' && field != null) return numeric(field, true);
  if (['opening', 'purchase'].includes(type) && heading(input.price)) {
    const amount = numeric(input.price, true) * quantity;
    if (amount > 9000000000000) fail('Итоговая сумма больше поддерживаемого предела.');
    return amount;
  }
  return fail('Укажите сумму или цену за единицу.');
}
function attributeValue(value, field) {
  if (field.type === 'number') {
    const text = heading(value).replace(/\s/g, '').replace(',', '.');
    const number = Number(text);
    if (!Number.isFinite(number) || !/^-?\d+(?:\.\d+)?$/.test(text)) fail('Характеристика «' + field.name + '» требует число.');
    return number;
  }
  if (field.type === 'boolean') {
    const text = normalize(value);
    if (['да','yes','true','1'].includes(text)) return true;
    if (['нет','no','false','0'].includes(text)) return false;
    fail('Характеристика «' + field.name + '» требует «да» или «нет».');
  }
  return heading(value);
}

export async function previewSpreadsheet(sheet, mapping, options) {
  const ids = new Map();
  const encoder = new TextEncoder();
  function key(prefix, value) {
    const entry = prefix + value;
    if (!ids.has(entry)) ids.set(entry, sha256Hex(encoder.encode(value)).then(hash => prefix + hash));
    return ids.get(entry);
  }
  const headers = sheet.rows[0]?.values ?? [];
  const fields = mapping.filter(value => value && value !== 'attribute');
  if (new Set(fields).size !== fields.length) fail('Назначьте каждое поле только одному столбцу.');
  const found = new Map([...STANDARD_CATEGORIES, ...(options.categories ?? [])].flatMap(row => [[normalize(row.name), row], [normalize(row.id), row]]));
  const definitions = new Map();
  const created = new Map();
  const products = new Map();
  const known = new Set(options.known ?? []);
  const knownImeis = new Map(options.imeis ?? []);
  const errors = [], rows = [];
  const summary = Object.fromEntries(Object.keys(importTypes).map(type => [type, 0]));
  let cashMinor = 0, openingUnits = 0, historicalMinor = 0;
  for (const { values, number } of sheet.rows.slice(1)) {
    try {
      if (values.some(value => value && typeof value === 'object')) fail('Формулы и ячейки Excel с ошибками не импортируются. Вставьте значения.');
      const input = Object.fromEntries(mapping.flatMap((name, index) => name && name !== 'attribute' ? [[name, values[index] ?? '']] : []));
      if (values.some(value => typeof value === 'string' && /^[\s\uFEFF]*[=@+]|^[\s\uFEFF]*-(?!\d+(?:[.,]\d+)?\s*$)/.test(value)))
        fail('Замените формулу обычным значением.');
      const sourceType = normalize(input.type);
      const type = sourceType ? typeAliases.get(sourceType) : options.defaultType;
      if (!Object.hasOwn(importTypes, type)) fail('Неизвестный тип операции.');
      const name = heading(input.name);
      if (!name || name.length > 100) fail('Укажите название длиной до 100 символов.');
      const dated = heading(input.date);
      if (!dated && type.startsWith('historical_')) fail('Для исторической записи укажите исходную дату.');
      const date = dated ? externalDate(input.date, sheet.date1904) : options.today;
      if (date > options.today) fail('Дата операции в будущем.');
      const current = type === 'purchase' || type === 'expense';
      if (current && !options.accountId) fail('Выберите счёт для текущих операций.');
      const hasProduct = !type.endsWith('expense');
      const quantity = hasProduct && heading(input.quantity) ? numeric(input.quantity) : 1;
      if (!quantity) fail('Количество должно быть больше нуля.');
      const amountMinor = amountFor(type, input, quantity);
      if (type.endsWith('expense') && !amountMinor) fail('Сумма расхода должна быть больше нуля.');
      const costMinor = type === 'historical_sale' ? numeric(input.cost, true) : 0;
      const external = heading(input.external);
      if (external.length > 100) fail('Номер записи длиннее 100 символов.');
      let productId = null, product = null;
      if (hasProduct) {
        const imei = heading(input.imei).replace(/[\s-]/g, '');
        if (imei && !isValidImei(imei)) fail('IMEI должен содержать 15 цифр и проходить контрольную проверку.');
        const label = heading(input.category) || (imei ? 'Смартфоны' : 'Прочее');
        if (label.length > 100) fail('Название категории длиннее 100 символов.');
        let category = found.get(normalize(label)) ?? created.get(normalize(label));
        if (!category) {
          category = { id: await key('sheet_', normalize(label)), name: label, attributes: [] };
          created.set(normalize(label), category);
          definitions.set(category.id, category);
        }
        const trackingLabel = normalize(input.tracking);
        if (trackingLabel && !['unit','quantity','поштучный','количественный','поштучно','количественно'].includes(trackingLabel))
          fail('Укажите «поштучный» или «количественный» учёт.');
        const tracking = imei || ['unit','поштучный','поштучно'].includes(trackingLabel) ? 'unit' : 'quantity';
        if (tracking === 'unit' && quantity !== 1) fail('Поштучная карточка рассчитана на одну единицу.');
        const sku = heading(input.sku);
        if (sku.length > 100) fail('Артикул длиннее 100 символов.');
        if (tracking === 'unit' && !imei && !sku && !external) fail('Для поштучного товара нужен IMEI, артикул или номер записи.');
        const attributes = {};
        async function assign(label, value) {
          if (!heading(value)) return;
          if (!label || label.length > 100 || heading(value).length > 500) fail('Проверьте название или длину характеристики.');
          let field = category.attributes.find(row => normalize(row.name) === normalize(label) || normalize(row.id) === normalize(label));
          if (!field && definitions.has(category.id)) {
            field = { id: await key('attr_', normalize(label)), name: label, type: 'text' };
            category.attributes.push(field);
          }
          if (!field) fail('В категории «' + category.name + '» нет характеристики «' + label + '».');
          attributes[field.id] = attributeValue(value, field);
        }
        if (imei) await assign('imei', imei);
        if (sku && category.attributes.some(field => field.id === 'article')) await assign('article', sku);
        for (let index = 0; index < mapping.length; index++) if (mapping[index] === 'attribute')
          await assign(heading(headers[index]).replace(/^[^:]+:\s*/, ''), values[index]);
        productId = await key('product:sheet_', [category.id, imei || normalize(sku) || (tracking === 'unit' ? normalize(external) : normalize(name))].join('\u0001'));
        if (imei && knownImeis.has(imei) && knownImeis.get(imei) !== productId) fail('IMEI уже зарегистрирован в другой карточке.');
        if (imei) knownImeis.set(imei, productId);
        product = { id: productId, name, categoryId: category.id, tracking, attributes };
        const before = products.get(productId);
        if (before && [before.name, before.tracking].join('|') !== [name, tracking].join('|')) fail('Один артикул сопоставлен разным товарам.');
        if (before && Object.entries(attributes).some(([id, value]) => Object.hasOwn(before.attributes, id) && before.attributes[id] !== value))
          fail('У одного товара конфликтуют характеристики.');
        product = { ...product, attributes: { ...before?.attributes, ...attributes } };
      }
      const row = { type, date, name, productId, quantity: hasProduct ? quantity : 0, amountMinor, costMinor,
        accountId: current ? options.accountId : null, external };
      const fingerprint = await key('', JSON.stringify(external ? [type, productId, normalize(external)] : { ...row, accountId: null }));
      if (known.has(fingerprint)) fail('Дубликат операции в файле или предыдущем импорте.');
      known.add(fingerprint);
      if (product) products.set(productId, product);
      rows.push({ ...row, fingerprint, sourceRow: number });
      summary[type]++;
      if (current) cashMinor -= amountMinor;
      if (type === 'opening' || type === 'purchase') openingUnits += quantity;
      if (type === 'historical_sale') historicalMinor += amountMinor;
    } catch (error) { errors.push({ row: number, message: error.message }); }
  }
  return { rows, categories: [...definitions.values()], products: [...products.values()], errors, summary,
    cashMinor, openingUnits, historicalMinor };
}

export const spreadsheetTemplate = [
  [...Object.values(importColumns).map(aliases => aliases[0]), 'Характеристика: Цвет'],
  ['Начальный остаток', 'Учебный смартфон', 'Смартфоны', 'DEMO-1', '490154203237518', 'Поштучный', 1, '', 12000, '', '2026-01-01', 'DEMO-stock-1', 'Чёрный'],
  ['Историческая продажа', 'Учебный чехол', 'Аксессуары', 'CASE-1', '', 'Количественный', 2, 1400, 400, '', '2026-01-02', 'DEMO-sale-1', 'Синий'],
];
