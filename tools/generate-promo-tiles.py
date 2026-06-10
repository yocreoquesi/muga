# Requires: python3 with the Pillow library (pip install Pillow).
# Not needed for extension builds or tests — only for regenerating Chrome Web Store promo images.
# See the "Optional toolchain dependencies" section in CONTRIBUTING.md.
"""
MUGA — Promo tile generator (violet/denoise palette)
Generates:
  - tools/screenshots/out/promo-small-440x280.png   (Chrome Web Store small tile)
  - tools/screenshots/out/promo-marquee-1400x560.png (Chrome Web Store marquee tile)

Output: 24-bit RGB PNG (no alpha) — accepted by Chrome Web Store and Firefox AMO.
Run: python3 tools/generate-promo-tiles.py
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import os

# ── Palette: Violet / Denoise ─────────────────────────────────────────────────
BG1     = (26,  24,  32)   # surface-1 dark
BG2     = (42,  28,  74)   # accent-soft dark
STR1    = (106,  43, 207)  # accent
STR2    = (159, 122, 232)  # accent light
WHITE   = (255, 255, 255)
WHITE70 = (176, 174, 186)  # text-2 dark
GOLD    = (159, 122, 232)  # accent light (replaces gold in text highlights)

OUT = os.path.join(os.path.dirname(__file__), 'screenshots', 'out')
os.makedirs(OUT, exist_ok=True)

FONT_BOLD = [
    # Linux
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    # Windows
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    # macOS
    '/System/Library/Fonts/Helvetica.ttc',
]
FONT_REG = [
    # Linux
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
    # Windows
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    # macOS
    '/System/Library/Fonts/Helvetica.ttc',
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

_BRAND_MARK_PNG = Path(__file__).resolve().parent / 'brand' / 'muga-mark-512.png'

def draw_icon_on(img, cx, cy, size):
    """Paste the M-arrow brand mark centered at (cx, cy), scaled to `size`.

    The mark lives at tools/brand/muga-mark-512.png as a transparent-bg PNG
    of the canonical square version (rendered from tools/brand/muga-mark-square.svg).
    Using the actual brand mark keeps promo tiles consistent with the
    extension's installed icon and the in-product brand mark — earlier
    revisions drew an approximation (a letter 'M' on a violet gradient
    badge) that didn't match the rebrand.
    """
    mark = Image.open(_BRAND_MARK_PNG).convert('RGBA')
    mark = mark.resize((size, size), Image.LANCZOS)
    x0, y0 = cx - size // 2, cy - size // 2
    img.paste(mark, (x0, y0), mark)


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

bb = draw.textbbox((tx, 42), 'MUGA', font=f_logo)
draw.text((tx, 42), 'MUGA', fill=WHITE, font=f_logo)
y = bb[3] + 10

draw.text((tx, y), 'The denoise extension for the web.', fill=GOLD, font=f_tag)
y += 28
draw.line([(tx, y), (W - 16, y)], fill=(255, 255, 255), width=1)
y += 10

for feat in ['•  Removes 450+ bits of noise', '•  Silent. Automatic. Free.', '•  No analytics, no telemetry']:
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
bb = draw.textbbox((text_x, 0), 'MUGA', font=f_muga)
mh = bb[3] - bb[1]
my = icon_cy - mh // 2 - 30
draw.text((text_x, my), 'MUGA', fill=WHITE, font=f_muga)
draw.text((text_x, my + bb[3] + 18), 'The denoise extension for the web.', fill=GOLD, font=f_sub)

# Vertical divider
div_x = 560
draw.line([(div_x, 56), (div_x, H - SH - 36)], fill=(255, 255, 255), width=1)

# Right block
rx, ry = div_x + 60, 52
draw.text((rx, ry), 'The web, with the noise turned down.', fill=WHITE, font=f_h2)
ry += 44
draw.text((rx, ry), 'Removes UTMs, fbclid, gclid, Amazon noise, YouTube tokens and 450+ more.', fill=WHITE70, font=f_body)
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
draw.text((rx + 6, ry), '→', fill=STR2, font=f_body)
ry += (bb_arr[3] - bb_arr[1]) + 6

draw_pill(draw, 'AFTER', after_url, rx, ry, (12, 46, 22), (70, 180, 90), (110, 220, 130), f_badge, f_mono)
ry += ph + 8

# Feature badges
badges = ['• Quiet', '• No telemetry', '• Free forever', '• Open source']
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
