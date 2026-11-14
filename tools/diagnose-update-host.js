// Read-only host audit. curl follows the environment's proxy and CA settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const base = new URL(process.argv[2] || 'https://phonebooks-update-test.pages.dev/phonebooks/');
if (base.protocol !== 'https:' || !base.pathname.endsWith('/')) throw new Error('Pass an HTTPS scope ending with /');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phonebooks-host-'));
try {
  const read = relative => {
    const file = path.join(dir, 'body');
    const info = JSON.parse(execFileSync('curl', ['--fail', '--silent', '--show-error', '--compressed', '--location', '--max-time', '60', '--output', file, '--write-out', '%{json}', new URL(relative, base).href], {encoding:'utf8'}));
    return { bytes: fs.readFileSync(file), status: info.http_code, redirects: info.num_redirects, final: info.url_effective };
  };
  const sw = read('sw.js'), text = sw.bytes.toString();
  const version = text.match(/const VERSION = '([^']+)'/)?.[1];
  const revisions = JSON.parse(text.match(/const REVISIONS = (.*);/)[1]);
  console.log(JSON.stringify({scope:base.href,version,workerSHA256:crypto.createHash('sha256').update(sw.bytes).digest('hex')}));
  let errors = 0;
  for (const [file, hashes] of Object.entries(revisions)) {
    const result = read(file);
    const valid = hashes.includes(crypto.createHash('sha256').update(result.bytes).digest('hex'));
    console.log(JSON.stringify({file,status:result.status,redirects:result.redirects,final:result.final,checksum:valid}));
    if (!valid || (result.redirects && file !== './index.html')) errors++;
  }
  const canonical = read('./');
  const valid = revisions['./index.html'].includes(crypto.createHash('sha256').update(canonical.bytes).digest('hex'));
  console.log(JSON.stringify({canonicalHTML:base.href,redirects:canonical.redirects,checksum:valid}));
  process.exitCode = errors || !valid || canonical.redirects ? 1 : 0;
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
