// server.js — search de-dupe, decade filter, and real tracks endpoint (FM base autodetect)
require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const path    = require('path');

const morgan = (() => { try { return require('morgan'); } catch { return () => (_req,_res,next)=>next(); } })();
const cors   = (() => { try { return require('cors');   } catch { return () => (_req,_res,next)=>next(); } })();

const app  = express();
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(process.cwd(), 'public')));

const PORT = Number(process.env.PORT || 3000);
const HOST = (process.env.HOST || '127.0.0.1').trim();
const trimQ = v => String(v ?? '').replace(/^\"(.*)\"$|^'(.*)'$/, '$1$2').trim();

const FM_HOST_RAW = trimQ(process.env.FM_HOST || process.env.FM_SERVER || '');
const FM_DB       = trimQ(process.env.FM_DB);
const FM_USER     = trimQ(process.env.FM_USER);
const FM_PASS     = trimQ(process.env.FM_PASS);
const FM_LAYOUT   = trimQ(process.env.FM_LAYOUT || 'API_Album_Songs');

// Album-level field names (override via env to match your layout)
const F_ALBUM_REF    = trimQ(process.env.F_ALBUM_REF    || 'Album Catalogue Number');
const F_ALBUM_TITLE  = trimQ(process.env.F_ALBUM_TITLE  || 'Tape Files::Album_Title');
const F_ALBUM_ARTIST = trimQ(process.env.F_ALBUM_ARTIST || 'Tape Files::Album Artist');
const F_DDEX_STATUS  = trimQ(process.env.F_DDEX_STATUS  || 'DDEX Status');
const F_YEAR_RELEASE = trimQ(process.env.F_YEAR_RELEASE || 'Tape Files::Year of Release');

// Track-level field names (override any as needed)
const F_TRACK_TITLE   = trimQ(process.env.F_TRACK_TITLE   || 'Track Name');
const F_TRACK_ARTIST  = trimQ(process.env.F_TRACK_ARTIST  || 'Track Artist');
const F_TRACK_NUMBER  = trimQ(process.env.F_TRACK_NUMBER  || 'Track Number');
const F_AUDIO_FIELD   = trimQ(process.env.F_AUDIO_FIELD   || 'Audio File');
const F_ISRC          = trimQ(process.env.F_ISRC          || 'ISRC');
const F_LANG          = trimQ(process.env.F_LANG          || 'Language Code');
const F_PRODUCER      = trimQ(process.env.F_PRODUCER      || 'Producer');
const F_COMPOSER1     = trimQ(process.env.F_COMPOSER1     || 'Composer');
const F_COMPOSER2     = trimQ(process.env.F_COMPOSER2     || 'Composer 2');
const F_COMPOSER3     = trimQ(process.env.F_COMPOSER3     || 'Composer 3');
const F_ORIG_REL_DATE = trimQ(process.env.F_ORIG_REL_DATE || 'Original Release date');
const F_TRACK_DDEX    = trimQ(process.env.F_TRACK_DDEX    || 'DDEX Status'); // some layouts store per-track too
const F_DURATION      = trimQ(process.env.F_DURATION      || 'Duration (s)'); // seconds; we’ll fall back to “Duration”

// ---------- helpers ----------
const isHtml = (x) => typeof x === 'string' && /<(?:!DOCTYPE|html|body|head)/i.test(x);
const wrapErr = (err, fallback='Request failed') => {
  const payload = err?.response?.data ?? err?.message ?? String(err);
  if (isHtml(payload)) return { error: fallback, hint: "Base URL isn't the FileMaker Data API. Autodetect will try alternatives." };
  return { error: fallback, detail: payload };
};

const must = (v,n) => { if(!v) throw new Error(`Missing env ${n}`); return v; };
must(FM_HOST_RAW,'FM_HOST (or FM_SERVER)'); must(FM_DB,'FM_DB'); must(FM_USER,'FM_USER'); must(FM_PASS,'FM_PASS'); must(FM_LAYOUT,'FM_LAYOUT');

// build candidate Data API bases
function buildCandidates(root) {
  let r = String(root).replace(/\/+$/,'');
  if (!/^https?:\/\//i.test(r)) throw new Error("FM_HOST must start with http(s)://");
  const hasData = /\/fmi\/data\//i.test(r);
  const versions = ['vLatest','v2','v1'];
  const list = [];
  if (hasData) {
    list.push(r);
    if (/\/fmi\/data$/i.test(r)) versions.forEach(v => list.push(`${r}/${v}`));
  } else {
    versions.forEach(v => list.push(`${r}/fmi/data/${v}`));
  }
  return Array.from(new Set(list));
}

let RESOLVED_BASE = null;

async function tryLogin(base) {
  const url = `${base.replace(/\/+$/,'')}/databases/${encodeURIComponent(FM_DB)}/sessions`;
  const r = await axios.post(url, {}, { auth: { username: FM_USER, password: FM_PASS }, validateStatus: () => true });
  if (r.status >= 200 && r.status < 300 && r?.data?.response?.token) return r.data.response.token;
  if (isHtml(r?.data) || r.status === 404) throw Object.assign(new Error('Wrong base'), { wrongBase: true, status: r.status });
  throw Object.assign(new Error('Data API error'), { data: r.data, status: r.status });
}

async function resolveBaseAndLogin() {
  if (RESOLVED_BASE) {
    const token = await tryLogin(RESOLVED_BASE);
    return { base: RESOLVED_BASE, token };
  }
  const candidates = buildCandidates(FM_HOST_RAW);
  let lastErr;
  for (const cand of candidates) {
    try {
      const token = await tryLogin(cand);
      RESOLVED_BASE = cand;
      return { base: cand, token };
    } catch (e) {
      lastErr = e;
      if (e.wrongBase) continue;
      throw e;
    }
  }
  throw Object.assign(new Error('Could not find a valid Data API base from FM_HOST'), { detail: lastErr?.message || lastErr });
}

async function fmFind(token, base, layout, queryObj, opts={}) {
  const url = `${base}/databases/${encodeURIComponent(FM_DB)}/layouts/${encodeURIComponent(layout)}/_find`;
  const body = { query: [queryObj], ...opts };
  const r = await axios.post(url, body, { headers: { Authorization: `Bearer ${token}` } });
  return r.data?.response?.data || [];
}
async function fmList(token, base, layout, offset=1, limit=20) {
  const url = `${base}/databases/${encodeURIComponent(FM_DB)}/layouts/${encodeURIComponent(layout)}/records?_offset=${offset}&_limit=${limit}`;
  const r = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
  return r.data?.response?.data || [];
}
async function fmLogout(token, base) {
  const url = `${base}/databases/${encodeURIComponent(FM_DB)}/sessions/${encodeURIComponent(token)}`;
  try { await axios.delete(url, { headers: { Authorization: `Bearer ${token}` } }); } catch {}
}

function fmContains(val) { return `*${String(val).trim()}*`; }
function parseYear(v) { const m = String(v ?? '').match(/(?:^|[^0-9])((19|20)\d{2})(?!\d)/); return m ? Number(m[1]) : null; }

// prefer env field; if empty, try common alternates
function pullYearField(f) {
  const candidates = [
    F_YEAR_RELEASE,
    'Year of Release',
    'Tape Files::Year of Release',
    'Tape Files::Release Year',
    'Release Year',
  ];
  for (const key of candidates) {
    if (key in f && f[key] != null && String(f[key]).trim() !== '') return f[key];
  }
  return null;
}

function mapAlbum(rec) {
  const f = rec.fieldData || {};
  const yraw = pullYearField(f);
  return {
    albumCatalogueNumber: f[F_ALBUM_REF],
    albumTitle: f[F_ALBUM_TITLE],
    albumArtist: f[F_ALBUM_ARTIST],
    ddexStatus: f[F_DDEX_STATUS] || '—',
    yearOfRelease: parseYear(yraw),
    faulty: !!(f.faulty || f.Faulty || f['Audio Faulty']),
  };
}

function uniqByAlbum(albums) {
  const seen = new Set(); const out = [];
  for (const a of albums) {
    if (!a || !a.albumCatalogueNumber) continue;
    if (seen.has(a.albumCatalogueNumber)) continue;
    seen.add(a.albumCatalogueNumber); out.push(a);
  }
  return out;
}

function sampleN(arr, n) {
  if (arr.length <= n) return arr.slice();
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a.slice(0, n);
}
function decadeToRange(label) {
  const t = String(label||'').toLowerCase();
  if (t.includes('1950')) return { start: 1950, end: 1959 };
  if (t.includes('1960')) return { start: 1960, end: 1969 };
  if (t.includes('1970')) return { start: 1970, end: 1979 };
  if (t.includes('1980')) return { start: 1980, end: 1989 };
  if (t.includes('1990')) return { start: 1990, end: 1999 };
  if (t.includes('2000')) return { start: 2000, end: 2009 };
  if (t.includes('2010')) return { start: 2010, end: 2019 };
  if (t.includes('modern')) return { start: 2020, end: 2099 };
  return null;
}

// ---------- Health ----------
app.get('/api/health', async (_req, res) => {
  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;
    res.json({ ok: true, base, db: FM_DB, layout: FM_LAYOUT });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Health check failed'));
  } finally {
    if (token && base) await fmLogout(token, base);
  }
});

// ---------- Albums search (AND across fields; de-dup) ----------
app.get('/api/albums', async (req, res) => {
  const { artist='', album='', ref='', page=1, mode='contains' } = req.query;
  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    const p = Math.max(1, Number(page) || 1);
    const pageSize = 20;

    const terms = {};
    if (artist) terms[F_ALBUM_ARTIST] = (mode === 'equals') ? String(artist).trim() : fmContains(artist);
    if (album)  terms[F_ALBUM_TITLE]  = (mode === 'equals') ? String(album).trim()  : fmContains(album);
    if (ref)    terms[F_ALBUM_REF]    = (mode === 'equals') ? String(ref).trim()    : fmContains(ref);

    let records = [];
    if (Object.keys(terms).length) {
      records = await fmFind(token, base, FM_LAYOUT, terms, { offset: 1, limit: pageSize });
    } else {
      const offset = ((p - 1) * pageSize) + 1;
      records = await fmList(token, base, FM_LAYOUT, offset, pageSize);
    }

    let albums = (records||[]).map(mapAlbum).filter(a => a.albumCatalogueNumber);
    albums = uniqByAlbum(albums);

    res.json({ page: Number(p), albums, foundCount: albums.length });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Album search failed'));
  } finally {
    if (token && base) await fmLogout(token, base);
  }
});

// ---------- Tracks for album (real implementation) ----------
app.get('/api/albums/:ref/tracks', async (req, res) => {
  const albumRef = String(req.params.ref || '').trim();
  if (!albumRef) return res.json({ album: '', trackCount: 0, tracks: [] });

  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    // Find all rows for this album (layout is per-track rows)
    const records = await fmFind(token, base, FM_LAYOUT, { [F_ALBUM_REF]: albumRef }, { offset: 1, limit: 999 });

    // Flexible getters for fields with common alternatives
    const getFirst = (f, keys) => {
      for (const k of keys) if (k in f && f[k] != null && String(f[k]).trim() !== '') return f[k];
      return '';
    };
    const parseSeconds = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return NaN;
      // already seconds?
      if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
      // mm:ss or hh:mm:ss
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
        const parts = s.split(':').map(Number);
        return parts.length === 3 ? (parts[0]*3600 + parts[1]*60 + parts[2]) : (parts[0]*60 + parts[1]);
      }
      // 000:03:59.717 or similar
      const m = s.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
      if (m) return Number(m[1])*3600 + Number(m[2])*60 + Number(m[3]);
      return NaN;
    };

    const tracks = (records||[]).map(rec => {
      const f = rec.fieldData || {};

      const title   = getFirst(f, [F_TRACK_TITLE, 'Track Title', 'Song Files::Track Name', 'TrackName', 'Title']);
      const artist  = getFirst(f, [F_TRACK_ARTIST, 'Song Files::Track Artist', 'Artist', 'Performer']);
      const number  = Number(getFirst(f, [F_TRACK_NUMBER, 'Index', 'TrackIndex', 'Song Index'])) || null;

      const audio   = getFirst(f, [F_AUDIO_FIELD, 'Audio', 'Stream URL', 'StreamUrl', 'Container URL', 'containerUrl', 'Audio URL']);
      const isrc    = getFirst(f, [F_ISRC, 'Song Files::ISRC', 'ISRC Code']);
      const lang    = getFirst(f, [F_LANG, 'Language', 'Lang']);
      const prod    = getFirst(f, [F_PRODUCER, 'Producer 1', 'Song Files::Producer']);
      const comp1   = getFirst(f, [F_COMPOSER1, 'Composer 1', 'Song Files::Composer']);
      const comp2   = getFirst(f, [F_COMPOSER2]);
      const comp3   = getFirst(f, [F_COMPOSER3]);
      const odate   = getFirst(f, [F_ORIG_REL_DATE, 'Original Release Date', 'Release Date']);
      const tddex   = getFirst(f, [F_TRACK_DDEX, F_DDEX_STATUS]);
      let duration  = getFirst(f, [F_DURATION, 'Track Duration', 'Duration', 'Media Duration (s)']);

      const dur = parseSeconds(duration);

      // normalize to the keys your front-end expects
      return {
        trackName: title || '(Untitled)',
        trackArtist: artist || '',
        audioSrc: (audio || '').toString().trim(),
        duration: isNaN(dur) ? null : Number(dur),
        isrc, languageCode: lang,
        producer: prod, composer: comp1, composer2: comp2, composer3: comp3,
        originalReleaseDate: odate,
        ddexStatus: tddex || '',
        trackNumber: number
      };
    })
    // keep only those with at least a title or audio
    .filter(t => t.trackName || t.audioSrc)
    // sort by track number if present, else as-is
    .sort((a,b) => {
      if (a.trackNumber == null && b.trackNumber == null) return 0;
      if (a.trackNumber == null) return 1;
      if (b.trackNumber == null) return -1;
      return a.trackNumber - b.trackNumber;
    });

    res.json({ album: albumRef, trackCount: tracks.length, tracks });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Track fetch failed'));
  } finally {
    if (token && base) await fmLogout(token, base);
  }
});

// ---------- Track search (placeholder to keep UI contract) ----------
app.get('/api/tracks', async (_req, res) => {
  res.json({ albums: [], foundCount: 0 });
});

// ---------- Explore: 15 random by decade ----------
app.get('/api/explore/decade', async (req, res) => {
  const { label='', limit=15 } = req.query;
  const range = decadeToRange(label);
  if (!range) return res.json({ albums: [] });

  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    const batchSize = 500;
    let offset = 1, all = [];
    while (all.length < 1500) {
      const chunk = await fmList(token, base, FM_LAYOUT, offset, batchSize);
      if (!chunk.length) break;
      all = all.concat(chunk);
      if (chunk.length < batchSize) break;
      offset += batchSize;
    }

    let albums = all.map(mapAlbum).filter(a => a.albumCatalogueNumber);
    albums = uniqByAlbum(albums);

    const filtered = albums.filter(a => a.yearOfRelease && a.yearOfRelease >= range.start && a.yearOfRelease <= range.end);
    const pick = sampleN(filtered, Math.max(1, Math.min(100, Number(limit)||15)));

    res.json({ label, start: range.start, end: range.end, count: pick.length, albums: pick });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Decade explore failed'));
  } finally {
    if (token && base) await fmLogout(token, base);
  }
});

// ---------- Root ----------
app.get('/', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[MASS] http://${HOST}:${PORT}`);
  console.log(`[MASS] FM_HOST(raw)=${FM_HOST_RAW}`);
});
