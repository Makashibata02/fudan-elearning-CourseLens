export function decodeHeic(bytes, { workerURL, WorkerImpl = Worker, timeout = 45000 } = {}) {
  if (bytes.byteLength > 100 * 1024 * 1024) return Promise.reject(new Error('HEIC 文件超过 100 MiB。'));
  return new Promise((resolve, reject) => {
    const worker = new WorkerImpl(workerURL);
    let done = false;
    const finish = (error, data) => {
      if (done) return;
      done = true; clearTimeout(timer); worker.terminate();
      if (error) reject(error); else resolve(data);
    };
    const timer = setTimeout(() => finish(new Error('HEIC 解码超时，请下载原件阅读。')), timeout);
    worker.onerror = () => finish(new Error('HEIC 解码器未能运行，请重新加载插件后重试。'));
    worker.onmessage = ({ data }) => {
      if (data.id !== 'preview') return;
      if (data.error) finish(new Error(`HEIC 无法解码：${data.error}`));
      else if (!data.imageData?.width || !data.imageData?.height) finish(new Error('HEIC 没有可读的照片。'));
      else finish(null, data.imageData);
    };
    const buffer = bytes.slice().buffer;
    try { worker.postMessage({ id: 'preview', buffer }, [buffer]); }
    catch (error) { finish(error); }
  });
}
