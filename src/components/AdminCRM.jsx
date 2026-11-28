import React, { useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, Repeat, Crown, Moon, AlertTriangle, Ban, Search, ArrowLeft, Phone, MessageCircle, Copy, Download, CalendarClock, StickyNote, Tag, X, Check, Wallet, TrendingUp, Truck, RefreshCw, ShoppingCart, Trash2 } from 'lucide-react';
import { toDate, formatDateTime } from '../utils/dates';
import { phoneKey } from '../data/shopConfig';
import { watchBlocked, blockPhone } from '../blocklist';
import { watchCrm, saveCrm, MAX_TAGS, watchLeads, markLeadContacted } from '../crmStore';
import { askConfirm } from './AlertCenter';
import { AdminAnalytics } from './AdminDashboard';
import OrdersPanel from './OrdersPanel';
import { courierVerdict, checkCourier } from '../courierCheck';
import { getFirestore, doc, deleteDoc } from 'firebase/firestore';
export { courierVerdict };

const TONE = { green: 'bg-green-600/10 text-green-700 border-green-600/30', amber: 'bg-amber-500/10 text-amber-700 border-amber-500/30', red: 'bg-red-500/10 text-red-600 border-red-500/30', gray: 'bg-gray-500/10 text-gray-600 border-gray-500/30' };

export function CourierCheck({ phone, isDarkMode, card, fetcher }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fresh = false) => {
    setBusy(true); setErr('');
    try {
      let data;
      data = await (fetcher || checkCourier)(phone, fresh);
      setRes(data);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };
  const v = courierVerdict(res);
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold flex items-center gap-2"><Truck size={15} /> Courier check <span className="font-normal text-xs text-gray-500">Steadfast, Pathao, RedX, Paperfly, CarryBee +2</span></h3>
        {!res
          ? <button type="button" disabled={busy} onClick={() => run(false)} className="px-4 py-2 rounded bg-[#D4AF37] text-black text-xs font-bold uppercase tracking-wider disabled:opacity-50">{busy ? 'Checking…' : 'Check this number'}</button>
          : <button type="button" disabled={busy} onClick={() => run(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-semibold disabled:opacity-50"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Check again</button>}
      </div>
      {!res && !err && <p className="mt-2 text-xs text-gray-500">Shows how many parcels this number received or sent back with other shops too, so a first-time fake order can be caught before sending.</p>}
      {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
      {res && (
        <div className="mt-3 space-y-3">
          <div className={`rounded-lg border px-3 py-2 text-sm font-bold ${TONE[v.tone]}`}>{v.label}</div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[['Parcels', res.total], ['Received', res.success], ['Returned / cancelled', res.cancel]].map(([k, n]) => (
              <div key={k} className={`rounded-lg border p-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}><div className="text-[11px] text-gray-500">{k}</div><div className="font-bold">{n}</div></div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 text-left"><th className="py-1 pr-2 font-semibold">Courier</th><th className="py-1 px-2 font-semibold text-right">Parcels</th><th className="py-1 px-2 font-semibold text-right">Received</th><th className="py-1 pl-2 font-semibold text-right">Returned</th></tr></thead>
              <tbody>
                {(res.couriers || []).map((c) => (
                  <tr key={c.name} className={`border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                    <td className="py-1.5 pr-2 font-semibold">{c.name}</td>
                    <td className="py-1.5 px-2 text-right">{c.total}</td><td className="py-1.5 px-2 text-right text-green-700">{c.success}</td><td className="py-1.5 pl-2 text-right text-red-600">{c.cancel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(res.reports || []).length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <div className="text-xs font-bold text-red-600 mb-1">Fraud reports from other shops ({res.reports.length})</div>
              <ul className="space-y-1">
                {res.reports.map((r, i) => <li key={i} className="text-xs">{r.text || 'Reported'} <span className="text-gray-500">{r.name ? `· ${r.name}` : ''}{r.courier ? ` · ${r.courier}` : ''}{r.at ? ` · ${r.at}` : ''}</span></li>)}
              </ul>
            </div>
          )}
          {!(res.couriers || []).length && <p className="text-xs text-gray-500">No courier has a parcel for this number yet.</p>}
          <p className="text-[11px] text-gray-500">Checked {res.at ? new Date(res.at).toLocaleString('en-GB') : ''}{res.cached ? ' (saved copy, under 24 h old)' : ''}. Courier data can be late or miss small couriers: use it as a hint, not proof.</p>
        </div>
      )}
    </div>
  );
}

// Admin Portal > CRM. The customer list is built from the orders (one customer = one phone number); the team adds
// tags, notes and a follow-up date (crmCustomers/<phoneKey>). Tabs: Customers, Follow-ups, Segments, Analytics
// (store sales + customer numbers; the old Analytics page lives here now). No supplier cost or profit here.
const DAY = 86400000;
const VIP_SPEND = 5000;      // ৳ spent (delivered or open orders, not cancelled / returned)
const VIP_ORDERS = 3;
const INACTIVE_DAYS = 60;
const PRESET_TAGS = ['VIP', 'Wholesale', 'Friend / Family', 'Prefers WhatsApp', 'Size issue', 'Fake order', 'Late payer'];
const counted = (o) => o.status !== 'Cancelled' && !o.returned;
const ms = (o) => { const d = toDate(o.createdAt); return d ? d.getTime() : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (t) => { if (!t) return '-'; const d = Math.floor((Date.now() - t) / DAY); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };
const waLink = (key) => `https://wa.me/88${key.replace(/^88/, '')}`;
// Incomplete order → a ready WhatsApp message (the team member only presses Send in WhatsApp)
const leadMessage = (l) => {
  const items = (l.items || []).map((it) => `${it.name}${[it.size, it.color].filter(Boolean).length ? ` (${[it.size, it.color].filter(Boolean).join(', ')})` : ''}`).join(', ');
  return `আসসালামু আলাইকুম${l.name ? ` ${l.name}` : ''}! Dorzi থেকে বলছি। আপনি ${items} অর্ডার করতে চাচ্ছিলেন, কিন্তু অর্ডারটি শেষ হয়নি। কোনো সমস্যা হয়েছে? চাইলে এখানেই সাইজ, রং আর ঠিকানা জানান, আমরা অর্ডারটি করে দিচ্ছি। 🙂`;
};
const leadWa = (l) => `https://wa.me/88${String(l.id || l.phone).replace(/^88/, '')}?text=${encodeURIComponent(leadMessage(l))}`;
const cityOf = (addr) => {
  const lines = String(addr || '').split('\n');
  const get = (k) => (lines.map((l) => l.match(new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'i'))).find(Boolean) || [])[1];
  return (get('City') || get('Zone') || '').trim();
};

const SEGMENTS = [
  { key: 'all', label: 'All', Icon: Users, tint: 'bg-gray-500/10 text-gray-500', note: 'everyone who ordered' },
  { key: 'new', label: 'New', Icon: UserPlus, tint: 'bg-green-600/10 text-green-600', note: '1 order so far' },
  { key: 'repeat', label: 'Repeat', Icon: Repeat, tint: 'bg-blue-500/10 text-blue-500', note: '2+ orders' },
  { key: 'vip', label: 'VIP', Icon: Crown, tint: 'bg-[#D4AF37]/15 text-[#B8921F]', note: `৳${VIP_SPEND}+ or ${VIP_ORDERS}+ orders` },
  { key: 'inactive', label: 'Inactive', Icon: Moon, tint: 'bg-purple-500/10 text-purple-500', note: `no order in ${INACTIVE_DAYS} days` },
  { key: 'risky', label: 'Risky', Icon: AlertTriangle, tint: 'bg-orange-500/10 text-orange-600', note: 'often cancels / returns' },
  { key: 'blocked', label: 'Blocked', Icon: Ban, tint: 'bg-red-500/10 text-red-600', note: 'orders refused' },
];
const SEG_BADGE = { new: 'bg-green-600/15 text-green-700', repeat: 'bg-blue-500/15 text-blue-600', vip: 'bg-[#D4AF37]/20 text-[#8a6d12]', inactive: 'bg-purple-500/15 text-purple-600', risky: 'bg-orange-500/15 text-orange-700', blocked: 'bg-red-500/15 text-red-600' };

// one customer per phone number, newest name / address wins
export function buildCustomers(orders, crm = {}, blockedPhones = {}) {
  const map = new Map();
  [...orders].sort((a, b) => ms(a) - ms(b)).forEach((o) => {
    const phone = o.customer && o.customer.phone;
    if (!phone) return;
    const key = phoneKey(phone);
    const c = map.get(key) || { key, phone: String(phone), name: '', address: '', city: '', emails: new Set(), shops: new Set(), orders: [], spent: 0, real: 0, delivered: 0, bad: 0, first: 0, last: 0 };
    c.name = (o.customer.name || c.name || '').trim();
    c.address = o.customer.address || c.address;
    c.city = cityOf(o.customer.address) || c.city;
    if (o.email) c.emails.add(String(o.email).toLowerCase());
    c.shops.add(o.shop || 'Main store');
    c.orders.push(o);
    if (counted(o)) { c.real += 1; c.spent += Number(o.total) || 0; }
    if (o.status === 'Delivered' && !o.returned) c.delivered += 1;
    if (o.status === 'Cancelled' || o.returned) c.bad += 1;
    const t = ms(o);
    if (!c.first || t < c.first) c.first = t;
    if (t > c.last) c.last = t;
    map.set(key, c);
  });
  return [...map.values()].map((c) => {
    const entry = crm[c.key] || {};
    const blocked = !!blockedPhones[c.key];
    const segs = [];
    if (c.real <= 1) segs.push('new'); else segs.push('repeat');
    if (c.spent >= VIP_SPEND || c.real >= VIP_ORDERS) segs.push('vip');
    if (c.last && Date.now() - c.last > INACTIVE_DAYS * DAY) segs.push('inactive');
    if (c.bad >= 2 || (c.bad >= 1 && c.bad / c.orders.length >= 0.5)) segs.push('risky');
    if (blocked) segs.push('blocked');
    return { ...c, emails: [...c.emails], shops: [...c.shops], orders: c.orders.reverse(), tags: entry.tags || [], notes: entry.notes || [], followUp: entry.followUp || '', followUpNote: entry.followUpNote || '', blocked, segs };
  });
}

function useCls(isDarkMode) {
  return {
    card: `rounded-2xl border p-5 ${isDarkMode ? 'bg-[#161616] border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`,
    input: `border px-3 py-2 text-sm rounded focus:outline-none focus:border-[#D4AF37] ${isDarkMode ? 'bg-[#121212] border-gray-700 text-white' : 'bg-white border-gray-300 text-black'}`,
    chip: (on) => `px-3 py-1.5 rounded-full border text-xs font-semibold transition ${on ? 'bg-[#D4AF37] border-[#D4AF37] text-black' : isDarkMode ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'}`,
  };
}

function Stat({ label, value, note, Icon, tint, isDarkMode, onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`text-left w-full rounded-2xl border p-4 flex items-center gap-3 transition ${isDarkMode ? 'bg-[#161616] border-gray-800' : 'bg-white border-gray-200 shadow-sm'} ${active ? '!border-[#D4AF37] ring-1 ring-[#D4AF37]' : ''} ${onClick ? 'hover:border-[#D4AF37]/70' : ''}`}>
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tint}`}><Icon size={18} /></span>
      <span className="min-w-0">
        <span className="block text-[11px] text-gray-500 truncate">{label}</span>
        <span className="block text-lg font-bold truncate">{value}</span>
        {note && <span className="block text-[11px] text-gray-500 truncate">{note}</span>}
      </span>
    </Tag>
  );
}

function RankBars({ rows, valueText, isDarkMode, empty = 'Nothing yet.' }) {
  if (!rows.length) return <p className="text-sm text-gray-500">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${valueText(r)}`}>
          <div className="flex justify-between gap-3 text-xs"><span className="truncate">{r.label}</span><strong className="shrink-0">{valueText(r)}</strong></div>
          <div className={`mt-1 h-2 rounded-full ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}><div className="h-2 rounded-full bg-[#D4AF37]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

const Badges = ({ c }) => (
  <span className="flex flex-wrap gap-1">
    {c.segs.filter((s) => s !== 'repeat' || !c.segs.includes('vip')).map((s) => <span key={s} className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEG_BADGE[s]}`}>{s}</span>)}
    {c.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-semibold border border-gray-400/50 text-gray-500">{t}</span>)}
  </span>
);

const toCsv = (rows) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Name', 'Phone', 'City', 'Orders', 'Delivered', 'Cancelled/Returned', 'Spent (BDT)', 'First order', 'Last order', 'Segments', 'Tags', 'Follow-up'];
  const body = rows.map((c) => [c.name, c.phone, c.city, c.orders.length, c.delivered, c.bad, c.spent, c.first ? new Date(c.first).toISOString().slice(0, 10) : '', c.last ? new Date(c.last).toISOString().slice(0, 10) : '', c.segs.join(' '), c.tags.join(' | '), c.followUp]);
  return [head, ...body].map((r) => r.map(esc).join(',')).join('\n');
};

function CustomerProfile({ c, onBack, isDarkMode, formatPrice, staff, canBlock, canExport, allOrders = [], orderTools = {} }) {
  const [openOrder, setOpenOrder] = useState('');
  const { card, input, chip } = useCls(isDarkMode);
  const [tags, setTags] = useState(c.tags);
  const [notes, setNotes] = useState(c.notes);
  const [followUp, setFollowUp] = useState(c.followUp);
  const [followUpNote, setFollowUpNote] = useState(c.followUpNote);
  const [note, setNote] = useState('');
  const [customTag, setCustomTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const dirty = JSON.stringify([tags, notes, followUp, followUpNote]) !== JSON.stringify([c.tags, c.notes, c.followUp, c.followUpNote]);

  const save = async (next = {}) => {
    const entry = { tags, notes, followUp, followUpNote, ...next };
    setBusy(true); setMsg('');
    try { await saveCrm(c.phone, entry, staff); setMsg('Saved.'); }
    catch (e) { setMsg(`Could not save: ${e.message || e}`); }
    setBusy(false);
  };
  const addNote = async () => {
    const text = note.trim();
    if (!text) return;
    const next = [{ text: text.slice(0, 500), by: staff.email, byName: staff.name, at: new Date().toISOString() }, ...notes].slice(0, 50);
    setNotes(next); setNote('');
    await save({ notes: next });
  };
  const removeNote = async (i) => {
    if (!(await askConfirm('Delete this note?'))) return;
    const next = notes.filter((_, k) => k !== i);
    setNotes(next); await save({ notes: next });
  };
  const toggleTag = (t) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= MAX_TAGS ? cur : [...cur, t]));
  const addCustomTag = () => { const t = customTag.trim().slice(0, 30); if (t && !tags.includes(t) && tags.length < MAX_TAGS) setTags([...tags, t]); setCustomTag(''); };
  const copyPhone = async () => { try { await navigator.clipboard.writeText(c.phone); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };
  const doBlock = async () => {
    if (!(await askConfirm(`Block ${c.phone}? New orders from this number will be refused. Owner / Manager can unblock it in Orders.`))) return;
    setBusy(true);
    try { await blockPhone(c.phone, c.orders[0] && c.orders[0].orderNumber, staff); setMsg('Blocked.'); } catch (e) { setMsg(`Could not block: ${e.message || e}`); }
    setBusy(false);
  };
  const avg = c.real ? c.spent / c.real : 0;
  const items = new Map();
  c.orders.filter(counted).forEach((o) => (o.items || []).forEach((it) => { const k = it.category || 'Other'; items.set(k, (items.get(k) || 0) + (parseInt(it.quantity, 10) || 0)); }));
  const likes = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} (${v})`).join(', ');

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#B8921F]"><ArrowLeft size={14} /> All customers</button>
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold truncate">{c.name || 'No name'}</h2>
            <p className="text-sm text-gray-500">{c.phone}{c.city ? ` · ${c.city}` : ''}{c.emails.length ? ` · ${c.emails.join(', ')}` : ''}</p>
            <div className="mt-2"><Badges c={{ ...c, tags }} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-semibold"><Phone size={14} /> Call</a>
            <a href={waLink(c.key)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-semibold text-green-600 border-green-600/50"><MessageCircle size={14} /> WhatsApp</a>
            <button type="button" onClick={copyPhone} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-semibold">{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy phone'}</button>
            {canBlock && !c.blocked && <button type="button" disabled={busy} onClick={doBlock} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-red-500/60 text-red-600 text-xs font-semibold"><Ban size={14} /> Block</button>}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          {[['Spent', formatPrice(c.spent)], ['Orders', `${c.orders.length} (${c.delivered} delivered)`], ['Average order', formatPrice(avg)], ['Cancelled / returned', c.bad], ['First order', c.first ? new Date(c.first).toLocaleDateString('en-GB') : '-'], ['Last order', daysAgo(c.last)], ['Bought from', c.shops.join(', ')], ['Likes', likes || '-']].map(([k, v]) => (
            <div key={k} className={`rounded-xl border p-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}><div className="text-[11px] text-gray-500">{k}</div><div className="font-bold break-words">{v}</div></div>
          ))}
        </div>
        {c.address && <p className="mt-3 text-xs text-gray-500 whitespace-pre-line"><strong>Last address:</strong> {c.address}</p>}
      </div>

      <CourierCheck phone={c.key} isDarkMode={isDarkMode} card={card} />

      <div className="grid lg:grid-cols-2 gap-5">
        <div className={card}>
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Tag size={15} /> Tags</h3>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...PRESET_TAGS, ...tags])].map((t) => <button key={t} type="button" onClick={() => toggleTag(t)} className={chip(tags.includes(t))}>{t}</button>)}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={customTag} onChange={(e) => setCustomTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }} maxLength={30} placeholder="Other tag, e.g. Eid buyer" className={`${input} flex-1`} />
            <button type="button" onClick={addCustomTag} className="px-3 py-2 rounded border text-xs font-semibold">Add</button>
          </div>
          <h3 className="text-sm font-bold mt-5 mb-3 flex items-center gap-2"><CalendarClock size={15} /> Follow-up</h3>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={input} />
            <input value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} maxLength={200} placeholder="What to do, e.g. tell about new hoodies" className={`${input} flex-1 min-w-[12rem]`} />
            {followUp && <button type="button" onClick={() => { setFollowUp(''); setFollowUpNote(''); save({ followUp: '', followUpNote: '' }); }} className="px-3 py-2 rounded border text-xs font-semibold text-green-600 border-green-600/50">✓ Done</button>}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" disabled={busy || !dirty} onClick={() => save()} className="px-4 py-2 rounded bg-[#D4AF37] text-black text-xs font-bold uppercase tracking-wider disabled:opacity-50">{busy ? 'Saving…' : 'Save tags & follow-up'}</button>
            {msg && <span className="text-xs text-gray-500">{msg}</span>}
          </div>
        </div>
        <div className={card}>
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><StickyNote size={15} /> Notes ({notes.length})</h3>
          <div className="flex gap-2">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="e.g. XL fits better, call after 6 pm" className={`${input} flex-1`} />
            <button type="button" disabled={busy || !note.trim()} onClick={addNote} className="px-3 py-2 rounded bg-[#D4AF37] text-black text-xs font-bold self-start disabled:opacity-50">Add</button>
          </div>
          <ul className="mt-3 space-y-2 max-h-72 overflow-y-auto">
            {notes.length === 0 && <li className="text-sm text-gray-500">No notes yet.</li>}
            {notes.map((n, i) => (
              <li key={i} className={`rounded-lg border p-2.5 text-sm ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                <div className="flex justify-between gap-2"><span className="whitespace-pre-line break-words">{n.text}</span><button type="button" aria-label="Delete note" onClick={() => removeNote(i)} className="text-gray-400 hover:text-red-500 shrink-0"><X size={14} /></button></div>
                <div className="mt-1 text-[11px] text-gray-500">{n.byName || n.by} · {n.at ? new Date(n.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={card}>
        <h3 className="text-sm font-bold mb-1">Order history ({c.orders.length})</h3>
        <p className="text-[11px] text-gray-500 mb-3">Click an order to open it: confirm, mark paid, cancel or delete it here, same as in Orders.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-gray-500"><th className="py-2 pr-3">Order</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Products</th><th className="py-2 pr-3">From</th><th className="py-2 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-500/15">
              {c.orders.map((o) => (
                <React.Fragment key={o.id || o.orderNumber}>
                <tr onClick={() => o.id && setOpenOrder(openOrder === o.id ? '' : o.id)} className={`align-top cursor-pointer ${openOrder === o.id ? 'bg-[#D4AF37]/10' : 'hover:bg-gray-500/5'}`} title="Open this order">
                  <td className="py-2 pr-3 font-bold text-[#B8921F] whitespace-nowrap">{openOrder === o.id ? '▲' : '▼'} {o.orderNumber}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(o.createdAt)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{o.returned ? 'Returned' : o.status}{o.paymentStatus === 'Paid' ? ' · Paid' : ''}</td>
                  <td className="py-2 pr-3 min-w-[12rem]">{(o.items || []).map((it, k) => <div key={k}>{it.name}{it.size && it.size !== 'Standard' ? ` · ${it.size}` : ''}{it.color ? ` · ${it.color}` : ''} × {it.quantity}</div>)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{o.shop ? `Shop: ${o.shop}` : 'Main store'}</td>
                  <td className="py-2 text-right font-bold whitespace-nowrap">{formatPrice(o.total)}</td>
                </tr>
                {openOrder === o.id && (
                  <tr><td colSpan={6} className="py-3">
                    <OrdersPanel key={o.id} focusId={o.id} orders={allOrders} isDarkMode={isDarkMode} formatPrice={formatPrice} adminName={staff.name} loggedInUserEmail={staff.email} {...orderTools} />
                  </td></tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {canExport && <p className="mt-3 text-[11px] text-gray-500">Customer details stay inside the team. Never share them with sellers.</p>}
      </div>
    </div>
  );
}

export default function AdminCRM({ orders = [], formatPrice, isDarkMode, adminRole, adminName, loggedInUserEmail, startTab = 'customers', orderTools = {} }) {
  const { card, input, chip } = useCls(isDarkMode);
  const [tab, setTab] = useState(startTab);
  const [crm, setCrm] = useState({});
  const [blocked, setBlocked] = useState({ phones: {}, emails: {} });
  const [seg, setSeg] = useState('all');
  const [tagFilter, setTagFilter] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('last');
  const [openKey, setOpenKey] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => watchCrm(setCrm), []);
  useEffect(() => watchBlocked(setBlocked), []);
  const [leads, setLeads] = useState([]);
  const [leadView, setLeadView] = useState('new');
  useEffect(() => watchLeads(setLeads), []);
  useEffect(() => { setTab(startTab); }, [startTab]);

  const canExport = adminRole === 'owner' || adminRole === 'manager';
  const staff = { email: String(loggedInUserEmail || '').toLowerCase(), name: adminName || loggedInUserEmail || '' };
  const customers = useMemo(() => buildCustomers(orders, crm, blocked.phones), [orders, crm, blocked]);
  const allTags = useMemo(() => [...new Set(customers.flatMap((c) => c.tags))].sort(), [customers]);
  const segCount = (k) => (k === 'all' ? customers.length : customers.filter((c) => c.segs.includes(k)).length);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    const rows = customers.filter((c) => (seg === 'all' || c.segs.includes(seg))
      && (!tagFilter || c.tags.includes(tagFilter))
      && (!term || c.name.toLowerCase().includes(term) || (digits && c.key.includes(digits)) || c.city.toLowerCase().includes(term) || c.emails.some((e) => e.includes(term)) || c.orders.some((o) => String(o.orderNumber || '').toLowerCase().includes(term))));
    const by = { last: (a, b) => b.last - a.last, spent: (a, b) => b.spent - a.spent, orders: (a, b) => b.orders.length - a.orders.length, name: (a, b) => a.name.localeCompare(b.name) };
    return rows.sort(by[sort] || by.last);
  }, [customers, seg, tagFilter, q, sort]);

  const due = useMemo(() => customers.filter((c) => c.followUp).sort((a, b) => a.followUp.localeCompare(b.followUp)), [customers]);
  const dueNow = due.filter((c) => c.followUp <= today()).length;

  const copyPhones = async (rows, id) => {
    try { await navigator.clipboard.writeText(rows.map((c) => c.phone).join('\n')); setCopied(id); setTimeout(() => setCopied(''), 1500); } catch (e) {}
  };
  const downloadCsv = (rows, name) => {
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dorzi-customers-${name}-${today()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const open = customers.find((c) => c.key === openKey);
  if (open) return <CustomerProfile key={open.key} c={open} onBack={() => setOpenKey('')} isDarkMode={isDarkMode} formatPrice={formatPrice} staff={staff} canBlock canExport={canExport} allOrders={orders} orderTools={orderTools} />;

  // Incomplete orders: hidden once the same phone ordered (from 10 minutes before the save on), and after 30 days
  const orderedAfter = (l) => { const t = Date.parse(l.at || 0) - 10 * 60000; return orders.some((o) => phoneKey(o.customer?.phone) === l.id && (toDate(o.createdAt) || 0) >= t); };
  const openLeads = leads.filter((l) => l.at && Date.now() - Date.parse(l.at) < 30 * 864e5 && !orderedAfter(l)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const newLeads = openLeads.filter((l) => l.status !== 'contacted');
  const shownLeads = leadView === 'new' ? newLeads : openLeads.filter((l) => l.status === 'contacted');
  const contactLead = async (l, yes = true) => { try { await markLeadContacted(l, staff, yes); } catch (e) { alert(`Could not save: ${e.message || e}`); } };
  const deleteLead = async (l) => { if (!(await askConfirm(`Delete the incomplete order of ${l.phone}?`))) return; try { await deleteDoc(doc(getFirestore(), 'leads', l.id)); } catch (e) { alert(`Could not delete: ${e.message || e}`); } };

  const TABS = [['customers', 'Customers'], ['leads', `Incomplete orders${newLeads.length ? ` (${newLeads.length})` : ''}`], ['followups', `Follow-ups${dueNow ? ` (${dueNow})` : ''}`], ['segments', 'Segments'], ['analytics', 'Analytics']];
  const realC = customers.filter((c) => c.real > 0);
  const repeatRate = realC.length ? Math.round((realC.filter((c) => c.real >= 2).length / realC.length) * 100) : 0;
  const ltv = realC.length ? realC.reduce((n, c) => n + c.spent, 0) / realC.length : 0;
  const newThisMonth = (() => { const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); return customers.filter((c) => c.first >= m.getTime()).length; })();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold">CRM</h2>
        <p className="text-xs text-gray-500">Every customer who ordered (one phone number = one customer), with their orders, your notes, tags and follow-ups. Money counts every order except cancelled and returned ones.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={chip(tab === k)}>{label}</button>)}
      </div>

      {tab === 'customers' && (
        <>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3">
            <Stat isDarkMode={isDarkMode} label="Customers" value={customers.length} note={`${newThisMonth} new this month`} Icon={Users} tint="bg-blue-500/10 text-blue-500" />
            <Stat isDarkMode={isDarkMode} label="Come back to buy again" value={`${repeatRate}%`} note="2+ orders" Icon={Repeat} tint="bg-green-600/10 text-green-600" onClick={() => setSeg('repeat')} />
            <Stat isDarkMode={isDarkMode} label="Spent per customer" value={formatPrice(ltv)} note="on average" Icon={Wallet} tint="bg-[#D4AF37]/15 text-[#B8921F]" />
            <Stat isDarkMode={isDarkMode} label="Follow-ups due" value={dueNow} note={`${due.length} planned`} Icon={CalendarClock} tint="bg-purple-500/10 text-purple-500" onClick={() => setTab('followups')} />
          </div>
          <div className={card}>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[14rem]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, city, email or order number" className={`${input} w-full pl-9`} />
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={input} aria-label="Sort">
                <option value="last">Last order</option><option value="spent">Most spent</option><option value="orders">Most orders</option><option value="name">Name A-Z</option>
              </select>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {SEGMENTS.map((s) => <button key={s.key} type="button" onClick={() => setSeg(s.key)} className={chip(seg === s.key)}>{s.label} ({segCount(s.key)})</button>)}
              {allTags.length > 0 && (
                <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className={`${input} !py-1.5 text-xs`} aria-label="Tag">
                  <option value="">Any tag</option>{allTags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>{list.length} customer{list.length === 1 ? '' : 's'}</span>
              {canExport && list.length > 0 && (
                <span className="flex gap-2">
                  <button type="button" onClick={() => copyPhones(list, 'list')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border font-semibold">{copied === 'list' ? <Check size={13} /> : <Copy size={13} />} Copy phones</button>
                  <button type="button" onClick={() => downloadCsv(list, seg)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border font-semibold"><Download size={13} /> CSV</button>
                </span>
              )}
            </div>
            {list.length === 0 ? <p className="mt-4 text-sm text-gray-500">{customers.length ? 'No customer matches.' : 'No customers yet. They show up here after their first order.'}</p> : (
              <>
              <ul className="mt-3 sm:hidden divide-y divide-gray-500/15">
                {list.map((c) => (
                  <li key={c.key}><button type="button" onClick={() => setOpenKey(c.key)} className="w-full text-left py-3">
                    <div className="flex justify-between gap-3"><span className="font-bold truncate">{c.name || 'No name'}</span><strong className="shrink-0">{formatPrice(c.spent)}</strong></div>
                    <div className="text-xs text-gray-500">{c.phone}{c.city ? ` · ${c.city}` : ''} · {c.orders.length} order{c.orders.length === 1 ? '' : 's'}{c.bad ? ` (${c.bad}✕)` : ''} · {daysAgo(c.last)}</div>
                    {c.followUp && <div className={`text-xs ${c.followUp <= today() ? 'text-red-500 font-bold' : 'text-gray-500'}`}>Follow-up: {c.followUp}</div>}
                    <div className="mt-1"><Badges c={c} /></div>
                  </button></li>
                ))}
              </ul>
              <div className="mt-3 overflow-x-auto hidden sm:block">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wider text-gray-500"><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">City</th><th className="py-2 pr-3 text-right">Orders</th><th className="py-2 pr-3 text-right">Spent</th><th className="py-2 pr-3">Last order</th><th className="py-2">Follow-up</th></tr></thead>
                  <tbody className="divide-y divide-gray-500/15">
                    {list.map((c) => (
                      <tr key={c.key} onClick={() => setOpenKey(c.key)} className={`cursor-pointer align-top ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                        <td className="py-2.5 pr-3 min-w-[12rem]"><div className="font-bold">{c.name || 'No name'}</div><div className="text-gray-500">{c.phone}</div><div className="mt-1"><Badges c={c} /></div></td>
                        <td className="py-2.5 pr-3">{c.city || '-'}</td>
                        <td className="py-2.5 pr-3 text-right whitespace-nowrap">{c.orders.length}{c.bad ? <span className="text-red-500"> ({c.bad}✕)</span> : ''}</td>
                        <td className="py-2.5 pr-3 text-right font-bold whitespace-nowrap">{formatPrice(c.spent)}</td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">{daysAgo(c.last)}</td>
                        <td className={`py-2.5 whitespace-nowrap ${c.followUp && c.followUp <= today() ? 'text-red-500 font-bold' : ''}`}>{c.followUp || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        </>
      )}

      {tab === 'leads' && (
        <div className={card}>
          <h3 className="text-sm font-bold mb-1 flex items-center gap-2"><ShoppingCart size={15} /> Incomplete orders</h3>
          <p className="text-xs text-gray-500 mb-3">People who typed their phone at checkout (or to the chat agent) with products picked, but did not order. Press WhatsApp: the message is ready, you only press Send (it is then marked contacted). Gone when they order, or after 30 days.</p>
          <div className="flex gap-2 mb-3">
            <button type="button" onClick={() => setLeadView('new')} className={chip(leadView === 'new')}>New ({newLeads.length})</button>
            <button type="button" onClick={() => setLeadView('contacted')} className={chip(leadView === 'contacted')}>Contacted ({openLeads.length - newLeads.length})</button>
          </div>
          {shownLeads.length === 0 ? <p className="text-sm text-gray-500">{leadView === 'new' ? 'No incomplete orders right now.' : 'Nobody contacted yet.'}</p> : (
            <ul className="divide-y divide-gray-500/15">
              {shownLeads.map((l) => (
                <li key={l.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <div className="font-bold">{l.name || 'No name'} <span className="font-normal text-gray-500">· {l.phone}</span></div>
                    <div className="text-xs mt-0.5">{(l.items || []).map((it) => `${it.qty} × ${it.name}${[it.size, it.color].filter(Boolean).length ? ` (${[it.size, it.color].filter(Boolean).join(', ')})` : ''}`).join(' · ')}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{formatPrice(l.total || 0)} · {l.source === 'chat' ? 'from the chat' : 'at checkout'}{l.shop ? ` · shop ${l.shop}` : ''} · {formatDateTime(l.at)}{l.status === 'contacted' ? ` · contacted by ${l.contactedBy || '?'}` : ''}</div>
                  </div>
                  <span className="flex flex-wrap gap-2">
                    <a href={leadWa(l)} target="_blank" rel="noopener noreferrer" onClick={() => { if (l.status !== 'contacted') contactLead(l); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-green-600 text-white text-xs font-bold"><MessageCircle size={13} /> WhatsApp</a>
                    <a href={`tel:${l.phone}`} onClick={() => { if (l.status !== 'contacted') contactLead(l); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-semibold"><Phone size={13} /> Call</a>
                    {l.status === 'contacted'
                      ? <button type="button" onClick={() => contactLead(l, false)} className="px-2.5 py-1.5 rounded border text-xs font-semibold">Back to new</button>
                      : <button type="button" onClick={() => contactLead(l)} className="px-2.5 py-1.5 rounded border text-xs font-semibold"><Check size={13} className="inline" /> Contacted</button>}
                    {canExport && <button type="button" onClick={() => deleteLead(l)} aria-label="Delete" className="px-2 py-1.5 rounded border text-xs text-red-600 border-red-500/50"><Trash2 size={13} /></button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'followups' && (
        <div className={card}>
          <h3 className="text-sm font-bold mb-1">Follow-ups</h3>
          <p className="text-xs text-gray-500 mb-3">Customers you planned to message or call. Open one, contact them, then press ✓ Done.</p>
          {due.length === 0 ? <p className="text-sm text-gray-500">Nothing planned. Open a customer and set a follow-up date.</p> : (
            <ul className="divide-y divide-gray-500/15">
              {due.map((c) => (
                <li key={c.key} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setOpenKey(c.key)} className="text-left min-w-0">
                    <div className="font-bold text-sm">{c.name || c.phone} <span className={`ml-1 text-xs ${c.followUp < today() ? 'text-red-500' : c.followUp === today() ? 'text-orange-600' : 'text-gray-500'}`}>{c.followUp < today() ? `late · ${c.followUp}` : c.followUp === today() ? 'today' : c.followUp}</span></div>
                    <div className="text-xs text-gray-500">{c.followUpNote || 'No note'} · {c.phone}</div>
                  </button>
                  <span className="flex gap-2">
                    <a href={waLink(c.key)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-semibold text-green-600 border-green-600/50"><MessageCircle size={13} /> WhatsApp</a>
                    <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-semibold"><Phone size={13} /> Call</a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'segments' && (
        <>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3">
            {SEGMENTS.map((s) => <Stat key={s.key} isDarkMode={isDarkMode} label={s.label} value={segCount(s.key)} note={s.note} Icon={s.Icon} tint={s.tint} onClick={() => { setSeg(s.key); setTab('customers'); }} />)}
          </div>
          <div className={card}>
            <h3 className="text-sm font-bold mb-1">Send an offer to a group</h3>
            <p className="text-xs text-gray-500 mb-3">Copy the phone numbers of a group for SMS / WhatsApp offers (for example Inactive customers: "we miss you, 10% off"). Blocked and Risky customers are left out.</p>
            {!canExport ? <p className="text-sm text-gray-500">Only the Owner or a Manager can copy or download customer lists.</p> : (
              <ul className="divide-y divide-gray-500/15">
                {SEGMENTS.filter((s) => !['blocked', 'risky'].includes(s.key)).map((s) => {
                  const rows = customers.filter((c) => (s.key === 'all' || c.segs.includes(s.key)) && !c.segs.includes('blocked') && !c.segs.includes('risky'));
                  return (
                    <li key={s.key} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span><strong>{s.label}</strong> <span className="text-gray-500">· {rows.length} number{rows.length === 1 ? '' : 's'}</span></span>
                      <span className="flex gap-2">
                        <button type="button" disabled={!rows.length} onClick={() => copyPhones(rows, s.key)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-semibold disabled:opacity-40">{copied === s.key ? <Check size={13} /> : <Copy size={13} />} Copy phones</button>
                        <button type="button" disabled={!rows.length} onClick={() => downloadCsv(rows, s.key)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-semibold disabled:opacity-40"><Download size={13} /> CSV</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {tab === 'analytics' && (
        <>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3">
            <Stat isDarkMode={isDarkMode} label="Customers" value={customers.length} note={`${newThisMonth} new this month`} Icon={Users} tint="bg-blue-500/10 text-blue-500" />
            <Stat isDarkMode={isDarkMode} label="Repeat rate" value={`${repeatRate}%`} note="ordered 2+ times" Icon={Repeat} tint="bg-green-600/10 text-green-600" />
            <Stat isDarkMode={isDarkMode} label="Spent per customer" value={formatPrice(ltv)} note="lifetime, on average" Icon={TrendingUp} tint="bg-[#D4AF37]/15 text-[#B8921F]" />
            <Stat isDarkMode={isDarkMode} label="Risky customers" value={segCount('risky')} note="often cancel / return" Icon={AlertTriangle} tint="bg-orange-500/10 text-orange-600" />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <div className={card}><h3 className="text-sm font-bold mb-3">Top customers (spent)</h3>
              <RankBars isDarkMode={isDarkMode} rows={[...realC].sort((a, b) => b.spent - a.spent).slice(0, 6).map((c) => ({ key: c.key, label: c.name || c.phone, value: c.spent, n: c.real }))} valueText={(r) => `${formatPrice(r.value)} · ${r.n} order${r.n === 1 ? '' : 's'}`} /></div>
            <div className={card}><h3 className="text-sm font-bold mb-3">Customers by city</h3>
              <RankBars isDarkMode={isDarkMode} rows={Object.entries(customers.reduce((m, c) => { const k = c.city || 'Unknown'; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => ({ key: k, label: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 6)} valueText={(r) => String(r.value)} /></div>
          </div>
          <AdminAnalytics orders={orders} formatPrice={formatPrice} isDarkMode={isDarkMode} title="Store sales" />
        </>
      )}
    </div>
  );
}
