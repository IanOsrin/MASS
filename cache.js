// Simple in-memory LRU cache
export class LRUCache {
  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    this.hits++;
    return item.value;
  }

  set(key, value) {
    // Remove if exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total * 100).toFixed(2) : '0.00';
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
      total
    };
  }

  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }
}

// Global cache instances
export const searchCache = new LRUCache(200, 3 * 60 * 1000); // 200 items, 3 min TTL
export const exploreCache = new LRUCache(100, 5 * 60 * 1000); // 100 items, 5 min TTL
export const albumCache = new LRUCache(500, 10 * 60 * 1000); // 500 items, 10 min TTL
export const publicPlaylistsCache = new LRUCache(50, 5 * 60 * 1000); // 50 items, 5 min TTL
