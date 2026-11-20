# 场地自主规划交互 P1 · 交接说明（2026-11-20）

对应设计稿：`docs/plans/2026-11-20-venue-agent-interaction-design-plan.md`。

> 2026-11-20 16:2x 补充：本轮浏览器自动化通道恢复，**真实页面上跑通了「生成 → 结果卡 → A/B 比较 → 采用 → 撤销」**，并因此发现两处真实缺陷（见 §五）。修复已落码并补回归测试。

本页只讲三件事：这轮真正落到代码里的行为、还差哪一步接上画布、哪些验证做了/没做。

## 一、这轮落地的行为

| 设计稿要点 | 落点 | 行为 |
| --- | --- | --- |
| 结果摘要（为什么这样排 / 实际摆下多少 / 关键假设） | `lib/outdoor-design-summary.ts`、`components/outdoor-design-result-card.tsx` | 摘要卡只在产出一版婚礼方案后出现，理由最多 3 条、席位三数（观礼/宴席/目标）、假设折叠、硬冲突单列 |
| 摘要 ↔ 画布双向定位 | 卡片 `onLocateZone` / `onLocateSelection` → hook `locateDesignEntities` | 点分区把该区设施 id 交给画布；画布没提供定位接口时如实写「画布没有提供定位接口」，不假装移动了镜头 |
| 当前选中作为可见、可清除的聊天上下文 | hook 800ms 选中快照 + 卡片「下一句的对象」 | 选中件数/名称可见；「清除引用」后下一句不再带这组，「重新取回」恢复；重新点选自动复位 |
| 局部调整（只作用于选中组） | `lib/outdoor-local-adjust.ts`、hook `tryLocalAdjust` | `选中一组 + 「这组向右移 2 米」` 本地解析执行，其余物件与分区不动；无选中时只要求先点选，不猜「这里」 |
| 「向右」的坐标语义 | `parseLocalAdjustment` + `parseRightBasisAnswer` | 东/南/西/北永远显式；左/右读不到画布朝向时只问一次「按屏幕右边还是场地东侧」，记住后不再追问 |
| 本次变化（新增/移动/删除） | `lib/outdoor-plan-change.ts`、卡片「本次变化」 | 应用后给出「新增 x 件、移动 y 件、删除 z 件」与明细，撤销入口只出现一次 |
| A/B 同视图比较 | hook `openDesignCompare` / `selectDesignCandidate` / `adoptDesignCandidate`、卡片比较区 | 同一份 `designInput` 快照重算两种策略，切候选不改画布；只有「采用这一版」才写盘 |
| 旧候选不能覆盖新改动 | `baseStillIntact` + 候选基座比对 | 打开比较后用户手动改过画布，采用会被拒绝并写明「不再覆盖你的修改」 |
| 锁定层不放行（2026-11-20 补） | `facilityLayerLocked`（契约→画布 `isFacilityLayerLocked` →overlay） | 设施层锁定时局部位移/候选采用直接拒写，并说清「先在图层里解锁」；撤销仍放行（回到锁前快照） |
| 冲突与影响范围（2026-11-20 补） | `applyLocalAdjust` + `facilityOverlapPairs`（K7 同一套判据） | 越界件数与「压到相邻物料」处数分开计，并报出这次动到的分区名；椅子叠桌子仍按 K7 允许，不算冲突 |
| 复用监督档 / 撤销 / 恢复 | `gateAction` + `commitDesignChange` + 整份快照写回 | 严格档一次确认（未确认前画布不动），默认档按既有风险规则；撤销 = 写回应用前完整方案（对象、分区、引用一起回来） |

集成面只加在 `hooks/use-outdoor-agent-workflow.ts`，对外返回新增：

- `designResult`：结果卡模型（`title/summary/state/change/pending/selection/compare/compareNote/locateNote`）
- `designPendingApply`：没有结果卡时的确认条（例如只位移了一组）
- `designActions`：`on*` 动作集合
- `openDesignCompare`：异步打开比较

## 二、画布侧适配已接上（2026-11-20 补）

第一版落地时画布文件在途，只加了可选能力；画布随后由另一条线提交（`853e53fd`），本轮把这层补完：

| 桥能力 | 落点 | 作用 |
| --- | --- | --- |
| `focusEntities(ids)` | 画布 `focusFacilities` + overlay 透传 | 结果卡「定位到分区 / 取回这组」一次把整组塞进视口；只动视图，不改 plan 与选中；一件都找不到时回 `false` |
| `viewBearingDeg()` | 画布 `getBearing()` + overlay 透传 | 「左/右」按画布当前罗盘朝向换算；画布没挂载时回 `null`，对话仍只澄清一次 |
| `currentView()` | 壳层（`room-organizer` `view={outdoor2DOpen ? '2d' : '3d'}`）→ overlay ref → bridge | 3D 里不拿 2D 罗盘口径当「右」的依据；不传时（只读分享页）如实报 `2d` |

`focusFacilities` 的实现要点：按每件设施的位置 ± 尺寸算外接框；单件或一排椅子会退化成一点，补 1.5 m 最小框（否则 `focusBounds` 因 `east === west` 直接不动），再复用现成的 `focusBounds` 入镜。

定位的回落顺序：`focusEntities`（整组入镜）→ `inspectFacility`（逐件聚焦，提示里写「同组 n 件」）→ 如实写「画布没有提供定位接口」。

3D 视图里的「左/右」（2026-11-20 补）：二维画布本身不知道有没有 3D 接管——真相在壳层，所以由 `room-organizer` 把 `view` 传进覆盖层（`outdoor2DOpen ? '2d' : '3d'`，跟 2D/3D 切换钮同一个判断），overlay 用 ref 带进终身注册的 bridge，换视角不用重新注册。行为：

| 场景 | 行为 |
| --- | --- |
| 2D 正北朝上 | 直接按东（+x）走，不打断 |
| 2D 转过角度 | 只问一次「按屏幕 / 按东侧」，记住丨按转角换算 |
| 3D，还没口径 | 只问一次，并把「这是 3D」写进问题；不再默默按东算 |
| 3D，答“按东侧” | 按 +x 走（已记住） |
| 3D，答“按屏幕” | 不当成记住了：当场说明 3D 里屏幕右随相机转、落不成坐标，请说“往东/往西”或切回 2D |

## 三、验证

在 `frontend/` 下执行：

```
npx tsc --noEmit
→ 第一版：通过（无输出）
→ 2026-11-20 补锁与冲突计数后：5 条 error，均在另一条线的发布流文件
  （lib/publish-flow.test.ts:44、panels/share-menu.tsx:412/444、
   room-organizer-publish.react.test.tsx:89/129），本轮文件 0 条。
  期间两次 `Zone Allocation failed` / `heap out of memory` 崩在系统内存不足（当时全机可用约 1.4 GB），
  降低并发后重跑得到上述结果；不把崩溃当成「通过」。
```

```
npx vitest run \
  components/room-organizer/lib/outdoor-design-summary.test.ts \
  components/room-organizer/lib/outdoor-plan-change.test.ts \
  components/room-organizer/lib/outdoor-local-adjust.test.ts \
  components/room-organizer/components/outdoor-design-result-card.react.test.tsx \
  components/room-organizer/hooks/use-outdoor-agent-workflow.design.react.test.tsx
→ Test Files  5 passed (5) / Tests  34 passed (34)   # 第一版
→ Test Files  3 passed (3) / Tests  17 passed (17)   # 补画布适配后：设计闭环 10 + 结果卡 6 + 画布入镜 1
→ 2026-11-20 打完锁定与冲突计数：6 个文件 / 45 条全过
  （设计闭环 14 + 结果卡 6 + 画布入镜 1 + 局部调整 14 + 摘要 4 + 差异 4）
  实跑（因机器内存吃紧分两批，单 worker）：
    npx vitest run --maxWorkers=1 --pool=forks <局部调整>            → 14 passed
    npx vitest run --maxWorkers=1 --pool=forks <设计闭环>            → 14 passed
    npx vitest run --maxWorkers=1 --pool=forks <其余 4 个>          → 17 passed
  合计 45 passed；没有合并成一次并发跑，因为两台其它窗口在建/在测，重复 OOM。
→ 2026-11-20 补 3D 视角口径后：
    局部调整 18、设计闭环 16、覆盖层桥 12（含 `currentView` 那条）、结果卡 6、差异 4、摘要 4、画布入镜 3
    实跑（单 worker）：vitest run <outdoor-local-adjust.test.ts> → 18 passed
                        vitest run <use-outdoor-agent-workflow.design.react.test.tsx> → 16 passed
                        vitest run <outdoor-plan-overlay.merge.react.test.tsx> → 12 passed
    tsc --noEmit → 4 条 error，仍全在发布流文件；本轮改动的 5 个文件 0 条
```

覆盖到的验收项（都能在 `use-outdoor-agent-workflow.design.react.test.tsx` 里逐条对上）：

1. 点选一组桌椅后「这组向右移 2 米」只改该组，同区另一桌不动，`allocationKey` / 名称等引用字段不变；
2. 读不到画布朝向时只澄清一次「按屏幕 / 按东侧」，回答后不再追问，再发同一句即按记住口径执行；
3. 没有选中对象时不猜「这里」，只要求先点选；
4. 严格档一次确认，确认前画布不动；
5. 默认档普通位移不额外弹确认；
6. 撤销写回应用前完整方案（坐标、桌号引用、分区一起回来）；
7. 应用前画布又改过 → 拒绝写入，不覆盖用户较新的手动修改；
8. 候选比较：打开不改画布，A/B 可切，画布改动后采用被拒绝。
9. 定位分区优先整组入镜（`focusEntities` 收到该区全部 id），画布不提供时如实回落到逐件聚焦。
10. 设施层锁定时：局部位移不写、不进确认；采用候选也被拒（测试 `锁定设施层` 两条）。
11. 采用候选后可撤销回到采用前的完整方案（测试 `候选采用与撤销`）。
12. 选中上下文件数只数现存对象，已删掉的不算（测试 `选中上下文的件数`）。

卡片渲染层另有 6 条（`outdoor-design-result-card.react.test.tsx`）：摘要文案、分区定位派发、选中上下文的清除/取回、已应用态的撤销入口唯一、严格档不谎称已写入、A/B 切换 + 采用 + 结束比较。

```
npm run lint
→ 0 errors, 2070 warnings（全仓既有 import/order 等风格告警）
   本轮新增文件单独 lint：0 problems
```

```
npm run build
→ 第一版（未改画布时）：成功静态导出（postbuild strip-internal-learning 已执行）
→ 补画布适配后：`npm run build` 在 ESLint 阶段被 V8 崩溃打断（build worker exit 134），
   连跑三次一致；`npx next build --no-lint` 仍成功静态导出，`npm run lint` 全仓 0 errors。
   当时工作树里画布正被另一条线并发修改（重复 props 的 lint error 已就地修掉），
   该崩溃出现在这些并发改动之后，未确认为本轮提交内容引起。
```

### 已知存量失败（与本轮无关）

`components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx`：16 failed / 101 passed。已用「临时 stash 掉本轮三个文件的改动后重跑」对照，失败项与数量完全一致（16 / 101），因此是当前工作树里其它在途改动带来的存量失败，本轮没有新增：

- 在地图上手画分区按钮直接进入绘制模式
- 地点轮廓仅候选，具体活动范围需真实卡片确认才写入
- place / scope 阶段搜索轮廓到达后自动出现确认按钮（2 条）
- 没有红线时核对把地图上的可见范围送进确认卡…
- 地图已有有效边界时核对重新预览…
- 未确认活动边界先出范围确认卡而不是死路…
- 多轮事实延续、改口人数…
- 已确认场地后一次 search 不再静默丢场地…
- 没核实入口也先出设计…
- 选项里夹带别的要求时不本地强制推进…
- 入口核对不能推断出口…
- 明确肯定仍绑定当前一版（3 条：没问题 / 同意这版方案 / 就按它落下去吧）
- 缺分区要追问时，提示条里也带上后置活

### 没做的验证

- **真实浏览器交互链路未执行**：只做到「dev server 起得来、`/editor` 返回 200 且有应用壳」的烟雾检查（`http://localhost:3001/editor` → 200，19674 字节）；「生成 → 点选 → 局部改 → 撤销 → 比较」需要已登录会话 + 已有边界/锚点的项目 + 可用模型后端，本环境没有这个会话，所以没有换成「已验」的口径。
- 画布 `focusFacilities` 只在 jsdom 里验证了「能定位 / 找不到如实回 false」；真实底图上的取景范围（整组是否刚好装得下）没有目测。
- 3D 里「右」的追问只在测试里验过，没在真浏览器 3D 视角里点过；“地图不在前面就是 3D”这个判断在「全部收起」时也成立，属有意选择。
## 四、刻意没做的事

- 不改后端契约、迁移、依赖、CI。
- 没有新增顶层导航，也没有第二张进度卡；结果卡只挂在工作流卡内部。
- 没有为了「看起来智能」让相机自动跟拍：定位只在用户点分区/取回时发生。
- 撤销只做一层（写回应用前快照），不做重做栈。

---

## 五、2026-11-20 16:2x 真实页面走查与两处修正

浏览器自动化通道本轮恢复，真实工作台（`http://localhost:3000/?local=1`）上跑通了完整链路：**生成 → 结果卡 → A/B 比较 → 采用（触发监督档确认）→ 撤销**。逐条页面证据见基线文档 §十。

走查中暴露两处**先在页面上看见、再定位到代码**的问题：

### 5.1 「比较方案」原本比较的是同一份布局

- 现象：A、B 两版的席位数、变更项数、取舍文案完全一样；采用 B 后标题写「宴席优先」，写进画布的还是同一份布局。
- 根因：`proposeWeddingLayout` 返回的 `report.plan` 永远是**推荐版**的布局（入参 `strategy` 只影响推荐取舍，不影响返回值）；`openDesignCompare` 按 strategy 跑两遍规划器，两遍拿到的都是推荐版。
- 改法：
  - 规划器让每版候选自带 `quantities` / `reachability` / `diff`（自己的物料数量、自己的动线自检、自己对原始方案的差异）；
  - `openDesignCompare` 改成**跑一次规划**取两版，各用各的 plan 与数字（顺带把比较的计算量减半——原来跑两遍）；
  - 比较卡的取舍文案改用每版实算的数（面积 / 席位 / 通道长度 / 路线交叉）；
  - 两版算出来确实一样时照实写「分不出两种配比的差别」，不包装成两种取舍；
  - 场地已有分区必须保留时，规划器只算得出一版——比较卡照实给一版并说明原因，不再复制成两张页签。
- 影响面：`lib/wedding-layout.ts`（候选数据模型 + 汇总处补 diff）、`hooks/use-outdoor-agent-workflow.ts`（比较逻辑与卡片模型）。

### 5.2 撤销之后卡片仍写「已应用 · 可撤销」

- 现象：点「撤销这次」，画布确实回到应用前（变化摘要变成「删除 135 · 删除 6 个分区」），但状态角标还是「已应用 · 可撤销」，「撤销这次」按钮也还在——再点只会得到「没有可撤销的这次应用」。
- 根因：撤销只清了 `undoBefore`，卡片状态仍被置成 `applied`，而按钮显示条件只看 `state === "applied"`。
- 改法：新增第三种状态 `reverted`；撤销后角标写「已撤销 · 回到上一版」，并按状态收起「撤销这次」。
- 影响面：`components/outdoor-design-result-card.tsx`、`hooks/use-outdoor-agent-workflow.ts`。

### 5.3 回归测试

- `lib/wedding-layout.test.ts`：新增「两版候选各带各的布局、数量与差异：比较时不能拿推荐版当另一版」。
- `components/outdoor-design-result-card.react.test.tsx`：新增「撤销后不再给撤销入口，状态写明已撤销」。
- `hooks/use-outdoor-agent-workflow.design.react.test.tsx`：新增「空场地上比较两版：两版各带各的实算取舍，差别看得见」；既有「采用候选后可撤销」用例补 `applied → reverted` 断言。

### 5.4 本轮仍未验证

- **3D**：本机内置浏览器未开硬件加速，WebGL 不可用，3D 层没渲染出来 → 2D/3D 位置、朝向、数量对应与 3D 定位取景**未验收**。
- **画布点选后的局部调整**：本轮是在本机 scratch 活动上手画范围跑的，没做「点选一组桌椅 → 说一句话」的页面链路。
- **保存 / 刷新 / 分享一致性**：本轮未做。
- **用户真实场地**：本轮用的是 scratch 活动，按计划 P0「不用夹具代替当前场地」，**不算真实场地验收**。
