import React from 'react';
import { ArrowDownLeft, ArrowRight, ChartNoAxesCombined, Coins, Package, Plus, Smartphone, TrendingUp, Wrench } from 'lucide-react';
import { warehouseProjection } from '../domain/warehouse.js';
import { useStore } from '../hooks/useStore.jsx';
import { Metrics, PeriodSelect, SectionTitle } from '../product/ui.jsx';
import { getStats } from '../utils/calculations.js';
import { formatPreciseMoney, formatShortDate, getPeriod, getPreviousPeriod, inPeriod } from '../utils/format.js';
import { getAllOperations } from '../utils/operations.js';
import { percentChange } from '../components/StatCard.jsx';
import { getAccessoryStockQty } from '../domain/accessories.js';

function change(current, previous) {
  const delta = percentChange(current, previous);
  if (delta == null) return null;
  return <small className={delta >= 0 ? 'pb-positive' : 'pb-negative'}>{delta > 0 ? '+' : ''}{delta.toLocaleString('ru')}% к прошлому периоду</small>;
}

export function DashboardPage({ onNavigate, onNewPurchase, onNewSale }) {
  const { data, period, setPeriod } = useStore();
  const { stats, before, stock, repairs, operations } = React.useMemo(() => {
    const range = getPeriod(period);
    const last = getPreviousPeriod(range);
    const accessoryCount = getAccessoryStockQty(data);
    const otherStock = [...warehouseProjection(data).products.values()];
    return {
      stats: getStats(data, range),
      before: last ? getStats(data, last) : null,
      stock: data.phones.filter(phone => ['in_stock', 'reserved'].includes(phone.status)).length + accessoryCount + otherStock.filter(item => !item.inRepair).reduce((sum, item) => sum + item.quantity, 0),
      repairs: data.phones.filter(phone => phone.status === 'repair').length + otherStock.filter(item => item.inRepair).length,
      operations: getAllOperations(data).filter(operation => inPeriod(operation.date, range)).slice(0, 5),
    };
  }, [data, period]);

  return <>
    <PeriodSelect value={period} onChange={setPeriod} />
    <Metrics items={[
      { label: 'Выручка', value: formatPreciseMoney(stats.revenue), detail: change(stats.revenue, before?.revenue), Icon: Coins },
      { label: 'Чистая прибыль', value: formatPreciseMoney(stats.netProfit), detail: change(stats.netProfit, before?.netProfit), Icon: ChartNoAxesCombined },
      { label: 'На складе', value: stock + ' шт.', Icon: Smartphone, onClick: () => onNavigate('purchase') },
      { label: 'В ремонте', value: repairs + ' шт.', Icon: Wrench, onClick: () => onNavigate('repairs') },
    ]} />
    <section aria-label="Последние операции">
      <SectionTitle action={<button className="pb-text-button" onClick={() => onNavigate('history')}>Все операции <ArrowRight size={16} /></button>}>Последние операции</SectionTitle>
      {operations.length ? <ul className="pb-list">{operations.map(operation => {
        const Icon = operation.kind === 'repair' ? Wrench
          : operation.type === 'sale' || operation.type === 'acc_sale' ? TrendingUp
          : operation.type === 'purchase' ? Smartphone
          : operation.type.startsWith('acc_') ? Package : ArrowDownLeft;
        return <li key={operation.id}>
          <span className="pb-row-icon"><Icon size={18} aria-hidden="true" /></span>
          <div><strong>{operation.title}</strong><small>{formatShortDate(operation.date)}{operation.status === 'cancelled' ? ' · отменена' : ''}</small></div>
          {Boolean(operation.moneyEffect) && <strong className={operation.moneyEffect > 0 ? 'pb-positive' : undefined}>
            {operation.moneyEffect > 0 ? '+' : ''}{formatPreciseMoney(operation.moneyEffect)}
          </strong>}
        </li>;
      })}</ul> : <p className="pb-empty">За этот период ещё нет операций.</p>}
    </section>
    <div className="pb-actions pb-overview-actions">
      <button className="pb-action" onClick={onNewPurchase}><Plus size={17} />Оформить скупку</button>
      <button className="pb-action pb-action-secondary" onClick={onNewSale}><TrendingUp size={17} />Оформить продажу</button>
    </div>
  </>;
}
