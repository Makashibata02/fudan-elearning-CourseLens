import * as pdfjs from './vendor/pdf.mjs';
import { HostPermissionError, readFile } from './reader.mjs';
import { renderOther } from './other-viewer.mjs';
import { PdfReader } from './pdf-reader.mjs';
import { parseZip, readZipEntry } from './zip.mjs';

const api = globalThis.browser || chrome;
const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const demoFormat = query.get('demo') === 'docx' ? 'docx' : query.get('demo') === 'zip' ? 'zip' : query.get('demo') === '1' ? 'pdf' : null;
const source = query.get('source'), original = query.get('original') || source;
const embedded = window.top !== window;
const formatOf = (name) => CanvasPreviewCatalog.formats.find((item) => item.pathPattern.test(name))?.id || 'unsupported';
let fileName = demoFormat ? `演示文件.${demoFormat}` : FdPdf.filename(query.get('name'));
let fileFormat = demoFormat || FdPdf.describe(source, fileName)?.format || 'unsupported';
let name = fileName, format = fileFormat, localFile, archive, view, documentTask, workerPort, downloadURL;
let loading = false, pendingScope, loadStage = '准备阅读器', page = 1, pageCount = 0, scale = 1;
let zoomMode = 'page', readingMode = 'scroll';
pdfjs.GlobalWorkerOptions.workerSrc = api.runtime.getURL('vendor/pdf.worker.mjs');
if (embedded) { $('standalone').href = location.href; $('standalone').hidden = false; }
$('local-picker').hidden = embedded || Boolean(source) || Boolean(demoFormat);
$('demo-note').hidden = !demoFormat;
if (!demoFormat && FdPdf.fileUrl(original)) { $('original').href = original; $('original').hidden = false; }

function showStatus(title, detail, retry = false) {
  $('status').hidden = false; $('status-title').textContent = title; $('status-detail').textContent = detail; $('retry').hidden = !retry;
}
function updateControls() {
  $('title').textContent = archive ? `${archive.name} / ${name}` : name;
  document.title = `${name} · CourseLens`;
  $('badge').textContent = ({ pdf: 'PDF', docx: 'DOCX', heic: 'HEIC', zip: 'ZIP', image: '图片', text: '文本', unsupported: '附件' })[format];
  const ready = Boolean(view && pageCount);
  $('pdf-controls').hidden = !ready || (pageCount < 2 && format !== 'pdf');
  $('page').disabled = !ready; $('page').value = page; $('page').max = pageCount || 1;
  $('page-count').textContent = `/ ${pageCount || '—'}`;
  $('previous').disabled = !ready || page <= 1; $('next').disabled = !ready || page >= pageCount;
  for (const id of ['zoom-in', 'zoom-out', 'fit', 'fit-page']) $(id).disabled = !ready;
  $('reading-mode').disabled = !ready || pageCount < 2;
  $('reading-mode').value = readingMode;
  $('fit').setAttribute('aria-pressed', String(zoomMode === 'width'));
  $('fit-page').setAttribute('aria-pressed', String(zoomMode === 'page'));
  $('zoom-label').textContent = `${Math.round(scale * 100)}%`;
  $('format-note').hidden = format !== 'docx';
  $('archive-entry').disabled = loading; $('local-file').disabled = loading;
}
function onChange(state) { page = state.page; pageCount = state.pages; scale = state.scale; updateControls(); }
function configure() {
  if (!view) return;
  try { view.configure({ zoomMode, readingMode, scale }); }
  catch (error) { showError(error); }
}
function showError(error) {
  if (error instanceof HostPermissionError) {
    pendingScope = error.scope; $('grant').hidden = embedded;
    showStatus('需要允许读取文件服务器', `${new URL(error.scope).hostname}\n${embedded ? '点击“独立阅读 / 授权”，在新标签页允许此服务器，再返回重新打开附件。' : '点击下方按钮，仅允许此服务器；也可以打开原文件。'}`);
  } else {
    showStatus('暂时无法预览', `阶段：${loadStage}\n${error?.message || String(error || '文件无法读取。')}`, true);
  }
}
async function clearDocument() {
  view?.destroy(); view = null; pageCount = 0;
  await documentTask?.destroy(); documentTask = null;
  workerPort?.terminate(); workerPort = null; pdfjs.GlobalWorkerOptions.workerPort = null;
  if (downloadURL) URL.revokeObjectURL(downloadURL); downloadURL = null;
  $('download').hidden = true; $('pdf-document').hidden = true; $('other-document').hidden = true;
}
function clearArchive() {
  if (archive?.url) URL.revokeObjectURL(archive.url);
  archive = null; $('archive-panel').hidden = true; $('archive-entry').replaceChildren();
}
async function display(bytes, nextName, nextFormat) {
  await clearDocument(); name = nextName; format = nextFormat; page = 1; scale = 1; zoomMode = 'page';
  updateControls(); $('workspace').scrollTop = 0;
  const mime = format === 'pdf' ? 'application/pdf' : format === 'heic' ? 'image/heic' : 'application/octet-stream';
  downloadURL = URL.createObjectURL(new Blob([bytes], { type: mime }));
  $('download').href = downloadURL; $('download').download = name; $('download').hidden = false;
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
    const pdf = await documentTask.promise;
    loadStage = '绘制 PDF 页面';
    view = new PdfReader({ pdfjs, root: $('workspace'), target: $('pdf-document'), name, onChange, onError: showError });
    view.readingMode = readingMode; view.zoomMode = zoomMode;
    await view.open(pdf);
  } else {
    view = await renderOther(bytes, format, $('other-document'), { root: $('workspace'), api, onChange });
    configure();
  }
  $('status').hidden = true; updateControls();
}
async function openArchiveEntry(index) {
  const entry = archive.entries[index];
  if (!entry) return;
  await clearDocument(); name = entry.name; format = formatOf(entry.name); updateControls();
  loadStage = '解压 ZIP 内文件'; showStatus('正在读取 ZIP 内文件…', entry.name);
  const bytes = await readZipEntry(archive.bytes, entry, { workerURL: api.runtime.getURL('vendor/zip.worker.mjs') });
  await display(bytes, entry.name, formatOf(entry.name));
}
async function load() {
  if (loading) return;
  loading = true; $('grant').hidden = true; pendingScope = null; updateControls();
  try {
    await clearDocument(); clearArchive(); name = fileName; format = fileFormat; updateControls();
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
    } else bytes = await readFile(source, { api, format: fileFormat });
    if (fileFormat !== 'zip') await display(bytes, fileName, fileFormat);
    else {
      loadStage = '读取 ZIP 文件列表'; const entries = parseZip(bytes);
      archive = { bytes, entries, name: fileName, url: URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })) };
      $('archive-download').href = archive.url; $('archive-download').download = fileName;
      $('archive-summary').textContent = `${entries.length} 个文件`;
      $('archive-entry').replaceChildren(...entries.map((entry, index) => {
        const option = document.createElement('option'); option.value = index;
        option.textContent = entry.name + (entry.encrypted ? '（加密）' : !entry.readable ? '（不支持压缩方法）' : '');
        option.disabled = !entry.readable; return option;
      }));
      $('archive-panel').hidden = false;
      const first = entries.findIndex((entry) => entry.readable && !['unsupported', 'zip'].includes(formatOf(entry.name)));
      if (first >= 0) { $('archive-entry').value = first; await openArchiveEntry(first); }
      else { $('archive-entry').selectedIndex = -1; showStatus('ZIP 文件列表已打开', '选择文件可以下载，支持的 PDF、DOCX、HEIC、图片和文本可以直接阅读。加密 ZIP 请先在本地解密。'); }
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
$('grant').addEventListener('click', () => {
  if (!pendingScope) return;
  api.permissions.request({ origins: [pendingScope] }).then((granted) => granted ? load() : showStatus('尚未获得服务器权限', '可以再次授权，或打开原文件。')).catch(showError);
});
$('fit').addEventListener('click', () => { zoomMode = 'width'; configure(); });
$('fit-page').addEventListener('click', () => { zoomMode = 'page'; configure(); });
for (const [id, factor] of [['zoom-in', 1.2], ['zoom-out', 1 / 1.2]]) $(id).addEventListener('click', () => { zoomMode = 'custom'; scale = Math.min(4, Math.max(.02, scale * factor)); configure(); });
$('reading-mode').addEventListener('change', () => { readingMode = $('reading-mode').value; configure(); });
$('previous').addEventListener('click', () => view?.goTo(page - 1));
$('next').addEventListener('click', () => view?.goTo(page + 1));
$('page').addEventListener('change', () => view?.goTo($('page').value));
let resizeTimer;
const resize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (zoomMode !== 'custom') configure(); }, 100); };
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe($('workspace'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && embedded) { window.parent.postMessage({ type: 'fdta-close' }, FdPdf.ORIGIN); return; }
  if (event.target.matches('input, select, button, a, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (view && event.key === 'ArrowLeft') { event.preventDefault(); view.goTo(page - 1); }
  if (view && event.key === 'ArrowRight') { event.preventDefault(); view.goTo(page + 1); }
});
window.addEventListener('pagehide', () => { resizeObserver.disconnect(); clearTimeout(resizeTimer); view?.destroy(); documentTask?.destroy(); workerPort?.terminate(); if (downloadURL) URL.revokeObjectURL(downloadURL); clearArchive(); });
updateControls(); load();
