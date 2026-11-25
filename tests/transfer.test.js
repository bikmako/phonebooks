import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { buildExportFile } from '../src/storage/backupFormat.js';
import { prepareSoloTransfer, transferSource } from '../src/domain/soloTransfer.js';
import { sha256Hex, TRANSFER_CHUNK_BYTES } from '../src/domain/transferWire.js';
import { realisticSnapshot } from './fixtures/realistic.js';
import { asUser, seedSession, seedUser, teamDatabase, testImportKey } from './support/team-database.js';

let db;
let key;
before(async () => { db = await teamDatabase(); key = await testImportKey(db); });
after(() => db?.close());

async function owner() {
  const claims = await seedSession(db, await seedUser(db, randomUUID() + '@phonebooks.test'));
  const [space] = await asUser(db, claims, 'select * from public.phonebooks_team_create_workspace($1,$2)', ['Перенос', randomUUID()]);
  return { claims, space: space.id };
}
async function transfer(context, action, input) {
  const [row] = await asUser(db, context.claims, 'select public.phonebooks_team_transfer($1,$2,$3,$4) as result',
    [context.space, context.claims.sub, action, input]);
  return row.result;
}
async function part(id, bytes, position) {
  return { id, position, digest: await sha256Hex(bytes), data: Buffer.from(bytes).toString('base64') };
}

test('resumable transfer verifies and publishes an original source larger than 4 MiB exactly once', async () => {
  const context = await owner();
  const snapshot = realisticSnapshot();
  const state = snapshot.indexedDB.state[0].value;
  for (let index = 0; index < 75; index++) {
    state.audit.push({ id: 'large-' + index, at: '2026-01-03T00:00:00Z', action: 'note', entity: 'audit',
      entityId: 'fixture', summary: String(index) + 'a'.repeat(60000) });
  }
  const file = JSON.stringify(buildExportFile(snapshot));
  const source = transferSource(file);
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  assert.ok(bytes.length > 4 * 1024 * 1024);
  const manifest = { size: bytes.length, digest: await sha256Hex(bytes) };
  const { id } = await transfer(context, 'start', manifest);
  const first = await part(id, bytes.subarray(0, TRANSFER_CHUNK_BYTES), 0);
  await assert.rejects(transfer(context, 'chunk', { ...first, digest: '0'.repeat(64) }), { code: 'PT400' });
  await transfer(context, 'chunk', first);
  await transfer(context, 'chunk', first);
  const resumed = await transfer(context, 'start', manifest);
  assert.equal(resumed.id, id);
  assert.deepEqual(resumed.received, [0]);
  await assert.rejects(transfer(context, 'source', { id, key }), { code: 'PT409' });
  for (let offset = TRANSFER_CHUNK_BYTES; offset < bytes.length; offset += TRANSFER_CHUNK_BYTES) {
    await transfer(context, 'chunk', await part(id, bytes.subarray(offset, offset + TRANSFER_CHUNK_BYTES), offset / TRANSFER_CHUNK_BYTES));
  }
  await assert.rejects(transfer(context, 'source', { id, key: 'untrusted-test-key' }), { code: 'PT403' });
  const verified = await transfer(context, 'source', { id, key });
  const material = prepareSoloTransfer(verified.source);
  const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify(material)));
  const published = await transfer(context, 'finish', { id, key, fingerprint, material });
  assert.equal(published.state, 'complete');
  assert.deepEqual(published.reply.summary, material.summary);
  assert.equal((await transfer(context, 'start', manifest)).reply.replayed, true);
  assert.equal(Number((await db.query('select count(*) from phonebooks_team_private.transfer_chunks where transfer_id=$1',[id])).rows[0].count), 0);
  assert.deepEqual(transferSource(file), source);
});

test('whole checksum and chunk size protect interrupted, cross-workspace, cancelled and expired uploads', async () => {
  const context = await owner();
  const outsider = await owner();
  const bytes = new TextEncoder().encode('{}');
  const manifest = { size: bytes.length, digest: 'a'.repeat(64) };
  const { id } = await transfer(context, 'start', manifest);
  await assert.rejects(transfer(outsider, 'cancel', { id }), { code: 'PT404' });
  await assert.rejects(transfer(context, 'chunk', await part(id, bytes.subarray(0, 1), 0)), { code: 'PT400' });
  await transfer(context, 'chunk', await part(id, bytes, 0));
  await assert.rejects(transfer(context, 'source', { id, key }), { code: 'PT409' });
  assert.equal((await transfer(context, 'cancel', { id })).state, 'cancelled');
  assert.equal((await transfer(context, 'source', { id, key })).state, 'cancelled');
  assert.equal((await transfer(context, 'finish', { id, key })).state, 'cancelled');

  const stale = await transfer(context, 'start', manifest);
  await transfer(context, 'chunk', await part(stale.id, bytes, 0));
  await db.query("update phonebooks_team_private.transfer_uploads set expires_at=now()-interval '1 minute' where id=$1",[stale.id]);
  assert.equal(Number((await db.query('select phonebooks_team_private.prune_transfer_uploads() as removed')).rows[0].removed),1);
  assert.equal((await transfer(context, 'cancel', { id: stale.id })).state,'cancelled');
  assert.equal(Number((await db.query('select cloud_revision from phonebooks_team_private.workspaces where id=$1',[context.space])).rows[0].cloud_revision),0);
});
