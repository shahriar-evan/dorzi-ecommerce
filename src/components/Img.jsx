import React, { useState } from 'react';

// Product photos from the suppliers (ShopBase, SelfShop, …) are big JPEGs on slow servers with no cache. They are sent
// through wsrv.nl (free image CDN: resized to the width shown, WebP, cached worldwide), so a page loads fast.
// Our own files (/cutouts, data: URLs, Vercel Blob, Google photos) are used as they are. If the CDN fails, the original loads.
const OWN = /(^|\.)(kyvro\.store|dorzi\.store|vercel\.app|vercel-storage\.com|googleusercontent\.com|wsrv\.nl)$/i;
export function thumb(url, w = 600) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return u;
  let host = '';
  try { host = new URL(u).hostname; } catch (e) { return u; }
  if (OWN.test(host) || host === 'localhost') return u;
  return `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=${Math.round(w * 2)}&q=78&output=webp&we`;
}

export default function Img({ src, w = 600, ...rest }) {
  const [failed, setFailed] = useState(false);
  const small = thumb(src, w);
  return <img src={failed ? src : small} decoding="async" onError={() => { if (!failed && small !== src) setFailed(true); }} {...rest} />;
}
