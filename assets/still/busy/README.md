# 晴光 · busy（忙碌/思考）静帧（assets/still/busy）

busy = 思考/忙碌**兜底静帧**：微微低头、视线向下略偏一侧但仍清晰可见。**没有红点/齿轮/转圈/角标叠头**——状态完全由姿态表达。

本版为**重锚定后的 v3**：配色锚定 `_refs/head_3d_master.png`，并补回参考图标志性的
**头顶暖白发光体**（`paintglow.cjs` 确定性补画）。透明底 RGBA。

## 文件

| 文件 | 像素 | 字节 | SHA-256（前 16 位） |
|---|---|---|---|
| `qingguang-40-busy.png` | 40×40 | 4161 | `E317369B6D1D68CF` |
| `qingguang-40-busy@2x.png` | 80×80 | 13315 | `E80D28E178E344AD` |
| `qingguang-40-busy-32.png` | 32×32 | 2861 | `DDE956A794E82553` |
| `qingguang-32-busy.png` | 32×32 | 2861 | `DDE956A794E82553` |

后两个 32px 文件是同一份内容的两种命名（SHA-256 完全一致）。设计尺寸 40×40。

## 配色（40px 实测 8 段，top→bottom，`alpha>8` 口径）

`#dfe4c7`（sage 圆顶 + 暖白发光体）→ `#aeb392` → `#9e8f5f` → `#b8aa79` → `#a99e72`
→ `#97875c` → `#989475`（暗橄榄）→ `#b1ad84`。顶部暖白发光体 maxL=254。

## 生成（可复现）

1. **姿态**：`qwen-image-3.0` img2img，参考 master 扁平定锚件
   `.scratch/qingguang/lead/busy-ref.png`（master 饱和×1.45 + 低头盖板），tag `busy_v4`，
   prompt hex 点名配色（`#D4D9C4`/`#DBD9C1`/`#C7B599`/`#33442B`/`#FFF6D9`）+「微微低头、
   双眼向下偏一侧像在专注思考、眼睛依然清晰可见」。
2. **配色修正 + 发光体**：`node .scratch/qingguang/lead/colorize.cjs` 以 master 垂直色度斜坡
   逐像素确定性迁移 Hue/Sat（保留明度，解耦「姿态/配色」）；再
   `node .scratch/qingguang/lead/paintglow.cjs` 确定性补画头顶 `#FFF9E6` 正圆暖白发光体。
3. **抠图 + 尺寸梯**：`node .scratch/qingguang/lead/deliver.cjs --type busy
   --src .scratch/qingguang/lead/gen/busy_v4_0_cg.png --outdir assets/still/busy`
   （抠图 = alpha bbox 裁剪 → 0.5px 羽化 → lanczos3 出 40/80/32）。

选用原图：`.scratch/qingguang/lead/gen/busy_v4_0.png`（1024×1024）→ 色迁移 + 发光体后
`.scratch/qingguang/lead/gen/busy_v4_0_cg.png`。

## 验收（客观）

- **身份 + 姿态**：`qwen3-vl-plus` 四图同批复核——`busy_v4_0`：「微微低头、眼睛向下偏左
  但仍完全可见」符合 busy ✓；鼠尾草绿圆顶、前脸渐变、深橄榄圆珠眼、头顶暖白发光体 ✓；
  无畸形。`busy_v4_1` 头部正对前方、无低头倾向（弃）。
- **与 collapsed 区分**：40px 整体主色与 collapsed 同族但构图不同（busy 居中露全上半身、
  头微低；collapsed 靠底边侧倾半身），二者 40px 下仍可辨。

## 记录在案的局限（已知、已接受）

1. 「低头」是 2D 几何线索（头前倾 + 视线下偏），非真实三维点头；用户明示门槛是
   「微低头或目光游移即可」，已达。
2. 抠图硬阈值 + 0.5px 羽化，深色底放大见极轻白色 halo（40px 不可见）。
3. 色迁移仅改 Hue/Sat、保留 model 明度；暗部层次继承原输出。