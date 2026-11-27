import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(script, args) {
  execFileSync(process.execPath, [script, ...args], { stdio: 'inherit' });
}

for (const mode of ['solo', 'team']) {
  const team = mode === 'team';
  run('tools/prepare-scanner-assets.js', team ? ['--team'] : []);
  run('node_modules/vite/bin/vite.js', [
    'build', '--mode', 'demo', '--outDir', fileURLToPath(new URL('../work/demo/' + mode, import.meta.url)),
    ...(team ? ['--config', 'vite.team.config.js'] : []),
  ]);
}
