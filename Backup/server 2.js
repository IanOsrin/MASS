// server.js — single-layout API (API_Album_Songs) with DDEX status fallback
require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const path    = require('path');

const morgan = (() => { try { return require('morgan'); } catch { return () => (_req,_res,next)=>next(); } })();
const cors   = (() => { try { return require('cors');   } catch { return () => (_req,_res,next)=>next(); } })();

const app  = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = (process.env.HOST || '127.0.0.1').trim();
const trimQ = v => String(v ?? '').replace(/^\"(.*)\"$|^'(.*)'$/, '$1$2').trim();

const FM_BASE = trimQ(process.env.FM_HOST || process.env.FM_SERVER || '');
const FM_DB   = trimQ(process.env.FM_DB);
const FM_USER = trimQ(process.env.FM_USER);
const FM_PASS = trimQ(process.env.FM_PASS);

const FM_LAYOUT = trimQ(process.env.FM_LAYOUT || 'API_Album_Songs');

// Albums
const F_ALBUM_REF    = trimQ(process.env.F_ALBUM_REF    || 'Album Catalogue Number');
const F_ALBUM_TITLE  = trimQ(process.env.F_ALBUM_TITLE  || 'Tape Files::Album_Title');
const F_ALBUM_ARTIST = trimQ(process.env.F_ALBUM_ARTIST || 'Tape Files::Album Artist');
const F_FAULTY_HINT  = trimQ(process.env.F_FAULTY_HINT  || 'faulty');
const F_DDEX_STATUS  = trimQ(process.env.F_DDEX_STATUS  || 'DDEX Status');

// Tracks
const F_TRACK_NAME   = trimQ(process.env.F_TRACK_NAME   || 'Trackname'); // also 'Track Name'
const F_TRACK_ARTIST = trimQ(process.env.F_TRACK_ARTIST || 'Track Artist');
const F_AUDIO        = trimQ(process.env.F_AUDIO        || 'Audio File');
const F_ISRC         = trimQ(process.env.F_ISRC         || 'ISRC');
const F_LANG         = trimQ(process.env.F_LANG         || 'Language Code');
const F_PRODUCER     = trimQ(process.env.F_PRODUCER     || 'Producer');
const F_COMP1        = trimQ(process.env.F_COMP1        || 'Composer 1');
const F_COMP2        = trimQ(process.env.F_COMP2        || 'Composer 2');
const F_COMP3        = trimQ(process.env.F_COMP3        || 'Composer 3');
const F_ORIG_DATE    = trimQ(process.env.F_ORIG_DATE    || 'Original Release date');

const ALT_ALBUM_TITLE   = 'Album Title';
const ALT_ALBUM_ARTIST  = 'Album Artist';
const ALT_TRACK_NAME    = 'Track Name';

const PAGE_SIZE      = Number(process.env.PAGE_SIZE || 5);
const FETCH_LIMIT    = Number(process.env.FETCH_LIMIT || 1200);
const TRACK_LIMIT    = Number(process.env.TRACK_LIMIT || 500);

const TOKEN_TTL_MS   = Number(process.env.FM_TOKEN_TTL_MS || 13*60*1000);

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(process.cwd(), 'public')));

// Config check
if (!/^https?:\/\//i.test(FM_BASE)) {
  console.error('[CONFIG] Set FM_SERVER or FM_HOST, e.g. https://digitalcupboard.app');
  process.exit(1);
}
if (!FM_DB || !FM_USER || !FM_PASS) {
  console.error('[CONFIG] Missing FM_DB, FM_USER or FM_PASS');
  process.exit(1);
}

const baseDB = () => `${FM_BASE.replace(/\/+$/,'')}/fmi/data/vLatest/databases/${encodeURIComponent(FM_DB)}`;

let _token = null, _lastLogin = 0;

async function fmLogin(force=false) {
  if (!force && _token && (Date.now() - _lastLogin) < TOKEN_TTL_MS) return _token;
  const r = await axios.post(`${baseDB()}/sessions`, {}, { auth: { username: FM_USER, password: FM_PASS } });
  _token = r?.data?.response?.token;
  _lastLogin = Date.now();
  if (!_token) throw new Error('No FileMaker token');
  return _token;
}

async function fmRequest(method, path, { data, params, headers } = {}) {
  const cfg = (t) => ({
    method, url: `${baseDB()}${path}`, data, params,
    headers: { Authorization: `Bearer ${t}`, ...(headers||{}) },
    validateStatus: s => (s>=200 && s<300) || s===401
  });
  let t = await fmLogin();
  let r = await axios.request(cfg(t));
  if (r.status === 401) { t = await fmLogin(true); r = await axios.request(cfg(t)); }
  if (r.status>=200 && r.status<300) return r;
  const e = new Error(`FM ${method} ${path} failed: ${r.status}`);
  e.response = r;
  throw e;
}

const fmMatch = (mode,val) => {
  const s = String(val||'').trim(); if (!s) return '';
  return (String(mode||'contains').toLowerCase()==='equals') ? `==${s}` : `*${s}*`;
};
const boolish = (v) => {
  if (typeof v==='boolean') return v;
  if (v==null) return false;
  const s = String(v).trim().toLowerCase();
  return s==='1'||s==='true'||s==='t'||s==='yes'||s==='y';
};
function fmErrInfo(err) {
  const status = err?.response?.status;
  const data   = err?.response?.data;
  const code   = data?.messages?.[0]?.code;
  const msg    = data?.messages?.[0]?.message;
  return { status, code, message: msg, raw: data };
}

// Build album queries
function buildAlbumQuery({ artist, album, ref, mode }) {
  const q = {};
  if (artist) q[F_ALBUM_ARTIST] = fmMatch(mode, artist);
  if (album)  q[F_ALBUM_TITLE]  = fmMatch(mode, album);
  if (ref)    q[F_ALBUM_REF]    = fmMatch(mode, ref);
  if (!artist && !album && !ref) q[F_ALBUM_REF] = '*';
  return q;
}
function buildAlbumQueryAlt({ artist, album, ref, mode }) {
  const q = {};
  if (artist) q[ALT_ALBUM_ARTIST] = fmMatch(mode, artist);
  if (album)  q[ALT_ALBUM_TITLE]  = fmMatch(mode, album);
  if (ref)    q[F_ALBUM_REF]      = fmMatch(mode, ref);
  if (!artist && !album && !ref) q[F_ALBUM_REF] = '*';
  return q;
}

// Robust field fallback helper
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
  }
  return '';
}

// Map result rows → distinct albums
function rowsToAlbumMap(rows) {
  const map = new Map();
  for (const rec of rows) {
    const fd = rec.fieldData || {};
    const key = pick(fd, [F_ALBUM_REF, 'Album Catalogue Number']);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        albumCatalogueNumber: key,
        albumTitle:  pick(fd, [F_ALBUM_TITLE, 'Album Title']),
        albumArtist: pick(fd, [F_ALBUM_ARTIST, 'Album Artist']),
        // DDEX with generous fallbacks (including related-field style)
        ddexStatus:  pick(fd, [F_DDEX_STATUS, 'DDEX_Status', 'DDEX Status', 'DDEX', 'Tape Files::DDEX Status', 'Tape Files::DDEX_Status']),
        faulty: boolish(pick(fd, [F_FAULTY_HINT]))
      });
    }
  }
  return map;
}

async function searchDistinctAlbumsPage(page, queryObj, pageSize = PAGE_SIZE) {
  const r = await fmRequest('post', `/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
    data: { query: [queryObj], limit: FETCH_LIMIT, offset: 1 }
  });
  const rows = r.data?.response?.data || [];
  const albumsAll = Array.from(rowsToAlbumMap(rows).values());
  const foundCount = albumsAll.length;
  const start = (Math.max(1, Number(page)) - 1) * pageSize;
  const pageItems = albumsAll.slice(start, start + pageSize);
  return { albums: pageItems, foundCount };
}

// Probe (also fetch canonical DDEX if missing)
async function enrichAlbum(albumRef) {
  try {
    const r = await fmRequest('post', `/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
      data: { query: [ { [F_ALBUM_REF]: `==${albumRef}` } ], limit: 1, offset: 1 }
    });
    const row = (r.data?.response?.data || [])[0];
    if (!row) return { faulty: true, ddexStatus: '' };
    const fd = row.fieldData || {};

    const ddexStatus = pick(fd, [F_DDEX_STATUS, 'DDEX_Status', 'DDEX Status', 'DDEX', 'Tape Files::DDEX Status', 'Tape Files::DDEX_Status']);
    const audioUrl = pick(fd, [F_AUDIO]);

    if (!audioUrl) return { faulty: true, ddexStatus };

    const probe = await axios.get(audioUrl, {
      headers: { Range: 'bytes=0-0' },
      validateStatus: s => s===200 || s===206
    });
    const ok = (probe.status === 200 || probe.status === 206);
    return { faulty: !ok, ddexStatus };
  } catch (_e) {
    return { faulty: true, ddexStatus: '' };
  }
}

/* ================= ROUTES ================= */

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/albums', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const mode = String(req.query.mode || 'contains');

  const primary = buildAlbumQuery({
    artist: req.query.artist || '', album: req.query.album || '', ref: req.query.ref || '', mode
  });

  try {
    const pageSize = Math.max(1, Number(req.query.pageSize || PAGE_SIZE));
  const out = await searchDistinctAlbumsPage(page, primary, pageSize);
    const albums = await Promise.all(out.albums.map(async a => {
      const { faulty, ddexStatus } = await enrichAlbum(a.albumCatalogueNumber);
      return { ...a, faulty, ddexStatus: a.ddexStatus || ddexStatus || '' };
    }));
    return res.json({ page, pageSize, albums, foundCount: out.foundCount });
  } catch (err) {
    const info = fmErrInfo(err);
    if (info.code === '102') {
      try {
        const alt = buildAlbumQueryAlt({
          artist: req.query.artist || '', album: req.query.album || '', ref: req.query.ref || '', mode
        });
        const out2 = await searchDistinctAlbumsPage(page, alt, pageSize);
        const albums2 = await Promise.all(out2.albums.map(async a => {
          const { faulty, ddexStatus } = await enrichAlbum(a.albumCatalogueNumber);
          return { ...a, faulty, ddexStatus: a.ddexStatus || ddexStatus || '' };
        }));
        return res.json({ page, pageSize, albums: albums2, foundCount: out2.foundCount });
      } catch (err2) {
        return res.status(500).json({ error: 'Album search failed (alt labels)', detail: fmErrInfo(err2) });
      }
    }
    return res.status(500).json({ error: 'Album search failed', detail: info });
  }
});

app.get('/api/albums/:ref/tracks', async (req, res) => {
  try {
    const ref = String(req.params.ref || '').trim();
    if (!ref) return res.json({ trackCount: 0, tracks: [] });

    const r = await fmRequest('post', `/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, {
      data: { query: [{ [F_ALBUM_REF]: `==${ref}` }], limit: TRACK_LIMIT, offset: 1 }
    });
    const rows = r.data?.response?.data || [];

    const tracks = rows.map(rec => {
      const fd = rec.fieldData || {};

      const composerPrimary =
        fd[F_COMP1] ?? fd['Composer'] ?? fd['Composer1'] ?? fd['Composer_1'] ?? '';

      const composerSecond =
        fd[F_COMP2] ?? fd['Composer 2'] ?? fd['Composer2'] ?? fd['Composer_2'] ?? '';

      const composerThird =
        fd[F_COMP3] ?? fd['Composer 3'] ?? fd['Composer3'] ?? fd['Composer_3'] ?? '';

      return {
        trackName: fd[F_TRACK_NAME] || fd['Track Name'] || '',
        trackArtist: fd[F_TRACK_ARTIST] || '',
        audioSrc: fd[F_AUDIO] || '',
        isrc: fd[F_ISRC] || '',
        languageCode: fd[F_LANG] || '',
        producer: fd[F_PRODUCER] || '',
        composer: composerPrimary,
        composer2: composerSecond,
        composer3: composerThird,
        originalReleaseDate: fd[F_ORIG_DATE] || '',
        duration: ''
      };
    });

    res.json({ trackCount: tracks.length, tracks });
  } catch (err) {
    res.status(500).json({ error: 'Track list failed', detail: fmErrInfo(err) });
  }
});

app.get('/api/tracks', async (req, res) => {
  const page  = Math.max(1, Number(req.query.page || 1));
  const mode  = String(req.query.mode || 'contains').trim().toLowerCase();
  const track = String(req.query.track || '').trim();
  const pageSize = Math.max(1, Number(req.query.pageSize || PAGE_SIZE));

  if (!track) return res.json({ page, pageSize, albums: [], foundCount: 0 });

  const qPrimary = { [F_TRACK_NAME]: fmMatch(mode, track) };

  try {
    const out = await searchDistinctAlbumsPage(page, qPrimary);
    const albums = await Promise.all(out.albums.map(async a => {
      const { faulty, ddexStatus } = await enrichAlbum(a.albumCatalogueNumber);
      return { ...a, faulty, ddexStatus: a.ddexStatus || ddexStatus || '' };
    }));
    return res.json({ page, pageSize, albums, foundCount: out.foundCount });
  } catch (err) {
    const info = fmErrInfo(err);
    if (info.code === '102') {
      try {
        const qAlt = { [ALT_TRACK_NAME]: fmMatch(mode, track) };
        const out2 = await searchDistinctAlbumsPage(page, qAlt, pageSize);
        const albums2 = await Promise.all(out2.albums.map(async a => {
          const { faulty, ddexStatus } = await enrichAlbum(a.albumCatalogueNumber);
          return { ...a, faulty, ddexStatus: a.ddexStatus || ddexStatus || '' };
        }));
        return res.json({ page, pageSize, albums: albums2, foundCount: out2.foundCount });
      } catch (err2) {
        return res.status(500).json({ error: 'Track search failed (alt label)', detail: fmErrInfo(err2) });
      }
    }
    return res.status(500).json({ error: 'Track search failed', detail: info });
  }
});

app.get('/api/streamByRecord/:recordId', async (req, res) => {
  const recordId = String(req.params.recordId || '').trim();
  const redirect = String(req.query.redirect || '') === '1';
  const debug    = String(req.query.debug || '') === '1';

  if (!recordId) return res.status(400).json({ error: 'Missing recordId' });

  try {
    const r = await fmRequest('get', `/layouts/${encodeURIComponent(FM_LAYOUT)}/records/${encodeURIComponent(recordId)}`);
    const data = r.data?.response?.data?.[0];
    if (!data) return res.status(404).json({ error: 'Record not found' });

    const fd = data.fieldData || {};
    const audioUrl = fd[F_AUDIO];
    if (!audioUrl) return res.status(404).json({ error: `Field "${F_AUDIO}" has no container URL` });

    if (redirect) return res.redirect(audioUrl);

    const out = {
      ok: true, host: FM_BASE, db: FM_DB, layout: FM_LAYOUT,
      audioField: F_AUDIO, hasToken: true,
      recordId, play: audioUrl
    };

    if (debug) {
      try {
        const probe = await axios.get(audioUrl, { headers: { Range: 'bytes=0-0' }, validateStatus: s => s===200||s===206 });
        out.probeStatus = probe.status;
      } catch (e) { out.probeError = String(e?.response?.data || e?.message || e); }
    }

    res.json(out);
  } catch (err) {
    res.status(502).json({ error: 'Upstream error on probe', detail: fmErrInfo(err) });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[GalloCMS] Up on http://${HOST}:${PORT}`);
});
