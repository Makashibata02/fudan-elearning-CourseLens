const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { zipSync, strToU8 } = require('fflate');
const ppt = new Uint8Array(fs.readFileSync('tests/fixtures/basic-test.ppt'));

test('PPTX renders ordered Chinese slides and inline images; real binary PPT renders its text', async () => {
  const { convertPowerPoint } = await import('../extension/powerpoint-core.mjs');
  const { createDemoPptx } = await import('../scripts/demo-pptx.mjs');
  const modern = await convertPowerPoint(createDemoPptx());
  assert.equal(modern.slides.length, 2); assert.equal(modern.width, 960); assert.equal(modern.height, 540);
  assert.match(modern.slides[0], /课件阅读示例/); assert.match(modern.slides[1], /第二页/);
  assert.match(modern.slides[0], /data:image\/png;base64,/); assert.doesNotMatch(modern.slides[0], /blob:/);
  const legacy = await convertPowerPoint(ppt);
  assert.equal(legacy.source, 'ppt'); assert.equal(legacy.slides.length, 1);
  assert.match(legacy.slides[0], /This is a test title/); assert.match(legacy.slides[0], /This is on page 1/);
});

test('PowerPoint preflight rejects allocation cycles, encrypted containers, macros and oversized ZIP entries', async () => {
  const { validatePowerPoint } = await import('../extension/powerpoint-validation.mjs');
  const { createDemoPptx } = await import('../scripts/demo-pptx.mjs');
  assert.doesNotThrow(() => validatePowerPoint(ppt)); assert.doesNotThrow(() => validatePowerPoint(createDemoPptx()));
  const cycle = ppt.slice(), v = new DataView(cycle.buffer), sector = 2 ** v.getUint16(30, true), fatAt = (v.getUint32(76, true) + 1) * sector;
  v.setUint32(fatAt, 0, true); assert.throws(() => validatePowerPoint(cycle), /PPT 结构/);
  const badShift = ppt.slice(); new DataView(badShift.buffer).setUint16(30, 31, true); assert.throws(() => validatePowerPoint(badShift), /PPT 结构/);
  const encrypted = ppt.slice(), nameOffset = Buffer.from(encrypted).indexOf(Buffer.from('PowerPoint Document', 'utf16le'));
  encrypted.fill(0, nameOffset, nameOffset + 64); encrypted.set(Buffer.from('EncryptedPackage', 'utf16le'), nameOffset);
  new DataView(encrypted.buffer).setUint16(nameOffset + 64, 34, true); assert.throws(() => validatePowerPoint(encrypted), /加密/);
  const oversized = createDemoPptx(), dv = new DataView(oversized.buffer);
  for (let i = 0; i < oversized.length - 46; i++) if (dv.getUint32(i, true) === 0x02014b50) { dv.setUint32(i + 24, 40 * 1024 * 1024, true); break; }
  assert.throws(() => validatePowerPoint(oversized), /过大/);
  assert.throws(() => validatePowerPoint(zipSync({ '[Content_Types].xml': strToU8(''), 'ppt/presentation.xml': strToU8(''), 'ppt/vbaProject.bin': strToU8('macro') })), /PPTX/);
  assert.throws(() => validatePowerPoint(strToU8('<html>login</html>')), /PPT 结构/);
});

test('slide sanitization removes executable content and all external resources without fetching them', async () => {
  const { safeSlide } = await import('../extension/powerpoint.mjs');
  const { convertPowerPoint } = await import('../extension/powerpoint-core.mjs');
  const { createDemoPptx } = await import('../scripts/demo-pptx.mjs');
  const dom = new JSDOM('<body>');
  try {
    const fragment = safeSlide('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><iframe src="https://example.invalid/"></iframe></foreignObject><image href="https://example.invalid/track.png"/><path fill="url(https://example.invalid/x)" style="background:url(https://example.invalid/y)" onload="alert(1)"/><text>可读文字</text></svg>', dom.window);
    const container = dom.window.document.createElement('div'); container.append(fragment);
    assert.match(container.textContent, /可读文字/); assert.doesNotMatch(container.innerHTML, /https:|script|iframe|foreignObject|onload|style=/i);
    const originalFetch = global.fetch; let requests = 0;
    global.fetch = () => { requests++; throw new Error('unexpected network'); };
    try { const pres = await convertPowerPoint(createDemoPptx({ unsafeImage: true })); const safe = safeSlide(pres.slides[0], dom.window); assert.equal(safe.querySelector('image')?.getAttribute('href'), null); assert.equal(requests, 0); }
    finally { global.fetch = originalFetch; }
  } finally { dom.window.close(); }
});

test('PowerPoint reader fits landscape slides, switches scroll/manual mode, and releases its parsing worker', async () => {
  const dom = new JSDOM('<body><main id="root"><div id="target"></div></main>');
  const oldDocument = global.document, oldStyle = global.getComputedStyle; global.document = dom.window.document; global.getComputedStyle = dom.window.getComputedStyle;
  try {
    const { convertPowerPoint } = await import('../extension/powerpoint-core.mjs');
    const { createDemoPptx } = await import('../scripts/demo-pptx.mjs');
    const { renderOther } = await import('../dist/chromium/other-viewer.mjs'); let released = 0, state;
    class RealParserWorker { postMessage({ id, buffer }) { convertPowerPoint(new Uint8Array(buffer)).then((presentation) => this.onmessage({ data: { id, presentation } }), (e) => this.onmessage({ data: { id, error: e.message } })); } terminate() { released++; } }
    const root = document.getElementById('root'), target = document.getElementById('target');
    Object.defineProperties(root, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const reader = await renderOther(createDemoPptx(), 'powerpoint', target, { root, powerpointOptions: { WorkerImpl: RealParserWorker }, onChange: (s) => { state = s; } });
    const pages = [...target.querySelectorAll('.ppt-page')];
    pages.forEach((page) => { page.getBoundingClientRect = () => ({ width: 960, height: 540 }); });
    reader.configure(); assert.equal(state.pages, 2); assert.equal(released, 1); assert.ok(state.scale < 1); assert.ok(state.scale * 960 <= 800 && state.scale * 540 <= 600); assert.ok(pages.every((p) => !p.hidden));
    reader.configure({ readingMode: 'page' }); reader.goTo(2); assert.equal(state.page, 2); assert.equal(pages[0].hidden, true); assert.equal(pages[1].hidden, false);
    reader.configure({ readingMode: 'scroll' }); assert.ok(pages.every((p) => !p.hidden)); reader.destroy(); assert.equal(target.children.length, 0);
  } finally { global.document = oldDocument; global.getComputedStyle = oldStyle; dom.window.close(); }
});

test('PowerPoint workers terminate on parse errors, worker failure, transfer failure and timeout', async () => {
  const { parsePowerPoint } = await import('../extension/powerpoint.mjs');
  for (const mode of ['parse', 'worker', 'transfer', 'timeout']) {
    let released = 0;
    class FailedWorker {
      postMessage() { if (mode === 'transfer') throw new Error('transfer failed'); if (mode === 'parse') this.onmessage({ data: { id: 'slides', error: 'parse failed' } }); if (mode === 'worker') this.onerror(); }
      terminate() { released++; }
    }
    await assert.rejects(parsePowerPoint(ppt, { WorkerImpl: FailedWorker, timeout: 5 })); assert.equal(released, 1);
  }
});
