# -*- coding: utf-8 -*-
"""生成《合格 Agent》思维导图 PNG（飞书文档可插入）。布局自适应，无溢出。"""
from PIL import Image, ImageDraw, ImageFont
import os

BG = (250, 250, 248)
INK = (28, 32, 38)
MUTED = (98, 106, 118)

BRANCHES = [
    ("架构 · 谁拥有什么", (37, 99, 178), [
        "五段链路：观测→决策→动作→校验→回执",
        "模型不产生：坐标 / ID / 价格 / 结论",
        "观测要诚实：冻结快照 + 指纹 + 标注「非事实」",
        "反模式：状态机寄生在 UI 里",
    ]),
    ("代码 · 让编造成为类型错误", (16, 128, 108), [
        "strictObject + 枚举 + evidence 字段",
        "工具说明必须写「不保证什么」",
        "干跑(validate) 与提交(submit) 分离",
        "风险 = diff 的纯函数，不问模型",
        "失败有名字：5 态 + 12 类诊断码",
        "幂等 / deadline / 退款 / 事件脱锁",
    ]),
    ("逻辑 · 敢不敢说不知道", (170, 92, 20), [
        "失败顺序：有依据 > 说明拒绝 > 假布局",
        "假布局永远是 0 容忍",
        "评测三件套：正例 / 负例 / 误报对照",
        "算不了的判据不计分，并写明原因",
        "阈值本身要能被拷问",
    ]),
    ("幕景现状 · 8 过 1 部分 3 未过", (150, 45, 92), [
        "过：无几何权 · 逐字溯源 · diff 风险",
        "过：三段式撤销 · 失败命名 · 运营卫生",
        "断① 编排住在 React（5160 + 3908 行）",
        "断② 模型只分类，不参与设计",
        "断③ 代码抢路由，出问题不可归因",
        "断④ 92 个测试，CI 只跑小程序",
        "断⑤ 说对了做错：缩放 10% 成 0.2×",
    ]),
]

FONT_DIR = r"C:\Windows\Fonts"
def font(names, size):
    for f in names:
        p = os.path.join(FONT_DIR, f)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

F_TITLE = font(["msyhbd.ttc", "simhei.ttf"], 40)
F_SUB   = font(["msyh.ttc", "simsun.ttc"], 18)
F_ROOT  = font(["msyhbd.ttc", "simhei.ttf"], 46)
F_BR    = font(["msyhbd.ttc", "simhei.ttf"], 27)
F_LEAF  = font(["msyh.ttc", "simsun.ttc"], 22)

_probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
def tw(s, f):
    l, _, r, _ = _probe.textbbox((0, 0), s, font=f)
    return r - l

ROW, GAP = 56, 40
TOP = 190
PAD_L, PAD_R = 72, 60
ROOT_W = 220
H_GAP1, H_GAP2 = 54, 58
BR_W = max(tw(name, F_BR) for name, _, _ in BRANCHES) + 56
LEAF_W = max(tw(lf, F_LEAF) for _, _, ls in BRANCHES for lf in ls) + 48

X_ROOT = PAD_L
X_BR = X_ROOT + ROOT_W + H_GAP1
X_LEAF = X_BR + BR_W + H_GAP2
W = X_LEAF + LEAF_W + PAD_R

leaf_rows = sum(len(b[2]) for b in BRANCHES)
body_h = leaf_rows * ROW + (len(BRANCHES) - 1) * GAP
H = TOP + body_h + 110

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img, "RGBA")

def rrect(box, r, fill, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

def text_center(box, s, f, fill):
    l, t, r, b = d.textbbox((0, 0), s, font=f)
    d.text(((box[0] + box[2] - (r - l)) / 2 - l, (box[1] + box[3] - (b - t)) / 2 - t), s, font=f, fill=fill)

def curve(p0, p1, color, width=3):
    x0, y0 = p0
    x1, y1 = p1
    mx = (x0 + x1) / 2
    pts = [(x0 + (x1 - x0) * (i / 40),
            (1 - i/40)**3*y0 + 3*(1 - i/40)**2*(i/40)*y0
            + 3*(1 - i/40)*(i/40)**2*y1 + (i/40)**3*y1) for i in range(41)]
    d.line(pts, fill=color, width=width, joint="curve")

# 标题
d.text((PAD_L, 46), "什么算一个合格的 AI Agent", font=F_TITLE, fill=INK)
d.text((PAD_L + 2, 104), "一条链路 · 十二问 · 七处断点", font=F_SUB, fill=MUTED)

ROOT_CY = TOP + body_h / 2
ROOT_BOX = (X_ROOT, ROOT_CY - 82, X_ROOT + ROOT_W, ROOT_CY + 82)

y = TOP
for name, color, leaves in BRANCHES:
    block_h = len(leaves) * ROW
    br_cy = y + block_h / 2
    br_box = (X_BR, br_cy - 44, X_BR + BR_W, br_cy + 44)

    curve((ROOT_BOX[2], ROOT_CY), (br_box[0], br_cy), color + (185,), 4)
    rrect(br_box, 16, color + (255,))
    text_center(br_box, name, F_BR, (255, 255, 255))

    for i, leaf in enumerate(leaves):
        ly = y + i * ROW
        leaf_box = (X_LEAF, ly + 7, X_LEAF + LEAF_W, ly + 7 + 42)
        curve((br_box[2], br_cy), (leaf_box[0], ly + 28), color + (105,), 2)
        rrect(leaf_box, 10, (255, 255, 255), color + (68,), 2)
        d.text((leaf_box[0] + 20, ly + 28 - 14), leaf, font=F_LEAF, fill=INK)

    y += block_h + GAP

rrect(ROOT_BOX, 20, (28, 32, 38))
d.text((ROOT_BOX[0] + 36, ROOT_CY - 62), "合格", font=F_ROOT, fill=(255, 255, 255))
d.text((ROOT_BOX[0] + 36, ROOT_CY - 6), "Agent", font=F_ROOT, fill=(255, 255, 255))

d.line([(PAD_L, H - 66), (W - PAD_R, H - 66)], fill=(214, 216, 214), width=1)
d.text((PAD_L, H - 52),
       "判据来源：docs/63-Agent合格度与断点审计-20261121.md  ·  代码口径 2026-11-21",
       font=F_SUB, fill=MUTED)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "63-思维导图-Agent合格度.png")
img.save(out, "PNG")
print("saved", out, img.size)
