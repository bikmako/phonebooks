import { createAccessorySale, getAccessoryStock } from './accessories.js';
import { accessoryProductId, phoneProductId } from './inventory.js';
import { legacyBookings, legacyCorrections, legacyPhoneCost, phoneUnavailable } from './legacyTradeState.js';
import { createSale } from './sales.js';
import { assert, assertSufficientFunds, getActiveAccount, makeAuditEntry, makeId, nowISO, withAudit } from './shared.js';
import { assertReturn, remainingReturn, returnTypes } from './warehouseTrade.js';
import { getSaleRevenue } from '../utils/calculations.js';
import { today } from '../utils/format.js';

const minor = value => Math.round(value * 100);

function returnedAccessoryLots(state, original, quantity, skipped) {
  const item = original.item;
  const parts = (item.allocations ?? []).map(allocation => {
    const batch = state.accessoryBatches.find(row => row.id === allocation.batchId && row.itemId === item.itemId);
    return { quantity: allocation.qty, unitMinor: batch ? minor(batch.unitCost) : null };
  });
  const total = parts.reduce((amount, row) => amount + row.quantity * (row.unitMinor ?? 0), 0);
  if (!parts.some(row => row.unitMinor === null) && total === original.costMinor &&
    parts.reduce((count, row) => count + row.quantity, 0) === original.units) {
    const returned = [];
    let left = quantity;
    for (const part of parts) {
      const offset = Math.min(skipped, part.quantity);
      skipped -= offset;
      const amount = Math.min(left, part.quantity - offset);
      left -= amount;
      if (amount) returned.push({ units: amount, unitMinor: part.unitMinor });
    }
    return returned;
  }
  assert(quantity === original.units, 'Для частичного возврата отсутствует история себестоимости по партиям.');
  const price = Math.floor(original.costMinor / quantity);
  const remainder = original.costMinor % quantity;
  return [{ units: quantity - remainder, unitMinor: price }, { units: remainder, unitMinor: price + 1 }].filter(row => row.units);
}

export function legacyTradeContext(state, productId) {
  const phone = state.phones.find(row => phoneProductId(row.id) === productId);
  const accessory = state.accessoryItems.find(row => accessoryProductId(row.id) === productId);
  if (!phone && !accessory) return null;
  const reservations = legacyBookings(state, productId);
  const product = { id: productId, name: phone?.model ?? accessory.name, tracking: phone ? 'unit' : 'quantity',
    quantity: phone ? Number(!phoneUnavailable(phone)) : getAccessoryStock(state, accessory.id),
    reservedQuantity: reservations.reduce((sum, row) => sum + row.quantity, 0) || Number(phone?.status === 'reserved'),
    inRepair: phone?.status === 'repair', plannedPriceMinor: minor(phone?.plannedPrice ?? accessory?.salePrice ?? 0) };
  const rows = phone ? [
    { id: productId, type: 'purchase', units: 1, date: phone.purchaseDate, amountMinor: minor(phone.purchasePrice), purchase: phone },
    ...state.sales.filter(row => row.phoneId === phone.id && row.status === 'completed').map(row => ({
      id: 'sale:' + row.id, type: 'sale', units: 1, date: row.date, amountMinor: minor(getSaleRevenue(row)), costMinor: legacyPhoneCost(row, phone), sale: row,
    })),
  ] : [
    ...state.accessoryBatches.filter(row => row.itemId === accessory.id && row.kind === 'purchase' && row.qtyLeft > 0).map(row => ({
      id: 'acc_batch:' + row.id, type: 'purchase', units: row.qty, date: row.date, amountMinor: minor(row.qty * row.unitCost), purchase: row,
    })),
    ...state.accessorySales.filter(row => row.status === 'completed' && (!row.discount || row.items.length === 1)).flatMap(row =>
      row.items.flatMap((item, index) => item.itemId !== accessory.id ? [] : [{ id: 'acc_sale:' + row.id, line: index + 1, type: 'sale', units: item.qty,
        date: row.date, amountMinor: minor(item.unitPrice * item.qty - (row.discount || 0)), costMinor: minor(item.unitCost * item.qty), sale: row, item }])),
  ];
  const originals = rows.map(row => {
    const earlier = legacyCorrections(state, row.id, productId);
    const left = remainingReturn(row, earlier);
    return { ...row, leftUnits: Math.min(left.units, row.purchase?.qtyLeft ?? left.units), leftMinor: left.amountMinor,
      canReturn: Number.isSafeInteger(row.costMinor), canVoid: row.type === 'sale' && !earlier.length && (Boolean(phone) || row.sale.items.length === 1) };
  }).filter(row => row.leftUnits > 0 || row.leftMinor > 0).reverse();
  return { product, phone, accessory, reservations, originals };
}

export function applyLegacyTrade(state, command) {
  const { type, productId, reservationId } = command;
  const context = legacyTradeContext(state, productId);
  assert(context, 'Товар не найден.');
  const { product, phone, accessory, originals, reservations } = context;
  const available = product.quantity - product.reservedQuantity;
  const quantity = command.quantity;
  const events = state.legacyTrade ?? [];
  const booking = reservations.find(row => row.id === reservationId);
  const validQuantity = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100000;
  const updateBooking = changes => events.map(row => row.id === booking.id ? { ...row, ...changes } : row);
  let next = state;
  if (type === 'reserve') {
    assert(validQuantity && quantity <= available && !product.inRepair, 'Недостаточный доступный остаток.');
    assert(command.buyer?.trim() && Date.parse(command.expiresAt) > Date.now() && Number.isSafeInteger(command.unitPriceMinor) &&
      command.unitPriceMinor > 0, 'Укажите покупателя, цену и срок в будущем.');
    next = { ...state, legacyTrade: [...events, { id: makeId('booking'), type, productId, quantity, date: today(),
      buyer: command.buyer.trim(), contact: command.contact ?? '', note: command.note ?? '', unitMinor: command.unitPriceMinor,
      status: 'active', expiresAt: command.expiresAt }] };
  } else if (['extend_reserve', 'cancel_reserve', 'sale'].includes(type)) {
    assert(booking, 'Активное бронирование не найдено.');
    if (type === 'extend_reserve') {
      assert(Date.parse(command.expiresAt) > Date.parse(booking.expiresAt), 'Укажите срок позже действующего.');
      next = { ...state, legacyTrade: updateBooking({ expiresAt: command.expiresAt }) };
    } else if (type === 'cancel_reserve') next = { ...state, legacyTrade: updateBooking({ status: 'cancelled' }) };
    else {
      assert(validQuantity && quantity <= booking.quantity && command.unitPriceMinor === booking.unitMinor, 'Бронь изменилась.');
      const input = { date: today(), accountId: command.accountId, discount: 0, paymentMethod: 'cash', reservationId };
      next = phone ? createSale(state, { ...input, phoneId: phone.id, price: booking.unitMinor / 100, buyerName: booking.buyer, buyerPhone: '' }) :
        createAccessorySale(state, { ...input, items: [{ itemId: accessory.id, qty: quantity, unitPrice: booking.unitMinor / 100 }] });
      next = { ...next, legacyTrade: updateBooking({ quantity: booking.quantity - quantity,
        status: quantity === booking.quantity ? 'sold' : 'active' }) };
    }
  } else {
    assert(returnTypes.includes(type), 'Неизвестная операция.');
    const supplier = type === 'supplier_return';
    const original = originals.find(row => row.id === command.originalId && row.type === (supplier ? 'purchase' : 'sale'));
    const amount = command.amountMinor;
    assert(original && Number.isSafeInteger(amount) && amount >= 0 && (type === 'compensation' ? quantity === 0 && amount > 0 : validQuantity) &&
      command.reason?.trim() && command.reason.length <= 500, 'Выберите исходную операцию и укажите причину.');
    const earlier = legacyCorrections(state, original.id, productId);
    assertReturn(original, earlier, { ...command, units: quantity });
    if (amount) {
      getActiveAccount(state, command.accountId);
      if (!supplier) assertSufficientFunds(state, command.accountId, amount / 100, 'Возврат');
    }
    let costMinor = 0, expenseMinor = 0;
    if (supplier) {
      assert(quantity <= available && quantity <= original.leftUnits && !product.inRepair, 'В партии недостаточно свободного остатка.');
      const purchase = original.purchase;
      expenseMinor = minor(phone ? phone.purchasePrice + (phone.repairs ?? []).reduce((total, row) => total + row.amount, 0) : purchase.unitCost * quantity) - amount;
      next = phone ? { ...state, phones: state.phones.map(row => row.id === phone.id ? { ...row, status: 'supplier_returned', updatedAt: nowISO() } : row) } :
        { ...state, accessoryBatches: state.accessoryBatches.map(row => row.id === purchase.id ? { ...row, qtyLeft: row.qtyLeft - quantity } : row) };
    } else if (quantity) {
      const used = earlier.reduce((sum, row) => sum + row.units, 0);
      assert(Number.isSafeInteger(original.costMinor), 'Себестоимость исходной продажи недоступна.');
      if (phone) assert(phone.status === 'sold' && !state.sales.some(row => row.phoneId === phone.id && row.status === 'completed' &&
        row.id !== original.sale.id && !legacyCorrections(state, 'sale:' + row.id, productId).some(entry => entry.units)), 'Выберите последнюю невозвращённую продажу.');
      if (phone) {
        costMinor = -original.costMinor;
        next = { ...state,
          sales: state.sales.map(row => row.id === original.sale.id ? { ...row, costMinor: original.costMinor } : row),
          phones: state.phones.map(row => row.id === phone.id ? { ...row, status: command.toRepair ? 'repair' : 'in_stock', updatedAt: nowISO() } : row) };
      } else {
        const restored = returnedAccessoryLots(state, original, quantity, used);
        costMinor = -restored.reduce((sum, row) => sum + row.units * row.unitMinor, 0);
        const lots = restored.map(({ units, unitMinor }) => ({
          id: makeId('batch'), itemId: accessory.id, qty: units, qtyLeft: units, unitCost: unitMinor / 100, accountId: '',
          kind: 'adjust', date: today(), createdAt: nowISO(), fromReturn: true,
        }));
        next = { ...state, accessoryBatches: [...lots, ...state.accessoryBatches] };
      }
    }
    next = { ...next, legacyTrade: [...events, { id: makeId('trade'), type, productId, name: product.name, originalId: original.id,
      units: quantity, amountMinor: amount, date: today(), createdAt: nowISO(), originalLine: original.line ?? 1,
      reason: command.reason.trim(), accountId: amount ? command.accountId : null,
      cashMinor: supplier ? amount : -amount, revenueMinor: supplier ? 0 : -amount, costMinor, expenseMinor,
      stockDelta: supplier ? -quantity : quantity }] };
  }
  return withAudit(next, makeAuditEntry(state, 'create', 'warehouse', productId, 'Склад · ' + product.name));
}
