import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const base = 'https://bikmako.github.io/phonebooks/';
const workerHash = '481cfe99db85863948ac494dcad9a86a2ea5d9f41bb023d6dfe6131d3ac41061';
const output = resolve('work/published-fixture');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function verified(relative, hashes) {
  if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(relative) || relative.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Invalid fixture path');
  }
  const response = await fetch(base + relative, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Published file unavailable: ' + relative);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!hashes.includes(digest(bytes))) throw new Error('Published file has changed: ' + relative);
  return bytes;
}

const worker = await verified('sw.js', [workerHash]);
const revisions = JSON.parse(/^const REVISIONS = (.+);$/m.exec(worker.toString())[1]);
const paths = Object.keys(revisions);
for (let offset = 0; offset < paths.length; offset += 4) {
  await Promise.all(paths.slice(offset, offset + 4).map(async key => {
    const relative = key.slice(2);
    const bytes = await verified(relative, revisions[key]);
    const file = resolve(output, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }));
}
await writeFile(resolve(output, 'sw.js'), worker);
console.log('Verified published fixture: ' + paths.length + ' files and service worker ' + workerHash);
