"""S4: school corridor seen from above. Martina walks by; two classmates look at a phone and laugh
when they see her; she checks her own phone, stops (the world goes quiet), and walks away fast.
Her reaction is told only through movement, sound and framing: no image is ever shown."""
import math
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import W, H, font, rrect, circle, prog, ease_in_out, ease_out, ease_in, lerp, drop_shadow
from gfx import smooth_noise, to_img, cache_png, fade, place, cam_view
from people import MARTINA, ALUMNO_A, ALUMNO_B, TRANSEUNTE, person_top
import timeline as TL

K = 2
CW1, CH1 = 2600, 1080
CW, CH = CW1 * K, CH1 * K
WALK_Y = 500
DUO = ((1250, 790), (1335, 770))


def R(*v):
    return tuple(int(x * K) for x in v)


def corridor_canvas():
    def build():
        yy, xx = np.mgrid[0:CH, 0:CW]
        size = 80 * K
        chk = ((xx // size + yy // size) % 2).astype(np.float32)[..., None]
        arr = np.array((214, 210, 200), np.float32) * (1 - chk) + np.array((196, 192, 182), np.float32) * chk
        arr *= (0.95 + 0.06 * smooth_noise(CW, CH, 50, 4))[..., None]
        arr[((xx % size) < K) | ((yy % size) < K)] *= 0.9
        im = to_img(arr).convert("RGBA")
        d = ImageDraw.Draw(im)
        # top wall with windows (outside: courtyard)
        d.rectangle(R(0, 0, CW1, 96), fill=(118, 150, 96))
        d.rectangle(R(0, 96, CW1, 128), fill=(92, 90, 88))
        for x in range(120, CW1, 420):
            d.rectangle(R(x, 104, x + 260, 120), fill=(170, 205, 230))
        # bottom wall with classroom doors
        d.rectangle(R(0, 900, CW1, 932), fill=(92, 90, 88))
        d.rectangle(R(0, 932, CW1, CH1), fill=(150, 130, 104))
        for i, x in enumerate(range(260, CW1, 640)):
            d.rectangle(R(x, 898, x + 140, 934), fill=(150, 130, 104))
            d.line(R(x, 916, x + 6, 1050), fill=(176, 134, 94), width=8 * K)
            sign = rrect(110 * K, 44 * K, 6 * K, (240, 236, 226, 255)).copy()
            ImageDraw.Draw(sign).text((14 * K, 6 * K), f"{i + 1}°{'AB'[i % 2]}", font=font("bold", 28 * K), fill=(40, 44, 56))
            place(im, sign, ((x + 230) * K, 870 * K), 0, shadow=(2 * K, 3 * K, 3 * K, 0.3))
        # bench and a bulletin board along the top wall
        d.rounded_rectangle(R(560, 140, 960, 196), 8 * K, fill=(150, 108, 70))
        board = rrect(360 * K, 30 * K, 4 * K, (176, 140, 96, 255)).copy()
        place(im, board, (1700 * K, 146 * K), 0, shadow=(2 * K, 4 * K, 3 * K, 0.3))
        rgb = np.asarray(im.convert("RGB"), np.float32)
        # sunlight patches from the windows, slanted
        patch = Image.new("L", (CW, CH), 0)
        pd = ImageDraw.Draw(patch)
        for x in range(120, CW1, 420):
            pd.polygon([R(x, 128)[0:2], R(x + 260, 128)[0:2], R(x + 420, 470)[0:2], R(x + 160, 470)[0:2]], fill=255)
        patch = np.asarray(patch.filter(ImageFilter.GaussianBlur(10 * K)), np.float32)[..., None] / 255
        rgb = rgb * (0.9 + 0.22 * patch) + patch * np.array((14, 10, 0), np.float32)
        return to_img(rgb)
    return cache_png("cache_corridor.png", build)


@lru_cache(maxsize=1)
def canvas():
    return corridor_canvas()


def put(cv, img, xy, shadow=True):
    if shadow:
        sh, pad = drop_shadow(img, 6 * K, 0.35)
        cv.alpha_composite(sh, (int(xy[0] - img.width / 2 - pad + 5 * K), int(xy[1] - img.height / 2 - pad + 8 * K)))
    cv.alpha_composite(img, (int(xy[0] - img.width / 2), int(xy[1] - img.height / 2)))


def phone_in_hands(cv, xy, angle, glow=1.0):
    ph = Image.new("RGBA", (34 * K, 62 * K), (0, 0, 0, 0))
    ImageDraw.Draw(ph).rounded_rectangle((0, 0, 34 * K - 1, 62 * K - 1), 8 * K, fill=(20, 22, 28, 255))
    ImageDraw.Draw(ph).rounded_rectangle((3 * K, 3 * K, 31 * K, 59 * K), 6 * K, fill=(160, 196, 255, int(255 * glow)))
    ph = ph.rotate(angle, resample=Image.BICUBIC, expand=True)
    put(cv, ph, xy)


def martina_state(t):
    T = TL.S4
    if t <= T["m_walk1"][1]:
        x = lerp(160, 1430, prog(t, *T["m_walk1"]))
        walking = True
    elif t < T["m_walk2"][0]:
        x, walking = 1430, False
    else:
        k = prog(t, *T["m_walk2"])
        x, walking = 1430 + 1350 * (k ** 1.4), True
    # slows down as she approaches the stop
    return x, walking


def s4_frame(t):
    T = TL.S4
    cv = canvas().copy().convert("RGBA")
    # a pair of students far left, chatting, not involved
    for i, (x, y, f) in enumerate(((430, 800, 70), (500, 790, 120))):
        put(cv, person_top(TRANSEUNTE[i], 0.9 * K, f, head_turn=8 * math.sin(t * 1.3 + i)), (x * K, y * K))
    # the duo: look at a phone, then at her, laughing
    mx, walking = martina_state(t)
    laugh = prog(t, T["laugh"][0], T["laugh"][0] + 0.4) * (1 - prog(t, T["laugh"][1] + 1.5, T["laugh"][1] + 2.5))
    toward = []
    for (dx, dy) in DUO:
        ang = math.degrees(math.atan2(-(WALK_Y - dy), mx - dx))
        toward.append(ang)
    shake = math.sin(t * 22) * 3 * laugh
    a_face = lerp(55, toward[0], 0.75 * laugh)
    b_face = lerp(125, toward[1], 0.75 * laugh)
    put(cv, person_top(ALUMNO_A, 0.95 * K, a_face, reach=(0.5, 0.55), head_turn=10 * laugh),
        ((DUO[0][0] + shake) * K, (DUO[0][1] - abs(shake)) * K))
    put(cv, person_top(ALUMNO_B, 0.95 * K, b_face, reach=(0.15, 0.2), head_turn=-10 * laugh),
        ((DUO[1][0] - shake) * K, (DUO[1][1] - abs(shake)) * K))
    pa = math.radians(a_face)
    phone_in_hands(cv, ((DUO[0][0] + 62 * math.cos(pa)) * K, (DUO[0][1] - 62 * math.sin(pa)) * K), a_face - 90)
    # Martina
    phone = ease_out(prog(t, *T["phone"]))
    look_back = ease_in_out(prog(t, T["look"][1] - 0.4, T["look"][1])) * (1 - ease_in_out(prog(t, T["m_walk2"][0] + 0.4, T["m_walk2"][0] + 0.9)))
    step = t * 2 * math.pi * (1.8 if t < T["m_walk1"][1] else 2.6) if walking else None
    head_down = ease_in_out(prog(t, T["look"][0], T["look"][0] + 0.6)) * (1 - look_back)
    m = person_top(MARTINA, 0.95 * K, 0, step=step, reach=(0.55 * phone, 0.55 * phone), spread=(-0.3 * phone, -0.3 * phone),
                   head_turn=55 * look_back)
    put(cv, m, (mx * K, WALK_Y * K))
    if phone > 0:
        phone_in_hands(cv, ((mx + 64) * K, WALK_Y * K), -90, glow=phone)
    # camera follows her, then lets her go
    camx = min(max(mx + 60, 900), 1750)
    fr = cam_view(cv.convert("RGB"), 1560 * K, camx * K, 560 * K)
    # when she reads: the world closes in around her (vignette), then releases
    q = ease_in_out(prog(t, T["look"][0], T["look"][0] + 0.8)) * (1 - ease_in_out(prog(t, T["m_walk2"][0], T["m_walk2"][0] + 1.0)))
    if q > 0:
        vx0 = camx - 780
        px, py = (mx - vx0) * W / 1560, (WALK_Y - (560 - 1560 * H / W / 2)) * W / 1560
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt(((xx - px) / 760) ** 2 + ((yy - py) / 560) ** 2)
        v = 1 - 0.55 * q * np.clip(d - 0.25, 0, 1) ** 1.3
        arr = np.asarray(fr, np.float32) * v[..., None]
        gray = arr.mean(-1, keepdims=True)
        arr = arr * (1 - 0.5 * q) + gray * 0.5 * q
        fr = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return fade(fr, prog(t, 0, 0.4) * (1 - prog(t, 14.5, 15.0)))
