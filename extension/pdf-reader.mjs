import { fitScale, viewportSize, scrollToPage, visiblePage } from './layout.mjs';

export class PdfReader {
  constructor({ pdfjs, root, target, name, onChange = () => {}, onError = () => {} }) {
    Object.assign(this, { pdfjs, root, target, name, onChange, onError });
    this.page = 1; this.zoomMode = 'page'; this.readingMode = 'scroll'; this.scale = 1;
    this.entries = []; this.pending = new Set(); this.epoch = 0; this.destroyed = false;
    this.onScroll = () => {
      if (this.readingMode !== 'scroll') return;
      this.page = visiblePage(root, this.entries.map((entry) => entry.element));
      this.notify(); this.warm();
    };
    root.addEventListener('scroll', this.onScroll, { passive: true });
  }
  async open(pdf) {
    this.pdf = pdf;
    if (pdf.numPages > 5000) throw new Error('PDF 页数超过 5000，请下载后阅读。');
    const first = await pdf.getPage(1), natural = first.getViewport({ scale: 1 });
    if (this.destroyed) return;
    this.entries = Array.from({ length: pdf.numPages }, (_, index) => {
      const element = document.createElement('section'); element.className = 'pdf-page';
      element.setAttribute('aria-label', `第 ${index + 1} 页`);
      const label = document.createElement('div'); label.className = 'pdf-page-label'; label.textContent = `第 ${index + 1} 页 / ${pdf.numPages}`;
      const paper = document.createElement('div'); paper.className = 'paper';
      const canvas = document.createElement('canvas'), text = document.createElement('div'); text.className = 'textLayer';
      canvas.setAttribute('aria-label', `${this.name}，第 ${index + 1} 页`);
      paper.append(canvas, text); element.append(label, paper);
      return { element, paper, canvas, text, width: natural.width, height: natural.height, painted: false };
    });
    this.target.replaceChildren(...this.entries.map((entry) => entry.element)); this.target.hidden = false;
    this.layout(); await this.paint(1); if (this.destroyed) return; this.observe(); this.warm(); this.notify();
  }
  layout() {
    const size = viewportSize(this.root);
    this.entries.forEach((entry, index) => {
      entry.scale = fitScale(entry.width, entry.height, size.width, size.height, this.zoomMode, this.scale);
      entry.element.hidden = this.readingMode === 'page' && index !== this.page - 1;
      entry.paper.style.width = `${entry.width * entry.scale}px`;
      entry.paper.style.height = `${entry.height * entry.scale}px`;
      entry.paper.style.setProperty('--scale-factor', entry.scale);
      entry.paper.style.setProperty('--total-scale-factor', entry.scale);
    });
    this.target.style.minWidth = `${Math.max(...this.entries.filter((entry) => !entry.element.hidden).map((entry) => entry.width * entry.scale))}px`;
  }
  observe() {
    this.observer?.disconnect();
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((items) => {
        for (const item of items) if (item.isIntersecting) this.queue(this.entries.findIndex((entry) => entry.element === item.target) + 1);
      }, { root: this.root, rootMargin: '250px 0px' });
      for (const entry of this.entries) this.observer.observe(entry.element);
    }
  }
  notify() { this.onChange({ page: this.page, pages: this.pdf?.numPages || 0, scale: this.entries[this.page - 1]?.scale || this.scale }); }
  configure({ zoomMode = this.zoomMode, scale = this.scale, readingMode = this.readingMode } = {}) {
    if (this.destroyed || !this.pdf) return;
    Object.assign(this, { zoomMode, scale, readingMode }); this.epoch++; this.pending.clear();
    for (const entry of this.entries) { entry.task?.cancel(); entry.textTask?.cancel(); entry.painted = false; entry.text.replaceChildren(); entry.canvas.width = entry.canvas.height = 0; }
    this.layout(); this.goTo(this.page); this.observe();
  }
  goTo(number) {
    this.page = Math.max(1, Math.min(this.pdf.numPages, Math.trunc(Number(number) || 1)));
    this.layout();
    if (this.readingMode === 'page') this.root.scrollTop = 0;
    else scrollToPage(this.root, this.entries[this.page - 1].element);
    this.notify(); this.warm();
  }
  warm() {
    for (let page = Math.max(1, this.page - 1); page <= Math.min(this.entries.length, this.page + 1); page++) this.queue(page);
    // Keep at most nearby canvases; long assignments do not retain every bitmap.
    this.entries.forEach((entry, index) => {
      if (Math.abs(index + 1 - this.page) > 3 && entry.painted && !entry.task) {
        entry.canvas.width = entry.canvas.height = 0; entry.text.replaceChildren(); entry.painted = false;
      }
    });
  }
  queue(number) {
    if (this.destroyed || number < 1 || number > this.entries.length || (this.readingMode === 'page' && number !== this.page) || this.entries[number - 1].painted) return;
    this.pending.add(number); this.drain();
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.size && !this.destroyed) {
        const number = [...this.pending].sort((a, b) => Math.abs(a - this.page) - Math.abs(b - this.page))[0]; this.pending.delete(number);
        if (this.readingMode === 'page' && number !== this.page) continue;
        try { await this.paint(number); } catch (error) { this.onError(error); }
      }
    } finally { this.draining = false; }
  }
  async paint(number) {
    const entry = this.entries[number - 1], token = this.epoch;
    if (entry.painted || this.destroyed) return;
    const oldTask = entry.task; oldTask?.cancel(); entry.textTask?.cancel();
    try { await oldTask?.promise; } catch { /* cancellation */ }
    const page = await this.pdf.getPage(number);
    if (token !== this.epoch || this.destroyed) return;
    const natural = page.getViewport({ scale: 1 }); entry.width = natural.width; entry.height = natural.height; this.layout();
    const viewport = page.getViewport({ scale: entry.scale });
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
    entry.canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); entry.canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
    entry.canvas.style.width = `${viewport.width}px`; entry.canvas.style.height = `${viewport.height}px`;
    const task = entry.task = page.render({ canvasContext: entry.canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    try {
      await task.promise;
      if (token !== this.epoch || this.destroyed) return;
      entry.painted = true; entry.text.replaceChildren();
      const text = await page.getTextContent();
      if (token !== this.epoch || this.destroyed) return;
      entry.textTask = new this.pdfjs.TextLayer({ textContentSource: text, container: entry.text, viewport });
      await entry.textTask.render();
      if (number === this.page) this.notify();
    } catch (error) {
      if (!['RenderingCancelledException', 'AbortException'].includes(error.name) && token === this.epoch && !this.destroyed) throw error;
    } finally { if (entry.task === task) entry.task = null; }
  }
  destroy() {
    this.destroyed = true; this.epoch++; this.pending.clear(); this.observer?.disconnect(); this.root.removeEventListener('scroll', this.onScroll);
    for (const entry of this.entries) { entry.task?.cancel(); entry.textTask?.cancel(); entry.canvas.width = entry.canvas.height = 0; }
    this.entries = []; this.pdf = null;
    this.target.replaceChildren(); this.target.hidden = true; this.target.style.minWidth = '';
  }
}
