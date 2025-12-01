import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fetch } from 'undici';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { searchCache, exploreCache, albumCache, publicPlaylistsCache, trendingCache } from './cache.js';
const { AbortController } = globalThis;

// Request deduplication - prevent duplicate simultaneous requests to FileMaker
const pendingRequests = new Map();

async function deduplicatedFetch(cacheKey, cache, fetchFn) {
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Check if request is already pending
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  // Execute and store the promise
  const promise = fetchFn().finally(() => {
    pendingRequests.delete(cacheKey);
  });

  pendingRequests.set(cacheKey, promise);
  return promise;
}

// ETag support for API responses - reduces bandwidth on repeat visits
function generateETag(data) {
  const hash = createHash('md5').update(JSON.stringify(data)).digest('hex');
  return `"${hash.slice(0, 16)}"`;
}

function sendWithETag(res, data) {
  const etag = generateETag(data);
  res.setHeader('ETag', etag);

  const clientETag = res.req.headers['if-none-match'];
  if (clientETag === etag) {
    return res.status(304).end();
  }

  return res.json(data);
}

let loadEnv = () => ({ parsed: {}, skipped: true });
try {
  ({ config: loadEnv } = await import('dotenv'));
} catch (err) {
  console.warn('[MASS] Optional dependency dotenv not found; continue without .env file support');
}

let express;
try {
  ({ default: express } = await import('express'));
} catch (err) {
  console.error('[MASS] Missing dependency express. Run "npm install" to install server packages.');
  process.exit(1);
}

loadEnv();

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
});

function parseTrustProxy(value) {
  if (value === undefined || value === null) return 'loopback';
  if (typeof value === 'boolean' || typeof value === 'number' || Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isNaN(num) ? false : num;
  }
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

const trustProxySetting = parseTrustProxy(process.env.TRUST_PROXY);

function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (Number.isFinite(num) && num > 0) {
    return num;
  }
  return fallback;
}

function parseNonNegativeInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (Number.isFinite(num) && num >= 0) {
    return num;
  }
  return fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FM_TIMEOUT_MS = parsePositiveInt(process.env.FM_TIMEOUT_MS, 45000);
const fmDefaultFetchOptions = { timeoutMs: FM_TIMEOUT_MS, retries: 1 };
const FM_MAX_CONCURRENT_REQUESTS = parsePositiveInt(process.env.FM_MAX_CONCURRENT_REQUESTS, 4);
const FM_MIN_REQUEST_INTERVAL_MS = parseNonNegativeInt(process.env.FM_MIN_REQUEST_INTERVAL_MS, 100);

const fmRequestQueue = [];
let fmActiveRequests = 0;
let fmLastRequestTime = 0;
let fmStartChain = Promise.resolve();

async function takeStartSlot() {
  let release;
  const prev = fmStartChain;
  fmStartChain = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    if (FM_MIN_REQUEST_INTERVAL_MS > 0) {
      const elapsed = Date.now() - fmLastRequestTime;
      const waitMs = FM_MIN_REQUEST_INTERVAL_MS - elapsed;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }
    fmLastRequestTime = Date.now();
  } finally {
    release();
  }
}

function processFmQueue() {
  while (fmRequestQueue.length && fmActiveRequests < FM_MAX_CONCURRENT_REQUESTS) {
    const job = fmRequestQueue.shift();
    fmActiveRequests += 1;
    (async () => {
      try {
        await takeStartSlot();
        const result = await job.task();
        job.resolve(result);
      } catch (err) {
        job.reject(err);
      } finally {
        fmActiveRequests -= 1;
        if (fmRequestQueue.length) {
          process.nextTick(processFmQueue);
        }
      }
    })();
  }
}

function enqueueFmRequest(task) {
  return new Promise((resolve, reject) => {
    fmRequestQueue.push({ task, resolve, reject });
    if (fmRequestQueue.length > FM_MAX_CONCURRENT_REQUESTS * 4) {
      console.warn(`[FM] Request queue length: ${fmRequestQueue.length}`);
    }
    processFmQueue();
  });
}

function fmSafeFetch(url, options, overrides = {}) {
  const finalOptions = { ...fmDefaultFetchOptions, ...overrides };
  return enqueueFmRequest(() => safeFetch(url, options, finalOptions));
}

const app = express();
app.set('trust proxy', trustProxySetting);

// Force HTTPS in production (security - prevent credential leakage)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      console.warn(`[SECURITY] Redirecting HTTP request to HTTPS: ${req.method} ${req.path}`);
      return res.redirect(301, `https://${req.get('host')}${req.url}`);
    }
    next();
  });

  // Add HSTS header (tell browsers to always use HTTPS)
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}

// Enable gzip compression with optimized settings
app.use(compression({
  level: 6, // Balance between compression ratio and speed
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Skip compression if client requests no compression
    if (req.headers['x-no-compression']) return false;
    // Use default filter for everything else
    return compression.filter(req, res);
  }
}));

// Response time logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Only log API requests and slow requests (>100ms)
    if (req.path.startsWith('/api/') || duration > 100) {
      const cached = res.getHeader('X-Cache-Hit') === 'true' ? '[CACHED]' : '';
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms ${cached}`);
    }
  });
  next();
});

app.use(express.json());

// Rate limiting configuration
// More relaxed rate limits for development
const isDevelopment = (process.env.NODE_ENV === 'development' || process.env.HOST === 'localhost' || process.env.HOST === '127.0.0.1');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 100, // Much higher limit in development
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
  // Note: No need to skip static files - they're handled early by express.static()
});

const expensiveLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: isDevelopment ? 500 : 20, // Much higher limit in development for testing
  message: { error: 'Rate limit exceeded for this endpoint' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per window
  message: { error: 'Too many login attempts, please try again later' },
  skipSuccessfulRequests: true
});

// Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

// Add Cache-Control headers for API and HTML responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    if (process.env.NODE_ENV === 'development') {
      // Development: no caching to always see fresh data
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      // Production: 3 minutes browser cache
      res.setHeader('Cache-Control', 'public, max-age=180');
    }
  } else if (req.path === '/' || req.path.endsWith('.html')) {
    if (process.env.NODE_ENV === 'development') {
      // Development: no caching for HTML
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
  next();
});

// Access token validation middleware - checks all API requests
app.use('/api/', async (req, res, next) => {
  // Skip access token check for certain endpoints
  // Note: req.path already has /api/ stripped when using app.use('/api/', ...)
  const skipPaths = [
    '/access/validate',
    '/container'  // Container/image requests - can't send headers from <img> tags
  ];

  if (skipPaths.some(path => req.path === path || req.path.startsWith(path))) {
    return next();
  }

  // Check for access token in header or body
  const accessToken = req.headers['x-access-token'] || req.body?.accessToken;

  if (!accessToken) {
    return res.status(403).json({
      ok: false,
      error: 'Access token required',
      requiresAccessToken: true
    });
  }

  const validation = await validateAccessToken(accessToken);

  if (!validation.valid) {
    return res.status(403).json({
      ok: false,
      error: 'Invalid or expired access token',
      reason: validation.reason,
      requiresAccessToken: true
    });
  }

  // Token is valid, attach info to request and continue
  req.accessToken = {
    code: accessToken,
    type: validation.type,
    expirationDate: validation.expirationDate
  };

  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ========= ENV ========= */
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const FM_HOST = process.env.FM_HOST;
const FM_DB = process.env.FM_DB;
const FM_USER = process.env.FM_USER;
const FM_PASS = process.env.FM_PASS;
const FM_LAYOUT = process.env.FM_LAYOUT || 'API_Album_Songs';
const FM_USERS_LAYOUT = process.env.FM_USERS_LAYOUT || 'API_Users';
const FM_STREAM_EVENTS_LAYOUT = process.env.FM_STREAM_EVENTS_LAYOUT || 'Stream_Events';
const FM_FEATURED_FIELD = (process.env.FM_FEATURED_FIELD || 'Tape Files::featured').trim();
const FM_FEATURED_VALUE = (process.env.FM_FEATURED_VALUE || 'yes').trim();
const FM_FEATURED_VALUE_LC = FM_FEATURED_VALUE.toLowerCase();
const STREAM_EVENT_DEBUG =
  process.env.DEBUG_STREAM_EVENTS === 'true' ||
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG?.includes('stream');
const MASS_SESSION_COOKIE = 'mass.sid';
const MASS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days (reduced from 1 year for security)
const STREAM_EVENT_TYPES = new Set(['PLAY', 'PROGRESS', 'PAUSE', 'SEEK', 'END', 'ERROR']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate session ID format (security - prevent session fixation)
function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return null;
  }
  // Must be valid UUID format
  if (!UUID_REGEX.test(sessionId)) {
    return null;
  }
  return sessionId;
}
const STREAM_TERMINAL_EVENTS = new Set(['END', 'ERROR']);
const STREAM_TIME_FIELD = 'TimeStreamed';
const STREAM_TIME_FIELD_LEGACY = 'PositionSec';

const STREAM_RECORD_CACHE_TTL_MS = 30 * 60 * 1000;
const streamRecordCache = new Map();
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const PLAYLISTS_PATH = path.join(DATA_DIR, 'playlists.json');
const ACCESS_TOKENS_PATH = path.join(DATA_DIR, 'access-tokens.json');

// Serve static files EARLY (after constants defined, before API middleware)
// This bypasses rate limiting, JSON parsing, and other API-specific middleware
const REGEX_STATIC_FILES = /\.(jpe?g|png|gif|svg|webp|ico|woff2?|ttf|eot|mp3|mp4|webm)$/i;
app.use(express.static(PUBLIC_DIR, {
  index: false, // Don't auto-serve index.html - we handle routes manually
  setHeaders: (res, filePath) => {
    // Versioned files (contain ?v= or .min.) get immutable caching for 1 year
    if (filePath.includes('.min.') || /\.[a-f0-9]{8,}\./i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (REGEX_STATIC_FILES.test(filePath)) {
      // Images, fonts, media: 1 day cache
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // JS/CSS without version: 1 hour with revalidation
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    } else {
      // HTML and other files: no cache for development
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
  etag: true,
  lastModified: true
}));
const JUKEBOX_IMAGE_PATH = path.join(PUBLIC_DIR, 'img', 'jukebox.png');

app.get('/img/jukebox.webp', async (req, res, next) => {
  try {
    await fs.access(JUKEBOX_IMAGE_PATH);
    res.type('image/png');
    res.sendFile(JUKEBOX_IMAGE_PATH);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENAMETOOLONG')) return next();
    next(err);
  }
});
const fallbackAuthSecretPath = path.join(DATA_DIR, '.auth_secret');
const RANDOM_SONG_CACHE_PATH = path.join(DATA_DIR, 'random-songs-cache.json');
const RANDOM_SONG_SEED_LOCK_PATH = path.join(DATA_DIR, '.random-songs-cache.lock');
const PLAYLIST_SEED_CACHE_TTL_MS = parsePositiveInt(process.env.PLAYLIST_SEED_CACHE_TTL_MS, 15 * 60 * 1000);
const FEATURED_ALBUM_CACHE_TTL_MS = parsePositiveInt(process.env.FEATURED_ALBUM_CACHE_TTL_MS, 30 * 1000); // 30 seconds

let randomSongPersistedCache = { items: [], updatedAt: 0 };
let playlistSeedCache = { items: [], updatedAt: 0 };
let featuredAlbumCache = { items: [], total: 0, updatedAt: 0 };
let cachedFeaturedFieldName = null; // Cache the successful featured field name
try {
  const persistedRaw = await fs.readFile(RANDOM_SONG_CACHE_PATH, 'utf8');
  const persistedJson = JSON.parse(persistedRaw);
  if (Array.isArray(persistedJson?.items) && persistedJson.items.length) {
    randomSongPersistedCache = {
      items: persistedJson.items,
      updatedAt: Number(persistedJson.updatedAt) || Date.now()
    };
    console.log(`[random-songs] Loaded persisted cache with ${randomSongPersistedCache.items.length} items`);
  }
} catch (err) {
  if (err?.code !== 'ENOENT') {
    console.warn('[random-songs] Failed to read persisted cache', err);
  }
}
class HttpError extends Error {
  constructor(status, body, meta = {}) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.meta = meta;
  }
}

let AUTH_SECRET = process.env.AUTH_SECRET;
let authSecretSource = AUTH_SECRET ? 'AUTH_SECRET environment variable' : null;

if (!AUTH_SECRET && process.env.AUTH_SECRET_FILE) {
  try {
    const fileSecret = (await fs.readFile(process.env.AUTH_SECRET_FILE, 'utf8')).trim();
    if (fileSecret) {
      AUTH_SECRET = fileSecret;
      authSecretSource = `AUTH_SECRET_FILE (${process.env.AUTH_SECRET_FILE})`;
    } else {
      console.error(`[MASS] AUTH_SECRET_FILE ${process.env.AUTH_SECRET_FILE} is empty`);
    }
  } catch (err) {
    console.error(`[MASS] Failed to read AUTH_SECRET_FILE ${process.env.AUTH_SECRET_FILE}: ${err.message}`);
  }
}

if (!AUTH_SECRET && process.env.NODE_ENV === 'production') {
  try {
    const fileSecret = (await fs.readFile(fallbackAuthSecretPath, 'utf8')).trim();
    if (fileSecret) {
      AUTH_SECRET = fileSecret;
      authSecretSource = `persisted file (${fallbackAuthSecretPath})`;
      console.warn(`[MASS] Loaded AUTH_SECRET from ${fallbackAuthSecretPath}. Configure AUTH_SECRET in the environment to manage rotation explicitly.`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[MASS] Failed to read fallback auth secret file ${fallbackAuthSecretPath}: ${err.message}`);
    }
  }
}

if (!AUTH_SECRET && process.env.NODE_ENV === 'production') {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    AUTH_SECRET = randomBytes(32).toString('hex');
    await fs.writeFile(fallbackAuthSecretPath, AUTH_SECRET, { encoding: 'utf8', mode: 0o600 });
    authSecretSource = 'generated ephemeral secret';
    console.warn('[MASS] Generated AUTH_SECRET at runtime because none was provided. Sessions will reset on redeploy; set AUTH_SECRET in the environment for stability.');
  } catch (err) {
    console.error('[MASS] FATAL: AUTH_SECRET is required in production and could not be generated', err);
    process.exit(1);
  }
}

if (!AUTH_SECRET) {
  console.warn('[MASS] WARNING: Using insecure development secret. DO NOT use in production!');
  console.warn('[MASS] Generate a secret: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  AUTH_SECRET = 'development-secret-change-me';
  authSecretSource = 'development fallback';
}

if (authSecretSource && process.env.NODE_ENV !== 'production') {
  console.info(`[MASS] AUTH_SECRET source: ${authSecretSource}`);
}
const AUTH_COOKIE_NAME = 'mass_session';
const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const PUBLIC_PLAYLIST_FIELDS = [
  'PublicPlaylist',
  'Public Playlist',
  'Tape Files::PublicPlaylist',
  'Tape Files::Public Playlist',
  'Public_Playlist',
  'Playlist Name',
  'Playlist::Public'
];

// Cache for discovered field names (performance optimization)
let publicPlaylistFieldCache = null; // Caches which field name works in FileMaker
let yearFieldCache = null; // Caches which year field name works in FileMaker

// Memoized regex patterns (performance optimization - avoids recompilation)
const REGEX_WHITESPACE = /\s+/g;
const REGEX_CURLY_SINGLE_QUOTES = /[\u2018\u2019]/g;
const REGEX_CURLY_DOUBLE_QUOTES = /[\u201C\u201D]/g;
const REGEX_LEADING_TRAILING_NONWORD = /^\W+|\W+$/g;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_HTTP_HTTPS = /^https?:\/\//i;
const REGEX_ABSOLUTE_API_CONTAINER = /^https?:\/\/[^/]+\/api\/container\?/i;
const REGEX_DATA_URI = /^data:/i;
const REGEX_EXTRACT_NUMBERS = /[^0-9.-]/g;
const REGEX_TRACK_SONG = /(track|song)/;
const REGEX_NUMBER_INDICATORS = /(no|num|#|seq|order|pos)/;
const REGEX_TABLE_MISSING = /table is missing/i;
// REGEX_STATIC_FILES moved to top of file (line ~205) where express.static() is configured
const REGEX_SLUGIFY_NONALPHA = /[^a-z0-9]+/g;
const REGEX_SLUGIFY_TRIM_DASHES = /^-+|-+$/g;
const REGEX_UUID_DASHES = /-/g;
const REGEX_NORMALIZE_FIELD = /[^a-z0-9]/gi;

// Input validation helpers (security - prevent injection/XSS)
const validators = {
  searchQuery: (value) => {
    if (typeof value !== 'string') return { valid: false, error: 'Must be string' };
    const trimmed = value.trim();
    if (trimmed.length > 200) return { valid: false, error: 'Too long (max 200 chars)' };
    // Reject FileMaker operators to prevent query injection
    if (/[=<>!]|\s(OR|AND|NOT)\s/i.test(trimmed)) {
      return { valid: false, error: 'Invalid characters in search query' };
    }
    return { valid: true, value: trimmed };
  },

  playlistName: (value) => {
    if (typeof value !== 'string') return { valid: false, error: 'Must be string' };
    const trimmed = value.trim();
    if (trimmed.length < 1) return { valid: false, error: 'Playlist name required' };
    if (trimmed.length > 100) return { valid: false, error: 'Too long (max 100 chars)' };
    // Prevent XSS by rejecting HTML tags
    if (/<[^>]*>/g.test(trimmed)) {
      return { valid: false, error: 'HTML tags not allowed' };
    }
    return { valid: true, value: trimmed };
  },

  recordId: (value) => {
    const str = String(value).trim();
    if (!/^\d+$/.test(str)) {
      return { valid: false, error: 'Record ID must be numeric' };
    }
    if (str.length > 20) {
      return { valid: false, error: 'Record ID too long' };
    }
    return { valid: true, value: str };
  },

  limit: (value, max = 1000) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) return { valid: false, error: 'Limit must be positive integer' };
    if (num > max) return { valid: false, error: `Limit exceeds maximum (${max})` };
    return { valid: true, value: num };
  },

  offset: (value) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return { valid: false, error: 'Offset must be non-negative integer' };
    if (num > 1000000) return { valid: false, error: 'Offset too large' };
    return { valid: true, value: num };
  },

  url: (value) => {
    if (typeof value !== 'string') return { valid: false, error: 'URL must be string' };
    const trimmed = value.trim();
    // Reject directory traversal attempts
    if (trimmed.includes('..') || trimmed.includes('\\')) {
      return { valid: false, error: 'Invalid URL path' };
    }
    if (trimmed.length > 2000) {
      return { valid: false, error: 'URL too long' };
    }
    return { valid: true, value: trimmed };
  }
};

const TRACK_SEQUENCE_FIELDS = [
  'Track Number',
  'TrackNumber',
  'Track_Number',
  'Track No',
  'Track No.',
  'Track_No',
  'Track #',
  'Track#',
  'Track Sequence',
  'Track Sequence Number',
  'Track Seq',
  'Track Seq No',
  'Track Order',
  'Track Position',
  'TrackPosition',
  'Sequence',
  'Seq',
  'Sequence Number',
  'Sequence_Number',
  'Song Number',
  'Song No',
  'Song Seq',
  'Song Order',
  'Tape Files::Track Number',
  'Tape Files::Track_No'
];
const PUBLIC_PLAYLIST_NAME_SPLIT = /[,;|\r\n]+/;
const FM_VISIBILITY_FIELD = (process.env.FM_VISIBILITY_FIELD || '').trim();
const FM_VISIBILITY_VALUE = (process.env.FM_VISIBILITY_VALUE || 'show').trim();
const FM_VISIBILITY_VALUE_LC = FM_VISIBILITY_VALUE.toLowerCase();


function hasValidAudio(fields) {
  if (!fields || typeof fields !== 'object') return false;
  for (const field of AUDIO_FIELD_CANDIDATES) {
    const raw = fields[field];
    if (!raw) continue;
    const resolved = resolvePlayableSrc(String(raw));
    if (resolved) return true;
  }
  for (const field of DEFAULT_AUDIO_FIELDS) {
    const raw = fields[field];
    if (!raw) continue;
    const resolved = resolvePlayableSrc(String(raw));
    if (resolved) return true;
  }
  return false;
}

function hasValidArtwork(fields) {
  if (!fields || typeof fields !== 'object') return false;
  for (const field of ARTWORK_FIELD_CANDIDATES) {
    const raw = fields[field];
    if (!raw) continue;
    const resolved = resolveArtworkSrc(String(raw));
    if (resolved) return true;
  }
  return false;
}

function applyVisibility(query = {}) {
  if (!FM_VISIBILITY_FIELD) return { ...query };
  return { ...query, [FM_VISIBILITY_FIELD]: FM_VISIBILITY_VALUE };
}

function shouldFallbackVisibility(json) {
  const code = json?.messages?.[0]?.code;
  const codeStr = code === undefined || code === null ? '' : String(code);
  return codeStr === '102' || codeStr === '121';
}

function isMissingFieldError(json) {
  const code = json?.messages?.[0]?.code;
  const codeStr = code === undefined || code === null ? '' : String(code);
  return codeStr === '102';
}

function recordIsVisible(fields = {}) {
  if (!FM_VISIBILITY_FIELD) return true;
  const raw = fields[FM_VISIBILITY_FIELD] ?? fields['Tape Files::Visibility'];
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return true;
  return value === FM_VISIBILITY_VALUE_LC;
}

function recordIsFeatured(fields = {}) {
  if (!FEATURED_FIELD_CANDIDATES.length) return false;
  for (const field of FEATURED_FIELD_CANDIDATES) {
    const raw = fields[field];
    if (raw === undefined || raw === null) continue;
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : String(raw).trim().toLowerCase();
    if (!value) continue;
    if (value === FM_FEATURED_VALUE_LC) {
      return true;
    }
  }
  return false;
}

const DEFAULT_AUDIO_FIELDS = ['mp3', 'MP3', 'Audio File', 'Audio::mp3'];
const AUDIO_FIELD_CANDIDATES = ['mp3', 'MP3', 'Audio File', 'Audio::mp3'];
const ARTWORK_FIELD_CANDIDATES = [
  'Artwork::Picture',
  'Artwork Picture',
  'Picture',
  'CoverArtURL',
  'AlbumCover',
  'Cover Art',
  'CoverArt'
];
const CATALOGUE_FIELD_CANDIDATES = [
  'Album Catalogue Number',
  'Album Catalog Number',
  'Album Catalogue No',
  'Album Catalog No',
  'Catalogue',
  'Catalogue #',
  'Catalogue Number',
  'Catalog Number',
  'Catalog #',
  'Tape Files::Album Catalogue Number',
  'Tape Files::Catalogue',
  'Tape Files::Catalogue #',
  'Reference Catalogue Number',
  'Reference Catalog Number',
  'Reference Catalogue No',
  'Reference Catalog No',
  'Reference Catalogue #',
  'Reference Catalog #',
  'Tape Files::Reference Catalogue Number',
  'Tape Files::Reference Catalogue No',
  'Tape Files::Reference Catalogue #',
  'Tape Files::Reference Catalog Number',
  'Tape Files::Reference Catalog No',
  'Tape Files::Reference Catalog #'
];
const FEATURED_FIELD_BASE = FM_FEATURED_FIELD.replace(/^tape files::/i, '').trim();
const FEATURED_FIELD_CANDIDATES = Array.from(
  new Set(
    [
      FM_FEATURED_FIELD,
      FEATURED_FIELD_BASE && `Tape Files::${FEATURED_FIELD_BASE}`,
      FEATURED_FIELD_BASE,
      'Tape Files::featured',
      'Tape Files::Featured',
      'featured',
      'Featured'
    ].filter(Boolean)
  )
);

const PUBLIC_PLAYLIST_LAYOUT = 'API_Album_Songs';
const PLAYLIST_IMAGE_EXTS = ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.svg'];
const PLAYLIST_IMAGE_DIR = path.join(PUBLIC_DIR, 'img', 'Playlists');
const playlistImageCache = new Map();

let playlistsCache = { data: null, mtimeMs: 0 };
let accessTokensCache = { data: null, mtimeMs: 0 };
const loggedPublicPlaylistFieldErrors = new Set();

// Map FileMaker error codes to appropriate HTTP status codes
function fmErrorToHttpStatus(fmCode, defaultStatus = 500) {
  const code = parseInt(fmCode, 10);

  // FileMaker error code reference:
  // https://fmhelp.filemaker.com/docs/18/en/errorcodes/

  if (isNaN(code)) return defaultStatus;

  // No records found - return 404 Not Found
  if (code === 401) return 404;

  // Client errors (400-499) - invalid request, missing fields, etc.
  if (code === 102) return 400; // Field is missing
  if (code === 103) return 400; // Relationship is missing
  if (code === 104) return 400; // Script is missing
  if (code === 105) return 400; // Layout is missing
  if (code === 106) return 400; // Table is missing
  if (code >= 500 && code <= 599) return 400; // Date/time validation errors
  if (code >= 800 && code <= 899) return 400; // Find errors (invalid criteria)

  // Service unavailable (503) - FileMaker down or inaccessible
  if (code === 802) return 503; // Unable to open file
  if (code === 954) return 503; // Server is busy
  if (code === 958) return 503; // Parameter missing in query
  if (code >= 10000) return 503; // ODBC/External errors

  // Authentication/permission errors - 401 Unauthorized or 403 Forbidden
  if (code >= 200 && code <= 299) return 403; // Permission/access errors

  // Default to 500 for unknown errors
  return 500;
}

const normalizeRecordId = (value) => {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  return str;
};

const playlistOwnerMatches = (ownerId, userRecordId) =>
  normalizeRecordId(ownerId) === normalizeRecordId(userRecordId);

const slugifyPlaylistName = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(REGEX_SLUGIFY_NONALPHA, '-')
    .replace(REGEX_SLUGIFY_TRIM_DASHES, '');

const normalizeShareId = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const generateShareId = () => {
  if (typeof randomUUID === 'function') {
    return randomUUID().replace(REGEX_UUID_DASHES, '');
  }
  return randomBytes(16).toString('hex');
};

const cloneTrackForShare = (track) => {
  if (!track || typeof track !== 'object') return null;
  const {
    id = null,
    trackRecordId = null,
    name = '',
    albumTitle = '',
    albumArtist = '',
    catalogue = '',
    trackArtist = '',
    mp3 = '',
    resolvedSrc = '',
    seq = null,
    artwork = '',
    audioField = '',
    artworkField = '',
    addedAt = null,
    producer = '',
    language = '',
    genre = '',
    isrc = '',
    composer1 = '',
    composer2 = '',
    composer3 = '',
    composer4 = '',
    composers = [],
    albumKey = '',
    picture = ''
  } = track;

  const payload = {
    id,
    trackRecordId,
    name,
    albumTitle,
    albumArtist,
    catalogue,
    trackArtist,
    mp3,
    resolvedSrc,
    seq,
    artwork,
    audioField,
    artworkField,
    addedAt
  };
  if (producer) payload.producer = producer;
  if (language) payload.language = language;
  if (genre) payload.genre = genre;
  if (isrc) payload.isrc = isrc;
  if (composer1) payload.composer1 = composer1;
  if (composer2) payload.composer2 = composer2;
  if (composer3) payload.composer3 = composer3;
  if (composer4) payload.composer4 = composer4;
  if (Array.isArray(composers) && composers.length) payload.composers = composers.slice();
  if (albumKey) payload.albumKey = albumKey;
  if (picture) payload.picture = picture;
  return payload;
};

const sanitizePlaylistForShare = (playlist) => {
  if (!playlist || typeof playlist !== 'object') return null;
  const tracks = Array.isArray(playlist.tracks)
    ? playlist.tracks.map(cloneTrackForShare).filter(Boolean)
    : [];
  return {
    id: playlist.id || null,
    shareId: normalizeShareId(playlist.shareId),
    name: playlist.name || '',
    sharedAt: playlist.sharedAt || null,
    createdAt: playlist.createdAt || null,
    updatedAt: playlist.updatedAt || null,
    tracks
  };
};

const resolveRequestOrigin = (req) => {
  const originHeader = req.get('origin');
  if (originHeader) return originHeader;
  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const host = forwardedHost || req.get('host');
  const proto = forwardedProto || req.protocol;
  if (proto && host) return `${proto}://${host}`;
  if (host) return `http://${host}`;
  return '';
};

const buildShareUrl = (req, shareId) => {
  const normalized = normalizeShareId(shareId);
  if (!normalized) return '';
  const origin = resolveRequestOrigin(req);
  const pathPart = `/?share=${encodeURIComponent(normalized)}`;
  return origin ? `${origin}${pathPart}` : pathPart;
};

async function resolvePlaylistImage(name) {
  if (!name) return null;
  const slug = slugifyPlaylistName(name);
  if (!slug) return null;
  if (playlistImageCache.has(slug)) return playlistImageCache.get(slug);
  for (const ext of PLAYLIST_IMAGE_EXTS) {
    const fullPath = path.join(PLAYLIST_IMAGE_DIR, slug + ext);
    try {
      await fs.access(fullPath);
      const relative = `/img/Playlists/${slug}${ext}`;
      playlistImageCache.set(slug, relative);
      return relative;
    } catch {
      // ignore
    }
  }
  playlistImageCache.set(slug, null);
  return null;
}

if (!FM_HOST || !FM_DB || !FM_USER || !FM_PASS) {
  console.warn('[MASS] Missing .env values; expected FM_HOST, FM_DB, FM_USER, FM_PASS');
}

const fmBase = `${FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(FM_DB)}`;
let fmToken = null;
let fmTokenExpiresAt = 0;
let fmLoginPromise = null;

const TRENDING_LOOKBACK_HOURS = parsePositiveInt(process.env.TRENDING_LOOKBACK_HOURS, 168);
const TRENDING_FETCH_LIMIT = parsePositiveInt(process.env.TRENDING_FETCH_LIMIT, 400);
const TRENDING_MAX_LIMIT = parsePositiveInt(process.env.TRENDING_MAX_LIMIT, 20);

const RETRYABLE_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT']);
const RETRYABLE_NAMES = new Set(['AbortError']);

async function safeFetch(url, options = {}, { timeoutMs = 15000, retries = 2 } = {}) {
  let attempt = 0;
  let backoff = 500;

  while (true) {
    let timedOut = false;
    let externalAbort = false;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);

    const { signal: originalSignal, headers: originalHeaders, ...rest } = options || {};

    const headers = new Headers(originalHeaders || {});
    if (!headers.has('Connection')) headers.set('Connection', 'close');

    if (originalSignal) {
      if (originalSignal.aborted) {
        externalAbort = true;
        timeoutController.abort();
      } else {
        originalSignal.addEventListener(
          'abort',
          () => {
            externalAbort = true;
            timeoutController.abort();
          },
          { once: true }
        );
      }
    }

    const signals = [timeoutController.signal];
    if (originalSignal) signals.push(originalSignal);
    const composedSignal = signals.length > 1 ? AbortSignal.any(signals) : timeoutController.signal;

    try {
      const response = await fetch(url, { ...rest, headers, signal: composedSignal });
      clearTimeout(timer);
      return response;
    } catch (err) {
      clearTimeout(timer);
      err.timedOut = err.timedOut || timedOut;
      err.externalAbort = err.externalAbort || externalAbort;

      const message = String(err?.message || '').toLowerCase();
      const code = err?.code || err?.cause?.code;
      const retryable = !externalAbort && (
        err.timedOut ||
        RETRYABLE_NAMES.has(err?.name) ||
        (code && RETRYABLE_CODES.has(code)) ||
        message.includes('terminated')
      );

      if (retryable && attempt < retries) {
        await sleep(backoff);
        attempt += 1;
        backoff *= 2;
        continue;
      }
      throw err;
    }
  }
}

function getClientIP(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    const first = forwarded[0];
    if (typeof first === 'string' && first.trim()) {
      return first.trim();
    }
  }
  if (typeof req?.ip === 'string' && req.ip) {
    return req.ip;
  }
  const remoteAddress = req?.socket?.remoteAddress;
  if (typeof remoteAddress === 'string' && remoteAddress) {
    return remoteAddress;
  }
  return '';
}

async function lookupASN(ip) {
  // TODO: integrate MaxMind ASN or an external lookup service for ASN enrichment.
  if (!ip) return 'Unknown';
  return 'Unknown';
}

async function fmLogin() {
  // Mutex pattern: if login is already in progress, wait for it
  if (fmLoginPromise) {
    return fmLoginPromise;
  }

  fmLoginPromise = (async () => {
    try {
      const res = await fmSafeFetch(`${fmBase}/sessions`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${FM_USER}:${FM_PASS}`).toString('base64')
        },
        body: JSON.stringify({})
      }, { retries: 1 });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.messages?.[0]?.message || `HTTP ${res.status}`;
        throw new Error(`FM login failed: ${msg}`);
      }
      const token = json?.response?.token;
      if (!token) throw new Error('FM login returned no token');
      fmToken = token;
      // Token expires in 12 minutes, but refresh 30 seconds early for safety
      fmTokenExpiresAt = Date.now() + (11.5 * 60 * 1000);
      return fmToken;
    } finally {
      fmLoginPromise = null;
    }
  })();

  return fmLoginPromise;
}

async function ensureToken() {
  // Refresh token if missing or expired (using >= to catch exact expiration time)
  if (!fmToken || Date.now() >= fmTokenExpiresAt) {
    await fmLogin();
  }
  return fmToken;
}

async function fmPost(pathSuffix, body) {
  await ensureToken();
  const url = `${fmBase}${pathSuffix}`;
  const baseHeaders = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${fmToken}`
  };

  let res = await fmSafeFetch(url, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(body)
  });

  if (res.status === 401) {
    await fmLogin();
    res = await fmSafeFetch(url, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'Authorization': `Bearer ${fmToken}`
      },
      body: JSON.stringify(body)
    });
  }

  return res;
}

async function fmGetAbsolute(u, { signal } = {}) {
  await ensureToken();
  const headers = new Headers();
  if (typeof u === 'string' && u.startsWith(FM_HOST)) {
    headers.set('Authorization', `Bearer ${fmToken}`);
  }

  let res = await fmSafeFetch(u, { headers, signal }, { retries: 1 });
  if (res.status === 401 && typeof u === 'string' && u.startsWith(FM_HOST)) {
    await fmLogin();
    headers.set('Authorization', `Bearer ${fmToken}`);
    res = await fmSafeFetch(u, { headers, signal }, { retries: 1 });
  }
  return res;
}

async function fmCreateRecord(layout, fieldData) {
  await ensureToken();
  const url = `${fmBase}/layouts/${encodeURIComponent(layout)}/records`;
  const makeHeaders = () => ({
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${fmToken}`
  });

  let res = await fmSafeFetch(url, {
    method: 'POST',
    headers: makeHeaders(),
    body: JSON.stringify({ fieldData })
  });

  if (res.status === 401) {
    await fmLogin();
    res = await fmSafeFetch(url, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({ fieldData })
    });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.messages?.[0]?.message || 'FM error';
    const code = json?.messages?.[0]?.code;
    throw new Error(`FM create failed: ${msg} (${code ?? 'n/a'})`);
  }
  return json?.response || null;
}

async function fmUpdateRecord(layout, recordId, fieldData) {
  if (!recordId) throw new Error('fmUpdateRecord requires recordId');
  await ensureToken();
  const url = `${fmBase}/layouts/${encodeURIComponent(layout)}/records/${encodeURIComponent(recordId)}`;
  const makeHeaders = () => ({
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${fmToken}`
  });

  let res = await fmSafeFetch(url, {
    method: 'PATCH',
    headers: makeHeaders(),
    body: JSON.stringify({ fieldData })
  });

  if (res.status === 401) {
    await fmLogin();
    res = await fmSafeFetch(url, {
      method: 'PATCH',
      headers: makeHeaders(),
      body: JSON.stringify({ fieldData })
    });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.messages?.[0]?.message || 'FM error';
    const code = json?.messages?.[0]?.code;
    throw new Error(`FM update failed: ${msg} (${code ?? 'n/a'})`);
  }
  return json?.response || null;
}

async function fmGetRecordById(layout, recordId) {
  if (!recordId) return null;
  await ensureToken();
  const url = `${fmBase}/layouts/${encodeURIComponent(layout)}/records/${encodeURIComponent(recordId)}`;
  const makeHeaders = () => ({
    'Accept': 'application/json',
    'Authorization': `Bearer ${fmToken}`
  });

  let res = await fmSafeFetch(url, { method: 'GET', headers: makeHeaders() });

  if (res.status === 401) {
    await fmLogin();
    res = await fmSafeFetch(url, { method: 'GET', headers: makeHeaders() });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return null;
  }
  return json?.response?.data?.[0] || null;
}

async function fmFindRecords(layout, queries, { limit = 1, offset = 1, sort = [] } = {}) {
  const payload = {
    query: queries,
    limit,
    offset
  };
  if (Array.isArray(sort) && sort.length) {
    payload.sort = sort;
  }
  const r = await fmPost(`/layouts/${encodeURIComponent(layout)}/_find`, payload);
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.messages?.[0]?.message || 'FM error';
    const code = json?.messages?.[0]?.code;
    return { ok: false, status: r.status, msg, code, data: [], total: 0 };
  }
  const data = json?.response?.data || [];
  const total = json?.response?.dataInfo?.foundCount ?? data.length;
  return { ok: true, data, total };
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await fmFindRecords(FM_USERS_LAYOUT, [{ Email: `==${normalized}` }], { limit: 1, offset: 1 });
  if (!result.ok || result.data.length === 0) return null;
  const entry = result.data[0];
  const fields = entry.fieldData || {};
  return {
    recordId: entry.recordId,
    email: normalizeEmail(fields.Email || normalized),
    passwordHash: fields.PasswordHash || ''
  };
}

async function createUserRecord(email, passwordHash) {
  const normalized = normalizeEmail(email);
  const response = await fmCreateRecord(FM_USERS_LAYOUT, {
    Email: normalized,
    PasswordHash: passwordHash,
    CreatedAt: new Date().toISOString()
  });
  return {
    recordId: response?.recordId,
    email: normalized
  };
}

const normalizeFieldKey = (name) => (typeof name === 'string' ? name.replace(REGEX_NORMALIZE_FIELD, '').toLowerCase() : '');

function pickFieldValueCaseInsensitive(fields = {}, candidates = []) {
  const entries = Object.entries(fields);
  for (const candidate of candidates) {
    for (const [key, raw] of entries) {
      if (key === candidate && raw !== undefined && raw !== null) {
        const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
        if (str) return { value: str, field: key };
      }
    }
    const needle = normalizeFieldKey(candidate);
    if (!needle) continue;
    for (const [key, raw] of entries) {
      if (key === candidate) continue;
      if (raw === undefined || raw === null) continue;
      if (normalizeFieldKey(key) !== needle) continue;
      const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
      if (str) return { value: str, field: key };
    }
  }
  return { value: '', field: '' };
}

function splitPlaylistNames(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split(PUBLIC_PLAYLIST_NAME_SPLIT).map((value) => value.trim()).filter(Boolean);
}

function resolvePlayableSrc(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const src = raw.trim();
  if (!src) return '';

  // Detect FileMaker's internal container metadata format (not a valid URL)
  // Format: "size:0,0\rmovie:file.mp3\rmoviemac:/path/to/file.mp3"
  if (src.includes('\r') || src.includes('\n') ||
      (src.includes('movie:') && src.includes('size:')) ||
      src.includes('moviemac:') || src.includes('moviewin:')) {
    console.warn('[MASS] Detected FileMaker container metadata format, rejecting:', src.slice(0, 100));
    return ''; // Return empty so client falls back to recordId+field approach
  }

  if (src.startsWith('/api/container?')) return src;
  if (REGEX_ABSOLUTE_API_CONTAINER.test(src)) return src;
  if (REGEX_DATA_URI.test(src)) return src;
  if (REGEX_HTTP_HTTPS.test(src)) return `/api/container?u=${encodeURIComponent(src)}`;
  if (src.startsWith('/')) return src;
  return `/api/container?u=${encodeURIComponent(src)}`;
}

function resolveArtworkSrc(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const src = raw.trim();
  if (!src) return '';

  // Detect FileMaker's internal container metadata format (not a valid URL)
  if (src.includes('\r') || src.includes('\n') ||
      (src.includes('movie:') && src.includes('size:')) ||
      src.includes('moviemac:') || src.includes('moviewin:') ||
      src.includes('image:')) {
    console.warn('[MASS] Detected FileMaker container metadata in artwork, rejecting:', src.slice(0, 100));
    return ''; // Return empty - artwork is optional
  }

  if (src.startsWith('/api/container?') || REGEX_HTTP_HTTPS.test(src)) return src;
  return `/api/container?u=${encodeURIComponent(src)}`;
}

function normTitle(str) {
  return String(str || '')
    .replace(REGEX_WHITESPACE, ' ')
    .replace(REGEX_CURLY_SINGLE_QUOTES, "'")
    .replace(REGEX_CURLY_DOUBLE_QUOTES, '"')
    .replace(REGEX_LEADING_TRAILING_NONWORD, '')
    .trim();
}

function makeAlbumKey(catalogue, title, artist) {
  const cat = String(catalogue || '').trim();
  if (cat) return `cat:${cat.toLowerCase()}`;
  const normT = normTitle(title || '').toLowerCase();
  const normA = normTitle(artist || '').toLowerCase();
  return `title:${normT}|artist:${normA}`;
}

function parseTrackSequence(fields = {}) {
  for (const key of TRACK_SEQUENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    const raw = fields[key];
    if (raw === undefined || raw === null) continue;
    const str = String(raw).trim();
    if (!str) continue;
    const numeric = Number(str);
    if (Number.isFinite(numeric)) return numeric;
    const cleaned = Number(str.replace(REGEX_EXTRACT_NUMBERS, ''));
    if (Number.isFinite(cleaned)) return cleaned;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const lower = key.toLowerCase();
    if (!REGEX_TRACK_SONG.test(lower)) continue;
    if (!REGEX_NUMBER_INDICATORS.test(lower)) continue;
    const str = String(value).trim();
    if (!str) continue;
    const numeric = Number(str);
    if (Number.isFinite(numeric)) return numeric;
    const cleaned = Number(str.replace(REGEX_EXTRACT_NUMBERS, ''));
    if (Number.isFinite(cleaned)) return cleaned;
  }
  return Number.POSITIVE_INFINITY;
}

function composersFromFields(fields = {}) {
  return [
    fields['Composer'],
    fields['Composer 1'] ?? fields['Composer1'],
    fields['Composer 2'] ?? fields['Composer2'],
    fields['Composer 3'] ?? fields['Composer3'],
    fields['Composer 4'] ?? fields['Composer4']
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function firstNonEmpty(fields, candidates) {
  for (const candidate of candidates) {
    if (!Object.prototype.hasOwnProperty.call(fields, candidate)) continue;
    const raw = fields[candidate];
    if (raw === undefined || raw === null) continue;
    const str = String(raw).trim();
    if (str) return str;
  }
  return '';
}

// ========= OPTIMIZED FIELD MAP CACHING (40x faster) =========
// WeakMap automatically cleans up when field objects are garbage collected
const fieldMapCache = new WeakMap();

/**
 * Build a normalized field map for fast lookups (O(n) once per record)
 * Maps normalized field names to their values
 */
function getFieldMap(fields) {
  // Check cache first
  if (fieldMapCache.has(fields)) {
    return fieldMapCache.get(fields);
  }

  // Build normalized field name map
  const map = new Map();
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;

    // Store exact match first
    const str = typeof value === 'string' ? value.trim() : String(value).trim();
    if (str && !map.has(key)) {
      map.set(key, str);
    }

    // Also store normalized version for case-insensitive lookup
    const normalized = normalizeFieldKey(key);
    if (normalized && str && !map.has(normalized)) {
      map.set(normalized, str);
    }
  }

  // Cache for future lookups
  fieldMapCache.set(fields, map);
  return map;
}

/**
 * Fast field value picker using cached field map (O(15) vs O(750))
 */
function firstNonEmptyFast(fields, candidates) {
  const map = getFieldMap(fields); // O(1) if cached, O(50) first time

  // Try exact matches first
  for (const candidate of candidates) {
    if (map.has(candidate)) {
      return map.get(candidate);
    }
  }

  // Try normalized matches
  for (const candidate of candidates) {
    const normalized = normalizeFieldKey(candidate);
    if (normalized && map.has(normalized)) {
      return map.get(normalized);
    }
  }

  return '';
}

async function fetchPublicPlaylistRecords({ limit = 100 } = {}) {
  // Robust version: try each candidate PublicPlaylist field individually, skip 102 errors,
  // merge and dedupe results.
  if (!FM_HOST || !FM_DB || !FM_USER || !FM_PASS) {
    return { records: [], total: 0, missingEnv: true };
  }

  const seen = new Set();
  const records = [];
  let totalFound = 0;

  const batchSize = Math.max(1, Math.min(100, limit));
  const candidates = Array.isArray(PUBLIC_PLAYLIST_FIELDS) ? PUBLIC_PLAYLIST_FIELDS : ['PublicPlaylist'];

  // Try cached field first, then others (performance optimization)
  const fieldsToTry = publicPlaylistFieldCache
    ? [publicPlaylistFieldCache, ...candidates.filter(f => f !== publicPlaylistFieldCache)]
    : candidates;

  for (const field of fieldsToTry) {
    let offset = 1;
    let progressed = false;
    while (records.length < limit) {
      const remaining = limit - records.length;
      const currentLimit = Math.min(batchSize, remaining);
      let json;
      try {
        const response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
          query: [{ [field]: '*' }],
          limit: currentLimit,
          offset
        });
        json = await response.json().catch(() => ({}));

        if (!response.ok) {
          const msg = json?.messages?.[0]?.message || 'FM error';
          const code = json?.messages?.[0]?.code;
          const tableMissing = typeof msg === 'string' && REGEX_TABLE_MISSING.test(msg);
          // Skip missing field errors (102) and move to next candidate
          if (String(code) === '102') {
            console.warn(`[MASS] Skipping playlist field "${field}" (FileMaker code 102: Field is missing on layout ${FM_LAYOUT})`);
            break;
          }
          if (tableMissing) {
            if (!loggedPublicPlaylistFieldErrors.has(field)) {
              loggedPublicPlaylistFieldErrors.add(field);
              console.warn(
                `[MASS] Skipping playlist field "${field}" because FileMaker reported "Table is missing" on layout ${FM_LAYOUT}`
              );
            }
            break;
          }
          console.warn(`[MASS] Public playlist query on field "${field}" failed: ${msg} (${code ?? response.status})`);
          break;
        }
      } catch (err) {
        const msg = err?.message || '';
        if (REGEX_TABLE_MISSING.test(msg)) {
          if (!loggedPublicPlaylistFieldErrors.has(field)) {
            loggedPublicPlaylistFieldErrors.add(field);
            console.warn(
              `[MASS] Skipping playlist field "${field}" because FileMaker reported "Table is missing" on layout ${FM_LAYOUT}`
            );
          }
        } else {
          console.warn(`[MASS] Public playlist query on field "${field}" threw`, msg || err);
        }
        break;
      }

      const data = json?.response?.data || [];
      totalFound = Math.max(totalFound, json?.response?.dataInfo?.foundCount ?? 0);

      let added = 0;
      for (const row of data) {
        const rid = row?.recordId ? String(row.recordId) : JSON.stringify(row?.fieldData || row);
        if (seen.has(rid)) continue;
        seen.add(rid);
        records.push(row);
        added++;
        if (records.length >= limit) break;
      }

      progressed = progressed || added > 0;

      // Cache the working field name for future requests (performance optimization)
      if (added > 0 && !publicPlaylistFieldCache) {
        publicPlaylistFieldCache = field;
        console.log(`[CACHE] Detected public playlist field: "${field}"`);
      }

      if (data.length < currentLimit) break;
      offset += data.length;
    }
    // If this field produced any result and we already have enough rows, we can stop early
    if (records.length >= limit) break;
  }

  return { records, total: totalFound || records.length };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: AUTH_COOKIE_SECURE,
    maxAge: AUTH_COOKIE_MAX_AGE,
    path: '/'
  };
}

function setAuthCookie(res, token) {
  if (res.cookie) {
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    return;
  }
  const opts = cookieOptions();
  const parts = [`${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`];
  parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  parts.push('SameSite=Lax');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res) {
  const opts = cookieOptions();
  if (res.clearCookie) {
    res.clearCookie(AUTH_COOKIE_NAME, { ...opts, maxAge: 0 });
    return;
  }
  const parts = [`${AUTH_COOKIE_NAME}=`, 'Max-Age=0', 'Path=/', 'HttpOnly'];
  if (opts.secure) parts.push('Secure');
  parts.push('SameSite=Lax');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const out = {};
  const pieces = header.split(';');
  for (const piece of pieces) {
    const part = piece.trim();
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function readAuthToken(req) {
  const cookies = parseCookies(req);
  return cookies[AUTH_COOKIE_NAME] || null;
}

function issueToken(payload) {
  return jwt.sign(payload, AUTH_SECRET, { expiresIn: '7d' });
}

async function getUserFromTokenPayload(payload) {
  const recordId = payload?.sub;
  if (!recordId) return null;
  const record = await fmGetRecordById(FM_USERS_LAYOUT, recordId);
  if (!record) return null;
  const fields = record.fieldData || {};
  const email = normalizeEmail(fields.Email || payload?.email || '');
  if (!email) return null;
  return { recordId, email };
}

async function authenticateRequest(req) {
  const token = readAuthToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, AUTH_SECRET);
    return await getUserFromTokenPayload(payload);
  } catch (err) {
    if (err?.name !== 'TokenExpiredError') {
      console.warn('[MASS] Auth token verification failed:', err?.message || err);
    }
    return null;
  }
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'Email required' };
  if (!REGEX_EMAIL.test(normalized)) {
    return { ok: false, reason: 'Invalid email address' };
  }
  return { ok: true, email: normalized };
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.trim().length < 8) {
    return { ok: false, reason: 'Password must be at least 8 characters' };
  }
  if (password.length > 200) {
    return { ok: false, reason: 'Password too long' };
  }
  return { ok: true };
}

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.warn('[MASS] Failed to ensure data directory exists:', err);
  }
}

async function loadPlaylists() {
  try {
    const stat = await fs.stat(PLAYLISTS_PATH);
    if (Array.isArray(playlistsCache.data) && playlistsCache.mtimeMs === stat.mtimeMs) {
      return playlistsCache.data;
    }

    const raw = await fs.readFile(PLAYLISTS_PATH, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.warn('[MASS] Playlists file contained invalid JSON, resetting to empty list:', parseErr);
      await fs.writeFile(PLAYLISTS_PATH, '[]', 'utf8');
      let repairedMtime = Date.now();
      try {
        const repairedStat = await fs.stat(PLAYLISTS_PATH);
        if (repairedStat?.mtimeMs) repairedMtime = repairedStat.mtimeMs;
      } catch {
        // ignore stat errors; continue with Date.now()
      }
      playlistsCache = { data: [], mtimeMs: repairedMtime };
      return playlistsCache.data;
    }
    const data = Array.isArray(parsed) ? parsed : [];

    // Remove email addresses for privacy (we only need userId)
    for (const entry of data) {
      if (entry && typeof entry === 'object') {
        delete entry.userEmail;
      }
    }

    playlistsCache = { data, mtimeMs: stat.mtimeMs };
    return data;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await ensureDataDir();
      await fs.writeFile(PLAYLISTS_PATH, '[]', 'utf8');
      playlistsCache = { data: [], mtimeMs: Date.now() };
      return playlistsCache.data;
    }
    console.warn('[MASS] Failed to read playlists file:', err);
    return Array.isArray(playlistsCache.data) ? playlistsCache.data : [];
  }
}

async function savePlaylists(playlists) {
  try {
    await ensureDataDir();
    const normalized = Array.isArray(playlists) ? playlists : [];
    for (const entry of normalized) {
      if (entry && typeof entry === 'object') {
        entry.userId = normalizeRecordId(entry.userId);

        // Remove email address for privacy (we already have userId)
        delete entry.userEmail;

        const shareId = normalizeShareId(entry.shareId);
        if (shareId) {
          entry.shareId = shareId;
        } else {
          delete entry.shareId;
          if (entry.sharedAt) entry.sharedAt = null;
        }
      }
    }
    const payload = JSON.stringify(normalized, null, 2);
    const tempPath = `${PLAYLISTS_PATH}.tmp`;
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, PLAYLISTS_PATH);
    let mtimeMs = Date.now();
    try {
      const stat = await fs.stat(PLAYLISTS_PATH);
      if (stat?.mtimeMs) mtimeMs = stat.mtimeMs;
    } catch {
      // ignore stat errors; fall back to Date.now()
    }
    playlistsCache = { data: normalized, mtimeMs };
  } catch (err) {
    console.error('[MASS] Failed to write playlists file:', err);
    throw err;
  }
}

// ========= ACCESS TOKEN MANAGEMENT =========

async function loadAccessTokens() {
  try {
    const stat = await fs.stat(ACCESS_TOKENS_PATH);
    if (accessTokensCache.data && accessTokensCache.mtimeMs === stat.mtimeMs) {
      return accessTokensCache.data;
    }

    const raw = await fs.readFile(ACCESS_TOKENS_PATH, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.warn('[MASS] Access tokens file contained invalid JSON, resetting to default:', parseErr);
      const defaultData = {
        tokens: [
          {
            code: 'MASS-UNLIMITED-ACCESS',
            type: 'unlimited',
            issuedDate: new Date().toISOString(),
            expirationDate: null,
            notes: 'Master cheat token - never expires'
          }
        ]
      };
      await fs.writeFile(ACCESS_TOKENS_PATH, JSON.stringify(defaultData, null, 2), 'utf8');
      accessTokensCache = { data: defaultData, mtimeMs: Date.now() };
      return defaultData;
    }

    const data = parsed && typeof parsed === 'object' ? parsed : { tokens: [] };
    if (!Array.isArray(data.tokens)) {
      data.tokens = [];
    }

    accessTokensCache = { data, mtimeMs: stat.mtimeMs };
    return data;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await ensureDataDir();
      const defaultData = {
        tokens: [
          {
            code: 'MASS-UNLIMITED-ACCESS',
            type: 'unlimited',
            issuedDate: new Date().toISOString(),
            expirationDate: null,
            notes: 'Master cheat token - never expires'
          }
        ]
      };
      await fs.writeFile(ACCESS_TOKENS_PATH, JSON.stringify(defaultData, null, 2), 'utf8');
      accessTokensCache = { data: defaultData, mtimeMs: Date.now() };
      return defaultData;
    }
    console.warn('[MASS] Failed to read access tokens file:', err);
    return accessTokensCache.data || { tokens: [] };
  }
}

async function saveAccessTokens(tokenData) {
  try {
    await ensureDataDir();
    const normalized = tokenData && typeof tokenData === 'object' ? tokenData : { tokens: [] };
    if (!Array.isArray(normalized.tokens)) {
      normalized.tokens = [];
    }

    const payload = JSON.stringify(normalized, null, 2);
    const tempPath = `${ACCESS_TOKENS_PATH}.tmp`;
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, ACCESS_TOKENS_PATH);

    let mtimeMs = Date.now();
    try {
      const stat = await fs.stat(ACCESS_TOKENS_PATH);
      if (stat?.mtimeMs) mtimeMs = stat.mtimeMs;
    } catch {
      // ignore stat errors; fall back to Date.now()
    }
    accessTokensCache = { data: normalized, mtimeMs };
  } catch (err) {
    console.error('[MASS] Failed to write access tokens file:', err);
    throw err;
  }
}

// Fallback function: validates token from JSON file (used if FileMaker is down)
function validateAccessTokenFromJSON(tokenCode) {
  if (!tokenCode || typeof tokenCode !== 'string') {
    return { valid: false, reason: 'No token provided' };
  }

  const trimmedCode = tokenCode.trim().toUpperCase();

  // Special case: cheat token (unlimited access)
  if (trimmedCode === 'MASS-UNLIMITED-ACCESS') {
    return {
      valid: true,
      type: 'unlimited',
      expirationDate: null,
      message: 'Unlimited access token'
    };
  }

  // Load and check against stored tokens
  const tokenData = accessTokensCache.data || { tokens: [] };
  const token = tokenData.tokens.find(t =>
    t.code && t.code.trim().toUpperCase() === trimmedCode
  );

  if (!token) {
    return { valid: false, reason: 'Invalid token' };
  }

  // Check expiration
  if (token.expirationDate) {
    const expirationTime = new Date(token.expirationDate).getTime();
    const now = Date.now();

    if (now > expirationTime) {
      return {
        valid: false,
        reason: 'Token expired',
        expirationDate: token.expirationDate
      };
    }
  }

  return {
    valid: true,
    type: token.type || 'trial',
    expirationDate: token.expirationDate,
    issuedDate: token.issuedDate,
    notes: token.notes
  };
}

// Main function: validates token from FileMaker database
async function validateAccessToken(tokenCode) {
  if (!tokenCode || typeof tokenCode !== 'string') {
    return { valid: false, reason: 'No token provided' };
  }

  const trimmedCode = tokenCode.trim().toUpperCase();

  // Special case: unlimited cheat token (no DB lookup needed)
  if (trimmedCode === 'MASS-UNLIMITED-ACCESS') {
    return {
      valid: true,
      type: 'unlimited',
      expirationDate: null,
      message: 'Unlimited access token'
    };
  }

  try {
    // Look up token in FileMaker
    const layout = process.env.FM_TOKENS_LAYOUT || 'API_Access_Tokens';

    const result = await fmFindRecords(layout, [
      { 'Token_Code': `==${trimmedCode}` }  // Exact match search
    ], { limit: 1 });

    // Token not found in FileMaker
    if (!result || !result.data || result.data.length === 0) {
      return { valid: false, reason: 'Invalid token' };
    }

    const token = result.data[0].fieldData;

    // Check if token is disabled
    if (token.Active === 0 || token.Active === '0') {
      return { valid: false, reason: 'Token disabled' };
    }

    // Check expiration
    if (token.Expiration_Date) {
      // Parse FileMaker timestamp with timezone offset
      // FileMaker stores timestamps in server's local timezone (CAT = UTC+2)
      // We need to convert to UTC for comparison
      const fmTimezoneOffset = parseFloat(process.env.FM_TIMEZONE_OFFSET || '0');

      // Parse the FileMaker date string
      let expirationTime = new Date(token.Expiration_Date).getTime();

      // Adjust for FileMaker's timezone offset (convert FM local time to UTC)
      // If FM is UTC+2, subtract 2 hours to get UTC
      const offsetMs = fmTimezoneOffset * 60 * 60 * 1000;
      expirationTime = expirationTime - offsetMs;

      const now = Date.now();

      console.log(`[MASS] Token expiration check for ${trimmedCode}:`);
      console.log(`  Raw expiration from FM: "${token.Expiration_Date}"`);
      console.log(`  FM Timezone offset: ${fmTimezoneOffset > 0 ? '+' : ''}${fmTimezoneOffset} hours`);
      console.log(`  Parsed as local: ${new Date(token.Expiration_Date).toISOString()}`);
      console.log(`  Adjusted to UTC: ${new Date(expirationTime).toISOString()}`);
      console.log(`  Current UTC time: ${new Date(now).toISOString()}`);
      console.log(`  Time until expiry: ${((expirationTime - now) / 1000 / 60 / 60).toFixed(2)} hours`);

      if (isNaN(expirationTime)) {
        console.warn(`[MASS] Could not parse expiration date: "${token.Expiration_Date}" - treating as no expiration`);
      } else if (now > expirationTime) {
        console.log(`[MASS] Token ${trimmedCode} is EXPIRED`);
        return {
          valid: false,
          reason: 'Token expired',
          expirationDate: token.Expiration_Date
        };
      } else {
        console.log(`[MASS] Token ${trimmedCode} is still valid`);
      }
    }

    // Update usage statistics (async - don't wait for it)
    const recordId = result.data[0].recordId;
    const now = new Date();
    const fmTimestamp = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const updateFields = {
      'Last_Used': fmTimestamp,
      'Use_Count': (parseInt(token.Use_Count) || 0) + 1
    };

    // Track if we're calculating a new expiration for first-time use
    let calculatedExpirationUTC = null;

    // If this is the first use, set First_Used timestamp
    if (!token.First_Used || token.First_Used === '') {
      updateFields['First_Used'] = fmTimestamp;
      console.log(`[MASS] Setting First_Used for token ${trimmedCode}`);

      // Also calculate and set Expiration_Date if Token_Duration_Hours is set
      if (token.Token_Duration_Hours && parseInt(token.Token_Duration_Hours) > 0) {
        const durationSeconds = parseInt(token.Token_Duration_Hours);
        const expirationTime = new Date(now.getTime() + (durationSeconds * 1000));
        const fmExpiration = `${expirationTime.getMonth() + 1}/${expirationTime.getDate()}/${expirationTime.getFullYear()} ${expirationTime.getHours()}:${String(expirationTime.getMinutes()).padStart(2, '0')}:${String(expirationTime.getSeconds()).padStart(2, '0')}`;
        updateFields['Expiration_Date'] = fmExpiration;

        // Store the calculated expiration as UTC ISO string for return
        calculatedExpirationUTC = expirationTime.toISOString();
        console.log(`[MASS] Setting Expiration_Date for token ${trimmedCode}: ${fmExpiration} (${durationSeconds} seconds from now)`);
      }
    }

    fmUpdateRecord(layout, recordId, updateFields).catch(err => {
      console.warn('[MASS] Failed to update token usage stats:', err);
    });

    // Token is valid!
    // Use calculated expiration if we just set it, otherwise convert from DB
    let expirationDateUTC = calculatedExpirationUTC;
    if (!expirationDateUTC && token.Expiration_Date) {
      const fmTimezoneOffset = parseFloat(process.env.FM_TIMEZONE_OFFSET || '0');
      let expirationTimeUTC = new Date(token.Expiration_Date).getTime();
      const offsetMs = fmTimezoneOffset * 60 * 60 * 1000;
      expirationTimeUTC = expirationTimeUTC - offsetMs;
      expirationDateUTC = new Date(expirationTimeUTC).toISOString();
    }

    return {
      valid: true,
      type: token.Token_Type || 'trial',
      expirationDate: expirationDateUTC,
      issuedDate: token.Issued_Date,
      notes: token.Notes
    };
  } catch (err) {
    console.error('[MASS] FileMaker token validation error:', err);

    // Fallback to JSON file if FileMaker lookup fails
    console.warn('[MASS] Falling back to JSON file for token validation');
    return validateAccessTokenFromJSON(tokenCode);
  }
}

function normalizeTrackPayload(raw = {}) {
  const recordId = typeof raw.recordId === 'string' ? raw.recordId.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const albumTitle = typeof raw.albumTitle === 'string' ? raw.albumTitle.trim() : '';
  const albumArtist = typeof raw.albumArtist === 'string' ? raw.albumArtist.trim() : '';
  const catalogue = typeof raw.catalogue === 'string' ? raw.catalogue.trim() : '';
  const trackArtist = typeof raw.trackArtist === 'string' ? raw.trackArtist.trim() : '';
  const mp3 = typeof raw.mp3 === 'string' ? raw.mp3.trim() : '';
  const resolvedSrc = typeof raw.resolvedSrc === 'string' ? raw.resolvedSrc.trim() : '';
  let seq = raw.seq;
  if (typeof seq === 'string') {
    const parsed = Number(seq.trim());
    seq = Number.isFinite(parsed) ? parsed : null;
  } else if (typeof seq === 'number') {
    seq = Number.isFinite(seq) ? seq : null;
  } else {
    seq = null;
  }
  const artwork = typeof raw.artwork === 'string' ? raw.artwork.trim() : '';
  const audioField = typeof raw.audioField === 'string' ? raw.audioField.trim() : '';
  const artworkField = typeof raw.artworkField === 'string' ? raw.artworkField.trim() : '';
  return {
    recordId,
    name,
    albumTitle,
    albumArtist,
    catalogue,
    trackArtist,
    mp3,
    resolvedSrc,
    seq,
    artwork,
    audioField,
    artworkField
  };
}

function trackDuplicateKey(payload) {
  if (!payload) return '';
  if (payload.recordId) return `id:${payload.recordId}`;
  if (payload.name && payload.albumTitle && payload.albumArtist) {
    return `meta:${payload.name}|${payload.albumTitle}|${payload.albumArtist}`;
  }
  return '';
}

function trackDuplicateKeyFromEntry(entry = {}) {
  const recordId = typeof entry.trackRecordId === 'string' ? entry.trackRecordId.trim() : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const albumTitle = typeof entry.albumTitle === 'string' ? entry.albumTitle.trim() : '';
  const albumArtist = typeof entry.albumArtist === 'string' ? entry.albumArtist.trim() : '';
  return trackDuplicateKey({ recordId, name, albumTitle, albumArtist });
}

function summarizeTrackPayload(payload = {}) {
  return {
    recordId: payload.recordId || null,
    name: payload.name || '',
    albumTitle: payload.albumTitle || '',
    albumArtist: payload.albumArtist || '',
    seq: Number.isFinite(payload.seq) ? payload.seq : null
  };
}

function buildTrackEntry(payload, addedAt) {
  return {
    id: randomUUID(),
    trackRecordId: payload.recordId || null,
    name: payload.name,
    albumTitle: payload.albumTitle,
    albumArtist: payload.albumArtist,
    catalogue: payload.catalogue,
    trackArtist: payload.trackArtist,
    mp3: payload.mp3,
    resolvedSrc: payload.resolvedSrc,
    seq: Number.isFinite(payload.seq) ? payload.seq : null,
    artwork: payload.artwork,
    audioField: payload.audioField,
    artworkField: payload.artworkField,
    addedAt
  };
}

function buildPlaylistDuplicateIndex(playlist) {
  const map = new Map();
  const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
  for (const entry of tracks) {
    const key = trackDuplicateKeyFromEntry(entry);
    if (key && !map.has(key)) {
      map.set(key, entry);
    }
  }
  return map;
}

function resolveDuplicate(map, payload) {
  const key = trackDuplicateKey(payload);
  if (!key) return { key: '', entry: null };
  return { key, entry: map.get(key) || null };
}

function streamRecordCacheKey(sessionId, trackRecordId) {
  return `${sessionId}::${trackRecordId}`;
}

function getCachedStreamRecordId(sessionId, trackRecordId) {
  const key = streamRecordCacheKey(sessionId, trackRecordId);
  const entry = streamRecordCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    streamRecordCache.delete(key);
    return null;
  }
  return entry.recordId || null;
}

function setCachedStreamRecordId(sessionId, trackRecordId, recordId) {
  if (!sessionId || !trackRecordId || !recordId) return;
  const key = streamRecordCacheKey(sessionId, trackRecordId);
  streamRecordCache.set(key, {
    recordId,
    expiresAt: Date.now() + STREAM_RECORD_CACHE_TTL_MS
  });
}

function clearCachedStreamRecordId(sessionId, trackRecordId) {
  if (!sessionId || !trackRecordId) return;
  const key = streamRecordCacheKey(sessionId, trackRecordId);
  streamRecordCache.delete(key);
}

async function findStreamRecord(sessionId, trackRecordId) {
  if (!sessionId || !trackRecordId) return null;
  const query = [
    {
      SessionID: `==${sessionId}`,
      TrackRecordID: `==${trackRecordId}`
    }
  ];
  const sort = [
    { fieldName: 'LastEventUTC', sortOrder: 'descend' },
    { fieldName: 'TimestampUTC', sortOrder: 'descend' }
  ];
  let result = await fmFindRecords(FM_STREAM_EVENTS_LAYOUT, query, { limit: 1, offset: 1, sort });
  if (!result.ok) {
    result = await fmFindRecords(FM_STREAM_EVENTS_LAYOUT, query, { limit: 1, offset: 1 });
  }
  if (!result.ok || result.data.length === 0) return null;
  const entry = result.data[0];
  const recordId = entry?.recordId;
  if (recordId) setCachedStreamRecordId(sessionId, trackRecordId, recordId);
  return {
    recordId,
    fieldData: entry?.fieldData || {}
  };
}

async function ensureStreamRecord(sessionId, trackRecordId, createFields, { forceNew = false } = {}) {
  if (!sessionId || !trackRecordId) {
    throw new Error('ensureStreamRecord requires sessionId and trackRecordId');
  }
  if (forceNew) {
    clearCachedStreamRecordId(sessionId, trackRecordId);
  } else {
    const cachedId = getCachedStreamRecordId(sessionId, trackRecordId);
    if (cachedId) {
      return { recordId: cachedId, created: false, response: null, existingFieldData: null };
    }
  }
  if (!forceNew) {
    const existing = await findStreamRecord(sessionId, trackRecordId);
    if (existing?.recordId) {
      return { recordId: existing.recordId, created: false, response: null, existingFieldData: existing.fieldData || null };
    }
  }
  const response = await fmCreateRecord(FM_STREAM_EVENTS_LAYOUT, createFields);
  const recordId = response?.recordId;
  if (!recordId) {
    throw new Error('Stream event create returned no recordId');
  }
  setCachedStreamRecordId(sessionId, trackRecordId, recordId);
  return { recordId, created: true, response, existingFieldData: null };
}

function normalizeSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.round(parsed));
  }
  return 0;
}

function toCleanString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatTimestampUTC(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    return formatTimestampUTC(new Date());
  }
  const pad = (num) => String(num).padStart(2, '0');
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const year = d.getUTCFullYear();
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());
  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
}

function parseFileMakerTimestamp(value) {
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }
  if (typeof value !== 'string') {
    if (value === null || value === undefined) return 0;
    return parseFileMakerTimestamp(String(value));
  }
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    // FileMaker uses MM/DD/YYYY HH:MM:SS - Date.parse usually handles it; fallback to Date constructor
    const fallback = new Date(trimmed.replace(/-/g, '/'));
    const ts = fallback.getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }
  return parsed;
}

app.post('/api/stream-events', async (req, res) => {
  try {
    // Debug: Check if access token is available
    if (STREAM_EVENT_DEBUG) {
      console.log('[MASS] Stream event - Access Token:', req.accessToken?.code || 'NO TOKEN');
    }

    const {
      eventType = '',
      trackRecordId = '',
      trackISRC = '',
      positionSec = 0,
      durationSec = 0,
      deltaSec = 0
    } = req.body || {};

    const normalizedType = String(eventType || '').trim().toUpperCase();
    if (!STREAM_EVENT_TYPES.has(normalizedType)) {
      res.status(400).json({ ok: false, error: 'Invalid eventType' });
      return;
    }

    const headersSessionRaw = req.get?.('X-Session-ID') || req.headers?.['x-session-id'];
    let sessionId = Array.isArray(headersSessionRaw) ? headersSessionRaw[0] : headersSessionRaw;
    if (typeof sessionId === 'string') {
      sessionId = sessionId.trim();
    }

    const cookies = parseCookies(req);
    if (!sessionId) {
      sessionId = cookies[MASS_SESSION_COOKIE] || '';
    }

    // Validate session ID format (security - prevent session fixation)
    const validatedSession = validateSessionId(sessionId);
    if (!validatedSession) {
      // Invalid or missing session ID - generate new one
      sessionId = randomUUID();
      if (STREAM_EVENT_DEBUG && cookies[MASS_SESSION_COOKIE]) {
        console.log(`[SECURITY] Invalid session ID rejected, generating new one`);
      }
    } else {
      sessionId = validatedSession;
    }

    if (!cookies[MASS_SESSION_COOKIE] || cookies[MASS_SESSION_COOKIE] !== sessionId) {
      const cookieParts = [
        `${MASS_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
        'Path=/',
        `Max-Age=${MASS_SESSION_MAX_AGE_SECONDS}`,
        'SameSite=Lax'
      ];
      res.setHeader('Set-Cookie', cookieParts.join('; '));
    }

    const timestamp = formatTimestampUTC();
    const clientIP = getClientIP(req);
    const asn = await lookupASN(clientIP);
    const userAgentHeader = req.headers?.['user-agent'];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader || '';

    const normalizedTrackRecordId = toCleanString(trackRecordId);
    if (!normalizedTrackRecordId) {
      res.status(400).json({ ok: false, error: 'trackRecordId is required' });
      return;
    }

    const normalizedTrackISRC = toCleanString(trackISRC);

    const normalizedPosition = normalizeSeconds(positionSec);
    const normalizedDuration = normalizeSeconds(durationSec);
    const payloadDelta = normalizeSeconds(deltaSec);
    const baseFields = {
      TimestampUTC: timestamp,
      EventType: normalizedType,
      TrackRecordID: normalizedTrackRecordId,
      TrackISRC: normalizedTrackISRC,
      [STREAM_TIME_FIELD]: normalizedPosition,
      DurationSec: normalizedDuration,
      DeltaSec: payloadDelta,
      SessionID: sessionId,
      ClientIP: clientIP,
      ASN: asn || 'Unknown',
      UserAgent: userAgent,
      Token_Number: req.accessToken?.code || ''
    };

    const primaryKey = randomUUID();
    const createFields = {
      PrimaryKey: primaryKey,
      SessionID: sessionId,
      TrackRecordID: normalizedTrackRecordId,
      TrackISRC: normalizedTrackISRC,
      TimestampUTC: timestamp,
      EventType: normalizedType,
      [STREAM_TIME_FIELD]: normalizedPosition,
      DurationSec: normalizedDuration,
      DeltaSec: payloadDelta,
      ClientIP: clientIP,
      ASN: asn || 'Unknown',
      UserAgent: userAgent,
      TotalPlayedSec: payloadDelta,
      PlayStartUTC: normalizedType === 'PLAY' ? timestamp : '',
      LastEventUTC: timestamp,
      Token_Number: req.accessToken?.code || ''
    };

    if (STREAM_EVENT_DEBUG) {
      console.info('[MASS] stream event logging', {
        eventType: baseFields.EventType,
        sessionId,
        trackRecordId: normalizedTrackRecordId,
        timeStreamed: baseFields[STREAM_TIME_FIELD],
        deltaSec: baseFields.DeltaSec,
        tokenNumber: baseFields.Token_Number
      });
    }

    const forceNewRecord = normalizedType === 'PLAY';
    const ensureResult = await ensureStreamRecord(sessionId, normalizedTrackRecordId, createFields, { forceNew: forceNewRecord });
    const existingFields = ensureResult.existingFieldData || {};

    const existingPositionValue = existingFields
      ? existingFields[STREAM_TIME_FIELD] ?? existingFields[STREAM_TIME_FIELD_LEGACY]
      : null;
    const existingPosition = normalizeSeconds(existingPositionValue);
    const deltaFromPosition = Math.max(0, baseFields[STREAM_TIME_FIELD] - existingPosition);
    if (existingPosition > baseFields[STREAM_TIME_FIELD]) {
      baseFields[STREAM_TIME_FIELD] = existingPosition;
    }
    const existingDuration = normalizeSeconds(existingFields.DurationSec);
    if (existingDuration && !baseFields.DurationSec) {
      baseFields.DurationSec = existingDuration;
    }
    if (!baseFields.TrackISRC && existingFields.TrackISRC) {
      baseFields.TrackISRC = existingFields.TrackISRC;
    }

    const existingTotalPlayed = normalizeSeconds(existingFields.TotalPlayedSec);
    const effectiveDelta = payloadDelta || deltaFromPosition;
    baseFields.DeltaSec = effectiveDelta;
    baseFields.TotalPlayedSec = existingTotalPlayed + effectiveDelta;
    baseFields.LastEventUTC = timestamp;
    if (!existingFields.PlayStartUTC && normalizedType === 'PLAY') {
      baseFields.PlayStartUTC = timestamp;
    }

    // Ensure DurationSec reflects track length when provided at END.
    if (normalizedType === 'END' && normalizedDuration && normalizedDuration > baseFields.DurationSec) {
      baseFields.DurationSec = normalizedDuration;
    }

    if (STREAM_EVENT_DEBUG) {
      console.info('[MASS] Updating FileMaker record with Token_Number:', baseFields.Token_Number);
    }

    let fmResponse = await fmUpdateRecord(FM_STREAM_EVENTS_LAYOUT, ensureResult.recordId, baseFields);

    if (STREAM_EVENT_DEBUG) {
      console.info('[MASS] stream event persisted', {
        eventType: baseFields.EventType,
        sessionId,
        trackRecordId: normalizedTrackRecordId,
        recordId: ensureResult.recordId,
        totalPlayedSec: baseFields.TotalPlayedSec,
        timeStreamed: baseFields[STREAM_TIME_FIELD]
      });
    }

    if (STREAM_TERMINAL_EVENTS.has(normalizedType)) {
      clearCachedStreamRecordId(sessionId, normalizedTrackRecordId);
    } else {
      setCachedStreamRecordId(sessionId, normalizedTrackRecordId, ensureResult.recordId);
    }

    res.json({ ok: true, recordId: ensureResult.recordId, totalPlayedSec: baseFields.TotalPlayedSec });
  } catch (err) {
    console.error('[MASS] stream event failed', err);
    const errorMessage = err?.message || 'Stream event logging failed';
    res.status(500).json({ ok: false, error: errorMessage });
  }
});

async function collectTrendingStats({ limit, lookbackHours, fetchLimit }) {
  const normalizedLimit = Math.max(1, limit || 5);
  const cutoffDate = lookbackHours && lookbackHours > 0
    ? new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
    : null;
  const baseQuery = { TrackRecordID: '*' };
  if (cutoffDate) {
    baseQuery.LastEventUTC = `>=${formatTimestampUTC(cutoffDate)}`;
  }

  const findResult = await fmFindRecords(
    FM_STREAM_EVENTS_LAYOUT,
    [baseQuery],
    {
      limit: fetchLimit,
      offset: 1,
      sort: [
        { fieldName: 'TimestampUTC', sortOrder: 'descend' }
      ]
    }
  );

  if (!findResult.ok) {
    const detail = `${findResult.msg || 'FM error'}${findResult.code ? ` (FM ${findResult.code})` : ''}`;
    throw new Error(`Trending stream query failed: ${detail}`);
  }

  const statsByTrack = new Map();
  for (const entry of findResult.data) {
    const fields = entry?.fieldData || {};
    const trackRecordId = normalizeRecordId(fields.TrackRecordID || fields['Track Record ID'] || '');
    if (!trackRecordId) continue;
    const totalSeconds = normalizeSeconds(
      fields.TotalPlayedSec ??
      fields[STREAM_TIME_FIELD] ??
      fields.DurationSec ??
      fields.DeltaSec ??
      0
    );
    const lastEventTs = parseFileMakerTimestamp(fields.LastEventUTC || fields.TimestampUTC);
    const sessionId = toCleanString(fields.SessionID || fields['Session ID'] || '');
    if (!statsByTrack.has(trackRecordId)) {
      statsByTrack.set(trackRecordId, {
        trackRecordId,
        totalSeconds: 0,
        playCount: 0,
        sessionIds: new Set(),
        lastEvent: 0
      });
    }
    const stat = statsByTrack.get(trackRecordId);
    stat.totalSeconds += totalSeconds || 0;
    stat.playCount += 1;
    if (sessionId) stat.sessionIds.add(sessionId);
    if (lastEventTs > stat.lastEvent) {
      stat.lastEvent = lastEventTs;
    }
  }

  if (!statsByTrack.size) {
    return [];
  }

  const sortedStats = Array.from(statsByTrack.values()).sort((a, b) => {
    if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
    if (b.playCount !== a.playCount) return b.playCount - a.playCount;
    return b.lastEvent - a.lastEvent;
  });

  const results = [];
  for (const stat of sortedStats) {
    const record = await fmGetRecordById(FM_LAYOUT, stat.trackRecordId);
    if (!record) continue;
    const fields = record.fieldData || {};
    if (!recordIsVisible(fields)) continue;
    if (!hasValidAudio(fields)) continue;
    results.push({
      recordId: record.recordId || stat.trackRecordId,
      modId: record.modId || '0',
      fields,
      metrics: {
        plays: stat.playCount,
        uniqueListeners: stat.sessionIds.size || 0,
        lastPlayedAt: stat.lastEvent ? new Date(stat.lastEvent).toISOString() : null
      }
    });
    if (results.length >= normalizedLimit) break;
  }

  return results;
}

async function fetchTrendingTracks(limit = 5) {
  const normalizedLimit = Math.max(1, Math.min(TRENDING_MAX_LIMIT, limit || 5));
  const baseFetchLimit = Math.min(2000, Math.max(normalizedLimit * 80, TRENDING_FETCH_LIMIT));
  const attempts = [];
  if (TRENDING_LOOKBACK_HOURS > 0) {
    attempts.push({
      lookbackHours: TRENDING_LOOKBACK_HOURS,
      fetchLimit: baseFetchLimit
    });
  }
  attempts.push({
    lookbackHours: 0,
    fetchLimit: Math.min(2000, baseFetchLimit * 2)
  });

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    try {
      const items = await collectTrendingStats({
        limit: normalizedLimit,
        lookbackHours: attempt.lookbackHours,
        fetchLimit: attempt.fetchLimit
      });
      if (items.length || i === attempts.length - 1) {
        return items.slice(0, normalizedLimit);
      }
    } catch (err) {
      if (i === attempts.length - 1) throw err;
      console.warn('[TRENDING] Attempt failed (will retry with fallback):', err?.message || err);
    }
  }
  return [];
}

async function requireUser(req, res) {
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return null;
  }
  return user;
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const passwordRaw = req.body?.password;
    const emailCheck = validateEmail(emailRaw);
    if (!emailCheck.ok) {
      res.status(400).json({ ok: false, error: emailCheck.reason });
      return;
    }
    const passwordCheck = validatePassword(passwordRaw);
    if (!passwordCheck.ok) {
      res.status(400).json({ ok: false, error: passwordCheck.reason });
      return;
    }

    const existing = await findUserByEmail(emailCheck.email);
    if (existing) {
      res.status(409).json({ ok: false, error: 'Account already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(passwordRaw, 12);
    const user = await createUserRecord(emailCheck.email, passwordHash);
    if (!user.recordId) {
      throw new Error('FileMaker returned no recordId');
    }

    const token = issueToken({ sub: user.recordId, email: user.email });
    setAuthCookie(res, token);
    res.status(201).json({ ok: true, user: { email: user.email } });
  } catch (err) {
    console.error('[MASS] Registration failed:', err);
    res.status(500).json({ ok: false, error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const passwordRaw = req.body?.password;
    const emailCheck = validateEmail(emailRaw);
    if (!emailCheck.ok) {
      res.status(400).json({ ok: false, error: emailCheck.reason });
      return;
    }
    const passwordCheck = validatePassword(passwordRaw);
    if (!passwordCheck.ok) {
      res.status(400).json({ ok: false, error: passwordCheck.reason });
      return;
    }

    const user = await findUserByEmail(emailCheck.email);
    if (!user?.passwordHash) {
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }

    const match = await bcrypt.compare(passwordRaw, user.passwordHash);
    if (!match) {
      res.status(401).json({ ok: false, error: 'Invalid credentials' });
      return;
    }

    const token = issueToken({ sub: user.recordId, email: user.email });
    setAuthCookie(res, token);
    res.json({ ok: true, user: { email: user.email } });
  } catch (err) {
    console.error('[MASS] Login failed:', err);
    res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    res.json({ ok: true, user: user ? { email: user.email } : null });
  } catch (err) {
    console.error('[MASS] Session check failed:', err);
    res.status(500).json({ ok: false, error: 'Session check failed' });
  }
});

// ========= ACCESS TOKEN ENDPOINTS =========

console.log('[MASS] Registering access token validation endpoint');
app.post('/api/access/validate', async (req, res) => {
  console.log('[MASS] /api/access/validate route hit');
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        ok: false,
        valid: false,
        error: 'Token is required'
      });
    }

    const result = await validateAccessToken(token);

    if (result.valid) {
      res.json({
        ok: true,
        valid: true,
        type: result.type,
        expirationDate: result.expirationDate,
        message: result.message || 'Token is valid'
      });
    } else {
      res.status(401).json({
        ok: false,
        valid: false,
        reason: result.reason,
        expirationDate: result.expirationDate
      });
    }
  } catch (err) {
    console.error('[MASS] Token validation failed:', err);
    res.status(500).json({ ok: false, valid: false, error: 'Token validation failed' });
  }
});

app.get('/api/playlists', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const playlists = await loadPlaylists();
    const mine = playlists.filter((p) => p && playlistOwnerMatches(p.userId, userRecordId));
    res.json({ ok: true, playlists: mine });
  } catch (err) {
    console.error('[MASS] Fetch playlists failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load playlists' });
  }
});

app.post('/api/playlists', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const nameRaw = req.body?.name;

    // Validate playlist name (prevent XSS and enforce limits)
    if (!nameRaw) {
      res.status(400).json({ ok: false, error: 'Playlist name required' });
      return;
    }
    const nameValidation = validators.playlistName(nameRaw);
    if (!nameValidation.valid) {
      res.status(400).json({ ok: false, error: nameValidation.error });
      return;
    }
    const name = nameValidation.value;

    const now = new Date().toISOString();
    const playlists = await loadPlaylists();
    const collision = playlists.find(
      (p) => p && playlistOwnerMatches(p.userId, userRecordId) && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase()
    );
    if (collision) {
      res.status(409).json({ ok: false, error: 'You already have a playlist with that name', playlist: collision });
      return;
    }

    const playlist = {
      id: randomUUID(),
      userId: userRecordId,
      name,
      tracks: [],
      createdAt: now,
      updatedAt: now
    };

    playlists.push(playlist);
    await savePlaylists(playlists);

    res.status(201).json({ ok: true, playlist });
  } catch (err) {
    console.error('[MASS] Create playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to create playlist' });
  }
});

app.post('/api/playlists/:playlistId/tracks', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const playlistId = req.params?.playlistId;
    if (!playlistId) {
      res.status(400).json({ ok: false, error: 'Playlist ID required' });
      return;
    }

    const trackPayload = normalizeTrackPayload(req.body?.track || {});

    if (!trackPayload.name) {
      res.status(400).json({ ok: false, error: 'Track name required' });
      return;
    }

    const playlists = await loadPlaylists();
    const index = playlists.findIndex((p) => p && p.id === playlistId && playlistOwnerMatches(p.userId, userRecordId));
    if (index === -1) {
      res.status(404).json({ ok: false, error: 'Playlist not found' });
      return;
    }

    const playlist = playlists[index];
    playlist.tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];

    const duplicateIndex = buildPlaylistDuplicateIndex(playlist);
    const { entry: duplicate } = resolveDuplicate(duplicateIndex, trackPayload);
    if (duplicate) {
      res.status(200).json({ ok: true, playlist, track: duplicate, duplicate: true });
      return;
    }

    const addedAt = new Date().toISOString();
    const entry = buildTrackEntry(trackPayload, addedAt);

    playlist.tracks.push(entry);
    playlist.updatedAt = addedAt;

    playlists[index] = playlist;
    await savePlaylists(playlists);

    res.status(201).json({ ok: true, playlist, track: entry });
  } catch (err) {
    console.error('[MASS] Add track to playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to add track' });
  }
});

app.post('/api/playlists/:playlistId/tracks/bulk', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const playlistId = req.params?.playlistId;
    if (!playlistId) {
      res.status(400).json({ ok: false, error: 'Playlist ID required' });
      return;
    }

    const rawTracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
    if (!rawTracks.length) {
      res.status(400).json({ ok: false, error: 'At least one track required' });
      return;
    }

    const normalizedTracks = rawTracks.map((track) => normalizeTrackPayload(track || {}));
    const playlists = await loadPlaylists();
    const index = playlists.findIndex((p) => p && p.id === playlistId && playlistOwnerMatches(p.userId, userRecordId));
    if (index === -1) {
      res.status(404).json({ ok: false, error: 'Playlist not found' });
      return;
    }

    const playlist = playlists[index];
    playlist.tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];

    const duplicateIndex = buildPlaylistDuplicateIndex(playlist);

    const addedEntries = [];
    const duplicates = [];
    const skipped = [];
    const timestampBase = Date.now();

    for (const trackPayload of normalizedTracks) {
      if (!trackPayload.name) {
        skipped.push({ ...summarizeTrackPayload(trackPayload), reason: 'invalid_name' });
        continue;
      }

      const { key, entry: duplicate } = resolveDuplicate(duplicateIndex, trackPayload);
      if (duplicate) {
        duplicates.push({ ...summarizeTrackPayload(trackPayload), reason: 'already_exists' });
        continue;
      }

      const addedAt = new Date(timestampBase + addedEntries.length).toISOString();
      const entry = buildTrackEntry(trackPayload, addedAt);
      playlist.tracks.push(entry);
      addedEntries.push(entry);
      if (key) duplicateIndex.set(key, entry);
    }

    if (addedEntries.length) {
      playlist.updatedAt = addedEntries[addedEntries.length - 1].addedAt;
      playlists[index] = playlist;
      await savePlaylists(playlists);
    }

    const status = addedEntries.length ? 201 : 200;
    res.status(status).json({
      ok: true,
      playlist,
      addedCount: addedEntries.length,
      duplicateCount: duplicates.length,
      skippedCount: skipped.length,
      added: addedEntries,
      duplicates,
      skipped
    });
  } catch (err) {
    console.error('[MASS] Bulk add tracks to playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to add tracks' });
  }
});

app.post('/api/playlists/:playlistId/share', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  let playlist = null;
  let shareId = '';

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const playlistId = req.params?.playlistId;
    if (!playlistId) {
      res.status(400).json({ ok: false, error: 'Playlist ID required' });
      return;
    }

    const playlists = await loadPlaylists();
    const index = playlists.findIndex((p) => p && p.id === playlistId && playlistOwnerMatches(p.userId, userRecordId));
    if (index === -1) {
      res.status(404).json({ ok: false, error: 'Playlist not found' });
      return;
    }

    playlist = playlists[index];
    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    if (!tracks.length) {
      res.status(400).json({ ok: false, error: 'Add at least one track before sharing a playlist' });
      return;
    }

    const regenerate = req.body?.regenerate === true;
    const existingIds = new Set();
    playlists.forEach((entry, idx) => {
      if (!entry || idx === index) return;
      const existing = normalizeShareId(entry.shareId);
      if (existing) existingIds.add(existing);
    });

    shareId = normalizeShareId(playlist.shareId);
    const needsNewId = regenerate || !shareId || existingIds.has(shareId);
    if (needsNewId) {
      let candidate = '';
      let attempts = 0;
      do {
        candidate = generateShareId();
        attempts += 1;
      } while (existingIds.has(candidate) && attempts < 50);
      if (existingIds.has(candidate)) {
        res.status(500).json({ ok: false, error: 'Unable to generate a unique share link' });
        return;
      }
      shareId = candidate;
      playlist.shareId = shareId;
      playlist.sharedAt = new Date().toISOString();
    } else if (!playlist.sharedAt) {
      playlist.sharedAt = new Date().toISOString();
    }

    playlists[index] = playlist;
    await savePlaylists(playlists);

    const payload = sanitizePlaylistForShare(playlist);
    const shareUrl = buildShareUrl(req, shareId);

    res.json({ ok: true, shareId, shareUrl, playlist: payload });
  } catch (err) {
    console.error('[MASS] Generate playlist share link failed:', err);
    const detail = err?.message || err?.code || String(err);
    const fallbackId = normalizeShareId(shareId || playlist?.shareId);
    if (fallbackId && playlist) {
      try {
        const payload = sanitizePlaylistForShare(playlist);
        const shareUrl = buildShareUrl(req, fallbackId);
        res.json({ ok: true, shareId: fallbackId, shareUrl, playlist: payload, reused: true, error: 'Existing share link reused' });
        return;
      } catch (fallbackErr) {
        console.error('[MASS] Fallback share link serialization failed:', fallbackErr);
      }
    }
    res.status(500).json({ ok: false, error: 'Unable to generate share link', detail });
  }
});

// Export playlist as compact code
app.get('/api/playlists/:playlistId/export', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const playlistId = req.params?.playlistId;

    if (!playlistId) {
      return res.status(400).json({ ok: false, error: 'Playlist ID required' });
    }

    const playlists = await loadPlaylists();
    const playlist = playlists.find((p) => p && p.id === playlistId && playlistOwnerMatches(p.userId, userRecordId));

    if (!playlist) {
      return res.status(404).json({ ok: false, error: 'Playlist not found' });
    }

    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    if (!tracks.length) {
      return res.status(400).json({ ok: false, error: 'Playlist is empty' });
    }

    // Extract track IDs
    const trackIds = tracks.map(t => t.trackRecordId).filter(Boolean);
    console.log(`[MASS] Export: Extracted ${trackIds.length} track IDs from playlist "${playlist.name}"`);
    console.log(`[MASS] Export: Sample IDs:`, trackIds.slice(0, 3));

    // Create export data
    const exportData = {
      name: playlist.name,
      tracks: trackIds,
      exported: new Date().toISOString()
    };

    // Generate compact code (MASS:base64json)
    const jsonStr = JSON.stringify(exportData);
    const base64 = Buffer.from(jsonStr, 'utf-8').toString('base64');
    const compactCode = `MASS:${base64}`;
    console.log(`[MASS] Export: Generated code of length ${compactCode.length}`);

    res.json({
      ok: true,
      code: compactCode,
      json: exportData,
      trackCount: trackIds.length
    });
  } catch (err) {
    console.error('[MASS] Export playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to export playlist', detail: err?.message });
  }
});

// Import playlist from compact code or track IDs
app.post('/api/playlists/import', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const { name, code, trackIds } = req.body;

    let playlistName = '';
    let importedTrackIds = [];

    // Parse compact code (MASS:base64json) or direct track IDs
    if (code && typeof code === 'string') {
      const trimmed = code.trim();

      // Check for MASS: prefix
      if (trimmed.startsWith('MASS:')) {
        const base64Part = trimmed.substring(5);
        try {
          const jsonStr = Buffer.from(base64Part, 'base64').toString('utf-8');
          const data = JSON.parse(jsonStr);
          playlistName = data.name || 'Imported Playlist';
          importedTrackIds = Array.isArray(data.tracks) ? data.tracks : [];
        } catch (parseErr) {
          return res.status(400).json({ ok: false, error: 'Invalid import code format' });
        }
      } else {
        // Try parsing as plain JSON
        try {
          const data = JSON.parse(trimmed);
          playlistName = data.name || 'Imported Playlist';
          importedTrackIds = Array.isArray(data.tracks) ? data.tracks : [];
        } catch {
          return res.status(400).json({ ok: false, error: 'Invalid import code format' });
        }
      }
    } else if (Array.isArray(trackIds)) {
      // Direct track IDs provided
      importedTrackIds = trackIds;
      playlistName = typeof name === 'string' && name.trim() ? name.trim() : 'Imported Playlist';
    } else {
      return res.status(400).json({ ok: false, error: 'Provide either code or trackIds' });
    }

    if (!importedTrackIds.length) {
      return res.status(400).json({ ok: false, error: 'No tracks found in import data' });
    }

    // Validate track IDs exist in FileMaker (fetch minimal data)
    console.log(`[MASS] Import: Validating ${importedTrackIds.length} track IDs`);
    const validTrackIds = [];
    const failedIds = [];
    for (const trackId of importedTrackIds.slice(0, 100)) { // Limit to 100 tracks
      try {
        const record = await fmGetRecordById(FM_LAYOUT, trackId);
        if (record) {
          console.log(`[MASS] Import: ✓ Found track ID: ${trackId}`);
          validTrackIds.push(trackId);
        } else {
          console.log(`[MASS] Import: ✗ Track ID not found: ${trackId}`);
          failedIds.push(trackId);
        }
      } catch (err) {
        console.error(`[MASS] Import: ✗ Error fetching track ${trackId}:`, err.message);
        failedIds.push(trackId);
      }
    }

    console.log(`[MASS] Import: Valid IDs: ${validTrackIds.length}, Failed IDs: ${failedIds.length}`);
    if (failedIds.length > 0) {
      console.log(`[MASS] Import: Failed ID samples:`, failedIds.slice(0, 5));
    }

    if (!validTrackIds.length) {
      return res.status(400).json({
        ok: false,
        error: 'None of the imported tracks were found',
        detail: `Tried ${importedTrackIds.length} track IDs, none found in FileMaker`
      });
    }

    // Create new playlist
    const now = new Date().toISOString();
    const playlists = await loadPlaylists();
    const newPlaylist = {
      id: randomUUID(),
      userId: userRecordId,
      name: playlistName,
      tracks: [], // Will be populated below
      createdAt: now,
      updatedAt: now
    };

    // Fetch full track data for valid IDs
    for (const trackId of validTrackIds) {
      try {
        const record = await fmGetRecordById(FM_LAYOUT, trackId);

        if (record) {
          const fields = record.fieldData || {};

          // Build track object
          const trackObj = {
            trackRecordId: trackId,
            name: fields['Track Name'] || fields['Tape Files::Track Name'] || 'Unknown Track',
            albumTitle: fields['Album'] || fields['Tape Files::Album'] || '',
            albumArtist: fields['Album Artist'] || fields['Artist'] || fields['Tape Files::Album Artist'] || '',
            trackArtist: fields['Track Artist'] || fields['Album Artist'] || '',
            catalogue: fields['Catalogue #'] || fields['Catalogue'] || '',
            addedAt: now
          };

          // Find audio and artwork fields
          const audioField = AUDIO_FIELD_CANDIDATES.find(f => fields[f]);
          const artworkField = ARTWORK_FIELD_CANDIDATES.find(f => fields[f]);

          if (audioField) {
            trackObj.mp3 = fields[audioField];
            trackObj.audioField = audioField;
          }
          if (artworkField) {
            trackObj.artwork = fields[artworkField];
            trackObj.artworkField = artworkField;
          }

          newPlaylist.tracks.push(trackObj);
        }
      } catch (err) {
        console.error(`[MASS] Failed to fetch track ${trackId}:`, err);
      }
    }

    playlists.push(newPlaylist);
    await savePlaylists(playlists);

    res.json({
      ok: true,
      playlist: newPlaylist,
      imported: newPlaylist.tracks.length,
      skipped: importedTrackIds.length - newPlaylist.tracks.length
    });
  } catch (err) {
    console.error('[MASS] Import playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to import playlist', detail: err?.message });
  }
});

app.get('/api/shared-playlists/:shareId', async (req, res) => {
  try {
    const shareId = normalizeShareId(req.params?.shareId);
    if (!shareId) {
      res.status(400).json({ ok: false, error: 'Share ID required' });
      return;
    }

    const playlists = await loadPlaylists();
    const playlist = playlists.find((p) => p && normalizeShareId(p.shareId) === shareId);
    if (!playlist) {
      res.status(404).json({ ok: false, error: 'Playlist not found' });
      return;
    }

    const payload = sanitizePlaylistForShare(playlist);
    const shareUrl = buildShareUrl(req, shareId);

    res.json({ ok: true, playlist: payload, shareUrl });
  } catch (err) {
    console.error('[MASS] Fetch shared playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Unable to load playlist' });
  }
});

app.delete('/api/playlists/:playlistId/tracks/:addedAt', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const playlistId = req.params?.playlistId;
    const addedAt = req.params?.addedAt;

    if (!playlistId) {
      res.status(400).json({ ok: false, error: 'Playlist ID required' });
      return;
    }
    if (!addedAt) {
      res.status(400).json({ ok: false, error: 'Track addedAt timestamp required' });
      return;
    }

    const playlists = await loadPlaylists();
    const playlistIndex = playlists.findIndex((p) => p && p.id === playlistId && playlistOwnerMatches(p.userId, userRecordId));
    if (playlistIndex === -1) {
      res.status(404).json({ ok: false, error: 'Playlist not found' });
      return;
    }

    const playlist = playlists[playlistIndex];
    playlist.tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];

    const trackIndex = playlist.tracks.findIndex((t) => t && t.addedAt === addedAt);
    if (trackIndex === -1) {
      res.status(404).json({ ok: false, error: 'Track not found in playlist' });
      return;
    }

    const [deletedTrack] = playlist.tracks.splice(trackIndex, 1);
    playlist.updatedAt = new Date().toISOString();

    playlists[playlistIndex] = playlist;
    await savePlaylists(playlists);

    res.json({ ok: true, playlist, track: deletedTrack });
  } catch (err) {
    console.error('[MASS] Delete track from playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete track from playlist' });
  }
});

app.delete('/api/playlists/:playlistId', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const userRecordId = normalizeRecordId(user.recordId);
    const playlistId = req.params?.playlistId;
    if (!playlistId) {
      res.status(400).json({ ok: false, error: 'Playlist ID required' });
      return;
    }

    const playlists = await loadPlaylists();
    const index = playlists.findIndex((p) => p && p.id === playlistId && playlistOwnerMatches(p.userId, userRecordId));
    if (index === -1) {
      res.status(404).json({ ok: false, error: 'Playlist not found' });
      return;
    }

    const [deleted] = playlists.splice(index, 1);
    await savePlaylists(playlists);

    res.json({ ok: true, playlist: deleted || null });
  } catch (err) {
    console.error('[MASS] Delete playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete playlist' });
  }
});

app.get('/api/track/:recordId/container', async (req, res) => {
  try {
    const recordId = (req.params?.recordId || '').toString().trim();
    if (!recordId) {
      res.status(400).json({ ok: false, error: 'Record ID required' });
      return;
    }

    const layout = (req.query?.layout || FM_LAYOUT || '').toString().trim() || FM_LAYOUT;
    const requestedField = (req.query?.field || '').toString().trim();
    const candidateParam = (req.query?.candidates || '').toString().trim();
    const candidates = candidateParam
      ? candidateParam.split(',').map((value) => value.trim()).filter(Boolean)
      : [];

    const record = await fmGetRecordById(layout, recordId);
    if (!record) {
      res.status(404).json({ ok: false, error: 'Record not found' });
      return;
    }

    const fieldData = record.fieldData || {};

    const getFieldValue = (fieldName) => {
      if (!fieldName) return '';
      if (!Object.prototype.hasOwnProperty.call(fieldData, fieldName)) return '';
      const raw = fieldData[fieldName];
      if (raw === undefined || raw === null) return '';
      const str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
      return str;
    };

    let chosenField = requestedField;
    let containerUrl = getFieldValue(chosenField);

    const tryCandidates = (list) => {
      for (const candidate of list) {
        const value = getFieldValue(candidate);
        if (value) {
          chosenField = candidate;
          containerUrl = value;
          return true;
        }
      }
      return false;
    };

    if (!containerUrl && candidates.length) {
      tryCandidates(candidates);
    }

    if (!containerUrl) {
      tryCandidates(DEFAULT_AUDIO_FIELDS);
    }

    if (!containerUrl) {
      res.status(404).json({ ok: false, error: 'Container data not found' });
      return;
    }

    res.json({ ok: true, url: containerUrl, field: chosenField || requestedField || '' });
  } catch (err) {
    console.error('[MASS] Container refresh failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to refresh container' });
  }
});

/* ========= Cache statistics ========= */
app.get('/api/cache/stats', (req, res) => {
  try {
    const stats = {
      search: searchCache.getStats(),
      explore: exploreCache.getStats(),
      album: albumCache.getStats(),
      publicPlaylists: publicPlaylistsCache.getStats(),
      timestamp: new Date().toISOString()
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve cache stats' });
  }
});

/* ========= Static site ========= */
// Note: express.static() moved to top of file (line ~206) for better performance
// Static files now bypass rate limiting and API middleware
// Default to MADMusic (modern-view) layout
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'modern-view.html')));
// Classic view available at /classic
app.get('/classic', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ========= Search ========= */
const SEARCH_FIELDS_BASE = ['Album Artist', 'Album Title', 'Track Name'];
const SEARCH_FIELDS_OPTIONAL = [
  'Year of Release',
  'Local Genre',
  'Language Code',
  'Track Artist',
  'Genre'
];
const SEARCH_FIELDS_DEFAULT = [...SEARCH_FIELDS_BASE, ...SEARCH_FIELDS_OPTIONAL];

const ARTIST_FIELDS_BASE = ['Album Artist'];
const ARTIST_FIELDS_OPTIONAL = ['Track Artist'];
const ALBUM_FIELDS_BASE = ['Album Title'];
const ALBUM_FIELDS_OPTIONAL = [];
const TRACK_FIELDS_BASE = ['Track Name'];
const TRACK_FIELDS_OPTIONAL = [];

const TARGET_ARTIST_FIELDS = ['Track Artist'];
const TARGET_ALBUM_FIELDS = ['Album Title'];
const TARGET_TRACK_FIELDS = ['Track Name'];

const parseFieldList = (envKey, fallback) => {
  const raw = (process.env[envKey] || '').trim();
  if (!raw) return fallback;
  const parts = raw.split(/[,\|]/).map((value) => value.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
};

const AI_GENRE_FIELDS = parseFieldList('FM_GENRE_FIELDS', ['Local Genre', 'Genre']);
const SEARCH_GENRE_FIELDS = ['Local Genre', 'Genre'];
const AI_LANGUAGE_FIELDS = parseFieldList('FM_LANGUAGE_FIELDS', ['Language Code']);

const listSearchFields = (base, optional, includeOptional) =>
  includeOptional ? [...base, ...optional] : base;

function buildSearchQueries({ q, artist, album, track }, includeOptionalFields, fieldOverrides = {}) {
  const queries = [];

  const extend = (arr, make) => {
    const out = [];
    for (const base of arr) {
      const vs = make(base);
      if (Array.isArray(vs)) out.push(...vs);
      else out.push(vs);
    }
    return out;
  };

  let combos = [{}];
  const artistFields = Array.isArray(fieldOverrides.artist) && fieldOverrides.artist.length
    ? fieldOverrides.artist
    : listSearchFields(ARTIST_FIELDS_BASE, ARTIST_FIELDS_OPTIONAL, includeOptionalFields);
  const albumFields = Array.isArray(fieldOverrides.album) && fieldOverrides.album.length
    ? fieldOverrides.album
    : listSearchFields(ALBUM_FIELDS_BASE, ALBUM_FIELDS_OPTIONAL, includeOptionalFields);
  const trackFields = Array.isArray(fieldOverrides.track) && fieldOverrides.track.length
    ? fieldOverrides.track
    : listSearchFields(TRACK_FIELDS_BASE, TRACK_FIELDS_OPTIONAL, includeOptionalFields);

  if (artist) {
    combos = extend(combos, (b) =>
      artistFields.map((field) => ({
        ...b,
        [field]: begins(artist)
      }))
    );
  }
  if (album) {
    combos = extend(combos, (b) =>
      albumFields.map((field) => ({
        ...b,
        [field]: begins(album)
      }))
    );
  }
  if (track) {
    combos = extend(combos, (b) =>
      trackFields.map((field) => ({
        ...b,
        [field]: begins(track)
      }))
    );
  }

  if (artist || album || track) {
    return combos;
  }

  if (q) {
    const fields = includeOptionalFields ? SEARCH_FIELDS_DEFAULT : SEARCH_FIELDS_BASE;
    return fields.map((field) => ({ [field]: begins(q) }));
  }

  return [{ 'Album Title': '*' }];
}

const begins = (s) => (s ? `${s}*` : '');
const contains = (s) => (s ? `*${s}*` : '');

function normalizeAiValue(value) {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (!str || str.toLowerCase() === 'null') return '';
  return str;
}

function prepareAiSearchPayload(rawCriteria = {}, userQuery = '') {
  const normalized = {
    artist: normalizeAiValue(rawCriteria.artist),
    album: normalizeAiValue(rawCriteria.album),
    track: normalizeAiValue(rawCriteria.track),
    genre: normalizeAiValue(rawCriteria.genre),
    year: normalizeAiValue(rawCriteria.year),
    language: normalizeAiValue(rawCriteria.language),
    keywords: normalizeAiValue(rawCriteria.keywords || rawCriteria.q || rawCriteria.text || rawCriteria.description)
  };

  const fallbackQuery = normalizeAiValue(userQuery);
  const queryText = normalized.keywords || fallbackQuery;
  normalized.queryText = queryText;
  normalized.usedFallbackQuery = !normalized.keywords && Boolean(queryText);

  const shouldUseGeneral = !normalized.artist && !normalized.album && !normalized.track;
  // If we have extracted criteria (genre/year/language), don't use queryText in base search
  // This prevents "1960 jazz" from searching for titles containing "1960 jazz"
  // Instead, we'll just filter by the extracted criteria
  const hasExtractedCriteria = normalized.genre || normalized.year || normalized.language;
  const useQueryText = shouldUseGeneral && !hasExtractedCriteria;

  const baseQueries = buildSearchQueries({
    artist: normalized.artist,
    album: normalized.album,
    track: normalized.track,
    q: useQueryText ? queryText : ''
  }, true);

  let finalQueries = baseQueries.length ? baseQueries : [{ 'Album Title': '*' }];

  if (normalized.genre && AI_GENRE_FIELDS.length) {
    const genreQueries = [];
    finalQueries.forEach((q) => {
      AI_GENRE_FIELDS.forEach((field) => {
        genreQueries.push({ ...q, [field]: `*${normalized.genre}*` });
      });
    });
    finalQueries = genreQueries;
  }

  if (normalized.year) {
    finalQueries = finalQueries.map((q) => ({ ...q, 'Year of Release': normalized.year }));
  }

  if (normalized.language && AI_LANGUAGE_FIELDS.length) {
    finalQueries = finalQueries.map((q) => {
      const base = { ...q };
      AI_LANGUAGE_FIELDS.forEach((field) => {
        base[field] = `*${normalized.language}*`;
      });
      return base;
    });
  }

  if (!finalQueries.length) {
    finalQueries = [{ 'Album Title': '*' }];
  }

  return { normalizedCriteria: normalized, finalQueries };
}

async function buildAiResponseFromCriteria(rawCriteria, userQuery, logLabel = '') {
  let payloadInfo = prepareAiSearchPayload(rawCriteria, userQuery);
  console.log(`[AI SEARCH] Structured criteria${logLabel}:`, payloadInfo.normalizedCriteria);
  console.log(`[AI SEARCH] FileMaker queries${logLabel}:`, JSON.stringify(payloadInfo.finalQueries, null, 2));

  let findPayload = {
    query: payloadInfo.finalQueries,
    limit: 100
  };

  let findResponse = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, findPayload);
  let findJson = await findResponse.json().catch(() => ({}));

  const maybeRetryWithoutOptionalFields = async () => {
    const code = findJson?.messages?.[0]?.code;
    const codeStr = code === undefined || code === null ? '' : String(code);
    if (codeStr === '102' && (payloadInfo.normalizedCriteria.genre || payloadInfo.normalizedCriteria.language)) {
      const sanitizedCriteria = {
        ...rawCriteria,
        genre: '',
        language: ''
      };
      payloadInfo = prepareAiSearchPayload(sanitizedCriteria, userQuery);
      console.warn('[AI SEARCH] Retrying without genre/language filters due to missing field (102)');
      findPayload = {
        query: payloadInfo.finalQueries,
        limit: 100
      };
      findResponse = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, findPayload);
      findJson = await findResponse.json().catch(() => ({}));
    }
  };

  const maybeFallbackToGeneralSearch = async () => {
    const code = findJson?.messages?.[0]?.code;
    const codeStr = code === undefined || code === null ? '' : String(code);
    if (codeStr !== '102') return false;
    const fallbackText = payloadInfo.normalizedCriteria.queryText || userQuery || '';
    if (!fallbackText) return false;
    console.warn('[AI SEARCH] Retrying with general text search due to missing field (102)');
    const fallbackQuery = buildSearchQueries({ q: fallbackText, artist: '', album: '', track: '' }, false);
    const fallbackPayload = {
      query: fallbackQuery,
      limit: 100,
      offset: 1
    };
    findResponse = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, fallbackPayload);
    findJson = await findResponse.json().catch(() => ({}));
    payloadInfo.normalizedCriteria = {
      ...payloadInfo.normalizedCriteria,
      fallbackMode: 'text',
      genre: '',
      language: ''
    };
    return findResponse.ok;
  };

  await maybeRetryWithoutOptionalFields();
  if (!findResponse.ok) {
    const fallbackWorked = await maybeFallbackToGeneralSearch();
    if (!fallbackWorked) {
      const msg = findJson?.messages?.[0]?.message || 'Find failed';
      const code = findJson?.messages?.[0]?.code;
      return {
        error: {
          status: 500,
          body: {
            error: 'FileMaker find failed',
            detail: `${msg} (${code})`,
            criteria: payloadInfo.normalizedCriteria
          }
        }
      };
    }
  }

  const rawData = findJson?.response?.data || [];
  const validRecords = rawData.filter((record) => {
    const fields = record.fieldData || {};
    return hasValidAudio(fields) && hasValidArtwork(fields);
  });

  return {
    payload: {
      items: validRecords.map((d) => ({
        recordId: d.recordId,
        modId: d.modId,
        fields: d.fieldData || {}
      })),
      total: findJson?.response?.dataInfo?.foundCount || validRecords.length,
      aiInterpretation: payloadInfo.normalizedCriteria,
      query: userQuery
    }
  };
}

/* ========= Wake/Health endpoint ========= */
app.get('/api/wake', async (req, res) => {
  try {
    // Warm up the FileMaker connection by ensuring token is valid
    await ensureToken();
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      tokenValid: !!fmToken
    });
  } catch (err) {
    console.error('[MASS] Wake endpoint error:', err);
    res.status(500).json({
      status: 'error',
      error: err.message
    });
  }
});

// Update the version to bust cached search responses when the shape changes
const SEARCH_CACHE_VERSION = 'genre-one-per-album-v1';

app.get('/api/search', async (req, res) => {
  try {
    // Validate search inputs (prevent injection)
    const validationErrors = {};
    if (req.query.q && req.query.q !== '') {
      const qResult = validators.searchQuery(req.query.q);
      if (!qResult.valid) validationErrors.q = qResult.error;
    }
    if (req.query.artist && req.query.artist !== '') {
      const artistResult = validators.searchQuery(req.query.artist);
      if (!artistResult.valid) validationErrors.artist = artistResult.error;
    }
    if (req.query.album && req.query.album !== '') {
      const albumResult = validators.searchQuery(req.query.album);
      if (!albumResult.valid) validationErrors.album = albumResult.error;
    }
    if (req.query.track && req.query.track !== '') {
      const trackResult = validators.searchQuery(req.query.track);
      if (!trackResult.valid) validationErrors.track = trackResult.error;
    }
    if (req.query.limit) {
      const limitResult = validators.limit(req.query.limit, 500);
      if (!limitResult.valid) validationErrors.limit = limitResult.error;
    }
    if (req.query.offset) {
      const offsetResult = validators.offset(req.query.offset);
      if (!offsetResult.valid) validationErrors.offset = offsetResult.error;
    }
    const q = (req.query.q || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const album = (req.query.album || '').toString().trim();
    const track = (req.query.track || '').toString().trim();
    const limit = Math.max(1, Math.min(10, parseInt(req.query.limit || '10', 10)));
    const uiOff0 = Math.max(0, parseInt(req.query.offset || '0', 10));
    const fmOff = uiOff0 + 1;

    const rawGenreInput = req.query.genre;
    const genreFragments = [];
    if (Array.isArray(rawGenreInput)) {
      rawGenreInput.forEach((value) => {
        if (value === undefined || value === null) return;
        String(value)
          .split(/[,\|]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => genreFragments.push(part));
      });
    } else if (rawGenreInput !== undefined && rawGenreInput !== null) {
      String(rawGenreInput)
        .split(/[,\|]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => genreFragments.push(part));
    }

    const MAX_GENRE_FILTERS = 5;
    const genreFilters = [];
    const normalizedGenreKeys = new Set();
    for (const fragment of genreFragments) {
      if (genreFilters.length >= MAX_GENRE_FILTERS) break;
      const validation = validators.searchQuery(fragment);
      if (!validation.valid) {
        validationErrors.genre = validation.error;
        break;
      }
      const normalizedKey = validation.value.toLowerCase();
      if (normalizedGenreKeys.has(normalizedKey)) continue;
      normalizedGenreKeys.add(normalizedKey);
      genreFilters.push(validation.value);
    }

    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json({ error: 'Invalid input', details: validationErrors });
    }

    const genreCacheKey = genreFilters.length
      ? genreFilters.map((g) => g.toLowerCase()).sort().join('|')
      : '';

    if (genreFilters.length) {
      console.log('[SEARCH] Genre filters:', genreFilters.join(', '));
    }

    // Check cache
    const cacheKey = `search:${SEARCH_CACHE_VERSION}:${q}:${artist}:${album}:${track}:${limit}:${uiOff0}:${genreCacheKey}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] search: ${cacheKey.slice(0, 50)}...`);
      res.setHeader('X-Cache-Hit', 'true');
      return res.json(cached);
    }

    const applyGenreFiltersToQueries = (queries, candidateFields = SEARCH_GENRE_FIELDS) => {
      if (!genreFilters.length) return queries;
      const fields = Array.isArray(candidateFields) ? candidateFields.filter(Boolean) : [];
      if (!fields.length) return queries;
      const augmented = [];
      for (const baseQuery of queries) {
        for (const genreValue of genreFilters) {
          const pattern = `*${genreValue}*`;
          fields.forEach((field) => {
            augmented.push({
              ...baseQuery,
              [field]: pattern
            });
          });
        }
      }
      return augmented.length ? augmented : queries;
    };

    const makePayload = (
      includeOptionalFields,
      overrides,
      genreFields = SEARCH_GENRE_FIELDS,
      customOffset,
      customLimit
    ) => {
      const baseQueries = buildSearchQueries({ q, artist, album, track }, includeOptionalFields, overrides);
      const queryWithGenres = applyGenreFiltersToQueries(baseQueries, genreFields);
      return {
        query: queryWithGenres,
        limit: typeof customLimit === 'number' ? customLimit : limit,
        offset: typeof customOffset === 'number' ? customOffset : fmOff
      };
    };

    const runSearch = async (includeOptionalFields, overrides, customOffset, customLimit) => {
      const genreFieldCandidates = SEARCH_GENRE_FIELDS.filter(Boolean);
      let activeGenreFields = genreFieldCandidates.slice();

      while (true) {
        const payload = makePayload(
          includeOptionalFields,
          overrides,
          activeGenreFields,
          customOffset,
          customLimit
        );
        const response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
        const json = await response.json().catch(() => ({}));

        if (!genreFilters.length) {
          return { response, json };
        }

        const code = json?.messages?.[0]?.code;
        const codeStr = code === undefined || code === null ? '' : String(code);

        if (codeStr === '102' && activeGenreFields.length > 1) {
          const removedField = activeGenreFields.pop();
          console.warn(`[SEARCH] Genre field "${removedField}" missing (102); retrying with remaining fields`);
          continue;
        }

        return { response, json };
      }
    };

    const hasOnlyArtist = Boolean(artist) && !album && !track && !q;
    const hasOnlyAlbum = Boolean(album) && !artist && !track && !q;
    const hasOnlyTrack = Boolean(track) && !artist && !album && !q;

    const targetedOverrides = {};
    if (hasOnlyArtist) targetedOverrides.artist = TARGET_ARTIST_FIELDS;
    if (hasOnlyAlbum) targetedOverrides.album = TARGET_ALBUM_FIELDS;
    if (hasOnlyTrack) targetedOverrides.track = TARGET_TRACK_FIELDS;

    const usingTargetedOverrides = Object.keys(targetedOverrides).length > 0;

    let attemptUsedOptional = !usingTargetedOverrides;
    const fmQueryLimit = Math.min(500, Math.max(limit * 10, 50));
    const MAX_GENRE_FETCH_BATCHES = Math.max(1, parsePositiveInt(process.env.SEARCH_GENRE_MAX_BATCHES, 20));

    let attempt = await runSearch(
      attemptUsedOptional,
      usingTargetedOverrides ? targetedOverrides : undefined,
      undefined,
      fmQueryLimit
    );

    if (!attempt.response.ok) {
      const code = attempt.json?.messages?.[0]?.code;
      if (String(code) === '102' && attemptUsedOptional) {
        attemptUsedOptional = false;
        attempt = await runSearch(false, undefined, undefined, fmQueryLimit);
      }
    }

    if (!attempt.response.ok) {
      const msg = attempt.json?.messages?.[0]?.message || 'FM error';
      const code = attempt.json?.messages?.[0]?.code;
      const httpStatus = fmErrorToHttpStatus(code, attempt.response.status);
      return res
        .status(httpStatus)
        .json({ error: 'Album search failed', status: httpStatus, detail: `${msg} (FM ${code})` });
    }

    if (
      usingTargetedOverrides &&
      attempt.response.ok &&
      (attempt.json?.response?.dataInfo?.returnedCount ?? attempt.json?.response?.data?.length ?? 0) === 0
    ) {
      attemptUsedOptional = true;
      attempt = await runSearch(true, undefined, undefined, fmQueryLimit);
    }

    let aggregatedRawData = Array.isArray(attempt.json?.response?.data)
      ? attempt.json.response.data.slice()
      : [];
    let aggregatedRawCount = aggregatedRawData.length;
    const initialFoundCount = Number(attempt.json?.response?.dataInfo?.foundCount);
    let rawTotal = Number.isFinite(initialFoundCount) ? initialFoundCount : null;

    const filterValidRecords = () =>
      aggregatedRawData.filter((record) => {
        const fields = record.fieldData || {};
        return hasValidAudio(fields) && hasValidArtwork(fields);
      });
    const dedupeByAlbum = (records) => {
      const seenAlbums = new Set();
      const deduped = [];
      for (const record of records) {
        const fields = record.fieldData || {};
        const catalogue = firstNonEmptyFast(fields, CATALOGUE_FIELD_CANDIDATES);
        const albumTitle = firstNonEmptyFast(fields, ['Album Title', 'Tape Files::Album_Title', 'Tape Files::Album Title']);
        const albumArtist = firstNonEmptyFast(fields, ['Album Artist', 'Tape Files::Album Artist', 'Artist']);
        const trackName = firstNonEmptyFast(fields, ['Track Name', 'Tape Files::Track Name', 'Song Name', 'Title']);
        const trackArtist = firstNonEmptyFast(fields, ['Track Artist', 'Tape Files::Track Artist', 'Artist']) || albumArtist;

        let albumKey = makeAlbumKey(catalogue, albumTitle, albumArtist);
        const fallbackKey = record.recordId
          ? `record:${record.recordId}`
          : `track:${normTitle(trackName)}|artist:${normTitle(trackArtist)}`;
        if (!albumKey || albumKey === 'title:|artist:') {
          albumKey = fallbackKey || `row:${deduped.length}`;
        }

        if (seenAlbums.has(albumKey)) continue;
        seenAlbums.add(albumKey);
        deduped.push(record);
      }
      return deduped;
    };

    let validRecords = filterValidRecords();
    let processedRecords = genreFilters.length ? dedupeByAlbum(validRecords) : validRecords.slice();

    if (genreFilters.length) {
      let batchesFetched = 1;
      let nextFmOffset = fmOff + aggregatedRawCount;
      while (
        processedRecords.length < limit &&
        batchesFetched < MAX_GENRE_FETCH_BATCHES &&
        (rawTotal === null || nextFmOffset <= rawTotal)
      ) {
        const nextAttempt = await runSearch(
          attemptUsedOptional,
          usingTargetedOverrides ? targetedOverrides : undefined,
          nextFmOffset,
          fmQueryLimit
        );
        if (!nextAttempt.response.ok) {
          break;
        }
        const nextRaw = nextAttempt.json?.response?.data || [];
        if (!nextRaw.length) {
          break;
        }
        aggregatedRawData = aggregatedRawData.concat(nextRaw);
        aggregatedRawCount += nextRaw.length;
        batchesFetched += 1;
        nextFmOffset += nextRaw.length;
        if (rawTotal === null) {
          const nextFound = Number(nextAttempt.json?.response?.dataInfo?.foundCount);
          if (Number.isFinite(nextFound)) {
            rawTotal = nextFound;
          }
        }
        validRecords = filterValidRecords();
        processedRecords = dedupeByAlbum(validRecords);
      }
    }

    const limitedRecords = processedRecords.slice(0, limit);
    if (rawTotal === null) {
      rawTotal = limitedRecords.length;
    }
    const rawReturnedCount = aggregatedRawCount;

    const response = {
      items: limitedRecords.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
      total: rawTotal,
      offset: uiOff0,
      limit,
      rawReturnedCount
    };

    // Cache the response
    searchCache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    const detail = err?.response?.data?.messages?.[0]?.message || err?.message || String(err);
    res.status(500).json({ error: 'Album search failed', status: 500, detail });
  }
});

app.get('/api/ai-search', async (req, res) => {
  try {
    const query = (req.query.q || '').toString().trim();

    if (!query) {
      return res.status(400).json({ error: 'Query parameter required' });
    }

    if (query.length > 500) {
      return res.status(400).json({ error: 'Query too long (max 500 characters)' });
    }

    // Check cache
    const cacheKey = `ai-search:${query}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] ai-search: ${query}`);
      res.setHeader('X-Cache-Hit', 'true');
      return res.json(cached);
    }

    console.log(`[AI SEARCH] Query: "${query}"`);

    const scriptParam = JSON.stringify({ query });
    const scriptUrl = `${FM_HOST}/fmi/data/v1/databases/${encodeURIComponent(FM_DB)}/layouts/${encodeURIComponent(FM_LAYOUT)}/script/AI_NaturalLanguageSearch?script.param=${encodeURIComponent(scriptParam)}`;

    const callScript = () =>
      safeFetch(scriptUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${fmToken}`,
          'Content-Type': 'application/json'
        }
      });

    const processScriptResponse = async (scriptResponse, label = '') => {
      const json = await scriptResponse.json();
      const scriptResult = json?.response?.scriptResult;

      if (!scriptResult) {
        res.status(500).json({ error: 'No script result returned from FileMaker script' });
        return false;
      }

      const result = JSON.parse(scriptResult);

      if (!result.success) {
        res.status(500).json({
          error: 'AI interpretation failed',
          detail: result.error || 'Unknown error'
        });
        return false;
      }

      const criteria = result.criteria || {};
      console.log(`[AI SEARCH] Extracted criteria${label}:`, criteria);

      const built = await buildAiResponseFromCriteria(criteria, query, label);
      if (built?.error) {
        res.status(built.error.status).json(built.error.body);
        return false;
      }

      const finalResult = built?.payload;
      if (!finalResult) {
        res.status(500).json({ error: 'AI search failed', detail: 'Missing AI payload' });
        return false;
      }

      searchCache.set(cacheKey, finalResult);
      res.json(finalResult);
      return true;
    };

    const response = await callScript();
    if (response.ok) {
      await processScriptResponse(response);
      return;
    }

    if (response.status === 401) {
      await ensureToken();
      const retryResponse = await callScript();
      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        console.error('[AI SEARCH] Script execution failed:', errorText);
        res.status(500).json({ error: 'AI search failed', detail: errorText });
        return;
      }
      await processScriptResponse(retryResponse, ' (retry)');
      return;
    }

    const errorText = await response.text();
    console.error('[AI SEARCH] Script execution failed:', errorText);
    res.status(500).json({ error: 'AI search failed', detail: errorText });
  } catch (err) {
    console.error('[AI SEARCH] Error:', err);
    const detail = err?.message || String(err);
    res.status(500).json({ error: 'AI search failed', status: 500, detail });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const limitParam = Number.parseInt(req.query.limit || '5', 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(TRENDING_MAX_LIMIT, limitParam))
      : 5;
    const cacheKey = `trending:${limit}`;
    const cached = trendingCache.get(cacheKey);
    if (cached) {
      console.log(`[TRENDING] Serving from 24-hour cache (limit=${limit})`);
      res.setHeader('X-Cache-Hit', 'true');
      return res.json({ items: cached });
    }

    console.log(`[TRENDING] Cache miss - calculating fresh trending data (limit=${limit})`);
    const items = await fetchTrendingTracks(limit);
    trendingCache.set(cacheKey, items);
    console.log(`[TRENDING] Cached ${items.length} trending tracks for 24 hours`);
    res.json({ items });
  } catch (err) {
    console.error('[TRENDING] Failed to load trending tracks:', err);
    const detail = err?.message || 'Trending lookup failed';
    res.status(500).json({ error: detail || 'Failed to load trending tracks' });
  }
});

app.get('/api/public-playlists', expensiveLimiter, async (req, res) => {
  try {
    const nameParam = (req.query.name || '').toString().trim();
    const limitParam = Number.parseInt((req.query.limit || '100'), 10);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(2000, limitParam)) : 100;

    // Check cache
    const cacheKey = `public-playlists:${nameParam}:${limit}`;
    const cached = publicPlaylistsCache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] public-playlists: ${nameParam || 'all'}`);
      res.setHeader('X-Cache-Hit', 'true');
      return res.json(cached);
    }

    const result = await fetchPublicPlaylistRecords({ limit });
    if (result && result.missingEnv) {
      return res.status(503).json({ ok: false, error: 'Curated playlists are disabled: missing FM_HOST/FM_DB/FM_USER/FM_PASS' });
    }
    const { records } = result || { records: [] };
    if (!records.length) {
      const payload = { ok: true, playlists: [] };
      if (nameParam) payload.tracks = [];
      res.json(payload);
      return;
    }

    const summaryMap = new Map();
    const tracks = [];
    const targetName = nameParam.toLowerCase();

    for (const record of records) {
      const fields = record?.fieldData || {};

      // Skip records without valid audio
      if (!hasValidAudio(fields)) continue;

      const playlistInfo = pickFieldValueCaseInsensitive(fields, PUBLIC_PLAYLIST_FIELDS);
      if (!playlistInfo.value) continue;
      const playlistNames = splitPlaylistNames(playlistInfo.value);
      if (!playlistNames.length) continue;

      const trackName = firstNonEmptyFast(fields, ['Track Name', 'Tape Files::Track Name', 'Tape Files::Track_Name', 'Song Name', 'Song_Title', 'Title', 'Name']);
      const albumTitle = firstNonEmptyFast(fields, ['Album Title', 'Tape Files::Album_Title', 'Tape Files::Album Title', 'Album']);
      const albumArtist = firstNonEmptyFast(fields, ['Album Artist', 'Tape Files::Album Artist', 'Tape Files::Album_Artist', 'AlbumArtist', 'Artist']);
      const trackArtist = firstNonEmptyFast(fields, ['Track Artist', 'Tape Files::Track Artist', 'TrackArtist', 'Artist']) || albumArtist;
      const catalogue = firstNonEmptyFast(fields, CATALOGUE_FIELD_CANDIDATES);
      const genre = firstNonEmptyFast(fields, ['Local Genre', 'Tape Files::Local Genre', 'Genre']);
      const language = firstNonEmptyFast(fields, ['Language', 'Tape Files::Language', 'Language Code']);
      const producer = firstNonEmptyFast(fields, ['Producer', 'Tape Files::Producer']);

      const audioInfo = pickFieldValueCaseInsensitive(fields, AUDIO_FIELD_CANDIDATES);
      const artworkInfo = pickFieldValueCaseInsensitive(fields, ARTWORK_FIELD_CANDIDATES);
      const resolvedSrc = resolvePlayableSrc(audioInfo.value);
      const resolvedArt = resolveArtworkSrc(artworkInfo.value);
      const composers = composersFromFields(fields);
      const seq = parseTrackSequence(fields);
      const recordId = record.recordId ? String(record.recordId) : '';
      const albumKey = makeAlbumKey(catalogue, albumTitle, albumArtist);

      for (const rawName of playlistNames) {
        const trimmed = rawName.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        let entry = summaryMap.get(key);
        if (!entry) {
          entry = { name: trimmed, albumKeys: new Set(), trackCount: 0 };
          summaryMap.set(key, entry);
        }
        if (albumKey) entry.albumKeys.add(albumKey);
        entry.trackCount += 1;

        if (targetName && key === targetName) {
          tracks.push({
            id: recordId,
            trackRecordId: recordId,
            name: trackName || `Track ${tracks.length + 1}`,
            seq: Number.isFinite(seq) ? Number(seq) : null,
            albumTitle,
            albumArtist,
            trackArtist,
            catalogue,
            genre,
            language,
            producer,
            composers,
            isrc: firstNonEmptyFast(fields, ['ISRC', 'Tape Files::ISRC']) || '',
            composer1: fields['Composer'] || fields['Composer 1'] || fields['Composer1'] || '',
            composer2: fields['Composer 2'] || fields['Composer2'] || '',
            composer3: fields['Composer 3'] || fields['Composer3'] || '',
            composer4: fields['Composer 4'] || fields['Composer4'] || '',
            mp3: audioInfo.value || '',
            resolvedSrc,
            audioField: audioInfo.field || '',
            artworkField: artworkInfo.field || '',
            picture: resolvedArt,
            albumPicture: resolvedArt,
            albumKey
          });
        }
      }
    }

    const summaryEntries = Array.from(summaryMap.values());
    const playlists = await Promise.all(
      summaryEntries.map(async (entry) => {
        const image = (await resolvePlaylistImage(entry.name)) || '';
        return {
          name: entry.name,
          albumCount: entry.albumKeys.size,
          trackCount: entry.trackCount,
          image
        };
      })
    );
    playlists.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    if (nameParam) {
      const match = playlists.find((p) => p && typeof p.name === 'string' && p.name.toLowerCase() === targetName);
      const fallbackImage = match?.image || '';
      if (fallbackImage) {
        for (const track of tracks) {
          if (!track || typeof track !== 'object') continue;
          if (!track.picture) track.picture = fallbackImage;
          if (!track.albumPicture) track.albumPicture = fallbackImage;
        }
      }
    }

    const payload = { ok: true, playlists };
    if (nameParam) payload.tracks = tracks;

    // Cache the response
    publicPlaylistsCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('[MASS] Public playlists fetch failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to load public playlists' });
  }
});

/* ========= Container proxy ========= */
const MIRROR_HEADERS = new Map([
  ['content-type', 'Content-Type'],
  ['content-length', 'Content-Length'],
  ['accept-ranges', 'Accept-Ranges'],
  ['content-range', 'Content-Range'],
  ['etag', 'ETag'],
  ['last-modified', 'Last-Modified']
]);

app.get('/api/container', async (req, res) => {
  const direct = (req.query.u || '').toString().trim();
  const rid = (req.query.rid || '').toString().trim();
  const field = (req.query.field || '').toString().trim();
  const rep = (req.query.rep || '1').toString().trim();

  let upstreamUrl = '';
  let requiresAuth = false;

  if (rid && field) {
    // Validate record ID
    const ridValidation = validators.recordId(rid);
    if (!ridValidation.valid) {
      res.status(400).json({ error: 'invalid_input', detail: `Invalid record ID: ${ridValidation.error}` });
      return;
    }
    upstreamUrl = `${fmBase}/records/${encodeURIComponent(rid)}/containers/${encodeURIComponent(field)}/${encodeURIComponent(rep || '1')}`;
    requiresAuth = true;
  } else if (direct) {
    // Validate URL to prevent directory traversal and SSRF
    const urlValidation = validators.url(direct);
    if (!urlValidation.valid) {
      res.status(400).json({ error: 'invalid_input', detail: urlValidation.error });
      return;
    }

    // If absolute URL, validate hostname is not private/internal
    if (REGEX_HTTP_HTTPS.test(direct)) {
      try {
        const url = new URL(direct);
        const hostname = url.hostname;

        // Reject private IP ranges and localhost (prevent SSRF)
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname.match(/^10\./) ||
          hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
          hostname.match(/^192\.168\./) ||
          hostname.match(/^169\.254\./) || // AWS metadata
          hostname.match(/^::1$/) || // IPv6 localhost
          hostname.match(/^fe80:/i) || // IPv6 link-local
          hostname.match(/^fc00:/i) // IPv6 private
        ) {
          res.status(403).json({ error: 'forbidden', detail: 'Access to private/internal IPs not allowed' });
          return;
        }
        upstreamUrl = direct;
      } catch (err) {
        res.status(400).json({ error: 'invalid_input', detail: 'Invalid URL format' });
        return;
      }
    } else {
      // FileMaker container path - already validated for directory traversal by validators.url
      upstreamUrl = `${FM_HOST.replace(/\/?$/, '')}/${direct.replace(/^\//, '')}`;
    }
    requiresAuth = upstreamUrl.startsWith(FM_HOST);
  } else {
    res.status(400).json({ error: 'invalid_input', detail: 'Missing rid/field or u parameter.' });
    return;
  }

  let clientAborted = false;
  const controller = new AbortController();
  const onClose = () => {
    clientAborted = true;
    controller.abort();
  };
  req.once('close', onClose);

  try {
    await ensureToken();

    const headers = new Headers();
    headers.set('Connection', 'close');
    if (requiresAuth && fmToken) headers.set('Authorization', `Bearer ${fmToken}`);
    if (req.headers.range) headers.set('Range', req.headers.range);
    if (req.headers['if-none-match']) headers.set('If-None-Match', req.headers['if-none-match']);
    if (req.headers['if-modified-since']) headers.set('If-Modified-Since', req.headers['if-modified-since']);

    let upstream = await safeFetch(
      upstreamUrl,
      { headers, signal: controller.signal },
      { timeoutMs: 45000, retries: 0 }
    );

    if (upstream.status === 401 && requiresAuth) {
      await fmLogin();
      headers.set('Authorization', `Bearer ${fmToken}`);
      upstream = await safeFetch(
        upstreamUrl,
        { headers, signal: controller.signal },
        { timeoutMs: 45000, retries: 0 }
      );
    }

    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      console.warn('[MASS] Container fetch failed', {
        status: upstream.status,
        requiresAuth,
        url: upstreamUrl.slice(0, 200)
      });
      if (upstream.status === 404) {
        res.status(404).json({ error: 'not_found', status: 404, url: upstreamUrl });
      } else {
        const detail = `Upstream error: ${upstream.status}`;
        res.status(upstream.status).send(detail);
      }
      return;
    }

    res.statusCode = upstream.status;
    for (const [lower, headerName] of MIRROR_HEADERS.entries()) {
      const value = upstream.headers.get(lower);
      if (value !== null) res.setHeader(headerName, value);
    }

    if (!res.getHeader('Accept-Ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (clientAborted) {
      return;
    }

    const msg = String(err?.message || '').toLowerCase();
    const code = err?.code || err?.cause?.code;
    if (err?.name === 'AbortError' && err?.timedOut) {
      if (!res.headersSent) res.status(504).send('Upstream timeout');
    } else if (code === 'UND_ERR_SOCKET' || code === 'ERR_STREAM_PREMATURE_CLOSE' || msg.includes('terminated')) {
      if (!res.headersSent) res.status(502).send('Upstream connection terminated');
    } else {
      if (!res.headersSent) res.status(500).send('Container proxy failed');
    }
  } finally {
    req.off('close', onClose);
  }
});

/* ========= Explore by decade ========= */
app.get('/api/explore', expensiveLimiter, async (req, res) => {
  try {
    // Override global API cache-control - explore returns random data
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');

    const start = parseInt((req.query.start || '0'), 10);
    const end = parseInt((req.query.end || '0'), 10);
    const reqLimit = Math.max(1, Math.min(300, parseInt((req.query.limit || '50'), 10)));
    const bypassCache = req.query.refresh === '1' || req.query.refresh === 'true';
    if (!start || !end || end < start) return res.status(400).json({ error: 'bad decade', start, end });

    // Note: Random offset means we cache by decade/limit but accept different random results
    // This gives variety while still caching common decade queries
    // Skip cache if refresh parameter is present (for "Select Again" button)
    const cacheKey = `explore:${start}:${end}:${reqLimit}`;
    if (!bypassCache) {
      const cached = exploreCache.get(cacheKey);
      if (cached) {
        console.log(`[CACHE HIT] explore: ${start}-${end}`);
        res.setHeader('X-Cache-Hit', 'true');
        return res.json(cached);
      }
    } else {
      console.log(`[CACHE BYPASS] explore: ${start}-${end} (refresh requested)`);
      // Clear cache for this decade to ensure maximum variety
      exploreCache.delete(cacheKey);
    }

    const FIELDS = [
      'Year of Release',
      'Year Of Release',
      'Year of release',
      'Year Release',
      'Year',
      'Original Release Year',
      'Original Release Date',
      'Release Year',
      'Recording Year',
      'Year_Release',
      'Year Release num',
      'Year_Release_num',
      'Tape Files::Year of Release',
      'Tape Files::Year Release',
      'Tape Files::Year',
      'Tape Files::Year Release num',
      'Tape Files::Year_Release_num',
      'Albums::Year of Release',
      'Albums::Year Release',
      'Albums::Year',
      'Albums::Year Release num',
      'Albums::Year_Release_num',
      'API_Albums::Year of Release',
      'API_Albums::Year Release',
      'API_Albums::Year',
      'API_Albums::Year Release num',
      'API_Albums::Year_Release_num'
    ];

    // Try cached year field first, then others (performance optimization)
    const fieldsToTry = yearFieldCache
      ? [yearFieldCache, ...FIELDS.filter(f => f !== yearFieldCache)]
      : FIELDS;

    async function tryFind(payload) {
      const r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = json?.messages?.[0]?.message || 'FM error';
        const code = json?.messages?.[0]?.code;
        return { ok: false, status: r.status, msg, code, data: [], total: 0 };
      }
      const data = json?.response?.data || [];
      const total = json?.response?.dataInfo?.foundCount ?? data.length;
      return { ok: true, data, total };
    }

    let chosenField = null;
    for (const field of fieldsToTry) {
      const probe = await tryFind({ query: [{ [field]: `${start}...${end}` }], limit: 1, offset: 1 });
      if (probe.ok && probe.total > 0) {
        chosenField = field;
        break;
      }
    }
    if (!chosenField) {
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      for (const field of fieldsToTry) {
        const probe = await tryFind({ query: years.map((y) => ({ [field]: `==${y}` })), limit: 1, offset: 1 });
        if (probe.ok && probe.total > 0) {
          chosenField = field;
          break;
        }
      }
    }
    if (!chosenField) {
      for (const field of fieldsToTry) {
        const probe = await tryFind({ query: [{ [field]: `${start}*` }], limit: 1, offset: 1 });
        if (probe.ok && probe.total > 0) {
          chosenField = field;
          break;
        }
      }
    }
    if (!chosenField) {
      console.log(`[EXPLORE] No matching year field for ${start}-${end}`);
      return res.json({ ok: true, items: [], total: 0, offset: 0, limit: reqLimit });
    }

    // Cache the working year field for future requests (performance optimization)
    if (chosenField && !yearFieldCache) {
      yearFieldCache = chosenField;
      console.log(`[CACHE] Detected year field: "${chosenField}"`);
    }

    const probe = await tryFind({ query: [{ [chosenField]: `${start}...${end}` }], limit: 1, offset: 1 });
    let foundTotal = probe.total || 0;

    if (!foundTotal) {
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      const probe2 = await tryFind({ query: years.map((y) => ({ [chosenField]: `==${y}` })), limit: 1, offset: 1 });
      foundTotal = probe2.total || 0;
      if (foundTotal === 0) {
        const probe3 = await tryFind({ query: [{ [chosenField]: `${start}*` }], limit: 1, offset: 1 });
        foundTotal = probe3.total || 0;
      }
    }

    if (foundTotal === 0) {
      console.log(`[EXPLORE] Field ${chosenField} yielded 0 rows for ${start}-${end}`);
      return res.json({ ok: true, items: [], total: 0, offset: 0, limit: reqLimit });
    }

    const windowSize = Math.min(reqLimit, 300);
    const maxStart = Math.max(1, foundTotal - windowSize + 1);
    const randStart = Math.floor(1 + Math.random() * maxStart);

    let final = await tryFind({ query: [{ [chosenField]: `${start}...${end}` }], limit: windowSize, offset: randStart });
    if (!final.ok || final.data.length === 0) {
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      final = await tryFind({ query: years.map((y) => ({ [chosenField]: `==${y}` })), limit: windowSize, offset: randStart });
      if (!final.ok || final.data.length === 0) {
        final = await tryFind({ query: [{ [chosenField]: `${start}*` }], limit: windowSize, offset: randStart });
      }
    }

    // Filter to only include records with valid audio
    const filteredData = (final.data || []).filter(d => hasValidAudio(d.fieldData || {}));
    const items = filteredData.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} }));
    console.log(`[EXPLORE] ${start}-${end} using ${chosenField}: total ${foundTotal}, offset ${randStart}, returned ${items.length} (filtered from ${final.data?.length || 0})`);

    const response = { ok: true, items, total: foundTotal, offset: randStart - 1, limit: windowSize, field: chosenField };
    // Only cache initial loads, not refreshes (to preserve variety)
    if (!bypassCache) {
      exploreCache.set(cacheKey, response);
    }
    return res.json(response);
  } catch (err) {
    const detail = err?.message || String(err);
    return res.status(500).json({ error: 'Explore failed', status: 500, detail });
  }
});

const RANDOM_SONG_BUFFER_MAX_RECORDS = 500;
const RANDOM_SONG_BUFFER_WARM_COUNT = 24;
const randomSongBuffer = {
  recordsById: new Map(),
  recordIdsByArtist: new Map(),
  insertionQueue: [],
  removedIds: new Set(),
  warmPromise: null
};
void warmRandomSongBuffer(RANDOM_SONG_BUFFER_WARM_COUNT * 2);

const RANDOM_SONG_PERSIST_MAX_AGE_MS = 30 * 60 * 1000;
const RANDOM_SONG_PERSIST_MAX_ITEMS = 80;
let randomSongPersistWritePromise = null;
let randomSongRefreshPromise = null;

function resolveArtist(fields = {}) {
  return (
    fields['Album Artist'] ||
    fields['Artist'] ||
    fields['Tape Files::Album Artist'] ||
    'Unknown'
  );
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (typeof err.code === 'string' && err.code.toUpperCase() === 'UND_ERR_ABORTED') return true;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return message.includes('aborted') || message.includes('aborterror');
}

function bufferTrimOverflow() {
  while (randomSongBuffer.insertionQueue.length) {
    const firstId = randomSongBuffer.insertionQueue[0];
    if (!randomSongBuffer.removedIds.has(firstId) && randomSongBuffer.recordsById.has(firstId)) {
      break;
    }
    randomSongBuffer.removedIds.delete(firstId);
    randomSongBuffer.insertionQueue.shift();
  }

  while (randomSongBuffer.insertionQueue.length > RANDOM_SONG_BUFFER_MAX_RECORDS) {
    const oldestId = randomSongBuffer.insertionQueue.shift();
    if (oldestId) {
      randomSongBuffer.removedIds.delete(oldestId);
      bufferRemoveRecordId(oldestId);
    }
  }
}

function bufferRemoveRecordId(recordId) {
  if (!recordId) return;
  const record = randomSongBuffer.recordsById.get(recordId);
  if (!record) {
    randomSongBuffer.removedIds.add(recordId);
    return;
  }

  randomSongBuffer.recordsById.delete(recordId);
  randomSongBuffer.removedIds.add(recordId);

  const artist = resolveArtist(record.fieldData || {});
  const set = randomSongBuffer.recordIdsByArtist.get(artist);
  if (set) {
    set.delete(recordId);
    if (!set.size) {
      randomSongBuffer.recordIdsByArtist.delete(artist);
    }
  }
}

function bufferAddRecords(records = []) {
  let added = 0;
  for (const record of records) {
    if (!record || !record.recordId) continue;
    if (randomSongBuffer.recordsById.has(record.recordId)) continue;
    const fields = record.fieldData || {};
    if (!hasValidAudio(fields) || !hasValidArtwork(fields)) continue;

    const artist = resolveArtist(fields);
    randomSongBuffer.recordsById.set(record.recordId, record);
    if (!randomSongBuffer.recordIdsByArtist.has(artist)) {
      randomSongBuffer.recordIdsByArtist.set(artist, new Set());
    }
    randomSongBuffer.recordIdsByArtist.get(artist).add(record.recordId);
    randomSongBuffer.insertionQueue.push(record.recordId);
    randomSongBuffer.removedIds.delete(record.recordId);
    added += 1;
  }

  if (added) {
    bufferTrimOverflow();
  }
  return added;
}

function bufferAddItems(items = []) {
  if (!Array.isArray(items) || !items.length) return 0;
  const records = items.map((item) => ({
    recordId: item.recordId,
    modId: item.modId,
    fieldData: { ...(item.fields || {}) }
  }));
  return bufferAddRecords(records);
}

function bufferUniqueArtistCount() {
  return randomSongBuffer.recordIdsByArtist.size;
}

function bufferTake(count) {
  if (!count || count <= 0) return [];
  if (bufferUniqueArtistCount() < count) return null;

  const artists = shuffleArray(Array.from(randomSongBuffer.recordIdsByArtist.keys()));
  const selected = [];
  const idsToConsume = [];

  for (const artist of artists) {
    if (selected.length >= count) break;
    const set = randomSongBuffer.recordIdsByArtist.get(artist);
    if (!set || !set.size) continue;
    const ids = Array.from(set);
    const recordId = ids[Math.floor(Math.random() * ids.length)];
    const record = randomSongBuffer.recordsById.get(recordId);
    if (!record) {
      set.delete(recordId);
      continue;
    }
    selected.push(record);
    idsToConsume.push(recordId);
  }

  if (selected.length < count) {
    return null;
  }

  for (const recordId of idsToConsume) {
    bufferRemoveRecordId(recordId);
  }

  bufferTrimOverflow();
  return selected;
}

if (randomSongPersistedCache.items.length) {
  const added = bufferAddItems(randomSongPersistedCache.items);
  if (added) {
    console.log(`[random-songs] Primed buffer with ${added} persisted records`);
  }
}

async function warmRandomSongBuffer(targetCount) {
  if (randomSongBuffer.warmPromise) {
    return randomSongBuffer.warmPromise;
  }

  const desiredCount = Math.max(RANDOM_SONG_BUFFER_WARM_COUNT, targetCount || 0);
  randomSongBuffer.warmPromise = (async () => {
    try {
      let batch;
      try {
        batch = await fetchRandomSongsBatch({
          count: desiredCount,
          mode: 'loadMore'
        });
      } catch (err) {
        if (!isAbortError(err)) throw err;
        console.warn('[random-songs] Buffer warm primary fetch aborted; falling back to legacy fetch');
        batch = await fetchRandomSongsLegacy({
          count: desiredCount,
          isLoadMore: true
        });
      }

      if ((!batch.selected || !batch.selected.length) && !(batch.extras && batch.extras.length)) {
        console.warn('[random-songs] Buffer warm primary fetch empty; falling back to legacy fetch');
        batch = await fetchRandomSongsLegacy({
          count: desiredCount,
          isLoadMore: true
        });
      }
      const recordsToStore = [
        ...(batch.selected || []),
        ...((batch.extras && batch.extras.length) ? batch.extras : [])
      ];
      if (recordsToStore.length) {
        bufferAddRecords(recordsToStore);
        console.log(`[random-songs] Buffer warmed with ${recordsToStore.length} records`);
      } else {
        console.log('[random-songs] Buffer warm produced no records');
      }
    } catch (err) {
      console.error('[random-songs] Buffer warm failed', err);
    } finally {
      randomSongBuffer.warmPromise = null;
    }
  })();

  return randomSongBuffer.warmPromise;
}

function mapRecordsToItems(records = []) {
  return records.map((record) => ({
    recordId: record.recordId,
    modId: record.modId,
    fields: record.fieldData || {}
  }));
}

function cloneRandomSongItems(items = [], count = items.length) {
  return items.slice(0, Math.min(count, items.length)).map((item) => ({
    recordId: item.recordId,
    modId: item.modId,
    fields: { ...(item.fields || {}) }
  }));
}

function getPersistedRandomSongs(count, returnAll = false) {
  if (!randomSongPersistedCache.items.length) return null;
  if (Date.now() - randomSongPersistedCache.updatedAt > RANDOM_SONG_PERSIST_MAX_AGE_MS) {
    return null;
  }

  // Validate that cached items still have valid audio (container URLs might have expired)
  // Note: We don't require artwork - frontend handles missing artwork with placeholders
  const validItems = randomSongPersistedCache.items.filter(item => {
    const fields = item?.fields || {};
    return hasValidAudio(fields);
  });

  // If returnAll is true (for featured albums), return all items regardless of count
  if (returnAll) {
    const items = cloneRandomSongItems(validItems);
    return { ok: true, items, total: items.length };
  }

  if (validItems.length < count) {
    console.log(`[random-songs] Persisted cache has only ${validItems.length}/${randomSongPersistedCache.items.length} valid items (need ${count}), refreshing...`);
    return null;
  }

  const items = cloneRandomSongItems(validItems, count);
  return { ok: true, items, total: items.length };
}

function updatePersistedRandomSongs(items = []) {
  if (!Array.isArray(items) || !items.length) return;
  const vetted = items.filter(item => {
    const fields = item?.fields || {};
    return hasValidAudio(fields) && hasValidArtwork(fields);
  });
  if (!vetted.length) return;
  const trimmed = cloneRandomSongItems(vetted, RANDOM_SONG_PERSIST_MAX_ITEMS);
  randomSongPersistedCache = {
    items: trimmed,
    updatedAt: Date.now()
  };
  bufferAddItems(trimmed);
  const payload = JSON.stringify({
    items: trimmed,
    updatedAt: randomSongPersistedCache.updatedAt
  });
  playlistSeedCache = { items: [], updatedAt: 0 };
  randomSongPersistWritePromise = (async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(RANDOM_SONG_CACHE_PATH, payload, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      console.warn('[random-songs] Failed to persist random song cache', err);
    }
  })();
}

async function waitForPersistedCache(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (randomSongPersistedCache.items.length) return true;
    try {
      const raw = await fs.readFile(RANDOM_SONG_CACHE_PATH, 'utf8');
      const json = JSON.parse(raw);
      if (Array.isArray(json?.items) && json.items.length) {
        randomSongPersistedCache = {
          items: json.items,
          updatedAt: Number(json.updatedAt) || Date.now()
        };
        bufferAddItems(json.items);
        return true;
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.warn('[random-songs] Waiting for cache read failed', err);
      }
    }
    await sleep(1000);
  }
  return false;
}

function computeCacheKey(count, cacheSlot) {
  if (typeof cacheSlot !== 'number') return null;
  return `random-songs:${count}:${cacheSlot}`;
}

function refreshRandomSongsInBackground({ count, isLoadMore = false, cacheSlot = null }) {
  if (randomSongRefreshPromise) {
    return randomSongRefreshPromise;
  }
  randomSongRefreshPromise = (async () => {
    try {
      // Fetch random songs from the entire catalog
      let batch;
      try {
        batch = await fetchRandomSongsBatch({
          count,
          mode: isLoadMore ? 'loadMore' : 'initial',
          cacheSlot
        });
      } catch (err) {
        if (!isAbortError(err)) throw err;
        console.warn('[random-songs] Background fetch aborted; falling back to legacy');
        batch = await fetchRandomSongsLegacy({
          count,
          isLoadMore,
          cacheSlot
        });
      }

      if (!batch.selected.length) {
        batch = await fetchRandomSongsLegacy({
          count,
          isLoadMore,
          cacheSlot
        });
      }

      if (!batch.selected.length) {
        console.warn('[random-songs] Background refresh produced no songs');
        return;
      }

      const items = mapRecordsToItems(batch.selected);
      updatePersistedRandomSongs(items);
      if (batch.extras && batch.extras.length) {
        bufferAddRecords(batch.extras);
      }
      const cacheKey = computeCacheKey(count, cacheSlot);
      if (cacheKey) {
        searchCache.set(cacheKey, { ok: true, items, total: items.length });
      }
    } catch (err) {
      if (!isAbortError(err)) {
        console.error('[random-songs] Background refresh failed', err);
      }
    } finally {
      randomSongRefreshPromise = null;
    }
  })();
  return randomSongRefreshPromise;
}

async function ensureRandomSongSeed(count = RANDOM_SONG_BUFFER_WARM_COUNT * 2) {
  if (randomSongPersistedCache.items.length) {
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });

  let lockHandle = null;
  try {
    lockHandle = await fs.open(RANDOM_SONG_SEED_LOCK_PATH, 'wx').catch((err) => {
      if (err?.code === 'EEXIST') {
        return null;
      }
      throw err;
    });

    if (!lockHandle) {
      console.log('[random-songs] Another worker is seeding random songs; waiting for cache');
      const ready = await waitForPersistedCache();
      if (!ready) {
        console.warn('[random-songs] Cache still empty after waiting; proceeding without seed');
      }
      return;
    }

    console.log('[random-songs] Seeding persisted random songs cache (cold start)');
    const seedCount = Math.max(count, RANDOM_SONG_BUFFER_WARM_COUNT);

    // Seed with random songs from the catalog instead of featured albums
    void refreshRandomSongsInBackground({ count: seedCount, isLoadMore: false, cacheSlot: null });
  } finally {
    if (lockHandle) {
      await lockHandle.close().catch(() => {});
      await fs.unlink(RANDOM_SONG_SEED_LOCK_PATH).catch(() => {});
    }
  }
}

function mapPlaylistTrackToRandomItem(track = {}, playlist = {}) {
  const mp3 = track.mp3 || track.resolvedSrc || track.audioUrl || '';
  if (!mp3) return null;
  const artwork = track.artwork || track.coverArt || '';
  const playlistId = normalizeRecordId(playlist.id || '');
  const recordId =
    normalizeRecordId(track.trackRecordId || track.recordId) ||
    `playlist-${playlistId || 'seed'}-${track.seq || track.addedAt || randomUUID()}`;
  const albumArtist = track.albumArtist || track.trackArtist || track.artist || '';
  const trackName = track.name || track.trackName || track.title || 'Unknown Track';
  const fields = {
    'Track Name': trackName,
    'Tape Files::Track Name': trackName,
    'Album Title': track.albumTitle || track.album || '',
    Album: track.albumTitle || track.album || '',
    'Album Artist': albumArtist,
    Artist: track.trackArtist || albumArtist,
    'Track Artist': track.trackArtist || albumArtist,
    'Catalogue #': track.catalogue || track.catalog || '',
    Catalogue: track.catalogue || track.catalog || '',
    mp3,
    MP3: mp3,
    'Audio File': mp3,
    'Artwork::Picture': artwork,
    Artwork: artwork,
    Visibility: FM_VISIBILITY_VALUE || 'show',
    'Tape Files::Visibility': FM_VISIBILITY_VALUE || 'show',
    'Playlist Name': playlist.name || '',
    'Playlist ID': playlistId,
    'Seed Source': 'playlist'
  };
  return {
    recordId,
    modId: track.modId || '1',
    fields
  };
}

async function fetchFeaturedAlbumRecords(limit = 400) {
  if (!FEATURED_FIELD_CANDIDATES.length) return [];
  const normalizedLimit = Math.max(1, Math.min(1000, limit));

  // Helper function to try a specific field
  const tryField = async (field) => {
    if (!field) return null;
    const query = applyVisibility({ [field]: FM_FEATURED_VALUE });
    const payload = {
      query: [query],
      limit: normalizedLimit,
      offset: 1
    };
    try {
      const response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (isMissingFieldError(json)) {
          return null; // Field doesn't exist, try next
        }
        const fmCode = json?.messages?.[0]?.code;
        if (String(fmCode) === '401') {
          return null; // No records found, try next
        }
        const msg = json?.messages?.[0]?.message || 'FM error';
        console.warn('[featured] Album fetch failed', { field, status: response.status, msg, code: fmCode });
        return [];
      }
      const rawData = json?.response?.data || [];
      const filtered = rawData
        .filter(record => recordIsVisible(record.fieldData || {}))
        .filter(record => hasValidAudio(record.fieldData || {}))
        .filter(record => hasValidArtwork(record.fieldData || {}))
        .filter(record => recordIsFeatured(record.fieldData || {}));
      if (filtered.length) {
        console.log(`[featured] Field "${field}" returned ${filtered.length}/${rawData.length} records`);
        cachedFeaturedFieldName = field; // Cache successful field name
        return filtered;
      }
      return null;
    } catch (err) {
      console.warn(`[featured] Fetch threw for field "${field}"`, err);
      return null;
    }
  };

  // Try cached field first if we have one
  if (cachedFeaturedFieldName) {
    console.log(`[featured] Trying cached field: "${cachedFeaturedFieldName}"`);
    const result = await tryField(cachedFeaturedFieldName);
    if (result && result.length > 0) {
      return result;
    }
    // Cached field failed, clear it and try all candidates
    console.warn(`[featured] Cached field "${cachedFeaturedFieldName}" failed, trying all candidates`);
    cachedFeaturedFieldName = null;
  }

  // Try all field candidates
  for (const field of FEATURED_FIELD_CANDIDATES) {
    const result = await tryField(field);
    if (result && result.length > 0) {
      return result;
    }
    if (Array.isArray(result) && result.length === 0) {
      // Empty array means error, stop trying
      return [];
    }
  }
  return [];
}

function cloneRecordsForLimit(records = [], count = records.length) {
  return records.slice(0, Math.min(count, records.length)).map((record) => ({
    recordId: record.recordId,
    modId: record.modId,
    fields: { ...(record.fieldData || record.fields || {}) }
  }));
}

async function loadFeaturedAlbumRecords({ limit = 400, refresh = false } = {}) {
  const now = Date.now();
  const cacheAge = featuredAlbumCache.updatedAt ? (now - featuredAlbumCache.updatedAt) / 1000 : 0;

  if (
    !refresh &&
    featuredAlbumCache.items.length &&
    now - featuredAlbumCache.updatedAt < FEATURED_ALBUM_CACHE_TTL_MS
  ) {
    console.log(`[featured] Using cache (age: ${cacheAge.toFixed(1)}s, ${featuredAlbumCache.items.length} items)`);
    return {
      items: cloneRecordsForLimit(featuredAlbumCache.items, limit),
      total: featuredAlbumCache.total
    };
  }

  console.log(`[featured] Fetching fresh data (refresh=${refresh}, cache age=${cacheAge.toFixed(1)}s)`);
  const fetchLimit = Math.max(limit, 400);
  const records = await fetchFeaturedAlbumRecords(fetchLimit);
  const items = records.map((record) => ({
    recordId: record.recordId,
    modId: record.modId,
    fields: record.fieldData || {}
  }));

  console.log(`[featured] Cached ${items.length} featured albums`);

  // Log first 5 albums for debugging
  if (items.length > 0) {
    console.log('[featured] Sample albums:');
    items.slice(0, 5).forEach((item, i) => {
      const title = item.fields['Album Title'] || item.fields['Tape Files::Album_Title'] || 'Unknown';
      const artist = item.fields['Album Artist'] || item.fields['Tape Files::Album Artist'] || 'Unknown';
      const featuredValue = item.fields['Tape Files::featured'] || item.fields['featured'] || item.fields['Tape Files::Featured'] || item.fields['Featured'] || 'N/A';
      console.log(`[featured]   ${i + 1}. "${title}" by ${artist} (featured=${featuredValue})`);
    });
  }

  featuredAlbumCache = {
    items,
    total: items.length,
    updatedAt: now
  };

  return {
    items: cloneRecordsForLimit(items, limit),
    total: items.length
  };
}

app.get('/api/featured-albums', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '400', 10)));
    const refresh = req.query.refresh === '1';
    console.log(`[featured] GET /api/featured-albums limit=${limit} refresh=${refresh}`);
    const result = await loadFeaturedAlbumRecords({ limit, refresh });
    // No browser caching - always fetch fresh from server (server has its own 30s cache)
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.json({ ok: true, items: result.items, total: result.total });
  } catch (err) {
    console.error('[featured] Failed to load albums', err);
    return res.status(500).json({ ok: false, error: 'Failed to load featured albums' });
  }
});

// Alias endpoint for modern view
app.get('/api/releases/latest', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '1', 10)));
    const refresh = req.query.refresh === '1';
    console.log(`[releases] GET /api/releases/latest limit=${limit} refresh=${refresh}`);
    const result = await loadFeaturedAlbumRecords({ limit, refresh });
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.json({ ok: true, items: result.items, total: result.total });
  } catch (err) {
    console.error('[releases] Failed to load latest releases', err);
    return res.status(500).json({ ok: false, error: 'Failed to load latest releases' });
  }
});

async function buildPlaylistSeedItems(count) {
  const now = Date.now();
  if (
    playlistSeedCache.items.length >= count &&
    now - playlistSeedCache.updatedAt < PLAYLIST_SEED_CACHE_TTL_MS
  ) {
    // Validate cached playlist seed items still have valid audio
    // Note: We don't require artwork - frontend handles missing artwork with placeholders
    const validItems = playlistSeedCache.items.filter(item => {
      const fields = item?.fields || {};
      return hasValidAudio(fields);
    });
    if (validItems.length >= count) {
      return cloneRandomSongItems(validItems, count);
    }
    // If not enough valid items, rebuild the cache
  }

  const playlists = await loadPlaylists();
  const collected = [];
  for (const playlist of playlists) {
    const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
    for (const track of tracks) {
      const item = mapPlaylistTrackToRandomItem(track, playlist);
      if (item) {
        collected.push(item);
      }
    }
  }

  if (!collected.length) {
    return [];
  }

  // Filter playlist seed items to only include tracks with artwork (for initial load quality)
  const withArtwork = collected.filter(item => hasValidArtwork(item.fields || {}));
  const finalItems = withArtwork.length > 0 ? withArtwork : collected;

  shuffleArray(finalItems);
  playlistSeedCache = { items: finalItems, updatedAt: now };
  return cloneRandomSongItems(finalItems, count);
}

async function fetchRandomSongsBatch({ count, mode = 'loadMore', cacheSlot = null, genreFilters = [] }) {
  const maxOffset = 5000;
  const fetchLimit = Math.min(120, Math.max(count * 5, 30));
  const baseQuery = { 'Album Title': '*' };
  const normalizedGenres = Array.isArray(genreFilters)
    ? genreFilters.map((value) => value.trim()).filter(Boolean)
    : [];
  const genreFieldCandidates = SEARCH_GENRE_FIELDS.filter(Boolean);
  let activeGenreFieldIndex = 0;
  let activeGenreFilters = normalizedGenres.slice(0, 5);
  let currentGenreField = activeGenreFilters.length ? genreFieldCandidates[activeGenreFieldIndex] || null : null;

  let randomOffset;
  if (mode === 'initial' && typeof cacheSlot === 'number') {
    randomOffset = (cacheSlot % maxOffset) + 1;
  } else {
    randomOffset = Math.floor(Math.random() * maxOffset) + 1;
  }

  const state = {
    selected: [],
    usedArtists: new Set(),
    selectedIds: new Set(),
    extrasMap: new Map()
  };

  const buildQueries = () => {
    const applyGenreField = (fieldName) => {
      if (!fieldName || !activeGenreFilters.length) return [applyVisibility({ ...baseQuery })];
      return activeGenreFilters.map((genre) => applyVisibility({ ...baseQuery, [fieldName]: `*${genre}*` }));
    };
    return applyGenreField(currentGenreField);
  };

  const runQuery = async (offset) => {
    while (true) {
      let queryWithVisibility = buildQueries();
      let r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
        query: queryWithVisibility,
        limit: fetchLimit,
        offset
      });
      let json = await r.json().catch(() => ({}));

      if (!r.ok && shouldFallbackVisibility(json)) {
        console.warn('[random-songs] Visibility field not available; retrying without filter');
        queryWithVisibility = queryWithVisibility.map((entry) => {
          const clone = { ...entry };
          delete clone[FM_VISIBILITY_FIELD];
          delete clone['Tape Files::Visibility'];
          return clone;
        });
        r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
          query: queryWithVisibility,
          limit: fetchLimit,
          offset
        });
        json = await r.json().catch(() => ({}));
      }

      if (!r.ok) {
        const msg = json?.messages?.[0]?.message || 'FM error';
        const code = json?.messages?.[0]?.code;
        const codeStr = code === undefined || code === null ? '' : String(code);
        if (codeStr === '102' && currentGenreField) {
          const hasNext = activeGenreFieldIndex < genreFieldCandidates.length - 1;
          if (hasNext) {
            const previous = currentGenreField;
            activeGenreFieldIndex += 1;
            currentGenreField = genreFieldCandidates[activeGenreFieldIndex] || null;
            console.warn(`[random-songs] Genre field "${previous}" unavailable; retrying with "${currentGenreField}"`);
            continue;
          }
          if (activeGenreFilters.length) {
            console.warn('[random-songs] Genre filters unavailable; retrying without genre filter');
            activeGenreFilters = [];
            currentGenreField = null;
            continue;
          }
        }
        throw new HttpError(500, { error: 'Random songs failed', status: r.status, detail: `${msg} (${codeStr})` }, { offset, fetchLimit });
      }

    const rawData = json?.response?.data || [];
      let filtered = rawData
      .filter(record => recordIsVisible(record.fieldData || {}))
      .filter(record => hasValidAudio(record.fieldData || {}));

      // Note: We don't filter by artwork here - frontend handles missing artwork with placeholders
      // This ensures we have enough results for highlights/random songs even if artwork is missing

      return filtered;
    }
  };

  let dataWithVisibility = await runQuery(randomOffset);

  if (!dataWithVisibility.length) {
    console.warn(`[random-songs] Empty batch at offset ${randomOffset}, retrying from start`);
    dataWithVisibility = await runQuery(1);
  }

  selectUniqueRecords(dataWithVisibility, count, state);

  if (state.selected.length < count) {
    console.log(`[random-songs] Only found ${state.selected.length}/${count} unique artists, fetching more (1 retry max)`);
    const additionalOffset = Math.floor(Math.random() * maxOffset) + 1;
    let additionalData = await runQuery(additionalOffset);
    additionalData = additionalData.filter(record => !state.selectedIds.has(record.recordId));
    selectUniqueRecords(additionalData, count, state);
  }

  const extras = Array.from(state.extrasMap.values()).filter(record => !state.selectedIds.has(record.recordId));
  const uniqueArtistCount = state.usedArtists.size;

  if (state.selected.length < count) {
    console.log(`[random-songs] Could only find ${state.selected.length}/${count} songs (${uniqueArtistCount} unique artists)`);
  } else {
    console.log(`[random-songs] Returning ${state.selected.length} songs from ${uniqueArtistCount} unique artists (offset ${randomOffset}, limit ${fetchLimit})`);
  }

  return {
    selected: state.selected,
    extras,
    meta: {
      randomOffset,
      fetchLimit,
      uniqueArtistCount
    }
  };
}

async function fetchRandomSongsLegacy({ count, isLoadMore, cacheSlot, genreFilters = [] }) {
  const maxOffset = 5000;
  let randomOffset;
  if (!isLoadMore && typeof cacheSlot === 'number') {
    randomOffset = (cacheSlot % maxOffset) + 1;
  } else {
    randomOffset = Math.floor(Math.random() * maxOffset) + 1;
  }

  const fetchLimit = Math.min(60, count * 4);
  const baseQuery = { 'Album Title': '*' };
  const normalizedGenres = Array.isArray(genreFilters)
    ? genreFilters.map((value) => value.trim()).filter(Boolean)
    : [];
  const genreFieldCandidates = SEARCH_GENRE_FIELDS.filter(Boolean);
  let activeGenreFieldIndex = 0;
  let activeGenreFilters = normalizedGenres.slice(0, 5);
  let currentGenreField = activeGenreFilters.length ? genreFieldCandidates[activeGenreFieldIndex] || null : null;

  const buildGenreQueries = () => {
    if (!activeGenreFilters.length || !currentGenreField) {
      return [applyVisibility({ ...baseQuery })];
    }
    return activeGenreFilters.map((genre) => applyVisibility({ ...baseQuery, [currentGenreField]: `*${genre}*` }));
  };

  const runLegacyQuery = async (offset) => {
    while (true) {
      let queryWithVisibility = buildGenreQueries();
      let response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
        query: queryWithVisibility,
        limit: fetchLimit,
        offset
      });
      let json = await response.json().catch(() => ({}));

      if (!response.ok && shouldFallbackVisibility(json)) {
        console.warn('[random-songs] Visibility field not available; retrying without filter (legacy)');
        queryWithVisibility = queryWithVisibility.map((entry) => {
          const clone = { ...entry };
          delete clone[FM_VISIBILITY_FIELD];
          delete clone['Tape Files::Visibility'];
          return clone;
        });
        response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
          query: queryWithVisibility,
          limit: fetchLimit,
          offset
        });
        json = await response.json().catch(() => ({}));
      }

      if (!response.ok) {
        const msg = json?.messages?.[0]?.message || 'FM error';
        const code = json?.messages?.[0]?.code;
        const codeStr = code === undefined || code === null ? '' : String(code);
        if (codeStr === '102' && currentGenreField) {
          const hasNext = activeGenreFieldIndex < genreFieldCandidates.length - 1;
          if (hasNext) {
            const previous = currentGenreField;
            activeGenreFieldIndex += 1;
            currentGenreField = genreFieldCandidates[activeGenreFieldIndex] || null;
            console.warn(`[random-songs] Legacy genre field "${previous}" unavailable; retrying with "${currentGenreField}"`);
            continue;
          }
          if (activeGenreFilters.length) {
            console.warn('[random-songs] Legacy retry without genre filters');
            activeGenreFilters = [];
            currentGenreField = null;
            continue;
          }
        }
        throw new HttpError(500, { error: 'Random songs failed', status: response.status, detail: `${msg} (${codeStr})` }, { offset, fetchLimit });
      }

      return json?.response?.data || [];
    }
  };

  let rawData = await runLegacyQuery(randomOffset);
  let visible = rawData
    .filter(record => recordIsVisible(record.fieldData || {}))
    .filter(record => hasValidAudio(record.fieldData || {}));
    // Note: We don't filter by artwork here - frontend handles missing artwork with placeholders

  if (!visible.length) {
    console.warn(`[random-songs] Legacy fetch empty at offset ${randomOffset}, retrying from start`);
    const retryJson = await runLegacyQuery(1);
    if (retryJson && retryJson.length) {
      rawData = retryJson;
      visible = rawData
        .filter(record => recordIsVisible(record.fieldData || {}))
        .filter(record => hasValidAudio(record.fieldData || {}));
    }
  }

  if (!visible.length) {
    return {
      selected: [],
      extras: [],
      meta: {
        randomOffset,
        fetchLimit,
        uniqueArtistCount: 0
      }
    };
  }

  const artistMap = new Map();
  for (const record of visible) {
    const artist = resolveArtist(record.fieldData || {});
    if (!artistMap.has(artist)) {
      artistMap.set(artist, []);
    }
    artistMap.get(artist).push(record);
  }

  const artists = shuffleArray(Array.from(artistMap.keys()));
  const selected = [];

  for (const artist of artists) {
    if (selected.length >= count) break;
    const tracks = artistMap.get(artist);
    if (!tracks || !tracks.length) continue;
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];
    selected.push(randomTrack);
  }

  if (selected.length < count) {
    console.log(`[random-songs] Legacy fetch only found ${selected.length}/${count} unique artists, attempting secondary fetch`);
    const usedArtists = new Set(selected.map(record => resolveArtist(record.fieldData || {})));
    const selectedIds = new Set(selected.map(record => record.recordId));
    const additionalOffset = Math.floor(Math.random() * maxOffset) + 1;
    const additionalRawData = await runLegacyQuery(additionalOffset);
    let additionalVisible = additionalRawData
      .filter(record => recordIsVisible(record.fieldData || {}))
      .filter(record => hasValidAudio(record.fieldData || {}));
    const shuffledTracks = shuffleArray(additionalVisible.slice());

    for (const track of shuffledTracks) {
      if (selected.length >= count) break;
      const artist = resolveArtist(track.fieldData || {});
      if (usedArtists.has(artist) || selectedIds.has(track.recordId)) continue;
      selected.push(track);
      selectedIds.add(track.recordId);
      usedArtists.add(artist);
    }
  }

  const uniqueArtistCount = new Set(selected.map(record => resolveArtist(record.fieldData || {}))).size;

  if (selected.length < count) {
    console.log(`[random-songs] Legacy fetch returning ${selected.length}/${count} songs (${uniqueArtistCount} unique artists)`);
  } else {
    console.log(`[random-songs] Legacy fetch returning ${selected.length} songs from ${uniqueArtistCount} unique artists (offset ${randomOffset}, limit ${fetchLimit})`);
  }

  return {
    selected,
    extras: [],
    meta: {
      randomOffset,
      fetchLimit,
      uniqueArtistCount
    }
  };
}

function selectUniqueRecords(records, desiredCount, state) {
  if (!Array.isArray(records) || !records.length) {
    return state;
  }

  const { selected, usedArtists, selectedIds, extrasMap } = state;
  const artistBuckets = new Map();

  for (const record of records) {
    if (!record || !record.recordId || selectedIds.has(record.recordId)) continue;
    const fields = record.fieldData || {};
    if (!hasValidAudio(fields) || !hasValidArtwork(fields)) continue;
    const artist = resolveArtist(fields);
    if (!artistBuckets.has(artist)) {
      artistBuckets.set(artist, []);
    }
    artistBuckets.get(artist).push(record);
  }

  const artists = shuffleArray(Array.from(artistBuckets.keys()));

  for (const artist of artists) {
    if (selected.length >= desiredCount) break;
    const bucket = artistBuckets.get(artist);
    if (!bucket || !bucket.length) continue;

    if (usedArtists.has(artist)) {
      for (const record of bucket) {
        extrasMap.set(record.recordId, record);
      }
      continue;
    }

    const pick = bucket[Math.floor(Math.random() * bucket.length)];
    selected.push(pick);
    selectedIds.add(pick.recordId);
    usedArtists.add(artist);

    for (const record of bucket) {
      if (record.recordId !== pick.recordId) {
        extrasMap.set(record.recordId, record);
      }
    }
  }

  for (const bucket of artistBuckets.values()) {
    for (const record of bucket) {
      if (!record || selectedIds.has(record.recordId)) continue;
      extrasMap.set(record.recordId, record);
    }
  }

  return state;
}

/* ========= Random Songs: Get random individual songs with artwork ========= */
app.get('/api/random-songs', async (req, res) => {
  try {
    const count = Math.max(1, Math.min(50, parseInt(req.query.count || '8', 10)));

    const rawGenreInput = req.query.genre;
    const genreFragments = [];
    if (Array.isArray(rawGenreInput)) {
      rawGenreInput.forEach((value) => {
        if (value === undefined || value === null) return;
        String(value)
          .split(/[,\|]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => genreFragments.push(part));
      });
    } else if (rawGenreInput !== undefined && rawGenreInput !== null) {
      String(rawGenreInput)
        .split(/[,\|]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => genreFragments.push(part));
    }

    const MAX_GENRE_FILTERS = 5;
    const genreFilters = [];
    const normalizedGenreKeys = new Set();
    for (const fragment of genreFragments) {
      if (genreFilters.length >= MAX_GENRE_FILTERS) break;
      const validation = validators.searchQuery(fragment);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Invalid genre filter', detail: validation.error });
      }
      const normalizedKey = validation.value.toLowerCase();
      if (normalizedGenreKeys.has(normalizedKey)) continue;
      normalizedGenreKeys.add(normalizedKey);
      genreFilters.push(validation.value);
    }

    const genreCacheKey = genreFilters.length
      ? genreFilters.map((g) => g.toLowerCase()).sort().join('|')
      : '';

    console.log(`[random-songs] Parsed genre filters:`, genreFilters, `(count: ${genreFilters.length})`);

    // If _t parameter is present, user clicked "Load More" - bypass cache for fresh songs
    const isLoadMore = !!req.query._t;

    // Disable caching for random songs to ensure true randomness every time
    const cacheSlot = !isLoadMore ? Math.floor(Date.now() / 30000) : null;
    const cacheKey = !isLoadMore
      ? `${computeCacheKey(count, cacheSlot)}:${genreCacheKey || 'all'}`
      : null;
    // if (!isLoadMore && cacheKey && !genreFilters.length) {
    //   const cached = searchCache.get(cacheKey);
    //   if (cached) {
    //     console.log('[CACHE HIT] random-songs (30s window)');
    //     res.setHeader('X-Cache-Hit', 'true');
    //     res.setHeader('Cache-Control', 'public, max-age=30');
    //     return res.json(cached);
    //   }
    // }

    if (!isLoadMore && !genreFilters.length) {
      // Warm the buffer in the background with featured albums if needed
      if (bufferUniqueArtistCount() < RANDOM_SONG_BUFFER_WARM_COUNT) {
        void warmRandomSongBuffer(count * 2);
      }
    }

    console.log(`[random-songs] Buffer check: isLoadMore=${isLoadMore}, genreFilters.length=${genreFilters.length}, will use buffer=${isLoadMore && !genreFilters.length}`);

    if (isLoadMore && !genreFilters.length) {
      // First try the buffer for truly random songs
      const buffered = bufferTake(count);
      if (buffered && buffered.length === count) {
        console.log(`[random-songs] Served ${count} songs from buffer (unique artists: ${bufferUniqueArtistCount()})`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        void warmRandomSongBuffer(count * 2);
        return res.json({ ok: true, items: mapRecordsToItems(buffered), total: buffered.length });
      }

      // Buffer doesn't have enough, fall through to fetch random songs from FileMaker
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    let batch;
    try {
      batch = await fetchRandomSongsBatch({
        count,
        mode: isLoadMore ? 'loadMore' : 'initial',
        cacheSlot,
        genreFilters
      });
    } catch (err) {
      if (!isAbortError(err)) throw err;
      console.warn('[random-songs] Primary fetch aborted; falling back to legacy implementation');
      batch = await fetchRandomSongsLegacy({
        count,
        isLoadMore,
        cacheSlot,
        genreFilters
      });
    }

    if (!batch.selected.length) {
      console.warn('[random-songs] Primary fetch returned no songs; falling back to legacy implementation');
      batch = await fetchRandomSongsLegacy({
        count,
        isLoadMore,
        cacheSlot,
        genreFilters
      });
    }

    if (!batch.selected.length) {
      console.warn('[random-songs] Legacy fallback also returned no songs');
      const emptyResult = { ok: true, items: [], total: 0 };
      if (!isLoadMore && cacheKey) {
        res.setHeader('Cache-Control', 'public, max-age=5');
        searchCache.set(cacheKey, emptyResult);
      }
      return res.json(emptyResult);
    }

    if (batch.extras && batch.extras.length) {
      bufferAddRecords(batch.extras);
    }

    const items = mapRecordsToItems(batch.selected);
    const result = { ok: true, items, total: items.length };

    if (!isLoadMore && cacheKey && !genreFilters.length) {
      searchCache.set(cacheKey, result);
      res.setHeader('X-Cache-Hit', 'false');
      res.setHeader('Cache-Control', 'public, max-age=30');
      console.log(`[CACHE MISS] random-songs - cached result (offset ${batch.meta?.randomOffset ?? 'n/a'})`);
    } else if (isLoadMore) {
      console.log(`[LOAD MORE] Fetched ${items.length} songs (offset ${batch.meta?.randomOffset ?? 'n/a'}, limit ${batch.meta?.fetchLimit ?? 'n/a'})`);
    }

    if (!genreFilters.length) {
      updatePersistedRandomSongs(items);
      if (bufferUniqueArtistCount() < RANDOM_SONG_BUFFER_WARM_COUNT) {
        void warmRandomSongBuffer(count * 2);
      }
    }

    return res.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      if (!res.headersSent && err.meta?.headers) {
        for (const [key, value] of Object.entries(err.meta.headers)) {
          res.setHeader(key, value);
        }
      }
      return res.status(err.status).json(err.body);
    }
    const detail = err?.message || String(err);
    return res.status(500).json({ error: 'Random songs failed', status: 500, detail });
  }
});

/* ========= Missing Audio Songs: Get random songs WITHOUT valid audio ========= */
app.get('/api/missing-audio-songs', async (req, res) => {
  try {
    const count = Math.max(1, Math.min(50, parseInt(req.query.count || '12', 10)));

    await ensureToken();

    // Fetch with random offset to show different missing audio songs each time
    const fetchLimit = count * 20; // Fetch more since we're filtering for missing audio
    const maxOffset = 10000;
    const randomOffset = Math.floor(Math.random() * maxOffset) + 1;

    console.log(`[missing-audio-songs] Fetching ${fetchLimit} records from offset ${randomOffset}`);

    const json = await fmFindRecords(FM_LAYOUT, [{ 'Album Title': '*' }], {
      limit: fetchLimit,
      offset: randomOffset
    });

    const rawData = json?.data || [];
    console.log(`[missing-audio-songs] Fetched ${rawData.length} total records`);

    // Filter for records WITHOUT valid audio
    const missingAudioRecords = rawData.filter(record => {
      const fields = record.fieldData || {};
      const hasAudio = hasValidAudio(fields);
      return !hasAudio;
    });

    console.log(`[missing-audio-songs] Found ${missingAudioRecords.length} songs without audio out of ${rawData.length} total`);

    // Shuffle and take requested count
    const shuffled = missingAudioRecords.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);

    // Map to items format
    const items = selected.map(record => ({
      recordId: record.recordId,
      modId: record.modId,
      fields: record.fieldData || {}
    }));

    console.log(`[missing-audio-songs] Returning ${items.length} songs`);

    return res.json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error('[missing-audio-songs] Error:', err);
    const detail = err?.message || String(err);
    return res.status(500).json({ error: 'Missing audio songs failed', status: 500, detail });
  }
});

/* ========= Album: fetch full tracklist =========*/
app.get('/api/album', async (req, res) => {
  try {
    const cat = (req.query.cat || '').toString().trim();
    const title = (req.query.title || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '100', 10)));

    // Check cache
    const cacheKey = `album:${cat}:${title}:${artist}:${limit}`;
    const cached = albumCache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] album: ${cacheKey.slice(0, 50)}...`);
      res.setHeader('X-Cache-Hit', 'true');
      return res.json(cached);
    }

    let queries = [];
    const exact = (v) => `==${v}`;

    if (cat) {
      const seenFields = new Set();
      queries = [];
      for (const field of CATALOGUE_FIELD_CANDIDATES) {
        if (!field || seenFields.has(field)) continue;
        seenFields.add(field);
        queries.push({ [field]: exact(cat) });
      }
    } else if (title) {
      if (artist) {
        queries = [
          { 'Album Title': exact(title), 'Album Artist': exact(artist) },
          { 'Tape Files::Album_Title': exact(title), 'Tape Files::Album Artist': exact(artist) }
        ];
      } else {
        queries = [
          { 'Album Title': exact(title) },
          { 'Tape Files::Album_Title': exact(title) }
        ];
      }
    } else {
      return res.status(400).json({ error: 'Missing cat or title' });
    }

    const payload = { query: queries, limit, offset: 1 };
    const r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = json?.messages?.[0]?.message || 'FM error';
      const code = json?.messages?.[0]?.code;
      const httpStatus = fmErrorToHttpStatus(code, r.status);
      return res.status(httpStatus).json({ error: 'Album lookup failed', status: httpStatus, detail: `${msg} (FM ${code})` });
    }

    const rawData = json?.response?.data || [];

    // Filter to only include records with valid audio
    const data = rawData.filter(d => hasValidAudio(d.fieldData || {}));

    // Get the actual total count from FileMaker (before filtering)
    const actualTotal = json?.response?.dataInfo?.foundCount ?? rawData.length;

    const response = {
      ok: true,
      items: data.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
      total: actualTotal,
      offset: 0, // This endpoint doesn't use pagination (returns all tracks for an album)
      limit
    };

    // Cache the response
    albumCache.set(cacheKey, response);
    return res.json(response);
  } catch (err) {
    const detail = err?.message || String(err);
    return res.status(500).json({ error: 'Album lookup failed', status: 500, detail });
  }
});

if (FM_HOST && FM_DB && FM_USER && FM_PASS) {
  try {
    await ensureToken();
    console.log('[MASS] FileMaker token primed');
  } catch (err) {
    console.warn('[MASS] Initial FileMaker login failed:', err?.message || err);
  }
} else {
  console.warn('[MASS] Skipping initial FileMaker login; missing FM environment variables');
}

if (!randomSongPersistedCache.items.length) {
  try {
    await ensureRandomSongSeed();
  } catch (err) {
    console.warn('[random-songs] Initial seed failed', err);
  }
}

// Load access tokens on server startup
try {
  await loadAccessTokens();
  console.log('[MASS] Access tokens loaded successfully');
} catch (err) {
  console.warn('[MASS] Failed to load access tokens:', err);
}

// Pre-warm FileMaker connection pool
async function warmConnections() {
  console.log('[MASS] Warming FileMaker connections...');
  try {
    await ensureToken();
    // Make a lightweight query to fully establish the connection
    await fmFindRecords(FM_LAYOUT, [{ 'Album Title': '*' }], { limit: 1 });
    console.log('[MASS] FileMaker connection warmed successfully');
  } catch (err) {
    console.warn('[MASS] Connection warm-up failed:', err.message);
  }
}

// Call warmConnections before starting the server
await warmConnections();

app.listen(PORT, HOST, () => {
  console.log(`[MASS] listening on http://${HOST}:${PORT}`);
  console.log(`[MASS] Rate limits: ${isDevelopment ? 'DEVELOPMENT (relaxed)' : 'PRODUCTION (strict)'}`);
  if (isDevelopment) {
    console.log(`[MASS] - API: 1000 req/15min, Explore: 500 req/5min`);
  }
});
