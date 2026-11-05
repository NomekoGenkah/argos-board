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


# ------------------------------------------------------------------ cápsula 2 sounds
VOWELS = [(730, 1090, 2440), (530, 1840, 2480), (300, 2200, 2900), (570, 840, 2410), (330, 900, 2240)]


def voice(dur, f0, seed, rate=5.0, energy=1.0):
    """Unintelligible speech: a glottal-ish source shaped by changing vowel formants, syllable by syllable."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    pos = 0.0
    while pos < dur - 0.08:
        L = rng.uniform(0.6, 1.4) / rate
        i0, i1 = int(pos * SR), min(n, int((pos + L) * SR))
        tt = t[i0:i1] - pos
        f = f0 * (1 + energy * 0.18 * rng.uniform(-1, 1) + 0.12 * np.sin(2 * np.pi * rng.uniform(0.5, 1.5) * tt))
        ph = np.cumsum(f) / SR
        src = 2 * (ph % 1.0) - 1 + 0.02 * rng.normal(0, 1, len(tt))
        F = VOWELS[rng.integers(0, len(VOWELS))]
        seg = sum(g * filt(src, "bandpass", [fr * 0.88, fr * 1.12]) for fr, g in zip(F, (1.0, 0.55, 0.25)))
        env = np.sin(np.pi * np.clip(tt / L, 0, 1)) ** 0.7
        out[i0:i1] += seg * env * rng.uniform(0.6, 1.0)
        pos += L + (rng.uniform(0.15, 0.4) if rng.random() < 0.18 else rng.uniform(0.0, 0.05))
    out = filt(out, "lowpass", 1700)
    return out / (np.abs(out).max() + 1e-9)


def footstep(surface="concrete", g=1.0):
    t = tarr(0.16)
    if surface == "concrete":
        n = filt(RNG.normal(0, 1, len(t)), "bandpass", [700, 5000]) * np.exp(-t * 45)
        th = np.sin(2 * np.pi * 110 * t) * np.exp(-t * 40) * 0.6
    else:
        n = filt(RNG.normal(0, 1, len(t)), "bandpass", [200, 1800]) * np.exp(-t * 35)
        th = np.sin(2 * np.pi * 90 * t) * np.exp(-t * 30) * 0.9
    return (n + th) * g * RNG.uniform(0.75, 1.0)


def door_slam():
    t = tarr(0.9)
    thump = np.sin(2 * np.pi * (60 + 50 * np.exp(-t * 30)) * t) * np.exp(-t * 9)
    body = filt(RNG.normal(0, 1, len(t)), "bandpass", [120, 900]) * np.exp(-t * 14) * 0.7
    latch = np.zeros(len(t))
    k = filt(RNG.normal(0, 1, int(0.02 * SR)), "highpass", 2500) * np.exp(-tarr(0.02) * 200)
    latch[int(0.04 * SR):int(0.04 * SR) + len(k)] += k * 0.5
    return thump + body + latch


def door_knock():
    t = tarr(0.18)
    s = np.sin(2 * np.pi * 210 * t) * np.exp(-t * 38) + np.sin(2 * np.pi * 420 * t) * np.exp(-t * 60) * 0.4
    s += filt(RNG.normal(0, 1, len(t)), "bandpass", [300, 2500]) * np.exp(-t * 90) * 0.7
    return s


def message_ping():
    out = np.zeros(int(0.6 * SR))
    for i, f in enumerate((1175, 1568, 2093)):
        t = tarr(0.4)
        s = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 11)
        j = int(i * 0.075 * SR)
        out[j:j + len(s)] += s[: len(out) - j]
    return out


def ambience_yard(dur, seed=21):
    rng = np.random.default_rng(seed)
    wind = roomtone(dur, seed, lp=400) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * tarr(dur)))
    kids = np.zeros(int(dur * SR))
    for i in range(6):
        v = voice(dur, rng.uniform(230, 330), seed + i, rate=rng.uniform(4, 6), energy=1.3)
        kids += v * rng.uniform(0.3, 1.0)
    kids = filt(kids, "lowpass", 1100) / 6
    birds = np.zeros(int(dur * SR))
    for _ in range(int(dur * 0.8)):
        st = rng.uniform(0, dur - 0.4)
        tt = tarr(0.12)
        f = rng.uniform(3200, 4200) * (1 + 0.3 * np.sin(2 * np.pi * 18 * tt))
        ch = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / 0.12)
        i = int(st * SR)
        birds[i:i + len(ch)] += ch
    return wind * 0.6 + kids * 0.9, birds


# ------------------------------------------------------------------ cápsula 3 sounds
def heartbeat():
    t = tarr(0.7)
    lub = np.sin(2 * np.pi * (48 + 30 * np.exp(-t * 30)) * t) * np.exp(-t * 16)
    dub = np.zeros_like(lub)
    i = int(0.26 * SR)
    t2 = np.arange(len(lub) - i) / SR
    dub[i:] = np.sin(2 * np.pi * (42 + 20 * np.exp(-t2 * 30)) * t2) * np.exp(-t2 * 18) * 0.7
    return filt(lub + dub, "lowpass", 160)


def breath(inhale=True, dur=0.7, seed=0):
    rng = np.random.default_rng(seed)
    t = tarr(dur)
    n = rng.normal(0, 1, len(t))
    band = [500, 2200] if inhale else [300, 1300]
    x = filt(n, "bandpass", band)
    env = np.sin(np.pi * t / dur) ** (1.6 if inhale else 1.2)
    return x * env


def laugh(dur, f0, seed):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    pos = 0.0
    k = 0
    while pos < dur - 0.12:
        L = rng.uniform(0.07, 0.11)
        tt = tarr(L)
        f = f0 * (1.25 - 0.25 * pos / dur) * (1 + 0.05 * rng.normal())
        src = 2 * ((np.cumsum(np.full(len(tt), f)) / SR) % 1) - 1
        voiced = sum(g * filt(src, "bandpass", [fr * 0.85, fr * 1.15]) for fr, g in ((800, 1.0), (1250, 0.6), (2600, 0.25)))
        asp = filt(rng.normal(0, 1, len(tt)), "bandpass", [900, 3200]) * 0.5
        env = np.sin(np.pi * tt / L) ** 0.8
        i = int(pos * SR)
        seg = (voiced + asp) * env * (0.95 ** k)
        out[i:i + len(seg)] += seg[: n - i]
        pos += L + rng.uniform(0.05, 0.1)
        k += 1
        if rng.random() < 0.12:
            pos += rng.uniform(0.2, 0.35)
    return out / (np.abs(out).max() + 1e-9)


def pop():
    t = tarr(0.09)
    f = 900 + 500 * np.exp(-t * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 45)


def car_pass(dur=3.2):
    t = tarr(dur)
    n = filt(RNG.normal(0, 1, len(t)), "lowpass", 900) + 0.3 * np.sin(2 * np.pi * 70 * t)
    env = np.exp(-((t - dur * 0.45) / (dur * 0.22)) ** 2)
    pan = np.clip((t - dur * 0.45) / (dur * 0.5), -1, 1)
    l = n * env * np.sqrt((1 + pan) / 2)
    r = n * env * np.sqrt((1 - pan) / 2)
    return np.stack([l, r], -1)


def outro_hit(mx, hit):
    """Same closing hit as cápsulas 1 and 2."""
    mx.add(hit, boom(3.2, 64, 34), 0.6, bus="m")
    outro = np.zeros(int(8.0 * SR))

    def put(t_, sig, g):
        i = int(t_ * SR)
        n = min(len(sig), len(outro) - i)
        outro[i:i + n] += sig[:n] * g
    put(0.0, sine_bass(midi(33), 4.5), 0.35)
    for j, n_ in enumerate((45, 52, 57, 60, 64, 71)):
        put(0.012 * j, ep_long(midi(n_), 5.0), 0.16)
    beat = 60 / 84
    for j, n_ in enumerate((69, 72, 76, 79, 76)):
        put(1.3 + j * beat, ep_long(midi(n_), 3.0, 1.6), 0.10)
    put(0.3, warm_pad([45, 52, 57, 60], 7.4), 0.10)
    mx.add(hit, reverb(outro, 3.2, 0.42, 3), 0.55, bus="m")


# ------------------------------------------------------------------ build
def build(path):
    S = TL.START
    mx = Mix(TL.TOTAL)
    s2, s3, s4, s5, s6, s7 = (S[k] for k in ("s2_grupo", "s3_reenviar", "s4_pasillo", "s5_reenvias", "s6_dato", "s7_cierre"))

    # ---------- MUSIC: soft urban beat in his headphones, until the chat turns ugly
    lofi(mx, 0.0, s3, 88, PROG_A, drums_from=0.0, bass_from=0.0, gain=0.9)
    m = mx.music
    m[: int(1.2 * SR)] *= np.linspace(0, 1, int(1.2 * SR))[:, None]
    a, b = int((s2 + 2.0) * SR), int((s2 + 5.0) * SR)
    m[a:b] *= np.linspace(1, 0.55, b - a)[:, None]
    m[b:int(s3 * SR)] *= 0.55
    a, b = int((s2 + 8.0) * SR), int((s2 + 12.0) * SR)
    m[a:b] *= np.linspace(1, 0, b - a)[:, None]
    m[b:] = 0.0
    # low tension drone under the thumb / corridor
    mx.add(s2 + 9.0, drone(18.0, [midi(33), midi(34)], lambda t, d: np.clip(t / 4, 0, 1) * np.clip((d - t) / 3, 0, 1)), 0.05, bus="m")
    outro_hit(mx, s7 + 0.12)

    # ---------- SFX
    # S1: street
    mx.add(0.0, roomtone(8.0, seed=51, lp=500), 0.05)
    mx.add(1.2, car_pass(3.4), 0.12)
    tt = 0.2
    while tt < TL.S1["walk"][1]:
        mx.add(tt, footstep("concrete"), 0.12)
        tt += TL.S1["steps_every"]
    mx.add(TL.S1["buzz"], buzz(0.25), 0.2)
    mx.add(TL.S1["buzz"] + 0.4, buzz(0.25), 0.2)
    # S2: the burst of group messages
    mx.add(s2, roomtone(17.0, seed=52, lp=400), 0.04)
    for i, ta in enumerate(TL.S2["arrive"]):
        mx.add(s2 + ta, pop(), 0.2, pan=RNG.uniform(-0.2, 0.2))
        mx.add(s2 + ta, buzz(0.12), 0.06)
    # S3 + S5: heartbeat under the thumb
    hb = 0.95
    tt = s3 + TL.S3["heartbeat_from"]
    while tt < s4 - 0.2:
        mx.add(tt, heartbeat(), 0.4)
        tt += hb
    mx.add(s3, roomtone(10.0, seed=53, lp=300), 0.035)
    # S4: corridor, laughter, then the world goes quiet and only breathing is left
    T4 = TL.S4
    amb = np.zeros(int(15 * SR))
    rng = np.random.default_rng(60)
    for i in range(7):
        v = voice(15.0, rng.uniform(150, 300), 300 + i, rate=rng.uniform(4, 6), energy=1.0)
        amb += v * rng.uniform(0.4, 1.0)
    amb = filt(amb / 7, "lowpass", 1400) + roomtone(15.0, seed=61, lp=600) * 0.5
    env = np.ones(len(amb))
    q0, q1 = int(T4["silence"][0] * SR), int(T4["silence"][1] * SR)
    env[q0:q1] = np.linspace(1, 0, q1 - q0)
    env[q1:] = 0.0
    env[: int(0.5 * SR)] *= np.linspace(0, 1, int(0.5 * SR))
    mx.add(s4, amb * env, 0.16)
    tt = s4 + 0.1
    while tt < s4 + T4["m_walk1"][1]:
        mx.add(tt, footstep("concrete"), 0.1 * (1 - 0.0))
        tt += 0.5
    mx.add(s4 + T4["laugh"][0] + 0.4, reverb(laugh(1.8, 210, 1), 0.8, 0.25, 7) * np.array([0.75, 1.0]), 0.11)
    mx.add(s4 + T4["laugh"][0] + 0.7, reverb(laugh(1.6, 175, 2), 0.8, 0.25, 8) * np.array([1.0, 0.8]), 0.10)
    # breathing, getting shorter
    tt = s4 + T4["look"][0] + 0.2
    k = 0
    while tt < s4 + T4["m_walk2"][1]:
        d_in = max(0.38, 0.62 - 0.04 * k)
        mx.add(tt, breath(True, d_in, k), 0.06)
        mx.add(tt + d_in + 0.05, breath(False, d_in + 0.1, 100 + k), 0.06)
        tt += 2 * d_in + 0.35
        k += 1
    tt = s4 + T4["m_walk2"][0] + 0.1
    while tt < s4 + T4["m_walk2"][1]:
        mx.add(tt, filt(footstep("concrete"), "lowpass", 700), 0.12)
        tt += 0.36
    # S5: heartbeat until the freeze, then silence
    fz = s5 + TL.S5["freeze"]
    tt = s5 + 0.1
    while tt < fz - 0.3:
        mx.add(tt, heartbeat(), 0.4)
        tt += hb
    mx.add(fz, filt(RNG.normal(0, 1, int(0.06 * SR)), "highpass", 2500) * np.exp(-tarr(0.06) * 60), 0.18)
    mx.add(fz, boom(1.6, 80, 36), 0.25)
    mx.add(s5, roomtone(s7 - s5, seed=70, lp=250), 0.018)
    # S6: statistic
    for i in range(8):
        mx.add(s6 + 0.2 + i * 0.07, tick(i == 0), 0.07)
    mx.add(s6 + 0.8, boom(1.8, 75, 38), 0.3)

    # ---------- master
    mus = reverb(mx.music, 1.4, 0.18, 9)
    out = mx.buf + mus[: len(mx.buf)]
    out = out[: int(TL.TOTAL * SR)]
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
