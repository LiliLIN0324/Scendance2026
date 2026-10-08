# tools/floorplan

将平面图栅格转成**米制、轴对齐的墙体矩形**，供 `.local-dev/blender-demo/plan.html` 消费。

## 三个候选项目的评测结论

| 项目 | 能力 | 权重可得性 | 许可证 | 结论 |
|---|---|---|---|---|
| [RasterScan/Floor-Plan-Recognition](https://github.com/RasterScan/Floor-Plan-Recognition) | **栅格→矢量**（正是我们要的）+ 房间判定 | Docker 镜像，`/get_machine_code` + `/activate_machine` 机器码激活换「终身许可」 | 无开源许可证，README 导向商业授权与 RapidAPI | **能力最契合，但无法复用**（专有许可） |
| [ozturkoktay/floor-plan-room-segmentation](https://github.com/ozturkoktay/floor-plan-room-segmentation) | U-Net+ResNet 语义分割（房间/墙/门/窗）+ 房间框 | 仓库里**只有一份 11.7 MB notebook 和 LICENSE**，无权重、无数据集、无推理脚本 | MIT | 代码可复用，但必须自己训练；且输出是像素掩膜，不是米制矢量 |
| [TAU-VAILab/WAFFLE](https://github.com/TAU-VAILab/WAFFLE) | 面向**真实世界（in-the-wild）**平面图的墙检测、OCR、图例理解；WACV 2025 | 微调权重在 SharePoint 链接上，**实测 HTTP 403**，不可公开下载 | 仓库无 LICENSE 文件；README 称 Wikimedia Commons，论文称数据集 CC BY 4.0 | 方法最契合「手绘/翻拍」这类脏图，但**关键权重拿不到** |

补充核查：

- WAFFLE 的 `src/helpers/wall_detection_inf.py` 是 **ControlNet 扩散**方案：以 `CompVis/stable-diffusion-v1-4` 为基座，跑 16 个样本取平均得到二值墙掩膜。基座模型公开可用，但**它自己的 ControlNet 权重**就是那个 403 的 SharePoint 目录。
- WAFFLE 的 `clipseg_inf.py` 基于 **`CIDAS/clipseg-rd64-refined`**（公开、非 gated、78 万下载）。我们直接拿基座模型在本仓库的两张图上实测（见下），结论是**基座 CLIPSeg 抽不出平面图的细线结构**——这正是 WAFFLE 需要专门微调它的原因。
- 顺带核查了一个看似现成的替代：`JessiP23/cubicasa-segformer-v2` 有 `model.onnx` 和 `inference.py`，但它的 `metrics.json` 是 **mIoU 0.122 / Wall 0.309 / Room 全为 0**，是一次失败的训练，不可用。

### CLIPSeg 实测（`segment-walls.py`，咖啡馆平面图，1200×1200）

```
wall             coverage>0.5: 0.3028   mean prob 0.3434   peak 0.627
glass window     coverage>0.5: 0.0020   mean prob 0.0619
furniture        coverage>0.5: 0.0291   mean prob 0.1136
```

「wall」输出的是覆盖整个室内的一大块（峰值概率仅 0.63），不是墙线；「glass window」0.2% 等于没检出。原因是 CLIPSeg 工作在 352×352，细线级特征在缩放中消失。

### 所以复用什么

三个项目的**权重都无法直接获得**，因此复用的是它们共同预设的那一层：**掩膜 → 米制矢量**。`extract-walls.py` 的 `--mode mask` 接受的正是三者一致的输出格式（二值墙掩膜 PNG），模型一旦可得即可直接接入，不必改这个文件。今天可用的是 `--mode weight`：利用制图线宽语义，无需任何权重。

## 用法

```sh
# 今天可用：从栅格按线宽直接抽墙，无需模型
python tools/floorplan/extract-walls.py \
  --image plan.jpg --mode weight --heavy 3 \
  --venue 7.2 8.0 --calibration 47 227 1017 1316 \
  --out walls.json

# 模型到位后：喂入二值墙掩膜
python tools/floorplan/extract-walls.py \
  --mask wall.png --mode mask \
  --venue 7.2 8.0 --calibration 47 227 1017 1316 \
  --out walls.json

# 找门窗开口：逐条墙线走一遍，报出断开处
python tools/floorplan/find-openings.py \
  --image plan.jpg --calibration 47 227 1017 1316 --venue 7.2 8.0 \
  --line x=1017 x=957 --axis z

# 文字提示分割（公开 CLIPSeg 基座；对细线平面图不可用，见上）
python tools/floorplan/segment-walls.py --image plan.jpg --out seg
```

`--calibration` 是**原图**像素下的场地外框，`--venue` 是实际米制尺寸；`--heavy` 是判为「剖切结构」的最小笔画宽度（px）。输出 JSON 含每段墙的 `px` 证据和 `metres` 结果，可回查。

**找开口时务必查同一面墙的两条线**：墙通常画成两个面，真门会在两面同时断开；只有一条线断开多半是杂笔或线条倾斜。给 `find-openings.py` 传 `--line` 时把内外两条线都列上。

## 已验证

### 咖啡馆平面图（20.0 × 10.4 m）

`--mode weight --heavy 3` 输出 35 段墙，其中南侧 5 个柱墩与手工实测一致：

| 抽出（m） | 手工实测（m） |
|---|---|
| x 0.00–1.02 | 0.00–1.00（西南角柱） |
| x 4.92–5.77 | 4.92–5.73 |
| x 9.66–10.51 | 9.64–10.49 |
| x 14.41–15.27 | 14.38–15.25 |
| x 19.15–20.00 | 19.17–19.98（东南角柱） |

全部落在 z 9.44–10.22（实测 9.44–10.36）。

### 手绘平面图（7.2 × 8.0 m）

`find-openings.py` 在东墙**内外两条线**上都找到同一处断开，互相印证：

```
line x=1017   drawn 0.00..1.02   drawn 1.59..8.01   OPENING 1.01..1.59 m (0.58 m)
line x= 957   drawn 0.20..1.01   drawn 1.59..7.71   OPENING 1.00..1.59 m (0.60 m)
```

即东墙 z 1.00–1.59 处有一道 0.59 m 的门洞。中间轴线上另有一道**细隔墙**：两条平行粗线 x 529–532 与 552–556 px（间隔 23 px = 0.17 m），在 z 2.09–2.72 处断开。

## 已知局限

1. **双线画法的墙不会被合成一条墙带。** 墙画成两条平行线、中间空白时，工具得到两条 0.03 m 的细带，而不是一条 0.26–0.45 m 的墙。当前只合并**连续**有墨的行/列；需要补一步「把相隔一个墙厚的两条平行线配对成墙」。这是手绘/线稿类图纸上抽不出墙厚度的直接原因。
2. **墙与家具贴着时会被并宽。** 咖啡馆图北侧墙与吧台连续，输出成 0.96 m 的一条带。`--heavy` 与 `--bridge` 可调，但两者本质上靠墨迹连通性区分，没有语义。
3. **`--mode weight` 依赖线宽可分。** 若线宽只有 1 px 与 2 px 之差（模糊或低分辨率扫描），需先退回人工判读。
4. **只处理轴对齐墙体。** 斜墙、弧形墙未涉及。
5. **`segment-walls.py` 需要 `transformers`**（本机已装 5.19.0）；`extract-walls.py` 只需 numpy + Pillow。
