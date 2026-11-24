import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { accountsDatabase, seedSession, seedUser, signedRpc } from "./support/accounts-database.js";
import { accessLease, MAX_OFFLINE_MS, WRITE_LEASE_MS } from "../src/account/access.js";

let db, owner, customer, userId;
const HOUR = 3600000;
const DAY = 24 * HOUR;

before(async () => {
  db = await accountsDatabase();
  const ownerId = await seedUser(db, "owner@example.test", new Date());
  await db.query("insert into phonebooks_private.owners values ($1)", [ownerId]);
  owner = await seedSession(db, ownerId);
  userId = await seedUser(db, "customer@example.test");
  customer = await seedSession(db, userId);
});
after(async () => { await db?.close(); });

const access = claims => signedRpc(db, claims, "access");
const action = (name, values, requestId = crypto.randomUUID()) => signedRpc(db, owner, "admin_action", {
  p_target: userId, p_request_id: requestId, p_action: name, ...values,
});

test("trial starts after confirmation, lasts exactly 72 hours and never starts again", async () => {
  assert.equal((await access(customer)).status, "pending");
  const confirmed = new Date();
  await db.query("update auth.users set email_confirmed_at=$2 where id=$1", [userId, confirmed]);
  const result = await access(customer);
  assert.equal(result.status, "trial");
  assert.equal(Date.parse(result.trialUntil) - confirmed.getTime(), 72 * HOUR);
  await db.query("update auth.users set email_confirmed_at=now()+interval '1 hour' where id=$1", [userId]);
  assert.equal((await access(customer)).trialUntil, result.trialUntil);
  await db.query("update phonebooks_private.accounts set trial_started_at=now()-interval '72 hours' where user_id=$1", [userId]);
  assert.equal((await access(customer)).status, "expired");
});

test("owner permissions and private tables reject ordinary and anonymous access", async () => {
  await assert.rejects(signedRpc(db, customer, "admin_list"), { code: "PT403" });
  await assert.rejects(signedRpc(db, { ...customer, role: "owner" }, "admin_action", {
    p_target: userId, p_request_id: crypto.randomUUID(), p_action: "lifetime",
  }), { code: "PT403" });
  await assert.rejects(db.exec("begin; set local role anon; select public.phonebooks_access();"), { code: "42501" });
  await db.exec("rollback");
  await assert.rejects(db.exec("begin; set local role authenticated; select * from phonebooks_private.accounts;"), { code: "42501" });
  await db.exec("rollback");
});

test("payment is atomic, repeatable by request ID and early extension preserves remaining days", async () => {
  const requestId = crypto.randomUUID();
  const [first, replay] = await Promise.all([action("payment", {}, requestId), action("payment", {}, requestId)]);
  assert.deepEqual(first, replay);
  const firstExpiry = Date.parse(first.paid_until);
  assert.ok(Math.abs(firstExpiry - Date.now() - 30 * DAY) < 5000);
  assert.equal((await access(customer)).status, "active");
  const early = await action("extend", { p_days: 17 });
  assert.equal(Date.parse(early.paid_until) - firstExpiry, 17 * DAY);
  const [payment] = await Promise.all([action("payment"), action("attribution", { p_source: "Telegram", p_partner: "Партнёр" })]);
  assert.equal(Date.parse(payment.paid_until) - Date.parse(early.paid_until), 30 * DAY);
  await assert.rejects(action("extend", { p_days: -1 }), { code: "PT400" });
  await assert.rejects(action("extend", { p_days: 30 }, requestId), { code: "PT409" });
  const res = await signedRpc(db, owner, "admin_list", { p_query: "партн", p_status: "active" });
  assert.equal(res.total, 1);
  assert.equal(res.metrics.active, 1);
  assert.equal(res.metrics.receivedKopecks, 79800);
  assert.equal(res.metrics.monthlyRunRateKopecks, 39900);
  assert.equal(res.accounts[0].source, "Telegram");
  const history = await signedRpc(db, owner, "admin_history", { p_target: userId });
  assert.equal(history.payments.length, 2);
  assert.equal(history.actions.length, 4);
  assert.equal(history.actions[0].actor_email, "owner@example.test");
});

test("expired session, lifetime access, blocking, and unblock are independently enforced", async () => {
  await db.query("update phonebooks_private.accounts set paid_until=now()-interval '1 second' where user_id=$1", [userId]);
  assert.equal((await access(customer)).status, "expired");
  await assert.rejects(access(await seedSession(db, userId, new Date(Date.now() - 1000))), { code: "PT401" });
  await action("lifetime");
  assert.equal((await access(customer)).status, "lifetime");
  await action("block");
  await assert.rejects(access(customer), { code: "PT401" });
  assert.equal((await access(await seedSession(db, userId))).status, "blocked");
  await action("unblock");
  assert.equal((await access(await seedSession(db, userId))).status, "lifetime");
});

test("local clock changes and network loss cannot extend a write lease", () => {
  let wall = 1000, monotonic = 0;
  const clock = { wall: () => wall, monotonic: () => monotonic };
  const access = accessLease({
    status: "active", serverNow: "2026-11-24T10:00:00Z", expiresAt: "2026-11-24T10:00:08Z",
  }, clock);
  assert.equal(access.state(true).write, true);
  assert.equal(access.state(false).write, false);
  assert.match(access.state(false).reminder, /суток/);
  wall -= 2 * DAY;
  monotonic += 8000;
  assert.deepEqual(access.state(true), { read: true, write: false, expired: true, reminder: "" });
  monotonic = MAX_OFFLINE_MS;
  assert.equal(access.state(false).read, false);
  const unlimited = accessLease({ status: "lifetime", serverNow: "2026-11-24T10:00:00Z" }, clock);
  assert.equal(unlimited.state(true).write, true);
  wall += WRITE_LEASE_MS + 1;
  assert.equal(unlimited.state(true).write, false);
  wall -= 2 * DAY;
  assert.equal(unlimited.state(true).write, false);
});

test("paid expiry notification uses the server's three-day and one-day thresholds", () => {
  const epoch = Date.parse("2026-11-24T10:00:00Z");
  const clocks = { wall: () => 0, monotonic: () => 0 };
  const notice = duration => accessLease({
    status: "active", serverNow: new Date(epoch).toISOString(), expiresAt: new Date(epoch + duration).toISOString(),
  }, clocks).state(true).reminder;
  const stale = accessLease({ status: "active", serverNow: new Date(epoch).toISOString(), expiresAt: new Date(epoch + 100).toISOString() }, clocks, 120);
  assert.equal(stale.state(true).write, false);
  assert.equal(notice(3 * DAY + 1), "");
  assert.match(notice(3 * DAY), /трёх дней/);
  assert.match(notice(DAY + 1), /трёх дней/);
  assert.match(notice(DAY), /суток/);
});
