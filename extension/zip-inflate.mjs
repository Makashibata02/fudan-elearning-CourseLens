import { Inflate } from 'fflate';
import { crc32 } from './zip.mjs';
export function inflateEntry(bytes, { size, crc, method }) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024) throw new Error('ZIP 文件大小超限。');
  const chunks = []; let length = 0;
  if (method === 0) { chunks.push(bytes); length = bytes.length; }
  else if (method === 8) {
    const stream = new Inflate((chunk) => {
      length += chunk.byteLength;
      if (length > size) throw new Error('ZIP 实际解压大小超出声明，已停止。');
      chunks.push(chunk);
    });
    for (let pos = 0; pos < bytes.length; pos += 16384) stream.push(bytes.subarray(pos, pos + 16384), pos + 16384 >= bytes.length);
  } else throw new Error('ZIP 压缩方法暂不支持。');
  if (length !== size) throw new Error('ZIP 文件大小校验失败。');
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  if (crc32(result) !== crc) throw new Error('ZIP 文件 CRC 校验失败。');
  return result;
}
