import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export async function accountsDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text not null unique,
      created_at timestamptz not null default now(), email_confirmed_at timestamptz
    );
    create table auth.sessions (
      id uuid primary key, user_id uuid not null references auth.users, not_after timestamptz
    );
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
  `);
  await db.exec(await readFile(new URL("../../supabase/migrations/202611240001_phonebooks_accounts.sql", import.meta.url), "utf8"));
  return db;
}

const argumentsByFunction = {
  access: [],
  admin_list: ["p_query", "p_status", "p_offset"],
  admin_history: ["p_target", "p_offset"],
  admin_action: ["p_target", "p_request_id", "p_action", "p_days", "p_source", "p_partner"],
};

export async function signedRpc(db, claims, name, body = {}) {
  const args = argumentsByFunction[name];
  if (!args) throw new Error("Unknown RPC");
  const supplied = args.filter(key => Object.hasOwn(body, key));
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated;");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await tx.query(
      `select public.phonebooks_${name}(${supplied.map((key, index) => key + " => $" + (index + 1)).join(",")}) as value`,
      supplied.map(key => body[key]),
    );
    return result.rows[0].value;
  });
}

export async function seedUser(db, email, confirmed = null) {
  const id = crypto.randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values ($1,$2,$3)", [id, email, confirmed]);
  return id;
}

export async function seedSession(db, userId, notAfter = null) {
  const sessionId = crypto.randomUUID();
  await db.query("insert into auth.sessions(id,user_id,not_after) values ($1,$2,$3)", [sessionId, userId, notAfter]);
  return { sub: userId, session_id: sessionId };
}
