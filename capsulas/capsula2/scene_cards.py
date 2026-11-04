"""S6 (freeze on the close-up + statistic) and S7 (final card)."""
import math
import os
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

from common import W, H, font, prog, ease_out, ease_in_out, lerp, emoji_img, radial
import timeline as TL

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
RED = (255, 84, 74)


def grain(seed, amount=7):
    rng = np.random.default_rng(seed)
    return rng.normal(0, amount, (H, W, 1)).astype(np.float32)


def text_layer(items):
    """items: list of (text, font, color_rgba, (cx, y))."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for txt, f, col, (cx, y) in items:
        d.text((cx - f.getlength(txt) / 2, y), txt, font=f, fill=col)
    return layer


def with_alpha(layer, a):
    if a >= 1:
        return layer
    l2 = layer.copy()
    l2.putalpha(layer.split()[3].point(lambda v: int(v * a)))
    return l2


def offset(layer, dy):
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.alpha_composite(layer, (0, int(dy)))
    return out


BLUE = (110, 190, 255)


# ------------------------------------------------------------------ S6
@lru_cache(maxsize=1)
def freeze_src():
    from scene_casa import closeup_frame
    return closeup_frame(TL.S6["freeze"])


@lru_cache(maxsize=1)
def freeze_treated():
    src = freeze_src()
    g = ImageEnhance.Color(src).enhance(0.0)
    g = g.filter(ImageFilter.GaussianBlur(7))
    arr = np.asarray(g, np.float32) * 0.26
    arr[..., 2] *= 1.15
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def person_icon(h, fill, outline=None):
    s = 4
    w = int(h * 0.62)
    im = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    hr = w * s * 0.26
    cx = w * s / 2
    kw = dict(fill=fill) if outline is None else dict(outline=outline, width=3 * s)
    d.ellipse((cx - hr, 0, cx + hr, 2 * hr), **kw)
    d.rounded_rectangle((cx - w * s * 0.46, 2 * hr + 0.08 * h * s, cx + w * s * 0.46, h * s - 1), int(w * s * 0.3), **kw)
    return im.resize((w, h), Image.LANCZOS)


def s6_frame(t):
    from scene_casa import closeup_frame
    D = TL.PLAN["dato"]
    fz = TL.S6["freeze"]
    if t < fz:
        return closeup_frame(t)
    t2 = t - fz
    x = ease_in_out(prog(t2, 0.05, 0.7))
    base = Image.blend(freeze_src(), freeze_treated(), x).convert("RGBA")
    if t2 < 0.12:
        base.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, int(110 * (1 - t2 / 0.12)))))
    # three people, one of them lit by the screen
    for i in range(3):
        a = ease_out(prog(t2, 0.6 + i * 0.18, 0.9 + i * 0.18))
        if a <= 0:
            continue
        icon = person_icon(120, BLUE + (255,)) if i == 0 else person_icon(120, None, (150, 156, 170, 255))
        base.alpha_composite(with_alpha(icon, a), (int(W / 2 - 130 + i * 100 - icon.width / 2), int(120 + 14 * (1 - a))))
    b = ease_out(prog(t2, 1.2, 1.6))
    if b > 0:
        l = text_layer([(D["big"], font("d_black", 176), BLUE + (255,), (W / 2, 278))])
        sc = with_alpha(l, b)
        base.alpha_composite(offset(sc, 18 * (1 - b)))
    for i, line in enumerate(D["lines"]):
        c = ease_out(prog(t2, 1.9 + i * 0.35, 2.3 + i * 0.35))
        if c > 0:
            l = text_layer([(line, font("d_med", 54), (235, 237, 242, 255), (W / 2, 520 + i * 72))])
            base.alpha_composite(offset(with_alpha(l, c), 16 * (1 - c)))
    s = ease_out(prog(t2, 3.3, 3.8))
    if s > 0:
        l = text_layer([(D["source"], font("ital", 30), (170, 175, 186, 255), (W / 2, 800))])
        base.alpha_composite(with_alpha(l, s))
    arr = np.asarray(base.convert("RGB"), np.float32) + grain(0, 3)
    k = 1 - prog(t, 11.5, 12.0)
    return Image.fromarray(np.clip(arr * k, 0, 255).astype(np.uint8))


# ------------------------------------------------------------------ S7: final card (same as cápsula 1)
@lru_cache(maxsize=1)
def s8_bg():
    yy = np.linspace(0, 1, H)[:, None, None]
    top = np.array([10, 12, 22], np.float32)
    bot = np.array([4, 5, 9], np.float32)
    arr = (top * (1 - yy) + bot * yy) * np.ones((1, W, 1), np.float32)
    im = Image.fromarray(arr.astype(np.uint8)).convert("RGBA")
    im.alpha_composite(radial(W, H, W / 2, H / 2, 900, (60, 90, 200), amax=50, power=2.2))
    return im


def s7_frame(t):
    C = TL.PLAN["cierre"]
    base = s8_bg().copy()
    hit = 0.12
    p = prog(t, hit, hit + 0.5)
    if p > 0:
        sc = lerp(1.12, 1.0, ease_out(p))
        f = font("d_xbold", int(132 * sc))
        cols = [(255, 255, 255, 255), (255, 255, 255, 255), (110, 190, 255, 255)]
        lh = int(150 * sc)
        y0 = H / 2 - lh * 1.5 - 30
        items = [(ln, f, cols[i], (W / 2, y0 + i * lh)) for i, ln in enumerate(C["lines"])]
        l = text_layer(items)
        blur = (1 - ease_out(p)) * 12
        if blur > 0.5:
            l = l.filter(ImageFilter.GaussianBlur(blur))
        base.alpha_composite(with_alpha(l, ease_out(prog(t, hit, hit + 0.25))))
    q = ease_out(prog(t, 1.2, 1.8))
    if q > 0:
        tag = text_layer([(C["tag"], font("semi", 28), (150, 156, 170, 255), (W / 2, H - 150))])
        base.alpha_composite(with_alpha(tag, q))
    # hit flash
    if hit <= t < hit + 0.15:
        fl = Image.new("RGBA", (W, H), (255, 255, 255, int(70 * (1 - (t - hit) / 0.15))))
        base.alpha_composite(fl)
    arr = np.asarray(base.convert("RGB"), np.float32) + grain(0, 3)
    k = 1 - prog(t, 7.2, 8.0)
    return Image.fromarray(np.clip(arr * k, 0, 255).astype(np.uint8))
