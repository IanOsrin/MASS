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

// Global cache instances - Optimized for faster performance
export const searchCache = new LRUCache(300, 10 * 60 * 1000); // 300 items, 10 min TTL
export const exploreCache = new LRUCache(150, 15 * 60 * 1000); // 150 items, 15 min TTL
export const albumCache = new LRUCache(500, 20 * 60 * 1000); // 500 items, 20 min TTL
export const publicPlaylistsCache = new LRUCache(100, 15 * 60 * 1000); // 100 items, 15 min TTL
