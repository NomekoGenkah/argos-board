"""S1: 07:42, Benja walks to school with headphones (street seen from above).
Also provides the blurred school-gate background used behind the phone in S3/S5."""
import math
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import W, H, font, rrect, circle, prog, ease_in_out, ease_out, lerp, camera
from gfx import smooth_noise, to_img, cache_png, time_label, fade, place, cam_view
from people import BENJA_CALLE, MARTINA, TRANSEUNTE, person_top, paste_person, cast_shadow
import timeline as TL

K = 2
SW1, SH1 = 3200, 1080            # street canvas in 1x units
CW, CH = SW1 * K, SH1 * K
SUN = (-0.78, -0.42)             # morning sun: shadows fall to the upper left
WALK_Y = 590
GATE_X = 2880


def R(*v):
    return tuple(int(x * K) for x in v)


def car(w, h, body):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), int(h * 0.32), fill=body)
    dark = (30, 36, 46, 255)
    d.rounded_rectangle((int(w * 0.18), int(h * 0.12), int(w * 0.36), int(h * 0.88)), int(h * 0.12), fill=dark)
    d.rounded_rectangle((int(w * 0.66), int(h * 0.14), int(w * 0.80), int(h * 0.86)), int(h * 0.12), fill=dark)
    d.rounded_rectangle((int(w * 0.38), int(h * 0.08), int(w * 0.64), int(h * 0.92)), int(h * 0.14), fill=tuple(min(255, int(c * 1.08)) for c in body[:3]) + (255,))
    for y in (int(h * 0.02), int(h * 0.88)):
        d.rectangle((int(w * 0.92), y, int(w * 0.98), y + int(h * 0.1)), fill=(250, 240, 200, 255))
    return im


def tree(r, seed):
    rng = np.random.default_rng(seed)
    im = Image.new("RGBA", (2 * r, 2 * r), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for _ in range(26):
        a, rr = rng.uniform(0, 2 * math.pi), rng.uniform(0, r * 0.55)
        cr = rng.uniform(r * 0.28, r * 0.45)
        cx, cy = r + rr * math.cos(a), r + rr * math.sin(a)
        g = int(rng.uniform(95, 140))
        d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill=(int(g * 0.45), g, int(g * 0.45), 255))
    for _ in range(18):
        a, rr = rng.uniform(0, 2 * math.pi), rng.uniform(0, r * 0.6)
        cr = rng.uniform(r * 0.08, r * 0.16)
        cx, cy = r + rr * math.cos(a) + r * 0.08, r + rr * math.sin(a) + r * 0.08
        d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill=(120, 170, 90, 255))
    return im


def street_canvas():
    def build():
        rng = np.random.default_rng(5)
        yy = np.arange(CH)[:, None] / K
        arr = np.zeros((CH, CW, 3), np.float32)
        n = smooth_noise(CW, CH, 24, 3)[..., None]
        road = (yy < 380)[..., None]
        arr += road * (np.array((62, 64, 68)) * (0.9 + 0.15 * n))
        curb = ((yy >= 380) & (yy < 410))[..., None]
        arr += curb * np.array((196, 194, 188)) * (0.95 + 0.05 * n)
        side = ((yy >= 410) & (yy < 760))[..., None]
        arr += side * (np.array((200, 194, 182)) * (0.965 + 0.035 * n))
        arr += side * rng.normal(0, 3.0, (CH, CW, 1))
        garden = (yy >= 760)[..., None]
        arr += garden * (np.array((96, 128, 74)) * (0.85 + 0.2 * smooth_noise(CW, CH, 60, 9)[..., None]))
        im = to_img(arr).convert("RGBA")
        d = ImageDraw.Draw(im)
        # sidewalk tiles
        for x in range(0, SW1, 70):
            d.line(R(x, 410, x, 760), fill=(170, 164, 152), width=K)
        for y in range(410, 760, 70):
            d.line(R(0, y, SW1, y), fill=(170, 164, 152), width=K)
        # road markings + crosswalk
        for x in range(0, SW1, 160):
            d.rectangle(R(x, 186, x + 90, 194), fill=(232, 230, 220))
        for i in range(8):
            d.rectangle(R(1400 + i * 0, 20 + i * 45, 1580, 48 + i * 45), fill=(232, 230, 220))
        # house walls + gates along the gardens, school wall at the right
        for x0 in range(0, 2600, 520):
            d.rectangle(R(x0, 760, x0 + 470, 786), fill=(176, 150, 120))
            d.rectangle(R(x0 + 470, 760, x0 + 520, 786), fill=(90, 92, 96))
        d.rectangle(R(2600, 760, SW1, 800), fill=(214, 206, 188))
        d.rectangle(R(GATE_X - 100, 760, GATE_X + 100, 800), fill=(180, 176, 168))
        for x in range(GATE_X - 96, GATE_X + 100, 16):
            d.line(R(x, 762, x, 798), fill=(70, 74, 80), width=2 * K)
        d.rectangle(R(GATE_X - 100, 800, GATE_X + 100, SH1), fill=(190, 186, 176))
        d.rectangle(R(2600, 800, GATE_X - 100, SH1), fill=(150, 160, 120))
        d.rectangle(R(GATE_X + 100, 800, SW1, SH1), fill=(150, 160, 120))
        sign = rrect(300 * K, 64 * K, 8 * K, (30, 60, 110, 255)).copy()
        ImageDraw.Draw(sign).text((24 * K, 10 * K), "COLEGIO", font=font("d_bold", 36 * K), fill=(240, 240, 245))
        place(im, sign, (2700 * K, 742 * K), 0, shadow=(-6 * K, -4 * K, 4 * K, 0.4))
        # parked cars
        for x, col in ((260, (190, 60, 50)), (880, (220, 220, 225)), (2060, (60, 90, 150)), (2500, (90, 96, 100))):
            place(im, car(300 * K, 140 * K, col + (255,)), (x * K, 320 * K), 0, shadow=(-10 * K, -6 * K, 8 * K, 0.5))
        # trees (canopies overhang the sidewalk)
        for i, x in enumerate((620, 1500, 2350)):
            d.ellipse(R(x - 30, 420, x + 30, 466), fill=(110, 84, 60))
            place(im, tree(160 * K, i + 3), (x * K, 420 * K), 0, shadow=(-34 * K, -20 * K, 16 * K, 0.5))
        # garden plants
        for _ in range(40):
            x, y = rng.uniform(0, 2600), rng.uniform(810, 1070)
            place(im, circle(int(rng.uniform(40, 90) * K), (70, int(rng.uniform(110, 150)), 64, 255)), (x * K, y * K), 0,
                  shadow=(-6 * K, -4 * K, 6 * K, 0.4))
        rgb = np.asarray(im.convert("RGB"), np.float32) * np.array((1.03, 0.99, 0.93), np.float32)
        return to_img(rgb)
    return cache_png("cache_street.png", build)


@lru_cache(maxsize=1)
def canvas():
    return street_canvas()


def benja_x(t):
    w0, w1 = TL.S1["walk"]
    v = 225.0
    if t <= w1 - 0.6:
        return 520 + v * (t - w0)
    # slows down and stops
    base = 520 + v * (w1 - 0.6 - w0)
    x = prog(t, w1 - 0.6, w1)
    return base + v * 0.6 * (x - x * x / 2)


def walkers(t):
    out = []
    for i, (x0, y0, v) in enumerate(((1700, 520, 190), (2050, 660, 205))):
        x = x0 + v * t
        out.append((TRANSEUNTE[i], x, y0, t * 2 * math.pi * 1.9 + i))
    return out


def s1_frame(t):
    T = TL.S1
    cv = canvas().copy().convert("RGBA")
    # a car passing on the road
    cx_car = 3300 - 900 * max(0.0, t - 1.0)
    if -400 < cx_car < 3600:
        place(cv, car(300 * K, 140 * K, (230, 200, 70, 255)).rotate(180), (cx_car * K, 110 * K), 0, shadow=(-10 * K, -6 * K, 8 * K, 0.5))
    for look, x, y, ph in walkers(t):
        cast_shadow(cv, (x * K, y * K), K * 0.9, SUN, 1.5, 0.4, 2 * K, walk=ph)
        paste_person(cv, person_top(look, 0.9 * K, 0, step=ph), (x * K, y * K))
    bx = benja_x(t)
    walking = t < T["walk"][1]
    step = t * 2 * math.pi * 2.0 if walking else None
    phone = ease_out(prog(t, T["buzz"] + 0.3, T["buzz"] + 1.0))
    cast_shadow(cv, (bx * K, WALK_Y * K), K * 0.95, SUN, 1.5, 0.42, 2 * K,
                walk=step, arm_l=10 + 50 * phone, arm_r=10 + 50 * phone, elbow_l=40 * phone, elbow_r=40 * phone)
    b = person_top(BENJA_CALLE, 0.95 * K, 0, step=step, reach=(0.55 * phone, 0.55 * phone), spread=(-0.3 * phone, -0.3 * phone))
    paste_person(cv, b, (bx * K, WALK_Y * K))
    if phone > 0:
        ph = rrect(26 * K, 50 * K, 6 * K, (20, 22, 28, 255)).copy()
        ImageDraw.Draw(ph).rounded_rectangle((3 * K, 3 * K, 23 * K, 47 * K), 5 * K, fill=(150, 190, 255, int(255 * phone)))
        place(cv, ph.rotate(90, expand=True), ((bx + 60 * phone) * K, WALK_Y * K), 0, shadow=(-3 * K, -2 * K, 3 * K, 0.4))
    view = lerp(1450, 1250, ease_in_out(prog(t, 5.5, 8.0))) * K
    camx = lerp(bx + 220, bx + 80, ease_in_out(prog(t, 5.5, 8.0))) * K
    fr = cam_view(cv.convert("RGB"), view, camx, 560 * K)
    fr = time_label(fr, TL.PLAN["labels"]["camino"], ease_out(prog(t, 0.3, 1.0)) * (1 - prog(t, 6.6, 7.2)))
    return fade(fr, prog(t, 0, 0.45) * (1 - prog(t, 7.6, 8.0)))


# ------------------------------------------------------------------ blurred gate behind the phone (S3, S5)
def gate_background(t, with_martina=True, martina_walk=None, dim=0.5):
    box = R(2280, 300, 3200, 820)
    reg = canvas().crop(box).convert("RGBA")
    if with_martina and martina_walk:
        a, b = martina_walk
        x = prog(t, a, b)
        # along the sidewalk, then turns into the school gate
        if x < 0.65:
            px, py, face = lerp(2250, GATE_X, x / 0.65), WALK_Y, 0
        else:
            k = (x - 0.65) / 0.35
            px, py, face = GATE_X, lerp(WALK_Y, 900, k), lerp(0, -90, min(1, k * 3))
        if a <= t <= b + 0.1:
            m = person_top(MARTINA, 1.0 * K, face, step=t * 2 * math.pi * 1.8)
            reg.alpha_composite(m, (int(px * K - box[0] - m.width / 2), int(py * K - box[1] - m.height / 2)))
    small = reg.convert("RGB").resize((480, 270), Image.BILINEAR).filter(ImageFilter.GaussianBlur(5))
    bg = small.resize((W, H), Image.BICUBIC)
    arr = np.asarray(bg, np.float32) * dim
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
