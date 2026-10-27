# 晴光 · 收起态静帧（assets/still/collapsed）

收起态 = 「场边半身 / 微姿态」——角色在场、靠画布下边沿露上半身并轻微侧倾，**不是默认头放大**。

本版为**重锚定后的 v2**：身份/配色锚定 `_refs/head_3d_master.png`（见 `docs/REFERENCE.md`），
并补回参考图标志性的**头顶暖白发光体**。透明底 RGBA。

## 文件

| 文件 | 像素 | 字节 | SHA-256（前 16 位） |
|---|---|---|---|
| `qingguang-40-collapsed.png` | 40×40 | 3883 | `8FC15D58B912FAAE` |
| `qingguang-40-collapsed@2x.png` | 80×80 | 12496 | `F875414B06B936E8` |
| `qingguang-40-collapsed-32.png` | 32×32 | 2655 | `E32F967C27AE397D` |
| `qingguang-32-collapsed.png` | 32×32 | 2655 | `E32F967C27AE397D` |

后两个 32px 文件是同一份内容的两种命名（SHA-256 完全一致）。设计尺寸 40×40。

## 配色（40px 实测 8 段，top→bottom，`alpha>8` 口径）

`#d5d9bd`（sage 圆顶 + 暖白发光体）→ `#c2c7a2` → `#a59663`（奶油/卡其渐变）→ `#aca072`
→ `#b2a678` → `#ac9968` → `#979374`（暗橄榄）→ `#b6b289`。顶部暖白发光体 maxL=255。

## 生成（可复现）

1. **姿态**：`qwen-image-3.0` img2img，参考 master 扁平定锚件
   `.scratch/qingguang/lead/collapsed-ref.png`（master 饱和×1.45 + 侧倾盖板），tag `col_v4`，
   prompt hex 点名配色 +「靠画面下边沿露上半身、轻微侧倾、目光斜下」。
2. **配色修正 + 发光体**：qwen-image-3.0 会把参考的鼠尾草绿渲成去饱和灰棕（两轮 8 张全部如此），
   因此加一步确定性色迁移：`node .scratch/qingguang/lead/colorize.cjs` 以 master 垂直色度斜坡
   逐像素改写候选的 Hue/Sat、保留明度；再 `node .scratch/qingguang/lead/paintglow.cjs`
   确定性补画头顶 `#FFF9E6` 正圆暖白发光体。
3. **抠图 + 尺寸梯**：`node .scratch/qingguang/lead/deliver.cjs --type collapsed
   --src .scratch/qingguang/lead/gen/col_v4_0_cg.png --outdir assets/still/collapsed`
   （抠图 = alpha bbox 裁剪 → 0.5px 羽化 → lanczos3 出 40/80/32）。

选用原图：`.scratch/qingguang/lead/gen/col_v4_0.png`（1024×1024，不透明白底）→ 色迁移 + 发光体后
`.scratch/qingguang/lead/gen/col_v4_0_cg.png`。

## 验收（客观）

- **身份 + 姿态**：`qwen3-vl-plus` 四图同批复核——`col_v4_0` 判定：柔软 3D 毛绒球形活物 ✓
  （非扁平插画/非狗）；鼠尾草绿圆顶 ✓、前脸奶油→卡其渐变 ✓、深橄榄圆珠眼 ✓、头顶暖白发光体 ✓、
  「靠画面下边沿、仅上半身、轻微右倾」符合 collapsed ✓，无畸形；`col_v4_1` 姿态居中不符（弃）。
- **不是默认头放大**：构图是「半身 + 侧倾 + 靠底边」，与 `head_3d_master` 的正面全头
  明显不同（vision 判定身份一致但姿态/裁切不同）。

## 记录在案的局限（已知、已接受）

1. 抠图是**硬阈值 + 0.5px 羽化**（`colorize.cjs` 的「背景 max≥240 → 透明」），深色底放大可见
   极轻白色 halo 边，40px 下不可见。
2. 色迁移对候选明度（Value）未做重映射，仅改 Hue/Sat；暗部层次继承 model 输出。
3. 参考图的「外缘浅黄绿绒毛边」在 40px 下只剩不足 1px 量级，实际不可留（与旧版同）。