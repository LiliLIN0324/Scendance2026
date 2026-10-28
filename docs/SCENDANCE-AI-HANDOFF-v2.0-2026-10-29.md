# 幕景 Scendance AI 接力手册 v2.0 — 2026-10-29

> **给下一任 AI / 云 Agent / Cursor Agent 的完整交接。**  
> 读完本文件 + 文内点名的几份真源，应能**不依赖本聊天历史**继续改产品。  
> 语言：中文为主；关键 ID / 路径 / SHA / 色值保持英文原文。  
> 作者角色：Grok Bot 过夜协调；产品主人：林丽丽（li ni）。  
> 状态快照时间：**2026-10-29 Asia/Shanghai ~02:10**。  
> **本回合禁止改产品应用代码**——只写交接；改码另开闸。

---

## 0. How to use this doc（怎么用这份交接）

### 0.1 新 AI 的推荐阅读顺序（严格按序）

1. **本文件全文**（尤其 §1 北极星、§5 未完成、§7 接力剧本、§8 硬拒清单）。  
2. **Taste & IA Memo**：`/workspace/docs/SCENDANCE-TASTE-IA-MEMO-2026-10-29.md`（KEEP/KILL/深藏 + Steal matrix + 首屏线框）。  
3. **规划 Page（可交互验收闸）**：  
   https://cursor.com/canvas/store-3e5ed5f3-ba6e-4f35-a16b-76a7db04eca1/75cbff1f-b526-4304-9617-90ec3d417da6  
   标题：《幕景 v2.0 产品规划全套》。  
4. **仓库 main 上的 README**（已含活动流程图与留面/收内表）：  
   https://github.com/LiliLIN0324/Scendance2026/blob/main/README.md  
5. **活动流框架**（能力边界仍有效；叙事以 v2.0 钉为准）：仓内  
   `docs/ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md`  
   （box 上也有副本：`/workspace/ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md`）。  
6. **视觉真源**：仓内 `docs/visual-2026/design-spec-2026.html`（**v2.6**）。  
7. **PINOC 实机截图**（大气参考，非 IA 蓝本）：`/workspace/pinoc-shots/01..05.png`  
   （同内容亦在取消的云 Agent store：`/cursor/stores/bc-b387707d-e09a-58a8-bc5d-7b3cb294ab51/`）。  
8. 需要再对视觉债时：`docs/VISUAL-GAP-v2.6-2026-10-28.md`（**优先级低于 Taste 收口**）。

### 0.2 什么是「法」（binding law），什么是「假说」（hypothesis）

| 层级 | 含义 | 例子 |
|---|---|---|
| **法 / 钉（binding）** | 主人口头钉或已合入 README / Release / 本交接的硬约束；冲突时以此为准 | 「3D 活动方案全流程生成」；左轨仅布置/评审/执行；色板四色；scene/object/compose 永不首页 Tab；主人品味 > 任何参考站 |
| **规划真源** | Page + Taste Memo + 本交接；指导下一 PR 的门禁 | KEEP/KILL；验收闸；切片 A–E |
| **仓内历史文档** | 仍有用，但可能被新钉覆盖叙事 | `ACTIVITY-FLOW-…2026-10-27.md` 曾偏「对话主路径」→ 已被「卡片先于对话」软化 |
| **假说 / 借鉴** | 从参考站偷氛围或路径，**可被主人一句话推翻** | 「PINOC 右栏合成可类比幕景结果三板」；「画布 ≥60%」 |
| **过期钉** | 明确作废，勿复活 | 「勿直接上 v2.0.0 / 下一推用 v1.4.0」（已被 2026-10-29 换代推废）；「chat 是入学考试」 |

### 0.3 冲突裁决（写在最前，避免浪费 token）

1. **主人林丽丽的品味与口头钉 > 任何参考站美学（Viggle / Spline / Meshy / Dora…）**。  
2. **主人钉 > 本交接 > Taste Memo > 规划 Page > README > 旧框架 md > 代码现状里的脏 UI**。  
3. 参考站只教「感觉」与「反例」；**禁止**把 Character / Motion / MCP / Objects / Assets / Code 搬成幕景首页模块。  
4. **UIUX专家**终审色板与气质；**产品经理**管范围；执行 Agent 不得自创色系或第四左轨。  
5. 用户说「推」才允许合 main / 打 tag / 发 Release；用户说「别改了 / 停云端」必须立刻停写码，改做文档或本地同步。

### 0.4 本文件不是什么

- 不是产品代码 PR。  
- 不是重新发明北极星。  
- 不是授权你去烧 token 做 Aholo E2E / 3DGS / WorldGen 表面。  
- 不是授权你 `reset --hard` 抹掉本机 ahead commit。

---

## 1. Product north star（binding · 产品北极星）

### 1.1 一句话（不可改写营销腔）

**3D 活动方案全流程生成**

英文产品名：**Scendance**；中文名：**幕景**。  
在线试用（CF Pages）：https://scendance-scene-planner-ewz.pages.dev

### 1.2 唯一用户主路径

```
选活动 → 定场地·人数 → 生成 → 确认 → 导出
```

README 已用 mermaid 钉死同一条路。任何「先进编辑器再想做什么」的入口都是歪路。

### 1.3 结果三板（plates · 同一方案的三种视图，不是三个产品）

| 板 | 用户看到什么 |
|---|---|
| **布置** | 三维场地里这一版怎么摆 |
| **物料** | 这一版用了哪些东西、各多少 |
| **执行资料** | 件数与场地，以及导出交接 |

切板 = 换看法；**禁止**做成三个并列 App / 三个首页模式。

### 1.4 左轨（rail · 永不第四枚）

**布置 / 评审 / 执行** only。

- 布置：选活动、定场地人数、生成、确认  
- 评审：把已确认方案准备给客户看（客户页无编辑 chrome）  
- 执行：内部资料与导出（意图 → 预览 → 确认导出）

### 1.5 确认闸（confirm gate）

```
建议 → 绿框预览 → 唯一确认才落盘
```

- 布置：确认布置  
- 导出：确认导出  
- **禁止**双确认、静默 apply、空闲就挂绿导出。

### 1.6 对话的地位

**Chat 加速，不是入学考试。**  
冷启动靠 **活动卡片 → chips → 一颗「生成方案」**；对话 refine（「再宽松一点」）可选。  
没选完也能跟晴光说一句，效果与点选相同：**先建议，再预览，唯一确认后写入**。

### 1.7 内部层（永远不当首页 Tab / 模式轨）

`scene`（场地壳） · `object`（物件/家具） · `compose`（合成/吸附/层）

这是管线名词。用户语言只用：**活动 / 场地 / 人数 / 方案 / 布置 / 物料 / 执行 / 确认 / 导出**。

### 1.8 色板（已定 · 禁止发明新色系）

| Token 语义 | Hex | 用法 |
|---|---|---|
| 冷石 / plane | `#F4F5F7` | 大底、安静 chrome |
| 品牌绿 | `#4A7C59` | **极稀缺**：可行动的生成 / 确认瞬间；空闲零绿主钮 |
| 近黑 ink | `#141416` | 主字、墨主钮（部分 CTA 用墨底白字） |
| 发丝线 hair | `#E4E4E7` | 分割、薄边 |

视觉全书：`docs/visual-2026/design-spec-2026.html` **v2.6**。  
绿纪律口号：**绿极稀缺**；Taste 原则第 8 条。

### 1.9 IP · 晴光（spotlight only）

- 方向已定：**A 晴光 / spotlight**；B 小园 / C 尺尺仅对照，**不推进**。  
- 真源路径（本机仓）：`_refs/ip-brand/spotlight/`  
  - `main.jpg` + `sheet.jpg`（2026-10-19 原件）  
  - `states-solo/` 六态透明 PNG（**勿覆盖**）  
  - `avatars/head_32` · `head_40`  
- 产品表现：场边**活物**单入口；**禁**矩形笨卡片 / 双胶囊贴纸 / 静帧小图标当「在场」。  
- 独立调研仓（可选读）：`LiliLIN0324/scendance-agent-presence`。

### 1.10 决定性判断（写进 Taste Memo 的合成句）

> 幕景首屏 = **推鉴的路径清晰** + **Viggle 体量的安静大世界**；  
> **不是** PINOC 多模式工作室，**不是** Spline/Meshy 工具箱。  
> PINOC Scene = *氛围* 参考；tuijian = *IA* 参考。

---

## 2. Owner references（必须塑形 UI · 尚未做完的品味收口）

主人明确要求：**根据参考重新想、深砍小碎乱、品味优先、她的判断最终**。时间线见 §2.4。

### 2.1 推鉴 tuijian — IA 绑定参考

- URL：https://github.com/wustwyh/tuijian  
- 主人钉：「笨但好懂」· **card → pipeline → 结果分块**。  
- 仓页曾 thin/403：pattern 取自主人钉，**不要**指望像素级逆向。  
- **要偷**：一张卡说清起点 → 少步 → 一键生成 → 结构化结果。  
- **不偷**：并行「高级」入口、需要教程墙才能懂的首页。

### 2.2 Viggle PINOC — 大气 / 单工作室参考

- 入口：https://viggle.ai/pinoc/app/scene  
- 实机结论（2026-10-29 journal）：  
  - **一个工作室**；资产架是 Character / Motion / Scene。  
  - **合成在场景画布右栏**，不是第三个导航产品。  
  - Create 用单提示词分支，不是模式百科。  
- 幕景映射：学「大气画布 + 单动词」；用户语言说活动/方案/布置，**不说** Character / Motion。

### 2.3 PINOC 浏览笔记 + 截图路径（box）

目录：`/workspace/pinoc-shots/`

| 文件 | 内容要点（给品味对照用） |
|---|---|
| `01-scene-gallery-create-dialog.png` | Scene 库 + Featured 卡网格；中央浮动 prompt；冷灰底；Create 不拆成五个产品 |
| `02-create-home.png` | Create 首页大留白；中央生成台；底部作品条；绿只作点缀/品牌 |
| `03-scene-canvas-add-motion.png` | **关键**：中画布吃画面；右栏「On the canvas」列角色/场景；合成在画布侧栏而非顶层 Nav |
| `04-motion-create-dialog.png` | Motion 创建对话（反例：幕景不要把动作生成抬成首页并列） |
| `05-character-create-dialog.png` | Character 创建对话（反例同上） |

同批文件亦归档在取消的云 Agent store：  
`/cursor/stores/bc-b387707d-e09a-58a8-bc5d-7b3cb294ab51/`  
（含 memo 副本 + 上述 01..05.png）。

### 2.4 Steal matrix + 反模式（压缩自 Taste Memo）

| 参考 | 学 | 不学 |
|---|---|---|
| Viggle PINOC | 世界优先；深工具折叠；describe→进空间；合成在画布面板 | 角色/动作/MCP 并列首页 |
| 推鉴 | 卡片→少步→一生成→结果块 | 并行高级入口 |
| Dora | 一生成交付整包 | 站点编辑器 chrome 当首页 |
| Spline | 大空白视口呼吸感 | Agent/Objects/Assets + Code 同级 day-0 |
| Luma | 对话改结果的流畅 | 模式 Tab + 无限画板当脊梁 |
| **Meshy** | — | **模式边栏 = 产品地图（强反例）** |
| Rodin / Polycam | — | 物件表 / 图层合成当首页（仅可作内部） |

**反模式口号**：看起来像 Meshy mode rail 或 Spline tool dock → **砍**。

### 2.5 主人指令时间线（塑形本交接的因果）

| 何时（Asia/Shanghai） | 主人说了什么 | 后果 |
|---|---|---|
| 2026-10-28 前后 | 压低理解成本；对齐推鉴「笨但好懂」；一句话钉死 | 北极星与主路径改写 |
| 过夜前 | 「必须出 v2.0.0 且大刀阔斧」；废「勿直接 v2.0.0」 | 换代授权 |
| token 紧时 | 先齐全套规划再砍码 | 规划 Page + Taste Memo 优先；打断早期云改码 |
| 说 **「推」** | 按规划开砍并打 v2.0.0 | 云 Agent `bc-6d7ae00f…` → PR#3 → tag/Release |
| v2.0.0 已发后 | 要求按推鉴+Viggle 再做 **UI 品味深收口** | 启动品味云 Agent `bc-b387707d…` |
| 随后 | **「别改了 把改动补充到本地」** | **取消/归档** 品味云 Agent；停止云端写码；优先本地同步 + **本交接** |
| 现在 ~02:10 | 要完整指导方案，让其他 AI 能接力 | **本文件即当前最高优先交付** |

---

## 3. Repo & version truth（仓库与版本真相）

### 3.1 远端真相（以 GitHub 为准）

| 项 | 值 |
|---|---|
| Repo | https://github.com/LiliLIN0324/Scendance2026 |
| 默认分支 | `main` |
| **tip / tag** | **`v2.0.0`** |
| Annotated tip SHA | `5c78074cc735f7d81cd0dd05c7ee581cc4fa63b9` |
| Release | https://github.com/LiliLIN0324/Scendance2026/releases/tag/v2.0.0 |
| Release 发布时间 | 2026-10-28 18:05:08Z → **2026-10-29 02:05 Asia/Shanghai** |
| 合入 PR | **PR #3**（squash merge）https://github.com/LiliLIN0324/Scendance2026/pull/3 |
| PR 标题 | `v2.0.0 活动方案全流程：首屏生成，三块视图，深收口` |
| PR head 分支 | `cursor/v2-activity-flow-bec8` |
| 执行云 Agent（已完成发版） | `bc-6d7ae00f-2827-5bfc-96d4-f82d706bbec8` |
| 生产预览 | https://scendance-scene-planner-ewz.pages.dev |

Release body 摘要（事实）：

- README 开头是活动流程图  
- 首屏：活动卡片、场地与人数、一颗「生成方案」  
- 结果三板：布置 / 物料 / 执行资料  
- 深收口：左轨只留布置/评审/执行；场景与物件不占首页  

### 3.2 本机克隆（用户桌面 · 需小心和解）

| 项 | 值 |
|---|---|
| 路径 | `C:\Users\13266\.dsh\bot\workspace\Scendance2026\` |
| machineId | `b33e3e92-e01a-447e-af22-578ac4323c98`（label: **Scendance**） |
| 交接撰写时状态 | 该机曾报 **temporarily unreachable**；下一 AI 须重试探测 |

**已知脏状态（主人/协调口述 · 拉取中断现场）**：

```
main...origin/main [ahead 1]
 M design-spec-2026.html   （或 docs/visual-2026/ 下等价路径——以本机 git status 为准）
?? _work/
```

**硬规则**：

1. **不要** `git reset --hard` 盲目丢掉 ahead 的那 1 个本地 commit。  
2. 先 `git fetch`，再 `git log --oneline HEAD...origin/main`、`git status`、`git stash list` 看清再决定 merge/rebase/cherry-pick。  
3. `_work/` 未跟踪目录：先列出内容，可能是草稿/截图/临时导出——问清或搬到安全处再清理。  
4. `design-spec-2026.html` 的本地修改：对照远端 `docs/visual-2026/design-spec-2026.html` v2.6；可能是有意编辑或旧路径副本——**diff 后再合**。  
5. box 上 `/workspace/Scendance2026` **不是**用户本机真相：它停在很旧的 `local/workbench-v24`（tip ~`e647c80`），**勿**把它当成 v2.0.0 工作树。

### 3.3 技术栈速查（改 UI 时别走错目录）

- 工作台主体：`frontend/`（Next.js 15 静态导出 · React 18 · three.js · zustand）  
- 关键组件区：`frontend/components/room-organizer/`  
- 样式 token：`frontend/app/globals.css`  
- 后端：Supabase（Postgres + Auth + Edge Functions）  
- 部署：Cloudflare Pages ← `main` → `frontend/out`

---

## 4. What v2.0.0 already shipped（已上车 · 保持）

### 4.1 表面 KEEP（与 Taste Memo / README 一致）

- 一颗主动词 **「生成方案」**；未选完时灰，不是绿。  
- 活动卡冷启动 + 场地·人数。  
- 大画布：空闲约整窗 96%；预览确认栏打开后仍约 72%（PR#3 自述）。  
- 左轨仅 **布置 / 评审 / 执行**。  
- 预览后唯一 **「确认布置」**。  
- 结果三板同一方案。  
- 六页执行台收进「内部资料」，默认不展开。  
- 画布不再显示 n/N 进度；空闲导出不用品牌绿。  
- 可见文案去掉厂商名；按钮旁不放说明书。  
- README 根目录活动流程图 + 留面/收内表。

### 4.2 PR#3 验证（合入时）

- `npx tsc --noEmit`（frontend）通过  
- `npm run build`（frontend）通过  
- 相关测试：plan-flow、agent-panel、物料库、执行面板、画布工具等（PR body：113 + 创意工作室 212）  
- 浏览器故事：选「发布会 / 室内 12×9 / 80 人」→ 生成 → 预览 → 三板 → 一颗确认  

### 4.3 KEEP / KILL / DEEP-HIDE 权威表

**完整表以 Taste Memo §3 为准**；此处只钉执行口令：

- **KEEP surface**：生成方案、活动卡、chips、大画布、三板、预览→一确认、三图标左轨、晴光场边、诚实 demo 条、冷石 chrome。  
- **KILL from first screen**：Scene/Object/Compose/Animate/Print/Remesh/Mood/3DGS/WorldGen 并列；六 Tab 默认壳；向导 n/4；双确认；空闲绿导出；说明书墙；Meshy 模式轨；Spline 工具岛；第四左轨；厂商名上屏。  
- **DEEP-HIDE**：场地壳 / 物件库 / 合成吸附 / 执行六工具 / 评审云链 / 模型·MCP 选择 —— 有方案后或按语境出现，永不 day-0 Tab。

### 4.4 重要：v2.0.0 ≠ 品味终态

结构与主路径已换代，但主人仍认为 **推鉴清晰度 + Viggle 大气** 未吃满。  
下一刀是 **Taste pass（气质/chrome/疏密）**，不是再发明一条产品路径。

---

## 5. What is NOT done（关键缺口）

### 5.1 品味 UI 收口（当前最高产品优先级 · 未完成）

- 主人明确要按 **推鉴 + Viggle look/feel** 再砍一刀。  
- 云 Agent **`bc-b387707d-e09a-58a8-bc5d-7b3cb294ab51`** 已启动做该品味 PR，但在完成前被主人下令：  
  **「别改了 把改动补充到本地」** → **CANCELLED / archived**。  
- Store 里现有：Taste Memo 副本 + PINOC 01..05 截图；**没有**已合入的品味 PR。  
- **下一步**：由新 AI 在本地（或新分支）重开 Taste pass；**默认先问是否允许 push**——主人刚停过云端。

### 5.2 本机与 v2.0.0 同步（拉取曾中断）

- 本机曾 `ahead 1` + 脏文件；fetch/pull 可能未完成。  
- 下一 AI 必须 **先和解 git**，再改 UI。  
- 和解时保护本地 ahead commit 与 `_work/`。

### 5.3 较低优先级（明确排在 Taste 之后）

| 项 | 说明 |
|---|---|
| **VISUAL-GAP v2.6 Waves A–D** | 28 条；字标/绿三处/token 清扫等。文档仍写「发版走 v1.4.0」——**版本叙事已被 v2.0.0 覆盖**，但波次技术债仍在。Taste 收口时可顺手吃 Wave A 的绿纪律/画布安静，勿展开成全波运动。 |
| **Aholo E2E / M3** | 仍欠；**除非主人点名，禁止烧 token**。 |
| 真 3DGS / WorldGen 表面 | Out this phase。 |
| 重写布置几何算法 | Out。 |

### 5.4 规划验收闸仍全部未勾（Page 原文）

- [ ] 首屏：卡片 + chips + 一颗绿「生成方案」；无模式轨  
- [ ] 空闲：零绿主钮  
- [ ] 生成后：大布置 + 三板可见，不先开工具  
- [ ] 左轨仅布置 / 评审 / 执行  
- [ ] 无六 Tab 壳、无脚注墙、无 Scene/Object/Compose Tab  
- [ ] 预览 → 唯一确认仍成立  

> 注：PR#3 声称结构上已接近；**品味与肉眼闸**仍要对照 PINOC 截图 + 推鉴清晰度重新过。未过 UIUX/主人点头前，不宣称 Taste PASS。

---

## 6. Planning artifacts to read（规划真源清单）

| # | 产物 | 路径 / URL | 用途 |
|---|---|---|---|
| 1 | 本交接 | `/workspace/docs/SCENDANCE-AI-HANDOFF-v2.0-2026-10-29.md` | 接力总纲 |
| 2 | Taste & IA Memo | `/workspace/docs/SCENDANCE-TASTE-IA-MEMO-2026-10-29.md` | KEEP/KILL、Steal、首屏、CloudAgent brief |
| 3 | 规划 Page | https://cursor.com/canvas/store-3e5ed5f3-ba6e-4f35-a16b-76a7db04eca1/75cbff1f-b526-4304-9617-90ec3d417da6 | 切片 A–E、验收闸、演示脚本 |
| 4 | Activity Flow 框架 | 仓 `docs/ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md` | 交互纪律、Out 表；叙事以 v2.0 软化 chat-first |
| 5 | design-spec v2.6 | 仓 `docs/visual-2026/design-spec-2026.html` | 色、字、chrome 真源 |
| 6 | VISUAL-GAP | 仓 `docs/VISUAL-GAP-v2.6-2026-10-28.md` | 视觉债波次（低优） |
| 7 | README main | 仓根 README | 已发版用户叙事 |
| 8 | PINOC shots | `/workspace/pinoc-shots/01..05.png` | 大气对照 |
| 9 | 取消 Agent store | `/cursor/stores/bc-b387707d-e09a-58a8-bc5d-7b3cb294ab51/` | 同批截图+memo；无未完成 PR 代码可依赖 |
| 10 | Release / PR | Release v2.0.0 · PR #3 | 已合入范围边界 |

Page 源码副本（只读）：  
`/cursor/stores/user/canvases/75cbff1f-b526-4304-9617-90ec3d417da6/source.canvas.tsx`

---

## 7. Relay playbook（下一任 AI 逐步剧本）

### Step 1 — 读真源（只读）

1. 本交接全文。  
2. Taste Memo 全文。  
3. `git clone` / 打开本机仓后读 **main 上 README**（确认 tip = `5c78074…` / tag `v2.0.0`）。  
4. 打开规划 Page，过一遍验收闸与切片 A–E。  
5. 肉眼看 `/workspace/pinoc-shots/01..05.png`（至少 02 Create 首页 + 03 画布右栏合成）。

**完成标准**：能用自己的话复述北极星、KILL 名单、为何 PINOC 不是 IA 蓝本。

### Step 2 — 和解本机克隆（危险操作区）

在 machineId `b33e3e92-e01a-447e-af22-578ac4323c98`：

```text
cd C:\Users\13266\.dsh\bot\workspace\Scendance2026
git status -sb
git remote -v
git fetch origin
git log --oneline -5 HEAD
git log --oneline -5 origin/main
git log --oneline HEAD...origin/main
git diff --stat
git diff -- design-spec-2026.html docs/visual-2026/design-spec-2026.html
dir _work
```

决策树：

- 若 ahead commit **有价值** → 分支备份 `backup/local-ahead-YYYYMMDD`，再 rebase/merge `origin/main`。  
- 若 ahead commit **无价值/误操作** → 仍先备份分支，再丢弃；**禁止不备份直接 hard reset**。  
- `_work/` → 列清单；有用则移出仓或加入明确文档，再删。  
- 工作树干净且与 `origin/main`（v2.0.0）对齐后，才开品味分支。

建议分支名：`cursor/taste-pinoc-tuijian-YYYYMMDD` 或 `local/taste-pass`。

### Step 3 — Diff 当前 UI vs 参考（先出变更清单，再写码）

对照清单（写进 PR 描述或 `_work/taste-diff.md`）：

| 检查点 | 幕景现状（自己开 /editor 看） | 参考期望 | 拟改 chrome |
|---|---|---|---|
| 首屏入口 | ? | 推鉴：卡→chips→一生成 | … |
| 画布占比 | ? | PINOC：世界吃画面 | … |
| 右栏 | ? | 简报+三板；合成不进 Nav | … |
| 左轨 | ? | 仅三图标 | … |
| 空闲绿 | ? | 零绿主钮 | … |
| 模式/工具岛 | ? | 无 Meshy rail / 无 Spline dock | … |
| 脚注/说明书 | ? | 全砍 | … |
| 晴光 | ? | 场边活物单入口 | … |

**禁止**：未列出具体 chrome 变更就直接「全面重构」。

### Step 4 — 实现 Taste PR（或仅本地）

按规划切片顺序（可合并，但勿颠倒优先级）：

| 切片 | 结果 |
|---|---|
| **A 首屏** | 卡+chips+单生成；杀并列入口；chat 降级可选 |
| **B 结果板** | 布置/物料/执行 = 同方案视图；接预览→确认 |
| **C 深藏扫** | grep KILL 文案与壳；能力退到语境 |
| **D 安静** | 抬画布占比；空闲零绿；脚注清扫；对齐冷石 |
| **E 演示** | 四步伙伴脚本（可不写码） |

实现纪律：

- **深砍优于抛光堆砌。**  
- **不发明颜色**；只吃 `#F4F5F7 / #4A7C59 / #141416 / #E4E4E7`。  
- **不加** Scene / Object / Compose Tab。  
- 用户未说「推」→ **只本地或 draft PR，不合 main、不打 tag**。  
- 代码工作优先交 Cursor 强模型；Grok Bot 写任务书与回报（主人既有工作习惯）。

### Step 5 — 验收

用规划 Page 验收闸 + Taste Memo §7.2 Acceptance screenshots：

1. 首屏无模式轨。  
2. 空闲零绿主钮。  
3. 生成后大布置+三板，不先开工具。  
4. 左轨三枚。  
5. 无六 Tab / 脚注墙 / Scene·Object·Compose Tab。  
6. 预览→唯一确认仍在。  
7. （品味加项）并排 PINOC `02`/`03`：幕景应更「活动方案」而非「3D 资产工作室」，但画布安静度同级。  

交 **UIUX专家** 肉眼闸；主人点头前不宣称 PASS。

### Step 6 — 明确不要做

- 不发明色系 / 换 IP / 教程产品。  
- 不加 Scene/Object 首页 Tab。  
- **不烧 token 做 Aholo / 3DGS**，除非主人本回合点名。  
- 不复活 Meshy 式模式轨「给高级用户折叠一下」。  
- 不把 Generate 拆成 Scene Generate + Layout Generate。

### Step 7 — 演示脚本（给伙伴 · 切片 E）

1. **选活动** — 点「发布会」卡 → 对方应感到「活动方案」不是「3D 软件」。  
2. **定场地人数** — chips 改人数/尺寸；简报同步；无第二表单。  
3. **生成→确认** — 一颗生成；画布出布置；绿框预览后唯一确认；展示三板。  
4. **导出/评审** — 执行轨导出预览再确认；评审只给客户看结果；**禁演示模式 Tab**。

---

## 8. Hard reject list for PRs（硬拒 · 来自 Memo §7.5 + Page ProsCons）

下一任审 PR / 自审时，**出现任一条 → 直接拒或打回**：

1. 首页加折叠「高级 3D / Advanced tools」区块「先收起来」。  
2. 首屏或左轨出现 **Mode switcher**（Scene/Object/Compose/Animate/…）。  
3. 生成键或确认键旁出现说明书段落 / AI 脚注墙。  
4. 把「生成方案」拆成 **Scene 生成 + Layout 生成**（或更多）。  
5. 第四枚左轨图标。  
6. 空闲态品牌绿主按钮（含空闲绿导出）。  
7. 双确认（确认应用 + 确认布置并存等）。  
8. 六 Tab 执行台回到默认主壳。  
9. 新色系 / 奶油靛蓝洗色 / 毛玻璃当工作台主材质。  
10. 表面文案出现：重建、高斯、splat、WorldGen、Object、Composer、模式库、厂商名（Viggle/Meshy/Rodin…）。  
11. 未备份就 `reset --hard` 抹本机 ahead。  
12. 主人未说「推」却合 main / 打 tag / 部署当完成态。

**可合信号（正向）**：首屏一眼主路径；深砍优于堆功能；用语只说活动/方案；空闲沉默。

---

## 9. Teammates / roles（角色）

| 角色 | 职责 | 边界 |
|---|---|---|
| **主人 林丽丽** | 品味终审、是否「推」、停/改方向 | 口头钉 > 一切文档 |
| **UIUX专家** | 色板、气质、肉眼 PASS/FAIL | 不擅自扩产品范围 |
| **产品经理** | 范围、优先级、Out 表 | 不发明与北极星冲突的模块 |
| **Grok Bot** | 过夜协调、规划 Page、Memo、**本交接**、开/停云 Agent | 默认不手写大块产品代码；改码派 Cursor |
| **Cursor / Cloud Agent** | 按 brief 改 `frontend/`、开 PR | 遵守 §8；停令立即停 |
| **前端落地等** | 历史合入执行 | 以当前 v2.0 钉为准 |

协作习惯（主人 profile）：改仓库时 Grok 写任务书与摘要 → Cursor 强模型写码 → 另一模型对抗审查；**分支+PR，禁止直推 main**；合并由人（或主人明确「推」）。

---

## 10. Status as of 2026-10-29 Asia/Shanghai ~02:10

| 维度 | 状态 |
|---|---|
| 产品换代发版 | **已完成** v2.0.0 @ `5c78074` · PR#3 · Release 已发 |
| 规划文档 | **已齐**：Taste Memo + 规划 Page + README 流程图 |
| 品味深收口（推鉴+PINOC） | **未完成**；云 Agent `bc-b387707d` **已取消/归档** |
| 本机同步 | **可能中断**；ahead 1 + 脏文件；机曾 unreachable |
| VISUAL-GAP / Aholo | **仍欠**；低于 Taste |
| 当前最高优先交付 | **本 AI 交接文件**（非改码） |
| 工作态 | **Idle after cancel** — 等下一 AI 按 §7 接力 |

### 10.1 给协调者放上 Page 的短注（Deliverable 2）

绝对路径：

```text
/workspace/docs/SCENDANCE-AI-HANDOFF-v2.0-2026-10-29.md
```

建议 Page 一行摘要：

> 幕景 v2.0 AI 接力手册（2026-10-29）：北极星已钉、v2.0.0 已发、品味收口未做完（云端已停）；下一 AI 先读此文件再和解本机仓。

### 10.2 一句话给下一任

> **先读交接与 Taste Memo，小心对齐本机到 `origin/main`（v2.0.0），对照 PINOC 截图与推鉴列出 chrome 砍单，再开 Taste 分支；不发明颜色、不加 Scene/Object Tab、不碰 Aholo，除非主人再说一次「推」。**

— End handoff v2.0 · 2026-10-29 —

