// ==UserScript==
// @name         复旦 eLearning PDF 弹窗预览
// @namespace    https://elearning.fudan.edu.cn/
// @version      1.0.0
// @description  在 eLearning 页面中预览 PDF，无需自动保存文件
// @license      MIT
// @homepageURL  https://github.com/sjy0630/fudan-elearning-pdf-preview
// @supportURL   https://github.com/sjy0630/fudan-elearning-pdf-preview/issues
// @updateURL    https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js
// @downloadURL  https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js
// @match        https://elearning.fudan.edu.cn/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  function pdfLinkFromClick(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return null;
    }

    const link = event.target?.nodeType === 1 ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download')) return null;
    if (link.matches('.download, .download_link, [aria-label*="Download"], [aria-label*="下载"]')) {
      return null;
    }

    let url;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;

    const match = url.pathname.match(/^(\/(?:courses\/\d+\/)?files\/\d+)(?:\/.*)?$/);
    if (!match && !/\.pdf$/i.test(url.pathname)) return null;

    const label = [link.textContent, link.title, link.dataset.filename]
      .filter(Boolean)
      .join(' ');
    if (!/\.pdf\b/i.test(label)) return null;

    const name = (link.dataset.filename || link.textContent || link.title || 'PDF').trim();
    const downloadUrl = match
      ? new URL(`${match[1]}/download?download_frd=1`, location.origin)
      : url;
    return { link, url, name, downloadUrl };
  }

  const state = {
    root: null,
    title: null,
    status: null,
    viewer: null,
    originalLink: null,
    downloadLink: null,
    closeButton: null,
    trigger: null,
    controller: null,
    objectUrl: null,
    requestId: 0,
    oldOverflow: '',
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function ensureDialog() {
    if (state.root) return;

    const style = element('style');
    style.textContent = `
      .fdpdf-overlay[hidden], .fdpdf-overlay [hidden] { display: none !important; }
      .fdpdf-overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex;
        align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
        background: rgba(15, 23, 42, .68); font: 14px/1.5 system-ui, sans-serif; }
      .fdpdf-dialog { display: flex; flex-direction: column; width: min(1200px, 100%);
        height: min(900px, 100%); min-height: 280px; overflow: hidden; border-radius: 12px;
        background: #fff; box-shadow: 0 20px 70px rgba(0, 0, 0, .35); color: #1f2937; }
      .fdpdf-header { display: flex; align-items: center; gap: 12px; min-height: 54px;
        box-sizing: border-box; padding: 10px 16px; border-bottom: 1px solid #e5e7eb; }
      .fdpdf-title { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; font-size: 16px; font-weight: 600; }
      .fdpdf-action { flex: none; border: 1px solid #cbd5e1; border-radius: 6px;
        padding: 6px 10px; background: #fff; color: #1d4ed8; text-decoration: none;
        font: inherit; cursor: pointer; }
      .fdpdf-action:hover, .fdpdf-action:focus-visible { background: #eff6ff; }
      .fdpdf-close { color: #334155; }
      .fdpdf-body { position: relative; flex: 1; min-height: 0; display: flex;
        align-items: center; justify-content: center; background: #e5e7eb; }
      .fdpdf-status { position: absolute; z-index: 1; max-width: 420px; margin: 16px;
        padding: 18px 22px; border-radius: 8px; background: #fff; text-align: center;
        color: #334155; white-space: pre-line; box-shadow: 0 4px 18px #64748b44; }
      .fdpdf-viewer { display: block; width: 100%; height: 100%; border: 0; background: #e5e7eb; }
      @media (max-width: 600px) {
        .fdpdf-overlay { padding: 0; }
        .fdpdf-dialog { height: 100%; min-height: 0; border-radius: 0; }
        .fdpdf-header { flex-wrap: wrap; }
        .fdpdf-title { flex-basis: 100%; }
      }
    `;

    const root = element('div', 'fdpdf-overlay');
    root.hidden = true;
    const dialog = element('section', 'fdpdf-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'fdpdf-title');

    const header = element('header', 'fdpdf-header');
    const title = element('h2', 'fdpdf-title');
    title.id = 'fdpdf-title';
    const originalLink = element('a', 'fdpdf-action', '打开原文件');
    originalLink.hidden = true;
    originalLink.target = '_blank';
    originalLink.rel = 'noopener noreferrer';
    const downloadLink = element('a', 'fdpdf-action', '下载 PDF');
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    const closeButton = element('button', 'fdpdf-action fdpdf-close', '关闭');
    closeButton.type = 'button';
    header.append(title, originalLink, downloadLink, closeButton);

    const body = element('div', 'fdpdf-body');
    const status = element('div', 'fdpdf-status', '正在读取 PDF…');
    status.setAttribute('role', 'status');
    const viewer = element('iframe', 'fdpdf-viewer');
    viewer.title = 'PDF 预览';
    viewer.hidden = true;
    body.append(status, viewer);
    dialog.append(header, body);
    root.append(dialog);
    document.head.append(style);
    document.body.append(root);

    root.addEventListener('click', (event) => {
      if (event.target === root) closeDialog();
    });
    closeButton.addEventListener('click', closeDialog);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !root.hidden) closeDialog();
    });

    Object.assign(state, { root, title, status, viewer, originalLink, downloadLink, closeButton });
  }

  function clearPending() {
    state.requestId += 1;
    state.controller?.abort();
    state.controller = null;
    if (state.viewer) {
      state.viewer.onload = null;
      state.viewer.onerror = null;
      state.viewer.removeAttribute('src');
      state.viewer.hidden = true;
    }
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  }

  function closeDialog() {
    if (!state.root || state.root.hidden) return;
    clearPending();
    state.root.hidden = true;
    document.body.style.overflow = state.oldOverflow;
    state.trigger?.focus();
    state.trigger = null;
  }

  function showError(message) {
    state.viewer.hidden = true;
    state.status.hidden = false;
    state.status.textContent = `${message}\n可以打开原文件，或使用右上角的下载按钮。`;
    state.originalLink.hidden = false;
  }

  function requestThroughTampermonkey(url, signal) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('浏览器扩展未提供跨站文件读取功能。'));
        return;
      }
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      let request;
      let finished = false;
      const done = (callback) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => {
        request?.abort();
        done(() => reject(new DOMException('Aborted', 'AbortError')));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        request = GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'blob',
          timeout: 60000,
          headers: { Accept: 'application/pdf' },
          onload: (response) => done(() => {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error(response.status === 401 || response.status === 403
                ? '登录状态或文件权限已失效。'
                : `文件请求失败（HTTP ${response.status}）。`));
              return;
            }
            if (!response.response) {
              reject(new Error('文件服务返回了空内容。'));
              return;
            }
            resolve(new Blob([response.response], { type: 'application/pdf' }));
          }),
          onerror: () => done(() => reject(new Error('文件服务拒绝了预览请求。'))),
          ontimeout: () => done(() => reject(new Error('文件读取超时。'))),
          onabort: () => done(() => reject(new DOMException('Aborted', 'AbortError'))),
        });
      } catch (error) {
        done(() => reject(error));
      }
      if (signal.aborted) onAbort();
    });
  }

  async function retrievePdf(file, signal) {
    try {
      const response = await fetch(file.downloadUrl.href, {
        credentials: 'same-origin',
        redirect: 'follow',
        signal,
        headers: { Accept: 'application/pdf' },
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? '登录状态或文件权限已失效。'
          : `文件请求失败（HTTP ${response.status}）。`);
      }
      return await response.blob();
    } catch (error) {
      if (signal.aborted || error?.name !== 'TypeError') throw error;
      // Canvas may redirect a file to another host that cannot be read by page fetch.
      return await requestThroughTampermonkey(file.downloadUrl.href, signal);
    }
  }

  async function loadPdf(file) {
    const requestId = state.requestId;
    const controller = new AbortController();
    state.controller = controller;
    const timeoutId = setTimeout(() => {
      if (requestId === state.requestId && !state.root.hidden) {
        controller.abort();
        showError('文件读取超时。');
      }
    }, 60000);

    try {
      const blob = await retrievePdf(file, controller.signal);
      const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      const isPdf = signature.length === 5 &&
        signature[0] === 0x25 && signature[1] === 0x50 && signature[2] === 0x44 &&
        signature[3] === 0x46 && signature[4] === 0x2d;
      if (!isPdf) throw new Error('服务器返回的不是 PDF 文件。');
      if (requestId !== state.requestId || state.root.hidden) return;

      const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
      state.objectUrl = URL.createObjectURL(pdfBlob);
      state.downloadLink.href = state.objectUrl;
      state.downloadLink.download = /\.pdf$/i.test(file.name) ? file.name : 'document.pdf';
      state.status.textContent = '正在打开预览…';
      state.viewer.onload = () => {
        if (requestId === state.requestId) state.status.hidden = true;
      };
      state.viewer.onerror = () => {
        if (requestId === state.requestId) showError('浏览器未能嵌入 PDF 预览。');
      };
      state.viewer.hidden = false;
      state.viewer.src = state.objectUrl;
    } catch (error) {
      if (controller.signal.aborted || requestId !== state.requestId) return;
      showError(error instanceof Error ? error.message : '无法读取 PDF。');
    } finally {
      clearTimeout(timeoutId);
      if (state.controller === controller) state.controller = null;
    }
  }

  function openDialog(file) {
    ensureDialog();
    if (state.root.hidden) state.oldOverflow = document.body.style.overflow;
    clearPending();
    state.trigger = file.link;
    state.title.textContent = file.name;
    state.originalLink.href = file.url.href;
    state.originalLink.hidden = true;
    state.downloadLink.href = file.downloadUrl.href;
    state.downloadLink.removeAttribute('download');
    state.status.textContent = '正在读取 PDF…';
    state.status.hidden = false;
    state.root.hidden = false;
    document.body.style.overflow = 'hidden';
    state.closeButton.focus();
    void loadPdf(file);
  }

  window.addEventListener('click', (event) => {
    const file = pdfLinkFromClick(event);
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openDialog(file);
  }, true);
})();
