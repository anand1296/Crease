"""
Bakes the textures the game needs from a Rocketbox avatar:

  public/players/<id>_body.jpg     body albedo (1024²)
  public/players/<id>_body_n.jpg   body normal map
  public/players/<id>_head.jpg     head albedo
  public/players/<id>_head_n.jpg   head normal map
  public/players/<id>_kit.png      kit mask: R = shirt (1) / trim (0.5), G = trousers, B = shoes, A = gloves

The kit mask is made by rasterising the body's UV triangles and, for each
texel, finding where it sits on the body in the bind pose (nearest bone
segment and height). The game paints team colours through the mask, so one
avatar can wear any team's kit.

Usage: python3 scripts/avatars/mask.py <rocketbox-src-dir> <work-dir>
"""
import json, sys, os
import numpy as np
from PIL import Image

SRC, WORK = sys.argv[1], sys.argv[2]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'players')
SIZE = 1024
AVATARS = [('Sports_Male_01', 'p1'), ('Sports_Male_02', 'p2'), ('Sports_Male_03', 'p3'), ('Sports_Male_04', 'p4')]

def tex(src_dir, prefix, part, kind, out_name, quality):
    p = os.path.join(src_dir, f'{prefix}_{part}_{kind}.tga')
    im = Image.open(p).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    # TGA is stored bottom-up in Rocketbox exports as loaded by PIL already; glTF UVs have v flipped by the exporter.
    im.save(os.path.join(OUT, out_name), quality=quality, optimize=True)

def segments(b):
    def seg(a, c, name):
        return (np.array(b[a], float), np.array(b[c], float), name)
    hand_end = lambda s: list(np.array(b[f'Bip01_{s}_Hand']) + (np.array(b[f'Bip01_{s}_Hand']) - np.array(b[f'Bip01_{s}_Forearm'])) * 0.45)
    toe_end = lambda s: list(np.array(b[f'Bip01_{s}_Toe0']) + (np.array(b[f'Bip01_{s}_Toe0']) - np.array(b[f'Bip01_{s}_Foot'])) * 0.3)
    S = [seg('Bip01_Pelvis', 'Bip01_Spine', 'pelvis'), seg('Bip01_Spine', 'Bip01_Spine1', 'torso'), seg('Bip01_Spine1', 'Bip01_Spine2', 'torso'),
         seg('Bip01_Spine2', 'Bip01_Neck', 'torso'), seg('Bip01_Neck', 'Bip01_Head', 'neck')]
    for s in 'LR':
        b[f'_{s}_handend'] = hand_end(s)
        b[f'_{s}_toeend'] = toe_end(s)
        S += [seg('Bip01_Neck', f'Bip01_{s}_UpperArm', 'shoulder'), seg(f'Bip01_{s}_UpperArm', f'Bip01_{s}_Forearm', 'upperarm'),
              seg(f'Bip01_{s}_Forearm', f'Bip01_{s}_Hand', 'forearm'), seg(f'Bip01_{s}_Hand', f'_{s}_handend', 'hand'),
              seg('Bip01_Pelvis', f'Bip01_{s}_Thigh', 'pelvis'), seg(f'Bip01_{s}_Thigh', f'Bip01_{s}_Calf', 'thigh'),
              seg(f'Bip01_{s}_Calf', f'Bip01_{s}_Foot', 'calf'), seg(f'Bip01_{s}_Foot', f'_{s}_toeend', 'foot')]
    return S

def classify(P, b):
    """P: (n,3) bind positions in cm → (n,4) mask values."""
    segs = segments(b)
    best = np.full(len(P), np.inf); kind = np.empty(len(P), object); tpar = np.zeros(len(P))
    for a, c, name in segs:
        ab = c - a; L2 = max(ab @ ab, 1e-6)
        t = np.clip(((P - a) @ ab) / L2, 0, 1)
        d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
        m = d < best
        best[m] = d[m]; kind[m] = name; tpar[m] = t[m]
    y = P[:, 1]
    waist = b['Bip01_Spine'][1] + 2.0
    collar = b['Bip01_Neck'][1] - 2.5
    ankle = b['Bip01_L_Foot'][1] + 4.0
    out = np.zeros((len(P), 4))
    shirt = np.isin(kind, ['torso', 'shoulder']) & (y >= waist) & (y < collar)
    collar_band = np.isin(kind, ['torso', 'shoulder', 'neck']) & (y >= collar) & (y < collar + 2.2)
    sleeve = (kind == 'upperarm') & (tpar < 0.62)
    cuff = (kind == 'upperarm') & (tpar >= 0.62) & (tpar < 0.7)
    trousers = (np.isin(kind, ['pelvis', 'thigh', 'calf']) | (np.isin(kind, ['torso']) & (y < waist))) & (y >= ankle)
    shoes = (np.isin(kind, ['foot', 'calf']) & (y < ankle))
    gloves = (kind == 'hand') | ((kind == 'forearm') & (tpar > 0.86))
    out[shirt | sleeve, 0] = 1.0
    out[(collar_band | cuff) & ~gloves, 0] = 0.5
    out[trousers, 1] = 1.0
    out[shoes, 2] = 1.0
    out[gloves, 3] = 1.0
    return out

def bake_mask(d):
    uv = np.array(d['uv']).reshape(-1, 2)
    pos = np.array(d['pos']).reshape(-1, 3)
    tris = np.array(d['tris']['body']).reshape(-1, 3)
    vals = classify(pos, dict(d['bones']))
    img = np.zeros((SIZE, SIZE, 4))
    cover = np.zeros((SIZE, SIZE), bool)
    # Rasterise per triangle (texel centres), nearest-vertex class within the triangle using barycentric weights
    # on per-texel positions for accuracy at seams.
    for tri in tris:
        uvt = uv[tri] * SIZE
        uvt[:, 1] = SIZE - uvt[:, 1]  # image rows go down; glTF/three v goes up
        x0, y0 = np.floor(uvt.min(0)).astype(int); x1, y1 = np.ceil(uvt.max(0)).astype(int)
        x0 = max(x0, 0); y0 = max(y0, 0); x1 = min(x1, SIZE - 1); y1 = min(y1, SIZE - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = uvt
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9: continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not inside.any(): continue
        P = (w0[..., None] * pos[tri[0]] + w1[..., None] * pos[tri[1]] + w2[..., None] * pos[tri[2]])[inside]
        v = classify(P, dict(d['bones']))
        iy = (ys[inside] - 0.5).astype(int); ix = (xs[inside] - 0.5).astype(int)
        img[iy, ix] = v
        cover[iy, ix] = True
    # Dilate into the gutters so mip-mapping does not bleed skin into the kit at UV seams.
    for _ in range(6):
        grown = img.copy(); gc = cover.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(img, dy, 0), dx, 1); sc = np.roll(np.roll(cover, dy, 0), dx, 1)
            fill = ~gc & sc
            grown[fill] = sh[fill]; gc |= fill
        img, cover = grown, gc
    return Image.fromarray((img * 255).round().astype(np.uint8), 'RGBA')

for name, id in AVATARS:
    d = json.load(open(os.path.join(WORK, f'{id}.uv.json')))
    src = os.path.join(SRC, name)
    prefix = [f for f in os.listdir(src) if f.endswith('_body_color.tga')][0].replace('_body_color.tga', '')
    tex(src, prefix, 'body', 'color', f'{id}_body.jpg', 85)
    tex(src, prefix, 'body', 'normal', f'{id}_body_n.jpg', 88)
    tex(src, prefix, 'head', 'color', f'{id}_head.jpg', 85)
    tex(src, prefix, 'head', 'normal', f'{id}_head_n.jpg', 88)
    hair = os.path.join(src, f'{prefix}_opacity_color.tga')
    if os.path.exists(hair):
        Image.open(hair).convert('RGBA').resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f'{id}_hair.png'), optimize=True)
    m = bake_mask(d)
    m.save(os.path.join(OUT, f'{id}_kit.png'), optimize=True)
    print(id, 'done')
