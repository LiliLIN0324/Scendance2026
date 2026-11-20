# 户外地图编辑交互修复 · 独立验收（2026-11-20）

> §0–§6 保留独立验收时的历史结论；后续补齐及最新验证结果见 §7，不将旧的「未通过」表当作当前修复状态。

验收人：Qoder 独立会话（只读验收，未修改产品源码、未提交、未撤销其他窗口的改动）。
基准文档：`deliverables/outdoor-map-editing-interaction-audit-2026-11-20.md`（B/K/F 编号沿用原文）。

## 0. 验收位置与范围

- 开始时记录：`main = fd6820c3`，主工作区当时已有其他窗口的在途改动（`panels/share-panel.tsx`、`lib/site-plan-guide.ts`、`panels/f3-coach-bubble.tsx` 删除等）与暂存内容，**这些不计入本次验收**。
- 验收范围：`29e87786~1..fd6820c3` 共 16 个实现/文档提交（823e26e3 B3/K3/K8/F4/F5 → f52adc3a B5/B8/B9/K4/K12/K13 → a5165b9f B1/B2 → 9dcacfee B6/F9 → 8ec6dd37 K2/F1/K1 → aeaf8668 B7/F6/F7 → 14a8a936 K9/F2 → f672fafe K11/K5 → f2ff2980 F10/K6 部分 → 853e53fd B4/F8/F3/F11 → 66292f66 K6 补齐 → c85d3811 K7 → fd6820c3 K10，另有 a36dd428 / 099bc7e8 / 14fc5533 / bb297cdd / e203df66 / 6edbed77 / e3398b42 等非审计批次混在同一段历史里）。
- 验收用干净工作树：`.temp/wt-f2ff`（detached `fd6820c3`，`git status --porcelain` 只剩我自己写的未跟踪 `.audit-probe/`），dev server `127.0.0.1:3012` 服务该树。
- 收口后补核：验收期间 `main` 又前进到 `41e626c8`，其中 `9b574141`（锁定层挡写、局部冲突说清、候选采用可撤销）属审计后续；已确认它对被审文件只加 3 行（`isFacilityLayerLocked()` 句柄），**下面列的主缺陷代码在该 HEAD 仍未变**。

## 1. 命令与结果（区分既有失败）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | EXIT=0，0 错误 |
| 测试 | `npx vitest run --maxWorkers=1`（heap 4096） | Test Files 30 failed / 788 passed；Tests 232 failed / 9837 passed / 75 skipped；另有 4 个 `Worker forks emitted error`（本机内存吃紧导致的 fork 失败，不是断言） |
| 同一批文件的基线复跑 | 在 `29e87786` 跑上述 30 个失败文件 | 30 files 全红、244 条用例失败；逐文件对比：**没有文件是 HEAD 才红的**，agent-panel 144→140、app/page 9→1，其余计数相同 → 232 条失败全部为既有失败，本批未新增红测试 |
| Lint | `npx --no-install eslint app components lib --ext .ts,.tsx` | EXIT=0：**0 errors / 2059 warnings**（首轮曾在并发内存压力下报插件加载错，单独复跑即通过；2059 条全是 import/order 一类既有噪音） |
| 构建 | `npx --no-install next build` | EXIT=0：`Compiled successfully in 50s`，静态导出 20/20 页通过（`next build` 自带的 lint 步骤同样只出 warning） |

审计相关测试在 HEAD 全绿：`lib/plan-edit-gate.test.ts`(10)、`lib/plan-pointer-bridge.test.ts`(5)、`lib/outdoor-write-guard.test.ts`(6)、`lib/outdoor-plan-session.test.ts`(14)、`lib/plan-facility-overlap.test.ts`(9)、`components/outdoor-plan-canvas.measure-session.react.test.tsx`(3)、`.placement-bar`(5)、`.pointer-capture`(4)、`.card-actions`(3)、`.scene-objects`(2)、`outdoor-plan-save-lifecycle`(9)、`site-plan-facilities`(48)、`workspace-write-guards`(5)。

## 2. 问题清单（按严重程度）

行号以 `fd6820c3` 为准，文件为 `frontend/components/room-organizer/components/outdoor-plan-canvas.tsx`（下称 canvas）。

### P0-1 右键入口与菜单项完全绕过可编辑性门，隐藏层与锁定层照样改数据（浏览器实证）

- 现象与证据（干净 HEAD、本机模式）：
  - 隐藏设施层 → 左键点中心：提示「「设施」图层已隐藏：先在左栏图层开关里打开它，才能选中或编辑。」（正确）；同点位右键：菜单仍弹出 `复制 / 上移一层 / 置于顶层 / 下移一层 / 置于底层 / 删除`；点删除 → 该记录设施由 `["审计样机A"]` 变成 `[]`，且无任何拒绝提示。
  - 锁定设施层（`layer-lock-facility` 的 `aria-pressed` 确认已为 `true`）→ 右键：同样弹完整菜单；点复制 → 方案里多出「审计样机A 副本」。
  - 对照：同层隐藏时清单行左键、清单行 Delete 键、清单行右键都是被拦住的（带上面同一句提示），**只有画布右键这条路是开的**。
- 代码位置：
  - 右键入口 canvas:2677-2691（`handleContextMenu`）：命中判定只看 `viewPlan().facilities`，不查可见性；只有「是否选中」查了锁（2687 一带 `if (!layerLocked('facility')) selectFacility(...)`），菜单弹出（2691）无任何守卫。
  - 菜单项 canvas:13163-13182 + 13279（`plan-context-menu` 内 `duplicate` / `order-*` / `delete`）分别直调 `duplicateFacility` / `reorderFacility` / `deleteFacility`；这三个函数本体（canvas:7304 / 5995 / 7095）都不含门。
  - 门本身是好的：`entityEditable` canvas:5465、`layerBlockedReason` 5470、`refuseEntityWrite` 5475——但 `refuseEntityWrite` 的调用点只有 3 处（5919 / 6937 / 7043），右键这条路一次都没走。
- 影响：这正好是审计 §5「同一件事有多个入口、多个口径」的复发，且落在数据破坏最不可逆的删除上；`main = 41e626c8` 仍在。
- 建议：命中判定改用 `entityEditable('facility')`（或 `planLayerBlock`），被挡时走 `layerBlockedReason` 出提示且**不弹菜单**；六个菜单项各自加同一道门（层级项按 `order-*` 也应拒写）。

### P1-2 Agent 公共句柄仍是「门后真空」（代码实证，未实机）

- canvas:5015 `applyRoutes` / 5039 `applyWorkers` / 5061 `applyMeasurements` / 5078 `applyAnnotations` 直接 `commitPlan`；`addFacility` 5138、`removeFacility` 5145 同样无门（`updateFacility` 5151 是收口的对照样板）。
- `removeFacility` 内部走的就是 P0-1 里未收口的 `deleteFacility`。
- 说明：`9b574141` 已给「局部位移 / 候选采用」两条 hook 路径加了 `isFacilityLayerLocked()` 判断（overlay:746 注入），方向正确、范围仍窄——上面这些句柄仍是谁调谁写。

### P1-3 清单行「删除/层级」按钮与属性卡经纬度写入未入门（代码实证）

- `deleteRow` canvas:8577 无门（同函数族里 `locateRow` 8567 是正确样板：先 `layerBlockedReason(row.kind)` 再动作）；分区 `duplicateZone` 8538、属性卡经纬度 `moveFacilityTo` 7123（经 `commitFacilityGeoDraft` 7115）同样未入门。
- 可达性：层隐藏/锁定后，用清单行上的删除图标即可删掉该实体；这是 P0-1 之外第二条「看得见拦不住」的路。

### P2-4 隐藏与锁定两种被挡状态，提示口径不一致（浏览器观察）

- 隐藏层左键：有完整解释句；锁定层左键：实测既没选中也没有任何提示（同点位、同一读取时机）。审计 K3 的原话是「锁层点击还没有反馈」，这一条只补了一半。
- 建议：锁定层命中被挡时同样走 `planLayerBlockReason`。

### P2-5 3D 右键桥在地面命中失败时静默，且没有解释（代码实证，未实机）

- `components/outdoor-plan-3d.tsx:2402-2404`：`const hit = eventToPlanHit(event); if (!hit) return;` → 相机贴地或指针越过地平线时，右键「取消放置 / 撤上一点」在 3D 里整条不可达；用户只会觉得右键没反应。桥本身对 move/up 有 `lastHit` 兜底，右键这条路绕过兜底。
- `lib/plan-pointer-bridge.ts:36-37`：`lastHit` 只在 `leave` 清空 → 若某次 up/cancel 未达（`setPointerCapture` 失败、切窗口），上一手势的落点可能被下一手势起手继承。

### P2-6 F8 只补齐画布，清单行右键仍无菜单（代码 + 浏览器实证）

- 清单行渲染 canvas:13737-13751 只有 `onClick={locateRow}`，没有 `onContextMenu`；K11 与 F8 要求的「同一套右键能力」在 3D 与画布到位，清单行这一格仍缺。

### P2-7 B4 撤销粒度：会话内 Agent 写入会把临时测量一起提交进历史，撤销一次吞掉两件事（代码推断）

- canvas:5026 一带的 `expected` 比对用 `JSON.stringify` 判等（键序敏感），与 `commitPlan` 的判等（2849）和会话的 `samePlanContent`（键序无关）是三套口径；一次 Agent 提交可能把未退出的临时测量写进历史。属语义收口，非破坏性。

### P3 其余待收口（低危，列出以便排期）

- `reorderFacility`（canvas:5995）层级写未入门（与 P0-1 同函数）。
- `placeArmedFacilityRef`（canvas:5458-5461）：武装态不查可见性，`drawGhostPlus`（9953-9958）在隐藏层仍画幽灵「+」；K8 只在 `placeFacilityAt`（6937）落点守卫，预览与守卫不同步。
- F12（3D 拖拽每帧重建）本轮未见实施：`components/outdoor-plan-3d.tsx:2257-2263`、`1217`、`1228` 与审计描述一致。
- 治理缺口：本仓 CI 只有 `.github/workflows/miniprogram.yml`；实施窗口曾出现「`onPointerCancel={handleStagePointerCancel}` 引用先于函数体落库、渲染阶段 ReferenceError」的中间态（`f28a704b` 记录，`66292f66` 修复）。已用 `git grep` 确认该 token 在 `f2ff2980`、`853e53fd` 均为 0 次，即**没有任何已提交状态带崩溃**，但 `next dev/build` 都不做类型检查，说明缺一道前端 typecheck 门禁。

## 3. 没有证据的推测（不作为结论）

1. 桥 `lastHit` 跨手势陈旧落点是否真能被下一手势继承（未做连续手势实机，且本机无 3D 场地）。
2. 3D 右键在真实场景「无地面命中」的频率与观感。
3. B4 会话期 Agent 写入吞掉一格撤销的实际用户影响面。
4. `JSON.stringify` 键序判等是否会稳定产生「假不等 → 多一条历史」。
5. F12 每帧重建的实际掉帧程度（本机无 GPU 场景，无法量化）。

## 4. 逐项验收表

| 编号 | 结论 | 依据 |
|---|---|---|
| B1 关页/刷新丢最后编辑 | 通过 | `a5165b9f`：pagehide+visibilitychange 同步 flush；`outdoor-plan-save-lifecycle`(9) 行为级用例（localStorage 字节、调用次数） |
| B2 本机写失败被吞 | 通过 | `saveOutdoorProjectRecord` 返回 `OutdoorSaveResult{ok,reason}`；`local-failed` 态存在且 `save-status.ts` 有专门文案；配额满用例覆盖 |
| B3 隐藏层仍可点选/拖动/Delete | **未通过** | 左键/清单行/属性写入已收口（实测有拒绝提示），但画布右键入口与六个菜单项无门：**隐藏层右键删除实测改掉了数据**（P0-1） |
| B4 临时测量共用正式方案与历史 | 通过（带尾差） | `853e53fd`：`dropMeasureSession` + `dropSessionMeasurementsFromHistory`，撤销不再复活临时线（3 条用例）；退出即清的既有约定保留 ✓；残留见 P2-7 |
| B5 3D 越过地平线落错点 | 基本通过 | `lib/plan-pointer-bridge.ts` 纯函数 + 5 条用例：不再回落 `clientX/clientY`；未闭环见 P2-5（右键早退、跨手势 lastHit），未实机 |
| B6 同源双窗口借 revision 覆盖 | 基本通过 | `outdoor-plan-session`（baseRevision/isPersisted/samePlanContent）+ `outdoor-write-guard`（Web Locks 写租约，租约被占不写）；**跨设备 CAS 明确未验证** |
| B7 选中/定位指向不存在对象 | 通过 | `aeaf8668`：`locateIssue` canvas:8650-8680 先验存在性与锚点，不再「飞过去 + 报已定位」 |
| B8 3D 手柄不跟清单选中 | 通过（代码级） | 手柄按 `selectedFacilityId` 重挂 + `onSelectionSyncRequest` 同步；未实机 |
| B9 3D 动线/节点/人员/标注无反馈但 Delete 生效 | 部分通过 | `f52adc3a` 扩了 `PlanEditVisuals` 选中态（`outdoor-plan-3d.tsx:1579-1631`）；**拖拽反馈仍只有 facility/zone**（1619 `kind !== 'facility' && kind !== 'zone'` 早退），route/node/worker/annotation 仍无手柄与轮廓；未实机 |
| K1 等比缩放与尺寸输入误导 | 通过 | `8ec6dd37`；等比约定保留 ✓（短边语义换算、FACILITY_MIN/MAX 夹紧，`site-plan-facilities` 48 条用例覆盖） |
| K2 每个键一条 undo | 通过 | `commitPlanMerged` 400ms 同键合并 + `commitPlan` JSON 判等短路（双口径问题另见 P2-7） |
| K3 锁只锁画布、锁层点击无反馈 | **未通过** | 清单行/属性写入已入门；画布右键菜单（P0-1）与清单行删除按钮、经纬度写入（P1-3）未入门；锁定层左键无提示（P2-4） |
| K4 3D Alt 分叉失效 | 基本通过 | 桥透传 `originalEvent` + `parseFacilityAltPreviewState`（canvas:10675 一带）；未实机 |
| K5 3D 无放置浮条 | 通过 | `f672fafe`：浮条改画布根级绝对定位，3D 复用同一条（placement-bar 5 条用例，含 3D 场景） |
| K6 拖拽跨出画布就取消且不提示 | 通过（未实机） | `f2ff2980` 部分 + `66292f66` 补齐 `handleStagePointerCancel` 函数体与 `clearStageHoverState()`；3D `pointercancel` 监听早于本批已存在（`outdoor-plan-3d.tsx:2408`）；提示文案未实机确认 |
| K7 物料压物料无检测 | 通过 | `c85d3811`：`lib/plan-facility-overlap.ts` + `site-plan-conflicts.ts:413` 进问题清单 + canvas:7044 落点软提示（9 条用例） |
| K8 隐藏层还能放置却报「已放置」 | 基本通过 | canvas:6937 `refuseEntityWrite('facility')` + `planModeAutoVisibleLayer` 自动开层；预览与武装态不同步见 P3 |
| K9 单件卡没有复制/删除 | 通过 | `14a8a936`（card-actions 3 条用例） |
| K10 触屏/键盘缺完整路径 | 待产品决策（已按「桌面优先」文档收口） | `fd6820c3` 只改文档，未补可达性实现 |
| K11 3D 没桥接右键 | 部分通过 | 有命中时桥接正确（用例覆盖）；无命中静默不可达（P2-5）；桥过来的菜单同样受 P0-1 影响 |
| K12 无红线时草稿/幽灵一律不画 | 通过 | `outdoor-plan-3d.tsx:1563-1578` 注释写明口径 + `boundaryLocked` 用例 |
| K13 3D 框选无反馈 | 部分通过 | 2D 侧 rubber-band 描边已有；3D 里 facility/zone 之外的实体拖框仍无反馈（同 B9）；未实机 |
| F1/F2/F4/F5/F6/F7/F9/F10/F11 | 通过 | 分别见 `8ec6dd37`、`14a8a936`、`823e26e3`、`f672fafe`、`aeaf8668`、`9dcacfee`、`f2ff2980`/`66292f66`、`853e53fd`（场景物件「只读」文案实测出现在问题清单：「只读场地模型中的场景物件不可编辑。」） |
| F3 清单滚动只覆盖 4 类 | 通过 | canvas:3321-3339 `selectedInventoryRowId` 扩到 8 类 + 11000-11020 窗口化与「已切回全部类型」提示 |
| F8 右键能力不一致 | 部分通过 | 画布与 3D 补齐；清单行右键仍无菜单（P2-6） |
| F12 3D 拖拽每帧重建 | 未实施 | 代码与审计描述一致，本批未动 |
| 测试是否只复述实现 | 大部分不是 | `plan-edit-gate.test.ts`(10)、`plan-pointer-bridge.test.ts`(5) 等纯函数表驱动；保存/会话/租约/测量会话/浮条/卡片均为行为级断言（localStorage 字节、调用次数、句柄结果）。缺口：门本身有单测，但没有任何一条用例覆盖「入口一致性」，这正是 P0-1 漏网的原因 |

## 5. 浏览器复现记录（干净 HEAD `fd6820c3`，`http://127.0.0.1:3012/?local=1`，1512×932）

准备：localStorage 写入 40×30 m 红线 + 单件设施「审计样机A」@ (0,0)（视图中心即该件中心），重载后进入「户外规划 → 已放置物件」。脚本与截图：`.temp/wt-f2ff/frontend/.audit-probe/probe22.mjs`、`browser-63-head-leak.png`（不入库）。

| 步骤 | 预期 | 实际 |
|---|---|---|
| 隐藏设施层，左键点 A | 拒选 + 一句解释 | 符合：「「设施」图层已隐藏：先在左栏图层开关里打开它，才能选中或编辑。」 |
| 同点位右键 | 不该弹菜单（或菜单项只读） | **不符**：完整菜单弹出（复制/上移一层/置于顶层/下移一层/置于底层/删除） |
| 点菜单「删除」 | 拒写 + 解释 | **不符**：设施直接消失（该记录 `["审计样机A"] → []`），无任何提示 |
| 锁定设施层（`aria-pressed=true`），右键点 A | 只读，不该有写动作 | **不符**：同样弹完整菜单 |
| 点菜单「复制」 | 拒写 | **不符**：方案里新增「审计样机A 副本」 |
| 锁定层左键点 A | 至少给一句「已锁定」解释 | 未给：既没选中也无任何提示（与隐藏层口径不一致） |
| 隐藏层时点清单行 / 按 Delete / 行右键 | 三者一致拒选 | 符合：三处都是同一句「已隐藏」提示，数据不变 |

未做/做不到的浏览器验证：3D 相关（本机 `?local=1` 无可渲染 splat 场地）、云端保存与跨设备冲突、F12 帧率。

## 6. 结论

1. 本批修复的方向和大多数条目是实的，而且没有把测试搞红：既有 232 条失败与审计无关，HEAD 相对基线还少了 12 条。
2. 唯一 P0：`B3/K3` 只收了左半边——画布右键这条入口从命中到六个菜单项全程没有经过 `plan-edit-gate`，隐藏/锁定层照样删与复制，已在干净 HEAD 实机复现；同一函数族里 `locateRow`/`updateFacility` 就是现成样板，改动面很小。
3. 第二梯队是「入口一致性」缺口的其余分支（Agent 句柄、清单行删除按钮、经纬度写入），以及 `K11` 右键在无地面命中时的静默。
4. 验收本身未修改产品源码、未提交、未撤销其他窗口工作；`main` 期间前进到 `41e626c8`，主缺陷代码未变。


## 7. 验收遗留补齐与复验（Codex，2026-11-20）

代码基线：`41e626c8`。本次在主工作区补齐；发布流程、引导和截图清理等其他窗口的未提交改动不纳入本次提交。以下是代码实现与本机验证结果，不能据此宣称真实云端或整体工作区已验收通过。

### 7.1 本次变更

| 原验收问题 | 本次处理 | 验证层次 |
| --- | --- | --- |
| P0-1 画布右键绕过隐藏/锁定层 | 菜单入口、单件复制/删除/层级动作均检查可编辑性；提交前还检查所有实际变更的层，防止已打开菜单及级联修改绕过保护 | 组件回归 + 本机工作台浏览器复验 |
| P1-2 Agent 公共写句柄 | 增删改、批量动线/节点/人员/测量/标注及整批方案拒绝受保护层写入；批量操作原子拒绝，返回 false | 组件行为测试；未调用真实 Agent 服务 |
| P1-3 清单及经纬度写入 | 删除、分区复制、设施经纬度移动补守卫；级联写入被阻止时停止成功反馈 | 组件回归 + 提交层守卫 |
| P2-4 锁层反馈不可见 | 拒绝原因独立显示在图层面板，不依赖选中属性卡是否打开；切换可见性/锁定时清除旧提示 | 工作台浏览器实测出现「设施图层已锁定…」 |
| P2-5 3D 无地面命中右键及旧落点 | 无命中右键仍派发取消/撤点，不猜坐标打开对象菜单；down/dblclick 需要新命中，up/leave 清缓存 | 桥单测 + 独立 3D 浏览器场景 |
| P2-6 清单行右键 | 清单和物件树复用同一行菜单入口与写入守卫 | 组件行为测试 |
| P2-7 临时测量历史 | 从历史/重做快照中剥离临时线，保留其他编辑，合并相邻重复快照；即使退出前已撤掉临时线，也清理重做栈；方案判等统一忽略对象键序及可选 undefined 字段 | 测量会话及保存会话回归 |
| B9/K13 3D 反馈尾差 | 原代码已有单选动线、人员、节点、标注等轮廓，并非全部缺失。本次补动线/人员/测量拖拽预览、动线/节点多选反馈和设施组角柄拾取；修复单选后 Shift 点第二件不能成组 | 组件测试 + 3D 组角柄实际拖动 |
| K8 武装/幽灵与层状态 | 隐藏/锁定时不再绘制设施幽灵或注入 3D 幽灵设施；锁层拒绝武装，放置中隐藏目标层后拖放返回 false | 组件行为测试 |
| F12 每帧全层与人群重建 | 选中、框选和草稿覆盖层与全场几何重建分开；真实模型变换实时更新，全场预览重建按 64ms 合并，提交立即刷新；人群只按已提交方案更新，保持自己的坐标原点 | 调度回归 + CPU 基准；非整机 FPS 验收 |
| F13 捕获失败/取消尾差 | renderer 外松手兜底；pointercancel、失焦和捕获丢失取消预览并恢复轨道控制，不把取消当作提交 | 代码核查 + 既有 2D 指针取消回归；3D 系统强制取消未实机复现 |

首次创建场地保留既有约定：红线默认锁保护已有轮廓，不阻止空白活动首次选址。测量退出清除与设施恒等比缩放的约定均保留。未新增固定测量、比例解锁或完整触屏能力。

### 7.2 可复跑检查与原始结果

相关回归（覆盖本轮修改及保存/场地构建回归）：

```text
npm --prefix frontend run test -- outdoor-plan-canvas outdoor-project-store outdoor-plan-save-lifecycle plan-edit-gate plan-pointer-bridge plan-preview-refresh site-plan-facilities plan-footprint-builder outdoor-plan-session outdoor-write-guard
Test Files  21 passed (21)
     Tests  275 passed (275)
```

本轮相关组件、测试和导入依赖的定向类型检查：

```text
npm --prefix frontend run typecheck -- --project ../.tmp-audit/tsconfig-outdoor-remainder.json
退出码 0，无类型错误
```

该临时配置继承前端 tsconfig，只包含 outdoor-plan-canvas*.tsx、outdoor-plan-3d.tsx、plan-pointer-bridge*.ts、plan-preview-refresh*.ts 与 next-env.d.ts，并检查其导入依赖。它不包含 Next 生成的历史页面类型，也不包含其他窗口新增的发布流程测试；因此不能替代全量 typecheck。

```text
npm --prefix frontend run lint
2082 problems (0 errors, 2082 warnings)
退出码 0
```

标准全量检查仍失败（已执行，未标为通过）：

- `npm --prefix frontend run typecheck`：历史生成文件 `.next-dev/types/app/dev-publish-preview/page.ts`、`.next/types/app/dev-publish-preview/page.ts` 和 `.next/types/validator.ts` 引用已不存在的页面；另有未提交 `publish-flow.test.ts` 的未用变量，以及 `room-organizer-publish.react.test.tsx` 的 symbol 索引和 Testing Library 参数类型错误。
- `npm --prefix frontend run build`：实际执行完整构建脚本，编译后在类型检查阶段因 `.next-dev/types/app/dev-publish-preview/page.ts:2:24` 找不到对应页面失败，`Next.js build worker exited with code: 1`。
- 本轮未重跑全仓 Vitest；§1 的全量基线记录仍属历史证据，不能代表当前工作区全量结果。

### 7.3 浏览器与性能证据

浏览器使用新建、隔离的无头 Edge 会话，阻断外部请求，不读取日常浏览器数据、不调用付费生成或真实云端保存。

1. **实际工作台** `http://127.0.0.1:3000/?local=1`：在本机记录中放入单设施「审计样机A」，从物件树定位后隐藏设施层，画布原位置右键不再弹菜单；锁定层后左键与右键均拒绝编辑，图层面板出现锁定原因。两种情况下本机记录设施集合保持不变。解锁后右键复制，当前记录出现「审计样机A 副本」。页面异常列表为空。
2. **独立 3D 组件场景**：临时本机页面同时挂载真实 Canvas/OutdoorPlan3D，使用两件 3×3 设施、纸面场地。真实指针点击 + Shift 成组，四角柄可被射线拾取并拖动；最终两件均变为 `3.4855252049586847 × 3.4855252049586847`，保持比例。renderer 天空区域右键后模式为 `view`，页面异常列表为空。这验证组件交互，不冒充完整工作台的 3D 接管、真实模型恢复或云端验证。
3. **CPU 基准**：Node/Vitest 中实际调用 `buildPlanFootprint`，120 件设施、60 个预览采样（16ms 间隔的模拟时钟），同次测量结果：

```json
{"samples":60,"facilities":120,"before":{"fullRebuilds":60,"cpuMs":379},"after":{"fullRebuilds":16,"cpuMs":67}}
```

这是场地构建/释放的 CPU 对照，未计入浏览器渲染、真实 GLB、人群或 GPU，不据此承诺 FPS。调度测试另验证最后预览刷新、提交立即刷新、旧预览不能覆盖提交、卸载不再触发尾帧。

本机诊断脚本/截图位于 `.tmp-audit/remainder-*`，未纳入提交；临时 3D 测试页面和性能采样测试已删除，没有向产品增加调试入口。保留的 `planToScreen/groupScreen` 仅扩展既有 development 调试快照。

### 7.4 仍未验证或不属于本轮的事项

- 真实云端 CAS、跨设备冲突及真实 Agent 服务未验证；本机与 mock 结果不作为替代。
- 真实场地、真实模型下的 3D FPS 与系统级指针捕获异常尚未做硬件验收。
- K10 延续桌面优先边界；完整触屏/纯键盘能力仍需产品决策。
- 原验收提到的 CI 门禁属于治理建议，本轮未修改治理配置。
- 本轮没有推送、部署、发布，也未提交其他窗口的在途改动。当前全量 typecheck/build 的阻塞未解除，不能将此报告解读为整体工作区可发布。
