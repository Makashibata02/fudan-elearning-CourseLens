const MiB = 1024 * 1024;
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function parseZip(bytes) {
  const fail = (message = 'ZIP 结构损坏或不受支持。') => { throw new Error(message); };
  if (bytes.byteLength < 22 || bytes.byteLength > 100 * MiB) fail('ZIP 为空、损坏或超过 100 MiB。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('不支持分卷 ZIP 或损坏的压缩包。');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
  let pos = view.getUint32(end + 16, true), total = 0;
  if (count > 2048 || count === 65535 || pos + directorySize !== end) fail('ZIP 条目过多，或使用了暂不支持的 ZIP64 格式。');
  const directoryStart = pos, entries = [], names = new Set();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) fail();
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true), compressed = view.getUint32(pos + 20, true), size = view.getUint32(pos + 24, true);
    const length = view.getUint16(pos + 28, true), extraLength = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
    const step = 46 + length + extraLength + comment, offset = view.getUint32(pos + 42, true);
    if (pos + step > end || compressed === 0xffffffff || size === 0xffffffff || offset + 30 > directoryStart || view.getUint32(offset, true) !== 0x04034b50) fail();
    const rawName = bytes.subarray(pos + 46, pos + 46 + length);
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(rawName); }
    catch { name = new TextDecoder('gb18030').decode(rawName); }
    // Info-ZIP Unicode path takes precedence when its name CRC is valid.
    for (let extra = pos + 46 + length, stop = extra + extraLength; extra + 4 <= stop;) {
      const tag = view.getUint16(extra, true), len = view.getUint16(extra + 2, true);
      if (extra + 4 + len > stop) fail();
      if (tag === 0x7075 && len >= 5 && bytes[extra + 4] === 1 && view.getUint32(extra + 5, true) === crc32(rawName)) name = new TextDecoder().decode(bytes.subarray(extra + 9, extra + 4 + len));
      extra += 4 + len;
    }
    name = name.replaceAll('\\', '/');
    if (!name || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..') || names.has(name)) fail('ZIP 包含无效或重复的文件路径。');
    names.add(name); total += size;
    if (size > 100 * MiB || total > 300 * MiB) fail('ZIP 解压内容超过限制（单文件 100 MiB，总计 300 MiB）。');
    const dataStart = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (dataStart + compressed > directoryStart || view.getUint16(offset + 8, true) !== method) fail();
    const encrypted = Boolean(flags & 1 || view.getUint16(offset + 6, true) & 1);
    if (!name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.split('/').some((part) => part.startsWith('._'))) {
      entries.push({ name, compressed, size, crc, dataStart, method, encrypted, readable: !encrypted && [0, 8].includes(method) });
    }
    pos += step;
  }
  if (pos !== end) fail();
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

export function readZipEntry(bytes, entry, { workerURL, WorkerImpl = Worker, timeout = 20000 } = {}) {
  if (!entry.readable) return Promise.reject(new Error(entry.encrypted ? '加密 ZIP 暂不支持，请先在本地解密。' : '该 ZIP 使用了不受支持的压缩方法。'));
  return new Promise((resolve, reject) => {
    const worker = new WorkerImpl(workerURL, { type: 'module' });
    let done = false;
    const finish = (error, data) => { if (done) return; done = true; clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(data); };
    const timer = setTimeout(() => finish(new Error('ZIP 解压超时，请下载后阅读。')), timeout);
    worker.onerror = () => finish(new Error('ZIP 解压器未能运行。'));
    worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, new Uint8Array(data.buffer));
    const buffer = bytes.slice(entry.dataStart, entry.dataStart + entry.compressed).buffer;
    try { worker.postMessage({ buffer, size: entry.size, crc: entry.crc, method: entry.method }, [buffer]); }
    catch (error) { finish(error); }
  });
}
