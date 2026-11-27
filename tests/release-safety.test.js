import assert from 'node:assert/strict';
import { test } from 'node:test';
import { teamDatabase } from './support/team-database.js';

test('Team migration chain keeps every private table and public RPC closed to anonymous access', async () => {
  const db = await teamDatabase();
  try {
    const { rows: tables } = await db.query(`
      select c.relname, c.relrowsecurity,
        has_table_privilege('anon',c.oid,'select,insert,update,delete') as anonymous,
        has_table_privilege('authenticated',c.oid,'select,insert,update,delete') as direct_member
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='phonebooks_team_private' and c.relkind='r'
    `);
    assert.ok(tables.length >= 22);
    for (const table of tables) {
      assert.ok(table.relrowsecurity, table.relname);
      assert.ok(!table.anonymous && !table.direct_member, table.relname);
    }
    const { rows: functions } = await db.query(`
      select p.proname, p.prosecdef, coalesce('search_path=""'=any(p.proconfig),false) as pinned_path,
        has_function_privilege('anon',p.oid,'execute') as anonymous,
        has_function_privilege('authenticated',p.oid,'execute') as member
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'phonebooks_team_%'
    `);
    assert.ok(functions.length >= 27);
    for (const rpc of functions) {
      assert.ok(!rpc.anonymous && rpc.member, rpc.proname);
      assert.ok(!rpc.prosecdef || rpc.pinned_path, rpc.proname);
    }
  } finally { await db.close(); }
});
