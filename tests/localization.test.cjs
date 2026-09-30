const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

// Test the real build once, rather than a duplicate manifest factory.
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
for (const browser of ['chromium', 'firefox']) {
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
