import React, { useEffect, useRef, useState } from 'react';
import { SoloTransfer } from './SoloTransfer.jsx';

const names = {
  purchase: 'Закупка', sale: 'Продажа', repair: 'Ремонт', expense: 'Расход',
  stock_adjustment: 'Корректировка остатка', deposit: 'Пополнение кассы',
};
const sections = ['categories', 'products', 'accounts', 'operations'];
const requestPrefix = 'phonebooks.team.pending:';
const CACHE_LIFETIME = 15 * 60 * 1000;
const formatMoney = value => new Intl.NumberFormat('ru', { style: 'currency', currency: 'RUB' }).format(Number(value) / 100);

function money(value) {
  const match = /^(\d{1,9})(?:[,.](\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new Error('Введите сумму в рублях с точностью до копеек.');
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

function commandFor(values, type, selection) {
  const command = { type };
  if (['purchase', 'sale', 'repair', 'stock_adjustment'].includes(type)) {
    if (selection) Object.assign(command, { productId: selection.id, expectedVersion: selection.version });
    else if (type !== 'purchase') throw new Error('Выберите товар.');
    else Object.assign(command, {
      name: values.get('name').trim(), categoryId: values.get('categoryId'), tracking: values.get('tracking'),
    });
  }
  if (['purchase', 'sale', 'stock_adjustment'].includes(type)) command.quantity = Number(values.get('quantity'));
  if (['purchase', 'sale'].includes(type)) command.unitPriceMinor = money(values.get('amount'));
  if (['expense', 'repair', 'deposit'].includes(type)) command.amountMinor = money(values.get('amount'));
  if (type !== 'stock_adjustment') command.accountId = values.get('accountId');
  return command;
}

function mergeFeed(previous, delta) {
  const merged = {};
  for (const section of sections) {
    const rows = new Map((previous?.[section] ?? []).map(item => [item.id, item]));
    for (const item of delta[section]) rows.set(item.id, item);
    merged[section] = [...rows.values()];
  }
  return { ...merged, cursor: delta.cursor, role: delta.role, totals: delta.totals };
}

function readPending(key) {
  try {
    const pending = JSON.parse(sessionStorage.getItem(key));
    return pending?.id && pending?.command ? pending : null;
  } catch { return null; }
}

export function clearCloudRequests() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(requestPrefix)) sessionStorage.removeItem(key);
    }
  } catch { /* Some private sessions disable storage. */ }
}

export function CloudWorkspace({ workspace, actor, api }) {
  const scope = { p_workspace: workspace.id, p_actor: actor };
  const requestKey = requestPrefix + actor + ':' + workspace.id;
  const [data, setData] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [connection, setConnection] = useState('connecting');
  const [type, setType] = useState(workspace.role === 'employee' ? 'sale' : 'purchase');
  const [selection, setSelection] = useState(null);
  const [pending, setPending] = useState(() => readPending(requestKey));
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const cached = useRef(null);
  const lastResponse = useRef(0);
  const sync = useRef(false);
  const sendingRef = useRef(false);
  const mounted = useRef(false);

  async function refresh() {
    if (sync.current || !navigator.onLine || !mounted.current) return;
    sync.current = true;
    try {
      let current = cached.current;
      let delta;
      try {
        delta = await api('cloud/feed', { ...scope, p_cursor: current?.cursor ?? null });
      } catch (error) {
        if (error.status !== 409) throw error;
        current = null;
        delta = await api('cloud/feed', { ...scope, p_cursor: null });
      }
      if (current && delta.role !== current.role) {
        cached.current = null;
        if (mounted.current) setData(null);
        current = null;
        delta = await api('cloud/feed', { ...scope, p_cursor: null });
      }
      if (!mounted.current) return;
      cached.current = mergeFeed(current, delta);
      lastResponse.current = Date.now();
      setData(cached.current);
      setConnection('connected');
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401 || error.status === 403) {
        cached.current = null;
        setData(null);
        savePending(null);
        setConnection('denied');
      } else setConnection('unavailable');
    } finally {
      sync.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    function handleNetwork() {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        setConnection('connecting');
        void refresh();
      }
    }
    window.addEventListener('online', handleNetwork);
    window.addEventListener('offline', handleNetwork);
    const interval = window.setInterval(() => {
      if (cached.current && Date.now() - lastResponse.current > CACHE_LIFETIME) {
        cached.current = null;
        setData(null);
      }
      if (document.visibilityState === 'visible') void refresh();
    }, 4000);
    void refresh();
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener('online', handleNetwork);
      window.removeEventListener('offline', handleNetwork);
    };
  }, []);

  function savePending(next) {
    setPending(next);
    try {
      if (next) sessionStorage.setItem(requestKey, JSON.stringify(next));
      else sessionStorage.removeItem(requestKey);
    } catch { /* Replays remain available in this open page. */ }
  }

  async function send(request) {
    if (sendingRef.current || !navigator.onLine) return;
    sendingRef.current = true;
    savePending(request);
    setSending(true);
    setFailure('');
    setMessage('');
    try {
      const confirmation = await api('cloud/command', { ...scope, p_request: request.id, p_command: request.command });
      if (!mounted.current) return;
      savePending(null);
      setSelection(null);
      setMessage('Операция подтверждена сервером. Ревизия ' + confirmation.revision + '.');
    } catch (error) {
      if (!mounted.current) return;
      if ([400, 401, 403, 409].includes(error.status)) {
        savePending(null);
        setFailure(error.status === 409 ? 'Операция отклонена. Проверьте остаток, кассу и актуальную версию товара.' : error.message);
      } else setFailure('Подтверждение не получено. После восстановления связи проверьте ту же операцию.');
    } finally {
      sendingRef.current = false;
      if (mounted.current) {
        setSending(false);
        void refresh();
      }
    }
  }

  function submit(event) {
    event.preventDefault();
    try {
      const command = commandFor(new FormData(event.currentTarget), type, selection);
      void send({ id: crypto.randomUUID(), command });
    } catch (error) {
      setFailure(error.message);
    }
  }

  const canManage = (data?.role ?? workspace.role) !== 'employee';
  const available = online && connection === 'connected';
  const needsProduct = ['purchase', 'sale', 'repair', 'stock_adjustment'].includes(type);
  return <section aria-labelledby="cloud-title">
    <h2 id="cloud-title">Облачный склад</h2>
    <p aria-live="polite">{!online ? 'Нет интернета. Показаны последние полученные данные.' : {
      connected: 'Подключено', connecting: 'Подключение…', unavailable: 'Сервер недоступен. Показаны последние полученные данные.',
      denied: 'Доступ к рабочим данным завершён.',
    }[connection]}</p>
    {message && <p className="notice" aria-live="polite">{message}</p>}
    {failure && <p role="alert" className="notice error">{failure}</p>}
    {pending && <p>Операция ожидает подтверждения.{' '}
      <button disabled={!available || sending} onClick={() => send(pending)}>Проверить операцию</button>
    </p>}
    {data && <>
      {data.totals && <div>
        <h3>Касса и итоги предприятия</h3>
        {data.accounts.map(item => <p key={item.id}>{item.name} · {formatMoney(item.balanceMinor)}</p>)}
        <p>Выручка {formatMoney(data.totals.revenue_minor)} · Валовая прибыль {formatMoney(data.totals.revenue_minor - data.totals.cost_minor)} · Продажи {data.totals.sales_count}</p>
      </div>}
      <h3>Товары и остатки</h3>
      {data.products.length === 0 ? <p>Склад пуст.</p> : <ul>{data.products.filter(item => !item.archived).map(item =>
        <li key={item.id}><span>{item.name}</span><span>Остаток {item.quantity} · резерв {item.reserved}{item.inRepair ? ' · ремонт' : ''}</span></li>)}</ul>}
      <form onSubmit={submit}>
        <fieldset disabled={!available || !!pending || sending}>
          <legend>Новая операция</legend>
          <label>Тип операции<select value={type} onChange={event => { setType(event.target.value); setSelection(null); }}>
            {Object.entries(names).filter(([id]) => canManage || id === 'sale').map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          {needsProduct && <label>Товар<select name="productId" aria-label="Товар" value={selection?.id ?? ''}
            onChange={event => setSelection(data.products.find(item => item.id === event.target.value) ?? null)} required={type !== 'purchase'}>
            <option value="">{type === 'purchase' ? 'Новая карточка' : 'Выберите товар'}</option>
            {data.products.filter(item => !item.archived && (type !== 'purchase' || item.tracking === 'quantity'))
              .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
          {type === 'purchase' && !selection && <>
            <label>Название товара<input name="name" maxLength={100} required /></label>
            <label>Категория<select name="categoryId" required>{data.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Учёт<select name="tracking"><option value="unit">Поштучный</option><option value="quantity">Количественный</option></select></label>
          </>}
          {['purchase', 'sale', 'stock_adjustment'].includes(type) && <label>{type === 'stock_adjustment' ? 'Изменение количества' : 'Количество'}
            <input name="quantity" type="number" defaultValue="1" min={type === 'stock_adjustment' ? -100000 : 1} max="100000" step="1" required /></label>}
          {type !== 'stock_adjustment' && <>
            <label>{['purchase', 'sale'].includes(type) ? 'Цена за единицу, ₽' : 'Сумма, ₽'}<input name="amount" inputMode="decimal" required /></label>
            <label>Счёт<select name="accountId" required>{data.accounts.filter(item => !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </>}
          <button>Провести операцию</button>
        </fieldset>
      </form>
      {data.operations.length > 0 && <><h3>Последние операции</h3>
        <ul>{data.operations.slice(-10).reverse().map(item => <li key={item.id}>{item.date} · {names[item.type] ?? item.type}</li>)}</ul></>}
      {data.role === 'owner' && <SoloTransfer scope={scope} online={available && !pending && !sending} api={api} onImported={refresh} />}
    </>}
  </section>;
}
