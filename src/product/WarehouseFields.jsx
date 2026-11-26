import React, { lazy, Suspense, useState } from 'react';
import { Camera } from 'lucide-react';
import { formatMinorMoney } from '../utils/format.js';

const Scanner = lazy(() => import('../components/purchase/ImeiScanner.jsx').then(module => ({ default: module.ImeiScanner })));
export const warehouseMoney = value => value == null ? '—' : formatMinorMoney(value);
export const priceInput = value => value == null ? '' : String(Number(value) / 100);
export const fieldTypes = [['text', 'Текст'], ['number', 'Число'], ['boolean', 'Да или нет']];
export function readAttributes(category, values) {
  return Object.fromEntries((category?.attributes ?? []).flatMap(field => {
    const raw = values.get('attribute:' + field.id);
    if (raw == null || raw === '') return [];
    return [[field.id, field.type === 'number' ? Number(raw) : field.type === 'boolean' ? raw === 'yes' : raw.trim()]];
  }));
}

function ImeiField({ field, initialValue }) {
  const [value, setValue] = useState(initialValue ?? '');
  const [scan, setScan] = useState(false);
  const inputId = React.useId();
  return <div className="pb-warehouse-imei">
    <label htmlFor={inputId}>{field.name}</label>
    <div className="imei-input-row">
      <input className="input" id={inputId} name={'attribute:' + field.id} inputMode="numeric" value={value}
        onChange={event => setValue(event.target.value)} maxLength={15} pattern="[0-9]{15}" />
      <button type="button" className="pb-action pb-action-secondary" aria-label="Сканировать IMEI" onClick={event => {
        event.currentTarget.focus({ preventScroll: true }); setScan(true);
      }}><Camera size={17} aria-hidden="true" /></button>
    </div>
    {scan && <Suspense fallback={<p role="status">Подготавливаем сканер…</p>}>
      <Scanner onClose={() => setScan(false)} onConfirm={imei => { setValue(imei); setScan(false); }} />
    </Suspense>}
  </div>;
}
export function AttributeFields({ category, attributes }) {
  return (category?.attributes ?? []).map(field => {
    const value = attributes?.[field.id];
    if (field.id === 'imei' && field.type === 'text') return <ImeiField key={field.id} field={field} initialValue={value} />;
    return <label key={field.id}>{field.name}{field.type === 'boolean'
      ? <select className="input" name={'attribute:' + field.id} defaultValue={value == null ? '' : value ? 'yes' : 'no'}>
        <option value="">Не указано</option><option value="yes">Да</option><option value="no">Нет</option>
      </select>
      : <input className="input" name={'attribute:' + field.id} type={field.type === 'number' ? 'number' : 'text'}
        step={field.type === 'number' ? 'any' : undefined} defaultValue={value ?? ''} maxLength={200} />}</label>;
  });
}

export function CategoryFields({ category }) {
  const [fields, setFields] = useState(category?.attributes ?? []);
  return <>
    <label>Название<input className="input" name="name" defaultValue={category?.name ?? ''} maxLength={100} required /></label>
    {fields.map((field, index) => <div key={field.id} className="pb-catalog-fields">
      <input type="hidden" name="fieldKey" value={field.id} />
      <label>Характеристика {index + 1}<input className="input" name={'fieldLabel:' + field.id} defaultValue={field.name} maxLength={100} required /></label>
      <label>Тип<select className="input" name={'fieldType:' + field.id} defaultValue={field.type}>
        {fieldTypes.map(([type, name]) => <option key={type} value={type}>{name}</option>)}
      </select></label>
      <button className="pb-action pb-action-secondary" type="button" aria-label={'Удалить характеристику ' + (index + 1)}
        onClick={() => setFields(current => current.filter(item => item.id !== field.id))}>Удалить</button>
    </div>)}
    <button className="pb-action pb-action-secondary" type="button" onClick={() => setFields(current => [
      ...current, { id: 'field-' + crypto.randomUUID(), name: '', type: 'text' },
    ])}>Добавить характеристику</button>
  </>;
}
export function readCategory(data, category) {
  return {
    id: category?.id ?? 'category-' + crypto.randomUUID(), name: data.get('name').trim(),
    attributes: data.getAll('fieldKey').map(id => ({ id, name: data.get('fieldLabel:' + id).trim(), type: data.get('fieldType:' + id) })),
  };
}
