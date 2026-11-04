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


def typing_times(text, t0, cps, seed, pause_after=None, pause=0.0):
    """Times at which each character appears. `pause_after` = substring after which Benja hesitates."""
    rng = random.Random(seed)
    cut = text.find(pause_after) + len(pause_after) if pause_after else -1
    times, t = [], t0
    for i, ch in enumerate(text):
        t += (1.0 / cps) * rng.uniform(0.55, 1.5)
        if ch == " ":
            t += rng.uniform(0.0, 0.08)
        if i == cut:
            t += pause
        times.append(t)
    return times


def stream_tokens_visible(t, t0, wps, n_tokens):
    if t < t0:
        return 0
    return min(n_tokens, int((t - t0) * wps) + 1)


C = PLAN["chat"]

# ---- S1: patio
S1 = dict(
    argue=(0.3, 6.0),
    turn=(5.6, 6.4),           # Tomás turns away
    walk=(6.2, 9.4),           # and walks out of frame
    steps_every=0.42,
)

# ---- S2: house
S2 = dict(
    front_close=(0.0, 0.7),
    walk=(0.4, 5.3),
    door_close=(5.9, 6.35),    # soft slam
)

# ---- S3: chat
S3 = dict(u1_t0=1.0, u1_cps=12.0, wps1=8.0, u2_cps=11.0, wps2=7.0)
S3["u1"] = typing_times(C["u1"], S3["u1_t0"], S3["u1_cps"], 5, pause_after="Tomás.", pause=0.8)
S3["send1"] = S3["u1"][-1] + 0.35
S3["dots1"] = (S3["send1"] + 0.3, S3["send1"] + 1.4)
S3["a1_t0"] = S3["dots1"][1]
S3["u2_t0"] = S3["a1_t0"] + 3.0
S3["u2"] = typing_times(C["u2"], S3["u2_t0"], S3["u2_cps"], 9)
S3["send2"] = S3["u2"][-1] + 0.35
S3["dots2"] = (S3["send2"] + 0.3, S3["send2"] + 1.4)
S3["a2_t0"] = S3["dots2"][1]
_a2_end = S3["a2_t0"] + len(C["a2"].split()) / S3["wps2"]
S3["zoom"] = (_a2_end + 0.45, _a2_end + 2.0)

# ---- S4: notification
S4 = dict(cam_up=(0.0, 1.4), drop=(1.6, 1.95), touch=(6.3, 6.6), swipe=(6.75, 7.15), cam_down=(7.4, 9.0))

# ---- S5: door
S5 = dict(knocks=[0.6, 0.86, 1.12], look=(1.35, 1.9), back=(5.2, 5.8))

# ---- S6: close-up + statistic
S6 = dict(freeze=2.0)
