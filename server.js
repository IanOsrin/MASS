import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fetch } from 'undici';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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

const AUTH_SECRET = process.env.AUTH_SECRET || 'development-secret-change-me';
if (!process.env.AUTH_SECRET) {
  console.warn('[MASS] AUTH_SECRET not set; falling back to insecure development secret');
}
const AUTH_COOKIE_NAME = 'mass_session';
const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const DATA_DIR = path.join(__dirname, 'data');
const PLAYLISTS_PATH = path.join(DATA_DIR, 'playlists.json');

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

async function fmFindRecords(layout, queries, { limit = 1, offset = 1 } = {}) {
  const r = await fmPost(`/layouts/${encodeURIComponent(layout)}/_find`, {
    query: queries,
    limit,
    offset
  });
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

function getCookies(req) {
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
  const cookies = getCookies(req);
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
    const raw = await fs.readFile(PLAYLISTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await ensureDataDir();
      await fs.writeFile(PLAYLISTS_PATH, '[]', 'utf8');
      return [];
    }
    console.warn('[MASS] Failed to read playlists file:', err);
    return [];
  }
}

async function savePlaylists(playlists) {
  try {
    await ensureDataDir();
    const payload = JSON.stringify(Array.isArray(playlists) ? playlists : [], null, 2);
    await fs.writeFile(PLAYLISTS_PATH, payload, 'utf8');
  } catch (err) {
    console.error('[MASS] Failed to write playlists file:', err);
    throw err;
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
    const playlists = await loadPlaylists();
    const mine = playlists.filter((p) => p && p.userId === user.recordId);
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
    const nameRaw = req.body?.name;
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!name) {
      res.status(400).json({ ok: false, error: 'Playlist name required' });
      return;
    }

    const now = new Date().toISOString();
    const playlists = await loadPlaylists();
    const collision = playlists.find((p) => p && p.userId === user.recordId && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
    if (collision) {
      res.status(409).json({ ok: false, error: 'You already have a playlist with that name', playlist: collision });
      return;
    }

    const playlist = {
      id: randomUUID(),
      userId: user.recordId,
      userEmail: user.email,
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
    const playlistId = req.params?.playlistId;
    if (!playlistId) {
      res.status(400).json({ ok: false, error: 'Playlist ID required' });
      return;
    }

    const payload = req.body?.track || {};
    const recordId = typeof payload.recordId === 'string' ? payload.recordId.trim() : '';
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const albumTitle = typeof payload.albumTitle === 'string' ? payload.albumTitle.trim() : '';
    const albumArtist = typeof payload.albumArtist === 'string' ? payload.albumArtist.trim() : '';

    if (!name) {
      res.status(400).json({ ok: false, error: 'Track name required' });
      return;
    }

    const playlists = await loadPlaylists();
    const index = playlists.findIndex((p) => p && p.id === playlistId && p.userId === user.recordId);
    if (index === -1) {
      res.status(404).json({ ok: false, error: 'Playlist not found' });
      return;
    }

    const playlist = playlists[index];
    const duplicate = playlist.tracks?.find((t) => t && ((recordId && t.trackRecordId === recordId) || (t.name === name && t.albumTitle === albumTitle && t.albumArtist === albumArtist)));
    if (duplicate) {
      res.status(200).json({ ok: true, playlist, track: duplicate, duplicate: true });
      return;
    }

    const now = new Date().toISOString();
    const entry = {
      id: randomUUID(),
      trackRecordId: recordId || null,
      name,
      albumTitle,
      albumArtist,
      catalogue: typeof payload.catalogue === 'string' ? payload.catalogue.trim() : '',
      trackArtist: typeof payload.trackArtist === 'string' ? payload.trackArtist.trim() : '',
      mp3: typeof payload.mp3 === 'string' ? payload.mp3.trim() : '',
      resolvedSrc: typeof payload.resolvedSrc === 'string' ? payload.resolvedSrc.trim() : '',
      seq: typeof payload.seq === 'number' && Number.isFinite(payload.seq) ? payload.seq : null,
      artwork: typeof payload.artwork === 'string' ? payload.artwork.trim() : '',
      addedAt: now
    };

    playlist.tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    playlist.tracks.push(entry);
    playlist.updatedAt = now;

    playlists[index] = playlist;
    await savePlaylists(playlists);

    res.status(201).json({ ok: true, playlist, track: entry });
  } catch (err) {
    console.error('[MASS] Add track to playlist failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to add track' });
  }
});

app.delete('/api/playlists/:playlistId', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const playlistId = req.params?.playlistId;
    if (!playlistId) {
      res.status(400).json({ ok: false, error: 'Playlist ID required' });
      return;
    }

    const playlists = await loadPlaylists();
    const index = playlists.findIndex((p) => p && p.id === playlistId && p.userId === user.recordId);
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

/* ========= Static site ========= */
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ========= Search ========= */
const SEARCH_FIELDS = [
  'Album Artist',
  'Album Title',
  'Track Name',
  'Year of Release',
  'Local Genre',
  'Language',
  'Language Code',
  'Tape Files::Album Artist',
  'Tape Files::Album_Title',
  'Track Artist'
];

const begins = (s) => (s ? `${s}*` : '');

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const album = (req.query.album || '').toString().trim();
    const track = (req.query.track || '').toString().trim();
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '60', 10)));
    const uiOff0 = Math.max(0, parseInt(req.query.offset || '0', 10));
    const fmOff = uiOff0 + 1;

    let queries = [];
    if (artist || album || track) {
      let combos = [{}];
      const extend = (arr, make) => {
        const out = [];
        for (const base of arr) {
          const vs = make(base);
          if (Array.isArray(vs)) out.push(...vs);
          else out.push(vs);
        }
        return out;
      };
      if (artist) {
        combos = extend(combos, (b) => [
          { ...b, ['Album Artist']: begins(artist) },
          { ...b, ['Tape Files::Album Artist']: begins(artist) },
          { ...b, ['Track Artist']: begins(artist) }
        ]);
      }
      if (album) {
        combos = extend(combos, (b) => [
          { ...b, ['Album Title']: begins(album) },
          { ...b, ['Tape Files::Album_Title']: begins(album) }
        ]);
      }
      if (track) {
        combos = extend(combos, (b) => [
          { ...b, ['Track Name']: begins(track) }
        ]);
      }
      queries = combos;
    } else if (q) {
      const needle = begins(q);
      queries = SEARCH_FIELDS.map((field) => ({ [field]: needle }));
    } else {
      queries = [{ 'Album Title': '*' }];
    }

    const payload = { query: queries, limit, offset: fmOff };
    const r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = json?.messages?.[0]?.message || 'FM error';
      const code = json?.messages?.[0]?.code;
      return res
        .status(500)
        .json({ error: 'Album search failed', status: r.status, detail: `${msg} (${code})` });
    }

    const data = json?.response?.data || [];
    const total = json?.response?.dataInfo?.foundCount ?? data.length;

    res.json({
      items: data.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
      total,
      offset: uiOff0,
      limit
    });
  } catch (err) {
    const detail = err?.response?.data?.messages?.[0]?.message || err?.message || String(err);
    res.status(500).json({ error: 'Album search failed', status: 500, detail });
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
      const detail = `Upstream error: ${upstream.status}`;
      res.status(upstream.status).send(detail);
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
    const reqLimit = Math.max(1, Math.min(400, parseInt((req.query.limit || '200'), 10)));
    if (!start || !end || end < start) return res.status(400).json({ error: 'bad decade', start, end });

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

    const windowSize = Math.min(reqLimit, 400);
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

    const items = (final.data || []).map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} }));
    console.log(`[EXPLORE] ${start}-${end} using ${chosenField}: total ${foundTotal}, offset ${randStart}, returned ${items.length}`);
    return res.json({ ok: true, items, total: foundTotal, offset: randStart - 1, limit: windowSize, field: chosenField });
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

    const data = json?.response?.data || [];
    const total = json?.response?.dataInfo?.foundCount ?? data.length;

    return res.json({
      ok: true,
      items: data.map((d) => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
      total,
      offset: 0,
      limit
    });
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
