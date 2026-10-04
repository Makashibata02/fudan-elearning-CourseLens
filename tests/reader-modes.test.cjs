const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { zipSync, strToU8 } = require('fflate');

function domGlobals(t) {
  const dom = new JSDOM('<body><main id="root" style="padding:12px"><div id="target"></div></main></body>', { pretendToBeVisual: true });
  const keys = ['document', 'window', 'getComputedStyle', 'HTMLElement', 'Node', 'DOMParser', 'Blob', 'FileReader', 'requestAnimationFrame'];
  const original = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  for (const key of keys) globalThis[key] = dom.window[key];
  t.after(() => { for (const key of keys) { if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key]; } dom.window.close(); });
  const root = dom.window.document.getElementById('root'), target = dom.window.document.getElementById('target');
  Object.defineProperties(root, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  root.getBoundingClientRect = () => ({ top: 0, bottom: 600, width: 800, height: 600 });
  return { dom, root, target };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('fit page constrains both portrait/landscape dimensions; width and manual zoom remain available', async () => {
  const { fitScale } = await import('../extension/layout.mjs');
  for (const [width, height] of [[600, 1200], [2000, 700], [1200, 1200]]) {
    const scale = fitScale(width, height, 800, 500);
    assert.ok(width * scale <= 800); assert.ok(height * scale <= 500);
  }
  assert.equal(fitScale(600, 1200, 800, 500, 'width'), 800 / 600);
  assert.equal(fitScale(600, 1200, 800, 500, 'custom', 1.5), 1.5);
});

test('PDF defaults to scroll, fits full page, tracks scrolling, supports manual navigation and evicts old canvases', async (t) => {
  const { root, target } = domGlobals(t);
  const { PdfReader } = await import('../extension/pdf-reader.mjs');
  globalThis.document.defaultView.HTMLCanvasElement.prototype.getContext = () => ({});
  const rendered = [], states = [], errors = [];
  const reader = new PdfReader({ root, target, name: 'test.pdf', onChange: (state) => states.push(state), onError: (err) => errors.push(err), pdfjs: { TextLayer: class { async render() {} cancel() {} } } });
  const pdf = { numPages: 12, async getPage(number) { return {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 1200 * scale }),
    render() { rendered.push(number); return { promise: Promise.resolve(), cancel() {} }; },
    async getTextContent() { return { items: [] }; },
  }; } };
  await reader.open(pdf); await settle();
  assert.equal(reader.readingMode, 'scroll'); assert.equal(reader.entries.filter((entry) => !entry.element.hidden).length, 12);
  assert.ok(reader.entries[0].height * reader.entries[0].scale <= 546);
  assert.ok(rendered.length <= 3, 'do not render all 12 pages at opening');
  reader.entries.forEach((entry, index) => { entry.element.getBoundingClientRect = () => ({ top: index * 560 - root.scrollTop, bottom: index * 560 + 554 - root.scrollTop }); });
  root.scrollTop = 560 * 4; root.dispatchEvent(new window.Event('scroll')); await settle();
  assert.equal(reader.page, 5); assert.equal(states.at(-1).page, 5);
  reader.goTo(12); await settle(); assert.equal(reader.entries[0].canvas.width, 0);
  reader.configure({ readingMode: 'page' }); reader.goTo(3); await settle();
  assert.equal(reader.entries.filter((entry) => !entry.element.hidden).length, 1); assert.equal(reader.entries[2].element.hidden, false);
  assert.equal(root.scrollTop, 0); assert.equal(states.at(-1).page, 3);
  reader.configure({ zoomMode: 'width' }); await settle(); assert.ok(reader.entries[2].scale > .8);
  reader.configure({ zoomMode: 'page', readingMode: 'scroll' }); await settle();
  assert.equal(reader.entries.filter((entry) => !entry.element.hidden).length, 12);
  assert.deepEqual(errors, []); reader.destroy(); assert.equal(target.children.length, 0);
});

test('real DOCX pages can switch between continuous scrolling and one-page mode', async (t) => {
  const { dom, root, target } = domGlobals(t);
  const createNS = dom.window.document.createElementNS.bind(dom.window.document);
  dom.window.document.createElementNS = (ns, name, options) => { const el = createNS(ns, name, options); if (ns.includes('MathML') && !el.style) Object.defineProperty(el, 'style', { value: {} }); return el; };
  const { createDemoDocx } = await import('../scripts/demo-docx.mjs');
  const { renderOther } = await import('../dist/chromium/other-viewer.mjs');
  let state;
  const reader = await renderOther(createDemoDocx(), 'docx', target, { root, onChange: (s) => { state = s; } });
  const pages = [...target.firstChild.shadowRoot.querySelectorAll('section.docx')];
  assert.ok(pages.length >= 2); reader.configure(); assert.ok(pages.every((el) => !el.hidden));
  assert.ok(state.scale < 1); reader.configure({ readingMode: 'page' }); reader.goTo(2);
  assert.equal(pages.filter((el) => !el.hidden).length, 1); assert.equal(pages[1].hidden, false); assert.equal(state.page, 2);
  reader.configure({ readingMode: 'scroll' }); assert.ok(pages.every((el) => !el.hidden));
  reader.destroy(); assert.equal(target.children.length, 0);
});

test('ZIP lists Chinese folders, ignores Apple metadata, and verifies both stored/deflated entry bytes', async () => {
  const { parseZip } = await import('../extension/zip.mjs');
  const { inflateEntry } = await import('../extension/zip-inflate.mjs');
  const values = { '作业/第一页.txt': strToU8('中文答案'), '作业/第二页.txt': strToU8('第二页'.repeat(100)), '__MACOSX/._第一页': strToU8('metadata') };
  for (const level of [0, 6]) {
    const bytes = zipSync(values, { level }), entries = parseZip(bytes);
    assert.equal(entries.length, 2); assert.ok(entries.every((entry) => entry.readable));
    for (const entry of entries) assert.deepEqual(inflateEntry(bytes.slice(entry.dataStart, entry.dataStart + entry.compressed), entry), values[entry.name]);
    const entry = entries[0]; assert.throws(() => inflateEntry(bytes.slice(entry.dataStart, entry.dataStart + entry.compressed), { ...entry, crc: 1 }), /CRC/);
    assert.throws(() => inflateEntry(bytes.slice(entry.dataStart, entry.dataStart + entry.compressed), { ...entry, size: 1 }), /大小/);
  }
  assert.throws(() => parseZip(zipSync({ '../逃逸.txt': strToU8('test') })), /路径/);
  assert.throws(() => parseZip(strToU8('invalid zip')), /ZIP/);
  const large = zipSync({ 'bomb.txt': strToU8('test') });
  for (let i = 0; i < large.length - 46; i++) if (new DataView(large.buffer).getUint32(i, true) === 0x02014b50) { new DataView(large.buffer).setUint32(i + 24, 101 * 1024 * 1024, true); break; }
  assert.throws(() => parseZip(large), /限制/);
});

test('worker wrappers release resources on success, errors, timeouts and failed postMessage', async () => {
  const { decodeHeic } = await import('../extension/heic.mjs');
  const { readZipEntry } = await import('../extension/zip.mjs');
  for (const scenario of ['success', 'error', 'timeout', 'post-error']) {
    let terminated = 0;
    class FakeWorker {
      terminate() { terminated++; }
      postMessage() { if (scenario === 'post-error') throw new Error('message failed'); if (scenario === 'timeout') return; queueMicrotask(() => scenario === 'error' ? this.onerror() : this.onmessage({ data: { id: 'preview', imageData: { width: 2, height: 2 }, buffer: new ArrayBuffer(2) } })); }
    }
    for (const run of [() => decodeHeic(new Uint8Array(2), { WorkerImpl: FakeWorker, timeout: 5 }), () => readZipEntry(new Uint8Array(2), { readable: true, dataStart: 0, compressed: 2 }, { WorkerImpl: FakeWorker, timeout: 5 })]) {
      if (scenario === 'success') await run(); else await assert.rejects(run());
    }
    assert.equal(terminated, 2);
  }
});

test('ordinary course attachments open an accessible modal first and preserve native download controls', async (t) => {
  const dom = new JSDOM('<body><button id="start">Focus</button><a id="file" href="/files/42">苹果照片.HEIC</a><a id="zip" href="/files/43">作业.zip</a><a download id="download" href="/files/42/download">下载</a></body>', { url: 'https://elearning.fudan.edu.cn/courses/1', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const win = dom.window, messages = [];
  win.chrome = { runtime: { getURL: (p) => `chrome-extension://test/${p}`, sendMessage: async (msg) => { messages.push(msg); return { ok: true }; } } };
  for (const name of ['catalog.js', 'core.js', 'content.js']) win.eval(fs.readFileSync(path.join(__dirname, '../extension', name), 'utf8'));
  win.document.getElementById('start').focus(); win.document.getElementById('file').click();
  const host = win.document.getElementById('fdta-preview'), shadow = host.shadowRoot;
  assert.ok(shadow.querySelector('[role="dialog"][aria-modal="true"]')); assert.equal(host.style.position, 'fixed');
  assert.equal(new URL(shadow.querySelector('iframe').src).searchParams.get('format'), 'heic'); assert.equal(messages.length, 0);
  assert.equal(win.document.documentElement.style.overflow, 'hidden');
  const evt = new win.MouseEvent('click', { bubbles: true, cancelable: true }); win.document.getElementById('download').dispatchEvent(evt); assert.equal(evt.defaultPrevented, false);
  shadow.querySelector('[data-action="tab"]').click(); await settle(); assert.equal(messages.length, 1);
  shadow.querySelector('[data-action="close"]').click(); assert.equal(win.document.getElementById('fdta-preview'), null); assert.equal(win.document.documentElement.style.overflow, '');
  assert.equal(win.document.activeElement.id, 'start');
  win.document.getElementById('zip').click(); assert.equal(new URL(win.document.getElementById('fdta-preview').shadowRoot.querySelector('iframe').src).searchParams.get('format'), 'zip');
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(win.document.getElementById('fdta-preview'), null);
});

test('bundled HEIC worker decodes a real official libheif HEIC sample into color pixels', async () => {
  class ImageData {
    constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); }
  }
  let deliver;
  const result = new Promise((resolve) => { deliver = resolve; });
  const context = { ImageData, console, setTimeout, clearTimeout, postMessage: deliver };
  context.self = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/chromium/vendor/heic.worker.js'), 'utf8'), context, { timeout: 10000 });
  const sample = fs.readFileSync(process.env.HEIC_SAMPLE || path.join(__dirname, 'fixtures/with-alpha-512x512.heic'));
  // Worker messages are structured-cloned into its realm. Mirror that here;
  // an outside-realm ArrayBuffer fails libheif's instanceof check.
  context.sampleBytes = Array.from(sample);
  await vm.runInContext("onmessage({data:{id:'fixture',buffer:new Uint8Array(sampleBytes).buffer}})", context);
  const data = await result; assert.equal(data.error, ''); assert.equal(data.id, 'fixture');
  assert.ok(data.imageData.width > 0); assert.ok(data.imageData.height > 0);
  assert.equal(data.imageData.data.length, data.imageData.width * data.imageData.height * 4);
  assert.ok(data.imageData.data.some((byte, index) => index % 4 !== 3 && byte !== 0), 'decoded color pixels');
});
