import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publicDemoOrigin } from '../src/demo/mode.js';

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
