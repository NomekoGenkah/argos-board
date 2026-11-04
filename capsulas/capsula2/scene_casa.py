"""S2 (the house as a floor plan, seen from above), S5 (bedroom at night, knocks on the door)
and the bedroom close-up used by S6. Canvases are rendered at 2x and cached."""
import math
import os
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import W, H, font, rrect, circle, prog, ease_in_out, ease_out, lerp, camera, drop_shadow, radial
from gfx import (OUT, smooth_noise, to_img, planks, place, cache_png, time_label, fade, multiply)
from people import BENJA, MAMA, HERMANA, person_top, paste_person, head_side, _shade
import timeline as TL

K = 2
CW, CH = W * K, H * K
WALL = 22


def R(*v):
    return tuple(int(x * K) for x in v)


# ================================================================== floor plan
ROOMS = {
    "bano": (60, 80, 380, 470),
    "cocina": (380, 80, 1000, 470),
    "hermana": (1000, 80, 1500, 470),
    "pasillo": (60, 470, 1500, 650),
    "living": (60, 650, 1500, 1000),
    "pieza": (1500, 80, 1860, 1000),
}
WALLS = [  # (x0, y0, x1, y1) axis-aligned centre lines
    (60, 80, 1860, 80), (60, 1000, 1860, 1000), (1860, 80, 1860, 1000),
    (60, 80, 60, 500), (60, 620, 60, 1000),
    (60, 470, 180, 470), (270, 470, 560, 470), (760, 470, 1180, 470), (1270, 470, 1500, 470),
    (60, 650, 300, 650), (700, 650, 1500, 650),
    (380, 80, 380, 470), (1000, 80, 1000, 470),
    (1500, 80, 1500, 500), (1500, 620, 1500, 1000),
]
FRONT_HINGE, BENJA_HINGE = (60, 500), (1500, 500)
DOOR_LEN = 120


def tiles(w, h, a, b, size, seed=1):
    arr = np.empty((h, w, 3), np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    chk = ((xx // size + yy // size) % 2).astype(np.float32)[..., None]
    arr[:] = np.array(a, np.float32) * (1 - chk) + np.array(b, np.float32) * chk
    grout = ((xx % size) < max(2, size // 30)) | ((yy % size) < max(2, size // 30))
    arr[grout] *= 0.8
    arr *= (0.94 + 0.08 * smooth_noise(w, h, 60, seed))[..., None]
    return arr


def furniture(cv):
    d = ImageDraw.Draw(cv)
    sh = (5 * K, 7 * K, 6 * K, 0.45)

    def box(x0, y0, x1, y1, col, r=6, shadow=sh):
        img = rrect((x1 - x0) * K, (y1 - y0) * K, r * K, col + (255,))
        place(cv, img, ((x0 + x1) / 2 * K, (y0 + y1) / 2 * K), 0, shadow=shadow)
        return img
    # kitchen
    box(395, 92, 995, 160, (222, 220, 214), 4)
    d.rounded_rectangle(R(450, 102, 545, 150), 8 * K, fill=(170, 176, 182))
    d.rounded_rectangle(R(460, 110, 535, 142), 6 * K, fill=(140, 148, 156))
    d.rounded_rectangle(R(770, 98, 890, 156), 6 * K, fill=(44, 44, 48))
    for cx, cy in ((800, 115), (860, 115), (800, 140), (860, 140)):
        d.ellipse(R(cx - 14, cy - 10, cx + 14, cy + 10), outline=(90, 90, 96), width=3 * K)
    pot = circle(46 * K, (150, 152, 158, 255))
    place(cv, pot, (860 * K, 116 * K), 0, shadow=(3 * K, 4 * K, 4 * K, 0.4))
    box(915, 170, 990, 270, (238, 238, 236), 4)
    table = circle(130 * K, (150, 104, 62, 255))
    for a in (200, 320, 80):
        ch = rrect(46 * K, 46 * K, 8 * K, (110, 74, 44, 255))
        place(cv, ch, ((640 + 82 * math.cos(math.radians(a))) * K, (330 + 82 * math.sin(math.radians(a))) * K), a, shadow=sh)
    place(cv, table, (640 * K, 330 * K), 0, shadow=sh)
    d.ellipse(R(610, 300, 670, 360), fill=(232, 228, 216))
    # bathroom
    box(80, 95, 170, 150, (240, 240, 240), 20)
    d.ellipse(R(95, 160, 155, 240), fill=(244, 244, 244), outline=(200, 200, 205), width=2 * K)
    box(250, 95, 370, 220, (210, 220, 228), 4)
    d.ellipse(R(300, 145, 320, 165), fill=(150, 160, 170))
    # sister's room
    box(1300, 100, 1490, 330, (240, 236, 230), 10)
    box(1300, 100, 1490, 150, (250, 248, 244), 10, shadow=None)
    box(1300, 170, 1490, 330, (190, 120, 150), 10, shadow=None)
    box(1020, 100, 1180, 160, (170, 130, 90), 4)
    rug = circle(150 * K, (220, 200, 120, 255))
    place(cv, rug, (1180 * K, 330 * K), 0, shadow=None)
    # living
    rug = rrect(430 * K, 170 * K, 6 * K, (150, 72, 58, 255)).copy()
    ImageDraw.Draw(rug).rectangle((12 * K, 12 * K, 418 * K, 158 * K), outline=(200, 160, 110), width=3 * K)
    place(cv, rug, (430 * K, 800 * K), 0, shadow=None)
    box(150, 900, 720, 985, (96, 108, 122), 18)
    box(150, 760, 230, 985, (96, 108, 122), 18)
    box(380, 760, 520, 830, (128, 92, 60), 6)
    box(70, 700, 98, 900, (30, 30, 34), 4)
    box(1150, 760, 1400, 900, (150, 104, 62), 8)
    for cx, cy in ((1200, 740), (1340, 740), (1200, 920), (1340, 920)):
        box(cx - 24, cy - 22, cx + 24, cy + 22, (110, 74, 44), 8)
    plant = circle(90 * K, (60, 120, 70, 255))
    place(cv, plant, (1450 * K, 950 * K), 0, shadow=sh)
    # hallway
    box(90, 505, 140, 615, (110, 90, 70), 4)          # doormat
    box(300, 490, 360, 520, (70, 60, 52), 6)          # shoe rack
    # Benja's room
    box(1640, 100, 1850, 560, (60, 64, 76), 10)
    box(1650, 110, 1840, 175, (210, 212, 220), 14, shadow=None)
    box(1645, 200, 1845, 555, (40, 52, 84), 10, shadow=None)
    box(1540, 880, 1845, 985, (120, 86, 56), 4)
    nb = rrect(120 * K, 84 * K, 3 * K, (250, 248, 240, 255))
    place(cv, nb, (1640 * K, 930 * K), 8, shadow=(2 * K, 3 * K, 3 * K, 0.4))
    box(1600, 720, 1680, 800, (70, 74, 82), 12)         # backpack on the floor


def plan_albedo():
    arr = np.zeros((CH, CW, 3), np.float32)

    def fill(room, a):
        x0, y0, x1, y1 = [int(v * K) for v in ROOMS[room]]
        arr[y0:y1, x0:x1] = a[: y1 - y0, : x1 - x0]
    rw = lambda r: (int((ROOMS[r][2] - ROOMS[r][0]) * K), int((ROOMS[r][3] - ROOMS[r][1]) * K))
    w, h = rw("pasillo")
    fill("pasillo", planks(w, h, (196, 146, 100), (150, 104, 66), 34 * K, seed=2))
    w, h = rw("living")
    fill("living", planks(w, h, (180, 130, 88), (136, 94, 60), 34 * K, seed=3, vertical=True))
    w, h = rw("pieza")
    fill("pieza", planks(w, h, (170, 122, 84), (128, 88, 56), 34 * K, seed=4, vertical=True))
    w, h = rw("hermana")
    fill("hermana", planks(w, h, (200, 160, 118), (160, 122, 86), 34 * K, seed=5))
    w, h = rw("cocina")
    fill("cocina", tiles(w, h, (232, 228, 218), (196, 190, 178), 54 * K, 6))
    w, h = rw("bano")
    fill("bano", tiles(w, h, (198, 210, 216), (176, 190, 198), 30 * K, 7))
    cv = to_img(arr).convert("RGBA")
    # outside the house
    out = np.asarray(cv, np.float32)
    mask = np.zeros((CH, CW), bool)
    mask[int(80 * K):int(1000 * K), int(60 * K):int(1860 * K)] = True
    bg = np.array((54, 58, 52, 255), np.float32)
    out[~mask] = bg
    cv = Image.fromarray(out.astype(np.uint8), "RGBA")
    furniture(cv)
    d = ImageDraw.Draw(cv)
    for x0, y0, x1, y1 in WALLS:
        hw = WALL / 2
        d.rectangle(R(min(x0, x1) - hw, min(y0, y1) - hw, max(x0, x1) + hw, max(y0, y1) + hw), fill=(58, 56, 54))
    for x0, y0, x1, y1 in WALLS:
        hw = WALL / 2 - 4
        d.rectangle(R(min(x0, x1) - hw, min(y0, y1) - hw, max(x0, x1) + hw, max(y0, y1) + hw), fill=(78, 75, 72))
    # closed doors (bathroom, sister) drawn as leaves in the wall
    d.rectangle(R(180, 466, 270, 474), fill=(170, 130, 92))
    d.rectangle(R(1180, 466, 1270, 474), fill=(170, 130, 92))
    return cv


def plan_light():
    yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
    xx /= K
    yy /= K
    L = np.zeros((CH, CW, 3), np.float32)
    zones = {
        "cocina": (1.08, 1.0, 0.86), "pasillo": (0.92, 0.86, 0.76), "bano": (0.62, 0.64, 0.7),
        "hermana": (0.98, 0.88, 0.74), "living": (0.72, 0.64, 0.58), "pieza": (0.24, 0.27, 0.40),
    }
    for r, c in zones.items():
        x0, y0, x1, y1 = ROOMS[r]
        m = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        L[m] = c
    L[(xx < 60) | (xx >= 1860) | (yy < 80) | (yy >= 1000)] = (0.55, 0.6, 0.7)
    Li = to_img(np.clip(L / 1.2, 0, 1) * 255).filter(ImageFilter.GaussianBlur(14 * K))
    L = np.asarray(Li, np.float32) / 255 * 1.2
    lamp = np.exp(-(((xx - 690) / 330) ** 2 + ((yy - 275) / 260) ** 2))
    L += lamp[..., None] * np.array((0.18, 0.12, 0.02), np.float32)
    tv = np.exp(-(((xx - 160) / 140) ** 2 + ((yy - 800) / 160) ** 2))
    L += tv[..., None] * np.array((0.0, 0.12, 0.3), np.float32)
    win = np.exp(-(((xx - 1700) / 150) ** 2 + ((yy - 140) / 70) ** 2))
    L += win[..., None] * np.array((0.06, 0.1, 0.2), np.float32)
    return L


@lru_cache(maxsize=1)
def plan_assets():
    lp = os.path.join(OUT, "cache_plan_light.npy")
    if os.path.exists(lp):
        L = np.load(lp)
    else:
        L = plan_light()
        np.save(lp, L)

    def build():
        return to_img(np.asarray(plan_albedo().convert("RGB"), np.float32) * L)
    return cache_png("cache_plan.png", build), L


def lit_paste(canvas, img, center, L):
    x, y = int(center[0] - img.width / 2), int(center[1] - img.height / 2)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(canvas.width, x + img.width), min(canvas.height, y + img.height)
    if x1 <= x0 or y1 <= y0:
        return
    part = img.crop((x0 - x, y0 - y, x1 - x, y1 - y))
    canvas.alpha_composite(multiply(part, L[y0:y1, x0:x1]), (x0, y0))


def door_leaf(hinge, angle_deg, L, canvas):
    """Door leaf as a thin board from the hinge, angle measured CCW from +x."""
    a = math.radians(angle_deg)
    leaf = Image.new("RGBA", (DOOR_LEN * K * 2 + 20, DOOR_LEN * K * 2 + 20), (0, 0, 0, 0))
    c = leaf.width / 2
    d = ImageDraw.Draw(leaf)
    ex, ey = c + math.cos(a) * DOOR_LEN * K, c - math.sin(a) * DOOR_LEN * K
    d.line((c, c, ex, ey), fill=(176, 134, 94, 255), width=9 * K)
    d.ellipse((c - 5 * K, c - 5 * K, c + 5 * K, c + 5 * K), fill=(90, 90, 96, 255))
    lit_paste(canvas, leaf, (hinge[0] * K, hinge[1] * K), L)


def s2_frame(t):
    T = TL.S2
    base, L = plan_assets()
    cv = base.convert("RGBA")
    # front door closes behind him (from open into the hallway to closed along the wall)
    fd = ease_in_out(prog(t, *T["front_close"]))
    door_leaf(FRONT_HINGE, lerp(-40, -90, fd), L, cv)
    # Benja's door: open into his room, then closes (soft slam)
    bd = prog(t, *T["door_close"]) ** 2
    door_leaf(BENJA_HINGE, lerp(0, -90, bd), L, cv)
    # mum at the stove, turns her head to the hallway when she calls him
    turn = ease_in_out(prog(t, 0.7, 1.3)) * (1 - ease_in_out(prog(t, 4.2, 4.9)))
    mama = person_top(MAMA, 0.8 * K, 90 + 150 * turn, reach=(0.35, 0.3), spread=(0, 0), head_turn=-25 * turn)
    lit_paste(cv, mama, (830 * K, 205 * K), L)
    # Benja walks along the hallway into his room
    w = prog(t, *T["walk"])
    x = lerp(120, 1650, ease_in_out(w) * 0.15 + w * 0.85)
    y = 560 if x < 1560 else lerp(560, 470, prog(x, 1560, 1650))
    facing = 0 if x < 1560 else lerp(0, 60, prog(x, 1560, 1650))
    walking = T["walk"][0] < t < T["walk"][1]
    step = (t * 2 * math.pi * 2.0) if walking else None
    benja = person_top(BENJA, 0.8 * K, facing, step=step)
    lit_paste(cv, benja, (x * K, y * K), L)
    # camera follows him along the hallway
    s = 1.45
    cx = lerp(620, 1430, ease_in_out(prog(t, 0.0, 6.0))) * K
    cy = 520 * K
    fr = camera(cv.convert("RGB"), s, cx, cy)
    fr = time_label(fr, TL.PLAN["labels"]["casa"], ease_out(prog(t, 0.2, 0.9)) * (1 - prog(t, 4.0, 4.6)))
    return fade(fr, prog(t, 0, 0.45) * (1 - prog(t, 7.4, 8.0)))


# ================================================================== bedroom (S5, S6, chat background)
BED_PHONE = (985, 470)
PHONE_W, PHONE_H = 118, 244        # 1x canvas coords of the phone on the pillow
BED_PHONE_ANGLE = 18
BED_HEAD = (1165, 392)
DOOR_X = 470                   # wall between hallway (left) and the room


def bedroom_albedo():
    arr = planks(CW, CH, (150, 108, 74), (112, 78, 50), 40 * K, seed=11, vertical=True)
    xx = np.arange(CW)[None, :] / K
    hall = planks(CW, CH, (196, 146, 100), (150, 104, 66), 34 * K, seed=2)
    arr[:, : int((DOOR_X - 11) * K)] = hall[:, : int((DOOR_X - 11) * K)]
    cv = to_img(arr).convert("RGBA")
    d = ImageDraw.Draw(cv)
    sh = (8 * K, 12 * K, 10 * K, 0.5)
    # bed: frame, mattress, pillow, blanket
    place(cv, rrect(760 * K, 1000 * K, 16 * K, (70, 54, 42, 255)), (1240 * K, 640 * K), 0, shadow=sh)
    place(cv, rrect(720 * K, 960 * K, 26 * K, (226, 228, 236, 255)), (1240 * K, 640 * K), 0, shadow=None)
    pillow = rrect(560 * K, 230 * K, 70 * K, (238, 240, 246, 255)).copy()
    ImageDraw.Draw(pillow).line((40 * K, 115 * K, 520 * K, 118 * K), fill=(215, 218, 228), width=4 * K)
    place(cv, pillow, (1240 * K, 330 * K), -3, shadow=(4 * K, 8 * K, 10 * K, 0.35))
    blanket = Image.new("RGBA", (740 * K, 620 * K), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blanket)
    bd.rounded_rectangle((0, 0, 740 * K - 1, 620 * K - 1), 40 * K, fill=(38, 52, 92, 255))
    # the curled body under the blanket
    bd.ellipse((60 * K, 10 * K, 520 * K, 360 * K), fill=(46, 62, 108, 255))
    bd.ellipse((150 * K, -40 * K, 400 * K, 150 * K), fill=(50, 68, 116, 255))
    bd.ellipse((200 * K, 230 * K, 640 * K, 560 * K), fill=(44, 60, 104, 255))
    for i in range(7):
        y = (60 + i * 80) * K
        bd.arc((-200 * K, y - 300 * K, 900 * K, y + 300 * K), 70, 110, fill=(30, 42, 76, 255), width=5 * K)
    place(cv, blanket, (1250 * K, 770 * K), -2, shadow=(4 * K, 6 * K, 10 * K, 0.4))
    # his arm out of the blanket, hand by the phone
    arm = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arm)
    ad.line(R(1250, 540, 1180, 590, 1110, 612, 1050, 602), fill=(104, 110, 128, 255), width=50 * K, joint="curve")
    ad.ellipse(R(1012, 572, 1072, 628), fill=(214, 168, 132, 255))
    sh_, pad_ = drop_shadow(arm.crop(R(900, 450, 1300, 720)), 8 * K, 0.45)
    cv.alpha_composite(sh_, (int(900 * K - pad_ + 6 * K), int(450 * K - pad_ + 10 * K)))
    cv.alpha_composite(arm)
    # night table + lamp (off) + headphones
    place(cv, rrect(170 * K, 170 * K, 8 * K, (110, 80, 56, 255)), (1740 * K, 300 * K), 0, shadow=sh)
    place(cv, circle(100 * K, (230, 222, 200, 255)), (1740 * K, 290 * K), 0, shadow=(4 * K, 6 * K, 6 * K, 0.4))
    # desk with the 'Guía 4' notebook from cápsula 1
    place(cv, rrect(600 * K, 170 * K, 6 * K, (120, 86, 56, 255)), (330 * K + 600 * K, 1040 * K), 0, shadow=sh)
    nb = rrect(220 * K, 150 * K, 3 * K, (248, 246, 238, 255)).copy()
    ImageDraw.Draw(nb).text((20 * K, 14 * K), "Guía 4", font=font("hand_b", 34 * K), fill=(30, 55, 140))
    place(cv, nb, (820 * K, 1010 * K), 6, shadow=(3 * K, 4 * K, 4 * K, 0.4))
    # backpack thrown on the floor
    place(cv, rrect(150 * K, 120 * K, 26 * K, (70, 74, 82, 255)), (640 * K, 640 * K), 24, shadow=sh)
    # wall + closed door (between hallway and room)
    d.rectangle(R(DOOR_X - 11, 0, DOOR_X + 11, 220), fill=(58, 56, 54))
    d.rectangle(R(DOOR_X - 11, 400, DOOR_X + 11, 1080), fill=(58, 56, 54))
    d.rectangle(R(DOOR_X - 7, 0, DOOR_X + 7, 220), fill=(78, 75, 72))
    d.rectangle(R(DOOR_X - 7, 400, DOOR_X + 7, 1080), fill=(78, 75, 72))
    # window on the top wall
    d.rectangle(R(DOOR_X, 0, 1920, 14), fill=(58, 56, 54))
    d.rectangle(R(1300, 0, 1700, 10), fill=(150, 180, 220))
    return cv


def bedroom_light():
    yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
    xx /= K
    yy /= K
    L = np.empty((CH, CW, 3), np.float32)
    L[:] = (0.16, 0.18, 0.30)
    hall = xx < DOOR_X
    L[hall] = (0.95, 0.86, 0.72)
    # light leaking under the door into the room
    leak = np.exp(-(((xx - DOOR_X) / 70) ** 2 + ((yy - 310) / 90) ** 2)) * (xx >= DOOR_X)
    L += leak[..., None] * np.array((0.55, 0.42, 0.25), np.float32)
    # window: cold street light
    win = np.exp(-(((xx - 1500) / 260) ** 2 + ((yy - 40) / 160) ** 2))
    L += win[..., None] * np.array((0.10, 0.14, 0.26), np.float32)
    # the phone's glow on pillow and face
    ph = np.exp(-(((xx - BED_PHONE[0]) / 330) ** 2 + ((yy - BED_PHONE[1]) / 300) ** 2))
    L += ph[..., None] * np.array((0.35, 0.48, 0.85), np.float32)
    return L


@lru_cache(maxsize=1)
def bedroom_assets():
    lp = os.path.join(OUT, "cache_bed_light.npy")
    if os.path.exists(lp):
        L = np.load(lp)
    else:
        L = bedroom_light()
        np.save(lp, L)

    def build():
        return to_img(np.asarray(bedroom_albedo().convert("RGB"), np.float32) * L)
    return cache_png("cache_bedroom.png", build), L


def phone_body(k):
    w, h = PHONE_W * k, PHONE_H * k
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    im.alpha_composite(rrect(w, h, 26 * k, (40, 42, 48, 255)))
    im.alpha_composite(rrect(w - 4 * k, h - 4 * k, 24 * k, (8, 9, 11, 255)), (2 * k, 2 * k))
    return im


@lru_cache(maxsize=4)
def final_screen(clock):
    from scene_chat import render_screen, user_block, ai_block, CHAT
    from common import tokenize
    blocks = [user_block(CHAT["u1"]), ai_block(tokenize(CHAT["a1"])), user_block(CHAT["u2"]), ai_block(tokenize(CHAT["a2"]))]
    return render_screen(clock, blocks, "", False, 0.0)


def cam_box(s, cx, cy):
    vw, vh = CW / s, CH / s
    x0 = min(max(cx - vw / 2, 0), CW - vw)
    y0 = min(max(cy - vh / 2, 0), CH - vh)
    return x0, y0, W / vw


def phone_screen_on(frame, s, cx, cy, clock="19:52", brightness=1.0):
    """Paste the (emissive) phone screen at full display resolution after the camera transform."""
    x0, y0, sc = cam_box(s, cx, cy)
    pw, ph = PHONE_W * K * sc, PHONE_H * K * sc
    scr = final_screen(clock)
    sw, sh = int(pw - 10 * K * sc), int(ph - 10 * K * sc)
    img = scr.resize((max(1, sw), max(1, sh)), Image.LANCZOS)
    if brightness < 1:
        img = Image.fromarray((np.asarray(img, np.float32) * np.array([brightness] * 3 + [1.0])).astype(np.uint8), "RGBA")
    img = img.rotate(BED_PHONE_ANGLE, resample=Image.BICUBIC, expand=True)
    px, py = (BED_PHONE[0] * K - x0) * sc, (BED_PHONE[1] * K - y0) * sc
    fr = frame.convert("RGBA")
    fr.alpha_composite(img, (int(px - img.width / 2), int(py - img.height / 2)))
    return fr.convert("RGB")


def bedroom_frame(t, s, cx, cy, head_look=0.0, sister=None, door_shake=0.0, clock="19:52"):
    base, L = bedroom_assets()
    cv = base.convert("RGBA")
    # phone body on the pillow
    pb = phone_body(K).rotate(BED_PHONE_ANGLE, resample=Image.BICUBIC, expand=True)
    sh, pad = drop_shadow(pb, 6 * K, 0.5)
    cv.alpha_composite(sh, (int(BED_PHONE[0] * K - pb.width / 2 - pad + 4 * K), int(BED_PHONE[1] * K - pb.height / 2 - pad + 6 * K)))
    cv.alpha_composite(pb, (int(BED_PHONE[0] * K - pb.width / 2), int(BED_PHONE[1] * K - pb.height / 2)))
    # Benja's head on the pillow, facing the phone; turns to the door when they knock
    face = lerp(196, 150, head_look)
    head = head_side(BENJA, 105 * K, face)
    lit_paste(cv, head, (BED_HEAD[0] * K, BED_HEAD[1] * K), L)
    # door leaf (closed), shaking on knocks
    leaf = Image.new("RGBA", (30 * K, 190 * K), (0, 0, 0, 0))
    ImageDraw.Draw(leaf).rectangle((8 * K, 0, 22 * K, 180 * K), fill=(176, 134, 94, 255))
    lit_paste(cv, leaf, ((DOOR_X + door_shake * 3) * K, 312 * K), L)
    if sister is not None:
        lit_paste(cv, sister, (DOOR_X * K - 110 * K, 300 * K), L)
    fr = camera(cv.convert("RGB"), s, cx, cy)
    return phone_screen_on(fr, s, cx, cy, clock)


def s5_frame(t):
    T = TL.S5
    look = ease_in_out(prog(t, *T["look"])) * (1 - ease_in_out(prog(t, *T["back"])))
    knock = 0.0
    reach = 0.15
    for k_ in T["knocks"]:
        if k_ - 0.08 < t < k_ + 0.1:
            knock = math.sin((t - k_ + 0.08) / 0.18 * math.pi)
            reach = 0.9
    if T["knocks"][0] - 0.4 < t < T["knocks"][-1] + 0.3:
        reach = max(reach, 0.75)
    sister = person_top(HERMANA, 1.0 * K, 0, reach=(0.1, reach), spread=(0, 0.1), head_turn=4 * math.sin(t))
    s = lerp(1.25, 1.36, prog(t, 0, 8))
    fr = bedroom_frame(t, s, 860 * K, 520 * K, head_look=look, sister=sister, door_shake=knock)
    return fade(fr, prog(t, 0, 0.4))


def closeup_frame(t):
    s = lerp(2.4, 2.7, ease_out(prog(t, 0, 2.0)))
    return bedroom_frame(t, s, 1090 * K, 450 * K)
