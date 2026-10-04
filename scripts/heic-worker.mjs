import { parse } from 'acorn';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function buildHeicWorker(root, output) {
  // Pin the upstream CSP build, but externalize its worker string to satisfy MV3.
  const source = await readFile(path.join(root, 'node_modules/heic-to/dist/csp/heic-to.js'), 'utf8');
  const candidates = [];
  function visit(node, callback) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') callback(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child, callback));
      else if (value && typeof value === 'object') visit(value, callback);
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string' && node.value.length > 100000 && node.value.includes('HEIF image not found') && node.value.includes('onmessage=')) candidates.push(node.value);
  });
  if (candidates.length !== 1) throw new Error('Pinned HEIC worker extraction failed');
  const code = candidates[0];
  visit(parse(code, { ecmaVersion: 'latest' }), (node) => {
    if ((node.type === 'NewExpression' && node.callee.name === 'Function') || (node.type === 'CallExpression' && ['eval', 'Function'].includes(node.callee.name))) throw new Error('HEIC worker contains dynamic code execution');
  });
  const guard = `/* Extracted from heic-to 1.6.5 CSP distribution (LGPL-3.0). Pixel guard added by Fudan TA Reader. */\nconst NativeImageData = self.ImageData;\nself.ImageData = class extends NativeImageData {\n  constructor(width, height, ...rest) {\n    if (typeof width === 'number' && (!Number.isSafeInteger(width * height) || width <= 0 || height <= 0 || width * height > 50000000)) throw new Error('照片超过 5000 万像素，请下载原件阅读。');\n    super(width, height, ...rest);\n  }\n};\n`;
  await writeFile(path.join(output, 'vendor/heic.worker.js'), guard + code);
}
