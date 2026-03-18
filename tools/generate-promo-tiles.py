"""
MUGA — Promo tile generator (A1 Navy+Gold palette)
Generates:
  - tools/screenshots/out/promo-small-440x280.png   (Chrome Web Store small tile)
  - tools/screenshots/out/promo-marquee-1400x560.png (Chrome Web Store marquee tile)

Output: 24-bit RGB PNG (no alpha) — accepted by Chrome Web Store and Firefox AMO.
Run: python3 tools/generate-promo-tiles.py
"""

from PIL import Image, ImageDraw, ImageFont
import os

# ── Palette A1 ────────────────────────────────────────────────────────────────
BG1     = (13,  27,  75)
BG2     = (26,  58, 107)
STR1    = (217, 119,   6)
STR2    = (245, 158,  11)
WHITE   = (255, 255, 255)
WHITE70 = (179, 196, 222)
GOLD    = (245, 158,  11)

OUT = os.path.join(os.path.dirname(__file__), 'screenshots', 'out')
os.makedirs(OUT, exist_ok=True)

FONT_BOLD = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
]
FONT_REG = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
]

def load_font(size, bold=True):
    for p in (FONT_BOLD if bold else FONT_REG):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

def lerp_color(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

def draw_bg(draw, w, h, stripe_h):
    for y in range(h - stripe_h):
        t = y / max(1, h - stripe_h - 1)
        draw.line([(0, y), (w, y)], fill=lerp_color(BG1, BG2, t))
    for y in range(h - stripe_h, h):
        t = (y - (h - stripe_h)) / max(1, stripe_h - 1)
        draw.line([(0, y), (w, y)], fill=lerp_color(STR1, STR2, t))

def draw_icon_on(img, cx, cy, size):
    r  = max(4, int(size * 0.18))
    sh = int(size * 0.22)
    x0, y0 = cx - size // 2, cy - size // 2

    tmp = Image.new('RGB', (size, size))
    td  = ImageDraw.Draw(tmp)
    for sy in range(size):
        t = sy / max(1, size - 1)
        td.line([(0, sy), (size, sy)], fill=lerp_color(BG1, BG2, t))
    for sy in range(size - sh, size):
        t = (sy - (size - sh)) / max(1, sh - 1)
        td.line([(0, sy), (size, sy)], fill=lerp_color(STR1, STR2, t))

    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)

    font  = load_font(int(size * 0.60))
    td2   = ImageDraw.Draw(tmp)
    bb    = td2.textbbox((0, 0), 'M', font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    td2.text(((size - tw) / 2 - bb[0], ((size - sh) - th) / 2 - bb[1]), 'M', fill=WHITE, font=font)

    img.paste(tmp, (x0, y0), mask)


# ═══════════════════════════════════════════════════════════════════════════════
# Small promo tile — 440×280
# ═══════════════════════════════════════════════════════════════════════════════
W, H, SH = 440, 280, 36
img  = Image.new('RGB', (W, H))
draw = ImageDraw.Draw(img)
draw_bg(draw, W, H, SH)

ICON = 96
icon_cx, icon_cy = 80, H // 2 - 10
draw_icon_on(img, icon_cx, icon_cy, ICON)

tx = icon_cx + ICON // 2 + 26

f_logo = load_font(38)
f_tag  = load_font(15, bold=False)
f_feat = load_font(13, bold=False)

bb = draw.textbbox((0, 0), 'MUGA', font=f_logo)
draw.text((tx, 42), 'MUGA', fill=WHITE, font=f_logo)
y = 42 + (bb[3] - bb[1]) + 6

draw.text((tx, y), 'Make URLs Great Again.', fill=GOLD, font=f_tag)
y += 22
draw.line([(tx, y), (W - 16, y)], fill=(255, 255, 255), width=1)
y += 10

for feat in ['✓  Strips 50+ tracking parameters', '✓  Silent. Automatic. Free.', '✓  100% local — no data sent']:
    draw.text((tx, y), feat, fill=WHITE70, font=f_feat)
    y += 19

path_small = os.path.join(OUT, 'promo-small-440x280.png')
img.save(path_small)
print(f'✓  Small tile   → {path_small}')


# ═══════════════════════════════════════════════════════════════════════════════
# Marquee promo tile — 1400×560
# ═══════════════════════════════════════════════════════════════════════════════
W, H, SH = 1400, 560, 64
img  = Image.new('RGB', (W, H))
draw = ImageDraw.Draw(img)
draw_bg(draw, W, H, SH)

ICON = 156
icon_cx = 104
icon_cy = H // 2 - 30
draw_icon_on(img, icon_cx, icon_cy, ICON)

f_muga  = load_font(72)
f_sub   = load_font(22, bold=False)
f_h2    = load_font(28)
f_body  = load_font(17, bold=False)
f_mono  = load_font(14, bold=False)
f_badge = load_font(13, bold=False)

text_x = icon_cx + ICON // 2 + 38
bb = draw.textbbox((0, 0), 'MUGA', font=f_muga)
mh = bb[3] - bb[1]
my = icon_cy - mh // 2 - 10
draw.text((text_x, my), 'MUGA', fill=WHITE, font=f_muga)
draw.text((text_x, my + mh + 6), 'Make URLs Great Again.', fill=GOLD, font=f_sub)

# Vertical divider
div_x = 560
draw.line([(div_x, 56), (div_x, H - SH - 36)], fill=(255, 255, 255), width=1)

# Right block
rx, ry = div_x + 60, 52
draw.text((rx, ry), 'Every link. Cleaned. Before it loads.', fill=WHITE, font=f_h2)
ry += 44
draw.text((rx, ry), 'Strips UTMs, fbclid, gclid, Amazon noise, YouTube tokens and 40+ more.', fill=WHITE70, font=f_body)
ry += 32

# Before / After pills
def draw_pill(draw, label, url, x, y, bg, border, text_col, f_label, f_url):
    bb_u  = draw.textbbox((0, 0), url,   font=f_url)
    bb_l  = draw.textbbox((0, 0), label, font=f_label)
    pw    = bb_u[2] - bb_u[0] + 24 + (bb_l[2] - bb_l[0]) + 16
    ph    = max(bb_u[3] - bb_u[1], bb_l[3] - bb_l[1]) + 14
    draw.rounded_rectangle([x, y, x + pw, y + ph], radius=7, fill=bg, outline=border)
    draw.text((x + 10, y + (ph - (bb_l[3] - bb_l[1])) // 2), label, fill=border, font=f_label)
    lw = bb_l[2] - bb_l[0]
    draw.text((x + 10 + lw + 12, y + (ph - (bb_u[3] - bb_u[1])) // 2), url, fill=text_col, font=f_url)
    return ph + 6

before_url = 'amazon.es/dp/B09?tag=yt&utm_source=yt&linkCode=ll1&pd_rd_r=xyz&ref_=nav'
after_url  = 'amazon.es/dp/B09?tag=yt'

ph = draw_pill(draw, 'BEFORE', before_url, rx, ry, (70, 18, 18), (200, 80, 80), (200, 130, 130), f_badge, f_mono)
ry += ph

bb_arr = draw.textbbox((0, 0), '→', font=f_body)
draw.text((rx + 6, ry), '→', fill=GOLD, font=f_body)
ry += (bb_arr[3] - bb_arr[1]) + 6

draw_pill(draw, 'AFTER', after_url, rx, ry, (12, 46, 22), (70, 180, 90), (110, 220, 130), f_badge, f_mono)
ry += ph + 8

# Feature badges
badges = ['✓ Silent', '✓ Local only', '✓ Free forever', '✓ Open source']
bx = rx
for badge in badges:
    bb_b = draw.textbbox((0, 0), badge, font=f_badge)
    bw   = bb_b[2] - bb_b[0] + 22
    draw.rounded_rectangle([bx, ry, bx + bw, ry + 26], radius=13,
                           fill=(40, 60, 110), outline=(80, 100, 160))
    draw.text((bx + 10, ry + 5), badge, fill=WHITE70, font=f_badge)
    bx += bw + 8

path_marquee = os.path.join(OUT, 'promo-marquee-1400x560.png')
img.save(path_marquee)
print(f'✓  Marquee tile → {path_marquee}')

# Verify
for path in [path_small, path_marquee]:
    im = Image.open(path)
    assert im.mode == 'RGB', f'{path} has alpha channel!'
    print(f'   {os.path.basename(path)}: {im.size[0]}×{im.size[1]}  mode={im.mode}  ✓')
