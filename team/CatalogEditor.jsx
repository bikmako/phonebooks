import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { parseMinor } from '../src/domain/warehouse.js';
import { BulkPrices } from '../src/product/BulkPrices.jsx';
import { AttributeFields, CategoryFields, priceInput, readAttributes, readCategory } from '../src/product/WarehouseFields.jsx';
import { PageTitle } from '../src/product/ui.jsx';

export function CatalogEditor({ mode, products, categories, product, canPrice, canEdit, disabled, onSave, onClose }) {
  const [chosen, setChosen] = useState(product?.categoryId ?? '');
  const [error, setError] = useState('');
  const category = categories.find(item => item.id === chosen);
  if (mode === 'bulk') return <BulkPrices products={products} categories={categories} canPrice={canPrice} canEdit={canEdit}
    disabled={disabled} onClose={onClose} onApply={(rows, kind) => onSave(kind === 'attributes'
      ? { type: 'bulk_attributes', items: rows }
      : { type: 'bulk_price', items: rows.map(({ id, version, plannedPriceMinor }) => ({ id, version, plannedPriceMinor })) })} />;
  async function save(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      let command;
      if (mode === 'category') {
        const fields = readCategory(form, category);
        command = { type: 'save_category', categoryId: fields.id, name: fields.name,
          attributes: fields.attributes, expectedVersion: category?.version ?? 0 };
      } else {
        command = { type: 'edit_product', productId: product.id, expectedVersion: product.version,
          name: form.get('name').trim(), categoryId: chosen, attributes: readAttributes(category, form) };
        if (canPrice) {
          const price = form.get('plannedPrice').trim();
          command.plannedPriceMinor = price ? parseMinor(price) : null;
        }
      }
      if (await onSave(command)) onClose();
    } catch (failure) { setError(failure.message); }
  }
  return <section className="pb-catalog-form">
    <button type="button" className="secondary" onClick={onClose}><ArrowLeft size={16} />К складу</button>
    <PageTitle title={mode === 'category' ? 'Категории товаров' : 'Редактирование товара'} />
    {error && <p role="alert" className="notice error">{error}</p>}
    <form onSubmit={save}>
      <fieldset disabled={disabled}>
        <label>{mode === 'category' ? 'Выберите категорию' : 'Категория товара'}
          <select value={chosen} onChange={event => setChosen(event.target.value)} required={mode !== 'category'}>
            {mode === 'category' && <option value="">Новая категория</option>}
            {categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {mode === 'category' ? <CategoryFields key={chosen || 'new'} category={category} />
          : <>
            <label>Название<input name="name" defaultValue={product.name} maxLength={100} required /></label>
            <div className="group-fields" key={chosen}><AttributeFields category={category} attributes={product.attributes} /></div>
            {canPrice && <label>Плановая цена продажи, ₽<input name="plannedPrice" inputMode="decimal" defaultValue={priceInput(product.plannedPriceMinor)} /></label>}
          </>}
        <button>{mode === 'category' ? 'Сохранить категорию' : 'Сохранить товар'}</button>
      </fieldset>
    </form>
  </section>;
}
