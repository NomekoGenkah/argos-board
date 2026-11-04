"""S1: school yard, late afternoon. Seen from above: Benja and Tomás argue (their long shadows
gesticulate), then Tomás turns and walks out of frame."""
import math
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import W, H, prog, ease_in_out, ease_out, lerp, camera
from gfx import smooth_noise, to_img, cache_png, time_label, fade, place
from people import BENJA, TOMAS, person_top, paste_person, cast_shadow
import timeline as TL

K = 2
CW, CH = W * K, H * K
SUN = (0.72, 0.69)
B_POS = (860, 600)
T_POS = (1062, 556)


def patio_canvas():
    def build():
        rng = np.random.default_rng(3)
        n1 = smooth_noise(CW, CH, 30, 1)
        n2 = smooth_noise(CW, CH, 420, 2)
        fine = rng.normal(0, 1, (CH, CW)).astype(np.float32)
        base = np.array((178, 171, 158), np.float32)
        arr = base[None, None] * (0.86 + 0.09 * n1 + 0.1 * n2)[..., None] + fine[..., None] * 5
        im = to_img(arr).convert("RGBA")
        d = ImageDraw.Draw(im)
        # slab joints
        for x in range(-200 * K, CW, 600 * K):
            d.line((x + 300 * K, 0, x + 300 * K, CH), fill=(128, 122, 112), width=3 * K)
        for y in range(140 * K, CH, 600 * K):
            d.line((0, y, CW, y), fill=(128, 122, 112), width=3 * K)
        # cracks
        for _ in range(9):
            x, y = rng.uniform(0, CW), rng.uniform(0, CH)
            pts = [(x, y)]
            a = rng.uniform(0, 2 * math.pi)
            for _ in range(rng.integers(6, 14)):
                a += rng.normal(0, 0.5)
                x += math.cos(a) * rng.uniform(20, 60) * K
                y += math.sin(a) * rng.uniform(20, 60) * K
                pts.append((x, y))
            d.line(pts, fill=(118, 112, 102), width=2 * K)
        # painted court lines (worn yellow)
        paint = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        pd = ImageDraw.Draw(paint)
        yellow = (228, 188, 64, 255)
        pd.line((0, 880 * K, CW, 880 * K), fill=yellow, width=16 * K)
        pd.arc((1150 * K, 300 * K, 2550 * K, 1700 * K), 160, 290, fill=yellow, width=16 * K)
        pd.line((0, 240 * K, 520 * K, 240 * K), fill=(236, 236, 230, 255), width=14 * K)
        wear = smooth_noise(CW, CH, 14, 9) * 0.6 + smooth_noise(CW, CH, 90, 10) * 0.4
        a = np.asarray(paint.split()[3], np.float32) * np.clip((wear - 0.22) * 2.2, 0, 1) * 0.85
        paint.putalpha(Image.fromarray(a.astype(np.uint8)))
        im.alpha_composite(paint)
        # drain grate
        gx, gy = 260 * K, 960 * K
        d.rectangle((gx, gy, gx + 150 * K, gy + 60 * K), fill=(70, 70, 72))
        for i in range(9):
            d.rectangle((gx + (8 + i * 16) * K, gy + 8 * K, gx + (14 + i * 16) * K, gy + 52 * K), fill=(25, 25, 28))
        # leaves
        for _ in range(26):
            leaf = Image.new("RGBA", (40 * K, 22 * K), (0, 0, 0, 0))
            c = [(150, 96, 40), (178, 128, 48), (120, 92, 50), (160, 70, 40)][int(rng.integers(0, 4))]
            ImageDraw.Draw(leaf).ellipse((0, 0, 40 * K - 1, 22 * K - 1), fill=c + (255,))
            ImageDraw.Draw(leaf).line((2 * K, 11 * K, 38 * K, 11 * K), fill=tuple(int(v * 0.7) for v in c) + (255,), width=K)
            place(im, leaf, (rng.uniform(0, CW), rng.uniform(0, CH)), rng.uniform(0, 360), shadow=(3 * K, 3 * K, 2 * K, 0.4))
        # bench at the top-right edge (seen from above: wooden slats + metal legs)
        bx, by = 1340 * K, -10 * K
        for i in range(4):
            d.rectangle((bx, by + i * 34 * K, bx + 520 * K, by + i * 34 * K + 26 * K), fill=(126, 84, 50))
        rgb = np.asarray(im.convert("RGB"), np.float32)
        # dappled tree shadow, top-left
        leaves = smooth_noise(CW, CH, 26, 31) * 0.6 + smooth_noise(CW, CH, 70, 32) * 0.4
        yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
        region = np.clip(1.25 - np.sqrt((xx / CW) ** 2 * 1.4 + (yy / CH) ** 2 * 2.2) * 1.6, 0, 1)
        sh = np.clip((leaves - 0.42) * 6, 0, 1) * region
        sh = np.asarray(to_img(sh * 255).filter(ImageFilter.GaussianBlur(9 * K)), np.float32) / 255
        rgb *= (1 - 0.42 * sh)[..., None]
        # golden-hour grade + vignette
        rgb *= np.array((1.07, 0.95, 0.80), np.float32)
        warm = np.exp(-(((xx - 0.2 * CW) / CW) ** 2 + ((yy - 0.1 * CH) / CH) ** 2) * 1.1)
        rgb *= (0.86 + 0.22 * warm)[..., None]
        v = 1 - 0.38 * np.clip(np.sqrt(((xx - CW / 2) / (CW / 2)) ** 2 * 0.8 + ((yy - CH / 2) / (CH / 2)) ** 2) / 1.25, 0, 1) ** 2.2
        rgb *= v[..., None]
        return to_img(rgb)
    return cache_png("cache_patio.png", build)


@lru_cache(maxsize=1)
def canvas():
    return patio_canvas()


def window(t, a, b, ramp=0.25):
    return min(prog(t, a - ramp, a + ramp), 1 - prog(t, b - ramp, b + ramp))


def gesture(t, turns, seed):
    g = max(window(t, a, b) for a, b in turns)
    ar = 14 + 85 * g * (0.55 + 0.45 * math.sin(t * 5.1 + seed))
    al = 10 + 45 * g * (0.5 + 0.5 * math.sin(t * 3.7 + seed * 2))
    er = 35 * g * (0.5 + 0.5 * math.sin(t * 4.3 + seed))
    return dict(arm_l=al, arm_r=ar, elbow_l=10 * g, elbow_r=er), g


T_TURNS = [(0.3, 1.9), (3.0, 4.4)]
B_TURNS = [(1.9, 3.0), (4.4, 5.5)]


def s1_frame(t):
    T = TL.S1
    cv = canvas().copy().convert("RGBA")
    # --- Benja
    bp, bg = gesture(t, B_TURNS, 0.7)
    if t > 5.6:
        k = prog(t, 5.6, 6.4)
        bp = {key: lerp(v, 8.0 if "arm" in key else 0.0, k) for key, v in bp.items()}
    b_face = 8 - 14 * prog(t, 6.2, 8.0)          # follows Tomás a little, then lowers
    # --- Tomás
    tp, tg = gesture(t, T_TURNS, 2.1)
    turn = ease_in_out(prog(t, *T["turn"]))
    t_face = 188 - 118 * turn
    wk = max(0.0, t - T["walk"][0])
    speed = 0.0 if wk <= 0 else min(1.0, wk / 0.5) * 235
    dist = 0.0
    if wk > 0:
        dist = 235 * (wk - 0.25) if wk > 0.5 else 235 * wk * wk
    a = math.radians(70)
    tpos = (T_POS[0] + math.cos(a) * dist, T_POS[1] - math.sin(a) * dist)
    step = wk * 2 * math.pi * 1.9 if wk > 0 else None
    if t > T["turn"][0]:
        tp = {key: lerp(v, 6.0 if "arm" in key else 0.0, turn) for key, v in tp.items()}
    if step is not None:
        tp["walk"] = step
    # shadows first (on the ground), then bodies
    cast_shadow(cv, (B_POS[0] * K, B_POS[1] * K), K, SUN, 2.35, 0.55, 2 * K, **bp)
    cast_shadow(cv, (tpos[0] * K, tpos[1] * K), K, SUN, 2.35, 0.55, 2 * K, **tp)
    reach_b = (math.sin(math.radians(bp["arm_l"])) * 0.9, math.sin(math.radians(bp["arm_r"])) * 0.9)
    reach_t = (math.sin(math.radians(tp["arm_l"])) * 0.9, math.sin(math.radians(tp["arm_r"])) * 0.9)
    paste_person(cv, person_top(BENJA, K, b_face, reach=reach_b, spread=(0.2, 0.4 * bg),
                                head_turn=6 * math.sin(t * 2.3) * bg), (B_POS[0] * K, B_POS[1] * K))
    paste_person(cv, person_top(TOMAS, K, t_face, reach=reach_t, spread=(0.3 * tg, 0.5 * tg), step=step,
                                head_turn=8 * math.sin(t * 2.9) * tg), (tpos[0] * K, tpos[1] * K))
    # camera: slow push, then towards Benja
    x = ease_in_out(prog(t, 6.0, 10.0))
    s = lerp(1.55 + 0.08 * prog(t, 0, 6), 1.95, x)
    cx = lerp(1030 * K, B_POS[0] * K + 170 * K, x)
    cy = lerp(700 * K, B_POS[1] * K + 130 * K, x)
    fr = camera(cv.convert("RGB"), s, cx, cy)
    fr = time_label(fr, TL.PLAN["labels"]["patio"], ease_out(prog(t, 0.4, 1.2)) * (1 - prog(t, 8.6, 9.2)))
    return fade(fr, prog(t, 0, 0.5) * (1 - prog(t, 9.4, 10.0)))
