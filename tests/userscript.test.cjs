const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'elearning-pdf-preview.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumented = source.replace(
  /\}\)\(\);\s*$/,
  'globalThis.__testExports = { pdfLinkFromClick, retrievePdf };})();',
);
assert.notEqual(instrumented, source, 'the userscript wrapper must be instrumented');

function loadScript(overrides = {}) {
  const context = {
    URL,
    Blob,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    location: {
      origin: 'https://elearning.fudan.edu.cn',
      href: 'https://elearning.fudan.edu.cn/courses/12345/assignments/24680',
    },
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    ...overrides,
  };
  vm.runInNewContext(instrumented, context, { filename: scriptPath });
  return context.__testExports;
}

function clickFor(href, textContent, options = {}) {
  const link = {
    nodeType: 1,
    href,
    textContent,
    title: '',
    dataset: {},
    hasAttribute: () => Boolean(options.download),
    matches: () => Boolean(options.downloadControl),
    closest: () => link,
  };
  return {
    button: 0,
    defaultPrevented: false,
    target: link,
    ...options.event,
  };
}

test('recognizes the assignment PDF and derives its download endpoint', () => {
  const { pdfLinkFromClick } = loadScript();
  const result = pdfLinkFromClick(clickFor(
    'https://elearning.fudan.edu.cn/courses/12345/files/67890?wrap=1',
    '示例讲义.pdf',
  ));
  assert.equal(result.name, '示例讲义.pdf');
  assert.equal(result.downloadUrl.href,
    'https://elearning.fudan.edu.cn/courses/12345/files/67890/download?download_frd=1');
});

test('leaves download controls, non-PDF files and modified clicks alone', () => {
  const { pdfLinkFromClick } = loadScript();
  const href = 'https://elearning.fudan.edu.cn/courses/12345/files/67890?wrap=1';
  assert.equal(pdfLinkFromClick(clickFor(href, '示例讲义.pdf', { downloadControl: true })), null);
  assert.equal(pdfLinkFromClick(clickFor(href, '作业说明.docx')), null);
  assert.equal(pdfLinkFromClick(clickFor(href, '示例讲义.pdf', { event: { ctrlKey: true } })), null);
  assert.equal(pdfLinkFromClick(clickFor('https://example.com/file.pdf', 'file.pdf')), null);
});

test('recognizes a direct same-origin PDF URL', () => {
  const { pdfLinkFromClick } = loadScript();
  const result = pdfLinkFromClick(clickFor(
    'https://elearning.fudan.edu.cn/resources/handout.pdf', 'handout.pdf'));
  assert.equal(result.downloadUrl.href, 'https://elearning.fudan.edu.cn/resources/handout.pdf');
});

test('uses Tampermonkey only when browser fetch is blocked by a redirect', async () => {
  const pdf = new Blob(['%PDF-1.7\nexample'], { type: 'application/pdf' });
  let requestedUrl = '';
  const { retrievePdf } = loadScript({
    fetch: async () => { throw new TypeError('CORS blocked'); },
    GM_xmlhttpRequest: ({ url, onload }) => {
      requestedUrl = url;
      queueMicrotask(() => onload({ status: 200, response: pdf }));
      return { abort() {} };
    },
  });
  const file = {
    downloadUrl: new URL('https://elearning.fudan.edu.cn/courses/12345/files/67890/download?download_frd=1'),
  };
  const result = await retrievePdf(file, new AbortController().signal);
  assert.equal(requestedUrl, file.downloadUrl.href);
  assert.equal((await result.text()).startsWith('%PDF-'), true);
});
