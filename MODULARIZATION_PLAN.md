# MASS Music - Modularization Plan

**Goal**: Split 3,100-line monolithic server.js into focused, testable modules
**Timeline**: 2-3 weeks (can be done incrementally)
**Risk Level**: Medium (requires careful testing)

---

## Table of Contents

1. [Target Architecture](#target-architecture)
2. [Module Extraction Order](#module-extraction-order)
3. [Step-by-Step Examples](#step-by-step-examples)
4. [Testing Strategy](#testing-strategy)

---

## Target Architecture

### Current State
```
mass-music/
├── server.js          (3,100 lines - EVERYTHING)
├── cache.js           (60 lines)
├── cluster.js         (40 lines)
├── worker.js          (10 lines)
└── public/
    └── app.js         (3,049 lines - EVERYTHING)
```

### Target State
```
mass-music/
├── src/
│   ├── core/
│   │   ├── filemaker.js       (280 lines) - FileMaker API client
│   │   ├── config.js          (100 lines) - Configuration & constants
│   │   └── cache.js           (moved from root, enhanced)
│   ├── services/
│   │   ├── auth.service.js    (300 lines) - Auth business logic
│   │   ├── playlist.service.js (400 lines) - Playlist operations
│   │   ├── discovery.service.js (500 lines) - Search/explore logic
│   │   └── streaming.service.js (300 lines) - Stream events & audio
│   ├── routes/
│   │   ├── auth.routes.js     (150 lines) - Auth endpoints
│   │   ├── playlist.routes.js (200 lines) - Playlist endpoints
│   │   ├── discovery.routes.js (150 lines) - Discovery endpoints
│   │   └── streaming.routes.js (100 lines) - Streaming endpoints
│   ├── middleware/
│   │   ├── auth.middleware.js (100 lines) - JWT verification
│   │   ├── validation.middleware.js (150 lines) - Input validation
│   │   ├── ratelimit.middleware.js (80 lines) - Rate limiting
│   │   └── error.middleware.js (100 lines) - Error handling
│   └── utils/
│       ├── normalize.js       (200 lines) - Data normalization
│       ├── validation.js      (150 lines) - Validators
│       └── helpers.js         (150 lines) - Misc utilities
├── server.js              (200 lines) - App composition
├── cluster.js             (existing)
├── worker.js              (existing)
└── public/
    ├── js/
    │   ├── api.js             (400 lines) - API client
    │   ├── state.js           (300 lines) - State management
    │   ├── ui/
    │   │   ├── player.js      (400 lines) - Audio player
    │   │   ├── search.js      (300 lines) - Search UI
    │   │   ├── playlists.js   (400 lines) - Playlist UI
    │   │   └── explore.js     (300 lines) - Explore UI
    │   ├── utils.js           (200 lines) - DOM helpers
    │   └── app.js             (200 lines) - Main initialization
    └── index.html             (existing)
```

---

## Module Extraction Order

### Phase 1: Foundation (Week 1)
1. ✅ Extract `src/core/config.js` - Constants & configuration
2. ✅ Extract `src/core/filemaker.js` - FileMaker API client
3. ✅ Extract `src/utils/normalize.js` - Normalization functions
4. ✅ Extract `src/utils/validation.js` - Validators
5. ✅ Extract `src/utils/helpers.js` - Misc utilities

**Why first**: Zero dependencies, purely functional, easy to test

### Phase 2: Middleware (Week 2)
6. ✅ Extract `src/middleware/auth.middleware.js` - JWT verification
7. ✅ Extract `src/middleware/validation.middleware.js` - Input validation
8. ✅ Extract `src/middleware/ratelimit.middleware.js` - Rate limiting
9. ✅ Extract `src/middleware/error.middleware.js` - Error handling

**Why second**: Used by all routes, minimal business logic

### Phase 3: Services (Week 2-3)
10. ✅ Extract `src/services/auth.service.js` - Auth logic
11. ✅ Extract `src/services/playlist.service.js` - Playlist operations
12. ✅ Extract `src/services/discovery.service.js` - Search/explore
13. ✅ Extract `src/services/streaming.service.js` - Stream events

**Why third**: Core business logic, depends on core & utils

### Phase 4: Routes (Week 3)
14. ✅ Extract `src/routes/auth.routes.js` - Auth endpoints
15. ✅ Extract `src/routes/playlist.routes.js` - Playlist endpoints
16. ✅ Extract `src/routes/discovery.routes.js` - Discovery endpoints
17. ✅ Extract `src/routes/streaming.routes.js` - Streaming endpoints

**Why fourth**: Thin layer over services, easy to extract once services exist

### Phase 5: Composition (Week 3)
18. ✅ Update `server.js` - Compose all modules
19. ✅ Add tests for all modules
20. ✅ Update documentation

---

## Step-by-Step Examples

### Example 1: Extract `src/core/filemaker.js`

**Current Code** (server.js lines 337-628):
```javascript
// FileMaker connection
const FM_HOST = process.env.FM_HOST;
const FM_DB = process.env.FM_DB;
// ...

let fmToken = null;
let fmTokenExpiresAt = 0;

async function fmLogin() { /* ... */ }
async function ensureToken() { /* ... */ }
async function fmPost(pathSuffix, body) { /* ... */ }
async function fmCreateRecord(layout, fieldData) { /* ... */ }
// ... etc
```

**New File**: `src/core/filemaker.js`
```javascript
import { request } from 'undici';

export class FileMakerClient {
  constructor({ host, database, username, password }) {
    this.host = host;
    this.database = database;
    this.username = username;
    this.password = password;

    this.token = null;
    this.tokenExpiresAt = 0;
    this.baseUrl = `${host}/fmi/data/vLatest/databases/${encodeURIComponent(database)}`;
  }

  /**
   * Authenticate with FileMaker Data API
   * @returns {Promise<string>} Authentication token
   */
  async login() {
    const url = `${this.baseUrl}/sessions`;
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    const res = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json?.response?.token) {
      throw new Error(`FileMaker login failed: ${json?.messages?.[0]?.message || 'Unknown error'}`);
    }

    this.token = json.response.token;
    this.tokenExpiresAt = Date.now() + 12 * 60 * 1000; // 12 minutes

    console.log('[FM] Authenticated successfully');
    return this.token;
  }

  /**
   * Ensure we have a valid token
   * @returns {Promise<string>} Valid token
   */
  async ensureToken() {
    const now = Date.now();
    if (this.token && this.tokenExpiresAt > now + 60000) {
      return this.token; // Token valid for at least 1 more minute
    }

    console.log('[FM] Token expired or missing, re-authenticating...');
    return await this.login();
  }

  /**
   * Safe fetch with timeout and retry logic
   */
  async safeFetch(url, options = {}, retries = 3, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await request(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);

      // Retry on network errors
      if (retries > 0 && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        console.warn(`[FM] Request failed (${err.code}), retrying... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, 500 * (4 - retries)));
        return this.safeFetch(url, options, retries - 1, timeoutMs);
      }

      throw err;
    }
  }

  /**
   * Create a new record
   */
  async createRecord(layout, fieldData) {
    await this.ensureToken();

    const url = `${this.baseUrl}/layouts/${encodeURIComponent(layout)}/records`;
    const body = JSON.stringify({ fieldData });

    let res = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body
    });

    // Retry on 401
    if (res.statusCode === 401) {
      await this.login();
      res = await this.safeFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body
      });
    }

    const json = await res.body.json().catch(() => ({}));

    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      data: json?.response?.recordId,
      msg: json?.messages?.[0]?.message,
      code: json?.messages?.[0]?.code
    };
  }

  /**
   * Update an existing record
   */
  async updateRecord(layout, recordId, fieldData) {
    await this.ensureToken();

    const url = `${this.baseUrl}/layouts/${encodeURIComponent(layout)}/records/${encodeURIComponent(recordId)}`;
    const body = JSON.stringify({ fieldData });

    let res = await this.safeFetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body
    });

    // Retry on 401
    if (res.statusCode === 401) {
      await this.login();
      res = await this.safeFetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body
      });
    }

    const json = await res.body.json().catch(() => ({}));

    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      msg: json?.messages?.[0]?.message,
      code: json?.messages?.[0]?.code
    };
  }

  /**
   * Find records matching query
   */
  async findRecords(layout, queries, options = {}) {
    await this.ensureToken();

    const url = `${this.baseUrl}/layouts/${encodeURIComponent(layout)}/_find`;
    const body = JSON.stringify({
      query: queries,
      limit: options.limit?.toString() || '100',
      offset: options.offset?.toString() || '1',
      ...(options.sort && { sort: options.sort })
    });

    let res = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body
    });

    // Retry on 401
    if (res.statusCode === 401) {
      await this.login();
      res = await this.safeFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body
      });
    }

    const json = await res.body.json().catch(() => ({}));

    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      data: json?.response?.data || [],
      total: json?.response?.dataInfo?.foundCount || 0,
      msg: json?.messages?.[0]?.message,
      code: json?.messages?.[0]?.code
    };
  }

  /**
   * Get a single record by ID
   */
  async getRecordById(layout, recordId) {
    await this.ensureToken();

    const url = `${this.baseUrl}/layouts/${encodeURIComponent(layout)}/records/${encodeURIComponent(recordId)}`;

    let res = await this.safeFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });

    // Retry on 401
    if (res.statusCode === 401) {
      await this.login();
      res = await this.safeFetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
    }

    const json = await res.body.json().catch(() => ({}));

    if (res.statusCode === 404) {
      return { ok: false, data: null, code: '404' };
    }

    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      data: json?.response?.data?.[0] || null,
      msg: json?.messages?.[0]?.message,
      code: json?.messages?.[0]?.code
    };
  }
}

// Singleton instance (optional - can also inject via DI)
let fmClient = null;

export function initializeFileMaker(config) {
  fmClient = new FileMakerClient(config);
  return fmClient;
}

export function getFileMakerClient() {
  if (!fmClient) {
    throw new Error('FileMaker client not initialized. Call initializeFileMaker() first.');
  }
  return fmClient;
}
```

**Updated server.js**:
```javascript
import { initializeFileMaker, getFileMakerClient } from './src/core/filemaker.js';

// Initialize FileMaker client
const fmClient = initializeFileMaker({
  host: process.env.FM_HOST,
  database: process.env.FM_DB,
  username: process.env.FM_USER,
  password: process.env.FM_PASS
});

// Prime the token on startup
await fmClient.login().catch(err => {
  console.warn('[MASS] Failed to prime FileMaker token:', err.message);
});

// Use in routes
app.get('/api/search', async (req, res) => {
  const fm = getFileMakerClient();
  const results = await fm.findRecords('API_Album_Songs', queries, { limit: 100 });
  // ...
});
```

**Benefits**:
- ✅ Testable (can mock FileMaker responses)
- ✅ Reusable (can create multiple clients)
- ✅ Type-safe (can add TypeScript later)
- ✅ Documented (JSDoc comments)

---

### Example 2: Extract `src/utils/normalize.js`

**Current Code** (server.js lines 193-220):
```javascript
function normalizeRecordId(value) { /* ... */ }
function normalizeEmail(email) { /* ... */ }
function normalizeShareId(value) { /* ... */ }
function generateShareId() { /* ... */ }
function slugifyPlaylistName(name) { /* ... */ }
// ...
```

**New File**: `src/utils/normalize.js`
```javascript
/**
 * Normalize a FileMaker record ID
 * @param {any} value - Record ID (string or number)
 * @returns {string} Trimmed string representation
 */
export function normalizeRecordId(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Normalize an email address (lowercase + trim)
 * @param {string} email - Email address
 * @returns {string} Normalized email
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.toLowerCase().trim();
}

/**
 * Normalize a share ID (trim)
 * @param {string} value - Share ID
 * @returns {string} Trimmed share ID
 */
export function normalizeShareId(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Generate a random share ID (UUID or hex)
 * @param {boolean} useUUID - Use UUID format (default: false)
 * @returns {string} Random share ID
 */
export function generateShareId(useUUID = false) {
  if (useUUID) {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Convert playlist name to URL-safe slug
 * @param {string} name - Playlist name
 * @returns {string} Slugified name
 */
export function slugifyPlaylistName(name) {
  if (!name || typeof name !== 'string') return 'playlist';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalize field key for case-insensitive comparison
 * @param {string} key - Field name
 * @returns {string} Normalized key (lowercase alphanumeric)
 */
export function normalizeFieldKey(key) {
  if (!key || typeof key !== 'string') return '';
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalize title (trim, collapse whitespace, remove quotes)
 * @param {string} title - Title string
 * @returns {string} Normalized title
 */
export function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/["']/g, '');
}
```

**Updated server.js**:
```javascript
import {
  normalizeRecordId,
  normalizeEmail,
  normalizeShareId,
  generateShareId,
  slugifyPlaylistName,
  normalizeFieldKey,
  normalizeTitle
} from './src/utils/normalize.js';

// Use throughout codebase
const recordId = normalizeRecordId(record.recordId);
const email = normalizeEmail(req.body.email);
// ...
```

**Unit Tests**: `src/utils/normalize.test.js`
```javascript
import { describe, it, expect } from '@jest/globals';
import { normalizeEmail, slugifyPlaylistName } from './normalize.js';

describe('normalizeEmail', () => {
  it('should lowercase email', () => {
    expect(normalizeEmail('Test@Example.COM')).toBe('test@example.com');
  });

  it('should trim whitespace', () => {
    expect(normalizeEmail('  test@example.com  ')).toBe('test@example.com');
  });

  it('should return empty string for invalid input', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(123)).toBe('');
  });
});

describe('slugifyPlaylistName', () => {
  it('should convert to lowercase', () => {
    expect(slugifyPlaylistName('My Playlist')).toBe('my-playlist');
  });

  it('should replace spaces with hyphens', () => {
    expect(slugifyPlaylistName('Rock Music 2024')).toBe('rock-music-2024');
  });

  it('should remove special characters', () => {
    expect(slugifyPlaylistName('Rock & Roll!')).toBe('rock-roll');
  });

  it('should handle empty input', () => {
    expect(slugifyPlaylistName('')).toBe('playlist');
    expect(slugifyPlaylistName(null)).toBe('playlist');
  });
});
```

---

### Example 3: Extract `src/middleware/auth.middleware.js`

**Current Code** (server.js lines 941-953):
```javascript
async function authenticateRequest(req) {
  const token = readAuthToken(req);
  try {
    const payload = jwt.verify(token, AUTH_SECRET);
    return await getUserFromTokenPayload(payload);
  } catch (err) {
    return null;
  }
}

async function requireUser(req, res) {
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return null;
  }
  return user;
}
```

**New File**: `src/middleware/auth.middleware.js`
```javascript
import jwt from 'jsonwebtoken';
import { getFileMakerClient } from '../core/filemaker.js';

/**
 * Read JWT token from request (cookie or Authorization header)
 */
function readAuthToken(req) {
  // Try cookie first
  const cookies = parseCookies(req);
  if (cookies.mass_session) {
    return cookies.mass_session;
  }

  // Try Authorization header
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Parse cookies from request
 */
function parseCookies(req) {
  const header = req.get('cookie') || '';
  const cookies = {};

  for (const pair of header.split(';')) {
    const [key, ...rest] = pair.split('=');
    if (key && rest.length > 0) {
      cookies[key.trim()] = rest.join('=').trim();
    }
  }

  return cookies;
}

/**
 * Authenticate request and return user or null
 * @param {Request} req - Express request
 * @returns {Promise<{recordId: string, email: string} | null>}
 */
export async function authenticateRequest(req) {
  const token = readAuthToken(req);

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, process.env.AUTH_SECRET);

    // Fetch user from FileMaker to verify still exists
    const fm = getFileMakerClient();
    const result = await fm.getRecordById(
      process.env.FM_USERS_LAYOUT || 'API_Users',
      payload.sub
    );

    if (!result.ok || !result.data) {
      return null;
    }

    const fields = result.data.fieldData || {};
    return {
      recordId: payload.sub,
      email: fields.email || fields.Email || payload.email
    };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      // Silent - expired tokens are expected
      return null;
    }
    console.warn('[AUTH] Token verification failed:', err.message);
    return null;
  }
}

/**
 * Middleware to require authentication
 * @param {Request} req
 * @param {Response} res
 * @param {Function} next
 */
export async function requireAuth(req, res, next) {
  const user = await authenticateRequest(req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: 'Authentication required'
    });
  }

  // Attach user to request
  req.user = user;
  next();
}

/**
 * Optional authentication (doesn't fail if not authenticated)
 */
export async function optionalAuth(req, res, next) {
  req.user = await authenticateRequest(req);
  next();
}
```

**Updated Routes**:
```javascript
import { requireAuth, optionalAuth } from './src/middleware/auth.middleware.js';

// Protected route
app.get('/api/playlists', requireAuth, async (req, res) => {
  // req.user is guaranteed to exist
  const { recordId, email } = req.user;
  // ...
});

// Optional auth (can check req.user inside)
app.get('/api/search', optionalAuth, async (req, res) => {
  if (req.user) {
    // Logged in - personalize results
  } else {
    // Anonymous - show generic results
  }
});
```

---

### Example 4: Extract `src/routes/playlist.routes.js`

**Current Code** (server.js lines 1541-2113):
```javascript
// All playlist routes mixed with other code
app.get('/api/playlists', async (req, res) => { /* ... */ });
app.post('/api/playlists', async (req, res) => { /* ... */ });
app.delete('/api/playlists/:playlistId', async (req, res) => { /* ... */ });
// ... etc
```

**New File**: `src/routes/playlist.routes.js`
```javascript
import express from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import * as PlaylistService from '../services/playlist.service.js';

const router = express.Router();

/**
 * GET /api/playlists
 * List all playlists for authenticated user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const playlists = await PlaylistService.getUserPlaylists(req.user.recordId);
    res.json({ ok: true, playlists });
  } catch (err) {
    console.error('[ERROR] GET /api/playlists:', err);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

/**
 * POST /api/playlists
 * Create a new playlist
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Playlist name required' });
    }

    const playlist = await PlaylistService.createPlaylist(req.user.recordId, name);
    res.status(201).json({ ok: true, playlist });
  } catch (err) {
    console.error('[ERROR] POST /api/playlists:', err);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

/**
 * DELETE /api/playlists/:playlistId
 * Delete a playlist
 */
router.delete('/:playlistId', requireAuth, async (req, res) => {
  try {
    const { playlistId } = req.params;

    const deleted = await PlaylistService.deletePlaylist(
      req.user.recordId,
      playlistId
    );

    if (!deleted) {
      return res.status(404).json({ error: 'Playlist not found or access denied' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[ERROR] DELETE /api/playlists:', err);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

/**
 * POST /api/playlists/:playlistId/tracks
 * Add a track to playlist
 */
router.post('/:playlistId/tracks', requireAuth, async (req, res) => {
  try {
    const { playlistId } = req.params;
    const track = req.body;

    const added = await PlaylistService.addTrackToPlaylist(
      req.user.recordId,
      playlistId,
      track
    );

    if (!added) {
      return res.status(404).json({ error: 'Playlist not found or track already exists' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[ERROR] POST /api/playlists/:id/tracks:', err);
    res.status(500).json({ error: 'Failed to add track' });
  }
});

// ... more routes

export default router;
```

**Updated server.js**:
```javascript
import playlistRoutes from './src/routes/playlist.routes.js';
import authRoutes from './src/routes/auth.routes.js';
import discoveryRoutes from './src/routes/discovery.routes.js';
import streamingRoutes from './src/routes/streaming.routes.js';

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api', discoveryRoutes);
app.use('/api', streamingRoutes);

// server.js is now ~200 lines!
```

---

## Testing Strategy

### Unit Tests (Jest)

Install dependencies:
```bash
npm install --save-dev jest @jest/globals supertest
```

**package.json**:
```json
{
  "scripts": {
    "test": "NODE_ENV=test jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/*.test.js"],
    "coveragePathIgnorePatterns": ["/node_modules/"],
    "transform": {}
  }
}
```

**Example Test**: `src/utils/normalize.test.js`
```javascript
import { describe, it, expect } from '@jest/globals';
import { normalizeEmail, slugifyPlaylistName, normalizeRecordId } from './normalize.js';

describe('Normalize Utils', () => {
  describe('normalizeEmail', () => {
    it('converts to lowercase', () => {
      expect(normalizeEmail('Test@Example.COM')).toBe('test@example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeEmail('  test@example.com  ')).toBe('test@example.com');
    });

    it('handles invalid input', () => {
      expect(normalizeEmail(null)).toBe('');
      expect(normalizeEmail('')).toBe('');
      expect(normalizeEmail(123)).toBe('');
    });
  });

  describe('slugifyPlaylistName', () => {
    it('creates URL-safe slug', () => {
      expect(slugifyPlaylistName('My Awesome Playlist!')).toBe('my-awesome-playlist');
    });

    it('handles special characters', () => {
      expect(slugifyPlaylistName('Rock & Roll')).toBe('rock-roll');
    });
  });

  describe('normalizeRecordId', () => {
    it('converts numbers to strings', () => {
      expect(normalizeRecordId(12345)).toBe('12345');
    });

    it('trims whitespace', () => {
      expect(normalizeRecordId('  123  ')).toBe('123');
    });
  });
});
```

### Integration Tests

**Example**: `src/routes/auth.routes.test.js`
```javascript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../../server.js';

describe('Auth Routes', () => {
  let authToken;

  it('POST /api/auth/register - creates new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'testpassword123'
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('POST /api/auth/login - returns JWT token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'testpassword123'
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Extract token from cookie
    const cookie = res.headers['set-cookie'][0];
    authToken = cookie.match(/mass_session=([^;]+)/)[1];
  });

  it('GET /api/auth/me - returns user info', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `mass_session=${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test@example.com');
  });

  it('POST /api/auth/logout - clears session', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `mass_session=${authToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/Max-Age=0/);
  });
});
```

### Run Tests
```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

---

## Migration Checklist

For each module extraction:

### Before Extraction
- [ ] Identify all dependencies (what it imports/uses)
- [ ] Identify all dependents (what uses it)
- [ ] Create feature branch (`git checkout -b refactor/extract-<module>`)

### During Extraction
- [ ] Create new module file with clear exports
- [ ] Add JSDoc comments for all public functions
- [ ] Add unit tests (aim for >80% coverage)
- [ ] Update server.js to import from module
- [ ] Remove old code from server.js

### After Extraction
- [ ] Run all tests (`npm test`)
- [ ] Run smoke tests (`npm run smoke`)
- [ ] Verify no regressions (manual testing)
- [ ] Commit with descriptive message
- [ ] Create PR for review

---

## Timeline Estimate

| Phase | Tasks | Time | Cumulative |
|-------|-------|------|------------|
| Phase 1: Foundation | 5 modules | 3 days | 3 days |
| Phase 2: Middleware | 4 modules | 2 days | 5 days |
| Phase 3: Services | 4 modules | 5 days | 10 days |
| Phase 4: Routes | 4 modules | 3 days | 13 days |
| Phase 5: Testing | Unit + integration | 4 days | 17 days |
| Phase 6: Documentation | Update docs | 1 day | 18 days |

**Total**: 3-4 weeks (working part-time)

---

## Questions?

Refer to:
- **REFACTORING_ROADMAP.md** - Overall plan
- **SECURITY_AUDIT.md** - Security fixes to include
- **PERFORMANCE_AUDIT.md** - Performance optimizations

Good luck with the refactoring! 🏗️
