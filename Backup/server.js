// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();

/* ========= ENV ========= */
const FM_HOST   = process.env.FM_HOST;            // e.g. https://your-filemaker-host
const FM_DB     = process.env.FM_DB;              // e.g. YourDatabaseName
const FM_USER   = process.env.FM_USER;
const FM_PASS   = process.env.FM_PASS;
const FM_LAYOUT = process.env.FM_LAYOUT || 'API_Album_Songs';

function must(v, name){ if(!v) throw new Error(`${name} missing`); }
must(FM_HOST,'FM_HOST'); must(FM_DB,'FM_DB'); must(FM_USER,'FM_USER'); must(FM_PASS,'FM_PASS');

/* ========= AXIOS / TOKEN ========= */
const fm = axios.create({ baseURL: `${FM_HOST}/fmi/data/vLatest`, timeout: 15000 });
let fmToken = null;
let loginPromise = null;

async function fmLogin() {
  if (fmToken) return fmToken;
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const res = await fm.post(`/databases/${encodeURIComponent(FM_DB)}/sessions`, {}, {
      auth: { username: FM_USER, password: FM_PASS },
    });
    fmToken = res.data?.response?.token;
    loginPromise = null;
    return fmToken;
  })().catch(e => { loginPromise = null; throw e; });

  return loginPromise;
}

async function fmPost(path, body) {
  try {
    const token = await fmLogin();
    return await fm.post(path, body, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if (e.response?.status === 401) fmToken = null;
    throw e;
  }
}

async function fmGetAbsolute(absoluteUrl, opts = {}) {
  const token = await fmLogin();
  return axios.get(absoluteUrl, {
    ...opts,
    responseType: opts.responseType || 'arraybuffer',
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
    },
    timeout: 20000,
    validateStatus: () => true,
  });
}

/* ========= SEARCH FIELDS ========= */
const SEARCH_FIELDS = [
  'Album Artist',
  'Album Title',
  'Track Name',
  'Year of Release',
  'Local Genre'
];

/* ========= SEARCH API ========= */
app.get('/api/search', async (req, res) => {
  const q       = (req.query.q || '').trim();
  const limit   = Math.max(1, Math.min(100, parseInt(req.query.limit || '12', 10)));
  const uiOff0  = Math.max(0, parseInt(req.query.offset || '0', 10)); // UI 0-based
  const fmOff   = uiOff0 + 1; // FM 1-based

  const needle = q ? `${q}*` : '*'; // begins-with, wildcard if blank
  const query = SEARCH_FIELDS.map(f => ({ [f]: needle })); // OR across allowed fields

  const payload = { query, limit, offset: fmOff };

  try {
    const r = await fmPost(
      `/databases/${encodeURIComponent(FM_DB)}/layouts/${encodeURIComponent(FM_LAYOUT)}/_find`,
      payload
    );

    const response = r.data?.response || {};
    const items = (response.data || []).map(d => ({
      recordId: d.recordId,
      modId: d.modId,
      fields: d.fieldData || {},
    }));

    // Convert FM 1-based offset back to UI 0-based
    const fmOffsetReturned = Number(response.dataInfo?.offset ?? fmOff);
    const uiOffsetReturned = Math.max(0, fmOffsetReturned - 1);

    res.json({
      ok: true,
      count: response.returnedCount ?? items.length,
      total: response.dataInfo?.foundCount ?? items.length,
      offset: uiOffsetReturned,
      limit,
      items
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || err.message || String(err);
    res.status(500).json({ error: 'Album search failed', status, detail });
  }
});

/* ========= PROXY: FileMaker container (images/mp3) =========
   Use when the container URL requires FM auth cookies/headers.
   Client calls: /api/container?u=<encodeURIComponent(containerUrl)>
*/
app.get('/api/container', async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).send('Missing u');
    // Only allow proxying to this FM host for safety
    if (!u.startsWith(FM_HOST)) return res.status(400).send('URL not allowed');

    const resp = await fmGetAbsolute(u, { responseType: 'arraybuffer' });
    if (!resp || !resp.status) return res.status(502).send('Upstream error');

    // Pass through content-type and length if present
    if (resp.headers['content-type']) res.set('Content-Type', resp.headers['content-type']);
    if (resp.headers['content-length']) res.set('Content-Length', resp.headers['content-length']);

    res.status(resp.status).send(resp.data);
  } catch (e) {
    res.status(500).send('Container proxy failed');
  }
});

/* ========= STATIC + ROOT ========= */
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ========= START ========= */
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`[MASS] listening on http://${HOST}:${PORT}`));
