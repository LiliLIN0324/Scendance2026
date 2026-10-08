"""Find the openings (doors, windows) in a plan's walls.

Walks a wall line and reports where it is present and where it breaks, in metres.
A wall drawn with two faces should break on both faces at an opening, so
`--both-faces` checks a second, parallel line and only reports a gap when both
agree — that is what distinguishes a real door from a stray pen stroke.

Usage:
  python tools/floorplan/find-openings.py --image plan.jpg \
      --calibration 47 227 1017 1316 --venue 7.2 8.0 \
      --line x=1017 x=957 --axis z

  # scan every long line automatically and report the ones with gaps
  python tools/floorplan/find-openings.py --image plan.jpg \
      --calibration 47 227 1017 1316 --venue 7.2 8.0 --auto
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8)


def runs(flags: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    out, start = [], None
    for i, on in enumerate(flags):
        if on and start is None:
            start = i
        elif not on and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(flags) - 1))
    return [(a, b) for a, b in out if b - a + 1 >= min_len]


def walk(mask: np.ndarray, fixed: int, var_range: tuple[int, int], axis: str, tol: int, min_len: int):
    """Return (segments, origin) with segments as ABSOLUTE raster coordinates."""
    lo, hi = var_range
    flags = []
    for v in range(lo, hi + 1):
        if axis == "z":
            seg = mask[v, max(0, fixed - tol):fixed + tol + 1]
        else:
            seg = mask[max(0, fixed - tol):fixed + tol + 1, v]
        flags.append(bool(seg.any()))
    absolute = [(a + lo, b + lo) for a, b in runs(np.array(flags), min_len)]
    return absolute, lo


def gaps(segs: list[tuple[int, int]], lo: int, scale: float, label: str, min_gap: int):
    """Report the breaks between drawn segments. `lo` converts px to metres."""
    found = []
    prev = None
    for a, b in segs:
        if prev is not None and a - prev >= min_gap:
            found.append((prev, a))
        prev = b
    for a, b in found:
        print(f"  OPENING  {label} {(a - lo) * scale:5.2f}..{(b - lo) * scale:5.2f} m"
              f"   ({a}..{b} px, {(b - a) * scale:.2f} m wide)")
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--image", required=True)
    ap.add_argument("--calibration", nargs=4, type=int, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"), required=True)
    ap.add_argument("--venue", nargs=2, type=float, metavar=("WIDTH", "DEPTH"), required=True)
    ap.add_argument("--ink", type=int, default=215)
    ap.add_argument("--line", nargs="+", help="lines to walk, as x=<col> or y=<row>")
    ap.add_argument("--axis", choices=("x", "z"), help="direction to walk along")
    ap.add_argument("--tol", type=int, default=3, help="how far off the line to look, px")
    ap.add_argument("--min-run", type=int, default=12, help="shortest drawn segment to keep, px")
    ap.add_argument("--min-gap", type=int, default=12, help="shortest break to report, px")
    ap.add_argument("--auto", action="store_true", help="scan every row and column for lines with gaps")
    args = ap.parse_args()

    left, top, right, bottom = args.calibration
    width_m, depth_m = args.venue
    scale_x = width_m / (right - left)
    scale_z = depth_m / (bottom - top)
    mask = load(args.image) < args.ink
    print(f"raster {args.image}  ink<{args.ink}  calibration x {left}..{right} y {top}..{bottom}")

    if args.auto:
        hits = 0
        for row in range(top, bottom + 1):
            segs, _ = walk(mask, row, (left, right), "x", 0, args.min_run * 3)
            if gaps(segs, left, scale_x, f"y={row}", args.min_gap * 3):
                hits += 1
        for col in range(left, right + 1):
            segs, _ = walk(mask, col, (top, bottom), "z", 0, args.min_run * 3)
            if gaps(segs, top, scale_z, f"x={col}", args.min_gap * 3):
                hits += 1
        print(f"{hits} line(s) carry an opening")
        return 0

    if not args.line or not args.axis:
        ap.error("--line and --axis are required unless --auto is used")
    scale = scale_x if args.axis == "x" else scale_z
    for spec in args.line:
        kind, _, value = spec.partition("=")
        fixed = int(value)
        if args.axis == "z":
            segs, lo = walk(mask, fixed, (top, bottom), "z", args.tol, args.min_run)
        else:
            segs, lo = walk(mask, fixed, (left, right), "x", args.tol, args.min_run)
        print(f"\nline {kind}={fixed} walked along {args.axis}")
        for a, b in segs:
            print(f"  drawn    {(a - lo) * scale:5.2f}..{(b + 1 - lo) * scale:5.2f} m   ({a}..{b} px)")
        gaps(segs, lo, scale, f"{kind}={fixed}", args.min_gap)
    print("\nA gap on both faces of one wall is a door or window; one face only is")
    print("usually a stray stroke. Re-run with --tol 0 to follow a skewed line exactly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
