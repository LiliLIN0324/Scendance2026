"""Segment a floor plan by text prompt, using the public CLIPSeg checkpoint.

This is the one reuse path out of the three candidate projects that is actually
open and obtainable:

  * RasterScan/Floor-Plan-Recognition does raster -> vector, but ships as a
    Docker image behind machine-code licence activation.
  * ozturkoktay/floor-plan-room-segmentation is MIT but publishes no weights,
    only a training notebook.
  * TAU-VAILab/WAFFLE publishes the wall-detection method that fits messy,
    in-the-wild plans -- and its `src/helpers/clipseg_inf.py` is built on
    `CIDAS/clipseg-rd64-refined`, which is public and ungated.

WAFFLE's own fine-tuned checkpoint lives on a SharePoint link that returns 403,
so this uses the public base checkpoint and the same prompting interface.

Usage:
  python tools/floorplan/segment-walls.py --image plan.jpg --out dir
  python tools/floorplan/segment-walls.py --image plan.jpg --prompts wall "glass window" door
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import CLIPSegForImageSegmentation, CLIPSegProcessor

MODEL_ID = "CIDAS/clipseg-rd64-refined"
DEFAULT_PROMPTS = ["wall", "glass window", "door", "furniture"]


def segment(image: Image.Image, prompts: list[str]):
    """Return one probability map per prompt, at the model's working resolution."""
    processor = CLIPSegProcessor.from_pretrained(MODEL_ID)
    model = CLIPSegForImageSegmentation.from_pretrained(MODEL_ID).eval()
    inputs = processor(text=prompts, images=[image] * len(prompts), padding=True, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
    if logits.dim() == 3:
        logits = logits.unsqueeze(0)
    return torch.sigmoid(logits).squeeze(0).numpy()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prompts", nargs="+", default=DEFAULT_PROMPTS)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    source = Image.open(args.image).convert("RGB")
    print(f"image   {args.image}  {source.size}")
    print(f"model   {MODEL_ID}")

    probs = segment(source, args.prompts)
    print(f"logits  {probs.shape[0]} prompt(s) at {probs.shape[1]}x{probs.shape[2]}")

    report = {"image": str(args.image), "model": MODEL_ID, "prompts": []}
    for i, prompt in enumerate(args.prompts):
        p = probs[i]
        # upscale the working-resolution map back onto the source raster
        up = np.asarray(
            Image.fromarray((p * 255).astype(np.uint8)).resize(source.size, Image.BILINEAR),
            dtype=np.float32,
        ) / 255.0
        name = prompt.replace(" ", "_")
        Image.fromarray((up * 255).astype(np.uint8)).save(out / f"{name}.png")
        np.save(out / f"{name}.npy", up)
        cover = float((up > 0.5).mean())
        report["prompts"].append({"prompt": prompt, "coverage_at_0.5": round(cover, 4)})
        print(f"  {prompt:<16} coverage>0.5: {cover:.4f}   mean prob {up.mean():.4f}")

    (out / "segment-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"wrote   {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
