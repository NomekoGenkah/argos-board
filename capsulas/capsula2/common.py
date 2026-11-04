"""Shared helpers: fonts, easing, antialiased shapes, shadows, text with emoji."""
import os
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1920, 1080, 30

# Fonts are looked up by file name in assets/fonts, the dirs listed in $CAPSULA_FONT_DIRS
# (separated by os.pathsep) and the usual system font folders (Linux, macOS, Windows).
FONT_FILES = {
    "reg": "Inter-Regular.otf",
    "med": "Inter-Medium.otf",
    "semi": "Inter-SemiBold.otf",
    "bold": "Inter-Bold.otf",
    "ital": "Inter-Italic.otf",
    "d_thin": "InterDisplay-Thin.otf",
    "d_light": "InterDisplay-Light.otf",
    "d_med": "InterDisplay-Medium.otf",
    "d_semi": "InterDisplay-SemiBold.otf",
    "d_bold": "InterDisplay-Bold.otf",
    "d_xbold": "InterDisplay-ExtraBold.otf",
    "d_black": "InterDisplay-Black.otf",
    "mono": "JetBrainsMono-Medium.ttf",
    "hand": "caveat-latin-500-normal.woff",
    "hand_b": "caveat-latin-600-normal.woff",
    "emoji": "NotoColorEmoji.ttf",
}
FONT_DIRS = [os.path.join(HERE, "assets/fonts")] + [d for d in os.environ.get("CAPSULA_FONT_DIRS", "").split(os.pathsep) if d] + [
    "/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.local/share/fonts"), os.path.expanduser("~/.fonts"),
    "/Library/Fonts", "/System/Library/Fonts", os.path.expanduser("~/Library/Fonts"),
    os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts"), os.path.expanduser("~/AppData/Local/Microsoft/Windows/Fonts"),
]


@lru_cache(maxsize=None)
def font_path(name):
    fn = FONT_FILES[name]
    for d in FONT_DIRS:
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            if fn in files:
                return os.path.join(root, fn)
    raise FileNotFoundError(f"Font {fn} not found. Install it or copy it into assets/fonts (see README.md).")


@lru_cache(maxsize=None)
def font(name, size):
    return ImageFont.truetype(font_path(name), int(size))


# ---------------------------------------------------------------- easing
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def prog(t, t0, t1):
    """0..1 progress of t inside [t0, t1]."""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))


def ease_out(x):
    return 1 - (1 - x) ** 3


def ease_in(x):
    return x ** 3


def ease_in_out(x):
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def lerp(a, b, x):
    return a + (b - a) * x


# ---------------------------------------------------------------- shapes
@lru_cache(maxsize=512)
def rrect(w, h, r, fill, ss=3):
    """Antialiased rounded rectangle as RGBA image (cached)."""
    w, h = int(round(w)), int(round(h))
    big = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, fill=fill)
    return big.resize((w, h), Image.LANCZOS)


@lru_cache(maxsize=64)
def circle(d, fill, ss=4):
    d = int(round(d))
    big = Image.new("RGBA", (d * ss, d * ss), (0, 0, 0, 0))
    ImageDraw.Draw(big).ellipse((0, 0, d * ss - 1, d * ss - 1), fill=fill)
    return big.resize((d, d), Image.LANCZOS)


def drop_shadow(img, blur=20, opacity=0.6, spread=0, color=(0, 0, 0)):
    """Return (shadow_image, pad) for an RGBA image."""
    pad = blur * 3 + spread
    a = img.split()[3]
    sh = Image.new("L", (img.width + 2 * pad, img.height + 2 * pad), 0)
    sh.paste(a, (pad, pad))
    if spread:
        sh = sh.filter(ImageFilter.MaxFilter(spread * 2 + 1))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    sh = sh.point(lambda v: int(v * opacity))
    out = Image.new("RGBA", sh.size, color + (0,))
    out.putalpha(sh)
    return out, pad


def paste_with_shadow(base, img, xy, blur=20, opacity=0.55, offset=(0, 12)):
    sh, pad = drop_shadow(img, blur, opacity)
    base.alpha_composite(sh, (int(xy[0] - pad + offset[0]), int(xy[1] - pad + offset[1])))
    base.alpha_composite(img, (int(xy[0]), int(xy[1])))


def radial(w, h, cx, cy, r, color, amax=255, power=2.0):
    """RGBA radial glow."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    a = np.clip(1 - d, 0, 1) ** power * amax
    arr = np.zeros((h, w, 4), np.uint8)
    arr[..., :3] = color
    arr[..., 3] = a.astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def vignette(w, h, strength=0.65, power=2.2):
    """Multiplicative vignette as float array (h, w, 1)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx - w / 2) / (w / 2)
    ny = (yy - h / 2) / (h / 2)
    d = np.sqrt(nx ** 2 * 0.8 + ny ** 2 * 1.0) / 1.25
    v = 1 - strength * np.clip(d, 0, 1) ** power
    return v[..., None]


def noise_grain(w, h, amount=6, seed=0):
    rng = np.random.default_rng(seed)
    return rng.normal(0, amount, (h, w, 1)).astype(np.float32)


def rotate_rgba(img, angle):
    return img.rotate(angle, resample=Image.BICUBIC, expand=True)


# ---------------------------------------------------------------- emoji / text
@lru_cache(maxsize=32)
def emoji_img(ch, size):
    f = ImageFont.truetype(font_path("emoji"), 109)
    im = Image.new("RGBA", (136, 128), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((0, 0), ch, font=f, embedded_color=True)
    im = im.crop(im.getbbox())
    s = size / max(im.size)
    return im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)


def is_emoji(tok):
    return any(ord(c) > 0x2600 and not (0x2190 <= ord(c) <= 0x22FF) for c in tok) and len(tok) <= 2


def tokenize(text):
    """Split into word tokens; '\n' is its own token."""
    toks = []
    for para_i, para in enumerate(text.split("\n")):
        if para_i:
            toks.append("\n")
        toks.extend([w for w in para.split(" ") if w != ""])
    return toks


def wrap_tokens(tokens, fnt, maxw, esize):
    """Greedy wrap -> list of lines (each a list of tokens)."""
    lines, cur, curw = [], [], 0.0
    space = fnt.getlength(" ")
    for tok in tokens:
        if tok == "\n":
            lines.append(cur)
            cur, curw = [], 0.0
            continue
        tw = esize * 1.1 if is_emoji(tok) else fnt.getlength(tok)
        add = tw if not cur else space + tw
        if cur and curw + add > maxw:
            lines.append(cur)
            cur, curw = [tok], tw
        else:
            cur.append(tok)
            curw += add
    lines.append(cur)
    return lines


def line_width(line, fnt, esize):
    space = fnt.getlength(" ")
    w = 0
    for i, tok in enumerate(line):
        w += (esize * 1.1 if is_emoji(tok) else fnt.getlength(tok)) + (space if i else 0)
    return w


def draw_line(img, draw, line, xy, fnt, fill, esize):
    x, y = xy
    space = fnt.getlength(" ")
    asc = fnt.getmetrics()[0]
    for i, tok in enumerate(line):
        if i:
            x += space
        if is_emoji(tok):
            e = emoji_img(tok, esize)
            img.alpha_composite(e, (int(x), int(y + asc - esize * 0.9)))
            x += esize * 1.1
        else:
            draw.text((x, y), tok, font=fnt, fill=fill)
            x += fnt.getlength(tok)
    return x


def text_center(draw, cx, y, text, fnt, fill):
    w = fnt.getlength(text)
    draw.text((cx - w / 2, y), text, font=fnt, fill=fill)


def to_rgb(img):
    if img.mode == "RGB":
        return img
    bg = Image.new("RGB", img.size, (0, 0, 0))
    bg.paste(img, mask=img.split()[3])
    return bg


def camera(canvas, scale, cx, cy, out=(W, H), resample=Image.BILINEAR):
    """Crop a region of `canvas` (any size) centred on (cx, cy) in canvas pixels.
    scale=1 shows the whole canvas width; >1 zooms in."""
    cw, ch = canvas.size
    vw, vh = cw / scale, ch / scale
    x0 = clamp(cx - vw / 2, 0, cw - vw)
    y0 = clamp(cy - vh / 2, 0, ch - vh)
    return canvas.resize(out, resample, box=(x0, y0, x0 + vw, y0 + vh))
