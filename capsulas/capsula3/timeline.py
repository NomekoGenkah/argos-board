"""Single source of timing truth, shared by the video scenes and the audio mix.
All times inside a segment are LOCAL seconds (0 = segment start)."""
import json
import os

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

# ---- S1: walking to school
S1 = dict(walk=(0.0, 6.4), buzz=6.0, steps_every=0.46)

# ---- S2: group chat burst (arrival time of each message, in order)
S2 = dict(arrive=[1.0, 1.7, 3.3, 4.1, 4.9, 8.2], zoom_img=(10.0, 11.4), unzoom=(14.2, 15.6))

# ---- S3: long press -> menu, thumb hovers over "Reenviar", Martina walks in behind
S3 = dict(menu=(0.2, 0.6), thumb_in=(0.8, 1.6), martina_walk=(2.0, 9.5), heartbeat_from=0.4)

# ---- S4: corridor
S4 = dict(
    m_walk1=(0.0, 6.2),       # Martina walks along the corridor, passes the two students
    laugh=(4.0, 6.4),         # they look at the phone, look at her, laugh
    phone=(6.6, 7.2),         # she takes out her phone
    look=(7.2, 10.2),         # she reads; the corridor sound fades, only breathing
    silence=(7.0, 8.6),
    turn=(10.2, 10.7),
    m_walk2=(10.6, 14.5),     # walks away fast
)

# ---- S5: back to the thumb, freeze, question
S5 = dict(freeze=2.0, question=(2.6, 3.2))
