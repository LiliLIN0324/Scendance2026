# 场地自主规划 · 本轮基线与验收记录

日期：2026-11-20。角色：集成与验收（协调入口）。配套计划：[2026-11-20-venue-agent-interaction-design-plan.md](2026-11-20-venue-agent-interaction-design-plan.md)。

状态：**基线已建立；真实页面验收已于 2026-11-20 16:2x 补做**（浏览器通道本轮恢复，见 §十）。此前三轮「通道不可用」的阻塞已解除。凡未实际观察到的项目，一律标「未验收」，不以测试通过代替。

> 2026-11-20 16:2x 复核（HEAD `74f0a7b9` + 本轮改动）：**浏览器自动化通道恢复可用**。工作台在 `http://localhost:3000/?local=1` 正常渲染，画布、地图底图、Agent 面板、结果卡、A/B 比较、采用与撤销全部跑通，并由此发现两处真实缺陷（A/B 比较拿的是同一份布局、撤销后仍挂「可撤销」），已修并补测试。完整记录见 §十、§十一；仍未验收项见 §十.7。

> 2026-11-20 第二次复核（HEAD `f2ff2980`）：规划套件已转绿、前端类型检查 0 错；浏览器通道仍然不可用，P0 四步复现**未执行**。详见 §一.2、§二.4、§五.5。
>
> 2026-11-20 12:05 更新：用户在客户端内置浏览器里打开了真实页面，**P0 的第一个失败点已确定**——工作台在渲染阶段即崩溃（`handleStagePointerCancel is not defined`），根本到不了「起稿」。归属：交互（画布）。详见 §二.5。
> 2026-11-20 13:50 复核更新（HEAD `fd6820c3`，工作区含他窗未提交改动）：**12:05 那个崩溃已修**（`66292f66`，定义见 `outdoor-plan-canvas.tsx:10984`，`tsc` 不再报 TS2304）。重启 dev 后 `GET /` 200、编译 17.2s、页面标题「幕景 Scendance · 活动布置工作台」。但 `screenshot` 仍超时（os error 10060），**P0 四步依旧未执行**，画面证据仍缺。§二.5、§四、§七、§八 已按此更正。

---

## 一、版本与提交

| 时点 | 事实 |
| --- | --- |
| 本轮开始 | `HEAD = f9b72f77`（docs：制定本轮计划），`git status` 有 17 项已跟踪改动 + 若干未跟踪文件 |
| 本轮进行中 | 另一对话在同一 `main` 工作区连续提交 4 次：`f52adc3a` 3D 命中桥/选中反馈/草稿反馈（B5/B8/B9/K4/K12/K13）、`a5165b9f` 关页补存与本机写入失败口径（B1/B2）、`9dcacfee` 会话 revision 与同源写租约（B6/F9）、`3182ed62` 引导退役后的用例对齐 |
| 记录时 | `HEAD = 3182ed62`（2026-11-20 10:33:31 +0800），工作区仍有大量未提交改动 |
| 第二次复核 | 期间又落 4 次提交：`aeaf8668` 定位存在性/尺寸草稿（B7/F6/F7）、`14a8a936` 属性卡复制删除（K9/F2）、`f0158cd0` 婚礼分区按真实可布置域（规划）、`f2ff2980` Ctrl+Y 重做与画布外取消拖动（F10/K6）。复核时 `HEAD = f2ff2980` |

**并发事实（必须遵守）**：本轮全程存在他人未提交改动，且工作区文件在我读取期间被改写（例如 `outdoor-plan-3d.tsx` 在开始时是 `M`，随后被提交而退出改动列表；`wedding-layout.ts` 在我首轮 `git status` 时未出现，几分钟后出现 `+1079/−251`）。因此下文所有测试与类型检查结果都是**某一瞬时快照**，不是稳定基线，也不代表他人最终版本。

未提交在途（按负责人归纳，均为他人成果，本对话未改动）：

| 归属判断 | 文件 |
| --- | --- |
| 交互负责人（新模块，未跟踪） | `components/outdoor-design-result-card.tsx` / `.css`、`lib/outdoor-plan-change.ts`、`lib/outdoor-local-adjust.ts`、`lib/outdoor-design-summary.ts`、`components/plan-inline-text-input.tsx` 及各自 `*.test.ts(x)` |
| 交互负责人（已跟踪改动） | `components/outdoor-plan-canvas.tsx`（+86/−22）、`hooks/use-outdoor-agent-workflow.ts`（+4） |
| 规划负责人 | `lib/wedding-layout.ts`（+1079/−251）、`lib/wedding-layout.test.ts`（+149/−1）、`lib/wedding-spatial.ts`（+275/−23）、`lib/wedding-request.ts`（+1/−1） |
| Qoder 引导批（已在《协作区变更登记》登记） | `onboarding/*`（新）、`lib/site-plan-guide.ts` / `.test.ts`、`app/globals.css`、`room-organizer.tsx`、`tsconfig.json`、`COLLAB.md`（已并入 `AGENTS.md`）；删除 `components/outdoor-plan-interactions.tsx`、`hooks/use-f3-coach-bubble.ts`、`panels/f3-coach-bubble.tsx` |
| 与本轮无关的未跟踪物 | `.tmp-audit/`（本次审计笔记）、`deliverables/*.mp4`、`snap-*.yml` |

---

## 二、真实页面复现：阻塞（P0 第 2 条未完成）

做法与结果：

1. 本机工作台已拉起：`npm --prefix frontend run dev` → `✓ Ready in 3.4s`，`GET /?local=1 200`（`.tmp-audit/logs/dev.log`），端口 3000 监听正常。
2. 浏览器自动化通过 agent-browser MCP 调用，**全部失败**：
   - `agent_browser_open`（内置浏览器）：`内置浏览器未就绪，请打开当前任务后重试。`
   - `agent_browser_open`（Chrome，独立自动化窗口）：超时，原文「工具等待超时，结果待确认」。
   - 之后 `snapshot` × 2、`screenshot` × 2 均同样超时（其中一次因工具绑定过期返回 `not found`，重新发现后再次超时）。
3. 进程侧可见 `chrome.exe` 与 `chrome-headless-shell.exe` 已启动、dev.log 里有多次 `GET /?local=1 200`，说明页面请求发生过，但 MCP 侧拿不到任何返回值；未取得截图、快照或页面 DOM。

**结论**：无法证明「当前场地生成 → 点选 → 局部修改 → 撤销」在真实页面上的首个失败点。按要求不编造验收结果，也不以夹具或审计笔记替代当前场地。后续任何人重启客户端/浏览器后，应先用一次 `screenshot` 确认通道可用，再补做 P0。

4. **第二次自检（同日 11:40 前后，用户告知通道已恢复）**：`screenshot` → 超时；`open`（内置浏览器，`localhost:3000/?local=1`）→ 超时；`close(all)` → 也超时。连关闭会话都拿不到返回值，说明问题在 agent-browser 的 MCP 守护进程/会话层，而不是页面加载或渲染。P0 四步仍未执行，本轮不再重放同一调用。

**通道恢复后的自查顺序**（供下一轮直接照做）：① `screenshot` 确认有画面返回；② `open` 到 `/?local=1`；③ `snapshot` 取 `户外规划` 入口；④ 按 §七 第一行起稿。若 `close` 仍超时，先重启客户端再试，不要在超时状态里继续点页面。

5. **第三次自检（客户端重启后，同日 12:0x）**：重启后开发服务器被一并关掉，已重新拉起（`Ready in 32.3s`，端口 3000 监听）。随后：
   - `screenshot`（内置浏览器）→ **快速返回** `内置浏览器未就绪，请打开当前任务后重试。`（这一次不是超时，说明 MCP 侧可达，缺的是当前任务的内置浏览器面板）；
   - `open`（Chrome，独立窗口，`/?local=1`）→ 超时；同时 `dev2.log` **没有任何 GET 请求**，说明卡在浏览器启动而非页面加载；
   - 对 Chrome 会话补一次 `screenshot` → 仍超时。
   **结论**：可用通道只剩「用户在当前任务里打开内置浏览器面板」这一条；Chrome 自动化窗口在本机启动即挂。开发服务器已就绪，面板一打开即可按上面四步自查补 P0。

### 2.5 P0 首个失败点（真实页面，2026-11-20 12:05）

用户在内置浏览器里打开 `http://localhost:3000/?local=1`，页面没有出现工作台，而是 Next.js 运行时错误浮层：

```
Runtime ReferenceError
handleStagePointerCancel is not defined
components\room-organizer\components\outdoor-plan-canvas.tsx (12980:24) @ OutdoorPlanCanvas
12978 |      onPointerUp={handleStagePointerUp}
12979 |      onPointerLeave={handleStagePointerLeave}
> 12980 |      onPointerCancel={handleStagePointerCancel}
Call Stack: OutdoorPlanCanvas → OutdoorPlanOverlay (outdoor-plan-overlay.tsx 1162:11)
            → RoomOrganizer (room-organizer.tsx 5314:13) → WorkspaceShell (workspace-shell.tsx 179:9)
```

代码核对（只读）：

```
Select-String -Path …\outdoor-plan-canvas.tsx -Pattern "handleStagePointerCancel"
12980:  onPointerCancel={handleStagePointerCancel}
13048:  onPointerCancel={handleStagePointerCancel}      # 共 2 处，均为使用，无定义
对比：handleStagePointerDown/Move/Up/Leave 各 3 处（1 定义 + 2 使用）
git log -S"handleStagePointerCancel" -- <file>        # 无输出：不在任何提交里，属工作区未提交改动
文件 mtime：2026-11-20 12:06:30；dev2.log：编译成功（GET /?local=1 200）
```

**定性**：这是「鼠标事件 → 指针事件」重构（审计 K6/K11：指针捕获与 `pointercancel`）的**在途未完成态**——两个舞台都接上了 `onPointerCancel`，但处理函数尚未落盘。它不是页面太重、也不是浏览器问题。

| 项 | 内容 |
| --- | --- |
| 首个失败点 | 工作台渲染期 `ReferenceError`，画布不出现，整个页面停在错误浮层 |
| 归属 | **交互负责人**（`outdoor-plan-canvas.tsx` 画布交互适配；改动在 `2aadfbad` 之后的未提交工作区） |
| 最小复现 | ① `npm --prefix frontend run dev`；② 打开 `http://localhost:3000/?local=1`；③ 不等任何操作，页面直接弹上述浮层；④ DevTools Console 同样是 `handleStagePointerCancel is not defined` |
| 预期 | 工作台正常渲染，出现左轨与画布；错误浮层不出现 |
| 证据 | 用户提供的内置浏览器截图（12:05）；上文代码核对与提交检索 |
| 阻断范围 | P0 四步（起稿/点选/局部修改/撤销）全部无法开始；同样阻断 A/B 比较、锁定件、保存刷新与分享的页面验收 |
| 为何没被拦住 | `next dev`/`next build` 都不做类型检查，未定义标识符是合法 JS；只有 `npm --prefix frontend run typecheck` 会报 TS2304。我在 `f2ff2980` 跑 tsc 时该行尚未写入，故当时 0 错 |

**建议**：由交互负责人在其重构里补齐 `handleStagePointerCancel`（并确认 `cancelStageDragSessions` 的调用语义），提交后我重跑 `typecheck` + 页面 P0。本对话**不代改**该文件：它正在被编辑（mtime 12:06），并发改动会产生冲突。若需要我接手，请明确交接并等对方保存完成。

**13:50 复核：失败点已消除，但只到「能编译/能出 HTML」这一层。**

```
Select-String -Path …\outdoor-plan-canvas.tsx -Pattern "handleStagePointerCancel"
10984: function handleStagePointerCancel() {      # 新增定义
13079: onPointerCancel={handleStagePointerCancel} # 使用
npx tsc --noEmit                                # 无 TS2304
netstat :3000 LISTENING → 17872                 # dev 重启（PID 30492 → npm → next）
GET / 200 in 17826ms（Compiling / … 3159 modules）; 后续 GET / 200 in 47ms
agent_browser_open http://localhost:3000/ → title=幕景 Scendance · 活动布置工作台
auth? screenshot → Failed to read: os error 10060（连接方超时）
```

即：`ReferenceError` 不再出现，SSR/编译层面工作台可加载；但**「画布真的画出来了吗」没有截图证据**，`screenshot` 在 60s/120s 两档都超时。因此 P0 四步仍是未执行，而不是通过。

**替代证据（明确降级，不能算页面验收）**：仓库内 `.tmp-audit/3d-parity.md`、`panel-canvas-sync.md`、`persistence-undo.md` 是同日只读代码审计笔记，给出具体行号。本次只把它们当待核假设；已用当前代码核对的两条见下节。

---

## 三、问题分层（代码级，可复查；页面未验证）

### 3.1 交互问题

| 编号 | 事实 | 证据 | 状态 |
| --- | --- | --- | --- |
| I-1 | 3D 此前只有 zone/facility 两种选中，动线/节点/人员/车辆/标注选中在 3D 无反馈却可被 Delete | 现 `outdoor-plan-canvas.tsx` 的 `PlanEditVisuals` 已新增 `selectedRouteId/selectedNodeId/selectedWorkerId/selectedVehicleId/selectedAnnotationId/selectedMeasurementId`、`multiSelectedFacilityIds`、`marquee`，注释直指「3D 里框选不再盲选」 | 代码已补（`f52adc3a`），页面未验证 |
| I-2 | 3D 面板/清单选中不同步到 3D 手柄（会拖动上一次选中的物件） | 审计笔记指 `selectFacility` 只写 ref、不 `notifyPlanDraftChanged`。本次未在 `selectFacility` 定义处命中该模式，未能确认是否已修 | 未定论，需交互负责人自查 |
| I-3 | 结果卡动作契约与组件不匹配，当前无法通过类型检查 | `outdoor-workflow-card.tsx(277,58)`：传入的 `locateZone/locateSelection/…/adoptCandidate` 与 `DesignResultCardActions` 无公共属性 | **当前阻断**（未跟踪新模块） |
| I-4 | workflow 状态字面量越界与空值未收窄 | `use-outdoor-agent-workflow.ts(1186,115)` `'p' is possibly 'null'`；`(3264,31)`、`(3797,51)` 传 `"info"` 不在状态联合内 | **当前阻断** |

### 3.2 规划数据问题

| 编号 | 事实 | 证据 |
| --- | --- | --- |
| P-1 | ~~规划纯函数测试当前 3 红~~ **已消除**：`f0158cd0` 落地后在 `f2ff2980` 复跑 14/14 全绿 | 复跑输出见 §五.5；原 3 红为在途过渡态（`+1079/−251` 改写期间的中间版本） |
| P-2 | ~~`wedding-layout.ts(316,10)` 未使用符号~~ **已消除**：`tsc` 现 0 错 | 见 §五.5 |

**重要限定**：P-1/P-2 的定论已随规划负责人提交而更新（见 §五.5）；此前那 3 红与 1 条未使用符号确认为**在途过渡态**，不是本轮交付缺陷。今后同类判断仍须等文件提交后复跑，不能凭改写中的工作区下结论。

### 3.3 渲染问题

- 未取得页面，无法判断 2D 渲染/3D 渲染。已知代码层线索：`three/outdoor.ts` 与 `three/builders/builders-outdoor.ts` 不在户外规划 3D 链路上（属室内编辑器），不能用来解释户外渲染现象（审计笔记已核实，本次未复核）。
- 3D 桥的 px↔米换算、拖动期整层重建的帧耗时，均为审计笔记的「待确认」项，无 trace 证据。

---

## 四、2D / 3D 现有能力与真实页面未覆盖项

代码阅读结论（不是页面验证）：

| 能力 | 2D | 3D |
| --- | --- | --- |
| 选中 / 拖动 / 旋转 / 改尺寸 / 删除 / 复制 | 有（唯一编辑实现） | 经指针桥转发到同一实现 |
| 撤销 / 重做 | 有，栈在内存、上限 30 | 同左（3D 不写 plan，松手才提交） |
| 分区 / 动线 / 出入口 / 人员 / 标注 | 有 | 选中反馈刚补齐（`f52adc3a`）；右键菜单与 Alt 分叉是否已桥接未核实 |
| 框选 / 组选 | 有 | `marquee` 已并入 `PlanEditVisuals`，组包围盒由 3D 绘制 |
| 放置（点击或物料拖入） | 有 | 有 |
| 无用地红线时画草稿 | 不受影响 | 审计称草稿与幽灵不画且无提示；未复核 |

**表内已过期的一条（13:50 复核）**：`f52adc3a` 之后 3D 侧已补选中反馈——`PlanEditVisuals` 增加 `selectedRouteId/selectedNodeId/selectedWorkerId/selectedVehicleId/selectedAnnotationId/selectedMeasurementId`（全文件 40 处引用），`marquee` 已并入同一结构并由 3D 绘制（3 处消费）。故「选中反馈刚补齐…未核实」只剩「右键菜单与 Alt 分叉」成立。仍属代码级，未页面验证。

**真实页面未覆盖项（本轮全部未覆盖，因浏览器阻塞）**：结果摘要与画布双向定位、局部修改的作用范围提示、同视角 A/B 比较与恢复、保存刷新与分享一致性、2D/3D 位置朝向一致性、生成中并发修改与停止/失败。

---

## 五、检查输出（原始）

### 5.1 聚焦 Vitest（已提交模块，45 例全绿）

```
npx vitest run lib/outdoor-plan-session.test.ts lib/outdoor-write-guard.test.ts \
  lib/save-status.test.ts lib/outdoor-plan-protection.test.ts
✓ save-status.test.ts (14 tests)
✓ outdoor-write-guard.test.ts (6 tests)
✓ outdoor-plan-session.test.ts (14 tests)
✓ outdoor-plan-protection.test.ts (11 tests)
Test Files 4 passed (4) | Tests 45 passed (45) | Duration 47.11s
```

### 5.2 同批第二轮（含覆盖层与规划）

```
npx vitest run lib/wedding-layout.test.ts outdoor-plan-save-lifecycle.react.test.tsx \
  outdoor-plan-overlay.merge.react.test.tsx ...
Test Files 1 failed | 4 passed (5) | Tests 3 failed | 56 passed (59)
Error: [vitest-pool]: Failed to start forks worker for …
  components/outdoor-plan-save-lifecycle.react.test.tsx
```

- 3 红全部在 `wedding-layout.test.ts`（P-1），失败断言：`92:55 expected true to be false`、`122:27 expected 0 to be greater than 0`、`163:27 expected 46 to be 60`。
- `save-lifecycle` 是**运行器未启动**（worker 超时），不是用例失败；需单独复跑，本轮未取得结果。
- 该轮全量耗时 193.5s，环境本身偏慢；并行会话同时跑测试会加剧。

### 5.3 前端类型检查

```
npx tsc --noEmit → 24 errors，TSC_EXIT=2
```

按归属：交互在途 20 条（`outdoor-workflow-card.tsx` 1、`use-outdoor-agent-workflow.ts` 3、`outdoor-plan-canvas.tsx` 2 未使用导入、三个新测试文件 14 条夹具缺 `notes`/`semantic`），规划在途 1 条（`wedding-layout.ts:316` 未使用符号），其余 3 条为同一批新测试的重复计数。**没有一条来自已提交代码**；但这也意味着当前工作区不能作为可交付基线，任何人现在跑 `typecheck` 都会红。

### 5.4 未运行（首轮）

`npm run lint`、`npm run build`、全量 Vitest：当前工作区不绿且他人正在改写，全量结果无解释力，按要求避免无变化重复全量。

### 5.5 第二次复核（HEAD `f2ff2980`）

```
npx vitest run components/room-organizer/lib/wedding-layout.test.ts --maxWorkers=1
✓ wedding-layout.test.ts (14 tests) 2220ms
Test Files 1 passed (1) | Tests 14 passed (14)

npx tsc --noEmit  （NODE_OPTIONS=--max-old-space-size=4096）
无输出 | TSC_EXIT=0

npx vitest run components/room-organizer/components/outdoor-plan-save-lifecycle.react.test.tsx --maxWorkers=1
✓ outdoor-plan-save-lifecycle.react.test.tsx (9 tests) 5930ms
Test Files 1 passed (1) | Tests 9 passed (9)
（含 F9 干净打开不写盘、pagehide 本机写入同步完成、配额满可见提示、回执不盖更新版、租约被占时拒写）
```

同一时点第一次尝试直接崩掉，原始输出：`vitest: [vitest-pool] Worker exited unexpectedly`（1.93s，no tests）、`tsc` 退出 134 并打印 V8 原生栈。当时空闲内存 `3177 MB / 16193 MB`，判断为并行会话 + dev server 造成的瞬时内存压力，不是代码缺陷；降至单 worker 后即通过。复跑时应保留 `--maxWorkers=1`，避免再次误判为用例失败。

---

## 六、文件所有权与在途版本确认

| 范围 | 负责人 | 本轮状态 | 本对话动作 |
| --- | --- | --- | --- |
| 结果展示：`outdoor-design-result-card.tsx/.css`、`outdoor-design-summary.ts`、`outdoor-plan-change.ts` | 交互负责人 | 未跟踪，`tsc` 未过 | 只读，不编辑 |
| 画布交互适配：`outdoor-plan-canvas.tsx`、`outdoor-plan-3d.tsx` | 交互负责人 | canvas 有在途改动；3d 已提交 `f52adc3a` | 只读，不编辑 |
| `use-outdoor-agent-workflow.ts` 集成 | 交互负责人 | 有在途改动，`tsc` 3 条错 | 只读，不编辑 |
| 布局纯函数与算法测试：`wedding-layout.ts`、`wedding-spatial.ts`、`wedding-request.ts`、`wedding-layout.test.ts` | 规划负责人 | 大改在途（+1079 等） | 只读；**未运行中的结论不作缺陷定论** |
| 新手引导批（`onboarding/*` 等） | Qoder（已登记独占区变更） | 未提交，等复核 | 只读 |
| 基线、验收记录、跨模块回归、收口 | 本对话 | 本文件 | 仅新增本文件与计划状态行 |

**待确认（需两位负责人各回一句）**：

1. 交互负责人：`outdoor-design-result-card.tsx` 的 `DesignResultCardActions` 是否为最终契约？若否，先落契约再改调用方，避免两边互改。
2. 交互负责人：`selectFacility` 等五个 `select*` 是否已改为通知 3D（I-2）？若已改，请给出提交号，我从审计笔记里撤下这条。
3. 规划负责人：`wedding-layout.ts` 在途版本预计何时可提交？提交后我重跑该套件，再判定 P-1 是缺陷还是过渡态。
4. 双方：`components/outdoor-plan-interactions.tsx` 被整文件删除（−178 行），请确认这是引导退役的有意删除、不是误删。

---

## 七、验收脚本逐项状态

| 场景 | 状态 | 依据 |
| --- | --- | --- |
| 当前场地起稿与实际容量 | **未验收（阻塞原因已变更）** | 原失败点（渲染崩溃）已由 `66292f66` 修复，12:05 的 `ReferenceError` 不再适用；现阻塞在取证层：`GET /` 200、标题正常，但 `screenshot` 超时（os error 10060），拿不到工作台画面，四步未执行；规划单测只证明算法夹具 |
| 点选对象后聊天局部调整 | 未验收 | 需页面 |
| 已确认景观方向和背景调整 | 未验收 | 需页面；规划套件中景观方向用例已转绿，但仍属夹具 |
| 锁定件保留 | 未验收 | 需页面；`outdoor-plan-protection` 11 例绿只覆盖锚点/红线安全阀 |
| 不规则场地、建筑阻挡、容量不足 | 未验收 | 规划套件含凹形/建筑/狭小用例，现 14/14 绿（夹具）；真实凹形场地未跑 |
| 同视角 A/B 比较及恢复 | 未验收 | 需页面；比较动作当前 `tsc` 不通过 |
| 生成中手动修改、停止、失败与旧候选应用 | 未验收 | 需页面 |
| 保存刷新、2D/3D 与分享一致性 | 部分（单测，13:50 在当前工作区复跑） | 两批共 **120 例绿**：`vitest run … --maxWorkers=1` → 11 文件 **69 passed**（session、write-guard、save-lifecycle、protection、pointer-capture、scene-objects、measure-session、card-actions、placement-bar、boundary-lock、overlay.merge）+ 4 文件 **51 passed**（facility-footprint-lock、wedding-layout、plan-facility-drag、plan-facility-overlap）；刷新与分享仍需页面 |
| 设计效果（主次、朝向、组团、留白、动线） | 无法评价 | 无截图，拒绝以文字代替画面 |

---

## 八、存量问题与剩余工作

1. **页面可用性未定（12:05 的崩溃已修）**：`66292f66` 补齐了 `handleStagePointerCancel`，dev 重启后 `GET /` 200、标题正常；但 `screenshot` 仍超时，「画布是否渲染」无画面证据，P0 四步仍未执行。当前工作区还有他窗未提交改动（含 `outdoor-plan-canvas.tsx`、`outdoor-plan-overlay.tsx`，并删除 `outdoor-plan-interactions.tsx`、`f3-coach-bubble` 等），故本轮单测与 tsc 的结果都是「含在途改动」状态，不等于任何提交的验收。
2. **类型检查当前 5 错，全部落在发布窗在途文件**（13:50 复核，`npx tsc --noEmit`）：`room-organizer-publish.react.test.tsx`×2、`panels/share-menu.tsx`×2、`lib/publish-flow.test.ts`×1。上轮报的 `handleStagePointerCancel` TS2304 已消失；他人在途文件我不作判断，仅记录归属线索（未提交 + 文件名均属发布流程）。规划/持久化套件在当前工作区全绿（§七）。
3. **并发写同一工作区**：本轮已出现文件在我读取期间被改写。建议两位负责人各自收口提交后再进入集成，避免我基于漂移快照下结论。
4. **未验证的审计结论**：右键/Alt 桥接、无红线草稿提示、3D 换算精度、拖动重建帧耗时，全部仍为待证项。
5. 未做且按约束不得做：改契约、迁移、依赖、CI；部署；推送；`git add -A`。

---

## 九、本轮实际改动

仅本文件与计划文档的状态行。未修改任何产品代码、测试、契约或配置；未暂存他人改动。

---

## 十、真实页面复现（2026-11-20 16:2x，浏览器通道恢复）

> 此前三轮「浏览器自动化通道不可用」的阻塞在本轮解除。以下全部是**真实页面观察**，不是夹具、不是审计笔记推断。

### 10.0 环境与版本

| 项 | 事实 |
| --- | --- |
| URL | <code>http://localhost:3000/?local=1</code>（本机模式） |
| 服务 | 本机 dev server，端口 3000（PID 14772，13:52 起），<code>GET /</code> → 200 / 18,683 B / 标题「幕景 Scendance · 活动布置工作台」 |
| 代码版本 | <code>HEAD = 74f0a7b9</code> + 本轮未提交改动（见 §十一） |
| 当前活动 | 「周末共创工作坊」（本机，1 个） |
| 浏览器 | 客户端内置浏览器（Electron FilePanel），通道可用 |

### 10.1 工作台渲染：此前的渲染崩溃已不存在

页面完整渲染出：左轨（总控 / 空间 / 物料 / 3D创作 / **户外规划** / 消息）、Agent 面板（会话、活动切换、聊天输入、执行权限、模型选择）、地图画布（高德街道底图，实际出图到杭州西湖孤山一带）、右上工具簇（罗盘、2D/3D 切换、缩放、图层、工具）、底部状态条。交互元素数从 108 增至 214（打开户外规划后）。引导浮层用「关闭引导」关掉，不影响验收。

**Console 只有两条错误，都与本计划无关**：

1. <code>[glb-load] Error: 模型下载失败（HTTP 404）</code>（<code>three/glb-assets.ts:228</code>）——对应左下角「1 Issue」角标，属素材库缺件；
2. <code>[glb-load] AbortError: BodyStreamBuffer was aborted</code>——同一资源的下载被取消。

本计划链路（Agent → 规划 → 结果卡 → 比较 → 采用 → 撤销）**没有产生任何 JS 错误**。

### 10.2 3D 本轮仍未验收（环境限制，不计通过）

画布区常驻一条红底提示：「WebGL is not supported in your environment. Please enable hardware acceleration or use a different browser.」本机内置浏览器未开硬件加速，3D 层没有渲染出来。

因此 **P3 的 3D 侧（2D/3D 位置、朝向、数量对应；3D 定位取景）本轮仍标「未验收」**，不能因为 2D 跑通就算过。

### 10.3 首个失败点：入口问题（前置条件），不是渲染、也不是规划

1. 打开「户外规划」：左栏显示「用地红线 0 · 还没画红线——物件库 → 区域 → 用地红线」，画布上只有底图。
2. 发送「这里做 60 人婚礼，先出一版」，Agent 回：

   > **这一步没做成 · 核对具体活动范围**
   > 地图上还没有可核对的活动边界；请点「在地图上手画活动范围」，或在左上角重新搜索地点并选择候选。
   > ［重试］［在地图上手画活动范围］

3. **定性：入口问题**——用地范围还没确认，属于前置条件。行为符合计划「缺依据时不静默出方案、给出可执行的下一步」，不是缺陷。
4. 手画 4 点红线后，同一张卡改口为：「按画布真实用地红线：**4 个点 · 577.7 × 619.0 m · 357626 ㎡**」——尺寸口径与画布一致，说明用地依据真的进了规划输入。

### 10.4 生成 → 结果卡（页面证据）

再次发送「这里做 60 人婚礼，先出一版」，页面依次出现真实阶段「正在处理 · 摆放物料 → 正在把婚礼分区、通道和物料安排成同一份布局」，随后结果卡出现（<code>data-testid="outdoor-design-result-card"</code>）：

| 计划要求 | 页面实际 |
| --- | --- |
| 推荐理由最多 3 条 | 卡片 3 条；Agent 侧另有 5 条「推荐理由」（含两版对照） |
| 假设人数与实际摆下人数分开 | 「观礼 **58** 席、宴席 **60** 席（目标 60 人），没摆满的差额留在清单里，不降低人数」；Agent 侧另写「60 件，实际放入 58 件，差 2 件」 |
| 两种有区别的候选 | 「本轮给出 2 版候选：「仪式与观景优先」、「宴席与服务效率优先」；推荐「仪式与观景优先」」 |
| 景观方向未知时不用「观景更好」当理由 | 「景观方向没有依据，两版都没有把「观景」写成推荐理由」 |
| 硬冲突先行 | 「几何校验：物件碰撞 0 处，越界 0 件，已知障碍冲突 0 件，通道占用 0 件；观礼 58/60 席，宴席 60/60 席（6 桌，整组率 100%）」 |
| 动线自检与几何冲突分开 | 卡片单列「这些分区还没有通道接上 · 现场可达性仍未核对」，并列出「仪式观礼区」；Agent 侧写明「席前需要补一条可走的路线」 |
| 物料缺失保留尺寸占位并标注 | 「134 件复用真实物料，1 件是标注过的尺寸占位」 |
| 摘要与画布一致 | 分区 chip 件数：仪式观礼区 59 / 宴席区 66 / 迎宾签到区 3 / 合影区 1 / 休息区 4 / 后勤备物区 2，与清单逐条数量合计相符 |

### 10.5 A/B 比较 → 采用 → 撤销

| 步骤 | 页面实际 |
| --- | --- |
| 点「比较方案」 | 卡片出现 A/B 两个候选页签、每版席位数、每版与当前画布的变更项数、「采用这一版」「结束比较」，并写明「切换只换卡片数据，采用前不改画布，也不移动视角」 |
| 切到 B | 页签 <code>aria-selected</code> 切到 B；**切换不动画布** |
| 点「采用这一版」 | 命中监督档：「采用「宴席优先」影响约 **144 件**，属于大范围改动，先确认再动手。」→「确认应用 / 先不应用」 |
| 确认后 | 卡片转「**已应用 · 可撤销**」，标题变「婚礼布置 · 宴席优先」，给出「新增 135 · 新增 6 个分区」「新增落在：仪式观礼区、迎宾签到区、合影区、休息区」「撤销这次」；**画布上真实出现仪式观礼区 / 宴席区分区与宴席桌椅** |
| 点「撤销这次」 | 「本次变化：删除 135 · 删除 6 个分区」，画布回到采用前的完整方案 |

### 10.6 并发保护

生成过程中改动活动/会话，Agent 回「**当前活动或会话正在变化，请稍后重新核对。**」并中止本轮，不覆盖较新的状态——与计划「拒绝覆盖较新方案」一致。

### 10.7 仍未验收（不因 2D 跑通而算过）

| 项 | 原因 |
| --- | --- |
| 3D 位置 / 朝向 / 数量对应、3D 定位取景 | 本机 WebGL 不可用（§10.2） |
| 在画布上点选一组桌椅后说「这里松一点」的完整链路 | 本次是在本机 scratch 活动里手画范围跑的，没做画布点选（§10.8） |
| 保存 / 刷新 / 分享一致性 | 本轮未做 |
| 用户真实场地（西湖扫描场地等）上的验收 | 本轮用的是本机 scratch 活动，**不当作用户真实场地验收**（计划 P0 明确「不用夹具代替当前场地」） |

### 10.8 一条观察：未采用的草案在页面刷新后不保留

跑第二轮时页面被 dev 热更新自动刷新（同时有别的会话在改本仓库），刚生成、尚未采用的结果卡随之消失；**已画的红线与已确认的用地依据仍在**。这与计划第 7 步「场地、当前方案和已确认约束保持一致」不冲突（未采用的草案本就不该落盘），但记录在此，避免下次误判为「方案丢了」。

---

## 十一、本轮对照计划发现并修掉的两个问题

两个都是**先在真实页面上看见、再回头定位到代码**的，不是我读代码推测的。

### 11.1 「比较方案」比较的是同一份布局（A/B 两版实际一样）

- **现象**：页面上点「比较方案」，A 与 B 的席位数、变更项数（新增 142 / 移除 0 / 改动 0）、取舍文案**完全一样**；采用 B 之后标题写「宴席优先」，但写进画布的还是同一份布局。
- **根因**：<code>proposeWeddingLayout</code> 返回的 <code>report.plan</code> 永远是**推荐版**的布局（入参 <code>strategy</code> 只影响推荐的取舍，不影响返回值）；而 <code>openDesignCompare</code> 按 strategy 跑两遍规划器，两遍都拿到推荐版的 plan、同一份数量、同一段取舍文案——于是「两版」其实是同一版。
- **违反的计划条目**：「两种有区别的候选」「每版显示实际容量与取舍」；验收项「两版比较：差异真实可见」。
- **修法**：
  1. 规划器让每版候选自带 <code>quantities</code>（自己的物料数量）、<code>reachability</code>（自己的动线自检）、<code>diff</code>（自己相对原始方案的差异）——比较时不能拿推荐版的数字去描述另一版；
  2. <code>openDesignCompare</code> 改成**跑一次规划**取两版，各用各的 plan / 数量 / 动线自检 / 差异（顺带把比较的计算量减半）；
  3. 比较卡的取舍文案改用每版实算出来的数（面积 / 席位 / 通道长度 / 路线交叉），不再用那句两版共用的通用理由；
  4. 两版算出来确实一样时，**照实写「这两版算出来的面积、席位与通道完全相同——这块场地分不出两种配比的差别」**，不把同一份布局包装成两种有取舍的方案。
- **回归测试**：<code>wedding-layout.test.ts</code> 新增「两版候选各带各的布局、数量与差异」；<code>use-outdoor-agent-workflow.design.react.test.tsx</code> 新增「比较卡给两版各自的实算取舍，并说清差别在哪（或分不出差别）」。

### 11.2 撤销之后卡片仍写着「已应用 · 可撤销」，还挂着撤销按钮

- **现象**：页面上点「撤销这次」，画布确实回到了应用前（「本次变化：删除 135 · 删除 6 个分区」），但卡片状态角标仍是「**已应用 · 可撤销**」，「撤销这次」按钮也还在——再点只会得到「没有可撤销的这次应用」。
- **根因**：撤销时只清了 <code>undoBefore</code>（快照没了），但卡片状态仍被置成 <code>applied</code>，而「撤销这次」按钮的显示条件只看 <code>state === "applied"</code>。
- **违反的计划条目**：「局部修改结果｜……提供一次撤销｜预览和已应用状态明确」。
- **修法**：新增第三种状态 <code>reverted</code>；撤销后角标写「**已撤销 · 回到上一版**」，并按状态收起「撤销这次」按钮（没得撤就不给第二次入口）。
- **回归测试**：结果卡新增「撤销后不再给撤销入口，状态写明已撤销」；工作流用例补「采用后 <code>applied</code> → 撤销后 <code>reverted</code>」。

### 11.3 修复后在同一页面复验（16:5x）

两处修复都在**发现它们的同一张页面**上复验过（dev 热更新已加载新代码）：

| 项 | 修复后页面实际 |
| --- | --- |
| 比较卡的取舍 | 「仪式区 36671 ㎡、宴席区 57288 ㎡；观礼 58/60 席、宴席 60/60 席（6 桌）。；入口到仪式区通道 0 m，后勤通道 0.8 m，宾客/后勤路线交叉 0 处。；景观方向未确认，本版未把观景作为取舍理由。」——每版自己的实算数，不再是那句通用理由 |
| 比较卡的候选名 | 页签变成「A · 仪式与观景优先」「B · 宴席与服务效率优先」（此前是「A · 仪式优先」「B · 宴席优先」） |
| 两版真的一样时 | 说明改口为「这两版算出来的面积、席位与通道完全相同——这块场地分不出两种配比的差别，选哪版容量都一样。」——这块 577×619 m 的规整场地本来就算不出差别，如实说 |
| 撤销后的状态角标 | 「**已撤销 · 回到上一版**」，变化摘要写「删除 135 · 删除 6 个分区」 |
| 撤销后的撤销按钮 | **消失**（DOM 查询 <code>撤销这次</code> → 无匹配），不再留一个只会报「没有可撤销的这次应用」的入口 |

---

## 十二、静态交互草图（P0 交付项补齐）

本轮不画视觉稿，只画**状态与动作的对应关系**，供实现与验收对照：

~~~
用户输入「这里做 60 人婚礼，先出一版」
        │
        ▼
┌───────────────────────────────┐
│ 前置：用地红线已确认？          │
│  否 → 卡片「这一步没做成 ·     │
│        核对具体活动范围」      │
│        ［重试］［在图上手画］   │
│  是 ↓                          │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ 生成中（真实阶段，不装进度条）  │
│ 「判断可布置区域」              │
│ 「组织仪式与宴席」              │
│ 「核对通道与桌椅」              │
│ 期间画布被改 → 中止并保留原方案 │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────┐
│ 结果卡（proposal · 尚未写入画布）             │
│ 理由 ≤3 条 ｜ 观礼/宴席/目标三数 ｜ 硬冲突单列 │
│ 没接通道的分区单列 ｜ 分区 chip（点=定位）      │
│ 关键假设折叠 ｜ ［比较方案］                    │
└───────────────────────────────────────────────┘
        │ 点「比较方案」
        ▼
┌───────────────────────────────────────────────┐
│ 比较（不写画布、不动视角）                     │
│ A · 仪式优先 ｜ B · 宴席优先                   │
│ 每版：席位数 + 自己的取舍数 + 与画布的变更项数 │
│ 说明：差别在哪 / 分不出差别                     │
│ ［采用这一版］［结束比较］                      │
└───────────────────────────────────────────────┘
        │ 采用
        ▼
┌───────────────────────────────────────────────┐
│ 监督档判定（严格档一次确认；大范围改动也确认） │
│ 通过 → 写入画布 → 卡片 applied                 │
│        「已应用 · 可撤销」                      │
│        「新增 x · 移动 y · 删除 z」+ 范围      │
│        ［撤销这次］                             │
│ 撤销 → 卡片 reverted「已撤销 · 回到上一版」    │
│        按钮收起（没得撤就不给入口）             │
└───────────────────────────────────────────────┘

旁路（任何一步都成立）：
  选中一组 → 「下一句的对象：已选 n 件」［清除引用］［重新取回］
            → 说「这组向右移 2 米」→ 只动这组 → 变化摘要 → 可撤销一次
  设施层锁定 → 写入被拒并说「先在图层里解锁」；撤销仍放行
  画布又改过 → 拒绝写入并说「不再覆盖你的修改」
  3D 视角说「往右」→ 先问口径（屏幕 / 东侧），不默认成东
~~~

