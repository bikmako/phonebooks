import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Plus, Smartphone, Wrench } from 'lucide-react';
import { PhoneDetails } from '../components/purchase/PhoneDetails.jsx';
import { PHONE_STATUS_TABS } from '../components/purchase/PhoneDetailParts.jsx';
import { PurchaseForm } from '../components/purchase/PurchaseForm.jsx';
import { Button, Card, ConfirmDialog, SearchInput } from '../components/ui.jsx';
import { deletePhone } from '../domain/phones.js';
import { useStore } from '../hooks/useStore.jsx';
import { PageTitle, SectionTitle, Status } from '../product/ui.jsx';
import { getPhoneRepairs, getRepairTotal } from '../utils/calculations.js';
import { PHONE_STATUS_LABELS } from '../utils/constants.js';
import { clearDraft, readDraft } from '../utils/drafts.js';
import { formatDate, formatMoney } from '../utils/format.js';

export function PurchasePage({ formOpen, onOpenForm, onCloseForm, onSell, repairMode }) {
  const { data, mutatePersisted, notify } = useStore();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [order, setOrder] = useState('recent');
  const [limit, setLimit] = useState(25);
  const [phone, setPhone] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [draft, setDraft] = useState(() => readDraft('phone-new'));
  const filters = repairMode ? [{ id: 'all', label: 'В ремонте' }, { id: 'history', label: 'Завершённые' }] : PHONE_STATUS_TABS;
  const matchesStatus = (item, state) => repairMode
    ? state === 'history' ? getPhoneRepairs(item).length > 0 : item.status === 'repair'
    : state === 'all' || item.status === state;
  const search = query.trim().toLocaleLowerCase('ru');
  const digits = search.replace(/\D/g, '');
  const items = data.phones.filter(item => matchesStatus(item, status) &&
    (!search || [item.model, item.supplierName, item.color, item.storage].some(value => value?.toLocaleLowerCase('ru').includes(search))
      || (digits.length >= 3 && item.imei?.includes(digits))));
  items.sort((a, b) => {
    if (order === 'name') return a.model.localeCompare(b.model, 'ru');
    if (order === 'price') return b.purchasePrice - a.purchasePrice;
    return b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt);
  });

  function closeForm() {
    setDraft(readDraft('phone-new'));
    onCloseForm();
  }

  async function remove() {
    if (!deleting) return;
    const result = await mutatePersisted(state => deletePhone(state, deleting.id));
    if (result.ok) {
      notify({ title: 'Закупка удалена', description: 'Деньги вернулись на счёт', tone: 'info' });
      setDeleting(null);
      setPhone(null);
    }
  }

  if (formOpen && !repairMode) return <section className="pb-stock-form">
    <button type="button" className="pb-action pb-action-secondary pb-back" onClick={closeForm}><ArrowLeft size={17} />К складу</button>
    <PageTitle title="Добавить устройство" />
    <PurchaseForm onDone={closeForm} onCancel={closeForm} />
  </section>;

  if (editing) return <section className="pb-stock-form">
    <button type="button" className="pb-action pb-action-secondary pb-back" onClick={() => setEditing(null)}><ArrowLeft size={17} />К складу</button>
    <PageTitle title="Редактирование устройства" />
    <PurchaseForm phone={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
  </section>;

  if (phone) return <>
    <PhoneDetails phone={phone} onClose={() => setPhone(null)}
      onEdit={item => { setEditing(item); setPhone(null); }}
      onSell={id => { setPhone(null); onSell(id); }} onDelete={setDeleting} />
    {deleting && createPortal(<ConfirmDialog open onClose={() => setDeleting(null)} onConfirm={remove}
      title="Удалить закупку?" confirmLabel="Удалить"
      description={`«${deleting.model}» будет удалён. Закупка ${formatMoney(deleting.purchasePrice)} вернётся на счёт закупки.${
        getPhoneRepairs(deleting).length ? ` Ремонты (${formatMoney(getRepairTotal(deleting))}) будут удалены, их суммы вернутся на исходные счета.` : ''}`}
    />, document.body)}
  </>;

  return <div className="pb-stack">
    {!repairMode && draft?.model && <Card className="card-pad">
      <div className="pb-actions">
        <strong>Черновик · {draft.model}</strong>
        <Button size="sm" onClick={onOpenForm}>Продолжить</Button>
        <Button size="sm" variant="secondary" onClick={() => { clearDraft('phone-new'); setDraft(null); }}>Удалить черновик</Button>
      </div>
    </Card>}
    <section className="pb-stock-list" aria-label={repairMode ? 'Устройства и история ремонта' : 'Смартфоны на складе'}>
      <div className="pb-stock-controls">
        <SearchInput value={query} onChange={value => { setQuery(value); setLimit(25); }} placeholder="IMEI, модель или продавец" />
        <label>Сортировка<select value={order} onChange={event => { setOrder(event.target.value); setLimit(25); }}>
          <option value="recent">Сначала новые</option><option value="name">По модели</option>
          {!repairMode && <option value="price">По закупочной цене</option>}
        </select></label>
      </div>
      <div className="pb-tabs pb-stock-tabs" aria-label="Статусы">
        {filters.map(({ id, label }) => <button type="button" key={id} aria-pressed={status === id}
          onClick={() => { setStatus(id); setLimit(25); }}>{!repairMode && id === 'repair' ? 'В ремонте' : label} ({data.phones.filter(item => matchesStatus(item, id)).length})</button>)}
      </div>
      {status === 'history' && <SectionTitle>История ремонта</SectionTitle>}
      {items.length ? <ul className="pb-list">{items.slice(0, limit).map(item => {
        const Icon = item.status === 'repair' ? Wrench : Smartphone;
        return <li key={item.id}><button className="pb-row" type="button" onClick={() => { setPhone(item); window.scrollTo(0, 0); }}>
          <span className="pb-row-icon"><Icon size={18} aria-hidden="true" /></span>
          <span>
            <strong>{item.model}</strong>
            <small>{[item.storage, item.color].filter(value => value && value !== '—').join(' · ')}</small>
            <small>{item.imei ? 'IMEI ' + item.imei : formatDate(item.purchaseDate)}</small>
          </span>
          <span className="pb-row-end"><Status tone={item.status === 'in_stock' ? 'good' : ['repair', 'reserved'].includes(item.status) ? 'warn' : 'neutral'}>
            {item.status === 'repair' ? 'В ремонте' : PHONE_STATUS_LABELS[item.status]}
          </Status><strong>{formatMoney(repairMode ? getRepairTotal(item) : item.purchasePrice)}</strong></span>
        </button></li>;
      })}</ul> : <p className="pb-empty">{search ? 'Ничего не найдено.' : repairMode
        ? (status === 'history' ? 'Завершённых ремонтов пока нет.' : 'Нет устройств в ремонте.')
        : data.phones.length ? 'Нет устройств с этим статусом.' : 'Склад пуст. Оформите первую скупку.'}</p>}
      {items.length > limit && <button type="button" className="pb-action pb-action-secondary pb-back" onClick={() => setLimit(limit + 25)}>Показать ещё</button>}
    </section>
    {!repairMode && <div className="pb-actions">
      <button className="pb-action" onClick={onOpenForm}><Plus size={17} />Добавить устройство</button>
    </div>}
  </div>;
}
