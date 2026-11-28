import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { teamDatabase } from '../tests/support/team-database.js';

export async function hostedDemoDatabase() {
  const cluster = new EmbeddedPostgres({
    databaseDir: join(await mkdtemp(join(tmpdir(), 'phonebooks-demo-')), 'data'),
    user: 'phonebooks_demo_admin', password: randomBytes(32).toString('hex'), authMethod: 'scram-sha-256',
    port: 55476, persistent: false,
    initdbFlags: ['--no-locale', '--encoding=UTF8'],
    postgresFlags: ['-h', '127.0.0.1', '-c', 'shared_buffers=16MB', '-c', 'work_mem=2MB', '-c', 'max_connections=8'],
  });
  await cluster.initialise();
  await cluster.start();
  const client = cluster.getPgClient();
  let queue = Promise.resolve();
  const run = action => {
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  };
  const connection = { query: (sql, parameters) => client.query(sql, parameters), exec: sql => client.query(sql) };
  const database = {
    query: (sql, parameters) => run(() => connection.query(sql, parameters)),
    exec: sql => run(() => connection.exec(sql)),
    transaction: task => run(async () => {
      await connection.exec('begin');
      try {
        const value = await task(connection);
        await connection.exec('commit');
        return value;
      } catch (error) {
        await connection.exec('rollback');
        throw error;
      }
    }),
    close: () => run(async () => { try { await client.end(); } finally { await cluster.stop(); } }),
  };
  try { await client.connect(); } catch (error) { await database.close(); throw error; }
  return teamDatabase(database);
}
