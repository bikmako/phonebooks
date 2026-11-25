import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { asUser, seedSession, seedUser, teamDatabase } from './support/team-database.js';

let db;
before(async () => { db = await teamDatabase(); });
after(() => db?.close());
const cash = 'ac_default_cash';
const roleId = () => 'custom:' + randomUUID();
async function person() {
  const email = randomUUID() + '@phonebooks.test';
  return { ...(await seedSession(db, await seedUser(db, email))), email };
}
async function rpc(caller, method, ...args) {
  const parameters = args.map((_, index) => '$' + (index + 1)).join(',');
  const [row] = await asUser(db, caller, 'select public.phonebooks_team_' + method + '(' + parameters + ') as value', args);
  return row.value;
}
async function spaceFor(owner) {
  const [space] = await asUser(db, owner, 'select * from public.phonebooks_team_create_workspace($1,$2)', ['Команда', randomUUID()]);
  return space.id;
}
function manage(caller, space, action, payload) { return rpc(caller, 'manage', space, caller.sub, action, payload); }
function role(owner, space, id, grants, revision = 0) {
  return manage(owner, space, 'save_role', { roleId: id, name: id.startsWith('custom:') ? id.slice(7,15) : 'Сотрудник', grants, revision });
}
function assign(owner, space, target, assigned, revision = 1, overrides = {}) {
  return manage(owner, space, 'set_member', { userId: target.sub, roleId: assigned, revision, overrides });
}
function access(caller, space) { return rpc(caller, 'access', space, caller.sub); }
function feed(caller, space, cursor = null) { return rpc(caller, 'cloud_feed', space, caller.sub, cursor); }
function command(caller, space, body, id = randomUUID()) { return rpc(caller, 'cloud_command', space, caller.sub, id, body); }
function audit(caller, space, member = null, kind = null, from = null, to = null) {
  return rpc(caller, 'audit', space, caller.sub, member, kind, from, to, 0);
}
function stats(caller, space, member = null, from = null, to = null) {
  return rpc(caller, 'stats', space, caller.sub, member, from, to);
}
async function invite(owner, space, target, assigned) {
  const id = await rpc(owner, 'create_invitation', space, target.email, assigned);
  assert.equal(await rpc(target, 'accept_invitation', id), space);
  return id;
}

test('workspace roles share changes live, support individual deny/allow and protect ownership and archive references', async () => {
  const [owner, first, second, third, alternative] = await Promise.all([person(),person(),person(),person(),person()]);
  const space = await spaceFor(owner);
  const stranger = await spaceFor(alternative);
  assert.equal((await rpc(owner,'members',space,owner.sub)).members.length, 1);
  const custom = roleId();
  await role(owner,space,custom,['stock.read','trade.sale']);
  await invite(owner,space,first,custom);
  await invite(owner,space,second,custom);
  await invite(owner,space,third,'employee');
  const manager = await person();
  const otherManager = await person();
  await invite(owner,space,manager,'manager');
  await invite(owner,space,otherManager,'manager');
  assert.equal((await rpc(owner,'members',space,owner.sub)).members.filter(member => member.roleId==='manager').length, 2);
  assert.deepEqual((await access(first,space)).permissions,['stock.read','trade.sale']);
  await assign(owner,space,first,custom,1,{'trade.sale':false,'analytics.self':true});
  assert.deepEqual((await access(first,space)).permissions,['analytics.self','stock.read']);
  await role(owner,space,custom,['stock.read','trade.sale','analytics.self'],1);
  assert.equal((await access(second,space)).permissions.includes('analytics.self'),true);
  assert.equal((await access(first,space)).permissions.includes('trade.sale'),false);
  await assign(owner,space,first,custom,2,{});
  assert.equal((await access(first,space)).permissions.includes('trade.sale'),true);
  await assert.rejects(assign(first,space,first,'manager',3),{code:'PT403'});
  await assert.rejects(assign(owner,space,owner,'employee'),{code:'PT403'});
  await assert.rejects(manage(owner,space,'revoke_member',{userId:owner.sub,revision:1}),{code:'PT403'});
  await assert.rejects(role(owner,space,'owner',['stock.read']),{code:'PT400'});
  await assert.rejects(assign(owner,space,third,'owner'),{code:'PT400'});
  await assert.rejects(rpc(alternative,'members',space,alternative.sub),{code:'PT403'});
  await assert.rejects(rpc(owner,'members',space,first.sub),{code:'PT403'});
  await assert.rejects(rpc(alternative,'create_invitation',stranger,first.email,custom),{code:'PT400'});
  await assert.rejects(manage(owner,space,'archive_role',{roleId:custom,revision:2}),{code:'PT409'});
  await assign(owner,space,first,'employee',3);
  await assign(owner,space,second,'employee');
  await manage(owner,space,'archive_role',{roleId:custom,revision:2});
  await assert.rejects(assign(owner,space,third,custom),{code:'PT400'});
  const ownerRoleAudit = await audit(owner,space,null,'role.edit');
  assert.deepEqual(ownerRoleAudit[0].previous.grants,['stock.read','trade.sale']);
  assert.ok(ownerRoleAudit[0].current.grants.includes('analytics.self'));
  const overrides = await audit(owner,space,null,'member.permission');
  assert.ok(overrides.some(event => event.previous?.allowed === false || event.current?.allowed === false));
  assert.equal((await audit(owner,space,null,null,'1999-01-01','1999-12-31')).length,0);
});

test('revoked rights are checked on feed, direct commands/replays, financial totals and audit; history stays attributable', async () => {
  const [owner,seller,outsider] = await Promise.all([person(),person(),person()]);
  const space = await spaceFor(owner);
  const custom = roleId();
  await role(owner,space,custom,['stock.read','trade.sale','analytics.self','analytics.company','finance.revenue.read','finance.profit.read','team.audit.read']);
  await invite(owner,space,seller,custom);
  await command(owner,space,{type:'deposit',accountId:cash,amountMinor:1000});
  await command(owner,space,{type:'purchase',accountId:cash,quantity:1,unitPriceMinor:500,name:'Телефон',categoryId:'smartphones',tracking:'unit'});
  const stock = await feed(seller,space);
  const [product] = stock.products;
  assert.equal(product.lastPurchasePriceMinor,undefined);
  assert.equal(product.stockCostMinor,undefined);
  assert.equal((await feed(owner,space)).products[0].lastPurchasePriceMinor,'500');
  assert.ok(stock.accounts.every(account => !Object.hasOwn(account,'balanceMinor')));
  assert.equal(Object.hasOwn(stock.totals,'cost_minor'),false);
  assert.deepEqual(stock.operations,[]);
  assert.equal((await audit(seller,space,null,'purchase')).length,0);
  assert.equal((await stats(seller,space)).cashMinor,undefined);
  assert.equal((await stats(seller,space)).grossMinor,undefined);
  assert.equal((await stats(seller,space)).purchaseMinor,undefined);
  assert.equal((await stats(seller,space)).stockMinor,undefined);
  for (const type of ['purchase','repair','expense','deposit','stock_adjustment']) {
    await assert.rejects(command(seller,space,{type,accountId:cash,productId:product.id,quantity:-1,amountMinor:1}),{code:'PT403'});
  }
  await assign(owner,space,seller,custom,1,{'finance.history.read':true});
  const filteredHistory = await audit(seller,space,null,'purchase');
  assert.equal(filteredHistory.length,1);
  assert.equal(filteredHistory[0].current.amountMinor,undefined);
  const requestId = randomUUID();
  const sale = { type:'sale', accountId:cash, productId:product.id, expectedVersion:product.version, quantity:1, unitPriceMinor:800 };
  const receipt = await command(seller,space,sale,requestId);
  assert.deepEqual(await command(seller,space,sale,requestId),receipt);
  assert.equal((await stats(owner,space)).grossMinor,'300');
  assert.equal((await stats(owner,space)).sales,1);
  assert.equal((await stats(owner,space,owner.sub)).purchases,1);
  assert.equal((await stats(owner,space,owner.sub)).sales,0);
  assert.equal((await stats(owner,space,seller.sub)).sales,1);
  assert.equal((await stats(owner,space,seller.sub)).revenueMinor,'800');
  assert.equal((await stats(seller,space,seller.sub)).sales,1);
  assert.equal((await stats(owner,space,seller.sub,'1999-01-01','1999-12-31')).sales,0);
  await assert.rejects(stats(seller,space,owner.sub),{code:'PT403'});
  await assert.rejects(stats(outsider,space,seller.sub),{code:'PT403'});
  await assert.rejects(asUser(db,seller,'select * from phonebooks_team_private.team_audit'),{code:'42501'});
  await assign(owner,space,seller,custom,2,{'trade.sale':false,'stock.read':false,'finance.revenue.read':false});
  const after = await feed(seller,space,stock.cursor);
  assert.deepEqual(after.products,[]);
  assert.equal(after.totals,null);
  assert.equal((await stats(seller,space)).revenueMinor,undefined);
  await assert.rejects(command(seller,space,sale,requestId),{code:'PT403'});
  await manage(owner,space,'revoke_member',{userId:seller.sub,revision:3});
  await assert.rejects(feed(seller,space),{code:'PT403'});
  await assert.rejects(audit(seller,space),{code:'PT403'});
  const history = await audit(owner,space,seller.sub,'sale');
  assert.equal(history.length,1);
  assert.equal(history[0].current.amountMinor,'800');
  assert.equal((await stats(owner,space,seller.sub)).revenueMinor,'800');
  await manage(owner,space,'restore_member',{userId:seller.sub,revision:4});
  assert.ok((await access(seller,space)).permissions.includes('analytics.self'));
  assert.equal((await audit(owner,space,null,'member.restore')).length,1);
});

test('delegated invitations and access management cannot grant beyond the caller or bypass revocation', async () => {
  const [owner,delegate,receiver,former] = await Promise.all([person(),person(),person(),person()]);
  const space = await spaceFor(owner);
  const custom = roleId();
  await role(owner,space,custom,['team.invite','team.members.manage','team.members.read','stock.read','trade.sale','analytics.self']);
  await invite(owner,space,delegate,custom);
  await invite(owner,space,former,'employee');
  await assert.rejects(rpc(delegate,'create_invitation',space,receiver.email,'manager'),{code:'PT403'});
  await assert.rejects(rpc(delegate,'create_invitation',space,receiver.email,custom),{code:'PT403'});
  await manage(delegate,space,'revoke_member',{userId:former.sub,revision:1});
  const pendingFormer = await rpc(delegate,'create_invitation',space,former.email,'employee');
  await assert.rejects(rpc(former,'accept_invitation',pendingFormer),{code:'PT409'});
  await manage(delegate,space,'restore_member',{userId:former.sub,revision:2});
  await assert.rejects(manage(delegate,space,'revoke_member',{userId:owner.sub,revision:1}),{code:'PT403'});
  const pending = await rpc(delegate,'create_invitation',space,receiver.email,'employee');
  await manage(owner,space,'revoke_member',{userId:delegate.sub,revision:1});
  await assert.rejects(rpc(receiver,'accept_invitation',pending),{code:'PT403'});
});
