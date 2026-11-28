import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Search, Settings, UsersRound } from 'lucide-react';
import { AppShell, PageTitle } from '../src/product/ui.jsx';
import { initTheme, ThemeToggle } from '../src/hooks/useTheme.jsx';
import { AccountForm, AuthLayout } from './AccountForm.jsx';
import { Workspaces } from './Workspaces.jsx';
import { clearCloudRequests, CloudWorkspace } from './CloudWorkspace.jsx';
import { TeamPanel } from './TeamPanel.jsx';
import { demoTeamUrl, isDemo } from '../src/demo/mode.js';
import { DemoBanner } from '../src/demo/DemoBanner.jsx';
import '../src/product/product.css';
import './styles.css';
import './auth.css';

if (isDemo && location.origin !== new URL(demoTeamUrl).origin) {
  document.getElementById('root').textContent = 'Откройте демоверсию по адресу ' + demoTeamUrl;
  throw new Error('Demo origin required');
}

const callbackUrl = new URL(location.href);
const callbackView = callbackUrl.searchParams.get('view');
const callbackToken = ['confirm', 'reset'].includes(callbackView) ? callbackUrl.hash.slice(1) : '';
if (callbackView) history.replaceState(null, '', location.pathname);

async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => { throw new Error('Нет соединения с PhoneBooks Team. Попробуйте ещё раз.'); });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const message = response.status < 500 && data?.error ? data.error
      : response.status === 403 ? 'У вас нет доступа к этому действию.'
      : 'Сервис временно недоступен. Попробуйте ещё раз.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

const sections = ['dashboard', 'purchase', 'sales', 'repairs', 'finance', 'history', 'search', 'team', 'settings'];
const readRoute = () => sections.includes(location.hash.slice(2)) ? location.hash.slice(2) : 'dashboard';

function TeamApp() {
  const [config, setConfig] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [view, setView] = useState(callbackToken ? callbackView : 'login');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [route, setRoute] = useState(readRoute);
  const [addRequest, setAddRequest] = useState(0);
  const working = useRef(false);
  const selectedId = useRef('');

  function navigate(next) {
    location.hash = '/' + next;
    setRoute(next);
    window.scrollTo(0, 0);
  }

  useEffect(() => {
    const change = () => { setRoute(readRoute()); setNote(''); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  function clearWorkspace() {
    selectedId.current = '';
    setInviteLink('');
    setData(null);
  }

  async function loadWorkspaces(preferred = selectedId.current) {
    const overview = await api('workspaces', { p_preferred: preferred || null });
    const { selected } = overview;
    if (selected?.id !== selectedId.current || selected?.role !== 'owner') setInviteLink('');
    selectedId.current = selected?.id ?? '';
    setData(overview);
  }

  async function run(action, { refresh = false, quiet = false } = {}) {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    setError('');
    if (!quiet) setNote('');
    try {
      await action();
      return true;
    } catch (failure) {
      if (failure.status === 401 || (refresh && failure.status && failure.status < 500)) {
        clearCloudRequests();
        clearWorkspace();
        if (failure.status === 401) setView('login');
      }
      if (!(quiet && failure.status === 401)) setError(failure.message);
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(async () => {
      setConfig(await api('config'));
      if (!callbackToken) {
        await loadWorkspaces().catch(failure => { if (failure.status !== 401) throw failure; });
      }
    }).finally(() => setReady(true));
  }, []);

  const accountId = data?.account.id;
  useEffect(() => {
    if (!accountId) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void run(loadWorkspaces, { refresh: true, quiet: true });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      window.clearInterval(timer);
    };
  }, [accountId]);

  function changeView(next) {
    setError('');
    setNote('');
    setView(next);
  }

  function submitAuth(mode, values) {
    return run(async () => {
      if (mode === 'confirm' || mode === 'reset') {
        await api('auth/verify', { token: callbackToken, kind: mode === 'confirm' ? 'email' : 'recovery' });
        if (mode === 'reset') setView('password');
        else {
          setView('login');
          await loadWorkspaces();
        }
        return;
      }
      await api('auth/' + mode, values);
      if (mode === 'login') await loadWorkspaces();
      else {
        setView('login');
        setNote({
          password: 'Пароль изменён. Войдите с новым паролем.',
          recover: 'Если аккаунт существует, ссылка для восстановления придёт на указанный адрес.',
          register: 'Проверьте почту и подтвердите адрес перед входом.',
          resend: 'Если адрес ждёт подтверждения, письмо придёт повторно.',
        }[mode]);
      }
    });
  }

  const actions = {
    select: id => run(() => loadWorkspaces(id), { refresh: true }),
    create: (name, requestId) => run(async () => {
      const [workspace] = await api('workspaces/create', { p_name: name, p_request_id: requestId });
      await loadWorkspaces(workspace.id);
      navigate('dashboard');
    }),
    rename: (name, previousName, requestId) => run(async () => {
      await api('cloud/command', { p_workspace: data.selected.id, p_actor: accountId,
        p_request: requestId, p_command: { type: 'rename_workspace', name, previousName } });
      await loadWorkspaces();
      setNote('Название предприятия сохранено.');
    }),
    invite: (email, role) => run(async () => {
      await api('invitations/create', { p_workspace_id: data.selected.id, p_email: email, p_role: role });
      await loadWorkspaces();
      setInviteLink(location.origin + '/');
      setNote('Передайте ссылку сотруднику. Приглашение появится после входа с указанной почтой.');
    }),
    accept: id => run(async () => {
      const workspaceId = await api('invitations/accept', { p_invitation_id: id });
      await loadWorkspaces(workspaceId);
      navigate('dashboard');
    }),
    revoke: id => run(async () => {
      await api('invitations/revoke', { p_workspace_id: data.selected.id, p_invitation_id: id });
      setInviteLink('');
      await loadWorkspaces();
    }),
  };

  const notices = <>
    {note && <p role="status" className="notice">{note}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </>;
  if (!data || !ready) return <AuthLayout soloUrl={config?.soloUrl}>
    {ready && config && !isDemo ? <AccountForm key={view} view={view} siteKey={config.turnstileSiteKey}
      busy={busy} note={note} error={error} onSubmit={submitAuth} onView={changeView} />
      : <div className="pb-auth-view">
        {!ready ? <p className="pb-auth-feedback" role="status">Проверяем сессию…</p> : <>
          <p className="pb-auth-feedback pb-auth-error" role="alert">{error}</p>
          <button className="pb-auth-primary" onClick={() => location.reload()}>Повторить подключение</button>
        </>}
      </div>}
  </AuthLayout>;

  const permissions = data.selected?.permissions ?? [];
  const enabled = sections.filter(section => {
    if (section === 'team' || section === 'settings') return true;
    if (!data.selected) return false;
    if (section === 'purchase') return permissions.includes('stock.read');
    if (section === 'sales') return permissions.some(permission => ['trade.sale', 'finance.history.read', 'analytics.company', 'analytics.self'].includes(permission));
    if (section === 'repairs') return permissions.includes('stock.read') || permissions.includes('finance.history.read');
    if (section === 'finance') return permissions.some(permission => ['finance.cash.read', 'finance.history.read', 'finance.deposit', 'analytics.company', 'analytics.self'].includes(permission)) ||
      permissions.includes('stock.read') && permissions.some(permission => ['analytics.categories', 'analytics.aging'].includes(permission));
    if (section === 'search') return permissions.includes('stock.read') || permissions.includes('finance.history.read');
    if (section === 'history') return permissions.includes('finance.history.read');
    return true;
  });
  const active = enabled.includes(route) ? route : data.selected ? 'dashboard' : 'team';
  const mayAdd = permissions.includes('stock.read') && permissions.includes('trade.purchase');
  const add = mayAdd ? () => { navigate('purchase'); setAddRequest(value => value + 1); } : undefined;
  return <AppShell route={active} navigate={navigate} mode="Team" identity={data.selected?.name ?? data.account.email}
    enabled={enabled} switchUrl={config.soloUrl} onAdd={add}
    tools={<>
      <ThemeToggle />
      {enabled.includes('search') && <button className="pb-icon-button" onClick={() => navigate('search')} aria-label="Глобальный поиск"><Search size={19} /></button>}
      <button className="pb-icon-button" onClick={() => navigate('team')} aria-label="Рабочие пространства"><UsersRound size={19} />
        {data.incoming.length > 0 && <span className="pb-invite-dot" />}
      </button>
      <button className="pb-icon-button" onClick={() => navigate('settings')} aria-label="Аккаунт"><Settings size={19} /></button>
    </>}>
    {isDemo && <DemoBanner />}
    {notices}
    {active === 'settings' && <>
      <PageTitle title="Настройки" />
      <div className="pb-panel" aria-label="Сессия">
        <h2>Аккаунт</h2>
        <p>{data.account.email}</p>
        {!isDemo && <div className="account-nav">
            <button className="secondary" disabled={busy} onClick={() => run(async () => {
              await api('auth/logout-others', {});
              setNote('Другие сессии завершены.');
            })}>Завершить другие сессии</button>
            <button className="secondary" disabled={busy} onClick={() => run(async () => {
              await api('auth/logout', {});
              clearCloudRequests();
              clearWorkspace();
              setView('login');
            })}>Выйти</button>
        </div>}
      </div>
    </>}
    {active === 'team' && <PageTitle title="Команда" description={data.selected?.name} />}
    <div hidden={active !== 'team'} className="pb-team-admin">
      {!isDemo && <Workspaces key={accountId} data={data} busy={busy} inviteLink={inviteLink} actions={actions} />}
      {data.selected && <TeamPanel key={'team:' + accountId + ':' + data.selected.id}
        workspace={data.selected} actor={accountId} api={api} onChanged={() => void loadWorkspaces().catch(() => {})} />}
    </div>
    {data.selected && <CloudWorkspace key={accountId + ':' + data.selected.id + ':' + data.selected.role}
      workspace={data.selected} actor={accountId} api={api} route={active} navigate={navigate}
      addRequest={addRequest} onAdd={add}
      onAccessChanged={() => void run(loadWorkspaces, { refresh: true, quiet: true })} />}
  </AppShell>;
}

initTheme();
createRoot(document.getElementById('root')).render(<TeamApp />);
