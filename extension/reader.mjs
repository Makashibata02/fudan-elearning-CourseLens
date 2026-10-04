export class HostPermissionError extends Error {
  constructor(scope) {
    super(`需要允许读取文件服务器：${new URL(scope).hostname}`);
    this.scope = scope;
  }
}

export async function readFile(source, { api, fetchImpl = fetch, format = 'pdf', limit = 100 * 1024 * 1024, timeout = 60000, signal } = {}) {
  if (!globalThis.FdPdf.fileUrl(source)) throw new Error('仅支持复旦 eLearning 的文件链接。');
  const baseScope = globalThis.FdPdf.permissionScope(source);
  if (!(await api.permissions.contains({ origins: [baseScope] }))) throw new HostPermissionError(baseScope);
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  const seen = new Set([source]);
  let redirect = null;
  let requestId = null;
  const observe = (details) => {
    if (!seen.has(details.url) || (requestId && requestId !== details.requestId)) return;
    requestId = details.requestId;
    redirect = details.redirectUrl;
    seen.add(redirect);
  };
  api.webRequest.onBeforeRedirect.addListener(observe, { urls: ['https://*/*'] });
  try {
    const response = await fetchImpl(source, {
      credentials: 'include', redirect: 'follow', cache: 'no-store', signal: controller.signal,
      // Canvas submission downloads negotiate the controller format before sending
      // the attachment. A PDF-only Accept can yield HTTP 406 on the HTML route.
      // Validate actual file bytes below instead of restricting response MIME here.
      headers: { Accept: '*/*' },
    });
    if (!response.ok) {
      throw new Error([401, 403].includes(response.status)
        ? '登录已失效或没有文件权限。请先打开 eLearning 登录，然后重试。'
        : `文件读取失败（HTTP ${response.status}）。`);
    }
    if (Number(response.headers.get('content-length')) > limit) throw new Error('文件超过 100 MiB，请使用“打开原文件”。');
    if (!response.body) throw new Error('文件服务返回了空内容。');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('文件超过 100 MiB，请使用“打开原文件”。');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    chunks.length = 0;
    signal?.throwIfAborted();
    if (format === 'pdf' && new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) {
      throw new Error('返回内容不是 PDF，可能是登录页面。请登录 eLearning 后重试。');
    }
    if (!size) throw new Error('文件服务返回了空内容。');
    const type = response.headers.get('content-type') || '';
    if (/text\/html/i.test(type) || /^\s*(?:<!doctype html|<html[\s>])/i.test(new TextDecoder().decode(bytes.subarray(0, 512)))) {
      throw new Error('返回了登录页面而不是附件，请先登录 eLearning 后重试。');
    }
    return bytes;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已停止读取附件。', 'AbortError');
    if (controller.signal.aborted) throw new Error('读取超时，请检查网络后重试。');
    if (error instanceof TypeError && redirect) {
      const scope = globalThis.FdPdf.permissionScope(redirect);
      if (scope && !(await api.permissions.contains({ origins: [scope] }))) throw new HostPermissionError(scope);
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    clearTimeout(timer);
    api.webRequest.onBeforeRedirect.removeListener(observe);
    controller.abort();
  }
}
export const readPdf = (source, options = {}) => readFile(source, { ...options, format: 'pdf' });
