"""
Closes gaps in the shirt (R) channel of the kit masks so no skin shows
through the shirt: slits and armpit wedges between the body's UV islands
are filled, and the only hole left is the neck opening (the part ringed
by the collar trim).

Usage: python3 scripts/avatars/fixmask.py   (rewrites public/players/p*_kit.png)
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'players')

for pid in ['p1', 'p2', 'p3', 'p4']:
    path = os.path.join(OUT, f'{pid}_kit.png')
    im = Image.open(path)
    r, g, b, a = [np.array(c) for c in im.split()]
    shirt = r > 150
    trim = (r > 40) & (r <= 150)
    cover = shirt | trim
    # Holes inside the shirt, and narrow gaps between its pieces.
    closed = ndimage.binary_closing(cover, structure=np.ones((61, 61)), border_value=0)
    filled = ndimage.binary_fill_holes(closed)
    # The neck: the hole the collar trim rings. Keep what lies inside the trim ring's ellipse.
    holes = filled & ~cover
    labels, n = ndimage.label(holes)
    keep = np.zeros_like(cover)
    for i in range(1, n + 1):
        comp = labels == i
        near = ndimage.binary_dilation(comp, iterations=12) & trim
        if near.sum() < 200:
            continue
        ys, xs = np.nonzero(near)
        cy, cx = ys.mean(), xs.mean()
        ry, rx = (ys.max() - ys.min()) / 2 * 0.85, (xs.max() - xs.min()) / 2 * 0.85
        yy, xx = np.ogrid[: cover.shape[0], : cover.shape[1]]
        ellipse = ((yy - cy) / max(ry, 1)) ** 2 + ((xx - cx) / max(rx, 1)) ** 2 <= 1
        keep |= comp & ellipse
    add = filled & ~cover & ~keep
    r2 = r.copy()
    r2[add] = 255
    print(pid, 'filled', int(add.sum()), 'kept neck', int(keep.sum()))
    Image.merge('RGBA', [Image.fromarray(c) for c in (r2, g, b, a)]).save(path, optimize=True)
