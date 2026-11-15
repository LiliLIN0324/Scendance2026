# 中等尺寸布局（769–1080）改造记录

状态：**已按 B 方案落地** — `frontend/app/globals.css:1021` 新增断点 `@media (min-width:769px) and (max-width:1080px)`（1021–1041，+26 行），其余零改动。

本文档按真实代码重写：下面所有类名、行号都取自仓库当前版本，可直接跳转核对。

---

## 1. 代码地图

### 1.1 外壳 DOM（`components/room-organizer/room-organizer.tsx`）

```
.sc-workbench
└─ .sc-workspace.is-docked-layout.is-mode-rail(.has-left-column)
   ├─ .sc-mode-rail                     左侧 64px 图标轨
   ├─ .sc-left-column                   会话/卡片列（"新会话"那整块）
   │  ├─ .sc-agent-panel                panels/agent-panel.css:3
   │  │  ├─ .ap-head.ap-session-head     agent-panel.css:24 / :25
   │  │  └─ .ap-body → .ap-feed / .ap-composer   agent-panel.css:42 / :87
   │  └─ .sc-left-card-resizer          panels/left-card-resizer.tsx（拖宽用）
   └─ .sc-canvas-stage                  画布格（地图 / 3D）
      ├─ .sc-scene-viewport
      ├─ .sc-tool-column.sc-canvas-rail 右侧竖排圆钮
      ├─ .sc-geo-scale-north            左下 比例尺 + 图源署名（globals.css:814）
      └─ .sc-geo-compass-card           右下 罗盘卡（globals.css:819）
```

手机外壳的两件 DOM（`.sc-mobile-agent-entry`、`MobileAgentDock`）**桌面端也渲染**，靠 CSS 隐藏：`room-organizer.tsx:4477`、`:4490`。

### 1.2 三档断点的真实出处

| 档位 | 位置 | 结构与后果 |
|---|---|---|
| ≥1081 | `globals.css:1087-1097` | 三列 `64px · var(--sc-left-card-width,320px) · 1fr`，同一行 |
| 769–1080 | **`globals.css:1005-1015`**（改前）→ **`:1021`（改后）** | 改前：`grid-template-rows: minmax(220px,42%) minmax(0,1fr)`（1009），左栏 `grid-row:1`（1011）、画布 `grid-row:2`（1014） |
| ≤768 | `components/room-organizer/panels/mobile-shell.css:18-118` + `:200-237` | 画布 `position:absolute; inset:0 0 dock-h 0`（42–49），工具列转顶部横条（61–77），对话区底部 dock（200 起） |

基础（三档共用）网格在 `globals.css:1080`（`rows: minmax(0,1fr)`）；`.sc-left-column` 基础样式在 `:1106`。

---

## 2. 改前为什么"上下"难看（代码级）

1. **画布只拿到 58%**：`globals.css:1009` 把左栏钉在 `minmax(220px,42%)` 的第一行，画布 `grid-row:2`（1014）吃剩下的 `1fr`。
2. **竖排工具列装不下**：`globals.css:1678-1686`
   ```css
   .sc-workbench .sc-tool-column.sc-canvas-rail {
     position: absolute; right: 12px; top: 12px;
     max-height: calc(100% - 24px);   /* 1686 */
     overflow: visible;               /* 溢出但不滚动 → 直接漫出去 */
     gap: 4px; z-index: 35;
   }
   ```
   12 颗 30px 圆钮 + 分隔 + 楼层切换 ≈ 430px；58% 高度下画布约 450px，只剩 426px 可用。
3. **再矮一档还有第二道压缩**：`globals.css:1784-1785` 的 `@media (max-height:640px)` 把按钮降到 26px —— 是"承认装不下"，但没有换向。
4. 顺带的既有 bug：`is-mode-rail` 但**没有**左栏时，画布仍在第一行（42%），下面 58% 是空的。

---

## 3. 已落地的改动（`globals.css:1016-1062`，+47 行）

```css
/* 1016-1020 注释：769–1080 不再上下切两行，左栏改成画布上的浮层卡 */
@media (min-width:769px) and (max-width:1080px) {          /* 1021 */
  /* 1024：卡片宽度只算一次，用 vw 表达，画布里才能复用 */
  .sc-workbench .sc-workspace.is-docked-layout.is-mode-rail { --sc-medium-card-w: min(420px, 46vw); }
  .sc-workbench .sc-workspace.is-docked-layout.is-mode-rail,
  .sc-workbench .sc-workspace.is-docked-layout.is-mode-rail.has-left-column {
    grid-template-rows: minmax(0, 1fr);                    /* 1028：单行，画布满高 */
  }
  .sc-workbench .is-docked-layout.is-mode-rail > .sc-mode-rail { grid-row: 1; }        /* 1030：不再 span 2 */
  .sc-workbench .is-docked-layout.is-mode-rail.has-left-column > .sc-canvas-stage
    { grid-column: 2; grid-row: 1; }                       /* 1031：覆盖 1014 的 row:2 */
  .sc-workbench .is-docked-layout.is-mode-rail > .sc-left-column {   /* 1033 */
    position: absolute; left: calc(var(--sc-nav-rail-width) + 12px); top: 12px;
    right: auto; bottom: auto; grid-column: auto; grid-row: auto;    /* 1035：containing block 回到 workspace */
    width: var(--sc-medium-card-w); height: min(62%, 640px); max-height: calc(100% - 24px);  /* 1036 */
    border: 1px solid var(--wk-hair); border-radius: 16px;
    background: var(--paper);
    box-shadow: 0 12px 32px rgb(20 20 22 / 14%), 0 2px 6px rgb(20 20 22 / 6%);
    z-index: 31;                                           /* 与 :1104 的桌面层级一致 */
  }
  /* 1045-1049：画布左上的抬头/胶囊让到卡片右侧（卡片左缘离画布 12px，再留 24px 间距） */
  .sc-workbench .is-docked-layout.is-mode-rail.has-left-column .sc-canvas-heading,
  .sc-workbench .is-docked-layout.is-mode-rail.has-left-column .sc-canvas-mode {
    left: calc(var(--sc-medium-card-w) + 36px);
    max-width: calc(100% - var(--sc-medium-card-w) - 96px);
  }
  /* 1050-1059：引导气泡避让卡片（栈上下文导致 z 值无效，只能平移） */
  .sc-workbench .is-docked-layout.is-mode-rail.has-left-column [data-testid="guide-bubble"] {
    left: calc(var(--sc-medium-card-w) + 36px) !important;
    transform: none !important;
  }
  .sc-workbench .is-docked-layout.is-mode-rail > .sc-left-column .sc-left-card-resizer
    { display: none; }                                     /* 1061 */
}
```

要点：

- `grid-column/grid-row: auto`（1032）是必须的。绝对定位的网格子项若同时带 `grid-column:2`，containing block 会变成第 2 列那个网格区，`left` 再算一次 76px 就多出一段——实测卡片会落在 x=140 而不是 x=76。
- 高度用定值 `min(62%, 640px)` 而不是 `height:auto`：只有父级高度确定，`.ap-feed`（`agent-panel.css:87`，`flex:1; min-height:0; overflow-y:auto`）才会真正出现滚动条；`auto` 会让内容撑破卡片后被 `.sc-left-column` 的 `overflow:hidden` 直接裁掉。
- 62% 是给底部留位：`.sc-geo-scale-north`（`left:14; bottom:14`，`globals.css:814`）和 2D/3D 分段控件都在那条带上，卡片压到 62% 就不会碰它们。
- resizer（`left-card-resizer.tsx`）写的是 `--sc-left-card-width`，只在 ≥1081 生效，所以这一档隐藏，避免出现拖不动的把手。

---

## 4. 实测几何

用 Playwright 加载 `globals.css` / `agent-panel.css` / `mobile-shell.css`，以同结构 mock DOM 渲染后量 `getBoundingClientRect()`：

| 视口 | `.sc-left-column` | `.sc-canvas-stage` | `.sc-tool-column` |
|---|---|---|---|
| 933×813 | x76 y12 **422×506**（浮层卡） | 64→933，**全高 813** | h391，距画布底余 410px |
| 1024×768（真实预览） | x76 y12 **420×476** | 64→1024，**全高 768** | h357，余 411px；比例尺 y=728、罗盘 x=954 |
| 1440×900 | x64 y0 320×900（三列，未变） | 384→1440 | 未变 |
| 700×800 | 手机外壳 dock（未变） | 0→704，工具列顶部横条 h54 | — |

改前同样本在 933×813 下画布只有第一行的 42%，工具列溢出画布底边。

1024×768 那一行取自**重启后的真实预览**（`npm run dev` → localhost:3000，Playwright 无登录态直进，console 无错误）：`.sc-workspace` 带 `is-docked-layout is-mode-rail has-left-column`，`--sc-medium-card-w` 解析为 `min(420px, 46vw)`。

---

## 5. 已知取舍与遗留

| 项 | 说明 | 处理建议 |
|---|---|---|
| `.sc-canvas-heading` | **已处理**：这一档右移到卡片右侧（`:1045-1049`，`left: calc(var(--sc-medium-card-w) + 36px)`）。注意该组件目前只有自家测试 import（`canvas-heading.tsx`），运行时不渲染，这条属防御性规则 | 组件恢复使用时无需再改；想改成隐藏就把 1045-1049 换成 `display:none` |
| `.sc-canvas-mode` 在同一角 | 隔离扫描态才渲染（`room-organizer.tsx:4881`），与抬头共用同一条右移规则 | — |
| 首次开图引导气泡被卡片压住 | **已处理**：靠 z-index 走不通——气泡在 `.sc-canvas-stage` 里，该元素 `container-type: size`（layout containment）自成栈上下文，气泡 z 提到 **99 仍被卡片（z31）压住**（已实测）。改成平移：`:1056-1059` 用 `[data-testid="guide-bubble"]` + `!important` 把 `left` 设为 `calc(var(--sc-medium-card-w) + 36px)`、取消 `translateX(-50%)`。两步（canvas / left 锚点）现在都在卡片右侧 | 组件侧保持 `zIndex: 30`，只留一条注释说明为何不要靠 z 值解决 |
| 其它左卡（`.sc-left-drawer`） | `globals.css:996` 已把抽屉在这档设成 `position:absolute; inset:0 auto 48px 0`，现在它的 containing block 变成浮层卡 | 目前视觉可用；若抽屉撑破卡片，把 996 那条的 `inset` 改成 `0` |
| 卡片宽度不可拖 | 见 §3 最后一条 | 需要的话把 resizer 的 `width` 改成写 `--sc-medium-card-width`，并在 1033 行引用 |
| `--sc-nav-rail-width` 改动会同步 | 1031 行用的是变量，不是硬编码 64px | 保持 |

---

## 6. 若还要更彻底（A 方案：中等尺寸直接复用窄屏外壳）

目标：769–1080 用"画布全出血 + 顶部横条工具 + 底部 dock"，与 ≤768 完全同一套心智。

1. 把 `mobile-shell.css` 现有 `@media (max-width:768px)`（18 行起）拆成两组：
   - **画布形态组**（33–77：workspace `display:block`、画布 `inset`、`.sc-canvas-heading` 隐藏、`.sc-tool-column` 转横条）→ 提到 `max-width:1080px`；
   - **手机密度组**（80–118：44px 命中区、`#tool-walk` 去文案、tool-pop 定位；200–237：dock 高度与 `--sc-mobile-*` 变量）→ 留在 ≤768。
2. JS 断点需同步核对：`room-organizer.tsx:858`（`matchMedia('(max-width: 768px)')`）、`:869`（1080）、`:880`（680）——CSS 提到 1080 而 JS 留在 768 会出现"样式换了、状态没换"。
3. 风险：`.sc-mobile-*` 变量在 `.sc-workbench` 上定义于手机档，提到 1080 需一并搬；`mobile-shell.css:200` 起的左栏规则与 `globals.css:1106` 基础样式会互相覆盖，改动前先确认 `!important` 的先后。

---

## 7. 验收清单（可直接跑）

```js
// 在 1024×768、933×813、769×700 三个视口各跑一次
const r = s => document.querySelector(s)?.getBoundingClientRect();
const stage = r('.sc-canvas-stage'), tools = r('.sc-tool-column.sc-canvas-rail');
const col = r('.sc-left-column'), scale = r('.sc-geo-scale-north');
({
  canvasFullHeight: Math.round(stage.height) === innerHeight,      // 1 画布满高
  toolsInsideCanvas: tools.bottom <= stage.bottom,                 // 2 工具列不溢出
  toolsClearOfRail:  tools.left > stage.left + stage.width - 64,    // 3 不与比例尺抢位
  cardFloats:        col.x > 64 && col.y < 40,                     // 4 卡片浮起且让开图标轨
  cardAboveScale:    col.bottom < scale.top,                       // 5 卡片不压比例尺
  feedScrolls:       getComputedStyle(document.querySelector('.ap-feed')).overflowY === 'auto',
});
```

补充人工项：

1. 会话内容很长时，卡片内正文滚动、输入区与底栏固定可见；
2. 折起左栏（无 `.has-left-column`）后画布仍是满高；
3. 1280×800 / 1440×900 走三列，行为与改动前完全一致；
4. ≤768 手机外壳不受影响（画布全出血、顶部横条、底部 dock）；
5. 拖动窗口跨 1080 与 768 两个断点，无控件瞬时重叠；
6. 画布左上不再有元素被卡片压住（`.sc-canvas-heading` 已右移；`.sc-canvas-mode` 仅在隔离扫描态出现）；
7. 首次开图引导气泡三步都落在卡片右侧、不被遮挡（1024×768 已截图确认前两步：气泡 x=520–860，卡片右缘 496，工具列左缘 968）。

---

## 8. 回滚

改动集中在单个文件的一处媒体查询，`git revert` 掉 `globals.css` 即可；不涉及 TSX、测试与数据。
