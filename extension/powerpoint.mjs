import createDOMPurify from 'dompurify';

export function parsePowerPoint(bytes, { workerURL, WorkerImpl = Worker, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new WorkerImpl(workerURL, { type: 'module' }); let done = false;
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('课件解析超时，请下载后阅读。')), timeout);
    worker.onerror = () => finish(new Error('课件阅读器未能运行，请重新加载插件后重试。'));
    worker.onmessage = ({ data }) => { if (data?.id === 'slides') finish(data.error ? new Error(data.error) : null, data.presentation); };
    const buffer = bytes.slice().buffer;
    try { worker.postMessage({ id: 'slides', buffer }, [buffer]); } catch (error) { finish(error); }
  });
}
export function safeSlide(svg, windowObject = window) {
  const fragment = createDOMPurify(windowObject).sanitize(svg, {
    RETURN_DOM_FRAGMENT: true, USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'style', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'],
    FORBID_ATTR: ['style'],
  });
  for (const el of fragment.querySelectorAll('*')) for (const attr of [...el.attributes]) {
    if (['href', 'xlink:href'].includes(attr.name) && !/^(?:#|data:image\/(?:png|jpeg|gif|webp|bmp|svg\+xml);base64,)/i.test(attr.value)) el.removeAttribute(attr.name);
    if (/url\(/i.test(attr.value) && !/^url\(#[\w.-]+\)$/.test(attr.value)) el.removeAttribute(attr.name);
  }
  return fragment;
}
export async function renderPowerPoint(bytes, target, options = {}) {
  const pres = await parsePowerPoint(bytes, options), pages = [];
  for (const [index, svg] of pres.slides.entries()) {
    const page = target.ownerDocument.createElement('section'); page.className = 'ppt-page';
    page.setAttribute('aria-label', `第 ${index + 1} 张幻灯片`);
    page.style.width = `${pres.width}px`; page.style.height = `${pres.height}px`;
    const fragment = safeSlide(svg, target.ownerDocument.defaultView), picture = fragment.querySelector('svg');
    if (!picture) throw new Error('课件页面无法显示，请下载原件阅读。');
    picture.style.cssText = 'display:block;width:100%;height:100%';
    page.attachShadow({ mode: 'open' }).append(fragment);
    target.append(page); pages.push(page);
  }
  return pages;
}
