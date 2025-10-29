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

const app = express();
app.set('trust proxy', true);

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
const MASS_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const STREAM_EVENT_TYPES = new Set(['PLAY', 'PROGRESS', 'PAUSE', 'SEEK', 'END', 'ERROR']);
const STREAM_TERMINAL_EVENTS = new Set(['END', 'ERROR']);
const STREAM_TIME_FIELD = 'TimeStreamed';
const STREAM_TIME_FIELD_LEGACY = 'PositionSec';

const STREAM_RECORD_CACHE_TTL_MS = 30 * 60 * 1000;
const streamRecordCache = new Map();

const AUTH_SECRET = process.env.AUTH_SECRET || 'development-secret-change-me';
if (!process.env.AUTH_SECRET) {
  console.warn('[MASS] AUTH_SECRET not set; falling back to insecure development secret');
}
const AUTH_COOKIE_NAME = 'mass_session';
const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const PLAYLISTS_PATH = path.join(DATA_DIR, 'playlists.json');
const DEFAULT_AUDIO_FIELDS = ['mp3', 'MP3', 'Audio File', 'Audio::mp3'];
const AUDIO_FIELD_CANDIDATES = ['mp3', 'MP3', 'Audio File', 'Audio::mp3'];
const ARTWORK_FIELD_CANDIDATES = ['Artwork::Picture', 'Artwork Picture', 'Picture'];
const PUBLIC_PLAYLIST_FIELDS = [
  'PublicPlaylist',
  'Public Playlist',
  'Tape Files::PublicPlaylist',
  'Tape Files::Public Playlist',
  'Public_Playlist',
  'Playlist Name',
  'Playlist::Public'
];
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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeShareId = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const generateShareId = () => {
  if (typeof randomUUID === 'function') {
    return randomUUID().replace(/-/g, '');
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
  const res = await safeFetch(`${fmBase}/sessions`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${FM_USER}:${FM_PASS}`).toString('base64')
    },
    body: JSON.stringify({})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.messages?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`FM login failed: ${msg}`);
  }
  const token = json?.response?.token;
  if (!token) throw new Error('FM login returned no token');
  fmToken = token;
  fmTokenExpiresAt = Date.now() + 12 * 60 * 1000;
  return fmToken;
}

async function ensureToken() {
  if (!fmToken || Date.now() > fmTokenExpiresAt) {
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

  let res = await safeFetch(url, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(body)
  });

  if (res.status === 401) {
    await fmLogin();
    res = await safeFetch(url, {
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

  let res = await safeFetch(u, { headers, signal }, { timeoutMs: 30000, retries: 1 });
  if (res.status === 401 && typeof u === 'string' && u.startsWith(FM_HOST)) {
    await fmLogin();
    headers.set('Authorization', `Bearer ${fmToken}`);
    res = await safeFetch(u, { headers, signal }, { timeoutMs: 30000, retries: 1 });
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

  let res = await safeFetch(url, {
    method: 'POST',
    headers: makeHeaders(),
    body: JSON.stringify({ fieldData })
  });

  if (res.status === 401) {
    await fmLogin();
    res = await safeFetch(url, {
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

  let res = await safeFetch(url, {
    method: 'PATCH',
    headers: makeHeaders(),
    body: JSON.stringify({ fieldData })
  });

  if (res.status === 401) {
    await fmLogin();
    res = await safeFetch(url, {
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

  let res = await safeFetch(url, { method: 'GET', headers: makeHeaders() });

  if (res.status === 401) {
    await fmLogin();
    res = await safeFetch(url, { method: 'GET', headers: makeHeaders() });
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

const normalizeFieldKey = (name) => (typeof name === 'string' ? name.replace(/[^a-z0-9]/gi, '').toLowerCase() : '');

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
  if (/^https?:\/\//i.test(src)) return `/api/container?u=${encodeURIComponent(src)}`;
  if (src.startsWith('/')) return src;
  return `/api/container?u=${encodeURIComponent(src)}`;
}

function hasValidAudio(fields) {
  if (!fields || typeof fields !== 'object') return false;
  const audioInfo = pickFieldValueCaseInsensitive(fields, AUDIO_FIELD_CANDIDATES);
  if (!audioInfo.value) return false;
  const resolvedSrc = resolvePlayableSrc(audioInfo.value);
  return resolvedSrc !== '';
}

function resolveArtworkSrc(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const src = raw.trim();
  if (!src) return '';
  if (src.startsWith('/api/container?') || /^https?:\/\//i.test(src)) return src;
  return `/api/container?u=${encodeURIComponent(src)}`;
}

function normTitle(str) {
  return String(str || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/^\W+|\W+$/g, '')
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
    const cleaned = Number(str.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(cleaned)) return cleaned;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const lower = key.toLowerCase();
    if (!/(track|song)/.test(lower)) continue;
    if (!/(no|num|#|seq|order|pos)/.test(lower)) continue;
    const str = String(value).trim();
    if (!str) continue;
    const numeric = Number(str);
    if (Number.isFinite(numeric)) return numeric;
    const cleaned = Number(str.replace(/[^0-9.-]/g, ''));
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

async function fetchPublicPlaylistRecords({ limit = 600 } = {}) {
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

  for (const field of candidates) {
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
          const tableMissing = typeof msg === 'string' && /table is missing/i.test(msg);
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
        if (/table is missing/i.test(msg)) {
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
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
    if (!sessionId) {
      sessionId = randomUUID();
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

app.post('/api/auth/register', async (req, res) => {
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

app.post('/api/auth/login', async (req, res) => {
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
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!name) {
      res.status(400).json({ ok: false, error: 'Playlist name required' });
      return;
    }

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
app.use(express.static(PUBLIC_DIR));
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
    const q = (req.query.q || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const album = (req.query.album || '').toString().trim();
    const track = (req.query.track || '').toString().trim();
    const limit = Math.max(1, Math.min(300, parseInt(req.query.limit || '60', 10)));
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
      const catalogue = firstNonEmpty(fields, ['Album Catalogue Number', 'Album Catalog Number', 'Catalogue', 'Tape Files::Album Catalogue Number']);
      const albumTitle = firstNonEmpty(fields, ['Album Title', 'Tape Files::Album_Title', 'Tape Files::Album Title']);
      const albumArtist = firstNonEmpty(fields, ['Album Artist', 'Tape Files::Album Artist', 'Artist']);

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

app.get('/api/public-playlists', async (req, res) => {
  try {
    const nameParam = (req.query.name || '').toString().trim();
    const limitParam = Number.parseInt((req.query.limit || '600'), 10);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(2000, limitParam)) : 600;

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

      const trackName = firstNonEmpty(fields, ['Track Name', 'Tape Files::Track Name', 'Tape Files::Track_Name', 'Song Name', 'Song_Title', 'Title', 'Name']);
      const albumTitle = firstNonEmpty(fields, ['Album Title', 'Tape Files::Album_Title', 'Tape Files::Album Title', 'Album']);
      const albumArtist = firstNonEmpty(fields, ['Album Artist', 'Tape Files::Album Artist', 'Tape Files::Album_Artist', 'AlbumArtist', 'Artist']);
      const trackArtist = firstNonEmpty(fields, ['Track Artist', 'Tape Files::Track Artist', 'TrackArtist', 'Artist']) || albumArtist;
      const catalogue = firstNonEmpty(fields, ['Album Catalogue Number', 'Album Catalog Number', 'Album Catalogue No', 'Tape Files::Album Catalogue Number', 'Catalogue']);
      const genre = firstNonEmpty(fields, ['Local Genre', 'Tape Files::Local Genre', 'Genre']);
      const language = firstNonEmpty(fields, ['Language', 'Tape Files::Language', 'Language Code']);
      const producer = firstNonEmpty(fields, ['Producer', 'Tape Files::Producer']);

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
            isrc: firstNonEmpty(fields, ['ISRC', 'Tape Files::ISRC']) || '',
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
    upstreamUrl = `${fmBase}/records/${encodeURIComponent(rid)}/containers/${encodeURIComponent(field)}/${encodeURIComponent(rep || '1')}`;
    requiresAuth = true;
  } else if (direct) {
    upstreamUrl = direct.match(/^https?:\/\//i)
      ? direct
      : `${FM_HOST.replace(/\/?$/, '')}/${direct.replace(/^\//, '')}`;
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
app.get('/api/explore', async (req, res) => {
  try {
    const start = parseInt((req.query.start || '0'), 10);
    const end = parseInt((req.query.end || '0'), 10);
    const reqLimit = Math.max(1, Math.min(300, parseInt((req.query.limit || '200'), 10)));
    if (!start || !end || end < start) return res.status(400).json({ error: 'bad decade', start, end });

    // Note: Random offset means we cache by decade/limit but accept different random results
    // This gives variety while still caching common decade queries
    const cacheKey = `explore:${start}:${end}:${reqLimit}`;
    const cached = exploreCache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] explore: ${start}-${end}`);
      res.setHeader('X-Cache-Hit', 'true');
      return res.json(cached);
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
    for (const field of FIELDS) {
      const probe = await tryFind({ query: [{ [field]: `${start}...${end}` }], limit: 1, offset: 1 });
      if (probe.ok && probe.total > 0) {
        chosenField = field;
        break;
      }
    }
    if (!chosenField) {
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      for (const field of FIELDS) {
        const probe = await tryFind({ query: years.map((y) => ({ [field]: `==${y}` })), limit: 1, offset: 1 });
        if (probe.ok && probe.total > 0) {
          chosenField = field;
          break;
        }
      }
    }
    if (!chosenField) {
      for (const field of FIELDS) {
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
    exploreCache.set(cacheKey, response);
    return res.json(response);
  } catch (err) {
    const detail = err?.message || String(err);
    return res.status(500).json({ error: 'Explore failed', status: 500, detail });
  }
});

/* ========= Album: fetch full tracklist ========= */
app.get('/api/album', async (req, res) => {
  try {
    const cat = (req.query.cat || '').toString().trim();
    const title = (req.query.title || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '800', 10)));

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

app.listen(PORT, HOST, () => {
  console.log(`[MASS] listening on http://${HOST}:${PORT}`);
});
