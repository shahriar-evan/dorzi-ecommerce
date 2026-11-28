import { auth } from './firebase';
import { phoneKey } from './data/shopConfig';

// Courier history of a phone number across Bangladesh couriers (server: api/plan.js?action=courier-check, BD Courier).
// Team only. The CRM profile asks for one number; the Orders panel asks for the numbers of recent open orders.

export function courierVerdict(r) {
  if (!r) return null;
  if (!r.total) return { label: 'No courier history (new number)', short: 'New number', tone: 'gray' };
  if (r.rate >= 80) return { label: `Good: ${r.rate}% of parcels received`, short: `Courier ${r.rate}%`, tone: 'green' };
  if (r.rate >= 50) return { label: `Careful: only ${r.rate}% received, call before sending`, short: `Courier ${r.rate}%`, tone: 'amber' };
  return { label: `Risky: only ${r.rate}% received, ask for advance payment`, short: `Risky ${r.rate}%`, tone: 'red' };
}

async function post(body) {
  const idToken = await auth.currentUser.getIdToken();
  const r = await fetch('/api/plan?action=courier-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

export const checkCourier = (phone, fresh = false) => post({ phone, fresh });

// { <phoneKey>: answer } for up to 25 numbers (saved answers up to 30 days old, at most 10 new checks per call)
export async function checkCourierMany(phones) {
  const keys = [...new Set(phones.map(phoneKey))].filter((k) => /^01[3-9][0-9]{8}$/.test(k)).slice(0, 25);
  if (!keys.length) return {};
  const data = await post({ phones: keys });
  return data.results || {};
}
