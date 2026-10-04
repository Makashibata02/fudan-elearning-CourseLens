import { inflateEntry } from './zip-inflate.mjs';
self.onmessage = ({ data }) => {
  try {
    const result = inflateEntry(new Uint8Array(data.buffer), data);
    self.postMessage({ buffer: result.buffer }, [result.buffer]);
  } catch (error) { self.postMessage({ error: error.message || 'ZIP 解压失败。' }); }
};
