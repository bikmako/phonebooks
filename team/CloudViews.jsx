import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, Package, Plus, Search, Smartphone, Wrench } from 'lucide-react';
import { PageTitle, SectionTitle, Status } from '../src/product/ui.jsx';
import { PHONE_CONDITIONS } from '../src/utils/constants.js';
import { formatDate } from '../src/utils/format.js';
import { formatMinor } from './CloudReports.jsx';

export const operationNames = {
  purchase: 'Закупка', sale: 'Продажа', repair: 'Завершение ремонта', repair_start: 'Передача в ремонт', expense: 'Расход',
  stock_adjustment: 'Корректировка остатка', deposit: 'Пополнение кассы',
  customer_return: 'Возврат покупателя', supplier_return: 'Возврат поставщику', reservation: 'Резерв',
  withdrawal: 'Снятие со счёта', transfer: 'Перевод', stock_writeoff: 'Списание',
};

const stockStatuses = { all: 'Все', stock: 'На складе', repair: 'В ремонте', reserved: 'В резерве', empty: 'Нет в наличии' };
const productStatus = product => product.inRepair ? 'repair' : product.quantity === 0 ? 'empty'
  : product.reserved === product.quantity ? 'reserved' : 'stock';
const productIcon = product => product.categoryId === 'smartphones' ? Smartphone : Package;

export function TeamStock({ products, categories, repairs, onOpen, onCreate, onCategories, onBulk, onReserve, onExport }) {
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const [limit, setLimit] = useState(30);
  const active = products.filter(item => !item.archived && (!repairs || item.inRepair));
  const group = active.filter(item => !category || item.categoryId === category);
  const matches = group.filter(item => (status === 'all' || (status === 'reserved' ? item.reserved > 0 : productStatus(item) === status)) &&
    [item.name, ...Object.values(item.attributes ?? {})].join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  matches.sort((a, b) => sort === 'quantity' ? b.quantity - a.quantity || a.name.localeCompare(b.name, 'ru')
    : a.name.localeCompare(b.name, 'ru'));

  return <section aria-label={repairs ? 'Устройства в ремонте' : 'Товары и остатки'}>
    {!repairs && <div className="pb-tabs pb-stock-sections" aria-label="Категории товаров">
      {[['', 'Все товары'], ...['smartphones', 'accessories'].flatMap(id => {
        const item = categories.find(category => category.id === id);
        return item ? [[item.id, item.name]] : [];
      })].map(([id, label]) =>
        <button key={id} type="button" aria-pressed={category === id} onClick={() => { setCategory(id); setLimit(30); }}>{label}</button>)}
    </div>}
    <div className="pb-toolbar pb-stock-toolbar">
      <label className="pb-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Поиск товаров"
        placeholder="Название, IMEI или характеристика" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }} /></label>
      {!repairs && categories.some(item => !['smartphones', 'accessories'].includes(item.id)) &&
        <select aria-label="Другие категории" value={['smartphones', 'accessories'].includes(category) ? '' : category}
          onChange={event => { setCategory(event.target.value); setLimit(30); }}>
          <option value="">Другие категории</option>
          {categories.filter(item => !['smartphones', 'accessories'].includes(item.id)).map(item =>
            <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>}
      {!repairs && <select aria-label="Статус товара" value={status} onChange={event => { setStatus(event.target.value); setLimit(30); }}>
        {Object.entries(stockStatuses).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>}
      <select aria-label="Сортировка" value={sort} onChange={event => { setSort(event.target.value); setLimit(30); }}>
        <option value="name">По названию</option><option value="quantity">По остатку</option>
      </select>
    </div>
    {(onCreate || onCategories || onBulk || onExport) && <div className="pb-actions pb-stock-actions pb-warehouse-actions" role="group" aria-label={repairs ? 'Экспорт ремонта' : 'Действия склада'}>
      {onCreate && <button onClick={onCreate}><Plus size={17} />Добавить товар</button>}
      {onCategories && <button className="secondary" onClick={onCategories}>Категории товаров</button>}
      {onBulk && <button className="secondary" onClick={onBulk}>Массовое редактирование</button>}
      {onExport && <button className="secondary" onClick={() => onExport({ kind: 'stock', category, query, status: repairs ? 'repair' : status })}>Экспорт склада</button>}
    </div>}
    {matches.length ? <ul className="pb-list pb-stock-rows">{matches.slice(0, limit).map(product => {
      const Icon = productIcon(product);
      const state = productStatus(product);
      return <li key={product.id} className="pb-trade-stock-row"><button className="pb-row" type="button" onClick={() => onOpen(product.id)}>
        <span className="pb-row-icon"><Icon size={18} aria-hidden="true" /></span>
        <span><strong>{product.name}</strong><small>Остаток {product.quantity}{Boolean(product.reserved) && ' · резерв ' + product.reserved}</small></span>
        <span className="pb-row-end"><Status tone={state === 'stock' ? 'good' : state === 'repair' || state === 'reserved' ? 'warn' : 'neutral'}>{stockStatuses[state]}</Status>
          {product.lastPurchasePriceMinor != null && <strong>{formatMinor(product.lastPurchasePriceMinor)}</strong>}</span>
      </button>{onReserve && !product.inRepair && product.quantity > product.reserved && <button type="button"
        className="secondary pb-stock-reserve" aria-label={'Забронировать ' + product.name}
        onClick={() => onReserve(product.id)}>Забронировать</button>}</li>;
    })}</ul> : <p className="pb-empty">{!active.length ? (repairs ? 'В ремонте пока нет устройств.' : 'Склад пуст.') : 'Товары с такими параметрами не найдены.'}</p>}
    {matches.length > limit && <button className="secondary" onClick={() => setLimit(limit + 30)}>Показать ещё</button>}
  </section>;
}

export function TeamProduct({ product, categories, onBack, onOperation, actions, history, onEdit, onTrade }) {
  const [tab, setTab] = useState('info');
  const status = productStatus(product);
  const category = categories.find(item => item.id === product.categoryId);
  const labels = new Map(category?.attributes?.map(field => [field.id, field.name]));
  const values = [
    ['Остаток', product.quantity + ' шт.'],
    ['Плановая цена продажи', product.plannedPriceMinor == null ? '—' : formatMinor(product.plannedPriceMinor)],
    ...(product.reserved ? [['В резерве', product.reserved + ' шт.']] : []),
    ...Object.entries(product.attributes ?? {}).filter(([, value]) => value !== '').map(([key, value]) => [
      labels.get(key) ?? key, typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : key === 'condition' ? PHONE_CONDITIONS[value] ?? String(value) : String(value),
    ]),
    ...(product.lastPurchasePriceMinor != null ? [['Последняя закупка за единицу', formatMinor(product.lastPurchasePriceMinor)]] : []),
    ...(product.stockCostMinor != null ? [['Себестоимость остатка', formatMinor(product.stockCostMinor)]] : []),
  ];
  return <section className="pb-detail">
    <button className="secondary" type="button" onClick={onBack}><ArrowLeft size={16} />К товарам</button>
    <PageTitle title={product.name} eyebrow={category?.name ?? 'Товар'} />
    <Status tone={status === 'stock' ? 'good' : status === 'repair' || status === 'reserved' ? 'warn' : 'neutral'}>{stockStatuses[status]}</Status>
    {history && <div className="pb-tabs" aria-label="Разделы карточки">
      {[['info', 'Информация'], ['operations', 'Операции'], ['repairs', 'Ремонты']].map(([id, label]) =>
        <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>}
    {tab !== 'info' && history?.(tab)}
    {tab === 'info' && <dl className="metric-list">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <div className="pb-actions pb-warehouse-actions">{actions.map(type => <button key={type} onClick={() => onOperation(type)}>
      {type === 'sale' ? 'Продать' : type === 'repair' ? 'Завершить ремонт' : type === 'repair_start' ? 'Передать в ремонт' : operationNames[type]}
    </button>)}{onEdit && <button className="secondary" onClick={onEdit}>Изменить</button>}
      {onTrade && <button className="secondary" onClick={onTrade}>Возвраты и бронирования</button>}</div>
  </section>;
}

const operationStatus = { posted: 'Проведена', cancelled: 'Отменена', reversed: 'Сторнирована', draft: 'Черновик' };

export function TeamOperations({ operations, title, latest, onHistory, memberNames }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [open, setOpen] = useState('');
  const matching = operations;
  const displayed = latest ? matching.slice(0, 5) : matching.filter(item =>
    (!kind || item.type === kind) && (!status || status === item.status) &&
    [operationNames[item.type] ?? 'Операция', formatDate(item.date), ...((item.products ?? []).map(product => product.name)), memberNames?.get(item.actorId) ?? ''].join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  const kinds = [...new Set(matching.map(item => item.type))];

  return <section aria-label={title}>
    <SectionTitle action={onHistory && <button className="pb-text-button secondary" onClick={onHistory}>Все операции <ArrowRight size={16} /></button>}>{title}</SectionTitle>
    {!latest && matching.length > 0 && <div className="pb-toolbar">
      <label className="pb-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Поиск операций" placeholder="Товар, тип операции или дата"
        value={query} onChange={event => setQuery(event.target.value)} /></label>
      {kinds.length > 1 && <select aria-label="Фильтр операций" value={kind} onChange={event => setKind(event.target.value)}>
        <option value="">Все типы</option>{kinds.map(type => <option value={type} key={type}>{operationNames[type] ?? 'Операция'}</option>)}
      </select>}
      <select aria-label="Статус операции" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">Все статусы</option>{[...new Set(matching.map(item => item.status))].map(key =>
          <option value={key} key={key}>{operationStatus[key] ?? 'Другой статус'}</option>)}
      </select>
    </div>}
    {displayed.length ? <ul className="pb-list">{displayed.map(item => <li key={item.id}>
      <button className="pb-row" type="button" onClick={() => setOpen(open === item.id ? '' : item.id)} aria-expanded={open === item.id}>
        <span className="pb-row-icon">{item.type.startsWith('repair') ? <Wrench size={18} /> : <ArrowRight size={18} />}</span>
        <span><strong>{item.products?.length ? item.products.map(product => product.name).join(', ') : operationNames[item.type] ?? 'Операция'}</strong>
          <small>{item.products?.length ? (operationNames[item.type] ?? 'Операция') + ' · ' : ''}{formatDate(item.date)}</small></span>
        <span className="pb-row-end">{item.postings?.length === 1 ? <strong>{formatMinor(item.postings[0].amountMinor)}</strong>
          : <ChevronRight size={16} aria-hidden="true" />}</span>
      </button>
      {open === item.id && <div className="pb-operation-detail">
        <Status tone={item.status === 'posted' ? 'good' : 'neutral'}>{operationStatus[item.status] ?? 'Статус не указан'}</Status>
        {memberNames?.has(item.actorId) && <small>{memberNames.get(item.actorId)}</small>}
        {item.products?.map((product, index) => <small key={index}>{product.name} · {product.quantity} шт.</small>)}
        {item.postings?.map((posting, index) => <small key={index}>
          {posting.account ? posting.account + ' · ' : ''}{formatMinor(posting.amountMinor)}
        </small>)}
        {item.profitMinor != null && <small>Валовая прибыль · {formatMinor(item.profitMinor)}</small>}
      </div>}
    </li>)}</ul> : <p className="pb-empty">{matching.length ? 'Операции с такими параметрами не найдены.' : 'Операций пока нет.'}</p>}
  </section>;
}
