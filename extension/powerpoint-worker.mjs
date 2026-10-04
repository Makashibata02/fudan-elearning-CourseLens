import { convertPowerPoint } from './powerpoint-core.mjs';
self.onmessage = async ({ data }) => {
  if (data?.id !== 'slides' || !(data.buffer instanceof ArrayBuffer)) return;
  try { self.postMessage({ id: 'slides', presentation: await convertPowerPoint(new Uint8Array(data.buffer)) }); }
  catch (error) { self.postMessage({ id: 'slides', error: error?.message || '课件解析失败。' }); }
};
