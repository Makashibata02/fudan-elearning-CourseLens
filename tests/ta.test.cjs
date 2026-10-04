const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
require('../extension/catalog.js'); require('../extension/core.js');
const core = globalThis.FdPdf, origin = core.ORIGIN;

test('SpeedGrader submission download routes preserve authorization and remove inline', () => {
  const file = core.describe(`${origin}/courses/1/assignments/2/submissions/3?download=42&inline=1&verifier=token`, '作业.docx');
  assert.equal(file.format, 'docx'); assert.equal(file.name, '作业.docx');
  const url = new URL(file.source);
  assert.equal(url.searchParams.get('download'), '42'); assert.equal(url.searchParams.get('verifier'), 'token');
  assert.equal(url.searchParams.has('inline'), false);
  assert.equal(core.fileUrl(`${origin}/courses/1/assignments/2/submissions/3?download=../../evil`), null);
  assert.ok(core.describe(`${origin}/courses/1/assignments/2/anonymous_submissions/abc_2?download=42`, '答案.pdf'));
});

test('image/text formats and unsupported office formats do not turn into PDFs', () => {
  for (const [name, format] of [['a.DOCX', 'docx'], ['图.jpg', 'image'], ['a.py', 'text'], ['a.csv', 'text'], ['旧.doc', 'unsupported'], ['a.xlsx', 'unsupported']]) {
    assert.equal(core.describe(`${origin}/files/1`, name).format, format);
    assert.equal(core.filename(name), name);
  }
});

function fixture() {
  const dom = new JSDOM(`<body><button id="next-student-button">Next</button><div id="left_side" style="position:relative;height:600px"></div><div id="right_side"><div id="submission_files_list"><a class="display_name" href="/courses/1/assignments/2/submissions/3?download=42&inline=1">作业.docx</a><a class="submission-file-download" download href="/files/42/download">下载此文件</a></div><input id="grade" value="7"><textarea id="comment">尚未提交的评语</textarea></div></body>`, { url: `${origin}/courses/1/gradebook/speed_grader?student_id=3`, runScripts: 'outside-only' });
  const win = dom.window, messages = [];
  win.chrome = { runtime: { getURL: (p) => `chrome-extension://test/${p}`, sendMessage: async (message) => { messages.push(message); return { ok: true }; } } };
  for (const name of ['catalog.js', 'core.js', 'content.js']) win.eval(fs.readFileSync(path.join(__dirname, '../extension', name), 'utf8'));
  return { dom, win, messages, doc: win.document };
}
const pause = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

test('SpeedGrader shows inline DOCX, replaces it for another student, and keeps grading drafts', async (t) => {
  const { dom, win, doc, messages } = fixture(); t.after(() => dom.window.close());
  doc.querySelector('a.display_name').click();
  let shadow = doc.getElementById('fdta-preview').shadowRoot, frame = shadow.querySelector('iframe');
  assert.equal(new URL(frame.src).searchParams.get('format'), 'docx'); assert.equal(messages.length, 0);
  const downloadEvent = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  doc.querySelector('[download]').dispatchEvent(downloadEvent); assert.equal(downloadEvent.defaultPrevented, false);
  doc.getElementById('next-student-button').click();
  assert.equal(frame.hasAttribute('src'), false); assert.equal(frame.hidden, true);
  win.history.replaceState(null, '', '?student_id=4');
  await pause(600); assert.equal(frame.hasAttribute('src'), false, 'old links must not reopen for new URL');
  doc.querySelector('a.display_name').href = '/courses/1/assignments/2/submissions/4?download=43&inline=1';
  doc.querySelector('a.display_name').textContent = '第二份.pdf';
  await pause();
  assert.equal(new URL(frame.src).searchParams.get('name'), '第二份.pdf');
  assert.equal(doc.getElementById('grade').value, '7'); assert.equal(doc.getElementById('comment').value, '尚未提交的评语');
  shadow.querySelector('[data-action="tab"]').click(); await pause(10); assert.equal(messages[0].file.name, '第二份.pdf');
  doc.getElementById('submission_files_list').replaceChildren(); await pause();
  assert.equal(frame.hidden, true); assert.match(shadow.querySelector('p').textContent, /没有可阅读/);
  shadow.querySelector('[data-action="close"]').click(); assert.equal(doc.getElementById('fdta-preview'), null);
});

test('PDF sample is parseable by the actual bundled reader', async () => {
  const { createDemoPdf } = await import('../scripts/demo-pdf.mjs');
  const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(createDemoPdf()), isEvalSupported: false, standardFontDataUrl: path.join(__dirname, '../node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' });
  const pdf = await task.promise; assert.ok(pdf.numPages >= 2);
  assert.ok((await (await pdf.getPage(1)).getTextContent()).items.length > 0); await task.destroy();
});

test('DOCX renders real Chinese, tables, images, MathML and page breaks; strips unsafe links', async (t) => {
  const dom = new JSDOM('<body><div id="doc"></div></body>', { pretendToBeVisual: true });
  // jsdom omits MathMLElement.style; Chrome implements it. Emulate only that DOM API.
  const createNS = dom.window.document.createElementNS.bind(dom.window.document);
  dom.window.document.createElementNS = (ns, name, options) => {
    const element = createNS(ns, name, options);
    if (ns === 'http://www.w3.org/1998/Math/MathML' && !element.style) Object.defineProperty(element, 'style', { value: {} });
    return element;
  };
  const originals = {};
  for (const key of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'Blob', 'FileReader', 'requestAnimationFrame']) {
    originals[key] = globalThis[key]; globalThis[key] = dom.window[key];
  }
  t.after(() => { for (const key of Object.keys(originals)) { if (originals[key] === undefined) delete globalThis[key]; else globalThis[key] = originals[key]; } dom.window.close(); });
  const { createDemoDocx } = await import('../scripts/demo-docx.mjs');
  const { renderDocx } = await import('../dist/chromium/vendor/docx.bundle.mjs');
  const shadow = await renderDocx(createDemoDocx({ unsafeLink: true }), dom.window.document.getElementById('doc'), dom.window);
  assert.match(shadow.textContent, /线性规划/); assert.match(shadow.textContent, /第二页/);
  assert.equal(shadow.querySelectorAll('table').length, 1); assert.ok(shadow.querySelectorAll('section.docx').length >= 2);
  assert.ok(shadow.querySelector('math mfrac'), 'OMML fraction must render as MathML');
  assert.match(shadow.querySelector('img').getAttribute('src'), /^data:image\/png;base64,/);
  assert.equal(shadow.querySelector('a').hasAttribute('href'), false);
  assert.equal(shadow.querySelectorAll('script, iframe, object').length, 0);
});

test('file sniffing, Chinese encoding, invalid ZIP and oversized DOCX are handled', async () => {
  const { imageMime, decodeText, validateDocx } = await import('../extension/formats.mjs');
  assert.equal(imageMime(Uint8Array.of(255, 216, 255)), 'image/jpeg');
  assert.throws(() => imageMime(new TextEncoder().encode('<html>login</html>')), /不是支持的图片/);
  assert.equal(decodeText(new TextEncoder().encode('答案')), '答案');
  assert.equal(decodeText(Uint8Array.of(0xb4, 0xf0, 0xb0, 0xb8)), '答案');
  assert.throws(() => decodeText(new Uint8Array(8 * 1024 * 1024 + 1)), /超过/);
  assert.throws(() => validateDocx(new TextEncoder().encode('<html>not a docx</html>')), /有效 DOCX/);
  const { createDemoDocx } = await import('../scripts/demo-docx.mjs');
  const bytes = createDemoDocx(); assert.ok(validateDocx(bytes).entries > 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = 0; p + 46 < bytes.length; p++) if (view.getUint32(p, true) === 0x02014b50) { view.setUint32(p + 24, 40 * 1024 * 1024, true); break; }
  assert.throws(() => validateDocx(bytes), /解压后内容过大/);
});

test('generic file reader accepts DOCX and text bytes, rejects login pages and cleans listeners', async () => {
  const { readFile } = await import('../extension/reader.mjs');
  const { createDemoDocx } = await import('../scripts/demo-docx.mjs');
  let listening = false;
  const api = { permissions: { contains: async () => true }, webRequest: { onBeforeRedirect: {
    addListener() { listening = true; }, removeListener() { listening = false; },
  } } };
  const source = `${origin}/courses/1/assignments/2/submissions/3?download=42`;
  const expected = createDemoDocx();
  assert.deepEqual(await readFile(source, { api, format: 'docx', fetchImpl: async () => new Response(expected) }), expected);
  assert.equal(listening, false);
  assert.equal(new TextDecoder().decode(await readFile(source, { api, format: 'text', fetchImpl: async () => new Response('答案') })), '答案');
  await assert.rejects(readFile(source, { api, format: 'docx', fetchImpl: async () => new Response('<!doctype html><html>login</html>', { headers: { 'content-type': 'text/html' } }) }), /登录页面/);
  assert.equal(listening, false);
});
