# 场地自主规划交互 P1 · 交接说明（2026-11-20）

对应设计稿：`docs/plans/2026-11-20-venue-agent-interaction-design-plan.md`。

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
| 复用监督档 / 撤销 / 恢复 | `gateAction` + `commitDesignChange` + 整份快照写回 | 严格档一次确认（未确认前画布不动），默认档按既有风险规则；撤销 = 写回应用前完整方案（对象、分区、引用一起回来） |

集成面只加在 `hooks/use-outdoor-agent-workflow.ts`，对外返回新增：

- `designResult`：结果卡模型（`title/summary/state/change/pending/selection/compare/compareNote/locateNote`）
- `designPendingApply`：没有结果卡时的确认条（例如只位移了一组）
- `designActions`：`on*` 动作集合
- `openDesignCompare`：异步打开比较

## 二、还差一步：画布侧适配（未改画布文件）

`outdoor-plan-canvas.tsx` / `outdoor-plan-overlay.tsx` 当前有别的改动在途，本轮**没动**。`OutdoorAgentBridge` 因此新增了两个可选能力（`lib/outdoor-agent-contract.ts`）：

```ts
/** 画布相机的方位角（度，0 = 正北，顺时针）。读不到就不要实现。 */
viewBearingDeg?: () => number | null;
/** 当前视图：2d / 3d；决定「屏幕右边」这层语义是否成立。 */
currentView?: () => "2d" | "3d";
```

接入时在画布的 bridge 实现里补三行即可（示例，按现有 bridge 组装处照抄）：

```ts
selectedIds: () => useOutdoorPlanStore.getState().selectedIds,   // 已有则不用改
viewBearingDeg: () => camera?.bearingDeg ?? null,                 // 2D 正北朝上时返回 0
currentView: () => (viewMode === "3d" ? "3d" : "2d"),
```

不补的后果是明确的、可接受的：左/右类指令会**只澄清一次**方向口径，用户回答「按东侧 / 按屏幕」后按记住的口径执行；东/南/西/北一直可用。不会出现猜方向、也不会重复追问。

定位侧同理：如果画布提供 `inspectFacility(id)`（现有能力）即可逐件聚焦；要「整组入镜」需要画布新增一个 `focusEntities(ids)`，卡片侧已经把 id 交出去了，只等画布接。

## 三、验证

在 `frontend/` 下执行：

```
npx tsc --noEmit
→ 通过（无输出）
```

```
npx vitest run \
  components/room-organizer/lib/outdoor-design-summary.test.ts \
  components/room-organizer/lib/outdoor-plan-change.test.ts \
  components/room-organizer/lib/outdoor-local-adjust.test.ts \
  components/room-organizer/components/outdoor-design-result-card.react.test.tsx \
  components/room-organizer/hooks/use-outdoor-agent-workflow.design.react.test.tsx
→ Test Files  5 passed (5) / Tests  34 passed (34)
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

卡片渲染层另有 6 条（`outdoor-design-result-card.react.test.tsx`）：摘要文案、分区定位派发、选中上下文的清除/取回、已应用态的撤销入口唯一、严格档不谎称已写入、A/B 切换 + 采用 + 结束比较。

```
npm run lint
→ 0 errors, 2070 warnings（全仓既有 import/order 等风格告警）
   本轮新增文件单独 lint：0 problems
```

```
npm run build
→ 成功静态导出（postbuild strip-internal-learning 已执行）
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

- **真实浏览器手验未执行**：本轮只做了 jsdom + 组件测试与静态构建，没有在 `/editor` 里跑「生成 → 点选 → 局部改 → 撤销 → 比较」的肉眼链路。视觉（卡片在窄侧栏里的换行、比较区高度）需要人工过一眼。
- 没有提交任何画布/overlay 改动，因此「整组入镜」的镜头行为没有端到端验证。

## 四、刻意没做的事

- 不改 `lib/wedding-layout.ts`（布局算法仍归规划线），不改后端契约、迁移、依赖、CI。
- 没有新增顶层导航，也没有第二张进度卡；结果卡只挂在工作流卡内部。
- 没有为了「看起来智能」让相机自动跟拍：定位只在用户点分区/取回时发生。
- 撤销只做一层（写回应用前快照），不做重做栈。
