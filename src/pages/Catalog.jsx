import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Package, Plus } from 'lucide-react';
import { DomainError, makeAuditEntry, withAudit } from '../domain/shared.js';
import { projectInventory, saveInventoryCategory, saveInventoryProduct } from '../domain/inventory.js';
import { parseMinor, recordWarehouse, warehouseLabels, warehouseProjection, warehouseStock } from '../domain/warehouse.js';
import { remainingReturn } from '../domain/warehouseTrade.js';
import { useStore } from '../hooks/useStore.jsx';
import { BulkPrices } from '../product/BulkPrices.jsx';
import { TradePanel, tradeLabels } from '../product/TradePanel.jsx';
import { SoloSpreadsheet } from '../product/SoloSpreadsheet.jsx';
import { Modal } from '../components/ui.jsx';
import { PageTitle, SectionTitle, Status } from '../product/ui.jsx';
import { AttributeFields, CategoryFields, priceInput, readAttributes, readCategory, warehouseMoney } from '../product/WarehouseFields.jsx';
import { readInventoryCatalog } from '../storage/inventoryStore.js';
import { getAccountBalance } from '../utils/calculations.js';
import { formatDate } from '../utils/format.js';

const details = { purchase: 'Оформить закупку', sale: 'Оформить продажу', repair_start: 'Передать в ремонт', repair: 'Завершить ремонт' };

export function CatalogPage({ initialProduct }) {
  const { data, mutatePersisted } = useStore();
  const [legacyCatalog, setLegacyCatalog] = useState(null);
  const [form, setForm] = useState(initialProduct ? 'detail' : '');
  const [chosen, setChosen] = useState(initialProduct ?? '');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showSheets, setShowSheets] = useState(false);
  const [now, setNow] = useState(Date.now);
  const projection = warehouseProjection(data);
  useEffect(() => {
    const current = Date.now();
    const expiry = [...projection.bookings.values()].reduce((first, item) => {
      const deadline = Date.parse(item.expiresAt);
      return item.status === 'active' && deadline > now ? Math.min(first, deadline) : first;
    }, Infinity);
    if (!Number.isFinite(expiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, expiry - current)));
    return () => window.clearTimeout(timer);
  }, [projection, now]);
  useEffect(() => {
    let active = true;
    readInventoryCatalog().then(value => { if (active) setLegacyCatalog(value); }).catch(() => {
      if (active) setError('Не удалось открыть каталог.');
    });
    return () => { active = false; };
  }, []);
  const saved = data.catalog ?? legacyCatalog;
  const catalog = saved && projectInventory(data, saved);
  const product = catalog?.products.find(item => item.id === chosen && item.id.startsWith('product:'));
  const categories = catalog?.categories ?? [];
  const selected = categories.find(item => item.id === category);
  const custom = saved?.categories.find(item => item.id === category);

  function open(next, item = null, categoryId = '') {
    setChosen(item?.id ?? '');
    setCategory(categoryId || item?.categoryId || 'laptops');
    setForm(next);
    setError('');
    window.scrollTo(0, 0);
  }

  async function commit(change) {
    if (busy || !saved) return false;
    setBusy(true); setError('');
    try {
      const result = await mutatePersisted(state => {
        const current = state.catalog ?? legacyCatalog;
        if (current.revisionId !== saved.revisionId) throw new DomainError('Каталог изменился. Откройте карточку заново.');
        try { return change(state, current); } catch (failure) { throw new DomainError(failure.message); }
      });
      if (!result.ok) setError(result.error?.message ?? 'Не удалось сохранить изменения.');
      return result.ok;
    } finally { setBusy(false); }
  }
  const update = (state, current) => ({ ...state, catalog: { ...current, revision: current.revision + 1, revisionId: crypto.randomUUID() } });

  async function saveCategory(event) {
    event.preventDefault();
    const fields = readCategory(new FormData(event.currentTarget), custom);
    if (await commit((state, current) => update(state, saveInventoryCategory(current, fields)))) open('');
  }
  async function saveProduct(event) {
    event.preventDefault();
    try {
      const fields = new FormData(event.currentTarget);
      const price = fields.get('plannedPrice').trim();
      const next = { id: product?.id ?? 'product:' + crypto.randomUUID(), name: fields.get('name').trim(),
        categoryId: category, tracking: product?.purchased ? product.tracking : fields.get('tracking'),
        attributes: readAttributes(selected, fields), plannedPriceMinor: price ? parseMinor(price) : null };
      if (await commit((state, current) => update(state, saveInventoryProduct(current, next, product?.version ?? 0)))) {
        open(product ? 'detail' : '', next);
      }
    } catch (failure) { setError(failure.message); }
  }
  async function operate(event) {
    event.preventDefault();
    if (busy) return;
    try {
      const values = new FormData(event.currentTarget);
      const accountId = values.get('accountId');
      const input = { units: Number(values.get('units') ?? 1), unitMinor: form === 'repair_start' ? 0 : parseMinor(values.get('amount')),
        accountId, version: product.version, position: data.warehouse?.length ?? 0 };
      if (await commit((state, current) => recordWarehouse({ ...state, catalog: current }, product.id, form, input,
        Math.round(getAccountBalance(state, accountId) * 100)))) open('detail', product);
    } catch (failure) { setError(failure.message); }
  }
  function trade(command) {
    const input = { ...command, units: command.quantity, unitMinor: command.unitPriceMinor, version: command.expectedVersion,
      position: data.warehouse?.length ?? 0 };
    return commit((state, current) => recordWarehouse({ ...state, catalog: current }, product.id, command.type, input,
      Math.round(getAccountBalance(state, command.accountId) * 100)));
  }
  if (!catalog) return <p className="pb-empty" role={error ? 'alert' : 'status'}>{error || 'Загружаем каталог…'}</p>;
  const own = catalog.products.filter(item => item.id.startsWith('product:'));
  const visible = own.filter(item => (!filter || item.categoryId === filter) &&
    (!status || (status === 'reserved' ? item.reservedQuantity > 0 : status === (item.inRepair ? 'repair' : item.quantity > 0 ? 'stock' : 'empty'))) &&
    [item.name, ...Object.values(item.attributes)].join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => (sort === 'quantity' ? b.quantity - a.quantity : 0) || a.name.localeCompare(b.name, 'ru'));
  const events = product ? projection.operations.filter(event => event.productId === product.id).reverse() : [];
  const originals = events.filter(item => ['purchase', 'sale'].includes(item.type)).map(item => {
    const remaining = remainingReturn(item, projection.corrected.get(item.id) ?? []);
    return { ...item, leftUnits: remaining.units, leftMinor: remaining.amountMinor };
  });

  return <section className="pb-catalog" data-view={form || undefined}>
    {form && form !== 'bulk' && <button className="pb-action pb-action-secondary pb-back" onClick={() => open(product && form !== 'detail' ? 'detail' : '', product)}>
      <ArrowLeft size={16} />{product && form !== 'detail' ? 'К карточке' : 'К каталогу'}</button>}
    {error && <p className="pb-empty" role="alert">{error}</p>}
    {showSheets && <Modal open size="lg" title="Таблицы склада" onClose={() => setShowSheets(false)}>
      <SoloSpreadsheet currentFilter={{ kind: 'stock', category: filter, query, status: status || 'all' }} />
    </Modal>}
    {form === 'category' && <form className="pb-catalog-form" onSubmit={saveCategory}>
      <PageTitle title={custom ? 'Редактирование категории' : 'Новая категория'} />
      <CategoryFields key={custom?.id ?? 'new'} category={custom} />
      <button type="submit" className="pb-action" disabled={busy}>Сохранить категорию</button>
    </form>}
    {form === 'product' && <form className="pb-catalog-form" onSubmit={saveProduct}>
      <PageTitle title={product ? 'Редактирование товара' : 'Добавить товар'} />
      <label>Название<input className="input" name="name" defaultValue={product?.name ?? ''} maxLength={100} required /></label>
      <div className="pb-catalog-fields">
        <label>Категория<select className="input" value={category} onChange={event => setCategory(event.target.value)} required>
          {categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Учёт<select className="input" name="tracking" disabled={product?.purchased} defaultValue={product?.tracking ?? 'unit'}>
          <option value="unit">Поштучный</option><option value="quantity">Количественный</option>
        </select></label>
      </div>
      <div className="pb-catalog-fields" key={category}><AttributeFields category={selected} attributes={product?.attributes} /></div>
      <label>Плановая цена продажи, ₽<input className="input" name="plannedPrice" inputMode="decimal" defaultValue={priceInput(product?.plannedPriceMinor)} /></label>
      <button type="submit" className="pb-action" disabled={busy}>Сохранить товар</button>
    </form>}
    {form === 'detail' && (product ? <>
      <PageTitle title={product.name} eyebrow={categories.find(item => item.id === product.categoryId)?.name} />
      <Status tone={product.inRepair ? 'warn' : product.quantity ? 'good' : 'neutral'}>
        {product.inRepair ? 'В ремонте' : product.quantity ? 'На складе' : 'Нет в наличии'}
      </Status>
      <dl className="pb-finance-flow">
        <div><dt>Остаток</dt><dd>{product.quantity} шт.</dd></div>
        {product.reservedQuantity > 0 && <div><dt>В резерве</dt><dd>{product.reservedQuantity} шт.</dd></div>}
        <div><dt>Себестоимость остатка</dt><dd>{warehouseMoney(product.stockCostMinor)}</dd></div>
        <div><dt>Плановая цена продажи</dt><dd>{warehouseMoney(product.plannedPriceMinor)}</dd></div>
        {categories.find(item => item.id === product.categoryId)?.attributes.filter(field => Object.hasOwn(product.attributes, field.id))
          .map(field => <div key={field.id}><dt>{field.name}</dt><dd>{field.type === 'boolean' ? (product.attributes[field.id] ? 'Да' : 'Нет') : product.attributes[field.id]}</dd></div>)}
      </dl>
      <div className="pb-actions pb-warehouse-actions">
        {(!product.purchased || product.tracking === 'quantity') && <button className="pb-action" onClick={() => open('purchase', product)}>{details.purchase}</button>}
        {product.quantity > product.reservedQuantity && !product.inRepair && <button className="pb-action" onClick={() => open('sale', product)}>{details.sale}</button>}
        {product.tracking === 'unit' && product.quantity === 1 && !product.reservedQuantity && <button className="pb-action pb-action-secondary"
          onClick={() => open(product.inRepair ? 'repair' : 'repair_start', product)}>{details[product.inRepair ? 'repair' : 'repair_start']}</button>}
        <button className="pb-action pb-action-secondary" onClick={() => open('product', product)}>Изменить</button>
        <button className="pb-action pb-action-secondary" onClick={() => open('trade', product)}>Возвраты и бронирования</button>
      </div>
      <div className="pb-warehouse-history"><SectionTitle>История товара</SectionTitle>
        {events.length ? <ul className="pb-list">{events.map(item => <li key={item.id}><span>{warehouseLabels[item.type]}</span>
          <span>{formatDate(item.date)}{item.units > 0 ? ' · ' + item.units + ' шт.' : ''}{item.reason && ' · ' + item.reason}</span>
          {item.cashMinor !== 0 && <strong>{warehouseMoney(item.cashMinor)}</strong>}</li>)}</ul> : <p className="pb-empty">Операций пока нет.</p>}
      </div>
    </> : <p className="pb-empty">Карточка товара недоступна.</p>)}
    {['trade', 'reserve'].includes(form) && product && <TradePanel product={product} originals={originals}
      initialAction={form === 'reserve' ? 'reserve' : undefined}
      reservations={warehouseStock(data, product.id, now).reservations} accounts={data.accounts.filter(account => !account.archived)}
      allowed={[...Object.keys(tradeLabels), 'repair_start']} busy={busy} submit={trade} />}
    {product && Object.hasOwn(details, form) && <form className="pb-catalog-form" onSubmit={operate}>
      <PageTitle title={details[form]} description={product.name} />
      {['purchase', 'sale'].includes(form) && <label>Количество<input className="input" name="units" type="number" min="1"
        max={form === 'sale' ? product.quantity - product.reservedQuantity : product.tracking === 'unit' ? 1 : 100000} defaultValue="1" required /></label>}
      {form !== 'repair_start' && <>
        <label>{form === 'repair' ? 'Стоимость ремонта, ₽' : 'Цена за единицу, ₽'}<input className="input" name="amount" inputMode="decimal"
          defaultValue={form === 'sale' ? priceInput(product.plannedPriceMinor) : form === 'repair' ? '0' : ''} required /></label>
        <label>Счёт<select className="input" name="accountId">
          {data.accounts.filter(account => !account.archived).map(account => <option value={account.id} key={account.id}>{account.name}</option>)}
        </select></label>
      </>}
      <button type="submit" className="pb-action" disabled={busy}>Провести операцию</button>
    </form>}
    {form === 'bulk' && <BulkPrices products={catalog.products.map(item =>
      item.id.startsWith('product:') ? item : { ...item, version: 1, priceOnly: true })}
      categories={categories} canEdit disabled={busy} onClose={() => open('')} onApply={(rows, kind) =>
        commit((state, current) => {
          const byId = new Map(rows.map(row => [row.id, row]));
          const legacyPrices = (items, prefix, field) => items.map(item => {
            const change = byId.get(prefix + item.id);
            if (!change) return item;
            const previous = item[field] > 0 ? Math.round(item[field] * 100) : null;
            if (kind !== 'price' || previous !== change.expectedPrice) throw new DomainError('Цена товара изменилась. Создайте новый предпросмотр.');
            return { ...item, [field]: (change.plannedPriceMinor ?? 0) / 100 };
          });
          const next = rows.filter(row => row.id.startsWith('product:')).reduce((result, row) => {
            const item = result.products.find(product => product.id === row.id);
            const changes = kind === 'price' ? { plannedPriceMinor: row.plannedPriceMinor } : { attributes: row.attributes };
            return saveInventoryProduct(result, { ...item, ...changes }, row.version);
          }, current);
          return withAudit(update({ ...state, phones: legacyPrices(state.phones, 'phone:', 'plannedPrice'),
            accessoryItems: legacyPrices(state.accessoryItems, 'accessory:', 'salePrice') }, next),
            makeAuditEntry(state, 'update', 'warehouse', 'bulk', 'Массовое редактирование товаров · ' + rows.length));
        })} />}
    {!form && <>
      <SectionTitle>Каталог товаров</SectionTitle>
      <button className="pb-action pb-action-secondary" onClick={() => setShowSheets(true)}>Экспорт склада</button>
      <div className="pb-toolbar">
        <input className="input" type="search" aria-label="Поиск в каталоге" placeholder="Название или характеристика"
          value={query} onChange={event => setQuery(event.target.value)} />
        <select className="input" aria-label="Категория товара" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">Все категории</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className="input" aria-label="Статус товара" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Все статусы</option><option value="stock">На складе</option>
          <option value="repair">В ремонте</option><option value="reserved">В резерве</option><option value="empty">Нет в наличии</option>
        </select>
        <select className="input" aria-label="Сортировка" value={sort} onChange={event => setSort(event.target.value)}>
          <option value="name">По названию</option><option value="quantity">По остатку</option>
        </select>
      </div>
      {visible.length ? <ul className="pb-list">{visible.map(item => <li key={item.id} className="pb-trade-stock-row">
        <button className="pb-row" type="button" onClick={() => open('detail', item)}>
          <span className="pb-row-icon"><Package size={18} /></span>
          <span><strong>{item.name}</strong><small>{item.inRepair ? 'В ремонте' : 'Остаток ' + item.quantity + ' шт.'}
            {item.reservedQuantity > 0 && ' · резерв ' + item.reservedQuantity}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        {item.quantity > item.reservedQuantity && !item.inRepair && <button type="button" className="pb-stock-reserve pb-action pb-action-secondary"
          aria-label={'Забронировать ' + item.name} onClick={() => open('reserve', item)}>Забронировать</button>}
      </li>)}</ul> : <p className="pb-empty">Карточки товаров пока не найдены.</p>}
      <div className="pb-actions pb-warehouse-actions">
        <button className="pb-action" onClick={() => open('product')}><Plus size={16} />Добавить товар</button>
        <button className="pb-action pb-action-secondary" onClick={() => open('category')}>Новая категория</button>
        {saved.categories.some(item => item.id === filter) && <button className="pb-action pb-action-secondary"
          onClick={() => open('category', null, filter)}>Изменить категорию</button>}
        {catalog.products.some(item => item.status !== 'archived') && <button className="pb-action pb-action-secondary" onClick={() => open('bulk')}>Массовое редактирование</button>}
      </div>
    </>}
  </section>;
}
