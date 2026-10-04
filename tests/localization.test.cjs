const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('built Manifest V3 allows only packaged workers and compatible executable sources', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'dist/chromium/manifest.json')));
  const directives = new Map(manifest.content_security_policy.extension_pages.split(';').filter((part) => part.trim()).map((part) => { const [name, ...values] = part.trim().split(/\s+/); return [name, values]; }));
  assert.deepEqual(directives.get('worker-src'), ["'self'"]);
  for (const name of ['default-src', 'script-src', 'worker-src', 'object-src']) {
    assert.ok(directives.get(name).every((value) => ["'self'", "'none'", "'wasm-unsafe-eval'"].includes(value)), name);
  }
});

// Inspect the real build; run npm run build before this suite.
for (const browser of ['chromium']) {
  test(`${browser} localizes manifest metadata and preserves catalog bytes`, () => {
    const output = path.join(root, 'dist', browser);
    const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json')));
    assert.equal(manifest.default_locale, 'zh_CN');
    assert.equal(manifest.name, '__MSG_extensionName__');
    assert.equal(manifest.description, '__MSG_extensionDescription__');
    assert.equal(manifest.action.default_title, '__MSG_actionTitle__');
    const references = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);
    for (const locale of ['zh_CN', 'en']) {
      const relative = path.join('_locales', locale, 'messages.json');
      const bytes = readFileSync(path.join(output, relative));
      assert.deepEqual(bytes, readFileSync(path.join(root, 'extension', relative)));
      const messages = JSON.parse(bytes);
      for (const key of references) {
        assert.equal(typeof messages[key]?.message, 'string', `${locale}: ${key}`);
        assert.ok(messages[key].message.trim(), `${locale}: ${key} must not be empty`);
      }
    }
  });
}
