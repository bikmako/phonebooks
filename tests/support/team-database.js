import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export async function teamDatabase() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text not null unique, email_confirmed_at timestamptz);
      create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users, not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$
        select nullif(current_setting('request.jwt.claims', true), '')::jsonb
      $$;
      create function auth.uid() returns uuid language sql stable as $$
        select (auth.jwt()->>'sub')::uuid
      $$;
    `);
    const migrations = new URL('../../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, migrations), 'utf8'));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function seedUser(db, address, confirmed = true) {
  const id = randomUUID();
  await db.query('insert into auth.users values ($1, $2, case when $3 then now() end)', [id, address, confirmed]);
  return id;
}

export async function testImportKey(db) {
  const key = randomBytes(32).toString('hex');
  await db.query("insert into phonebooks_team_private.solo_import_config (key_hash) values (sha256(convert_to($1,'UTF8')))", [key]);
  return key;
}

export async function seedSession(db, userId, expired = false) {
  const sessionId = randomUUID();
  await db.query("insert into auth.sessions values ($1, $2, case when $3 then now() - interval '1 minute' end)", [sessionId, userId, expired]);
  return { sub: userId, session_id: sessionId };
}

export function asUser(db, claims, statement, args = [], role = 'authenticated') {
  return db.transaction(async tx => {
    await tx.exec(role === 'anon' ? 'set local role anon' : 'set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return (await tx.query(statement, args)).rows;
  });
}
