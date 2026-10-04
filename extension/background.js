/* Chrome and Edge use the same Chromium service worker. */
if (typeof importScripts === 'function') importScripts('catalog.js', 'core.js');
const api = globalThis.browser || chrome;

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
