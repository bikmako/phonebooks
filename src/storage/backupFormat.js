import { requireDataTransfer } from "../config.js";
/** Portable local backup format. Never coerce or discard unknown state fields. */
export const FORMAT_VERSION = 2;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const COLLECTIONS = ['accounts', 'phones', 'sales', 'expenses', 'transfers', 'cashOps', 'audit', 'accessoryItems', 'accessoryBatches', 'accessorySales'];
export const isLocalKey = key => key === 'phonebooks.theme' || key === 'phonebooks.data.v1' || key.startsWith('phonebooks.draft.');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = message => { throw new Error(message); };
const text = (x, path) => typeof x === 'string' || fail(`${path}: ожидается строка`);
const number = (x, path) => (typeof x === 'number' && Number.isFinite(x)) || fail(`${path}: ожидается конечное число`);
const date = (x, path) => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(x) || !Number.isFinite(Date.parse(x))) fail(`${path}: неверная дата`);
  const day = x.slice(0, 10);
  if (new Date(day).toISOString().slice(0, 10) !== day) fail(`${path}: неверная календарная дата`);
};
const choice = (x, choices, path) => choices.includes(x) || fail(`${path}: неизвестное значение`);
export function safeJson(value, depth = 0) {
  if (depth > 80) fail('Слишком большая вложенность');
  if (typeof value === 'number') number(value, 'JSON');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Недопустимый ключ JSON');
    safeJson(child, depth + 1);
  }
}
const fields = {
  accounts: ['name', 'type', 'color', '#openingBalance'],
  phones: ['storage', 'color', 'imei', 'condition', 'kit', 'supplierName', 'supplierPhone', 'purchasePaymentMethod', 'purchaseComment', 'model', 'purchaseAccountId', 'purchaseDate', 'status', '#purchasePrice', '#plannedPrice'],
  sales: ['buyerName', 'buyerPhone', 'paymentMethod', 'comment', 'phoneId', 'accountId', 'date', 'status', '#price', '#discount'],
  expenses: ['accountId', 'date', 'category', '#amount'],
  transfers: ['fromAccountId', 'toAccountId', 'date', '#amount'],
  cashOps: ['accountId', 'date', 'kind', '#amount'],
  audit: ['at', 'action', 'entity', 'entityId', 'summary'],
  accessoryItems: ['compatibility', 'color', 'name', 'category', '#salePrice', '#minStock'],
  accessoryBatches: ['itemId', 'accountId', 'date', 'kind', '#qty', '#qtyLeft', '#unitCost'],
  accessorySales: ['accountId', 'date', 'status', '#discount'],
};
export function validateState(input, { legacy = false } = {}) {
  if (!object(input)) fail('Нет объекта состояния');
  safeJson(input);
  const state = structuredClone(input);
  if (legacy && state.schemaVersion === undefined) state.schemaVersion = 1;
  if (state.schemaVersion !== 1) fail('Неподдерживаемая версия схемы данных');
  for (const name of COLLECTIONS) {
    if (legacy && state[name] === undefined && name !== 'accounts' && name !== 'phones') state[name] = [];
    if (!Array.isArray(state[name])) fail(`${name}: ожидается массив`);
    const ids = new Set();
    for (const row of state[name]) {
      if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)) fail(`${name}: неверный или повторный id`);
      ids.add(row.id);
      if (name !== 'audit') date(row.createdAt, `${name}.createdAt`);
      if (name === 'accounts' && typeof row.archived !== 'boolean') fail('accounts.archived: ожидается boolean');
      for (const field of fields[name]) {
        const numeric = field.startsWith('#'), key = numeric ? field.slice(1) : field;
        (numeric ? number : text)(row[key], `${name}.${key}`);
        if (numeric && key !== 'openingBalance' && row[key] < 0) fail(`${name}.${key}: отрицательное значение`);
      }
      for (const [key, value] of Object.entries(row)) {
        if (['supplierName', 'supplierPhone', 'buyerName', 'buyerPhone', 'storage', 'color', 'imei', 'condition', 'kit', 'paymentMethod', 'purchasePaymentMethod', 'purchaseComment', 'comment', 'vendor', 'compatibility', 'groupId', 'details', 'category', 'summary', 'action', 'entity'].includes(key) && value !== undefined) text(value, `${name}.${key}`);
        if (value !== null && /(?:At|Date)$/.test(key)) date(value, `${name}.${key}`);
        if (key === 'date') date(value, `${name}.date`);
        if (['archived'].includes(key) && typeof value !== 'boolean') fail(`${name}.${key}: ожидается boolean`);
      }
    }
  }
  if (!state.accounts.length) fail('Нужен хотя бы один счёт');
  if (legacy && state.settings === undefined) state.settings = { businessName: 'Моя скупка', currency: 'RUB' };
  if (!object(state.settings)) fail('Нет настроек');
  text(state.settings.businessName, 'settings.businessName');
  text(state.settings.currency, 'settings.currency');
  const ids = Object.fromEntries(COLLECTIONS.map(name => [name, new Set(state[name].map(x => x.id))]));
  const ref = (value, name, path) => ids[name].has(value) || fail(`${path}: ссылка на отсутствующую запись`);
  for (const row of state.accounts) choice(row.type, ['cash', 'bank', 'card', 'other'], 'accounts.type');
  const repairIds = new Set();
  for (const row of state.phones) {
    ref(row.purchaseAccountId, 'accounts', 'phones.purchaseAccountId');
    choice(row.status, ['in_stock', 'reserved', 'repair', 'sold'], 'phones.status');
    // Optional nested extension: old v1 phones and backups remain byte-for-byte
    // intact. No extra object store or duplicated expense/payment is created.
    if (row.repairSessionId !== undefined && row.repairSessionId !== null) {
      text(row.repairSessionId, 'phones.repairSessionId');
      if (!row.repairSessionId || row.status !== 'repair') fail('Неверный активный ремонт');
      if (repairIds.has(row.repairSessionId)) fail('Повторный id ремонта');
      repairIds.add(row.repairSessionId);
    }
    if (row.repairs !== undefined) {
      if (!Array.isArray(row.repairs)) fail('phones.repairs: ожидается массив');
      for (const repair of row.repairs) {
        if (!object(repair) || typeof repair.id !== 'string' || !repair.id || repairIds.has(repair.id)) fail('Неверный или повторный id ремонта');
        repairIds.add(repair.id);
        number(repair.amount, 'repairs.amount');
        if (repair.amount < 0 || !Number.isSafeInteger(Math.round(repair.amount * 100)) || Math.abs(repair.amount * 100 - Math.round(repair.amount * 100)) > 0.00001) fail('Неверная сумма ремонта');
        if (repair.amount > 0) ref(repair.accountId, 'accounts', 'repairs.accountId');
        else if (repair.accountId !== null) fail('Нулевой ремонт не должен списывать деньги');
        text(repair.comment, 'repairs.comment');
        date(repair.date, 'repairs.date'); date(repair.createdAt, 'repairs.createdAt'); date(repair.updatedAt, 'repairs.updatedAt');
      }
      const total = row.purchasePrice + row.repairs.reduce((sum, repair) => sum + repair.amount, 0);
      if (!Number.isSafeInteger(Math.round(total * 100))) fail('Слишком большая себестоимость');
    }
  }
  for (const name of ['sales', 'expenses', 'cashOps', 'accessorySales']) for (const row of state[name]) ref(row.accountId, 'accounts', `${name}.accountId`);
  for (const row of state.transfers) {
    ref(row.fromAccountId, 'accounts', 'transfers.fromAccountId');
    ref(row.toAccountId, 'accounts', 'transfers.toAccountId');
    if (row.fromAccountId === row.toAccountId) fail('Перевод на тот же счёт');
  }
  for (const row of state.cashOps) choice(row.kind, ['deposit', 'withdrawal'], 'cashOps.kind');
  // The original app allows deleting a phone after cancelling its sale.
  // Keep that historical record; only active sales require an existing phone.
  for (const row of state.sales) if (row.status === 'completed') ref(row.phoneId, 'phones', 'sales.phoneId');
  for (const row of state.accessoryBatches) {
    ref(row.itemId, 'accessoryItems', 'accessoryBatches.itemId');
    choice(row.kind, ['purchase', 'adjust', 'writeoff'], 'accessoryBatches.kind');
    if (row.kind === 'purchase' || row.accountId) ref(row.accountId, 'accounts', 'accessoryBatches.accountId');
  }
  for (const row of [...state.sales, ...state.accessorySales]) choice(row.status, ['completed', 'cancelled'], 'sales.status');
  for (const row of state.accessorySales) {
    if (!Array.isArray(row.items) || !row.items.length) fail('Нет позиций продажи аксессуаров');
    for (const item of row.items) {
      if (!object(item)) fail('Неверная позиция продажи');
      ref(item.itemId, 'accessoryItems', 'items.itemId');
      text(item.name, 'items.name');
      text(item.category, 'items.category');
      for (const key of ['qty', 'unitPrice', 'unitCost']) number(item[key], `items.${key}`);
      if (!Array.isArray(item.allocations)) fail('Нет распределения партий');
      for (const allocation of item.allocations) {
        if (!object(allocation)) fail('Неверное распределение партии');
        ref(allocation.batchId, 'accessoryBatches', 'allocations.batchId');
        number(allocation.qty, 'allocations.qty');
        const batch = state.accessoryBatches.find(x => x.id === allocation.batchId);
        if (batch.itemId !== item.itemId || allocation.qty <= 0) fail('Неверное распределение партии');
      }
    }
  }
  return state;
}
export function validateLocal(entries) {
  if (!Array.isArray(entries)) fail('Нет localStorage');
  const keys = new Set();
  for (const entry of entries) {
    if (!object(entry) || typeof entry.key !== 'string' || !isLocalKey(entry.key) || keys.has(entry.key) || typeof entry.value !== 'string') fail('Неверный ключ localStorage');
    keys.add(entry.key);
    if (entry.key === 'phonebooks.theme') choice(entry.value, ['dark', 'light', 'system'], 'theme');
    else {
      const value = JSON.parse(entry.value); safeJson(value);
      if (!object(value)) fail('Неверный черновик или legacy-состояние');
      if (entry.key === 'phonebooks.data.v1') validateState(value, { legacy: true });
      else if (['phonebooks.draft.phone-new', 'phonebooks.draft.sale-new'].includes(entry.key)) {
        const numericInputs = ['purchasePrice', 'plannedPrice', 'price', 'discount', 'accDiscount'];
        for (const [key, field] of Object.entries(value)) {
          if (key === 'accLines') {
            if (!Array.isArray(field)) fail('Черновик: accLines должен быть массивом');
            for (const line of field) {
              if (!object(line)) fail('Неверная строка черновика');
              text(line.itemId, 'draft.itemId'); number(line.qty, 'draft.qty'); number(line.unitPrice, 'draft.unitPrice');
            }
          } else if (numericInputs.includes(key)) {
            if (typeof field !== 'string') number(field, `draft.${key}`);
          } else text(field, `draft.${key}`);
        }
      }
    }
  }
  return entries;
}
export function validateSnapshot(snapshot) {
  if (!object(snapshot) || !object(snapshot.indexedDB)) fail('Нет снимка хранилищ');
  safeJson(snapshot);
  const db = snapshot.indexedDB;
  if (db.name !== 'phonebooks' || db.version !== 1) fail('Неизвестная база или версия');
  for (const name of ['state', 'backups', 'meta']) {
    if (!Array.isArray(db[name])) fail(`Нет хранилища ${name}`);
    const keys = new Set();
    for (const entry of db[name]) {
      if (!object(entry) || typeof entry.key !== 'string' || keys.has(entry.key) || !('value' in entry)) fail(`Неверная запись ${name}`);
      keys.add(entry.key);
      if (name === 'state') validateState(entry.value);
      if (name === 'backups') {
        const backup = entry.value;
        if (!object(backup) || backup.id !== entry.key || typeof backup.payload !== 'string') fail('Неверная точка восстановления');
        date(backup.at, 'backups.at');
        const data = validateState(JSON.parse(backup.payload), { legacy: true });
        number(backup.phones, 'backups.phones'); number(backup.sales, 'backups.sales'); text(backup.reason, 'backups.reason');
        if (backup.phones !== data.phones.length || backup.sales !== data.sales.length) fail('Счётчики точки восстановления не соответствуют данным');
      }
      if (name === 'meta' && entry.key === 'lastSaved') date(entry.value?.at, 'lastSaved.at');
      if (name === 'meta' && entry.key === 'pendingImport') fail('Незавершённый импорт в файле');
      if (name === 'meta' && entry.key.startsWith('recovery:')) validateSnapshot(entry.value);
    }
  }
  const current = db.state.find(x => x.key === 'current');
  if (!current) fail('Нет текущего состояния');
  validateLocal(snapshot.localStorage);
  return snapshot;
}
export function buildExportFile(snapshot) {
  requireDataTransfer();
  validateSnapshot(snapshot);
  const file = { app: 'PhoneBooks', formatVersion: FORMAT_VERSION, schemaVersion: 1, exportedAt: new Date().toISOString(), snapshot: structuredClone(snapshot) };
  if (new TextEncoder().encode(JSON.stringify(file, null, 2)).length > MAX_FILE_BYTES) fail('Полная копия больше 32 МБ: импорт такого файла невозможен');
  return file;
}
export function parseImportFile(source) {
  requireDataTransfer();
  try {
    if (new TextEncoder().encode(source).length > MAX_FILE_BYTES) fail('Файл больше 32 МБ');
    const file = JSON.parse(source); safeJson(file);
    if (!object(file)) fail('Нет данных PhoneBooks');
    if ('formatVersion' in file) {
      if (file.app !== 'PhoneBooks' || file.formatVersion !== FORMAT_VERSION || file.schemaVersion !== 1) fail('Неизвестный формат или версия копии');
      date(file.exportedAt, 'exportedAt');
      validateSnapshot(file.snapshot);
      return { snapshot: file.snapshot, data: file.snapshot.indexedDB.state.find(x => x.key === 'current').value, legacy: false, error: null };
    }
    if ('data' in file && (file.app !== 'PhoneBooks' || file.version !== 1)) fail('Неизвестный старый формат');
    const data = validateState('data' in file ? file.data : file, { legacy: true });
    return { data, snapshot: null, legacy: true, error: null };
  } catch (error) { return { data: null, snapshot: null, error: `Копия не принята: ${error.message}` }; }
}
