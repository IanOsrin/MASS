// server.js — fast decade explore (cache + early-exit), album/track search, cover proxy, FM autodetect
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

// ---------------- Config / ENV ----------------
const PORT  = Number(process.env.PORT || 3000);
const HOST  = (process.env.HOST || '0.0.0.0').trim();
const trimQ = v => String(v ?? '').replace(/^\"(.*)\"$|^'(.*)'$/, '$1$2').trim();

const FM_HOST_RAW = trimQ(process.env.FM_HOST || process.env.FM_SERVER || '');
const FM_DB       = trimQ(process.env.FM_DB);
const FM_USER     = trimQ(process.env.FM_USER);
const FM_PASS     = trimQ(process.env.FM_PASS);
const FM_LAYOUT   = trimQ(process.env.FM_LAYOUT || 'API_Album_Songs');

// Album & Track fields (defaults match your schema; override via env only if needed)
const F_ALBUM_REF    = trimQ(process.env.F_ALBUM_REF    || 'Album Catalogue Number');
const F_ALBUM_TITLE  = trimQ(process.env.F_ALBUM_TITLE  || 'Tape Files::Album_Title');
const F_ALBUM_ARTIST = trimQ(process.env.F_ALBUM_ARTIST || 'Tape Files::Album Artist');
const F_DDEX_STATUS  = trimQ(process.env.F_DDEX_STATUS  || 'DDEX Status');
// Preferred year field name; we still auto-detect if it's not on the layout
const F_YEAR_RELEASE_PREFERRED = trimQ(process.env.F_YEAR_RELEASE || 'Tape Files::Year of Release');

const F_TRACK_TITLE   = trimQ(process.env.F_TRACK_TITLE   || 'Track Name');
const F_TRACK_ARTIST  = trimQ(process.env.F_TRACK_ARTIST  || 'Track Artist');
const F_TRACK_NUMBER  = trimQ(process.env.F_TRACK_NUMBER  || 'Track Number');
const F_AUDIO_FIELD   = trimQ(process.env.F_AUDIO_FIELD   || 'Audio File');
const F_ISRC          = trimQ(process.env.F_ISRC          || 'ISRC');
const F_LANG          = trimQ(process.env.F_LANG          || 'Language Code');
const F_PRODUCER      = trimQ(process.env.F_PRODUCER      || 'Producer');
const F_ORIG_REL_DATE = trimQ(process.env.F_ORIG_REL_DATE || 'Original Release date');
const F_TRACK_DDEX    = trimQ(process.env.F_TRACK_DDEX    || 'DDEX Status');
const F_DURATION      = trimQ(process.env.F_DURATION      || 'Duration (s)');

// Artwork layout (optional). No new env required.
const FM_LAYOUT_ART   = trimQ(process.env.FM_ARTWORK_LAYOUT || 'Artwork');

// Paging / batching
const PAGE_SIZE     = Math.max(1, Number(process.env.PAGE_SIZE || 6));
const FIND_BATCH    = 200;
const LIST_BATCH    = 200;
const MAX_ROWS_SCAN = 5000;

// ---------------- Helpers ----------------
const isHtml = x => typeof x === 'string' && /<(?:!DOCTYPE|html|body|head)/i.test(x);
const must   = (v,n) => { if(!v) throw new Error(`Missing env ${n}`); return v; };
must(FM_HOST_RAW,'FM_HOST (or FM_SERVER)'); must(FM_DB,'FM_DB'); must(FM_USER,'FM_USER'); must(FM_PASS,'FM_PASS'); must(FM_LAYOUT,'FM_LAYOUT');

const fmContains = s => `=${String(s||'').trim()}`; // FileMaker "contains" operator (equals string with leading "=")

const wrapErr = (err, fallback='Request failed') => {
  const payload = err?.response?.data ?? err?.message ?? String(err);
  if (isHtml(payload)) return { error: fallback, hint: "Server responded with HTML (likely WebDirect). This base probably isn't the Data API. Autodetect will try alternatives." };
  return { error: fallback, detail: payload };
};

function parseYear(y) {
  const s = String(y||'').trim();
  const m = s.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
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

// ---------------- FileMaker base autodetect + login ----------------
let RESOLVED_BASE = null;

function buildCandidates(hostRaw) {
  const bases = [];
  let root = String(hostRaw||'').trim();
  if (!/^https?:\/\//.test(root)) root = 'https://' + root;
  root = root.replace(/\/+$/,'');
  if (/\/fmi\/data\//.test(root)) bases.push(root);
  for (const seg of ['/fmi/data/vLatest', '/fmi/data/v1', '/fmi/data/v2']) {
    bases.push(root.replace(/\/fmi\/data\/?.*$/,'') + seg);
  }
  return [...new Set(bases)];
}

async function tryLogin(base) {
  const url = `${base}/databases/${encodeURIComponent(FM_DB)}/sessions`;
  const r = await axios.post(url, {}, {
    auth: { username: FM_USER, password: FM_PASS },
    validateStatus: () => true
  });
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
      if (!e.wrongBase) throw e;
    }
  }
  throw Object.assign(new Error('Could not find a valid Data API base from FM_HOST'), { detail: lastErr?.message || lastErr });
}

async function fmLogout(token, base) {
  try {
    const url = `${base}/databases/${encodeURIComponent(FM_DB)}/sessions/${token}`;
    await axios.delete(url, { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
  } catch {}
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

// Layout metadata (to auto-detect year field)
async function fmLayoutFields(token, base, layout) {
  const url = `${base}/databases/${encodeURIComponent(FM_DB)}/layouts/${encodeURIComponent(layout)}`;
  const r = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
  return r?.data?.response?.fieldMetaData?.map(f => f.name) || [];
}

// ---------------- Shaping & aggregation ----------------
function shapeTrack(fieldData) {
  const audio = (fieldData[F_AUDIO_FIELD] || '').toString().trim();
  const duration = Number(fieldData[F_DURATION]);
  const faulty = !audio || /error/i.test(audio) || (isFinite(duration) && duration <= 0);

  return {
    trackName: fieldData[F_TRACK_TITLE] || '',
    trackArtist: fieldData[F_TRACK_ARTIST] || '',
    trackNumber: fieldData[F_TRACK_NUMBER] || '',
    audioSrc: audio || '',
    isrc: fieldData[F_ISRC] || '',
    languageCode: fieldData[F_LANG] || '',
    producer: fieldData[F_PRODUCER] || '',
    originalReleaseDate: fieldData[F_ORIG_REL_DATE] || '',
    ddexStatus: fieldData[F_TRACK_DDEX] || '',
    duration: isFinite(duration) ? duration : null,
    faulty
  };
}

function shapeAlbumHead(fieldData, yearFieldName) {
  const yraw = fieldData[yearFieldName];
  return {
    albumCatalogueNumber: fieldData[F_ALBUM_REF],
    albumTitle: fieldData[F_ALBUM_TITLE],
    albumArtist: fieldData[F_ALBUM_ARTIST],
    ddexStatus: fieldData[F_DDEX_STATUS] || '—',
    yearOfRelease: parseYear(yraw)
  };
}

function aggregateAlbumsFromRows(rows, yearFieldName = F_YEAR_RELEASE_PREFERRED) {
  const byRef = new Map();
  for (const rec of rows) {
    const f = rec.fieldData || {};
    const ref = f[F_ALBUM_REF];
    if (!ref) continue;
    let agg = byRef.get(ref);
    if (!agg) {
      const head = shapeAlbumHead(f, yearFieldName);
      agg = { ...head, tracks: [], faulty: false, count: 0 };
      byRef.set(ref, agg);
    }
    const t = shapeTrack(f);
    agg.tracks.push(t);
    agg.count++;
    if (t.faulty) agg.faulty = true;
  }

  const out = [];
  for (const a of byRef.values()) {
    out.push({
      albumCatalogueNumber: a.albumCatalogueNumber,
      albumTitle: a.albumTitle,
      albumArtist: a.albumArtist,
      ddexStatus: a.ddexStatus,
      yearOfRelease: a.yearOfRelease,
      faulty: a.faulty,
      trackCount: a.count
    });
  }
  return out;
}

function paginate(arr, page, size) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.max(1, Number(size) || PAGE_SIZE);
  const start = (p - 1) * s;
  return arr.slice(start, start + s);
}

function sampleN(arr, n) {
  if (arr.length <= n) return arr.slice();
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a.slice(0, n);
}

// ---------------- Decade speedups: cache + early-exit helpers ----------------
const DECADE_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheGet(key) {
  const e = DECADE_CACHE.get(key);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL_MS) { DECADE_CACHE.delete(key); return null; }
  return e.v;
}
function cacheSet(key, value) {
  DECADE_CACHE.set(key, { t: Date.now(), v: value });
}

// Collect albums via one or more find criteria, dedup by Cat#, stop when enough
async function findUniqueAlbumsByCriteria(token, base, yearField, criteriaList, targetCount) {
  const uniq = new Map();
  const batch = 200;
  for (const criteria of criteriaList) {
    let offset = 1;
    while (uniq.size < targetCount) {
      // _find supports limit/offset in the body on modern Data API
      const rows = await fmFind(token, base, FM_LAYOUT, criteria, { limit: batch, offset });
      if (!rows.length) break;
      const albums = aggregateAlbumsFromRows(rows, yearField).filter(a => !a.faulty);
      for (const a of albums) {
        if (a.albumCatalogueNumber) uniq.set(a.albumCatalogueNumber, a);
        if (uniq.size >= targetCount) break;
      }
      if (rows.length < batch) break;
      offset += rows.length;
    }
    if (uniq.size >= targetCount) break;
  }
  return [...uniq.values()];
}

// Quick list scan with early-exit (only scan until we have enough)
async function listScanUnique(token, base, yearField, range, targetCount) {
  const uniq = new Map();
  let offset = 1, batch = 500;
  while (uniq.size < targetCount) {
    const chunk = await fmList(token, base, FM_LAYOUT, offset, batch);
    if (!chunk.length) break;
    const filtered = chunk.filter(rec => {
      const y = parseYear((rec.fieldData || {})[yearField || F_YEAR_RELEASE_PREFERRED]);
      return y && y >= range.start && y <= range.end;
    });
    const albums = aggregateAlbumsFromRows(filtered, yearField).filter(a => !a.faulty);
    for (const a of albums) {
      if (a.albumCatalogueNumber) uniq.set(a.albumCatalogueNumber, a);
      if (uniq.size >= targetCount) break;
    }
    offset += chunk.length;
    if (chunk.length < batch) break;
  }
  return [...uniq.values()];
}

// ---------------- Data gatherers ----------------
async function gatherAlbums_Find(token, base, terms, page=1, yearFieldName=F_YEAR_RELEASE_PREFERRED) {
  const rows = await fmFind(token, base, FM_LAYOUT, terms, { limit: FIND_BATCH });
  let albums = aggregateAlbumsFromRows(rows, yearFieldName);
  albums = albums.filter(a => !a.faulty);
  albums.sort((a,b) => (String(a.albumArtist||'').localeCompare(String(b.albumArtist||'')) || String(a.albumTitle||'').localeCompare(String(b.albumTitle||''))));
  const total = albums.length;
  const pageAlbums = paginate(albums, page, PAGE_SIZE);
  return { albums: pageAlbums, total };
}

async function gatherAlbums_List(token, base, page=1, yearFieldName=F_YEAR_RELEASE_PREFERRED) {
  const allRows = [];
  let offset = 1, scanned = 0, batch = LIST_BATCH;
  while (scanned < MAX_ROWS_SCAN && allRows.length < 4000) {
    const chunk = await fmList(token, base, FM_LAYOUT, offset, batch);
    if (!chunk.length) break;
    allRows.push(...chunk);
    scanned += chunk.length;
    offset += chunk.length;
    if (chunk.length < batch) break;
  }
  let albums = aggregateAlbumsFromRows(allRows, yearFieldName);
  albums = albums.filter(a => !a.faulty);
  albums.sort((a,b) => (String(a.albumArtist||'').localeCompare(String(b.albumArtist||'')) || String(a.albumTitle||'').localeCompare(String(b.albumTitle||''))));
  const total = albums.length;
  const pageAlbums = paginate(albums, page, PAGE_SIZE);
  return { albums: pageAlbums, total };
}

// ---------------- Routes ----------------

// Health
app.get('/api/health', async (_req, res) => {
  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;
    res.json({ ok: true, base, db: FM_DB, layout: FM_LAYOUT });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Health check failed'));
  } finally {
    try { if (token && base) await fmLogout(token, base); } catch {}
  }
});

// Albums search (artist/album/ref; hides faulty)
app.get('/api/albums', async (req, res) => {
  const { artist='', album='', ref='', page=1, mode='contains' } = req.query;
  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    const names = await fmLayoutFields(token, base, FM_LAYOUT);
    const yearField = resolveYearFieldName(names) || F_YEAR_RELEASE_PREFERRED;

    const p = Math.max(1, Number(page) || 1);
    const terms = {};
    if (artist) terms[F_ALBUM_ARTIST] = (mode === 'equals') ? String(artist).trim() : fmContains(artist);
    if (album)  terms[F_ALBUM_TITLE]  = (mode === 'equals') ? String(album).trim()  : fmContains(album);
    if (ref)    terms[F_ALBUM_REF]    = (mode === 'equals') ? String(ref).trim()    : fmContains(ref);

    const result = Object.keys(terms).length
      ? await gatherAlbums_Find(token, base, terms, p, yearField)
      : await gatherAlbums_List(token, base, p, yearField);

    res.json({ albums: result.albums, foundCount: result.total });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Album search failed'));
  } finally {
    try { if (token && base) await fmLogout(token, base); } catch {}
  }
});

// Tracks search (by track name; returns album cards; hides faulty albums)
app.get('/api/tracks', async (req, res) => {
  const { track='', page=1, mode='contains' } = req.query;
  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    if (!track) return res.json({ albums: [], foundCount: 0 });

    const names = await fmLayoutFields(token, base, FM_LAYOUT);
    const yearField = resolveYearFieldName(names) || F_YEAR_RELEASE_PREFERRED;

    const q = (mode === 'equals') ? String(track).trim() : fmContains(track);
    const rows = await fmFind(token, base, FM_LAYOUT, { [F_TRACK_TITLE]: q }, { limit: FIND_BATCH });

    let albums = aggregateAlbumsFromRows(rows, yearField);
    albums = albums.filter(a => !a.faulty);
    albums.sort((a,b) => (String(a.albumArtist||'').localeCompare(String(b.albumArtist||'')) || String(a.albumTitle||'').localeCompare(String(b.albumTitle||''))));
    const total = albums.length;
    const pageAlbums = paginate(albums, page, PAGE_SIZE);
    res.json({ albums: pageAlbums, foundCount: total });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Track search failed'));
  } finally {
    try { if (token && base) await fmLogout(token, base); } catch {}
  }
});

// Tracks for a specific album (by Catalogue Number)
app.get('/api/albums/:cat/tracks', async (req, res) => {
  const cat = decodeURIComponent(String(req.params.cat||'')).trim();
  if (!cat) return res.status(400).json({ error: 'Missing catalogue number' });

  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    const rows = await fmFind(token, base, FM_LAYOUT, { [F_ALBUM_REF]: cat }, { limit: 1000 });
    const tracks = rows.map(rec => shapeTrack(rec.fieldData || {}));
    tracks.sort((a,b) => (Number(a.trackNumber||0) - Number(b.trackNumber||0)));

    res.json({ trackCount: tracks.length, tracks });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Track list failed'));
  } finally {
    try { if (token && base) await fmLogout(token, base); } catch {}
  }
});

// Explore by decade (fast): native range -> wildcard decade -> quick list scan; early-exit + cache
app.get('/api/explore/decade', async (req, res) => {
  const { label = '', limit = 15 } = req.query;
  const range = decadeToRange(label);
  if (!range) return res.json({ albums: [] });

  const cacheKey = `decade:${label.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  const need = Math.max(1, Number(limit) || 15);
  if (cached && cached.length) {
    return res.json({ albums: sampleN(cached, need) });
  }

  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    // Detect actual year field present on the layout
    const names = await fmLayoutFields(token, base, FM_LAYOUT);
    const yearField = resolveYearFieldName(names) || F_YEAR_RELEASE_PREFERRED;

    // Collect just enough unique albums (target = 3x desired for variety)
    const TARGET = need * 3;

    // 1) Native range find (fast when field is numeric/date)
    const criteria = [{ [yearField]: `${range.start}...${range.end}` }];
    let albums = await findUniqueAlbumsByCriteria(token, base, yearField, criteria, TARGET);

    // 2) If too few, try wildcard decade patterns (197#, 197*, *197*)
    if (albums.length < TARGET) {
      const decadePrefix = String(range.start).slice(0, 3); // e.g., "197"
      const wildcards = [
        { [yearField]: `${decadePrefix}#` },   // 1970–1979 (digit wildcard)
        { [yearField]: `${decadePrefix}*` },   // starts with 197
        { [yearField]: `*${decadePrefix}*` },  // contains 197 (e.g., "1970's", "c. 1973")
      ];
      const extra = await findUniqueAlbumsByCriteria(token, base, yearField, wildcards, TARGET);
      const seen = new Map(albums.map(a => [a.albumCatalogueNumber, a]));
      for (const a of extra) if (!seen.has(a.albumCatalogueNumber)) seen.set(a.albumCatalogueNumber, a);
      albums = [...seen.values()];
    }

    // 3) Last resort: bounded list scan with early exit
    if (albums.length < need) {
      const more = await listScanUnique(token, base, yearField, range, TARGET);
      const seen = new Map(albums.map(a => [a.albumCatalogueNumber, a]));
      for (const a of more) if (!seen.has(a.albumCatalogueNumber)) seen.set(a.albumCatalogueNumber, a);
      albums = [...seen.values()];
    }

    // Cache broader set; respond with a sample
    cacheSet(cacheKey, albums);
    res.json({ albums: sampleN(albums, need) });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Decade explore failed'));
  } finally {
    try { if (token && base) await fmLogout(token, base); } catch {}
  }
});

// Cover thumbnail proxy by Album Catalogue Number (no token leak to client)
app.get('/api/cover/:cat', async (req, res) => {
  const cat = decodeURIComponent(String(req.params.cat||'')).trim();
  if (!cat) return res.status(400).send('Missing catalogue number');

  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    async function pipeContainer(containerUrl) {
      const absolute = /^https?:/i.test(containerUrl)
        ? containerUrl
        : `${FM_HOST_RAW.replace(/\/+$/,'')}${containerUrl}`;
      const stream = await axios.get(absolute, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'stream',
        validateStatus: () => true
      });
      if (stream.status >= 400) return res.status(204).end();
      if (stream.headers['content-type'])  res.setHeader('Content-Type',  stream.headers['content-type']);
      if (stream.headers['content-length']) res.setHeader('Content-Length', stream.headers['content-length']);
      res.setHeader('Cache-Control', 'public, max-age=300');
      stream.data.pipe(res);
    }

    // Attempt A: related field on main layout
    let recs = await fmFind(token, base, FM_LAYOUT, { [F_ALBUM_REF]: cat });
    let fd = recs?.[0]?.fieldData || {};
    let containerUrl =
      fd['Artwork::Picture'] ||
      fd['Artwork:Picture'] ||
      fd['Artwork_Picture'] ||
      null;

    // Attempt B: dedicated 'Artwork' layout
    if (!containerUrl) {
      recs = await fmFind(token, base, FM_LAYOUT_ART, { [F_ALBUM_REF]: cat });
      fd = recs?.[0]?.fieldData || {};
      containerUrl = fd['Picture'] || fd['Artwork::Picture'] || fd['Artwork:Picture'] || null;
    }

    if (!containerUrl) return res.status(204).end();
    await pipeContainer(containerUrl);
  } catch (err) {
    const msg = (err?.response?.data?.messages?.[0]?.message) || err?.message || String(err);
    res.status(500).json({ error: 'Cover fetch failed', detail: msg });
  } finally {
    try { if (token && base) await fmLogout(token, base); } catch {}
  }
});

// Root -> serve UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// ---------------- Utilities ----------------
function resolveYearFieldName(layoutFieldNames) {
  const names = (layoutFieldNames || []).map(String);
  const candidates = [
    F_YEAR_RELEASE_PREFERRED,
    'Year of Release',
    'Tape Files::Year of Release',
    'Year',
    'Tape Files::Year',
    'Tape Files::Year_of_Release',
    'Tape Files::YearOfRelease',
    'Album Year',
    'Release Year',
    'Tape Files::Release Year'
  ];
  for (const cand of candidates) {
    if (names.includes(cand)) return cand;
  }
  const fuzzy = names.find(n => /year/i.test(n));
  return fuzzy || null;
}

// Start
app.listen(PORT, HOST, () => {
  console.log(`[MASS] http://${HOST}:${PORT}`);
  console.log(`[MASS] FM_HOST(raw)=${FM_HOST_RAW}`);
  console.log(`[MASS] PAGE_SIZE=${PAGE_SIZE}`);
});
