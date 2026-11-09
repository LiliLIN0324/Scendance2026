#!/usr/bin/env python3
"""生成 data/building-heights.json 的唯一脚本。

来源优先级（高 -> 低）：
  A  地标覆盖表：官方 / 设计方 / 结构论文给出的总高（landmark_official）
  A* 地标覆盖表：媒体 / 百科等二手口径给出的总高（landmark_media）
  A  OSM height 经官方值确认（mapped，仅雷峰塔）
  B  OSM height 标签
  C  地标覆盖表：公开层数 × 按用途层高（derived_layers）
  C  OSM building:levels × 3.2 m（derived_osm_levels）
  C  CNBH 10 m 栅格（≥3 m 采纳；>30 m 保留采样值并标 suspect，不再退回 D）
  D  街区类型推断（确定性，可复跑）

用法：
  python scripts/build-building-heights.py \
    --osm <xihu-ring.osm> <landmark-*.osm> ... --sample-osm <east-shore.osm> \
    --cnbh <cnbh-*.tif> --landmarks data/landmark-footprints.geojson \
    --out data/building-heights.json --stats data/building-heights-stats.md

`--osm` 可传多个文件：第一个视为基底（街区网格锚点只取它），其余为补丁簇；
way_id 冲突时以先出现的为准。
`--landmarks` 是人工补录 overlay（GeoJSON），**优先级高于 OSM、地标覆盖表与补充记录**：
  - `properties.mode = "record"`：新增一条记录，id 必须 `x-` 开头，geometry 为 Polygon，
    必须给 `height_m`；`height_source` 默认 `landmark_media`，并写 `footprint=approximate`。
  - `properties.mode = "name_patch"`：只给既有记录补名字，不改高度，需给 `target_id`。

地标覆盖表的逐条依据见 docs/40-地标高度清单-20261109.md（S1–S52）；
补录与 id 规则见 docs/41-缺失地标补录方案-20261109.md。
"""

import argparse
import hashlib
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import date

import numpy as np

MLAT = 111319.49
FLOOR_M = 3.2          # OSM levels 换算层高（任务口径）
CNBH_MIN = 3.0         # 栅格下限
CNBH_MAX = 30.0        # 采纳上限；超过只降置信度、不再退回 D

# 街区类型 -> (层数档位与占比, 层高)
TYPOLOGY = {
    "commercial_core":   {"bands": [(4, 7, 70), (8, 12, 20), (13, 30, 10)], "floor": 3.6},
    "old_residential":   {"bands": [(2, 4, 65), (5, 6, 30), (7, 8, 5)],     "floor": 3.0},
    "historic":          {"bands": [(1, 3, 90), (4, 4, 10)],                "floor": 3.0},
    "institutional":     {"bands": [(4, 6, 70), (7, 10, 30)],               "floor": 3.3},
    "highrise":          {"bands": [(12, 18, 50), (19, 33, 50)],            "floor": 3.3},
    "default":           {"bands": [(2, 4, 70), (5, 6, 30)],                "floor": 3.0},
}

CONF = {
    "osm_height": (0.85, "OSM height 标签，社区测绘值，未逐栋核验"),
    "osm_levels": (0.60, "OSM building:levels 换算 3.2 m/层，层高为假设值"),
    "cnbh": (0.55, "CNBH 10 m 栅格；低层可信，产品对高层系统性低估"),
    "typology": (0.30, "街区类型 + 固定哈希取层数档，误差 ±1–2 层"),
    "landmark_official": (0.90, "官方 / 设计方 / 结构论文公布的总高"),
    "landmark_media": (0.80, "媒体 / 百科等二手口径的总高，非官方公示"),
    "landmark_layers": (0.70, "公开层数 × 按用途层高，层数与层高依据逐条记录"),
}
VALUE_KIND = {
    "survey": "measured",
    "osm_height": "mapped",
    "osm_levels": "derived_osm_levels",
    "cnbh": "cnbh_raster",
    "typology": "inferred",
    "landmark_official": "reported_official",
    "landmark_media": "reported_media",
    "landmark_layers": "derived_layers",
}
GRADE = {
    "survey": "A", "landmark_official": "A", "landmark_media": "A*",
    "osm_height": "B", "landmark_layers": "C", "osm_levels": "C",
    "cnbh": "C", "typology": "D",
}
# 等级从高到低；A* 是「有总高、但非官方公示/图纸」的独立档，不并入 A
GRADE_ORDER = ("A", "A*", "B", "C", "D")
GRADE_LABELS = {
    "A": "官方 / 设计方 / 结构论文 / 实测",
    "A*": "媒体·百科等二手口径的总高（非官方公示）",
    "B": "OSM height 标签",
    "C": "层数×层高 derived / OSM levels / CNBH 栅格",
    "D": "街区类型推断",
}
DERIVED_KINDS = ("derived_layers", "derived_osm_levels", "cnbh_raster", "inferred")

# ---------------------------------------------------------------------------
# 地标覆盖表（人工核对；逐条依据见 docs/40-地标高度清单-20261109.md）
#
# 字段：
#   id                   OSM way_id
#   height_m             直接给出的总高（A / A*）
#   grade                覆盖后的等级：A / A* / C
#   source               height_source：landmark_official / landmark_media / landmark_layers
#   confidence           0–1
#   provenance           人可读依据，必须能追溯到来源编号（Sxx）
#   layers / floor_m     仅 derived_layers：层数 + 采用的层高
#   layers_source        仅 derived_layers：层数出自哪条来源
#   floor_basis          仅 derived_layers：层高用了哪一档、为什么
#
# derived_layers 的高度一律由 layers × floor_m 计算，不手填，避免与依据走形。
# ---------------------------------------------------------------------------
LANDMARKS = [
    # ---------- A：官方 / 设计方 / 结构论文 ----------
    {
        "id": "229726934", "height_m": 71.7, "grade": "A", "source": "osm_height",
        "confidence": 0.95,
        "provenance": "OSM height=71.7 m，与官方 71.679 m（台基 9.77 + 塔身 45.809"
                      " + 塔刹 16.10，央广网 2007·S2 / 西湖区 2024·S3）吻合 +0.03%；"
                      "值不动，仅由 B 提为 A",
    },
    {
        "id": "399030896", "height_m": 41.6, "grade": "A", "source": "landmark_official",
        "confidence": 0.88,
        "provenance": "7 层仿古阁，总高 41.6 m（西湖区政府 2025·S4；2024 修缮报道·S5）",
    },
    {
        "id": "28756030", "height_m": 72.0, "grade": "A", "source": "landmark_official",
        "confidence": 0.90,
        "provenance": "72 m / 地上 18 层（浙江省建筑设计研究院项目页·S6，1989 设计、1997 竣工）",
    },
    {
        "id": "292982168", "height_m": 38.4, "grade": "A", "source": "landmark_official",
        "confidence": 0.85,
        "provenance": "主体最高点 38.4 m、东侧外檐 25.0 m（工程概况·S12）；"
                      "占地 5.46 公顷、建面近 6 万 m²（官网·S13）",
    },
    {
        "id": "461665066", "height_m": 48.0, "grade": "A", "source": "landmark_official",
        "confidence": 0.88,
        "provenance": "主楼 48 m（2009 规划公示定案，85→56→48 m·S10；2016 施工方·S11）",
    },
    {
        "id": "28538110", "height_m": 31.6, "grade": "A", "source": "landmark_official",
        "confidence": 0.90,
        "provenance": "31.6 m / 8 层（浙江省建筑设计研究院项目页·S7）；"
                      "Portman 记 31 m / 12 层（·S8）",
    },
    {
        "id": "30411430", "height_m": 18.0, "grade": "A", "source": "landmark_official",
        "confidence": 0.90,
        "provenance": "18 m / 4 层（浙江省建筑设计研究院项目页·S9，1994/1998）",
    },
    {
        "id": "970028320", "height_m": 39.0, "grade": "A", "source": "landmark_official",
        "confidence": 0.78,
        "provenance": "黄龙体育中心**场体**最高处 39 m（场馆资料/百科口径，非图纸）；"
                      "南北塔楼已拆为独立记录 970028320-tower（85 m），"
                      "结构设计见同济大学学报 2001·S45",
    },
    {
        "id": "450603875", "height_m": 45.0, "grade": "A", "source": "landmark_official",
        "confidence": 0.88,
        "provenance": "总高 45 m，地上 3 层 + 地下 1 层"
                      "（杭州文广旅游局 2022·S40；钱江晚报 2012·S41）",
    },
    # ---------- A*：二手口径总高 ----------
    {
        "id": "518032727", "height_m": 70.0, "grade": "A*", "source": "landmark_media",
        "confidence": 0.80,
        "provenance": "主楼 70 m / 21 层（杭州网 2004 拍卖报道·S38；"
                      "杭州网 2023「1986 年建成、高 70 米」·S39）——媒体报道口径，"
                      "无规划/图纸佐证，故为 A* 不并入 A",
    },
    {
        "id": "447977372", "height_m": 30.0, "grade": "A*", "source": "landmark_media",
        "confidence": 0.78,
        "provenance": "地上 5 层 / 局部 8 层，总高约 30 m"
                      "（都市快报 2026·S42；楼盘参数页同口径）——「约」为媒体估算，故为 A*",
    },
    # ---------- C-der：公开层数 × 按用途层高 ----------
    {
        "id": "109882469", "grade": "C", "source": "landmark_layers", "confidence": 0.68,
        "layers": 3, "floor_m": 5.0,
        "layers_source": "2–3 层传统骑楼街区（新浪财经 2005·S30；BIDG 项目页·S31）",
        "floor_basis": "百货/购物中心 5.0 m 档；层数取区间上限 3 层",
        "provenance": "in77 A 区一期名品街，骑楼 2–3 层",
    },
    {
        "id": "432726134", "grade": "C", "source": "landmark_layers", "confidence": 0.74,
        "layers": 6, "floor_m": 5.0,
        "layers_source": "地上 6 层（本地宝楼层导览 1F–6F·S32；浙江日报 2019 A 座 6 层·S33）",
        "floor_basis": "百货/购物中心 5.0 m 档",
        "provenance": "解百新世纪，延安路口转角",
    },
    {
        "id": "61232073", "grade": "C", "source": "landmark_layers", "confidence": 0.66,
        "layers": 3, "floor_m": 6.0,
        "layers_source": "3 层展厅（浙大高分子系 2011 参观记·S34「展厅共分三层」）",
        "floor_basis": "博物馆/美术馆展厅 6.0 m 档（展陈层高 6–9 m，取保守下沿）",
        "provenance": "杭州博物馆南馆，吴山山脊",
    },
    {
        "id": "1443017854", "grade": "C", "source": "landmark_layers", "confidence": 0.66,
        "layers": 4, "floor_m": 6.0,
        "layers_source": "4 层（原吴山博物馆，馆方导览 / 景点页·S35）",
        "floor_basis": "博物馆/美术馆展厅 6.0 m 档",
        "provenance": "杭州博物馆北馆",
    },
    {
        "id": "420546406", "grade": "C", "source": "landmark_layers", "confidence": 0.74,
        "layers": 4, "floor_m": 5.5,
        "layers_source": "地上 4 层（浙江宣传 2023·S36；中国建筑学会 程泰宁作品页，"
                         "地上建面 16,212 m²·S37）",
        "floor_basis": "美术馆坡顶展厅 5.5 m 档（顶层收分，低于平顶展厅 6.0）",
        "provenance": "浙江美术馆，南山路湖岸",
    },
    {
        "id": "706922787", "grade": "C", "source": "landmark_layers", "confidence": 0.72,
        "layers": 5, "floor_m": 4.0,
        "layers_source": "中楼 5 层，1922 年建（官网·S18；潮新闻·S19）",
        "floor_basis": "1920s 历史饭店 4.0 m 档（砖混，层高高于现代客房层）",
        "provenance": "新新饭店，北山街一线",
    },
    {
        "id": "260710901", "grade": "C", "source": "landmark_layers", "confidence": 0.70,
        "layers": 4, "floor_m": 5.0,
        "layers_source": "地下 1 层至地上 4 层（浙江日报 2013 湖滨二期·S46）",
        "floor_basis": "百货/购物中心 5.0 m 档",
        "provenance": "in77 C1 区",
    },
    {
        "id": "260711006", "grade": "C", "source": "landmark_layers", "confidence": 0.70,
        "layers": 4, "floor_m": 5.0,
        "layers_source": "地下 1 层至地上 4 层（浙江日报 2013 湖滨二期·S46）",
        "floor_basis": "百货/购物中心 5.0 m 档",
        "provenance": "in77 C2 区",
    },
    {
        "id": "514210559", "grade": "C", "source": "landmark_layers", "confidence": 0.70,
        "layers": 5, "floor_m": 5.0,
        "layers_source": "地上 5 层（浙江在线 2017·S46）",
        "floor_basis": "百货/购物中心 5.0 m 档",
        "provenance": "in77 D 区",
    },
    {
        "id": "547678662", "grade": "C", "source": "landmark_layers", "confidence": 0.68,
        "layers": 3, "floor_m": 5.0,
        "layers_source": "地上 2–3 层（浙大院五期项目页·S47）",
        "floor_basis": "百货/购物中心 5.0 m 档；层数取区间上限 3 层",
        "provenance": "in77 E 区",
    },
    {
        "id": "29993237", "grade": "C", "source": "landmark_layers", "confidence": 0.70,
        "layers": 8, "floor_m": 5.0,
        "layers_source": "一期地上 8 层（赢商网 2019·S43）；二期 13 层退层（杭州网 2021·S44）",
        "floor_basis": "百货/购物中心 5.0 m 档（取一期 8 层）",
        "provenance": "工联 CC",
    },
    {
        "id": "988508474", "grade": "C", "source": "landmark_layers", "confidence": 0.72,
        "layers": 7, "floor_m": 3.5,
        "layers_source": "平顶 7 层（戴念慈方案，中新网 2023·S22）",
        "floor_basis": "酒店客房 3.5 m 档（西湖边限高 30 m 交叉验证）",
        "provenance": "望湖宾馆",
    },
    {
        "id": "817297029", "grade": "C", "source": "landmark_layers", "confidence": 0.70,
        "layers": 5, "floor_m": 3.8,
        "layers_source": "东楼由 7 层降至 5 层（2019 降拆，中新网 2023·S22；杭州网 2019·S48）",
        "floor_basis": "低层度假酒店 3.8 m 档",
        "provenance": "杭州香格里拉饭店东楼",
    },
    {
        "id": "399028956", "grade": "C", "source": "landmark_layers", "confidence": 0.68,
        "layers": 5, "floor_m": 3.8,
        "layers_source": "主楼 5 层、附楼 4 层（会小二·S49）",
        "floor_basis": "酒店客房 3.8 m 档",
        "provenance": "华侨饭店",
    },
    {
        "id": "109882430", "grade": "C", "source": "landmark_layers", "confidence": 0.68,
        "layers": 4, "floor_m": 4.5,
        "layers_source": "4 层，1936 年历史建筑（AMI 建筑档案·S50）",
        "floor_basis": "低层度假酒店 4.5 m 档（含坡顶）",
        "provenance": "大华饭店",
    },
    {
        "id": "1178719882", "grade": "C", "source": "landmark_layers", "confidence": 0.66,
        "layers": 4, "floor_m": 3.8,
        "layers_source": "4 层（会小二·S51）",
        "floor_basis": "酒店客房 3.8 m 档",
        "provenance": "涌金饭店",
    },
    {
        "id": "976000575", "grade": "C", "source": "landmark_layers", "confidence": 0.70,
        "layers": 2, "floor_m": 5.5,
        "layers_source": "2 层（四季官网 Hotel Facts「Number of Stories: 2」·S52；"
                         "GOA 建面 43,537 m²）",
        "floor_basis": "低层庭院式 5.5 m 档（庭院式大层高，非普通客房层）",
        "provenance": "杭州西子湖四季酒店",
    },
    {
        "id": "507057184", "grade": "C", "source": "landmark_layers", "confidence": 0.72,
        "layers": 25, "floor_m": 3.3,
        "layers_source": "主楼 25 层（华润守正采购平台 2026·S16）",
        "floor_basis": "酒店客房 3.3 m 档",
        "provenance": "杭州维景国际大酒店——原 CNBH 31.6 m 超限被退回 D 的 3 层档（6.0 m），"
                      "此处按公开层数修正",
    },
    {
        "id": "547500303", "grade": "C", "source": "landmark_layers", "confidence": 0.70,
        "layers": 15, "floor_m": 3.3,
        "layers_source": "15 层（Business Travel News·S17）",
        "floor_basis": "酒店客房 3.3 m 档",
        "provenance": "中山国际大酒店主楼——原 CNBH 30.9 m 超限被退回 D（15.0 m）",
    },
    {
        "id": "547500304", "grade": "C", "source": "landmark_layers", "confidence": 0.68,
        "layers": 15, "floor_m": 3.3,
        "layers_source": "15 层（Business Travel News·S17，与主楼同体量）",
        "floor_basis": "酒店客房 3.3 m 档",
        "provenance": "中山国际大酒店附楼——原 CNBH 30.6 m 超限被退回 D（9.0 m）",
    },
]

# 无 OSM footprint 的补充记录。
# id 规则：`<parent_way_id>-<slug>`，写入前断言不与任何 OSM way_id 冲突，
# 因此不会出现两条同 id 记录。位置取父记录形心，footprint=none，不虚构多边形。
SYNTHETIC = [
    {
        "id": "970028320-tower", "parent": "970028320",
        "name": "黄龙体育中心·南北塔楼",
        "type": "tower",
        "height_m": 85.0, "grade": "A", "source": "landmark_official",
        "confidence": 0.92,
        "provenance": "塔楼地上 24 层、顶部标高 85 m（同济大学学报 2001 结构设计·S45）；"
                      "省体育局 2023 记约 85 m（·S14）；2007 报道记北塔 21 层 / 87 m（·S15）。"
                      "取 85 m，与场体 39 m 分条记录",
    },
]


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_path(p):
    """相对路径优先按当前工作目录，找不到再按仓库根目录解析。"""
    if os.path.isabs(p) or os.path.exists(p):
        return p
    alt = os.path.join(repo_root(), p)
    return alt if os.path.exists(alt) else p


def load_landmark_overlay(path):
    """读取 data/landmark-footprints.geojson；文件不存在视为空 overlay。"""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    feats = gj.get("features") or []
    items = []
    for i, ft in enumerate(feats):
        props = dict(ft.get("properties") or {})
        mode = props.get("mode", "record")
        fid = str(props.get("id") or ("overlay-%d" % i))
        if mode == "name_patch":
            target = str(props.get("target_id") or "")
            if not target:
                raise SystemExit("overlay 名称映射缺少 target_id：%s" % fid)
            items.append({"mode": mode, "id": fid, "target_id": target,
                          "name": props.get("name") or "",
                          "provenance": props.get("provenance") or ""})
            continue
        if mode != "record":
            raise SystemExit("overlay mode 未知：%s（%s）" % (mode, fid))
        if not fid.startswith("x-"):
            raise SystemExit("overlay 新增记录 id 必须以 x- 开头：%s" % fid)
        geom = ft.get("geometry") or {}
        if geom.get("type") != "Polygon":
            raise SystemExit("overlay 新增记录只支持 Polygon：%s" % fid)
        pts = [(float(p[0]), float(p[1])) for p in geom["coordinates"][0]]
        if len(pts) >= 2 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3:
            raise SystemExit("overlay 多边形点数不足：%s" % fid)
        h = props.get("height_m")
        if h is None:
            raise SystemExit("overlay 新增记录缺少 height_m：%s" % fid)
        h = float(h)
        if not 2.0 <= h <= 400.0:
            raise SystemExit("overlay 高度越界（2–400 m）：%s = %s" % (fid, h))
        src = props.get("height_source") or "landmark_media"
        if src not in GRADE:
            raise SystemExit("overlay height_source 未注册：%s（%s）" % (src, fid))
        items.append({
            "mode": mode, "id": fid, "pts": pts, "height_m": h,
            "name": props.get("name") or "",
            "type": props.get("type") or "building",
            "height_source": src,
            "source_grade": props.get("source_grade") or GRADE[src],
            "confidence": float(props.get("confidence", CONF[src][0])),
            "provenance": props.get("provenance") or "",
            "geometry_source": props.get("geometry_source") or "manual_trace",
            "footprint": props.get("footprint") or "approximate",
        })
    return items


def parse_osm_buildings(path):
    """解析 OSM：兼容 Overpass out geom（<nd> 自带坐标）与标准 <node> 引用。"""
    root = ET.parse(path).getroot()
    nodes = {}
    for nd in root.findall("node"):
        if nd.get("lat") is not None:
            nodes[nd.get("id")] = (float(nd.get("lon")), float(nd.get("lat")))
    out = []
    for way in root.findall("way"):
        tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
        b = tags.get("building")
        if not b or b == "no":
            continue
        pts = []
        for nd in way.findall("nd"):
            la, lo = nd.get("lat"), nd.get("lon")
            if la is not None and lo is not None:
                pts.append((float(lo), float(la)))
            elif nd.get("ref") in nodes:
                pts.append(nodes[nd.get("ref")])
        if len(pts) < 3:
            continue
        out.append({"id": way.get("id"), "type": b, "tags": tags, "pts": pts})
    return out


def ring_area_m(pts):
    lat = sum(p[1] for p in pts) / len(pts)
    ml = MLAT * math.cos(math.radians(lat))
    x0, y0 = pts[0]
    xy = [((p[0] - x0) * ml, (p[1] - y0) * MLAT) for p in pts]
    s = 0.0
    for i in range(len(xy)):
        x1, y1 = xy[i]
        x2, y2 = xy[(i + 1) % len(xy)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def parse_height(v):
    if not v:
        return None
    s = str(v).strip().lower().replace(",", ".")
    num = ""
    for ch in s:
        if ch.isdigit() or ch == ".":
            num += ch
        elif num:
            break
    if not num:
        return None
    try:
        h = float(num)
    except ValueError:
        return None
    if "ft" in s or "'" in s:
        h *= 0.3048
    return h if 2.0 <= h <= 400.0 else None


def parse_levels(v):
    if not v:
        return None
    try:
        lv = float(str(v).strip().replace(",", "."))
    except ValueError:
        return None
    return lv if 1.0 <= lv <= 60.0 else None


def fnv1a(s):
    h = 0x811C9DC5
    for ch in str(s):
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def classify_block(types, areas):
    n = len(types)
    if n == 0:
        return "default"
    share = Counter(types)
    commercial = (share["commercial"] + share["retail"]) / n
    institutional = (share["school"] + share["hospital"] + share["college"]
                     + share["university"]) / n
    residential = (share["residential"] + share["yes"] + share["house"]) / n
    high = (share["apartments"] + share["office"]) / n
    med_area = float(np.median(areas))
    if commercial > 0.40:
        return "commercial_core"
    if institutional > 0.30:
        return "institutional"
    if high > 0.30 and med_area > 2000:
        return "highrise"
    if residential > 0.60:
        if med_area < 400 and (share["house"] + share["yes"]) / n > 0.5:
            return "historic"
        return "old_residential"
    return "default"


def pick_levels(way_id, block_class):
    spec = TYPOLOGY[block_class]
    r = fnv1a(way_id) % 100
    acc = 0
    for lo, hi, pct in spec["bands"]:
        acc += pct
        if r < acc:
            span = hi - lo + 1
            return lo + (fnv1a("l" + str(way_id)) % span)
    lo, hi, _ = spec["bands"][-1]
    return lo + (fnv1a("l" + str(way_id)) % (hi - lo + 1))


def sha256(path, block=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(block)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


class RasterSampler:
    """按 512 px 块缓存读取，避免整幅 1.75 GB 载入。"""

    def __init__(self, path):
        import rasterio
        self.rio = rasterio
        self.src = rasterio.open(path)
        self.crs = self.src.crs
        self.block = 512
        self.cache = {}
        self.nodata = self.src.nodata

    def to_xy(self, lons, lats):
        from rasterio.warp import transform
        xs, ys = transform("EPSG:4326", self.crs, lons, lats)
        return list(xs), list(ys)

    def _block(self, bx, by):
        key = (bx, by)
        if key in self.cache:
            return self.cache[key]
        from rasterio.windows import Window
        col, row = bx * self.block, by * self.block
        w = min(self.block, self.src.width - col)
        hgt = min(self.block, self.src.height - row)
        if w <= 0 or hgt <= 0:
            arr = None
        else:
            arr = self.src.read(1, window=Window(col, row, w, hgt))
        if len(self.cache) > 64:
            self.cache.clear()
        self.cache[key] = arr
        return arr

    def sample(self, x, y):
        from rasterio.transform import xy as pixel_xy
        col_f, row_f = (~self.src.transform) * (x, y)
        col, row = int(math.floor(col_f)), int(math.floor(row_f))
        if col < 0 or row < 0 or col >= self.src.width or row >= self.src.height:
            return None
        arr = self._block(col // self.block, row // self.block)
        if arr is None:
            return None
        v = float(arr[row % self.block, col % self.block])
        if not np.isfinite(v):
            return None
        if self.nodata is not None and v == self.nodata:
            return None
        return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", required=True, nargs="+",
                    help="基底 OSM 在前，补丁簇在后；街区网格锚点只取第一个")
    ap.add_argument("--sample-osm", required=True)
    ap.add_argument("--cnbh", required=True)
    ap.add_argument("--landmarks", default="data/landmark-footprints.geojson")
    ap.add_argument("--out", default="data/building-heights.json")
    ap.add_argument("--stats", default="data/building-heights-stats.md")
    args = ap.parse_args()

    osm_paths = [resolve_path(p) for p in args.osm]
    overlay_path = resolve_path(args.landmarks)

    buildings = []
    base_n = 0
    seen_ids = set()
    for i, p in enumerate(osm_paths):
        part = parse_osm_buildings(p)
        if i == 0:
            base_n = len(part)
        for b in part:
            if b["id"] in seen_ids:
                continue
            seen_ids.add(b["id"])
            buildings.append(b)
    sample_ids = {b["id"] for b in parse_osm_buildings(args.sample_osm)}

    # --- 预处理：面积 / 形心 / 标签 ---
    recs = []
    n_base_recs = 0
    for idx, b in enumerate(buildings):
        area = ring_area_m(b["pts"])
        if area < 12:
            continue
        lon = sum(p[0] for p in b["pts"]) / len(b["pts"])
        lat = sum(p[1] for p in b["pts"]) / len(b["pts"])
        tags = b["tags"]
        recs.append({
            "id": b["id"], "type": b["type"], "area": area, "lon": lon, "lat": lat,
            "name": tags.get("name") or tags.get("name:zh") or "",
            "height_tag": parse_height(tags.get("height")),
            "levels": parse_levels(tags.get("building:levels")),
        })
        if idx < base_n:
            n_base_recs += 1

    # --- CNBH 采样 ---
    sampler = RasterSampler(args.cnbh)
    xs, ys = sampler.to_xy([r["lon"] for r in recs], [r["lat"] for r in recs])
    for r, x, y in zip(recs, xs, ys):
        vals = []
        for dx, dy in ((0, 0), (10, 0), (-10, 0), (0, 10), (0, -10)):
            v = sampler.sample(x + dx, y + dy)
            if v is not None:
                vals.append(v)
        r["cnbh_raw"] = round(float(np.median(vals)), 1) if vals else None

    # --- 街区类型（200 m 网格；锚点 lat0 只取基底文件，补丁不改变既有网格） ---
    cells = defaultdict(lambda: {"types": [], "areas": []})
    anchor = recs[:n_base_recs] or recs
    lat0 = float(np.mean([r["lat"] for r in anchor]))
    mlat = MLAT * math.cos(math.radians(lat0))
    for r in recs:
        cx = int(math.floor(r["lon"] * mlat / 200.0))
        cy = int(math.floor(r["lat"] * MLAT / 200.0))
        cells[(cx, cy)]["types"].append(r["type"])
        cells[(cx, cy)]["areas"].append(r["area"])
    block_class = {k: classify_block(v["types"], v["areas"]) for k, v in cells.items()}
    cell_n = {k: len(v["types"]) for k, v in cells.items()}

    # --- 分级赋值 ---
    out = {}
    for r in recs:
        cx = int(math.floor(r["lon"] * mlat / 200.0))
        cy = int(math.floor(r["lat"] * MLAT / 200.0))
        cls = block_class[(cx, cy)]
        n = cell_n[(cx, cy)]
        cnbh = r["cnbh_raw"]
        rec = {
            "name": r["name"],
            "type": r["type"],
            "lon": round(r["lon"], 7),
            "lat": round(r["lat"], 7),
            "area_m2": round(r["area"]),
            "osm_levels": r["levels"],
            "osm_height_tag": r["height_tag"],
            "cnbh_m": cnbh,
        }
        if r["height_tag"]:
            h, src = r["height_tag"], "osm_height"
        elif r["levels"]:
            h, src = round(r["levels"] * FLOOR_M, 1), "osm_levels"
        elif cnbh is not None and cnbh >= CNBH_MIN:
            h, src = cnbh, "cnbh"
        else:
            h, src = float(pick_levels(r["id"], cls)), "typology"
            h = round(h * TYPOLOGY[cls]["floor"], 1)
        grade = GRADE[src]
        conf, reason = CONF[src]
        suspect = False
        if src == "typology":
            conf = 0.20 if n < 5 else 0.30
            src_reason = ("街区 %s（200 m 格内 %d 栋）→ %d 层 × %.1f m"
                          % (cls, n, round(h / TYPOLOGY[cls]["floor"]), TYPOLOGY[cls]["floor"]))
        elif src == "cnbh":
            if cnbh > CNBH_MAX:
                conf, suspect = 0.35, True
                src_reason = ("CNBH 10 m 采样 %.1f m，超过 30 m 采纳上限；"
                              "按保留采样值处理（产品高值截断风险，标 suspect），"
                              "不再退回 D 的街区层数档" % cnbh)
            elif cnbh > 25.0:
                conf, suspect = 0.35, True
                src_reason = ("CNBH 10 m 采样 %.1f m，接近产品天花板（约 43 m），"
                              "高层可能被截断，建议实测复核" % cnbh)
            else:
                src_reason = "CNBH 10 m 采样 %.1f m（≤30 m 采纳区）" % cnbh
        elif src == "osm_levels":
            src_reason = "OSM levels=%.0f × %.1f m" % (r["levels"], FLOOR_M)
        else:
            src_reason = "OSM height 标签 %s m" % r["height_tag"]
        kind = VALUE_KIND[src]
        rec.update({
            "height_m": h,
            "height_source": src,
            "source_grade": grade,
            "value_kind": kind,
            "is_measured": kind == "measured",
            "is_inferred": kind in DERIVED_KINDS,
            "confidence": round(conf, 2),
            "confidence_reason": reason + "；" + src_reason,
            "suspect": suspect,
            "block_class": cls if src == "typology" else None,
        })
        out[r["id"]] = rec

    # --- 地标覆盖（人工核对值，优先级高于上面所有自动来源） ---
    for lm in LANDMARKS:
        wid = lm["id"]
        if wid not in out:
            raise SystemExit("地标覆盖 id 不存在于 OSM 结果：%s" % wid)
        rec = out[wid]
        src = lm["source"]
        if src == "landmark_layers":
            h = round(float(lm["layers"]) * float(lm["floor_m"]), 1)
        else:
            h = float(lm["height_m"])
        kind = VALUE_KIND[src]
        rec.update({
            "height_m": h,
            "height_source": src,
            "source_grade": lm["grade"],
            "value_kind": kind,
            "is_measured": kind == "measured",
            "is_inferred": kind in DERIVED_KINDS,
            "confidence": round(float(lm["confidence"]), 2),
            "confidence_reason": CONF[src][1] + "；" + lm["provenance"],
            "provenance": lm["provenance"],
            "suspect": False,
            "block_class": None,
            "landmark": True,
        })
        if src == "landmark_layers":
            rec.update({
                "layers": float(lm["layers"]),
                "floor_m": float(lm["floor_m"]),
                "layers_source": lm["layers_source"],
                "floor_basis": lm["floor_basis"],
            })

    # --- 无 footprint 的补充记录（id 唯一性在此断言） ---
    osm_ids = {r["id"] for r in recs}
    for syn in SYNTHETIC:
        sid, parent = syn["id"], syn["parent"]
        if sid in out or sid in osm_ids:
            raise SystemExit("补充记录 id 与已有 way_id 冲突：%s" % sid)
        prow = out.get(parent)
        if prow is None:
            raise SystemExit("补充记录的 parent way 不存在：%s" % parent)
        kind = VALUE_KIND[syn["source"]]
        out[sid] = {
            "name": syn["name"],
            "type": syn["type"],
            "lon": prow["lon"],
            "lat": prow["lat"],
            "area_m2": 0,
            "osm_levels": None,
            "osm_height_tag": None,
            "cnbh_m": None,
            "height_m": float(syn["height_m"]),
            "height_source": syn["source"],
            "source_grade": syn["grade"],
            "value_kind": kind,
            "is_measured": False,
            "is_inferred": kind in DERIVED_KINDS,
            "confidence": round(float(syn["confidence"]), 2),
            "confidence_reason": CONF[syn["source"]][1] + "；" + syn["provenance"],
            "provenance": syn["provenance"],
            "suspect": False,
            "block_class": None,
            "landmark": True,
            "synthetic": True,
            "parent_way_id": parent,
            "footprint": "none",
            "geometry_note": "OSM 无独立塔楼 footprint；坐标取场体形心，"
                             "南北两塔合为本条记录，不代表单体轮廓",
        }

    # --- 人工补录 overlay（最高优先级；来源 data/landmark-footprints.geojson） ---
    overlay_items = load_landmark_overlay(overlay_path)
    overlay_n = 0
    for item in overlay_items:
        if item["mode"] == "name_patch":
            tid = item["target_id"]
            if tid not in out:
                raise SystemExit("overlay 名称映射目标不存在：%s -> %s" % (item["id"], tid))
            rec = out[tid]
            if item["name"]:
                rec["name"] = item["name"]
            rec["name_source"] = "landmark_overlay"
            rec["landmark_name"] = True
            if item["provenance"]:
                rec["name_provenance"] = item["provenance"]
            continue

        oid = item["id"]
        if oid in out or oid in osm_ids:
            raise SystemExit("overlay 记录 id 冲突：%s" % oid)
        area = ring_area_m(item["pts"])
        lon = sum(p[0] for p in item["pts"]) / len(item["pts"])
        lat = sum(p[1] for p in item["pts"]) / len(item["pts"])
        xs1, ys1 = sampler.to_xy([lon], [lat])
        vals = []
        for dx, dy in ((0, 0), (10, 0), (-10, 0), (0, 10), (0, -10)):
            v = sampler.sample(xs1[0] + dx, ys1[0] + dy)
            if v is not None:
                vals.append(v)
        cnbh = round(float(np.median(vals)), 1) if vals else None
        src = item["height_source"]
        kind = VALUE_KIND[src]
        reason = CONF[src][1] + ("；" + item["provenance"] if item["provenance"] else "")
        out[oid] = {
            "name": item["name"],
            "type": item["type"],
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "area_m2": round(area),
            "osm_levels": None,
            "osm_height_tag": None,
            "cnbh_m": cnbh,
            "height_m": item["height_m"],
            "height_source": src,
            "source_grade": item["source_grade"],
            "value_kind": kind,
            "is_measured": kind == "measured",
            "is_inferred": kind in DERIVED_KINDS,
            "confidence": round(item["confidence"], 2),
            "confidence_reason": reason,
            "provenance": item["provenance"],
            "suspect": False,
            "block_class": None,
            "landmark": True,
            "overlay": True,
            "footprint": item["footprint"],
            "geometry_source": item["geometry_source"],
        }
        overlay_n += 1

    # --- 统计 ---
    total = len(out)
    skipped = len(buildings) - len(recs)
    suspect_n = sum(1 for v in out.values() if v["suspect"])
    grade_n = Counter(v["source_grade"] for v in out.values())
    src_n = Counter(v["height_source"] for v in out.values())
    kind_n = Counter(v["value_kind"] for v in out.values())
    landmark_n = sum(1 for v in out.values() if v.get("landmark"))
    cnbh_over_n = sum(1 for v in out.values()
                      if (v.get("cnbh_m") or 0) > CNBH_MAX)
    cnbh_over_kept = sum(1 for v in out.values()
                         if v["height_source"] == "cnbh"
                         and (v.get("cnbh_m") or 0) > CNBH_MAX)
    sample_recs = [v for k, v in out.items() if k in sample_ids]
    sample_total = len(sample_ids)
    sample_grade = Counter(v["source_grade"] for v in sample_recs)
    sample_src = Counter(v["height_source"] for v in sample_recs)
    sample_kind = Counter(v["value_kind"] for v in sample_recs)
    sample_covered = sum(1 for v in sample_recs)
    sample_tag_n = sum(1 for b in parse_osm_buildings(args.sample_osm)
                       if parse_height(b["tags"].get("height")))
    sample_lv_n = sum(1 for b in parse_osm_buildings(args.sample_osm)
                      if parse_levels(b["tags"].get("building:levels")))

    bbox = [round(min(r["lon"] for r in recs), 5), round(min(r["lat"] for r in recs), 5),
            round(max(r["lon"] for r in recs), 5), round(max(r["lat"] for r in recs), 5)]
    if overlay_n:
        olon = [v["lon"] for v in out.values() if v.get("overlay")]
        olat = [v["lat"] for v in out.values() if v.get("overlay")]
        bbox = [round(min(bbox[0], min(olon)), 5), round(min(bbox[1], min(olat)), 5),
                round(max(bbox[2], max(olon)), 5), round(max(bbox[3], max(olat)), 5)]

    meta = {
        "schema": 3,
        "generated": str(date.today()),
        "generator": "scripts/build-building-heights.py",
        "crs": "footprints WGS84 (EPSG:4326); CNBH sampled in EPSG:32651",
        "bbox_wgs84": bbox,
        "coverage": "西湖环湖 + 地标补丁簇（%d 条记录，含 %d 条地标覆盖、"
                    "%d 条无 footprint 补充记录、%d 条 overlay 补录）"
                    % (total, landmark_n, len(SYNTHETIC), overlay_n),
        "sources": {
            "osm": [{"path": os.path.abspath(p), "sha256": sha256(p)} for p in osm_paths],
            "sample_osm": {"path": os.path.abspath(args.sample_osm),
                           "sha256": sha256(args.sample_osm)},
            "cnbh": {"path": os.path.abspath(args.cnbh), "sha256": sha256(args.cnbh)},
            "landmarks": {"path": os.path.abspath(overlay_path) if os.path.exists(overlay_path) else None,
                          "sha256": sha256(overlay_path) if os.path.exists(overlay_path) else None,
                          "features": len(overlay_items), "records": overlay_n},
            "landmark_review": {"path": "docs/40-地标高度清单-20261109.md",
                                "entries": len(LANDMARKS), "synthetic": len(SYNTHETIC)},
        },
        "rules": ("overlay > A landmark_official > A* landmark_media > A osm_height(confirmed) > "
                  "B osm_height > C landmark_layers > C osm_levels×3.2 > "
                  "C cnbh(≥3m, >30m 保留并 suspect) > D typology"),
        "grade_order": list(GRADE_ORDER),
        "synthetic_ids": [s["id"] for s in SYNTHETIC],
        "overlay_ids": [v["id"] for v in overlay_items if v["mode"] == "record"],
        "ownership": "data/OWNERSHIP.md",
        "counts": {"buildings": total, "skipped_area_lt_12m2": skipped,
                   "suspect": suspect_n, "landmark": landmark_n,
                   "overlay": overlay_n, "name_patches": len(overlay_items) - overlay_n,
                   "cnbh_over_30m_total": cnbh_over_n,
                   "cnbh_over_30m_kept": cnbh_over_kept,
                   "grades": dict(grade_n), "sources": dict(src_n),
                   "value_kinds": dict(kind_n)},
        "sample_700m": {"buildings": sample_total, "grades": dict(sample_grade),
                        "sources": dict(sample_src),
                        "value_kinds": dict(sample_kind)},
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "buildings": out}, f, ensure_ascii=False,
                  separators=(",", ":"))
    os.replace(tmp, args.out)

    # --- 可读统计 ---
    lines = []
    lines.append("# 建筑高度数据 · 来源统计\n")
    lines.append("> 自动生成，请勿手改；唯一写入方见 [OWNERSHIP.md](OWNERSHIP.md)。"
                 "生成日期 %s。\n" % meta["generated"])
    lines.append("## 来源与口径\n")
    lines.append("| 项 | 内容 |\n|---|---|")
    lines.append("| 建筑轮廓 | `xihu-ring.osm`（Overpass `out geom`）+ %d 个补丁簇，只取 "
                 "`building≠no`、闭合、面积 ≥12 m² 的 way |" % (len(osm_paths) - 1))
    lines.append("| 样区轮廓 | `east-shore.osm`（700 m 视宽样区），291 栋 |")
    lines.append("| 高度栅格 | `cnbh-x121y31.tif`，10 m，EPSG:32651 |")
    lines.append("| 坐标系 | 轮廓 WGS84（EPSG:4326）；栅格采样 EPSG:32651 |")
    lines.append("| 覆盖范围 | WGS84 经度 %.4f–%.4f，纬度 %.4f–%.4f |"
                 % (bbox[0], bbox[2], bbox[1], bbox[3]))
    lines.append("| 覆盖栋数 | %d |" % total)
    lines.append("")
    lines.append("## 总量\n")
    lines.append("| 项 | 值 |\n|---|---:|")
    lines.append("| 建筑记录 | %d |" % total)
    lines.append("| 有非零高度 | %d（100%%） |" % total)
    lines.append("| 轮廓面积 <12 m² 跳过 | %d |" % skipped)
    lines.append("| 标记 `suspect` | %d |" % suspect_n)
    lines.append("| overlay 补录 | %d |" % overlay_n)
    if overlay_n or len(overlay_items) - overlay_n:
        lines.append("")
        lines.append("## overlay 补录（`data/landmark-footprints.geojson`）\n")
        lines.append("| id | 名称 | 高度 | 等级 | 几何 |\n|---|---|---:|---:|---|")
        for it in overlay_items:
            if it["mode"] == "name_patch":
                lines.append("| `%s`（名称映射） | %s → `%s` | 不改 | — | 既有轮廓 |"
                             % (it["id"], it["name"], it["target_id"]))
            else:
                lines.append("| `%s` | %s | %.1f | %s | %s |"
                             % (it["id"], it["name"], it["height_m"],
                                it["source_grade"], it["footprint"]))
    lines.append("")
    lines.append("## 等级分布（全环湖 %d 栋）\n" % total)
    lines.append("| 等级 | 来源 | 条数 | 占比 |\n|---|---|---:|---:|")
    for g in GRADE_ORDER:
        n = grade_n.get(g, 0)
        lines.append("| %s | %s | %d | %.2f%% |" % (g, GRADE_LABELS[g], n, 100 * n / total))
    lines.append("")
    lines.append("> `A*` 是**独立等级**，不是 A 的别名：它有公开总高，但只来自媒体 / 百科等"
                 "二手口径，未经规划公示或图纸佐证，因此不并入 A。等级顺序 "
                 "A > A\\* > B > C > D。\n")
    lines.append("## `value_kind` 分布（C 级不再是一个暗桶）\n")
    lines.append("| `value_kind` | 含义 | 条数 |\n|---|---|---:|")
    kind_meta = [
        ("measured", "现场实测"),
        ("reported_official", "官方 / 设计方 / 结构论文公布总高"),
        ("reported_media", "媒体·百科等二手口径总高"),
        ("mapped", "OSM `height` 标签"),
        ("derived_layers", "公开层数 × 按用途层高"),
        ("derived_osm_levels", "OSM `building:levels` × 3.2"),
        ("cnbh_raster", "CNBH 10 m 栅格采样"),
        ("inferred", "街区类型推断"),
    ]
    for k, desc in kind_meta:
        lines.append("| `%s` | %s | %d |" % (k, desc, kind_n.get(k, 0)))
    lines.append("")
    lines.append("> **`cnbh_raster` 与 `derived_layers` 必须分开看。** 两者在 C 级里混装时，"
                 "前者带 10 m 栅格的系统性低估，后者误差是 ±(0.5 m × 层数)，"
                 "精度差一个量级。统计与下游取用都要按 `value_kind` 分流。\n")
    lines.append("| height_source | 条数 |\n|---|---:|")
    for s in ("survey", "landmark_official", "landmark_media", "osm_height",
              "landmark_layers", "osm_levels", "cnbh", "typology"):
        lines.append("| `%s` | %d |" % (s, src_n.get(s, 0)))
    lines.append("")
    lines.append("## 700 m 样区（%d 栋）\n" % sample_total)
    lines.append("| 项 | 数量 | 覆盖率 |\n|---|---:|---:|")
    lines.append("| 有 `height` 标签 | %d | %.2f%% |" % (sample_tag_n, 100 * sample_tag_n / sample_total))
    lines.append("| 有 `building:levels` | %d | %.2f%% |" % (sample_lv_n, 100 * sample_lv_n / sample_total))
    lines.append("| 本文件给出高度 | %d | %.2f%% |" % (sample_covered, 100 * sample_covered / sample_total))
    lines.append("")
    lines.append("| 等级 | 条数 | 占样区 |\n|---|---:|---:|")
    for g in GRADE_ORDER:
        n = sample_grade.get(g, 0)
        lines.append("| %s | %d | %.2f%% |" % (g, n, 100 * n / sample_total))
    lines.append("")
    lines.append("| height_source | 条数 |\n|---|---:|")
    for s in ("survey", "landmark_official", "landmark_media", "osm_height",
              "landmark_layers", "osm_levels", "cnbh", "typology"):
        lines.append("| `%s` | %d |" % (s, sample_src.get(s, 0)))
    lines.append("")
    lines.append("| `value_kind` | 条数 |\n|---|---:|")
    for k, _ in kind_meta:
        lines.append("| `%s` | %d |" % (k, sample_kind.get(k, 0)))
    lines.append("")
    lines.append("## 口径说明\n")
    lines.append("- `value_kind`：`measured`（实测）/ `mapped`（OSM `height` 标签）/ "
                 "`reported_official`（官方·设计方·结构论文总高）/ "
                 "`reported_media`（媒体·百科等二手口径总高）/ "
                 "`derived_layers`（公开层数 × 按用途层高）/ "
                 "`derived_osm_levels`（OSM levels × 3.2）/ "
                 "`cnbh_raster`（CNBH 栅格采样）/ `inferred`（类型推断）。")
    lines.append("- `is_measured` 仅实测为 true；`is_inferred` 对 "
                 "`derived_layers` / `derived_osm_levels` / `cnbh_raster` / `inferred` 为 true。")
    lines.append("- CNBH 采纳下限 3 m；**超过 30 m 不再退回 D**，而是保留采样值并标 "
                 "`suspect=true`、`confidence=0.35`（高值有截断风险，但量级仍优于街区层数档）。"
                 "本次采样值 >30 m 的共 %d 条，其中 %d 条按保留值落 C，其余 %d 条"
                 "已被地标覆盖表按公开层数接管。"
                 % (cnbh_over_n, cnbh_over_kept, cnbh_over_n - cnbh_over_kept))
    lines.append("- 地标覆盖表（%d 条）与补充记录（%d 条）见脚本内 `LANDMARKS` / `SYNTHETIC`，"
                 "逐条依据见 `docs/40-地标高度清单-20261109.md`。"
                 % (len(LANDMARKS), len(SYNTHETIC)))
    lines.append("- `derived_layers` 记录必须带 `layers` / `floor_m` / `layers_source` / "
                 "`floor_basis` 四个字段，能追溯到「层数来自哪、层高用了哪档」。")
    lines.append("- 无 footprint 的补充记录 id 形如 `<parent_way_id>-<slug>`，"
                 "生成时断言不与任何 OSM way_id 冲突；`footprint=none`，坐标取父记录形心，"
                 "不代表单体轮廓（当前：%s）。"
                 % "、".join("`%s`" % s["id"] for s in SYNTHETIC))
    lines.append("- D 级由 200 m 街区类型 + `fnv1a(way_id)` 固定取档，跨刷新稳定。")
    lines.append("- `survey`（现场实测）当前 0 条，接入后应覆盖为最高优先级。")
    with open(args.stats, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(json.dumps({"buildings": total, "grades": dict(grade_n),
                      "sources": dict(src_n), "value_kinds": dict(kind_n),
                      "suspect": suspect_n, "landmark": landmark_n,
                      "overlay": overlay_n,
                      "sample": {"n": sample_total, "grades": dict(sample_grade),
                                 "sources": dict(sample_src),
                                 "value_kinds": dict(sample_kind)}}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
