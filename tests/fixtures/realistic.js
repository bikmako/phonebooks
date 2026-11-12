import { createInitialState } from '../../src/storage/initialState.js';
import { saveAccount } from '../../src/domain/accounts.js';
import { createPhone } from '../../src/domain/phones.js';
import { createSale, cancelSale } from '../../src/domain/sales.js';
import { createAccessoryBatch, createAccessorySale, adjustAccessoryStock } from '../../src/domain/accessories.js';
import { saveExpense } from '../../src/domain/expenses.js';
import { saveTransfer } from '../../src/domain/transfers.js';
import { saveCashOp } from '../../src/domain/cashOps.js';
import { emptyPurchaseForm } from '../../src/utils/drafts.js';
export function realisticSnapshot() {
  let data = createInitialState();
  const cash = data.accounts[0].id;
  data.accounts[0].openingBalance = 500000;
  data.settings.businessName = 'Учебная скупка — синтетические данные';
  data = saveAccount(data, { name: 'Учебный банк', type: 'bank', color: '#2563eb', openingBalance: 200000 });
  const bank = data.accounts[1].id;
  for (const [model, price, imei] of [['iPhone 14', 28000, '111111111111111'], ['Samsung S23', 31000, '222222222222222'], ['iPhone 13', 22000, '333333333333333']]) {
    data = createPhone(data, { ...emptyPurchaseForm(cash), model, imei, purchasePrice: price, plannedPrice: price + 8000, purchaseDate: '2026-01-03', supplierName: 'Учебный продавец', condition: 'good' });
  }
  data = createSale(data, { phoneId: data.phones[0].id, price: 35000, discount: 500, accountId: bank, date: '2026-01-05', paymentMethod: 'card', buyerName: 'Учебный покупатель' });
  data = createSale(data, { phoneId: data.phones[1].id, price: 40000, discount: 0, accountId: cash, date: '2026-01-05', paymentMethod: 'cash' });
  data = cancelSale(data, data.sales[0].id);
  for (const [name, category, unitCost] of [['Чехол', 'case', 200], ['Кабель', 'cable', 300]]) data = createAccessoryBatch(data, { newItem: { name, category, salePrice: 700, minStock: 2, compatibility: 'Учебная модель' }, qty: 15, unitCost, accountId: cash, date: '2026-01-03', paymentMethod: 'cash' });
  data = createAccessorySale(data, { items: data.accessoryItems.map(item => ({ itemId: item.id, qty: 2, unitPrice: 700 })), accountId: bank, date: '2026-01-05', paymentMethod: 'card', discount: 100 });
  data = adjustAccessoryStock(data, { itemId: data.accessoryItems[0].id, delta: -1, comment: 'Учебное списание' });
  data = saveExpense(data, { amount: 12000, category: 'rent', accountId: bank, date: '2026-01-06', vendor: 'Учебная аренда', comment: 'Только тест' });
  data = saveTransfer(data, { amount: 25000, fromAccountId: cash, toAccountId: bank, date: '2026-01-07' });
  for (const kind of ['deposit', 'withdrawal']) data = saveCashOp(data, { amount: kind === 'deposit' ? 10000 : 2500, kind, accountId: cash, date: '2026-01-08' });
  data.unknownExtension = { preserved: ['не терять', 42] };
  const snapshot = {
    indexedDB: { name: 'phonebooks', version: 1, state: [{ key: 'current', value: data }],
      backups: [{ key: 'fixture-point', value: { id: 'fixture-point', at: '2026-01-09T12:00:00.000Z', reason: 'manual', phones: data.phones.length, sales: data.sales.length, payload: JSON.stringify(data) } }],
      meta: [{ key: 'lastSaved', value: { at: '2026-01-09T12:00:00.000Z' } }, { key: 'fixture-metadata', value: { preserved: true } }] },
    localStorage: [
      { key: 'phonebooks.theme', value: 'dark' },
      { key: 'phonebooks.draft.phone-new', value: JSON.stringify({ ...emptyPurchaseForm(cash), model: 'Черновик Pixel', purchasePrice: '19500' }) },
      { key: 'phonebooks.draft.sale-new', value: JSON.stringify({ phoneId: data.phones[1].id, buyerName: 'Учебный черновик', price: '38000', discount: '0', accountId: cash, paymentMethod: 'cash', date: '2026-01-10', comment: '', accLines: [{ itemId: data.accessoryItems[0].id, qty: 1, unitPrice: 700 }], accDiscount: '0' }) },
    ],
  };
  snapshot.indexedDB.meta.sort((a, b) => a.key < b.key ? -1 : 1);
  snapshot.localStorage.sort((a, b) => a.key < b.key ? -1 : 1);
  return JSON.parse(JSON.stringify(snapshot));
}
