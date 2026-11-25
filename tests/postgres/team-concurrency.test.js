import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const container = process.env.PHONEBOOKS_TEST_POSTGRES_CONTAINER;
const owner = '00000000-0000-4000-8000-000000000001';
const employee = '00000000-0000-4000-8000-000000000002';
const ownerSession = '00000000-0000-4000-9000-000000000001';
const employeeSession = '00000000-0000-4000-9000-000000000002';
const space = '00000000-0000-4000-a000-000000000001';
const depositId = '00000000-0000-4000-b000-000000000001';
const purchaseId = '00000000-0000-4000-b000-000000000002';
const firstSale = '00000000-0000-4000-b000-000000000003';
const secondSale = '00000000-0000-4000-b000-000000000004';
const quoted = value => "'" + String(value).replaceAll("'", "''") + "'";

function psql(sql, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    assert.match(container, /^[a-f0-9]{12,64}$/);
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
      '-U', 'phonebooks_ci', '-d', 'phonebooks_ci'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; onOutput(stdout); });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(sql);
  });
}

function authenticate(user, session) {
  return `set local role authenticated;
select set_config('request.jwt.claims', ${quoted(JSON.stringify({ sub: user, session_id: session }))}, true);`;
}

function command(actor, id, fields) {
  return `select public.phonebooks_team_cloud_command(${quoted(space)},${quoted(actor)},${quoted(id)},${quoted(JSON.stringify(fields))});`;
}

test('native PostgreSQL serializes two independent sessions and replays only the winning sale', { skip: !container, timeout: 30_000 }, async () => {
  const root = new URL('../../supabase/migrations/', import.meta.url);
  const migrations = await Promise.all((await readdir(root)).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFile(new URL(name, root), 'utf8')));
  const setup = await psql(`
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key, email text not null unique, email_confirmed_at timestamptz);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users, not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
${migrations.join('\n')}
insert into auth.users values ('${owner}','owner@phonebooks.test',now()), ('${employee}','employee@phonebooks.test',now());
insert into auth.sessions values ('${ownerSession}','${owner}',null), ('${employeeSession}','${employee}',null);
insert into phonebooks_team_private.workspaces(id,name,created_by,creation_request_id,creation_name)
  values ('${space}','Тест','${owner}',gen_random_uuid(),'Тест');
insert into phonebooks_team_private.memberships (workspace_id,user_id,role)
  values ('${space}','${owner}','owner'), ('${space}','${employee}','employee');
begin;
${authenticate(owner, ownerSession)}
${command(owner, depositId, { type: 'deposit', amountMinor: 1000, accountId: 'ac_default_cash' })}
${command(owner, purchaseId, { type: 'purchase', name: 'Товар', categoryId: 'other', tracking: 'unit',
    quantity: 1, unitPriceMinor: 100, accountId: 'ac_default_cash' })}
commit;
`);
  assert.equal(setup.code, 0, setup.stderr);
  const sale = { type: 'sale', productId: 'product:' + purchaseId, expectedVersion: 2,
    quantity: 1, unitPriceMinor: 300, accountId: 'ac_default_cash' };
  let notify;
  const acquired = new Promise(resolve => { notify = resolve; });
  const first = psql(`begin;
${authenticate(owner, ownerSession)}
${command(owner, firstSale, sale)}
\\echo phonebooks-first-locked
select pg_sleep(2);
commit;
`, stdout => { if (stdout.includes('phonebooks-first-locked')) notify(); });
  await Promise.race([acquired, first.then(result => assert.fail(result.stderr || 'Transaction ended before taking the lock'))]);
  const second = await psql(`begin;
\\set VERBOSITY verbose
${authenticate(employee, employeeSession)}
${command(employee, secondSale, sale)}
commit;
`);
  assert.equal((await first).code, 0);
  assert.notEqual(second.code, 0);
  assert.match(second.stderr, /PT409/);
  const replay = await psql(`begin;
${authenticate(owner, ownerSession)}
${command(owner, firstSale, sale)}
commit;
select quantity from phonebooks_team_private.inventory_products where workspace_id='${space}';
select sales_count from phonebooks_team_private.inventory_totals('${space}');
select delta_minor from phonebooks_team_private.inventory_account_movements where workspace_id='${space}';
`);
  assert.equal(replay.code, 0, replay.stderr);
  assert.deepEqual(replay.stdout.trim().split(/\r?\n/).slice(-3), ['0', '1', '1200']);
});
