import { validateOfficeZip } from './formats.mjs';

// Validate allocation chains before the binary parser allocates stream buffers.
export function validatePowerPoint(bytes) {
  if (bytes.length > 100 * 1024 * 1024) throw new Error('课件超过 100 MiB，请下载后阅读。');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    validateOfficeZip(bytes, 'PPTX', 'ppt/presentation.xml'); return;
  }
  const fail = () => { throw new Error('PPT 结构损坏或不受支持，请下载后用 PowerPoint 阅读。'); };
  if (bytes.length < 512 || ![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => bytes[i] === x)) fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), u32 = (n) => v.getUint32(n, true);
  const shift = v.getUint16(30, true), major = v.getUint16(26, true);
  if (v.getUint16(28, true) !== 0xfffe || !((major === 3 && shift === 9) || (major === 4 && shift === 12)) || v.getUint16(32, true) !== 6 || u32(56) !== 4096) fail();
  const sector = 2 ** shift, count = Math.floor(bytes.length / sector) - 1, FREE = 0xffffffff, END = 0xfffffffe;
  const offset = (n) => { if (n >= count) fail(); return (n + 1) * sector; };
  const fatCount = u32(44), difCount = u32(72), fatSectors = [], difSeen = new Set();
  if (!count || !fatCount || fatCount > Math.ceil(count / (sector / 4)) || difCount > count || u32(64) > count) fail();
  for (let i = 0; i < 109; i++) { const n = u32(76 + i * 4); if (n !== FREE) fatSectors.push(n); }
  let dif = u32(68);
  for (let i = 0; i < difCount; i++) {
    if (difSeen.has(dif)) fail(); difSeen.add(dif); const at = offset(dif);
    for (let j = 0; j < sector / 4 - 1; j++) { const n = u32(at + j * 4); if (n !== FREE) fatSectors.push(n); }
    dif = u32(at + sector - 4);
  }
  if ((dif !== END && dif !== FREE) || fatSectors.length !== fatCount || new Set(fatSectors).size !== fatCount) fail();
  const fat = new Uint32Array(fatCount * sector / 4);
  fatSectors.forEach((n, i) => { const at = offset(n); for (let j = 0; j < sector / 4; j++) fat[i * sector / 4 + j] = u32(at + j * 4); });
  const checkCycles = (table, max) => {
    const state = new Uint8Array(table.length);
    for (let i = 0; i < Math.min(max, table.length); i++) {
      if (state[i]) continue; let n = i; const trail = [];
      while (n < 0xfffffffa) {
        if (n >= max || n >= table.length || state[n] === 1) fail();
        if (state[n] === 2) break;
        state[n] = 1; trail.push(n); n = table[n];
      }
      for (const item of trail) state[item] = 2;
    }
  };
  checkCycles(fat, count);
  const chain = (start, table, max) => {
    const result = []; let n = start;
    while (n !== END && n !== FREE) { if (n >= max || n >= table.length || result.length >= max) fail(); result.push(n); n = table[n]; }
    return result;
  };
  const directory = chain(u32(48), fat, count);
  if (!directory.length || directory.length * sector > 512 * 1024) fail();
  const entries = [];
  for (const n of directory) for (let j = 0; j < sector; j += 128) {
    const at = offset(n) + j, type = v.getUint8(at + 66); if (![2, 5].includes(type)) continue;
    const len = v.getUint16(at + 64, true); if (len < 2 || len > 64 || len % 2) fail();
    const name = new TextDecoder('utf-16le').decode(bytes.subarray(at, at + len - 2));
    if (u32(at + 124) || u32(at + 120) > bytes.length) fail();
    entries.push({ name, type, start: u32(at + 116), size: u32(at + 120) });
  }
  if (entries.some((e) => /^(EncryptedPackage|EncryptionInfo)$/i.test(e.name))) throw new Error('暂不支持加密课件，请先解密或导出 PDF。');
  if (!entries.some((e) => e.name === 'PowerPoint Document')) fail();
  const root = entries.find((e) => e.type === 5); if (!root) fail();
  const miniSectors = chain(u32(60), fat, count); if (miniSectors.length !== u32(64)) fail();
  const mini = new Uint32Array(miniSectors.length * sector / 4);
  miniSectors.forEach((n, i) => { const at = offset(n); for (let j = 0; j < sector / 4; j++) mini[i * sector / 4 + j] = u32(at + j * 4); });
  checkCycles(mini, Math.ceil(root.size / 64));
  for (const e of entries) {
    const small = e.type !== 5 && e.size < 4096;
    const sectors = chain(e.start, small ? mini : fat, small ? Math.ceil(root.size / 64) : count);
    if (sectors.length * (small ? 64 : sector) < e.size) fail();
  }
}
