export function imageMime(bytes) {
  const starts = (...numbers) => numbers.every((number, index) => bytes[index] === number);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(255, 216, 255)) return 'image/jpeg';
  const text = new TextDecoder().decode(bytes.subarray(0, 12));
  if (/^GIF8[79]a/.test(text)) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8) === 'WEBP') return 'image/webp';
  if (starts(66, 77)) return 'image/bmp';
  throw new Error('文件内容不是支持的图片，可能是登录页面或损坏的文件。');
}
export function decodeText(bytes) {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('文本超过 8 MiB，请下载后阅读。');
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}
/* Check central-directory expansion before the DOCX library inflates any entry. */
export function validateDocx(bytes) {
  const fail = (detail) => { throw new Error(detail || '文件不是有效 DOCX，请确认不是旧版 DOC 或加密文件。'); };
  if (bytes.length < 22) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail();
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true);
  let pos = view.getUint32(end + 16, true), total = 0;
  if (count > 4096 || count === 65535 || size === 0xffffffff || pos + size !== end) fail('DOCX 压缩结构不受支持或条目过多，请下载后阅读。');
  const names = new Set();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) fail();
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const expanded = view.getUint32(pos + 24, true), len = view.getUint16(pos + 28, true);
    const step = 46 + len + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    if (pos + step > end || flags & 1 || ![0, 8].includes(method)) fail('不支持加密或特殊压缩的 DOCX。');
    const local = view.getUint32(pos + 42, true);
    if (local + 30 > end || view.getUint32(local, true) !== 0x04034b50 || view.getUint32(local + 22, true) > 32 * 1024 * 1024) fail();
    total += expanded;
    if (expanded > 32 * 1024 * 1024 || total > 200 * 1024 * 1024) fail('DOCX 解压后内容过大，请下载后阅读。');
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + len));
    if (names.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\')) fail();
    names.add(name); pos += step;
  }
  if (pos !== end || !names.has('[Content_Types].xml') || !names.has('word/document.xml') || [...names].some((name) => /vbaProject/i.test(name))) fail();
  return { entries: count, expandedBytes: total };
}
