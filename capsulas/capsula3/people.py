"""Top-down people (head + shoulders seen from above) and their long cast shadows."""
import math
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from gfx import rotate_point

SS = 3  # supersampling


class Look:
    def __init__(self, hair, jacket, skin=(214, 168, 132), pack=None, hair_len=1.0, pants=(40, 44, 58),
                 phones=False, ponytail=False):
        self.hair, self.jacket, self.skin, self.pack, self.hair_len, self.pants = hair, jacket, skin, pack, hair_len, pants
        self.phones, self.ponytail = phones, ponytail


BENJA = Look(hair=(34, 26, 22), jacket=(30, 42, 78), pack=(70, 74, 82))
BENJA_CASA = Look(hair=(34, 26, 22), jacket=(30, 42, 78), pack=None)
TOMAS = Look(hair=(120, 82, 46), jacket=(30, 42, 78), pack=(150, 40, 46), skin=(226, 182, 146))
MAMA = Look(hair=(70, 44, 30), jacket=(150, 92, 110), skin=(220, 172, 138), hair_len=1.25)
BENJA_CALLE = Look(hair=(34, 26, 22), jacket=(30, 42, 78), pack=(70, 74, 82), phones=True)
MARTINA = Look(hair=(58, 36, 26), jacket=(30, 42, 78), pack=(120, 150, 190), skin=(224, 178, 142), hair_len=1.3, ponytail=True)
ALUMNO_A = Look(hair=(26, 22, 20), jacket=(30, 42, 78), pack=(60, 110, 70), skin=(204, 156, 120))
ALUMNO_B = Look(hair=(140, 96, 56), jacket=(30, 42, 78), pack=(180, 140, 60), skin=(228, 186, 150))
TRANSEUNTE = [Look(hair=(40, 30, 26), jacket=(30, 42, 78), pack=(160, 60, 60)),
              Look(hair=(90, 60, 40), jacket=(30, 42, 78), pack=(60, 60, 140), hair_len=1.3, ponytail=True)]
HERMANA = Look(hair=(46, 30, 24), jacket=(90, 140, 120), skin=(222, 176, 140), hair_len=1.35)


def _shade(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c)


def person_top(look, scale=1.0, facing=0.0, reach=(0.0, 0.0), spread=(0.0, 0.0), step=None, head_turn=0.0):
    """Person seen from directly above. Facing is in degrees, CCW from +x (screen).
    reach: forearm forward extension 0..1 for (left, right). step: walking phase in radians or None."""
    u = scale * SS
    size = int(260 * u)
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = size / 2

    def P(x, y):  # local (x forward, y to the right of the person) -> image
        return cx + x * u, cy + y * u

    # feet (walking)
    if step is not None:
        for side, ph in ((-1, 0.0), (1, math.pi)):
            fx = 34 * math.sin(step + ph)
            x0, y0 = P(fx - 14, side * 17 - 9)
            x1, y1 = P(fx + 16, side * 17 + 9)
            d.ellipse((x0, y0, x1, y1), fill=(28, 28, 32))
    # backpack
    if look.pack:
        x0, y0 = P(-48, -34)
        x1, y1 = P(-14, 34)
        d.rounded_rectangle((x0, y0, x1, y1), 10 * u, fill=look.pack)
        d.rounded_rectangle((P(-44, -30)[0], P(-44, -30)[1], P(-30, 30)[0], P(-30, 30)[1]), 6 * u, fill=_shade(look.pack, 0.8))
    # arms (forearms forward when gesturing)
    for i, side in enumerate((-1, 1)):
        r = reach[i]
        sp = spread[i]
        sx, sy = 2, side * 50
        ang = math.radians(side * (4 + 40 * sp) * min(1.0, 0.3 + r))
        L = 10 + 70 * r
        hx, hy = sx + L * math.cos(ang), sy + L * math.sin(ang) * 0.6 + side * 6
        d.line([P(sx, sy), P(hx, hy)], fill=_shade(look.jacket, 0.92), width=int(22 * u), joint="curve")
        d.ellipse((*P(sx - 11, sy - 11), *P(sx + 11, sy + 11)), fill=_shade(look.jacket, 0.92))
        d.ellipse((*P(hx - 11, hy - 11), *P(hx + 11, hy + 11)), fill=_shade(look.jacket, 0.92))
        if r > 0.15:
            d.ellipse((*P(hx - 9, hy - 9), *P(hx + 9, hy + 9)), fill=look.skin)
    # shoulders / torso from above
    d.ellipse((*P(-26, -58), *P(26, 58)), fill=look.jacket)
    d.ellipse((*P(-20, -50), *P(18, 50)), fill=_shade(look.jacket, 1.12))
    d.line([P(-4, -40), P(-4, 40)], fill=_shade(look.jacket, 0.85), width=int(3 * u))
    # head (rotates a little relative to the body)
    ht = math.radians(head_turn)
    hxc, hyc = 6 * math.cos(ht), 6 * math.sin(ht)
    # face skin crescent towards the front
    fx, fy = hxc + 9 * math.cos(ht), hyc + 9 * math.sin(ht)
    d.ellipse((*P(fx - 21, fy - 21), *P(fx + 21, fy + 21)), fill=look.skin)
    # ears
    for side in (-1, 1):
        ex, ey = hxc + 2 * math.cos(ht) - side * 24 * math.sin(ht), hyc + 2 * math.sin(ht) + side * 24 * math.cos(ht)
        d.ellipse((*P(ex - 6, ey - 6), *P(ex + 6, ey + 6)), fill=_shade(look.skin, 0.92))
    hr = 25 * look.hair_len
    bx, by = hxc - 5 * math.cos(ht), hyc - 5 * math.sin(ht)
    d.ellipse((*P(bx - hr, by - 25), *P(bx + 25, by + 25)), fill=look.hair)
    d.ellipse((*P(bx - 8, by - 14), *P(bx + 6, by - 2)), fill=_shade(look.hair, 1.35))
    if look.ponytail:
        d.ellipse((*P(bx - 44, by - 9), *P(bx - 16, by + 9)), fill=_shade(look.hair, 0.9))
        d.ellipse((*P(bx - 24, by - 6), *P(bx - 16, by + 6)), fill=(200, 60, 90))
    if look.phones:
        # headband over the top of the head, ear cups on both sides
        p0 = P(hxc + 2 * math.cos(ht) + 26 * math.sin(ht), hyc + 2 * math.sin(ht) - 26 * math.cos(ht))
        p1 = P(hxc - 4 * math.cos(ht), hyc - 4 * math.sin(ht))
        p2 = P(hxc + 2 * math.cos(ht) - 26 * math.sin(ht), hyc + 2 * math.sin(ht) + 26 * math.cos(ht))
        d.line([p0, p1, p2], fill=(236, 236, 240), width=int(6 * u), joint="curve")
        for side in (-1, 1):
            ex, ey = hxc + 2 * math.cos(ht) - side * 27 * math.sin(ht), hyc + 2 * math.sin(ht) + side * 27 * math.cos(ht)
            d.ellipse((*P(ex - 9, ey - 11), *P(ex + 9, ey + 11)), fill=(236, 236, 240))
            d.ellipse((*P(ex - 5, ey - 7), *P(ex + 5, ey + 7)), fill=(200, 202, 210))
    im = im.rotate(facing, resample=Image.BICUBIC, expand=False)
    return im.resize((size // SS, size // SS), Image.LANCZOS)


def paste_person(canvas, img, center):
    canvas.alpha_composite(img, (int(center[0] - img.width / 2), int(center[1] - img.height / 2)))


def silhouette(scale, arm_l=10.0, arm_r=10.0, elbow_l=0.0, elbow_r=0.0, walk=None, hair_len=1.0):
    """Front-view silhouette (alpha only), feet at bottom-centre. Arm angles in degrees from hanging down."""
    u = scale * SS
    w, h = int(200 * u), int(230 * u)
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    cx = w / 2
    base = h - 4 * u

    def P(x, y):
        return cx + x * u, base - y * u

    # legs
    lsw = 0 if walk is None else 10 * math.sin(walk)
    for side in (-1, 1):
        fx = side * 9 + side * lsw
        d.line([P(side * 9, 100), P(fx, 4)], fill=255, width=int(17 * u))
        d.ellipse((*P(fx - 10, 9), *P(fx + 10, -1)), fill=255)
    # torso
    d.rounded_rectangle((*P(-25, 160), *P(25, 94)), int(10 * u), fill=255)
    d.line([P(0, 170), P(0, 158)], fill=255, width=int(10 * u))
    # head
    d.ellipse((*P(-14, 196), *P(14, 166)), fill=255)
    if hair_len > 1.1:
        d.rounded_rectangle((*P(-16, 190), *P(16, 160)), int(8 * u), fill=255)
    # arms
    for side, ang, elb in ((-1, arm_l, elbow_l), (1, arm_r, elbow_r)):
        sx, sy = side * 24, 156
        a = math.radians(ang)
        ex, ey = sx + side * 34 * math.sin(a), sy - 34 * math.cos(a)
        a2 = a + math.radians(elb)
        hx, hy = ex + side * 32 * math.sin(a2), ey - 32 * math.cos(a2)
        d.line([P(sx, sy), P(ex, ey), P(hx, hy)], fill=255, width=int(12 * u), joint="curve")
        d.ellipse((*P(hx - 7, hy + 7), *P(hx + 7, hy - 7)), fill=255)
    return im, (cx, base)


def cast_shadow(canvas, feet_xy, scale, sun_dir, stretch, opacity, blur, **pose):
    """Project the silhouette on the ground along sun_dir, anchored at the feet."""
    sil, (fx, fy) = silhouette(scale, **pose)
    w, h = sil.size
    sil = sil.resize((w, int(h * stretch)), Image.BICUBIC)
    fy *= stretch
    dx, dy = sun_dir
    theta = math.degrees(math.atan2(-dx, -dy))
    rot = sil.rotate(theta, resample=Image.BICUBIC, expand=True)
    rx, ry = rotate_point(fx, fy, sil.width, sil.height, theta)
    rot = rot.resize((rot.width // SS, rot.height // SS), Image.LANCZOS)
    rx, ry = rx / SS, ry / SS
    if blur:
        rot = rot.filter(ImageFilter.GaussianBlur(blur))
    a = rot.point(lambda v: int(v * opacity))
    layer = Image.new("RGBA", rot.size, (20, 18, 30, 0))
    layer.putalpha(a)
    canvas.alpha_composite(layer, (int(feet_xy[0] - rx), int(feet_xy[1] - ry)))


def head_side(look, size, facing=180.0):
    """Head of someone lying on their side, seen from above: hair at the back, face profile in front."""
    s = int(size * SS)
    im = Image.new("RGBA", (s * 2, s * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = s

    def E(cx, cy, rx, ry, fill):
        d.ellipse((c + (cx - rx) * s, c + (cy - ry) * s, c + (cx + rx) * s, c + (cy + ry) * s), fill=fill)
    # local frame: +x = where the face looks
    E(0.08, 0.02, 0.50, 0.40, look.skin)                      # head shape
    E(0.55, 0.10, 0.07, 0.06, _shade(look.skin, 0.95))        # nose tip
    E(-0.20, -0.02, 0.36, 0.42, look.hair)                    # hair over the back
    E(0.10, -0.26, 0.30, 0.15, look.hair)                     # top of the head / fringe
    E(-0.02, 0.16, 0.08, 0.10, _shade(look.skin, 0.88))       # ear
    E(-0.2, -0.18, 0.14, 0.08, _shade(look.hair, 1.4))        # sheen
    im = im.rotate(facing, resample=Image.BICUBIC)
    return im.resize((s * 2 // SS, s * 2 // SS), Image.LANCZOS)
