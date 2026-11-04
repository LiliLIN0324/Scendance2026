# 幕景品牌资产 · 总索引

品牌主标志是 **「AI 的门」（door 版）**：绿色圆角方块 + 白色拱形门洞，主色 `#35624A`，无绿点。
本节目录只作设计留档，**不参与构建**，不能靠改这里来改页面。

## 目录内有什么

| 路径 | 内容 | 说明 |
| --- | --- | --- |
| `logo-2026/door/door.svg` | **矢量母版**，`viewBox="0 0 1024 1024"`，单文件 447 B | 几何来自对 128 位图的像素反推（见下） |
| `logo-2026/door/door-128.svg` | 同一路径的 `viewBox="0 0 128 128"` 等价版 | 与原图逐像素同坐标，便于比对 |
| `logo-2026/door/door-eyes.svg` | 母版 + 两只白眼睛（取自 `icon.svg` 的 rect，48 单位换算到 128） | 对齐运行时包装层的外观 |
| `logo-2026/door/png/` | 16 / 24 / 28 / 32 / 48 / 64 / 128 / 256 / 512 共 9 档 | **全部由 `door.svg` 渲染**（resvg 2.6.2），不是位图降采样 |
| `logo-2026/door/compare-128.png` | 原图 / SVG 渲回 128 / 差异高亮 三面板 | 形状掩膜 IoU **0.9779**，不匹配 215 px（1.31%） |
| `logo-2026/door/compare-eyes.png` | 带眼 / 不带眼并排 | 眼睛是否存在的事实对照 |
| `logo-2026/door/door-master-128.png` | 运行时 `door.png` 的逐字节副本（SHA256 `911D11FD…ADAF8F`） | 仅作溯源留档 |
| `logo-2026/motion/` | 12 个动效 SVG + `index.html`（双击即开）+ `preview.png` | 见 `logo-2026/README.md` 的动效一节 |

旧的 `threshold-*`（黑底门槛 + 拱内绿点）是 2026-10 的设计，与当前在用的 door 版不是同一设计，
**已于 2026-11-04 全部删除**（62 个文件、约 0.58 MB）。**现在仓库内已不存在任何 threshold 文件**，
`logo-2026/` 下只剩 `door/`、`motion/` 与两份 README。

## 矢量几何是怎么来的（反推，不是手绘）

对 `frontend/public/assets/rail/door.png` 做 alpha 通道量化后得到（128×128 坐标）：

| 项 | 实测值 |
| --- | --- |
| 绿色 bbox / 四边留白 | x 8..119、y 8..118；L8 R8 T8 B9，112×111 |
| 四角圆拟合半径 | TL 30.83 / TR 31.03 / BR 31.80 / BL 31.91（母版取 34.877 / 34.359 / 34.74 / 36.381） |
| 门洞宽度 | 32.0（x 47.5..79.5），中心 x=63.5 |
| 拱顶 | x=64 处 y≈72.5；拱圆心 y=89.148、半径 16.273 |
| 门腿 | 垂直，洞直通底边（无封口） |
| 主色 | `#35624A`（RGB 53,98,74），核心区 100% 单一色 |
| 抗锯齿 | 全不透明 8817 px、半透明 1505 px（占 17.1%）——原件本身就是位图渲染 |
| 白色像素簇 | **全图 0 个**，门洞内 0 个 → PNG 本体没有眼睛 |

复现检验：`door.svg` 用 resvg 渲回 128×128，与原图二值化掩膜（alpha>0.5）比对，
IoU **0.9779**，不匹配 215 px（**1.31%**），残差集中在四个圆角（143 px）与外缘（67 px）。

## 运行时真源清单（实测）

| 角色 | 运行时文件 | 实测 | 引用方 |
| --- | --- | --- | --- |
| 主标志 | `frontend/public/assets/rail/door.png` | 128×128，5.2 KB，绿色 `#35624A` | `frontend/app/icon.svg`、`frontend/components/brand-mark.tsx` |
| Agent 四形体 | `frontend/public/assets/rail/ball.png` | 128×128，`#4A7C59` | `frontend/components/room-organizer/panels/rail-avatar.tsx` |
| | `frontend/public/assets/rail/pyramid.png` | 128×128，`#6A8C5D` | 同上 |
| | `frontend/public/assets/rail/cube.png` | 128×128，`#7B9A67` | 同上 |
| favicon | `frontend/app/icon.svg` | 内嵌 `/assets/rail/door.png` + 两只白眼睛 rect（`viewBox 48`） | 浏览器标签页 |
| 页头标志组件 | `frontend/components/brand-mark.tsx` | 同一个 `door.png` + 同一套两只白眼睛 | 页头 / 左上角 |
| 分享图与交付物 | `frontend/components/room-organizer/lib/plan-export/print.ts`、`shot-list.ts` | 文字字标「幕景 Scendance」+ `#4A7C59` 绿圆点，**不嵌位图** | 打印/导出页 |

**本轮不替换运行时**：`door.png` / `icon.svg` / `brand-mark.tsx` 一个字节都没改。
运行时真源仍是那张 128 位图，favicon 与 `BrandMark` 都指向它。

> 若要提升高分屏清晰度，可用 `door.svg` 替换 `app/icon.svg` 的引用方式（把 `<image href=…door.png>`
> 换成内联矢量路径），**需另开任务验证**：`icon.svg` 目前是 48 单位画布 + 40×40 的 `preserveAspectRatio="none"`
> 贴图，换成 128 单位的路径要先做坐标重映射，且要确认 favicon 在 16/32 档下的边缘表现。

## 动效素材（`logo-2026/motion/`）

- **主干动作是「门洞」在变，绿色外框零位移、零缩放、零旋转**：只有拱形白色负空间的宽度、
  总高、拱顶弧度在演化（`d` 属性关键帧插值）。
- 全身只有两个颜色：`#35624A` 与 `#FFFFFF`（白仅以不同不透明度叠加），没有任何第三色、没有暖光。
- favicon 必须用 `door-static.svg`（无动画）。预览页：`logo-2026/motion/index.html`。

## 眼睛：事实与结论

- `door.png` 本体**无眼**：白色像素簇 0 个，门洞内全透明。
- `icon.svg` / `brand-mark.tsx` 里的两只白眼睛是**包装层加上去的**（48 单位：`x=16.5 y=17.1`、
  `x=25.4 y=16.3`，`4.2×9.4`、`rx=2.1`、`rotate 12°`），换算到 128 空间是
  (40.0, 41.92) 与 (68.48, 39.36)，尺寸 13.44×30.08、圆角 6.72。
- 它们落在绿色门脸上、拱洞正上方（拱顶 y≈72.9），不落在门洞内部，属于**品牌"脸"的装饰**，
  不是为 favicon 补的视觉重量。运行时用户看到的其实是"带眼"的包装层。
- 因此矢量母版 `door.svg` 保持**纯净拱洞**，另给 `door-eyes.svg` 复刻包装层的带眼外观。

## 改版流程

1. 换 logo 只需替换 `frontend/public/assets/rail/door.png` 一处：favicon 与 `BrandMark` 都引用它，自动跟随。
2. 有矢量源后，以 `door.svg` 为唯一上游，重导 `png/` 9 档，再决定是否替换运行时位图。
3. 四形体（`ball` / `pyramid` / `cube`）要一起换，否则风格不协调。
4. 本目录不在 `public/` 下、无构建脚本读取，因此**改这里不会改页面**。

> 现状：door 版**已有矢量源**（`door/door.svg`），512 档可直接由矢量渲染、清晰可用，
> 不再受"最大只有 128 位图"的限制；运行时仍未切换（见上）。
