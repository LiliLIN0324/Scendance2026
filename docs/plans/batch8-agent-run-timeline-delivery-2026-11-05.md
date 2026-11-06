# 第 8 批前端接线交付：活动脸显示真实运行过程（第 8 批 · 第一段）

| 项 | 值 |
|---|---|
| 分支 | `feat/continue-20261105`（基于 `origin/main` d27cd7d） |
| 提交 | `ecd2110` 前端接线 · `936f160` 联调夹具 CORS 修复 · `3bcc021` 本地联调启动器 |
| 目标 | 活动脸（`door`）不再显示写死的 5 步假进度，而是显示**云端那一趟的真实步骤时间线 + 真实模型调用轮数 + 真实耗时**，并把这些真实数字接到审校台完成卡的「思考轮数」 |
| 边界 | 不碰 `onApplyCreative` 三道门；不新增必填 wire schema 字段；不引新依赖；不新增色系；不重写 3D 画布 / scene-script / Aholo / HY-3D 管线 |

---

## 1. 这一刀补的是哪个断口

第 7 批把「本次结果真的出现在审校台上」做通了，但**运行过程仍然是假的**：

- 活动脸（`agent === 'door'`）在 `agent-chat.tsx` 里被 `return null` 掉了，拿不到任何运行面板。
- 活动脸生成态渲染的是 `GenProgress`——`workbench-agent.ts:19` 的 `GEN_STEPS`，**写死的 5 步**，与云端实际发生了什么无关。
- 审校台完成卡的 `rounds`（思考轮数）没有真值来源。

于是策划师看到的是「正在整理方案 / 正在检查方案…」这种**永远会成功的假进度**，而真实的一趟可能是 2 轮模型调用就失败。这一刀让两者对上。

---

## 2. 改了什么

### 2.1 运行时账本（`panels/agent-chat-store.ts`）

账本从「一张脸的本地状态」升级成**带 scope 的运行时账本**：

| 新增 | 语义 |
|---|---|
| `startAgentRun(scope)` | 开一趟。`scope` 取 `'layout' \| 'space' \| 'material'`，**四张脸不串味** |
| `setAgentThoughtCount(n)` | **绝对值**写入思考轮数（不是自增，避免重放时重复累加） |
| `closeAgentStep(durationMs)` | 给当前步骤收尾耗时 |
| `AgentRunState.scope` | 记账属于哪张脸 |

`scope` 是必须的：Bingo / 空间 / 物料 / 活动脸共用一个账本，不隔离就会出现「活动脸在跑，Bingo 的面板显示活动脸的轮数」。

### 2.2 共享运行面板（新文件 `panels/agent-run-panel.tsx`）

把原来长在 `agent-chat.tsx` 里的内联面板抽成共享件 `AgentRunPanel({ scope, controls })`：

- 头部：**「正在思考 · N 条思考 · 已用时 mm:ss」** → 结束后变成**「这一趟走完了 · N 条思考 · N 步 · 用时」**。
- 步骤流：默认只露**最后 3 步**，其余折叠成「共 N 步，展开全部」——不让长任务把面板撑爆。
- 空结果回执卡：本轮既没给候选也没改动画布时，**出回执卡，不许沉默结束**。
- 运行条三控件（跑完这步停 / 停止 / 为下一步加备注）由 `controls` 控制是否挂载。

### 2.3 生产者：`panels/creative-studio.tsx` 的 `followRun()`

云端每一轮轮询都写一次账本：

```ts
startAgentRun('layout');
// 每次轮询：
//   云端 progress 变了 → 收掉上一条步骤的耗时，开一条新步骤
//   云端 callCount    → setAgentThoughtCount(result.callCount)
```

两个刻意的选择：

1. **步骤文案用云端自己写的原句**（`agent-runner.ts` 的 `progressLabels`，如「正在读取当前场景」「正在整理候选方案」），前端不重写措辞。
2. **这一趟在确认前不改画布，所以每一步都标只读**（`isReadonly: true`）——不装成写入步。

### 2.4 消费端

| 文件 | 改动 |
|---|---|
| `panels/agent-chat.tsx` | 内联面板换成 `<AgentRunPanel scope={agent}/>`，删掉本地 `useNowMs` 与面板状态 |
| `panels/agent-panel.tsx` | 活动脸生成态渲染 `<AgentRunPanel scope="layout" controls={false}/>`；`GenProgress` 加 `hidden` 参数——**真实时间线在场时让位**，不同时摆两套进度 |
| `room-organizer.tsx` | 完成卡的 `rounds` 取 `getAgentRun()` 的真实 `thoughtCount`（`scope === 'layout'` 且 `> 0` 才写） |
| `lib/generation-outcome.ts` | `rounds` 注释改为真值口径：云端 `AgentRun.call_count`（0–6 轮，`AGENT_CALL_LIMIT` 守着），拿不到就整行不渲染 |

### 2.5 活动脸**不挂**那三个控件（刻意的）

「跑完这步停 / 停止 / 为下一步加备注」目前**没有真后端通道**：`stopRequested` / `steerNotes` 无人消费，`clearAgentSteerNotes` 没有生产调用方。挂上去就是三个假控件。所以活动脸用 `controls={false}`，它的真取消在 studio 的「取消任务」。

（这条在谷地工坊实操里得到了反证——见第 5 节 N11：工坊运行中是把输入框**改道**成「为下一步添加备注」，真有通道。）

---

## 3. 怎么验的

### 3.1 单元与静态检查

| 检查 | 结果 |
|---|---|
| `npm run typecheck`（根，`tsc --noEmit`） | exit 0 |
| `npm run typecheck`（frontend） | exit 0 |
| `npm run build`（frontend） | exit 0 |
| 本刀相关 3 个测试文件 | **66 用例全通过**（`agent-run-panel.react.test.tsx` 11 条 + `agent-chat.react.test.tsx` + `agent-panel.react.test.tsx`） |
| 前端全量（固定环境 `NODE_OPTIONS=--no-experimental-webstorage`） | 见 3.2 |

> 固定环境的理由：本机 Node 26 默认开启实验性 Web Storage，会遮住 jsdom 的 `localStorage`，把成片的 jsdom 用例打成假失败。加 `--no-experimental-webstorage` 还原仓库目标 Node 24 的行为。

### 3.2 全量回归与基线逐条比对

基线取 `origin/main` 在同一固定环境下的结果：

| | 基线（origin/main） | 本刀改动后 | 提交后干净复跑（13:18） |
|---|---|---|---|
| 用例总数 | 4583 | 4606 | 4617 |
| 含失败用例的文件 | 13 | 13 | 13 |
| 失败用例 | 41 | 41 | 41 |

**排除本刀新增的测试文件后**，全量清单与基线**逐条一致**：13 个失败文件、41 个失败用例，没有新增失败文件，也没有新增失败用例。

提交后在无 dev server / 无夹具进程的干净机器上再跑一次（`after6`）：4617 例、41 失败，**失败用例名与基线逐条相同**（零新增、零消失）。这次是收工复核，取代上面那次满载跑。

### 3.3 一处必须说清楚的失败

含本刀新增测试文件的那次全量跑，多出 **1 个失败**：`frontend/components/room-organizer/lib/share.test.ts` 里那条
「cuts a deflate bomb off at the output budget, cheaply」的**墙钟预算断言**（要求 < 1000 ms，实测 1804 ms）。

判据链：

- 该文件**单独跑 25/25 全过**。
- **排除本刀新增的测试文件**后，全量回到与基线逐条一致（13/41）→ 与本刀的生产代码改动无关。
- 断言本身写的是墙钟预算，测试注释里也写着「generous for slow CI machines」；本轮跑测试时机器上同时开着 dev server、浏览器与夹具进程，CPU 被挤占后这条 1000 ms 的预算就会顶破。

结论：**这是既有测试的负载敏感点被新增文件挤占了并发资源而触发，不是本刀引入的回归。** 处置：本刀不改那条断言的阈值（那属于另一个文件的度量口径，不该由这一刀顺手放宽）；文档记录在案。

同类负载敏感点在收工后的干净复跑里又出现过一次，换成 `frontend/lib/project-review-library.test.ts` 的
「retains 20 older files and refuses automatic eviction when a new file exceeds the count limit」：
全量跑失败，单跑 50/50 全过（该例自己就吃掉 1.3 s）。两次都是「满载时顶破墙钟预算」，两次都不是改动引入。

### 3.4 浏览器端到端

- 联调环境：`npm run dev:agent` 起**真实 scene-api + 迁移过的 PGlite**（真 SQL 的 `agent_rpc`）+ **本地模型桩**；前端 `frontend/.env.local` 指向 `http://127.0.0.1:54329`。
- 模型桩只回放工具调用（先 `get_scene`，再 `submit_candidates`），**不做真实推理**；run 的状态、`call_count`、`progress`、`candidates` 全部由真实 `agent_rpc` 记录。
- **未完成的部分**：浏览器端的最终实拍（真实轮数/时间线/完成卡截图）需要一次人工登录——浏览器工具不允许代填登录表单。详见第 6 节。

---

## 4. 顺带修掉的一个真缺陷

`tests/local-server.ts`（仓库自带的本地联调夹具）**没有给浏览器回 CORS 头**：

- `/auth/v1/token` 的预检响应缺 `Access-Control-Allow-Private-Network`（Chrome 的私有网络预检）→ 浏览器直接拦成 `net::ERR_FAILED`，前端只能报「暂时无法连接登录服务」。
- `/functions/v1/scene-api/*` 分支**完全没有 CORS 头**，也没有 OPTIONS 处理 → 浏览器直连本机服务调业务接口一定被拦。
- Node 侧集成测试（`frontend/lib/backend-integration.test.ts`）不带 Origin，**测不到这条**，所以一直没暴露。

也就是说 `docs/33-前后端联调.md` 那条「把前端指到本地服务」的流程，在现代 Chrome 上是**断的**。已修（`936f160`）：预检、业务响应、500 兜底路径都补齐 CORS + 私有网络放行头。

配套还发现：仓库脚本靠 `node --experimental-transform-types` 跑 TS，而该 flag 在 **Node 26 已被移除**（本机 v26.2.0），仓库的 `.nvmrc` 目标仍是 24.15.0。为此新增 `scripts/run-ts.mjs`（用 esbuild——vitest 自带，不引新依赖——打包后交给 node 执行），`npm run dev:agent` 与之配套，任何 Node 版本都能跑。

---

## 5. 从谷地工坊实操里学到、并回喂本刀的

（详见 `docs/plans/petitmaker-playtest-2026-11-05.md` 第二节增补。）与本刀直接相关的三条：

1. **N9 监督档位**：工坊把「多久跟你确认一次」做成用户可见的三档旋钮（严格 / 关键节点 / 自动），并配一句人话解释。幕景的三道门是**固定流程**，没有这层偏好旋钮。→ 列入下一批候选（不动三道门，只加"打断频率"这一层）。
2. **N11 运行中输入框改道**：工坊运行中把输入框变成「为下一步添加备注」，是真通道。幕景第三张脸有同名按钮但**没有通道**。→ 印证本刀把活动脸那三个控件**摘掉**的决定：宁可没有，不要假的。
3. **N10 失败路径的可见预算**：工坊把「已尝试 N/5 次」和自动重试倒计时写进头部。幕景当前的失败提示是笼统的。→ 列入下一批候选。

---

## 6. 明确没做 / 未验

- **浏览器端到端实拍未完成**：活动脸真跑一轮的真实截图（真实轮数、真实步骤时间线、审校完成卡的「思考轮数」）还需要一次人工登录。联调环境与夹具都已就绪（`npm run dev:agent` + `frontend/.env.local`），登录后即可跑通；本刀**不把未拍的截图算作已验收**。
- **没有真实模型参与**：本轮模型端是本地桩（用户的 MiniMax 额度已用尽，谷地工坊那侧 5 次调用全部 429）。`call_count` / `progress` / `candidates` 的**形状与真值链路**是真的（真 SQL 记录），**模型内容**不是。
- 活动脸那三个运行条控件**仍未接线**（无后端通道），本刀只做了「不挂假控件」。
- 未验移动端；未验多脸并跑时的账本隔离在真实浏览器里的表现（单测覆盖了 scope 隔离）。
