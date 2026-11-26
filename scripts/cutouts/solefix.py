# free sole clean-up: the sole bottom sank into a fluffy rug, so the cut-out edge is wavy / fuzzy.
# 1) hard edge in the lower part (removes fur fuzz)  2) a smooth sole line fitted along the bottom
# 3) cut what hangs below the line, fill gaps up to it with the sole colour just above
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
src, dst = sys.argv[1], sys.argv[2]
SC = 3                                   # work 3x bigger for smooth edges
im = Image.open(src).convert('RGBA'); w0, h0 = im.size
im = im.resize((w0 * SC, h0 * SC), Image.LANCZOS)
a = np.asarray(im).astype(np.float32); alpha = a[..., 3]; h, w = alpha.shape
m = alpha > 128
lab, n = ndimage.label(m)
if n > 1: m = lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1)))))
m = ndimage.binary_fill_holes(m)
rows = np.where(m.any(1))[0]; top, bot = rows[0], rows[-1]; H = bot - top
y0 = int(bot - H * 0.30)                 # sole zone
xs = np.where(m[y0:].any(0))[0]
lowest = np.array([y0 + np.where(m[y0:, x])[0].max() for x in xs], float)
# lower envelope smoothed: rolling median then a low-order fit (ignores bumps and notches)
win = max(15, len(xs) // 10) | 1
med = ndimage.median_filter(lowest, size=win, mode='nearest')
deg = 4
coef = np.polyfit(xs, med, deg); fit = np.polyval(coef, xs)
for tol in (12 * SC, 6 * SC, 4 * SC):
    ok = np.abs(med - fit) < tol
    if ok.sum() > deg + 5: coef = np.polyfit(xs[ok], med[ok], deg); fit = np.polyval(coef, xs)
span = xs.max() - xs.min(); keep_end = span * 0.015
new = m.copy()
for k, x in enumerate(xs):
    if x < xs.min() + keep_end or x > xs.max() - keep_end: continue
    L = int(round(fit[k]))
    col = np.where(m[y0:, x])[0]
    if not col.size: continue
    first = y0 + col.min()
    new[L + 1:, x] = False
    new[first:L + 1, x] = True
# toe / heel ends: blend between kept outline and line by trimming below the line too
new = ndimage.binary_opening(new, iterations=SC)
add = new & ~m
rgb = a[..., :3].copy()
for x in np.where(add.any(0))[0]:
    ys = np.where(add[:, x])[0]; yy = ys.min() - 1
    while yy > 0 and not m[yy, x]: yy -= 1
    rgb[ys, x] = a[max(yy - 4 * SC, 0):yy + 1, x, :3].mean(0)
# smooth the filled colours sideways so there are no vertical streaks
blur = np.dstack([ndimage.uniform_filter1d(np.where(new, rgb[..., c], 0), size=9 * SC, axis=1) for c in range(3)])
wt = ndimage.uniform_filter1d(new.astype(np.float32), size=9 * SC, axis=1)[..., None]
sm = blur / np.maximum(wt, 1e-3)
band = ndimage.binary_dilation(add, iterations=2 * SC) & new
rgb[band] = sm[band]
# alpha: keep soft original edges up top, crisp antialiased edge in the sole zone
na = np.where(new, 255.0, 0.0)
na = np.asarray(Image.fromarray(na.astype(np.uint8)).filter(ImageFilter.GaussianBlur(SC * 0.7))).astype(np.float32)
fa = alpha.copy(); fa[y0:] = na[y0:]
fa[:y0] = np.where(new[:y0], np.maximum(alpha[:y0], 0), alpha[:y0])
out = np.dstack([rgb, fa]).clip(0, 255).astype(np.uint8)
o = Image.fromarray(out).resize((w0, h0), Image.LANCZOS)
bb = o.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
o.crop(bb).save(dst, quality=92)
print(dst, 'filled', int(add.sum() / SC / SC), 'cut', int((m & ~new).sum() / SC / SC))
