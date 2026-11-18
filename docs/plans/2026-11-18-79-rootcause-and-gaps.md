# #79 根因与可执行缺口（2026-11-18）

- 目的：把「11 条验收用例 0 条三类全绿」拆到根因层——**能修的当场修，不能修的写清缺什么、谁去补、怎么补**。
- 范围：`状态卡为什么算不出绿`、`#3 改口为什么没被采纳`、`#6 四类阻塞为什么分不出来`。
- 边界：本页**不产生任何一条用例的通过结论**。浏览器与云端两类证据一条未增；`allGreen` 仍是 0。
- 关联：`docs/plans/2026-11-18-79-walkthrough-checklist.md`（真机走查清单）、`docs/plans/2026-11-16-outdoor-evidence-matrix.md`（三类证据对照表）。

---

## 一、根因 1：状态卡为什么算不出绿

### 1.1 判据只有一条

`frontend/components/room-organizer/lib/outdoor-release-status-card.ts`：

```ts
export function isAllGreen(row: CaseLedgerRow): boolean {
  return row.fixedData && row.browser === 'pass' && row.cloud === 'pass';
}
```

三类**同时** `pass` 才算全绿，`partial` 一律不算。三类各由谁供：

| 列 | 谁供 | 现状 | 为什么 |
| --- | --- | --- | --- |
| 固定数据 | `FIXED_DATA_CASES`（代码常量，1..11） | **11/11 有** | 每条都有具名测试文件（`outdoor-fixed-data-evidence.test.ts` 钉住文件存在） |
| 真实浏览器 | 走查记录本 → `browserEvidenceFrom()` | **0 条 pass** | 对照表快照里最高只到 `partial`；`pass` 只能由真机走查产生 |
| 真实云端 | `cloudPassIds`（面板上人显式声明） | **0 条 pass** | 默认空数组；代码里**没有任何一处**能自动产生云端 pass |

**结论：`allGreen = 0` 是输入缺，不是算法错。** 旧清单 §0 写的「`FIXED_DATA_CASES = [2,5]`、`ledgerFromEvidence` 恒写 `none`、所以 0 是常量算出来的」已经过期——main 早就支持注入（`ledgerFromEvidence(fixedDataIds, evidence, cloudPassIds)`），缺的是**数据**，不是能力。本页把这点纠正了。

### 1.2 顺带查出的真缺陷：卡片自相矛盾（已修）

真实链路是 `loadBook() → bookToRecord() → browserEvidenceFrom()`：

- `bookToRecord()` **永远返回一个对象**（空记录本也是 `{seen:{}}`）；
- 而 `browserEvidenceFrom()` 旧写法**只在 `record` 为 `undefined` 时**才回落到对照表快照 `BROWSER_EVIDENCE`。

结果：真实界面里 11 条全是「无证据」，可卡片的日期又回落到 `EVIDENCE_AS_OF = '2026-11-17 正式站走查第二轮'`——**日期是那一轮的，证据是空记录本的，跨了两轮**。对照表 §0 锚点里明明是 `partial: [1,3,4,6,7,8,9,10,11]`，真实界面却显示成一片 `none`。

**修法**：`browserEvidenceFrom()` 把「这一轮还没走查」（记录为空）与「这一轮走了但某条没证据」分开——

- 记录为空 → 整列回落到对照表快照（与 §0 锚点一致，日期与证据同属一轮）；
- 记录里有任何一条 → 整份按记录替换，没提到的号一律 `none`（**不放宽**「没标就是没看」）。

改后实测：空记录本下浏览器列 = **9 条 partial + 2 条 none**，`allGreen` 仍是 **0**（partial 不算过，云端列仍空）。卡片与对照表 §0 锚点重新对齐。

---

## 二、根因 2：#3「明确小改」为什么两轮都没被采纳

### 2.1 现象

正式站走查两轮：「主通道改走场地北侧仁和路、观众从北门进场」→ 请求确实发出、模型通道确实被调用，但**改口没被采纳**：路网依旧按等级与长度选湖滨路，入口候选仍只有延安路口。

### 2.2 真因：选路口径是纯几何的，原话根本没进选路

`frontend/components/room-organizer/lib/route-proposal.ts` → `buildRouteProposal()`：

1. 道路按 `routeClassForHighway(highway)` 分成人行/车行/后勤三类；
2. **类内按「落在范围内的折线总长」降序**排序，取前 N 条（车行 3 / 后勤 2 / 人行 3）；
3. **出入口候选只从「被选中的那几条路」与边界的交点派生**（`boundaryCrossings`，去重 10 m，每条路最多 2 个，全局上限 8）。

也就是说：**用户说的路名、方位，一点都没有参与选择**。模型听懂了与否都不影响结果——`仁和路` 只要不是同类别里最长的前几条，就永远进不了候选池；它与边界的交点也就永远不是入口候选。「按等级与长度选湖滨路」不是偶发，是口径本身。

调用点确认（两处都把选路当成纯几何任务）：

- `hooks/use-outdoor-agent-workflow.ts` → `turn.action === "main-routes"` 分支；
- `panels/agent-panel.tsx` → `proposeRoutePlan()`（本地「排一下流线」指令）。

### 2.3 已修：把这一轮的原话接进选路口径

`buildRouteProposal()` 新增可选入参 `request`（用户这一轮的原话），并新增纯函数 `roadIntentFromRequest()`：

- **点名要走**：原话里出现、且这一带路网里确有同名的路 → 同类里排最前；
- **明确不要**：原话里否定语境里的路（别沿 X 走 / 不要走 X / 避开 X）→ 不进候选；
- **否定只管到本小句**：「别沿湖滨路走，改走仁和路」不会把仁和路一起排除；
- **找不到就如实说**：原话点了路但路网里没有同名路 → 提案照旧给，卡上写明「你点名的路这一带路网里没找到，仍按道路等级挑了到场候选」；
- **要排除的路是这一带唯一一条** → 先留着候选并说明，不静默塞回去、也不让整轮空掉。

入口候选随之改由「被选中那条路」的交点派生——**选了仁和路，入口候选就是仁和路口，不再是湖滨路上的那个口**。卡片上的说明也会跟着改（「按你点名的「仁和路」排的到场候选。/ 按你说的没有用「湖滨路」。」），没改过就还是老口径那句「按道路等级挑」。

### 2.4 这一刀没覆盖的（登记为缺口，不假装做完）

| 缺口 | 现状 | 为什么这轮没做 |
| --- | --- | --- |
| **只说方位不说路名**（「走场地北侧那条路」） | 仍按等级与长度选 | 需要按边界方位给候选排序，是另一套口径；这轮只把「点名」接通 |
| **「改走」是新增不是替换** | 新提案把新流线**追加**到画布，旧流线还在 | 提案是「纯新增 + 整批撤销」语义，要改成替换得先定义替换对象，风险面大 |
| **入口候选仍只来自被选中的路** | 没被选中的路上的口不会出现 | 与旧口径一致；「北门」能出现是因为北侧那条路这次被选中了 |

---

## 三、根因 3：#6 四类阻塞为什么「没分别验」

### 3.1 后端早就分档了，前端丢了一档

- 后端失败状态枚举（`supabase/functions/_shared/assistant-chat-contract.ts`）：
  `disabled | invalid | unavailable | timeout | provider_error | quota_exhausted`；
- 户外理解链把这档原样透出（`outdoor-agent-understanding.ts`：`error.status = response.status`）；
- 前端按档出文案的地方只有一个：`frontend/lib/agent-error-view.ts` 的 `agentErrorView()`。

**真因：`agentErrorView()` 里没有 `timeout` 分支**——超时与 `provider_error`、未知状态共用同一个兜底档（「智能理解 / 服务商可能仍在处理或计费」）。于是四类阻塞里，**三类在界面上分得开，超时这一类分不开**；「分别验」连观察对象都没有。

### 3.2 已修：超时单列一档

`agentErrorView('timeout')` → 标签「响应超时」，文案「服务商这次没在时限内返回，本次未执行；请稍后重试，或把这一句拆短一点再试。」

修完后四类各自的落点：

| 类别 | 界面落点 | 可分辨 |
| --- | --- | --- |
| 未登录 | 登录卡（`pendingLogin`，输入框被禁） | ✅ |
| 功能关闭 | 标签「暂未启用」 | ✅ |
| 额度不足 | 标签「额度不足」 | ✅ |
| 网络超时 | 标签「响应超时」（本轮新增） | ✅（此前与服务商抖动同档） |

### 3.3 这一刀没覆盖的

| 缺口 | 现状 |
| --- | --- |
| **未登录会先于其它三类发生** | 登录判在前（`use-outdoor-agent-workflow.ts` 的前置检查），未登录时根本不请求模型，所以「未登录」只能在未登录态验，另外三类必须在登录态验 |
| **界面文案 ≠ 事件日志** | 界面这一档是前端本地标签，不是服务端分类码；「诊断编号与服务端日志对上」仍属 #10 的缺口 |
| **服务商抖动与超时的边界** | 后端 `timeout` 与 `provider_error` 的判定在上游超时/错误映射里，前端不再合并，但两者的根因区分要等服务端侧日志 |

---

## 四、不能修的：可执行缺口

### 4.1 环境前置（预检 0，四项任一不过 → 相关用例记 `blocked: 环境`，不产出 `pass`）

| # | 检查项 | 通过判据 | 现在为什么过不了 |
| --- | --- | --- | --- |
| 0.1 | 运行环境与抓包 | 页面可开、console 无启动期异常、能导出 HAR | 生产站 Edge 标签显示「内存使用量高 1.4 GB」、正文空；`:9222` 返回 404（非 DevTools 端点）；`:3210` 连接超时 |
| 0.2 | 登录态（非游客） | 刷新后仍登录；写操作不被登录门拦 | 需要一个可交互、可保持登录的浏览器 |
| 0.3 | 账号物料库 + 云保存 | 物料列表非空；云保存返回 revision 且刷新仍在 | 上一轮实测：账号物料库是空的、云保存未验 |
| 0.4 | 断网 + 导出落盘 | 断网不白屏；导出文件能打开 | 需要 DevTools offline 能力 |

### 4.2 逐条缺口与归属（本轮没动的部分）

| 用例 | 状态 | 缺什么 | 归属 |
| --- | --- | --- | --- |
| #1 | 已有 2026-11-17 第二轮证据 | 空白项目口径、真实物料库 | 重跑需登录态 + 非空物料库 |
| #2 | 未验 | 一对同名 POI 的真实搜索与点选 | 需真机 |
| **#3** | **代码已修，真机未验** | 改口生效的界面证据（提案卡上的路名与入口候选） | 本轮已修代码，**需真机复跑才可判过** |
| #4 | 部分 | 「再改预算或人数」那一半 | 需真机 |
| #5 | 未验 | 断网场景的降级文案与零写证据 | 需断网手段 |
| **#6** | **文案已修，四类未验** | 四类各自的触发条件与界面文案截图 | 本轮已修代码，**需真机逐类验** |
| #7 | 部分 | 「说等等」那一半 | 需真机 |
| #8 | 部分 | 8a 应用中刷新 / 8b 双点确认 / 8c 切项目 | 需真机 |
| #9 | 未验 | 撤销回读（入口有、没点过） | 需真机 |
| #10 | 部分 | 诊断编号与服务端日志关联 | 需云端日志权限 |
| #11 | 未通过 | CSV/PDF/效果图 + 旧云 Agent Run | 需真机 + 云端 |

### 4.3 门禁与签字

- **技术门禁**（`tsc` / 定向用例 / build）与**发布门禁**（11 条三类全绿）分开汇报，前者不替代后者。
- `allGreen` 从 0 变成 1，需要**同时**满足：固定数据有（已满足）+ 浏览器 `pass`（只能真机走查产生）+ 云端 `pass`（只能人显式声明）。
- 「门禁解除」只有人能写。

---

## 五、这次改了什么（代码）

| 文件 | 改动 |
| --- | --- |
| `frontend/components/room-organizer/lib/outdoor-release-status-card.ts` | `browserEvidenceFrom()`：空记录回落对照表快照；有记录仍整份替换 |
| `frontend/components/room-organizer/lib/route-proposal.ts` | 新增 `roadIntentFromRequest()` / `routeIntentNote()`；`buildRouteProposal()` 支持 `request`，按原话优先与排除选路，并回报 `intent` |
| `frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.ts` | `main-routes` 分支把原话传进 `buildRouteProposal()`，卡片说明按实际改动写 |
| `frontend/lib/agent-error-view.ts` | 新增 `timeout` 档（响应超时） |

**没有改**：数据库迁移、Edge Functions 契约、根依赖、CI/治理配置；没有伪造任何 `pass`；没有动 `#3` 的方位口径与「改走=替换」语义。

---

## 六、复跑命令

```bash
# 前端定向用例（Node 24；frontend/vitest.config.ts 的 execArgv 按进程 cwd 解析，必须在 frontend 目录里起）
cd frontend
npx vitest run components/room-organizer/lib/outdoor-browser-evidence.test.ts \
  components/room-organizer/lib/route-proposal.test.ts \
  lib/agent-error-view.test.ts
# 期望：三文件全过；空记录回落那两条断言钉住「9 partial + 2 none、allGreen 0」

# 户外整套件（本轮 78 文件）
# 见 §0 预检：真实浏览器与云端两类证据一条未增
```
