import { assert } from './shared.js';

export const returnTypes = ['customer_return', 'supplier_return', 'compensation', 'void_sale'];
export const reservationTypes = ['reserve', 'extend_reserve', 'cancel_reserve'];

export function portion(amount, units, total) {
  return Number(BigInt(amount) * BigInt(units) / BigInt(total));
}

export function activeReservations(bookings, productId, at = Date.now()) {
  return [...bookings.values()].filter(item => item.productId === productId && item.status === 'active' && Date.parse(item.expiresAt) > at);
}

export function remainingReturn(original, corrections) {
  return {
    units: original.units - corrections.reduce((total, item) => total + (item.units || 0), 0),
    amountMinor: original.amountMinor - corrections.reduce((total, item) => total + item.amountMinor, 0),
  };
}

export function assertReturn(original, corrections, event) {
  const remaining = remainingReturn(original, corrections);
  assert(event.units <= remaining.units && event.amountMinor <= remaining.amountMinor,
    'Количество или сумма превышает остаток по исходной операции.');
  if (event.type === 'void_sale') {
    assert(!corrections.length && event.units === original.units && event.amountMinor === original.amountMinor,
      'Для отмены требуется исходная продажа без корректировок и возврат всей суммы.');
  }
  if (event.type === 'customer_return' || event.type === 'supplier_return') {
    const alreadyReturned = original.units - remaining.units;
    const physicalRefund = corrections.filter(item => item.units > 0).reduce((sum, item) => sum + item.amountMinor, 0);
    assert(event.amountMinor <= portion(original.amountMinor, alreadyReturned + event.units, original.units) - physicalRefund,
      'Сумма превышает стоимость возвращаемых единиц.');
  }
}
