# T-VISUAL-CHROME-2 · 强制新 JSX 骨架（禁止只洗 CSS）

> 2026-10-27 · 喂 Trae · **上一轮 FAIL**  
> 证据：相对 tip `beb2d19`，`room-organizer.tsx` + `scendance-workspace.tsx` 合计仅约 **7 行**（挪把手、删角标/「氛围」字）。CSS 再多也不算过。用户已否决「验收全过」报告。

## 一句话

对照 `docs/visual-2026/04-final-flat.jpg`，**必须新增布局 JSX**，不是改 token / display。未达门槛 = 失败，禁止自称 PASS。

## 硬门槛（缺一 FAIL）

1. `git diff beb2d19 -- frontend/components/room-organizer/room-organizer.tsx frontend/components/room-organizer/panels/scendance-workspace.tsx`：**净增 JSX 结构 ≥ 40 行**（不含纯 className/字符串替换）。回报里贴该 diff 的 `--stat`。  
2. 左轨：在 TSX 里有明确的 mode-rail 节点（三按钮：布置/评审/执行 + 现图标），不是只靠 CSS 把旧节点 `display` 出来。若已存在，须证明并补齐终稿疏密（宽约 56、标签可见）。  
3. 浮岛：画布内独立竖向 pill 容器（白底 + `1px #E4E4E7`），图标无旁注；静息图标中性灰，**绿只用于选中与发送**。  
4. 底 MATERIALS：应用级全宽细条默认收起；打开才出货架。把手须在 DOM 里属于底条，不是画布角落小钮。  
5. Agent：transcript（非厚气泡）；演示提示 muted 一行；发送键 `#4A7C59`。  
6. 禁：只改 globals/agent-panel.css；禁毛玻璃；禁换图标；禁 commit/push。  
7. 验收：硬刷截图与 `04-final-flat.jpg` 并排；附 `git diff --stat`。吹牛行数与真实 diff 不符 = FAIL。

## 参考

`docs/T-VISUAL-CHROME-REFS.md`（tldraw 浮岛、Plane/Twenty 密度、assistant-ui）。色板钉死：`#F4F5F7` / 白 / `#141416` / `#E4E4E7` / `#4A7C59` + `#E8F0EA`。

## 回报格式（只许这个）

1. `git diff beb2d19 --stat -- <上述两 tsx>`  
2. 新增/改动的 JSX 片段说明（左轨/浮岛/底条各一段）  
3. 2～3 张对照截图路径  
等用户点头再提交。
