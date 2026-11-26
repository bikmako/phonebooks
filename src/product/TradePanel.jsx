import React, { useState } from 'react';
import { parseMinor } from '../domain/warehouse.js';
import { returnTypes } from '../domain/warehouseTrade.js';
import { formatDate } from '../utils/format.js';
import { PageTitle, SectionTitle } from './ui.jsx';
import { priceInput, warehouseMoney } from './WarehouseFields.jsx';

export const tradeLabels = {
  reserve: 'Забронировать', customer_return: 'Возврат покупателя', supplier_return: 'Возврат поставщику',
  compensation: 'Денежная компенсация', void_sale: 'Отменить продажу', sale: 'Продать из резерва',
  extend_reserve: 'Продлить', cancel_reserve: 'Отменить бронь',
};
const deadline = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

function eligibleSource(item, kind) {
  if (kind === 'supplier_return') return item.type === 'purchase' && item.leftUnits > 0;
  if (item.type !== 'sale') return false;
  if (kind === 'compensation') return item.hasMoney ?? Number(item.leftMinor) > 0;
  if (kind === 'void_sale') return item.canVoid ?? (item.leftUnits === item.units && Number(item.leftMinor) === Number(item.amountMinor));
  return item.leftUnits > 0;
}

export function TradePanel({ product, originals, reservations, accounts, allowed, busy, disabled, submit, initialAction, onAction }) {
  const [action, setAction] = useState(initialAction ? { kind: initialAction } : null);
  const [originalId, setOriginalId] = useState('');
  const [error, setError] = useState('');
  const kind = allowed.includes(action?.kind) ? action.kind : '';
  const booking = reservations.find(item => item.id === action?.reservationId);
  const isReturn = returnTypes.includes(kind);
  const available = Math.max(0, product.quantity - (product.reservedQuantity ?? product.reserved ?? 0));
  const sources = isReturn ? originals.filter(item => eligibleSource(item, kind)) : [];
  const returnActions = returnTypes.filter(key => allowed.includes(key));
  const original = sources.find(item => item.id === originalId) ?? sources[0];
  const visible = kind === 'reserve' ? available > 0 && !product.inRepair : isReturn ? Boolean(original) : Boolean(booking);

  function start(next, reservationId) {
    setAction({ kind: next, reservationId });
    setOriginalId('');
    setError('');
    onAction?.();
    window.scrollTo(0, 0);
  }

  async function save(event) {
    event.preventDefault();
    if (disabled || busy || !visible) return;
    setError('');
    const values = new FormData(event.currentTarget);
    const command = { type: kind, productId: product.id, expectedVersion: product.version };
    try {
      if (booking) command.reservationId = booking.id;
      if (kind === 'reserve' || kind === 'extend_reserve') {
        const date = new Date(values.get('expiry'));
        if (!Number.isFinite(date.getTime())) throw new Error('Укажите срок бронирования.');
        command.expiresAt = date.toISOString();
      }
      if (kind === 'reserve') Object.assign(command, {
        buyer: values.get('buyer').trim(), contact: values.get('contact').trim(), note: values.get('note').trim(),
        quantity: Number(values.get('quantity')), unitPriceMinor: parseMinor(values.get('unitPrice')),
      });
      if (kind === 'sale') Object.assign(command, { quantity: Number(values.get('quantity')), unitPriceMinor: Number(booking.unitMinor),
        accountId: values.get('accountId') });
      if (isReturn) Object.assign(command, { originalId: original.id,
        quantity: kind === 'compensation' ? 0 : kind === 'void_sale' ? original.units : Number(values.get('quantity')),
        amountMinor: kind === 'void_sale'
          ? (original.amountMinor == null ? null : Number(original.amountMinor)) : parseMinor(values.get('amount')),
        accountId: values.get('accountId'), reason: values.get('reason').trim(), toRepair: values.get('destination') === 'repair',
      });
      if (await submit(command)) setAction(null);
    } catch (failure) { setError(failure.message); }
  }

  return <section className="pb-trade" aria-label="Возвраты и бронирования">
    <PageTitle title={kind && visible ? tradeLabels[kind] : 'Возвраты и бронирования'} eyebrow={product.name} />
    {kind && visible ? <form className="pb-trade-form" onSubmit={save} key={kind + (booking?.id ?? '')}>
      {error && <p role="alert" className="pb-empty">{error}</p>}
      <fieldset disabled={disabled || busy}>
        {isReturn && <>
          <label>Исходная операция<select className="input" value={original.id} onChange={event => setOriginalId(event.target.value)}>
            {sources.map(item => <option value={item.id} key={item.id}>
              {formatDate(item.date)} · {item.units} шт.{item.amountMinor != null && ' · ' + warehouseMoney(item.amountMinor)} · {item.id.slice(-8)}
            </option>)}
          </select></label>
          <div className="pb-trade-fields" key={original.id}>
            {!['compensation', 'void_sale'].includes(kind) && <label>Количество<input className="input" name="quantity"
              type="number" min="1" max={kind === 'supplier_return' ? Math.min(original.leftUnits, available) : original.leftUnits} required defaultValue="1" /></label>}
            {(kind !== 'void_sale' || original.amountMinor != null) &&
              <label>Сумма возврата, ₽<input className="input" name="amount" inputMode="decimal" required
                defaultValue={kind === 'void_sale' ? priceInput(original.amountMinor) : undefined} readOnly={kind === 'void_sale'} /></label>}
          </div>
          <p className="pb-trade-hint">{kind === 'void_sale' && original.amountMinor == null
            ? 'Будет возвращена вся сумма исходной продажи.'
            : <>По операции осталось {original.leftUnits} шт.{original.leftMinor != null && ' и ' + warehouseMoney(original.leftMinor)}.</>}</p>
          {['customer_return', 'void_sale'].includes(kind) && product.tracking === 'unit' && allowed.includes('repair_start') &&
            <label>Куда вернуть товар<select className="input" name="destination">
              <option value="stock">На склад</option><option value="repair">В ремонт</option>
            </select></label>}
          <label>Причина<textarea className="input" name="reason" rows="2" maxLength="500" required /></label>
        </>}
        {kind === 'reserve' && <>
          <div className="pb-trade-fields">
            <label>Имя покупателя<input className="input" name="buyer" maxLength="100" required /></label>
            <label>Контакт<input className="input" name="contact" maxLength="100" /></label>
          </div>
          <div className="pb-trade-fields">
            <label>Количество<input className="input" name="quantity" type="number" min="1" max={available} required defaultValue="1" /></label>
            <label>Цена за единицу, ₽<input className="input" name="unitPrice" inputMode="decimal" defaultValue={priceInput(product.plannedPriceMinor)} required /></label>
          </div>
        </>}
        {['reserve', 'extend_reserve'].includes(kind) && <label>Срок бронирования<input className="input" name="expiry" type="datetime-local" required /></label>}
        {kind === 'reserve' && <label>Комментарий<textarea className="input" name="note" rows="2" maxLength="500" /></label>}
        {booking && <p className="pb-trade-hint">{booking.buyer} · {booking.quantity} шт. · {warehouseMoney(booking.unitMinor)} за ед. · до {deadline(booking.expiresAt)}</p>}
        {kind === 'sale' && <label>Количество<input className="input" name="quantity" type="number" min="1" max={booking.quantity} required defaultValue={booking.quantity} /></label>}
        {(kind === 'sale' || isReturn) && <label>Счёт<select className="input" name="accountId">
          {!accounts.length && <option value="">Нет доступных счетов</option>}
          {accounts.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>}
      </fieldset>
      <div className="pb-actions pb-warehouse-actions pb-trade-confirm">
        <button type="button" className="pb-action pb-action-secondary secondary" onClick={() => setAction(null)}>Назад</button>
        <button type="submit" className="pb-action" disabled={disabled || busy}>{busy ? 'Сохраняем…' : tradeLabels[kind]}</button>
      </div>
    </form> : <>
      {action && <p className="pb-trade-hint" role="status">Операция больше недоступна. Проверьте остатки и срок.</p>}
      {allowed.includes('reserve') && available > 0 && !product.inRepair &&
        <button type="button" className="pb-action pb-trade-create" onClick={() => start('reserve')} disabled={disabled}>Забронировать</button>}
      <SectionTitle>Активные бронирования</SectionTitle>
      {reservations.length ? <ul className="pb-trade-bookings">{reservations.map(item => <li key={item.id}>
        <strong>{item.buyer}</strong>
        <span>{item.quantity} шт. · {warehouseMoney(item.unitMinor)} за ед. · до {deadline(item.expiresAt)}</span>
        {item.contact && <span>{item.contact}</span>}{item.note && <span>{item.note}</span>}
        <div className="pb-actions pb-warehouse-actions">{['sale', 'extend_reserve', 'cancel_reserve'].filter(key => allowed.includes(key)).map(key =>
          <button type="button" key={key} className={'pb-action' + (key === 'sale' ? '' : ' pb-action-secondary secondary')}
            disabled={disabled} onClick={() => start(key, item.id)}>{tradeLabels[key]}</button>)}</div>
      </li>)}</ul> : <p className="pb-trade-hint">Активных бронирований нет.</p>}
      {returnActions.length > 0 && <SectionTitle>Возвраты</SectionTitle>}
      <div className="pb-actions pb-warehouse-actions">{returnActions.map(key =>
        <button type="button" key={key} className="pb-action pb-action-secondary secondary"
          disabled={disabled || !originals.some(item => eligibleSource(item, key)) || key === 'supplier_return' && (!available || product.inRepair)}
          onClick={() => start(key)}>{tradeLabels[key]}</button>)}</div>
    </>}
  </section>;
}
