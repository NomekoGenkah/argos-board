#!/usr/bin/env python3
"""Build Cápsula 2 'La noche'.

  python3 build.py                 # render every segment, audio, and the final mp4
  python3 build.py --only s3_chat  # re-render one segment, then re-assemble
  python3 build.py --assemble      # only re-mix audio + subtitles + concat (no frame rendering)
  python3 build.py --still s5_puerta 1.5   # write out/still.png for a quick look

Each segment is rendered to its own out/seg_<id>.mp4 (frames are streamed to ffmpeg one by one,
so memory stays low), then the segments are concatenated without re-encoding, and a last pass
adds the audio and burns in subs.srt.
"""
import argparse
import os
import subprocess
import sys
import time
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.chdir(HERE)

import timeline as TL  # noqa: E402
from common import W, H, FPS  # noqa: E402

OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)


def scene_fn(seg_id):
    import scene_patio, scene_casa, scene_chat, scene_cards
    return {
        "s1_patio": scene_patio.s1_frame,
        "s2_casa": scene_casa.s2_frame,
        "s3_chat": scene_chat.s3_frame,
        "s4_notif": scene_chat.s4_frame,
        "s5_puerta": scene_casa.s5_frame,
        "s6_dato": scene_cards.s6_frame,
        "s7_cierre": scene_cards.s7_frame,
    }[seg_id]


def run(cmd):
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def render_segment(seg_id):
    fn = scene_fn(seg_id)
    n = int(round(TL.DUR[seg_id] * FPS))
    path = os.path.join(OUT, f"seg_{seg_id}.mp4")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p",
           "-threads", "2", path]
    print(f"[{seg_id}] {n} frames ->", " ".join(cmd), flush=True)
    t0 = time.time()
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        img = fn(i / FPS)
        p.stdin.write(img.convert("RGB").tobytes())
    p.stdin.close()
    p.wait()
    print(f"[{seg_id}] done in {time.time() - t0:.1f}s", flush=True)
    return path


def warm_caches():
    """Build the big cached canvases once, before parallel rendering."""
    import scene_patio, scene_casa, scene_chat
    scene_patio.canvas()
    scene_casa.plan_assets()
    scene_casa.bedroom_assets()
    scene_chat.background()


def assemble():
    import audio
    wav = audio.build(os.path.join(OUT, "audio.wav"))
    lst = os.path.join(OUT, "concat.txt")
    with open(lst, "w") as f:
        for s in TL.SEGS:
            f.write(f"file 'seg_{s['id']}.mp4'\n")
    joined = os.path.join(OUT, "video_noaudio.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", joined])
    # SRT is scaled to a 288-px-high canvas by libass: FontSize 13 ≈ 49 px at 1080p.
    style = ("FontName=Inter SemiBold,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H60000000,"
             "BackColour=&H60000000,BorderStyle=3,Outline=1.2,Shadow=0,MarginV=20,Alignment=2")
    final = os.path.join(HERE, TL.PLAN["output"]["file"])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", joined, "-i", wav,
         "-vf", f"subtitles=subs.srt:force_style='{style}'",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000",
         "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final])
    print("FINAL:", final)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--assemble", action="store_true")
    ap.add_argument("--still", nargs=2)
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    if a.still:
        warm_caches()
        img = scene_fn(a.still[0])(float(a.still[1]))
        img.save(os.path.join(OUT, "still.png"))
        print("wrote out/still.png")
        return
    if not a.assemble:
        segs = a.only or [s["id"] for s in TL.SEGS]
        warm_caches()
        with Pool(min(a.jobs, len(segs))) as pool:
            pool.map(render_segment, segs, chunksize=1)
    assemble()


if __name__ == "__main__":
    main()
