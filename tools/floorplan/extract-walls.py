"""Turn a floor plan into metred, axis-aligned wall rectangles.

Two sources are supported, and they share every step after the mask:

  --mode mask    consume a binary wall mask (PNG). This is the output format of
                 all three candidate projects, so a model can be dropped in
                 without touching this file.
  --mode weight  derive the mask from the raster itself, using stroke weight.
                 Works today, with no model and no weights: in a drafted plan
                 the heavy strokes are the cut structure.

Output is JSON in metres, ready for the plan.html harness.

Usage:
  python tools/floorplan/extract-walls.py --image plan.jpg --mode weight \
      --venue 7.2 8.0 --calibration 47 227 1017 1316 --out walls.json
  python tools/floorplan/extract-walls.py --mask wall.png --mode mask \
      --venue 20 10.4 --calibration 130 345 1093 855 --out walls.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def load_grey(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8)


def stroke_width(mask: np.ndarray) -> np.ndarray:
    """Per-pixel min(horizontal run, vertical run): the stroke width at that pixel."""
    h, w = mask.shape
    out = np.zeros((h, w), dtype=np.int32)
    for y in range(h):
        row = mask[y]
        x = 0
        while x < w:
            if row[x]:
                x2 = x
                while x2 < w and row[x2]:
                    x2 += 1
                out[y, x:x2] = x2 - x
                x = x2
            else:
                x += 1
    v = np.zeros((h, w), dtype=np.int32)
    for x in range(w):
        y = 0
        while y < h:
            if mask[y, x]:
                y2 = y
                while y2 < h and mask[y2, x]:
                    y2 += 1
                v[y:y2, x] = y2 - y
                y = y2
            else:
                y += 1
    return np.minimum(out, v)


def runs_of(values: np.ndarray, min_len: int, bridge: int) -> list[tuple[int, int]]:
    out = []
    start = None
    gap = 0
    n = len(values)
    for i in range(n):
        if values[i]:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap > bridge:
                out.append((start, i - gap))
                start = None
                gap = 0
    if start is not None:
        out.append((start, n - 1))
    return [(a, b) for a, b in out if b - a + 1 >= min_len]


def bands(mask: np.ndarray, min_len: int, bridge: int, along_x: bool, slack: int = 1) -> list[dict]:
    """Group long runs into bands, tracking the perpendicular extent (thickness).

    `slack` is how many rows/columns a run may sit past a band's edge and still
    join it. Keep it small: a gap in the drawing is not a thicker wall.
    """
    outer = mask.shape[0] if along_x else mask.shape[1]
    found: list[dict] = []
    for a in range(outer):
        values = mask[a] if along_x else mask[:, a]
        for s, e in runs_of(values, min_len, bridge):
            for b in found:
                if b["a1"] + slack >= a and min(e, b["i1"]) - max(s, b["i0"]) > (e - s) * 0.6:
                    b["a1"] = max(b["a1"], a)
                    b["i0"] = min(b["i0"], s)
                    b["i1"] = max(b["i1"], e)
                    break
            else:
                found.append({"a0": a, "a1": a, "i0": s, "i1": e})
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--image", help="raster to read (required for --mode weight)")
    ap.add_argument("--mask", help="binary wall mask PNG (required for --mode mask)")
    ap.add_argument("--mode", choices=("weight", "mask"), default="weight")
    ap.add_argument("--venue", nargs=2, type=float, metavar=("WIDTH", "DEPTH"), required=True)
    ap.add_argument("--calibration", nargs=4, type=int, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"), required=True)
    ap.add_argument("--ink", type=int, default=200, help="grey level below which a pixel is ink (weight mode)")
    ap.add_argument("--heavy", type=int, default=3, help="stroke width at or above which a stroke is structure (weight mode)")
    ap.add_argument("--mask-threshold", type=float, default=0.5, help="probability cut for a mask (mask mode)")
    ap.add_argument("--min-len", type=float, default=0.7, help="shortest wall, in metres")
    ap.add_argument("--bridge", type=int, default=3, help="gap bridged within one drawn line, px")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    left, top, right, bottom = args.calibration
    width_m, depth_m = args.venue
    span_x, span_z = right - left, bottom - top
    mx, mz = width_m / span_x, depth_m / span_z
    min_len_px = int(args.min_len / max(mx, mz))

    if args.mode == "mask":
        if not args.mask:
            ap.error("--mask is required with --mode mask")
        probs = load_grey(args.mask).astype(np.float32) / 255.0
        source = probs > args.mask_threshold
        origin = "mask"
    else:
        if not args.image:
            ap.error("--image is required with --mode weight")
        grey = load_grey(args.image)
        ink = grey < args.ink
        widths = stroke_width(ink)
        source = ink & (widths >= args.heavy)
        origin = f"weight(ink<{args.ink}, >= {args.heavy}px)"

    print(f"source      {origin}")
    print(f"calibration x {left}..{right}, y {top}..{bottom}"
          f"  ->  {width_m} x {depth_m} m   ({mx:.5f} m/px in x, {mz:.5f} m/px in z)")
    print(f"structure   {int(source.sum())} px, min wall length {args.min_len} m = {min_len_px} px")
    if args.mode == "weight":
        print(f"note        aspect check: {(span_x / span_z) / (width_m / depth_m):.3f}"
              f"  (1.000 means the calibration rectangle has the venue's proportions)")

    result = {"venue": {"width": width_m, "depth": depth_m},
              "calibration": {"left": left, "top": top, "right": right, "bottom": bottom},
              "source": origin, "walls": []}

    for along_x, kind in ((True, "horizontal"), (False, "vertical")):
        for b in bands(source, min_len_px, args.bridge, along_x):
            t = b["a1"] - b["a0"] + 1
            # a* is the across-wall axis (row index for horizontal walls), i* runs along it.
            # Indices are absolute raster pixels, so subtract the calibration origin.
            i_lo, i_hi = b["i0"] - (left if along_x else top), b["i1"] + 1 - (left if along_x else top)
            a_lo, a_hi = b["a0"] - (top if along_x else left), b["a1"] + 1 - (top if along_x else left)
            mx_range = (i_lo * mx, i_hi * mx) if along_x else (a_lo * mx, a_hi * mx)
            mz_range = (a_lo * mz, a_hi * mz) if along_x else (i_lo * mz, i_hi * mz)
            # The raster usually carries a title block or notes outside the plan;
            # those runs are not structure.
            if mx_range[1] <= 0 or mx_range[0] >= width_m or mz_range[1] <= 0 or mz_range[0] >= depth_m:
                continue
            result["walls"].append({
                "kind": kind,
                "px": {"a0": b["a0"], "a1": b["a1"], "i0": b["i0"], "i1": b["i1"]},
                "metres": {"x": [round(max(0.0, mx_range[0]), 3), round(min(width_m, mx_range[1]), 3)],
                           "z": [round(max(0.0, mz_range[0]), 3), round(min(depth_m, mz_range[1]), 3)]},
                "thickness_m": round(t * (mz if along_x else mx), 3),
            })

    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"walls       {len(result['walls'])} axis-aligned band(s) -> {args.out}")
    for w in result["walls"]:
        m = w["metres"]
        print(f"  {w['kind']:<10} x {m['x'][0]:6.2f}..{m['x'][1]:6.2f}  z {m['z'][0]:6.2f}..{m['z'][1]:6.2f}"
              f"   t={w['thickness_m']:.2f} m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
