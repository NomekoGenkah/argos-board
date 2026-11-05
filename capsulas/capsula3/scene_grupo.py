"""S2 (group chat '3°B 💀': burst of messages around a fake image), S3 and S5 (thumb hovering
over 'Reenviar'). The 'image' is ALWAYS an abstract, fully blurred grey block with a label:
no body, no face, no silhouette, by design."""
import math
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

from common import (W, H, font, rrect, circle, prog, ease_out, ease_in_out, ease_in, lerp, tokenize,
                    wrap_tokens, draw_line, line_width, drop_shadow, emoji_img)
from scene_chat import (SW, SH, SX, SY, PW, PH, M, BG_SCREEN, C_MUTED, C_TXT, shell, phone_image, compose,
                        screen_to_frame, cam_mix, CAM_WIDE, CAM_CLOSE, background)
import timeline as TL

G = TL.PLAN["grupo"]
MSGS = G["messages"]
TOP = 214
INPUT_TOP = 1400
C_IN = (36, 39, 46)
F_TXT = 32
LH = 43
IMG_W, IMG_H = 440, 320


# ------------------------------------------------------------------ the blurred block
@lru_cache(maxsize=1)
def blurred_block():
    """Abstract grey block: smooth noise, heavily blurred. Contains no shapes at all."""
    rng = np.random.default_rng(12)
    small = rng.uniform(95, 150, (6, 8)).astype(np.float32)
    im = Image.fromarray(small.astype(np.uint8)).resize((IMG_W, IMG_H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(40))
    arr = np.asarray(im, np.float32)
    arr = (arr - arr.mean()) * 0.6 + 122
    block = Image.fromarray(np.clip(np.stack([arr, arr, arr * 1.03], -1), 0, 255).astype(np.uint8)).convert("RGBA")
    mask = rrect(IMG_W, IMG_H, 18, (255, 255, 255, 255)).split()[3]
    out = Image.new("RGBA", (IMG_W, IMG_H), (0, 0, 0, 0))
    out.paste(block, (0, 0), mask)
    # label pill
    d = ImageDraw.Draw(out)
    f = font("semi", 24)
    txt = G["image_label"]
    tw = f.getlength(txt)
    pw_, ph_ = int(tw + 76), 52
    px, py = (IMG_W - pw_) // 2, (IMG_H - ph_) // 2
    out.alpha_composite(rrect(pw_, ph_, 26, (20, 22, 28, 215)), (px, py))
    # eye-with-slash icon (hidden content)
    cx, cy = px + 30, py + ph_ // 2
    d.ellipse((cx - 13, cy - 8, cx + 13, cy + 8), outline=(235, 235, 240), width=3)
    d.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=(235, 235, 240))
    d.line((cx - 14, cy + 11, cx + 14, cy - 11), fill=(235, 235, 240), width=3)
    d.text((px + 52, py + 12), txt, font=f, fill=(240, 240, 245))
    return out


# ------------------------------------------------------------------ header / input
@lru_cache(maxsize=4)
def group_top(clock):
    im = Image.new("RGBA", (SW, TOP), BG_SCREEN + (255,))
    d = ImageDraw.Draw(im)
    d.text((62, 30), clock, font=font("semi", 29), fill=(245, 245, 247))
    im.alpha_composite(rrect(200, 56, 28, (0, 0, 0, 255)), (SW // 2 - 100, 18))
    x = SW - 205
    for i in range(4):
        h = 9 + i * 5
        d.rounded_rectangle((x + i * 10, 56 - h, x + i * 10 + 6, 56), 2, fill=(245, 245, 247))
    bx = SW - 100
    d.rounded_rectangle((bx, 36, bx + 46, 58), 6, outline=(160, 160, 165), width=2)
    d.rounded_rectangle((bx + 4, 40, bx + 36, 54), 3, fill=(245, 245, 247))
    d.text((24, 98), "‹", font=font("reg", 62), fill=(110, 150, 255))
    im.alpha_composite(circle(74, (70, 80, 110, 255)), (70, 108))
    f = font("bold", 24)
    d.text((107 - f.getlength("3°B") / 2, 131), "3°B", font=f, fill=(240, 240, 245))
    draw_line(im, d, tokenize(G["name"]), (162, 104), font("bold", 34), (245, 245, 247), 36)
    d.text((162, 150), G["members"], font=font("reg", 22), fill=C_MUTED)
    d.line((0, TOP - 2, SW, TOP - 2), fill=(36, 38, 44), width=2)
    return im


def draw_input(scr, d):
    d.rectangle((0, INPUT_TOP - 20, SW, SH), fill=BG_SCREEN)
    scr.alpha_composite(rrect(SW - 150, 78, 39, (34, 37, 43, 255)), (30, INPUT_TOP))
    d.text((70, INPUT_TOP + 20), "Mensaje", font=font("reg", 31), fill=(110, 114, 124))
    scr.alpha_composite(circle(70, (47, 109, 246, 255)), (SW - 104, INPUT_TOP + 4))
    cx, cy = SW - 69, INPUT_TOP + 39
    d.rounded_rectangle((cx - 8, cy - 18, cx + 8, cy + 6), 8, fill=(255, 255, 255))
    d.arc((cx - 14, cy - 8, cx + 14, cy + 14), 0, 180, fill=(255, 255, 255), width=3)
    d.rounded_rectangle((SW / 2 - 120, SH - 26, SW / 2 + 120, SH - 16), 5, fill=(220, 220, 225))


# ------------------------------------------------------------------ message blocks
def msg_block(m, first, alpha=1.0, marks=None, key=None):
    f = font("reg", F_TXT)
    fn = font("bold", 24)
    col = tuple(m["color"])
    if m.get("image"):
        bw, bh = IMG_W + 24, IMG_H + 24 + (40 if first else 0)
        lines = []
    else:
        lines = wrap_tokens(tokenize(m["text"]), f, 470, 34)
        tw = max(line_width(l, f, 34) for l in lines)
        bw = int(max(tw, fn.getlength(m["from"]) if first else 0, 120) + 48)
        bh = len(lines) * LH + 30 + (36 if first else 0)

    def draw(img, d, y):
        x = 104
        if first:
            img.alpha_composite(circle(56, col + (255,)), (34, int(y)))
            fi = font("bold", 26)
            d.text((62 - fi.getlength(m["from"][0]) / 2, y + 12), m["from"][0], font=fi, fill=(20, 22, 28))
        layer = Image.new("RGBA", (bw + 4, bh + 4), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        layer.alpha_composite(rrect(bw, bh, 28, C_IN + (255,)))
        yy = 12
        if first:
            ld.text((22, yy), m["from"], font=fn, fill=col)
            yy += 36
        if m.get("image"):
            layer.alpha_composite(blurred_block(), (12, yy))
        else:
            for i, l in enumerate(lines):
                draw_line(layer, ld, l, (24, yy + i * LH), f, C_TXT, 34)
        ld.text((bw - 70, bh - 26), "07:44", font=font("reg", 17), fill=(150, 154, 164))
        if alpha < 1:
            layer.putalpha(layer.split()[3].point(lambda v: int(v * alpha)))
        img.alpha_composite(layer, (x, int(y + (1 - alpha) * 30)))
        if marks is not None and key:
            marks[key] = (x + bw / 2, y + bh / 2, x, y, bw, bh)
    return bh, draw


def blocks_at(t, marks=None):
    out = []
    prev = None
    for i, (m, ta) in enumerate(zip(MSGS, TL.S2["arrive"])):
        if t < ta:
            break
        a = ease_out(prog(t, ta, ta + 0.18))
        first = m["from"] != prev
        out.append(msg_block(m, first, a, marks, "img" if m.get("image") else None))
        prev = m["from"]
    return out


def render_group(clock, blocks, overlay=None):
    scr = rrect(SW, SH, 94, BG_SCREEN + (255,)).copy()
    d = ImageDraw.Draw(scr)
    draw_input(scr, d)
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    y = INPUT_TOP - 40
    for h, fn in reversed(blocks):
        y -= h
        if y + h < TOP - 60:
            break
        fn(layer, ld, y)
        y -= 14
    clip = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(clip).rectangle((0, TOP, SW, INPUT_TOP - 20), fill=255)
    layer.putalpha(Image.fromarray(np.minimum(np.asarray(layer.split()[3]), np.asarray(clip))))
    scr.alpha_composite(layer)
    scr.alpha_composite(group_top(clock), (0, 0))
    if overlay:
        overlay(scr)
    mask = rrect(SW, SH, 94, (255, 255, 255, 255)).split()[3]
    out = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    out.paste(scr, (0, 0), mask)
    return out


# ------------------------------------------------------------------ S2
def s2_frame(t):
    T = TL.S2
    marks = {}
    scr = render_group(G["clock"], blocks_at(t, marks))
    phone = phone_image(scr)
    cam = cam_mix(CAM_WIDE, CAM_CLOSE, ease_in_out(prog(t, 0.2, 1.2)))
    z = ease_in_out(prog(t, *T["zoom_img"])) * (1 - ease_in_out(prog(t, *T["unzoom"])))
    if z > 0 and "img" in marks:
        cx, cy = marks["img"][:2]
        cam = cam_mix(cam, (1.75, SX + cx, SY + cy + 18, W / 2, H / 2), z)
    fr = compose(phone, *cam, fade=ease_out(prog(t, 0.0, 0.4)))
    return group_label(fr, ease_out(prog(t, 0.4, 1.0)) * (1 - prog(t, 6.0, 6.6)))


def group_label(frame, alpha):
    """Rounded label like the time stamps: names the chat as the class group."""
    if alpha <= 0:
        return frame
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f1, f2 = font("d_semi", 56), font("reg", 26)
    toks = tokenize(G["name"])
    w1 = line_width(toks, f1, 60)
    sub = "chat del curso"
    bw = int(max(w1, f2.getlength(sub)) + 72)
    layer.alpha_composite(rrect(bw, 150, 40, (8, 10, 18, 200)), (70, 60))
    draw_line(layer, d, toks, (106, 78), f1, (255, 255, 255), 60)
    d.text((106, 150), sub, font=f2, fill=(190, 194, 206))
    if alpha < 1:
        layer.putalpha(layer.split()[3].point(lambda v: int(v * alpha)))
    fr = frame.convert("RGBA")
    fr.alpha_composite(layer)
    return fr.convert("RGB")


# ------------------------------------------------------------------ menu + thumb (S3, S5)
MENU_ICONS = {"Responder": "↩", "Reenviar": "↪", "Copiar": "⧉", "Destacar": "★", "Eliminar": "🗑"}


@lru_cache(maxsize=1)
def chat_final():
    marks = {}
    scr = render_group(G["clock"], blocks_at(99, marks))
    return scr, marks


def menu_screen(appear, hover):
    """Long-press menu over the image message; 'Reenviar' highlighted by `hover` (0..1)."""
    base, marks = chat_final()
    x0, y0 = 104, 0
    _, _, bx, by, bw, bh = marks["img"]
    scr = base.copy()
    # dim + blur the chat behind
    dim = base.filter(ImageFilter.GaussianBlur(10 * appear))
    dim = Image.fromarray((np.asarray(dim, np.float32) * np.array([1 - 0.55 * appear] * 3 + [1.0])).astype(np.uint8), "RGBA")
    scr = dim
    # the lifted message, a bit higher, crisp
    lift = 40 * ease_out(appear)
    top = max(TOP + 40, by - 70) - lift
    msg = base.crop((int(bx) - 4, int(by) - 4, int(bx + bw) + 8, int(by + bh) + 8))
    sh, pad = drop_shadow(msg, 18, 0.6 * appear)
    scr.alpha_composite(sh, (int(bx) - 4 - pad, int(top) - 4 - pad + 12))
    scr.alpha_composite(msg, (int(bx) - 4, int(top) - 4))
    # emoji reaction bar above the message
    rb = rrect(470, 76, 38, (44, 47, 54, int(255 * appear)))
    scr.alpha_composite(rb, (int(bx), int(top - 96)))
    for i, e in enumerate(("👍", "❤", "😂", "😮", "😢", "🙏")):
        em = emoji_img(e, 40)
        if appear < 1:
            em = em.copy()
            em.putalpha(em.split()[3].point(lambda v: int(v * appear)))
        scr.alpha_composite(em, (int(bx + 24 + i * 74), int(top - 96 + 18)))
    # menu card
    rows = G["menu"]
    mw, rh = 420, 74
    my = top + bh + 24
    card = Image.new("RGBA", (mw, rh * len(rows)), (0, 0, 0, 0))
    card.alpha_composite(rrect(mw, rh * len(rows), 28, (44, 47, 54, 255)))
    cd = ImageDraw.Draw(card)
    fr_ = font("reg", 31)
    rows_y = {}
    for i, r in enumerate(rows):
        ry = i * rh
        if r == "Reenviar" and hover > 0:
            cd.rounded_rectangle((6, ry + 4, mw - 6, ry + rh - 4), 22, fill=(70, 76, 90, int(255 * hover)))
        col = (255, 105, 97) if r == "Eliminar" else (238, 239, 243)
        cd.text((30, ry + 19), r, font=fr_, fill=col)
        ic = MENU_ICONS[r]
        if ic == "🗑":
            ix, iy = mw - 56, ry + 22
            cd.rounded_rectangle((ix, iy + 6, ix + 24, iy + 34), 4, outline=col, width=3)
            cd.line((ix - 4, iy + 4, ix + 28, iy + 4), fill=col, width=3)
        else:
            fi = font("reg", 34)
            cd.text((mw - 44 - fi.getlength(ic) / 2, ry + 16), ic, font=fi, fill=col)
        if i < len(rows) - 1:
            cd.line((24, ry + rh, mw - 24, ry + rh), fill=(60, 64, 72), width=2)
        rows_y[r] = my + ry + rh / 2
    if appear < 1:
        card.putalpha(card.split()[3].point(lambda v: int(v * appear)))
    scr.alpha_composite(card, (int(bx), int(my + 20 * (1 - appear))))
    mask = rrect(SW, SH, 94, (255, 255, 255, 255)).split()[3]
    out = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    out.paste(scr, (0, 0), mask)
    return out, (bx + mw - 52, rows_y["Reenviar"])


@lru_cache(maxsize=1)
def thumb_img():
    """A thumb seen from above, pointing up-left; tip at the top of the image."""
    ss = 2
    w, h = 150 * ss, 520 * ss
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    skin = (222, 176, 142)
    d.rounded_rectangle((0, 0, w - 1, h + 200), w // 2, fill=skin + (255,))
    d.rounded_rectangle((int(w * 0.2), int(h * 0.03), int(w * 0.8), int(h * 0.2)), int(w * 0.3), fill=(240, 206, 186, 255))
    d.line((int(w * 0.2), int(h * 0.32), int(w * 0.8), int(h * 0.33)), fill=(196, 150, 118, 255), width=3 * ss)
    # side shading
    shade = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(shade)
    sd.rectangle((int(w * 0.72), 0, w, h), fill=70)
    shade = shade.filter(ImageFilter.GaussianBlur(14 * ss))
    dark = Image.new("RGBA", (w, h), (120, 70, 50, 0))
    dark.putalpha(Image.fromarray(np.minimum(np.asarray(shade), np.asarray(im.split()[3]))))
    im.alpha_composite(dark)
    return im.resize((w // ss, h // ss), Image.LANCZOS)


def draw_thumb(frame, tip, angle=32, lift=0.0, alpha=1.0):
    th = thumb_img()
    rot = th.rotate(angle, resample=Image.BICUBIC, expand=True)
    # tip (top-centre of the unrotated image) after rotation
    a = math.radians(angle)
    cx, cy = th.width / 2, th.height / 2
    dx, dy = 0, -cy + 30
    rx = dx * math.cos(a) + dy * math.sin(a)
    ry = -dx * math.sin(a) + dy * math.cos(a)
    tx, ty = rot.width / 2 + rx, rot.height / 2 + ry
    x, y = int(tip[0] - tx), int(tip[1] - ty)
    if alpha < 1:
        rot = rot.copy()
        rot.putalpha(rot.split()[3].point(lambda v: int(v * alpha)))
    sh, pad = drop_shadow(rot, int(14 + 16 * lift), 0.5 * alpha)
    fr = frame.convert("RGBA")
    fr.alpha_composite(sh, (x - pad + int(18 + 30 * lift), y - pad + int(24 + 30 * lift)))
    fr.alpha_composite(rot, (x, y))
    return fr.convert("RGB")


CAM_MENU = (1.05, PW / 2, 930, 1260, 540)


def reenviar_frame(t, martina=True, freeze_at=None):
    """Shared by S3 and S5: menu open, thumb hovering over 'Reenviar'."""
    from scene_calle import gate_background
    T = TL.S3
    appear = ease_out(prog(t, *T["menu"])) if freeze_at is None else 1.0
    tin = ease_out(prog(t, *T["thumb_in"])) if freeze_at is None else 1.0
    hover = tin
    scr, target = menu_screen(appear, hover)
    phone = phone_image(scr)
    tt = t if freeze_at is None else min(t, freeze_at)
    bg = gate_background(tt + (0 if martina else 30), with_martina=martina, martina_walk=T["martina_walk"], dim=0.5)
    cam = CAM_MENU
    s0 = 1 + 0.04 * prog(tt, 0, 10)
    cam = (cam[0] * s0, cam[1], cam[2], cam[3], cam[4])
    fr = compose(phone, *cam, bg=bg)
    tip = screen_to_frame(target[0], target[1], cam)
    bob = 6 * math.sin(tt * 2.2)
    start = (tip[0] + 380, tip[1] + 520)
    tipx = lerp(start[0], tip[0], tin)
    tipy = lerp(start[1], tip[1] + 14, tin) + bob * tin
    return draw_thumb(fr, (tipx, tipy), 32, lift=0.5 + 0.2 * math.sin(tt * 2.2), alpha=min(1.0, tin * 1.5))


def s3_frame(t):
    fr = reenviar_frame(t, martina=True)
    if t < 0.25:
        fr = Image.fromarray((np.asarray(fr, np.float32) * (t / 0.25)).astype(np.uint8))
    return fr


@lru_cache(maxsize=1)
def frozen():
    return reenviar_frame(9.0, martina=False, freeze_at=9.0)


def s5_frame(t):
    T = TL.S5
    if t < T["freeze"]:
        fr = reenviar_frame(7.0 + t, martina=False, freeze_at=None)
        if t < 0.3:
            fr = Image.fromarray((np.asarray(fr, np.float32) * (t / 0.3)).astype(np.uint8))
        return fr
    src = reenviar_frame(7.0 + T["freeze"], martina=False)
    x = ease_in_out(prog(t, T["freeze"], T["freeze"] + 0.6))
    g = ImageEnhance.Color(src).enhance(1 - 0.85 * x)
    arr = np.asarray(g, np.float32) * (1 - 0.45 * x)
    fr = Image.fromarray(arr.astype(np.uint8)).convert("RGBA")
    q = ease_out(prog(t, *T["question"]))
    if q > 0:
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        f = font("d_black", 132)
        txt = TL.PLAN["pregunta"]
        tw = f.getlength(txt)
        x0, y0 = 110, H / 2 - 100
        d.text((x0 + 4, y0 + 6), txt, font=f, fill=(0, 0, 0, int(150 * q)))
        d.text((x0, y0), txt, font=f, fill=(255, 255, 255, int(255 * q)))
        fr.alpha_composite(layer)
    k = 1 - prog(t, 9.6, 10.0)
    return Image.fromarray((np.asarray(fr.convert("RGB"), np.float32) * k).astype(np.uint8))
