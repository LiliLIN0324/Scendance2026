#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verify and re-download the scene template's curated model library.

The 30 local models come from a **human review pass**: candidates were harvested
from 3dassets.dev into a local corpus, ranked automatically, and then each model
was picked by hand from the shortlist. Automated scoring alone is not good enough
here - on this corpus it happily returns "Laptop riser" for a laptop and "Screen
wash bucket stand" for an LED screen, because those titles do contain the right
noun. The curated list below is therefore the source of truth; this tool does not
try to re-derive it.

Stages:

  verify   check every curated model still resolves upstream, is still CC0, is
           still compressed the way our loader can read, and that the committed
           file still matches its recorded sha256. Reports drift rather than
           silently changing the library.
  fetch    download the curated GLBs and previews and write catalogue.json. Use
           this to rebuild the library from scratch or restore a lost file.
  corpus   harvest a fresh local corpus, for reviewing candidates when a model is
           withdrawn and needs a hand-picked replacement.

Usage:
    python3 tools/catalog/build_catalog.py verify --root .
    python3 tools/catalog/build_catalog.py fetch  --root .
    python3 tools/catalog/build_catalog.py corpus --out assets/library/corpus

Standard library only. Python 3.8+.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://3dassets.dev/api/v1"
USER_AGENT = "scendance-catalog/0.1 (+https://github.com/LiliLIN0324/scendance)"
PAGE_LIMIT = 48

CORPUS_CATEGORIES = [
    "props", "environments", "buildings", "nature",
    "roads-infrastructure", "food", "effects-primitives", "vehicles",
]

# -----------------------------------------------------------------------------
# The curated library: (Chinese label, bucket, subcategory, upstream slug).
# Hand-picked. Every entry is CC0 1.0, under 320 KB, and named after the object
# itself rather than one of its parts.
# -----------------------------------------------------------------------------
CURATED = [
    ("桌子", "tables", "桌子", "medieval-monastery-and-scriptorium-trestle-table-2a0801e0"),
    ("椅子", "seating", "座椅", "bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7"),
    ("吧台", "tables", "吧台", "bar-pub-and-brewery-taproom-bar-counter-module-4f0062bc"),
    ("讲台", "tables", "讲台", "japanese-school-and-city-street-lectern-f8b909de"),
    ("展位", "exhibition", "展位", "trading-post-and-barter-market-canopy-market-booth-46c6c10f"),
    ("摊位", "exhibition", "摊位", "medieval-mmo-starter-realm-market-stall-blue-f5cbc408"),
    ("展架", "exhibition", "展架", "solar-system-and-astronauts-brochure-stand-167bd36f"),
    ("签到台", "exhibition", "服务台", "airport-terminal-and-ground-operations-check-in-desk-ba7d92dc"),
    ("背景板", "stage", "舞台", "live-music-venue-and-festival-stage-backdrop-banner-fr-7ebd4df6"),
    ("音箱", "stage", "音响", "indian-bazaar-street-and-temple-speaker-horn-on-pole-4788391b"),
    ("麦克风", "stage", "音响", "live-music-venue-and-festival-stage-microphone-on-boom-b553a46d"),
    ("桁架", "stage", "桁架", "live-music-venue-and-festival-stage-truss-straight-bay-3e0706d1"),
    ("LED 屏", "stage", "视听", "abandoned-cinema-and-projection-booth-abandoned-cinema-765a1a5b"),
    ("射灯", "stage", "灯光", "abandoned-puppet-theatre-and-prop-vault-spotlight-yoke-335ca905"),
    ("篮球架", "sports", "球类设施", "trampoline-park-and-soft-play-basketball-dunk-hoop-58e31467"),
    ("足球门", "sports", "球类设施", "football-soccer-club-grounds-full-size-goal-08c07f03"),
    ("记分牌", "sports", "赛事设施", "community-sports-hall-and-changing-rooms-hall-scoreboa-1aac26ec"),
    ("旗帜", "lighting", "标识", "beach-surf-and-paddle-kit-warning-flag-pole-04ad1969"),
    ("盆栽", "plants", "盆栽", "street-food-market-and-food-trucks-planter-with-shrub-0eedba0e"),
    ("花盆", "plants", "花器", "almanac-gardens-terracotta-planter-1472f447"),
    ("指示牌", "lighting", "标识", "ferry-terminal-and-harbour-crossing-ferry-terminal-and-4f8d77f5"),
    ("隔离带", "lighting", "导流", "airport-terminal-and-ground-operations-queue-barrier-r-0d620e5a"),
    ("帐篷", "structure", "临时建筑", "mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea"),
    ("遮阳伞", "structure", "临时建筑", "hero-shooter-harbour-payload-cafe-parasol-3af84c9f"),
    ("围栏", "structure", "围护", "zombie-quarantine-streets-chain-fence-bay-014919d4"),
    ("垃圾桶", "logistics", "清洁", "bunker-shelter-construction-waste-bin-foot-pedal-f50124e7"),
    ("推车", "logistics", "搬运", "robots-and-drones-kit-battery-trolley-c1d0113b"),
    ("地毯", "decor", "地面", "medieval-mmo-starter-realm-rug-5064c4c7"),
    ("挂画", "decor", "墙面", "pixel-modern-apartments-wall-art-6f3f2e8b"),
    ("笔记本", "digital", "办公", "computers-and-desk-gadgets-laptop-open-14-ad4c2b1d"),
]

# The English query each model answers, kept so a tile tooltip or a future
# recommendation pass can reuse the vocabulary that actually retrieves it.
QUERY_FOR = {
    "桌子": "table", "椅子": "chair", "吧台": "bar counter", "讲台": "lectern",
    "展位": "canopy booth", "摊位": "market stall", "展架": "brochure stand",
    "签到台": "reception desk", "背景板": "backdrop banner", "音箱": "pa speaker",
    "麦克风": "microphone", "桁架": "truss", "LED 屏": "projection screen",
    "射灯": "spotlight", "篮球架": "basketball hoop", "足球门": "soccer goal",
    "记分牌": "scoreboard", "旗帜": "flag pole", "盆栽": "potted plant",
    "花盆": "planter", "指示牌": "wayfinding totem", "隔离带": "queue barrier",
    "帐篷": "dome tent", "遮阳伞": "cafe parasol", "围栏": "chain fence",
    "垃圾桶": "trash bin", "推车": "trolley", "地毯": "rug",
    "挂画": "wall art", "笔记本": "laptop",
}

BUCKET_LABEL = {
    "seating": "坐具", "tables": "桌台", "exhibition": "展陈摊位", "stage": "舞台音响",
    "sports": "体育器材", "plants": "绿植景观", "lighting": "照明标识",
    "structure": "建筑结构", "logistics": "后勤服务", "food": "餐饮",
    "digital": "数码办公", "decor": "装饰陈设", "vehicles": "交通载具", "people": "人物角色",
}
BUCKET_ICON = {
    "seating": "💺", "tables": "🪑", "exhibition": "🏪", "stage": "🎤", "sports": "🏀",
    "plants": "🪴", "lighting": "💡", "structure": "⛺", "logistics": "🧰",
    "food": "🍽️", "digital": "💻", "decor": "🖼️", "vehicles": "🚗", "people": "🧑",
}

# A model larger than this is not a placeable prop, and a GLB larger than this is
# too heavy to commit. The curated list already satisfies both.
MAX_SIZE_M = 8.0
MAX_GLB_BYTES = 320 * 1024


def api_get(path, **params):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            last = exc
            time.sleep(1.2 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError("GET %s failed: %s" % (url, last))


def fetch_bytes(url, retries=3):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError("GET %s failed: %s" % (url, last))


def library_paths(root):
    library = os.path.join(root, "assets", "library")
    return library, os.path.join(library, "model"), os.path.join(library, "thumb")


def load_catalogue(root):
    path = os.path.join(library_paths(root)[0], "catalogue.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def upstream_metadata(slug):
    """Fetch and flatten one asset's metadata; None when it no longer resolves."""
    payload = api_get("/assets/" + slug)
    if not payload or "data" not in payload:
        return None
    asset = payload["data"]
    stats = asset.get("stats") or {}
    dims = (stats.get("sizeMeters") or [0, 0, 0])[:3]
    return {
        "slug": asset.get("slug", slug),
        "name": asset.get("title") or "",
        "license": (asset.get("license") or {}).get("slug", ""),
        "cdnUrl": asset.get("cdnUrl") or "",
        "thumbUrl": asset.get("thumbnailUrl") or "",
        "pageUrl": asset.get("url") or "",
        "bytes": stats.get("fileSize") or 0,
        "triangles": stats.get("triangles") or 0,
        # Provider order is [x, y, z] = [width, height, depth]; we store [w, d, h].
        "sizeMeters": [round(dims[0], 3), round(dims[2], 3), round(dims[1], 3)],
        "draco": bool(stats.get("hasDraco")),
        "meshopt": bool(stats.get("hasMeshopt")),
    }


# -----------------------------------------------------------------------------
# verify
# -----------------------------------------------------------------------------

def stage_verify(args):
    root = os.path.abspath(args.root)
    catalogue = load_catalogue(root)
    recorded = {}
    if catalogue:
        recorded = {model["slug"]: model for model in catalogue["models"]}

    print("verifying %d curated models against the provider and the working tree\n" % len(CURATED))
    problems = []
    notes = []
    ok = 0

    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(upstream_metadata, slug): (zh, bucket, sub, slug)
                for zh, bucket, sub, slug in CURATED}
        for job in futures.as_completed(jobs):
            zh, bucket, sub, slug = jobs[job]
            try:
                meta = job.result()
            except Exception as exc:  # noqa: BLE001
                problems.append("%s (%s): metadata request failed: %s" % (zh, slug, exc))
                continue
            if meta is None:
                problems.append("%s: WITHDRAWN upstream - %s no longer resolves" % (zh, slug))
                continue
            if meta["license"] != "cc0-1.0":
                problems.append("%s: licence is now %r, no longer redistributable" % (zh, meta["license"]))
                continue
            if meta["draco"] or meta["meshopt"]:
                problems.append("%s: now uses Draco/meshopt compression; the loader needs a decoder" % zh)
                continue

            _, model_dir, thumb_dir = library_paths(root)
            glb_path = os.path.join(model_dir, slug + ".glb")
            thumb_path = os.path.join(thumb_dir, slug + ".webp")
            if not os.path.exists(glb_path):
                problems.append("%s: missing %s" % (zh, os.path.relpath(glb_path, root)))
                continue
            if not os.path.exists(thumb_path):
                problems.append("%s: missing %s" % (zh, os.path.relpath(thumb_path, root)))
                continue

            digest = hashlib.sha256(open(glb_path, "rb").read()).hexdigest()
            entry = recorded.get(slug)
            if entry and entry.get("sha256") and entry["sha256"] != digest:
                problems.append("%s: committed GLB does not match the catalogue sha256" % zh)
                continue

            width, depth, height = meta["sizeMeters"]
            if max(width, depth, height) > MAX_SIZE_M:
                notes.append("%s: footprint is now %.2f m, above the %.1f m prop limit"
                             % (zh, max(width, depth), MAX_SIZE_M))
            if meta["bytes"] > MAX_GLB_BYTES:
                notes.append("%s: now %d bytes, above the %d byte budget" % (zh, meta["bytes"], MAX_GLB_BYTES))
            if meta["bytes"] and meta["bytes"] != os.path.getsize(glb_path):
                notes.append("%s: upstream is %d bytes, committed is %d (provider may have re-exported)"
                             % (zh, meta["bytes"], os.path.getsize(glb_path)))
            ok += 1

    print("verified OK: %d / %d" % (ok, len(CURATED)))
    if notes:
        print("\n%d note(s), nothing fatal:" % len(notes))
        for line in notes:
            print("  - " + line)
    if problems:
        print("\n%d problem(s):" % len(problems))
        for line in problems:
            print("  ! " + line)
        print("\nTo replace a withdrawn model: run `corpus`, pick a replacement by hand, "
              "update CURATED, then run `fetch`.")
        return 1
    print("every curated model still resolves, is CC0, is present, and matches its recorded hash.")
    return 0


# -----------------------------------------------------------------------------
# fetch
# -----------------------------------------------------------------------------

def stage_fetch(args):
    root = os.path.abspath(args.root)
    library, model_dir, thumb_dir = library_paths(root)
    for path in (model_dir, thumb_dir):
        os.makedirs(path, exist_ok=True)

    # Metadata first, so the catalogue records upstream facts rather than guesses.
    records = []
    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(upstream_metadata, slug): (zh, bucket, sub, slug)
                for zh, bucket, sub, slug in CURATED}
        for job in futures.as_completed(jobs):
            zh, bucket, sub, slug = jobs[job]
            meta = job.result()
            if meta is None:
                print("  !! %s: %s no longer resolves upstream" % (zh, slug))
                return 1
            meta.update({"zh": zh, "bucket": bucket, "subcategory": sub,
                         "query": QUERY_FOR.get(zh, "")})
            records.append(meta)

    order = {zh: index for index, (zh, _b, _s, _slug) in enumerate(CURATED)}
    records.sort(key=lambda record: order[record["zh"]])

    def grab(record):
        slug = record["slug"]
        try:
            blob = fetch_bytes(record["cdnUrl"])
            if blob[:4] != b"glTF":
                return slug, False, "not a GLB"
            with open(os.path.join(model_dir, slug + ".glb"), "wb") as handle:
                handle.write(blob)
            record["bytes"] = len(blob)
            record["sha256"] = hashlib.sha256(blob).hexdigest()
        except Exception as exc:  # noqa: BLE001
            return slug, False, "glb: %s" % exc
        try:
            thumb = fetch_bytes(record["thumbUrl"])
            with open(os.path.join(thumb_dir, slug + ".webp"), "wb") as handle:
                handle.write(thumb)
            record["thumbBytes"] = len(thumb)
        except Exception as exc:  # noqa: BLE001
            return slug, False, "thumb: %s" % exc
        return slug, True, ""

    done, failed = [], []
    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(grab, record): record for record in records}
        for n, job in enumerate(futures.as_completed(jobs), 1):
            slug, good, why = job.result()
            record = jobs[job]
            (done if good else failed).append(record if good else {"slug": slug, "reason": why})
            sys.stderr.write("\r  fetch %2d/%d ok=%d fail=%d   " % (n, len(jobs), len(done), len(failed)))
    sys.stderr.write("\n")
    for entry in failed:
        print("  !! %s: %s" % (entry["slug"], entry["reason"]))
    if failed:
        return 1

    counts = {}
    for record in done:
        counts[record["bucket"]] = counts.get(record["bucket"], 0) + 1

    catalogue = {
        "catalogueVersion": 1,
        "provider": "3dassets.dev",
        "providerApi": API,
        "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "license": "CC0 1.0 Universal",
        "attributionRequired": False,
        "modelCount": len(done),
        "totalBytes": sum(record["bytes"] for record in done),
        "totalThumbBytes": sum(record.get("thumbBytes", 0) for record in done),
        "localBase": "assets/library/",
        "buckets": [{"key": key, "label": BUCKET_LABEL[key], "icon": BUCKET_ICON[key],
                     "count": counts[key]} for key in BUCKET_LABEL if counts.get(key)],
        "models": [{
            "slug": record["slug"], "name": record["name"], "zh": record["zh"],
            "bucket": record["bucket"], "category": record["bucket"],
            "subcategory": record["subcategory"], "query": record["query"],
            "sizeMeters": record["sizeMeters"], "triangles": record["triangles"],
            "bytes": record["bytes"],
            "thumb": "assets/library/thumb/%s.webp" % record["slug"],
            "glb": "assets/library/model/%s.glb" % record["slug"],
            "cdnUrl": record["cdnUrl"], "pageUrl": record["pageUrl"],
            "sha256": record.get("sha256", ""),
        } for record in done],
    }
    path = os.path.join(library, "catalogue.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(catalogue, handle, ensure_ascii=False, separators=(",", ":"))

    print("catalogue: %d models, %.2f MB GLB, %.2f MB previews -> %s"
          % (len(done), catalogue["totalBytes"] / 1048576,
             catalogue["totalThumbBytes"] / 1048576, path))
    return 0


# -----------------------------------------------------------------------------
# corpus
# -----------------------------------------------------------------------------

def stage_corpus(args):
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    meta = {"provider": "3dassets.dev", "api": API,
            "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "categories": {}}
    for category in CORPUS_CATEGORIES:
        first = api_get("/assets", category=category, limit=PAGE_LIMIT, page=1, sort="popular")
        pages = int(first.get("totalPages") or 1)
        rows = list(first.get("data") or [])
        if pages > 1:
            with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                jobs = [pool.submit(api_get, "/assets", category=category, limit=PAGE_LIMIT,
                                    page=page, sort="popular") for page in range(2, pages + 1)]
                for n, job in enumerate(futures.as_completed(jobs), 2):
                    try:
                        rows.extend(job.result().get("data") or [])
                    except Exception:  # noqa: BLE001
                        pass
                    sys.stderr.write("\r  %-22s page %3d/%d rows=%d   " % (category, n, pages, len(rows)))
        sys.stderr.write("\n")

        packed = []
        for asset in rows:
            if (asset.get("license") or {}).get("slug") != "cc0-1.0":
                continue
            stats = asset.get("stats") or {}
            dims = (stats.get("sizeMeters") or [0, 0, 0])[:3]
            packed.append([
                asset.get("slug", ""), (asset.get("title") or "")[:120],
                (asset.get("summary") or "")[:110], dims,
                stats.get("fileSize") or 0, stats.get("triangles") or 0,
                asset.get("downloads") or 0, asset.get("thumbnailUrl") or "",
                asset.get("cdnUrl") or "", asset.get("url") or "",
            ])
        path = os.path.join(out_dir, category + ".json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"category": category, "rows": packed}, handle,
                      ensure_ascii=False, separators=(",", ":"))
        meta["categories"][category] = {"rows": len(packed), "upstreamPages": pages}
        print("  %-22s %6d rows  %7.0f KB" % (category, len(packed), os.path.getsize(path) / 1024))

    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, separators=(",", ":"))
    print("corpus written to %s" % out_dir)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = parser.add_subparsers(dest="stage", required=True)

    p_verify = subs.add_parser("verify", help="check the curated library against the provider and disk")
    p_verify.add_argument("--root", default=".")
    p_verify.add_argument("--workers", type=int, default=8)
    p_verify.set_defaults(func=stage_verify)

    p_fetch = subs.add_parser("fetch", help="download the curated library and write catalogue.json")
    p_fetch.add_argument("--root", default=".")
    p_fetch.add_argument("--workers", type=int, default=10)
    p_fetch.set_defaults(func=stage_fetch)

    p_corpus = subs.add_parser("corpus", help="harvest a local corpus for reviewing candidates")
    p_corpus.add_argument("--out", default="assets/library/corpus")
    p_corpus.add_argument("--workers", type=int, default=8)
    p_corpus.set_defaults(func=stage_corpus)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
