# T-VISUAL-CHROME · 骨架气质对齐（色板已过，chrome 未过）

> 2026-10-27 Asia/Shanghai · 给 Trae / 前端读  
> 背景：`v1.3.4` 只换了 token，用户判定仍「古早 UI」；终稿是**布局疏密 + 浮岛 + 左轨**，不是再换色。  
> 对照稿：`docs/visual-2026/04-final-flat.jpg` + `docs/visual-2026/FINAL.md`  
> 色板钉死：冷石 `#F4F5F7` / 白 / `#141416` / 线 `#E4E4E7` / 绿 `#4A7C59` + soft `#E8F0EA`  
> 图标：全部沿用现产品，禁止换稿里 pictogram  
> Stars：`gh api` 实查约数（2026-10-27）

## 一句话

别再洗色。打开下列仓/产品，**只学 chrome（轨、岛、线、疏密、聊天栏）**，把现皮改到贴近 `04-final-flat.jpg`。

## 必读开源仓（按优先级）

| # | Repo | ~★ | 学什么 | 不要抄 |
|---|------|---:|--------|--------|
| 1 | [tldraw/tldraw](https://github.com/tldraw/tldraw) | 51k | 画布浮层工具岛、竖工具条、岛屿圆角与 hairline、zoom 簇 | frosted/`backdrop-blur`；手绘糖果风 |
| 2 | [makeplane/plane](https://github.com/makeplane/plane) | 61k | Linear 级密度：窄侧栏、1px 分割、行高、空状态节奏 | 项目管理 IA；彩色徽章堆叠 |
| 3 | [twentyhq/twenty](https://github.com/twentyhq/twenty) | 60k | 白面板+冷灰底 workbench：侧栏宽、详情栏、字号密度 | 重表格 CRM 流 |
| 4 | [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | 13k | Agent：Thread/Composer/ActionBar；**transcript 非厚气泡** | 默认 indigo/violet；卡通气泡 |
| 5 | [LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat) | 46k | 侧栏会话+主对话+侧板；消息操作条、空状态 | ChatGPT 克隆、按钮过载、厚阴影 |
| 6 | [vercel/chatbot](https://github.com/vercel/chatbot) | 21k | 干净 AI 输入岛、消息间距、极简 header | 硬套成纯聊天站 |
| 7 | [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | 16k | Shell：可折叠侧栏、顶栏、padding、Command | Admin 表盘当产品 IA |
| 8 | [DeadWaveWave/opencove](https://github.com/DeadWaveWave/opencove) | 1.6k | 隐喻近：Agent+canvas 布局思路（星少仅灵感） | 无限画布吞一切；Electron 壳 |

备选：[midday-ai/midday](https://github.com/midday-ai/midday)；[shadcn AI Chat With Canvas](https://www.shadcn.io/blocks/ai-chat-with-canvas)。  
**不优先**：open-webui / lobehub（易抄厚）、excalidraw（手绘风）、一切 blur/glass demo。

## 活体产品（截图对照）

| 产品 | 偷什么 |
|---|---|
| Linear | 行高/字号、1px hairline、侧栏 ~220–240、几乎无阴影 |
| Vercel Dashboard | 冷石灰底+白面板、近黑字、边框优于大圆角卡片 |
| Cursor | 右栏 Agent：transcript 非气泡、底输入岛、中栏最大化 |
| Claude.ai | 对话排版、composer 圆角边框、消息间距 |
| Figma | 左轨+中画布+右栏、浮岛工具；**结构 only，实现禁 frosted** |

## 现皮 vs 终稿 Checklist

1. 边框统一 `1px #E4E4E7`，禁 2px 粗边  
2. 圆角：面板 8–12 / 按钮 6–8 / 工具岛 10–12；忌 16–24 胖圆  
3. 阴影：默认无或单层 `0 1px 2px`；禁多层大 blur  
4. 分层：页底 `#F4F5F7` → 面板白 → 画布中性；禁奶油暖灰  
5. 密度：侧栏项 ~32–36；列表 ~36–40；padding 12–16（忌 24–32 松）  
6. 宽：左图标轨 ~48–56；展开栏 ~220–260；右 Agent ~320–380（可拖）  
7. 分割用 1px border，禁厚 separator  
8. 工具岛：画布上实色白底+hairline；**禁 backdrop-blur/glass**  
9. Agent：薄 header；消息 **transcript 流**；演示提示 muted 一行勿大黄块  
10. Composer：底岛、1px 边、发送唯一 brand `#4A7C59`  
11. 字号：UI 12/13/14；标题 14–16 medium  
12. 字重：正文 regular；忌全 bold  
13. 空状态：短标题+一行灰字；大插画缩小或去  
14. Icon：现产品 16/20；hover `#E8F0EA` 轻底  
15. 左轨「布置/评审/执行」现身；底 MATERIALS 默认收起  
16. 品牌绿仅阶段选中+发送；禁毛玻璃/靛蓝/按稿换图标/按钮旁说明书  

## 粘贴给 Trae

> 幕景 workbench 不要只换 CSS token。对照 `docs/visual-2026/04-final-flat.jpg`，并学习（按优先级）：tldraw（画布浮层工具岛）、Plane / Twenty（Linear 级密度）、assistant-ui + LibreChat / vercel/chatbot（右侧 Agent transcript+composer）、shadcn-admin（shell）。线上截图对标 Linear、Vercel Dashboard、Cursor 右栏、Claude、Figma 三栏（结构 only）。硬约束：底 `#F4F5F7`、面板白、字 `#141416`、线 `#E4E4E7`、品牌 `#4A7C59` / soft `#E8F0EA`；禁止 cream、indigo 主色、frosted glass。保留现有产品图标。按 `docs/T-VISUAL-CHROME-REFS.md` checklist 改 chrome/密度/布局。做完本地预览贴对照图；**未再点头不 commit / 不 push**。
