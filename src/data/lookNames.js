// Shop the Look admin: name ideas for a look, made from the products in it (no AI call, free and instant).
// Each product adds themes (katua → "Eid Ready", hoodie → "Easy Layers", sneakers → "Sneaker"…); a colour word
// from the top makes more ("Black Street Look"). `seed` shuffles for ↻ More names.

const COLOR_RE = /\b(black|white|navy|blue|red|maroon|green|olive|grey|gray|brown|beige|cream|pink|purple|yellow|orange|golden|gold|silver|khaki|sky)\b/i;

// [test, names] — first match per product wins
const THEMES = [
  [/saree|sari/i, ['Saree Grace', 'Festive Saree', 'Graceful Drape', 'Saree Elegance', 'Golden Hour Saree']],
  [/three ?piece|salwar|kameez/i, ['Elegant Three Piece', 'Everyday Grace', 'Festive Three Piece', 'Desi Charm']],
  [/borka|burqa|abaya|hijab|nikab|niqab/i, ['Modest Elegance', 'Graceful Modest', 'Abaya Classic', 'Soft & Modest']],
  [/gown|dress|skirt|pinafore/i, ['Chic Set', 'Pretty in Skirt', 'Sweet Day Out', 'Brunch Ready']],
  [/katua|punjabi|panjabi/i, ['Eid Ready', 'Festive Classic', 'Desi Gentleman', 'Friday Best', 'Eid Mubarak Look']],
  [/blazer|suit/i, ['Sharp Layers', 'Smart Blazer', 'Gentleman Edit', 'Dinner Ready']],
  [/padding|puffer/i, ['Winter Street', 'Puffer Season', 'Warm & Bold', 'Cold Day Out']],
  [/overcoat|coat/i, ['City Coat', 'Winter Classic', 'Long Coat Edit']],
  [/denim jacket/i, ['Denim Layers', 'Denim Street', 'Rugged Casual']],
  [/varsity/i, ['Campus Cool', 'Varsity Vibes', 'College Street']],
  [/jacket/i, ['Layered Up', 'Jacket Weather', 'Street Layers']],
  [/hoodie/i, ['Easy Layers', 'Hoodie Season', 'Cozy Street', 'Chill Mode']],
  [/sweatshirt|sweater|cardigan/i, ['Cozy Winter', 'Easy Layers', 'Soft Winter', 'Weekend Warm']],
  [/formal|office|official/i, ['Office Sharp', 'Smart Formal', 'Boardroom Ready', 'Work Mode', 'Monday Sharp']],
  [/polo/i, ['Polo Club', 'Clean Casual', 'Smart Polo', 'Weekend Polo']],
  [/t-?shirt|\btee\b|top/i, ['Weekend Tee', 'Street Casual', 'Easy Tee', 'Daily Fit', 'Chill Casual']],
  [/shirt/i, ['Smart Casual', 'Weekend Shirt', 'Classic Shirt', 'Day Out']],
  [/cargo/i, ['Cargo Street', 'Utility Fit', 'Street Utility']],
  [/jeans|denim/i, ['Denim Day', 'Blue Jeans Fit', 'Denim Casual']],
  [/jogger|sweat ?pant|trouser|track/i, ['Comfy Street', 'Jogger Fit', 'Easy Weekend', 'Sporty Casual']],
  [/chino|pant/i, ['Smart Casual', 'Clean Fit', 'Everyday Smart']],
  [/sneaker|jordan|running|sports shoe/i, ['Sneaker Fit', 'Sneaker Street', 'Kicks & Style']],
  [/loafer|formal shoe|oxford|derby/i, ['Polished Gentleman', 'Smart Steps']],
  [/sandal|slipper/i, ['Easy Summer', 'Relaxed Day']],
  [/watch/i, ['Classic Time', 'Timeless Style', 'On Time']],
  [/wallet/i, ['Everyday Essentials', 'Pocket Ready']],
  [/bag/i, ['Bag & Go', 'City Girl', 'Day Out Chic']],
];

const cap = (w) => w.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function lookNameIdeas(items = [], who = 'men', seed = 0, taken = []) {
  const names = [];
  const add = (n) => { if (n && n.length <= 40 && !names.includes(n)) names.push(n); };
  const per = items.map((p) => {
    const t = `${p.category || ''} ${p.name || ''}`;
    const hit = THEMES.find(([re]) => re.test(t));
    return hit ? hit[1] : [];
  });
  // round-robin so every product gives a name, the top (first) one first
  for (let i = 0; i < 5; i += 1) per.forEach((list) => add(list[i]));
  // colour of the top + a theme word
  const top = items.find((p) => !/pant|jogger|trouser|jeans|shoe|sneaker|watch|wallet|bag/i.test(`${p.category} ${p.name}`)) || items[0];
  const col = top && (`${top.name || ''}`.match(COLOR_RE) || [])[1] || (top && Array.isArray(top.colors) && top.colors[0]);
  if (col && col.length <= 10) {
    const c = cap(col === 'gray' ? 'grey' : col);
    ['Street Look', 'Edit', 'Classic', 'Vibes', 'Mood'].forEach((w) => add(`${c} ${w}`));
  }
  // a pair of the pieces ("Katua & Sneakers")
  const short = (p) => {
    const t = `${p.category || ''} ${p.name || ''}`;
    const m = t.match(/katua|punjabi|saree|hoodie|sweatshirt|sweater|blazer|jacket|polo|t-shirt|shirt|joggers?|jeans|cargo|chinos?|pant|sneakers?|loafers?|watch|bag/i);
    return m ? cap(m[0].replace(/^t-shirt$/i, 'Tee')) : null;
  };
  const words = [...new Set(items.map(short).filter(Boolean))];
  if (words.length >= 2) add(`${words[0]} & ${words[words.length - 1]}`);
  // always something, even with no products yet
  (who === 'women' ? ['Everyday Chic', 'Girls Day Out', 'Soft Glam', 'Pretty Casual', 'Festive Glow'] : ['Smart Casual', 'Weekend Fit', 'Street Style', 'Daily Classic', 'Gentleman Edit']).forEach(add);
  const fresh = names.filter((n) => !taken.some((t) => (t || '').toLowerCase() === n.toLowerCase()));
  const pool = fresh.length >= 5 ? fresh : names;
  const start = (seed * 5) % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, 5);
}
