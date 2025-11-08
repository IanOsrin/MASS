import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fetch } from 'undici';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { searchCache, exploreCache, albumCache, publicPlaylistsCache } from './cache.js';
const { AbortController } = globalThis;

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

const FM_TIMEOUT_MS = parsePositiveInt(process.env.FM_TIMEOUT_MS, 45000);
const fmDefaultFetchOptions = { timeoutMs: FM_TIMEOUT_MS, retries: 1 };

function fmSafeFetch(url, options, overrides = {}) {
  const finalOptions = { ...fmDefaultFetchOptions, ...overrides };
  return safeFetch(url, options, finalOptions);
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

app.use(compression()); // Enable gzip compression
app.use(express.json());

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for static files
    return req.path.startsWith('/public/') || req.path === '/';
  }
});

const expensiveLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 requests per window
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

// Add Cache-Control headers for API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // Set cache headers for API responses
    res.setHeader('Cache-Control', 'public, max-age=180'); // 3 minutes browser cache
  }
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ========= ENV ========= */
const FM_HOST = process.env.FM_HOST;
const FM_DB = process.env.FM_DB;
const FM_USER = process.env.FM_USER;
const FM_PASS = process.env.FM_PASS;
const FM_LAYOUT = process.env.FM_LAYOUT || 'API_Album_Songs';
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const FM_USERS_LAYOUT = process.env.FM_USERS_LAYOUT || 'API_Users';
const FM_STREAM_EVENTS_LAYOUT = process.env.FM_STREAM_EVENTS_LAYOUT || 'Stream_Events';
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
const fallbackAuthSecretPath = path.join(DATA_DIR, '.auth_secret');
const RANDOM_SONG_CACHE_PATH = path.join(DATA_DIR, 'random-songs-cache.json');
const RANDOM_SONG_SEED_LOCK_PATH = path.join(DATA_DIR, '.random-songs-cache.lock');

let randomSongPersistedCache = { items: [], updatedAt: 0 };
let playlistSeedCache = { items: [], updatedAt: 0 };
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
const REGEX_STATIC_FILES = /\.(jpg|jpeg|png|gif|svg|webp|woff|woff2|ttf|eot)$/i;
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

function applyVisibility(query = {}) {
  if (!FM_VISIBILITY_FIELD) return { ...query };
  return { ...query, [FM_VISIBILITY_FIELD]: FM_VISIBILITY_VALUE };
}

function shouldFallbackVisibility(json) {
  const code = json?.messages?.[0]?.code;
  return code === '102' || code === '121';
}

function recordIsVisible(fields = {}) {
  if (!FM_VISIBILITY_FIELD) return true;
  const raw = fields[FM_VISIBILITY_FIELD] ?? fields['Tape Files::Visibility'];
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return true;
  return value === FM_VISIBILITY_VALUE_LC;
}

const DEFAULT_AUDIO_FIELDS = ['mp3', 'MP3'];
const AUDIO_FIELD_CANDIDATES = ['mp3', 'MP3'];
const ARTWORK_FIELD_CANDIDATES = ['Artwork::Picture', 'Artwork Picture', 'Picture'];

const PUBLIC_PLAYLIST_LAYOUT = 'API_Album_Songs';
const PLAYLIST_IMAGE_EXTS = ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.svg'];
const PLAYLIST_IMAGE_DIR = path.join(PUBLIC_DIR, 'img', 'Playlists');
const playlistImageCache = new Map();

let playlistsCache = { data: null, mtimeMs: 0 };
const loggedPublicPlaylistFieldErrors = new Set();

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

const RETRYABLE_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT']);
const RETRYABLE_NAMES = new Set(['AbortError']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

app.post('/api/stream-events', async (req, res) => {
  try {
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
      UserAgent: userAgent
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
      LastEventUTC: timestamp
    };

    if (STREAM_EVENT_DEBUG) {
      console.info('[MASS] stream event logging', {
        eventType: baseFields.EventType,
        sessionId,
        trackRecordId: normalizedTrackRecordId,
        timeStreamed: baseFields[STREAM_TIME_FIELD],
        deltaSec: baseFields.DeltaSec
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
// Serve static files with caching for images only, not JS/HTML for easier development
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    // Cache images and fonts for 1 hour
    if (REGEX_STATIC_FILES.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else {
      // Don't cache HTML/JS/CSS files for development
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
  etag: true,
  lastModified: true
}));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ========= Search ========= */
const SEARCH_FIELDS_BASE = ['Album Artist', 'Album Title', 'Track Name'];
const SEARCH_FIELDS_OPTIONAL = [
  'Year of Release',
  'Local Genre',
  'Language',
  'Language Code',
  'Tape Files::Album Artist',
  'Tape Files::Album_Title',
  'Track Artist'
];
const SEARCH_FIELDS_DEFAULT = [...SEARCH_FIELDS_BASE, ...SEARCH_FIELDS_OPTIONAL];

const ARTIST_FIELDS_BASE = ['Album Artist'];
const ARTIST_FIELDS_OPTIONAL = ['Tape Files::Album Artist', 'Track Artist'];
const ALBUM_FIELDS_BASE = ['Album Title'];
const ALBUM_FIELDS_OPTIONAL = ['Tape Files::Album_Title'];
const TRACK_FIELDS_BASE = ['Track Name'];
const TRACK_FIELDS_OPTIONAL = [];

const listSearchFields = (base, optional, includeOptional) =>
  includeOptional ? [...base, ...optional] : base;

function buildSearchQueries({ q, artist, album, track }, includeOptionalFields) {
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
  const artistFields = listSearchFields(ARTIST_FIELDS_BASE, ARTIST_FIELDS_OPTIONAL, includeOptionalFields);
  const albumFields = listSearchFields(ALBUM_FIELDS_BASE, ALBUM_FIELDS_OPTIONAL, includeOptionalFields);
  const trackFields = listSearchFields(TRACK_FIELDS_BASE, TRACK_FIELDS_OPTIONAL, includeOptionalFields);

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
      const limitResult = validators.limit(req.query.limit, 300);
      if (!limitResult.valid) validationErrors.limit = limitResult.error;
    }
    if (req.query.offset) {
      const offsetResult = validators.offset(req.query.offset);
      if (!offsetResult.valid) validationErrors.offset = offsetResult.error;
    }
    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json({ error: 'Invalid input', details: validationErrors });
    }

    const q = (req.query.q || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const album = (req.query.album || '').toString().trim();
    const track = (req.query.track || '').toString().trim();
    const limit = Math.max(1, Math.min(300, parseInt(req.query.limit || '30', 10)));
    const uiOff0 = Math.max(0, parseInt(req.query.offset || '0', 10));
    const fmOff = uiOff0 + 1;

    // Check cache
    const cacheKey = `search:${q}:${artist}:${album}:${track}:${limit}:${uiOff0}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] search: ${cacheKey.slice(0, 50)}...`);
      res.setHeader('X-Cache-Hit', 'true');
      return res.json(cached);
    }

    const makePayload = (includeOptionalFields) => ({
      query: buildSearchQueries({ q, artist, album, track }, includeOptionalFields),
      limit,
      offset: fmOff
    });

    const runSearch = async (includeOptionalFields) => {
      const payload = makePayload(includeOptionalFields);
      const response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
      const json = await response.json().catch(() => ({}));
      return { response, json };
    };

    let attempt = await runSearch(true);

    if (!attempt.response.ok) {
      const code = attempt.json?.messages?.[0]?.code;
      if (code === '102') {
        attempt = await runSearch(false);
      }
    }

    if (!attempt.response.ok) {
      const msg = attempt.json?.messages?.[0]?.message || 'FM error';
      const code = attempt.json?.messages?.[0]?.code;
      return res
        .status(500)
        .json({ error: 'Album search failed', status: attempt.response.status, detail: `${msg} (${code})` });
    }

    const rawData = attempt.json?.response?.data || [];

    // Filter to only include records with valid audio
    const data = rawData.filter(record => hasValidAudio(record.fieldData || {}));

    const total = attempt.json?.response?.dataInfo?.foundCount ?? data.length;

    // Deduplicate by album to ensure diverse results
    // Group tracks by album key and keep representative tracks from each
    const albumMap = new Map();
    const MIN_ALBUMS = 8;

    for (const record of data) {
      const fields = record.fieldData || {};
      const catalogue = firstNonEmptyFast(fields, ['Album Catalogue Number', 'Album Catalog Number', 'Catalogue', 'Tape Files::Album Catalogue Number']);
      const albumTitle = firstNonEmptyFast(fields, ['Album Title', 'Tape Files::Album_Title', 'Tape Files::Album Title']);
      const albumArtist = firstNonEmptyFast(fields, ['Album Artist', 'Tape Files::Album Artist', 'Artist']);

      const albumKey = makeAlbumKey(catalogue, albumTitle, albumArtist);

      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, []);
      }
      albumMap.get(albumKey).push(record);
    }

    // If we have fewer unique albums than MIN_ALBUMS and this is the first page,
    // return all tracks to maximize grouping on frontend
    // Otherwise, return one representative track per album for diverse results
    let finalData;
    if (uiOff0 === 0 && albumMap.size < MIN_ALBUMS) {
      // Return all tracks - not enough unique albums
      finalData = data;
    } else {
      // Return up to 3 tracks per album to ensure frontend has enough data
      // while keeping results diverse
      finalData = [];
      for (const tracks of albumMap.values()) {
        finalData.push(...tracks.slice(0, 3));
      }
    }

    const response = {
      items: finalData.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
      total,
      offset: uiOff0,
      limit
    };

    // Cache the response
    searchCache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    const detail = err?.response?.data?.messages?.[0]?.message || err?.message || String(err);
    res.status(500).json({ error: 'Album search failed', status: 500, detail });
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
      const catalogue = firstNonEmptyFast(fields, ['Album Catalogue Number', 'Album Catalog Number', 'Album Catalogue No', 'Tape Files::Album Catalogue Number', 'Catalogue']);
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

    const artist = resolveArtist(record.fieldData || {});
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

function getPersistedRandomSongs(count) {
  if (!randomSongPersistedCache.items.length) return null;
  if (Date.now() - randomSongPersistedCache.updatedAt > RANDOM_SONG_PERSIST_MAX_AGE_MS) {
    return null;
  }

  // Validate that cached items still have valid audio (container URLs might have expired)
  const validItems = randomSongPersistedCache.items.filter(item => {
    const fields = item?.fields || {};
    return hasValidAudio(fields);
  });

  if (validItems.length < count) {
    console.log(`[random-songs] Persisted cache has only ${validItems.length}/${randomSongPersistedCache.items.length} valid items (need ${count}), refreshing...`);
    return null;
  }

  const items = cloneRandomSongItems(validItems, count);
  return { ok: true, items, total: items.length };
}

function updatePersistedRandomSongs(items = []) {
  if (!Array.isArray(items) || !items.length) return;
  const trimmed = cloneRandomSongItems(items, RANDOM_SONG_PERSIST_MAX_ITEMS);
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
    const playlistSeed = await buildPlaylistSeedItems(seedCount);
    if (playlistSeed.length) {
      updatePersistedRandomSongs(playlistSeed);
      if (randomSongPersistWritePromise) {
        await randomSongPersistWritePromise;
      }
      console.log(`[random-songs] Seeded persisted cache with ${playlistSeed.length} playlist tracks`);
    } else {
      console.warn('[random-songs] No playlist seed available for initial cache');
    }

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

async function buildPlaylistSeedItems(count) {
  const now = Date.now();
  if (
    playlistSeedCache.items.length >= count &&
    now - playlistSeedCache.updatedAt < PLAYLIST_SEED_CACHE_TTL_MS
  ) {
    // Validate cached playlist seed items still have valid audio
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

  shuffleArray(collected);
  playlistSeedCache = { items: collected, updatedAt: now };
  return cloneRandomSongItems(collected, count);
}

async function fetchRandomSongsBatch({ count, mode = 'loadMore', cacheSlot = null }) {
  const maxOffset = 5000;
  const fetchLimit = Math.min(120, Math.max(count * 5, 30));
  const baseQuery = { 'Album Title': '*' };

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

  const runQuery = async (offset) => {
    let queryWithVisibility = [applyVisibility(baseQuery)];
    let r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
      query: queryWithVisibility,
      limit: fetchLimit,
      offset
    });
    let json = await r.json().catch(() => ({}));

    if (!r.ok && shouldFallbackVisibility(json)) {
      console.warn('[random-songs] Visibility field not available; retrying without filter');
      queryWithVisibility = [baseQuery];
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
      throw new HttpError(500, { error: 'Random songs failed', status: r.status, detail: `${msg} (${code})` }, { offset, fetchLimit });
    }

    const rawData = json?.response?.data || [];
    return rawData.filter(record => recordIsVisible(record.fieldData || {}));
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

async function fetchRandomSongsLegacy({ count, isLoadMore, cacheSlot }) {
  const maxOffset = 5000;
  let randomOffset;
  if (!isLoadMore && typeof cacheSlot === 'number') {
    randomOffset = (cacheSlot % maxOffset) + 1;
  } else {
    randomOffset = Math.floor(Math.random() * maxOffset) + 1;
  }

  const fetchLimit = Math.min(60, count * 4);
  const baseQuery = { 'Album Title': '*' };

  let queryWithVisibility = [applyVisibility(baseQuery)];
  let response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
    query: queryWithVisibility,
    limit: fetchLimit,
    offset: randomOffset
  });
  let json = await response.json().catch(() => ({}));

  if (!response.ok && shouldFallbackVisibility(json)) {
    console.warn('[random-songs] Visibility field not available; retrying without filter (legacy)');
    queryWithVisibility = [baseQuery];
    response = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
      query: queryWithVisibility,
      limit: fetchLimit,
      offset: randomOffset
    });
    json = await response.json().catch(() => ({}));
  }

  if (!response.ok) {
    const msg = json?.messages?.[0]?.message || 'FM error';
    const code = json?.messages?.[0]?.code;
    throw new HttpError(500, { error: 'Random songs failed', status: response.status, detail: `${msg} (${code})` }, { offset: randomOffset, fetchLimit });
  }

  let rawData = json?.response?.data || [];
  let visible = rawData.filter(record => recordIsVisible(record.fieldData || {}));

  if (!visible.length) {
    console.warn(`[random-songs] Legacy fetch empty at offset ${randomOffset}, retrying from start`);
    const retryPayload = {
      query: [applyVisibility(baseQuery)],
      limit: fetchLimit,
      offset: 1
    };
    const retryResponse = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, retryPayload);
    const retryJson = await retryResponse.json().catch(() => ({}));
    if (retryResponse.ok) {
      rawData = retryJson?.response?.data || [];
      visible = rawData.filter(record => recordIsVisible(record.fieldData || {}));
    } else {
      console.warn('[random-songs] Legacy retry fetch failed', retryJson?.messages?.[0]);
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
    let secondQueryUsesVisibility = Boolean(FM_VISIBILITY_FIELD);
    let secondQueryPayload = {
      query: [secondQueryUsesVisibility ? applyVisibility(baseQuery) : baseQuery],
      limit: fetchLimit,
      offset: additionalOffset
    };

    let secondResponse = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, secondQueryPayload);
    let secondJson = await secondResponse.json().catch(() => ({}));
    if (!secondResponse.ok && secondQueryUsesVisibility && shouldFallbackVisibility(secondJson)) {
      console.warn('[random-songs] Visibility field not available for legacy retry; retrying without filter');
      secondQueryUsesVisibility = false;
      secondQueryPayload = {
        query: [baseQuery],
        limit: fetchLimit,
        offset: additionalOffset
      };
      secondResponse = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, secondQueryPayload);
      secondJson = await secondResponse.json().catch(() => ({}));
    }

    if (secondResponse.ok) {
      let additionalRawData = secondJson?.response?.data || [];
      if (secondQueryUsesVisibility) {
        additionalRawData = additionalRawData.filter(record => recordIsVisible(record.fieldData || {}));
      }
      const shuffledTracks = shuffleArray(additionalRawData.slice());

      for (const track of shuffledTracks) {
        if (selected.length >= count) break;
        const artist = resolveArtist(track.fieldData || {});
        if (usedArtists.has(artist) || selectedIds.has(track.recordId)) continue;
        selected.push(track);
        selectedIds.add(track.recordId);
        usedArtists.add(artist);
      }
    } else {
      console.warn('[random-songs] Legacy secondary fetch failed', secondJson?.messages?.[0]);
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
    const artist = resolveArtist(record.fieldData || {});
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

    // If _t parameter is present, user clicked "Load More" - bypass cache for fresh songs
    const isLoadMore = !!req.query._t;
    const cacheSlot = !isLoadMore ? Math.floor(Date.now() / 30000) : null;
    const cacheKey = computeCacheKey(count, cacheSlot);

    if (!isLoadMore && cacheKey) {
      const cached = searchCache.get(cacheKey);
      if (cached) {
        console.log('[CACHE HIT] random-songs (30s window)');
        res.setHeader('X-Cache-Hit', 'true');
        res.setHeader('Cache-Control', 'public, max-age=30');
        return res.json(cached);
      }
    }

    if (!isLoadMore) {
      const persisted = getPersistedRandomSongs(count);
      if (persisted) {
        console.log('[random-songs] Served initial songs from persisted cache');
        res.setHeader('X-Cache-Hit', 'persisted');
        res.setHeader('Cache-Control', 'public, max-age=15');
        void refreshRandomSongsInBackground({ count, cacheSlot });
        if (bufferUniqueArtistCount() < RANDOM_SONG_BUFFER_WARM_COUNT) {
          void warmRandomSongBuffer(count * 2);
        }
        return res.json(persisted);
      }

      const playlistSeed = await buildPlaylistSeedItems(count);
      if (playlistSeed.length) {
        console.log('[random-songs] Served initial songs from playlist seed');
        updatePersistedRandomSongs(playlistSeed);
        res.setHeader('X-Cache-Hit', 'playlist-seed');
        res.setHeader('Cache-Control', 'public, max-age=15');
        void refreshRandomSongsInBackground({ count, cacheSlot });
        if (bufferUniqueArtistCount() < RANDOM_SONG_BUFFER_WARM_COUNT) {
          void warmRandomSongBuffer(count * 2);
        }
        return res.json({ ok: true, items: cloneRandomSongItems(playlistSeed, count), total: Math.min(count, playlistSeed.length) });
      }
    }

    if (isLoadMore) {
      const buffered = bufferTake(count);
      if (buffered && buffered.length === count) {
        console.log(`[random-songs] Served ${count} songs from buffer (unique artists: ${bufferUniqueArtistCount()})`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        void warmRandomSongBuffer(count * 2);
        return res.json({ ok: true, items: mapRecordsToItems(buffered), total: buffered.length });
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    let batch;
    try {
      batch = await fetchRandomSongsBatch({
        count,
        mode: isLoadMore ? 'loadMore' : 'initial',
        cacheSlot
      });
    } catch (err) {
      if (!isAbortError(err)) throw err;
      console.warn('[random-songs] Primary fetch aborted; falling back to legacy implementation');
      batch = await fetchRandomSongsLegacy({
        count,
        isLoadMore,
        cacheSlot
      });
    }

    if (!batch.selected.length) {
      console.warn('[random-songs] Primary fetch returned no songs; falling back to legacy implementation');
      batch = await fetchRandomSongsLegacy({
        count,
        isLoadMore,
        cacheSlot
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

    if (!isLoadMore && cacheKey) {
      searchCache.set(cacheKey, result);
      res.setHeader('X-Cache-Hit', 'false');
      res.setHeader('Cache-Control', 'public, max-age=30');
      console.log(`[CACHE MISS] random-songs - cached result (offset ${batch.meta?.randomOffset ?? 'n/a'})`);
    }

    if (isLoadMore) {
      console.log(`[LOAD MORE] Fetched ${items.length} songs (offset ${batch.meta?.randomOffset ?? 'n/a'}, limit ${batch.meta?.fetchLimit ?? 'n/a'})`);
    }

    updatePersistedRandomSongs(items);
    if (bufferUniqueArtistCount() < RANDOM_SONG_BUFFER_WARM_COUNT) {
      void warmRandomSongBuffer(count * 2);
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
      queries = [
        { 'Album Catalogue Number': exact(cat) },
        { 'Album Catalog Number': exact(cat) },
        { 'Album Catalogue No': exact(cat) }
      ];
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
      return res.status(500).json({ error: 'Album lookup failed', status: r.status, detail: `${msg} (${code})` });
    }

    const rawData = json?.response?.data || [];

    // Filter to only include records with valid audio
    const data = rawData.filter(d => hasValidAudio(d.fieldData || {}));

    const total = data.length;

    const response = {
      ok: true,
      items: data.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
      total,
      offset: 0,
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

app.listen(PORT, HOST, () => {
  console.log(`[MASS] listening on http://${HOST}:${PORT}`);
});
