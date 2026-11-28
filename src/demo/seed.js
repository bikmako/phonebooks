import { createInitialState } from '../storage/initialState.js';
import { emptyInventory, saveInventoryCategory, saveInventoryProduct } from '../domain/inventory.js';
import { createPhone } from '../domain/phones.js';
import { createSale } from '../domain/sales.js';
import { createAccessoryBatch, createAccessorySale } from '../domain/accessories.js';
import { saveExpense } from '../domain/expenses.js';
import { emptyPurchaseForm } from '../utils/drafts.js';
import { addDays, toISODate } from '../utils/format.js';

export function createDemoState(now = new Date()) {
  let state = createInitialState();
  const accountId = state.accounts[0].id;
  const date = offset => toISODate(addDays(now, offset));
  state.accounts[0].openingBalance = 1800000;
  state.settings.businessName = 'Магазин «Второй круг»';
  const models = ['iPhone 14', 'Samsung Galaxy S23', 'Google Pixel 7', 'iPhone 13'];
  for (let index = 0; index < 12; index++) {
    const price = 21000 + index % 4 * 3100;
    const inStock = index >= 8;
    state = createPhone(state, { ...emptyPurchaseForm(accountId), model: models[index % 4],
      purchasePrice: price, plannedPrice: price + 8500, purchaseDate: date(inStock ? -80 + (index - 8) * 23 : -114 + index * 12),
      storage: '128 ГБ', color: index % 2 ? 'Графит' : 'Серебристый', condition: 'good',
      status: index === 11 ? 'repair' : 'in_stock',
      supplierName: 'Учебный поставщик' });
    if (!inStock) state = createSale(state, { phoneId: state.phones[0].id, price: price + 7500, discount: index % 2 * 500,
      accountId, date: date(-108 + index * 14), paymentMethod: 'cash', buyerName: 'Учебный покупатель' });
  }
  for (const [name, category, cost, price] of [['Кабель USB-C 1 м', 'cable', 220, 590], ['Чехол MagSafe', 'case', 470, 990]]) {
    state = createAccessoryBatch(state, { newItem: { name, category, salePrice: price }, qty: 24, unitCost: cost,
      accountId, date: date(-68), paymentMethod: 'cash' });
    state = createAccessorySale(state, { items: [{ itemId: state.accessoryItems[0].id, qty: 8, unitPrice: price }],
      accountId, date: date(-15), paymentMethod: 'cash', discount: 200 });
  }
  for (const [offset, amount, category] of [[-100, 9500, 'rent'], [-70, 9500, 'rent'], [-42, 9500, 'rent'], [-18, 2300, 'marketing'], [-7, 9500, 'rent']]) {
    state = saveExpense(state, { amount, category, accountId, date: date(offset), vendor: 'Учебный контрагент' });
  }
  let catalog = saveInventoryCategory(emptyInventory(), { id: 'demo-audio', name: 'Студийный звук',
    attributes: [{ id: 'connection', name: 'Подключение', type: 'text' }] });
  const events = [];
  function product(id, categoryId, name, plannedPrice, attributes = {}, tracking = 'unit') {
    const sku = { id: 'product:' + id, categoryId, name, plannedPriceMinor: plannedPrice * 100, tracking, attributes };
    catalog = saveInventoryProduct(catalog, sku);
    return sku;
  }
  function operation(item, type, offset, amount = 0, fields = {}) {
    const event = { id: 'warehouse:' + crypto.randomUUID(), type, productId: item.id, name: item.name,
      tracking: item.tracking, units: 1, amountMinor: amount * 100, accountId: amount ? accountId : null,
      date: date(offset), createdAt: new Date(date(offset) + 'T12:00:00Z').toISOString(), ...fields };
    events.push(event);
    return event.id;
  }
  const laptop = product('demo-thinkpad', 'laptops', 'Lenovo ThinkPad T14', 48500, { processor: 'Ryzen 5', ram: '16 ГБ' });
  operation(laptop, 'purchase', -84, 31000);
  const mac = product('demo-mac', 'laptops', 'MacBook Air M1', 56800, { ram: '8 ГБ', storage: '256 ГБ' });
  operation(mac, 'purchase', -36, 42000);
  operation(mac, 'repair_start', -33);
  operation(mac, 'repair', -30, 2800);
  operation(mac, 'sale', -28, 56000);
  const tablet = product('demo-ipad', 'tablets', 'iPad Air 5', 33900, { storage: '64 ГБ' });
  operation(tablet, 'purchase', -42, 24500);
  const tabletSale = operation(tablet, 'sale', -22, 32500);
  operation(tablet, 'customer_return', -16, 32500, { originalId: tabletSale, reason: 'Учебный возврат', toRepair: false });
  const console = product('demo-ps5', 'consoles', 'PlayStation 5 Slim', 42500, { edition: 'Disc Edition' });
  operation(console, 'purchase', -61, 33000);
  const consoleSale = operation(console, 'sale', -9, 42800);
  operation(console, 'compensation', -5, 900, { originalId: consoleSale, reason: 'Комплектация', toRepair: false, units: 0 });
  const watch = product('demo-watch', 'watches', 'Apple Watch SE 44 мм', 15500, { size: '44 мм' });
  operation(watch, 'purchase', -13, 10000);
  operation(watch, 'reserve', -1, 0, {
    buyer: 'Учебный покупатель', contact: '', note: 'Самовывоз', agreedMinor: 1520000,
    expiresAt: new Date(now.getTime() + 2 * 86400000).toISOString(),
  });
  const audio = product('demo-mic', 'demo-audio', 'Focusrite Scarlett Solo', 10900, { connection: 'USB-C' }, 'quantity');
  operation(audio, 'purchase', -8, 19500, { units: 3 });
  operation(audio, 'sale', -2, 10800);
  const camera = product('demo-tablet-repair', 'tablets', 'Samsung Galaxy Tab S8', 31900, { storage: '128 ГБ' });
  operation(camera, 'purchase', -19, 22900);
  operation(camera, 'repair_start', -3);
  return { ...state, catalog, warehouse: events };
}
