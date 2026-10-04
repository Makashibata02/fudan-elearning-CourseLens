/* Optional, bounded memory cache. Nothing is written to disk or kept alive. */
(function (root) {
  'use strict';
  class PreviewCache {
    constructor({ limit = 24 * 1024 * 1024, fileLimit = 8 * 1024 * 1024, ttl = 5 * 60 * 1000, count = 8, now = Date.now } = {}) {
      Object.assign(this, { limit, fileLimit, ttl, count, now }); this.entries = new Map(); this.size = 0;
    }
    remove(key) { const entry = this.entries.get(key); if (entry) { this.size -= entry.bytes.byteLength; this.entries.delete(key); } }
    prune() { for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.remove(key); }
    clear() { this.entries.clear(); this.size = 0; }
    get(key) {
      this.prune(); const entry = this.entries.get(key); if (!entry) return null;
      this.entries.delete(key); this.entries.set(key, entry); return entry.bytes.slice();
    }
    put(key, bytes) {
      this.prune(); this.remove(key);
      if (!bytes.byteLength || bytes.byteLength > Math.min(this.fileLimit, this.limit)) return false;
      while (this.entries.size && (this.size + bytes.byteLength > this.limit || this.entries.size >= this.count)) this.remove(this.entries.keys().next().value);
      this.entries.set(key, { bytes: bytes.slice(), expires: this.now() + this.ttl }); this.size += bytes.byteLength; return true;
    }
  }
  const encode = (bytes) => {
    const parts = []; for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    return btoa(parts.join(''));
  };
  const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  root.CoursePreviewCache = { PreviewCache, encode, decode };
})(globalThis);
