import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';

function collect(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { collect(full, base, out); continue; }
    const relative = path.relative(base, full).split(path.sep).join('/');
    if (['sw.js', '404.html', '.nojekyll'].includes(relative)) continue;
    out.push(`./${relative}`);
  }
  return out;
}
export function buildServiceWorker(distDir, template) {
  const built = collect(distDir).sort();
  const indexPath = path.join(distDir, 'index.html');
  // Re-running the generator is deterministic, including in release tests.
  fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace(/<meta name="phonebooks-build" content="[^"]*">/g, ''));
  const digest = crypto.createHash('sha256').update(template);
  for (const file of built) digest.update(file).update(fs.readFileSync(path.join(distDir, file)));
  const version = `phonebooks-v9-${digest.digest('hex').slice(0, 16)}`;
  fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace('</head>', `<meta name="phonebooks-build" content="${version}"></head>`));
  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const revisions = Object.fromEntries(built.map(file => {
    const bytes = fs.readFileSync(path.join(distDir, file));
    // Vite preview (and some static hosts) serves .gz as Content-Encoding:gzip.
    // Fetch decodes that response. Both representations must be exact matches.
    return [file, file.endsWith('.gz') ? [sha256(bytes), sha256(gunzipSync(bytes))] : [sha256(bytes)]];
  }));
  const worker = template
    .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
    .replace(/const BUILT = \[[^\]]*\];/, `const BUILT = ${JSON.stringify(built)};`)
    .replace('const REVISIONS = {};', `const REVISIONS = ${JSON.stringify(revisions)};`);
  fs.writeFileSync(path.join(distDir, 'sw.js'), worker);
  return { version, files: built.length };
}
