import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildServiceWorker } from './build-service-worker.js';
const commit = process.argv[2] || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('Pass the reviewed commit SHA');
// Review/download artifacts only: this script never uploads or deploys a site.
const output = path.resolve('work/device-test-artifacts');
const root = path.resolve('work/iphone-upload');
fs.mkdirSync(output, { recursive: true });
for (const dir of ['dist', 'work/update-fixtures/legacy']) {
  if (!fs.existsSync(path.join(dir, 'sw.js'))) throw new Error('Run npm run test:updates before preparing device artifacts');
}
const sources = [
  ['01-previous-published', 'work/update-fixtures/legacy', 'Предыдущая опубликованная сборка'],
  ['02-safe-current', 'dist', 'Исправленная сборка PR #7'],
  ['03-safe-repeat', 'dist', 'Повторная тестовая версия того же кода'],
];
for (const [label, source, title] of sources) {
  const dir = path.join(root, label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const app = path.join(dir, 'phonebooks');
  fs.cpSync(source, app, { recursive: true });
  if (label.startsWith('03')) {
    const index = path.join(app, 'index.html');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('</body>', '<!-- Device-only repeat release: accounting code unchanged. --></body>'));
    buildServiceWorker(app, fs.readFileSync('public/sw.js', 'utf8'));
  }
  const worker = fs.readFileSync(path.join(app, 'sw.js'), 'utf8');
  const version = worker.match(/const (?:VERSION|CACHE) = '([^']+)'/)[1];
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тест обновлений PhoneBooks</title><style>body{font:17px/1.6 system-ui;max-width:700px;margin:40px auto;padding:20px}a{display:inline-block;padding:12px 18px;background:#2459ef;color:white;border-radius:12px}code{overflow-wrap:anywhere}</style><h1>Тестовый стенд PhoneBooks</h1><h2>${label}: ${title}</h2><p>Только вымышленные данные. Это должен быть новый отдельный HTTPS-хост. Не используйте рабочий GitHub Pages или существующий phonebooks-demo.</p><p>Коммит PR: <code>${commit}</code></p><p>Версия оболочки: <code>${version}</code></p><a href="./phonebooks/#/settings">Открыть тестовое приложение</a><p>На iPhone назовите отдельный ярлык «PhoneBooks ТЕСТ». Рабочую резервную копию на стенд не импортируйте.</p></html>`);
  fs.writeFileSync(path.join(dir, 'test-build.json'), JSON.stringify({ stage: label, sourceCommit: label.startsWith('01') ? '832972e5407a6a08894f1df5e475cb7a5cf02ac1' : commit, version, scope: '/phonebooks/', syntheticDataOnly: true }, null, 2));
  execFileSync('python3', ['-c', 'import sys,pathlib,zipfile;root=pathlib.Path(sys.argv[1]);z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED);[(z.write(p,p.relative_to(root))) for p in sorted(root.rglob("*")) if p.is_file()];z.close()', dir, path.join(output, label + '.zip')]);
  console.log(label, version);
}
fs.copyFileSync('docs/IPHONE_UPDATE_TEST.md', path.join(output, 'iPhone-safe-update-test.md'));
execFileSync('python3', ['-c', 'import pathlib,hashlib,json,sys;r=pathlib.Path(sys.argv[1]);files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in r.glob("*.zip")};(r/"SHA256SUMS.json").write_text(json.dumps(files,indent=2))', output]);
