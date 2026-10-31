# T-ICONS-SPEC — 图标按设计规范归一

> 依据：`docs/design-spec-2026.md` §4 图标与阴影（行内 16 / 控件 20 / 结构 24 / 整页空态 32、12 仅徽标内、stroke 统一 1.75）与 §344 清理计划。
> 状态：实现完成，待验收。

## 背景

规范写的是「图标尺寸归一 16 / 20 / 24（32 仅整页空态主图标）、stroke 1.75」，代码里实际散着 8/12/13/14/15/17/18/19/21/22/23/25/28/30 共 14 档中间值，且没有任何全局描边规则（lucide 默认 2）。本卡只做尺寸、描边与 8px 角标三项，不改图标语义、不换图标库、不动布局。

## 范围

**IN**

1. 15 个 lucide 使用文件里所有 `size={n}` 归一到 16 / 20 / 24 / 32。
2. `app/globals.css` 加全局描边：`.lucide { stroke-width: 1.75 }`（CSS 覆盖 SVG 呈现属性，圆头圆角沿用 lucide 默认）。
3. 画布工具列里 5 枚 8px `ChevronDown` 角标（视图 / 氛围 / 天气 / 时段 / 现场灯光）：按钮与菜单项都带 `aria-haspopup` 与文字或 `data-tip`，8px 既不在允许档也不在徽标内 → 移除，工具列回到等大圆钮。
4. 语义不变：`X` 仍只表示关闭，`Loader2` 仍是唯一旋转图标，`Sparkles` 仍只在「生成 · Agent」。

**OUT**

- 触达区 < 32px 的整改（`.`sc-icon-button` 32 已合规，缩略图角标与 `.ap-attach` 另案）。
- `plotcraft/icon.tsx`（stroke 1.5）与 `MaterialGlyph`（72×58、stroke 2.3–2.4）：领域符号不进 UI 栅格。
- BrandMark（28，品牌字标，锁定不换）。
- `components/ui/select.tsx` 的 `h-4 w-4`（16，属允许档；该 Select 只被 `room-settings-panel` 使用，而后者只出现在测试里）。
- 图标库替换、填充风格、把图标当唯一信息载体等问题。

## 档位规则（本卡执行口径）

| 档 | 用途 | 本卡落点 |
|---|---|---|
| 32 | 整页空态 / 错误页唯一主图 | `app/error.tsx`、`app/not-found.tsx` |
| 24 | 左轨、画布工具条、素材库轨道、面板内空态与缺省图 | 工作流程轨、14 键工具列、素材库 tab、项目/账户空态、拖放卡、上传按钮、邀请卡 |
| 20 | 图标按钮（无文字）、面板与弹窗头、输入内前置图标 | 发送、附件、关闭、收起面板、账户触发器、搜索框、换一条 |
| 16 | 文字旁的按钮图标、菜单项、列表与卡片内图标、行内状态标记 | 其余全部 |
| 12 | 仅徽标 / 步进圆标内的非交互小标 | `.ap-steps` 完成与进行中圆标、`.sc-material-add` 角标（保持） |

`BrandMark` 28、plotcraft、MaterialGlyph 不动。

## 落点

| 文件 | 改动 |
|---|---|
| `frontend/app/globals.css` | 新增 `.lucide` 全局 stroke 1.75 |
| `frontend/app/error.tsx` | `TriangleAlert` 24 → 32 |
| `frontend/app/not-found.tsx` | `Compass` 24 → 32 |
| `frontend/app/projects/page.tsx` | 导航 17 → 16；空态 30 → 24；项目卡 22 → 20 |
| `frontend/components/intro/intro-page.tsx` | 步骤图 18 → 20；CTA 箭头 18/17 → 16；`LockKeyhole` 14 → 16 |
| `frontend/components/room-organizer/panels/account-team-demo.tsx` | 18 → 20、25 → 24、14 → 16、13 → 16 |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | 关闭/附件/发送 → 20；拖放卡 20 → 24；行内 15/12 → 16；步进圆标保留 12 |
| `frontend/components/room-organizer/panels/cloud-panel.tsx` | 搜索 16 → 20；触发器 17 → 20；关闭 21 → 20；项目图 21 → 20；空态 28 → 24；外链 14 → 16 |
| `frontend/components/room-organizer/panels/creative-studio.tsx` | 生成 18 → 16；换一条 13 → 20；发送 19 → 20；关闭 18/16 → 20；其余 14/15 → 16 |
| `frontend/components/room-organizer/panels/item-context-popover.tsx` | 关闭 17 → 20；按钮 15 → 16 |
| `frontend/components/room-organizer/panels/online-model-library.tsx` | 搜索 15 → 20；角标 12 保留 |
| `frontend/components/room-organizer/panels/reconstruction-panel.tsx` | 行内删除 12 → 16；确认 15 → 16 |
| `frontend/components/room-organizer/panels/scendance-workspace.tsx` | 工具列 17/14 → 24/16；素材库 tab 18 → 24；关闭 16 → 20；把手 13 → 16；移除 5 枚 8px 角标 |
| `frontend/components/room-organizer/panels/venue-photos-panel.tsx` | 上传 23 → 24；缩略图删除 13 → 16 |
| `frontend/components/room-organizer/room-organizer.tsx` | 左轨 20 → 24；收起 18 → 20 |

## 验收

- [x] `npx tsc --noEmit -p tsconfig.json` 0 error
- [x] 定向 vitest 全绿（scendance-workspace / creative-studio / agent-panel / cloud-panel / projects / intro）
- [x] 全树 `size={` 只剩 12/16/20/24/32 与 BrandMark 28、MaterialGlyph/plotcraft 自绘尺寸
- [x] 浏览器实测：画布工具列、左轨、Agent、账户弹窗、项目页、错误页图标大小与 1.75 描边
- [x] 画布工具列 14 键仍在原位（只少 5 个角标，键数不变）
- [x] 不 commit / 不 push / 不部署

## 待核（未改，等拍板）

- `plotcraft/icon.tsx` 自绘 `Icon` 还挂在画布浮层上：`status-toast.tsx:98`（14）、`view-options.tsx:141`（18）、`chip-controls.tsx:125`（12）、`wall-paint-panel.tsx:221`（12）、`lot-badge.tsx:56`（18）、`placement-hint.tsx:47`（14）、`viewport.tsx:248/334/348/387/455/484`（14）。规范说「工具栏、按钮、菜单一律 lucide」，但这套符号是画布视觉语言（stroke 1.5、领域图形），本卡 OUT 里也划走了 plotcraft → **冲突，停在此处不擅自换库**。要归一并进 lucide 的话另开一卡。

## 自检记录

**2026-10-28**

- 类型：`npx tsc --noEmit -p tsconfig.json` → exit 0。
- 测试：10 个文件 / 467 条全绿（scendance-workspace、creative-studio、agent-panel、cloud-panel、projects、item-context-popover、online-model-library、creative-venue-photos、reconstruction-panel 共 9 文件 454 条 + intro-page 13 条）。
- 源码口径：`size={` 统计 12×6 / 16×50 / 20×22 / 24×16 / 32×2，外加 BrandMark 28×2；剩余 14×8 与 18×2 全是 plotcraft `Icon`（见「待核」），MaterialGlyph 不经 `size=`。
- 浏览器（1440×900，deviceScaleFactor 2）：
  - 工作台 `/`：29 枚 lucide，宽度分布 16×8 / 20×11 / 24×10，`bad: []`，stroke 全部 `1.75px`；工具列 6 枚圆钮均 24，视图菜单 9 项（行内 16）。
  - `/projects` 6 枚、`/auth` 6 枚、404 页 1 枚（Compass 32）：`bad: []`，stroke `1.75px`。
- 工具列键数：`git diff` 里该文件只删了 5 个 `<ChevronDown className="sc-tool-caret" size={8}>`，没有任何 `<button>` 被删；DOM 仍是 6 枚圆钮 + 视图菜单 9 项。
- 截图自查：工作台、展开素材库、`/projects`、404 四张看过，尺寸与灰度关系正常，搜索胶囊 28px 里放 20px 图标不挤。
- 未 commit / 未 push / 未部署。
