# B1 身份正源解耦 · 执行计划（2026-11-24）

> 承接 `2026-11-24-identity-source-decouple-proposal.md` §0 目标。本计划只覆盖 **B1 身份判定层收口**；B2 迁移、B3 写守卫、B4 镜像退役不在范围内。
> 状态：**P0–P3 已落码，P4 门禁已过（2026-11-24）；真机复核待部署；未 push、未部署**。行号对当前 main `e66249a8`，动手前先 `git fetch` + Grep 复核。执行回执见 §5。

## 0. 计划边界

**做**：身份判定从 id 格式切到正源三源（controller 挂载 + 后端可达 + 本机信封）；四态分类；回读失效的云卡在列表侧隔离、禁用进入；缓存副本只读标注；补定向测试 + 门禁 + 真机复核。

**不做**：不删 / 软删云端项目；不清本机裸槽；不迁历史裸槽；不改后端 RPC / 迁移；不做写守卫 plan 化；不做旧键退役；不访问数据库。

**不动的独占 / 基线文件**：`hooks/use-import-export.ts`、`hooks/use-splat-preview.ts`、`three/splat-preview.ts`、`room-organizer.tsx`、`panels/scendance-workspace.tsx`、`three/scan-placement.ts`、`three/furniture-builders.ts`。

## 1. 阶段拆解

### P0 基线与对照锚点（不改码）

- `git fetch` 复核行号；确认工作区无夹带改动（`git status --porcelain`）。
- 跑既有门禁留基线：根 `tsc --noEmit`、前端 `tsc --noEmit`、定向 vitest、`npm --prefix frontend run build`。
- 真机记录六卡现状（5 张 NOT_FOUND + `583dbff1` 只读 + house-* 草稿）作为前后对照锚点。
- 出口：基线全绿；六卡现状可复述。

### P1 身份模型纯函数层（可独立单测、独立提交点）

**改动文件**

- `frontend/components/room-organizer/lib/project-identity.ts`
  - 保留现有 `projectLinkKind`（`local-draft | cloud | invalid`）作为**格式分组**，不删——`reviewLinkProjectKey`、`cloudLedgerProjectId` 仍依赖它。
  - 新增正源分类纯函数 `classifyProjectIdentity(input)`，输出四态：
    - `bound-cloud`：controller 挂着服务端项目、探活可达；
    - `local-draft`：本机信封存在、未挂云项目；
    - `cache-copy`：曾打开的云项目本机副本、当前未挂云项目；
    - `orphan`：既非本机前缀、探活 NOT_FOUND、未挂云项目（终态不允许作为可切换身份）。
  - 输入显式传入：`id`、`controllerProjectId`、`geometryBinding`、`localRecordExists`、`reachability`（`reachable | unreachable | unknown`）。纯函数不读 window、不发请求。
- `frontend/components/room-organizer/lib/outdoor-project-store.ts`：仅复用 `readOutdoorProjectRecord` 判本机信封存在性；不改草稿索引前缀口径。

**测试落点**

- `lib/project-identity.test.ts`：补四态分类用例（bound-cloud / local-draft / cache-copy / orphan），以及「格式是 UUID 但本机有信封 ≠ 云项目」「格式是 UUID 且未挂云项目、探活不可达 = orphan」互斥用例。
- 不新增并行 wire schema；分类结果只驱动前端展示与守卫。

**出口**：四态纯函数 + 单测全绿；不接 UI。

### P2 列表可达性预检与失效隔离（cloud-panel）

**现状依据**（行号动手前复核）

- 预检循环已跑 `controller.peekProject`：`cloud-panel.tsx:951-970`；成功分支清缓存标记、必要时标只读；**catch 分支 :967-969 只清 `previewRequested`，未把项目判失效落到 UI**。
- 卡渲染：徽标 `:1384-1386`；`canEnter` `:1390`；双击 / Enter `:1395-1402`；缓存按钮 `:1436-1438`。
- 后端探活：`backend-session.ts:1397 peekProject`、`:1535 getProject`；错误码 `PROJECT_NOT_FOUND` `:361`。

**改动文件**

- `frontend/components/room-organizer/panels/cloud-panel.tsx`
  - 新增 `unreachableProjects: Record<string, boolean>` state；预检 catch 按错误码（`PROJECT_NOT_FOUND` / 非成员 / 已软删 / 场景损坏 502）记入；peek 成功后清除失效标记。
  - `canEnter` 并入 `!unreachableProjects[project.id]`；失效卡徽标「失效 · 无法访问」，双击 / Enter 不触发 `enterProject`；卡片置灰但**不物理删除**。
  - 缓存副本维持「本机缓存」只读入口（`openCachedProject` :792），不建立云绑定、不参与写租约。
  - 复核当前卡 `saveStatus` 来源：回读失效时不落「场景已保存 v0」这类与后端实际状态不符的陈旧标记；只保留可核实的状态回执。

**测试落点**

- 新建 panel 侧轻量 react 测试（Testing Library + jsdom）：mock `listProjects` 返回 1 可达 + 1 NOT_FOUND，`peekProject` 分别 resolve / reject；断言可达卡可进入、失效卡禁用且标失效文案。
- 断言「没有回读失败时，失效状态不渲染」（按位置断言，不钉死旧句原文）。

**待拍板前置**（P2 开工前）：失效卡是置灰留在活跃列表，还是折叠到「失效 / 归档」区；orphan 槽过渡态处置口径。
→ **2026-11-24 已拍板**：失效卡折叠到「失效 · 无法访问」区（保留卡片、禁用进入）；orphan 本机槽处置仍挂 B2。

**出口**：列表侧失效卡不可进入；可达 / 只读 / 缓存三态视觉可区分；测试全绿。

### P3 工作区判定收口（geometry-workbench 守卫前置）

**现状依据**

- `geometry-workbench.ts:14-17 isLocalProjectParam`；`:24-26 isEditorLocalProjectLink`；`:29-34 hasRequestedCloudProject`；`:37-42 isLocalActivityWorkspace`（requestedCloud 时 `:39` 早返回 false，不再读 controller snapshot / 本机信封）。
- 守卫链：`assertGeometryActionSource` `:53-60`；`handoff-cloud-guard`。

**改动文件**

- `frontend/lib/geometry-workbench.ts`
  - `isLocalActivityWorkspace`：requestedCloud 时不再直接 false；改读 `controller.getSnapshot()` 与本机信封——controller 未挂云项目且本机存在该 scope 信封，按本机工作区处理；挂着云项目才走云通道。
  - `hasRequestedCloudProject` 保留 URL 解析；身份真值交给 P1 分类函数，不凭格式单独定云 / 本机。
- 复核守卫文案与拦截条件：裸 UUID + 本机有信封 + controller 未挂云项目时，本机切换 / 备份恢复不被「已是团队项目」守卫误拦。

**测试落点**

- `lib/geometry-workbench-binding.test.ts`：补裸 UUID 本机信封用例（未挂云 → 本机工作区；挂云 → 云工作区）。
- `lib/handoff-cloud-guard.test.ts`：补云 / 本机互斥不被误判用例。

→ **实际落点（2026-11-24）**：用例放在 `lib/geometry-workbench.test.ts`（被测模块本身）；`geometry-workbench-binding.test.ts` 只覆盖绑定的读写与冲突，不装身份判定。`handoff-cloud-guard.test.ts` 未改——守卫本身不读身份，误判风险在被调用侧，已在 `assertGeometryActionSource` 用例里覆盖。

**风险与回退**：本步动到写守卫前置，若真机发现本机切换被误拦截，回退 P3，P1/P2 保留。属 B1 边界，不碰 B3 写守卫本身。

**待拍板前置**：过渡态「裸 UUID + 本机有信封 + 未挂云」按本机工作区处理的口径（台账挂 B2/B3 定稿，B1 内先取保守行为并标注）。

**出口**：本机草稿不被格式判成云项目；云项目不误降本机；守卫行为真机走查通过。

### P4 门禁与真机验收

- 根 `npm run typecheck`；前端 `npm --prefix frontend run typecheck`；前端定向 vitest + 全量套件无台账外新失败；`npm --prefix frontend run build`。
- 真机复核：
  - 5 张 NOT_FOUND 落失效态、禁进入；
  - `583dbff1` 只读云项目可只读打开；
  - `house-*` 草稿不误判云、本机切换不被误拦；
  - flow1 切项目不串、flow3 刷新续开回归。
- 本地攒批；验收全绿后一次性推 main；只按明确路径 `git add`，提交说明贴命令与原始输出、列未验证项与刻意没做的事。

## 2. 依赖与并行挂账（不在本计划）

- **后端数据层根因复核**：5 张 NOT_FOUND 的行存在性 / 成员关系 / `deleted_at` / 场景字段 / RPC 部署版本，需 DB 只读访问或 Function 日志；删除动作必须等此复核定性。
- **B2**：历史裸槽识别与迁移到 `house-*`；两份 brief 打通。
- **B3**：写守卫 plan 化（lease / revision）；checkin / note scope。
- **B4**：旧槽键 / 环境偏好键迁移；回写镜像退役。
- **待拍板口径**：新建即时归属（后端即时发号 vs 本机草稿后换绑）；C1 无参刷新草稿索引档位；C2 旧 `activity:` 存量迁移。

## 3. 风险清单

| 风险 | 缓解 |
| --- | --- |
| 预检把网络抖动 / 临时 502 误判成永久失效 | 探活失败区分 `unreachable` 与 `unknown`；临时错误不置永久失效标记，保留可重试入口 |
| 守卫改动误拦本机切换 | P3 独立提交点 + 回退预案；真机先验本机切换 |
| 失效卡文案违反文案纪律 §九 | 只留状态事实句（失效 / 只读 / 缓存）；不写免责声明、复述标题、按钮旁解释 |
| 误删 / 误归档云端项目 | 本计划不调用 `deleteProject`；失效仅前端置灰 |
| 行号漂移 | 开工前 Grep 符号复核；以符号为准 |

## 4. 提交纪律

- 不 `git add -A` / `.` / `commit -a`；不提交 `.env`、密钥、`.temp/`、`exports/` 产物与既有未跟踪夹带。
- 每阶段一个可回退提交点；P1 纯函数先合，P2/P3 绑定后合。
- 无证据不算完成：提交说明贴命令与原始输出，写清已验证 / 未验证 / 刻意没做的事。

## 5. 执行回执（2026-11-24）

### 5.1 落码范围

| 阶段 | 文件 | 落点 |
| --- | --- | --- |
| P1 | `components/room-organizer/lib/project-identity.ts` | `ProjectIdentityState` 四态、`classifyProjectIdentity()`、`reachabilityFromError()`；`projectLinkKind` 保留作格式分组 |
| P1 | `components/room-organizer/lib/project-identity.test.ts` | 四态互斥 + 错误码定性用例 |
| P2 | `panels/cloud-panel.tsx` | `unreachableProjects` 预检记录；活跃墙 `activeProjects` / 失效区 `invalidProjects`；`canEnter` 守卫；刷新重置预检；失效时当前卡不标「场景已保存」 |
| P2 | `panels/cloud-panel.react.test.tsx` | NOT_FOUND 折区并禁用、全部可达时不渲染失效区、网络错误不误判 |
| P2 | `app/cloud.css` | 失效区与置灰样式 |
| P3 | `lib/geometry-workbench.ts` | `isLocalActivityWorkspace` 不再凭 URL 格式早返回：挂云项目→云；本机前缀→本机；裸 UUID 以本机信封为准 |
| P3 | `lib/geometry-workbench.test.ts` | 裸 UUID + 本机信封 / 挂云项目 / 守卫路径用例 |

### 5.2 门禁原始输出

```
npm run typecheck                        → ROOT_TSC_EXIT=0
npm --prefix frontend run typecheck      → FRONT_TSC_EXIT=0
npx vitest run（frontend 全量）           → Test Files 842 passed | 6 skipped (848)
                                           Tests 10719 passed | 153 skipped (10872)
                                           Duration 281.73s
npm --prefix frontend run build          → BUILD_EXIT=0（oneplan-artifacts 违规 0）
```

定向：`project-identity.test.ts` + `cloud-panel.react.test.tsx` + `geometry-workbench.test.ts` 共 3 文件 / 125 条全绿。

### 5.3 执行中修掉的回归与收紧

1. **预检自动重试的回归**：初版在未知错误时清掉 `previewRequested`，导致 effect 重发云请求，破坏「守卫后不再发云请求」不变量（`cloud-panel` 4 条既有用例失败）。改为不自动重试，只在「刷新」按钮重置预检；复跑 98 条全绿。
2. **当前卡被误禁**：`canEnter` 并入失效判断后连「当前」卡也禁用，与「当前卡留在活跃区」矛盾；改为只对非当前卡生效。
3. **状态回执**：回读 `PROJECT_NOT_FOUND` 且画布就是该项目时，卡面落「失效 · 本机草稿」，不再声称「场景已保存」。

### 5.4 未验证 / 刻意没做

- **真机六卡复核未做**：需要部署后的构建；本轮未部署、未 push（当前分支 `verify-bingo-main`，非 `main`）。
- 未删 / 软删云端项目，未清本机裸槽，未动 IndexedDB / localStorage 存量。
- 未做 B2 迁移、B3 写守卫 plan 化、B4 镜像退役。
- 未碰 7 个独占 / 基线文件。
- 仍待拍板：离线缓存副本可见性档位、新建即时归属、5 张 NOT_FOUND 的后端数据层复核。
- 已拍板（2026-11-24）：orphan 本机槽按「标失效移出、只读保留备份」处理，落码见 §6。

## 6. B2 第一步：本机裸槽隔离（2026-11-24）

口径（用户拍板）：**标失效移出活跃列表、只读保留备份**；不删、不迁移、不改 id。

- **识别**：`localSlotNeedsCloudCheck()`——裸 uuid 且不是当前画布。云端清单里已有的跳过；剩下的逐个 `peekProject`，只有 `PROJECT_NOT_FOUND` / `FORBIDDEN` / `STUDIO_NOT_FOUND` 记入失效，网络抖动与 5xx 不动它。每次开面板每个槽最多探一次（`localProbeRequested`），不随渲染重发。
- **展示**：并入既有「失效」折叠区（标题改为「失效（N）」），卡面标「失效 · 本机备份」，禁用进入；不提供删除 / 迁移入口。
- **保留**：本机 envelope 原样不动（id、名称、规划、时间戳），不写盘、不清槽。
- **未做**：迁移到 `house-*`、换绑、旧键退役；跨团队归属仍只看回读结果，不拿「当前团队清单里没有」推断。
- **验证**：前端 tsc 0；frontend 全量 842 文件 / 10722 条通过；`cloud-panel` 99 条、`project-identity` 21 条；build 0。新增用例：裸 uuid 槽探活失效后落失效区且本机记录不变、网络错误不误判、纯函数前缀判定。
