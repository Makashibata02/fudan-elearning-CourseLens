import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createDemoPdf } from './demo-pdf.mjs';
import { archiveDirectory } from './archive.mjs';
import { build } from 'esbuild';
import { createDemoDocx } from './demo-docx.mjs';
import { buildHeicWorker } from './heic-worker.mjs';
import { zipSync, strToU8 } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
const vendor = path.join(root, 'node_modules/pdfjs-dist');
const dist = path.join(root, 'dist');
const catalogContext = {};
vm.runInNewContext(await readFile(path.join(root, 'extension/catalog.js'), 'utf8'), catalogContext);
const sites = Array.from(catalogContext.CanvasPreviewCatalog.platforms, (platform) => `${platform.origin}/*`);
await mkdir(dist, { recursive: true });
// Only remove generated archives inside this project's dist directory.
for (const name of await readdir(dist)) {
  if (/^fudan-(?:ta-preview|elearning-pdf-preview(?:4ta)?|elearning-courselens)-(?:chromium|firefox|source)-\d+\.\d+\.\d+\.zip$/.test(name)) {
    await rm(path.join(dist, name));
  }
}
const retiredTarget = path.resolve(dist, 'firefox');
if (!retiredTarget.startsWith(dist + path.sep)) throw new Error('Unsafe retired build target');
await rm(retiredTarget, { recursive: true, force: true });
const checksums = [];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function icon(size) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const xx = x / size, yy = y / size;
    let rgb = [36, 86, 166];
    if (xx > .26 && xx < .74 && yy > .17 && yy < .83) rgb = [255, 255, 255];
    if (xx > .35 && xx < .65 && ((yy > .41 && yy < .47) || (yy > .55 && yy < .61) || (yy > .69 && yy < .75))) rgb = [36, 86, 166];
    const rounded = Math.hypot(Math.max(.15 - xx, 0, xx - .85), Math.max(.15 - yy, 0, yy - .85)) <= .15;
    data.set([...rgb, rounded ? 255 : 0], i);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}

for (const browser of ['chromium']) {
  const output = path.join(dist, browser);
  if (!output.startsWith(dist + path.sep)) throw new Error('Unsafe build target');
  await rm(output, { recursive: true, force: true });
  await cp(path.join(root, 'extension'), output, { recursive: true });
  await writeFile(path.join(output, 'demo.pdf'), createDemoPdf());
  await mkdir(path.join(output, 'vendor'), { recursive: true });
  const bundle = await build({ absWorkingDir: root, tsconfigRaw: {}, entryPoints: ['./extension/docx.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', outfile: path.join(output, 'vendor/docx.bundle.mjs'), minify: true, legalComments: 'eof', metafile: true });
  await build({ absWorkingDir: root, tsconfigRaw: {}, entryPoints: ['./extension/zip-worker.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', outfile: path.join(output, 'vendor/zip.worker.mjs'), minify: true, legalComments: 'eof' });
  await buildHeicWorker(root, output);
  await cp(path.join(root, 'node_modules/heic-to/LICENSE'), path.join(output, 'vendor/heic-to-LICENSE.txt'));
  await cp(path.join(root, 'node_modules/heic-to/dist/csp/heic-to.js'), path.join(output, 'vendor/heic-to-upstream-source.txt'));
  const heicSource = path.join(dist, 'heic-to-source');
  if (!heicSource.startsWith(dist + path.sep)) throw new Error('Unsafe source target');
  await rm(heicSource, { recursive: true, force: true });
  await cp(path.join(root, 'node_modules/heic-to/src'), path.join(heicSource, 'src'), { recursive: true });
  for (const file of ['README.md', 'LICENSE', 'package.json', 'esbuild.mjs']) await cp(path.join(root, 'node_modules/heic-to', file), path.join(heicSource, file));
  await cp(path.join(root, 'scripts/heic-worker.mjs'), path.join(heicSource, 'fudan-extract-worker.mjs'));
  await writeFile(path.join(output, 'vendor/heic-to-source.zip'), await archiveDirectory(heicSource));
  await rm(heicSource, { recursive: true, force: true });
  for (const file of ['libheif-1.23.5-source.tar.gz', 'libde265-1.0.16-source.tar.gz']) await cp(path.join(root, 'third_party', file), path.join(output, 'vendor', file));
  await cp(path.join(root, 'node_modules/fflate/LICENSE'), path.join(output, 'vendor/fflate-LICENSE.txt'));
  await cp(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(output, 'vendor/THIRD-PARTY-NOTICES.md'));
  const bundledPackages = new Set(Object.keys(bundle.metafile.inputs).map((input) => input.replaceAll('\\', '/').match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
  for (const name of bundledPackages) {
    const directory = path.join(root, 'node_modules', name);
    for (const file of await readdir(directory)) {
      if (/^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(file)) await cp(path.join(directory, file), path.join(output, 'vendor', `${name.replaceAll('/', '-')}-${file}`));
    }
  }
  await writeFile(path.join(output, 'demo.docx'), createDemoDocx());
  await writeFile(path.join(output, 'demo.zip'), zipSync({
    '作业/两页示例.pdf': createDemoPdf(), '作业/公式与表格.docx': createDemoDocx(),
    '说明.txt': strToU8('ZIP 内的文件可以通过顶部下拉框切换。\nPDF / DOCX 默认连续滚动，使用“手动翻页”一次显示一页。'),
  }));
  for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await cp(path.join(vendor, 'legacy/build', file), path.join(output, 'vendor', file));
  await cp(path.join(vendor, 'web/pdf_viewer.css'), path.join(output, 'vendor/pdf_viewer.css'));
  for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'web/images']) {
    await cp(path.join(vendor, dir), path.join(output, 'vendor', path.basename(dir)), {
      recursive: true, filter: (source) => !path.basename(source).startsWith('quickjs-eval'),
    });
  }
  await cp(path.join(vendor, 'LICENSE'), path.join(output, 'vendor/PDFJS-LICENSE.txt'));
  await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE.txt'));
  for (const [name, license] of [['docx-preview', 'LICENSE'], ['dompurify', 'LICENSE'], ['jszip', 'LICENSE.markdown'], ['pako', 'LICENSE']]) {
    await cp(path.join(root, 'node_modules', name, license), path.join(output, 'vendor', `${name}-LICENSE.txt`));
  }
  await mkdir(path.join(output, 'icons'));
  const icons = {};
  for (const size of [16, 32, 48, 128]) {
    icons[size] = `icons/icon-${size}.png`;
    await writeFile(path.join(output, icons[size]), icon(size));
  }
  const manifest = {
    manifest_version: 3, name: '__MSG_extensionName__', version: pkg.version,
    description: '__MSG_extensionDescription__', default_locale: 'zh_CN',
    homepage_url: 'https://github.com/Makashibata02/fudan-elearning-CourseLens',
    permissions: ['webRequest'],
    host_permissions: sites,
    optional_host_permissions: ['https://*/*'],
    content_scripts: [{ matches: sites, js: ['catalog.js', 'core.js', 'content.js'], run_at: 'document_idle' }],
    action: { default_popup: 'popup.html', default_title: '__MSG_actionTitle__', default_icon: icons },
    options_ui: { page: 'help.html', open_in_tab: true }, icons,
    web_accessible_resources: [{ resources: ['viewer.html'], matches: sites }],
    content_security_policy: { extension_pages: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' https: blob:; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'" },
    background: { service_worker: 'background.js' },
  };
  manifest.minimum_chrome_version = '120';
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const archive = path.join(dist, `${pkg.name}-${browser}-${pkg.version}.zip`);
  await writeFile(archive, await archiveDirectory(output));
  checksums.push(`${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${path.basename(archive)}`);
  console.log(`${browser}: ${archive}`);
}
await writeFile(path.join(dist, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
