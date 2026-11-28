import { getApp } from "firebase/app";
import { getFirestore, doc, collection, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import "./firebase"; // makes sure the default Firebase app exists
import { phoneKey } from "./data/shopConfig";

const db = getFirestore(getApp());

// Admin CRM: the team's own notes about a customer, one document per phone number (crmCustomers/<phoneKey>).
// The customer list itself is built from the orders; only what the team adds is stored here:
//   tags: ['VIP', ...] (max 10), notes: [{ text, by, byName, at }] (newest first, max 50),
//   followUp: 'YYYY-MM-DD' or '', followUpNote, updatedBy, updatedAt.
// Team members only (rules: isStaff). Customers and sellers never read it.
export const MAX_TAGS = 10;
export const MAX_NOTES = 50;

export function watchCrm(onData) {
  return onSnapshot(collection(db, "crmCustomers"),
    (snap) => onData(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))),
    () => onData({}));
}

const clean = (s, n) => String(s || "").trim().slice(0, n);

// Saves the whole CRM entry of one customer (the panel always sends the full, current values)
export function saveCrm(phone, entry, staff) {
  const key = phoneKey(phone);
  const tags = [...new Set((entry.tags || []).map((t) => clean(t, 30)).filter(Boolean))].slice(0, MAX_TAGS);
  const notes = (entry.notes || []).slice(0, MAX_NOTES).map((n) => ({
    text: clean(n.text, 500), by: clean(n.by, 120), byName: clean(n.byName, 80), at: clean(n.at, 40),
  })).filter((n) => n.text);
  const followUp = /^\d{4}-\d{2}-\d{2}$/.test(entry.followUp || "") ? entry.followUp : "";
  return setDoc(doc(db, "crmCustomers", key), {
    tags, notes, followUp, followUpNote: followUp ? clean(entry.followUpNote, 200) : "",
    updatedBy: clean(staff.email, 120), updatedAt: serverTimestamp(),
  });
}

// Incomplete orders (leads/<phoneKey>): written by the server (api/plan.js?action=lead) when a customer typed a phone
// at checkout or to the chat agent with products picked but ordered nothing. Team reads; marks one contacted.
export function watchLeads(onData) {
  return onSnapshot(collection(db, "leads"),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([]));
}
export function markLeadContacted(lead, staff, contacted = true) {
  return setDoc(doc(db, "leads", lead.id), contacted
    ? { status: "contacted", contactedBy: String(staff.name || staff.email || "").slice(0, 120), contactedAt: new Date().toISOString() }
    : { status: "", contactedBy: "", contactedAt: "" }, { merge: true });
}

// The browser side: send an incomplete order (fire and forget; never blocks the page)
export function sendLead({ phone, name = "", items = [], source = "checkout", shop = "" }) {
  try {
    fetch("/api/plan?action=lead", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name, items: items.slice(0, 10), source, shop }),
    }).catch(() => {});
  } catch (e) { /* offline */ }
}
