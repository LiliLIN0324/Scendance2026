import json, math
from pathlib import Path
import cv2, numpy as np

ROOT = Path(r'C:\Users\13266\.dsh\bot\workspace\Scendance2026')
fit = json.loads((ROOT / '.tmp/replica-geo/start-on-the-street/google-fit.json').read_text())
M = np.array(fit['matrix'])
x0, y0 = fit['tileOrigin']
world = 256 * 2 ** fit['z']
ALAT, ALNG = fit['lat'], fit['lng']
mLng = 111320 * math.cos(math.radians(ALAT))
mLat = 110574

def ref_to_enu(px, py):
    sx, sy = M @ np.array([px, py, 1.0])
    wx, wy = x0 + sx, y0 + sy
    lng = wx / world * 360 - 180
    lat = math.degrees(math.atan(0.5 * (math.exp((1 - 2 * wy / world) * math.pi)
                                        - math.exp((2 * wy / world - 1) * math.pi))))
    return (lng - ALNG) * mLng, (lat - ALAT) * mLat

def poly(rect):
    x, y, w, h = rect
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]

def rect_pts(rect):
    return [ref_to_enu(x, y) for x, y in poly(rect)]

zones = [
    ('Booth Row West 西摊带', 'reserved', '#3fb544', 0.25, (207, 653, 348, 99)),
    ('Booth Row Center 中摊带', 'reserved', '#ec5fa8', 0.25, (760, 571, 355, 124)),
    ('Booth Row East 东摊带', 'reserved', '#3fb544', 0.25, (1183, 529, 357, 102)),
    ('Food Truck Court 餐车广场', 'reserved', '#c8894a', 0.3, (1710, 483, 594, 212)),
    ('Shop Parking 商户停车', 'parking', '#b362c9', 0.3, (2399, 546, 161, 182)),
    ('Dance Stage 舞台区', 'stage', '#b362c9', 0.3, (596, 760, 130, 40)),
    ('Historical Sworderman 历史剑士', 'reserved', '#e07b30', 0.3, (58, 690, 72, 66)),
]
zones_out = [dict(name=n, semantic=s, color=c, opacity=o,
                  polygon=[[round(a, 3), round(b, 3)] for a, b in rect_pts(r)])
             for n, s, c, o, r in zones]

def row_booths(x, y, w, count, depth_px, color, name):
    step = w / count
    out = []
    for i in range(count):
        cx = x + step * (i + 0.5)
        ex, ey = ref_to_enu(cx, y)
        out.append(dict(templateId='booth-2x2', name=f'{name} {i+1}', color=color,
                        placement=dict(kind='single', x=round(ex, 3), y=round(ey, 3), rot=0),
                        size=dict(width=3, depth=3)))
    return out

facilities = []
# booths sit on the north sidewalk; green row on top, pink row below
facilities += row_booths(207, 684, 348, 10, 30, '#3fb544', '西绿摊')
facilities += row_booths(210, 720, 348, 10, 30, '#ec5fa8', '西粉摊')
facilities += row_booths(760, 606, 355, 10, '#3fb544' and 30, '#3fb544', '中绿摊')
facilities += row_booths(768, 642, 351, 10, 30, '#ec5fa8', '中粉摊')
facilities += row_booths(1183, 562, 357, 10, 30, '#3fb544', '东绿摊')
facilities += row_booths(1187, 600, 357, 10, 30, '#ec5fa8', '东粉摊')

def single(px, py, tid, name, w, d, color=None, rot=0):
    ex, ey = ref_to_enu(px, py)
    item = dict(templateId=tid, name=name, placement=dict(kind='single', x=round(ex, 3), y=round(ey, 3), rot=rot),
                size=dict(width=w, depth=d))
    if color:
        item['color'] = color
    return item

# food trucks along the court's north edge
for i, px in enumerate((1780, 1930, 2080, 2230)):
    facilities.append(single(px, 540, 'food-truck-6x2.5', f'餐车 {i+1}', 6, 2.5, '#e07b30'))
# picnic tables inside the court
for r, py in enumerate((600, 640)):
    for c in range(6):
        facilities.append(single(1800 + c * 90, py, 'oneplan:scale:round-table-and-chairs',
                                 f'圆桌 {r+1}-{c+1}', 1.8, 1.8, '#f2d024'))
# parking cars
for i, py in enumerate((580, 630, 680)):
    facilities.append(single(2470, py, 'oneplan:scale:car', f'商户车 {i+1}', 4.5, 1.8, '#2b5fd9'))
# stages
for i, (px, py) in enumerate(((620, 780), (665, 780), (710, 780))):
    facilities.append(single(px, py, 'oneplan:scale:pop-up-tent', f'舞台 {i+1}', 6, 4, '#b362c9'))
# historical sworderman
facilities.append(single(94, 723, 'oneplan:scale:pop-up-tent', '历史剑士', 6, 4, '#e07b30'))

routes = [
    dict(name='人流 · 街道主动线', kind='pedestrian', carrier='walk', oneWay=True, widthM=4,
         color='#f2c744', points=[[round(a, 3), round(b, 3)] for a, b in
                                  [ref_to_enu(20, 800), ref_to_enu(400, 790), ref_to_enu(800, 780),
                                   ref_to_enu(1200, 760), ref_to_enu(1600, 745), ref_to_enu(2000, 735),
                                   ref_to_enu(2400, 720)]]),
    dict(name='人流 · 餐车广场环', kind='pedestrian', carrier='walk', oneWay=False, widthM=3,
         color='#e07b30', points=[[round(a, 3), round(b, 3)] for a, b in
                                  [ref_to_enu(1720, 700), ref_to_enu(1900, 710), ref_to_enu(2100, 700),
                                   ref_to_enu(2300, 690)]]),
]
nodes = [
    dict(name='西门', kind='both', x=round(ref_to_enu(30, 810)[0], 3), y=round(ref_to_enu(30, 810)[1], 3)),
    dict(name='东门', kind='both', x=round(ref_to_enu(2520, 700)[0], 3), y=round(ref_to_enu(2520, 700)[1], 3)),
]

spec = dict(slug='start-on-the-street', title='stART on the Street', category='Festivals',
            region='North America', refImage='start-on-the-street.png',
            refLink='https://www.oneplan.io/inspiration/start-on-the-street/',
            anchor=dict(lng=ALNG, lat=ALAT), rotationDeg=0,
            locationNote='2026-11-18 原图复核：0.1036 m/px，SIFT 2410 内点，RMSE 0.052 m；几何按原图色块重描，坐标已为真 ENU（rotation 0）。',
            zones=zones_out, facilities=[dict(**f) for f in facilities], routes=routes, nodes=nodes)
(ROOT / '.tmp/replica-geo/start-on-the-street/spec.json').write_text(json.dumps(spec, indent=1), encoding='utf-8')

# debug: draw the converted polygons back onto the reference
img = cv2.imread(str(ROOT / '.tmp/oneplan-hd/start-on-the-street.png'))
A = M[:, :2]
t = M[:, 2]
invA = np.linalg.inv(A)
def enu_to_ref(x, y):
    lng = ALNG + x / mLng; lat = ALAT + y / mLat
    wx = (lng + 180) / 360 * world
    wy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * world
    sx, sy = invA @ (np.array([wx - x0, wy - y0]) - t)
    return int(round(sx)), int(round(sy))
for z in zones_out:
    pts = np.array([enu_to_ref(*p) for p in z['polygon']], np.int32)
    cv2.polylines(img, [pts], True, (0, 0, 255), 3)
for f in facilities:
    px, py = enu_to_ref(f['placement']['x'], f['placement']['y'])
    cv2.circle(img, (px, py), 6, (255, 0, 255), 2)
cv2.imwrite(str(ROOT / '.temp/trace-check.jpg'), img)
print('zones', len(zones_out), 'facilities', len(facilities), 'routes', len(routes))
print('extent m', round(max(p['x'] for p in routes[0]['points']), 1), 'to', round(min(p['x'] for p in routes[0]['points']), 1))
