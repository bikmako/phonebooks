import React, { useState } from 'react';
import { ArrowLeft, Pencil, Smartphone, Wrench } from 'lucide-react';
import { setPhoneStatus } from '../../domain/phones.js';
import { legacyHeld, phoneUnavailable } from '../../domain/legacyTradeState.js';
import { useStore } from '../../hooks/useStore.jsx';
import { PageTitle, SectionTitle, Status } from '../../product/ui.jsx';
import { LegacyTradeDialog } from '../../product/LegacyTradeDialog.jsx';
import { findCompletedSale, getPhoneRepairs, getPhoneTotalCost, getRepairTotal, getSaleProfit, getSaleRevenue } from '../../utils/calculations.js';
import { PHONE_CONDITIONS, PHONE_STATUS_LABELS } from '../../utils/constants.js';
import { formatDate, formatPreciseMoney } from '../../utils/format.js';
import { getAllOperations } from '../../utils/operations.js';
import { RepairModal } from './RepairModal.jsx';

const tabs = [['info', 'Информация'], ['operations', 'Операции'], ['repairs', 'Ремонты']];

export function PhoneDetails({ phone: initialPhone, onClose, onEdit, onSell, onDelete }) {
  const { data, mutatePersisted, notify } = useStore();
  const phone = data.phones.find(item => item.id === initialPhone.id) ?? initialPhone;
  const [tab, setTab] = useState('info');
  const [repairDialog, setRepairDialog] = useState(null);
  const [changing, setChanging] = useState(false);
  const [trade, setTrade] = useState(false);
  const held = legacyHeld(data, 'phone:' + phone.id);
  const sale = findCompletedSale(data, phone.id);
  const repairs = getPhoneRepairs(phone);
  const cost = getPhoneTotalCost(phone);
  const listedPrice = sale ? getSaleRevenue(sale) : phone.plannedPrice;
  const profit = sale ? getSaleProfit(sale, data.phones) : listedPrice - cost;
  const caption = [phone.storage, phone.color, PHONE_CONDITIONS[phone.condition]].filter(value => value && value !== '—').join(' · ');
  const account = id => data.accounts.find(item => item.id === id)?.name ?? '—';

  async function changeStatus(status) {
    setChanging(true);
    const result = await mutatePersisted(state => setPhoneStatus(state, phone.id, status));
    setChanging(false);
    if (result.ok) {
      notify({ title: 'Статус: ' + PHONE_STATUS_LABELS[status].toLowerCase(), tone: 'success' });
      onClose();
    }
  }

  return <section className="pb-phone-detail" aria-label="Карточка устройства">
    <button className="pb-action pb-action-secondary pb-back" aria-label="Закрыть" onClick={onClose}><ArrowLeft size={17} />К списку</button>
    <PageTitle title={phone.model} eyebrow="Устройство" />
    <p className="pb-device-caption">{caption}</p>
    <Status tone={phone.status === 'in_stock' ? 'good' : ['repair', 'reserved'].includes(phone.status) ? 'warn' : 'neutral'}>
      {phone.status === 'repair' ? 'В ремонте' : PHONE_STATUS_LABELS[phone.status]}
    </Status>
    <div className="pb-tabs pb-device-tabs" aria-label="Разделы карточки">
      {tabs.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === 'info' && <>
      <section aria-label="Финансовая информация">
        <SectionTitle>Стоимость устройства</SectionTitle>
        <dl className="pb-finance-flow">
          <div><dt>Закупка</dt><dd>{formatPreciseMoney(phone.purchasePrice)}</dd></div>
          <div><dt>Ремонт</dt><dd>{formatPreciseMoney(getRepairTotal(phone))}</dd></div>
          <div><dt>Себестоимость</dt><dd>{formatPreciseMoney(cost)}</dd></div>
          <div><dt>{sale ? 'Фактическая цена продажи' : 'Планируемая цена продажи'}</dt><dd>{listedPrice || sale ? formatPreciseMoney(listedPrice) : '—'}</dd></div>
          <div><dt>{sale ? 'Прибыль' : 'Потенциальная прибыль'}</dt><dd className={profit >= 0 ? 'pb-positive' : 'pb-negative'}>
            {listedPrice || sale ? formatPreciseMoney(profit) : '—'}
          </dd></div>
        </dl>
      </section>
      <dl className="pb-finance-flow">
        <div><dt>IMEI</dt><dd>{phone.imei || '—'}</dd></div>
        <div><dt>Комплектация</dt><dd>{phone.kit}</dd></div>
        <div><dt>Продавец</dt><dd>{[phone.supplierName, phone.supplierPhone].filter(Boolean).join(' · ')}</dd></div>
        <div><dt>Дата закупки</dt><dd>{formatDate(phone.purchaseDate)}</dd></div>
        <div><dt>Счёт закупки</dt><dd>{account(phone.purchaseAccountId)}</dd></div>
        {phone.purchaseComment && <div><dt>Комментарий</dt><dd>{phone.purchaseComment}</dd></div>}
      </dl>
    </>}
    {tab === 'operations' && <ul className="pb-list">{getAllOperations(data).filter(item => item.meta?.phoneId === phone.id).map(item =>
      <li key={item.id}><span className="pb-row-icon"><Smartphone size={17} /></span>
        <span><strong>{item.title}</strong><small>{formatDate(item.date)} · {item.meta?.account}{item.status === 'cancelled' ? ' · отменена' : ''}</small></span>
        {item.moneyEffect !== 0 && <strong>{formatPreciseMoney(item.moneyEffect)}</strong>}</li>
    )}</ul>}
    {tab === 'repairs' && <section aria-label="История ремонтов">
      <SectionTitle>История ремонтов</SectionTitle>
      {repairs.length ? <ul className="pb-list">{repairs.map((repair, index) => <li key={repair.id}>
        <span className="pb-row-icon"><Wrench size={17} /></span>
        <div><strong>{formatDate(repair.date)}</strong><small>{[repair.comment, repair.accountId && account(repair.accountId)].filter(Boolean).join(' · ')}</small>
          <div className="pb-actions">
            <button className="pb-text-button" aria-label={'Исправить ремонт ' + (index + 1)} onClick={() => setRepairDialog({ repair })}>Исправить</button>
            <button className="pb-text-button pb-negative" aria-label={'Удалить ремонт ' + (index + 1)} onClick={() => setRepairDialog({ repair, deleting: true })}>Удалить</button>
          </div>
        </div>
        <strong>{formatPreciseMoney(repair.amount)}</strong>
      </li>)}</ul> : <p className="pb-empty">Завершённых ремонтов пока нет.</p>}
    </section>}
    {!phoneUnavailable(phone) && <>
      <div className="pb-actions pb-warehouse-actions pb-device-actions" role="group" aria-label="Действия устройства">
        {phone.status === 'repair' ? <button className="pb-action" onClick={() => setRepairDialog({})}><Wrench size={17} />Завершить ремонт</button>
          : <>
            <button className="pb-action" disabled={held > 0} onClick={() => onSell(phone.id)}>Продать</button>
            <button className="pb-action pb-action-secondary" disabled={changing || held > 0} onClick={() => changeStatus('repair')}><Wrench size={17} />Передать в ремонт</button>
          </>}
        <button className="pb-action pb-action-secondary" onClick={() => onEdit(phone)}><Pencil size={17} />Изменить</button>
        <button className="pb-text-button pb-negative" onClick={() => onDelete(phone)}>Удалить</button>
      </div>
      {phone.status !== 'repair' && !held && <div className="pb-actions">
        {['in_stock', 'reserved'].filter(status => status !== phone.status).map(status => <button className="pb-text-button" key={status}
          disabled={changing} onClick={() => changeStatus(status)}>{status === 'reserved' ? 'Перевести в резерв' : 'Вернуть на склад'}</button>)}
      </div>}
    </>}
    <button type="button" className="pb-action pb-action-secondary" onClick={() => setTrade(true)}>Возвраты и бронирования</button>
    {trade && <LegacyTradeDialog productId={'phone:' + phone.id} onClose={() => setTrade(false)} />}
    {repairDialog && <RepairModal phone={phone} {...repairDialog} onClose={() => setRepairDialog(null)} />}
  </section>;
}
