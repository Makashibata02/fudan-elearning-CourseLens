import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDemoPdf } from './demo-pdf.mjs';
import { createDemoDocx } from './demo-docx.mjs';
import { createDemoPptx } from './demo-pptx.mjs';
import { zipSync, strToU8 } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright/ci');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'canvas-preview-smoke-'));
const channel = process.env.BROWSER_CHANNEL || 'chromium';
assert.ok(['chromium', 'chrome', 'msedge'].includes(channel));
const report = { platform: process.platform, channel, checks: [], passed: false };
const downloads = [], pageErrors = [], unexpectedRequests = [];
report.network = []; report.consoleErrors = [];
const pdf = createDemoPdf(), docx = createDemoDocx(), pptx = createDemoPptx();
const ppt = await readFile(path.join(root, 'tests/fixtures/basic-test.ppt'));
const heic = await readFile(path.join(root, 'tests/fixtures/with-alpha-512x512.heic'));
const zipEntries = { '作业/答案.pdf': pdf, '作业/过程.docx': docx, '照片.heic': heic, '课件/现代课件.pptx': pptx, '课件/旧版课件.ppt': ppt, '说明.txt': strToU8('ZIP 中文答案') };
let zip = zipSync(zipEntries), jpeg;
const files = new Map([['456', ['application/pdf', pdf]], ['457', ['application/octet-stream', docx]], ['458', ['image/heic', heic]], ['459', ['application/zip', zip]], ['460', ['application/octet-stream', pptx]], ['461', ['application/vnd.ms-powerpoint', ppt]]]);
const courseHTML = '<!doctype html><html lang="zh"><head><title>模拟课程</title><link rel="icon" href="data:,"></head><body><h1>模拟课程（无真实学生资料）</h1>' +
  '<a id="pdf" href="/files/456">演示文件.pdf</a> <a id="docx" href="/files/457">公式.docx</a> <a id="heic" href="/files/458">苹果照片.heic</a> <a id="zip" href="/files/459">作业.zip</a> ' +
  '<a id="pptx" href="/files/460">现代课件.pptx</a> <a id="ppt" href="/files/461">旧版课件.ppt</a> <a id="jiff" href="/files/462">照片.jiff</a> <a id="jfif" href="/files/462">照片.jfif</a> <a id="redirect" href="/files/999">跨服务器.pdf</a> <a id="denied" href="/files/789">权限失效.pdf</a> <a class="download" href="/files/456/download" download>原下载</a></body></html>';
const taHTML = '<!doctype html><html lang="zh"><head><title>模拟 SpeedGrader</title><link rel="icon" href="data:,"></head><body>' +
  '<style>body{margin:0;font:14px/1.6 system-ui,sans-serif;color:#24344a;background:#eef1f5}header{padding:14px 24px;background:white;border-bottom:1px solid #d9e1eb;display:flex;align-items:center;justify-content:space-between}header strong{font-size:18px}header span{color:#728094}.review-layout{display:grid;grid-template-columns:minmax(0,1fr)320px;gap:16px;padding:16px;height:calc(100vh - 80px);box-sizing:border-box}#left_side{position:relative;height:100%;border:1px solid #d9e1eb;border-radius:8px;overflow:hidden}#right_side{padding:22px;background:white;border:1px solid #d9e1eb;border-radius:8px}h2{margin:0 0 18px;font-size:18px}label{display:block;margin:20px 0 8px;font-weight:600}input,textarea{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid #c6d2e2;border-radius:6px}textarea{height:140px}button{font:inherit;padding:7px 12px;background:white;border:1px solid #c6d2e2;border-radius:6px;cursor:pointer}#next-student-button{margin-top:18px}a{color:#2456a6}.hint{color:#728094;font-size:12px}</style>' +
  '<header><strong>课程作业 · 模拟批改页面</strong><span>测试文件与虚构学生，无真实课程数据</span></header><main class="review-layout"><div id="left_side"></div><div id="right_side"><h2>作业批改</h2><p class="hint">学生 A · 测试提交</p>' +
  '<div id="submission_files_list"><a class="display_name" href="/courses/123/assignments/456/submissions/10?download=456&inline=1">演示文件.pdf</a></div>' +
  '<label for="grade">成绩</label><input id="grade" value="7"><label for="comment">评语草稿</label><textarea id="comment">尚未提交的评语</textarea><button id="next-student-button">切换学生</button></div></main></body></html>';
let context, phase = 'launch';
async function check(name, action) { phase = name; await action(); report.checks.push(name); console.log(`PASS ${name}`); }
async function rendered(viewer, text) {
  try { await viewer.locator('#status').waitFor({ state: 'hidden', timeout: 70000 }); }
  catch (error) { throw new Error(`${await viewer.locator('#status').textContent()}\n${error.message}`); }
  if (text) await viewer.locator('.textLayer').filter({ hasText: text }).first().waitFor({ state: 'visible' });
}
async function panel(page) {
  const iframe = page.locator('#fdta-preview iframe'); await iframe.waitFor({ state: 'visible' });
  return (await iframe.elementHandle()).contentFrame();
}
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel }),
    headless: process.env.HEADED !== '1', viewport: { width: 1400, height: 950 }, acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${path.join(root, 'dist/chromium')}`, `--load-extension=${path.join(root, 'dist/chromium')}`],
  });
  context.setDefaultTimeout(30000);
  await context.addInitScript(() => {
    window.courselensMenuTrace = [];
    const property = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
    Object.defineProperty(HTMLElement.prototype, 'hidden', {
      get() { return property.get.call(this); },
      set(value) {
        if (this.id === 'more-menu') window.courselensMenuTrace.push({ value, stack: new Error().stack });
        property.set.call(this, value);
      },
    });
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, (event) => {
      window.courselensMenuTrace.push({ type, target: event.target.id || event.target.tagName, x: event.clientX, y: event.clientY });
    }, true);
  });
  const watch = (page) => { page.on('download', (file) => downloads.push(file)); page.on('pageerror', (error) => pageErrors.push(error.message)); page.on('console', (msg) => { if (msg.type() === 'error') report.consoleErrors.push(msg.text()); }); };
  context.on('page', watch); context.pages().forEach(watch);
  context.on('request', (request) => { if (request.url().startsWith('https://')) report.network.push({ event: 'request', url: request.url(), type: request.resourceType() }); });
  context.on('requestfinished', (request) => { if (request.url().startsWith('https://')) report.network.push({ event: 'finished', url: request.url() }); });
  context.on('requestfailed', (request) => { if (request.url().startsWith('https://')) report.network.push({ event: 'failed', url: request.url(), failure: request.failure() }); });
  // Intercept every HTTP request, including permissions tests. No real login/profile.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    if (url.origin === 'https://elearning.fudan.edu.cn') {
      const id = url.pathname.match(/\/files\/(\d+)\/download$/)?.[1] || url.searchParams.get('download');
      if (id === '789') return route.fulfill({ status: 403, body: 'Forbidden' });
      if (id === '999') return route.fulfill({ status: 302, headers: { location: 'https://files.example.test/demo.pdf' } });
      if (id && files.has(id)) {
        if (url.pathname.includes('/submissions/') && route.request().headers().accept !== '*/*') return route.fulfill({ status: 406, body: 'Not acceptable' });
        const [contentType, body] = files.get(id); return route.fulfill({ contentType, body: Buffer.from(body) });
      }
      if (url.pathname === '/courses/123/assignments/456') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: courseHTML });
      if (url.pathname === '/courses/123/gradebook/speed_grader') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: taHTML });
    }
    if (url.href === 'https://files.example.test/demo.pdf') return route.fulfill({ contentType: 'application/pdf', body: pdf });
    unexpectedRequests.push(url.href); return route.abort('blockedbyclient');
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = new URL('/', worker.url()).href;
  const diagnostic = await context.newPage(); await diagnostic.goto(`${base}popup.html`);
  // Generate a genuine JPEG/JFIF fixture with the browser's own encoder.
  jpeg = Buffer.from(await diagnostic.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
    const draw = canvas.getContext('2d'); draw.fillStyle = '#d94c47'; draw.fillRect(0, 0, 60, 80); draw.fillStyle = '#4b9e76'; draw.fillRect(60, 0, 60, 80);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  }), 'base64');
  files.set('462', ['application/octet-stream', jpeg]);
  zip = zipSync({ ...zipEntries, '照片/答案.jiff': jpeg }); files.set('459', ['application/zip', zip]);
  report.userAgent = await diagnostic.evaluate(() => navigator.userAgent);
  await check('restricted default permissions and installation welcome', async () => {
    report.permissions = await diagnostic.evaluate(() => chrome.permissions.getAll());
    assert.deepEqual(report.permissions.origins, ['https://elearning.fudan.edu.cn/*']); assert.deepEqual(report.permissions.permissions, ['webRequest']);
    const deadline = Date.now() + 30000;
    while (!context.pages().some((p) => p.url() === `${base}help.html`) && Date.now() < deadline) await delay(100);
    assert.ok(context.pages().some((p) => p.url() === `${base}help.html`));
    const welcome = context.pages().find((page) => page.url() === `${base}help.html`);
    await welcome.locator('h1').filter({ hasText: '课程附件，点开就能看' }).waitFor();
    assert.equal(await welcome.locator('.sample-links a').count(), 4);
    assert.equal(await welcome.locator('body').evaluate((body) => /2\.3\.0|更新记录|开发版|审核|尚未上传/.test(body.textContent)), false);
    await welcome.screenshot({ path: path.join(output, 'welcome-page.png'), fullPage: true });
  });
  await check('offline PDF and ZIP demos', async () => {
    await context.setOffline(true);
    try {
      await diagnostic.goto(`${base}viewer.html?demo=1`); await rendered(diagnostic, 'PDF preview works');
      assert.equal(await diagnostic.locator('#page-count').textContent(), '/ 2'); assert.equal(await diagnostic.locator('#original').count(), 0);
      await diagnostic.goto(`${base}viewer.html?demo=zip`); await rendered(diagnostic);
      assert.equal(await diagnostic.locator('#archive-entry option').count(), 4);
      await diagnostic.goto(`${base}viewer.html?demo=pptx`); await rendered(diagnostic);
      assert.equal(await diagnostic.locator('.ppt-page').count(), 2); await diagnostic.locator('.ppt-page svg text').filter({ hasText: 'CourseLens' }).first().waitFor({ state: 'visible' });
    } finally { await context.setOffline(false); }
  });
  const course = await context.newPage(); await course.goto('https://elearning.fudan.edu.cn/courses/123/assignments/456');
  let viewer;
  await check('course PDF modal, default scroll and full-page fit', async () => {
    const count = context.pages().length; await course.locator('#pdf').click(); viewer = await panel(course); await rendered(viewer, 'PDF preview works');
    assert.equal(context.pages().length, count); assert.equal(await course.getByRole('dialog').count(), 1);
    assert.equal(await viewer.locator('#reading-mode').inputValue(), 'scroll'); assert.equal(await viewer.locator('#fit-mode').inputValue(), 'page');
    const fits = await viewer.evaluate(() => document.querySelector('.paper').getBoundingClientRect().height < document.getElementById('workspace').clientHeight);
    assert.ok(fits);
    const centers = await viewer.locator('#pdf-controls').evaluate((group) => {
      const middle = (node) => { const rect = node.getBoundingClientRect(); return rect.top + rect.height / 2; };
      return ['#previous', '.page-label', '#page', '#page-count', '#next'].map((selector) => middle(group.querySelector(selector)) - middle(group));
    });
    assert.ok(centers.every((offset) => Math.abs(offset) <= 1), `Page controls must be vertically centered: ${centers}`);
    const centered = await viewer.evaluate(() => {
      const input = document.getElementById('page'), count = document.getElementById('page-count');
      const results = [];
      for (const [current, total] of [['1', '5'], ['24', '128'], ['1000', '10000']]) {
        input.value = current; input.dispatchEvent(new Event('input')); count.textContent = `/ ${total}`;
        const label = input.closest('label').getBoundingClientRect(), end = count.getBoundingClientRect(), group = document.getElementById('pdf-controls').getBoundingClientRect();
        results.push(Math.abs((label.left + end.right) / 2 - (group.left + group.right) / 2) <= 1);
      }
      input.value = '1'; input.dispatchEvent(new Event('input')); count.textContent = '/ 2'; return results.every(Boolean);
    });
    assert.ok(centered, 'Current page and total pages must be centered as one unit for different digit lengths');
    await course.locator('#fdta-preview section').screenshot({ path: path.join(output, 'page-number-alignment.png') });
    await viewer.locator('#pdf-controls').screenshot({ path: path.join(output, 'page-controls-centered.png') });
  });
  await check('preview fullscreen expands in place, restores with button or Escape, and does not reload the attachment', async () => {
    const pages = context.pages().length, frame = viewer, requests = report.network.filter((item) => item.event === 'request' && item.type === 'fetch').length;
    await viewer.evaluate(() => { window.courselensFullscreenIdentity = 'same-context'; });
    const size = await course.locator('#fdta-preview section').boundingBox();
    await course.locator('[data-action="fullscreen"]').click();
    assert.ok(await course.locator('#fdta-preview').evaluate((host) => { const rect = host.getBoundingClientRect(); return rect.left === 0 && rect.top === 0 && Math.abs(rect.width - innerWidth) <= 1 && Math.abs(rect.height - innerHeight) <= 1; }));
    assert.equal(await course.locator('[data-action="fullscreen"]').getAttribute('aria-label'), '还原窗口');
    assert.equal(await frame.evaluate(() => window.courselensFullscreenIdentity), 'same-context');
    await frame.waitForFunction(() => document.querySelector('.paper').getBoundingClientRect().height < document.getElementById('workspace').clientHeight);
    await course.screenshot({ path: path.join(output, 'fullscreen-preview.png') });
    await course.locator('[data-action="fullscreen"]').click();
    const restored = await course.locator('#fdta-preview section').boundingBox(); assert.deepEqual(restored, size);
    await course.locator('[data-action="fullscreen"]').click();
    await viewer.locator('#workspace').click({ position: { x: 5, y: 5 } }); await viewer.locator('#workspace').press('Escape');
    assert.equal(await course.locator('#fdta-preview').getAttribute('data-fullscreen'), null); assert.equal(await course.locator('#fdta-preview').isVisible(), true);
    assert.equal(context.pages().length, pages); assert.equal(report.network.filter((item) => item.event === 'request' && item.type === 'fetch').length, requests);
    assert.equal(await frame.evaluate(() => window.courselensFullscreenIdentity), 'same-context');
  });
  await check('automatic exit cleanup revokes file URLs and rereads on reopening', async () => {
    await viewer.locator('#more-toggle').click(); assert.equal(await viewer.locator('#auto-clear').isChecked(), true);
    await viewer.locator('#more-toggle').click();
    const blob = await viewer.locator('#download').getAttribute('href');
    const before = report.network.filter((item) => item.event === 'request' && item.type === 'fetch').length;
    await course.locator('[data-action="close"]').click();
    await course.locator('#fdta-preview').waitFor({ state: 'detached' });
    assert.equal(await diagnostic.evaluate(async (url) => { try { await fetch(url); return false; } catch { return true; } }, blob), true);
    await course.locator('#pdf').click(); viewer = await panel(course); await rendered(viewer, 'PDF preview works');
    assert.ok(report.network.filter((item) => item.event === 'request' && item.type === 'fetch').length > before);
  });
  await check('cleanup preference persists, temporary cache reuses exact bytes, and enabling cleanup discards it', async () => {
    await viewer.locator('#more-toggle').click(); await viewer.locator('#auto-clear').uncheck();
    await viewer.waitForFunction(async () => Boolean((await chrome.runtime.sendMessage({ type: 'preview-cache-get' }))?.data));
    await course.locator('[data-action="close"]').click();
    const before = report.network.filter((item) => item.event === 'request' && item.type === 'fetch').length;
    await course.locator('#pdf').click(); viewer = await panel(course); await rendered(viewer, 'PDF preview works');
    assert.equal(report.network.filter((item) => item.event === 'request' && item.type === 'fetch').length, before);
    await viewer.locator('#more-toggle').click(); assert.equal(await viewer.locator('#auto-clear').isChecked(), false);
    await viewer.locator('#auto-clear').check();
    await viewer.waitForFunction(async () => !(await chrome.runtime.sendMessage({ type: 'preview-cache-get' }))?.data);
    await course.locator('[data-action="close"]').click(); await course.locator('#pdf').click(); viewer = await panel(course); await rendered(viewer, 'PDF preview works');
    assert.ok(report.network.filter((item) => item.event === 'request' && item.type === 'fetch').length > before);
    await viewer.locator('#more-toggle').click(); assert.equal(await viewer.locator('#auto-clear').isChecked(), true); await viewer.locator('#more-toggle').click();
  });
  await check('scroll tracking, manual navigation and zoom', async () => {
    await viewer.locator('#workspace').evaluate((root) => { root.scrollTop = root.scrollHeight; });
    await viewer.waitForFunction(() => document.getElementById('page').value === '2');
    await viewer.locator('#more-toggle').click(); await viewer.locator('#reading-mode').selectOption('page'); await viewer.locator('#more-toggle').click(); await viewer.locator('#previous').click(); await rendered(viewer, 'PDF preview works');
    assert.equal(await viewer.locator('.pdf-page:not([hidden])').count(), 1);
    await viewer.locator('#next').click(); await rendered(viewer, 'Second page');
    const before = await viewer.locator('#zoom-label').textContent(); await viewer.locator('#zoom-in').click();
    await viewer.waitForFunction((before) => document.getElementById('zoom-label').textContent !== before, before);
    await viewer.locator('#fit-mode').selectOption('width'); await viewer.locator('#fit-mode').selectOption('page');
    await viewer.locator('#more-toggle').click(); await viewer.locator('#reading-mode').selectOption('scroll'); await viewer.locator('#more-toggle').click(); assert.equal(await viewer.locator('.pdf-page:not([hidden])').count(), 2);
    assert.equal(downloads.length, 0);
  });
  await check('explicit download exact bytes and optional new tab', async () => {
    const pending = course.waitForEvent('download'); await viewer.locator('#download').click(); const file = await pending;
    assert.equal(file.suggestedFilename(), '演示文件.pdf'); assert.equal(await file.failure(), null);
    const stream = await file.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), pdf);
    const pageCount = context.pages().length;
    await viewer.locator('#download-toggle').click();
    assert.deepEqual(await viewer.locator('#download-menu a').allTextContents(), ['下载当前文件', '下载原始文件']);
    assert.equal(await viewer.locator('#download-original').getAttribute('href'), await viewer.locator('#download').getAttribute('href'));
    const originalPending = course.waitForEvent('download'); await viewer.locator('#download-original').click(); const originalFile = await originalPending;
    const originalStream = await originalFile.createReadStream(), originalChunks = []; for await (const chunk of originalStream) originalChunks.push(chunk); assert.deepEqual(Buffer.concat(originalChunks), pdf);
    assert.equal(context.pages().length, pageCount); await viewer.locator('#download-toggle').click();
    const opened = context.waitForEvent('page'); await viewer.locator('#more-toggle').click(); await viewer.locator('#standalone').click(); await viewer.locator('#more-toggle').click(); const standalone = await opened;
    await rendered(standalone, 'PDF preview works'); assert.ok(standalone.url().startsWith(base)); await standalone.close();
  });
  await check('DOCX pages and actual HEIC worker rendering', async () => {
    await course.locator('[data-action="close"]').click(); await course.locator('#docx').click(); viewer = await panel(course); await rendered(viewer);
    assert.ok(await viewer.locator('section.docx').count() >= 2);
    await viewer.locator('#fit-mode').selectOption('width');
    await course.locator('#fdta-preview section').screenshot({ path: path.join(output, 'docx-modal.png') });
    await viewer.locator('#fit-mode').selectOption('page');
    await viewer.locator('#more-toggle').click(); await viewer.locator('#reading-mode').selectOption('page'); await viewer.locator('#more-toggle').click(); await viewer.locator('#next').click(); assert.equal(await viewer.locator('section.docx:not([hidden])').count(), 1);
    await course.locator('[data-action="close"]').click(); await course.locator('#heic').click(); viewer = await panel(course); await rendered(viewer);
    assert.ok(await viewer.locator('#other-document canvas').evaluate((el) => el.width === 512 && el.height === 512));
    await course.screenshot({ path: path.join(output, 'heic-modal.png') });
  });
  await check('compact menus support keyboard dismissal and narrow image previews hide page navigation', async () => {
    assert.equal(await viewer.locator('#pdf-controls').isVisible(), false);
    assert.equal(await viewer.locator('#clear-preview').count(), 0);
    assert.equal(await viewer.locator('.brand').isVisible(), false);
    await viewer.locator('#more-toggle').focus(); await viewer.locator('#more-toggle').press('ArrowDown');
    assert.equal(await viewer.locator('#more-menu').isVisible(), true);
    assert.equal(await viewer.locator('#auto-clear').evaluate((input) => document.activeElement === input), true);
    await viewer.locator('#auto-clear').press('Escape');
    assert.equal(await viewer.locator('#more-menu').isVisible(), false); assert.equal(await course.locator('#fdta-preview').isVisible(), true);
    await course.setViewportSize({ width: 390, height: 700 });
    await viewer.waitForFunction(() => {
      const rect = document.querySelector('#other-document canvas').getBoundingClientRect(), root = document.getElementById('workspace');
      return rect.width <= root.clientWidth - 16 && rect.height <= root.clientHeight - 16;
    });
    await viewer.locator('#more-toggle').click();
    assert.ok(await viewer.locator('#more-menu').evaluate((menu) => { const rect = menu.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; }));
    await course.screenshot({ path: path.join(output, 'narrow-more-menu.png') });
    await viewer.locator('#more-toggle').click(); await course.setViewportSize({ width: 1400, height: 950 });
  });
  await check('open menus stay visible and within the preview when its viewport changes', async () => {
    for (const name of ['more', 'download']) {
      await viewer.locator(`#${name}-toggle`).click();
      for (const width of [1100, 700, 390, 1400]) {
        await course.setViewportSize({ width, height: 950 });
        await viewer.waitForFunction((name) => {
          const menu = document.getElementById(`${name}-menu`), trigger = document.getElementById(`${name}-toggle`);
          const rect = menu.getBoundingClientRect(), button = trigger.getBoundingClientRect();
          return !menu.hidden && trigger.getAttribute('aria-expanded') === 'true' && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && Math.abs(rect.top - button.bottom - 6) <= 1;
        }, name);
      }
      await viewer.locator(`#${name}-toggle`).click();
    }
  });
  await check('JIFF and JFIF course attachments and local files decode real JPEG bytes without changing downloads', async () => {
    for (const extension of ['jiff', 'jfif']) {
      await course.locator('[data-action="close"]').click(); await course.locator(`#${extension}`).click(); viewer = await panel(course); await rendered(viewer);
      assert.deepEqual(await viewer.locator('#other-document img').evaluate((image) => [image.naturalWidth, image.naturalHeight]), [120, 80]);
      assert.equal(await viewer.locator('#pdf-controls').isVisible(), false);
      assert.equal(await viewer.locator('#download').getAttribute('download'), `照片.${extension}`);
    }
    const pending = course.waitForEvent('download'); await viewer.locator('#download').click(); const download = await pending;
    const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), jpeg);
    const local = await context.newPage(); await local.goto(`${base}viewer.html`);
    assert.ok((await local.locator('#local-file').getAttribute('accept')).includes('.jiff'));
    await local.locator('#local-file').setInputFiles({ name: '本地照片.jiff', mimeType: 'image/jpeg', buffer: jpeg }); await rendered(local);
    assert.deepEqual(await local.locator('#other-document img').evaluate((image) => [image.naturalWidth, image.naturalHeight]), [120, 80]);
    await local.close();
    await course.screenshot({ path: path.join(output, 'jiff-preview.png') });
  });
  await check('PPTX and real binary PPT render in modals with manual slide navigation', async () => {
    await course.locator('[data-action="close"]').click(); await course.locator('#pptx').click(); viewer = await panel(course); await rendered(viewer);
    assert.equal(await viewer.locator('.ppt-page').count(), 2); assert.equal(await viewer.locator('#reading-mode').inputValue(), 'scroll');
    assert.ok(await viewer.locator('.ppt-page').first().evaluate((el) => el.getBoundingClientRect().height < document.getElementById('workspace').clientHeight));
    await viewer.locator('#more-toggle').click(); await viewer.locator('#reading-mode').selectOption('page'); await viewer.locator('#more-toggle').click(); await viewer.locator('#next').click();
    assert.equal(await viewer.locator('.ppt-page:not([hidden])').count(), 1); await viewer.locator('.ppt-page:not([hidden]) svg text').filter({ hasText: '第二页' }).first().waitFor({ state: 'visible' });
    await viewer.locator('#fit-mode').selectOption('width'); await viewer.locator('#fit-mode').selectOption('page'); await course.screenshot({ path: path.join(output, 'pptx-modal.png') });
    await course.locator('[data-action="close"]').click(); await course.locator('#ppt').click(); viewer = await panel(course); await rendered(viewer);
    await viewer.locator('.ppt-page svg text').filter({ hasText: 'This is a test title' }).first().waitFor({ state: 'visible' }); assert.equal(await viewer.locator('#badge').textContent(), 'PPT');
    await course.screenshot({ path: path.join(output, 'ppt-modal.png') });
  });
  await check('ZIP previews PDF, DOCX, PPT, PPTX, HEIC and Chinese text', async () => {
    await course.locator('[data-action="close"]').click(); await course.locator('#zip').click(); viewer = await panel(course); await rendered(viewer);
    assert.equal(await viewer.locator('#archive-entry option').count(), 7);
    for (const [suffix, selector] of [['.pdf', '.paper canvas'], ['.docx', 'section.docx'], ['.pptx', '.ppt-page svg'], ['.ppt', '.ppt-page svg'], ['.heic', '#other-document canvas'], ['.jiff', '#other-document img'], ['.txt', '#other-document pre']]) {
      const value = await viewer.locator('#archive-entry option').evaluateAll((options, suffix) => options.find((option) => option.textContent.endsWith(suffix)).value, suffix);
      await viewer.locator('#archive-entry').selectOption(value); await rendered(viewer); await viewer.locator(selector).first().waitFor({ state: 'visible' });
      if (suffix === '.txt') assert.equal(await viewer.locator(selector).textContent(), 'ZIP 中文答案');
    }
    const selectedText = await viewer.locator('#archive-entry').inputValue();
    const selectedPdf = await viewer.locator('#archive-entry option').evaluateAll((options) => options.find((option) => option.textContent.endsWith('.pdf')).value);
    await viewer.locator('#archive-entry').selectOption(selectedPdf); await rendered(viewer, 'PDF preview works');
    await course.locator('#fdta-preview section').screenshot({ path: path.join(output, 'zip-modal.png') });
    await viewer.locator('#archive-entry').selectOption(selectedText); await rendered(viewer);
    const currentPending = course.waitForEvent('download'); await viewer.locator('#download').click(); const currentFile = await currentPending;
    const currentStream = await currentFile.createReadStream(), currentChunks = []; for await (const chunk of currentStream) currentChunks.push(chunk); assert.deepEqual(Buffer.concat(currentChunks), Buffer.from(strToU8('ZIP 中文答案')));
    const pages = context.pages().length;
    await viewer.locator('#download-toggle').click(); assert.equal(await viewer.locator('#download-original').isVisible(), true);
    assert.equal(await viewer.locator('#download-current').getAttribute('href'), await viewer.locator('#download').getAttribute('href'));
    assert.notEqual(await viewer.locator('#download-original').getAttribute('href'), await viewer.locator('#download').getAttribute('href'));
    await course.screenshot({ path: path.join(output, 'zip-download-menu.png') });
    const pending = course.waitForEvent('download'); await viewer.locator('#download-original').click(); const file = await pending;
    const stream = await file.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), Buffer.from(zip));
    assert.equal(context.pages().length, pages);
    await viewer.locator('#download-toggle').click();
    const archiveBlob = await viewer.locator('#download-original').getAttribute('href');
    await course.locator('[data-action="close"]').click();
    assert.equal(await diagnostic.evaluate(async (url) => { try { await fetch(url); return false; } catch { return true; } }, archiveBlob), true);
    await course.locator('#zip').click(); viewer = await panel(course); await rendered(viewer);
  });
  await check('Escape and native download controls', async () => {
    await course.keyboard.press('Escape'); await course.locator('#fdta-preview').waitFor({ state: 'detached' });
    await course.evaluate(() => document.addEventListener('click', (event) => { if (event.target.closest('a.download')) { document.documentElement.dataset.unchanged = String(!event.defaultPrevented); event.preventDefault(); } }));
    await course.locator('a.download').click(); assert.equal(await course.evaluate(() => document.documentElement.dataset.unchanged), 'true');
  });
  await check('SpeedGrader submission HTTP 406 regression, student switching and drafts', async () => {
    const ta = await context.newPage(); await ta.goto('https://elearning.fudan.edu.cn/courses/123/gradebook/speed_grader?student_id=10');
    await ta.locator('.display_name').click(); await rendered(await panel(ta), 'PDF preview works'); assert.equal(await ta.getByRole('dialog').count(), 0);
    const taFrame = await panel(ta);
    await taFrame.evaluate(() => { window.courselensFullscreenIdentity = 'same-ta-context'; });
    await ta.locator('#left_side').evaluate((left) => { left.style.transform = 'translateZ(0)'; left.style.overflow = 'hidden'; });
    await ta.locator('[data-action="fullscreen"]').click();
    assert.ok(await ta.locator('#fdta-preview').evaluate((host) => { const rect = host.getBoundingClientRect(); return rect.left === 0 && rect.top === 0 && Math.abs(rect.width - innerWidth) <= 1 && Math.abs(rect.height - innerHeight) <= 1; }));
    await ta.locator('[data-action="fullscreen"]').click();
    assert.equal(await ta.locator('#left_side #fdta-preview').count(), 1);
    assert.equal(await taFrame.evaluate(() => window.courselensFullscreenIdentity), 'same-ta-context');
    await ta.locator('#next-student-button').click(); await ta.locator('#fdta-preview iframe').waitFor({ state: 'hidden' });
    await ta.evaluate(() => { history.replaceState(null, '', '?student_id=11'); const a = document.querySelector('.display_name'); a.href = '/courses/123/assignments/456/submissions/11?download=457&inline=1'; a.textContent = '下一位.docx'; });
    const next = await panel(ta); await rendered(next); await next.locator('section.docx').first().waitFor({ state: 'visible' });
    assert.equal(await ta.locator('#grade').inputValue(), '7'); assert.equal(await ta.locator('#comment').inputValue(), '尚未提交的评语');
    await ta.screenshot({ path: path.join(output, 'ta-reader.png') });
    await ta.locator('#next-student-button').click();
    await ta.evaluate(() => { history.replaceState(null, '', '?student_id=12'); const a = document.querySelector('.display_name'); a.href = '/courses/123/assignments/456/submissions/12?download=460&inline=1'; a.textContent = '下一位.pptx'; });
    const slides = await panel(ta); await rendered(slides); await slides.locator('.ppt-page svg').first().waitFor({ state: 'visible' });
    assert.equal(await slides.locator('.ppt-page').count(), 2); assert.equal(await ta.getByRole('dialog').count(), 0);
    assert.equal(await ta.locator('#grade').inputValue(), '7'); assert.equal(await ta.locator('#comment').inputValue(), '尚未提交的评语');
    await ta.screenshot({ path: path.join(output, 'ta-pptx.png') });
  });
  await check('403, cross-host authorization and rejection of untrusted sources', async () => {
    await course.locator('#denied').click(); const denied = await panel(course);
    await denied.waitForFunction(() => document.getElementById('status-detail').textContent.includes('登录已失效')); assert.equal(await denied.locator('#grant').isVisible(), false);
    const redirect = await context.newPage(); await redirect.goto(`${base}viewer.html?source=https://elearning.fudan.edu.cn/files/999/download&name=redirect.pdf`);
    await redirect.locator('#permission-prompt').waitFor({ state: 'visible' }); await redirect.locator('#prompt-later').click(); await redirect.locator('#more-toggle').click(); await redirect.locator('#grant-more').waitFor({ state: 'visible' }); assert.match(await redirect.locator('#status-detail').textContent(), /files\.example\.test/);
    assert.deepEqual(await redirect.evaluate(() => chrome.permissions.getAll()), report.permissions);
    const invalid = await context.newPage(); await invalid.goto(`${base}viewer.html?source=https://example.invalid/private.pdf`);
    await invalid.waitForFunction(() => document.getElementById('status-title').textContent === '打开作业文件'); assert.equal(await invalid.locator('#download').isVisible(), false);
  });
  await check('embedded permission reminder appears once and uses a cancellable small window from More', async () => {
    await course.locator('[data-action="close"]').click(); await course.locator('#redirect').click(); viewer = await panel(course);
    await viewer.locator('#permission-prompt').waitFor({ state: 'visible' }); await viewer.locator('#prompt-later').click();
    await course.locator('[data-action="close"]').click(); await course.locator('#redirect').click(); viewer = await panel(course);
    await viewer.waitForFunction(() => document.getElementById('status-title').textContent.includes('需要允许'));
    assert.equal(await viewer.locator('#permission-prompt').isVisible(), false);
    await viewer.locator('#more-toggle').click();
    assert.equal(await viewer.locator('#more-menu').isVisible(), true);
    await course.setViewportSize({ width: 1200, height: 820 });
    await viewer.waitForFunction(() => !document.getElementById('more-menu').hidden && document.getElementById('more-toggle').getAttribute('aria-expanded') === 'true');
    const opened = context.waitForEvent('page'); opened.catch(() => {});
    await viewer.locator('#grant-more').click(); const permission = await opened;
    await permission.locator('#host').filter({ hasText: 'files.example.test' }).waitFor();
    assert.equal(await permission.locator('#allow').isEnabled(), true);
    assert.equal(await viewer.locator('#status-title').textContent(), '需要允许读取文件服务器');
    const closed = permission.waitForEvent('close'); closed.catch(() => {});
    await permission.locator('#cancel').click({ noWaitAfter: true }).catch((error) => {
      // A self-closing popup can destroy its target before headless Chromium acknowledges the click.
      // Accept only that error for this popup, then independently require its close event and a live reader.
      if (!permission.isClosed() || !error.message.includes('Target page, context or browser has been closed')) throw error;
    });
    await closed;
    assert.equal(course.isClosed(), false); assert.equal(diagnostic.isClosed(), false);
    assert.equal(await viewer.locator('#status-title').textContent(), '需要允许读取文件服务器');
    assert.deepEqual(await diagnostic.evaluate(() => chrome.permissions.getAll()), report.permissions);
  });
  assert.deepEqual(unexpectedRequests, []); assert.deepEqual(pageErrors, []); report.passed = true;
} catch (error) {
  report.failedPhase = phase; report.error = error.stack; process.exitCode = 1; console.error(error);
  report.menuDiagnostics = [];
  if (context) for (const page of context.pages()) for (const frame of page.frames()) {
    const trace = await frame.evaluate(() => window.courselensMenuTrace).catch(() => null);
    if (trace) report.menuDiagnostics.push({ url: frame.url(), trace });
  }
  if (context) for (const [i, page] of context.pages().entries()) await page.screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
} finally {
  report.pageErrors = pageErrors; report.unexpectedRequests = unexpectedRequests;
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n'); await context?.close();
  const profilePath = path.resolve(profile), tempRoot = path.resolve(tmpdir());
  if (!profilePath.startsWith(tempRoot + path.sep) || !path.basename(profilePath).startsWith('canvas-preview-smoke-')) throw new Error('Unsafe profile cleanup');
  await rm(profilePath, { recursive: true, force: true, maxRetries: 3 });
}
