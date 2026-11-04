"""S2 and S4: the generic 'IA' chat on Benja's phone (screen-life)."""
import os
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import (W, H, font, rrect, circle, prog, ease_out, ease_in_out, lerp,
                    tokenize, wrap_tokens, draw_line, line_width, to_rgb, drop_shadow,
                    radial, emoji_img)
import timeline as TL

CHAT = TL.PLAN["chat"]
PW, PH = 760, 1600          # phone body
M = 140                     # margin around phone (shadow/glow)
SX, SY = 20, 20             # screen offset inside phone
SW, SH = 720, 1560          # screen size

BG_SCREEN = (14, 15, 18)
C_USER = (47, 109, 246)
C_AI = (36, 39, 45)
C_TXT = (236, 237, 241)
C_MUTED = (140, 145, 155)
C_ACCENT = (138, 150, 255)

MSG_TOP = 214               # screen coords
INPUT_BOTTOM = 1478
F_MSG = 33
LH = 45


# ------------------------------------------------------------------ static layers
def sparkle(size, color):
    ss = 4
    s = size * ss
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = s / 2
    k = s * 0.12
    pts = [(c, 0), (c + k, c - k), (s, c), (c + k, c + k), (c, s), (c - k, c + k), (0, c), (c - k, c - k)]
    d.polygon(pts, fill=color)
    return im.resize((size, size), Image.LANCZOS)


@lru_cache(maxsize=1)
def shell():
    """Phone body + soft shadow + screen glow, with margin M."""
    cw, ch = PW + 2 * M, PH + 2 * M
    base = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    glow = radial(cw, ch, cw / 2, ch / 2, 900, (120, 150, 255), amax=70, power=2.4)
    base.alpha_composite(glow)
    body = rrect(PW, PH, 112, (58, 60, 66, 255))
    sh, pad = drop_shadow(body, blur=40, opacity=0.75)
    base.alpha_composite(sh, (M - pad + 10, M - pad + 30))
    base.alpha_composite(body, (M, M))
    base.alpha_composite(rrect(PW - 6, PH - 6, 109, (10, 11, 13, 255)), (M + 3, M + 3))
    # side buttons
    d = ImageDraw.Draw(base)
    d.rounded_rectangle((M - 5, M + 300, M + 1, M + 390), 3, fill=(50, 52, 58))
    d.rounded_rectangle((M - 5, M + 420, M + 1, M + 510), 3, fill=(50, 52, 58))
    d.rounded_rectangle((M + PW - 1, M + 360, M + PW + 5, M + 500), 3, fill=(50, 52, 58))
    return base


@lru_cache(maxsize=4)
def screen_static(clock):
    """Screen background + status bar + header (header drawn as separate top layer)."""
    scr = rrect(SW, SH, 94, BG_SCREEN + (255,)).copy()
    return scr


@lru_cache(maxsize=4)
def top_layer(clock):
    im = Image.new("RGBA", (SW, MSG_TOP), BG_SCREEN + (255,))
    d = ImageDraw.Draw(im)
    # status bar
    d.text((62, 30), clock, font=font("semi", 29), fill=(245, 245, 247))
    im.alpha_composite(rrect(200, 56, 28, (0, 0, 0, 255)), (SW // 2 - 100, 18))
    x = SW - 205
    for i in range(4):  # signal
        h = 9 + i * 5
        d.rounded_rectangle((x + i * 10, 56 - h, x + i * 10 + 6, 56), 2, fill=(245, 245, 247))
    # wifi
    cx, cy = SW - 135, 57
    for r, wdt in ((22, 4), (14, 4)):
        d.arc((cx - r, cy - r, cx + r, cy + r), 225, 315, fill=(245, 245, 247), width=wdt)
    d.ellipse((cx - 3, cy - 6, cx + 3, cy), fill=(245, 245, 247))
    # battery
    bx = SW - 100
    d.rounded_rectangle((bx, 36, bx + 46, 58), 6, outline=(160, 160, 165), width=2)
    d.rounded_rectangle((bx + 4, 40, bx + 18, 54), 3, fill=(255, 214, 10))
    d.rounded_rectangle((bx + 48, 43, bx + 51, 51), 1, fill=(160, 160, 165))
    # header
    d.text((30, 98), "‹", font=font("reg", 62), fill=(110, 150, 255))
    sp = sparkle(36, C_ACCENT + (255,))
    title_f = font("bold", 34)
    tw = title_f.getlength(CHAT["app_name"])
    tx = SW / 2 - (tw + 46) / 2
    im.alpha_composite(sp, (int(tx), 112))
    d.text((tx + 46, 108), CHAT["app_name"], font=title_f, fill=(245, 245, 247))
    sub = "Asistente virtual"
    sf = font("reg", 22)
    d.text((SW / 2 - sf.getlength(sub) / 2, 152), sub, font=sf, fill=C_MUTED)
    for i in range(3):
        d.ellipse((SW - 74 + i * 14, 132, SW - 66 + i * 14, 140), fill=(110, 150, 255))
    d.line((0, MSG_TOP - 2, SW, MSG_TOP - 2), fill=(36, 38, 44), width=2)
    return im


# ------------------------------------------------------------------ message blocks
def user_block(text):
    f = font("reg", F_MSG)
    lines = wrap_tokens(tokenize(text), f, 470, 36)
    tw = max(line_width(l, f, 36) for l in lines)
    bw, bh = tw + 52, len(lines) * LH + 30

    def draw(img, d, y):
        x = SW - 34 - bw
        img.alpha_composite(rrect(bw, bh, 34, C_USER + (255,)), (int(x), int(y)))
        for i, l in enumerate(lines):
            draw_line(img, d, l, (x + 26, y + 13 + i * LH), f, (255, 255, 255), 36)
        d.text((SW - 34 - 70, y + bh + 4), "23:48" if False else "", font=font("reg", 18), fill=C_MUTED)
    return bh, draw


def ai_block(text_tokens, code_lines=None, marker=None, marks=None):
    f = font("reg", F_MSG)
    fm = font("mono", 25)
    maxw = 568
    lines = wrap_tokens(text_tokens, f, maxw, 38) if text_tokens else []
    code_lines = code_lines or []
    tw = max([line_width(l, f, 38) for l in lines] + [0])
    code_h = (len(code_lines) * 38 + 30) if code_lines else 0
    if code_lines:
        tw = max(tw, max(fm.getlength(c) for c in code_lines) + 40)
    bw = min(maxw + 52, tw + 52)
    bh = len(lines) * LH + 30 + (code_h + 14 if code_lines else 0)
    label_h = 38

    def draw(img, d, y):
        x = 34
        img.alpha_composite(sparkle(22, C_ACCENT + (255,)), (x + 2, int(y + 6)))
        d.text((x + 32, y + 2), "IA", font=font("semi", 22), fill=C_MUTED)
        yb = y + label_h
        img.alpha_composite(rrect(bw, bh, 34, C_AI + (255,)), (x, int(yb)))
        for i, l in enumerate(lines):
            ly = yb + 13 + i * LH
            draw_line(img, d, l, (x + 26, ly), f, C_TXT, 38)
            if marker and marks is not None and marker in l:
                marks["y"] = ly + LH / 2
                marks["x"] = x + 26 + line_width(l, f, 38) / 2
        if code_lines:
            cy = yb + 13 + len(lines) * LH + 6
            img.alpha_composite(rrect(bw - 32, code_h, 16, (24, 26, 31, 255)), (x + 16, int(cy)))
            for i, c in enumerate(code_lines):
                d.text((x + 36, cy + 14 + i * 38), c, font=fm, fill=(150, 205, 255))
    return bh + label_h, draw


def dots_block(t):
    bw, bh = 120, 66

    def draw(img, d, y):
        x = 34
        img.alpha_composite(sparkle(22, C_ACCENT + (255,)), (x + 2, int(y + 6)))
        d.text((x + 32, y + 2), "IA", font=font("semi", 22), fill=C_MUTED)
        yb = y + 38
        img.alpha_composite(rrect(bw, bh, 33, C_AI + (255,)), (x, int(yb)))
        for i in range(3):
            ph = (np.sin((t * 6.0) - i * 0.9) + 1) / 2
            c = int(110 + 120 * ph)
            r = 7
            cx = x + 32 + i * 28
            img.alpha_composite(circle(2 * r, (c, c, c + 5, 255)), (int(cx - r), int(yb + bh / 2 - r - 3 * ph)))
    return bh + 38, draw


def empty_state(alpha):
    def draw(img, d, y_unused):
        if alpha <= 0:
            return
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        layer.alpha_composite(sparkle(90, C_ACCENT + (255,)), (SW // 2 - 45, 640))
        txt = "¿En qué te ayudo hoy?"
        ff = font("semi", 38)
        ld.text((SW / 2 - ff.getlength(txt) / 2, 760), txt, font=ff, fill=(200, 202, 210))
        a = layer.split()[3].point(lambda v: int(v * alpha))
        layer.putalpha(a)
        img.alpha_composite(layer)
    return draw


# ------------------------------------------------------------------ input bar
def draw_input(img, d, typed, typing_active, t, has_text):
    f = font("reg", 31)
    pill_l, pill_r = 30, SW - 112
    maxw = pill_r - pill_l - 56
    if typed:
        lines = wrap_tokens(tokenize(typed), f, maxw, 34)
        if typed.endswith(" ") and lines:
            pass
    else:
        lines = []
    shown = lines[-3:] if lines else []
    n = max(1, len(shown))
    ph = 78 + (n - 1) * 42
    top = INPUT_BOTTOM - ph
    # opaque band behind input
    d.rectangle((0, top - 22, SW, SH), fill=BG_SCREEN)
    img.alpha_composite(rrect(pill_r - pill_l, ph, 39, (34, 37, 43, 255)), (pill_l, top))
    if shown:
        for i, l in enumerate(shown):
            end_x = draw_line(img, d, l, (pill_l + 28, top + 19 + i * 42), f, C_TXT, 34)
        if typing_active and (t * 2.2) % 1 < 0.6:
            d.rectangle((end_x + 3, top + 21 + (len(shown) - 1) * 42, end_x + 6, top + 57 + (len(shown) - 1) * 42), fill=(110, 150, 255))
    else:
        d.text((pill_l + 28, top + 20), "Pregúntale algo a la IA…", font=f, fill=(110, 114, 124))
        if typing_active and (t * 2.2) % 1 < 0.6:
            d.rectangle((pill_l + 26, top + 21, pill_l + 29, top + 57), fill=(110, 150, 255))
    # send button
    bc = C_USER if has_text else (52, 55, 62)
    bx, by = SW - 98, INPUT_BOTTOM - 74
    img.alpha_composite(circle(70, bc + (255,)), (bx, by))
    cx, cy = bx + 35, by + 35
    d.line((cx, cy + 15, cx, cy - 14), fill=(255, 255, 255), width=5)
    d.line((cx - 13, cy - 1, cx, cy - 14), fill=(255, 255, 255), width=5)
    d.line((cx + 13, cy - 1, cx, cy - 14), fill=(255, 255, 255), width=5)
    # home indicator
    d.rounded_rectangle((SW / 2 - 120, SH - 26, SW / 2 + 120, SH - 16), 5, fill=(220, 220, 225))
    return top - 22


# ------------------------------------------------------------------ screen compose
def render_screen(clock, blocks, typed, typing_active, t, empty_alpha=0.0, marks=None, overlay=None):
    scr = screen_static(clock).copy()
    d = ImageDraw.Draw(scr)
    input_top = draw_input(scr, d, typed, typing_active, t, bool(typed))
    # messages layer, stacked from bottom
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    if empty_alpha > 0:
        empty_state(empty_alpha)(layer, ld, 0)
    y = input_top - 12
    measured = [b for b in blocks]
    for h, fn in reversed(measured):
        y -= h
        if y + h < MSG_TOP - 50:
            break
        fn(layer, ld, y)
        y -= 26
    # clip messages to area between header and input
    clip = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(clip).rectangle((0, MSG_TOP, SW, input_top), fill=255)
    a = np.minimum(np.array(layer.split()[3]), np.array(clip))
    layer.putalpha(Image.fromarray(a))
    scr.alpha_composite(layer)
    scr.alpha_composite(top_layer(clock), (0, 0))
    if overlay is not None:
        overlay(scr)
    # screen rounded mask
    mask = rrect(SW, SH, 94, (255, 255, 255, 255)).split()[3]
    out = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    out.paste(scr, (0, 0), mask)
    return out


def phone_image(screen):
    ph = shell().copy()
    ph.alpha_composite(screen, (M + SX, M + SY))
    return ph


# ------------------------------------------------------------------ background
@lru_cache(maxsize=1)
def background():
    """Benja's dark bedroom, blurred: the phone floats over it."""
    from scene_casa import bedroom_assets
    path = os.path.join(os.path.dirname(__file__), "out", "cache_chat_bg.png")
    if os.path.exists(path):
        return Image.open(path).convert("RGB")
    room = bedroom_assets()[0].crop((700 * 2, 0, 700 * 2 + W * 2 * 2 // 3, H * 2 * 2 // 3)).resize((W, H), Image.LANCZOS)
    bg = room.filter(ImageFilter.GaussianBlur(30))
    arr = np.asarray(bg).astype(np.float32) * 0.5
    arr[..., 2] *= 1.1
    bg = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    bg.save(path)
    return bg


def compose(phone, s, fx, fy, sx, sy, fade=1.0):
    """Place phone (with margin M) so that phone-body point (fx,fy) lands on screen (sx,sy) at scale s."""
    frame = background().copy().convert("RGBA")
    pw, ph = phone.size
    fcx, fcy = fx + M, fy + M
    x0 = sx - fcx * s
    y0 = sy - fcy * s
    vx0 = max(0, -x0 / s)
    vy0 = max(0, -y0 / s)
    vx1 = min(pw, (W - x0) / s)
    vy1 = min(ph, (H - y0) / s)
    if vx1 > vx0 and vy1 > vy0:
        ow = int(round((vx1 - vx0) * s))
        oh = int(round((vy1 - vy0) * s))
        part = phone.resize((max(1, ow), max(1, oh)), Image.BICUBIC, box=(vx0, vy0, vx1, vy1))
        frame.alpha_composite(part, (int(round(x0 + vx0 * s)), int(round(y0 + vy0 * s))))
    rgb = frame.convert("RGB")
    if fade < 1.0:
        arr = (np.asarray(rgb).astype(np.float32) * fade).astype(np.uint8)
        rgb = Image.fromarray(arr)
    return rgb


CAM_WIDE = (0.6, PW / 2, PH / 2, W / 2, H / 2)
CAM_CLOSE = (1.18, PW / 2, PH, W / 2, H + 2)
CAM_TOP = (1.12, PW / 2, 0, W / 2, -12)


def cam_mix(a, b, x):
    return tuple(lerp(p, q, x) for p, q in zip(a, b))


def cam_marker(marks, s=1.9):
    return (s, SX + marks["x"], SY + marks["y"], W / 2, H / 2 - 20)


# ------------------------------------------------------------------ conversation state
U1, A1, U2, A2 = CHAT["u1"], tokenize(CHAT["a1"]), CHAT["u2"], tokenize(CHAT["a2"])


def conversation(t, marks=None):
    """Blocks + typed text at local time t of S3 (t=99 gives the final state)."""
    T = TL.S3
    blocks = []
    typed, active = "", False
    if t < T["send1"]:
        typed = U1[: sum(1 for x in T["u1"] if x <= t)]
        active = True
    else:
        blocks.append(user_block(U1))
    if T["dots1"][0] <= t < T["dots1"][1]:
        blocks.append(dots_block(t))
    if t >= T["a1_t0"]:
        k = TL.stream_tokens_visible(t, T["a1_t0"], T["wps1"], len(A1))
        blocks.append(ai_block(A1[:k]))
    if t >= T["a1_t0"] + 0.5 and t < T["send2"]:
        typed = U2[: sum(1 for x in T["u2"] if x <= t)]
        active = True
    elif t >= T["send2"]:
        blocks.append(user_block(U2))
    if T["dots2"][0] <= t < T["dots2"][1]:
        blocks.append(dots_block(t))
    if t >= T["a2_t0"]:
        k = TL.stream_tokens_visible(t, T["a2_t0"], T["wps2"], len(A2))
        blocks.append(ai_block(A2[:k], None, CHAT["zoom_marker"], marks))
    return blocks, typed, active


def s3_frame(t):
    T = TL.S3
    marks = {}
    blocks, typed, active = conversation(t, marks)
    empty_alpha = 1.0 - prog(t, T["send1"] - 0.05, T["send1"] + 0.25)
    scr = render_screen(CHAT["clock"], blocks, typed, active, t, empty_alpha)
    phone = phone_image(scr)
    cam = cam_mix(CAM_WIDE, CAM_CLOSE, ease_in_out(prog(t, 0.45, 1.7)))
    z = ease_in_out(prog(t, *T["zoom"]))
    if z > 0 and "y" in marks:
        cam = cam_mix(cam, cam_marker(marks), z)
    s, fx, fy, sx, sy = cam
    s *= 1 + 0.03 * prog(t, T["zoom"][1], 22.0)
    fr = compose(phone, s, fx, fy, sx, sy, ease_out(prog(t, 0.0, 0.5)))
    from gfx import time_label
    return time_label(fr, TL.PLAN["labels"]["pieza"], ease_out(prog(t, 0.3, 1.0)) * (1 - prog(t, 3.6, 4.2)))


# ------------------------------------------------------------------ S4: notification
N = TL.PLAN["notif"]


def banner(scr, y, alpha):
    bw, bh = SW - 48, 170
    card = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    card.alpha_composite(rrect(bw, bh, 40, (58, 61, 70, 250)))
    d = ImageDraw.Draw(card)
    card.alpha_composite(rrect(72, 72, 18, (52, 199, 89, 255)), (24, 24))
    d.rounded_rectangle((38, 42, 82, 74), 14, fill=(255, 255, 255))
    d.polygon([(46, 70), (42, 84), (58, 72)], fill=(255, 255, 255))
    d.text((112, 22), N["app"].upper(), font=font("semi", 21), fill=(170, 174, 186))
    wf = font("reg", 21)
    d.text((bw - 28 - wf.getlength(N["when"]), 22), N["when"], font=wf, fill=(170, 174, 186))
    d.text((112, 54), N["from"], font=font("bold", 32), fill=(250, 250, 252))
    d.text((112, 98), N["text"], font=font("reg", 31), fill=(232, 233, 238))
    if alpha < 1:
        card.putalpha(card.split()[3].point(lambda v: int(v * alpha)))
    sh, pad = drop_shadow(card, 18, 0.5 * alpha)
    scr.alpha_composite(sh, (24 - pad, int(y) - pad + 10))
    scr.alpha_composite(card, (24, int(y)))
    return bw, bh


def s4_frame(t):
    T = TL.S4
    marks = {}
    blocks, _, _ = conversation(99, marks)
    drop = ease_out(prog(t, *T["drop"]))
    sw = ease_in_out(prog(t, *T["swipe"]))
    by = lerp(-200, 66, drop) - 300 * sw
    balpha = 1.0 - sw * 0.9
    touch = prog(t, *T["touch"]) * (1 - prog(t, T["swipe"][1], T["swipe"][1] + 0.25))

    def overlay(scr):
        if drop <= 0 or by < -190:
            return
        banner(scr, by, balpha)
        if touch > 0:
            r = 44
            ring = Image.new("RGBA", (2 * r + 8, 2 * r + 8), (0, 0, 0, 0))
            ImageDraw.Draw(ring).ellipse((4, 4, 2 * r + 4, 2 * r + 4), fill=(255, 255, 255, int(70 * touch)), outline=(255, 255, 255, int(170 * touch)), width=3)
            scr.alpha_composite(ring, (SW // 2 - r - 4, int(by + 85 - r - 4)))
    scr = render_screen("19:51", blocks, "", False, t, 0.0, None, overlay)
    phone = phone_image(scr)
    # need the marker position: rendered with marks in a first pass of the blocks
    if "y" not in marks:
        render_screen("19:51", conversation(99, marks)[0], "", False, t)
    start = cam_marker(marks)
    up = ease_in_out(prog(t, *T["cam_up"]))
    down = ease_in_out(prog(t, *T["cam_down"]))
    cam = cam_mix(start, CAM_TOP, up)
    cam = cam_mix(cam, cam_marker(marks, 1.7), down)
    s, fx, fy, sx, sy = cam
    s *= 1 + 0.03 * prog(t, T["cam_down"][1], 10.0)
    return compose(phone, s, fx, fy, sx, sy, 1 - prog(t, 9.6, 10.0))
