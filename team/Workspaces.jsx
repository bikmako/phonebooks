import React from 'react';

const roleLabel = { owner: 'Владелец', manager: 'Управляющий', employee: 'Сотрудник' };
const inviteStatus = { pending: 'Ожидает', expired: 'Истекло', accepted: 'Принято', revoked: 'Отозвано' };
const dateFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' });

export function Workspaces({ data, busy, inviteLink, actions }) {
  const { workspaces, selected, incoming, outgoing } = data;
  const creationRequest = React.useRef(null);

  function formAction(event, action) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void action(values).then(success => { if (success) form.reset(); });
  }

  return (
    <>
      <section aria-labelledby="workspace-title">
        <h2 id="workspace-title">Рабочие пространства</h2>
        {workspaces.length > 0 && <label>Выбрать пространство
          <select value={selected?.id ?? ''} disabled={busy} onChange={event => actions.select(event.target.value)}>
            <option value="" disabled>Выберите пространство</option>
            {workspaces.map(workspace => <option value={workspace.id} key={workspace.id}>
              {workspace.name} · {roleLabel[workspace.role]}
            </option>)}
          </select>
        </label>}
        {workspaces.length === 0 && <p>Создайте пространство или примите приглашение от владельца.</p>}
        <form onSubmit={event => formAction(event, async values => {
          const name = values.get('name').trim();
          if (creationRequest.current?.name !== name) creationRequest.current = { name, id: crypto.randomUUID() };
          const success = await actions.create(name, creationRequest.current.id);
          if (success) creationRequest.current = null;
          return success;
        })}>
          <label>Название нового пространства<input name="name" maxLength={100} required /></label>
          <button disabled={busy}>Создать пространство</button>
        </form>
      </section>
      {incoming.length > 0 && <section aria-labelledby="incoming-title">
        <h2 id="incoming-title">Входящие приглашения</h2>
        <ul>{incoming.map(invite => <li key={invite.id}>
          <div><strong>{invite.workspace_name}</strong><br />{roleLabel[invite.role]} · до {dateFormat.format(new Date(invite.expires_at))}</div>
          <button disabled={busy} onClick={() => actions.accept(invite.id)}>Принять приглашение</button>
        </li>)}</ul>
      </section>}
      {selected && <section aria-labelledby="selected-title">
        <h2 id="selected-title">{selected.name}</h2>
        <p>Ваша роль — {roleLabel[selected.role]}.</p>
        {selected.role === 'owner' && <>
          <h3>Приглашения сотрудников</h3>
          <form onSubmit={event => formAction(event, values => actions.invite(values.get('email'), values.get('role')))}>
            <label>Почта сотрудника<input name="email" type="email" maxLength={254} required /></label>
            <label>Роль<select name="role"><option value="employee">Сотрудник</option><option value="manager">Управляющий</option></select></label>
            <button disabled={busy}>Создать приглашение</button>
          </form>
          {inviteLink && <label>Ссылка для сотрудника
            <input readOnly value={inviteLink} onFocus={event => event.target.select()} />
          </label>}
          <ul>{outgoing.map(invite => <li key={invite.id}>
            <div><strong>{invite.email}</strong><br />{roleLabel[invite.role]} · {inviteStatus[invite.status]} · до {dateFormat.format(new Date(invite.expires_at))}</div>
            {invite.status === 'pending' && <button className="secondary" disabled={busy} onClick={() => actions.revoke(invite.id)}>Отозвать</button>}
          </li>)}</ul>
        </>}
      </section>}
    </>
  );
}
