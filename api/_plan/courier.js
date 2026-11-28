// Courier fraud check (Admin CRM → customer profile → "Courier check"): how many parcels this phone number got
// across Bangladesh couriers (Steadfast, Pathao, RedX, Paperfly, CarryBee, Parceldex, CourrierFast) and how many it
// sent back / cancelled, plus FraudShield's risk score and other shops' reviews of the number.
//   POST /api/plan?action=courier-check  team only, body { phone, fresh? }
// Uses FraudShield (fraudshield.bd, POST /api/customer/check, needs FRAUDSHIELD_API_KEY). The answer is kept 24 h in
// courierChecks/{phoneKey} (server only; no client rule allows it) so the same number does not use the daily limit twice.
// Optional COURIER_CHECK_DAILY_LIMIT (default 100) caps new API calls per day for the whole team (courierUsage/{day}).
import { FS, accessToken, val } from '../_sslc.js';
import { teamCaller } from './aiphoto.js';

const API = 'https://fraudshield.bd/api/customer/check';
const KEEP_MS = 24 * 60 * 60 * 1000;

const phoneKey = (p) => String(p || '').replace(/[\s()-]/g, '').replace(/^[+]/, '').replace(/^880/, '0').replace(/^1/, '01');
const num = (v) => Math.max(0, Math.round(Number(v) || 0));
const dayBD = () => new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);

// FraudShield answer → { couriers: [{ name, total, success, cancel }], total, success, cancel, rate,
//   risk: { score, level, label } | null, reviews: [{ name, rating, comment, at }] (max 5) }
export function shape(data) {
  const cd = (data && data.courierData) || {};
  const sum = cd.summary || {};
  const couriers = Object.entries(cd).filter(([k, c]) => k !== 'summary' && c && typeof c === 'object').map(([k, c]) => ({
    name: String(c.name || k).slice(0, 20), total: num(c.total_parcel), success: num(c.success_parcel), cancel: num(c.cancelled_parcel),
  })).slice(0, 10);
  const total = num(sum.total_parcel), success = num(sum.success_parcel), cancel = num(sum.cancelled_parcel);
  const rs = data && data.fraudRiskScore;
  const risk = rs && typeof rs === 'object'
    ? { score: Math.min(100, num(rs.score)), level: String(rs.level || '').slice(0, 20), label: String(rs.label || '').slice(0, 30) }
    : null;
  const reviews = (Array.isArray(data && data.reviews) ? data.reviews : []).slice(0, 5).map((r) => ({
    name: String(r.name || '').slice(0, 40), rating: Math.min(5, num(r.rating)), comment: String(r.comment || '').slice(0, 200), at: String(r.created_at || '').slice(0, 10),
  }));
  return { couriers, total, success, cancel, rate: total ? Math.round((success / total) * 100) : null, risk, reviews };
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

export default async function courierCheck(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const who = await teamCaller(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  const key = phoneKey(body.phone);
  if (!/^01[3-9][0-9]{8}$/.test(key)) return res.status(400).json({ error: 'Not a Bangladesh mobile number (01XXXXXXXXX).' });

  const token = await accessToken();
  const cached = await readDoc(token, `courierChecks/${key}`);
  if (cached && cached.result && !body.fresh && Date.now() - Date.parse(cached.at || 0) < KEEP_MS) {
    try { return res.json({ ...JSON.parse(cached.result), at: cached.at, cached: true }); } catch (e) { /* old / bad copy: ask again */ }
  }

  const apiKey = process.env.FRAUDSHIELD_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Courier check is not set up yet (FRAUDSHIELD_API_KEY in Vercel).' });

  const day = dayBD();
  const limit = Number(process.env.COURIER_CHECK_DAILY_LIMIT) || 100;
  const used = num((await readDoc(token, `courierUsage/${day}`) || {}).count);
  if (used >= limit) return res.status(429).json({ error: `Today's courier check limit (${limit}) is used up. Try again tomorrow.` });

  let out;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ phone: key }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    out = await r.json().catch(() => ({}));
    if (!r.ok || out.success === false || !out.courierData) {
      console.error('courier-check', r.status, out && out.message);
      const msg = r.status === 401 ? 'API key is wrong or expired (FRAUDSHIELD_API_KEY).' : String((out && (out.message || out.error)) || '').slice(0, 160);
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg ? `Courier check service: ${msg}` : 'Courier check service did not answer. Try again later.' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Courier check service did not answer. Try again later.' });
  }

  const result = shape(out);
  const at = new Date().toISOString();
  await Promise.all([
    writeDoc(token, `courierChecks/${key}`, { result: { stringValue: JSON.stringify(result) }, at: { stringValue: at }, by: { stringValue: who.email } }),
    writeDoc(token, `courierUsage/${day}`, { count: { integerValue: String(used + 1) }, updatedAt: { stringValue: at } }),
  ]);
  return res.json({ ...result, at, cached: false });
}
