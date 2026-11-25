import React from 'react';

// The Dorzi logo (was Kyvro until Nov 2026; the component keeps its old name so nothing else has to change).
//   default : the full flat logo (yellow + white / black): needle + crescent "D", button "O", "RZ", needle "I", stitched thread and spool (public/brand/dorzi-logo-*.webp, cut out of Evan's own logo picture: black background made transparent; the light-mode copy has the white parts turned black)
//   icon    : only the needle "D" (public/brand/dorzi-mark-*.webp), for tight spots and next to a Premium shop's own name
// Light mode: black letters. Dark mode: gold letters / white needles. The same on every store theme.
// Both pictures are always on the page (one hidden), so switching light / dark shows the right one at once.
// Size it with a height class (h-8, h-10 ...); the width follows. Files are made by .claude/logo-export/dorzi (scratch
// generator dorzi_final.py: letters outlined from Playfair Display Bold, so no font is needed).
// ?v= changes when the pictures are redrawn, so browsers never keep an old copy.
const V = '3';
export default function KyvroMark({ dark = false, className = '', title = 'Dorzi', icon = false }) {
  const kind = icon ? 'mark' : 'logo';
  return (
    <span className={`kyvro-mark inline-flex items-center ${className}`} role="img" aria-label={title}>
      <img src={`/brand/dorzi-${kind}-black.webp?v=${V}`} alt="" draggable={false} className={`h-full w-auto select-none ${dark ? 'hidden' : ''}`} />
      <img src={`/brand/dorzi-${kind}-gold.webp?v=${V}`} alt="" draggable={false} className={`h-full w-auto select-none ${dark ? '' : 'hidden'}`} />
    </span>
  );
}
