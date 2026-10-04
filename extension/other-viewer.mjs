import { imageMime, decodeText } from './formats.mjs';
import { renderDocx } from './vendor/docx.bundle.mjs';
import { decodeHeic } from './heic.mjs';
import { fitScale, viewportSize, visiblePage, scrollToPage } from './layout.mjs';

export async function renderOther(bytes, format, target, { root, api, onChange = () => {}, powerpointOptions = {} } = {}) {
  target.replaceChildren(); target.hidden = false; target.style.zoom = '';
  const content = document.createElement('div'); target.append(content);
  let resource, pages = [], page = 1, scale = 1, readingMode = 'scroll', zoomMode = 'page';
  if (format === 'docx') {
    const shadow = await renderDocx(bytes, content);
    pages = [...shadow.querySelectorAll('section.docx')];
    const wrapper = shadow.querySelector('.docx-wrapper');
    if (wrapper) wrapper.style.setProperty('padding', '0', 'important');
  } else if (format === 'powerpoint') {
    const { renderPowerPoint } = await import('./vendor/powerpoint.bundle.mjs');
    pages = await renderPowerPoint(bytes, content, { workerURL: api?.runtime.getURL('vendor/powerpoint.worker.mjs'), ...powerpointOptions });
  } else if (format === 'image') {
    const img = document.createElement('img'); img.alt = '提交的作业图片';
    resource = URL.createObjectURL(new Blob([bytes], { type: imageMime(bytes) })); img.src = resource;
    try { await img.decode(); } catch { URL.revokeObjectURL(resource); throw new Error('图片无法解码，请下载后阅读。'); }
    if (img.naturalWidth * img.naturalHeight > 50000000) { URL.revokeObjectURL(resource); throw new Error('照片超过 5000 万像素，请下载原件阅读。'); }
    content.append(img); pages = [img];
  } else if (format === 'heic') {
    const data = await decodeHeic(bytes, { workerURL: api.runtime.getURL('vendor/heic.worker.js') });
    const canvas = document.createElement('canvas'); canvas.width = data.width; canvas.height = data.height;
    canvas.setAttribute('aria-label', 'HEIC 作业照片'); canvas.getContext('2d').putImageData(data, 0, 0);
    content.append(canvas); pages = [canvas];
  } else {
    const pre = document.createElement('pre'); pre.textContent = decodeText(bytes); content.append(pre); pages = [pre];
  }
  if (!pages.length) throw new Error('文件中没有可显示的页面。');
  const dimensions = pages.map((el) => ({ width: el.naturalWidth || el.width || (format === 'powerpoint' ? parseFloat(el.style.width) : 0) || el.getBoundingClientRect().width || 794, height: el.naturalHeight || el.height || (format === 'powerpoint' ? parseFloat(el.style.height) : 0) || el.getBoundingClientRect().height || 1123 }));
  const notify = () => onChange({ page, pages: pages.length, scale });
  const onScroll = () => { if (readingMode === 'scroll' && pages.length > 1) { page = visiblePage(root, pages); notify(); } };
  root.addEventListener('scroll', onScroll, { passive: true });
  const view = {
    get pages() { return pages.length; },
    configure(options = {}) {
      ({ readingMode = readingMode, zoomMode = zoomMode } = options);
      const size = viewportSize(root);
      if (format === 'text') { scale = zoomMode === 'custom' ? (options.scale || scale) : 1; target.style.fontSize = `${14 * scale}px`; }
      else {
        const selected = readingMode === 'page' ? [dimensions[page - 1]] : dimensions;
        scale = fitScale(Math.max(...selected.map((d) => d.width)), Math.max(...selected.map((d) => d.height)), size.width, size.height, zoomMode, options.scale || scale);
        target.style.zoom = scale;
      }
      pages.forEach((el, index) => { el.hidden = readingMode === 'page' && index !== page - 1; });
      if (readingMode === 'page') root.scrollTop = 0;
      else if (pages.length > 1) scrollToPage(root, pages[page - 1]);
      notify();
    },
    goTo(number) {
      page = Math.max(1, Math.min(pages.length, Math.trunc(Number(number) || 1)));
      if (readingMode === 'page') view.configure({ readingMode, zoomMode, scale });
      else { scrollToPage(root, pages[page - 1]); notify(); }
    },
    destroy() {
      root.removeEventListener('scroll', onScroll); if (resource) URL.revokeObjectURL(resource);
      for (const canvas of content.querySelectorAll('canvas')) canvas.width = canvas.height = 0;
      target.replaceChildren(); target.hidden = true; target.style.zoom = ''; target.style.fontSize = '';
    },
  };
  return view;
}
