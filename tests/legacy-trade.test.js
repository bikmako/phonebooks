import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAccessorySale, getAccessoryStock } from '../src/domain/accessories.js';
import { applyLegacyTrade } from '../src/domain/legacyTrade.js';
import { createSale } from '../src/domain/sales.js';
import { prepareSoloTransfer } from '../src/domain/soloTransfer.js';
import { validateState } from '../src/storage/backupFormat.js';
import { getAccountBalance, getStats } from '../src/utils/calculations.js';
import { getPeriod, today } from '../src/utils/format.js';
import { realisticSnapshot } from './fixtures/realistic.js';

test('legacy reservations protect stock and use the negotiated price in the original sale form', () => {
  let state = realisticSnapshot().indexedDB.state[0].value;
  const item = state.accessoryItems[0];
  const accountId = state.accounts[0].id;
  const productId = 'accessory:' + item.id;
  const quantity = getAccessoryStock(state, item.id);
  state = applyLegacyTrade(state, { type: 'reserve', productId, quantity, buyer: 'Покупатель',
    unitPriceMinor: 55000, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  assert.throws(() => buildAccessorySale(state, { items: [{ itemId: item.id, qty: 1 }], date: today(), accountId }), /забронирована/);
  const before = getAccountBalance(state, accountId);
  state = applyLegacyTrade(state, { type: 'sale', productId, quantity: 1, reservationId: state.legacyTrade[0].id, unitPriceMinor: 55000, accountId });
  assert.equal(getAccountBalance(state, accountId), before + 550);
  assert.equal(getAccessoryStock(state, item.id), quantity - 1);
  validateState(state);
  assert.equal(prepareSoloTransfer({ state }).reservations[0].quantity, quantity - 1);
});

test('a returned legacy phone restores its recorded cost, can sell again and retains the original ledger', () => {
  let state = realisticSnapshot().indexedDB.state[0].value;
  const sale = state.sales.find(row => row.status === 'completed');
  const originalCost = state.phones.find(row => row.id === sale.phoneId).purchasePrice;
  const productId = 'phone:' + sale.phoneId;
  const command = { type: 'customer_return', productId, originalId: 'sale:' + sale.id, quantity: 1,
    amountMinor: 3450000, reason: 'Проверка', accountId: sale.accountId };
  const stats = getStats(state, getPeriod('all'));
  const balance = getAccountBalance(state, sale.accountId);
  state = applyLegacyTrade(state, command);
  assert.equal(getAccountBalance(state, sale.accountId), balance - 34500);
  assert.equal(getStats(state, getPeriod('all')).cogs, stats.cogs - originalCost);
  assert.throws(() => applyLegacyTrade(state, command));
  state = createSale(state, { phoneId: sale.phoneId, price: 34000, accountId: sale.accountId, date: today(), paymentMethod: 'card' });
  const material = prepareSoloTransfer({ state: validateState(state) });
  assert.equal(material.operations.filter(row => row.type === 'customer_return').length, 1);
  assert.equal(state.sales.filter(row => row.phoneId === sale.phoneId && row.status === 'completed').length, 2);
});
