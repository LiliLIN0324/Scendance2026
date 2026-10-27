# T-VISUAL-CHROME · 骨架对齐（强制改 DOM，禁止只洗 CSS）

> 2026-10-27 Asia/Shanghai · 喂 Trae  
> 对照：`docs/visual-2026/04-final-flat.jpg` + `docs/visual-2026/FINAL.md` + `docs/T-VISUAL-CHROME-REFS.md`  
> 现状：未 commit 的 CSS token/去玻璃改动可保留；**布局仍像旧皮**，用户判定「没改」。本卡必须改布局。

## 一句话

把工作台 chrome 改到并排 `04-final-flat.jpg` 三秒能认同一气质。只改 CSS 变量 = 失败。必须动 `room-organizer.tsx` / `scendance-workspace.tsx`（及相关 panel）的结构与 class。

## 钉死架构（终稿）

1. **左轨窄条**：布置 / 评审 / 执行（现产品图标），选中 = `#E8F0EA` 底 + `#4A7C59`  
2. **中场 3D 吃满**：少边距、少圆角大框；尺寸角标保留  
3. **右 Agent**：白面板 + 1px 左边线；transcript 非厚气泡；演示提示 muted 一行  
4. **画布浮岛工具**：竖向 pill / 轻圆角白底 + hairline，图标无旁注（T-06）  
5. **底 MATERIALS**：默认收起的细底条（终稿底栏），点开再出货架  

色板/图标钉：冷石 `#F4F5F7`、白、`#141416`、线 `#E4E4E7`、绿 `#4A7C59`；图标全部沿用现产品。禁毛玻璃、厚阴影、奶油/靛蓝、按稿换图标、按钮旁说明书。

## 参考（只学 chrome，不抄业务）

优先读开源：tldraw 浮岛 · Plane/Twenty 密度 · assistant-ui / vercel/chatbot Agent 栏。详表见 `docs/T-VISUAL-CHROME-REFS.md`。

## 必须改的文件（至少）

- `frontend/components/room-organizer/room-organizer.tsx` — 壳：左轨 / 画布 / Agent / 底条位置  
- `frontend/components/room-organizer/panels/scendance-workspace.tsx` — 工具岛形制、氛围旁注已去则保持  
- `frontend/components/room-organizer/panels/agent-panel.css` (+ 必要时 `.tsx`) — header/composer/transcript  
- `frontend/app/globals.css` — 仅服务上述布局（宽度、岛屿、轨），勿再假装「换 token 完成」

## 验收（缺一不过）

1. 本地硬刷后截图，与 `docs/visual-2026/04-final-flat.jpg` **并排**贴出。  
2. 左轨三阶段可见且可点。  
3. 工具在画布上呈浮岛，无旁注字。  
4. 底 MATERIALS 默认收起。  
5. Agent 无大黄块；发送键 brand 绿。  
6. 无 backdrop-filter / 厚玻璃。  
7. **未点头不 commit / 不 push。**

## 失败定义

- 只改颜色/阴影/圆角数字，DOM 骨架不变  
- 把左轨做成宽 admin 侧栏或表格后台  
- 换掉现有图标资源  

做完只回报：改动文件清单 + 2～3 张对照截图。等用户点头再提交。
