import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Package, Plus } from 'lucide-react';
import { saveInventoryCategory, saveInventoryProduct } from '../domain/inventory.js';
import { PageTitle, SectionTitle } from '../product/ui.jsx';
import { loadInventory, updateInventory } from '../storage/inventoryStore.js';

const fieldTypes = [['text', 'Текст'], ['number', 'Число'], ['boolean', 'Да или нет']];
const standalone = category => !['smartphones', 'accessories'].includes(category.id);

function order(a, b) { return a.name.localeCompare(b.name, 'ru'); }

export function CatalogPage() {
  const [catalog, setCatalog] = useState(null);
  const [form, setForm] = useState('');
  const [chosen, setChosen] = useState(null);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [fields, setFields] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    loadInventory().then(data => { if (active) setCatalog(data); }).catch(() => {
      if (active) setError('Не удалось открыть каталог.');
    });
    return () => { active = false; };
  }, []);

  const product = catalog?.products.find(item => item.id === chosen);
  const categories = catalog?.categories.filter(item => standalone(item) || item.id === product?.categoryId) ?? [];
  const selected = catalog?.categories.find(item => item.id === category);

  function open(next, item = null) {
    setChosen(item?.id ?? null);
    setCategory(item?.categoryId ?? categories[0]?.id ?? '');
    setFields([]);
    setForm(next);
    setError('');
    window.scrollTo(0, 0);
  }

  async function save(event, change) {
    event.preventDefault();
    if (busy || !catalog) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const data = await updateInventory(catalog.revisionId, value => change(value, values));
      setCatalog(data);
      open('');
    } catch (failure) {
      setError(failure instanceof DOMException ? 'Не удалось сохранить каталог.' : failure.message);
      try { setCatalog(await loadInventory()); } catch { /* Preserve the last successful read. */ }
    } finally {
      setBusy(false);
    }
  }

  function saveProduct(value, data) {
    const attributes = Object.fromEntries((selected?.attributes ?? []).flatMap(field => {
      const raw = data.get('attribute:' + field.id);
      if (raw == null || raw === '') return [];
      return [[field.id, field.type === 'number' ? Number(raw) : field.type === 'boolean' ? raw === 'yes' : raw.trim()]];
    }));
    return saveInventoryProduct(value, {
      id: product?.id ?? 'product:' + crypto.randomUUID(), name: data.get('name').trim(),
      categoryId: category, tracking: data.get('tracking'), attributes,
    }, product?.version ?? 0);
  }

  if (!catalog) return <p className="pb-empty" role={error ? 'alert' : 'status'}>{error || 'Загружаем каталог…'}</p>;
  const filters = [...new Set(catalog.products.filter(item => item.id.startsWith('product:')).map(item => item.categoryId))];
  const products = catalog.products.filter(item => item.id.startsWith('product:') && (!filter || item.categoryId === filter) &&
    [item.name, ...Object.values(item.attributes)].join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).sort(order);

  return <section className="pb-catalog">
    {form && <button className="pb-action pb-action-secondary pb-back" onClick={() => open('')}><ArrowLeft size={16} />К каталогу</button>}
    {error && <p className="pb-empty" role="alert">{error}</p>}
    {form === 'category' && <form className="pb-catalog-form" onSubmit={event => save(event, (value, data) =>
      saveInventoryCategory(value, {
        id: 'category-' + crypto.randomUUID(), name: data.get('name').trim(),
        attributes: fields.map(id => ({ id, name: data.get(id).trim(), type: data.get(id + '-type') })),
      }))}>
      <PageTitle title="Новая категория" />
      <label>Название<input className="input" name="name" maxLength={100} required /></label>
      {fields.map((id, index) => <div className="pb-catalog-fields" key={id}>
        <label>Характеристика {index + 1}<input className="input" name={id} maxLength={100} required /></label>
        <label>Тип<select className="input" name={id + '-type'}>{fieldTypes.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
        <button className="pb-action pb-action-secondary" type="button" aria-label={'Удалить характеристику ' + (index + 1)}
          onClick={() => setFields(current => current.filter(key => key !== id))}>Удалить</button>
      </div>)}
      <button className="pb-action pb-action-secondary" type="button" onClick={() => setFields(current => [...current, 'field-' + crypto.randomUUID()])}>
        <Plus size={16} />Добавить характеристику
      </button>
      <button className="pb-action" disabled={busy}>Сохранить категорию</button>
    </form>}
    {form === 'product' && <form className="pb-catalog-form" onSubmit={event => save(event, saveProduct)}>
      <PageTitle title={product ? product.name : 'Добавить товар'} />
      <label>Название<input className="input" name="name" defaultValue={product?.name ?? ''} maxLength={100} required /></label>
      <div className="pb-catalog-fields">
        <label>Категория<select className="input" value={category} onChange={event => setCategory(event.target.value)} required>
          {categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Учёт<select className="input" name="tracking" defaultValue={product?.tracking ?? 'unit'}>
          <option value="unit">Поштучный</option><option value="quantity">Количественный</option>
        </select></label>
      </div>
      <div className="pb-catalog-fields" key={category}>
        {selected?.attributes.map(field => <label key={field.id}>{field.name}{field.type === 'boolean'
          ? <select className="input" name={'attribute:' + field.id} defaultValue={product?.attributes[field.id] == null ? '' : product.attributes[field.id] ? 'yes' : 'no'}>
            <option value="">Не указано</option><option value="yes">Да</option><option value="no">Нет</option>
          </select>
          : <input className="input" name={'attribute:' + field.id} type={field.type === 'number' ? 'number' : 'text'} step="any"
            defaultValue={product?.attributes[field.id] ?? ''} />}</label>)}
      </div>
      <button className="pb-action" disabled={busy}>Сохранить товар</button>
    </form>}
    {!form && <>
      <SectionTitle>Каталог товаров</SectionTitle>
      <p className="pb-description">Карточки и характеристики можно перенести в Team вместе с резервной копией Solo.</p>
      <div className="pb-toolbar">
        <input className="input" type="search" aria-label="Поиск в каталоге" placeholder="Название или характеристика"
          value={query} onChange={event => setQuery(event.target.value)} />
        {filters.length > 0 && <select className="input" aria-label="Категория товара" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">Все категории</option>{catalog.categories.filter(item => filters.includes(item.id)).sort(order)
            .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>}
      </div>
      {products.length ? <ul className="pb-list">{products.map(item => <li key={item.id}>
        <button className="pb-row" type="button" onClick={() => open('product', item)}>
          <span className="pb-row-icon"><Package size={18} /></span>
          <span><strong>{item.name}</strong><small>{catalog.categories.find(category => category.id === item.categoryId)?.name}</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </li>)}</ul> : <p className="pb-empty">Карточки товаров пока не найдены.</p>}
      <div className="pb-actions">
        <button className="pb-action" onClick={() => open('product')}><Plus size={16} />Добавить товар</button>
        <button className="pb-action pb-action-secondary" onClick={() => open('category')}>Новая категория</button>
      </div>
    </>}
  </section>;
}
