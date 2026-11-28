// Local-only release switcher. Never shipped in dist or used by Pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { buildServiceWorker } from './build-service-worker.js';
const root = path.resolve('work/update-fixtures');
fs.mkdirSync(root, { recursive: true });
const template = fs.readFileSync('public/sw.js', 'utf8');
for (const label of ['a', 'b', 'c', 'd']) {
  const dir = path.join(root, label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync('dist', dir, { recursive: true });
  const index = path.join(dir, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('</body>', `<span hidden data-test-release="${label}"></span></body>`));
  // Different byte contents at the SAME public asset URL must change identity.
  fs.writeFileSync(path.join(dir, 'release-fixture.txt'), label);
  buildServiceWorker(dir, template);
}
// Keep the regular CI fixture reproducible. The optional fixture uses the
// verified published bytes, and is served only on this loopback test host.
const oldApp = path.join(root, 'legacy');
fs.rmSync(oldApp, { recursive: true, force: true });
if (process.env.PHONEBOOKS_USE_PUBLISHED_FIXTURE === '1') {
  const published = path.resolve('work/published-fixture');
  const worker = fs.readFileSync(path.join(published, 'sw.js'));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  if (digest(worker) !== '481cfe99db85863948ac494dcad9a86a2ea5d9f41bb023d6dfe6131d3ac41061') {
    throw new Error('Published fixture does not match the reviewed service worker');
  }
  const revisions = JSON.parse(/^const REVISIONS = (.+);$/m.exec(worker.toString())[1]);
  fs.mkdirSync(oldApp);
  fs.writeFileSync(path.join(oldApp, 'sw.js'), worker);
  for (const [key, hashes] of Object.entries(revisions)) {
    const relative = key.slice(2);
    const bytes = fs.readFileSync(path.join(published, relative));
    if (!hashes.includes(digest(bytes))) throw new Error('Published fixture has changed: ' + relative);
    const dest = path.join(oldApp, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
} else {
  const legacy = path.join(root, 'legacy-source');
  fs.rmSync(legacy, { recursive: true, force: true });
  fs.mkdirSync(legacy);
  const archive = path.join(root, 'legacy.tar');
  execFileSync('git', ['archive', '--output', archive, '832972e5407a6a08894f1df5e475cb7a5cf02ac1']);
  execFileSync('tar', ['-xf', archive, '-C', legacy]);
  fs.symlinkSync(path.resolve('node_modules'), path.join(legacy, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  execSync('npm run build -- --base /phonebooks/', { cwd: legacy, stdio: 'inherit' });
  fs.cpSync(path.join(legacy, 'dist'), oldApp, { recursive: true });
}
let release = 'a', failure = null, requests = [];
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__test/release' && req.method === 'POST') {
    let body = ''; req.on('data', part => body += part); req.on('end', () => {
      const next = JSON.parse(body);
      if (['a', 'b', 'c', 'd', 'legacy'].includes(next.release)) release = next.release;
      failure = next.failure || null; requests = [];
      res.end('ok');
    }); return;
  }
  if (url.pathname === '/__test/requests') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(requests)); return; }
  if (!url.pathname.startsWith('/phonebooks/')) { res.writeHead(404).end(); return; }
  // Match Cloudflare Pages clean-URL behavior, absent from the old fixture.
  if (url.pathname === '/phonebooks/index.html') {
    res.writeHead(308, { Location: '/phonebooks/' }).end(); return;
  }
  const relative = decodeURIComponent(url.pathname.slice('/phonebooks/'.length)) || 'index.html';
  const file = path.resolve(root, release, relative);
  if (!file.startsWith(path.join(root, release) + path.sep)) { res.writeHead(403).end(); return; }
  requests.push(relative);
  if (failure && relative === 'release-fixture.txt') {
    if (failure === 'corrupt') { res.end('wrong-release-bytes'); return; }
    res.writeHead(503).end('download interrupted'); return;
  }
  try {
    const data = fs.readFileSync(file);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  } catch { res.writeHead(404).end(); }
}).listen(4175, '127.0.0.1', () => console.log('Update release test server ready'));
