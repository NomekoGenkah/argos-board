"""Drawing helpers shared by the illustrated scenes (textures, placement, labels, caching)."""
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import W, H, font, rrect, drop_shadow

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)


def to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


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


def wood(w, h, base, dark, seed=1, ring=0.05, warp=4.0, vertical=False):
    if vertical:
        return np.transpose(wood(h, w, base, dark, seed, ring, warp), (1, 0, 2))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    n1 = aniso_noise(w, h, 900, 120, seed)
    n2 = aniso_noise(w, h, 300, 6, seed + 1)
    n3 = smooth_noise(w, h, 500, seed + 2)
    g = np.sin(yy * ring + warp * n1 * 6.0) * 0.5 + 0.5
    g = g ** 4 * 0.55 + n2 * 0.30 + n3 * 0.15
    base = np.array(base, np.float32)
    dark = np.array(dark, np.float32)
    return base[None, None] * (1 - g[..., None]) + dark[None, None] * g[..., None]


def planks(w, h, base, dark, plank_w, seed=1, vertical=False):
    """Wooden floor: boards of width plank_w with staggered joints."""
    arr = wood(w, h, base, dark, seed=seed, ring=0.09, warp=3.0, vertical=vertical)
    rng = np.random.default_rng(seed + 7)
    n = (w if vertical else h) // plank_w + 1
    for i in range(n):
        tint = rng.uniform(0.9, 1.08)
        a, b = i * plank_w, (i + 1) * plank_w
        if vertical:
            arr[:, a:b] *= tint
            arr[:, max(0, a - 1):a + 2] *= 0.55
            j = int(rng.uniform(0, h))
            arr[max(0, j - 1):j + 2, a:b] *= 0.6
        else:
            arr[a:b] *= tint
            arr[max(0, a - 1):a + 2] *= 0.55
            j = int(rng.uniform(0, w))
            arr[a:b, max(0, j - 1):j + 2] *= 0.6
    return arr


def place(canvas, img, center, angle=0.0, shadow=(14, 18, 16, 0.55)):
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
    a = math.radians(angle)
    cx, cy = w / 2, h / 2
    dx, dy = px - cx, py - cy
    rx = dx * math.cos(a) + dy * math.sin(a)
    ry = -dx * math.sin(a) + dy * math.cos(a)
    cos, sin = abs(math.cos(a)), abs(math.sin(a))
    nw, nh = w * cos + h * sin, w * sin + h * cos
    return nw / 2 + rx, nh / 2 + ry


def cache_png(name, builder):
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        return Image.open(path).copy()
    im = builder()
    im.save(path)
    return im


def time_label(frame, text, alpha, x=70, y=60, size=74):
    """Same rounded time stamp as cápsula 1."""
    if alpha <= 0:
        return frame
    f = font("d_light", size)
    tw = f.getlength(text)
    pad_x, pad_y = 34, 16
    bw, bh = int(tw + 2 * pad_x), int(size * 1.22 + 2 * pad_y)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.alpha_composite(rrect(bw, bh, bh // 2, (8, 10, 18, 190)), (x, y))
    ImageDraw.Draw(layer).text((x + pad_x, y + pad_y - size * 0.06), text, font=f, fill=(255, 255, 255, 255))
    if alpha < 1:
        layer.putalpha(layer.split()[3].point(lambda v: int(v * alpha)))
    fr = frame.convert("RGBA")
    fr.alpha_composite(layer)
    return fr.convert("RGB")


def fade(frame, k):
    if k >= 1:
        return frame
    return Image.fromarray((np.asarray(frame, np.float32) * max(0.0, k)).astype(np.uint8))


def multiply(img_rgba, light):
    """Multiply the RGB of an RGBA layer by a float light array (H, W, 3)."""
    a = np.asarray(img_rgba, np.float32).copy()
    a[..., :3] = np.clip(a[..., :3] * light, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def cam_view(canvas, view_w, cx, cy, resample=Image.BILINEAR):
    """16:9 camera on a canvas of any aspect: shows view_w canvas pixels across, centred on (cx, cy)."""
    cw, ch = canvas.size
    vw = min(view_w, cw, ch * W / H)
    vh = vw * H / W
    x0 = min(max(cx - vw / 2, 0), cw - vw)
    y0 = min(max(cy - vh / 2, 0), ch - vh)
    return canvas.resize((W, H), resample, box=(x0, y0, x0 + vw, y0 + vh))
