import * as pdfjs from './vendor/pdf.mjs';
import { HostPermissionError, readFile } from './reader.mjs';
import { renderOther } from './other-viewer.mjs';
import { PdfReader } from './pdf-reader.mjs';
import { parseZip, readZipEntry } from './zip.mjs';

const api = globalThis.browser || chrome;
const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const previewController = new AbortController();
const signal = previewController.signal;
const demoFormat = ['docx', 'zip', 'pptx'].includes(query.get('demo')) ? query.get('demo') : query.get('demo') === '1' ? 'pdf' : null;
const source = query.get('source');
const embedded = window.top !== window;
const formatOf = (name) => CanvasPreviewCatalog.formats.find((item) => item.pathPattern.test(name))?.id || 'unsupported';
let fileName = demoFormat ? `演示文件.${demoFormat}` : FdPdf.filename(query.get('name'));
let fileFormat = (demoFormat === 'pptx' ? 'powerpoint' : demoFormat) || FdPdf.describe(source, fileName)?.format || 'unsupported';
let name = fileName, format = fileFormat, localFile, archive, view, documentTask, workerPort, downloadURL;
let loading = false, pendingScope, loadStage = '准备阅读器', page = 1, pageCount = 0, scale = 1;
let zoomMode = 'page', readingMode = 'scroll';
const preferenceKey = 'courselens.exitAutoClear';
let autoClear = true, retainedBytes = null;
try { autoClear = localStorage.getItem(preferenceKey) !== 'false'; } catch { /* Private browsing may disable storage. */ }
const cacheMessage = (type, extra = {}) => api.runtime.sendMessage({ type, ...extra }).catch(() => null);
const policyReady = cacheMessage('preview-policy', { autoClear });
const cacheLimit = 8 * 1024 * 1024;
function updateCleanupOption() {
  $('auto-clear').checked = autoClear;
  $('cleanup-detail').textContent = autoClear ? '退出后释放文件缓存。' : '临时复用小文件，最多 5 分钟；浏览器可能提前回收。';
}
async function retain(bytes) {
  retainedBytes = null;
  if (!source || localFile || demoFormat || bytes.byteLength > cacheLimit) return;
  retainedBytes = bytes.slice();
  if (!autoClear) await cacheMessage('preview-cache-put', { data: CoursePreviewCache.encode(retainedBytes) });
}
pdfjs.GlobalWorkerOptions.workerSrc = api.runtime.getURL('vendor/pdf.worker.mjs');
if (embedded) { document.body.classList.add('embedded'); $('standalone').href = location.href; $('standalone').hidden = false; }
$('local-picker').hidden = embedded || Boolean(source) || Boolean(demoFormat);
$('demo-note').hidden = !demoFormat;

function showStatus(title, detail, retry = false) {
  $('status').hidden = false; $('status-title').textContent = title; $('status-detail').textContent = detail; $('retry').hidden = !retry;
}
function updateControls() {
  $('title').textContent = archive ? `${archive.name} / ${name}` : name;
  document.title = `${name} · CourseLens`;
  $('badge').textContent = ({ pdf: 'PDF', docx: 'DOCX', powerpoint: /\.ppt$/i.test(name) ? 'PPT' : 'PPTX', heic: 'HEIC', zip: 'ZIP', image: '图片', text: '文本', unsupported: '附件' })[format];
  const ready = Boolean(view && pageCount);
  $('pdf-controls').hidden = !ready || (pageCount < 2 && format !== 'pdf');
  $('page').disabled = !ready; $('page').value = page; $('page').max = pageCount || 1;
  sizePageInput();
  $('page-count').textContent = `/ ${pageCount || '—'}`;
  $('previous').disabled = !ready || page <= 1; $('next').disabled = !ready || page >= pageCount;
  for (const id of ['zoom-in', 'zoom-out', 'fit-mode']) $(id).disabled = !ready;
  $('reading-mode').disabled = !ready || pageCount < 2;
  $('reading-mode').value = readingMode;
  $('fit-mode').value = zoomMode;
  $('zoom-label').textContent = `${Math.round(scale * 100)}%`;
  const hasFormatNote = ['docx', 'powerpoint'].includes(format);
  $('format-info').hidden = !hasFormatNote;
  $('format-info').textContent = $('format-note').hidden ? '显示说明' : '收起说明';
  if (!hasFormatNote) $('format-note').hidden = true;
  $('format-note').textContent = format === 'powerpoint' ? '课件按静态幻灯片阅读。字体、复杂图形和特殊公式可能与 PowerPoint 不同，动画、音视频及加密课件暂不支持。' : 'DOCX 复杂版式可能与 Word 不同；如公式或图表缺失，请下载核对。';
  $('download-toggle').disabled = $('download-current').hidden && $('download-original').hidden;
  $('archive-entry').disabled = loading; $('local-file').disabled = loading;
}
function onChange(state) { page = state.page; pageCount = state.pages; scale = state.scale; updateControls(); }
function configure() {
  if (!view) return;
  try { view.configure({ zoomMode, readingMode, scale }); }
  catch (error) { showError(error); }
}
function showError(error) {
  if (signal.aborted) return;
  if (error instanceof HostPermissionError) {
    pendingScope = error.scope; $('grant-more').hidden = false;
    showStatus('需要允许读取文件服务器', `${new URL(error.scope).hostname}\n可从“更多功能 → 文件服务器授权”继续。`);
    const key = `courselens.permission:${error.scope}`;
    let first = true; try { first = !sessionStorage.getItem(key); sessionStorage.setItem(key, '1'); } catch { /* Show in this context only. */ }
    if (first && !$('permission-prompt').open) { $('permission-host').textContent = new URL(error.scope).hostname; $('permission-prompt').showModal(); }
  } else {
    showStatus('暂时无法预览', `阶段：${loadStage}\n${error?.message || String(error || '文件无法读取。')}`, true);
  }
}
async function clearDocument() {
  view?.destroy(); view = null; pageCount = 0;
  $('pdf-document').replaceChildren(); $('other-document').replaceChildren();
  if (downloadURL) URL.revokeObjectURL(downloadURL); downloadURL = null;
  for (const id of ['download', 'download-current', ...(!archive ? ['download-original'] : [])]) {
    $(id).removeAttribute('href'); $(id).removeAttribute('download'); $(id).hidden = true;
  }
  $('pdf-document').hidden = true; $('other-document').hidden = true;
  const task = documentTask, port = workerPort; documentTask = null; workerPort = null; pdfjs.GlobalWorkerOptions.workerPort = null;
  try { await task?.destroy(); } finally { port?.terminate(); }
}

function clearArchive() {
  if (archive?.url) URL.revokeObjectURL(archive.url);
  if (archive) { archive.bytes = null; archive.entries = []; }
  $('download-original').removeAttribute('href'); $('download-original').removeAttribute('download'); $('archive-summary').textContent = '';
  archive = null; $('archive-panel').hidden = true; $('archive-entry').replaceChildren();
  $('download-original').hidden = true;
}
async function display(bytes, nextName, nextFormat) {
  await clearDocument(); signal.throwIfAborted(); name = nextName; format = nextFormat; page = 1; scale = 1; zoomMode = 'page'; $('format-note').hidden = true;
  updateControls(); $('workspace').scrollTop = 0;
  const mime = format === 'pdf' ? 'application/pdf' : format === 'heic' ? 'image/heic' : 'application/octet-stream';
  downloadURL = URL.createObjectURL(new Blob([bytes], { type: mime }));
  for (const id of ['download', 'download-current', ...(!archive ? ['download-original'] : [])]) {
    $(id).href = downloadURL; $(id).download = name; $(id).hidden = false;
  }
  if (format === 'unsupported' || format === 'zip') {
    showStatus('此文件暂不支持直接预览', format === 'zip' ? '嵌套 ZIP 请下载后解压。' : /\.doc$/i.test(name) ? '旧版 DOC 请另存为 DOCX 或 PDF。' : '可以下载此文件，用对应的软件阅读。');
    return;
  }
  loadStage = format === 'pdf' ? '启动 PDF 阅读器' : format === 'heic' ? '解码 HEIC 照片' : '解析文件';
  showStatus(format === 'heic' ? '正在解码苹果照片…' : '正在准备预览…', '文件在浏览器本地处理。');
  if (format === 'pdf') {
    workerPort = new Worker(api.runtime.getURL('vendor/pdf.worker.mjs'), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = workerPort;
    documentTask = pdfjs.getDocument({ data: bytes, cMapUrl: api.runtime.getURL('vendor/cmaps/'), cMapPacked: true, standardFontDataUrl: api.runtime.getURL('vendor/standard_fonts/'), wasmUrl: api.runtime.getURL('vendor/wasm/'), isEvalSupported: false });
    documentTask.onPassword = (updatePassword) => {
      const password = window.prompt('此 PDF 已加密，请输入文件密码（不会保存）：');
      if (password === null) { documentTask.destroy(); showStatus('已取消打开加密文件', '点击重试可重新打开。', true); }
      else updatePassword(password);
    };
    const pdf = await documentTask.promise; signal.throwIfAborted();
    loadStage = '绘制 PDF 页面';
    view = new PdfReader({ pdfjs, root: $('workspace'), target: $('pdf-document'), name, onChange, onError: showError });
    view.readingMode = readingMode; view.zoomMode = zoomMode;
    await view.open(pdf);
  } else {
    view = await renderOther(bytes, format, $('other-document'), { root: $('workspace'), api, onChange, signal });
    configure();
  }
  signal.throwIfAborted(); $('status').hidden = true; updateControls();
}
async function openArchiveEntry(index) {
  const entry = archive.entries[index];
  if (!entry) return;
  await clearDocument(); name = entry.name; format = formatOf(entry.name); updateControls();
  loadStage = '解压 ZIP 内文件'; showStatus('正在读取 ZIP 内文件…', entry.name);
  const bytes = await readZipEntry(archive.bytes, entry, { workerURL: api.runtime.getURL('vendor/zip.worker.mjs'), signal });
  await display(bytes, entry.name, formatOf(entry.name));
}
async function load() {
  if (loading) return;
  loading = true; $('grant').hidden = true; $('grant-more').hidden = true; pendingScope = null; updateControls();
  try {
    retainedBytes = null;
    await clearDocument(); signal.throwIfAborted(); clearArchive(); name = fileName; format = fileFormat; updateControls();
    if (!demoFormat && !localFile && !FdPdf.fileUrl(source)) { showStatus('打开作业文件', '回到 eLearning 点击文件名，或在这里打开本地文件。'); return; }
    loadStage = '读取附件'; showStatus('正在读取文件…', '文件在浏览器本地处理。');
    let bytes;
    if (localFile) {
      if (localFile.size > 100 * 1024 * 1024) throw new Error('文件超过 100 MiB，请使用本地软件阅读。');
      bytes = new Uint8Array(await localFile.arrayBuffer());
    } else if (demoFormat) {
      const response = await fetch(api.runtime.getURL(`demo.${demoFormat}`));
      if (!response.ok) throw new Error('内置示例缺失，请重新加载扩展。');
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      await policyReady; signal.throwIfAborted();
      const cached = !autoClear && await cacheMessage('preview-cache-get');
      signal.throwIfAborted();
      bytes = cached?.data ? CoursePreviewCache.decode(cached.data) : await readFile(source, { api, format: fileFormat, signal });
      signal.throwIfAborted(); await retain(bytes);
    }
    signal.throwIfAborted();
    if (fileFormat !== 'zip') await display(bytes, fileName, fileFormat);
    else {
      loadStage = '读取 ZIP 文件列表'; const entries = parseZip(bytes);
      archive = { bytes, entries, name: fileName, url: URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })) };
      $('download-original').href = archive.url; $('download-original').download = fileName;
      $('download-original').hidden = false;
      $('archive-summary').textContent = `${entries.length} 个文件`;
      $('archive-entry').replaceChildren(...entries.map((entry, index) => {
        const option = document.createElement('option'); option.value = index;
        option.textContent = entry.name + (entry.encrypted ? '（加密）' : !entry.readable ? '（不支持压缩方法）' : '');
        option.disabled = !entry.readable; return option;
      }));
      $('archive-panel').hidden = false;
      const first = entries.findIndex((entry) => entry.readable && !['unsupported', 'zip'].includes(formatOf(entry.name)));
      if (first >= 0) { $('archive-entry').value = first; await openArchiveEntry(first); }
      else { $('archive-entry').selectedIndex = -1; showStatus('ZIP 文件列表已打开', '选择文件可以下载，支持的 PDF、DOCX、PPT / PPTX、HEIC、图片和文本可以直接阅读。加密 ZIP 请先在本地解密。'); }
    }
  } catch (error) { showError(error); }
  finally { loading = false; updateControls(); }
}
$('archive-entry').addEventListener('change', async () => {
  if (loading || !archive) return;
  loading = true; updateControls();
  try { await openArchiveEntry(Number($('archive-entry').value)); } catch (error) { showError(error); }
  finally { loading = false; updateControls(); }
});
$('local-file').addEventListener('change', () => {
  if (loading || !$('local-file').files[0]) return;
  localFile = $('local-file').files[0]; fileName = FdPdf.filename(localFile.name); fileFormat = formatOf(fileName); load();
});
$('retry').addEventListener('click', load);
function authorize() {
  if (!pendingScope) return;
  $('permission-prompt').close(); closeMenus();
  if (embedded) {
    cacheMessage('preview-authorize', { scope: pendingScope }).then((result) => {
      if (!result?.ok) showStatus('无法打开授权窗口', '请刷新页面后重试。');
    });
  } else api.permissions.request({ origins: [pendingScope] }).then((granted) => { if (granted) load(); }).catch(showError);
}
for (const id of ['grant', 'grant-more', 'prompt-allow']) $(id).addEventListener('click', authorize);
$('prompt-later').addEventListener('click', () => $('permission-prompt').close());
const permissionAdded = async () => {
  if (pendingScope && await api.permissions.contains({ origins: [pendingScope] }) && !signal.aborted) { $('permission-prompt').close(); load(); }
};
api.permissions.onAdded?.addListener(permissionAdded);
$('auto-clear').addEventListener('change', async () => {
  autoClear = $('auto-clear').checked;
  try { localStorage.setItem(preferenceKey, String(autoClear)); } catch { /* Keep choice for this preview. */ }
  updateCleanupOption();
  await cacheMessage('preview-policy', { autoClear });
  if (!autoClear && retainedBytes && !signal.aborted) await cacheMessage('preview-cache-put', { data: CoursePreviewCache.encode(retainedBytes) });
});
const storageChanged = (event) => {
  if (event.key !== preferenceKey) return;
  autoClear = event.newValue !== 'false'; updateCleanupOption();
  cacheMessage('preview-policy', { autoClear });
};
window.addEventListener('storage', storageChanged);
$('fit-mode').addEventListener('change', () => { zoomMode = $('fit-mode').value; configure(); });
for (const [id, factor] of [['zoom-in', 1.2], ['zoom-out', 1 / 1.2]]) $(id).addEventListener('click', () => { zoomMode = 'custom'; scale = Math.min(4, Math.max(.02, scale * factor)); configure(); });
$('reading-mode').addEventListener('change', () => { readingMode = $('reading-mode').value; configure(); });
$('previous').addEventListener('click', () => view?.goTo(page - 1));
$('next').addEventListener('click', () => view?.goTo(page + 1));
$('page').addEventListener('change', () => view?.goTo($('page').value));
function sizePageInput() { $('page').style.setProperty('--page-digits', `${Math.max(1, $('page').value.length)}ch`); }
$('page').addEventListener('input', sizePageInput);
function closeMenus() {
  for (const name of ['more', 'download']) { $(`${name}-menu`).hidden = true; $(`${name}-toggle`).setAttribute('aria-expanded', 'false'); }
}
function positionMenu(name) {
  const menu = $(`${name}-menu`), rect = $(`${name}-toggle`).getBoundingClientRect();
  menu.style.right = `${Math.max(8, innerWidth - rect.right)}px`; menu.style.top = `${rect.bottom + 6}px`;
  menu.style.maxHeight = `${Math.max(0, innerHeight - rect.bottom - 16)}px`;
}
function positionOpenMenus() {
  for (const name of ['more', 'download']) if (!$(`${name}-menu`).hidden) positionMenu(name);
}
for (const name of ['more', 'download']) {
  const button = $(`${name}-toggle`), menu = $(`${name}-menu`);
  button.addEventListener('click', () => {
    const open = menu.hidden; closeMenus(); if (!open) return;
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    positionMenu(name);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (menu.hidden) button.click(); menu.querySelector('a:not([hidden]), button:not([hidden]):not(:disabled), select:not(:disabled), input:not(:disabled)')?.focus(); }
  });
}
document.addEventListener('click', (event) => { if (!event.target.closest('.menu, #more-toggle, #download-toggle')) closeMenus(); });
$('format-info').addEventListener('click', () => { $('format-note').hidden = !$('format-note').hidden; $('format-info').textContent = $('format-note').hidden ? '显示说明' : '收起说明'; closeMenus(); });
let resizeTimer;
const resize = () => { positionOpenMenus(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (zoomMode !== 'custom') configure(); }, 100); };
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe($('workspace'));
window.addEventListener('resize', positionOpenMenus);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('permission-prompt').open) { event.preventDefault(); $('permission-prompt').close(); return; }
  if (event.key === 'Escape' && (!$('more-menu').hidden || !$('download-menu').hidden)) { event.preventDefault(); const trigger = $('more-menu').hidden ? $('download-toggle') : $('more-toggle'); closeMenus(); trigger.focus(); return; }
  if (event.key === 'Escape' && embedded) { window.parent.postMessage({ type: 'fdta-close' }, FdPdf.ORIGIN); return; }
  if (event.target.matches('input, select, button, a, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (view && event.key === 'ArrowLeft') { event.preventDefault(); view.goTo(page - 1); }
  if (view && event.key === 'ArrowRight') { event.preventDefault(); view.goTo(page + 1); }
});
window.addEventListener('pagehide', () => {
  previewController.abort(); resizeObserver.disconnect(); clearTimeout(resizeTimer);
  window.removeEventListener('resize', positionOpenMenus);
  api.permissions.onAdded?.removeListener(permissionAdded); window.removeEventListener('storage', storageChanged);
  if (autoClear && source) cacheMessage('preview-cache-remove');
  retainedBytes = null;
  const port = workerPort, pending = clearDocument(); port?.terminate(); pending.catch(() => {});
  clearArchive(); localFile = null; $('local-file').value = '';
});
window.addEventListener('pageshow', (event) => { if (event.persisted && signal.aborted) location.reload(); });
updateControls();
updateCleanupOption();
load();
