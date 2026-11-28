import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { parseMinor } from '../domain/warehouse.js';
import { PageTitle } from './ui.jsx';
import { warehouseMoney } from './WarehouseFields.jsx';

export function BulkPrices({ products, categories = [], canPrice = true, canEdit = false, disabled, onApply, onClose }) {
  const [selected, setSelected] = useState([]);
  const [target, setTarget] = useState(canPrice ? 'price' : '');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState(null);
  const [undo, setUndo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const items = products.filter(item => !item.archived && item.status !== 'archived');
  const chosen = items.filter(item => selected.includes(item.id));
  const category = chosen[0]?.categoryId;
  const fields = canEdit && chosen.length && chosen.every(item => item.categoryId === category && !item.priceOnly)
    ? (categories.find(item => item.id === category)?.attributes ?? []).filter(item => item.id !== 'imei') : [];
  const field = fields.find(item => 'field:' + item.id === target);
  const price = target === 'price' && canPrice;
  function prepare(event) {
    event.preventDefault();
    setError('');
    try {
      const raw = value.trim();
      const next = !raw ? null : price ? parseMinor(raw) : field.type === 'number' ? Number(raw) : field.type === 'boolean' ? raw === 'yes' : raw;
      if (typeof next === 'number' && !Number.isFinite(next)) throw new Error('Введите число.');
      const rows = chosen.map(item => {
        const before = price ? (item.plannedPriceMinor == null ? null : Number(item.plannedPriceMinor)) : item.attributes[field.id] ?? null;
        const attributes = { ...item.attributes };
        if (field) {
          if (next == null) delete attributes[field.id];
          else attributes[field.id] = next;
        }
        return { id: item.id, version: item.version, name: item.name, before, value: price && item.priceOnly && next === 0 ? null : next,
          previousAttributes: item.attributes, attributes };
      }).filter(item => item.before !== item.value);
      if (!rows.length) throw new Error('Выберите товары, у которых изменится значение.');
      setPreview({ rows, kind: price ? 'price' : 'attributes', label: price ? 'Плановая цена' : field.name });
    } catch (failure) { setError(failure.message); }
  }
  async function apply(batch, reverse) {
    setBusy(true); setError('');
    try {
      const rows = batch.rows.map(row => {
        const common = { id: row.id, version: reverse ? row.version + 1 : row.version };
        return batch.kind === 'price' ? { ...common, expectedPrice: reverse ? row.value : row.before,
          plannedPriceMinor: reverse ? row.before : row.value }
          : { ...common, attributes: reverse ? row.previousAttributes : row.attributes };
      });
      if (!await onApply(rows, batch.kind)) return;
      setPreview(null);
      setUndo(reverse ? null : batch);
      setSelected([]);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const display = (value, kind) => kind === 'price' ? warehouseMoney(value)
    : value == null ? '—' : typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : String(value);
  return <section aria-label="Массовое редактирование" className="pb-catalog-form pb-bulk">
    <button className="pb-action pb-action-secondary pb-warehouse-back" disabled={busy} onClick={onClose}><ArrowLeft size={16} />К складу</button>
    <PageTitle title="Массовое редактирование" />
    {error && <p role="alert">{error}</p>}
    {undo && <p role="status">Изменено товаров: {undo.rows.length}</p>}
    {undo && <button className="pb-action" disabled={disabled || busy} onClick={() => apply(undo, true)}>Отменить изменения</button>}
    {preview ? <>
      <p>{preview.label}</p>
      <ul className="pb-list">{preview.rows.map(row => <li key={row.id}><span>{row.name}</span>
        <span>{display(row.before, preview.kind)} → {display(row.value, preview.kind)}</span></li>)}</ul>
      <div className="pb-actions">
        <button className="pb-action" disabled={disabled || busy} onClick={() => apply(preview, false)}>Применить изменения</button>
        <button className="pb-action pb-action-secondary" disabled={busy} onClick={() => setPreview(null)}>Отмена предпросмотра</button>
      </div>
    </> : <form className="pb-catalog-form" onSubmit={prepare}>
      <fieldset disabled={busy || disabled}>
        <legend>Товары</legend>
        <div className="pb-bulk-items">{items.map(item => <label key={item.id} className="pb-bulk-option">
          <input type="checkbox" checked={selected.includes(item.id)} onChange={event => {
            const checked = event.target.checked;
            setSelected(current => checked ? [...current, item.id] : current.filter(id => id !== item.id));
          }} disabled={selected.length >= 100 && !selected.includes(item.id)} />{item.name}
        </label>)}</div>
        {canEdit && <label>Изменяемое поле<select value={price || field ? target : ''} onChange={event => {
          setTarget(event.target.value); setValue('');
        }}>
          <option value="">Выберите поле</option>
          {canPrice && <option value="price">Плановая цена</option>}
          {fields.map(item => <option key={item.id} value={'field:' + item.id}>{item.name}</option>)}
        </select></label>}
        {price && <label>Новая плановая цена, ₽<input className="input" inputMode="decimal" value={value}
          onChange={event => setValue(event.target.value)} placeholder="Пустое поле очищает цену" /></label>}
        {field && <label>Новое значение{field.type === 'boolean' ?
          <select value={value} onChange={event => setValue(event.target.value)}>
            <option value="">Очистить значение</option><option value="yes">Да</option><option value="no">Нет</option>
          </select> : <input className="input" value={value} maxLength={200} type={field.type === 'number' ? 'number' : 'text'}
            step={field.type === 'number' ? 'any' : undefined} onChange={event => setValue(event.target.value)} />}</label>}
      </fieldset>
      <button type="submit" className="pb-action" disabled={busy || disabled || !selected.length || (!price && !field)}>Предпросмотр изменений</button>
    </form>}
  </section>;
}
