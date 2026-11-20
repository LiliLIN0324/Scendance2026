# 户外规划 · 地图编辑交互审计

- 日期：2026-11-20
- 范围：户外规划里「把东西放到地图上，再改它」的全部编辑交互（2D 画布 / 3D 视图 / 左栏目录 / 图层栈 / 清单 / 属性卡 / 键盘 / 拖放 / 保存与撤销）
- 方式：只读代码审计（未改任何源码），并跑了 2 个相关单测文件取基线
- 证据边界：除验证记录中的单测外，交互后果均来自静态代码推导，尚未做浏览器复现；已有产品约定、实现缺陷与新增能力建议分别标明，不把代码风险当作实机已确认问题。
- 结论一句话：**单点手感打磨得很细（预览→提交、Esc 分层、门贴边、Alt 分叉、顶点合并），断点集中在两处：一是「图层可见 / 图层锁定 / 选中 / 撤销 / 持久化」五套状态各自为政，于是出现「看不见的还能改」「改完不一定存下来」「锁了等于没锁」；二是 3D 只借到了 2D 的编辑逻辑，没借到 2D 的选中/框选/右键反馈。**

## 0. 简写

| 简写 | 文件 |
| --- | --- |
| `C` | `frontend/components/room-organizer/components/outdoor-plan-canvas.tsx`（14,044 行） |
| `O` | `frontend/components/room-organizer/components/outdoor-plan-overlay.tsx` |
| `3D` | `frontend/components/room-organizer/components/outdoor-plan-3d.tsx` |
| `L/*` | `frontend/components/room-organizer/lib/*` |

## 1. 覆盖范围与交互盘点

查过的编辑对象共 12 类：设施（内置模板 / 活动包 / 物料卡 / 生成件）、分区、用地红线、设计范围、墙、动线、出入口节点、人员点位、车辆、测量、文本标注、形状标注；另有 1 类只读对象：场景物件（扫描/户型家具，`sceneObjects`）。

查过的交互通道 4 套：鼠标、键盘（6 个 `window` 级监听）、HTML5 拖放、3D 指针桥（`pointerFromPlan`）。

交互矩阵（✅ 可用 / ⚠️ 可用但有坑 / ❌ 不可用）：

| 动作 | 2D 浏览 | 2D 选择 | 3D | 左栏/属性卡 |
| --- | --- | --- | --- | --- |
| 选中 | ✅ 单击 | ✅ 单击 / Shift / 框选 | ✅ 单击 | ✅ 清单行 |
| 移动 | ✅ 拖本体 | ✅ 单件 / 整组 | ✅ 拖本体 | ✅ 经纬度输入 |
| 旋转 | ✅ 旋转柄 | ✅ 旋转柄 | ✅ 旋转柄 | ✅ 角度输入 |
| 改尺寸 | ✅ 按约定等比缩放 | ✅ 按约定等比缩放 | ✅ 同 2D | ⚠️ 两个输入框只认长边，语义误导 |
| 删除 | ✅ Delete / 右键 | ✅ Delete / 多选卡 | ✅ 仅键盘 | ❌ 单件卡无按钮 |
| 复制 | ✅ Ctrl+D / 右键 | ✅ 多选卡 | ✅ 仅 Ctrl+D | ❌ 单件卡无按钮 |
| 多选 | ❌ | ✅ 框选 / Shift | ⚠️ 仅 Shift 单击，框选无反馈 | — |
| 撤销/重做 | ✅ Ctrl+Z / 工具排 | ✅ | ✅（继承 2D 全局键） | ✅ 工具排按钮 |
| 放置 | ✅ 点击 / 拖放 / Enter | ✅ | ✅ 点击 / 拖放 | ✅ 库行点击 |
| 取消放置 | ✅ Esc / 右键 / 浮条 | ✅ | ⚠️ 仅 Esc（右键被 3D 平移占用） | — |
| 吸附 | ✅ 网格 / 门贴边 / 顶点 | ✅ | ✅ 同 2D | — |

## 2. 断点（路径断掉 / 数据丢 / 状态指向不存在的东西）

### B1 [高] 关页或刷新会丢掉最后 0.4 秒的编辑，且没有任何提示

- 证据：自动保存是 `plan` 变化后 400ms 防抖（`O:268`、`O:830-838`），只在组件卸载时补一次 `flushSave`（`O:840-842`）；户外链路全仓没有 `pagehide` / `visibilitychange` / `beforeunload` 监听（室内有：`hooks/use-layout-persistence.ts:486-513`）。
- 后果：拖完最后一件物料、改完最后一个尺寸，0.4 秒内刷新/关标签页，这次改动只存在于内存；重开回到旧版本，界面此前也没有「未保存」迹象。
- 建议：照室内补 `pagehide` + `visibilitychange(hidden)` 同步 flush；400ms 窗口内状态标「待保存」，不要停在无输出的 `saving`。

### B2 [高] 本机写失败被静默吞掉，仍上报本机保存成功

- 证据：`saveOutdoorProjectRecord` 是 `void`，`setItem` 外层 `catch { /* 静默降级 */ }`，存储不可用直接 `return`（`L/outdoor-project-store.ts:99-113`）；`flushSave` 无法得知结果，仍无条件 `setSavedAt` + `setSaveState('saved')` 并调用 `noteLocalSave(slotId)`（`O:753-757`）。
- 状态链路：父级 `onSaveStateChange` 回调虽为空，但不是唯一出口。Overlay 直接调用统一状态机的 `noteLocalSave / finishCloudSync / failCloudSync`（`O:698-720/757`）；云面板以 `useSaveStatus(layout.id ?? 'local')` 订阅，并显示云端确认、冲突或失败（`panels/cloud-panel.tsx:154/1413-1420`）。户外使用 `slotId` 上报，两者 scope 是否一致、反馈是否容易发现，仍需按实际活动核对，不能据空回调断言「保存状态没有出口」。
- 后果：配额满或其他存储不可用场景中，本机写入失败却被计为已保存；若同时未登录或云端推送失败，本次编辑没有可靠副本，刷新可能丢失。具体可见文案与提示位置待实机确认。
- 建议：`saveOutdoorProjectRecord` 返回 `{ ok, reason }`（参考 `L/persistence.ts:saveLayout` 的 `SaveResult`），失败不置 `saved`、不累加落盘计数，并将本机失败接入可见状态；同时核对户外上报与消费的 scope。保留本机保存与云端同步的独立结果。

### B3 [高] 图层「眼睛」只控制绘制，不控制命中：隐藏层仍可被点选、拖动、Delete

- 证据：绘制按可见性跳过（`C:3339/3391/3503/3612/3681/3759/3773`），但所有命中检测只按楼层过滤（`viewPlan()` = `filterPlanByLevel`，`C:2550-2552`、`L/plan-levels.ts:39-55`），不看 `layerState`：`nearestNodeIdAt/nearestWorkerIdAt/nearestVehicleIdAt/nearestRouteIdAt`（`C:7144-7188`）、设施命中（`C:9998`）、分区（`C:10007`）、红线（`C:8422` 起）全都没有可见性判断。`setLayerVisible` 也不清选中（`C:5106-5113`）。
- 后果：关掉「设施」层后，画布上看不见，但点在原位置仍会选中并拖动它；Delete 会删掉看不见的物件；更常见的是从清单行点进去——画面飞到一个空地点，属性卡照常打开，可以改名/改尺寸/改色。
- 建议：抽一个 `isEditable(kind)` = 可见 ∧ 未锁 ∧ 当前层，命中与清单行统一走它；隐藏层要么不可点，要么点中时给一次「该层已隐藏，已为你打开」。

### B4 [中·语义待收口] 临时测量退出即清符合约定，但共用正式方案与历史

- 证据：`finishMeasure` 把测量 `commitPlan` 进 `plan.measurements` 并记进 `measureSessionIdsRef`（`C:7667-7700`）；`setMode` 离开 `measure` 时调用 `dropMeasureSession()`（`C:2396-2400`），后者把本会话的测量再从 plan 里删掉（`C:7589-7611`）。面板却把它当正式对象：清单有行、图层栈有开关、选中可拖、Delete 可删（`C:7701-7730`）。
- 产品约定：`C:12176-12180` 明确记录 2026-11-16 用户要求「退出自动删线」，关闭按钮也标明「退出测量并清除本次测量」（`C:12224-12228`）。切换工具后本会话测量消失是当前预期行为，不据此认定为数据丢失缺陷。
- 风险：临时测量共用 `plan.measurements`、清单与撤销历史，完成与退出会分别提交新建和删除；可能产生临时状态落盘、历史恢复与会话清理语义不一致的问题，具体影响需复现验证。
- 建议：保留退出清除的约定，先核对临时测量在撤销/重做、刷新及导出时的行为，明确哪些状态应进入正式方案与历史。若要提供「舞台 12m」等长期尺寸线，应单列为固定标注能力建议，确定需求后再设计生命周期；不将新增 `pinned` 字段作为本项默认修复。

### B5 [高] 3D 拖拽越过地平线会落错位置

- 证据：3D 射线打不到地面时 `eventToPlanHit` 返回 `null`（`3D:2035-2047`），但 `onPointerMove/onPointerUp` 仍把 `null` 和真实 `clientX/clientY` 一起送进桥（`3D:2239-2252`、`3D:2049-2060`）；桥里 `pointerOverrideRef = null`、`pointerFrom3dRef = true`，2D 的 `eventPlanPoint` 于是退回「用 clientX/Y 减 2D 舞台矩形」反算（`C:4938-4960`、`C:4594-4601`）。
- 后果：相机贴地时地平线就在屏幕中部，拖着展位往上越过地平线，预览会跳到与 3D 表面对不上的 ENU 点；松手就把物件提交在那里。绘制模式的橡皮筋同理。
- 建议：桥里把「3D 命中为 null」显式传成 `hit: null` 并让 2D 的 move/up 在 null 时保持上一次有效点（或直接取消这次拖拽），不要回落到 clientX/Y 反算。

### B6 [高·代码风险] 同源多标签页共享记录，可能借用另一窗口的 revision 覆盖云端

- 证据：`local-write-lease-provider.tsx:18` 明确写明尚未接入业务写入路径，当前未挂载；`saveOutdoorProjectRecord` 直接 `setItem`（`L/outdoor-project-store.ts:108`）；`flushSave` 每次重读共享记录里的 `remoteRevision` 再推送（`O:741-753`），`pushOutdoorPlan` 将它作为 `baseRevision`（`L/outdoor-plan-sync.ts`）。成功回执又把 revision 写回共享记录（`O:698-702`）。
- 条件与后果：同源、共享同一 localStorage 的 A/B 窗口编辑同一活动时，若 B 的保存成功回执已写入本机记录，A 再 flush 就可能拿到 B 的 revision，却提交 A 尚未合并 B 改动的旧方案。假设服务端按 `baseRevision` 做 CAS 且没有其他并发写入，这次覆盖可能通过；反向同样可能发生。此为代码推导，尚未实测覆盖时序与服务端 CAS 实现，不保证每次都绕过冲突。
- 跨设备边界：不同设备不共享 localStorage，不能由上述路径推导出「多端都不弹冲突」。跨设备的旧 revision 是否被正确拒绝，须单独验证服务端 CAS。
- 建议：评估接入 `LocalWriteLeaseProvider`，并在每个真实存储事务内检查写能力；监听同一活动 key 的外部改动可用于提示，但不能代替写入保护。云端推送应使用本编辑会话确认的 revision：初始化时读取，随本会话成功保存回执或明确接受远端版本后更新，不能在每次 flush 时无条件借用共享记录的新 revision，也不能始终固定为打开时的值。验证连续两次本会话保存、双窗口交错保存及跨设备旧版本提交。

### B7 [高] 选中/定位会指向已删除或不存在的对象，并继续「已定位」

- 证据：`locateIssue` 先 `centerViewOn` 再按 id 选中，不校验实体是否还在，末尾无条件 `setInfoMessage('已定位：…')`（`C:8058-8072`）；`getSelectedIds()` 会把 ref 里的 id 原样交给 Agent（`C:5093-5096`）；问题条目缺锚点时回落 `{x:0,y:0}` 直接飞场地原点（`C:10413-10430`）。
- 后果：点一条已被修掉的问题，视图飞走、文案说已定位，画布没有选中任何东西；Agent 侧拿到悬空 id；缺锚点时飞到一个与内容无关的位置，看起来像「定位错了」。
- 建议：`locateRow/locateIssue` 先查存在性，缺失就明确提示「该对象已被删除」并刷新问题快照；`getSelectedIds()` 过滤不存在的 id；锚点缺失不飞视图。

### B8 [高] 3D 手柄不跟清单选中走：卡片是 A，手柄还挂在 B 上

- 证据：`PlanEditVisuals` 只暴露 `selectedZoneId/selectedFacilityId`（`C:1472-1478`）；`selectFacility/selectZone/selectRoute/selectNode/selectWorker` 只写 ref + `draw()`（`C:5510-5524`、`C:5594-5607`、`C:7091-7119`），不调用 `notifyPlanDraftChanged()`（对比 `setMode` 在 `C:2497` 有调）；而 `draw()` 内部没有该通知（`C:3131-3966` 无命中）；3D 的 `handleFacilityRef` 只在 `syncEditVisuals` 里按 `visuals.selectedFacilityId` 重算（`3D:1697-1703`）。
- 后果：在「已放置物件」里点 A，属性卡显示 A，3D 里手柄却仍画在上一次的 B 上；去抓那枚柄时，2D 按「A 的手柄」判定（`C:8512-8526`），要么没反应，要么按 B 的落点接管——用户以为在改 A。
- 建议：五个 `select*` 末尾补一次 `notifyPlanDraftChanged()`（与 `setMode` 同款），或把选中态并进 `PlanEditVisuals` 的推送键。

### B9 [高] 3D 里动线/出入口/人员/标注没有选中反馈，但 Delete 立刻生效

- 证据：3D 的选中视觉只有「单件设施手柄 + 分区顶点球」（`PlanEditVisuals` 字段见 `C:1472-1512`；3D 消费点 `3D:1697-1701`、`3D:1741`）；而 3D 点击会通过桥选中动线/节点/人员/标注（`C:9993-9997`）；Delete 在 window 监听里按选中集合删除，不分类型（`C:4415-4518`）。
- 后果：在 3D 里点一条动线或一个人，屏幕上没有任何变化；接着按 Delete，删掉的就是这个「看不见被选中」的对象。配合 B8 的手柄滞后，3D 的删除/移动有对着错误目标操作的风险。
- 建议：3D 为 route 画加粗选中线、为 node/worker/annotation 画底环；或在补齐反馈前先禁止这些类型在 3D 被点选。

## 3. 卡点（想做但做不到 / 做了没反馈）

### K1 [中] 等比缩放符合约定，但两个尺寸输入框与边柄注释误导

- 证据：面板给了独立的 W / L 两个输入框（`C:11284-11314`），提交时只取长边：`const major = Math.max(width, depth)`，再用 `sizeWithMajor` 重算另一边（`C:6689-6702`）；`normalizeFacilitySize` 也按模板权威比例重算（`L/facility-footprint-lock.ts:117-137`）。单测直接写明「南面拖动深度变 8，宽度同比例放大」（`L/site-plan-facilities.test.ts:363`）。而 mousedown 的注释写的是「单面拉伸……宽深独立变化」（`C:7075`），与实际行为相反。
- 产品约定：`L/facility-footprint-lock.ts:13-15` 明确记录 2026-11-15 用户口径：2D 缩放恒锁宽高比，3D 按同一系数等比跟随，避免模型变形。等比限制本身符合当前约定。
- 后果：输入框看似允许宽深独立编辑，提交却按 `Math.max(width, depth)` 重算，另一轴被改写或短边调整未生效时没有解释；拖边柄也整体缩放，与「宽深独立变化」注释不符。
- 建议：保留等比约束，明确显示「等比缩放」及联动关系；可以使用「长边 + 比例/派生尺寸」，或按实际编辑的宽/深分别计算等比缩放。修正边柄注释，并验证短边增减、横竖朝向与 2D/3D 一致性。开放比例解锁涉及已有产品约定及模型变形策略，不列为默认修复。

### K2 [高] 属性面板每个键都是一条 undo，30 步历史被一段名字吃掉

- 证据：设施名输入框 `onChange` 直接 `updateFacility({name})`（`C:11152-11158`）；分区名/颜色/透明度同样直接 `updateZone`（`C:10977-11025`、`C:5503-5506`）；`updateFacility` 无条件 `commitPlan`（`C:6579-6606`）；`commitPlan` 无条件 `historyRef.push`（`C:2665-2676`，上限 30 见 `C:1041`）。
- 后果：改一个 8 字的名字 = 8 条历史；拖动一次颜色选择器/透明度滑杆能产生几十条，30 步里只剩最近两三次操作可撤；撤销是「一次退一个字」。
- 建议：文本走本地草稿 + blur/Enter 提交（同卡里的尺寸、经纬已经是这个模式）；颜色/滑杆按 300–500ms 合并；`commitPlan` 加内容相等短路。

### K3 [高] 图层锁只锁画布，不锁清单行和属性面板；锁层点击还没有反馈

- 证据：`layerLocked` 只在画布命中里判断（`C:5129-5131`、`C:8083-8085`、`C:9993-10007`）；`locateRow` 不看锁（`C:8014` 起），`updateFacility` 也没有锁守卫（`C:6579`）；非红线层被锁时点画布没有提示，还会走到「全清选中」分支（`C:10016-10021`），红线段才有提示（`C:5398-5399/8493-8496/8646-8647/10184-10185`）。
- 后果：锁了设施层，画布点不中（像锁住了），左栏点同一行却能选中并改名/改尺寸/改色，锁形同虚设；点在锁住的设施上则是「没反应 + 选中掉了」，用户以为画布卡死。
- 建议：写入口统一加 `layerLocked` 守卫；命中锁层给一次统一提示，保留当前选中而不是清空。

### K4 [中] 3D 里 Alt 分叉失效：3D 送了修饰键，2D 桥没接

- 证据：3D 明确把 `altKey/ctrlKey/metaKey` 放进 flags（`3D:2049-2060`，注释写「否则 3D 里按了 Alt 跟没按一样」）；桥合成事件时只复制 `button / shiftKey / clientX / clientY`（`C:4945-4952`），`altKey` 丢失。
- 后果：3D 里按住 Alt 点已有点不会分叉，也不会出「Alt 只能从已有点分叉」的提示；`handleStageMouseDown(event.altKey)` 永远拿到 `undefined`。
- 建议：合成事件补 `altKey/ctrlKey/metaKey`（flags 已经传了）。

### K5 [中] 3D 没有放置浮条；2D 浮条显示了角度却不能改

- 证据：放置浮条在 2D 画布组件里（`C:12258-12280` 定义、`C:12908-12930` 渲染），3D 接管时整个 overlay 是 `visibility:hidden`（`O:976`），而 3D 文件里没有任何「放置中/取消放置」UI（grep 无命中）。2D 浮条第二行显示「当前 N°」（`C:12940-12948`），但没有可点的旋转控件；落位前旋转只有键盘 `R / Shift+R`（`C:4257-4268`），提示文案里才提到。
- 后果：触屏用户和不知道快捷键的人在落位前无法改朝向；3D 里连「正在放置、怎么取消」都看不到，只能凭 Esc/右键。
- 建议：浮条上加 ±15° 按钮与「取消」并排；3D 复用一个同样的 HUD（浮条本身不依赖 2D canvas，可提到 overlay 层）。

### K6 [中] 拖拽跨出画布或掠过浮层就取消，且不提示

- 证据：2D 只用 `onMouseDown/Move/Up/Leave`（`C:12296-12300`），没有 `setPointerCapture`；`handleStageMouseLeave` 把所有拖拽会话直接置空（`C:10204-10280`），没有任何消息。面板是 portal 到舞台外部的（`C:1332-1334`），鼠标从画布移到浮卡上就会触发 leave。
- 后果：拖动展位时手滑经过右侧属性卡/左栏，物件直接弹回原位，用户不知道是自己「取消了」还是没拖动；3D 侧反而有 `setPointerCapture`（`3D:2211-2225`），两端手感不一致。
- 建议：2D 也改成 Pointer Events + `setPointerCapture`，leave 只清 hover、不清拖拽；真需要取消时给一句「已取消这次拖动」。

### K7 [中] 没有设施之间的重叠检测（动线压设施有，物料压物料没有）

- 证据：放置只校验越界，`buildFacility` 的 `existing` 只用于自动命名（`L/site-plan-facilities.ts:231-265`）；冲突清单的类别只有动线交叉/共线/压设施/缺宽度/容量（`L/site-plan-conflicts.ts:56-61`）；碰撞函数 `facilitiesFootprintsIntersect` 只在阵列预览里用（`C:6776`）。
- 后果：两顶桁架、两个展位可以完全叠在一起，画布、清单、问题页都不会报；执行团队按图搭台时才发现。阵列复制反而会拦碰撞，前后语义不一致。
- 建议：把 `facilitiesFootprintsIntersect` 接进 `planConflictIssues`（或 `planFacilityIssues`），级别用 warning；放置/拖拽落点重合时给一次软提示。

### K8 [中] 在隐藏层里还能放置新物件，提示却说「已放置」

- 证据：`placeFacilityAt` 不检查 `layerLocked('facility')`，也不看可见性（`C:6466-6560`）；`setMode('facility')` 不会自动打开设施层（`C:2396-2503`）。
- 后果：用户之前关掉「设施」层，从库里点一个物料，地图上什么都没出现，右下角却说「已放置…继续单击放置」；接着连点会继续往看不见的层里塞。
- 建议：放置前若目标层隐藏/锁定，自动打开并提示，或直接拒绝并说明。

### K9 [中] 单件属性卡没有删除/复制，只有多选卡有

- 证据：单选设施卡只有名称输入与「阵列复制」（`C:11151-11170`）；多选卡才有复制/删除按钮（`C:10831-10845`）；键盘 Delete/Ctrl+D（`C:4455-4520`）、右键菜单（`C:12535/12551`）是另一套入口。
- 后果：只用属性卡的用户找不到删除；而选中两件时又突然出现按钮，交互语汇前后不一致。
- 建议：单件卡补一对图标按钮，复用 `deleteFacility`/`duplicateFacility`（同一条 undo）。

### K10 [中] 触屏与纯键盘都缺一条完整路径

- 证据：画布只有鼠标事件（`C:12296-12300`），全文件没有 `touchstart/pointerdown` 或 `touch-action`；缩放只有 `wheel`（`C:4160-4171`）；库拖拽是 HTML5 DnD（`C:6138-6144`）；舞台没有 `tabIndex`/`role`，键盘只能靠 6 个全局监听，且画布内没有焦点顺序。
- 后果：iPad 上不能双指缩放、不能从库里拖、不能按 R 旋转、不能右键取消；纯键盘用户无法选中/平移画布，只能靠记忆中的快捷键。
- 建议：明确产品边界（桌面优先就写进引导/入口提示），或补 Pointer Events + pinch + 画布 `tabIndex=0` 与方向键平移（与现有「方向键微调」用修饰键区分）。

### K11 [中] 3D 没桥接右键：取消放置、撤上一点、复制/删除/层级菜单全部不可达

- 证据：3D 只发 `down/move/up/dblclick`（`3D:2179-2282`），从未发 `contextmenu`；右键被 `controls.mouseButtons.RIGHT = PAN` 占用（`3D:914/923/1785`）。2D 右键承担三种动作：取消放置、撤草稿上一点、设施菜单（复制+层级+删除）（`C:12301-12344`、`L/plan-right-click.ts:22-27`）。
- 后果：3D 里放错只能 Esc；画错一个点只能 Esc 重来；复制、层级调整、右键删除都要靠记快捷键。
- 建议：在 `renderer.domElement` 上把 `contextmenu` 转成 `pointerFromPlan('contextmenu', hit)` 并 `preventDefault`（漫游/拖放态除外），右键平移改用中键或 Alt+右键。

### K12 [中] 没有用地红线时，3D 的草稿与幽灵一律不画，且不提示

- 证据：`buildPlanFootprint` 拿不到闭合外框就 `return`（`3D:1731-1734`），而 `addDraftOverlay` 在这个 return 之后（`3D:1742`）；空状态文案只写「切回 2D 画一圈」（`3D:3054`）。
- 后果：在 3D 里选「画分区/画动线」再点地图，屏幕上毫无反应，也不报错，像功能坏了。
- 建议：无外框时退化为在地面平面画草稿；或在工具入口直接禁用并说明「先有用地红线」。

### K13 [中] 3D 框选/组选没有视觉反馈，也抓不到组角柄

- 证据：`PlanEditVisuals` 没有 marquee/组边界字段（`C:1472-1512`）；框选矩形只在 2D 的 `draw()` 里画（`C:3602-3603`）；3D 手柄集合只有单件 4 角 + 4 边 + 1 旋转柄与分区顶点球（`3D:1541-1564`）。
- 后果：3D 里框选是盲选——看不到选了哪些，也抓不到组角柄做整组缩放，只能整组平移（Ctrl+D/Delete 仍可用）。
- 建议：把 marquee 与组包围盒并入 `PlanEditVisuals`，由 3D 画。

## 4. 不舒适（能用，但每次都想骂一句）

| # | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| F1 | `commitPlan` 不做内容相等短路 | `C:2665-2676` | 对齐/分布已在位、输入同样的数字也会压一条历史，30 步更不经用 |
| F2 | 复制只按 +2m 偏移，不校验边界/碰撞 | `C:6826-6840`、`C:7985-7996` | 复制件可能直接落到场地外，问题页只报越界不报重叠 |
| F3 | 画布→清单滚动只覆盖 4 类、40 行、筛选外 | `C:3112-3126`、`C:13114`、`C:1248` | 选中分区/车辆/测量不滚；行在筛选外或 40 行后，切回清单也不补滚，静默无反应 |
| F4 | 选中互斥矩阵不完整 | `C:7124-7130`（车辆不清分区）、`C:5594-5606`（分区不清车辆）、`C:5510`（设施不清标注）、`C:5527-5538`（`clearEntitySelection` 漏车辆）、`C:4365-4378`（Esc 漏车辆）、`C:2562-2576`（切层漏车辆/测量） | 可同时选中分区+车辆、设施+标注；切层后属性卡挂在不可见实体上；只选车辆时 Esc 没反应 |
| F5 | 双击改红线被「设施层锁定」连带禁用 | `C:10183` 用 `facilityDirectEditable()`（= 浏览模式 ∧ 设施层未锁，`C:5124-5126`） | 为了保护物料锁了设施层，结果红线也不能双击加点/删点，且没有任何解释 |
| F6 | 问题条目缺锚点飞 `(0,0)` | `C:10413-10430` | 飞到场地原点，看起来像定位错，而不是「找不到」 |
| F7 | 尺寸/经纬草稿跨选中残留 | `C:2095-2097`、`C:6689-6693`、`C:11287` | 输入框里还留着上一件的数字，失焦时按新选中提交，写出错误尺寸 |
| F8 | 右键能力不一致 | `L/plan-right-click.ts:22-27` | 分区/红线/动线右键撤点；测量/墙/文本/形状右键无动作，只能 Esc |
| F9 | 打开项目就写盘并推一次云端 | `O:830-838` + `O:753` + `O:763` | `updatedAt`/revision 每次打开都 +1，制造版本噪音，还可能一打开就弹冲突 |
| F10 | 只有 Ctrl+Z / Ctrl+Shift+Z，没有 Ctrl+Y；快捷键无 UI 提示 | `C:4239-4254`；全文件只有一处 `<kbd>Esc</kbd>`（`C:12935`） | Windows 用户习惯的 Ctrl+Y 无效；R/Delete/Ctrl+D/方向键/H/S 全靠文案偶遇 |
| F11 | 场景物件可见但完全不可点，且无说明 | `C:3608`（只画）、无命中/选中/删除；`L/plan-item-bridge.ts:21-41` | 扫描/户型家具的虚线框看起来像可编辑物件，点了没反应 |
| F12 | 3D 拖拽每帧重建整层占地与全体人群 | `3D:2239-2251`（每次 move 都 `syncEditVisuals`）→ `3D:1701-1711`（key 含整份 plan）→ `3D:1715-1742`（dispose 后整套重建）→ `3D:1768`（`rebuildCrowd`） | 物件/人群多时拖动掉帧（未实测帧率，属结构性风险）；undo 栈不受影响 |
| F13 | 3D `setPointerCapture` 失败时 `pointerEditing`/`controls.enabled=false` 会卡住 | `3D:2199`、`3D:2229`（catch 空处理）、`3D:2391-2392`（只监听 domElement 的 up/cancel） | 松手瞬间环绕失效一拍，要点一下才恢复 |

## 5. 结构性成因（为什么这些坑会反复出现）

1. **一个 14,044 行的组件同时管画布、面板、属性卡、快捷键、历史**。交互没有独立可测模块：`outdoor-inspector-layout.ts` 只有版式常量（`components/outdoor-inspector-layout.ts:44-147`），「联动」全部内联在 canvas 里。这不是风格问题——B3/K3/F4 都是「同一个判断在 6 处各写一遍，漏了一处」。
2. **没有单一的「可编辑性」判定**。今天是三条独立轴：`layerState`（可见）、`lockedLayers`（锁）、`selectedXxxRef`（选中）；命中、清单、面板、Agent 各取所需，组合语义没人定义。
3. **2D 用 Mouse Events，3D 用 Pointer Events**。3D 有 pointer capture、有 pointercancel（`3D:2389-2392`），2D 没有；同一个「拖动」在两个视图里是不同的可靠性。
4. **键盘监听有 6 个 `window` 级入口**，输入框判断各写各的（`isTypingTarget` 查 contentEditable，`C:4415` 只查 tag）。
5. **本机写入结果未进入保存状态机，户外状态的消费范围还需核对**：本机写失败仍调用 `noteLocalSave`；云端结果已通过 `finishCloudSync / failCloudSync` 进入统一状态机，云面板也有消费者（`panels/cloud-panel.tsx:154/1413-1420`）。应补齐本机失败结果，并核对户外 `slotId` 与 UI 订阅 scope、提示位置；不能把父回调为空等同于「没有出口」。
6. **3D 是「借 2D 的手」的视图，但只借到逻辑、没借到反馈**：`PlanEditVisuals` 只带设施/分区两种选中态与草稿（`C:1472-1512`），选中高亮、框选矩形、右键菜单、悬停手柄都是 2D 自己画的；于是 3D 里能改、却看不见改的是谁（B8/B9/K13）。

## 6. 建议修复顺序

**P0（优先处理数据可靠性与误操作风险，实施前补对应复现）**
1. B1/B2：`pagehide` + `visibilitychange` 同步 flush；`saveOutdoorProjectRecord` 返回 `SaveResult`，失败可见。
2. B3/K3：抽 `isEditable(kind)`，命中 + 清单行 + 属性写入统一用；隐藏/锁定时给一句提示，别静默清选中。
3. K2/F1：文本改名改草稿提交；颜色/滑杆 400ms 合并；`commitPlan` 相等短路。
4. B5：桥接层 `hit=null` 不回落 clientX/Y（3D 拖拽落错点是数据错误，不只是手感）。
5. B8/B9：`select*` 补通知；3D 先给动线/节点/人员/标注一个可见的选中态（或暂时禁止在 3D 点选）。

**P1（语义收口）**
6. K1：保留等比约束，修正尺寸输入语义与错误注释，验证短边编辑及 2D/3D 一致性。
7. K7：设施重叠接进问题清单（函数已有）。
8. F4：抽 `clearAllEntitySelection()`，切层/Esc/撤销/删除统一调它。
9. K9/K5：单件卡补删除/复制；放置浮条补旋转按钮并在 3D 复用。
10. B6：验证同源双窗口覆盖时序，接入写入保护并维护本会话确认的 revision；`storage` 提示不能代替写入保护。跨设备 CAS 单独验证。

**P2（体验与可达性）**
11. K6：2D 改 Pointer Events + capture。
12. K10：明确桌面边界或补触屏/键盘可达。
13. F3/F6/F7/F8/F9/F10/F11：按表逐条收。
14. B4：保留测量退出清除的约定，核对临时状态与方案/历史的关系；固定尺寸标注单列能力建议。

## 7. 验证记录

- 已跑（基线）：
  ```
  cd frontend
  npx vitest run components/room-organizer/lib/outdoor-plan-canvas.test.ts components/room-organizer/lib/site-plan-facilities.test.ts
  → Test Files 2 passed (2)
  → Tests 104 passed (104)
  ```
- 2026-11-20 文档复核时复跑（修订正文前）：
  ```
  npm --prefix frontend run test -- components/room-organizer/lib/outdoor-plan-canvas.test.ts components/room-organizer/lib/site-plan-facilities.test.ts
  Test Files  2 passed (2)
       Tests  104 passed (104)
  ```
  该结果只证明所选测试通过，不证明本报告交互风险已在浏览器复现或修复。本次仅修订审计文档，未修改产品源码。
- 未跑：`npm --prefix frontend run test` 全量、`typecheck`、`lint`、真实浏览器实机（本报告是只读审计，未改代码，因此没有「改动前/后」对比）。
- 未覆盖：小程序端、多人实时协作（if any）、导出/分享链路、云端 Edge Function 的 CAS 实现（B6 的服务端语义只按前端分支推断）。
- 待实机确认：B1 的 400ms 窗口实际丢失时序；B2 本机失败提示及户外上报/订阅 scope 是否一致；B4 临时测量的撤销/重做、刷新与导出行为；B6 双窗口交错保存、本会话连续保存及跨设备旧版本提交；K1 短边编辑与非法尺寸输入的真实表现；F3 的 40 行上限在真实方案里的触发频率。

## 8. 已核查、未发现问题的项（避免误判成「没查」）

- 拖拽「预览→松手才 commit」这条纪律执行得很干净：设施（`C:9088-9105`）、分区顶点（`C:8941` 起）、分区整体（`C:9878` 起）、红线（`C:9416` 起）、测量（`C:9924` 起）、人员（`C:9947` 起）都是松手才写 plan，拖拽过程不进 undo。
- 删除/复制/多选批量操作的 undo 是同一条：键盘、右键、清单行、多选卡最终都落到 `commitPlan`（`C:2665`），没有旁路。
- 面板点击不会误落到画布（`stopPanelMouse`/`stopPanelWheel`，`C:10472-10475`）。
- Agent 整批应用走 `applyWorkflowPlan → commitPlan`，可整批撤销（`C:4757-4771`）。
- 坐标换算链路（ENU↔经纬度、像素投影、bearing）在锚点附近一致，未发现换算错误。
- 2D→3D 交接态不是死路：覆盖层保活不卸载，切换不清模式/草稿/选中（`room-organizer.tsx:5296-5304`、`:2747-2762`），半成品幽灵与未闭合草稿切到 3D 后仍能继续完成。
