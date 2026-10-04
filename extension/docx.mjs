import { renderAsync } from 'docx-preview';
import createDOMPurify from 'dompurify';
import { validateDocx } from './formats.mjs';

export async function renderDocx(bytes, target, windowObject = window) {
  validateDocx(bytes);
  const doc = target.ownerDocument;
  const body = doc.createElement('div'), styles = doc.createElement('div');
  await renderAsync(bytes, body, styles, {
    className: 'docx', inWrapper: true, useBase64URL: true,
    renderAltChunks: false, renderComments: false, renderChanges: false,
    ignoreWidth: false, ignoreHeight: false, breakPages: true,
    renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
    experimental: false,
  });
  const purifier = createDOMPurify(windowObject);
  const fragment = purifier.sanitize(body.innerHTML, {
    RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'video', 'audio'],
    FORBID_ATTR: ['srcdoc', 'srcset'],
  });
  for (const el of fragment.querySelectorAll('*')) {
    for (const attr of ['src', 'href', 'xlink:href']) {
      if (!el.hasAttribute(attr)) continue;
      const value = el.getAttribute(attr);
      const isLink = el.localName === 'a' && attr === 'href';
      if (!(isLink ? /^(?:https?:\/\/|#)/i : /^(?:data:image\/(?:png|jpeg|gif|webp|bmp|svg\+xml);base64,|#)/i).test(value)) el.removeAttribute(attr);
    }
    if (el.hasAttribute('style')) el.setAttribute('style', cleanCss(el.getAttribute('style')));
    if (el.localName === 'a') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  }
  // Isolate document CSS so it cannot obscure the reader's controls.
  const shadow = target.shadowRoot || target.attachShadow({ mode: 'open' });
  const sheet = doc.createElement('style');
  sheet.textContent = `:host{display:block}*{box-sizing:border-box}[hidden]{display:none!important} .docx-wrapper{padding:12px!important;background:transparent!important} section.docx{box-shadow:0 3px 16px #17305020;margin-bottom:20px!important} img{max-width:100%}`;
  shadow.replaceChildren(sheet);
  for (const style of styles.querySelectorAll('style')) {
    const safe = doc.createElement('style'); safe.textContent = cleanCss(style.textContent); shadow.append(safe);
  }
  shadow.append(fragment);
  return shadow;
}

export function cleanCss(text) {
  return text.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, url) =>
    /^data:(?:image\/|application\/|font\/)/i.test(url) ? match : 'none');
}
