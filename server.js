// CODEX_CANARY
// server.js — CommonJS, Node 18+ (global fetch). Supports 3-field search and streams containers correctly.
require('dotenv').config();
const express = require('express');
const path = require('path');
const { Readable } = require('stream');

const app = express();

/* ========= ENV ========= */
const FM_HOST   = process.env.FM_HOST;            // e.g. https://digitalcupboard.app
const FM_DB     = process.env.FM_DB;              // e.g. Gallo CMS 2024
const FM_USER   = process.env.FM_USER;
const FM_PASS   = process.env.FM_PASS;
const FM_LAYOUT = process.env.FM_LAYOUT || 'API_Album_Songs';
const PORT      = process.env.PORT || 3000;
const HOST      = process.env.HOST || '127.0.0.1';

if (!FM_HOST || !FM_DB || !FM_USER || !FM_PASS) {
  console.warn('[MASS] Missing .env values; expected FM_HOST, FM_DB, FM_USER, FM_PASS');
}

/* ========= FileMaker client ========= */
const fmBase = `${FM_HOST}/fmi/data/vLatest/databases/${encodeURIComponent(FM_DB)}`;
let fmToken = null;
let fmTokenExpiresAt = 0; // epoch ms

async function fmLogin() {
  const res = await fetch(`${fmBase}/sessions`, {
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
  // 12-min TTL (FM tokens expire after ~15m of inactivity)
  fmTokenExpiresAt = Date.now() + 12 * 60 * 1000;
  return fmToken;
}

async function ensureToken() {
  if (!fmToken || Date.now() > fmTokenExpiresAt) {
    await fmLogin();
  }
  return fmToken;
}

async function fmPost(path, body) {
  await ensureToken();
  const url = `${fmBase}${path}`;
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${fmToken}`
    },
    body: JSON.stringify(body)
  });
  if (res.status === 401) {
    await fmLogin();
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${fmToken}`
      },
      body: JSON.stringify(body)
    });
  }
  return res;
}

async function fmGetAbsolute(u) {
  await ensureToken();
  const headers = {};
  if (typeof u === 'string' && u.startsWith(FM_HOST)) {
    headers['Authorization'] = `Bearer ${fmToken}`;
  }
  const r = await fetch(u, { headers });
  if (r.status === 401 && u.startsWith(FM_HOST)) {
    await fmLogin();
    return fetch(u, { headers: { 'Authorization': `Bearer ${fmToken}` } });
  }
  return r;
}

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

const begins = (s) => s ? `${s}*` : '';
const contains = (s) => s ? `*${s}*` : '';

const TRACK_SEQUENCE_KEYS = [
  'Sequence_Number',
  'Track_Sequence',
  'Sequence',
  'TrackNo',
  'TrackNumber',
  'Track_Order'
];

const ARTIST_FIELDS = [
  'Album Artist',
  'Track Artist'
];

const YEAR_RANGE_FIELDS = [
  'Year_Release_num',
  'Year Release num',
  'Year Release',
  'Year_Release',
  'Year'
];

const YEAR_TEXT_FIELDS = [
  'Year of Release',
  'Year Of Release',
  'Year of release',
  'Original Release Year',
  'Original Release Date',
  'Release Year',
  'Recording Year',
  'Year Release',
  'Years Release',
  'Tape Files::Year of Release',
  'Tape Files::Year Release',
  'Tape Files::Year',
  'Albums::Year of Release',
  'Albums::Year Release',
  'Albums::Year',
  'API_Albums::Year of Release',
  'API_Albums::Year Release',
  'API_Albums::Year'
];

const YEAR_FIELD_SET = [...new Set([...YEAR_RANGE_FIELDS, ...YEAR_TEXT_FIELDS])];

const ALBUM_KEY_FIELD_MAP = [
  { field: 'Album Catalogue Number', prefix: 'cat' },
  { field: 'Album Catalog Number', prefix: 'cat_alt' },
  { field: 'Album_ID', prefix: 'album_id' }
];

function canonicalAlbumKey(fields = {}) {
  for (const entry of ALBUM_KEY_FIELD_MAP) {
    const value = (fields[entry.field] || '').trim();
    if (value) {
      const encoded = encodeURIComponent(value);
      return {
        key: `${entry.prefix}:${encoded}`,
        type: 'field',
        field: entry.field,
        value,
        query: { [entry.field]: `==${value}` },
        groupKey: `field|${entry.field}`
      };
    }
  }

  const title = (fields['Album Title'] || '').trim();
  const artist = (fields['Album Artist'] || fields['Tape Files::Album Artist'] || fields['Track Artist'] || '').trim();
  if (title && artist) {
    return {
      key: `titleartist:${encodeURIComponent(title)}|${encodeURIComponent(artist)}`,
      type: 'composite',
      title,
      artist,
      query: { 'Album Title': `==${title}`, 'Album Artist': `==${artist}` },
      groupKey: 'composite'
    };
  }

  if (title) {
    return {
      key: `title:${encodeURIComponent(title)}`,
      type: 'title',
      title,
      query: { 'Album Title': `==${title}` },
      groupKey: 'title'
    };
  }

  return null;
}

function decodeAlbumKey(albumKey) {
  if (!albumKey || typeof albumKey !== 'string') return null;
  const idx = albumKey.indexOf(':');
  if (idx === -1) return null;
  const type = albumKey.slice(0, idx);
  const payload = albumKey.slice(idx + 1);

  if (type === 'cat' || type === 'cat_alt' || type === 'album_id') {
    const entry = ALBUM_KEY_FIELD_MAP.find(item => item.prefix === type);
    if (!entry) return null;
    const value = decodeURIComponent(payload || '');
    if (!value) return null;
    return {
      key: albumKey,
      type: 'field',
      field: entry.field,
      value,
      query: { [entry.field]: `==${value}` },
      groupKey: `field|${entry.field}`
    };
  }

  if (type === 'titleartist') {
    const [titleEnc = '', artistEnc = ''] = payload.split('|');
    const title = decodeURIComponent(titleEnc || '');
    const artist = decodeURIComponent(artistEnc || '');
    if (!title || !artist) return null;
    return {
      key: albumKey,
      type: 'composite',
      title,
      artist,
      query: { 'Album Title': `==${title}`, 'Album Artist': `==${artist}` },
      groupKey: 'composite'
    };
  }

  if (type === 'title') {
    const title = decodeURIComponent(payload || '');
    if (!title) return null;
    return {
      key: albumKey,
      type: 'title',
      title,
      query: { 'Album Title': `==${title}` },
      groupKey: 'title'
    };
  }

  return null;
}

function parseSequence(fields = {}) {
  for (const key of TRACK_SEQUENCE_KEYS) {
    if (!(key in fields)) continue;
    const raw = fields[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const direct = Number(raw);
    if (Number.isFinite(direct)) return direct;
    if (typeof raw === 'string') {
      const cleaned = Number(raw.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(cleaned)) return cleaned;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function extractYear(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function recordMatchesDecade(fields, start, endExclusive) {
  for (const key of YEAR_FIELD_SET) {
    if (!(key in fields)) continue;
    const year = extractYear(fields[key]);
    if (year !== null && year >= start && year < endExclusive) return true;
  }
  return false;
}

function formatRecords(rows = [], { includeAlbumKey = false } = {}) {
  return rows.map(rec => {
    const fields = rec.fieldData || {};
    const out = { recordId: rec.recordId, modId: rec.modId, fields };
    if (includeAlbumKey) {
      const meta = canonicalAlbumKey(fields);
      if (meta) out.__albumKeyMeta = meta;
    }
    return out;
  });
}

async function countTracksForAlbumKeys(metas = []) {
  const counts = {};
  const uniqueMetas = [];
  const seen = new Set();
  for (const meta of metas) {
    if (!meta?.key) continue;
    if (seen.has(meta.key)) continue;
    seen.add(meta.key);
    uniqueMetas.push(meta);
  }

  if (!uniqueMetas.length) return counts;

  const sampleKey = uniqueMetas[0]?.key || null;
  console.log('[MASS] track-count keys', { totalKeys: uniqueMetas.length, sample: sampleKey });

  const grouped = new Map();
  for (const meta of uniqueMetas) {
    const groupKey = meta.groupKey || meta.type || 'misc';
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(meta);
  }

  for (const [groupKey, metasForGroup] of grouped.entries()) {
    const queries = metasForGroup.map(meta => meta.query).filter(Boolean);
    if (!queries.length) continue;
    const limit = Math.max(1000, metasForGroup.length * 200);
    const payload = { query: queries, limit, offset: 1 };
    const result = await runFind(payload);
    if (!result.ok) {
      console.log('[MASS] track-count warn', { group: groupKey, warn: result.error || result.status });
      continue;
    }
    console.log('[MASS] track-count group', { group: groupKey, queries: metasForGroup.length, ms: result.ms });
    const records = result.data || [];
    for (const rec of records) {
      const keyInfo = canonicalAlbumKey(rec.fieldData || {});
      if (keyInfo?.key) {
        counts[keyInfo.key] = (counts[keyInfo.key] || 0) + 1;
      }
    }
  }

  return counts;
}

async function attachTrackCounts(records = []) {
  const metaMap = new Map();
  for (const rec of records) {
    if (rec.__albumKeyMeta) metaMap.set(rec.__albumKeyMeta.key, rec.__albumKeyMeta);
  }
  const metas = Array.from(metaMap.values());
  const counts = metas.length ? await countTracksForAlbumKeys(metas) : {};
  for (const rec of records) {
    if (rec.__albumKeyMeta) {
      rec.albumKey = rec.__albumKeyMeta.key;
      rec.trackCount = counts[rec.__albumKeyMeta.key] ?? 0;
      delete rec.__albumKeyMeta;
    } else {
      rec.trackCount = rec.trackCount ?? 0;
    }
  }
  return counts;
}

function buildTrackObject(record, albumKey) {
  const fields = record.fields || {};
  const seq = parseSequence(fields);
  const name = (fields['Track Name'] || fields['Track_Name'] || fields['TrackTitle'] || '').trim();
  const mp3 = (fields['mp3'] || fields['MP3'] || fields['Audio File'] || fields['Audio::mp3'] || '').trim();
  const producer = (fields['Producer'] || '').trim();
  const composer1 = (fields['Composer 1'] || fields['Composer1'] || '').trim();
  const composer2 = (fields['Composer 2'] || fields['Composer2'] || '').trim();
  const composer3 = (fields['Composer 3'] || fields['Composer3'] || '').trim();
  const composer4 = (fields['Composer 4'] || fields['Composer4'] || '').trim();
  const language = (fields['Language'] || fields['Language Code'] || '').trim();
  const genre = (fields['Local Genre'] || fields['Genre'] || '').trim();
  const isrc = (fields['ISRC'] || '').trim();

  return {
    recordId: record.recordId,
    albumKey,
    seq,
    name,
    mp3,
    producer,
    composer1,
    composer2,
    composer3,
    composer4,
    language,
    genre,
    isrc
  };
}

async function fetchFullTracksByAlbumKey(albumKey) {
  const meta = decodeAlbumKey(albumKey);
  if (!meta) {
    const err = new Error('Invalid album key');
    err.status = 400;
    throw err;
  }

  const payload = {
    query: [meta.query],
    limit: 2000,
    offset: 1
  };

  const result = await runFind(payload);
  if (!result.ok) {
    const err = new Error(result.error || 'Album track fetch failed');
    err.status = result.status || 500;
    throw err;
  }

  const records = formatRecords(result.data || [], { includeAlbumKey: false });
  const tracks = records.map(rec => buildTrackObject(rec, albumKey));
  tracks.sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });

  console.log('[MASS] album-tracks', { albumKey, trackCount: tracks.length, ms: result.ms });

  return { tracks, trackCount: tracks.length };
}

function normalizeDecade(query = {}) {
  const parseYear = (val) => {
    if (val === undefined || val === null) return null;
    const match = String(val).match(/(\d{4})/);
    if (!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : null;
  };

  const rawDecade = (query.decade || '').toString().trim();
  let start = null;
  let endExclusive = null;

  if (rawDecade) {
    if (/^\d{4}s$/i.test(rawDecade)) {
      start = Number(rawDecade.slice(0, 4));
    } else {
      const matches = rawDecade.match(/\d{4}/g);
      if (matches && matches.length) {
        start = Number(matches[0]);
        if (matches.length > 1) {
          const second = Number(matches[1]);
          if (Number.isFinite(second)) {
            endExclusive = second + 1;
          }
        }
      }
    }
  }

  const startParam = parseYear(query.start);
  const endParam = parseYear(query.end);
  if (start === null && startParam !== null) start = startParam;
  if (start === null && endParam !== null) start = endParam - 9;
  if (endExclusive === null && endParam !== null) endExclusive = endParam + 1;

  if (start === null || !Number.isFinite(start)) return null;
  start = Math.floor(start / 10) * 10;
  if (start < 1000) return null;

  if (endExclusive === null || !Number.isFinite(endExclusive)) endExclusive = start + 10;
  if (endExclusive <= start) endExclusive = start + 10;
  if (endExclusive - start > 10) endExclusive = start + 10;

  return { start, end: endExclusive };
}

async function runFind(payload) {
  const started = Date.now();
  const resp = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
  const ms = Date.now() - started;
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.messages?.[0]?.message || 'FM error';
    const code = json?.messages?.[0]?.code;
    return { ok:false, error:`${msg}${code ? ` (${code})` : ''}`, status: resp.status, ms, payload };
  }
  const data  = json?.response?.data || [];
  const total = Number(json?.response?.dataInfo?.foundCount ?? data.length);
  return { ok:true, data, total, ms, payload };
}

async function searchByArtist(term, limit, fmOffset) {
  const pattern = contains(term);
  let lastError = null;
  let fallback = null;

  for (const field of ARTIST_FIELDS) {
    const payload = { query: [ { [field]: pattern } ], limit, offset: fmOffset };
    const result = await runFind(payload);
    if (!result.ok) {
      lastError = result.error;
      continue;
    }
    if (result.total > 0) {
      return { ...result, fieldUsed: field, lastError };
    }
    if (!fallback) fallback = { ...result, fieldUsed: field, lastError };
  }

  return fallback || { ok:true, data: [], total: 0, ms: 0, fieldUsed: 'none', lastError };
}

app.get('/api/search', async (req, res) => {
  try {
    // Accept both legacy q and the 3-field form
    const q      = (req.query.q || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const album  = (req.query.album  || '').toString().trim();
    const track  = (req.query.track  || '').toString().trim();
    const hasArtistParam = Object.prototype.hasOwnProperty.call(req.query, 'artist');
    if (hasArtistParam && !artist) {
      return res.status(400).json({ error: 'Artist search requires a non-empty artist parameter' });
    }

    const defaultLimit = hasArtistParam ? 9 : 60;
    const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit || String(defaultLimit), 10)));
    const uiOff0 = Math.max(0, parseInt(req.query.offset || '0', 10)); // UI 0-based
    const fmOff  = uiOff0 + 1; // FM is 1-based

    if (hasArtistParam && artist && !q && !album && !track) {
      const result = await searchByArtist(artist, limit, fmOff);
      const items = formatRecords(result.data, { includeAlbumKey: true });
      await attachTrackCounts(items);
      console.log('[MASS] search artist', {
        artist,
        total: result.total,
        field: result.fieldUsed,
        offset: uiOff0,
        limit,
        ms: result.ms,
        ...(result.lastError ? { warn: result.lastError } : {})
      });
      return res.json({ items, total: result.total, offset: uiOff0, limit });
    }

    // Build _find queries
    let queries = [];
    if (artist || album || track) {
      // AND across inputs, OR across field-name variants
      let combos = [{}];
      const extend = (arr, make) => {
        const out = [];
        for (const base of arr) {
          const vs = make(base);
          if (Array.isArray(vs)) out.push(...vs); else out.push(vs);
        }
        return out;
      };
      if (artist) {
        combos = extend(combos, b => [
          { ...b, ['Album Artist']: begins(artist) },
          { ...b, ['Tape Files::Album Artist']: begins(artist) },
          { ...b, ['Track Artist']: begins(artist) },
        ]);
      }
      if (album) {
        combos = extend(combos, b => [
          { ...b, ['Album Title']: begins(album) },
          { ...b, ['Tape Files::Album_Title']: begins(album) },
        ]);
      }
      if (track) {
        combos = extend(combos, b => [
          { ...b, ['Track Name']: begins(track) }
        ]);
      }
      queries = combos;
    } else if (q) {
      const needle = begins(q);
      queries = SEARCH_FIELDS.map(f => ({ [f]: needle }));
    } else {
      queries = [ { 'Album Title': '*' } ];
    }

    const payload = { query: queries, limit, offset: fmOff };
    const r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = json?.messages?.[0]?.message || 'FM error';
      const code = json?.messages?.[0]?.code;
      return res.status(500).json({ error: 'Album search failed', status: r.status, detail: `${msg} (${code})` });
    }

    const data  = json?.response?.data || [];
    const formatted = formatRecords(data, { includeAlbumKey: true });
    await attachTrackCounts(formatted);
    const total = json?.response?.dataInfo?.foundCount ?? data.length;

    res.json({
      items: formatted,
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
app.get('/api/container', async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).send('Missing u');

    const upstream = await fmGetAbsolute(u);
    if (!upstream.ok) {
      return res.status(upstream.status).send(`Upstream error: ${upstream.status}`);
    }

    // Pass through content headers
    const ct = upstream.headers.get('content-type');
    const cl = upstream.headers.get('content-length');
    if (ct) res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);

    // WHATWG stream -> Node stream
    if (upstream.body && upstream.body.getReader) {
      return Readable.fromWeb(upstream.body).pipe(res);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.end(buf);
    }
  } catch (e) {
    res.status(500).send('Container proxy failed');
  }
});

/* ========= START ========= */

/* ========= Explore by decade ========= */


app.get('/api/explore', async (req, res) => {
  try {
    const normalized = normalizeDecade(req.query);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid decade parameter. Use decade=1960, 1960s, or 1960-1969.' });
    }

    const { start, end } = normalized; // end is exclusive
    const decadeLabel = `${start}-${end - 1}`;
    const limit = Math.max(1, Math.min(200, parseInt((req.query.limit || '9'), 10)));
    const offset = Math.max(0, parseInt((req.query.offset || '0'), 10));
    const fmOffset = offset + 1;
    const years = Array.from({ length: end - start }, (_, i) => start + i);
    const rangeQuery = `${start}...${end - 1}`;
    let lastError = null;

    const logResult = (field, payload, total, ms, note) => {
      console.log('[MASS] explore decade', {
        decade: decadeLabel,
        field,
        offset,
        limit,
        total,
        ms,
        note,
        query: payload?.query?.length ? payload.query : payload
      });
    };

    // Prefer numeric range fields
    for (const field of YEAR_RANGE_FIELDS) {
      const payload = { query: [ { [field]: rangeQuery } ], limit, offset: fmOffset };
      const result = await runFind(payload);
      if (!result.ok) {
        lastError = result.error;
        continue;
      }
      if (!result.total) continue;
      const items = formatRecords(result.data, { includeAlbumKey: true });
      await attachTrackCounts(items);
      logResult(field, payload, result.total, result.ms, 'range');
      return res.json({ items, total: result.total, offset, limit });
    }

    // Try exact matches on textual fields per year
    for (const field of YEAR_TEXT_FIELDS) {
      const payload = { query: years.map(year => ({ [field]: `==${year}` })), limit, offset: fmOffset };
      const result = await runFind(payload);
      if (!result.ok) {
        lastError = result.error;
        continue;
      }
      if (!result.total) continue;
      const items = formatRecords(result.data, { includeAlbumKey: true });
      await attachTrackCounts(items);
      logResult(field, payload, result.total, result.ms, 'text-eq');
      return res.json({ items, total: result.total, offset, limit });
    }

    // Fallback: contains match + local filtering
    for (const field of YEAR_TEXT_FIELDS) {
      const fetchLimit = Math.min(400, Math.max(limit + offset, limit * 4));
      const payload = { query: years.map(year => ({ [field]: contains(String(year)) })), limit: fetchLimit, offset: 1 };
      const result = await runFind(payload);
      if (!result.ok) {
        lastError = result.error;
        continue;
      }
      if (!result.data.length) continue;
      const formatted = formatRecords(result.data, { includeAlbumKey: true });
      await attachTrackCounts(formatted);
      const filtered = formatted.filter(rec => recordMatchesDecade(rec.fields, start, end));
      if (!filtered.length) continue;
      const total = filtered.length;
      const paged = filtered.slice(offset, offset + limit);
      logResult(field, payload, total, result.ms, 'text-filtered');
      return res.json({ items: paged, total, offset, limit });
    }

    if (lastError) {
      console.log('[MASS] explore decade fallback', { decade: decadeLabel, warn: lastError });
    }
    return res.json({ items: [], total: 0, offset, limit });
  } catch (err) {
    const detail = err?.message || String(err);
    return res.status(500).json({ error: 'Explore failed', detail });
  }
});

/* ========= Album: fetch full tracklist by catalogue OR title/artist ========= */
app.get('/api/album', async (req, res) => {
  try {
    const cat    = (req.query.cat    || '').toString().trim();
    const title  = (req.query.title  || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const limit  = Math.max(1, Math.min(1000, parseInt((req.query.limit || '800'), 10)));

    let queries = [];
    const exact = (v) => `==${v}`;

    if (cat) {
      queries = [
        { 'Album Catalogue Number': exact(cat) },
        { 'Album Catalog Number'  : exact(cat) },
        { 'Album Catalogue No'    : exact(cat) },
      ];
    } else if (title) {
      if (artist) {
        queries = [
          { 'Album Title': exact(title), 'Album Artist': exact(artist) },
          { 'Tape Files::Album_Title': exact(title), 'Tape Files::Album Artist': exact(artist) },
        ];
      } else {
        queries = [
          { 'Album Title': exact(title) },
          { 'Tape Files::Album_Title': exact(title) },
        ];
      }
    } else {
      return res.status(400).json({ error:'Missing cat or title' });
    }

    const payload = { query: queries, limit, offset: 1 };
    const r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = json?.messages?.[0]?.message || 'FM error';
      const code = json?.messages?.[0]?.code;
      return res.status(500).json({ error:'Album lookup failed', status:r.status, detail:`${msg} (${code})` });
    }

    const data  = json?.response?.data || [];
    const decorated = data.map((d, idx) => ({
      recordId: d.recordId,
      modId: d.modId,
      fields: d.fieldData || {},
      _seq: parseSequence(d.fieldData || {}),
      _idx: idx
    }));

    decorated.sort((a, b) => {
      if (a._seq !== b._seq) return a._seq - b._seq;
      return a._idx - b._idx;
    });

    if (decorated.length) {
      const sample = decorated.slice(0, 5).map(item => (item._seq === Number.POSITIVE_INFINITY ? '∞' : item._seq));
      console.log('[MASS] album track sequence sample', sample);
    }

    const items = decorated.map(({ _seq, _idx, ...rest }) => rest);
    const total = json?.response?.dataInfo?.foundCount ?? items.length;

    return res.json({
      ok: true,
      items,
      total, offset: 0, limit
    });
  } catch (err) {
    const detail = err?.message || String(err);
    return res.status(500).json({ error:'Album lookup failed', status:500, detail });
  }
});

app.get('/api/album/:albumKey/tracks', async (req, res) => {
  try {
    const albumKey = String(req.params.albumKey || '').trim();
    if (!albumKey) return res.status(400).json({ error: 'Missing album key' });
    const { tracks, trackCount } = await fetchFullTracksByAlbumKey(albumKey);
    res.json({ albumKey, trackCount, tracks });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to load tracks' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[MASS] listening on http://${HOST}:${PORT}`);
});
