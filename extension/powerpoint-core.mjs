import { parse, renderSlideToSvg } from '@web-ppt/core';
import { validatePowerPoint } from './powerpoint-validation.mjs';

export async function convertPowerPoint(bytes) {
  validatePowerPoint(bytes);
  const pres = await parse(bytes);
  try {
    if (!Number.isFinite(pres.width) || !Number.isFinite(pres.height) || pres.width < 1 || pres.height < 1 || pres.width > 10000 || pres.height > 10000) throw new Error('课件页面尺寸不受支持。');
    if (!pres.slides.length || pres.slides.length > 500) throw new Error('课件页数超过 500 页或没有可读页面，请下载后阅读。');
    const assets = new Map(), slides = []; let total = 0;
    for (const slide of pres.slides) {
      let svg = renderSlideToSvg(pres, slide, { textMode: 'svg', media: 'badge', includeNotes: false });
      // Preserve packaged images after the decoding worker is terminated.
      for (const url of new Set(svg.match(/blob:[^\s"'<>]+/g) || [])) {
        if (!assets.has(url)) {
          const blob = await (await fetch(url)).blob();
          if (blob.size > 32 * 1024 * 1024 || !blob.type.startsWith('image/')) throw new Error('课件图片过大或格式不受支持。');
          const raw = new Uint8Array(await blob.arrayBuffer()); let text = '';
          for (let i = 0; i < raw.length; i += 16384) text += String.fromCharCode(...raw.subarray(i, i + 16384));
          assets.set(url, `data:${blob.type};base64,${btoa(text)}`);
        }
        svg = svg.replaceAll(url, assets.get(url));
      }
      total += svg.length;
      if (total > 64 * 1024 * 1024) throw new Error('课件预览内容过大，请下载后阅读。');
      slides.push(svg);
    }
    return { width: pres.width, height: pres.height, source: pres.source, slides };
  } finally { pres.dispose?.(); }
}
