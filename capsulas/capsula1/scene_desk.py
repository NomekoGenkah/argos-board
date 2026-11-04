"""S1 (desk at night), S3 (fast-forward copying), S6 (the test, next day).
Top-down ("cenital") illustrated style. Big canvases are rendered at 2x and cached as PNG."""
import math
import os
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

from common import (W, H, font, rrect, circle, radial, prog, ease_in, ease_out, ease_in_out, lerp,
                    drop_shadow, camera, to_rgb, clamp)
import timeline as TL

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
K = 2                      # supersample factor for desk canvases
CW, CH = W * K, H * K


# ================================================================== generic helpers
def smooth_noise(w, h, cell, seed):
    rng = np.random.default_rng(seed)
    small = rng.random((h // cell + 3, w // cell + 3)).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w + 3 * cell, h + 3 * cell), Image.BICUBIC)
    return np.asarray(im, np.float32)[:h, :w] / 255.0


def aniso_noise(w, h, cx, cy, seed):
    rng = np.random.default_rng(seed)
    small = rng.random((h // cy + 3, w // cx + 3)).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w + 3 * cx, h + 3 * cy), Image.BICUBIC)
    return np.asarray(im, np.float32)[:h, :w] / 255.0


def wood(w, h, base, dark, seed=1, ring=0.05, warp=5.0, plank=None):
    """Long horizontal grain: anisotropic noise warps closely spaced rings."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    n1 = aniso_noise(w, h, 900, 120, seed)
    n2 = aniso_noise(w, h, 300, 6, seed + 1)
    n3 = smooth_noise(w, h, 500, seed + 2)
    g = np.sin(yy * ring + warp * n1 * 6.0) * 0.5 + 0.5
    g = g ** 4 * 0.55 + n2 * 0.30 + n3 * 0.15
    base = np.array(base, np.float32)
    dark = np.array(dark, np.float32)
    col = base[None, None] * (1 - g[..., None]) + dark[None, None] * g[..., None]
    if plank:
        for y in range(plank, h, plank):
            col[max(0, y - 2):y + 2] *= 0.6
    return col


def to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def place(canvas, img, center, angle=0.0, shadow=(14, 18, 16, 0.55)):
    """Rotate RGBA `img` by angle (deg, CCW) and paste centered at `center`, with a soft shadow."""
    rot = img.rotate(angle, resample=Image.BICUBIC, expand=True) if angle else img
    x = int(center[0] - rot.width / 2)
    y = int(center[1] - rot.height / 2)
    if shadow:
        dx, dy, blur, op = shadow
        sh, pad = drop_shadow(rot, blur=blur, opacity=op)
        canvas.alpha_composite(sh, (x - pad + dx, y - pad + dy))
    canvas.alpha_composite(rot, (x, y))
    return rot, (x, y)


def rotate_point(px, py, w, h, angle):
    """Where does point (px,py) of a w*h image end up after rotate(angle, expand=True)?"""
    a = math.radians(angle)
    cx, cy = w / 2, h / 2
    dx, dy = px - cx, py - cy
    rx = dx * math.cos(a) + dy * math.sin(a)
    ry = -dx * math.sin(a) + dy * math.cos(a)
    cos, sin = abs(math.cos(a)), abs(math.sin(a))
    nw, nh = w * cos + h * sin, w * sin + h * cos
    return nw / 2 + rx, nh / 2 + ry


def pencil_img(L, Wd, body=(242, 190, 38), facet=(214, 160, 20), ferrule=True):
    """Graphite pencil drawn horizontally, tip at the right-middle."""
    ss = 2
    L2, W2 = L * ss, Wd * ss
    im = Image.new("RGBA", (L2, W2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    er, fe, cone = int(L2 * 0.07), int(L2 * 0.06), int(L2 * 0.12)
    d.rounded_rectangle((0, 0, er + 10, W2 - 1), W2 // 3, fill=(236, 120, 130))
    d.rectangle((er, 0, er + fe, W2 - 1), fill=(190, 192, 198))
    for i in range(4):
        x = er + 6 + i * fe // 4
        d.line((x, 0, x, W2), fill=(150, 152, 158), width=2)
    bx0, bx1 = er + fe, L2 - cone
    d.rectangle((bx0, 0, bx1, W2 - 1), fill=body)
    d.rectangle((bx0, W2 // 3, bx1, 2 * W2 // 3), fill=facet)
    d.line((bx0, W2 // 3, bx1, W2 // 3), fill=tuple(int(c * 0.9) for c in facet), width=2)
    d.polygon([(bx1, 0), (L2 - 1, W2 // 2), (bx1, W2 - 1)], fill=(232, 200, 150))
    tip = int(cone * 0.35)
    d.polygon([(L2 - tip, W2 // 2 - W2 * 0.17), (L2 - 1, W2 // 2), (L2 - tip, W2 // 2 + W2 * 0.17)], fill=(60, 60, 66))
    return im.resize((L, Wd), Image.LANCZOS)


def pen_img(L, Wd):
    """Transparent ballpoint pen, tip at right-middle."""
    ss = 2
    L2, W2 = L * ss, Wd * ss
    im = Image.new("RGBA", (L2, W2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cap = int(L2 * 0.1)
    d.rounded_rectangle((0, 0, cap + 20, W2 - 1), W2 // 3, fill=(30, 64, 170))
    d.rounded_rectangle((cap, 2, L2 - int(L2 * 0.12), W2 - 3), W2 // 2, fill=(215, 222, 235, 235))
    d.rectangle((cap, W2 // 2 - 3, L2 - int(L2 * 0.14), W2 // 2 + 3), fill=(40, 80, 190))
    d.polygon([(L2 - int(L2 * 0.12), 3), (L2 - 1, W2 // 2), (L2 - int(L2 * 0.12), W2 - 3)], fill=(200, 205, 215))
    d.polygon([(L2 - 12, W2 // 2 - 4), (L2 - 1, W2 // 2), (L2 - 12, W2 // 2 + 4)], fill=(50, 50, 60))
    return im.resize((L, Wd), Image.LANCZOS)


def tool_at_tip(canvas, tool, angle, tip_xy, shadow_offset=(10, 14), lift=0.0, scale=1):
    """Paste a horizontal tool (tip at right-middle) rotated by `angle`, so its tip lands on tip_xy."""
    rot = tool.rotate(angle, resample=Image.BICUBIC, expand=True)
    tx, ty = rotate_point(tool.width - 1, tool.height / 2, tool.width, tool.height, angle)
    x, y = int(tip_xy[0] - tx), int(tip_xy[1] - ty)
    sh, pad = drop_shadow(rot, blur=int((6 + 10 * lift) * scale), opacity=0.45 - 0.15 * lift)
    so = (int(shadow_offset[0] * (1 + 2 * lift)), int(shadow_offset[1] * (1 + 2 * lift)))
    canvas.alpha_composite(sh, (x - pad + so[0], y - pad + so[1]))
    canvas.alpha_composite(rot, (x, y))


def hand_text(text, size, color, bold=False):
    f = font("hand_b" if bold else "hand", size)
    bb = f.getbbox(text)
    im = Image.new("RGBA", (int(bb[2] + 20), int(size * 1.5)), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((4, 0), text, font=f, fill=color)
    return im


def cache_png(name, builder):
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        return Image.open(path).copy()
    im = builder()
    im.save(path)
    return im


# ================================================================== NIGHT DESK (S1, S2/S4 bg)
WORKSHEET_EX = [
    "Si f(x) = 2x + 3, calcula f(4).",
    "Calcula f(−2).",
    "Determina el dominio de g(x) = √(x − 1).",
    "Encuentra los ceros de h(x) = x² − 4.",
    "Calcula la pendiente entre (0, 3) y (2, 7).",
    "Escribe la ecuación de la recta anterior.",
    "Grafica f(x) = 2x + 3.",
    "Evalúa f(0) y f(1).",
    "Resuelve 3x − 6 = 0.",
    "Factoriza x² − 4.",
    "Calcula h(3).",
    "Calcula f(g(1)).",
    "¿Es h(x) par o impar? Justifica.",
    "Determina el recorrido de h(x).",
    "Grafica g(x) y h(x) en el mismo plano.",
]


def worksheet(k):
    w, h = 620 * k, 860 * k
    im = Image.new("RGBA", (w, h), (246, 244, 238, 255))
    d = ImageDraw.Draw(im)
    m = 46 * k
    d.text((m, 40 * k), "GUÍA N°4 — FUNCIONES", font=font("d_bold", 30 * k), fill=(25, 28, 36))
    d.text((m, 84 * k), "Matemática · 3° Medio", font=font("med", 17 * k), fill=(70, 74, 84))
    d.text((m, 116 * k), "Nombre: ______________________   Fecha: _______", font=font("reg", 15 * k), fill=(70, 74, 84))
    d.line((m, 150 * k, w - m, 150 * k), fill=(40, 44, 55), width=2 * k)
    y = 172 * k
    for i, ex in enumerate(WORKSHEET_EX, 1):
        d.text((m, y), f"{i}.", font=font("semi", 15 * k), fill=(30, 33, 40))
        d.text((m + 30 * k, y), ex, font=font("reg", 15 * k), fill=(40, 44, 52))
        y += 44 * k
    d.text((w - m - 90 * k, h - 40 * k), "Prof. Soto", font=font("ital", 13 * k), fill=(120, 124, 130))
    return im


def notebook_page(k, w=640, h=820, title=True, line_gap=34, rings_left=True):
    w, h = w * k, h * k
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w, h), fill=(250, 248, 240, 255))
    for y in range(int(90 * k), h, int(line_gap * k)):
        d.line((0, y, w, y), fill=(160, 190, 225), width=max(1, k))
    d.line((92 * k, 0, 92 * k, h), fill=(230, 120, 120), width=max(1, k))
    if rings_left:
        for y in range(int(30 * k), h - int(20 * k), int(38 * k)):
            d.ellipse((-14 * k, y, 22 * k, y + 22 * k), outline=(70, 72, 78), width=4 * k)
            d.ellipse((30 * k, y + 6 * k, 40 * k, y + 16 * k), fill=(40, 40, 44))
    if title:
        d.text((110 * k, 34 * k), "Guía 4 — Funciones", font=font("hand_b", 40 * k), fill=(30, 55, 140))
        d.text((w - 130 * k, 42 * k), "20/10", font=font("hand", 30 * k), fill=(30, 55, 140))
    return im


def phone_top(k, on):
    w, h = 210 * k, 430 * k
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    im.alpha_composite(rrect(w, h, 34 * k, (40, 42, 48, 255)))
    im.alpha_composite(rrect(w - 4 * k, h - 4 * k, 32 * k, (8, 9, 11, 255)), (2 * k, 2 * k))
    sw, sh = w - 16 * k, h - 16 * k
    if on == "chat":
        scr = Image.new("RGBA", (sw, sh), (14, 15, 18, 255))
        d = ImageDraw.Draw(scr)
        d.text((sw / 2 - 10 * k, 30 * k), "IA", font=font("bold", 14 * k), fill=(240, 240, 245))
        y = 70 * k
        for i, (side, wv, hv) in enumerate([("u", 120, 34), ("a", 150, 40), ("a", 160, 150), ("u", 140, 46), ("a", 150, 90)]):
            col = (47, 109, 246, 255) if side == "u" else (36, 39, 45, 255)
            x = sw - 10 * k - wv * k if side == "u" else 10 * k
            scr.alpha_composite(rrect(wv * k, hv * k, 12 * k, col), (int(x), int(y)))
            if side == "a":
                for j in range(int((hv - 14) // 12)):
                    d.rounded_rectangle((x + 10 * k, y + (8 + j * 12) * k, x + (wv - 16 - (j * 17) % 40) * k, y + (13 + j * 12) * k), 2 * k, fill=(150, 205, 255) if hv > 100 else (200, 200, 205))
            y += (hv + 10) * k
    elif on:
        yy = np.linspace(0, 1, sh)[:, None, None]
        top = np.array([40, 60, 140], np.float32)
        bot = np.array([120, 50, 140], np.float32)
        grad = (top * (1 - yy) + bot * yy) * np.ones((1, sw, 1))
        scr = Image.fromarray(grad.astype(np.uint8)).convert("RGBA")
        d = ImageDraw.Draw(scr)
        f = font("d_light", 64 * k)
        txt = "23:47"
        d.text((sw / 2 - f.getlength(txt) / 2, 60 * k), txt, font=f, fill=(255, 255, 255))
        f2 = font("med", 13 * k)
        dt = "martes, 20 de octubre"
        d.text((sw / 2 - f2.getlength(dt) / 2, 44 * k), dt, font=f2, fill=(235, 235, 245))
        card = rrect(sw - 24 * k, 58 * k, 14 * k, (255, 255, 255, 70))
        scr.alpha_composite(card, (12 * k, 170 * k))
        d.text((24 * k, 180 * k), "Recordatorio", font=font("semi", 11 * k), fill=(255, 255, 255))
        d.text((24 * k, 198 * k), "Entregar guía de mate · 08:00", font=font("reg", 11 * k), fill=(240, 240, 250))
    else:
        yy = np.linspace(0, 1, sh)[:, None, None]
        grad = (np.array([16, 18, 24]) * (1 - yy) + np.array([6, 6, 8]) * yy) * np.ones((1, sw, 1))
        scr = Image.fromarray(grad.astype(np.uint8)).convert("RGBA")
        ImageDraw.Draw(scr).polygon([(0, 0), (sw * 0.55, 0), (0, sh * 0.35)], fill=(40, 44, 54, 255))
    mask = rrect(sw, sh, 26 * k, (255, 255, 255, 255)).split()[3]
    im.paste(scr, (8 * k, 8 * k), mask)
    im.alpha_composite(rrect(70 * k, 18 * k, 9 * k, (0, 0, 0, 255)), (w // 2 - 35 * k, 16 * k))
    return im


def mug(k):
    d0 = 190 * k
    im = Image.new("RGBA", (d0 + 70 * k, d0), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((d0 - 20 * k, d0 // 2 - 22 * k, d0 + 60 * k, d0 // 2 + 22 * k), 20 * k, fill=(205, 70, 60))
    d.rounded_rectangle((d0 + 2 * k, d0 // 2 - 9 * k, d0 + 42 * k, d0 // 2 + 9 * k), 9 * k, fill=(0, 0, 0, 0))
    d.ellipse((0, 0, d0, d0), fill=(215, 78, 66))
    d.ellipse((14 * k, 14 * k, d0 - 14 * k, d0 - 14 * k), fill=(110, 62, 34))
    d.ellipse((40 * k, 34 * k, 90 * k, 60 * k), fill=(150, 100, 70))
    return im


def eraser(k):
    im = Image.new("RGBA", (110 * k, 50 * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, 110 * k, 50 * k), 10 * k, fill=(245, 240, 235))
    d.rectangle((30 * k, 0, 85 * k, 50 * k), fill=(40, 90, 190))
    d.text((38 * k, 14 * k), "PZ", font=font("bold", 18 * k), fill=(255, 255, 255))
    return im


def night_albedo(phone_on):
    k = K
    base = wood(CW, CH, (98, 66, 44), (54, 33, 21), seed=3, ring=0.03, warp=4.0)
    cv = to_img(base).convert("RGBA")
    place(cv, mug(k), (230 * k, 170 * k), 15, shadow=(18 * k, 22 * k, 16 * k, 0.6))
    place(cv, worksheet(k), (640 * k, 560 * k), 5, shadow=(12 * k, 16 * k, 14 * k, 0.5))
    place(cv, notebook_page(k), (1290 * k, 520 * k), -3, shadow=(12 * k, 16 * k, 14 * k, 0.5))
    place(cv, eraser(k), (1720 * k, 210 * k), -24, shadow=(8 * k, 10 * k, 8 * k, 0.5))
    tool_at_tip(cv, pencil_img(520 * k, 26 * k), 18, (1180 * k, 930 * k), (8 * k, 10 * k), scale=k)
    # charging cable
    d = ImageDraw.Draw(cv)
    pts = [(1700 + 60 * math.sin(i / 7) + i * 2, 980 + i * 6) for i in range(0, 30)]
    d.line([(x * k, y * k) for x, y in pts], fill=(225, 225, 228), width=9 * k, joint="curve")
    rot, xy = place(cv, phone_top(k, False), (1660 * k, 760 * k), 14, shadow=(14 * k, 18 * k, 14 * k, 0.6))
    return cv, xy, rot.size


def night_light(phone_on, phone_center):
    yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
    lx, ly = 720 * K, 380 * K
    d2 = ((xx - lx) ** 2 + (yy - ly) ** 2) / (1050 * K) ** 2
    warm = np.exp(-d2 * 2.2)
    L = np.empty((CH, CW, 3), np.float32)
    amb = (0.09, 0.11, 0.21)
    lamp = (1.18, 0.98, 0.72)
    for c in range(3):
        L[..., c] = amb[c] + lamp[c] * warm
    if phone_on:
        px, py = phone_center
        pd2 = ((xx - px) ** 2 + (yy - py) ** 2) / (330 * K) ** 2
        g = np.exp(-pd2 * 1.3)
        for c, v in enumerate((0.22, 0.30, 0.62)):
            L[..., c] += v * g
    return L


def night_desk_canvas(phone_on):
    def build():
        cv, xy, size = night_albedo(phone_on)
        center = (xy[0] + size[0] / 2, xy[1] + size[1] / 2)
        arr = np.asarray(cv.convert("RGB"), np.float32)
        L = night_light(phone_on, center)
        arr = arr * L
        del L
        rng = np.random.default_rng(5)
        arr += rng.normal(0, 3.0, arr.shape[:2])[..., None]
        out = to_img(arr).convert("RGBA")
        if phone_on:
            # emissive screen on top (not affected by lighting)
            scr = phone_top(K, True).rotate(14, resample=Image.BICUBIC, expand=True)
            out.alpha_composite(scr, (int(center[0] - scr.width / 2), int(center[1] - scr.height / 2)))
        return out.convert("RGB")
    return cache_png(f"cache_night_{'on' if phone_on else 'off'}.png", build)


PHONE_C = (1660 * K, 760 * K)


@lru_cache(maxsize=1)
def night_pair():
    return night_desk_canvas(False), night_desk_canvas(True)


def clock_overlay(frame, text, alpha, x=70, y=60, size=74):
    """Time stamp in a dark rounded label (readable over paper or wood)."""
    if alpha <= 0:
        return frame
    f = font("d_light", size)
    tw = f.getlength(text)
    pad_x, pad_y = 34, 16
    bw, bh = int(tw + 2 * pad_x), int(size * 1.22 + 2 * pad_y)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    lab = rrect(bw, bh, bh // 2, (8, 10, 18, 190))
    layer.alpha_composite(lab, (x, y))
    d = ImageDraw.Draw(layer)
    d.text((x + pad_x, y + pad_y - size * 0.06), text, font=f, fill=(255, 255, 255, 255))
    if alpha < 1:
        layer.putalpha(layer.split()[3].point(lambda v: int(v * alpha)))
    fr = frame.convert("RGBA")
    fr.alpha_composite(layer)
    return fr.convert("RGB")


def s1_frame(t):
    off, on = night_pair()
    lit = prog(t, 4.2, 4.5)
    # phone flickers on
    src = off if lit <= 0 else (on if lit >= 1 else Image.blend(off, on, lit))
    x = prog(t, 6.55, 8.0)
    z = ease_in(x)
    s0 = 1.0 + 0.07 * ease_in_out(prog(t, 0, 6.55))
    c0 = (lerp(CW / 2, CW / 2 + 180, prog(t, 0, 6.55)), lerp(CH / 2, CH / 2 + 90, prog(t, 0, 6.55)))
    s = lerp(s0, 5.2, z)
    cx = lerp(c0[0], PHONE_C[0], ease_out(x))
    cy = lerp(c0[1], PHONE_C[1], ease_out(x))
    fr = camera(src, s, cx, cy)
    fr = clock_overlay(fr, "23:47", ease_out(prog(t, 0.4, 1.4)) * (1 - prog(t, 6.4, 7.0)))
    fade = 1 - prog(t, 7.65, 8.0)
    fadein = prog(t, 0, 0.5)
    k = fade * fadein
    if k < 1:
        fr = Image.fromarray((np.asarray(fr, np.float32) * k).astype(np.uint8))
    return fr


# ================================================================== S3: copying, fast-forward
S3_LINE0, S3_GAP, S3_X = 168, 76, 330


@lru_cache(maxsize=1)
def s3_static():
    def build():
        base = wood(W, H, (98, 66, 44), (54, 33, 21), seed=9, ring=0.06, warp=4.0)
        cv = to_img(base).convert("RGBA")
        ws = worksheet(1).resize((620, 860))
        place(cv, ws, (-60, 420), 5, shadow=(10, 14, 12, 0.5))
        page = notebook_page(1, w=1420, h=1300, title=False, line_gap=S3_GAP)
        page = page.crop((0, 0, 1420, 1300))
        sh, pad = drop_shadow(page, 18, 0.55)
        cv.alpha_composite(sh, (250 - pad + 14, -150 - pad + 18))
        cv.alpha_composite(page, (250, -150))
        d = ImageDraw.Draw(cv)
        d.text((S3_X - 10, 40), "Guía 4 — Funciones", font=font("hand_b", 62), fill=(30, 55, 140))
        return cv.convert("RGB")
    return np.asarray(cache_png("cache_s3.png", build), np.float32)


@lru_cache(maxsize=1)
def s3_light():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d2 = ((xx - 700) ** 2 + (yy - 260) ** 2) / 1150 ** 2
    warm = np.exp(-d2 * 1.4)
    L = np.empty((H, W, 3), np.float32)
    for c, (a, l) in enumerate(zip((0.15, 0.16, 0.26), (1.12, 0.96, 0.72))):
        L[..., c] = a + l * warm
    return L


S3_PHONE_C = (1490, 575)
S3_PHONE_ANGLE = -4
S3_PHONE_SCALE = 1.12


@lru_cache(maxsize=3)
def s3_phone(clock):
    """Benja's phone resting on the notebook, showing the real chat (same list he is copying)."""
    from scene_chat import render_screen, user_block, ai_block, ai1_state, CHAT
    toks, code = ai1_state(99, 0, 1)
    scr = render_screen(clock, [user_block(CHAT["msg1_user"]), ai_block(toks, code)], "", False, 0.0)
    body = phone_top(2, False)
    sw, sh = body.width - 32, body.height - 32
    scr = scr.resize((sw, sh), Image.LANCZOS)
    body.paste(scr, (16, 16), rrect(sw, sh, 52, (255, 255, 255, 255)).split()[3])
    ph = body.resize((int(body.width * S3_PHONE_SCALE), int(body.height * S3_PHONE_SCALE)), Image.LANCZOS)
    ph = ph.rotate(S3_PHONE_ANGLE, resample=Image.BICUBIC, expand=True)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.alpha_composite(radial(W, H, S3_PHONE_C[0], S3_PHONE_C[1], 650, (90, 120, 255), amax=45, power=2.0))
    x, y = int(S3_PHONE_C[0] - ph.width / 2), int(S3_PHONE_C[1] - ph.height / 2)
    sh_, pad = drop_shadow(ph, 16, 0.65)
    layer.alpha_composite(sh_, (x - pad + 14, y - pad + 20))
    layer.alpha_composite(ph, (x, y))
    return layer


@lru_cache(maxsize=None)
def s3_line_img(i):
    return hand_text(TL.PLAN["copia_lines"][i], 64, (28, 52, 140, 255))


@lru_cache(maxsize=1)
def pen():
    return pen_img(470, 26)


def s3_frame(t):
    T = TL.S3
    cv = Image.fromarray(s3_static().astype(np.uint8)).convert("RGBA")
    tip = None
    for i, (a, b) in enumerate(T["lines"]):
        if t < a:
            break
        img = s3_line_img(i)
        f = prog(t, a, b)
        wv = int(img.width * f)
        y = S3_LINE0 + i * S3_GAP - 4
        if wv > 0:
            cv.alpha_composite(img.crop((0, 0, wv, img.height)), (S3_X, y))
        tip = (S3_X + max(wv, 4), y + 64 + 6 * math.sin(t * 47 + i))
    if tip is None:
        tip = (S3_X, S3_LINE0 + 60)
    lift = 0.0
    if t > T["write_t1"]:
        # pen is put down to the side
        x = ease_in_out(prog(t, T["drop"] - 0.15, T["drop"] + 0.25))
        last = T["lines"][-1]
        i = len(T["lines"]) - 1
        end = (S3_X + s3_line_img(i).width, S3_LINE0 + i * S3_GAP + 60)
        tip = (lerp(end[0], 1080, x), lerp(end[1], 930, x))
        lift = math.sin(x * math.pi) * 0.8
        angle = lerp(130, 100, x)
    else:
        angle = 130 + 3 * math.sin(t * 9)
    light = s3_light()
    flick = 1.0 + 0.035 * math.sin(t * 31) * (t < T["write_t1"])
    arr = np.asarray(cv.convert("RGB"), np.float32) * light * flick
    fr = to_img(arr).convert("RGBA")
    # fast-forward clock
    hh0, mm0 = 23 * 60 + 52, 24 * 60 + 38
    m = int(lerp(hh0, mm0, prog(t, 0.2, T["write_t1"])))
    clock = f"{(m // 60) % 24:02d}:{m % 60:02d}"
    fr.alpha_composite(s3_phone(clock))
    # pen on its own layer, lit like the desk, above the phone
    pl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tool_at_tip(pl, pen(), angle, tip, (12, 16), lift)
    pa = np.asarray(pl, np.float32).copy()
    pa[..., :3] = np.clip(pa[..., :3] * light * flick, 0, 255)
    fr.alpha_composite(Image.fromarray(pa.astype(np.uint8), "RGBA"))
    fr = fr.convert("RGB")
    fr = clock_overlay(fr, clock, 1.0)
    if t < T["write_t1"] + 0.2:
        if (t * 2) % 1 < 0.7:
            f = font("mono", 36)
            frr = fr.convert("RGBA")
            frr.alpha_composite(rrect(220, 86, 43, (8, 10, 18, 190)), (70, 170))
            ImageDraw.Draw(frr).text((100, 190), "▶▶ x16", font=f, fill=(255, 255, 255))
            fr = frr.convert("RGB")
    if t < 0.15:
        fr = Image.fromarray((np.asarray(fr, np.float32) * (t / 0.15)).astype(np.uint8))
    return fr


# ================================================================== S6: the test (daylight)
def test_sheet(k):
    w, h = 900 * k, 1240 * k
    im = Image.new("RGBA", (w, h), (250, 250, 247, 255))
    d = ImageDraw.Draw(im)
    m = 60 * k
    d.text((m, 48 * k), "PRUEBA DE MATEMÁTICA — FUNCIONES", font=font("d_bold", 28 * k), fill=(20, 22, 30))
    d.text((m, 98 * k), "3° Medio · Unidad 2 · Forma A", font=font("med", 20 * k), fill=(70, 74, 84))
    d.text((m, 150 * k), "Nombre:", font=font("med", 20 * k), fill=(40, 44, 52))
    d.line((m + 90 * k, 174 * k, m + 470 * k, 174 * k), fill=(90, 94, 104), width=2 * k)
    d.text((m + 500 * k, 150 * k), "Curso:", font=font("med", 20 * k), fill=(40, 44, 52))
    d.line((m + 575 * k, 174 * k, m + 680 * k, 174 * k), fill=(90, 94, 104), width=2 * k)
    d.rounded_rectangle((w - m - 150 * k, 40 * k, w - m, 120 * k), 10 * k, outline=(40, 44, 52), width=2 * k)
    d.text((w - m - 135 * k, 52 * k), "Puntaje", font=font("med", 16 * k), fill=(70, 74, 84))
    d.text((w - m - 120 * k, 76 * k), "    / 30", font=font("semi", 26 * k), fill=(40, 44, 52))
    d.rectangle((m, 200 * k, w - m, 250 * k), fill=(236, 238, 242))
    d.text((m + 16 * k, 212 * k), "Responde con desarrollo. No se permite calculadora ni celular.", font=font("ital", 18 * k), fill=(60, 64, 72))
    qs = [
        ("1.", "Sea f(x) = 2x + 3. Calcula f(4) y f(−2).", "(4 pts)", 240),
        ("2.", "Determina dominio y recorrido de g(x) = √(x − 1).", "(6 pts)", 230),
        ("3.", "Encuentra los ceros de h(x) = x² − 4 y grafícala.", "(8 pts)", 330),
    ]
    y = 290 * k
    for n, q, p, gap in qs:
        d.text((m, y), n, font=font("bold", 22 * k), fill=(20, 22, 30))
        d.text((m + 34 * k, y), q, font=font("reg", 22 * k), fill=(30, 33, 40))
        d.text((w - m - 70 * k, y + 2 * k), p, font=font("reg", 18 * k), fill=(110, 114, 122))
        d.rounded_rectangle((m + 34 * k, y + 42 * k, w - m, y + (gap - 20) * k), 8 * k, outline=(210, 212, 218), width=2 * k)
        if n == "3.":
            ox, oy = m + 480 * k, y + 60 * k
            d.line((ox, oy + 120 * k, ox + 260 * k, oy + 120 * k), fill=(150, 154, 162), width=2 * k)
            d.line((ox + 130 * k, oy, ox + 130 * k, oy + 240 * k), fill=(150, 154, 162), width=2 * k)
            for i in range(-6, 7):
                d.line((ox + 130 * k + i * 20 * k, oy + 116 * k, ox + 130 * k + i * 20 * k, oy + 124 * k), fill=(150, 154, 162), width=k)
                d.line((ox + 126 * k, oy + 120 * k + i * 20 * k, ox + 134 * k, oy + 120 * k + i * 20 * k), fill=(150, 154, 162), width=k)
        y += gap * k
    d.text((m, y), "4.", font=font("bold", 22 * k), fill=(20, 22, 30))
    d.text((m + 34 * k, y), "Calcula la pendiente de la recta que pasa por (0, 3) y (2, 7).", font=font("reg", 22 * k), fill=(30, 33, 40))
    # Benja's handwriting (static)
    d.text((m + 100 * k, 132 * k), "Benjamín", font=font("hand", 44 * k), fill=(70, 72, 80))
    d.text((m + 585 * k, 132 * k), "3°B", font=font("hand", 44 * k), fill=(70, 72, 80))
    return im


SHEET_POS = (380, 40)      # 1x top-left of sheet on desk
ANS = (SHEET_POS[0] + 60 + 34 + 20, SHEET_POS[1] + 290 + 52)   # 1x top-left of answer text


def day_albedo():
    k = K
    yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
    n = smooth_noise(CW, CH, 30, 21) * 0.5 + smooth_noise(CW, CH, 300, 22) * 0.5
    base = np.array((218, 200, 166), np.float32)
    arr = base[None, None] * (0.93 + 0.1 * n[..., None])
    cv = to_img(arr).convert("RGBA")
    d = ImageDraw.Draw(cv)
    # desk graffiti + scratches
    rng = np.random.default_rng(4)
    for _ in range(40):
        x, y = rng.uniform(0, CW), rng.uniform(0, CH)
        a = rng.uniform(0, math.pi)
        l = rng.uniform(30, 160) * k
        d.line((x, y, x + l * math.cos(a), y + l * math.sin(a)), fill=(196, 178, 144), width=k)
    d.text((1480 * k, 900 * k), "3°B", font=font("hand", 70 * k), fill=(150, 150, 170))
    d.text((150 * k, 960 * k), "nico", font=font("hand", 52 * k), fill=(160, 140, 120))
    # metal frame edge of the desk
    d.rectangle((0, CH - 26 * k, CW, CH), fill=(90, 94, 100))
    sheet = test_sheet(k)
    sh, pad = drop_shadow(sheet, 10 * k, 0.35)
    sx, sy = SHEET_POS[0] * k, SHEET_POS[1] * k
    cv.alpha_composite(sh, (sx - pad + 8 * k, sy - pad + 10 * k))
    cv.alpha_composite(sheet, (sx, sy))
    # pencil case + eraser
    case = rrect(260 * k, 110 * k, 40 * k, (40, 52, 80, 255)).copy()
    cd = ImageDraw.Draw(case)
    cd.line((20 * k, 22 * k, 240 * k, 22 * k), fill=(25, 30, 45), width=4 * k)
    cd.rounded_rectangle((180 * k, 12 * k, 214 * k, 34 * k), 6 * k, fill=(190, 190, 195))
    place(cv, case, (1530 * k, 160 * k), -8, shadow=(10 * k, 12 * k, 10 * k, 0.4))
    place(cv, eraser(k), (1460 * k, 420 * k), 30, shadow=(6 * k, 8 * k, 6 * k, 0.35))
    return cv


def day_light():
    yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
    # window from the right: blind stripes, soft
    u = (xx * 0.8 + yy * 0.6) / K
    stripes = (np.sin(u / 26.0) > 0.15).astype(np.float32)
    sm = to_img(stripes * 255).filter(ImageFilter.GaussianBlur(10 * K))
    stripes = np.asarray(sm, np.float32) / 255.0
    side = np.clip((xx / CW - 0.25) * 1.6, 0, 1)
    L = 1.0 - 0.16 * stripes * side
    L = L * (1.0 - 0.10 * (1 - xx / CW))
    cool = np.stack([L * 0.96, L * 0.985, L * 1.0], -1)
    return cool


def day_canvas():
    def build():
        cv = day_albedo()
        arr = np.asarray(cv.convert("RGB"), np.float32) * day_light()
        return to_img(arr)
    return cache_png("cache_day.png", build)


@lru_cache(maxsize=1)
def day_light_img():
    def build():
        return to_img(np.clip(day_light(), 0, 1) * 255)
    return cache_png("cache_day_light.png", build)


@lru_cache(maxsize=1)
def day_pair():
    return day_canvas(), day_light_img()


@lru_cache(maxsize=1)
def pencil_big():
    return pencil_img(560 * K, 30 * K)


ANS_TEXT = "f(4) = 2·"
DYN = (ANS[0] * K - 200 * K, 0, CW, CH)


@lru_cache(maxsize=1)
def ans_img():
    return hand_text(ANS_TEXT, 52 * K, (62, 64, 72, 255))


def s6_desk(t):
    T = TL.S6
    cv_rgb, light = day_pair()
    x0, y0, x1, y1 = [int(v) for v in DYN]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(CW, x1), min(CH, y1)
    region = cv_rgb.crop((x0, y0, x1, y1)).convert("RGBA")
    dyn = Image.new("RGBA", region.size, (0, 0, 0, 0))
    ax, ay = ANS[0] * K - x0, ANS[1] * K - y0
    img = ans_img()
    f = prog(t, *T["write"])
    wv = int(img.width * f)
    if wv > 0:
        dyn.alpha_composite(img.crop((0, 0, wv, img.height)), (int(ax), int(ay)))
    cross = prog(t, *T["cross"])
    if cross > 0:
        dd = ImageDraw.Draw(dyn)
        ex = ax + img.width * cross
        dd.line((ax - 6 * K, ay + 46 * K, ex, ay + 34 * K), fill=(62, 64, 72, 255), width=4 * K)
        if cross >= 1:
            dd.line((ax - 6 * K, ay + 30 * K, ax + img.width, ay + 50 * K), fill=(62, 64, 72, 255), width=4 * K)
    # pencil choreography
    rest = (ax + 760 * K, ay + 360 * K)
    write_tip = (ax + max(wv, 6), ay + 56 * K + 4 * K * math.sin(t * 40))
    end_tip = (ax + img.width + 8 * K, ay + 58 * K)
    lift = 0.0
    if t < T["write"][0] - 0.8:
        tip, ang = rest, 150
    elif t < T["write"][0]:
        x = ease_in_out(prog(t, T["write"][0] - 0.8, T["write"][0]))
        tip = (lerp(rest[0], ax, x), lerp(rest[1], ay + 56 * K, x))
        ang, lift = lerp(150, 125, x), math.sin(x * math.pi) * 0.7
    elif t < T["write"][1]:
        tip, ang = write_tip, 125
    elif t < T["cross"][0]:
        tip, ang = end_tip, 125 + 4 * math.sin(t * 1.3)
        for tp in T["taps"]:
            if tp - 0.12 < t < tp + 0.1:
                lift = 0.35 * (1 - abs(t - tp + 0.01) / 0.12)
        tip = (tip[0], tip[1] - lift * 18 * K)
    elif t < T["cross"][1]:
        tip = (lerp(ax - 6 * K, ax + img.width, cross), lerp(ay + 46 * K, ay + 34 * K, cross))
        ang = 125
    else:
        tip, ang = (ax + img.width + 4 * K, ay + 46 * K), 128
    tool_at_tip(dyn, pencil_big(), ang, tip, (8 * K, 12 * K), lift, scale=K)
    # light the dynamic layer like the desk
    lr = light.crop((x0, y0, x1, y1))
    rgb = ImageChops.multiply(dyn.convert("RGB"), lr)
    dyn_lit = rgb.convert("RGBA")
    dyn_lit.putalpha(dyn.split()[3])
    region.alpha_composite(dyn_lit)
    canvas = cv_rgb.copy()
    canvas.paste(region.convert("RGB"), (x0, y0))
    return canvas


def s6_frame(t):
    T = TL.S6
    if t < T["fade_in"][0]:
        frame = Image.new("RGB", (W, H), (0, 0, 0))
    else:
        canvas = s6_desk(t)
        x = ease_in_out(prog(t, T["fade_in"][0], 14.0))
        s = lerp(1.0, 1.16, x)
        cx = lerp(CW / 2, (ANS[0] + 260) * K, x)
        cy = lerp(CH / 2, (ANS[1] + 120) * K, x)
        frame = camera(canvas, s, cx, cy)
        k = ease_out(prog(t, *T["fade_in"]))
        if k < 1:
            frame = Image.fromarray((np.asarray(frame, np.float32) * k).astype(np.uint8))
    # intro text
    a = prog(t, 0.2, 0.7) * (1 - prog(t, 1.6, 2.1))
    if a > 0:
        fr = frame.convert("RGBA")
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        f = font("d_light", 84)
        txt = TL.PLAN["prueba_intro"]
        d.text((W / 2 - f.getlength(txt) / 2, H / 2 - 60), txt, font=f, fill=(255, 255, 255, int(255 * a)))
        fr.alpha_composite(layer)
        frame = fr.convert("RGB")
    return frame
