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
