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

app.get('/api/search', async (req, res) => {
  try {
    // Accept both legacy q and the 3-field form
    const q      = (req.query.q || '').toString().trim();
    const artist = (req.query.artist || '').toString().trim();
    const album  = (req.query.album  || '').toString().trim();
    const track  = (req.query.track  || '').toString().trim();
    const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit || '60', 10)));
    const uiOff0 = Math.max(0, parseInt(req.query.offset || '0', 10)); // UI 0-based
    const fmOff  = uiOff0 + 1; // FM is 1-based

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
    const total = json?.response?.dataInfo?.foundCount ?? data.length;

    res.json({
      items: data.map(d => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} })),
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
    const start = parseInt((req.query.start || '0'), 10);
    const end   = parseInt((req.query.end   || '0'), 10);
    const reqLimit = Math.max(1, Math.min(400, parseInt((req.query.limit || '200'), 10)));
    if (!start || !end || end < start) return res.status(400).json({ error:'bad decade', start, end });

    // Try many possible year fields, including related-table names
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

    async function tryFind(payload){
      const r = await fmPost(`/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`, payload);
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg  = json?.messages?.[0]?.message || 'FM error';
        const code = json?.messages?.[0]?.code;
        return { ok:false, status:r.status, msg, code, data:[], total:0 };
      }
      const data  = json?.response?.data || [];
      const total = json?.response?.dataInfo?.foundCount ?? data.length;
      return { ok:true, data, total };
    }

    // 1) Determine a field that actually matches by probing with 1-row limit
    let chosenField = null;
    for (const field of FIELDS){
      const probe = await tryFind({ query: [ { [field]: `${start}...${end}` } ], limit: 1, offset: 1 });
      if (probe.ok && probe.total > 0){
        chosenField = field;
        break;
      }
    }
    if (!chosenField){
      // Try OR of exact years as a probe
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      for (const field of FIELDS){
        const probe = await tryFind({ query: years.map(y => ({ [field]: `==${y}` })), limit: 1, offset: 1 });
        if (probe.ok && probe.total > 0){
          chosenField = field;
          break;
        }
      }
    }
    if (!chosenField){
      // Try prefix style probe
      for (const field of FIELDS){
        const probe = await tryFind({ query: [ { [field]: `${start}*` } ], limit: 1, offset: 1 });
        if (probe.ok && probe.total > 0){
          chosenField = field;
          break;
        }
      }
    }
    if (!chosenField){
      console.log(`[EXPLORE] No matching year field for ${start}-${end}`);
      return res.json({ ok:true, items: [], total: 0, offset: 0, limit: reqLimit });
    }

    // 2) Get total count using chosen field
    const probe = await tryFind({ query: [ { [chosenField]: `${start}...${end}` } ], limit: 1, offset: 1 });
    let foundTotal = probe.total || 0;

    if (!foundTotal){
      // Retry with OR-of-years to compute total
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      const probe2 = await tryFind({ query: years.map(y => ({ [chosenField]: `==${y}` })), limit: 1, offset: 1 });
      foundTotal = probe2.total || 0;
      if (foundTotal === 0){
        // Retry with prefix
        const probe3 = await tryFind({ query: [ { [chosenField]: `${start}*` } ], limit: 1, offset: 1 });
        foundTotal = probe3.total || 0;
      }
    }

    if (foundTotal === 0){
      console.log(`[EXPLORE] Field ${chosenField} yielded 0 rows for ${start}-${end}`);
      return res.json({ ok:true, items: [], total: 0, offset: 0, limit: reqLimit });
    }

    // 3) Choose a random window within the decade set
    const windowSize = Math.min(reqLimit, 400);
    const maxStart = Math.max(1, foundTotal - windowSize + 1);
    const randStart = Math.floor(1 + Math.random() * maxStart);

    // Perform the real fetch from the chosen field (prefer range; fall back if needed)
    let final = await tryFind({ query: [ { [chosenField]: `${start}...${end}` } ], limit: windowSize, offset: randStart });
    if (!final.ok || final.data.length === 0){
      const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      final = await tryFind({ query: years.map(y => ({ [chosenField]: `==${y}` })), limit: windowSize, offset: randStart });
      if (!final.ok || final.data.length === 0){
        final = await tryFind({ query: [ { [chosenField]: `${start}*` } ], limit: windowSize, offset: randStart });
      }
    }

    const items = (final.data || []).map(d => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData || {} }));
    console.log(`[EXPLORE] ${start}-${end} using ${chosenField}: total ${foundTotal}, offset ${randStart}, returned ${items.length}`);
    return res.json({ ok:true, items, total: foundTotal, offset: randStart-1, limit: windowSize, field: chosenField });
  } catch (err) {
    const detail = err?.message || String(err);
    return res.status(500).json({ error:'Explore failed', status:500, detail });
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

app.listen(PORT, HOST, () => {
  console.log(`[MASS] listening on http://${HOST}:${PORT}`);
});
