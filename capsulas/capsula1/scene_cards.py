"""S5 (alert), S7 (freeze + statistic), S8 (final card)."""
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


# ------------------------------------------------------------------ S5
@lru_cache(maxsize=1)
def last_chat_frame():
    from scene_chat import s4_frame
    return s4_frame(TL.DUR["s4_chat_libro"] - 1 / 30)


def s5_frame(t):
    A = TL.PLAN["alerta"]
    base = Image.new("RGBA", (W, H), (6, 6, 8, 255))
    # glitchy remnant of the chat (first 0.25 s)
    if t < 0.28:
        src = np.asarray(last_chat_frame(), np.float32)
        k = 1 - t / 0.28
        r = np.roll(src[..., 0], 18, axis=1)
        b = np.roll(src[..., 2], -18, axis=1)
        g = src[..., 1]
        arr = np.stack([r, g, b], -1) * k * 0.8
        rng = np.random.default_rng(int(t * 100))
        for _ in range(8):
            y = int(rng.integers(0, H - 40))
            hgt = int(rng.integers(6, 40))
            arr[y:y + hgt] = np.roll(arr[y:y + hgt], int(rng.integers(-80, 80)), axis=1)
        base = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")
    glow = radial(W, H, W / 2, H / 2 - 40, 700, RED, amax=int(60 * ease_out(prog(t, 0.1, 0.6))), power=2.0)
    base.alpha_composite(glow)
    # warning icon with a pop
    p = prog(t, 0.12, 0.45)
    if p > 0:
        sc = 1 + 0.25 * math.sin(p * math.pi) * (1 - p) * 2
        size = int(190 * sc)
        e = emoji_img("⚠️"[0], 190).resize((size, int(size * 0.88)), Image.LANCZOS)
        base.alpha_composite(with_alpha(e, ease_out(p)), (W // 2 - e.width // 2, 230 - (e.height - 167) // 2))
    a1 = ease_out(prog(t, 0.45, 0.9))
    if a1 > 0:
        l1 = text_layer([(A["line1"], font("d_bold", 96), (255, 255, 255, 255), (W / 2, 470))])
        base.alpha_composite(offset(with_alpha(l1, a1), 24 * (1 - a1)))
    a2 = ease_out(prog(t, 1.5, 2.0))
    if a2 > 0:
        l2 = text_layer([(A["line2"], font("d_semi", 72), RED + (255,), (W / 2, 610))])
        base.alpha_composite(offset(with_alpha(l2, a2), 24 * (1 - a2)))
    arr = np.asarray(base.convert("RGB"), np.float32) + grain(0, 3)
    k = 1 - prog(t, 5.6, 6.0)
    return Image.fromarray(np.clip(arr * k, 0, 255).astype(np.uint8))


# ------------------------------------------------------------------ S7
@lru_cache(maxsize=1)
def freeze_src():
    from scene_desk import s6_frame
    return s6_frame(TL.DUR["s6_prueba"] - 1 / 30)


@lru_cache(maxsize=1)
def freeze_treated():
    src = freeze_src()
    g = ImageEnhance.Color(src).enhance(0.0)
    g = g.filter(ImageFilter.GaussianBlur(7))
    arr = np.asarray(g, np.float32) * 0.28
    arr[..., 2] *= 1.12
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def s7_frame(t):
    D = TL.PLAN["dato"]
    x = ease_in_out(prog(t, 0.05, 0.7))
    src = freeze_src()
    tr = freeze_treated()
    base = Image.blend(src, tr, x).convert("RGBA")
    # freeze flash
    if t < 0.12:
        fl = Image.new("RGBA", (W, H), (255, 255, 255, int(120 * (1 - t / 0.12))))
        base.alpha_composite(fl)
    f_pre = font("d_med", 60)
    a = ease_out(prog(t, 0.7, 1.2))
    if a > 0:
        l = text_layer([(D["pre"][0], f_pre, (235, 237, 242, 255), (W / 2, 180)),
                        (D["pre"][1], f_pre, (235, 237, 242, 255), (W / 2, 258))])
        base.alpha_composite(offset(with_alpha(l, a), 20 * (1 - a)))
    b = prog(t, 1.4, 2.6)
    if b > 0:
        n = int(round(D["number"] * ease_out(b)))
        txt = f"{n}{D['big_suffix']}"
        fb = font("d_black", 230)
        sc = 1 + 0.06 * (1 - ease_out(prog(t, 2.5, 2.9))) * (t > 2.5)
        l = text_layer([(txt, fb, RED + (255,), (W / 2, 345))])
        base.alpha_composite(with_alpha(l, ease_out(prog(t, 1.4, 1.7))))
    c = ease_out(prog(t, 2.8, 3.3))
    if c > 0:
        l = text_layer([(D["post"], f_pre, (235, 237, 242, 255), (W / 2, 640))])
        base.alpha_composite(offset(with_alpha(l, c), 20 * (1 - c)))
    s = ease_out(prog(t, 3.6, 4.1))
    if s > 0:
        l = text_layer([(D["source"], font("ital", 32), (170, 175, 186, 255), (W / 2, 790))])
        base.alpha_composite(with_alpha(l, s))
    arr = np.asarray(base.convert("RGB"), np.float32) + grain(0, 3)
    k = 1 - prog(t, 9.55, 10.0)
    return Image.fromarray(np.clip(arr * k, 0, 255).astype(np.uint8))


# ------------------------------------------------------------------ S8
@lru_cache(maxsize=1)
def s8_bg():
    yy = np.linspace(0, 1, H)[:, None, None]
    top = np.array([10, 12, 22], np.float32)
    bot = np.array([4, 5, 9], np.float32)
    arr = (top * (1 - yy) + bot * yy) * np.ones((1, W, 1), np.float32)
    im = Image.fromarray(arr.astype(np.uint8)).convert("RGBA")
    im.alpha_composite(radial(W, H, W / 2, H / 2, 900, (60, 90, 200), amax=50, power=2.2))
    return im


def s8_frame(t):
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
