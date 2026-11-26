import React, { useState } from 'react';
import { Package, Search } from 'lucide-react';
import { SectionTitle } from './ui.jsx';

export const matchesWarehouse = (item, query) => [item.name, ...Object.values(item.attributes ?? {})]
  .join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));

export function WarehouseSearch({ products, onProduct, history, maySearchStock = true }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const matches = query ? products.filter(item => !item.archived && matchesWarehouse(item, query)) : [];
  return <>
    <form className="pb-warehouse-search pb-toolbar" onSubmit={event => {
      event.preventDefault();
      setQuery(text.trim());
      setLimit(30);
    }}>
      <input className="input" type="search" aria-label="Поиск по складу и истории" maxLength={120}
        placeholder="Название, характеристика или дата" value={text} onChange={event => setText(event.target.value)} />
      <button className="pb-action"><Search size={17} aria-hidden="true" />Найти</button>
    </form>
    {query && <>
      {maySearchStock && <section className="pb-warehouse-history" aria-label="Найденные товары">
        <SectionTitle>Товары</SectionTitle>
        {matches.length ? <ul className="pb-list">{matches.slice(0, limit).map(item => <li key={item.id}>
          <button className="pb-row" type="button" onClick={() => onProduct(item)}>
            <span className="pb-row-icon"><Package size={18} aria-hidden="true" /></span>
            <span><strong>{item.name}</strong><small>Остаток {item.quantity} шт.</small></span>
          </button>
        </li>)}</ul> : <p className="pb-empty">Товары не найдены.</p>}
        {matches.length > limit && <button className="pb-action pb-action-secondary" onClick={() => setLimit(limit + 30)}>Показать ещё товары</button>}
      </section>}
      {history?.(query)}
    </>}
  </>;
}
