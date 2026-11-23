# 测试清绿与主线推进 · 给后续 Agent 的作业提示词（可直接粘贴）

> 生成时间：2026-11-23。本文件自包含：不依赖此前对话上下文即可开工。
> 适用仓库：`C:\幕景\Scendance2026`（幕景 Scendance2026，活动空间设计工作台）。
> 角色定位：你是在既有代码主仓上做测试收口与小步解耦的执行 agent；**只做被点名的事，不主动扩展范围**。

## 0. 一句话背景

产品正在从「本机本地方案为准」的旧室内壳体，迁移到「云端为唯一权威正源、本机仅作离线草稿与缓存」的形态。当前阶段后端还是本地桩，**不跳卡硬切生产码**；测试侧先把 `agent-panel` 套件的红例按 P1/P2/P3 三档收口，能独立清的清，依赖前置或需人拍板的如实挂账。

## 1. 环境与门禁命令（Windows / pwsh，Node 必须用 26）

默认 PATH 上的 Node 22 禁跑测试与构建，先切 Node26：

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
cd C:\幕景\Scendance2026\frontend
```

- 类型检查：`npx tsc --noEmit`（必须 exit 0）
- 单文件 lint：`npx eslint components/room-organizer/panels/agent-panel.react.test.tsx`（0 error；import/order 既有 warning 不算回归）
- 定向跑套件：`npx vitest run components/room-organizer/panels/agent-panel.react.test.tsx -t "标题片段"`
  - `-t` 只接受单值；多关键词用正则 `|` 合并，如 `-t "floor|Floor"`。
  - 大簇会被 15s timeout 例串行拖垮超时，必须分批 `-t` 子串，不要整簇一把跑。
  - 结构化清单：`--reporter=json --outputFile="$env:TEMP\ap-xxx.json"`（临时产物不入库）。
- 全量对照基线：`npm --prefix frontend run test`（耗时长，仅在阶段性收口时跑，用于比对是否有新增回归）。
- 构建：`npm --prefix frontend run build`（静态导出，阶段性收口前跑一次）。

## 2. 三档归类（先定性，再动手；证据不足不盲改）

每条红例先读测试标题与断言、再 grep 现役生产码出口，归入下面一档：

- **P1 断言对齐 / 结构修正（测试侧独立，不依赖新桩）**：现役文案已退役或漂移、说明收进了 title 属性等结构错位、`getByText` 多命中收窄为更精确选择器、签名/字段名漂移。
  - 每条先 grep 现役码核实：现役句/结构确实如此才对齐；**找不到现役依据的不删断言**，转 P2/P3 挂账。
  - 回显多命中收窄惯例：用户句会同时进对话流 `.ap-feed` 和会话标题 `<h1 class="ap-session-title">`；裸 `findByText(用户句)` 会双命中。用模块级现成 helper `waitFeed(text)`（只查 `.ap-feed` textContent）；清空断言收窄为 `document.querySelector('.ap-feed')?.textContent` 不含该句。
- **P2 套件补桩（测试侧，不改生产码）**：现役分支/句子在生产码存在，但 studioMock / 会话仓 / plan bridge 未喂对应状态（`pendingCandidates`、shortfall、`seatingReview.broken`、`applyRecovery`、非匿名 owner 快照、有效 StarterPlan 等）。参照套件内 studioMock 全集与已绿桩序补前置，再把观测点对齐现役产物。
- **P3 外部阻塞（前置到位前不在测试侧硬清）**：身份/会话守卫、提案状态缺口、两份 brief 打通、预览写画布守卫定性等。前置不到位时保持挂账，不计入测试侧可清数。

### 当前已知挂账（2026-11-23 复核，行号以当前文件为准，动手前先 Grep 复核）

**P2 补桩方向**
- 提案「确认布置」按钮 missing 一族：桩未喂 `layoutModeConfirmed` / shared allocation / shortfall / `pendingCandidates` / 有效 StarterPlan。按钮渲染条件见 `agent-proposal-card.tsx` 的 `!plan.blocked && !inventoryBlocked && !exportPreview`；逐例探针读 `plan.blocked` 文案，区分「桩未喂前置」与「生产守卫回退」。
- shared-desk 跨轮记忆保留；`seatingReview.broken` 桩未喂（出口 `agent-proposal-card.tsx` broken 分支）；shortfall 句映射待核；in-flight 撤回出口句待核。
- 楼层族 style 能力卡前置缺失；导出族 `snapshot.availability` / `pendingCandidates` registry 未喂。
- cloud seating 3 例 warning 归属漂移（见下方待拍板 1）。
- count-obj 预览写画布守卫（59 项 vs 1 项）：先定性现役生产回退（预览不该写画布）还是旧断言期望过时，在此之前不改断言凑绿。
- TypeError 多为前序 DOM 未渲染连锁，随 P2 桩到位消解。

**P3 外部阻塞方向**
- 身份/会话守卫约 13 例：`onApply` 期望未调却 `called 1`；需 B1 片2 可切会话/项目夹具（重渲染换 `outdoorProjectId` 驱动 scope/epoch 失效）。
- candidate-undefined 3 + style/scope 提案族：offer 被闸门拦下；需单例探针读 blocked status 文案，区分 scope-token 不符 vs `validateWorkflowPlan` throw；上游 people 轮 proposal null 未修，不冒充夹具过期。
- 两份 brief 未打通族归 B2/B3。

## 3. 硬红线（不可违反）

1. 不放宽断言、不假桩凑绿；不把生产回退 bug 用改断言掩盖；不伪造云端保存 / 降级路径。
2. P2 改测试桩，**不改生产码**；要动生产码先停下汇报，等人 review。
3. **禁改 7 个几何/渲染基线文件**（硬边界，任一环变动会让成图静默失效）：
   - `frontend/components/room-organizer/hooks/use-import-export.ts`
   - `frontend/components/room-organizer/hooks/use-splat-preview.ts`
   - `frontend/components/room-organizer/three/splat-preview.ts`
   - `frontend/components/room-organizer/room-organizer.tsx`
   - `frontend/components/room-organizer/panels/scendance-workspace.tsx`
   - `frontend/components/room-organizer/three/scan-placement.ts`
   - `frontend/components/room-organizer/three/furniture-builders.ts`
4. 只按明确路径 `git add`；**不用** `git add -A` / `git add .` / `git commit -a`。提交前 `git status --porcelain` 与 `git diff --stat` 自查范围。
5. 不提交 `.env`、任何密钥、`.temp/`、`exports/` 新生成产物与证据文件；不提交既有未暂存夹带（`.gitignore`、`HANDOFF.md`、`docs/INDEX.md` 及未跟踪的 `deliverables/`、`design-drafts/`、`design-sketches/`、`flow/`、`tools/aholo/`、`tools/demo-video/` 等目录）。
6. 本地攒好 tsc + 定向测试 + 全量对照无新增回归后，再一次性提交；**不开小 PR、不频繁 push main**（推送口径由人决定）。
7. 没有证据不算完成：提交说明必须贴命令与原始输出，写清哪些已验证、哪些没验证、刻意没做的事。
8. 不删/篡改 `UPSTREAM-LICENSE` 与素材来源说明；不做自动化合并、不打 tag、不发 release、不部署。

## 4. 到决策点必须停住（不代补需求、不代确认路径、不代选候选）

以下事项人还没拍板，**不要替人选**，在回复里把选项和各自影响列清楚即可：

1. **cloud seating 3 例 warning 归属**：三类未核验 warning（桌椅配比 / 人数来源 / 桌椅规格）只在创意提案卡出口，AgentPanel 提案卡不渲染。二选一：① 测试迁 creative-studio 套件并按其桩序补前置；② AgentPanel 提案卡补渲染三类 warning（生产码改动，需 review）。
2. **C 族夹具切口**：先补 B1 片2 可切会话/项目夹具，还是先核 P1 残留文案；观测点落新通路 `confirmProposal` 守卫，还是旧通路 legacy zoneProposal（旧通路随 E4 退役）。
3. **style/scope 提案族**：先单例探针读 blocked status，区分生产回退 bug 还是桩 plan 不满足校验，再定归属。
4. **预览写画布守卫**：定性现役回退还是断言过时，结论出来前不动断言。
5. **草稿槽身份**：终态不允许既非云项目号、又非 `house-*` 本机草稿前缀的第三身份；新建即时归属（后端即时发号 vs 临时本机草稿后换绑云 id）归 B2/B3 设计时定稿。

## 5. 作业顺序建议

1. 先跑 P1：grep 现役出口，对齐退役/漂移文案与多命中收窄；每改一批定向跑对应 `-t` 子串转绿，再 tsc。
2. 再做 P2：按已知挂账补桩，参照同套件已绿用例的桩序；每批贴出探针读到的 blocked / 状态文案作为定性证据。
3. P3 只做定性与挂账记录，不强行清；把探针读到的现役出口、缺失前置写进台账。
4. 阶段性收口：全量对照基线，确认失败集合无台账外新增；跑 build；把本轮改动范围、命令、结果、未验证项写进 `docs/plans/2026-11-21-indoor-decommission-goal.md` 对应分段。

## 6. 关键文件指针

- 测试主件：`frontend/components/room-organizer/panels/agent-panel.react.test.tsx`（458 例）
- 生产面板：`frontend/components/room-organizer/panels/agent-panel.tsx`
- 提案/警告映射：`frontend/components/room-organizer/lib/workbench-agent.ts`
- 创意提案卡出口：`frontend/components/room-organizer/panels/creative-studio.tsx`
- 台账（状态与挂账唯一入口）：`docs/plans/2026-11-21-indoor-decommission-goal.md`
- 项目总规范：`AGENTS.md`（目录、命令、提交纪律、文案纪律以它为准）
