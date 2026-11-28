import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { asUser as runAsUser, seedSession, seedUser as insertUser, teamDatabase } from './support/team-database.js';
import { crossModeUrl } from '../src/utils/modeUrl.js';
import worker from '../server/team-worker.js';

test('Team email actions use the Team origin on a shared Auth project', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(new URL(url));
    return Response.json({});
  });

  const origin = 'https://team.phonebooks.test';
  const env = { SUPABASE_URL: 'https://auth.phonebooks.test', SUPABASE_PUBLISHABLE_KEY: 'test-key' };
  for (const action of ['register', 'resend', 'recover']) {
    const response = await worker.fetch(new Request(origin + '/api/auth/' + action, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'team@phonebooks.test', password: 'a-fixture-password', redirect_to: 'https://other.test/' }),
    }), env);
    assert.equal(response.status, 200);
  }
  assert.deepEqual(requests.map(({ pathname }) => pathname), ['/auth/v1/signup', '/auth/v1/resend', '/auth/v1/recover']);
  assert.deepEqual(requests.map(url => url.searchParams.get('redirect_to')), Array(3).fill(origin + '/'));
});

let db;

before(async () => { db = await teamDatabase(); });

after(() => db?.close());

async function seedUser({ confirmed = true, expired = false, email = randomUUID() + '@phonebooks.test' } = {}) {
  return seedSession(db, await insertUser(db, email, confirmed), expired);
}

function asUser(claims, statement, args = [], role = 'authenticated') {
  return runAsUser(db, claims, statement, args, role);
}

const list = claims => asUser(claims, 'select * from public.phonebooks_team_workspaces()');
async function create(claims, name, requestId = randomUUID()) {
  const [workspace] = await asUser(claims, 'select * from public.phonebooks_team_create_workspace($1, $2)', [name, requestId]);
  return workspace;
}

test('workspace creation assigns the confirmed caller as owner and supports multiple memberships', async () => {
  const owner = await seedUser();
  const employee = await seedUser();
  assert.deepEqual(await list(owner), []);

  const first = await create(owner, '\t Магазин \n');
  const second = await create(owner, 'Склад');
  const unrelated = await create(employee, 'Другая компания');
  assert.equal(first.name, 'Магазин');
  assert.equal(first.role, 'owner');
  assert.notEqual(first.id, second.id);
  assert.deepEqual(new Set((await list(owner)).map(item => item.id)), new Set([first.id, second.id]));
  assert.deepEqual(await list(employee), [unrelated]);

  await db.query(`insert into phonebooks_team_private.memberships (workspace_id, user_id, role)
    values ($1, $2, 'employee')`, [first.id, employee.sub]);
  assert.deepEqual((await list(employee)).find(item => item.id === first.id), { ...first, role: 'employee' });
  await db.query('update phonebooks_team_private.memberships set revoked_at = now() where workspace_id = $1 and user_id = $2', [first.id, employee.sub]);
  assert.deepEqual(await list(employee), [unrelated]);
  const { rows } = await db.query('select revoked_at from phonebooks_team_private.memberships where workspace_id = $1 and user_id = $2', [first.id, employee.sub]);
  assert.ok(rows[0].revoked_at);
});

test('creation retries reuse the workspace and changed arguments conflict', async () => {
  const owner = await seedUser();
  const other = await seedUser();
  const requestId = randomUUID();
  const workspace = await create(owner, 'Магазин', requestId);
  assert.deepEqual(await create(owner, ' Магазин ', requestId), workspace);
  await assert.rejects(create(owner, 'Магазин 2', requestId), { code: 'PT409' });
  assert.notEqual((await create(other, 'Магазин', requestId)).id, workspace.id);
  assert.deepEqual(await list(owner), [workspace]);
});

test('workspace creation rejects invalid inputs without leaving a workspace or membership', async () => {
  const owner = await seedUser();
  for (const name of [null, '', ' \r\n', 'a'.repeat(101), 'a\tb']) {
    await assert.rejects(create(owner, name), { code: 'PT400' });
  }
  await assert.rejects(create(owner, 'Магазин', null), { code: 'PT400' });
  assert.deepEqual(await list(owner), []);
  const { rows } = await db.query('select id from phonebooks_team_private.workspaces where created_by = $1', [owner.sub]);
  assert.deepEqual(rows, []);
});

test('expired, revoked and mismatched sessions cannot read or create workspaces', async () => {
  const owner = await seedUser();
  const expired = await seedUser({ expired: true });
  const unrelated = await seedUser();
  await create(owner, 'Магазин');
  await db.query('delete from auth.sessions where id = $1', [owner.session_id]);
  for (const claims of [{}, expired, owner, { ...unrelated, sub: owner.sub }]) {
    await assert.rejects(list(claims), { code: 'PT401' });
    await assert.rejects(create(claims, 'Склад'), { code: 'PT401' });
  }
});

test('unconfirmed accounts and anonymous callers cannot use workspace RPCs', async () => {
  const pending = await seedUser({ confirmed: false });
  await assert.rejects(list(pending), { code: 'PT403' });
  await assert.rejects(create(pending, 'Магазин'), { code: 'PT403' });
  await assert.rejects(asUser({}, 'select * from public.phonebooks_team_workspaces()', [], 'anon'), { code: '42501' });
  await assert.rejects(asUser({}, 'select * from public.phonebooks_team_create_workspace($1, $2)', ['Склад', randomUUID()], 'anon'), { code: '42501' });
});

test('authenticated members cannot read or modify private tables through direct queries', async () => {
  const owner = await seedUser();
  await create(owner, 'Магазин');
  await assert.rejects(asUser(owner, 'select * from phonebooks_team_private.workspaces'), { code: '42501' });
  await assert.rejects(asUser(owner, "update phonebooks_team_private.memberships set role = 'owner'"), { code: '42501' });
});

async function invitationCommand(claims, name, args) {
  const parameters = args.map((_, index) => '$' + (index + 1)).join(', ');
  const [row] = await asUser(claims, 'select public.phonebooks_team_' + name + '(' + parameters + ') as result', args);
  return row.result;
}
const invite = (claims, workspaceId, email, role = 'employee') =>
  invitationCommand(claims, 'create_invitation', [workspaceId, email, role]);
const accept = (claims, id) => invitationCommand(claims, 'accept_invitation', [id]);
const revoke = (claims, workspaceId, id) => invitationCommand(claims, 'revoke_invitation', [workspaceId, id]);
const overview = (claims, preferred = null) => invitationCommand(claims, 'overview', [preferred]);

test('an invitation can only be seen and accepted by the confirmed email on it', async () => {
  const owner = await seedUser();
  const employee = await seedUser({ email: 'linked@phonebooks.test' });
  const unrelated = await seedUser();
  const pending = await seedUser({ email: 'pending@phonebooks.test', confirmed: false });
  const workspace = await create(owner, 'Приглашения');
  const invitation = await invite(owner, workspace.id, ' Linked@PhoneBooks.test ');

  assert.equal(await invite(owner, workspace.id, 'linked@phonebooks.test'), invitation);
  await assert.rejects(invite(owner, workspace.id, 'linked@phonebooks.test', 'manager'), { code: 'PT409' });
  await assert.rejects(invite(owner, workspace.id, 'noaddress', 'manager'), { code: 'PT400' });
  await assert.rejects(invite(owner, workspace.id, 'test@phonebooks.test', 'owner'), { code: 'PT400' });
  await invite(owner, workspace.id, 'pending@phonebooks.test');
  await assert.rejects(overview(pending), { code: 'PT403' });
  assert.deepEqual((await overview(unrelated, workspace.id)).incoming, []);
  assert.equal((await overview(unrelated, workspace.id)).selected, null);
  await assert.rejects(accept(unrelated, invitation), { code: 'PT404' });
  await assert.rejects(revoke(unrelated, workspace.id, invitation), { code: 'PT403' });
  assert.equal((await overview(employee)).incoming[0].id, invitation);
  await assert.rejects(asUser(employee, 'select * from phonebooks_team_private.invitations'), { code: '42501' });

  assert.equal(await accept(employee, invitation), workspace.id);
  assert.equal(await accept(employee, invitation), workspace.id);
  const employeeView = await overview(employee, workspace.id);
  assert.equal(employeeView.selected.role, 'employee');
  assert.deepEqual(employeeView.incoming, []);
  assert.deepEqual(employeeView.outgoing, []);
  await assert.rejects(invite(employee, workspace.id, 'another@phonebooks.test'), { code: 'PT403' });
  assert.equal((await overview(owner)).outgoing.find(item => item.id === invitation).status, 'accepted');
});

test('expired and revoked invitations cannot join a workspace', async () => {
  const owner = await seedUser();
  const employee = await seedUser({ email: 'expiry@phonebooks.test' });
  const workspace = await create(owner, 'Ограничение срока');
  const another = await create(owner, 'Другое рабочее пространство');
  const expired = await invite(owner, workspace.id, 'expiry@phonebooks.test');
  await db.query("update phonebooks_team_private.invitations set expires_at = now() - interval '1 second' where id = $1", [expired]);
  const revoked = await invite(owner, workspace.id, 'expiry@phonebooks.test');
  assert.notEqual(revoked, expired);
  await assert.rejects(revoke(owner, another.id, revoked), { code: 'PT404' });
  assert.equal(await revoke(owner, workspace.id, revoked), true);
  assert.equal(await revoke(owner, workspace.id, revoked), true);
  for (const id of [expired, revoked]) await assert.rejects(accept(employee, id), { code: 'PT409' });
  assert.deepEqual((await overview(employee)).workspaces, []);
  assert.deepEqual((await overview(employee)).incoming, []);
  assert.deepEqual(new Set((await overview(owner, workspace.id)).outgoing.map(item => item.status)), new Set(['expired', 'revoked']));
});

test('mode links require a different hostname and only allow HTTP for local testing', () => {
  const origin = 'https://team.phonebooks.test';
  assert.equal(crossModeUrl('https://solo.phonebooks.test/#/settings', origin), 'https://solo.phonebooks.test/#/settings');
  assert.equal(crossModeUrl('https://team.phonebooks.test:9443', origin), '');
  assert.equal(crossModeUrl('http://solo.phonebooks.test', origin), '');
  assert.equal(crossModeUrl('http://localhost:8080', origin), 'http://localhost:8080/');
  assert.equal(crossModeUrl('javascript:alert(1)', origin), '');
  assert.equal(crossModeUrl('https://user:pass@solo.phonebooks.test', origin), '');
});
