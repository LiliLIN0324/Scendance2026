# 边界顶点 DOM 手柄层方案（A 档 · 自动命中手段）

> 日期：2026-11-23 ｜ 状态：**已确认（用户拍板），落码中** ｜ 提出：幕景 Agent 实测会话
> 触发：R7-A 几何对抗真机实测中，canvas 顶点手柄纯绘制、无 DOM ref，自动拖拽两轮未命中 10px 手柄；用户拍板选 **A 档（产品侧 overlay DOM 手柄）**，先定手段再回对抗测试。
> 硬边界：本方案不碰渲染/导出独占五文件、不碰几何基线两文件；已按 `AGENTS.md` §六在 `HANDOFF.md` 登记，用户 11-23 确认后动手。

## 一、目标与非目标

**目标**：让测试脚本 / Agent 能按 DOM 引用稳定找到并按住某个边界顶点、拖到目标位置；顺带为锁定态补可见引导（呼应 A7-G）。

**非目标**：
- 不另起一套拖拽提交 / 几何校验链路；命中与提交必须复用既有 `dragVertexRef → moveRingVertex → checkBoundaryRing` 守卫分支。
- 不扩到 3D 模式（3D 走 `pointerFromPlan` 另一路，本期只做 2D）。
- 不改米制尺度、贴地、朝向等几何基线（`scan-placement.ts` / `furniture-builders.ts` 禁改）。
- 不推进岗位 / 人数 / 路径步。

## 二、现状代码事实（只读拆解，2026-11-23）

画布组件：`frontend/components/room-organizer/components/outdoor-plan-canvas.tsx`
投影纯函数：`frontend/components/room-organizer/lib/outdoor-plan-canvas.ts`

### 2.1 舞台 DOM 结构（13141–13220）
- `stageRef` 容器：`position: relative; width/height 100%; overflow: hidden`，全部指针事件绑在容器上：`onPointerDown/Move/Up/Leave/Cancel`、`onDoubleClick`、`onContextMenu`。
- 两张 absolute canvas：底图层 `baseCanvasRef`（接收 pointer）；规划层 `planCanvasRef`（`pointerEvents: none`）。
- 已有 absolute DOM 浮层先例（`arrangePreview` 等），空白处 `stopPropagation` 写法可参照。

### 2.2 投影契约（lib/outdoor-plan-canvas.ts）
- `planPointToPixel(p: PlanPoint, viewport: PlanViewport): {x,y}`：ENU 米制点 → 画布 **CSS 像素**（y 轴翻转、`bearing≠0` 时绕画布中心旋转已烘进）。
- `PlanViewport`：`lng, lat, zoom, canvasW, canvasH, anchorLng?, anchorLat?, bearing?`。
- 逆映射 `planPixelToPoint` 已存在，命中取点沿用。
- **注意**：返回的是 CSS 像素，不是 canvas backing store 像素；DOM 定位直接用，无需除 DPR。

### 2.3 既有命中 / 拖拽 / 提交链路（组件内，复用不动）
- 命中：`nearestBoundaryVertexIndex(px)`（5618）——在 `VERTEX_HANDLE_HIT_PX=10` 半径内取最近顶点；数据源 `previewRingRef ?? planRef.current.boundary`。
- 按下：`handleStagePointerDown`（8941）→ 顶点命中后 `dragVertexRef.current = boundaryVertex`（9202–9210），置预览环、编辑提示。
- 拖动：move 分支（9753 / 10003）用 `dragVertexRef` + `moveRingVertex(ring, index, next)` 出预览。
- 提交：松手分支（10480）取 `vertexIndex = dragVertexRef.current`，整环 `checkBoundaryRing` 复验；不合法 `setEditMessage(issue.message)` 并 return，**原环保留**；合法才 `commitPlan` 并 `syncScopeForBoundary` 随动白框。
- 可编辑判定：`boundaryDirectEditable()`（5492）= `mode === 'view' && !layerLocked('boundary')`；锁定态（3598）本就不画顶点 / 缩放柄。
- 视图：paint 循环 3415 局部构造 `viewport`；对外 `getView(): PlanViewport`（1463）。`overlayTick`（467）已用于尺寸变化触发 overlay 重算。

## 三、A 档设计

### 3.1 DOM 手柄层
- 在 `stageRef` 内、两张 canvas 之上新增一个绝对定位层：`position: absolute; inset: 0; pointerEvents: none; z-index` 介于规划 canvas 与信息面板之间。
- 每个可编辑边界顶点渲染一个手柄钮（小圆 / 小方块）：`pointerEvents: auto`，其余层空白保持 `none`，不拦截底图平移、滚轮缩放、空白点击。
- 定位：`left/top = planPointToPixel(ring[i], viewport)` 再扣手柄半径居中；坐标用 CSS 像素。
- 手柄钮带 `data-vertex-index={i}`（测试 / 自动化按 ref 读索引，不依赖像素盲查）。

### 3.2 视图与顶点数据同步
- paint 循环把最新 `viewport` 与当前 boundary 顶点写入 ref；复用 / 新增一个节流 tick（避免每帧 setState 触发 React 重渲染）驱动 DOM 层重算。
- 跟随：缩放、平移、`bearing` 旋转、窗口尺寸变化时手柄位置同步重算；`ResizeObserver` 兜尺寸。
- 数据源与命中一致：`previewRingRef ?? planRef.current.boundary`（拖动预览阶段手柄跟随预览环）。

### 3.3 命中复用（两条子路径，实现时二选一，倾向 a）
- **(a) 纯像素复用**：手柄中心即顶点像素，事件冒泡到容器既有 `handleStagePointerDown`，`nearestBoundaryVertexIndex` 自然命中；DOM 层只做"可见可引用锚点"，不改命中代码。
- **(b) 目标优先**：down 分支开头读 `(event.target as Element).dataset.vertexIndex`，命中时直接 `dragVertexRef.current = index`，跳过 10px 半径盲查；后续 move / commit 守卫完全沿用。
- 无论哪条，都不绕过 `boundaryDirectEditable`、`refusePlanWrite`、`checkBoundaryRing`。

### 3.4 可见性与锁定口径（与 canvas 一致）
- `boundaryDirectEditable()` 为假（非 view 模式 / boundary 层锁定 / 隐藏）时：不渲染可点手柄；可渲染半透明灰柄 + 悬停提示"红线已锁定，点锁钮解锁"（A7-G 引导改进点，是否同批做见 §六待确认）。
- 不新增第二份锁定 / 可见性判定，调用既有 `boundaryDirectEditable` / `layerVisible`。

### 3.5 视觉去重
- 倾向：DOM 层只做命中锚点，**视觉手柄仍由 canvas 绘制**；DOM 钮透明或仅极小热区，避免两套手柄同屏重叠。
- 若改由 DOM 画手柄，则 canvas 顶点绘制在 DOM 就位后隐藏——此改动面更大，列入待确认。

## 四、文件边界

| 文件 | 改动 | 边界判定 |
|---|---|---|
| `components/outdoor-plan-canvas.tsx` | 手柄层 JSX、tick 同步、（可选 b 路径）down 分支目标优先 | 非独占五文件、非几何基线两文件 |
| `lib/outdoor-plan-canvas.ts` | （建议）抽手柄布局 / 可见性纯函数，便于单测 | 纯函数层，不动基线坐标换算 |
| 测试（新或既有 `.react.test.tsx`） | 手柄渲染 / 坐标 / 命中 / 锁定不渲染断言 | 测试侧 |

**不碰**：`use-import-export.ts`、`use-splat-preview.ts`、`splat-preview.ts`、`room-organizer.tsx`、`scendance-workspace.tsx`（独占）；`scan-placement.ts`、`furniture-builders.ts`（几何基线）。

## 五、测试计划（沿用既有 react 测试先例）

参照 `outdoor-plan-canvas.pointer-capture.react.test.tsx`、`outdoor-plan-canvas.write-gates.react.test.tsx`（`ref.getView() + planPointToPixel + fireEvent` 拖顶点）：
1. 可编辑态：渲染出 N 个带 `data-vertex-index` 的手柄；坐标与 `planPointToPixel` 逐点一致。
2. 锁定态 / 隐藏层：不渲染可点手柄。
3. 点手柄 → 进入 `dragVertexRef`；拖到非法位置（面积 <4㎡ / 重合 / 自交 / 删到 2 点）松手 → 拒绝、原环保留，回执文案与 canvas 路径一致。
4. 合法拖动 → `commitPlan` 正常，白框随动。
5. 空白层 `pointer-events: none`：点不拦底图平移 / 滚轮。
6. 跑 `npm --prefix frontend run test -- site-plan-editing` 与画布定向套件；`npm --prefix frontend run typecheck` 0 错。

## 六、已拍板结论（2026-11-23 用户确认，全套认可倾向）

1. **命中子路径**：选 **(a) 纯像素复用**既有 `nearestBoundaryVertexIndex` 判定；DOM 层只做可见可引用锚点，不改命中代码。
2. **视觉归属**：**DOM 仅透明热区，手柄视觉仍由 canvas 绘制**；不隐藏 canvas 顶点绘制，避免两套手柄同屏。
3. **A7-G 引导**：**本批不同做**；锁钮 tooltip / 锁定态灰柄提示单列后续项。
4. **同步频率**：**仅 ring / viewport 关键态变化 bump** 刷新手柄位置，不做每帧 setState。
5. **3D**：**本期不扩 3D 手柄**，只做 2D。

## 七、本轮范围与未做事项

- 本轮：2D 边界顶点 overlay DOM 手柄层 + 定向 react 测试；收口跑通 `typecheck` + 定向测试后一次性提交 main。
- 未做：未新增依赖；未动数据库 / 契约 / CI；不扩 3D；不做 A7-G 锁钮引导；不改独占五文件 / 基线两文件。
- 真机对抗用例（A6→A1→A3→A2）仍待本手段落地后回填真机回执；此前几何对抗属人工介入段，不计 Agent 自主行为。
