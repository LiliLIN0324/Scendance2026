# VISUAL-GAP v2.6 · 2026-10-28

> 只读差距盘点 · 本机 Scendance2026 · Asia/Shanghai  
> 真源：`docs/visual-2026/design-spec-2026.html`（封面 **v2.6 / 2026-10-28 / 18 节**）  
> 交叉：`docs/design-spec-2026.md`（文内仍写 **v2.5** → **版本漂移**）  
> 执行卡：`docs/T-VISUAL-2026.md`、`docs/T-VISUAL-CHROME.md`、`docs/T-VISUAL-CHROME-2.md`、`docs/visual-2026/04-final-flat.jpg`  
> 产品范围：`frontend/app` 下 page/auth/projects/editor/reset-password/view + `room-organizer` chrome + `globals.css` tokens  
> 约束：本报告为只读盘点产出；**未改产品代码、未 commit**。  
> 版本钉：下一推用 **v1.4.0**（当前 `package.json` / `frontend/package.json` = `1.3.3`），**勿**建议 v2.0.0。  
> chrome gate（modern-ui）：只改色 ≠ PASS；禁毛玻璃 / 奶油·靛蓝主色 / 换产品图标。

---

## 总判

**能按规范全改，但必须分波；工作台骨架已半落地，字标/绿纪律/非工作台页/AI 十四~十八与 token 清扫仍欠账。**

未提交工作区已有 chrome 向改动（相对 tip，仅列关键文件）：

```
frontend/app/globals.css                              | ~98 行净变
frontend/components/room-organizer/panels/agent-panel.css | ~15
frontend/components/room-organizer/panels/scendance-workspace.tsx | ~73
frontend/components/room-organizer/room-organizer.tsx | ~38
```

tip：`8ec3340`（品牌定版与视觉重构已入史；工作区仍有未 commit 收口）。

---

## 00–18 差距表

| 节 | 主题 | Status | 证据（路径 + 选择器 / 要点） |
|---|---|---|---|
| **00** | Brand Wordmark | **PARTIAL** | 构造「门厅图标 → 幕景 → 绿点 → SCENDANCE」在工作台 JSX 已有：`room-organizer.tsx` `.sc-brand` + `BrandMark` + `.sc-brand-dot` + `<i>S</i>CENDANCE`。**登录 Intro** `intro.css` `.sc-intro-brand-en` 已用 `var(--font-playfair)` + Italic S + `.01em` → 对齐。**工作台** `globals.css` `.sc-brand-en` 仍是 **Inter** + `letter-spacing:.22em`（规范要 Playfair 500 · `.01em`）→ 半对齐。重置密码 `reset-password/page.tsx` `.sc-auth-brand` 纯文字「幕景 Scendance」，无 Playfair/绿点/BrandMark。 |
| **01** | 色彩系统 | **PARTIAL** | L1 主色钉对：`globals.css` `:root` `--green:#4A7C59`、`--ink:#141416`、`--plane:#F4F5F7`、`--hair:#E4E4E7`。**绿只三处**未守死：合法处 ≈ 左轨选中 `.sc-mode-rail button.is-active`、发送 `.ap-send`、成功点；泄漏：`.ap-link`/` .ap-ok-line`/` .sc-brief-blank-link`/` .ap-steps li.is-done`/` .sc-tool-column …is-active` 绿边字、品牌点本身另计。`--green-pale` 代码 `#EEF3EF`，HTML `:root` 写 `#E8F0EA`、色板 swatch 又画 `#EEF3EF`，执行卡钉 `#E8F0EA` → **规范内自相矛盾 + 产品取 EEF3EF**。无奶油/靛蓝主 UI 洗色（旧 hex 搜索基本清空）。 |
| **02** | 字体排版 | **PARTIAL** | `layout.tsx` 自托管 Inter + Noto Sans SC + Playfair；`--font-sans` / 7 档 `--fs-*` 在 `globals.css`。Agent 区已钉 `--fs-cap: var(--fs-p2)`（同区三档策略）。工作台字标英文字族错（见 00）。非工作台页（auth/projects/share）字号/族未统一抽检全 PASS。 |
| **03** | 间距与栅格 | **PARTIAL** | `--sp-1…8` 与工作台五块：顶栏 + 左轨 64 + 画布 + 右 Agent + 底薄条（HTML §7「左轨 64」与产品 `width:64px` 一致；旧 chrome 卡「~56」已过时，以 HTML v2.6 为准）。部分面板仍散落 magic px。 |
| **04** | 图标与阴影 | **PARTIAL** | lucide 沿用（`SquareStack`/`Send`/`ListChecks` 等），未见换产品图标 → chrome gate 过。E0 默认无阴影大体落实；残余：`cloud.css` dialog、`share.css` 浮层、旧 `.pc-glass` 定义仍带玻璃阴影（工作台内已 `backdrop-filter:none` 覆盖）。 |
| **05** | 图标索引 | **N/A→PARTIAL** | 规范索引是文档侧清单；产品继续用现有 lucide 名（`WORKBENCH_MODE_ICONS`），未引入终稿新 pictogram → 符合「图标不动」。完整 52 枚对照未做自动化核对，标 PARTIAL。 |
| **06** | 按钮与输入 | **PARTIAL** | Agent 主 CTA `.btn-primary` = 墨底白字（合 §6）；发送圆钮 `.ap-send` = 品牌绿。确认布置走 ink primary（与部分注释「绿钮」文案冲突，以色彩节「绿=选中/发送/确认勾选」+ §6 墨主钮为准，注释需 scrub）。输入 focus 环：工作台多数 `focus-visible`；composer textarea 显式 `outline:none`（靠容器 focus-within 淡绿晕，绿晕是否算「第四处绿」待 Wave A 裁决）。 |
| **07** | 导航架构 | **PARTIAL** | **已有 JSX 骨架**：`.sc-mode-rail` 布置/评审/执行 + 标签可见；`.sc-tool-column` 竖向浮岛；`.sc-material-drawer-bar` / `#material-drawer-handle` 底薄条默认收起；右 `.sc-agent-panel`。对照 `04-final-flat.jpg`：疏密/轨宽/底条文案「物料」vs 稿「MATERIALS」、工具岛静息灰与选中绿仍需并排截图硬验 → 未达 chrome gate 全 PASS。 |
| **08** | 数据展示与反馈 | **PARTIAL** | Toast/状态点/表格在 share·projects 有基础形态；语义色 token 在 `:root`；大黄块演示条已改为 `.ap-demo-note` muted 一行。 |
| **09** | 动效与极端 | **PARTIAL** | `--dur-1/2/3` + `prefers-reduced-motion` 在 globals/agent-panel；极端（窄屏收栏）room-organizer 有 `innerWidth` 分支。生成动效见 §14。 |
| **10** | 缺省图 · 空态 | **PARTIAL** | `not-found.tsx` / `.sc-page-error*`、projects 空工作室、share 空物料、canvas loading 文案存在；插画禁则大体遵守。统一「H2+P2+单主操作」模板未铺到全部空态。 |
| **11** | 错误与异常 | **PARTIAL** | `error.tsx`（chunk/恢复）、`not-found.tsx`、`view` `role="alert"`、canvas error 块在 globals。技术细节折叠样式有；英文堆栈外泄策略需按页再验。 |
| **12** | 无障碍 | **PARTIAL** | `lang="zh-CN"`；多处 `aria-label`/`aria-pressed`/`aria-expanded`/`aria-live="polite"`（`.ap-feed`）；触达区多数 ≥32；对比度 token 对齐 AA。缺口：composer/部分控件 focus 被掐；流式 `aria-live` 未做 800ms 节流（§14）。 |
| **13** | Token 三层治理 | **FAIL** | L1 语义 token 已建，但 **hex 散落**：`globals.css` ~94 处字面量、`room-organizer.tsx` 注释外仍有 UI 旁路、`intro-page.tsx` ~41、`cloud.css`/`share.css` 自建色。`--sc-*` / `--pc-*` / `--ap-*` / `--wk-*` 多层别名未收敛到「组件只引 L1」。HTML/CSS `--green-pale` 双值未裁定。globals 注释仍写 v2.2。 |
| **14** | AI 生成态 | **PARTIAL** | 有 `GenProgress` / `GEN_STEPS` / phase 机；**无**逐 token 尾随 1px 墨色光标、无「回到底部」、无 800ms aria-live 节流（规范明文）。 |
| **15** | AI 交互状态机 | **PARTIAL** | phase：`idle/generating/paused/proposed/ready/…` + 单 CTA `#step-cta` + stop/resume 存在；与规范五态图文未一一钉可视化，确认钮颜色注释混乱。 |
| **16** | AI-native 案例图谱 | **N/A** | 规范案例为设计侧示意；产品不「实现图谱页」。落地 = 把借鉴条收进交互（并入 Wave B 验收），本节本身不改代码则 N/A。 |
| **17** | AI-native 图解 | **N/A** | 同 16，文档图解；执行跟 Wave B。 |
| **18** | Agent IP「晴光」 | **PARTIAL** | 文案「晴光」+ `qingguang-3d-40-{ask\|done\|issue}.png` 头像切图 + 收起 orb；造型/指路暖光/性格动效相对 §18 母版仍粗，未宣称视觉 PASS。 |

### 特别核对（任务硬点）

| 硬点 | 结果 | 证据 |
|---|---|---|
| 品牌字标 Playfair+绿点排法 | **半** | Intro PASS；Workbench EN=Inter+.22em FAIL；reset-password 无锁标 |
| 绿只三处（选中/发送/确认） | **FAIL** | 见 §01 泄漏列表 |
| 字号同区 ≤3 档 | **半** | Agent 已 cap→p2；全局未审计 |
| 左轨 布置/评审/执行 | **PASS（结构）** | `workbench-mode.ts` + `.sc-mode-rail` JSX；疏密待截图 |
| 底物料薄条 | **PASS（结构）** | `MaterialDrawerHandle` + `.sc-material-drawer-*`；文案「物料」非 MATERIALS |
| Agent transcript 非厚气泡 | **半** | `.ap-agent` 左发丝线透明底 ✓；`.ap-user` 仍厚墨泡 `border-radius:16px 4px…` |
| suppress 旧胶囊 | **PASS** | `.sc-tool-capsule-bar{display:none!important}`；`suppressAgentLauncher` |
| 无障碍/错误/空态 | **半** | 见 §10–12 |
| `backdrop-filter` 残留 | **FAIL（残留在）** | `cloud.css` `::backdrop` blur；`globals.css` `.pc-world .pc-glass` 仍定义 blur（`.sc-workbench .pc-glass` 已关掉） |
| hex 散落 | **FAIL** | 见 §13 |

**chrome gate 硬失败提醒**：当前未提交 diff 含 TSX 结构变更（非纯改色），方向对；但在未与 `04-final-flat.jpg` 并排截图 + 绿纪律收口前，**禁止自称工作台视觉 PASS**。

---

## 已对齐 / 半对齐 / 未做

### 已对齐（结构或 token 主轴）

- 冷石色板主 token：`--plane/#F4F5F7`、`--paper`、`--ink/#141416`、`--hair/#E4E4E7`、`--green/#4A7C59`
- 左轨三模式 JSX + 现图标（未换标）
- 画布竖向工具岛容器 `.sc-tool-column`
- 底物料薄条 DOM（把手属底条，非画布角漂浮旧钮）；旧 tool-capsule 已 suppress
- Agent 演示提示 muted 一行；agent 回复非厚气泡
- Intro 锁标 Playfair + 绿点 + BrandMark
- 404/错误页骨架偏规范
- package 版本基线 1.3.3 → 下推钉 1.4.0

### 半对齐

- 工作台字标几何在、英文字族/字距错
- 绿用途部分正确但多处泄漏
- Agent 用户侧仍厚气泡；生成态有进度无流式光标
- 晴光切图状态机有，IP 造型/指路未满 §18
- 无障碍 focus / aria-live 节流不全
- md v2.5 ↔ html v2.6；`--green-pale` E8F0EA ↔ EEF3EF
- 非工作台页（projects/view/reset-password）未吃同一锁标与 token

### 未做 / 明显缺口

- Token L0/L1/L2 治理与 hex 清扫（§13）
- 全产品绿三处执法
- Workbench `.sc-brand-en` → Playfair
- AI §14 流式光标 / 回到底部 / aria-live 节流
- §16–17 借鉴条产品化验收清单（案例本身 N/A）
- `backdrop-filter` 从 cloud/旧 pc-glass 定义清除或隔离出产品 chrome
- 与 `04-final-flat.jpg` 正式并排验收包

---

## 建议波次

版本钉：**v1.4.0**（分波可同版本多次预发，或 A 先打 1.4.0、B/C/D 跟 1.4.x；**不要**跳 v2.0.0）。

### Wave A · 工作台 chrome 收口（优先）

**目标**：对照 `04-final-flat.jpg` 三秒同气质；chrome gate 可宣称 PASS。

验收清单：

1. [ ] `git diff <base> --stat` 含 `room-organizer.tsx` + `scendance-workspace.tsx` 结构变更（禁止只改 globals 颜色）
2. [ ] 左轨：布置/评审/执行标签可见；选中 = pale 底 + 绿指示；宽按 HTML §7（64）
3. [ ] 工具岛：白底 + 1px `#E4E4E7`；静息图标中性灰；**绿仅选中**
4. [ ] 底薄条默认收起；文案与终稿一致（MATERIALS 或规范中文「物料」二选一钉死）
5. [ ] Agent：用户侧去厚气泡（与 `.ap-agent` 同一 transcript 气质）；demo muted 一行
6. [ ] 工作台锁标：`.sc-brand-en` → `var(--font-playfair)`，字距 `.01em`，S Italic
7. [ ] 绿三处执法：清 `.ap-link` / brief 绿链 / 工具岛绿字边等泄漏
8. [ ] 工作台内无可用 `backdrop-filter`（cloud dialog 若保留须移出工作台路径或改实色遮罩）
9. [ ] 硬刷截图 ×2–3 与 `docs/visual-2026/04-final-flat.jpg` **并排**；用户点头前不 commit/push

**本波条目数：9**

### Wave B · Agent / AI-native 十四~十八

验收清单：

1. [ ] §14：流式尾随 1px 墨色光标（800ms）；上滑停自动滚 +「回到底部」
2. [ ] §14：`aria-live` 800ms 节流
3. [ ] §15：五态可视化与「提案待确认仅一颗确认控件」文案/注释一致（scrub「绿钮」过时注释）
4. [ ] 生成进度卡折叠为完成摘要（规范过程即界面）
5. [ ] §18：晴光切图尺寸/状态与母版对齐；收起 orb 不抢戏
6. [ ] §16–17：从案例图谱抽取「借鉴」条打成 Agent 交互回归表（不做图谱页）
7. [ ] 同区三档：Agent 面板目视审计无第四档字号

**本波条目数：7**

### Wave C · 登录 / 项目等非工作台页

验收清单：

1. [ ] `/auth` Intro 锁标保持 Playfair 绿点（回归）
2. [ ] `/reset-password` 换统一 BrandMark 锁标（去纯文字 `.sc-auth-brand`）
3. [ ] `/projects` 纸面/发丝/字阶吃 L1；空态套 §10 模板
4. [ ] `/view` share 页：客户只读气质与错误/过期态对齐 §10–11（深底若保留须走字标 on-dark）
5. [ ] `editor` 入口与工作台同壳，无第二套色
6. [ ] 错误页 `error.tsx` / `not-found.tsx` 文案与主操作对齐 §11（无插画、无错误码主区）

**本波条目数：6**

### Wave D · token 清扫与 md/html 版本对齐

验收清单：

1. [ ] 裁定 `--green-pale`：**钉一个**（建议与 HTML 色板 swatch / md 一致取 `#EEF3EF`，或全线改 `#E8F0EA` 并改 HTML swatch+执行卡）
2. [ ] `design-spec-2026.md` 封面版本改为 **v2.6**，与 HTML 条款交叉一致
3. [ ] `globals.css` 头注释版本 → v2.6；清 `--sc-glass-shadow` 等死名
4. [ ] 组件 CSS 禁新增 hex；存量 `globals`/`intro`/`cloud`/`share` hex 迁 L1（允许 3D/画布材质色例外并注释）
5. [ ] 删除或隔离 `.pc-world .pc-glass` 的 `backdrop-filter` 定义，避免回归
6. [ ] 发布版本号 **1.4.0**（changelog 写明 visual gap Waves；禁止标 v2.0.0）

**本波条目数：6**

---

## 统计

| 波次 | 验收条数 |
|---|---|
| A 工作台 chrome 收口 | **9** |
| B Agent / AI-native 十四~十八 | **7** |
| C 登录/项目等非工作台 | **6** |
| D token 清扫与版本对齐 | **6** |
| **合计** | **28** |

| 00–18 Status 计数（约） | |
|---|---|
| PASS（结构硬点） | 左轨结构、底条结构、旧胶囊 suppress（表内多记在 PARTIAL 节内的子项） |
| PARTIAL | 00 01 02 03 04 05 06 07 08 09 10 11 12 14 15 18 |
| FAIL | 13（token 治理）；硬点：绿三处、backdrop 残留、hex 散落 |
| N/A | 16 17（设计图谱/图解本身） |

---

## 给执行者的一句话

先 Wave A 把工作台 chrome 与字标/绿纪律收到能并排 `04-final-flat.jpg`，再 Wave B 补 AI 原生态，Wave C 铺非工作台页，Wave D 清 token 并把 md/html 钉到 **v2.6**；发版号走 **v1.4.0**。
