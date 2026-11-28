export function legacyBookings(state, productId, at = Date.now()) {
  return (state.legacyTrade ?? []).filter(row => row.type === 'reserve' && row.productId === productId &&
    row.status === 'active' && row.quantity > 0 && Date.parse(row.expiresAt) > at);
}

export function legacyHeld(state, productId, excluding) {
  return legacyBookings(state, productId).reduce((sum, row) => sum + (row.id === excluding ? 0 : row.quantity), 0);
}

export function legacyCorrections(state, originalId, productId) {
  return (state.legacyTrade ?? []).filter(row => row.originalId === originalId && (!productId || row.productId === productId));
}

export function legacyPhoneCost(sale, phone) {
  if (Number.isSafeInteger(sale.costMinor)) return sale.costMinor;
  if (!phone || !Number.isFinite(phone.purchasePrice)) return null;
  const repairs = phone.repairs ?? [];
  return Math.round((phone.purchasePrice + repairs.reduce((sum, row) => sum + row.amount, 0)) * 100);
}

export const phoneUnavailable = phone => ['sold', 'supplier_returned'].includes(phone.status);
export const legacyFinancialEvents = state => (state.legacyTrade ?? []).filter(row => row.originalId);
