import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('paid and demo artifacts keep separate identity, workers, caches and scanner resources', () => {
  const paid = fs.readFileSync('dist/sw.js', 'utf8'), demo = fs.readFileSync('dist-demo/sw-demo.js', 'utf8');
  assert.match(paid, /const CACHE = 'phonebooks-v9-/); assert.match(demo, /const CACHE = 'phonebooks-demo-v9-/);
  assert.match(demo, /k\.startsWith\('phonebooks-demo-'\)/); assert.doesNotMatch(demo, /k\.startsWith\('phonebooks-'\)/);
  assert.match(demo, /matchDemo\(request/); assert.equal(fs.existsSync('dist-demo/sw.js'), false);
  assert.equal(fs.existsSync('dist/sw-demo.js'), false);
  assert.match(fs.readFileSync('dist-demo/index.html', 'utf8'), /<title>PhoneBooks ДЕМО<\/title>/);
  assert.doesNotMatch(fs.readFileSync('dist/index.html', 'utf8'), /ДЕМО/);
  assert.equal(JSON.parse(fs.readFileSync('dist/manifest.webmanifest')).id, './');
  assert.equal(JSON.parse(fs.readFileSync('dist-demo/manifest.webmanifest')).id, './?app=phonebooks-demo');
  for (const dir of ['dist', 'dist-demo']) {
    const js = fs.readdirSync(dir + '/assets').filter(f => /^app-.*\.js$/.test(f)).map(f => fs.readFileSync(dir + '/assets/' + f, 'utf8')).join('');
    if (dir === 'dist') assert.doesNotMatch(js, /Синтетическая закупка/);
    else assert.doesNotMatch(js, /Полная локальная копия · формат 2/);
    const worker = fs.readFileSync(dir + (dir === 'dist' ? '/sw.js' : '/sw-demo.js'), 'utf8');
    assert.match(worker, /scanner-assets\/tesseract/); assert.match(worker, /scanner-assets\/zxing/);
    new vm.Script(worker);
  }
});
