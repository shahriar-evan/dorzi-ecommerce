import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Upload, Trash2, Pencil, Plus, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ArrowLeft, Check, ZoomIn } from 'lucide-react';
import { askConfirm } from './AlertCenter';
import { lookNameIdeas } from '../data/lookNames';
import { watchLooks, saveLook, deleteLook, LOOK_MAX_ITEMS, LOOK_MAX } from '../looks';
import { makeAiLook, aiCutoutLook } from '../aiPhoto';
import { prepareLookImage, lookFramed, reframeLook, toSendableJpeg } from '../utils/showcaseImage';
import { totalStock, rankBySales, productColors } from '../data/catalog';

// Admin → Shop the Look (Owner / Manager). A look = a full-body model picture (transparent) + the 1-6 store products
// worn in it, each with a numbered pin on the picture. ✨ Make with AI (OpenAI) dresses a model in the picked products;
// or upload your own transparent PNG. Shown on the home page between the Men's and Women's rails (ShopTheLook.jsx).
const EMPTY = { id: '', name: '', who: 'men', image: '', items: [], order: 0, active: true };
// Auto make: what a product is in an outfit, and where its pin goes
const MEN_SIDE = (p) => ['Men', 'Winter', 'Jackets', 'Shoes'].includes(p.gender);
export const pieceKind = (p) => {
  const t = `${p.category || ''} ${p.name || ''}`;
  if (p.gender === 'Shoes' || /shoe|sneaker|loafer|sandal|boot|slipper/i.test(p.category || '')) return 'shoes';
  if (/sweat ?pant|pant|jogger|trouser|jeans|cargo|shorts/i.test(t) && !/sweatshirt/i.test(t)) return 'bottom';
  if (/shirt|tee|polo|jacket|hoodie|sweat|blazer|sweater|coat|punjabi|katua|padding|puffer/i.test(t)) return 'top';
  return null;
};
// what a product takes on the model: one look has at most 1 of each place. Tops: 1 inner (shirt, T-shirt, polo, katua,
// punjabi, hoodie, sweater…) + 1 outer layer (jacket, blazer, coat…), so 2 katuas or a katua + a polo are never worn together.
// A saree / three piece / borka is a full outfit (takes the inner top and the bottom).
const OUTER_RE = /jacket|blazer|coat|padding|puffer|waistcoat|vest|cardigan|shrug|kimono|overshirt/i;
const DRESS_RE = /saree|sari|three ?piece|borka|burqa|abaya|gown|kurti set|dress/i;
export const lookSlots = (p) => {
  const c = `${p.gender || ''} ${p.category || ''}`;
  const t = `${p.category || ''} ${p.name || ''}`;
  if (pieceKind(p) === 'shoes') return ['shoes'];
  if (/watch/i.test(c)) return ['watch'];
  if (/wallet/i.test(c)) return ['wallet'];
  if (/bag/i.test(c)) return ['bag'];
  // a set (shirt & pant, two piece, abaya with hijab…) takes every place it covers
  if (DRESS_RE.test(t) || /two piece|\bset\b/i.test(t)) return ['inner', 'bottom', ...(/hijab|nikab|niqab/i.test(t) ? ['hijab'] : [])];
  if (/hijab/i.test(t)) return ['hijab'];
  if (pieceKind(p) === 'bottom') return ['bottom'];
  if (OUTER_RE.test(p.category || '') || (!/shirt|tee|polo|katua|punjabi|hoodie|sweat/i.test(p.category || '') && OUTER_RE.test(p.name || ''))) return ['outer'];
  return ['inner'];
};
const SLOT_NAME = { inner: 'a top (shirt / katua / polo…)', outer: 'a jacket / blazer', bottom: 'a pant', shoes: 'shoes', watch: 'a watch', wallet: 'a wallet', bag: 'a bag', hijab: 'a hijab' };
const PIN = { top: { x: 50, y: 33 }, bottom: { x: 50, y: 68 }, shoes: { x: 50, y: 95 } };
const AUTO = [
  { name: 'Winter Street', top: /jacket|padding|puffer|coat/i },
  { name: 'Smart Casual', top: /^(?!.*(t-shirt|tee|sweat)).*shirt/i },
  { name: 'Weekend Tee', top: /t-shirt|\btee\b|polo/i },
  { name: 'Easy Layers', top: /hoodie|sweatshirt|sweater/i },
];
const QUALITY = { medium: { label: 'Standard', note: '~$0.06 · 30-60 s', secs: 50 }, high: { label: 'Premium', note: '~$0.25 · 1-3 min, sharper face & fabric', secs: 120 } };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const absUrl = (u) => (/^https?:\/\//.test(u) || /^data:/.test(u) ? u : `${window.location.origin}${u.startsWith('/') ? '' : '/'}${u}`);

// product picker buttons (Shop the Look admin): a collection, then its sections
const PICK_GROUPS = [['Men', "Men's"], ['Women', "Women's"], ['Winter', 'Winter'], ['Shoes', 'Shoes'], ['Watches', 'Watches'], ['Wallets', 'Wallets']];

// every photo of a product: main photo, each colour's photo (+ its extra ones), then the other photos
const productPhotos = (p) => {
  if (!p) return [];
  const ci = p.colorImages || {}, cg = p.colorGallery || {};
  return [...new Set([p.image, ...productColors(p).flatMap((c) => [ci[c], ...(Array.isArray(cg[c]) ? cg[c] : [])]), ...(Array.isArray(p.images) ? p.images : [])].filter(Boolean))];
};

// Full-screen photo viewer (tap a product in the look): swipe / drag or arrows / ← → keys change the photo,
// ✕, the Back button, Esc or the browser's back button close it.
export function PhotoViewer({ name, photos, start = 0, onClose }) {
  const [i, setI] = useState(Math.max(0, Math.min(start, photos.length - 1)));
  const drag = useRef(null);
  const n = photos.length;
  const go = (d) => setI((k) => (k + d + n) % n);
  const close = () => { if (window.history.state && window.history.state.kyvroViewer) window.history.back(); else onClose(); };
  useEffect(() => {
    // the browser / phone back button closes the viewer instead of leaving the page
    window.history.pushState({ ...(window.history.state || {}), kyvroViewer: true }, '');
    const onPop = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); document.body.style.overflow = old; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const btn = 'w-11 h-11 rounded-full flex items-center justify-center bg-white/90 text-black shadow hover:bg-white';
  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex items-center justify-between gap-3 p-3 sm:p-4 text-white">
        <button type="button" onClick={close} className="w-11 h-11 rounded-full flex items-center justify-center bg-[#D4AF37] text-black shadow" aria-label="Back" title="Back"><ArrowLeft size={20} /></button>
        <p className="flex-1 min-w-0 text-center text-sm font-semibold truncate">{name} <span className="font-normal opacity-60">· {i + 1} / {n}</span></p>
        <button type="button" onClick={close} className={btn} aria-label="Close" title="Close"><X size={20} /></button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 touch-pan-y select-none"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const st = drag.current; drag.current = null;
          if (!st || n < 2) return;
          const dx = e.clientX - st.x, dy = e.clientY - st.y;
          if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => { drag.current = null; }}>
        <img src={photos[i]} alt={name} draggable={false} className="max-h-full max-w-full object-contain rounded" />
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} className={`${btn} absolute left-3 top-1/2 -translate-y-1/2`} aria-label="Previous photo"><ChevronLeft size={22} /></button>
            <button type="button" onClick={() => go(1)} className={`${btn} absolute right-3 top-1/2 -translate-y-1/2`} aria-label="Next photo"><ChevronRight size={22} /></button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex gap-2 overflow-x-auto p-3 justify-start sm:justify-center">
          {photos.map((u, k) => (
            <button key={u} type="button" onClick={() => setI(k)} className={`shrink-0 w-14 h-14 rounded overflow-hidden border-2 ${k === i ? 'border-[#D4AF37]' : 'border-transparent opacity-60'}`} aria-label={`Photo ${k + 1}`}>
              <img src={u} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ShopTheLookAdmin({ products = [], isDarkMode, formatPrice, staff }) {
  const [looks, setLooks] = useState(null);
  useEffect(() => watchLooks(setLooks), []);
  const [form, setForm] = useState(null); // the look being made / changed
  const [q, setQ] = useState('');
  const [bgFix, setBgFix] = useState(null); // the uploaded file whose busy background the AI can remove
  const [pickGroup, setPickGroup] = useState(''); // '' = follows Man / Woman
  const [pickCat, setPickCat] = useState(''); // '' = every section of the group
  const [viewer, setViewer] = useState(null); // { name, photos } of the product shown big
  const [pinFor, setPinFor] = useState(0); // which item the next click on the picture places
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]);
  const [quality, setQuality] = useState('medium');
  // timer while OpenAI works
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (!startedAt) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [startedAt]);
  const secs = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  // which looks already use a product (a product can be in several looks: same shoes, other clothes)
  const usedIn = useMemo(() => {
    const m = {};
    (looks || []).forEach((l) => l.items.forEach((it) => { (m[it.id] = m[it.id] || []).push(l.name || 'Look'); }));
    return m;
  }, [looks]);

  const card = `rounded-lg border p-5 sm:p-6 space-y-4 ${isDarkMode ? 'bg-[#161616] border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`;
  const input = `border p-2 text-sm rounded ${isDarkMode ? 'bg-[#121212] border-gray-700 text-white' : 'bg-white border-gray-300 text-black'}`;
  const live = (p) => p && (p.status || 'approved') === 'approved';
  // picker: the chosen collection (default: Men's for a man, Women's for a woman), its sections, then the products
  // (in stock first, best sellers first); typing in the search box searches every collection
  const group = pickGroup || (form && form.who === 'women' ? 'Women' : 'Men');
  const groupList = useMemo(() => products.filter((p) => live(p) && p.gender === group), [products, group]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = useMemo(() => [...new Set(groupList.map((p) => p.category).filter(Boolean))], [groupList]);
  const term = q.trim().toLowerCase();
  const found = useMemo(() => {
    const base = term.length >= 2
      ? products.filter((p) => live(p) && `${p.name} ${p.category} ${p.gender}`.toLowerCase().includes(term))
      : groupList.filter((p) => !pickCat || p.category === pickCat);
    const ranked = rankBySales(base);
    return [...ranked.filter((p) => totalStock(p) > 0), ...ranked.filter((p) => totalStock(p) <= 0)];
  }, [products, groupList, pickCat, term]); // eslint-disable-line react-hooks/exhaustive-deps

  // Position = place on the home page, 1 = first (looks are already sorted by order)
  const start = (look) => {
    const list = looks || [];
    const pos = look ? list.findIndex((l) => l.id === look.id) + 1 : list.length + 1;
    setForm(look ? { ...look, pos, items: look.items.map((it) => ({ ...it })) } : { ...EMPTY, pos });
    setMsg(null); setPinFor(0); setQ('');
  };
  // a slot (top / bottom / shoes / watch / wallet / bag) is full when the look already has its maximum
  // the place (top / jacket / pant / shoes…) this product needs that the look already fills, or null
  const slotFull = (items, p) => {
    const taken = new Set(items.flatMap((it) => (byId[it.id] ? lookSlots(byId[it.id]) : [])));
    return lookSlots(p).find((sl) => taken.has(sl)) || null;
  };
  const [nameSeed, setNameSeed] = useState(0);
  const nameIdeas = useMemo(() => (form ? lookNameIdeas(form.items.map((it) => byId[it.id]).filter(Boolean), form.who, nameSeed,
    (looks || []).filter((l) => l.id !== form.id).map((l) => l.name)) : []), [form, byId, nameSeed, looks]);
  const addItem = (p) => setForm((f) => (f.items.length >= LOOK_MAX_ITEMS || f.items.some((it) => it.id === String(p.id)) || slotFull(f.items, p) ? f
    : { ...f, items: [...f.items, { id: String(p.id), x: 50, y: 25 + f.items.length * 20 }] }));
  const removeItem = (i) => setForm((f) => ({ ...f, items: f.items.filter((_, k) => k !== i) }));
  // move a product up / down: its number (1-6) and pin number change with it, the pin stays where it was placed
  const moveItem = (i, d) => setForm((f) => {
    const j = i + d;
    if (j < 0 || j >= f.items.length) return f;
    const items = [...f.items];
    [items[i], items[j]] = [items[j], items[i]];
    return { ...f, items };
  });
  const place = (e) => {
    if (!form.items[pinFor]) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 100);
    const y = Math.round(((e.clientY - r.top) / r.height) * 100);
    setForm((f) => ({ ...f, items: f.items.map((it, k) => (k === pinFor ? { ...it, x, y } : it)) }));
    setPinFor((i) => (i + 1 < form.items.length ? i + 1 : i));
  };

  const makeAi = async () => {
    if (form.items.length < 2) { setMsg({ type: 'err', text: 'Pick at least 2 products first.' }); return; }
    setBusy('ai'); setMsg(null); setStartedAt(Date.now());
    try {
      const raw = await makeAiLook({ sources: form.items.map((it) => absUrl((byId[it.id] || {}).image || '')), who: form.who, quality, variant: Math.floor(Math.random() * 16) });
      const image = await prepareLookImage(raw);
      setForm((f) => ({ ...f, image }));
      setMsg({ type: 'ok', text: 'Done. Check the clothes carefully (colour, print, logo). Then tap the picture to place the numbered pins, and Save.' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    setBusy(''); setStartedAt(0);
  };
  // the same products as a saved look (in any order)
  const sameSet = form && form.items.length > 0 && (looks || []).find((l) => l.id !== form.id && l.items.length === form.items.length
    && form.items.every((it) => l.items.some((x) => x.id === it.id)));

  // ✨ Auto make: up to 4 men's looks from in-stock best sellers (jacket / shirt / tee / hoodie + cargo or pants + shoes),
  // saved and shown at once with pins in the usual places; change or delete any of them afterwards
  const [auto, setAuto] = useState('');
  // older looks were cut tight around the person; colour try-on needs the 2:3 frame (one click fixes them, pins move along)
  const [unframed, setUnframed] = useState([]);
  useEffect(() => {
    let live = true;
    Promise.all((looks || []).map(async (l) => ((await lookFramed(l.image).catch(() => true)) ? null : l.id)))
      .then((ids) => { if (live) setUnframed(ids.filter(Boolean)); });
    return () => { live = false; };
  }, [looks]);
  const fixFrames = async () => {
    setBusy('frame'); setMsg(null);
    let done = 0;
    for (const l of looks.filter((x) => unframed.includes(x.id))) {
      try { const r = await reframeLook(l.image, l.items); await saveLook({ ...l, image: r.image, items: r.items }, staff); done += 1; } catch (e) { setMsg({ type: 'err', text: `${l.name || 'Look'}: ${e.message}` }); }
    }
    setBusy('');
    setMsg((m) => m || { type: 'ok', text: `${done} look${done === 1 ? '' : 's'} ready for colour try-on.` });
  };
  const autoPlan = () => {
    const pool = rankBySales(products.filter((p) => (p.status || 'approved') === 'approved' && MEN_SIDE(p) && totalStock(p) > 0));
    const of = (k) => pool.filter((p) => pieceKind(p) === k);
    const tops = of('top'), bottoms = of('bottom'), shoes = of('shoes');
    const cargo = bottoms.filter((p) => /cargo/i.test(`${p.name} ${p.category}`));
    const used = new Set((looks || []).flatMap((l) => l.items.map((it) => it.id)));
    const fresh = (list, taken) => list.find((p) => !used.has(String(p.id)) && !taken.has(String(p.id))) || list.find((p) => !taken.has(String(p.id)));
    const taken = new Set();
    return AUTO.map((a, k) => {
      const top = fresh(tops.filter((p) => a.top.test(`${p.category} ${p.name}`)), taken);
      const bottom = fresh(k % 2 === 0 && cargo.length ? cargo : bottoms, taken) || fresh(bottoms, taken);
      const shoe = fresh(shoes, taken);
      [top, bottom, shoe].forEach((p) => p && taken.add(String(p.id)));
      const items = [top && ['top', top], bottom && ['bottom', bottom], shoe && ['shoes', shoe]].filter(Boolean);
      return items.length >= 2 ? { name: a.name, items } : null;
    }).filter(Boolean);
  };
  const autoMake = async () => {
    const plan = autoPlan();
    if (!plan.length) { setMsg({ type: 'err', text: 'Not enough in-stock tops, pants and shoes to make looks.' }); return; }
    const cost = quality === 'high' ? 0.25 : 0.06;
    if (!(await askConfirm(`Make ${plan.length} looks with AI (${QUALITY[quality].label}, about $${(plan.length * cost).toFixed(2)} of OpenAI credit)?\n\n${plan.map((l) => `${l.name}: ${l.items.map(([, p]) => p.name).join(' + ')}`).join('\n')}`, { confirmText: `Make ${plan.length} looks` }))) return;
    setBusy('auto'); setMsg(null);
    let done = 0; const failed = [];
    for (let k = 0; k < plan.length; k += 1) {
      const l = plan[k];
      setAuto(`Look ${k + 1} of ${plan.length}: ${l.name}`); setStartedAt(Date.now());
      try {
        const raw = await makeAiLook({ sources: l.items.map(([, p]) => absUrl(p.image || '')), who: 'men', quality, variant: k * 5 + Math.floor(Math.random() * 4) });
        const image = await prepareLookImage(raw);
        await saveLook({ name: l.name, who: 'men', image, active: true, order: (looks || []).length + k,
          items: l.items.map(([kind, p]) => ({ id: String(p.id), ...PIN[kind] })) }, staff);
        done += 1;
      } catch (e) { failed.push(`${l.name}: ${e.message}`); if (/credit|key|verify|team|sign in|limit used up/i.test(e.message)) break; }
    }
    setBusy(''); setAuto(''); setStartedAt(0);
    // nothing made and one reason: just that reason (short)
    const only = !done && failed.length ? failed[0].replace(/^[^:]+: /, '') : '';
    setMsg(only ? { type: 'err', text: only } : { type: failed.length ? 'err' : 'ok', text: `${done} look${done === 1 ? '' : 's'} made and shown on the home page. Check each one (Edit to move pins or make again).${failed.length ? ` Not made: ${failed.join('; ')}` : ''}` });
  };
  const timer = startedAt ? (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-gray-500"><span>⏱ {clock(secs)} {auto ? `· ${auto}` : '· OpenAI is dressing the model…'}</span><span>usually {quality === 'high' ? '1-3 min' : '30-60 s'}</span></div>
      <div className="h-1.5 rounded-full bg-gray-500/20 overflow-hidden"><div className="h-full bg-[#D4AF37] transition-all duration-1000" style={{ width: `${Math.min(95, (secs / QUALITY[quality].secs) * 90)}%` }} /></div>
    </div>
  ) : null;
  const qualityPick = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-gray-500">Picture quality:</span>
      {Object.entries(QUALITY).map(([k, q]) => (
        <button key={k} type="button" onClick={() => setQuality(k)} title={q.note} className={`px-3 py-1.5 rounded-full border font-semibold ${quality === k ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'border-gray-400'}`}>{q.label} <span className="font-normal opacity-70">{q.note}</span></button>
      ))}
    </div>
  );
  const upload = async (file) => {
    if (!file) return;
    setBusy('up'); setMsg(null); setBgFix(null);
    try { const image = await prepareLookImage(file); setForm((f) => ({ ...f, image })); } catch (e) {
      setMsg({ type: 'err', text: e.message });
      if (e.code === 'busy-bg') setBgFix(file);
    }
    setBusy('');
  };
  // ✨ Remove background with AI (OpenAI, same daily limit as the looks): the same person, only the background goes
  const aiRemoveBg = async () => {
    if (!bgFix) return;
    setBusy('cut'); setMsg(null); setStartedAt(Date.now());
    try {
      const raw = await aiCutoutLook(await toSendableJpeg(bgFix));
      const image = await prepareLookImage(raw);
      setForm((f) => ({ ...f, image }));
      setBgFix(null);
      setMsg({ type: 'ok', text: 'Background removed. Check the picture, place the pins and Save.' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    setStartedAt(0); setBusy('');
  };
  const save = async () => {
    if (!form.image) { setMsg({ type: 'err', text: 'Make or upload the model picture first.' }); return; }
    if (!form.items.length) { setMsg({ type: 'err', text: 'Pick the products in this look.' }); return; }
    if (!form.id && (looks || []).length >= LOOK_MAX) { setMsg({ type: 'err', text: `At most ${LOOK_MAX} looks. Delete one first.` }); return; }
    setBusy('save'); setMsg(null);
    try {
      // put this look at its Position and number every look 0, 1, 2 … so Position 4 really is the 4th look
      const others = (looks || []).filter((l) => l.id !== form.id);
      const at = Math.max(1, Math.min(others.length + 1, parseInt(form.pos, 10) || others.length + 1)) - 1;
      const { pos, ...mine } = form;
      const ordered = [...others.slice(0, at), mine, ...others.slice(at)];
      await saveLook({ ...mine, order: at }, staff);
      // only the looks whose number changed are written again
      await Promise.all(ordered.map((l, k) => (l === mine || l.order === k ? null : saveLook({ ...l, order: k }, staff))));
      setForm(null);
    } catch (e) {
      setMsg({ type: 'err', text: e.code === 'permission-denied' ? 'Could not save (only the Owner or a Manager; or the picture is too big).' : e.message });
    }
    setBusy('');
  };
  const toggle = (look) => saveLook({ ...look, active: !look.active }, staff).catch((e) => alert(e.message));
  const remove = async (look) => {
    if (!(await askConfirm(`Delete the look "${look.name || 'Look'}"?`, { danger: true, confirmText: 'Delete' }))) return;
    deleteLook(look.id).catch((e) => alert(e.message));
  };

  if (!looks) return null;
  return (
    <div className="space-y-5">
      {viewer && viewer.photos.length > 0 && <PhotoViewer name={viewer.name} photos={viewer.photos} onClose={() => setViewer(null)} />}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Shop the Look</h3>
            <p className="text-xs text-gray-500 mt-1">Models wearing your products, on the home page between Men&apos;s and Women&apos;s Collection. Customers tap a model to see each piece with its price, stock and Add to cart. Pick 2-4 products, then ✨ Make with AI (OpenAI, about $0.05 a picture) or upload your own transparent PNG.</p>
          </div>
          {!form && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={autoMake} className="px-4 py-2 rounded border border-[#D4AF37] text-[#9A7A1A] dark:text-[#D4AF37] text-xs font-bold uppercase flex items-center gap-1.5 disabled:opacity-50"><Sparkles size={14} /> {busy === 'auto' ? 'Making…' : 'Auto make 4 looks'}</button>
              <button type="button" disabled={!!busy} onClick={() => start(null)} className="px-4 py-2 rounded bg-[#D4AF37] text-black text-xs font-bold uppercase flex items-center gap-1.5 disabled:opacity-50"><Plus size={14} /> New look</button>
            </div>
          )}
        </div>
        {!form && unframed.length > 0 && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[12rem]">{unframed.length} older look{unframed.length === 1 ? '' : 's'} must be fixed once so customers can try other colours on the model (same picture, just framed; pins move along).</span>
            <button type="button" disabled={!!busy} onClick={fixFrames} className="px-3 py-1.5 rounded bg-[#D4AF37] text-black font-bold disabled:opacity-50">{busy === 'frame' ? 'Fixing…' : `Fix ${unframed.length} look${unframed.length === 1 ? '' : 's'}`}</button>
          </div>
        )}
        {!form && qualityPick}
        {!form && timer}
        {!form && msg && <p className={`text-xs ${msg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>}
        {!form && (looks.length === 0 ? <p className="text-sm text-gray-500">No looks yet.</p> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {looks.map((l) => (
              <div key={l.id} className={`rounded-lg border p-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'} ${l.active ? '' : 'opacity-50'}`}>
                <div className="aspect-[2/3] bg-gray-100 dark:bg-[#0f0f0f] rounded flex items-end justify-center overflow-hidden"><img src={l.image} alt={l.name} className="h-full object-contain" /></div>
                <p className="mt-1.5 text-xs font-bold truncate">{l.name || 'Look'} <span className="font-normal text-gray-500">· {l.who === 'women' ? 'Women' : 'Men'} · {l.items.length} pcs</span></p>
                <p className={`mt-1 text-[10px] font-bold ${l.active ? 'text-green-600' : 'text-gray-500'}`}>{l.active ? '● LIVE on the home page' : '○ HIDDEN (customers do not see it)'}</p>
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" onClick={() => toggle(l)} className={`flex-1 py-1 rounded text-[11px] font-bold ${l.active ? 'border border-gray-400' : 'bg-green-600 text-white'}`}>{l.active ? 'Hide' : 'Show on home'}</button>
                  <button type="button" onClick={() => start(l)} className="px-2 rounded border border-gray-400" aria-label="Edit"><Pencil size={13} /></button>
                  <button type="button" onClick={() => remove(l)} className="px-2 rounded border border-red-500 text-red-500" aria-label="Delete"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {form && (
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold">{form.id ? 'Edit look' : 'New look'}</h3>
            <button type="button" onClick={() => setForm(null)} className="p-1" aria-label="Close"><X size={18} /></button>
          </div>
          <fieldset disabled={!!busy} className="grid lg:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs font-semibold text-gray-500 col-span-2">Name (shown under the look)
                  <input className={`${input} w-full mt-1`} maxLength={40} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Eid Ready" />
                </label>
                <label className="text-xs font-semibold text-gray-500">Position
                  <input type="number" min="1" max={Math.max(1, (looks || []).length + (form.id ? 0 : 1))} className={`${input} w-full mt-1`} value={form.pos ?? ''} onChange={(e) => setForm((f) => ({ ...f, pos: e.target.value }))} />
                </label>
              </div>
              {form.items.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 -mt-1">
                  <span className="text-[11px] font-semibold text-gray-500">Name ideas:</span>
                  {nameIdeas.map((n) => (
                    <button key={n} type="button" onClick={() => setForm((f) => ({ ...f, name: n }))}
                      className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${form.name === n ? 'bg-[#D4AF37] border-[#D4AF37] text-black' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>{n}</button>
                  ))}
                  <button type="button" onClick={() => setNameSeed((x) => x + 1)} className="px-2 py-1 text-[11px] font-semibold text-[#B8921F]">↻ More</button>
                </div>
              )}
              <div className="flex gap-2 text-xs">
                {[['men', 'Man'], ['women', 'Woman']].map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, who: k }))} className={`px-3 py-1.5 rounded-full border font-semibold ${form.who === k ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'border-gray-400'}`}>{label}</button>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Products in this look ({form.items.length}/{LOOK_MAX_ITEMS}) · tap a number, then tap the picture to place its pin</p>
                <div className="space-y-1.5">
                  {form.items.map((it, i) => {
                    const p = byId[it.id];
                    return (
                      <div key={it.id} className={`flex items-center gap-2 rounded border p-1.5 ${pinFor === i ? 'border-[#D4AF37]' : isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                        <button type="button" onClick={() => setPinFor(i)} className={`w-6 h-6 rounded-full text-xs font-bold shrink-0 ${pinFor === i ? 'bg-[#D4AF37] text-black' : 'bg-gray-500/20'}`}>{i + 1}</button>
                        {p && (
                          <button type="button" onClick={() => setViewer({ name: p.name, photos: productPhotos(p) })} className="shrink-0" title="See the photos big" aria-label={`See ${p.name} photos`}>
                            <img src={p.image} alt="" className="w-9 h-9 object-cover rounded hover:ring-2 hover:ring-[#D4AF37]" />
                          </button>
                        )}
                        <div className="min-w-0 flex-1 text-xs">
                          {p ? (
                            <button type="button" onClick={() => setViewer({ name: p.name, photos: productPhotos(p) })} className="block max-w-full font-semibold truncate text-left hover:underline" title="See the photos big">{p.name}</button>
                          ) : <p className="font-semibold truncate">{`Product ${it.id} (deleted)`}</p>}
                          {p && <p className="text-gray-500">{formatPrice(p.price)} · {totalStock(p) > 0 ? `${totalStock(p)} in stock` : <span className="text-red-500 font-semibold">Out of stock</span>}</p>}
                          {looks.some((l) => l.id !== form.id && l.items.some((x) => x.id === it.id)) && (
                            <p className="text-[10px] text-[#B8921F] font-semibold">Already in: {looks.filter((l) => l.id !== form.id && l.items.some((x) => x.id === it.id)).map((l) => l.name || 'Look').join(', ')}</p>
                          )}
                        </div>
                        <div className="flex flex-col shrink-0">
                          <button type="button" disabled={i === 0} onClick={() => { moveItem(i, -1); if (pinFor === i) setPinFor(i - 1); else if (pinFor === i - 1) setPinFor(i); }} className="p-0.5 disabled:opacity-25" aria-label="Move up" title="Move up"><ChevronUp size={14} /></button>
                          <button type="button" disabled={i === form.items.length - 1} onClick={() => { moveItem(i, 1); if (pinFor === i) setPinFor(i + 1); else if (pinFor === i + 1) setPinFor(i); }} className="p-0.5 disabled:opacity-25" aria-label="Move down" title="Move down"><ChevronDown size={14} /></button>
                        </div>
                        <button type="button" onClick={() => removeItem(i)} className="p-1 text-red-500" aria-label="Remove"><X size={14} /></button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {PICK_GROUPS.map(([g, label]) => (
                      <button key={g} type="button" onClick={() => { setPickGroup(g); setPickCat(''); setQ(''); }}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${group === g && !term ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'border-gray-400 hover:border-[#D4AF37]'}`}>{label}</button>
                    ))}
                  </div>
                  {!term && cats.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      {['', ...cats].map((c) => (
                        <button key={c || 'all'} type="button" onClick={() => setPickCat(c)}
                          className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${pickCat === c ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white' : 'border-gray-300 dark:border-gray-700'}`}>{c || 'All'}</button>
                      ))}
                    </div>
                  )}
                  <input className={`${input} w-full`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Or search every product (shirt, jeans, sneakers…)" />
                  <p className="text-[11px] text-gray-500">{form.items.length >= LOOK_MAX_ITEMS ? `This look is full (${LOOK_MAX_ITEMS}). Tap a ticked product to take it out.` : 'Tap a product to add it, tap again to take it out. One look: 1 top (shirt / katua / polo…) + 1 jacket / blazer + 1 pant + 1 shoes, watch, wallet, bag. 🔍 shows its photos big.'}</p>
                  <div className={`max-h-[420px] overflow-y-auto rounded border p-2 grid grid-cols-3 sm:grid-cols-4 gap-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                    {found.length === 0 && <p className="col-span-full p-4 text-center text-xs text-gray-500">No products here.</p>}
                    {found.map((p) => {
                      const idx = form.items.findIndex((it) => it.id === String(p.id));
                      const inLook = idx >= 0;
                      const slotIsFull = !inLook && slotFull(form.items, p);
                      const full = !inLook && (form.items.length >= LOOK_MAX_ITEMS || slotIsFull);
                      const out = totalStock(p) <= 0;
                      return (
                        <div key={p.id} className={`relative rounded-lg border overflow-hidden text-left ${inLook ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]' : isDarkMode ? 'border-gray-800' : 'border-gray-200'} ${full || out ? 'opacity-50' : ''}`}>
                          <button type="button" disabled={full} onClick={() => (inLook ? removeItem(idx) : addItem(p))} className="block w-full text-left disabled:cursor-not-allowed">
                            <img src={p.image} alt="" loading="lazy" className="w-full aspect-square object-cover bg-gray-100" />
                            <span className="block p-1.5">
                              <span className="block text-[11px] font-semibold leading-tight line-clamp-2">{p.name}</span>
                              <span className="block text-[11px] text-gray-500">{formatPrice(p.price)}{out ? ' · Out of stock' : ''}</span>
                              {slotIsFull && <span className="block text-[10px] text-red-500 font-semibold">Look has {SLOT_NAME[slotIsFull]}</span>}
                              {usedIn[String(p.id)] && <span className="block text-[10px] text-[#B8921F] font-semibold">in {usedIn[String(p.id)].length} look{usedIn[String(p.id)].length > 1 ? 's' : ''}</span>}
                            </span>
                          </button>
                          {inLook && <span className="absolute top-1 left-1 w-6 h-6 rounded-full bg-[#D4AF37] text-black text-xs font-bold flex items-center justify-center">{idx + 1}</span>}
                          <button type="button" onClick={() => setViewer({ name: p.name, photos: productPhotos(p) })} className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 text-black shadow flex items-center justify-center" aria-label={`See ${p.name} photos`} title="See the photos big"><ZoomIn size={14} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              {sameSet && <p className="text-xs text-[#B8921F] font-semibold">These products already have a look: {sameSet.name || 'Look'}. You can still make another one (other model / pose).</p>}
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> Show on the home page</label>
              {msg && <p className={`text-xs ${msg.type === 'ok' ? 'text-green-600' : msg.type === 'err' ? 'text-red-500' : 'text-gray-500'}`}>{msg.text}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={save} className="px-5 py-2.5 rounded bg-[#D4AF37] text-black text-xs font-bold uppercase disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save look'}</button>
                <button type="button" onClick={() => setForm(null)} className="px-4 py-2.5 rounded border border-gray-400 text-xs font-semibold">Cancel</button>
              </div>
            </div>
            <div className="space-y-3 w-full max-w-[420px] mx-auto">
            <div className={`relative aspect-[2/3] max-h-[640px] mx-auto w-full max-w-[420px] rounded-lg overflow-hidden ${isDarkMode ? 'bg-[#0f0f0f]' : 'bg-[#f1f1f0]'}`}>
              {form.image ? (
                <div className="absolute inset-0 cursor-crosshair" onClick={place}>
                  <img src={form.image} alt="" className="w-full h-full object-contain pointer-events-none select-none" />
                  {form.items.map((it, i) => (
                    <span key={it.id} style={{ left: `${it.x}%`, top: `${it.y}%` }} className={`absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow ${pinFor === i ? 'bg-[#D4AF37] text-black' : 'bg-white text-black'}`}>{i + 1}</span>
                  ))}
                </div>
              ) : <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-gray-500">{busy === 'ai' ? `Making the picture… ${clock(secs)}` : 'The model picture shows here.'}</p>}
            </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={makeAi} className="px-4 py-2 rounded bg-gradient-to-b from-[#E9CB6B] to-[#B8921F] text-black text-xs font-bold uppercase flex items-center gap-1.5 disabled:opacity-50">
                  <Sparkles size={14} /> {busy === 'ai' ? 'Making…' : form.image ? 'Make again with AI' : 'Make with AI'}
                </button>
                <label className="px-4 py-2 rounded border border-gray-400 text-xs font-bold uppercase flex items-center gap-1.5 cursor-pointer">
                  <Upload size={14} /> {busy === 'up' ? 'Loading…' : 'Upload picture'}
                  <input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
                </label>
                {(bgFix || busy === 'cut') && (
                  <button type="button" disabled={!!busy} onClick={aiRemoveBg} title="OpenAI keeps the same person and clothes and removes only the background (about $0.06)"
                    className="px-4 py-2 rounded border border-[#D4AF37] bg-[#D4AF37]/10 text-[#9A7A1A] dark:text-[#D4AF37] text-xs font-bold uppercase flex items-center gap-1.5 disabled:opacity-50">
                    <Sparkles size={14} /> {busy === 'cut' ? `Removing… ${clock(secs)}` : 'Remove background with AI'}
                  </button>
                )}
              </div>
              {qualityPick}
              {timer}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
