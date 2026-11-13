import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildServiceWorker } from '../tools/build-service-worker.js';

test('release identity changes for same-name assets and worker logic; gzip hosts have exact alternative hashes', () => {
  fs.mkdirSync('work', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('work/update-build-'));
  try {
    const template = fs.readFileSync('public/sw.js', 'utf8');
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
    fs.writeFileSync(path.join(dir, 'worker.js'), 'release one');
    fs.writeFileSync(path.join(dir, 'data.gz'), gzipSync('data'));
    const first = buildServiceWorker(dir, template);
    assert.equal(buildServiceWorker(dir, template).version, first.version);
    fs.writeFileSync(path.join(dir, 'worker.js'), 'release two');
    const second = buildServiceWorker(dir, template);
    assert.notEqual(second.version, first.version);
    assert.notEqual(buildServiceWorker(dir, template + '\n// lifecycle change').version, second.version);
    const worker = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
    const hashes = JSON.parse(worker.match(/const REVISIONS = (.*);/)[1]);
    assert.equal(hashes['./data.gz'].length, 2);
    assert.equal(hashes['./index.html'].length, 1);
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8').match(/phonebooks-build/g).length, 1);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
