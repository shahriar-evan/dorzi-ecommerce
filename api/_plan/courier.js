// Courier fraud check (Admin CRM → customer profile → "Courier check"): how many parcels this phone number got
// across Bangladesh couriers (Steadfast, Pathao, RedX, Paperfly, CarryBee, Parceldex, CourrierFast) and how many it
// sent back / cancelled, plus fraud reports other shops made about the number.
//   POST /api/plan?action=courier-check  team only, body { phone, fresh? }
// Uses BD Courier (app.courier.com.bd → Developer/API, POST https://api.bdcourier.com/courier-check, Bearer key,
// needs BDCOURIER_API_KEY; free plan 80 checks a day). The answer is kept 24 h in
// courierChecks/{phoneKey} (server only; no client rule allows it) so the same number does not use the daily limit twice.
// Optional COURIER_CHECK_DAILY_LIMIT (default 80, the free plan) caps new API calls per day for the whole team (courierUsage/{day}).
import { FS, accessToken, val } from '../_sslc.js';
import { teamCaller } from './aiphoto.js';

const API = 'https://api.bdcourier.com/courier-check';
const KEEP_MS = 24 * 60 * 60 * 1000;

const phoneKey = (p) => String(p || '').replace(/[\s()-]/g, '').replace(/^[+]/, '').replace(/^880/, '0').replace(/^1/, '01');
const num = (v) => Math.max(0, Math.round(Number(v) || 0));
const dayBD = () => new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);

// BD Courier answer ({ status, data: { <courier>: {...}, summary }, reports }) →
//   { couriers: [{ name, total, success, cancel }], total, success, cancel, rate, reports: [{ name, text, courier, at }] (max 5) }
export function shape(out) {
  const cd = (out && out.data) || {};
  const sum = cd.summary || {};
  const couriers = Object.entries(cd).filter(([k, c]) => k !== 'summary' && c && typeof c === 'object').map(([k, c]) => ({
    name: String(c.name || k).slice(0, 20), total: num(c.total_parcel), success: num(c.success_parcel), cancel: num(c.cancelled_parcel),
  })).sort((x, y) => y.total - x.total).slice(0, 10);
  const total = num(sum.total_parcel), success = num(sum.success_parcel), cancel = num(sum.cancelled_parcel);
  const reports = (Array.isArray(out && out.reports) ? out.reports : []).slice(0, 5).map((r) => ({
    name: String(r.name || '').slice(0, 40), text: String(r.details || '').slice(0, 200), courier: String(r.courierName || '').slice(0, 20), at: String(r.created_at || '').slice(0, 10),
  }));
  return { couriers, total, success, cancel, rate: total ? Math.round((success / total) * 100) : null, reports };
}

async function readDoc(token, path) {
  const r = await fetch(`${FS}/documents/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, val(v)]));
}

async function writeDoc(token, path, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  await fetch(`${FS}/documents/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

const BATCH_MAX = 25;        // numbers per Orders panel request
const BATCH_NEW_MAX = 10;    // new API calls per Orders panel request (the rest wait for the next open)
const BATCH_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // the Orders panel badge accepts an answer up to 30 days old

// one API call → { result } | { error, status }
async function askApi(apiKey, key) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ phone: key }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out.status !== 'success' || !out.data) {
      console.error('courier-check', r.status, out && out.message);
      const msg = r.status === 401 ? 'API key is wrong or expired (BDCOURIER_API_KEY).' : String((out && (out.message || out.error)) || '').slice(0, 160);
      return { error: msg ? `Courier check service: ${msg}` : 'Courier check service did not answer. Try again later.', status: r.status === 429 ? 429 : 502 };
    }
    return { result: shape(out) };
  } catch (e) {
    return { error: 'Courier check service did not answer. Try again later.', status: 502 };
  }
}

const fromCache = (c, maxAge) => {
  if (!c || !c.result || Date.now() - Date.parse(c.at || 0) >= maxAge) return null;
  try { return { ...JSON.parse(c.result), at: c.at, cached: true }; } catch (e) { return null; }
};

// body { phone, fresh? } → one answer (CRM profile)
// body { phones: [...] } → { results: { <phoneKey>: answer } } (Orders panel badges; saved answers first, then at most
//   BATCH_NEW_MAX new API calls; numbers not checked yet are simply missing and are tried on the next open)
export default async function courierCheck(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const who = await teamCaller(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  const valid = (k) => /^01[3-9][0-9]{8}$/.test(k);
  const batch = Array.isArray(body.phones);
  const keys = batch ? [...new Set(body.phones.map(phoneKey))].filter(valid).slice(0, BATCH_MAX) : [phoneKey(body.phone)];
  if (!batch && !valid(keys[0])) return res.status(400).json({ error: 'Not a Bangladesh mobile number (01XXXXXXXXX).' });

  const token = await accessToken();
  const results = {};
  const todo = [];
  await Promise.all(keys.map(async (key) => {
    const hit = (batch || !body.fresh) ? fromCache(await readDoc(token, `courierChecks/${key}`), batch ? BATCH_KEEP_MS : KEEP_MS) : null;
    if (hit) results[key] = hit; else todo.push(key);
  }));
  if (!batch && results[keys[0]]) return res.json(results[keys[0]]);
  if (batch && !todo.length) return res.json({ results });

  const apiKey = process.env.BDCOURIER_API_KEY;
  if (!apiKey) return batch ? res.json({ results, note: 'not-set-up' }) : res.status(503).json({ error: 'Courier check is not set up yet (BDCOURIER_API_KEY in Vercel).' });

  const day = dayBD();
  const limit = Number(process.env.COURIER_CHECK_DAILY_LIMIT) || 80;
  const used = num((await readDoc(token, `courierUsage/${day}`) || {}).count);
  const room = Math.max(0, limit - used);
  if (!room) return batch ? res.json({ results, note: 'limit' }) : res.status(429).json({ error: `Today's courier check limit (${limit}) is used up. Try again tomorrow.` });

  let calls = 0;
  let lastError = null;
  for (const key of todo.slice(0, Math.min(room, batch ? BATCH_NEW_MAX : 1))) {
    const a = await askApi(apiKey, key);
    calls += 1;
    if (a.error) { lastError = a; if (a.status === 429) break; continue; }
    const at = new Date().toISOString();
    results[key] = { ...a.result, at, cached: false };
    await writeDoc(token, `courierChecks/${key}`, { result: { stringValue: JSON.stringify(a.result) }, at: { stringValue: at }, by: { stringValue: who.email } });
  }
  if (calls) await writeDoc(token, `courierUsage/${day}`, { count: { integerValue: String(used + calls) }, updatedAt: { stringValue: new Date().toISOString() } });

  if (batch) return res.json({ results });
  if (results[keys[0]]) return res.json(results[keys[0]]);
  return res.status((lastError && lastError.status) || 502).json({ error: (lastError && lastError.error) || 'Courier check failed.' });
}
