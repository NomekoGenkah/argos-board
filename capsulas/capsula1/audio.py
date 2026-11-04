"""Synthesised soundtrack: lo-fi music + sound effects, timed from timeline.py.
No external samples are used: everything is generated with numpy/scipy."""
import math
import numpy as np
from scipy import signal
import wave

import timeline as TL

SR = 48000
RNG = np.random.default_rng(7)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def tarr(d):
    return np.arange(int(d * SR)) / SR


def sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x)


def adsr(n, a, r, sustain_end=None):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


class Mix:
    def __init__(self, dur):
        self.buf = np.zeros((int(dur * SR) + SR, 2), np.float32)
        self.music = np.zeros_like(self.buf)

    def add(self, t, sig, gain=1.0, pan=0.0, bus="sfx"):
        b = self.buf if bus == "sfx" else self.music
        i = int(t * SR)
        if i >= len(b):
            return
        if sig.ndim == 1:
            l = sig * gain * math.cos((pan + 1) * math.pi / 4) * 1.414
            r = sig * gain * math.sin((pan + 1) * math.pi / 4) * 1.414
            st = np.stack([l, r], -1)
        else:
            st = sig * gain
        n = min(len(st), len(b) - i)
        b[i:i + n] += st[:n].astype(np.float32)


def reverb(x, decay=2.2, mix=0.25, seed=1):
    rng = np.random.default_rng(seed)
    n = int(decay * SR)
    env = np.exp(-np.arange(n) / SR * 6.9 / decay)
    out = []
    for ch in range(2):
        ir = rng.normal(0, 1, n) * env
        ir = filt(ir, "lowpass", 6000)
        ir /= np.sqrt((ir ** 2).sum())
        src = x[:, ch] if x.ndim == 2 else x
        out.append(signal.fftconvolve(src, ir)[: len(src) + n])
    wet = np.stack(out, -1)
    dry = x if x.ndim == 2 else np.stack([x, x], -1)
    dry = np.concatenate([dry, np.zeros((n, 2))])
    m_ = min(len(dry), len(wet))
    dry, wet = dry[:m_], wet[:m_]
    return dry * (1 - mix) + wet * mix


# ------------------------------------------------------------------ instruments
def saw(f, t):
    return 2 * ((f * t) % 1.0) - 1


def pad_note(f, dur, cutoff=1300):
    t = tarr(dur)
    s = sum(saw(f * d, t + p) for d, p in ((1, 0), (1.004, 0.3), (0.996, 0.6))) / 3
    s = filt(s, "lowpass", cutoff)
    return s * adsr(len(t), 0.7, 0.9)


def ep_note(f, dur=1.6):
    t = tarr(dur)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6)
    s *= np.exp(-t * 2.4) * (1 + 0.15 * np.sin(2 * np.pi * 5 * t))
    return s * adsr(len(t), 0.004, 0.05)


def ep_long(f, dur=4.0, decay=0.9):
    t = tarr(dur)
    s = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t) * np.exp(-t * 4) + 0.05 * np.sin(6 * np.pi * f * t) * np.exp(-t * 8)
    s *= np.exp(-t * decay) * (1 + 0.08 * np.sin(2 * np.pi * 4.5 * t))
    return s * adsr(len(t), 0.006, 0.4)


def sine_bass(f, dur):
    t = tarr(dur)
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 0.8) * adsr(len(t), 0.01, 0.5)


def warm_pad(notes, dur):
    t = tarr(dur)
    s = sum(np.sin(2 * np.pi * midi(n) * t + i) + 0.3 * np.sin(2 * np.pi * midi(n) * 1.003 * t) for i, n in enumerate(notes)) / len(notes)
    env = np.clip(t / 1.5, 0, 1) * np.clip((dur - t) / 3.0, 0, 1)
    return s * env


def pluck(f, dur=0.18, cutoff=2600):
    t = tarr(dur)
    s = saw(f, t) * np.exp(-t * 22)
    return filt(s, "lowpass", cutoff) * adsr(len(t), 0.002, 0.02)


def bass_note(f, dur):
    t = tarr(dur)
    s = np.tanh(1.6 * np.sin(2 * np.pi * f * t)) * 0.8
    return s * adsr(len(t), 0.01, 0.12) * np.exp(-t * 0.6)


def kick(g=1.0):
    t = tarr(0.42)
    f = 46 + 90 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 7.5)
    s[:120] += RNG.normal(0, 0.3, 120) * np.linspace(1, 0, 120)
    return s * g


def snare(g=1.0):
    t = tarr(0.22)
    n = filt(RNG.normal(0, 1, len(t)), "bandpass", [1200, 6000]) * np.exp(-t * 18)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30)
    return (n * 0.7 + tone * 0.5) * g


def hat(g=1.0, dec=50):
    t = tarr(0.08)
    return filt(RNG.normal(0, 1, len(t)), "highpass", 7000) * np.exp(-t * dec) * g


def crackle(dur):
    n = int(dur * SR)
    x = np.zeros(n)
    idx = RNG.integers(0, n, int(dur * 9))
    x[idx] = RNG.normal(0, 1, len(idx))
    x = filt(x, "bandpass", [800, 5000])
    hiss = filt(RNG.normal(0, 0.02, n), "lowpass", 5000)
    return x * 0.5 + hiss


# ------------------------------------------------------------------ music
PROG_A = [(45, [57, 60, 64, 67, 71]), (41, [53, 57, 60, 64]), (48, [55, 60, 64, 67]), (43, [55, 59, 62, 64])]
PROG_C = [(45, [57, 60, 64, 67]), (41, [53, 57, 60, 64]), (38, [53, 57, 62, 65]), (40, [56, 59, 64, 68])]


def lofi(mx, t0, t1, bpm, prog, drums_from=None, bass_from=None, gain=1.0, darker=False):
    beat = 60 / bpm
    bar = 4 * beat
    nbars = int(math.ceil((t1 - t0) / bar))
    cut = 1100 if darker else 1400
    for b in range(nbars):
        bt = t0 + b * bar
        root, notes = prog[b % len(prog)]
        for n in notes:
            mx.add(bt, pad_note(midi(n), bar + 0.5, cut), 0.05 * gain, pan=RNG.uniform(-0.4, 0.4), bus="m")
        # electric piano arpeggio (sparse, swung)
        for k in range(8):
            if RNG.random() < 0.55:
                sw = 0.08 * beat if k % 2 else 0
                mx.add(bt + k * beat / 2 + sw, ep_note(midi(notes[k % len(notes)] + 12)), 0.07 * gain, pan=RNG.uniform(-0.5, 0.5), bus="m")
        if bass_from is not None and bt >= bass_from:
            mx.add(bt, bass_note(midi(root - 12 + 12), beat * 2.5), 0.16 * gain, bus="m")
            mx.add(bt + beat * 2.5, bass_note(midi(root), beat * 1.4), 0.12 * gain, bus="m")
        if drums_from is not None and bt >= drums_from - 1e-6:
            for k in range(4):
                if k in (0,):
                    mx.add(bt + k * beat, kick(), 0.32 * gain, bus="m")
                if k == 2:
                    mx.add(bt + k * beat + beat / 2, kick(0.8), 0.28 * gain, bus="m")
                if k in (1, 3):
                    mx.add(bt + k * beat, snare(), 0.13 * gain, pan=0.1, bus="m")
            for k in range(8):
                sw = 0.1 * beat if k % 2 else 0
                mx.add(bt + k * beat / 2 + sw, hat(0.8 if k % 2 == 0 else 0.5), 0.06 * gain, pan=0.3, bus="m")


def fast(mx, t0, t1, bpm=168):
    beat = 60 / bpm
    bar = 4 * beat
    nb = int(math.ceil((t1 - t0) / bar))
    for b in range(nb):
        bt = t0 + b * bar
        root, notes = PROG_A[b % 4]
        for n in notes[:4]:
            mx.add(bt, pad_note(midi(n), bar + 0.2, 1800), 0.035, bus="m")
        for k in range(16):
            n = notes[(k * 3) % len(notes)] + 12 * (1 + (k % 4 == 3))
            cutoff = 1500 + 2500 * ((b * 16 + k) / (nb * 16))
            mx.add(bt + k * beat / 4, pluck(midi(n), 0.16, cutoff), 0.07, pan=0.5 * math.sin(k), bus="m")
            mx.add(bt + k * beat / 4, hat(0.6 if k % 2 else 0.9, 70), 0.05, pan=0.3, bus="m")
        for k in range(4):
            mx.add(bt + k * beat, kick(), 0.3, bus="m")
            mx.add(bt + k * beat + beat / 2, bass_note(midi(root), beat / 2), 0.13, bus="m")
        mx.add(bt + beat, snare(), 0.1, bus="m")
        mx.add(bt + 3 * beat, snare(), 0.1, bus="m")


# ------------------------------------------------------------------ sfx
def key_click():
    t = tarr(0.03)
    n = filt(RNG.normal(0, 1, len(t)), "bandpass", [2000, 7000]) * np.exp(-t * 260)
    thock = np.sin(2 * np.pi * RNG.uniform(1500, 2100) * t) * np.exp(-t * 400) * 0.4
    return (n + thock) * RNG.uniform(0.6, 1.0)


def whoosh(dur=0.35, f0=600, f1=3000, up=True):
    t = tarr(dur)
    n = RNG.normal(0, 1, len(t))
    out = np.zeros_like(n)
    seg = 512
    for i in range(0, len(n), seg):
        x = i / len(n)
        fc = f0 + (f1 - f0) * (x if up else 1 - x)
        out[i:i + seg] = filt(n[i:i + seg], "bandpass", [fc * 0.7, min(fc * 1.4, 20000)])
    env = np.sin(np.pi * np.linspace(0, 1, len(t))) ** 2
    return out * env


def send_sfx():
    t = tarr(0.16)
    f = 500 + 900 * t / 0.16
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.16)
    return s * 0.6 + whoosh(0.16, 1500, 5000) * 0.3


def recv_sfx():
    out = np.zeros(int(0.35 * SR))
    for i, f in enumerate((1046.5, 1568)):
        t = tarr(0.25)
        s = np.sin(2 * np.pi * f * t) * np.exp(-t * 18)
        j = int(i * 0.07 * SR)
        out[j:j + len(s)] += s[: len(out) - j]
    return out


def buzz(dur=0.3):
    t = tarr(dur)
    s = np.sign(np.sin(2 * np.pi * 165 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 30 * t))
    return filt(s, "lowpass", 600) * adsr(len(t), 0.01, 0.04)


def scribble(dur, seed=0, rate=9.0, bright=1.0):
    rng = np.random.default_rng(seed)
    t = tarr(dur)
    n = filt(rng.normal(0, 1, len(t)), "bandpass", [1800, 7000 * bright if bright <= 1 else 7000])
    strokes = np.abs(np.sin(2 * np.pi * rate * t + rng.uniform(0, 3) + 0.6 * np.sin(2 * np.pi * 1.7 * t))) ** 1.5
    jitter = filt(rng.normal(0, 1, len(t)), "lowpass", 20)
    jitter = 0.6 + 0.4 * np.clip(jitter / (np.abs(jitter).max() + 1e-6), -1, 1)
    return n * strokes * jitter * adsr(len(t), 0.02, 0.05)


def knock(f=900, dec=90):
    t = tarr(0.08)
    s = np.sin(2 * np.pi * f * t) * np.exp(-t * dec) + filt(RNG.normal(0, 1, len(t)), "bandpass", [600, 3000]) * np.exp(-t * 200) * 0.6
    return s


def tick(high=True):
    t = tarr(0.05)
    f = 2600 if high else 2000
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 160) + filt(RNG.normal(0, 1, len(t)), "highpass", 3000) * np.exp(-t * 400) * 0.5)


def alert_sfx():
    parts = []
    def sq(f, d):
        t = tarr(d)
        return np.sign(np.sin(2 * np.pi * f * t)) * adsr(len(t), 0.003, 0.01) * 0.5
    out = np.zeros(int(1.2 * SR))
    for st, f, d in ((0.0, 740, 0.11), (0.16, 740, 0.11), (0.34, 466, 0.32)):
        s = filt(sq(f, d), "lowpass", 4000)
        i = int(st * SR)
        out[i:i + len(s)] += s
    return out


def boom(dur=2.5, f0=70, f1=32):
    t = tarr(dur)
    f = f1 + (f0 - f1) * np.exp(-t * 4)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    s += filt(RNG.normal(0, 1, len(t)), "lowpass", 400) * np.exp(-t * 9) * 0.5
    return s


def stab(notes, dur=2.0):
    t = tarr(dur)
    s = sum(saw(midi(n), t) for n in notes) / len(notes)
    s = filt(s, "lowpass", 2200) * np.exp(-t * 2.5) * adsr(len(t), 0.004, 0.2)
    return s


def drone(dur, freqs, amp_env):
    t = tarr(dur)
    s = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate(freqs)) / len(freqs)
    return s * amp_env(t, dur)


def riser(dur, f0=300, f1=4000):
    w = whoosh(dur, f0, f1)
    return w * np.linspace(0.2, 1, len(w)) ** 2


def roomtone(dur, seed=3, lp=500):
    rng = np.random.default_rng(seed)
    n = np.cumsum(rng.normal(0, 1, int(dur * SR)))
    n -= filt(n, "lowpass", 2)
    n = filt(n, "lowpass", lp)
    return n / (np.abs(n).max() + 1e-9)


def crickets(dur):
    t = tarr(dur)
    chirp = (np.sin(2 * np.pi * 4300 * t) * (np.sin(2 * np.pi * 28 * t) > 0.3)) * (np.sin(2 * np.pi * 0.9 * t) > 0.55)
    return filt(chirp, "bandpass", [3500, 5200])


# ------------------------------------------------------------------ build
def build(path):
    S = TL.START
    mx = Mix(TL.TOTAL)

    # ---- MUSIC
    lofi(mx, 0.0, 20.0, 84, PROG_A, drums_from=S["s2_chat_guia"], bass_from=4.0)
    fast(mx, 20.0, 28.0)
    lofi(mx, 28.0, 42.0, 84, PROG_C, drums_from=28.0, bass_from=28.0, darker=True)
    mx.add(0.0, crackle(42.0), 0.18, bus="m")
    m = mx.music
    # fades / cuts on the music bus
    def fade(a, b, v0, v1):
        i0, i1 = int(a * SR), int(b * SR)
        m[i0:i1] *= np.linspace(v0, v1, i1 - i0)[:, None]
    fade(0.0, 2.5, 0.0, 1.0)
    fade(19.75, 20.0, 1.0, 0.0)
    fade(27.8, 28.0, 1.0, 0.0)
    fade(28.0, 28.5, 0.0, 1.0)
    fade(41.98, 42.0, 1.0, 0.0)
    m[int(42.0 * SR):] = 0.0
    # tension drone in the classroom, cut on the freeze
    def denv(t, d):
        return np.clip(t / 6.0, 0, 1) * 0.9
    mx.add(52.0, drone(10.0, [midi(33), midi(34) * 1.0, midi(45)], denv), 0.10, bus="m")
    m[int(62.0 * SR):int(72.0 * SR)] = 0.0
    # final hit: clean low impact + soft electric-piano chord + reprise of the intro motif
    hit = S["s8_cierre"] + 0.12
    mx.add(hit, boom(3.2, 64, 34), 0.6, bus="m")
    outro = np.zeros(int(8.0 * SR))
    def put(t_, sig, g):
        i = int(t_ * SR)
        n = min(len(sig), len(outro) - i)
        outro[i:i + n] += sig[:n] * g
    put(0.0, sine_bass(midi(33), 4.5), 0.35)                       # A1 sub
    for j, n_ in enumerate((45, 52, 57, 60, 64, 71)):                # Am(add9) soft strum
        put(0.012 * j, ep_long(midi(n_), 5.0), 0.16)
    beat = 60 / 84
    for j, n_ in enumerate((69, 72, 76, 79, 76)):                    # A C E G E, like the intro
        put(1.3 + j * beat, ep_long(midi(n_), 3.0, 1.6), 0.10)
    put(0.3, warm_pad([45, 52, 57, 60], 7.4), 0.10)
    st = reverb(outro, 3.2, 0.42, 3)
    mx.add(hit, st, 0.55, bus="m")

    # ---- SFX
    # S1: night room, phone buzz, zoom whoosh
    mx.add(0.0, roomtone(8.0, lp=300), 0.05)
    mx.add(0.0, crickets(8.0), 0.012, pan=-0.6)
    mx.add(4.2, buzz(0.28), 0.22)
    mx.add(4.62, buzz(0.28), 0.22)
    mx.add(6.6, riser(1.45, 300, 3000), 0.18)

    # S2 typing
    s2 = S["s2_chat_guia"]
    for tt in TL.S2["type"]:
        mx.add(s2 + tt, key_click(), 0.22, pan=RNG.uniform(-0.15, 0.15))
    mx.add(s2 + TL.S2["send"], send_sfx(), 0.22)
    mx.add(s2 + TL.S2["stream_t0"], recv_sfx(), 0.16)

    # S3 fast-forward copying
    s3 = S["s3_copia"]
    mx.add(s3, whoosh(0.5, 3000, 300, up=False), 0.2)
    for i, (a, b) in enumerate(TL.S3["lines"]):
        mx.add(s3 + a, scribble(b - a, seed=i, rate=16), 0.11, pan=-0.1)
    mx.add(s3 + TL.S3["drop"] + 0.25, knock(700, 60), 0.25)
    mx.add(s3 + TL.S3["drop"] + 0.33, knock(950, 90), 0.12)

    # S4 typing + riser to the cut
    s4 = S["s4_chat_libro"]
    for tt in TL.S4["type"]:
        mx.add(s4 + tt, key_click(), 0.22, pan=RNG.uniform(-0.15, 0.15))
    mx.add(s4 + TL.S4["send"], send_sfx(), 0.22)
    mx.add(s4 + TL.S4["stream_t0"], recv_sfx(), 0.16)
    mx.add(s4 + TL.S4["zoom"][0], whoosh(0.9, 400, 1800), 0.1)
    mx.add(s4 + 11.6, riser(2.4, 200, 6000), 0.16)

    # S5 alert
    s5 = S["s5_alerta"]
    glitch = filt(RNG.normal(0, 1, int(0.28 * SR)), "bandpass", [300, 6000])
    glitch = np.round(glitch * 4) / 4
    mx.add(s5, glitch, 0.18)
    mx.add(s5 + 0.1, alert_sfx(), 0.28)
    mx.add(s5, boom(2.5, 60, 30), 0.55)
    mx.add(s5 + 0.3, drone(5.4, [55, 58.3], lambda t, d: np.clip(t / 1.5, 0, 1) * np.clip((d - t) / 1.0, 0, 1)), 0.12)

    # S6 classroom
    s6 = S["s6_prueba"]
    mx.add(s6 + 1.6, roomtone(12.4, seed=8, lp=900), 0.07)
    k = 0
    tt = s6 + TL.S6["tick_from"]
    while tt < S["s7_dato"] - 0.05:
        mx.add(tt, tick(k % 2 == 0), 0.16 + 0.06 * (tt - s6) / 14, pan=0.35)
        tt += 1.0
        k += 1
    a, b = TL.S6["write"]
    mx.add(s6 + a, scribble(b - a, seed=40, rate=7), 0.1)
    for tp in TL.S6["taps"]:
        mx.add(s6 + tp, knock(1200, 120), 0.18)
    a, b = TL.S6["cross"]
    mx.add(s6 + a, scribble(b - a + 0.1, seed=41, rate=11), 0.14)

    # S7 freeze + stat
    s7 = S["s7_dato"]
    mx.add(s7, boom(1.6, 90, 40), 0.35)
    mx.add(s7, filt(RNG.normal(0, 1, int(0.06 * SR)), "highpass", 2500) * np.exp(-tarr(0.06) * 60), 0.2)
    for i in range(17):
        mx.add(s7 + 1.4 + 1.2 * (1 - (1 - i / 16) ** 0.33), tick(True), 0.07)
    mx.add(s7 + 2.55, boom(1.8, 75, 38), 0.35)
    mx.add(s7 + 0.6, drone(9.0, [midi(45), midi(52)], lambda t, d: np.clip(t / 2, 0, 1) * np.clip((d - t) / 2, 0, 1)), 0.04)

    # ---- master
    mus = reverb(mx.music, 1.4, 0.18, 9)
    out = mx.buf + mus[: len(mx.buf)]
    out = out[: int(TL.TOTAL * SR)]
    # tail fade
    n = int(0.5 * SR)
    out[-n:] *= np.linspace(1, 0, n)[:, None]
    peak = np.abs(out).max()
    out = out / peak * 0.89
    pcm = (out * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("audio:", path, f"{len(out) / SR:.2f}s, peak before norm {peak:.2f}")
    return path


if __name__ == "__main__":
    build("out/audio.wav")
