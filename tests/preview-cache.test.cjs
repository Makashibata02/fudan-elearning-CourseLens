const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../extension/catalog.js'); require('../extension/core.js'); require('../extension/preview-cache.js');
const { PreviewCache, encode, decode } = globalThis.CoursePreviewCache;

test('temporary cache expires without extending its lifetime on reuse, copies bytes, and evicts oldest files', () => {
  let now = 0; const cache = new PreviewCache({ limit: 6, fileLimit: 4, count: 2, ttl: 100, now: () => now });
  const data = Uint8Array.of(1, 2, 3); assert.equal(cache.put('a', data), true); data[0] = 9;
  const copy = cache.get('a'); assert.equal(copy[0], 1); copy[0] = 8; assert.equal(cache.get('a')[0], 1);
  cache.put('b', Uint8Array.of(4, 5, 6)); cache.get('a'); cache.put('c', Uint8Array.of(7, 8, 9));
  assert.equal(cache.get('b'), null); assert.equal(cache.size, 6);
  assert.equal(cache.put('big', new Uint8Array(5)), false);
  now = 99; assert.ok(cache.get('a')); now = 100; assert.equal(cache.get('a'), null); assert.equal(cache.size, 0);
  cache.put('x', data); cache.clear(); assert.equal(cache.get('x'), null);
});

test('JSON-compatible cache transport preserves binary bytes', () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, index) => index % 256);
  assert.deepEqual(decode(encode(bytes)), bytes);
});

function background() {
  const listeners = []; let granted = true, removed;
  const context = { URL, Uint8Array, atob, btoa, setTimeout: () => 1, clearTimeout() {}, FdPdf: globalThis.FdPdf, CoursePreviewCache, chrome: {
    runtime: { id: 'test', getURL: (name) => `chrome-extension://test/${name}`, onMessage: { addListener(fn) { listeners.push(fn); } }, onInstalled: { addListener() {} } },
    permissions: { contains: async () => granted, onRemoved: { addListener(fn) { removed = fn; } } },
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const source = 'https://elearning.fudan.edu.cn/files/456/download';
  const sender = (student = '1') => ({ id: 'test', url: `chrome-extension://test/viewer.html?source=${encodeURIComponent(source)}&context=${student}&format=pdf` });
  const call = (message, from = sender()) => new Promise((resolve) => {
    let replied = false;
    const async = listeners[0](message, from, (result) => { replied = true; resolve(result); });
    if (!async && !replied) resolve(null);
  });
  return { sender, call, revoke() { granted = false; removed(); } };
}

test('cache is off by default; opt-in reuse is scoped to student/context and discarded on enabling cleanup or revocation', async () => {
  const { call, sender, revoke } = background(), data = encode(Uint8Array.of(1, 2, 3));
  await call({ type: 'preview-cache-put', data }); assert.equal((await call({ type: 'preview-cache-get' })).data, undefined);
  await call({ type: 'preview-policy', autoClear: false }); await call({ type: 'preview-cache-put', data });
  assert.equal((await call({ type: 'preview-cache-get' })).data, data);
  assert.equal((await call({ type: 'preview-cache-get' }, sender('2'))).data, null);
  await call({ type: 'preview-policy', autoClear: true }); await call({ type: 'preview-policy', autoClear: false });
  assert.equal((await call({ type: 'preview-cache-get' })).data, null);
  await call({ type: 'preview-cache-put', data }); revoke(); assert.equal((await call({ type: 'preview-cache-get' })).data, null);
});

test('school content scripts and other extensions cannot read caches or change cleanup preferences', async () => {
  const { call } = background();
  for (const sender of [{ id: 'test', url: 'https://elearning.fudan.edu.cn/courses/1' }, { id: 'other', url: 'chrome-extension://test/viewer.html' }, { id: 'test', url: 'chrome-extension://other/viewer.html' }]) {
    assert.equal(await call({ type: 'preview-policy', autoClear: false }, sender), null);
    assert.equal(await call({ type: 'preview-cache-get' }, sender), null);
  }
});
