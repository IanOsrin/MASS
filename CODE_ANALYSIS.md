# DETAILED CODE ANALYSIS REPORT: /Users/ianosrin/projects/mass-music/server.js

**File:** server.js  
**Total Lines:** 3,049  
**Language:** Node.js (ESM) with Express 5, FileMaker Data API integration  
**Purpose:** Music streaming API server for MASS (Music Album Streaming System)

---

## 1. MAIN FUNCTIONAL SECTIONS & LINE RANGES

### Section 1: Setup & Configuration (Lines 1-69)
- Dependencies import and error handling
- Express app initialization
- Middleware setup (compression, logging, caching headers)

### Section 2: Environment & Constants (Lines 70-192)
- **Lines 70-143:** Environment variables and FileMaker configuration
- **Lines 144-192:** Application constants (cache, field mappings, playlists)

### Section 3: Utility Functions (Lines 193-416)
- **Lines 193-220:** Record normalization functions
- **Lines 221-295:** Track cloning and playlist sanitization
- **Lines 297-335:** Playlist image resolution
- **Lines 341-415:** Network resilience (safeFetch, sleep, retry logic)
- **Lines 417-430:** Client IP extraction

### Section 4: Field & Data Processing (Lines 430-866)
- **Lines 630-686:** Email normalization and field value picking
- **Lines 686-760:** Playlist name splitting, audio/artwork resolution
- **Lines 709-760:** Title normalization, album key generation, track sequencing
- **Lines 753-825:** Composer extraction, field prioritization
- **Lines 826-866:** Data merging and field candidates iteration

### Section 5: Authentication & Cookies (Lines 867-954)
- **Lines 867-875:** Cookie options setup
- **Lines 877-902:** Auth cookie management (set/clear)
- **Lines 904-928:** Cookie parsing, JWT token handling
- **Lines 930-954:** User authentication and token validation

### Section 6: Validation Functions (Lines 955-1087)
- **Lines 955-963:** Email validation
- **Lines 964-1066:** Password validation (min 8 chars, regex rules)
- **Lines 1067-1150:** Track payload normalization and deduplication logic

### Section 7: Stream Event Tracking (Lines 1168-1279)
- **Lines 1168-1199:** Stream record cache management (30-min TTL)
- **Lines 1251-1279:** Time normalization and timestamp formatting
- **Lines 1283-1443:** MAIN ENDPOINT: POST /api/stream-events

### Section 8: Authentication Endpoints (Lines 1454-1541)
- **Lines 1454-1488:** POST /api/auth/register
- **Lines 1490-1524:** POST /api/auth/login
- **Lines 1526-1529:** POST /api/auth/logout
- **Lines 1531-1541:** GET /api/auth/me

### Section 9: Playlist Management (Lines 1541-2041)
- **Lines 1541-1556:** GET /api/playlists (list user's playlists)
- **Lines 1556-1598:** POST /api/playlists (create new playlist)
- **Lines 1598-1648:** POST /api/playlists/:id/tracks (add single track)
- **Lines 1650-1727:** POST /api/playlists/:id/tracks/bulk (add multiple tracks)
- **Lines 1728-1810:** POST /api/playlists/:id/share (generate share link)
- **Lines 1811-1865:** GET /api/playlists/:id/export (export as JSON)
- **Lines 1866-2012:** POST /api/playlists/import (import from JSON)
- **Lines 2013-2037:** GET /api/shared-playlists/:shareId (view shared playlist)
- **Lines 2038-2084:** DELETE /api/playlists/:id/tracks/:addedAt
- **Lines 2085-2113:** DELETE /api/playlists/:id

### Section 10: File & Container Serving (Lines 2114-2211)
- **Lines 2114-2180:** GET /api/track/:recordId/container (audio streaming via proxy)
- **Lines 2182-2196:** GET /api/cache/stats (cache statistics)
- **Lines 2199-2212:** Static file serving and root route

### Section 11: Search Functionality (Lines 2214-2400)
- **Lines 2214-2293:** Search query building with field candidates
- **Lines 2294-2399:** GET /api/search (main search endpoint with deduplication)

### Section 12: Public Playlists (Lines 2401-2541)
- GET /api/public-playlists (list playlists from FileMaker with nested loops)

### Section 13: Audio Streaming Proxy (Lines 2542-2656)
- GET /api/container (proxy FileMaker container files with proper headers)

### Section 14: Browse by Decade (Lines 2659-2794)
- GET /api/explore (decade-based browsing with field probing)

### Section 15: Random Songs (Lines 2797-3011)
- GET /api/random-songs (shuffled tracks with artwork)

### Section 16: Album Details (Lines 3013-3098)
- GET /api/album (full tracklist for specific album)

### Section 17: Server Launch (Lines 3098-3104)
- app.listen() with startup message

---

## 2. GLOBAL VARIABLES & STATE MANAGEMENT

### Constants (Read-only, Well-Structured):
```javascript
FM_HOST, FM_DB, FM_USER, FM_PASS          // FileMaker config (Lines 71-74)
FM_LAYOUT, FM_USERS_LAYOUT, FM_STREAM_EVENTS_LAYOUT  // Layouts (Lines 75, 78-79)
AUTH_SECRET, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_SECURE (Lines 94, 98-100)
STREAM_EVENT_TYPES, STREAM_TERMINAL_EVENTS  // Stream event validation (Lines 86-87)
AUDIO_FIELD_CANDIDATES, ARTWORK_FIELD_CANDIDATES  // Field name variations (Lines 182-183)
PLAYLIST_IMAGE_EXTS, PUBLIC_PLAYLIST_FIELDS, TRACK_SEQUENCE_FIELDS  (Lines 145, 104-115, 113-142)
```

### Mutable State (Causes Issues):
```javascript
let fmToken = null;                              // Line 342 - Global FM token
let fmTokenExpiresAt = 0;                        // Line 343 - Token expiry tracking
let playlistsCache = { data: null, mtimeMs: 0 }; // Line 190 - File mtime cache
const streamRecordCache = new Map();              // Line 92 - 30-min TTL stream record IDs
const playlistImageCache = new Map();             // Line 188 - Playlist image paths
const loggedPublicPlaylistFieldErrors = new Set(); // Line 191 - Dedup error logs
```

### Issues with State Management:
1. **Global token state** (lines 342-343): Not thread-safe; concurrent requests could corrupt fmToken
2. **No cache invalidation strategy** for playlistsCache (line 190)
3. **Unbounded maps**: `streamRecordCache` has manual TTL cleanup (30 min) but no max size limits
4. **loggedPublicPlaylistFieldErrors** Set keeps growing indefinitely

---

## 3. EVENT HANDLERS & LISTENERS

### Express Route Handlers (17 endpoints):
1. **Authentication Routes:**
   - POST /api/auth/register (Line 1454)
   - POST /api/auth/login (Line 1490)
   - POST /api/auth/logout (Line 1526)
   - GET /api/auth/me (Line 1531)

2. **Playlist Routes:**
   - GET /api/playlists (Line 1541)
   - POST /api/playlists (Line 1556)
   - POST /api/playlists/:id/tracks (Line 1598)
   - POST /api/playlists/:id/tracks/bulk (Line 1650)
   - POST /api/playlists/:id/share (Line 1728)
   - GET /api/playlists/:id/export (Line 1811)
   - POST /api/playlists/import (Line 1866)
   - GET /api/shared-playlists/:shareId (Line 2013)
   - DELETE /api/playlists/:id/tracks/:addedAt (Line 2038)
   - DELETE /api/playlists/:id (Line 2085)

3. **Music Discovery:**
   - GET /api/search (Line 2294)
   - GET /api/public-playlists (Line 2401)
   - GET /api/explore (Line 2659)
   - GET /api/random-songs (Line 2797)
   - GET /api/album (Line 3013)

4. **Streaming:**
   - GET /api/track/:recordId/container (Line 2114)
   - POST /api/stream-events (Line 1283)

5. **Monitoring:**
   - GET /api/cache/stats (Line 2182)

### Middleware Handlers:
- Response time logging (Line 42)
- Compression middleware (Line 55)
- Express.json() (Line 56)
- Cache-Control headers (Line 59)

### No Event Emitters or Listeners (Server doesn't use EventEmitter pattern)

---

## 4. API CALLS & DATA FETCHING PATTERNS

### FileMaker API Client Functions:
```javascript
fmLogin()                          // Line ~470-500: Authenticate with FileMaker
fmPost()                           // Line ~515-540: POST to FileMaker Data API
fmGetAbsolute()                    // Line ~545-575: GET with proper auth headers
fmCreateRecord(layout, fieldData)  // Line ~580-610: POST to create records
fmUpdateRecord(layout, recordId, fieldData)  // Line ~615-645: POST to update records
fmGetRecordById(layout, recordId)  // Line ~650-670: GET single record
fmFindRecords(layout, queries, options)  // Line ~675-705: POST with find queries
```

### Network Resilience:
- **safeFetch()** (Line 350-415): Wrapper with:
  - 15-second default timeout
  - Exponential backoff retry (up to 2 retries)
  - AbortSignal composition for external cancellation
  - Handles ECONNRESET, ETIMEDOUT, socket errors
  - **Issue:** Blocks on timeout, no streaming support

### Data Fetching Patterns:
1. **Search pattern** (Line 2294-2399):
   - Try search with optional fields first
   - Fall back to base fields if code 102 error
   - Filter results by hasValidAudio()
   - Deduplicate by album key
   - Cache 3-min response

2. **Public playlists pattern** (Line 2401-2540):
   - Single FM query for all records
   - Double nested loops: records → playlist names → track building
   - **O(n*m*k) complexity** where n=records, m=playlist names, k=field iterations

3. **Explore pattern** (Line 2659-2794):
   - Field probing loop: tries 27 year fields 3 ways each (~81 potential queries!)
   - Random offset selection for variety
   - Caches by decade/limit

4. **Random songs pattern** (Line 2797-3011):
   - Offset randomization, filters by visibility/audio
   - Randomizes artist selection, then shuffles tracks per artist

---

## 5. DOM MANIPULATION PATTERNS

**NONE** - This is a server-side Node.js file. No DOM manipulation present.

---

## 6. PERFORMANCE BOTTLENECKS

### A. Nested Loops (O(n²) - O(n³) Complexity)

**1. PUBLIC PLAYLISTS endpoint (Lines 2432-2528) - CRITICAL:**
```javascript
for (const record of records)           // O(n) - maybe 5000+ records
  for (const rawName of playlistNames)  // O(m) - usually 1-3 per record
    // INSIDE INNER LOOP - for each record+name combo:
    pickFieldValueCaseInsensitive()     // O(k) field iteration
    firstNonEmpty() [6 calls]           // O(k) each
    composersFromFields()               // Iterates all fields
```
**Impact:** For 5000 records × 2 playlist names × 50 fields = 500,000 iterations  
**Recommendation:** Pre-compile field candidates, use indexing

**2. EXPLORE endpoint field probing (Lines 2720-2780) - CRITICAL:**
```javascript
for (const field of FIELDS)        // O(27) - 27 year field candidates
  for (3 different query formats)   // O(3) - range, explicit years, wildcard
    fmPost()                        // NETWORK CALL!
```
**Impact:** Up to 81 FM queries for single request  
**Recommendation:** Use smarter field detection strategy

### B. Inefficient Field Resolution

**3. pickFieldValueCaseInsensitive() (Line 664-683) - CALLED 3,000+ TIMES:**
```javascript
for (const candidate of candidates) {
  for (const [key, raw] of entries) {  // Re-iterates ALL fields for EACH candidate
    if (normalizeFieldKey(name) === normalizeFieldKey(key)) return { ... }
  }
}
```
**Complexity:** O(candidates × fields)  
**Better approach:** Create normalized field map once, lookup O(1)

**4. normalizeFieldKey() (Line 662-664) - Called in hot path:**
```javascript
const normalizeFieldKey = (name) => 
  (typeof name === 'string' ? name.replace(/[^a-z0-9]/gi, '').toLowerCase() : '')
```
**Issue:** Regex executed repeatedly; should be cached

### C. File I/O Blocking

**5. loadPlaylists() / savePlaylists() (Line ~1500+):**
- Called on EVERY playlist operation (add track, delete, import, export)
- Reads entire JSON file into memory
- No file streaming or partial updates
- No concurrent update protection (race conditions possible)

**6. resolvePlaylistImage() (Line 317-335):**
```javascript
for (const ext of PLAYLIST_IMAGE_EXTS) {
  const fullPath = path.join(PLAYLIST_IMAGE_DIR, slug + ext);
  try {
    await fs.access(fullPath);  // 6 async filesystem calls per playlist!
```
**Issue:** Up to 6 fs.access() calls per playlist image lookup  
**Impact:** With 100 playlists = 600 fs calls

### D. Unbounded Cache Growth

**7. streamRecordCache (Line 92) - Memory leak risk:**
```javascript
const streamRecordCache = new Map();
// Manual cleanup in setCachedStreamRecordId() after 30 min TTL
// BUT if TTL expires without new event, entry persists forever
```
**Impact:** Long-running server accumulates entries indefinitely  
**Fix needed:** Implement automatic Map cleanup or LRU cache

**8. loggedPublicPlaylistFieldErrors (Line 191) - Indefinite growth:**
```javascript
const loggedPublicPlaylistFieldErrors = new Set();
// Only records field names, never cleared
// After weeks, Set contains 1000s of entries
```

### E. Inefficient String Operations

**9. makeAlbumKey() (Line 718-725) - Called 5000+ times/request:**
```javascript
const makeAlbumKey = (catalogue, title, artist) =>
  normalizeTitle(catalogue) + '|' + normalizeTitle(title) + '|' + normalizeTitle(artist)

function normTitle(str) {
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/[\W_]/g, '');  // Regex per call
}
```
**Complexity:** 3 regex operations per album (3 fields)  
**Better:** Batch normalize fields once

### F. Stream Event Processing Bottleneck

**10. POST /api/stream-events (Line 1283-1443):**
```javascript
const asn = await lookupASN(clientIP);  // Network call for EVERY event
// Should batch or cache IP→ASN lookups
```
**Impact:** Each play event triggers external lookup  
**Better:** Cache IP→ASN with TTL

### G. Quadratic Algorithms

**11. buildPlaylistDuplicateIndex() (Line 1150-1161):**
```javascript
for (const entry of tracks) {
  const key = trackDuplicateKeyFromEntry(entry);
  duplicateIndex.set(key, entry);
}
```
**Then resolveDuplicate()** looks up in map - this is fine.  
**Issue:** Called on every track add, rebuilds entire index each time

**12. Explore decade randomization (Line 2771):**
```javascript
const maxStart = Math.max(1, foundTotal - windowSize + 1);
const randStart = Math.floor(1 + Math.random() * maxStart);
// Better to use crypto.getRandomValues() or crypto.randomInt()
```

---

## 7. CODE REPETITION & REFACTORING OPPORTUNITIES

### A. Repeated Error Handling Pattern (174 occurrences)

**Pattern appears everywhere:**
```javascript
// Lines 2335-2340 (Search)
if (!attempt.response.ok) {
  const msg = attempt.json?.messages?.[0]?.message || 'FM error';
  const code = attempt.json?.messages?.[0]?.code;
  return res.status(500).json({ 
    error: 'Album search failed', 
    status: attempt.response.status, 
    detail: `${msg} (${code})` 
  });
}

// Similar in Lines 2709-2712, 2790-2792, etc.
```

**Refactoring:** Create helper function
```javascript
function handleFMError(response, json, res, action) {
  const msg = json?.messages?.[0]?.message || 'FM error';
  const code = json?.messages?.[0]?.code;
  res.status(500).json({ 
    error: `${action} failed`, 
    status: response.status, 
    detail: `${msg} (${code})` 
  });
}
```

### B. Repeated Field Extraction Pattern

**Example 1 - Lines 2443-2450 (public-playlists):**
```javascript
const trackName = firstNonEmpty(fields, ['Track Name', 'Tape Files::Track Name', ...]);
const albumTitle = firstNonEmpty(fields, ['Album Title', 'Tape Files::Album_Title', ...]);
const albumArtist = firstNonEmpty(fields, ['Album Artist', 'Tape Files::Album Artist', ...]);
```

**Example 2 - Lines 2355-2359 (search):**
```javascript
const catalogue = firstNonEmpty(fields, ['Album Catalogue Number', ...]);
const albumTitle = firstNonEmpty(fields, ['Album Title', 'Tape Files::Album_Title', ...]);
const albumArtist = firstNonEmpty(fields, ['Album Artist', 'Tape Files::Album Artist', ...]);
```

**Appears 50+ times in different endpoints**

**Refactoring:** Create field extraction template
```javascript
function extractMetadata(fields) {
  const TRACK_FIELDS = {
    name: ['Track Name', 'Tape Files::Track Name', 'Song Name', 'Title'],
    album: ['Album Title', 'Tape Files::Album_Title'],
    artist: ['Album Artist', 'Tape Files::Album Artist'],
    // ...
  };
  return Object.entries(TRACK_FIELDS).reduce((acc, [key, candidates]) => ({
    ...acc,
    [key]: firstNonEmpty(fields, candidates)
  }), {});
}
```

### C. Repeated Response Building Pattern

**Pattern 1 - Lines 2385-2390 (search response):**
```javascript
const response = {
  items: finalData.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
  total,
  offset: uiOff0,
  limit
};
```

**Pattern 2 - Line 2784 (public-playlists):**
```javascript
const items = filteredData.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} }));
```

**Pattern 3 - Line 3089 (album):**
```javascript
return {
  items: items.map((item) => ({
    recordId: item.recordId,
    modId: item.modId,
    fields: item.fieldData || {}
  }))
};
```

**Refactoring:**
```javascript
const formatRecords = (records) => 
  records.map((d) => ({ 
    recordId: d.recordId, 
    modId: d.modId, 
    fields: d.fieldData || {} 
  }));
```

### D. Repeated Field Candidate Checking

**Lines 2676-2704 (explore - 28 year field variants!):**
```javascript
const FIELDS = [
  'Year of Release', 'Year Of Release', 'Year of release', 'Year Release',
  'Year', 'Original Release Year', ...
  'Tape Files::Year of Release', 'Tape Files::Year Release', ...
  'Albums::Year of Release', 'API_Albums::Year Release', ...
];
```

**Similar lists in multiple places:**
- Line 2357 (search - catalogue candidates)
- Line 2443-2450 (playlist - track field candidates)

**Refactoring:** Centralize in config
```javascript
const FIELD_CANDIDATES = {
  YEAR: ['Year of Release', 'Year Of Release', ...],  // 28 variants
  TRACK_NAME: ['Track Name', 'Tape Files::Track Name', ...],
  CATALOGUE: ['Album Catalogue Number', ...],
  // ...
};
```

### E. Repeated Cache Key Generation

**Pattern appears in 5 endpoints:**
```javascript
// Line 2305 (search)
const cacheKey = `search:${q}:${artist}:${album}:${track}:${limit}:${uiOff0}`;

// Line 2408 (public-playlists)
const cacheKey = `public-playlists:${nameParam}:${limit}`;

// Line 2668 (explore)
const cacheKey = `explore:${start}:${end}:${reqLimit}`;
```

**Refactoring:**
```javascript
function cacheKey(prefix, ...args) {
  return `${prefix}:${args.join(':')}`;
}
// Usage:
const key = cacheKey('search', q, artist, album, track, limit, uiOff0);
```

### F. Repeated Validation & Normalization

**Email/Password validation (lines 1458-1463, 1494-1503):**
Duplicated in register AND login endpoints
- Extract to validateCredentials() helper

**Track payload normalization (lines 1668, 1610):**
Called multiple times, could be standardized

**Record ID normalization:**
```javascript
const userRecordId = normalizeRecordId(user.recordId);  // Lines 1603, 1655, etc.
```
Repeated 20+ times

---

## 8. POTENTIAL SECURITY ISSUES

### A. XSS Vulnerabilities: LOW RISK

**Status:** ✅ **Protected** - Server doesn't return user input directly in HTML
- All playlist names are returned in JSON (not embedded in HTML)
- Track names are returned as JSON properties
- No server-side template injection
- **BUT:** Frontend (index.html) should validate/sanitize when displaying

### B. CSRF Protection: MEDIUM RISK

**Status:** ⚠️ **Partially Mitigated**
- **What's good:** SameSite=Lax cookies (Line 888, 900)
- **What's missing:**
  - No CSRF token validation on state-changing operations
  - POST requests relying solely on cookie + SameSite
  - If SameSite disabled or bypassed, vulnerable to CSRF

**Vulnerable endpoints:**
- POST /api/playlists (create)
- POST /api/playlists/:id/tracks (add track)
- POST /api/auth/register (register new account)
- POST /api/stream-events (track plays)

**Recommendation:** Add CSRF token validation for POST/DELETE endpoints

### C. SQL Injection / FileMaker Injection: MEDIUM RISK

**Status:** ⚠️ **Mostly Protected**
- FileMaker Data API uses parameterized queries (fields/values separate)
- BUT: Endpoint assumes FileMaker properly handles queries

**Potential issue - Line 2707:**
```javascript
const r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
// Query building at line 2313-2317:
const makePayload = (includeOptionalFields) => ({
  query: buildSearchQueries({ q, artist, album, track }, includeOptionalFields),
  // ...
});
```

**Check:** buildSearchQueries() (Line 2237-2293) properly escapes?
- Uses `==${value}` format (FileMaker wildcard syntax)
- But input fields (`q`, `artist`, etc.) not explicitly escaped
- Relies on FileMaker to handle special characters

**Risk:** Medium - depends on FileMaker's handling of malicious queries

### D. Authentication Bypass: LOW-MEDIUM RISK

**Status:** ✅ **JWT properly validated**
```javascript
async function authenticateRequest(req) {
  const token = readAuthToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, AUTH_SECRET);  // ✅ Signature verified
    return await getUserFromTokenPayload(payload);
  } catch { return null; }
}
```

**Issues:**
1. **Token expiration: 7 days** (Line 99, 927) - Long for sensitive app
   - Recommendation: Reduce to 1-24 hours, use refresh tokens

2. **Password hashing: bcrypt 12 rounds** (Line 1475) - ✅ Good
   - But password min length only 8 chars (Line 964)
   - No complexity requirements (uppercase, numbers, etc.)

3. **Session cookie fallback** (Line 1308-1312):
   ```javascript
   if (!sessionId) {
     sessionId = randomUUID();  // Generates new session for unauthenticated users
   }
   ```
   - OK for stream tracking, but unclear if intentional design

### E. File Path Traversal: MEDIUM RISK

**Status:** ⚠️ **Partially Mitigated**

**Line 317-335 (resolvePlaylistImage):**
```javascript
const slug = slugifyPlaylistName(name);  // ✅ Sanitizes name
const fullPath = path.join(PLAYLIST_IMAGE_DIR, slug + ext);
await fs.access(fullPath);  // OK - slugified name prevents ../../../etc
```

**BUT - Line 2562 (container proxy):**
```javascript
upstreamUrl = `${fmBase}/records/${encodeURIComponent(rid)}/containers/${encodeURIComponent(field)}/${encodeURIComponent(rep || '1')}`;
```
- **Issue:** Relies on FileMaker IDs being safe; if FM accepts malicious IDs, possible redirect to evil server
- **Mitigation:** Should validate recordId format (numeric)

### F. Sensitive Data Exposure: MEDIUM RISK

**Status:** ⚠️ **Mixed**

**What's protected:**
- ✅ Passwords hashed with bcrypt
- ✅ No email addresses stored in shared playlists (sanitized Line 281-295)
- ✅ HTTP-only cookies

**Exposure risks:**
1. **Client IPs logged in stream events** (Line 1350)
   - Stored in FileMaker with track play history
   - Could reveal user location/ISP

2. **User-Agent stored** (Line 1352)
   - Combined with IP + timestamp = fingerprinting risk

3. **Error messages leak FM details** (Line 2396):
   ```javascript
   const detail = err?.response?.data?.messages?.[0]?.message || ...
   res.status(500).json({ error, status: 500, detail });  // Returned to client
   ```
   - **Issue:** FM error messages might contain field names/structure
   - **Fix:** Return generic message in production, log details server-side

4. **Auth token in error message** (Line 1485-1486):
   ```javascript
   console.error('[MASS] Registration failed:', err);
   // If err contains auth token, logged to console/files
   ```

### G. Rate Limiting: HIGH RISK

**Status:** ❌ **Missing**
- No rate limiting on any endpoint
- `/api/stream-events` could be spammed
- `/api/auth/register` could be abused for account enumeration
- `/api/search` could be used for DOS (expensive FM queries)

**Recommendation:** Add rate limiting middleware (e.g., express-rate-limit)

### H. Data Validation: MEDIUM RISK

**Status:** ⚠️ **Inconsistent**

**Well-validated:**
- ✅ Email format (Line 955)
- ✅ Password length (Line 964)
- ✅ Track payload (Line 1067)

**Poorly validated:**
- ❌ Limit parameters just clamped (Line 2300):
  ```javascript
  const limit = Math.max(1, Math.min(300, parseInt(req.query.limit || '30', 10)));
  // parseInt('999999999') silently converts, no error
  ```
- ❌ Offset parameters: no validation on start/end decade (Line 2664):
  ```javascript
  if (!start || !end || end < start) return ...  // Only checks truthiness
  // Doesn't check valid year range
  ```

### I. Denial of Service (DOS) Vectors: HIGH RISK

**1. Large import exploit (Line 1868-2012):**
   ```javascript
   const rawTracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
   for (const trackPayload of rawTracks) {  // No size limit!
     // Each track causes lookups, validations
   }
   ```
   - **Attack:** POST 10,000 tracks at once → CPU spike, memory

**2. Explore decade field probing (Line 2720-2744):**
   - 81 FM queries per request!
   - **Attack:** Repeatedly hit /api/explore → 1000s of FM queries

**3. Stream event hammering (Line 1283):**
   ```javascript
   // No rate limit, accepts events every millisecond
   // Each event: lookupASN (network), fmUpdateRecord
   ```

### J. Insecure Crypto

**Status:** ⚠️ **Mixed**

**Good:**
- ✅ JWT signed with AUTH_SECRET (Line 927)
- ✅ bcrypt password hashing

**Weak:**
- ❌ AUTH_SECRET default value (Line 94-96):
  ```javascript
  const AUTH_SECRET = process.env.AUTH_SECRET || 'development-secret-change-me';
  if (!process.env.AUTH_SECRET) {
    console.warn('[MASS] AUTH_SECRET not set; falling back to insecure development secret');
  }
  ```
  - **Issue:** Warns but allows insecure fallback!
  - **Fix:** Throw error instead of warning

- ❌ randomUUID() used for sessions (Line 1311)
  - ✅ Actually fine - crypto.randomUUID() is cryptographically secure
  - BUT: Older Node versions used Math.random() fallback (Line 173-177)

---

## 9. OPPORTUNITIES TO SPLIT INTO MODULES

### Current Structure:
- **Single 3,049-line file**
- Monolithic: auth, search, playlists, streams, uploads all mixed
- Hard to test individual features
- Circular dependencies risk (helpers depend on app instance)

### Recommended Module Structure:

```
/server.js                 // Main app setup (200 lines)
/src/
  /config/
    constants.js           // All CONSTANTS (100 lines)
    fieldCandidates.js     // Field mapping configs (100 lines)
  /middleware/
    auth.js                // Auth middleware (50 lines)
    errors.js              // Error handling (80 lines)
    cache.js               // Caching logic (80 lines)
  /services/
    filemakerClient.js     // FM API wrapper (250 lines)
    - fmLogin()
    - fmPost(), fmGet(), fmFind()
    - safeFetch() with retry
    - makeHeaders(), ensureToken()
    
    userService.js         // User auth logic (150 lines)
    - findUserByEmail()
    - createUserRecord()
    - authenticateRequest()
    - tokenManagement()
    
    playlistService.js     // Playlist operations (300 lines)
    - loadPlaylists()
    - savePlaylists()
    - buildPlaylistDuplicateIndex()
    - cloneTrackForShare()
    - sanitizePlaylistForShare()
    
    searchService.js       // Search/explore (250 lines)
    - buildSearchQueries()
    - normalizeFieldKey() & caching
    - deduplication logic
    - field extraction helpers
    
    streamService.js       // Stream event tracking (200 lines)
    - ensureStreamRecord()
    - streamRecordCache management
    - lookupASN()
    - stream event validation
    
    dataTransform.js       // Data transformations (200 lines)
    - normalizeTrackPayload()
    - trackDuplicateKey()
    - buildTrackEntry()
    - formatRecords()
    - extractMetadata()
    
    containerService.js    // Audio container proxy (150 lines)
    - proxying logic
    - header mirroring
    - range request handling
  
  /routes/
    auth.js                // /api/auth/* (100 lines)
    playlists.js           // /api/playlists/* (300 lines)
    search.js              // /api/search, /api/explore, /api/album (250 lines)
    public.js              // /api/public-playlists, /api/random-songs (150 lines)
    container.js           // /api/container (100 lines)
    stream.js              // /api/stream-events (100 lines)
    stats.js               // /api/cache/stats (50 lines)
  
  /utils/
    validation.js          // Email, password, payload validation (100 lines)
    normalization.js       // normTitle(), slugify(), etc (80 lines)
    cookies.js             // Cookie management (80 lines)
    ipUtils.js             // getClientIP(), lookupASN() (50 lines)
    cache.js               // Cache helpers, LRU implementation (100 lines)
    
  /types/
    index.d.ts             // TypeScript definitions (150 lines)

/tests/
  /unit/
    userService.test.js
    playlistService.test.js
    searchService.test.js
  /integration/
    auth.test.js
    search.test.js
    playlists.test.js
```

### Benefits of Modularization:

1. **Testability:** Each service independently testable
2. **Maintainability:** Changes localized to specific modules
3. **Reusability:** Services usable across different backends
4. **Performance:** Tree-shaking unused code in production builds
5. **Scalability:** Easy to extract services to separate microservices later
6. **Documentation:** Each module has clear responsibility

### High Priority Extractions:

1. **filemakerClient.js** (Lines 337-705) - 368 lines
   - Currently scattered across file
   - Used by all endpoints
   - High reusability

2. **playlistService.js** (Lines 1541-2041) - 500 lines
   - All playlist CRUD operations
   - Clear API boundary

3. **searchService.js** (Lines 2214-3013) - 800 lines
   - Search, explore, album, public playlists
   - Complex deduplication logic
   - Worth extracting for testing

4. **streamService.js** (Lines 1283-1443) - 160 lines
   - Stream event tracking
   - Cache management

---

## SUMMARY TABLE

| Category | Issue Count | Severity | Impact |
|----------|-----------|----------|---------|
| **Nested Loops** | 3 | HIGH | O(n³) complexity, slow responses |
| **Field Resolution** | 15+ | MEDIUM | Wasted CPU, regex in hot path |
| **File I/O** | 2 | MEDIUM | Blocking, no race condition protection |
| **Cache Issues** | 3 | MEDIUM | Memory leaks, unbounded growth |
| **Code Duplication** | 50+ | LOW | Maintenance burden, bug propagation |
| **Security Issues** | 8 | MEDIUM-HIGH | CSRF, rate limiting, DOS vectors |
| **Error Handling** | 1 | MEDIUM | Leak FM details, inconsistent |
| **Modules** | 1 | MEDIUM | Single 3K file, hard to test |
| **Total** | **80+** | | **Moderate refactoring needed** |

---

## OPTIMIZATION PRIORITY LIST

### Phase 1 (Critical - 1-2 weeks):
1. Extract FileMaker client to module
2. Add rate limiting to all endpoints
3. Cache field key normalization
4. Fix unbounded cache growth (streamRecordCache)
5. Implement CSRF token validation

### Phase 2 (High - 2-4 weeks):
1. Optimize field extraction (use map lookup instead of loops)
2. Reduce explore field probing (smarter field detection)
3. Rewrite public playlists with O(n) complexity
4. Extract playlist service to module
5. Add integration tests for critical paths

### Phase 3 (Medium - 1 month):
1. Extract search service
2. Implement stream event service
3. Add TypeScript types
4. Create comprehensive test suite
5. Optimize image file checks (batch fs.access or use glob)

### Phase 4 (Nice-to-have):
1. Add caching layer (Redis) for expensive queries
2. Implement streaming for large exports
3. Add request/response logging middleware
4. Document API with OpenAPI/Swagger
5. Create monitoring dashboard for cache stats

---

