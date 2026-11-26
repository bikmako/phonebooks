import React from 'react';
import { useStore } from '../hooks/useStore.jsx';
import { warehouseLabels, warehouseProjection } from '../domain/warehouse.js';
import { returnTypes } from '../domain/warehouseTrade.js';
import { SectionTitle } from '../product/ui.jsx';
import { warehouseMoney } from '../product/WarehouseFields.jsx';
import { formatDate, inPeriod } from '../utils/format.js';

export function WarehouseActivity({ repairs = false, range, query = '', onOpen }) {
  const { data } = useStore();
  const { products, operations } = warehouseProjection(data);
  const cards = data.catalog?.products ?? [];
  const active = repairs ? cards.filter(item => products.get(item.id)?.inRepair) : [];
  const events = operations.filter(item => (repairs ? ['repair', 'repair_start'].includes(item.type) || item.toRepair
    : item.type === 'sale' || returnTypes.includes(item.type) && item.type !== 'supplier_return')
    && (!range || inPeriod(item.date, range)) && item.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).slice(-30).reverse();
  if (!active.length && !events.length) return null;
  return <section className="pb-warehouse-history">
    <SectionTitle>{repairs ? 'Ремонты других товаров' : 'Продажи и возвраты товаров'}</SectionTitle>
    <ul className="pb-list">
      {active.map(item => <li key={item.id}><button type="button" className="pb-row" onClick={() => onOpen(item.id)}>
        <span>В ремонте</span><strong>{item.name}</strong></button></li>)}
      {events.map(event => <li key={event.id}><button type="button" className="pb-row" onClick={() => onOpen(event.productId)}>
        <span>{formatDate(event.date)}</span><span><strong>{event.name}</strong><small>{warehouseLabels[event.type]}</small></span>
        <span className="pb-row-end">{event.cashMinor !== 0 && warehouseMoney(event.cashMinor)}
          {!repairs && <small>Прибыль {warehouseMoney(event.revenueMinor - event.costMinor)}</small>}</span>
      </button></li>)}
    </ul>
  </section>;
}
