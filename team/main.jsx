import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountForm } from './AccountForm.jsx';
import { Workspaces } from './Workspaces.jsx';
import './styles.css';

const callbackUrl = new URL(location.href);
const callbackView = callbackUrl.searchParams.get('view');
const callbackToken = ['confirm', 'reset'].includes(callbackView) ? callbackUrl.hash.slice(1) : '';
if (callbackView) history.replaceState(null, '', location.pathname);

async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => { throw new Error('Нет соединения с PhoneBooks Team. Попробуйте ещё раз.'); });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
  return data;
}

function TeamApp() {
  const [config, setConfig] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [view, setView] = useState(callbackToken ? callbackView : 'login');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const working = useRef(false);
  const selectedId = useRef('');

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
      if (refresh || failure.status === 401) {
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
    }),
    revoke: id => run(async () => {
      await api('invitations/revoke', { p_workspace_id: data.selected.id, p_invitation_id: id });
      setInviteLink('');
      await loadWorkspaces();
    }),
  };

  return (
    <main>
      <header>
        <h1>PhoneBooks Team</h1>
        {config?.soloUrl && <a href={config.soloUrl} rel="noreferrer">Перейти в Solo</a>}
      </header>
      {note && <p role="status" className="notice">{note}</p>}
      {error && <p role="alert" className="notice error">{error}</p>}
      {!ready && <p role="status">Проверяем сессию…</p>}
      {ready && !config && <button onClick={() => location.reload()}>Повторить подключение</button>}
      {ready && config && (data ? <>
        <section aria-label="Сессия">
          <p>{data.account.email}</p>
          <div className="account-nav">
            <button className="secondary" disabled={busy} onClick={() => run(async () => {
              await api('auth/logout-others', {});
              setNote('Другие сессии завершены.');
            })}>Завершить другие сессии</button>
            <button className="secondary" disabled={busy} onClick={() => run(async () => {
              await api('auth/logout', {});
              clearWorkspace();
              setView('login');
            })}>Выйти</button>
          </div>
        </section>
        <Workspaces key={accountId} data={data} busy={busy} inviteLink={inviteLink} actions={actions} />
      </> : <AccountForm key={view} view={view} siteKey={config.turnstileSiteKey} busy={busy} onSubmit={submitAuth} onView={changeView} />)}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<TeamApp />);
