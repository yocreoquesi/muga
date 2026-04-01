"""
MUGA — Promo tile generator (Pillow)

Generates docs/assets/promo-marquee-1400x560.png
No browser required — pure Python + Pillow.

Usage:
    python3 tools/screenshots/capture-promo.py
    npm run promo-tile
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
import os, sys
from pathlib import Path

ROOT       = Path(__file__).resolve().parents[2]
OUTPUT     = ROOT / "docs" / "assets" / "promo-marquee-1400x560.png"
FONT_SANS  = "/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf"
FONT_MONO  = "/usr/share/fonts/truetype/ubuntu/UbuntuSansMono[wght].ttf"

W, H = 1400, 560

# ── Palette ─────────────────────────────────────────────────────────────────
BG          = (10,  14,  26)
BLUE        = (37,  99, 235)
BLUE_LIGHT  = (96, 165, 250)
BLUE_MID    = (59, 130, 246)
WHITE       = (255, 255, 255)
GREY_DIM    = (75,  85,  99)
GREY_DARK   = (31,  41,  55)
RED_MUTED   = (239, 68,  68)
GREEN_CLEAN = (52, 211, 153)
DIVIDER     = (37,  55, 100)

def hex_alpha(rgb, a):
    return rgb + (a,)

def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

# ── Helpers ──────────────────────────────────────────────────────────────────

def draw_rrect(draw, xy, radius, fill=None, outline=None, width=1):
    """Rounded rectangle."""
    x0, y0, x1, y1 = xy
    r = radius
    if fill:
        draw.rounded_rectangle(xy, radius=r, fill=fill)
    if outline:
        draw.rounded_rectangle(xy, radius=r, outline=outline, width=width)


def glow_layer(size, cx, cy, radius, color, alpha_max=60):
    """Radial gradient glow as RGBA layer."""
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    arr   = np.zeros((h, w, 4), dtype=np.uint8)
    Y, X  = np.ogrid[:h, :w]
    dist  = np.sqrt((X - cx)**2 + (Y - cy)**2)
    a     = np.clip(1 - dist / radius, 0, 1) ** 1.5
    arr[:, :, 0] = color[0]
    arr[:, :, 1] = color[1]
    arr[:, :, 2] = color[2]
    arr[:, :, 3] = (a * alpha_max).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def grid_layer(w, h, step=48, color=(37, 99, 235), alpha=14):
    """Subtle dot-grid."""
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d     = ImageDraw.Draw(layer)
    col   = color + (alpha,)
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=col, width=1)
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=col, width=1)
    return layer


def draw_pill(draw, img_rgba, x, y, text, fnt):
    """Draw a small pill badge."""
    bbox   = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 12, 6
    pw = tw + pad_x * 2
    ph = th + pad_y * 2

    pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    pd   = ImageDraw.Draw(pill)
    fill_col = (37, 99, 235, 40)
    out_col  = (37, 99, 235, 100)
    pd.rounded_rectangle([0, 0, pw - 1, ph - 1], radius=ph // 2,
                          fill=fill_col, outline=out_col, width=1)
    pd.text((pad_x, pad_y), text, font=fnt, fill=BLUE_LIGHT + (220,))
    img_rgba.paste(pill, (x, y), pill)
    return pw + 8  # advance


def draw_url_box(img_rgba, x, y, w, h, segments, border_color, bg_color, mono_fnt):
    """Draw a URL box with colored segments."""
    box = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd  = ImageDraw.Draw(box)
    bd.rounded_rectangle([0, 0, w - 1, h - 1], radius=10,
                          fill=bg_color, outline=border_color, width=1)
    px = 18
    for text, color in segments:
        bd.text((px, 14), text, font=mono_fnt, fill=color)
        bbox = bd.textbbox((px, 14), text, font=mono_fnt)
        px  += bbox[2] - bbox[0]
    img_rgba.paste(box, (x, y), box)


# ── Build image ───────────────────────────────────────────────────────────────

img  = Image.new("RGB", (W, H), BG)
rgba = img.convert("RGBA")

# Grid
rgba = Image.alpha_composite(rgba, grid_layer(W, H))

# Glow blobs
rgba = Image.alpha_composite(rgba, glow_layer((W, H), -60,  -60,  520, BLUE,      50))
rgba = Image.alpha_composite(rgba, glow_layer((W, H), 1350, 580,  400, BLUE_MID,  35))
rgba = Image.alpha_composite(rgba, glow_layer((W, H), 420,  280,  300, BLUE,      20))

draw = ImageDraw.Draw(rgba)

# ── Fonts ─────────────────────────────────────────────────────────────────────
f_logo    = font(FONT_SANS, 108)
f_tagline = font(FONT_SANS, 19)
f_pill    = font(FONT_SANS, 11)
f_label   = font(FONT_SANS, 13)
f_mono    = font(FONT_MONO, 17)
f_arrow   = font(FONT_SANS, 14)
f_stat_n  = font(FONT_SANS, 26)
f_stat_l  = font(FONT_SANS, 12)
f_footer  = font(FONT_SANS, 12)

# ── Left: brand ───────────────────────────────────────────────────────────────
LX = 72

# MUGA logo — white with subtle blue tint
draw.text((LX, 80), "MUGA", font=f_logo, fill=WHITE)

# Tagline
draw.text((LX, 200), "Make URLs Great Again", font=f_tagline, fill=BLUE_LIGHT)

# Pills
pill_y = 238
pill_x = LX
for label in ["454 trackers stripped", "2 active + 1 pending store", "Zero data sent", "Open source"]:
    adv = draw_pill(draw, rgba, pill_x, pill_y, label, f_pill)
    pill_x += adv
    if pill_x > LX + 310:
        pill_x = LX
        pill_y += 32

# Refresh draw after compositing pills
draw = ImageDraw.Draw(rgba)

# ── Divider ───────────────────────────────────────────────────────────────────
DX = 430
for i in range(320):
    t    = i / 319
    # fade in and out
    a    = int(120 * (1 - abs(t - 0.5) * 2) ** 0.5)
    draw.point((DX, 120 + i), fill=BLUE + (a,))

# ── Right: URL transformation ─────────────────────────────────────────────────
RX = 468
RW = W - RX - 60    # available width

# "Before" label
draw.text((RX, 94), "BEFORE", font=f_label, fill=GREY_DIM)

# Dirty URL box — simplified for thumbnail legibility
dirty_segments = [
    ("amazon.es/dp/B08N5",  WHITE    + (200,)),
    ("?",                   GREY_DIM + (180,)),
    ("utm_source=google",   RED_MUTED + (230,)),
    ("&gclid=EAIaIQ",       RED_MUTED + (210,)),
    ("&fbclid=IwAR",        RED_MUTED + (200,)),
]
draw_url_box(rgba, RX, 114,
             RW, 56,
             dirty_segments,
             border_color=(239, 68, 68, 60),
             bg_color=(239, 68, 68, 18),
             mono_fnt=f_mono)

draw = ImageDraw.Draw(rgba)

# Arrow row with badge
AY = 192
# left line
draw.line([(RX, AY + 8), (RX + RW // 2 - 90, AY + 8)],
          fill=BLUE + (80,), width=1)
# badge
badge_text = "  MUGA cleaned it  "
bbox  = draw.textbbox((0, 0), badge_text, font=f_arrow)
bw    = bbox[2] - bbox[0] + 4
bh    = bbox[3] - bbox[1] + 12
bx    = RX + RW // 2 - bw // 2
by    = AY
badge_layer = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
bd = ImageDraw.Draw(badge_layer)
bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=bh // 2,
                     fill=BLUE + (255,))
bd.text((2, 6), badge_text, font=f_arrow, fill=WHITE + (255,))
rgba.paste(badge_layer, (bx, by), badge_layer)
draw = ImageDraw.Draw(rgba)
# right line
draw.line([(bx + bw + 4, AY + 8), (RX + RW, AY + 8)],
          fill=BLUE + (80,), width=1)

# "After" label
draw.text((RX, 220), "AFTER", font=f_label, fill=GREY_DIM)

# Clean URL box
clean_segments = [
    ("amazon.es/dp/B08N5", BLUE_LIGHT + (240,)),
]
draw_url_box(rgba, RX, 238,
             RW, 56,
             clean_segments,
             border_color=(37, 99, 235, 80),
             bg_color=(37, 99, 235, 25),
             mono_fnt=f_mono)
draw = ImageDraw.Draw(rgba)

# ── Stats bar ─────────────────────────────────────────────────────────────────
stats = [
    ("130+", "tracking params"),
    ("54",   "domain rules"),
    ("100%", "local processing"),
    ("0",    "data sent"),
]
SY    = 326
sx    = RX
sep_w = 1
sep_h = 40
for i, (num, label) in enumerate(stats):
    # number
    draw.text((sx, SY), num, font=f_stat_n, fill=WHITE)
    nb = draw.textbbox((sx, SY), num, font=f_stat_n)
    # label
    draw.text((sx, SY + 34), label, font=f_stat_l, fill=GREY_DIM)
    lb = draw.textbbox((sx, SY + 34), label, font=f_stat_l)
    col_w = max(nb[2] - nb[0], lb[2] - lb[0])
    sx += col_w + 28
    # separator
    if i < len(stats) - 1:
        for dy in range(sep_h):
            t = dy / (sep_h - 1)
            a = int(80 * (1 - abs(t - 0.5) * 2))
            draw.point((sx, SY + 4 + dy), fill=WHITE + (a,))
        sx += sep_w + 28

# ── Footer ────────────────────────────────────────────────────────────────────
footer = "Every link. Cleaned. Before it loads."
fb = draw.textbbox((0, 0), footer, font=f_footer)
fw = fb[2] - fb[0]
draw.text((W - fw - 72, H - 36), footer, font=f_footer, fill=GREY_DIM)

# ── Save ──────────────────────────────────────────────────────────────────────
final = rgba.convert("RGB")
final.save(OUTPUT, "PNG", optimize=True)
print(f"✅  Promo tile saved → {OUTPUT}  ({W}×{H})")
