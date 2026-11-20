# 场地自主规划 · 本轮基线与验收记录

日期：2026-11-20。角色：集成与验收（协调入口）。配套计划：[2026-11-20-venue-agent-interaction-design-plan.md](2026-11-20-venue-agent-interaction-design-plan.md)。

状态：**基线已建立，真实页面验收被阻塞**。浏览器自动化通道两轮共 8 次调用超时（含 `open`/`snapshot`/`screenshot`/`close`），未取得任何页面截图；因此本文件不包含真实页面复现结论、视觉验收结论与设计效果评价。凡未实际观察到的项目，一律标「未验收」，不以测试通过代替。

> 2026-11-20 第二次复核（HEAD `f2ff2980`）：规划套件已转绿、前端类型检查 0 错；浏览器通道仍然不可用，P0 四步复现**未执行**。详见 §一.2、§二.4、§五.5。

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
| Qoder 引导批（已在 COLLAB.md 登记） | `onboarding/*`（新）、`lib/site-plan-guide.ts` / `.test.ts`、`app/globals.css`、`room-organizer.tsx`、`tsconfig.json`、`COLLAB.md`；删除 `components/outdoor-plan-interactions.tsx`、`hooks/use-f3-coach-bubble.ts`、`panels/f3-coach-bubble.tsx` |
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
| 新手引导批（`onboarding/*` 等） | Qoder（COLLAB.md 已登记） | 未提交，等复核 | 只读 |
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
| 当前场地起稿与实际容量 | 未验收 | 需页面；规划单测 14/14 绿只证明算法夹具，不含真实场地 |
| 点选对象后聊天局部调整 | 未验收 | 需页面 |
| 已确认景观方向和背景调整 | 未验收 | 需页面；规划套件中景观方向用例已转绿，但仍属夹具 |
| 锁定件保留 | 未验收 | 需页面；`outdoor-plan-protection` 11 例绿只覆盖锚点/红线安全阀 |
| 不规则场地、建筑阻挡、容量不足 | 未验收 | 规划套件含凹形/建筑/狭小用例，现 14/14 绿（夹具）；真实凹形场地未跑 |
| 同视角 A/B 比较及恢复 | 未验收 | 需页面；比较动作当前 `tsc` 不通过 |
| 生成中手动修改、停止、失败与旧候选应用 | 未验收 | 需页面 |
| 保存刷新、2D/3D 与分享一致性 | 部分（单测） | 持久化层 54 例绿（会话 revision 14 / 写租约 6 / 保存态 14 / 钝点保护 11 / 关页补存 9）；刷新与分享需页面 |
| 设计效果（主次、朝向、组团、留白、动线） | 无法评价 | 无截图，拒绝以文字代替画面 |

---

## 八、存量问题与剩余工作

1. **浏览器通道**：内置浏览器与 Chrome 自动化窗口两轮共 8 次超时，连 `close` 都不返回，属 MCP 守护进程层。恢复后按 §二.4 的四步自查，再补 P0 与全部页面验收。
2. **在途不绿**：~~类型检查 24 条、规划套件 3 红~~ **已清零**（`f2ff2980`：`tsc` 0 错、规划 14/14）；`outdoor-plan-save-lifecycle` 首轮 worker 未启动，已单跑 **9/9 绿**。剩余不可验证项全部是页面项。
3. **并发写同一工作区**：本轮已出现文件在我读取期间被改写。建议两位负责人各自收口提交后再进入集成，避免我基于漂移快照下结论。
4. **未验证的审计结论**：右键/Alt 桥接、无红线草稿提示、3D 换算精度、拖动重建帧耗时，全部仍为待证项。
5. 未做且按约束不得做：改契约、迁移、依赖、CI；部署；推送；`git add -A`。

---

## 九、本轮实际改动

仅本文件与计划文档的状态行。未修改任何产品代码、测试、契约或配置；未暂存他人改动。
