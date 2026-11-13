import { createInitialState } from '../storage/initialState.js';
import { saveAccount } from '../domain/accounts.js';
import { createPhone, setPhoneStatus } from '../domain/phones.js';
import { createSale, cancelSale } from '../domain/sales.js';
import { createAccessoryBatch, createAccessorySale, adjustAccessoryStock } from '../domain/accessories.js';
import { saveExpense } from '../domain/expenses.js';
import { saveTransfer } from '../domain/transfers.js';
import { saveCashOp } from '../domain/cashOps.js';
import { completeRepair, getRepairSessionId } from '../domain/repairs.js';
import { addDays, toISODate } from '../utils/format.js';

// Domain APIs keep money, stock allocations and audit references consistent.
// No customer details, telephone numbers or actual device identifiers are used.
export function createDemoState(reference = new Date()) {
  const date = days => toISODate(addDays(reference, -days));
  let state = createInitialState();
  const cash = state.accounts[0].id;
  state.accounts[0].openingBalance = 800000;
  state.settings.businessName = 'PhoneBooks · Демо-магазин';
  state = saveAccount(state, { name: 'Расчётный счёт', type: 'bank', color: '#2563eb', openingBalance: 300000 });
  const bank = state.accounts[1].id;
  const models = [
    ['iPhone 15 Pro', 62000, 74900, '256 ГБ', 'Титан'],
    ['iPhone 14', 32000, 39900, '128 ГБ', 'Синий'],
    ['Samsung Galaxy S24', 39000, 48900, '256 ГБ', 'Серый'],
    ['iPhone 13', 23500, 29900, '128 ГБ', 'Белый'],
    ['Google Pixel 8', 28000, 35900, '128 ГБ', 'Чёрный'],
    ['Xiaomi 14', 31000, 39900, '256 ГБ', 'Зелёный'],
    ['iPhone 15', 42000, 52900, '128 ГБ', 'Розовый'],
    ['Samsung Galaxy A55', 18000, 23900, '128 ГБ', 'Сиреневый'],
    ['OnePlus 12', 35000, 44900, '256 ГБ', 'Чёрный'],
    ['iPhone 12', 15000, 21900, '64 ГБ', 'Чёрный'],
    ['Nothing Phone (2)', 22000, 29900, '256 ГБ', 'Белый'],
    ['Samsung Galaxy S23', 29000, 37900, '256 ГБ', 'Зелёный'],
    ['Google Pixel 7a', 17000, 23900, '128 ГБ', 'Голубой'],
    ['iPhone SE (2022)', 11000, 16900, '64 ГБ', 'Красный'],
  ];
  const phones = [];
  for (const [index, [model, purchasePrice, plannedPrice, storage, color]] of models.entries()) {
    state = createPhone(state, { model, purchasePrice, plannedPrice, storage, color, imei: '',
      condition: index % 3 ? 'good' : 'like_new', kit: 'Коробка и кабель',
      purchaseAccountId: index % 2 ? bank : cash, purchasePaymentMethod: index % 2 ? 'card' : 'cash',
      purchaseDate: date(24 - index), supplierName: `Демо-продавец ${index + 1}`, supplierPhone: '',
      purchaseComment: 'Синтетическая закупка · только для ознакомления' });
    phones.push(state.phones[0].id);
  }
  state = setPhoneStatus(state, phones[3], 'repair');
  state = completeRepair(state, phones[3], { sessionId: getRepairSessionId(state.phones.find(p => p.id === phones[3])), amount: 1500, accountId: cash, comment: 'Демо: замена аккумулятора' });
  // The interactive repair API records today's date; this synthetic historical
  // repair happened before the phone's sample sale.
  state.phones.find(p => p.id === phones[3]).repairs[0].date = date(14);
  for (let index = 0; index < 7; index++) {
    state = createSale(state, { phoneId: phones[index], price: models[index][2], discount: index % 2 ? 500 : 0,
      accountId: index % 2 ? cash : bank, paymentMethod: index % 2 ? 'cash' : 'card', date: date(12 - index * 2),
      buyerName: `Демо-покупатель ${index + 1}`, buyerPhone: '', comment: 'Синтетическая продажа' });
  }
  state = createSale(state, { phoneId: phones[7], price: models[7][2], discount: 0, accountId: cash, paymentMethod: 'cash', date: date(2), buyerName: 'Демо: возврат', buyerPhone: '' });
  state = cancelSale(state, state.sales[0].id);
  state = setPhoneStatus(state, phones[8], 'reserved');
  state = setPhoneStatus(state, phones[9], 'repair');
  const items = [];
  for (const [name, category, unitCost, salePrice, qty] of [
    ['Силиконовый чехол iPhone 15', 'case', 250, 990, 20],
    ['Защитное стекло универсальное', 'glass', 120, 690, 30],
    ['Кабель USB-C 1 м', 'cable', 300, 890, 15],
    ['Зарядное устройство 20 Вт', 'charger', 600, 1490, 12],
    ['Чехол Samsung Galaxy S24', 'case', 280, 990, 5],
  ]) {
    state = createAccessoryBatch(state, { newItem: { name, category, salePrice, minStock: 4, compatibility: 'Демо-ассортимент', color: 'Разные' },
      qty, unitCost, accountId: cash, date: date(20), paymentMethod: 'cash', supplierName: 'Демо-поставщик' });
    items.push(state.accessoryItems[0].id);
  }
  for (let index = 0; index < 4; index++) {
    state = createAccessorySale(state, { items: [{ itemId: items[index], qty: 2, unitPrice: [990, 690, 890, 1490][index] }],
      accountId: index % 2 ? bank : cash, date: date(6 - index * 2), paymentMethod: index % 2 ? 'card' : 'cash', discount: index === 0 ? 100 : 0 });
  }
  state = adjustAccessoryStock(state, { itemId: items[4], delta: -2, comment: 'Демо: повреждена упаковка' });
  // Stock adjustment dates default to today in the interactive API. Keep the
  // seed reference consistent for reproducible previews and boundary tests.
  state.accessoryBatches[0].date = date(0);
  for (const [category, amount, days, vendor] of [['rent', 12000, 15, 'Демо: аренда витрины'], ['marketing', 2500, 7, 'Демо: реклама'], ['other', 850, 1, 'Демо: упаковка']]) {
    state = saveExpense(state, { category, amount, accountId: bank, date: date(days), vendor, comment: 'Тестовый расход' });
  }
  state = saveTransfer(state, { amount: 25000, fromAccountId: cash, toAccountId: bank, date: date(4), comment: 'Демо: инкассация' });
  state = saveCashOp(state, { kind: 'deposit', amount: 50000, accountId: cash, date: date(10), comment: 'Демо: пополнение' });
  state = saveCashOp(state, { kind: 'withdrawal', amount: 15000, accountId: cash, date: date(1), comment: 'Демо: снятие' });
  return state;
}
