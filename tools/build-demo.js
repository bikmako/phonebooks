import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { publicDemoOrigin } from '../src/demo/mode.js';
import { teamDatabase } from '../tests/support/team-database.js';

const origin = publicDemoOrigin(process.env.PHONEBOOKS_DEMO_ORIGIN);

function run(script, args) {
  execFileSync(process.execPath, [script, ...args], {
    stdio: 'inherit', env: { ...process.env, VITE_PHONEBOOKS_DEMO_ORIGIN: origin },
  });
}

for (const mode of ['solo', 'team']) {
  const team = mode === 'team';
  run('tools/prepare-scanner-assets.js', team ? ['--team'] : []);
  run('node_modules/vite/bin/vite.js', [
    'build', '--mode', 'demo', '--outDir', fileURLToPath(new URL('../work/demo/' + mode, import.meta.url)),
    ...(team ? ['--config', 'vite.team.config.js', ...(origin ? ['--base', '/team/'] : [])] : []),
  ]);
}

if (origin) {
  const db = await teamDatabase({
    initialMemory: 128 * 1024 * 1024,
    postgresqlconf: ['shared_buffers=16MB', 'work_mem=2MB', 'maintenance_work_mem=8MB'],
  });
  try {
    // Each running instance creates its own import key and guest records.
    const snapshot = await db.dumpDataDir('gzip');
    await writeFile(new URL('../work/demo/team-template.tar.gz', import.meta.url), new Uint8Array(await snapshot.arrayBuffer()));
  } finally { await db.close(); }
}
