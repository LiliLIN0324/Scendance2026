# Scendance（幕景）AI-Native 超级升级蓝图 v0.1

> **状态**：只读规划 · **禁止执行代码 / 禁止开 PR / 禁止推生产**  
> **用途**：给其他 AI / Cursor Agent 当「可学习、可切片改」的总纲；改前必须对照仓库现状与本文件「边界」节。  
> **基线（2026-10-24 Asia/Shanghai）**  
> - GitHub `LiliLIN0324/Scendance2026` tip：`e84c101`（agent-panel 崩溃修复 + mock 真实 GLB）  
> - 本地：`C:\Users\13266\.dsh\bot\workspace\Scendance2026` 与 `origin/main` 对齐（勿急着改）  
> - 线上：https://scendance-scene-planner-ewz.pages.dev · package `1.0.1` · tag `v1.0.0` 落后 tip  
> - 定位：小型活动策划执行工作室的 **三维场景协作 Web**（非幕景宇宙官网、非西湖清趣图）

---

## 0. 怎么用这份蓝图（给改代码的 AI）

1. **先读再动**：`README.md` → `PLAN.md` → `docs/EDITOR_IA_PHASE1.md` → `docs/contracts/*` → 本文件对应章节。  
2. **一次只切一条「可验收切片」**（见 §9）；禁止「顺手重构」整仓。  
3. **一律分支 + PR，禁止直推 main**；合并只由人做。  
4. **未点头不推 Pages / 不合 PR**。  
5. **区分四层，禁止混写**：
   | 层 | 含义 | 谁定 | 谁写 |
   |---|---|---|---|
   | **产品意图** | 谁、在什么场景、完成什么 | 产品经理 | 本文 §1–2 |
   | **交互规格** | 入口、文案、浮层、验收闸 | UIUX专家 | 本文 §3 + UIUX 补丁 |
   | **领域契约** | Zod schema / Edge API / Scene v1·v2 | 后端 owner | `supabase/functions/_shared/*` |
   | **实现** | Next/Three/Zustand/组件 | Cursor（强模型） | `frontend/`；Grok 只写任务书 |

6. **禁止事项（硬钉）**  
   - 不自动 apply AI 提案到画布；必须「预览 → 人确认」。  
   - 不猜单位、不猜尺寸、不把识别结果当用户确认。  
   - 不把活动任务建议塞进 Scene candidates；分支必须 typed。  
   - 不把 Binggo 小狗当长期 IP；新角色未点头不进 UI。  
   - 不把幕景宇宙 / 西湖 / 个人站需求写进本仓。  
   - 不编造供应商、库存、价格、消防合规结论。

---

## 1. 一流活动策划产品对标（目标态，非现状宣称）

对标对象（能力维度，**不抄 UI / 不宣称已达到**）：  
Allseated / Social Tables（宴会与座位）、Cvent / Eventbrite（活动运营）、SketchUp + 活动插件（场地模型）、Notion/飞书（任务交接）、Matterport/式样漫游（客户交付观感）。

### 1.1 能力地图：一流产品「必须有」的六条主链

| # | 主链 | 一流标准（用户结果） | Scendance 现状（摘要） | 目标态（AI-Native） |
|---|---|---|---|---|
| A | **场地进场** | 平面图/CAD/照片 → 可编辑米制场地，人可纠错 | Scene v2 + reconstruction worker + 单位闸门已有；生产调度/实测弱 | Agent 驱动「识别→核对清单→确认结构」，不确定处只进待定区 |
| B | **布置编排** | 库内物料拖放 + 吸附 + 撤销；尺寸可信 | Three 编辑器 + ~550 GLB + 模板 10 套 | 自然语言 ↔ 受控工具；库检索/替换一等公民 |
| C | **方案修改** | 「把签到台挪到门口」类改动能预览、可回滚 | proposals + apply + 租约/修订 | 多轮 Agent；提案 diff 可视化；失效规则清晰 |
| D | **客户交付** | 只读链接、手机可看、可撤链、版本隔离 | `/view` + 分享撤销 | 深色评审壳 + 预设镜头 + 「发给客户」一键；对比草稿/发布 |
| E | **执行交付** | 物料表、制作计划、点验、导出给施工/外包 | 本地 handoff + SceneDeliveryPanel；云 delivery JSON **未做** | 本机闭环先稳；云交付单独立项 |
| F | **协作与权** | 工作室/项目、一人编辑锁、权限清楚 | Supabase Auth + lease + studio | Agent 动作也过租约；审计「谁确认了哪条提案」 |

### 1.2 一流体验的「非功能」标准

- **一屏主路径**：布置是默认；评审/执行不抢画布主权（已有三模式 IA，保持）。  
- **AI 是副驾驶**：永远可人工完成；AI 挂了也能拖库保存。  
- **同一场景服务编辑与交付**（PLAN 已钉）：不维护两套几何。  
- **性能**：库缩略图、实例 LOD、移动端只读流畅；Agent 上下文按需投影，不塞全库 GLB。  
- **可测**：契约单测 + 集成（PGlite）+ 真实供应商验收分列汇报。

---

## 2. 产品叙事（给产品经理对齐）

**一句话**：活动策划在浏览器里摆好三维场地，用 Agent 出初稿和改稿，再发给客户看、交给执行点验。

**付费方假设**：工作室负责人（订阅 + AI/生成额度）。首版可不做支付。

**主战场建议（待用户钉）**：活动策划执行（黑客松/工作坊/发布会）为主；展览/场馆为扩展，不抢首屏。

**砍掉 / 降级（保持一流聚焦）**  
- 多楼层复杂建筑 BIM、吊挂力学、消防合规认证 → 不做。  
- 无限额度免费 AI → 不做。  
- HY-3D 已 410：入口诚实降级，不假装还能生成。  
- 天气/NPC/漫游：氛围工具条可开，**不是**主路径第四模式。

---

## 3. 信息架构与交互（给 UIUX；现状 + 目标增量）

### 3.1 已冻结 Phase 1（勿回退）

| 模式 | 职责 | 注意 |
|---|---|---|
| `layout` 布置 | 画布 + 素材架 + 属性；活动需求嵌首屏 | 主路径 |
| `review` 评审 | 「发给客户」 | 深色预览壳 |
| `delivery` 执行 | 活动安排 / 物料 / 制作 / 点验 / 导出 / 本机备份 | 不冒充云已同步 |

左轨 ~48px 流程轨 → 向右浮层；同屏一张白板；氛围在底栏胶囊（漫游｜人群｜天气｜时段）。

### 3.2 AI-Native 交互增量（规格级，未实现则勿写进 UI）

1. **Agent 面板（替换 Binggo 入口语义）**  
   - 停靠：底栏或右下；头像/名字走新 IP（点头前占位「幕景助手」）。  
   - 三页签：`布置`（Scene tools）｜`任务建议`（activity_tasks，独立契约）｜`生成`（HY3 缺则灰显原因）。  
   - 每条回复结构：`说明` → `俯视/3D 预览 diff` → `变更列表` → `空间提示` → CTA「确认应用并保存」。  
   - 空场景 = layout 初稿；有物件 = modify；上下文变更则禁用旧提案。

2. **修改闭环**  
   - 选中物件 → 「让助手改这个」带入 selectedIds。  
   - 提案未确认时画布可继续编；确认时冲突 → 失效重生成，不静默合并。

3. **交付**  
   - 评审：预设镜头（整体/俯视/入口/舞台）、复制链接、撤链、版本时间。  
   - 执行：物料表与场景快照一致；导出 SVG/DXF/打印与 `plan-export/*` 对齐；handoff 状态机见 delivery-contract。

4. **平面图核对**  
   - 识别结果 UI：原图叠加墙线证据 + 米制读数 +「待核对」清单；无「一键全信」。

---

## 4. 三维子系统（给 3D / 氛围 / 平面图转3D）

### 4.1 现状能力清单（改前核对路径）

| 能力 | 关键路径（示意） | 状态 |
|---|---|---|
| 场景编辑 | `frontend/components/room-organizer/hooks/use-three-scene.ts` | 主路径 |
| 导入导出 | `hooks/use-import-export.ts` | 有 |
| 漫游 | `hooks/use-walkthrough.ts` | 有，非主路径 |
| NPC | `hooks/use-npcs.ts` | 有，约 3 人示意 |
| 天气/时段 | `hooks/use-scene-effects.ts` | 有 |
| 客户预览 | `components/business/scene-preview.tsx` | 有 |
| 计划导出 | `lib/plan-export/{svg,dxf,print,download}.ts` | 有 |
| 场景交付 | `lib/scene-delivery.ts` + tests | 本地 |
| 模型库 | `assets/library/model` ~550 GLB | 有；mock 已可返真实 GLB |
| Scene v2 结构 | `reconstruction-contract` + `structural-geometry` | 有 |
| 单位闸门 | `_shared/units.ts` `detectPlanUnit` / `normalizeRecognizedUnits` | 有，禁止猜 |

### 4.2 一流 3D 目标切片（按优先级）

**P0 — 布置可信**  
1. 库卡缩略图拖放 → 真实 GLB（本地 mock 与云授权分列验收）。  
2. 尺寸：包围盒归一化后可改宽深高；物料表读同一规格。  
3. 防穿墙：reducer + 后端保存双重校验（已有则补缺口测试）。  
4. 相机预设与客户页一致，避免「编辑好看、交付糊」。

**P1 — 场地进场**  
1. 图纸上传 → 识别 → 单位归一 → 人校核 → 提案应用。  
2. `SCALE_IMPLAUSIBLE` / `UNIT_AMBIGUOUS` 必须打断，禁止静默缩放。  
3. DXF 优先路径（调研结论由「平面图转3D空间」写入附录）；图片走现有重建；DWG 引导另存 DXF。

**P2 — 氛围不抢主路径**  
1. 天气/时段/漫游/NPC 保持底栏；默认全关。  
2. 性能预算：NPC≤3、特效可关；移动只读不跑漫游。

**P3 — 生成道具**  
1. HY3 410 诚实 UI；替代供应商另立项。  
2. 生成件在 BOM 标「概念道具，实物待确认」。

### 4.3 Agent 可见的 3D「工具面」（受控，非裸状态）

现有方向（Binggo / agent-runner）：`add_resource` / `replace_resource` / 移动旋转删除 / 提交 candidates。  
升级原则：  
- 工具白名单 + Zod；宽深 0.02–50 m，高 0.01–30 m。  
- 索引给模型：公共库条目（无下载 URL）+ 已授权私人资产。  
- 缺模型 → `modelSuggestions`（最多 3），不编造 assetId。

---

## 5. Agent 子系统（布置 / 修改 / 任务 — 必须区分）

### 5.1 三种 Agent「种类」——禁止混用

| kind | 用户意图 | 输入 | 输出 | 落盘方式 |
|---|---|---|---|---|
| **scene**（默认） | 摆场 / 改场 | Scene + lease + selectedIds + catalog 投影 | Scene candidates / proposal | 人确认 → proposals/apply |
| **activity_tasks** | 活动任务建议 | 白名单 summary（本机活动） | `{suggestions:[{title,phase,acceptance,objectIds?}]}` | 人选择 → 本机任务；**不**调 Scene apply |
| **generation**（页签） | 缺件生成 | 文本描述 | job 状态 + GLB | 异步 worker；与 Scene 工具隔离 |

参考：`docs/plans/activity-task-agent-integration.md`（契约待审，**未授权勿实现**）。

### 5.2 Scene Agent 一流行为规格

1. **预览 ≠ 应用**：预览零写库；确认才过租约/修订/指纹。  
2. **失效**：画布改、云版本变、租约变、提案到期 → 禁用旧提案。  
3. **限额**：≤6 工具调用 / ≤90s；每日预算；429 诚实展示。  
4. **修复**：最多一次 schema 修复；不无限付费重试。  
5. **空变更**：只聊天不写历史。  
6. **一句话铺场**：本地 `send()` 可解析铺场地（tip `e84c101`）；云路径仍走提案。

### 5.3 给改 Agent 的 AI 的文件地图

| 区域 | 路径 |
|---|---|
| 契约 | `supabase/functions/_shared/agent-contract.ts` |
| Runner | `agent-runner.ts` / `agent-model-reply.ts` / `providers.ts` |
| API | `_shared/api.ts` agent-runs 路由 |
| SQL | `migrations/20261003200000_agent_runs.sql` |
| 前端面板 | `frontend/components/.../agent-panel`（及 creative-studio 历史） |
| 提示词 | `docs/AI_SYSTEM_PROMPT.md` |
| 限额 | `docs/AI_USAGE_LIMITS.md` |
| 前端守则 | `frontend/AGENTS.md` |

### 5.4 IP / 助手形象

- 旧：Binggo 小狗 — **替换中**；未点头不进设计稿/前端。  
- 新：由 IP角色设计出 2–3 方向；尺寸/位置/用语听 UIUX。  
- 文案统一称「助手」或点头后的正式名；代码标识可暂 `assistant`，避免新写 `binggo`。

---

## 6. 交付子系统（客户交付 ≠ 执行交付）

### 6.1 客户交付（review / `/view`）

| 项 | 规格 |
|---|---|
| 产物 | 只读链接；可撤；再发新版本，旧链指旧版直至撤销 |
| 设备 | 手机可旋转缩放 + 预设视角 |
| 隐藏 | 编辑工具、内部备注、未发布草稿 |
| 壳 | 深色；与布置浅色编辑态区分 |

### 6.2 执行交付（delivery 模式）

**已实现（本地）**  
- `handoffSchema`：ownerName / dueDate / acceptance / status / evidence* / reviewedBasis  
- 状态：todo → doing → review → accepted（升态字段约束见 delivery-contract）  
- 导出：物料汇总、制作计划、点验、SVG/DXF/打印、本机备份  

**未实现（云候选 — 另立项）**  
- `projects.delivery jsonb`；业务键 `(projectId, SceneObject.id)`  
- 复制实例不继承交付态；换模型同 UUID 需重核验收  

**禁止**：把 `generation_jobs` / AI 费用映射成活动成本。

---

## 7. 数据与契约原则（所有 AI 必守）

1. **单一真源**：`supabase/functions/_shared/domain.ts` + `client/scene-client.ts`；禁止前端私自 fork wire schema。  
2. **单位**：契约全米；图纸单位走 `units.ts` 闸门。  
3. **编辑器适配**：原点/角度/尺寸转换只在 adapter；不丢字段、不伪造 cloud assetId。  
4. **Scene v2**：不可被普通保存降回 v1 覆盖结构。  
5. **汇报分列**：本地 mock / 集成替身 / 真实云供应商 — 三栏分开写，禁止「测试过了＝生产过了」。

---

## 8. 技术栈与仓结构（速查）

```
frontend/     Next 15 静态导出 · React · three.js · zustand · Tailwind/Radix
client/       分享客户端
supabase/     Auth · Postgres · Edge（scene-api, generation-worker, reconstruction-worker）
assets/       模型库 GLB + thumb
scene/        模板
tools/        Blender 参数化、平面图工具
docs/         设计与契约（改前必读）
mock-server   本地 mock（真实 GLB 路径已修）
```

部署：CF Pages 听 `main` → `frontend/out`；Edge 单独部署。

---

## 9. 可交给其他 AI 的切片清单（每片一张任务书）

格式固定：`目标 / 非目标 / 读哪些文件 / 改哪些文件 / 验收命令 / 风险`。

| ID | 切片 | 优先 | 依赖 | 验收要点 |
|---|---|---|---|---|
| S1 | Agent 面板稳定性回归（半成品崩溃类） | P0 | tip e84c101 | 打开面板不崩；空/有场景各一发 mock |
| S2 | 库拖放 → 真实 GLB 云路径验收 | P0 | 素材授权 API | 授权下载 glTF 头正确；保存重开一致 |
| S3 | 提案 diff 可视化（俯视 + 增减列表） | P1 | AI_ASSISTANT 流 | 预览不写库；确认后版本 +1 |
| S4 | activity_tasks 契约 PR（仅契约+测试，不接线 UI） | P1 | 用户授权 | 与 Scene 分支判别；无 proposals.store |
| S5 | 平面图单位歧义 UI（UNIT_AMBIGUOUS） | P1 | floorplan-v2 | 歧义阻断；无静默换算 |
| S6 | 客户页预设镜头与评审壳统一 | P1 | EDITOR_IA | 390 宽无横溢；深色壳 |
| S7 | 执行导出包黄金样例（SVG/DXF/打印） | P1 | plan-export | 与场景实例数一致 |
| S8 | 云 delivery jsonb（设计评审后） | P2 | delivery-contract 云段 | 租约下整单读写；缺实例 → needs_review |
| S9 | 新助手 IP 换肤（点头后） | P2 | IP+UIUX | 无小狗资源；无障碍名保留 |
| S10 | DXF 进场 MVP | P2 | 平面图转3D 规范 | 人工比例校准；不定尺寸进待定 |
| S11 | 氛围性能开关与默认全关审计 | P3 | use-scene-effects | 默认截图无天气粒子 |
| S12 | package/tag 与 Release 文案对齐 | P3 | 人点「打」 | 仅文档/tag，不改功能 |

**Grok Bot 职责**：为每片写任务书 + 收回报摘要；**代码由 Cursor 强模型写**；另一模型 Cursor Agent 对抗审查。

---

## 10. 角色分工（本群 · 区分清楚）

| 角色 | 本蓝图中负责 | 不负责 |
|---|---|---|
| **产品经理** | 钉主战场、砍范围、成功标准、切片优先级 | 不写代码 |
| **UIUX专家** | 三模式/Agent 面板/评审壳/390 闸；组件与用语 | 不写业务契约 |
| **平面图转3D空间** | DXF/识别路径、精度成本、待确认点清单 | 不改产品 UI 定稿 |
| **场景氛围调研** | 天气/NPC/漫游如何嵌布置、性能预算 | 不升级为第四模式 |
| **IP角色设计** | 助手形象 2–3 方向 + 用法 | 未点头不进稿 |
| **Grok Bot** | 总纲、任务书、合闸汇报、群短讯 | 不急着改本地仓 |
| **Cursor Agent** | 按切片改代码 + PR | 不直推 main |

---

## 11. 明确「现在不要做」

1. 不要急着改 `C:\Users\13266\.dsh\bot\workspace\Scendance2026` 本地未点头需求。  
2. 不要把西湖清趣图 / 幕景宇宙官网需求混进 Scendance2026。  
3. 不要实现未授权的 activity_tasks 接线或云 delivery 多表。  
4. 不要恢复 HY3 假装可用。  
5. 不要为「显得 AI」把 Agent 结果自动落盘。

---

## 12. 附录 · 一流对标检查表（验收用）

改完任一切片，用此表自检（是/否/不适用）：

- [ ] 策划能否 **不靠 AI** 完成：建场 → 拖物料 → 保存 → 发客户链？  
- [ ] AI 是否 **可关可限**，失败是否保留人工路径？  
- [ ] 提案是否 **先预览后确认**？旧提案是否会正确失效？  
- [ ] 客户链是否 **只读、可撤、版本清楚**？  
- [ ] 执行侧物料数是否与场景快照一致？  
- [ ] 单位/尺寸不确定时是否 **打断而非猜测**？  
- [ ] 租约冲突时是否 **拒绝覆盖**？  
- [ ] 文档/测试是否区分 mock / 集成 / 真云？  
- [ ] PR 是否单切片、可回滚？

---

## 13. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-10-24 | v0.1 | 首版总纲；对标一流活动策划六主链；区分 3D / 交付 / 修改 / Agent；切片 S1–S12；**不执行** |

