# Quick Performance Test Guide

## See Performance in Action

1. **Restart the server:**
   ```bash
   npm start
   ```

2. **Open browser console** (F12 or Cmd+Option+I)

3. **Load the page** and watch the console logs:
   ```
   [PERF] loadRandomAlbums: 850ms total (fetch: 750ms, parse: 5ms, group: 90ms, shuffle: 5ms)
   [PERF] UI update: 45ms (refresh: 2ms, render: 43ms)
   ```

4. **Click "Load More Albums"** immediately and compare:
   ```
   [CACHE HIT] explore: 1970-1979
   [PERF] loadRandomAlbums: 25ms total (fetch: 15ms, parse: 2ms, group: 5ms, shuffle: 3ms)
   [PERF] UI update: 20ms (refresh: 1ms, render: 19ms)
   ```

## What to Look For

### Backend Caching (Server Console)
- `[CACHE HIT] search: ...` - Search was cached (95%+ faster!)
- `[CACHE HIT] explore: ...` - Explore was cached (98%+ faster!)

### Frontend Performance (Browser Console)
- **Fetch time** - Time to get data from server
  - First time: 600-1000ms
  - Cached: 5-30ms ⚡
- **Group time** - Processing tracks into albums
  - Should be < 100ms
- **Render time** - Drawing cards on screen
  - Should be < 50ms

## Performance Breakdown

**Total page load time = Fetch + Parse + Group + Shuffle + Refresh + Render**

### Typical Times

**First Load (Uncached):**
```
Fetch:   750ms  (FileMaker query - can't optimize much)
Parse:     5ms  (JSON parsing)
Group:    90ms  (Grouping tracks into albums)
Shuffle:   5ms  (Randomizing order)
Refresh:   2ms  (UI updates)
Render:   43ms  (Drawing cards)
----------------------------
TOTAL:   895ms
```

**Second Load (Cached):**
```
Fetch:    15ms  ⚡ 98% faster!
Parse:     2ms
Group:     5ms
Shuffle:   3ms
Refresh:   1ms
Render:   19ms
----------------------------
TOTAL:    45ms  ⚡ 95% faster overall!
```

## When Cache Helps Most

✅ **Great improvements:**
- Clicking same decade twice in Explore
- Searching for same artist/album
- Using "Load More" button repeatedly
- Multiple users searching popular artists

❌ **No improvement:**
- Different searches (new cache entry)
- Different decades (new cache entry)
- First-time visitors
- Cache expired (3-5 min TTL)

## Clustering Benefits

You won't see single-request speed improvement, but:
- **More concurrent users** (3-5x capacity)
- **Better reliability** (worker crashes don't kill server)
- **Better CPU usage** (all cores utilized)

Test with: `ab -n 100 -c 10 http://localhost:3000/api/health`

## If It Still Feels Slow

The bottleneck is likely:
1. **FileMaker response time** (750ms+) - Can't optimize much
2. **Network latency** - Deploy closer to FileMaker server
3. **FileMaker server load** - Upgrade FileMaker hosting

The caching helps with *repeated* queries, not first-time queries!
