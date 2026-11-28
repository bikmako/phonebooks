import React, { useEffect, useState } from 'react';
import { useStore } from '../hooks/useStore.jsx';
import { projectInventory } from '../domain/inventory.js';
import { readInventoryCatalog } from '../storage/inventoryStore.js';
import { SectionTitle } from '../product/ui.jsx';
import { matchesWarehouse, WarehouseSearch } from '../product/WarehouseSearch.jsx';
import { getAllOperations } from '../utils/operations.js';
import { formatDate, formatPreciseMoney } from '../utils/format.js';

export function SoloWarehouseSearch({ onNavigate }) {
  const { data } = useStore();
  const [legacy, setLegacy] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    readInventoryCatalog().then(value => { if (active) setLegacy(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const catalog = data.catalog ?? legacy;
  const products = projectInventory(data, catalog ?? undefined).products;
  function open(item) {
    const [kind, id] = item.id.split(':');
    if (kind === 'phone') onNavigate('purchase', id);
    else if (kind === 'accessory') onNavigate('accessories', id);
    else onNavigate('catalog', item.id);
  }
  return <>
    {error && !data.catalog && <p role="alert">Не удалось открыть локальные категории.</p>}
    <WarehouseSearch products={products} onProduct={open} history={query => {
      const find = query.toLocaleLowerCase('ru');
      const matchingIds = new Set(products.filter(item => matchesWarehouse(item, query)).map(item => item.id));
      const matching = getAllOperations(data).filter(op =>
        [op.title, op.subtitle, op.date, op.meta?.account].join(' ').toLocaleLowerCase('ru').includes(find) ||
        matchingIds.has(op.meta?.productId) || matchingIds.has('phone:' + op.meta?.phoneId) || matchingIds.has('accessory:' + op.meta?.itemId));
      return <section className="pb-warehouse-history">
        <SectionTitle>История операций</SectionTitle>
        {matching.length ? <ul className="pb-list">{matching.map(op => <li key={op.id}>
          <span>{formatDate(op.date)}</span><strong>{op.title}</strong><span>{formatPreciseMoney(op.amount)}</span>
        </li>)}</ul> : <p className="pb-empty">Операции не найдены.</p>}
      </section>;
    }} />
  </>;
}
