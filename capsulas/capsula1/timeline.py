"""Single source of timing truth, shared by the video scenes and the audio mix.
All times inside a segment are LOCAL seconds (0 = segment start)."""
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = json.load(open(os.path.join(HERE, "plan.json"), encoding="utf-8"))

SEGS = PLAN["segments"]
START = {}
_t = 0.0
for s in SEGS:
    START[s["id"]] = _t
    _t += s["dur"]
TOTAL = _t
DUR = {s["id"]: s["dur"] for s in SEGS}


def typing_times(text, t0, cps, seed):
    """Return list of times at which each character appears."""
    rng = random.Random(seed)
    times, t = [], t0
    for ch in text:
        t += (1.0 / cps) * rng.uniform(0.55, 1.45)
        if ch == " ":
            t += rng.uniform(0.0, 0.05)
        times.append(t)
    return times


# ---- S2: chat, first request
S2 = dict(
    type_t0=0.95,
    cps=13.0,
    send=None,
    dots=(None, None),
    stream_t0=None,
    stream_wps=11.0,
)
S2["type"] = typing_times(PLAN["chat"]["msg1_user"], S2["type_t0"], S2["cps"], 11)
S2["send"] = S2["type"][-1] + 0.35
S2["dots"] = (S2["send"] + 0.35, S2["send"] + 1.35)
S2["stream_t0"] = S2["dots"][1]

# ---- S4: chat, second request
S4 = dict(type_t0=0.55, cps=19.0, stream_wps=17.0, zoom=(10.9, 12.5))
S4["type"] = typing_times(PLAN["chat"]["msg2_user"], S4["type_t0"], S4["cps"], 23)
S4["send"] = S4["type"][-1] + 0.3
S4["dots"] = (S4["send"] + 0.3, S4["send"] + 1.2)
S4["stream_t0"] = S4["dots"][1]

# ---- S3: fast-forward copying
S3 = dict(write_t0=0.35, write_t1=5.7, drop=5.95, clock=("23:52", "00:38"))
_n = len(PLAN["copia_lines"])
_span = (S3["write_t1"] - S3["write_t0"]) / _n
S3["lines"] = [(S3["write_t0"] + i * _span, S3["write_t0"] + (i + 0.86) * _span) for i in range(_n)]

# ---- S6: the test
S6 = dict(
    intro=(0.0, 2.2),          # black card "Al día siguiente…"
    fade_in=(2.05, 3.0),
    write=(6.2, 7.6),          # writes "f(4) = 2·"
    taps=[8.3, 8.75, 9.2, 10.4, 10.85],
    cross=(12.1, 12.6),        # crosses it out
    tick_from=2.0,
)


def stream_tokens_visible(t, t0, wps, n_tokens):
    if t < t0:
        return 0
    return min(n_tokens, int((t - t0) * wps) + 1)
