// High-performance LRU cache using npm package
import { LRUCache } from 'lru-cache';

// Global cache instances - Optimized for faster performance with bounded memory
export const searchCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
  updateAgeOnGet: true,
  updateAgeOnHas: true
});

export const exploreCache = new LRUCache({
  max: 200,
  ttl: 1000 * 60 * 10, // 10 minutes
  updateAgeOnGet: true,
  updateAgeOnHas: true
});

export const albumCache = new LRUCache({
  max: 300,
  ttl: 1000 * 60 * 15, // 15 minutes
  updateAgeOnGet: true,
  updateAgeOnHas: true
});

export const publicPlaylistsCache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 5, // 5 minutes
  updateAgeOnGet: true,
  updateAgeOnHas: true
});

export const trendingCache = new LRUCache({
  max: 50,
  ttl: 1000 * 60 * 5, // refresh trending every 5 minutes
  updateAgeOnGet: true,
  updateAgeOnHas: true
});
