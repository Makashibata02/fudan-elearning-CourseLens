/* Reads attachment links; never writes grades or comments. */
(function () {
  'use strict';
  if (window.top !== window) return;
  const api = globalThis.browser || chrome;
  const grading = /\/gradebook\/speed_grader\/?$/.test(location.pathname);
  let host, root, frame, selector, notice, active = false, current = null;
  let panelMode, savedOverflow, previousFocus;
  let files = [], signature = '', student = location.href, waitingFor = null, refreshTimer;
  const visible = (el) => !el.closest('[hidden], #submission_file_hidden') &&
    getComputedStyle(el).display !== 'none' && !el.closest('[style*="display: none"], [style*="display:none"]');
  function attachments() {
    const unique = new Map();
    document.querySelectorAll('#submission_files_list a[href], #submission_files_container a.display_name[href]').forEach((link) => {
      if (!visible(link) || link.hasAttribute('download') || link.matches('.submission-file-download, .download, .download_link')) return;
      const file = FdPdf.describe(link.href, link.dataset.filename || link.textContent.trim());
      if (file) unique.set(file.source, file);
    });
    return [...unique.values()];
  }
  function standalone(file) {
    return api.runtime.sendMessage({ type: 'open-pdf', file }).then((result) => {
      if (!result?.ok) throw new Error('无法打开阅读器，请刷新页面后重试。');
    });
  }
  function clearPreview(message) {
    frame?.removeAttribute('src');
    if (frame) frame.hidden = true;
    if (notice) { notice.textContent = message; notice.hidden = false; }
    current = null;
  }
  function createPanel(modal = !grading) {
    const left = modal ? null : document.querySelector('#left_side');
    if (!left) modal = true;
    if (host?.isConnected && panelMode === (modal ? 'modal' : 'ta')) return true;
    if (host?.isConnected) close();
    panelMode = modal ? 'modal' : 'ta';
    host = document.createElement('div'); host.id = 'fdta-preview';
    host.style.cssText = modal ? 'position:fixed;inset:0;z-index:2147483646;background:#10223d88;display:grid;place-items:center;' : 'position:absolute;inset:0;z-index:100;background:#edf1f6;';
    if (!modal && getComputedStyle(left).position === 'static') {
      host.dataset.originalPosition = left.style.position;
      left.style.position = 'relative';
    }
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{font:14px/1.5 system-ui;color:#24344a}*{box-sizing:border-box}[hidden]{display:none!important}
      section{height:100%;display:flex;flex-direction:column}header{display:flex;align-items:center;gap:8px;padding:10px;background:white;border-bottom:1px solid #d4dce7;flex-wrap:wrap}
      select{flex:1;min-width:100px;max-width:100%}button,select{font:inherit;border:1px solid #c6d2e2;border-radius:6px;padding:6px;background:white;color:#24344a}
      button{cursor:pointer}button:hover{background:#eef4ff}button:focus-visible,select:focus-visible{outline:3px solid #8cb5ff}
      iframe{border:0;width:100%;flex:1;min-height:0;background:#edf1f6}p{padding:24px;overflow-wrap:anywhere}b{font-size:13px}
      ${modal ? 'section{width:min(1280px,94vw);height:92vh;border-radius:12px;overflow:hidden;box-shadow:0 20px 70px #081c4266;background:white}' : ''}
      </style><section aria-label="文件阅读器" ${modal ? 'role="dialog" aria-modal="true"' : ''}><header><b>文件阅读</b><select aria-label="选择附件"></select><button data-action="tab" type="button">新标签页</button><button data-action="close" type="button">关闭</button></header><p role="status"></p><iframe title="作业文件预览" referrerpolicy="no-referrer" hidden></iframe></section>`;
    selector = root.querySelector('select'); notice = root.querySelector('p'); frame = root.querySelector('iframe');
    selector.addEventListener('change', () => open(files[Number(selector.value)], panelMode === 'modal'));
    root.querySelector('[data-action="tab"]').addEventListener('click', () => {
      if (current) standalone(current).catch((error) => { if (notice) { notice.hidden = false; notice.textContent = error.message; } });
    });
    root.querySelector('[data-action="close"]').addEventListener('click', close);
    if (modal) {
      previousFocus = document.activeElement; savedOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden'; document.body.append(host);
      host.addEventListener('click', (event) => { if (event.composedPath()[0] === host) close(); });
      root.querySelector('[data-action="close"]').focus();
      root.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;
        const controls = [...root.querySelectorAll('select,button,iframe')].filter((element) => !element.disabled && !element.hidden);
        const index = controls.indexOf(root.activeElement);
        if (event.shiftKey && index === 0) { event.preventDefault(); controls.at(-1).focus(); }
        else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0].focus(); }
      });
    } else left.append(host);
    return true;
  }
  function close() {
    active = false; waitingFor = null; clearPreview('');
    if (host?.hasAttribute('data-original-position') && host.parentElement) host.parentElement.style.position = host.dataset.originalPosition;
    host?.remove();
    if (panelMode === 'modal') { document.documentElement.style.overflow = savedOverflow || ''; previousFocus?.focus(); }
    panelMode = null; host = root = frame = selector = notice = null;
    files = []; signature = ''; previousFocus = null; savedOverflow = null;
  }
  function options() {
    if (!selector) return;
    selector.replaceChildren(...files.map((file, index) => {
      const option = document.createElement('option'); option.value = index; option.textContent = file.name; return option;
    }));
    selector.disabled = !files.length;
  }
  function open(file, modal = !grading) {
    if (!file) return;
    createPanel(modal);
    active = true; waitingFor = null;
    files = attachments();
    if (!files.some((item) => item.source === file.source)) files.push(file);
    signature = files.map((item) => item.source + item.name).join('|');
    student = location.href; options();
    selector.value = files.findIndex((item) => item.source === file.source);
    current = file; notice.hidden = true; frame.hidden = false;
    frame.src = FdPdf.viewerUrl(file, (p) => api.runtime.getURL(p));
  }
  function invalidate() {
    if (!active || panelMode !== 'ta') return;
    waitingFor = signature; clearPreview('正在切换提交…加载完成后会显示新附件，也可以点击文件名。');
  }
  function refresh() {
    const list = document.querySelector('#submission_files_list, #submission_files_container');
    if (list && !document.getElementById('fdta-open')) {
      const button = document.createElement('button'); button.id = 'fdta-open'; button.type = 'button';
      button.textContent = '阅读作业附件'; button.className = 'Button Button--small';
      button.addEventListener('click', () => {
        const first = attachments()[0];
        if (first) open(first);
        else if (createPanel()) { active = true; files = []; options(); clearPreview('当前提交没有可阅读的附件。'); }
      });
      list.after(button);
    }
    if (student !== location.href) { invalidate(); student = location.href; }
    if (active && panelMode === 'modal') return;
    const next = attachments(), nextSignature = next.map((file) => file.source + file.name).join('|');
    if (nextSignature === signature) return;
    files = next; signature = nextSignature;
    if (!active || panelMode !== 'ta') return;
    if (!createPanel()) { close(); return; }
    options();
    clearPreview(files.length ? '请选择附件。' : '当前提交没有可阅读的附件。');
    if (!files.length) return;
    if (waitingFor !== null && nextSignature === waitingFor) return;
    open(files[0]);
  }
  window.addEventListener('click', (event) => {
    if (grading && event.target?.closest?.('#next-student-button, #prev-student-button, .gradebookMoveToNext')) invalidate();
    const file = FdPdf.fromClick(event);
    if (!file || file.format === 'unsupported') return;
    event.preventDefault(); event.stopImmediatePropagation();
    open(file, !grading || !event.target.closest('#submission_files_list, #submission_files_container'));
  }, true);
  document.addEventListener('change', (event) => {
    if (event.target.closest('#combo_box_container, #multiple_submissions, #students_selectmenu')) invalidate();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active && !event.target.matches?.('input, textarea, [contenteditable]')) close();
  });
  window.addEventListener('message', (event) => {
    const extensionOrigin = api.runtime.getURL('').replace(/\/$/, '');
    if (event.source === frame?.contentWindow && event.origin === extensionOrigin && event.data?.type === 'fdta-close') close();
  });
  if (grading) {
    const observer = new MutationObserver((records) => {
      if (records.every((record) => host?.contains(record.target))) return;
      clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 80);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'style', 'hidden'] });
    const poll = setInterval(refresh, 500);
    window.addEventListener('pagehide', () => { observer.disconnect(); clearInterval(poll); clearTimeout(refreshTimer); close(); }, { once: true });
    refresh();
  }
})();
