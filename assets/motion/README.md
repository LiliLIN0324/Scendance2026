# 晴光 · 动效循环（assets/motion）

两段 WebP 均为**程序化形变**：由「已入库静帧」逐帧程序化变形生成，不重新生成，动画角色
不会跑形。本版源静帧已重锚定 `_refs/head_3d_master.png`（sage 配色 + 暖白发光体）。

## 参数（帧率 / 每帧时长 / Loop / 尺寸）

| 文件 | 帧数 | 帧率 | 每帧时长 | 总时长 | loop | 画布 | 编码 | 字节 | 推荐显示 |
|---|---|---|---|---|---|---|---|---|---|
| `idle/qingguang-idle.webp`（呼吸起伏） | 24 | 10 fps | 100 ms | 2400 ms | 0（无限循环） | 80×80 | 有损 WebP q80（alpha 无损） | 55052 | 40px / 72px |
| `busy/qingguang-busy.webp`（低头思考微动） | 20 | 10 fps | 100 ms | 2000 ms | 0（无限循环） | 80×80 | 有损 WebP q80（alpha 无损） | 53216 | 40px / 72px |

- **帧率** = 10 fps；**每帧时长** = 100 ms。
- **loop** = 0：WebP ANIM 无限循环播放下，首尾帧无缝衔接、可循环。
- 推荐显示尺寸 **40px**（主）/ **72px**（放大），画布 80×80（2× 超采样留余量）。

## 文件（SHA-256 前 16 位）

| 文件 | 像素 | 帧数 | 字节 | SHA-256 |
|---|---|---|---|---|
| `idle/qingguang-idle.webp` | 80×80 | 24 | 55052 | `83E98866E476A5B6` |
| `busy/qingguang-busy.webp` | 80×80 | 20 | 53216 | `F1AF0B5AACC4C9E9` |

## 源静帧（同源、不跑形）

| 动效 | 源静帧 | SHA-256（前 16 位） |
|---|---|---|
| idle | `frontend/public/assets/assistant/qingguang-3d-40@2x.png`（重锚定默认头） | `0856E4066E52F1BB` |
| busy | `assets/still/busy/qingguang-40-busy@2x.png` | `E80D28E178E344AD` |

每段循环都「某一帧 ≈ 源静帧」，保证动画与静帧 100% 同源（不跑形）。

## 生成（可复现）

```bash
# idle：呼吸起伏（垂直挤压 + 水平拉伸 + 轻微上下浮动，体积守恒，anchor=bottom）
node .scratch/qingguang/tools/breathe.cjs \
  --in frontend/public/assets/assistant/qingguang-3d-40@2x.png \
  --outdir .scratch/qingguang/motion/work/idle80 --frames 24 \
  --amp 0.045 --bob 0.015 --anchor bottom --prefix f

# busy：低头思考微动（慢点头 + 一次阻尼侧摆 + 横向漂移 + 下沉 + 挤压，640 超采样）
node .scratch/qingguang/motion/busy.cjs \
  --in assets/still/busy/qingguang-40-busy@2x.png \
  --outdir .scratch/qingguang/motion/work/busy640 --frames 20 --size 640 --prefix b
node .scratch/qingguang/motion/scale.cjs --indir .scratch/qingguang/motion/work/busy640 \
  --outdir .scratch/qingguang/motion/work/busy80 --size 80x80 --prefix b

# 合帧为 WebP（有损 q80、alpha 无损；fps=10、loop=0）
node .scratch/qingguang/tools/anim.cjs \
  --frames .scratch/qingguang/motion/work/idle80/f00.png,...,f23.png \
  --out assets/motion/idle/qingguang-idle.webp --fps 10 --loop 0 --quality 80
node .scratch/qingguang/tools/anim.cjs \
  --frames .scratch/qingguang/motion/work/busy80/b00.png,...,b19.png \
  --out assets/motion/busy/qingguang-busy.webp --fps 10 --loop 0 --quality 80
```

## 动效降级（reduced-motion / 静止帧兜底）

- 用户偏好 `prefers-reduced-motion` 或需要静止帧时：
  - **idle** → 直接显示源静帧 `qingguang-3d-40@2x.png`（重锚定默认头，40px 下同一张脸）。
  - **busy** → 直接显示 `assets/still/busy/qingguang-40-busy.png`（40px 静帧兜底）。

## 验收

`node .scratch/qingguang/verify/accept.cjs` 全量 PASS：loop 无缝、40px 下不闪、同源不跑形、
每帧仍是晴光配色、字节 <60KB、时长在任务区间内（idle 2–3s / busy 1.5–2.5s）。