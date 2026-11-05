# 第 7 批收尾交付：让「本次结果」真的出现在审校台上

| 项 | 值 |
|---|---|
| 分支 | `feat/continue-20261105`（基于 `origin/main` d27cd7d） |
| 提交 | `feat(bingo): 让本次结果真的出现在审校台上（第 7 批收尾）` |
| 路线图 | `docs/plans/smart-build-next-phase-2026-11-05.md`（第 7 批 / 第 10 章 Z8） |
| 日期 | 2026-11-05 |

---

## 1. 这一刀补的是什么洞

审计「智能建造第 6/7/7.5/8/9 批在 main 的真实落地状态」时发现的断口：

第 6/7 批的数理部分**其实真落地了**——命令门有 `applyLayoutCommandWithRefusals`、settle 有 `settlePlacement`、体检有 `computeBingoScore`，而且 `onApplyCreative` 落盘链四步都串上了：

```
provenance 打标 → applyLayoutCommandWithRefusals → settlePlacement → computeBingoScore → applyOutcome
```

但**算出来的东西策划师看不见**：

1. **体检分只进了 toast**。`computeBingoScore` 的结果只喂给 `notify(bingoScore.summary, …)`，弹一下就没了。
2. **审校卡没有数据源**。`BingoAuditCard` 声明了 `score / reasoning / suggestion / durationMs / rounds` 五个 props，但生产代码里**没有任何调用方传值**（`agent-panel.tsx:1972` 是 `{bingo && <BingoAuditCard/>}`，无 props）。于是「体检分区」永远不渲染。
3. **Outcome 没有承载报告的字段**。`GenerationOutcome` 只有 `placed / refused / skipped / scopeEmpty`，即使把体检分塞进 Outcome 也没地方放。
4. **真缺陷：Outcome 写了但卡不刷新**。`useGenerationOutcome` 用 `useMemo(…, [])` 读模块级变量 `pendingOutcome`——挂载之后再写入的 Outcome **不会**触发重渲染。症状是「数据明明写了，卡上就是没有」，且改前无解。

一句话：第 7 批的数理成果停在「算完」，没走到「用户看得见」。

---

## 2. 改了什么（9 个文件）

### 2.1 类型与纯函数层

| 文件 | 改动 |
|---|---|
| `frontend/lib/generation-outcome.ts` | 新增 `GenerationReport`（`score / reasoning / suggestion / durationMs / rounds`，**全部可选**）；`GenerationOutcome` 增加可选 `report?` 字段；新增 `hasOutcomeChanges()` 纯函数 |
| `frontend/lib/generation-report.ts`（新） | `buildReasoning` / `buildSuggestion` / `buildGenerationReport` 三个纯函数：把这一版的实测数字写成策划师看得懂的两句话 |
| `frontend/lib/generation-report.test.ts`（新） | 11 条断言（数字口径、分项优先级、无 rounds 不写） |
| `frontend/lib/generation-outcome.test.ts` | 补 3 条 `hasOutcomeChanges` 断言 |

### 2.2 数据通路层

| 文件 | 改动 |
|---|---|
| `frontend/components/room-organizer/room-organizer.tsx` | 落盘链末端把体检分、被拒/跳过件数、落盘耗时一起写进 `applyOutcome({ …, report })`；**只在真动了东西时才写账**（见 §4） |
| `frontend/components/room-organizer/lib/use-generation-outcome.ts` | `useMemo(…, [])` → `useState` + 订阅者集合，**写入即通知**（真缺陷修复） |
| `frontend/components/room-organizer/lib/use-generation-outcome.test.ts`（新） | 5 条断言，含「挂载后写入会刷新」的真缺陷用例 |

### 2.3 展示层

| 文件 | 改动 |
|---|---|
| `frontend/components/room-organizer/panels/bingo-audit-card.tsx` | props 优先、否则回落到 `outcome.report`；耗时行标题按来源区分「落盘耗时 / 耗时」；空值行不再无条件渲染占位符 |
| `frontend/components/room-organizer/panels/bingo-audit-card.react.test.tsx` | 新增 4 条用例（report 渲染 / 无 rounds 不渲染 / props 优先 / 挂载后写入刷新） |

**为什么不直接给 `<BingoAuditCard>` 传 props？** 因为生产挂载点是 `agent-panel.tsx:1972` 的无 props 写法，而落盘链在 `room-organizer.tsx`——两棵组件树。把 report 放进 Outcome，走已有的模块级账本通道，是唯一不需要改组件树的接法。

---

## 3. 口径纪律（红线逐条自查）

| 红线 | 本刀的落法 |
|---|---|
| 不绕 `onApplyCreative` 三道门 | 未改门：绿框预览 → 唯一确认 → 撤销一字未动，只是门后多带一份账 |
| 不新增必填 wire schema 字段 | `report` 只活在本地内存的 Outcome 上，**不进 wire**；`GenerationReport` 自身字段也全部 optional |
| 不引新依赖 | 零新依赖，纯 TS/React |
| 不新增色系 | 复用既有 breakdown 三色（`#4A7C59` / `#C9A96E` / `#C0392B`），没加任何新色值 |
| 技术 code 不进策划师视野 | 被拒件用既有 `violationCodeLabel()` 翻译成「出界 / 压墙 / 压主通道 / 家具重叠」，`BBOX_OVERLAP` 这类 code 只留在账本里 |
| 只写真数，不编 | 「思考轮数」服务端报不出真实轮数就**整行不渲染**，绝不拿「预览帧数」冒充 |
| 不重写 3D 画布 / scene-script / Aholo / 生成管线 | 一行未碰 |

**耗时字段的诚实边界**：`durationMs` 只覆盖「落盘 + 自动巡场 + 体检」这一段（`applyStartedAt` → 报告生成），不是整轮生成耗时——所以行标题写「落盘耗时」而不是「耗时」。

---

## 4. 顺带修掉的两个真缺陷

### 4.1 Outcome 写了但卡不刷新

`useGenerationOutcome` 此前：

```ts
return useMemo(() => ({ outcome: pendingOutcome, … }), []);   // ← 空依赖
```

挂载后再 `setGenerationOutcome(...)`，已挂载的卡片不会重渲染。这是「Outcome 写了但卡不刷新」的直接成因，**与本次接线无关也必须修**——不修的话新接的数据同样上不了卡。

改成 `useState` + 订阅者集合后，`setGenerationOutcome` / `__resetGenerationOutcome` 都会通知全部已挂载的 hook。用例 `use-generation-outcome.test.ts` 第 3 条与 `bingo-audit-card.react.test.tsx` 第 9 条分别从 hook 层和组件层钉死了这个行为。

### 4.2 「本次结果」会被没真改东西的操作冲掉

浏览器实拍时发现：编辑器一开场就弹「体检通过：5件全部可达主通道，0堵点」。查下来 `onApplyCreative` 不止 AI 生成一条入口——`room-organizer.tsx:2287` 的 **splat 预览按真实尺寸 resize 场地壳体**也走这一条。那条路一件家具都没变，若照写账，「本次结果」会变成「**放了 0 件**」，把上一次真的生成结果冲掉。

修法：把判断提成纯函数 `hasOutcomeChanges(outcome)`（只看 placed/refused/skipped 三个桶），**真动了东西才写账**。改完浏览器复验：开场不再出现「放了 0 件」，审校卡在没有任何生成结果时正确地不渲染。

---

## 5. 验收证据

### 5.1 类型检查

```
cd frontend && npm run typecheck
> tsc --noEmit
===EXIT=0===
```

（守卫改动前后各跑一次，均 exit 0。）

### 5.2 前端全量测试（含环境修正）

**先说环境**：本机 Node v26.2.0，而仓库 `.nvmrc` / `frontend/.nvmrc` 都写的是 `24.15.0`。Node 26 默认开启实验性 Web Storage，它的 `globalThis.localStorage` 会**遮住** jsdom 的 localStorage，于是所有 jsdom 用例炸在 `localStorage.clear()`——这就是冻结基线里 48 个文件 / 745 条失败的真实原因，**不是仓库的代码缺陷**。

用 `--no-experimental-webstorage`（等价于仓库目标 Node 24 的行为）重跑：

| | 冻结基线（Node 26 默认） | 固定环境基线（origin/main） | 本刀改动后 |
|---|---|---|---|
| 用例总数 | 4583 | 4583 | 4606（+23 本刀新增） |
| 通过 | 3838 | 4542 | 4565 |
| 失败 | 745 | 41 | 41 |
| 失败文件 | 48 | 13 | 13 |

**逐文件、逐用例比对结果：新增失败文件 0，新增失败用例 0。**

失败文件清单（改动后 = 固定环境基线，完全一致）：

```
frontend/lib/project-review.test.ts
frontend/components/business/assets-panel.react.test.tsx
frontend/components/room-organizer/three/scene-presets.test.ts
frontend/components/room-organizer/three/structure-satellite.test.ts
frontend/components/room-organizer/lib/nav-chrome.test.ts
frontend/components/room-organizer/lib/scene-delivery.test.ts
frontend/components/room-organizer/lib/structure-v2.test.ts
frontend/components/room-organizer/panels/lux3d-direct-test.react.test.tsx
frontend/components/room-organizer/panels/map-venue-overlay.react.test.tsx
frontend/components/room-organizer/panels/scendance-workspace.react.test.tsx
frontend/components/room-organizer/panels/space-panel.react.test.tsx
frontend/components/room-organizer/panels/venue-picker.react.test.tsx
frontend/components/room-organizer/panels/workbench-rail-head.react.test.tsx
```

（这 13 个文件的失败与本刀无关：jsdom 无 canvas 后端导致 `getContext()` 未实现，以及 texture/图片像素读取类断言。）

**本刀涉及用例全部通过**：

```
components/room-organizer/panels/bingo-audit-card.react.test.tsx   9 passed (9)
lib/generation-report.test.ts                                      11 passed (11)
lib/generation-outcome.test.ts                                     3 条新增 passed
components/room-organizer/lib/use-generation-outcome.test.ts        5 passed (5)
```

### 5.3 根后端测试

```
npx vitest run tests/    →  696 用例 / 1 失败（tests/config.test.ts 的 5s 超时，flaky）
```

与基线逐文件比对：新增失败文件 0。基线里另有 4 个失败文件（local-persistence / merged-library / library-assets / hunyuan-config）在本次复跑已通过。

### 5.4 构建

```
cd frontend && npm run build
✓ Generating static pages (14/14)
✓ Exporting (2/2)
===EXIT=0===
```

### 5.5 浏览器实拍（127.0.0.1:4310，dev server）

用一次性预览页把一份真实形态的 Outcome + report 喂给**生产组件本身**（`<BingoAuditCard/>`，无 props，走的就是生产挂载方式），肉眼确认完成卡 Z8 的排版与信息层级：

- 头部「甲方评审 / 待发」+ 盾牌图标
- 体检分区：**88 体检分**（88 < 95 走琥珀色 `#C9A96E`）+ 四项分项条（间距 90 / 通道 80 / 出界 100 绿 / 压墙 85）+ 中文摘要
- 「本次结果：放了 24 件、被拒 2 件」
- 完成卡 Z8：**改动件数 / 落盘耗时 1.2s / 为什么这么摆 / 后续建议**（思考轮数行按口径不出现）
- 被拒件（2）：`chair-07 压主通道`、`table-12 出界`——是人话，不是 code
- 页脚常驻「我会出错，也可能破坏你的设计。请在交付前亲自巡场一遍。」

预览页验完即删（`frontend/app/zz-audit-preview/` 已删除，工作树无残留）。

同时在真实 `/editor` 页复验：页面加载无 console error；点开 Bingo 面板后**审校卡不渲染**——正是 §4.2 守卫要的效果（场地 resize 那条路不再写出假账本）。

---

## 6. 明确没做的（别当成已完成）

1. **「思考轮数」没上**。服务端会话报不出真实轮数，按口径整行不渲染，不拿别的数字顶替。
2. **「落盘耗时」不是整轮生成耗时**。它只覆盖落盘 + 巡场 + 体检，行标题已写准。
3. **只有真改了东西的落盘才写 report**。手动拖放被拒（`placeCatalogItem` 的 refused 分支）仍走 `combineOutcomes`，不带 report——那条路径没有体检分可写，硬凑就是编。
4. **`GEN_STEPS` 仍是写死的 5 步假进度**（`workbench-agent.ts:19`），第 8 批的活。
5. **`addAnnotationFromPoints` / `appendAgentStep` / `clearAgentSteerNotes` / `SupervisionMode` 仍无生产调用方**，第 7.5/8 批的壳子还没接线。
6. **seed 仍未进 wire**（`agent-contract.ts` 无 seed 字段），第 9 批的活。
7. **命令门仍未收口**：move / remove / duplicate / rotate / resize / bulk 写路径绕过命令门；`window.confirm` 仍有 7 处残留；`placement-rules` 与 `canApplyLayoutGeometry` 两套判据并存。
8. **本机 Node 26 与仓库 .nvmrc（24.15.0）不一致**，导致 jsdom 用例大面积假失败。CI 用的是 24 就没事，但本地开发建议 `nvm use` 对齐，或临时加 `--no-experimental-webstorage`。

---

## 7. 下一刀建议（按审计排的优先级）

1. **第 8 批 · agent 自律回路**：`GEN_STEPS` 假进度换成真步骤时间线（Y3/Y4/Y5），把「agent 还活着」变成看得见的事实。这是当前性价比最高的一件。
2. **第 9 批 · 配方编号化**（X1）：`recipeHash` 取 4–5 位人话编号（「配方 90673」），让策划师能直接跟客户说编号。这一刀做完，U3「方案不可复现」才真正有解。
3. **命令门收口剩余写路径**：把 move/remove/duplicate/rotate/resize/bulk 全部改走 `executeSceneCommand`，顺带把 7 处 `window.confirm` 换成站内弹层（U2 的最后一块）。
4. **密度单旋钮**（U7）：density 有引擎没 UI。
5. **handoff 导出补 AI 占比**（U5）：provenance 已逐件打标，导出单还没汇总。

---

## 8. 复现命令

```powershell
# 类型检查
npm --prefix 'C:\幕景\Scendance2026\frontend' run typecheck

# 前端全量测试（Node 26 上需加 --no-experimental-webstorage，见 §5.2）
Set-Location 'C:\幕景\Scendance2026\frontend'
$env:NODE_OPTIONS='--no-experimental-webstorage'
npx vitest run --reporter=json --outputFile='C:\幕景\Scendance2026\.local-backup-20261105\after2-frontend-fixedenv.json'

# 根后端测试
npx vitest run tests/ --reporter=json --outputFile='C:\幕景\Scendance2026\.local-backup-20261105\after-root.json'

# 构建
npm --prefix 'C:\幕景\Scendance2026\frontend' run build
```
