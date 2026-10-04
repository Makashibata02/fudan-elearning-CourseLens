/* Chrome and Edge use the same Chromium service worker. */
if (typeof importScripts === 'function') importScripts('catalog.js', 'core.js', 'preview-cache.js');
const api = globalThis.browser || chrome;
const cache = new CoursePreviewCache.PreviewCache();
let autoClear = true;
let expiryTimer;
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (!cache.entries.size) return;
  const expires = Math.min(...Array.from(cache.entries.values(), (entry) => entry.expires));
  expiryTimer = setTimeout(() => { cache.prune(); scheduleExpiry(); }, Math.max(0, expires - Date.now()));
}

function viewerRequest(sender) {
  if (sender.id !== api.runtime.id) return null;
  try {
    const url = new URL(sender.url);
    const expected = new URL(api.runtime.getURL('viewer.html'));
    if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== '/viewer.html') return null;
    return url;
  } catch { return null; }
}

api.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['preview-policy', 'preview-cache-get', 'preview-cache-put', 'preview-cache-remove', 'preview-authorize'].includes(message?.type)) return false;
  const viewer = viewerRequest(sender); if (!viewer) return false;
  if (message.type === 'preview-policy') {
    if (typeof message.autoClear !== 'boolean') return false;
    autoClear = message.autoClear; if (autoClear) { cache.clear(); clearTimeout(expiryTimer); } respond({ ok: true }); return false;
  }
  if (message.type === 'preview-authorize') {
    if (!FdPdf.fileUrl(viewer.searchParams.get('source')) || FdPdf.permissionScope(message.scope) !== message.scope) return false;
    const url = new URL(api.runtime.getURL('permission.html')); url.searchParams.set('scope', message.scope);
    api.windows.create({ url: url.href, type: 'popup', width: 480, height: 320 }).then(() => respond({ ok: true }), () => respond({ ok: false })); return true;
  }
  const source = viewer.searchParams.get('source'); if (!FdPdf.fileUrl(source)) return false;
  const key = JSON.stringify([source, viewer.searchParams.get('context') || '', viewer.searchParams.get('format') || 'pdf']);
  if (message.type === 'preview-cache-remove') { cache.remove(key); respond({ ok: true }); return false; }
  if (autoClear) { cache.remove(key); respond({ ok: true }); return false; }
  if (message.type === 'preview-cache-put') {
    if (typeof message.data !== 'string' || message.data.length > Math.ceil(cache.fileLimit / 3) * 4) return false;
    try { const ok = cache.put(key, CoursePreviewCache.decode(message.data)); scheduleExpiry(); respond({ ok }); } catch { respond({ ok: false }); }
    return false;
  }
  api.permissions.contains({ origins: [FdPdf.permissionScope(source)] }).then((granted) => {
    const bytes = granted && !autoClear ? cache.get(key) : null;
    respond({ ok: true, data: bytes ? CoursePreviewCache.encode(bytes) : null });
  }).catch(() => respond({ ok: false })); return true;
});

api.permissions.onRemoved?.addListener(() => { cache.clear(); clearTimeout(expiryTimer); });

api.runtime.onMessage.addListener((message, sender, respond) => {
  if (!FdPdf.allowedMessage(message, sender, api.runtime.id)) return false;
  const file = { ...message.file, name: FdPdf.filename(message.file.name), format: message.file.format || 'pdf' };
  api.tabs.create({ url: FdPdf.viewerUrl(file, (p) => api.runtime.getURL(p)), openerTabId: sender.tab.id }).then(
    () => respond({ ok: true }),
    () => respond({ ok: false }),
  );
  return true;
});

api.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') api.tabs.create({ url: api.runtime.getURL('help.html') });
});
