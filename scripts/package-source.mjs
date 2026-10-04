import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
const names = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
const files = Object.create(null);
for (const name of names) {
  if (/^docs\/AUTHOR-MESSAGE\.md$/i.test(name)) continue;
  if (name.startsWith('/') || name.split('/').includes('..') || /^(?:\.git|node_modules|dist|output|backups)\//.test(name) || /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|log)$/.test(name)) continue;
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep)) throw new Error('Unsafe source path');
  try { if ((await stat(target)).isFile()) files[name] = await readFile(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const required of ['package.json', 'package-lock.json', 'extension/viewer.mjs', 'extension/heic.mjs', 'extension/zip.mjs', 'scripts/build.mjs', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
  if (!files[required]) throw new Error(`Source package missing ${required}`);
}
files['SOURCE-STATE.json'] = Buffer.from(JSON.stringify({
  version: pkg.version, baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  source: 'current working tree, including uncommitted additions',
}, null, 2) + '\n');
const name = `${pkg.name}-source-${pkg.version}.zip`;
const bytes = zipSync(files, { level: 6, mtime: new Date(2020, 0, 1), os: 0, attrs: 0 });
await writeFile(path.join(root, 'dist', name), bytes);
const installation = `${pkg.name}-chromium-${pkg.version}.zip`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(root, 'dist/SHA256SUMS.txt'), `${hash(await readFile(path.join(root, 'dist', installation)))}  ${installation}\n${hash(bytes)}  ${name}\n`);
console.log(`Source package: dist/${name} (${Object.keys(files).length} files)`);
