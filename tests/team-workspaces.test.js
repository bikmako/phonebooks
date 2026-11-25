import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = new URL('../supabase/migrations/202611250001_phonebooks_team_workspaces.sql', import.meta.url);
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
    create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users, not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
  `);
  await db.exec(await readFile(migration, 'utf8'));
});

after(() => db?.close());

async function seedUser({ confirmed = true, expired = false } = {}) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await db.query('insert into auth.users values ($1, case when $2 then now() end)', [userId, confirmed]);
  await db.query('insert into auth.sessions values ($1, $2, case when $3 then now() - interval \'1 minute\' end)', [sessionId, userId, expired]);
  return { sub: userId, session_id: sessionId };
}

function asUser(claims, statement, args = [], role = 'authenticated') {
  return db.transaction(async tx => {
    await tx.exec(role === 'anon' ? 'set local role anon' : 'set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return (await tx.query(statement, args)).rows;
  });
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
