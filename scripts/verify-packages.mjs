import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { archiveDirectory } from './archive.mjs';
import { createDemoPdf } from './demo-pdf.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root)));
const sums = (await readFile(new URL('dist/SHA256SUMS.txt', root), 'utf8')).trim().split('\n');
assert.ok(sums.length >= 1 && sums.length <= 2);
for (const browser of ['chromium']) {
  const name = `${pkg.name}-${browser}-${pkg.version}.zip`;
  const bytes = await readFile(new URL(`dist/${name}`, root));
  assert.ok(sums.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`), 'Checksum mismatch');
  // Independently repackage to catch missing files, changed bytes and unstable metadata.
  assert.deepEqual(bytes, Buffer.from(await archiveDirectory(fileURLToPath(new URL(`dist/${browser}/`, root)))));
  const files = unzipSync(bytes);
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.default_locale, 'zh_CN');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  assert.equal(manifest.action.default_title, '__MSG_actionTitle__');
  const references = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);
  for (const locale of ['zh_CN', 'en']) {
    const resource = `_locales/${locale}/messages.json`;
    assert.ok(files[resource]?.length, `Missing ${resource}`);
    const bytes = Buffer.from(files[resource]);
    assert.deepEqual(bytes, await readFile(new URL(`extension/${resource}`, root)), `${resource}: source bytes differ`);
    const messages = JSON.parse(bytes);
    for (const key of references) {
      assert.equal(typeof messages[key]?.message, 'string', `${locale}: missing ${key}`);
      assert.ok(messages[key].message.trim(), `${locale}: empty ${key}`);
    }
  }
  assert.deepEqual(manifest.permissions, ['webRequest']);
  assert.deepEqual(manifest.host_permissions, ['https://elearning.fudan.edu.cn/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
  assert.match(manifest.content_security_policy.extension_pages, /(?:^|;)\s*worker-src 'self'\s*(?:;|$)/);
  const resources = ['viewer.html', 'viewer.mjs', 'viewer.css', 'reader.mjs', 'help.html', 'help.css',
    'popup.html', 'preview-cache.js', 'permission.html', 'permission.js', 'demo.pdf', 'demo.docx', 'demo.zip', 'pdf-reader.mjs', 'layout.mjs', 'heic.mjs', 'zip.mjs',
    'other-viewer.mjs', 'vendor/powerpoint.bundle.mjs', 'vendor/powerpoint.worker.mjs', 'vendor/web-ppt-core-LICENSE.txt', 'demo.pptx', 'vendor/docx.bundle.mjs', 'vendor/heic.worker.js', 'vendor/zip.worker.mjs',
    'vendor/heic-to-LICENSE.txt', 'vendor/fflate-LICENSE.txt', 'vendor/THIRD-PARTY-NOTICES.md',
    'vendor/heic-to-source.zip', 'vendor/libheif-1.23.5-source.tar.gz', 'vendor/libde265-1.0.16-source.tar.gz',
    'LICENSE.txt', 'vendor/PDFJS-LICENSE.txt', 'vendor/pdf.mjs',
    'vendor/pdf.worker.mjs', 'vendor/pdf_viewer.css', ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script) => script.js),
    ...(manifest.background.scripts || [manifest.background.service_worker])];
  for (const resource of resources) assert.ok(files[resource]?.length, `Missing ${resource}`);
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'images']) {
    assert.ok(Object.keys(files).some((name) => name.startsWith(`vendor/${directory}/`)));
  }
  assert.deepEqual(Buffer.from(files['demo.pdf']), createDemoPdf());
  for (const name of Object.keys(files)) {
    assert.ok(!name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..'), name);
    assert.ok(!/quickjs-eval|node_modules|\.DS_Store/.test(name), name);
    // Finder/iCloud conflict copies use a space and numeric suffix, including on directories.
    assert.ok(!name.split('/').some((part) => / \d+(?=\.|$)/.test(part)), `Duplicate copy: ${name}`);
  }
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.minimum_chrome_version, '120');
  assert.equal(manifest.browser_specific_settings, undefined);
  // A fixed DOS timestamp also makes the embedded ZIP portable across CI runs.
  const demoBytes = Buffer.from(files['demo.zip']);
  assert.equal(demoBytes.readUInt16LE(10), 0, 'demo ZIP time must be deterministic');
  assert.equal(demoBytes.readUInt16LE(12), 0x5021, 'demo ZIP date must be 2020-01-01');
  const demoZip = unzipSync(demoBytes);
  assert.ok(Object.keys(demoZip).some((name) => name.endsWith('.pdf')));
  assert.ok(Object.keys(demoZip).some((name) => name.endsWith('.docx')));
  assert.ok(Object.keys(demoZip).some((name) => name.endsWith('.pptx')));
  console.log(`${browser}: checksum, reproducibility, manifest and ${Object.keys(files).length} resources verified`);
}
if (sums.length === 2) {
  const name = `${pkg.name}-source-${pkg.version}.zip`;
  const bytes = await readFile(new URL(`dist/${name}`, root));
  assert.ok(sums.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`));
  const files = unzipSync(bytes);
  for (const name of ['package.json', 'package-lock.json', 'extension/viewer.mjs', 'tests/reader-modes.test.cjs', 'THIRD-PARTY-NOTICES.md', 'SOURCE-STATE.json']) assert.ok(files[name]?.length, name);
  assert.equal(JSON.parse(Buffer.from(files['package.json'])).version, pkg.version);
  assert.ok(!Object.keys(files).some((name) => /^(?:\.git|dist|node_modules|output)\//.test(name)));
  console.log('Complete working-tree source ZIP and checksum verified');
}
