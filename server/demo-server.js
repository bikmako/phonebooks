import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { cloudRoute, readBody, teamRoute } from './team-worker.js';
import { nodeHandler } from './node-http.js';
import { asUser, seedSession, seedUser, teamDatabase, testImportKey } from '../tests/support/team-database.js';
import { createDemoState } from '../src/demo/seed.js';
import { demoUrls, publicDemoOrigin } from '../src/demo/mode.js';
import { prepareSoloTransfer } from '../src/domain/soloTransfer.js';

const hostedOrigin = publicDemoOrigin(process.env.PHONEBOOKS_DEMO_ORIGIN);
const { solo: demoSoloUrl, team: demoTeamUrl } = demoUrls(hostedOrigin);
const db = hostedOrigin ? await PGlite.create({
  initialMemory: 128 * 1024 * 1024,
  loadDataDir: await openAsBlob(new URL('../work/demo/team-template.tar.gz', import.meta.url)),
  postgresqlconf: ['shared_buffers=16MB', 'work_mem=2MB', 'maintenance_work_mem=8MB'],
}) : await teamDatabase();
const importKey = await testImportKey(db);
const guests = new Map();
const sessionMinutes = 45;
const guestLifetime = sessionMinutes * 60_000;
const cookieName = hostedOrigin ? '__Secure-phonebooks_demo_guest' : 'phonebooks_demo_guest';
const tokenPattern = new RegExp('(?:^|;\\s*)' + cookieName + '=([a-f0-9-]{36})(?:;|$)');
let guestCleanup;
const scope = ['p_workspace', 'p_actor'];
const routes = new Map([
  ['cloud_page', [...scope, 'p_position']],
  ['cloud_command', [...scope, 'p_request', 'p_command']],
  ['members', scope],
  ['trade_context', [...scope, 'p_product']],
  ['stats', [...scope, 'p_member', 'p_from', 'p_to']],
  ['analytics', [...scope, 'p_kind', 'p_from', 'p_to']],
  ['audit', [...scope, 'p_member', 'p_kind', 'p_from', 'p_to', 'p_offset']],
  ['operation_history', [...scope, 'p_product', 'p_kind', 'p_from', 'p_to', 'p_offset']],
  ['search_history', [...scope, 'p_product', 'p_kind', 'p_from', 'p_to', 'p_offset', 'p_query']],
]);

async function seedGuest(label, record) {
  for (const role of ['owner', 'manager', 'seller']) record.users.push(await seedUser(db, role + '-' + label + '@demo.invalid'));
  const [ownerId, guestId, seller] = record.users;
  const owner = await seedSession(db, ownerId);
  const guest = await seedSession(db, guestId);
  const [{ id }] = await asUser(db, owner, 'select * from public.phonebooks_team_create_workspace($1,$2)',
    ['Магазин «Второй круг»', randomUUID()]);
  record.workspace = id;
  await db.query(`insert into phonebooks_team_private.memberships(workspace_id,user_id,role)
    values ($1,$2,'manager'),($1,$3,'employee')`, [id, guest.sub, seller]);
  await db.query(`insert into phonebooks_team_private.member_overrides(workspace_id,user_id,permission,allowed)
    select $1,$2,permission.id,true from phonebooks_team_private.permission_catalog permission where permission.available
      and permission.id not like 'data.%' and (permission.id not like 'team.%' or permission.id in ('team.members.read','team.audit.read'))`, [id, guest.sub]);
  await db.query(`update phonebooks_team_private.team_roles set grants=array_remove(array_remove(grants,'data.solo_transfer'),'team.invite')
    where workspace_id=$1 and id='manager'`, [id]);
  const material = prepareSoloTransfer({ state: createDemoState() });
  await asUser(db, owner, 'select public.phonebooks_team_solo_import($1,$2,$3,$4,$5)',
    [id, owner.sub, importKey, label.padEnd(64, '0'), material]);
  await db.query(`update phonebooks_team_private.inventory_operations
    set historical=false, actor_id=case when type='sale' and (occurred_on-date '2000-01-01')%2=0 then $2::uuid
      when type in ('purchase','expense') then $3::uuid else actor_id end
    where workspace_id=$1 and coalesce(request_payload->>'sheetType','') not in ('historical_sale','historical_expense','opening')`,
  [id, seller, guest.sub]);
  return guest;
}

function cleanExpiredGuests() {
  if (guestCleanup) return guestCleanup;
  const expired = [...guests].filter(([, record]) => record.expires <= Date.now() && record.requests === 0);
  if (!expired.length) return;
  guestCleanup = db.transaction(async tx => {
    for (const [, record] of expired) {
      if (record.workspace) {
        // Dependent demo records first. All deletions are scoped to the expired guest's workspace.
        const tables = ['stock_reservations', 'stock_lots', 'inventory_postings', 'inventory_operation_lines', 'inventory_operations',
          'cloud_requests', 'inventory_products', 'inventory_accounts', 'inventory_categories', 'solo_imports', 'team_audit',
          'member_overrides', 'memberships', 'team_roles'];
        for (const table of tables) await tx.query(`delete from phonebooks_team_private.${table} where workspace_id=$1`, [record.workspace]);
        await tx.query('delete from phonebooks_team_private.workspaces where id=$1', [record.workspace]);
      }
      await tx.query('delete from auth.sessions where user_id=any($1::uuid[])', [record.users]);
      await tx.query('delete from auth.users where id=any($1::uuid[])', [record.users]);
    }
  }).then(() => { for (const [id] of expired) guests.delete(id); }).finally(() => { guestCleanup = undefined; });
  return guestCleanup;
}

const mime = new Map(Object.entries({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json' }));
const json = (payload, status = 200, headers = {}) => Response.json(payload, { status,
  headers: { ...headers, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const rejected = (status = 403) => json({ error: 'Действие недоступно в демоверсии.' }, status);

async function asset(request, root, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) return rejected(405);
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(root + sep)) return rejected(404);
  try {
    return new Response(request.method === 'HEAD' ? null : await readFile(path), { headers: {
      'Content-Type': mime.get(extname(path)) ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "frame-ancestors 'none'; connect-src 'self'; base-uri 'none'",
      'Cache-Control': 'public, max-age=0, no-transform',
    } });
  } catch { return rejected(404); }
}

const teamOrigin = new URL(demoTeamUrl).origin;
const soloOrigin = new URL(demoSoloUrl).origin;
const teamRoot = resolve('work/demo/team'), soloRoot = resolve('work/demo/solo');
async function team(request, pathname) {
  if (!pathname.startsWith('/api/')) return asset(request, teamRoot, pathname);
  if (pathname === '/api/config' && request.method === 'GET') return json({ soloUrl: demoSoloUrl, turnstileSiteKey: '' });
  if (request.method !== 'POST' || request.headers.get('Origin') !== teamOrigin) return rejected();
  const guestId = tokenPattern.exec(request.headers.get('Cookie') ?? '')?.[1];
  let record;
  try {
    const body = await readBody(request, 64 * 1024);
    await cleanExpiredGuests();
    const existing = guests.get(guestId);
    if (existing?.expires > Date.now()) { record = existing; record.requests += 1; }
    if (pathname === '/api/workspaces') {
      let cookie;
      if (!record) {
        if (guests.size >= 12) return json({ error: 'Все демосессии заняты. Попробуйте позже.' }, 429);
        const token = randomUUID();
        record = { users: [], workspace: null, expires: Date.now() + guestLifetime, requests: 1, changes: 0 };
        guests.set(token, record);
        record.session = seedGuest(token.replaceAll('-', '').slice(0, 16), record).catch(error => { record.expires = 0; throw error; });
        cookie = `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${sessionMinutes * 60}${hostedOrigin ? '; Secure' : ''}`;
      }
      const [row] = await asUser(db, await record.session, 'select public.phonebooks_team_overview($1) as value', [null]);
      return json(row.value, 200, cookie ? { 'Set-Cookie': cookie } : {});
    }
    if (!record) return rejected(401);
    const [operation, parameters] = pathname.startsWith('/api/cloud/') ? cloudRoute(pathname, body) : teamRoute(pathname, body);
    const fields = routes.get(operation);
    if (!fields) return rejected();
    if (operation === 'cloud_command') {
      if (record.changes >= 100) return json({ error: 'Достигнут лимит операций демосессии.' }, 429);
      record.changes += 1;
    }
    const sql = 'select public.phonebooks_team_' + operation + '(' + fields.map((_, index) => '$' + (index + 1)).join(',') + ') as value';
    const [row] = await asUser(db, await record.session, sql, fields.map(key => parameters[key]));
    return json(row.value);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : /^PT[45]\d\d$/.test(error.code) ? Number(error.code.slice(2)) : 500;
    if (status === 500) console.error('Demo request failed', error.code ?? error.name);
    return json({ error: status === 409 ? 'Данные изменились, обновите страницу.' : 'Действие не выполнено в демоверсии.' }, status);
  } finally {
    if (record) record.requests -= 1;
  }
}

function listen(origin, host, handler) {
  const url = new URL(origin);
  const server = createServer(nodeHandler(origin, (request) => {
    if (request.headers.get('Host') !== url.host) return rejected();
    return handler(request, new URL(request.url).pathname);
  }));
  return server.listen(Number(url.port), host);
}

function hosted(request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/healthz' && request.method === 'GET') return json({ status: 'ok' });
  if (request.headers.get('Host') !== new URL(hostedOrigin).host) return rejected();
  if (pathname.startsWith('/api/')) return team(request, pathname);
  if (!['GET', 'HEAD'].includes(request.method)) return rejected(405);
  if (pathname === '/solo' || pathname === '/team') return Response.redirect(hostedOrigin + pathname + '/', 308);
  if (pathname === '/') return Response.redirect(demoSoloUrl, 302);
  if (pathname.startsWith('/solo/')) return asset(request, soloRoot, pathname.slice('/solo'.length));
  if (pathname.startsWith('/team/')) return asset(request, teamRoot, pathname.slice('/team'.length));
  return rejected(404);
}

const servers = hostedOrigin ? [createServer(nodeHandler(hostedOrigin, hosted)).listen(Number(process.env.PORT || 10_000), '0.0.0.0')] : [
  listen(soloOrigin, '127.0.0.1', (request, path) => asset(request, soloRoot, path)),
  listen(teamOrigin, '127.0.0.1', team),
];
console.log('Demo Solo ' + demoSoloUrl + '  Demo Team ' + demoTeamUrl);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  for (const server of servers) { server.close(); server.closeAllConnections(); }
  await db.close();
});
