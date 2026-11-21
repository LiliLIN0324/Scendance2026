#!/usr/bin/env python
"""Step 1 of the replica georeferencing pipeline.

Fetch an Esri World Imagery mosaic around a candidate anchor and fit a
fixed-scale 2D rigid transform (rotation + translation) from the OnePlan
reference image to satellite native pixels with SIFT + RANSAC.

Usage:
  python tools/replica-geo/register.py start-on-the-street \
      --lat 42.268872 --lng -71.817042 --z 18

Outputs (under .local/tmp/replica-geo/<slug>/):
  satellite.jpg        stitched mosaic
  registration.json    matrix, rotationDeg, fitMpp, anchorPlanPx, inlier stats
  matches.jpg          SIFT inlier visualisation
  satellite-plan-view.jpg  satellite warped into reference-image orientation
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import urllib.request
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TILE_URL = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
            "World_Imagery/MapServer/tile/{z}/{y}/{x}")


def lonlat_to_world(lng: float, lat: float, z: int) -> tuple[float, float]:
    world = 256 * 2 ** z
    x = (lng + 180) / 360 * world
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * world
    return x, y


def fetch_tile(out: Path, z: int, x: int, y: int) -> np.ndarray:
    path = out / f"{z}-{y}-{x}.jpg"
    if not path.exists():
        with urllib.request.urlopen(TILE_URL.format(z=z, x=x, y=y), timeout=30) as r:
            path.write_bytes(r.read())
    img = cv2.imdecode(np.frombuffer(path.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    if img is None or img.shape[:2] != (256, 256):
        raise ValueError(f"bad tile {z}/{y}/{x}")
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lng", type=float, required=True)
    ap.add_argument("--z", type=int, default=19)
    ap.add_argument("--radius", type=int, default=3, help="tiles per side, radius 3 -> 7x7")
    ap.add_argument("--ref", default=None)
    ap.add_argument("--match-ratio", type=float, default=0.73)
    args = ap.parse_args()

    out = ROOT / ".local" / "tmp" / "replica-geo" / args.slug
    out.mkdir(parents=True, exist_ok=True)
    ref_path = Path(args.ref) if args.ref else ROOT / ".local" / "tmp" / "oneplan-hd" / f"{args.slug}.png"
    ref = cv2.imread(str(ref_path))
    if ref is None:
        raise SystemExit(f"reference not found: {ref_path}")

    world = 256 * 2 ** args.z
    cx, cy = lonlat_to_world(args.lng, args.lat, args.z)
    tx, ty = int(cx // 256), int(cy // 256)
    r = args.radius
    x0, y0 = (tx - r) * 256, (ty - r) * 256
    side = (2 * r + 1) * 256
    mpp = 156543.03392804097 * math.cos(math.radians(args.lat)) / 2 ** args.z

    sat = np.zeros((side, side, 3), np.uint8)
    tiles = [(x, y) for y in range(ty - r, ty + r + 1) for x in range(tx - r, tx + r + 1)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_tile, out, args.z, x, y): (x, y) for x, y in tiles}
        for fut in concurrent.futures.as_completed(futures):
            x, y = futures[fut]
            sat[(y - ty + r) * 256:(y - ty + r + 1) * 256,
                (x - tx + r) * 256:(x - tx + r + 1) * 256] = fut.result()

    cv2.imwrite(str(out / "satellite.jpg"), sat)

    # Ignore OnePlan toolbars / labels around the edges of the screenshot.
    h, w = ref.shape[:2]
    mask = np.full((h, w), 255, np.uint8)
    mask[:int(h * 0.09), int(w * 0.70):] = 0
    mask[int(h * 0.88):, int(w * 0.78):] = 0
    mask[int(h * 0.02):int(h * 0.08), int(w * 0.30):int(w * 0.65)] = 0

    sift = cv2.SIFT_create(nfeatures=16000)
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY), mask)
    k2, d2 = sift.detectAndCompute(cv2.cvtColor(sat, cv2.COLOR_BGR2GRAY), None)
    if d1 is None or d2 is None:
        raise SystemExit("SIFT found no descriptors")
    matches = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [m for m, n in matches if n is not None and m.distance < args.match_ratio * n.distance]
    print(f"keypoints ref={len(k1)} sat={len(k2)} knn={len(matches)} good={len(good)}", flush=True)
    if len(good) < 8:
        (out / "debug.json").write_text(json.dumps(dict(keypoints=[len(k1), len(k2)], good=len(good)), indent=2))
        raise SystemExit(f"not enough matches: {len(good)}")

    p = np.float32([k1[m.queryIdx].pt for m in good])
    q = np.float32([k2[m.trainIdx].pt for m in good])
    M, inliers = cv2.estimateAffinePartial2D(
        p, q, method=cv2.RANSAC, ransacReprojThreshold=4, maxIters=20000, confidence=0.999)
    print(f"partial-affine inliers={0 if inliers is None else int(inliers.sum())}", flush=True)
    if M is None or inliers is None or int(inliers.sum()) < 8:
        vis = cv2.drawMatches(ref, k1, sat, k2, good[:80], None, flags=2)
        cv2.imwrite(str(out / "matches-weak.jpg"), vis)
        (out / "debug.json").write_text(json.dumps(dict(
            keypoints=[len(k1), len(k2)], good=len(good),
            inliers=0 if inliers is None else int(inliers.sum())), indent=2))
        raise SystemExit("no robust image fit")

    sel = inliers.ravel().astype(bool)
    fit_mpp = math.hypot(M[0, 0], M[1, 0]) * mpp
    angle = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    anchor_px = np.linalg.solve(M[:, :2], np.array([cx - x0, cy - y0]) - M[:, 2])
    errors = np.linalg.norm(p @ M[:, :2].T + M[:, 2] - q, axis=1) * mpp

    data = dict(
        slug=args.slug, z=args.z, tileOrigin=[x0, y0], anchor=[args.lng, args.lat],
        anchorSatellitePx=[cx - x0, cy - y0], mpp=mpp, matrix=M.tolist(),
        fitMpp=fit_mpp, rotationDeg=angle, anchorPlanPx=anchor_px.tolist(),
        matches=len(good), inliers=int(sel.sum()),
        rmseM=float(np.sqrt(np.mean(errors[sel] ** 2))),
        points=[dict(plan=a.tolist(), sat=b.tolist(), errorM=float(e))
                for a, b, e in zip(p[sel], q[sel], errors[sel])],
    )
    (out / "registration.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

    vis = cv2.drawMatches(ref, k1, sat, k2,
                          [m for m, keep in zip(good, sel) if keep], None, flags=2)
    cv2.imwrite(str(out / "matches.jpg"), vis)
    cv2.imwrite(str(out / "satellite-plan-view.jpg"),
                cv2.warpAffine(sat, cv2.invertAffineTransform(M), (ref.shape[1], ref.shape[0])))

    print(json.dumps({k: v for k, v in data.items() if k != "points"}, indent=2))


if __name__ == "__main__":
    main()
