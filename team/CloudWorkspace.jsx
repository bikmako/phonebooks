import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { PageTitle, PeriodSelect, routeName, Status } from '../src/product/ui.jsx';
import { CloudReports } from './CloudReports.jsx';
import { TeamProduct, TeamStock } from './CloudViews.jsx';
import { TeamHistory } from './TeamHistory.jsx';
import { SoloTransfer } from './SoloTransfer.jsx';
import { readCloudFeed } from './cloudFeed.js';

const productCommands = ['purchase', 'sale', 'repair', 'repair_start', 'stock_adjustment'];
const accountCommands = ['purchase', 'sale', 'repair', 'expense', 'deposit'];
const requestPrefix = 'phonebooks.team.pending:';
const CACHE_LIFETIME = 15 * 60 * 1000;
const writePermissions = {
  purchase: ['trade.purchase', 'stock.read'], sale: ['trade.sale', 'stock.read'],
  repair: ['repair.finish', 'stock.read'], repair_start: ['repair.start', 'stock.read'], expense: ['finance.expense', 'finance.cash.read'],
  stock_adjustment: ['stock.adjust', 'stock.read'], deposit: ['finance.deposit'],
};

function canRetry(command, permissions) {
  const required = [...(writePermissions[command.type] ?? [])];
  if (!Object.hasOwn(writePermissions, command.type)) return false;
  if (command.type === 'purchase') {
    if (!command.productId) required.push('stock.create');
    if (command.unitPriceMinor > 0) required.push('finance.cash.read');
  }
  if (command.type === 'repair' && command.amountMinor > 0) required.push('repair.expense', 'finance.cash.read');
  if (command.type === 'stock_adjustment' && command.quantity < 0) required.push('stock.writeoff');
  return required.every(permission => permissions.includes(permission));
}

function money(value) {
  const match = /^(\d{1,9})(?:[,.](\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new Error('Введите сумму в рублях с точностью до копеек.');
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

function commandFor(values, type, selection, categories) {
  const command = { type };
  if (productCommands.includes(type)) {
    if (selection) Object.assign(command, { productId: selection.id, expectedVersion: selection.version });
    else if (type !== 'purchase') throw new Error('Выберите товар.');
    else {
      const categoryId = values.get('categoryId');
      const fields = categories.find(category => category.id === categoryId)?.attributes ?? [];
      const attributes = Object.fromEntries(fields.flatMap(field => {
        const value = values.get('attr:' + field.id);
        if (value == null || value === '') return [];
        return [[field.id, field.type === 'boolean' ? value === 'true' : field.type === 'number' ? Number(value) : value.trim()]];
      }));
      Object.assign(command, { name: values.get('name').trim(), categoryId, tracking: values.get('tracking'), attributes });
    }
  }
  if (['purchase', 'sale', 'stock_adjustment'].includes(type)) command.quantity = Number(values.get('quantity'));
  if (['purchase', 'sale'].includes(type)) command.unitPriceMinor = money(values.get('amount'));
  if (['expense', 'repair', 'deposit'].includes(type)) command.amountMinor = money(values.get('amount'));
  if (accountCommands.includes(type)) command.accountId = values.get('accountId');
  return command;
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

export function CloudWorkspace({ workspace, actor, api, onAccessChanged, route, navigate, addRequest, onAdd }) {
  const scope = { p_workspace: workspace.id, p_actor: actor };
  const requestKey = requestPrefix + actor + ':' + workspace.id;
  const [data, setData] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [connection, setConnection] = useState('connecting');
  const [period, setPeriod] = useState('month');
  const [chosenType, setType] = useState('');
  const [selection, setSelection] = useState(null);
  const [productId, setProductId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const seenAdd = useRef(addRequest);
  const [pending, setPending] = useState(() => readPending(requestKey));
  const pendingRequest = useRef(pending);
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
      const next = await readCloudFeed(api, scope, cached.current, () => {
        cached.current = null;
        if (mounted.current) {
          setData(null);
          setSelection(null);
          setType('');
          setProductId('');
          setMessage('');
          setFailure('');
          onAccessChanged();
        }
      });
      if (!mounted.current) return;
      if (pendingRequest.current && !canRetry(pendingRequest.current.command, next.permissions)) savePending(null);
      cached.current = next;
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
        onAccessChanged();
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
    pendingRequest.current = next;
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
      await api('cloud/command', { ...scope, p_request: request.id, p_command: request.command });
      if (!mounted.current) return;
      savePending(null);
      setSelection(null);
      setType('');
      setProductId('');
      setMessage('Операция подтверждена сервером.');
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
      const command = commandFor(new FormData(event.currentTarget), type, selection, data.categories);
      void send({ id: crypto.randomUUID(), command });
    } catch (error) {
      setFailure(error.message);
    }
  }

  const permissions = data?.permissions ?? [];
  const allowed = Object.keys(writePermissions).filter(kind => writePermissions[kind].every(permission => permissions.includes(permission)));
  const actions = {
    purchase: ['purchase', 'stock_adjustment'], sales: ['sale'], repairs: ['repair_start', 'repair'], finance: ['deposit', 'expense'],
  }[route] ?? [];
  const type = allowed.includes(chosenType) && actions.includes(chosenType) ? chosenType : '';
  const available = online && connection === 'connected';
  const needsProduct = productCommands.includes(type);
  const mayReadStock = permissions.includes('stock.read');
  const mayReadHistory = permissions.includes('finance.history.read');
  const currentProduct = data?.products.find(item => item.id === productId && !item.archived);
  const activeCategory = data?.categories.find(item => item.id === (categoryId || 'smartphones')) ?? data?.categories[0];
  function start(kind, product = null) {
    setSelection(product);
    setType(kind);
    setFailure('');
    setMessage('');
    if (kind === 'sale') navigate('sales');
    if (kind === 'repair' || kind === 'repair_start') navigate('repairs');
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    if (!data || seenAdd.current === addRequest) return;
    seenAdd.current = addRequest;
    if (allowed.includes('purchase')) start('purchase');
  }, [addRequest, data]);
  const previousRoute = useRef(route);
  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    if (!type) {
      setProductId('');
      setSelection(null);
      setType('');
    }
  }, [route, type]);
  const contextTitle = {
    purchase: 'Добавить товар', sale: 'Оформить продажу', repair: 'Завершить ремонт', repair_start: 'Передать в ремонт',
    stock_adjustment: 'Изменить остаток', expense: 'Учесть расход', deposit: 'Пополнить счёт',
  };

  const connectionStatus = !online ? (data ? 'Нет интернета. Показаны последние полученные данные.' : 'Нет интернета.') : {
      connected: 'Подключено', connecting: 'Подключение…', unavailable: data ? 'Сервер недоступен. Показаны последние полученные данные.' : 'Сервер недоступен.',
      denied: 'Доступ к рабочим данным завершён.',
  }[connection];
  const historyProps = data && {
    api, scope, revision: data.cursor, online: available, permissionKey: permissions.join(','),
  };
  const mayReadCash = permissions.includes('finance.cash.read');
  const stockDetail = ['purchase', 'repairs'].includes(route) && mayReadStock && currentProduct && !type;
  return <section className="pb-workspace" aria-label="Рабочие данные">
    {![ 'team', 'settings' ].includes(route) && !stockDetail && <PageTitle
      title={type ? contextTitle[type] : route === 'dashboard'
        ? <><span className="pb-overview-wordmark">PhoneBooks</span><span className="pb-overview-label">Обзор</span></>
        : routeName(route)}
      eyebrow={route === 'dashboard' ? 'Обзор' : undefined} description={route === 'dashboard' ? workspace.name : undefined}
      action={route === 'dashboard' && onAdd && <button className="pb-desktop-add" type="button" onClick={onAdd}><Plus size={17} />Добавить товар</button>}
    />}
    <div className="pb-connection" aria-live="polite"><Status tone={available ? 'good' : 'warn'}>{connectionStatus}</Status></div>
    {message && <p className="notice" aria-live="polite">{message}</p>}
    {failure && <p role="alert" className="notice error">{failure}</p>}
    {pending && <p className="notice">Операция ожидает подтверждения.{' '}
      <button disabled={!available || sending} onClick={() => send(pending)}>Проверить операцию</button>
    </p>}
    {data && <>
      {!type && ['dashboard', 'sales', 'finance'].includes(route) && <CloudReports data={data}
        workspaceId={workspace.id} actor={actor} api={api} route={route} online={available} navigate={navigate} period={period} setPeriod={setPeriod} />}
      {stockDetail && <TeamProduct key={currentProduct.id} product={currentProduct} categories={data.categories} onBack={() => setProductId('')}
        history={mayReadHistory ? tab => <TeamHistory key={tab} {...historyProps} product={currentProduct.id}
          kind={tab === 'repairs' ? 'repair' : null} title={tab === 'repairs' ? 'История ремонта' : 'Операции с товаром'} /> : undefined}
        actions={allowed.filter(kind => [
          ...(!currentProduct.inRepair && currentProduct.quantity > currentProduct.reserved ? ['sale'] : []),
          ...(!currentProduct.inRepair && currentProduct.tracking === 'unit' && currentProduct.quantity === 1 && currentProduct.reserved === 0 ? ['repair_start'] : []),
          ...(currentProduct.inRepair ? ['repair'] : ['stock_adjustment', ...(currentProduct.tracking === 'quantity' ? ['purchase'] : [])]),
        ].includes(kind))} onOperation={kind => start(kind, currentProduct)} />}
      {!type && !stockDetail && mayReadStock && ['purchase', 'repairs'].includes(route) && <TeamStock key={route}
        products={data.products} categories={data.categories} repairs={route === 'repairs'} onOpen={setProductId}
        onCreate={route === 'purchase' && allowed.includes('purchase') ? () => start('purchase') : undefined} />}
      {!type && !stockDetail && route !== 'purchase' && <div className="pb-actions">
        {actions.filter(kind => allowed.includes(kind)).map(kind =>
          <button key={kind} onClick={() => start(kind)} disabled={!available || !!pending}><Plus size={17} />{contextTitle[kind]}</button>)}
      </div>}
      {type && <form className="pb-command pb-panel" onSubmit={submit} key={type}>
        <button className="secondary" type="button" onClick={() => { setType(''); setSelection(null); }}><ArrowLeft size={16} />Вернуться</button>
        <fieldset disabled={!available || !!pending || sending} aria-label={contextTitle[type]}>
          {needsProduct && <label>Товар<select name="productId" aria-label="Товар" value={selection?.id ?? ''}
            onChange={event => setSelection(data.products.find(item => item.id === event.target.value) ?? null)} required={type !== 'purchase'}>
            {(type !== 'purchase' || permissions.includes('stock.create')) && <option value="">{type === 'purchase' ? 'Новая карточка' : 'Выберите товар'}</option>}
            {type === 'purchase' && !permissions.includes('stock.create') && <option value="">Выберите товар</option>}
            {data.products.filter(item => !item.archived &&
              (type !== 'purchase' || item.tracking === 'quantity') &&
              (type !== 'sale' || (!item.inRepair && item.quantity > item.reserved)) &&
              (type !== 'repair_start' || (item.tracking === 'unit' && item.quantity === 1 && !item.inRepair && !item.reserved)) &&
              (type !== 'repair' || (item.tracking === 'unit' && item.quantity === 1)))
              .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
          {type === 'purchase' && !selection && permissions.includes('stock.create') && <>
            <label>Название товара<input name="name" maxLength={100} required /></label>
            <div className="group-fields">
              <label>Категория<select name="categoryId" value={activeCategory?.id ?? ''} onChange={event => setCategoryId(event.target.value)} required>
                {data.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Учёт<select name="tracking" key={activeCategory?.id} defaultValue={activeCategory?.id === 'accessories' ? 'quantity' : 'unit'}>
                <option value="unit">Поштучный</option><option value="quantity">Количественный</option></select></label>
            </div>
            {activeCategory?.attributes?.length > 0 && <div className="group-fields" key={activeCategory.id}>
              {activeCategory.attributes.map(field => <label key={field.id}>{field.name}{field.type === 'boolean'
                ? <select name={'attr:' + field.id}><option value="">Не указано</option><option value="true">Да</option><option value="false">Нет</option></select>
                : <input name={'attr:' + field.id} type={field.type === 'number' ? 'number' : 'text'} step="any" maxLength={200} inputMode={field.id === 'imei' ? 'numeric' : undefined} />}</label>)}
            </div>}
          </>}
          {['purchase', 'sale', 'stock_adjustment'].includes(type) && <label>{type === 'stock_adjustment' ? 'Изменение количества' : 'Количество'}
            <input name="quantity" type="number" defaultValue="1" min={type === 'stock_adjustment' ? -100000 : 1} max="100000" step="1" required /></label>}
          {accountCommands.includes(type) && <>
            <label>{['purchase', 'sale'].includes(type) ? 'Цена за единицу, ₽' : 'Сумма, ₽'}<input name="amount" inputMode="decimal" required /></label>
            <label>Счёт<select name="accountId" required>{data.accounts.filter(item => !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </>}
          <button disabled={type === 'purchase' && !selection && !permissions.includes('stock.create')}>
            {sending ? 'Ожидаем подтверждения…' : 'Провести операцию'}<ArrowRight size={16} />
          </button>
        </fieldset>
      </form>}
      {!type && !stockDetail && mayReadHistory && ['dashboard', 'sales', 'repairs', 'finance', 'history'].includes(route) && <>
        {['repairs', 'history'].includes(route) && <PeriodSelect value={period} onChange={setPeriod} />}
        <TeamHistory key={route + ':' + period} {...historyProps} period={period}
          title={route === 'sales' ? 'Операции продаж' : route === 'repairs' ? 'История ремонта' : route === 'finance' && mayReadCash ? 'Движение по счетам' : 'Последние операции'}
          latest={route === 'dashboard'} onHistory={route === 'dashboard' ? () => navigate('history') : undefined}
          kind={route === 'sales' ? 'sale' : route === 'repairs' ? 'repair' : route === 'finance' && mayReadCash ? 'cash' : null}
          fallback={data.operations} />
      </>}
      {permissions.includes('data.solo_transfer') && <div className="pb-transfer" hidden={route !== 'settings'}>
        <SoloTransfer scope={scope} online={available && !pending && !sending} api={api} onImported={refresh} />
      </div>}
    </>}
  </section>;
}
