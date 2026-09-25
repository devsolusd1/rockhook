"""Rocky rarity art: recolours base.png by flame temperature.

Writes the 1024px tiers to nft/tiers/, the 64px copies the site uses to art/,
and nft/rarity-sheet.png. Run: python nft/generate.py (needs Pillow).
"""
import colorsys, os, random
from collections import deque
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'base.png')
N, SCALE = 64, 16
OUT = os.path.join(HERE, 'tiers')
SITE_ART = os.path.join(HERE, '..', 'art')

def hexc(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def mix(a, b, t): return tuple(round(x + (y - x) * t) for x, y in zip(a, b))
def lum(c): return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255

# ---- downsample to the native 64x64 grid (median of 5 samples per cell) ----
src = Image.open(SRC).convert('RGB'); sp = src.load(); cell = src.size[0] / N
grid = {}
for gy in range(N):
    for gx in range(N):
        cx, cy = (gx + .5) * cell, (gy + .5) * cell
        pts = [sp[int(cx + dx), int(cy + dy)] for dx, dy in ((0, 0), (-4, 0), (4, 0), (0, -4), (0, 4))]
        grid[gx, gy] = tuple(sorted(p[i] for p in pts)[2] for i in range(3))

# ---- classify: body (dark coal), glow (eyes/mouth), background ----
def hsv(c): return colorsys.rgb_to_hsv(*(v / 255 for v in c))
body = {p for p, c in grid.items() if (hsv(c)[2] < .36 and hsv(c)[1] < .62) or hsv(c)[2] < .2}
reach, q = set(), deque(p for p in grid if (p[0] in (0, N - 1) or p[1] in (0, N - 1)) and p not in body)
reach.update(q)
while q:
    x, y = q.popleft()
    for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if n in grid and n not in body and n not in reach:
            reach.add(n); q.append(n)
glow = {p for p in grid if p not in body and p not in reach}
# dark-red mouth interior counts as glow too
glow |= {p for p in body if grid[p][0] - grid[p][2] > 45 and grid[p][0] > 70}
body -= glow
bg = reach
glum = [lum(grid[p]) for p in glow]; gmin, gmax = min(glum), max(glum)
blum = sorted(lum(grid[p]) for p in body); bhot = blum[int(len(blum) * .93)]
interior = {p for p in body if all(n in body or n in glow for n in ((p[0]+1,p[1]),(p[0]-1,p[1]),(p[0],p[1]+1),(p[0],p[1]-1)))}

def ramp(stops, t):
    t = max(0, min(1, t)) * (len(stops) - 1); i = min(int(t), len(stops) - 2)
    return mix(stops[i], stops[i + 1], t - i)

TIERS = [  # name, flame ramp (dark -> bright), bg (light, rays), sparks, smoulder, aura, crown
    ('Ember',     ['#2a0802', '#6e1406', '#a8280c', '#c8481a', '#e07030'], ('#b89a82', '#7a5444'), 0,  False, False, False),
    ('Flame',     ['#5a1408', '#b83a10', '#f08020', '#ffc040', '#fff0a0'], ('#e8c38f', '#c8643c'), 0,  False, False, False),
    ('White-hot', ['#7a3a08', '#e09020', '#ffd860', '#fff4c0', '#ffffff'], ('#fff2c4', '#f0b848'), 10, False, False, False),
    ('Blue Flame',['#081a4a', '#1848b0', '#2890f0', '#80d8ff', '#ffffff'], ('#b8dcf8', '#2a5aa8'), 16, True,  False, False),
    ('Plasma',    ['#2a0848', '#7018b0', '#c040f0', '#f0a0ff', '#ffffff'], ('#e2c4f4', '#6a2a9a'), 22, True,  True,  False),
    ('Supernova', ['#6a3a00', '#e0a000', '#ffe040', '#fff8c0', '#ffffff'], ('#1a1426', '#c89a1a'), 30, True,  True,  True),
]
ASH = ['#141414', '#2e2e2e', '#4a4a4a', '#6e6e6e', '#8e8e8e']

def spark_cells(n, seed):
    rnd = random.Random(seed)
    near = [p for p in bg if 2 <= min(abs(p[0] - b[0]) + abs(p[1] - b[1]) for b in edge) <= 6]
    return rnd.sample(near, min(n, len(near)))
edge = [p for p in body if any(n in bg for n in ((p[0]+1,p[1]),(p[0]-1,p[1]),(p[0],p[1]+1),(p[0],p[1]-1)))]
ring1 = {n for p in edge for n in ((p[0]+1,p[1]),(p[0]-1,p[1]),(p[0],p[1]+1),(p[0],p[1]-1)) if n in bg}
ring2 = {n for p in ring1 for n in ((p[0]+1,p[1]),(p[0]-1,p[1]),(p[0],p[1]+1),(p[0],p[1]-1)) if n in bg} - ring1

CROWN = ['X.....X.....X', 'XX...XXX...XX', 'XXX.XXXXX.XXX', 'XXXXXXXXXXXXX', 'XXGXXXRXXXGXX', 'XXXXXXXXXXXXX', 'DDDDDDDDDDDDD']
def render(tier, ashen=False):
    name, stops, (light, rays), sparks, smoulder, aura, crown = tier
    stops = [hexc(h) for h in (ASH if ashen else stops)]
    light, rays = hexc(light), hexc(rays)
    if ashen: light, rays = mix(light, (140, 140, 140), .8), mix(rays, (90, 90, 90), .8)
    img = {}
    for p, c in grid.items():
        if p in glow:
            img[p] = ramp(stops, (lum(c) - gmin) / (gmax - gmin))
        elif p in bg:
            img[p] = light if lum(c) > .62 else rays
        else:
            img[p] = c
            if smoulder and not ashen and p in interior and lum(c) >= bhot:
                img[p] = mix(c, stops[2], .55)
            if ashen and c[0] - c[2] > 20:
                g = round(lum(c) * 255); img[p] = (g, g, g)
    if aura and not ashen:
        for p in ring1: img[p] = mix(img[p], stops[3], .75)
        for p in ring2: img[p] = mix(img[p], stops[2], .35)
    if sparks and not ashen:
        for i, p in enumerate(spark_cells(sparks, name)):
            img[p] = stops[4] if i % 3 else stops[3]
    if crown:
        top = min(y for (x, y) in body if x == 32)
        x0, y0 = 32 - 6, max(1, top - 5)
        gold, dark, line = hexc('#ffd23f'), hexc('#b8861a'), hexc('#2a1a00')
        cells = {(x0 + dx, y0 + dy): ch for dy, row in enumerate(CROWN) for dx, ch in enumerate(row) if ch != '.'}
        for (x, y) in cells:
            for n in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                if n not in cells and n in img: img[n] = line
        for p, ch in cells.items():
            img[p] = {'X': gold, 'D': dark, 'G': hexc('#40e0ff'), 'R': hexc('#ff3060')}[ch]
    out = Image.new('RGB', (N, N))
    out.putdata([img[x, y] for y in range(N) for x in range(N)])
    return out.resize((N * SCALE, N * SCALE), Image.NEAREST)

tiles = []
for t in TIERS:
    tiles.append((t[0], render(t), t[0].lower().replace(' ', '-')))
tiles.append(('Burnt out (sold)', render(TIERS[1], ashen=True), 'burnt-out'))
for _, im, slug in tiles:
    im.save(os.path.join(OUT, f'{slug}.png'))
    im.resize((N, N), Image.NEAREST).save(os.path.join(SITE_ART, f'{slug}.png'), optimize=True)

# contact sheet
T = 300; pad = 16; cols = 4; rows = 2
sheet = Image.new('RGB', (cols * (T + pad) + pad, rows * (T + 44 + pad) + pad), (18, 16, 22))
d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('arial.ttf', 20)
except OSError: font = ImageFont.load_default()
for i, (name, im, _) in enumerate(tiles):
    x = pad + (i % cols) * (T + pad); y = pad + (i // cols) * (T + 44 + pad)
    sheet.paste(im.resize((T, T), Image.NEAREST), (x, y))
    d.text((x + 4, y + T + 10), name, fill=(235, 225, 210), font=font)
sheet.save(os.path.join(HERE, 'rarity-sheet.png'))
print('glow cells', len(glow), 'body', len(body), 'bg', len(bg))
