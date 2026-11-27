import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const sha = process.env.PHONEBOOKS_TEST_COMMIT ?? execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A release commit SHA is required');
const output = resolve('work/release', sha.slice(0, 12));
await mkdir(output, { recursive: true });

const packages = {
  Solo: { 'phonebooks': 'dist', 'README.md': 'docs/PHONEBOOKS_RELEASE_CANDIDATE.md' },
  Team: { 'dist-team': 'dist-team', 'src': 'src', 'supabase': 'supabase', 'server/node-http.js': 'server/node-http.js',
    'server/team-worker.js': 'server/team-worker.js', 'server/render-team-staging.js': 'server/render-team-staging.js',
    'docs/PHONEBOOKS_TEAM_STAGING_WORK.md': 'docs/PHONEBOOKS_TEAM_STAGING_WORK.md',
    'README.md': 'docs/PHONEBOOKS_RELEASE_CANDIDATE.md', 'package.json':'package.json', 'package-lock.json':'package-lock.json' },
  Demo: { 'work/demo/solo': 'work/demo/solo', 'work/demo/team': 'work/demo/team', 'src': 'src', 'supabase/migrations':'supabase/migrations',
    'server/node-http.js': 'server/node-http.js', 'server/team-worker.js': 'server/team-worker.js', 'server/demo-server.js': 'server/demo-server.js',
    'tests/support/team-database.js': 'tests/support/team-database.js', 'package.json':'package.json', 'package-lock.json':'package-lock.json',
    'README.md': 'docs/PHONEBOOKS_RELEASE_CANDIDATE.md' },
};

async function collect(source, dest, files) {
  let contents;
  try { contents = await readdir(source, { withFileTypes:true }); }
  catch (error) { if (error.code !== 'ENOTDIR') throw error; }
  if (!contents) { files[dest] = new Uint8Array(await readFile(source)); return; }
  for (const member of contents.sort((a,b) => a.name.localeCompare(b.name))) {
    if (member.isSymbolicLink() || member.name.startsWith('.')) throw new Error('Unexpected file in build: ' + member.name);
    await collect(join(source, member.name), dest + '/' + member.name, files);
  }
}

const sums = [];
for (const [mode, paths] of Object.entries(packages)) {
  const files = {};
  for (const [name, source] of Object.entries(paths)) await collect(source, name, files);
  files['build.json'] = strToU8(JSON.stringify({ sha, mode, purpose:'acceptance' }) + '\n');
  const name = 'PhoneBooks-2.0-' + mode + '-' + sha.slice(0, 12) + '.zip';
  const bytes = zipSync(files, { level: 6 });
  await writeFile(join(output, name), bytes);
  sums.push(createHash('sha256').update(bytes).digest('hex') + '  ' + name);
}
await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(output);
