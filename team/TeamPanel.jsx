import React, { useEffect, useRef, useState } from 'react';
import { formatMinor as money } from './CloudReports.jsx';

const groups = ['Склад', 'Торговые операции', 'Ремонт', 'Финансы', 'Аналитика', 'Данные', 'Управление командой'];
const actions = {
  reservation: 'Бронирование', customer_return: 'Возврат покупателя', supplier_return: 'Возврат поставщику',
  'workspace.rename': 'Изменение названия предприятия', 'category.save': 'Изменение категории', purchase: 'Закупка', sale: 'Продажа', repair: 'Завершение ремонта', repair_start: 'Передача в ремонт', expense: 'Расход', deposit: 'Пополнение кассы',
  stock_adjustment: 'Корректировка остатка', 'product.edit': 'Редактирование товара', 'role.create': 'Создание роли',
  'role.edit': 'Изменение роли', 'role.archive': 'Архивирование роли', 'member.role': 'Назначение роли',
  'member.permission': 'Изменение индивидуального права', 'member.revoke': 'Отзыв доступа',
  'member.restore': 'Восстановление доступа', 'invite.create': 'Создание приглашения',
  'invite.revoke': 'Отзыв приглашения', 'invite.accept': 'Принятие приглашения', 'solo.import': 'Перенос Solo',
};
const metrics = {
  returns: 'Возвраты и компенсации', reservations: 'Созданные бронирования', purchases: 'Закупки', purchaseMinor: 'Сумма закупок', sales: 'Продажи', revenueMinor: 'Выручка',
  grossMinor: 'Валовая прибыль', netMinor: 'Чистая прибыль предприятия', expenses: 'Расходные операции',
  expensesMinor: 'Сумма расходов', repairs: 'Ремонты', cashMinor: 'Текущая касса', stockMinor: 'Текущая стоимость склада',
};
const initialFilter = { member: '', from: '', to: '', kind: '' };
const parameters = filter => ({ p_member: filter.member || null, p_from: filter.from || null, p_to: filter.to || null });

function RoleEditor({ role, catalog, apply, busy }) {
  const [name, setName] = useState(role?.name ?? '');
  const [grants, setGrants] = useState(role?.grants ?? []);
  const canArchive = role?.id.startsWith('custom:') && !role.archived;
  return <form onSubmit={event => {
    event.preventDefault();
    void apply('save_role', {
      roleId: role?.id ?? 'custom:' + crypto.randomUUID(), revision: role?.revision ?? 0, name, grants,
    }).then(saved => { if (saved && !role) { setName(''); setGrants([]); } });
  }}>
    <label>Название роли<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={busy} /></label>
    {groups.map(group => {
      const entries = catalog.filter(permission => permission.section === group);
      if (!entries.length) return null;
      const all = entries.every(permission => grants.includes(permission.id));
      return <fieldset key={group} disabled={busy}>
        <legend>{group}</legend>
        <button type="button" className="secondary" onClick={() => {
          const ids = entries.map(permission => permission.id);
          setGrants(all ? grants.filter(id => !ids.includes(id)) : [...new Set([...grants, ...ids])]);
        }}>{all ? 'Снять все' : 'Выбрать все'}</button>
        {entries.map(permission => <label className="permission-line" key={permission.id}>
          <input type="checkbox" checked={grants.includes(permission.id)} onChange={event => {
            setGrants(event.target.checked ? [...grants, permission.id] : grants.filter(id => id !== permission.id));
          }} />{permission.label}
        </label>)}
      </fieldset>;
    })}
    <div className="account-nav">
      <button disabled={busy}>{role ? 'Сохранить роль' : 'Создать роль'}</button>
      {canArchive && <button type="button" className="secondary" disabled={busy}
        onClick={() => apply('archive_role', { roleId: role.id, revision: role.revision })}>Архивировать роль</button>}
    </div>
  </form>;
}

function MemberEditor({ member, roles, catalog, owner, delegated, actor, apply, busy }) {
  const [roleId, setRoleId] = useState(member.roleId);
  const [rules, setRules] = useState(member.overrides ?? {});
  const [confirm, setConfirm] = useState(false);
  const assigned = roles.find(role => role.id === roleId);
  const editable = owner && member.roleId !== 'owner' && member.id !== actor;
  return <details>
    <summary>{member.email} · {member.roleName}{member.revoked ? ' · доступ отозван' : ''}</summary>
    <p>Дата вступления {new Date(member.joinedAt).toLocaleDateString('ru')}</p>
    {editable && <form onSubmit={event => {
      event.preventDefault();
      void apply('set_member', { userId: member.id, revision: member.revision, roleId, overrides: rules });
    }}>
      <label>Назначенная роль<select value={roleId} onChange={event => setRoleId(event.target.value)} disabled={busy}>
        {roles.filter(role => !role.archived).map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
      </select></label>
      <details>
        <summary>Индивидуальные разрешения</summary>
        <button type="button" className="secondary" onClick={() => setRules({})} disabled={busy}>Вернуть все к настройкам роли</button>
        {groups.map(group => <fieldset key={group} disabled={busy}>
          <legend>{group}</legend>
          {catalog.filter(permission => permission.section === group).map(permission => <label key={permission.id}>
            {permission.label}<select aria-label={permission.label} value={Object.hasOwn(rules, permission.id) ? String(rules[permission.id]) : ''}
              onChange={event => {
                const next = { ...rules };
                if (event.target.value === '') delete next[permission.id];
                else next[permission.id] = event.target.value === 'true';
                setRules(next);
              }}>
              <option value="">По роли · {assigned?.grants?.includes(permission.id) ? 'разрешено' : 'запрещено'}</option>
              <option value="true">Разрешить индивидуально</option>
              <option value="false">Запретить индивидуально</option>
            </select>
          </label>)}
        </fieldset>)}
      </details>
      <button disabled={busy}>Сохранить доступ сотрудника</button>
    </form>}
    {(editable || (delegated && member.roleId !== 'owner' && member.id !== actor)) &&
      <div className="account-nav">
        <button type="button" className="secondary" disabled={busy} onClick={() => {
          if (member.revoked || confirm) void apply(member.revoked ? 'restore_member' : 'revoke_member',
            { userId: member.id, revision: member.revision }).then(() => setConfirm(false));
          else setConfirm(true);
        }}>{member.revoked ? 'Восстановить доступ' : confirm ? 'Подтвердить отзыв доступа' : 'Отозвать доступ'}</button>
        {confirm && <button type="button" className="secondary" onClick={() => setConfirm(false)}>Отмена</button>}
      </div>}
  </details>;
}

function DateFields({ filter, update }) {
  return <div className="group-fields">
    <label>С даты<input type="date" value={filter.from} onChange={event => update({ ...filter, from: event.target.value })} /></label>
    <label>По дату<input type="date" value={filter.to} onChange={event => update({ ...filter, to: event.target.value })} /></label>
  </div>;
}

function AuditDetails({ event, names }) {
  const labelKeys = { status: 'Статус', productId: 'Товар', name: 'Название', role: 'Роль', revoked: 'Доступ отозван',
    permission: 'Разрешение', allowed: 'Разрешено', grants: 'Права', category: 'Категория', tracking: 'Тип учёта', amountMinor: 'Сумма' };
  function values(changes) {
    return Object.entries(changes ?? {}).filter(([, value]) => value !== null).map(([key, value]) =>
      <div key={key}>{labelKeys[key] ?? key} · {key === 'amountMinor' ? money(value) : Array.isArray(value) ? value.join(', ') : String(value)}</div>);
  }
  return <details>
    <summary>{actions[event.kind] ?? event.kind} · {names.get(event.actorId) ?? 'Участник'} · {new Date(event.recordedAt).toLocaleString('ru')}</summary>
    {event.targetId && <p>Запись {event.targetId}</p>}
    {event.previous && <div><strong>До изменения</strong>{values(event.previous)}</div>}
    {event.current && <div><strong>После изменения</strong>{values(event.current)}</div>}
  </details>;
}

export function TeamPanel({ workspace, actor, api, onChanged }) {
  const scope = { p_workspace: workspace.id, p_actor: actor };
  const [data, setData] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [openRole, setOpenRole] = useState('');
  const [statsFilter, setStatsFilter] = useState(initialFilter);
  const [auditFilter, setAuditFilter] = useState(initialFilter);
  const [stats, setStats] = useState(null);
  const [audit, setAudit] = useState(null);
  const signature = useRef('');
  const refreshSequence = useRef(0);
  const mounted = useRef(false);

  function clearReports() { setStats(null); setAudit(null); }
  async function load() {
    const sequence = ++refreshSequence.current;
    try {
      const next = await api('team/members', scope);
      if (!mounted.current || sequence !== refreshSequence.current || !navigator.onLine) return;
      const access = next.permissions.join(',');
      if (signature.current !== access) clearReports();
      signature.current = access;
      setData(next);
      setOnline(true);
    } catch (failure) {
      if (!mounted.current || sequence !== refreshSequence.current) return;
      signature.current = '';
      clearReports();
      setData(null);
      setOnline(false);
      if (failure.status === 401 || failure.status === 403) setError('Доступ к команде завершён.');
    }
  }
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { if (navigator.onLine) void load(); };
    const lost = () => { refreshSequence.current++; signature.current = ''; setOnline(false); clearReports(); setData(null); };
    addEventListener('online', refresh);
    addEventListener('offline', lost);
    const timer = setInterval(refresh, 5000);
    refresh();
    return () => {
      mounted.current = false;
      clearInterval(timer);
      removeEventListener('online', refresh);
      removeEventListener('offline', lost);
    };
  }, []);

  async function action(request) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setStatus('');
    try { await request(); return true; }
    catch (failure) {
      if (failure.status === 401 || failure.status === 403) await load();
      setError(failure.status === 409 ? 'Данные изменились или роль используется. Обновите список и проверьте назначения.' : failure.message);
      return false;
    } finally { setBusy(false); }
  }
  const apply = (name, payload) => action(async () => {
    await api('team/manage', { ...scope, p_action: name, p_input: payload });
    await load();
    onChanged();
    setStatus('Настройки команды сохранены.');
  });
  const may = permission => data?.permissions.includes(permission);
  const names = new Map(data?.members.map(member => [member.id, member.email]) ?? []);
  const canCompany = may('analytics.company');
  const canSelf = may('analytics.self');
  const canOthers = may('analytics.others') && may('team.members.read');
  const statsOptions = [
    ...(canCompany ? [{ id: '', label: 'Все сотрудники' }] : []),
    ...(canSelf ? [{ id: actor, label: 'Моя статистика' }] : []),
    ...(canOthers ? data.members.filter(member => member.id !== actor).map(member => ({ id: member.id, label: member.email })) : []),
  ];
  const reportMember = statsOptions.some(option => option.id === statsFilter.member)
    ? statsFilter.member : (statsOptions[0]?.id ?? '');
  async function report(kind, filter, offset = 0) {
    const access = signature.current;
    const query = { ...scope, ...parameters(filter) };
    if (kind === 'audit') Object.assign(query, { p_kind: filter.kind || null, p_offset: offset });
    const result = await api('team/' + kind, query);
    if (!mounted.current || signature.current !== access) return;
    if (kind === 'stats') setStats(result);
    else setAudit({ rows: offset ? [...(audit?.rows ?? []), ...result] : result, more: result.length === 50, filter });
  }
  if (!data) return error ? <p role="alert">{error}</p> : null;
  return <section aria-labelledby="team-panel-heading">
    <h2 id="team-panel-heading">Команда</h2>
    <p>Участников в списке {data.members.length}</p>
    {status && <p className="notice" aria-live="polite">{status}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {data.members.map(member => <MemberEditor key={member.id + ':' + member.revision} member={member} roles={data.roles}
      catalog={data.catalog} owner={data.owner} delegated={may('team.members.manage')} actor={actor} apply={apply} busy={busy || !online} />)}
    {data.owner && <details>
      <summary>Роли и права доступа</summary>
      <label>Настройка роли<select value={openRole} onChange={event => setOpenRole(event.target.value)}>
        <option value="">Новая роль</option>
        {data.roles.filter(role => !role.archived).map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
      </select></label>
      {(() => {
        const role = data.roles.find(item => item.id === openRole && !item.archived);
        return <RoleEditor key={role ? role.id + ':' + role.revision : 'new'} role={role} catalog={data.catalog} apply={apply} busy={busy || !online} />;
      })()}
    </details>}
    {statsOptions.length > 0 && <details>
      <summary>Статистика сотрудников</summary>
      <form onSubmit={event => {
        event.preventDefault();
        void action(() => report('stats', { ...statsFilter, member: reportMember }));
      }}>
        <label>Сотрудник для отчёта<select value={reportMember}
          onChange={event => { setStats(null); setStatsFilter({ ...statsFilter, member: event.target.value }); }}>
          {statsOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label>
        <DateFields filter={statsFilter} update={filter => { setStats(null); setStatsFilter(filter); }} />
        <button disabled={busy || !online}>Показать статистику</button>
      </form>
      {stats && <dl className="metric-list">{Object.entries(metrics).filter(([key]) => Object.hasOwn(stats, key)).map(([key,label]) =>
        <div key={key}><dt>{label}</dt><dd>{key.endsWith('Minor') ? money(stats[key]) : stats[key]}</dd></div>)}</dl>}
    </details>}
    {may('team.audit.read') && <details>
      <summary>Журнал действий</summary>
      <form onSubmit={event => { event.preventDefault(); void action(() => report('audit', auditFilter)); }}>
        <label>Автор действия<select value={auditFilter.member} onChange={event => setAuditFilter({ ...auditFilter, member: event.target.value })}>
          <option value="">Все участники</option>
          {data.members.map(member => <option key={member.id} value={member.id}>{member.email}</option>)}
        </select></label>
        <label>Тип действия<select value={auditFilter.kind} onChange={event => setAuditFilter({ ...auditFilter, kind: event.target.value })}>
          <option value="">Все действия</option>
          {Object.entries(actions).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <DateFields filter={auditFilter} update={setAuditFilter} />
        <button disabled={busy || !online}>Показать журнал</button>
      </form>
      {audit?.rows.map(event => <AuditDetails key={event.id} event={event} names={names} />)}
      {audit?.rows.length === 0 && <p>Действий за выбранный период нет.</p>}
      {audit?.more && <button className="secondary" disabled={busy || !online}
        onClick={() => action(() => report('audit', audit.filter, audit.rows.length))}>Показать ещё</button>}
    </details>}
  </section>;
}
