import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { before, test } from 'node:test';

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

function inPostgres(args, sql, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    assert.match(container, /^[a-f0-9]{12,64}$/);
    const child = spawn('docker', ['exec', '-i', container, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
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

function psql(sql, onOutput, database = 'phonebooks_ci') {
  return inPostgres(['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'phonebooks_ci', '-d', database], sql, onOutput);
}

function authenticate(user, session) {
  return `set local role authenticated;
select set_config('request.jwt.claims', ${quoted(JSON.stringify({ sub: user, session_id: session }))}, true);`;
}

function command(actor, id, fields, workspace = space) {
  return `select public.phonebooks_team_cloud_command(${quoted(workspace)},${quoted(actor)},${quoted(id)},${quoted(JSON.stringify(fields))});`;
}

before(async () => {
  if (!container) return;
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
});

test('native PostgreSQL serializes two independent sessions and replays only the winning sale', { skip: !container, timeout: 30_000 }, async () => {
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

const sampleSetup = `
create schema pilot_fixture;
grant usage on schema pilot_fixture to authenticated;
create function pilot_fixture.page_sample(workspace uuid,actor uuid,position jsonb,category text) returns jsonb
language plpgsql as $$
declare started timestamptz:=clock_timestamp(); result jsonb;
begin
  result:=public.phonebooks_team_cloud_page(workspace,actor,position);
  return jsonb_build_object('category',category,'ms',extract(epoch from clock_timestamp()-started)*1000,
    'bytes',octet_length(result::text),'rows',jsonb_array_length(result->'products')+jsonb_array_length(result->'categories')
      +jsonb_array_length(result->'accounts')+jsonb_array_length(result->'operations'));
end;
$$;
create function pilot_fixture.command_sample(workspace uuid,actor uuid,request_id uuid,input jsonb) returns jsonb
language plpgsql as $$
declare started timestamptz:=clock_timestamp();
begin
  perform public.phonebooks_team_cloud_command(workspace,actor,request_id,input);
  return jsonb_build_object('category',input->>'type','ms',extract(epoch from clock_timestamp()-started)*1000);
end;
$$;
create function pilot_fixture.full_scan(workspace uuid,actor uuid) returns jsonb
language plpgsql as $$
declare started timestamptz:=clock_timestamp(); pointer jsonb:='{"since":null}'; result jsonb; pages int:=0; items int:=0; bytes bigint:=0;
begin
  loop
    result:=public.phonebooks_team_cloud_page(workspace,actor,pointer);
    pages:=pages+1;
    items:=items+jsonb_array_length(result->'products');
    bytes:=bytes+octet_length(result::text);
    pointer:=result->'next';
    exit when pointer='null'::jsonb;
  end loop;
  return jsonb_build_object('category','bootstrap','ms',extract(epoch from clock_timestamp()-started)*1000,
    'bytes',bytes,'pages',pages,'items',items);
end;
$$;
`;

const account = 'ac_default_cash';
const timed = (identity, sql) => `begin;\n${authenticate(identity.member,identity.session)}\n${sql}\ncommit;\n`;

async function loadFixture(number, catalogue, opening = 10000000) {
  const workspace = randomUUID();
  const members = Array.from({ length: number }, () => ({ member: randomUUID(), session: randomUUID() }));
  const seed = await psql(`
insert into auth.users values ${members.map(({ member }) => `('${member}','${member}@phonebooks.test',now())`).join(',')};
insert into auth.sessions values ${members.map(({ member,session }) => `('${session}','${member}',null)`).join(',')};
insert into phonebooks_team_private.workspaces(id,name,created_by,creation_request_id,creation_name,cloud_revision)
  values ('${workspace}','Pilot load','${members[0].member}',gen_random_uuid(),'Pilot load',1);
insert into phonebooks_team_private.memberships(workspace_id,user_id,role)
  values ${members.map(({ member }, index) => `('${workspace}','${member}','${index?'manager':'owner'}')`).join(',')};
update phonebooks_team_private.inventory_accounts set opening_balance_minor=${opening} where workspace_id='${workspace}';
insert into phonebooks_team_private.inventory_products(workspace_id,id,category_id,name,tracking,cloud_revision)
  select '${workspace}','load:'||lpad(seq::text,6,'0'),'other','Load item '||seq,'quantity',1 from generate_series(1,${catalogue}) seq;
analyze phonebooks_team_private.inventory_products;
`);
  assert.equal(seed.code,0,seed.stderr);
  return { workspace,members };
}

function samples(result) {
  assert.equal(result.code,0,result.stderr);
  return result.stdout.split(/\r?\n/).filter(line => line.startsWith('PB '))
    .map(line => JSON.parse(line.slice(3)));
}

test('pilot load at 2, 5, 10 and 20 PostgreSQL sessions with bounded sync and mixed commands', { skip: !container, timeout: 120_000 }, async () => {
  const prepared = await psql(sampleSetup);
  assert.equal(prepared.code,0,prepared.stderr);
  for (const count of [2,5,10,20]) {
    const {workspace,members} = await loadFixture(count,2000);
    const all = await Promise.all(members.map(async identity => {
      const purchase = randomUUID();
      const productId = 'product:'+purchase;
      const commands = [
        [purchase,{type:'purchase',name:'Load phone',categoryId:'other',tracking:'unit',quantity:1,unitPriceMinor:100,accountId:account}],
        [randomUUID(),{type:'repair',productId,expectedVersion:2,amountMinor:25,accountId:account}],
        [randomUUID(),{type:'sale',productId,expectedVersion:3,quantity:1,unitPriceMinor:300,accountId:account}],
        [randomUUID(),{type:'expense',amountMinor:15,accountId:account}],
      ];
      const sample = (position,category) => timed(identity,`select 'PB '||pilot_fixture.page_sample('${workspace}','${identity.member}',${quoted(JSON.stringify(position))},'${category}');`);
      return samples(await psql(
        sample({since:'1',upper:'1'},'idle')+sample({since:null},'page')+
        commands.map(([id,input]) => timed(identity,`select 'PB '||pilot_fixture.command_sample('${workspace}','${identity.member}','${id}',${quoted(JSON.stringify(input))});`)).join('')+
        sample({since:'1'},'delta')
      ));
    }));
    const flat = all.flat();
    assert.equal(flat.length,count*7);
    assert.ok(flat.every(row => row.rows===undefined || row.rows<=100));
    const final = await psql(`
select sales_count||','||revenue_minor||','||cost_minor||','||expense_minor from phonebooks_team_private.inventory_totals('${workspace}');
select opening_balance_minor+delta_minor from phonebooks_team_private.inventory_accounts account
 join phonebooks_team_private.inventory_account_movements movement on movement.workspace_id=account.workspace_id and movement.account_id=account.id
 where account.workspace_id='${workspace}';
`);
    assert.equal(final.code,0,final.stderr);
    assert.deepEqual(final.stdout.trim().split(/\r?\n/),[`${count},${300*count},${125*count},${15*count}`,String(10000000+160*count)]);
    const measurements = Object.fromEntries([...new Set(flat.map(row => row.category))].map(category => {
      const rows = flat.filter(row => row.category===category).sort((a,b) => a.ms-b.ms);
      return [category,{ p95ms:Number(rows[Math.ceil(rows.length*0.95)-1].ms.toFixed(2)),
        maxBytes: Math.max(...rows.map(row => row.bytes ?? 0)) }];
    }));
    console.log('PILOT_LOAD '+JSON.stringify({users:count,measurements}));
  }
  const {workspace,members:[identity]} = await loadFixture(1,12000);
  const [scan] = samples(await psql(timed(identity,`select 'PB '||pilot_fixture.full_scan('${workspace}','${identity.member}');`)));
  assert.equal(scan.items,12000);
  assert.equal(scan.pages,121);
  console.log('PILOT_BOOTSTRAP '+JSON.stringify(scan));
});

test('conflicting purchases, repairs and expenses serialize without overdraft', { skip: !container, timeout: 30_000 }, async () => {
  const {workspace,members} = await loadFixture(2,0,300);
  const [leader] = members;
  const phone = randomUUID();
  const batch = randomUUID();
  const buy = (tracking,qty=1) => ({type:'purchase',name:'Fixture '+tracking,categoryId:'other',tracking,quantity:qty,unitPriceMinor:100,accountId:account});
  const prepared = await psql(timed(leader,command(leader.member,phone,buy('unit'),workspace)+command(leader.member,batch,buy('quantity'),workspace)));
  assert.equal(prepared.code,0,prepared.stderr);
  for (const input of [
    {type:'purchase',productId:'product:'+batch,expectedVersion:2,quantity:1,unitPriceMinor:0,accountId:account},
    {type:'repair',productId:'product:'+phone,expectedVersion:2,amountMinor:0,accountId:account},
    {type:'expense',amountMinor:70,accountId:account},
  ]) {
    const outcomes = await Promise.all(members.map(identity => psql(timed(identity,
      '\\set VERBOSITY verbose\n'+command(identity.member,randomUUID(),input,workspace)))));
    assert.equal(outcomes.filter(item => item.code===0).length,1);
    assert.match(outcomes.find(item => item.code!==0).stderr,/PT409/);
  }
  const final = await psql(`
select opening_balance_minor+delta_minor from phonebooks_team_private.inventory_accounts account
 join phonebooks_team_private.inventory_account_movements movement on movement.workspace_id=account.workspace_id and movement.account_id=account.id
 where account.workspace_id='${workspace}';
`);
  assert.equal(final.stdout.trim(),'30');
});

test('native dump and restore preserve business records, roles, grants and workspace totals', { skip: !container, timeout: 60_000 }, async () => {
  const output = '/tmp/phonebooks-pilot-fixture.dump';
  const dump = await inPostgres(['pg_dump','-Fc','-U','phonebooks_ci','-f',output,'phonebooks_ci'],'');
  assert.equal(dump.code,0,dump.stderr);
  const create = await psql('create database phonebooks_pilot_restore;');
  assert.equal(create.code,0,create.stderr);
  const restore = await inPostgres(['pg_restore','--exit-on-error','-U','phonebooks_ci','-d','phonebooks_pilot_restore',output],'');
  assert.equal(restore.code,0,restore.stderr);
  const verification = `
select count(*) from phonebooks_team_private.inventory_products;
select count(*),sum(revenue_minor),sum(cost_minor),sum(expense_minor) from phonebooks_team_private.inventory_operations;
select sum(amount_minor),count(*) from phonebooks_team_private.inventory_postings;
select count(*) from phonebooks_team_private.team_audit;
select count(*) from phonebooks_team_private.memberships;
${timed({member:employee,session:employeeSession},`select (public.phonebooks_team_cloud_page('${space}','${employee}','{"since":null}') -> 'accounts');`)}
`;
  const original = await psql(verification);
  const recovered = await psql(verification,undefined,'phonebooks_pilot_restore');
  assert.equal(original.code,0,original.stderr);
  assert.equal(recovered.code,0,recovered.stderr);
  assert.equal(recovered.stdout,original.stdout);
});
