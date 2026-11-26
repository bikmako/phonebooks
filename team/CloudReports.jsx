import React, { useEffect, useState } from 'react';
import { ChartNoAxesCombined, Coins, Smartphone, Wallet, Wrench } from 'lucide-react';
import { FinanceChart } from '../src/product/FinanceChart.jsx';
import { Metrics, PeriodSelect, SectionTitle } from '../src/product/ui.jsx';
import { addDays, formatShortDate, getPeriod, parseDate, toISODate, today } from '../src/utils/format.js';

const money = new Intl.NumberFormat('ru', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
export function formatMinor(value) {
  const minor = BigInt(value);
  const rubles = minor / 100n;
  const kopecks = minor % 100n;
  const amount = rubles === 0n && kopecks < 0n ? -0 : rubles;
  return money.formatToParts(amount).flatMap(({ type, value }) =>
    type === 'fraction' ? (kopecks ? [String(kopecks < 0 ? -kopecks : kopecks).padStart(2, '0')] : [])
      : type === 'decimal' && !kopecks ? [] : [value]).join('');
}

function reportRanges(period) {
  const range = getPeriod(period);
  if (period === 'day') return [{ from: range.from, to: range.to }];
  if (period === 'week' || period === 'month') {
    const ranges = [];
    for (let from = parseDate(range.from); toISODate(from) <= range.to; from = addDays(from, period === 'week' ? 1 : 7)) {
      ranges.push({ from: toISODate(from), to: [range.to, toISODate(addDays(from, period === 'week' ? 0 : 6))].sort()[0] });
    }
    return ranges;
  }
  const end = parseDate(today());
  const length = period === 'year' ? 13 : 6;
  return Array.from({ length }, (_, index) => {
    const month = end.getMonth() - length + index + 1;
    const from = toISODate(new Date(end.getFullYear(), month, 1));
    const to = toISODate(new Date(end.getFullYear(), month + 1, 0));
    return { from: [from, range.from].sort()[1], to: [to, today()].sort()[0] };
  }).filter(({ from, to }) => from <= to);
}

export function CloudReports({ data, workspaceId, actor, api, route, online, navigate, period, setPeriod }) {
  const permissions = data.permissions;
  const company = permissions.includes('analytics.company');
  const personal = permissions.includes('analytics.self');
  const [own, setOwn] = useState(!company);
  const [loaded, setLoaded] = useState(null);
  const mine = personal && (own || !company);
  const canRead = company || personal;
  const chart = route === 'finance';
  const reportKey = [workspaceId, actor, permissions.join(','), data.cursor, route, period, mine].join(':');

  useEffect(() => {
    if (!canRead || !online) return;
    let obsolete = false;
    const range = period === 'all' ? { from: null, to: null } : getPeriod(period);
    const query = ({ from, to }) => api('team/stats', {
      p_workspace: workspaceId, p_actor: actor, p_member: mine ? actor : null, p_from: from, p_to: to,
    });
    async function load() {
      try {
        const metrics = await query(range);
        if (obsolete) return;
        setLoaded({ key: reportKey, metrics });
        if (!chart || !Object.hasOwn(metrics, 'revenueMinor')) return;
        const ranges = reportRanges(period);
        const rows = await Promise.all(ranges.map(async range => {
          const values = await query(range);
          return {
            key: range.from, label: formatShortDate(range.from),
            fullLabel: range.from === range.to ? range.from : range.from + ' — ' + range.to,
            income: Number(values.revenueMinor) / 100,
            profit: Number(values.netMinor ?? values.grossMinor ?? 0) / 100,
          };
        }));
        if (!obsolete) setLoaded({ key: reportKey, metrics, rows });
      } catch (error) {
        if (!obsolete) setLoaded(current => current?.key === reportKey
          ? { ...current, chartError: true }
          : { key: reportKey, error: error.message });
      }
    }
    void load();
    return () => { obsolete = true; };
  }, [api, workspaceId, actor, canRead, chart, mine, online, period, reportKey]);

  const current = loaded?.key === reportKey ? loaded : null;
  const stats = current?.metrics;
  const accounts = data.accounts.filter(account => !account.archived && Object.hasOwn(account, 'balanceMinor'));
  const products = data.products.filter(item => !item.archived && item.quantity > 0);
  const metrics = [
    ['revenueMinor', 'Выручка', Coins], ['netMinor', 'Чистая прибыль', ChartNoAxesCombined],
    ...(!Object.hasOwn(stats ?? {}, 'netMinor') ? [['grossMinor', 'Валовая прибыль', ChartNoAxesCombined]] : []),
    ...(chart ? [['expensesMinor', 'Операционные расходы', Wallet]] : []),
    ...(route === 'sales' ? [['sales', 'Продажи', ChartNoAxesCombined]] : []),
  ].filter(([key]) => Object.hasOwn(stats ?? {}, key)).map(([key, label, Icon]) => ({
    label, Icon, value: key === 'sales' ? stats[key] : formatMinor(stats[key]),
  }));
  if (route === 'dashboard' && permissions.includes('stock.read')) metrics.push(
    { label: 'На складе', Icon: Smartphone, value: products.filter(item => !item.inRepair).reduce((sum, item) => sum + item.quantity, 0) + ' шт.', onClick: () => navigate('purchase') },
    { label: 'В ремонте', Icon: Wrench, value: products.filter(item => item.inRepair).length + ' шт.', onClick: () => navigate('repairs') },
  );

  return <>
    {canRead && <div className="pb-report-toolbar">
      <PeriodSelect value={period} onChange={setPeriod} />
      {company && personal && <div className="pb-tabs" aria-label="Область статистики">
        <button aria-pressed={!mine} onClick={() => setOwn(false)}>Предприятие</button>
        <button aria-pressed={mine} onClick={() => setOwn(true)}>Моя статистика</button>
      </div>}
    </div>}
    <Metrics items={metrics} />
    {current?.error && <p role="alert" className="notice error">{current.error}</p>}
    {canRead && !stats && !current?.error && <p className="pb-empty" role="status">{online ? 'Загружаем показатели…' : 'Показатели недоступны без подключения.'}</p>}
    {!canRead && route === 'dashboard' && !metrics.length && <p className="pb-empty">У вашей роли нет доступа к показателям предприятия.</p>}
    {chart && stats && Object.hasOwn(stats, 'revenueMinor') && <section className="pb-report">
      <SectionTitle>Динамика</SectionTitle>
      {current.rows ? <FinanceChart data={current.rows} series={[
        { key: 'income', label: 'Выручка' },
        ...(Object.hasOwn(stats, 'grossMinor') || Object.hasOwn(stats, 'netMinor') ? [{ key: 'profit', label: Object.hasOwn(stats, 'netMinor') ? 'Чистая прибыль' : 'Валовая прибыль' }] : []),
      ]} /> : <p className="pb-empty" role="status">{current.chartError ? 'Не удалось загрузить график.' : 'Загружаем график…'}</p>}
    </section>}
    {chart && permissions.includes('finance.cash.read') && <section className="pb-report" aria-label="Касса и счета">
      <SectionTitle>Касса и счета</SectionTitle>
      {accounts.length ? <dl className="metric-list">{accounts.map(account => <div key={account.id}><dt>{account.name}</dt><dd>{formatMinor(account.balanceMinor)}</dd></div>)}</dl>
        : <p className="pb-empty">Нет активных счетов.</p>}
    </section>}
  </>;
}
