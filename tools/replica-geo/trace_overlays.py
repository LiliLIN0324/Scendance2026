"""Colour-segment the OnePlan overlay so geometry can be traced from the source image."""
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(r'C:\Users\13266\.dsh\bot\workspace\Scendance2026')
img = cv2.imread(str(ROOT / '.local/tmp/oneplan-hd/start-on-the-street.png'))
H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

colors = {
    'green':  ('#3fb544', (45, 90, 60), (75, 255, 255)),
    'pink':   ('#ec5fa8', (150, 90, 120), (175, 255, 255)),
    'brown':  ('#c8894a', (10, 80, 80), (30, 255, 255)),
    'purple': ('#b362c9', (130, 60, 80), (155, 255, 255)),
    'orange': ('#e07b30', (5, 110, 120), (22, 255, 255)),
    'yellow': ('#f2c744', (20, 110, 150), (40, 255, 255)),
    'blue':   ('#2b5fd9', (100, 120, 80), (130, 255, 255)),
}

out = {}
debug = img.copy()
for name, (hexv, lo, hi) in colors.items():
    mask = cv2.inRange(hsv, np.array(lo), np.array(hi))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    boxes = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 120 or w < 4 or h < 4:
            continue
        boxes.append(dict(x=int(x), y=int(y), w=int(w), h=int(h), area=int(area),
                          cx=float(cents[i][0]), cy=float(cents[i][1])))
    boxes.sort(key=lambda b: -b['area'])
    out[name] = dict(hex=hexv, boxes=boxes[:40], total=len(boxes))
    for b in boxes[:40]:
        cv2.rectangle(debug, (b['x'], b['y']), (b['x'] + b['w'], b['y'] + b['h']), (0, 0, 255), 2)

(ROOT / '.local/tmp/overlay-boxes.json').write_text(json.dumps(out, indent=1), encoding='utf-8')
cv2.imwrite(str(ROOT / '.local/tmp/overlay-boxes.jpg'), debug)
print(json.dumps({k: len(v['boxes']) for k, v in out.items()}, indent=2))
for k, v in out.items():
    print(k, [(b['x'], b['y'], b['w'], b['h']) for b in v['boxes'][:8]])
