import React, { useEffect, useState } from 'react';
import { SectionTitle } from '../src/product/ui.jsx';
import { getPeriod } from '../src/utils/format.js';
import { formatMinor } from './CloudReports.jsx';
import { TeamOperations } from './CloudViews.jsx';

export function TeamHistory({ api, scope, revision, permissionKey, online, product, kind, period = 'all', title,
  latest = false, onHistory, fallback, query }) {
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState(null);
  const { p_workspace, p_actor } = scope;
  const key = [p_workspace, p_actor, revision, permissionKey, product, kind, period, offset, query].join(':');
  useEffect(() => {
    if (!online) return;
    let obsolete = false;
    const range = period === 'all' ? { from: null, to: null } : getPeriod(period);
    api('team/operations', { p_workspace, p_actor, p_product: product ?? null, p_kind: kind ?? null,
      p_from: range.from, p_to: range.to, p_offset: offset, ...(query != null ? { p_query: query } : {}) })
      .then(data => { if (!obsolete) setLoaded({ key, data }); })
      .catch(() => { if (!obsolete) setLoaded({ key, error: true }); });
    return () => { obsolete = true; };
  }, [api, p_workspace, p_actor, product, kind, period, offset, online, key, query]);

  const response = loaded?.key === key ? loaded : null;
  const rows = response?.data?.items;
  const flow = response?.data?.flow;
  if (!rows) return <>
    {latest && fallback?.length > 0 && <TeamOperations operations={[...fallback].reverse()} title={title} latest onHistory={onHistory} />}
    <p className="pb-empty" role="status">{!online ? 'История недоступна без подключения.'
      : response?.error ? 'Не удалось загрузить историю.' : 'Загружаем историю…'}</p>
  </>;
  return <div className="pb-history">
    {flow && <section>
      <SectionTitle>Движение денежных средств</SectionTitle>
      <dl className="metric-list">
        <div><dt>Приходы</dt><dd>{formatMinor(flow.inMinor)}</dd></div>
        <div><dt>Расходы</dt><dd>{formatMinor(flow.outMinor)}</dd></div>
        <div><dt>Изменение остатков</dt><dd>{formatMinor(flow.netMinor)}</dd></div>
      </dl>
    </section>}
    <TeamOperations operations={rows} title={title} latest={latest} onHistory={onHistory} memberNames={new Map([[p_actor, 'Вы']])} />
    {!latest && (offset > 0 || response.data.more) && <div className="pb-actions pb-history-pages">
      {offset > 0 && <button className="secondary" onClick={() => setOffset(offset - 50)}>Назад</button>}
      {response.data.more && <button className="secondary" onClick={() => setOffset(offset + 50)}>Следующая страница</button>}
    </div>}
  </div>;
}
