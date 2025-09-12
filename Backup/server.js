// server.js — album-level faulty aggregation + page-fill + decade + tracks (FM base autodetect)
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
const HOST = (process.env.HOST || '0.0.0.0').trim();
const trimQ = v => String(v ?? '').replace(/^\"(.*)\"$|^'(.*)'$/, '$1$2').trim();

const FM_HOST_RAW = trimQ(process.env.FM_HOST || process.env.FM_SERVER || '');
const FM_DB       = trimQ(process.env.FM_DB);
const FM_USER     = trimQ(process.env.FM_USER);
const FM_PASS     = trimQ(process.env.FM_PASS);
const FM_LAYOUT   = trimQ(process.env.FM_LAYOUT || 'API_Album_Songs');

// Album fields
const F_ALBUM_REF    = trimQ(process.env.F_ALBUM_REF    || 'Album Catalogue Number');
const F_ALBUM_TITLE  = trimQ(process.env.F_ALBUM_TITLE  || 'Tape Files::Album_Title');
const F_ALBUM_ARTIST = trimQ(process.env.F_ALBUM_ARTIST || 'Tape Files::Album Artist');
const F_DDEX_STATUS  = trimQ(process.env.F_DDEX_STATUS  || 'DDEX Status');
const F_YEAR_RELEASE = trimQ(process.env.F_YEAR_RELEASE || 'Tape Files::Year of Release');

// Fault flags (truthy means faulty)
const F_FAULTY_FLAG1 = trimQ(process.env.F_FAULTY_FLAG1 || 'Audio Faulty');
const F_FAULTY_FLAG2 = trimQ(process.env.F_FAULTY_FLAG2 || 'Faulty');
const F_FAULTY_FLAG3 = trimQ(process.env.F_FAULTY_FLAG3 || 'faulty');

// Healthy flags (falsy means faulty)
const F_HEALTHY_FLAG1 = trimQ(process.env.F_HEALTHY_FLAG1 || 'Audio Healthy');
const F_HEALTHY_FLAG2 = trimQ(process.env.F_HEALTHY_FLAG2 || 'Healthy');
const F_HEALTHY_FLAG3 = trimQ(process.env.F_HEALTHY_FLAG3 || 'healthy');

// Track fields
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
const F_TRACK_DDEX    = trimQ(process.env.F_TRACK_DDEX    || 'DDEX Status');
const F_DURATION      = trimQ(process.env.F_DURATION      || 'Duration (s)');

const PAGE_SIZE     = Number(process.env.PAGE_SIZE || 20);
const FIND_BATCH    = 200;
const LIST_BATCH    = 200;
const MAX_ROWS_SCAN = 5000;

// ---------- helpers ----------
const isHtml = x => typeof x === 'string' && /<(?:!DOCTYPE|html|body|head)/i.test(x);
const wrapErr = (err, fallback='Request failed') => {
  const payload = err?.response?.data ?? err?.message ?? String(err);
  if (isHtml(payload)) return { error: fallback, hint: "Base URL isn't the FileMaker Data API. Autodetect will try alternatives." };
  return { error: fallback, detail: payload };
};
const must = (v,n) => { if(!v) throw new Error(`Missing env ${n}`); return v; };
must(FM_HOST_RAW,'FM_HOST (or FM_SERVER)'); must(FM_DB,'FM_DB'); must(FM_USER,'FM_USER'); must(FM_PASS,'FM_PASS'); must(FM_LAYOUT,'FM_LAYOUT');

const truthy = v => (v === true) || ['1','true','yes','y','on'].includes(String(v ?? '').trim().toLowerCase());
const falsy  = v => (v === false) || ['0','false','no','n','off',''].includes(String(v ?? '').trim().toLowerCase());

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
function pullYearField(f) {
  const candidates = [F_YEAR_RELEASE,'Year of Release','Tape Files::Year of Release','Tape Files::Release Year','Release Year'];
  for (const key of candidates) if (key in f && String(f[key]??'').trim()!=='') return f[key];
  return null;
}

// Fault detection from a single FM row (track row)
function rowLooksFaulty(f) {
  // 1) explicit faulty flags
  if (truthy(f[F_FAULTY_FLAG1]) || truthy(f[F_FAULTY_FLAG2]) || truthy(f[F_FAULTY_FLAG3])) return true;
  // 2) explicit healthy flags (falsy => faulty)
  if (F_HEALTHY_FLAG1 && F_HEALTHY_FLAG1 in f && falsy(f[F_HEALTHY_FLAG1])) return true;
  if (F_HEALTHY_FLAG2 && F_HEALTHY_FLAG2 in f && falsy(f[F_HEALTHY_FLAG2])) return true;
  if (F_HEALTHY_FLAG3 && F_HEALTHY_FLAG3 in f && falsy(f[F_HEALTHY_FLAG3])) return true;
  // 3) obvious audio breakage on this row
  const audio = String(f[F_AUDIO_FIELD] ?? f['Audio'] ?? f['Stream URL'] ?? f['StreamUrl'] ?? f['Container URL'] ?? f['containerUrl'] ?? f['Audio URL'] ?? '').trim();
  if (!audio) return true;
  const durRaw = String(f[F_DURATION] ?? f['Track Duration'] ?? f['Duration'] ?? f['Media Duration (s)'] ?? '').trim();
  if (durRaw === '0' || /^0+:?0{0,2}(:?0{0,2})?$/.test(durRaw)) return true;
  return false;
}

function mapAlbumFieldsFromRow(f) {
  const yraw = pullYearField(f);
  return {
    albumCatalogueNumber: f[F_ALBUM_REF],
    albumTitle: f[F_ALBUM_TITLE],
    albumArtist: f[F_ALBUM_ARTIST],
    ddexStatus: f[F_DDEX_STATUS] || '—',
    yearOfRelease: parseYear(yraw)
  };
}

// Aggregate albums over many rows, applying faulty logic
function aggregateAlbumsFromRows(rows) {
  const byRef = new Map();
  for (const rec of rows) {
    const f = rec.fieldData || {};
    const ref = f[F_ALBUM_REF];
    if (!ref) continue;
    let agg = byRef.get(ref);
    if (!agg) {
      agg = { ...mapAlbumFieldsFromRow(f), faulty: false };
      byRef.set(ref, agg);
    }
    if (!agg.faulty && rowLooksFaulty(f)) agg.faulty = true;
  }
  // keep only non-faulty
  return Array.from(byRef.values()).filter(a => !a.faulty);
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

// ----- page-filling gatherers (scan -> aggregate -> paginate) -----
async function gatherAlbums_Find(token, base, terms, page) {
  const needStart = (page - 1) * PAGE_SIZE;
  const allRows = [];
  let offset = 1, scanned = 0;

  while (scanned < MAX_ROWS_SCAN && allRows.length < needStart + PAGE_SIZE * 6) { // read ahead to fill after filtering
    const chunk = await fmFind(token, base, FM_LAYOUT, terms, { offset, limit: FIND_BATCH });
    if (!chunk.length) break;
    scanned += chunk.length;
    offset += FIND_BATCH;
    allRows.push(...chunk);
    if (chunk.length < FIND_BATCH) break;
  }

  const albums = aggregateAlbumsFromRows(allRows);
  return {
    albums: albums.slice(needStart, needStart + PAGE_SIZE),
    scannedRows: allRows.length,
    totalAfterFilter: albums.length
  };
}

async function gatherAlbums_List(token, base, page) {
  const needStart = (page - 1) * PAGE_SIZE;
  const allRows = [];
  let offset = 1, scanned = 0;

  while (scanned < MAX_ROWS_SCAN && allRows.length < needStart + PAGE_SIZE * 6) {
    const chunk = await fmList(token, base, FM_LAYOUT, offset, LIST_BATCH);
    if (!chunk.length) break;
    scanned += chunk.length;
    offset += LIST_BATCH;
    allRows.push(...chunk);
    if (chunk.length < LIST_BATCH) break;
  }

  const albums = aggregateAlbumsFromRows(allRows);
  return {
    albums: albums.slice(needStart, needStart + PAGE_SIZE),
    scannedRows: allRows.length,
    totalAfterFilter: albums.length
  };
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

// ---------- Albums search (album-level faulty filter) ----------
app.get('/api/albums', async (req, res) => {
  const { artist='', album='', ref='', page=1, mode='contains' } = req.query;
  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    const p = Math.max(1, Number(page) || 1);
    const terms = {};
    if (artist) terms[F_ALBUM_ARTIST] = (mode === 'equals') ? String(artist).trim() : fmContains(artist);
    if (album)  terms[F_ALBUM_TITLE]  = (mode === 'equals') ? String(album).trim()  : fmContains(album);
    if (ref)    terms[F_ALBUM_REF]    = (mode === 'equals') ? String(ref).trim()    : fmContains(ref);

    const result = Object.keys(terms).length
      ? await gatherAlbums_Find(token, base, terms, p)
      : await gatherAlbums_List(token, base, p);

    res.json({
      page: Number(p),
      pageSize: PAGE_SIZE,
      albums: result.albums,
      foundCount: result.totalAfterFilter
    });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Album search failed'));
  } finally {
    if (token && base) await fmLogout(token, base);
  }
});

// ---------- Tracks for album (unchanged; track details) ----------
app.get('/api/albums/:ref/tracks', async (req, res) => {
  const albumRef = String(req.params.ref || '').trim();
  if (!albumRef) return res.json({ album: '', trackCount: 0, tracks: [] });

  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    const records = await fmFind(token, base, FM_LAYOUT, { [F_ALBUM_REF]: albumRef }, { offset: 1, limit: 999 });

    const getFirst = (f, keys) => { for (const k of keys) if (k in f && String(f[k]??'').trim()!=='') return f[k]; return ''; };
    const parseSeconds = (v) => {
      const s = String(v ?? '').trim(); if (!s) return NaN;
      if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) { const p = s.split(':').map(Number); return p.length===3 ? (p[0]*3600+p[1]*60+p[2]) : (p[0]*60+p[1]); }
      const m = s.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/); if (m) return Number(m[1])*3600 + Number(m[2])*60 + Number(m[3]);
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
      const dRaw    = getFirst(f, [F_DURATION, 'Track Duration', 'Duration', 'Media Duration (s)']);
      const dur     = parseSeconds(dRaw);

      return {
        trackName: title || '(Untitled)',
        trackArtist: artist || '',
        audioSrc: String(audio || '').trim(),
        duration: isNaN(dur) ? null : Number(dur),
        isrc, languageCode: lang,
        producer: prod, composer: comp1, composer2: comp2, composer3: comp3,
        originalReleaseDate: odate,
        ddexStatus: tddex || '',
        trackNumber: number
      };
    }).filter(t => t.trackName || t.audioSrc)
      .sort((a,b) => (a.trackNumber ?? 1e9) - (b.trackNumber ?? 1e9));

    res.json({ album: albumRef, trackCount: tracks.length, tracks });
  } catch (err) {
    res.status(500).json(wrapErr(err, 'Track fetch failed'));
  } finally {
    if (token && base) await fmLogout(token, base);
  }
});

// ---------- Explore decade (aggregate first, then sample 15) ----------
app.get('/api/explore/decade', async (req, res) => {
  const { label='', limit=15 } = req.query;
  const range = decadeToRange(label);
  if (!range) return res.json({ albums: [] });

  let token, base;
  try {
    const r = await resolveBaseAndLogin();
    base = r.base; token = r.token;

    // Scan a large chunk, then aggregate -> year filter -> sample
    const allRows = [];
    let offset = 1, scanned = 0, batch = 500;
    while (scanned < MAX_ROWS_SCAN && allRows.length < 4000) {
      const chunk = await fmList(token, base, FM_LAYOUT, offset, batch);
      if (!chunk.length) break;
      scanned += chunk.length;
      offset += batch;
      allRows.push(...chunk);
      if (chunk.length < batch) break;
    }

    const albums = aggregateAlbumsFromRows(allRows)
      .filter(a => {
        const y = a.yearOfRelease;
        return y && y >= range.start && y <= range.end;
      });

    const pick = sampleN(albums, Math.max(1, Math.min(100, Number(limit)||15)));
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
  console.log(`[MASS] PAGE_SIZE=${PAGE_SIZE}`);
});
