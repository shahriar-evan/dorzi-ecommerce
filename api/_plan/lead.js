// Incomplete orders ("leads"): a customer typed a phone number (checkout, or to the help chat agent) and picked products,
// but no order came. Saved so the team can message them on WhatsApp with one click (Admin → CRM → Incomplete orders).
//   POST /api/plan?action=lead  public, body { phone, name?, items: [{ id, name, size, color, qty, price }], source: 'checkout'|'chat', shop? }
// Written by the server only (rules: leads/{phoneKey} staff read; staff may only set the contacted fields; no client create),
// one document per phone (a new visit replaces the cart and makes it "new" again).
// Abuse guard: a few saves per minute per visitor (per server instance) and LEAD_DAILY_LIMIT (300) saves a day (leadUsage/{day}).
import { FS, accessToken, val } from '../_sslc.js';

const phoneKey = (p) => String(p || '').replace(/[\s()-]/g, '').replace(/^[+]/, '').replace(/^880/, '0').replace(/^1/, '01');
const clip = (s, n) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const num = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
const dayBD = () => new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);

const recent = new Map();
function tooFast(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 6) { recent.set(ip, list); return true; }
  list.push(now); recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return false;
}

const str = (v) => ({ stringValue: String(v) });
const int = (v) => ({ integerValue: String(v) });

export default async function lead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const key = phoneKey(body.phone);
  if (!/^01[3-9][0-9]{8}$/.test(key)) return res.status(400).json({ error: 'bad-phone' });
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 10).map((it) => ({
    id: clip(it && it.id, 40), name: clip(it && it.name, 120), size: clip(it && it.size, 20), color: clip(it && it.color, 40),
    qty: Math.max(1, num(it && it.qty, 20)), price: num(it && it.price, 1000000),
  })).filter((it) => it.name);
  if (!items.length) return res.status(400).json({ error: 'no-items' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  if (tooFast(ip)) return res.status(429).json({ error: 'too-fast' });

  try {
    const token = await accessToken();
    const day = dayBD();
    const limit = Math.max(1, parseInt(process.env.LEAD_DAILY_LIMIT || '300', 10) || 300);
    const u = await fetch(`${FS}/documents/leadUsage/${day}`, { headers: { Authorization: `Bearer ${token}` } });
    const used = u.ok ? Number(val(((await u.json()).fields || {}).count) || 0) : 0;
    if (used >= limit) return res.status(429).json({ error: 'daily-limit' });

    const at = new Date().toISOString();
    const total = items.reduce((t, it) => t + it.price * it.qty, 0);
    const fields = {
      phone: str(key), name: str(clip(body.name, 80)), source: str(body.source === 'chat' ? 'chat' : 'checkout'), shop: str(clip(body.shop, 60)),
      items: { arrayValue: { values: items.map((it) => ({ mapValue: { fields: { id: str(it.id), name: str(it.name), size: str(it.size), color: str(it.color), qty: int(it.qty), price: int(it.price) } } })) } },
      total: int(total), at: str(at), status: str(''), contactedBy: str(''), contactedAt: str(''),
    };
    const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
    await fetch(`${FS}/documents/leads/${key}?${mask}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
    });
    await fetch(`${FS}/documents/leadUsage/${day}?updateMask.fieldPaths=count`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { count: int(used + 1) } }),
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
}
