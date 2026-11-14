import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

async function install({ redirectAsset = false, corruptIndex = false } = {}) {
  const scope = 'https://isolated.example/phonebooks/';
  const body = '<html>verified shell</html>', asset = 'verified asset';
  const hash = async value => Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
  let source = fs.readFileSync('public/sw.js', 'utf8')
    .replace('const BUILT = [];', `const BUILT = ${JSON.stringify(['./index.html', './assets/app.js'])};`)
    .replace('const REVISIONS = {};', `const REVISIONS = ${JSON.stringify({'./index.html':[await hash(body)],'./assets/app.js':[await hash(asset)]})};`);
  const events = {}, requests = [], entries = new Map(); let deleted = false, skipped = false;
  vm.runInNewContext(source, {
    URL, Response, crypto: webcrypto, console: { error() {} },
    self: { registration: { scope }, addEventListener: (name, fn) => events[name] = fn, skipWaiting() { skipped = true; } },
    caches: { async open() { return { async put(key, value) { entries.set(key, value); } }; }, async delete() { deleted = true; entries.clear(); } },
    async fetch(url, options) {
      requests.push({url, cache: options.cache});
      // Cloudflare index.html redirects; the canonical directory does not.
      const response = new Response(url === scope ? (corruptIndex ? 'wrong shell' : body) : asset);
      Object.defineProperty(response, 'redirected', { value: url.endsWith('index.html') || redirectAsset && url.endsWith('app.js') });
      return response;
    },
  });
  let promise; events.install({ waitUntil(p) { promise = p; } });
  return { promise, requests, entries, deleted: () => deleted, skipped: () => skipped, scope };
}
test('Pages canonical HTML URL installs verified bytes under index cache key without auto-activation', async () => {
  const run = await install(); await run.promise;
  assert.equal(run.requests[0].url, run.scope);
  assert.ok(run.requests.every(r => r.cache === 'reload'));
  assert.ok(run.entries.has(run.scope + 'index.html'));
  assert.equal(run.skipped(), false);
});
test('redirected assets are still rejected and partial cache removed', async () => {
  const run = await install({ redirectAsset: true });
  await assert.rejects(run.promise, /Incomplete release/); assert.equal(run.deleted(), true);
});
test('canonical HTML must still pass the release checksum', async () => {
  const run = await install({ corruptIndex: true });
  await assert.rejects(run.promise, /checksum mismatch/); assert.equal(run.deleted(), true);
});
