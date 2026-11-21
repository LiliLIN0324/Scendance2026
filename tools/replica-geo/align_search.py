"""Rotation/scale search alignment for screenshots whose basemap differs in season.

SIFT fails when the OnePlan screenshot is rotated and the imagery provider/season
differ. This script matches Canny edges over a coarse angle/scale grid, then
refines rotation+translation with ECC (scale held from the coarse grid, matching
the pipeline's fixed-scale rigid model).

Usage:
  python tools/replica-geo/align_search.py start-on-the-street \
      --lat 42.268872 --lng -71.817042 --z 19 --radius 5
"""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def build_mosaic(slug: str, lat: float, lng: float, z: int, r: int):
    out = ROOT / ".local" / "tmp" / "replica-geo" / slug
    out.mkdir(parents=True, exist_ok=True)
    world = 256 * 2 ** z
    cx = (lng + 180) / 360 * world
    cy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * world
    tx, ty = int(cx // 256), int(cy // 256)
    side = (2 * r + 1) * 256
    sat = np.zeros((side, side, 3), np.uint8)
    for y in range(ty - r, ty + r + 1):
        for x in range(tx - r, tx + r + 1):
            p = out / f"{z}-{y}-{x}.jpg"
            if not p.exists():
                url = (f"https://server.arcgisonline.com/ArcGIS/rest/services/"
                       f"World_Imagery/MapServer/tile/{z}/{y}/{x}")
                last = None
                for _ in range(4):
                    try:
                        p.write_bytes(urllib.request.urlopen(url, timeout=30).read())
                        last = None
                        break
                    except Exception as exc:
                        last = exc
                        time.sleep(1.2)
                if last:
                    raise last
            sat[(y - ty + r) * 256:(y - ty + r + 1) * 256,
                (x - tx + r) * 256:(x - tx + r + 1) * 256] = cv2.imread(str(p))
    x0, y0 = (tx - r) * 256, (ty - r) * 256
    return sat, (x0, y0), (cx - x0, cy - y0)


def ref_edges(ref: np.ndarray) -> np.ndarray:
    h, w = ref.shape[:2]
    mask = np.full((h, w), 255, np.uint8)
    mask[:int(h * 0.10), int(w * 0.68):] = 0
    mask[int(h * 0.86):, int(w * 0.75):] = 0
    mask[:, :int(w * 0.012)] = 0
    mask[int(h * 0.92):, :] = 0
    hsv = cv2.cvtColor(ref, cv2.COLOR_BGR2HSV)
    plan = ((hsv[:, :, 1] > 95) & (hsv[:, :, 2] > 70)).astype(np.uint8) * 255
    plan = cv2.dilate(plan, np.ones((9, 9), np.uint8))
    mask[plan > 0] = 0
    gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    gray[mask == 0] = 0
    edges = cv2.Canny(gray, 40, 110)
    edges[mask == 0] = 0
    return edges


def warp_matrix(angle_deg: float, scale: float) -> np.ndarray:
    th = math.radians(angle_deg)
    return scale * np.array([[math.cos(th), -math.sin(th)],
                             [math.sin(th), math.cos(th)]], np.float64)


def place(edges: np.ndarray, A: np.ndarray):
    h, w = edges.shape
    pts = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    dst = pts @ A.T
    span = dst.max(0) - dst.min(0)
    T = np.array([[A[0, 0], A[0, 1], -dst[:, 0].min()],
                  [A[1, 0], A[1, 1], -dst[:, 1].min()]], np.float32)
    tpl = cv2.warpAffine(edges, T, (int(span[0]) + 1, int(span[1]) + 1))
    return tpl, T


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lng", type=float, required=True)
    ap.add_argument("--z", type=int, default=19)
    ap.add_argument("--radius", type=int, default=5)
    ap.add_argument("--angles", default="-60,0,5")
    ap.add_argument("--scales", default="0.60,1.00,0.05")
    args = ap.parse_args()

    ref = cv2.imread(str(ROOT / ".local" / "tmp" / "oneplan-hd" / f"{args.slug}.png"))
    sat, origin, anchor_px = build_mosaic(args.slug, args.lat, args.lng, args.z, args.radius)
    edges = ref_edges(ref)
    sat_edges = cv2.Canny(cv2.cvtColor(sat, cv2.COLOR_BGR2GRAY), 40, 110)

    # ---------- coarse search on 1/6 scale ----------
    down = 6
    e_small = cv2.resize(edges, (edges.shape[1] // down, edges.shape[0] // down),
                         interpolation=cv2.INTER_AREA)
    s_small = cv2.resize(sat_edges, (sat_edges.shape[1] // down, sat_edges.shape[0] // down),
                         interpolation=cv2.INTER_AREA)
    a0, a1, astep = (float(v) for v in args.angles.split(","))
    s0, s1, sstep = (float(v) for v in args.scales.split(","))
    best = None
    for ang in np.arange(a0, a1 + 0.001, astep):
        for sc in np.arange(s0, s1 + 0.001, sstep):
            A = warp_matrix(ang, sc / down)
            tpl, T = place(e_small, A)
            if tpl.shape[0] >= s_small.shape[0] or tpl.shape[1] >= s_small.shape[1]:
                continue
            res = cv2.matchTemplate(s_small, tpl, cv2.TM_CCORR_NORMED)
            _, maxv, _, maxloc = cv2.minMaxLoc(res)
            if best is None or maxv > best[0]:
                best = (maxv, ang, sc, maxloc, T)
    score, ang, sc, loc, T = best
    A = warp_matrix(ang, sc)
    tpl, T = place(edges, A)
    M = np.array([[T[0, 0], T[0, 1], T[0, 2] + loc[0] * down],
                  [T[1, 0], T[1, 1], T[1, 2] + loc[1] * down]], np.float32)
    print(f"coarse score={score:.4f} angle={ang:.2f} scale={sc:.3f}")

    # ---------- ECC refine (rotation + translation, scale fixed) ----------
    half = 2
    ref_g = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    ref_g = cv2.resize(ref_g, (ref_g.shape[1] // half, ref_g.shape[0] // half))
    sat_g = cv2.resize(cv2.cvtColor(sat, cv2.COLOR_BGR2GRAY),
                       (sat.shape[1] // half, sat.shape[0] // half))
    Mh = M.copy()
    Mh[:, 2] /= half
    Mh[:, :2] = Mh[:, :2]  # scale unchanged: half-res pixels already account for it
    warp = cv2.invertAffineTransform(Mh)
    try:
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-7)
        cc, warp = cv2.findTransformECC(sat_g, ref_g, warp, cv2.MOTION_EUCLIDEAN, crit,
                                        None, 5)
        M2 = cv2.invertAffineTransform(warp)
        M2[:, 2] *= half
        angle2 = math.degrees(math.atan2(M2[1, 0], M2[0, 0]))
        scale2 = math.hypot(M2[0, 0], M2[1, 0])
        print(f"ecc cc={cc:.4f} angle={angle2:.4f} scale={scale2:.5f}")
        M = M2.astype(np.float32)
        ang, sc = angle2, scale2
    except cv2.error as exc:
        print("ecc failed, keeping coarse:", exc)

    p0 = np.linalg.solve(M[:, :2].astype(np.float64), np.array(anchor_px) - M[:, 2])
    mpp = 156543.03392804097 * math.cos(math.radians(args.lat)) / 2 ** args.z
    data = dict(slug=args.slug, method="edge-rotation-search+ecc", score=float(score),
                angleDeg=float(ang), scale=float(sc), matrix=M.tolist(),
                anchor=[args.lng, args.lat], anchorSatellitePx=list(anchor_px),
                anchorPlanPx=p0.tolist(), mpp=mpp, fitMpp=float(sc * mpp),
                tileOrigin=list(origin), z=args.z)
    out = ROOT / ".local" / "tmp" / "replica-geo" / args.slug
    (out / "align.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in data.items() if k != "matrix"}, indent=2))

    warped = cv2.warpAffine(ref, M, (sat.shape[1], sat.shape[0]))
    cv2.imwrite(str(out / "align-blend.jpg"), cv2.addWeighted(sat, 0.55, warped, 0.45, 0))
    cv2.imwrite(str(out / "align-warp.jpg"), warped)


if __name__ == "__main__":
    main()
