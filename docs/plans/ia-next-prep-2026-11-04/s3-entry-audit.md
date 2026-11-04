# S3「空间/物料面板化」入口审计 + 施工卡（分片 A，只读前置）

- 审计日期：2026-11-04
- 审计基线：活仓库 `C:\mujing\Scendance2026` 工作树（S1.0 已完工后的状态；行号全部本轮字符串匹配重新钉死，未跑 git/vitest/build/dev）
- 口径：只读静态审计；所有 `file:line` 相对仓库根；代码标识符原文保留，用户可见建议文案不含「高斯/WorldGen」等内部管线名
- 关联：导演台账 `docs/plans/ia-role-rework-ledger-2026-11-04.md`（§3-C/D、§4-S3）；上一轮 `docs/plans/ia-s1-prep-2026-11-04/s2-review-audit.md`（§3.1 口令函数表，本轮已逐行复核无漂移）；对标调研 `docs/research/ia-2026-11-04/space-materials-tool-panels-2026-11-04.md`（下称 C 板）

---

## 0. 速览

- **空间/物料两脸入口共 21 处**（含按钮/chip/菜单项/overlay/口令槽），其中**重复最严重的簇是「建场/重建」一路四门**：SpacePanel 按钮、AgentChat「＋」菜单、地图浮层采集单回传、CreativeAssistant 业务下拉「场地重建」四路都指向同一个 `openAholoWorkflow`/Lux3dDirectTest 管线；以及**「换场地/新建」两路**（agent-panel 空间 chip、VenuePickerOverlay）。
- **最假的一张脸是物料脸**：它的底部聊天（AgentChat）**零口令分支**，任何自由文本都只回一段拼了画布读数的寒暄（agent-chat.tsx:101），真能力全在聊天框左下角那颗「生成物料」星（MaterialCreateCell）和库卡点击/拖拽里。
- **真能力 vs 假聊天**：空间脸聊天有 4 条真口令分支 + 4 个「＋」菜单项（真开管线），但自由文本兜底仍是假聊天；物料脸聊天 100% 假聊天。**结论：S3 要收的不是「删掉聊天」，而是把假聊天气泡退役、把真动作按钮化/行卡化**，共用 composer 这个形态本身就要拆成「单框 omnibox」（C 板形态 3）。
- **一个生产零入口的孤儿面板**：`VenueLibraryPanel`（venue-library-panel.tsx:15）已挂载 room-organizer.tsx:2040，但 `setSidePanel('venue')` 全仓零调用，永远不渲染——与 UUID 评审链同类的死代码，建议随 S3 一并砍。
- **用户可见禁词实锤（S3 必须清洗）**：「高斯」出现在 SpacePanel、EnvironmentPreview、AgentChat 气泡与「＋」菜单按钮上，共约 9 处（详见 §4.5 红线清单）。

---

## 1. 任务一：空间/物料两脸全部入口穷举对照表

> 行号为本轮实读钉死。「所在脸/槽位」：空间脸 = `activeAgent==='space'`；物料脸 = `activeAgent==='material'`；两脸共用的底部对话槽 = `chatSlot`。

### 1.1 空间脸入口

| # | 入口名 | file:line | 所在脸/槽位 | 承载组件与跳转目标 (file:line) | 触发方式 | 重复度判定 | 处置建议 |
|---|---|---|---|---|---|---|---|
| S1 | chip「新建/换场地」 | `panels/agent-panel.tsx:1925` | 空间脸工具 chips 区（:1922 `ap-space-actions`） | `agent.startVenuePicker`（:1389 `setVenuePickerOpen(true)`）→ `VenuePickerOverlay`（:1667，挂载 room-organizer.tsx:2141）→ `VenuePicker`（panels/venue-picker.tsx:67）+ 空白立壳 `onBlankVenue` | 点击 | 与 S3 重复（都是换场地） | **合并**：并入环境行列表头部「＋加场地」，不再独立 chip |
| S2 | chip「图纸与照片」 | `panels/agent-panel.tsx:1926` | 空间脸工具 chips 区 | `agent.callbacks.onOpenReference?.()`（回调签名 :202）→ ReferenceImageControls 业务参考视图（room-organizer.tsx:2198 `referenceImagePanel`；creative-studio.tsx:980 VenuePhotosPanel） | 点击 | 与「图纸与照片」业务下拉（creative-studio.tsx:1441 `reference`）同源 | **留但归位**：图纸/照片是空间素材，收进空间脸行列表的「参考图」段；不再走业务下拉 |
| S3 | 工作流切换「World 世界模型 / 传统空间」 | `panels/space-panel.tsx:91-95` | spaceSlot（SpacePanel） | `selectWorkflow` → `onWorkflowChange`（room-organizer.tsx:2017 传 `setSpaceWorkflow`，状态 :218） | 点击 toggle | 与 AgentChat 口令「切换传统/切回 Aholo」（agent-chat.tsx:77-85）重复 | **合并**：toggle 是真控件，保留为行列表头部模式段；聊天口令分支退役 |
| S4 | 「生成高斯空间」按钮 | `panels/space-panel.tsx:106-108` | spaceSlot·Aholo 分支 | `onOpenAholo?.('world')` → `openAholoWorkflow('world')`（room-organizer.tsx:1894）→ `setLux3dOpenKind`（:255）→ `Lux3dDirectTest` 浮层（:2155） | 点击 | 与 S5/S8/AC1/AC2 四路同管线 | **合并**：收为环境行列表头部「＋生成场地」omnibox 的 world 档；文案去「高斯」 |
| S5 | 「重建真实场地」按钮 | `panels/space-panel.tsx:109-111` | spaceSlot·Aholo 分支 | `onOpenAholo?.('recon')` → 同 S4 管线 | 点击 | 同上 | **合并**：同 S4，为 omnibox 的 recon 档 |
| S6 | 环境「＋添加场景」菜单 | `panels/environment-preview.tsx:41-57` | spaceSlot·环境段（SpacePanel :118/:136 渲染 EnvironmentPreview） | `onSelect(assetId,name)`（room-organizer.tsx:1166）→ selectEnvironment | details 菜单 | 低重复 | **留，升级为行列表主结构**（C 板形态 1）：现已是行雏形，补 active/显隐/Solo |
| S7 | 环境行（每行：选中/楼层 select/移除 ×） | `panels/environment-preview.tsx:59-79` | spaceSlot·环境段 | 行按钮 `onSelect`（:67）、楼层 `onSetFloor`（:73，room-organizer.tsx:1292）、移除 `onRemove`（:76，:1274）、脚「清空」`onClear`（:54，:1285） | 点击/select | 低重复 | **留，这就是空间脸的主体**（C 板 SuperSplat Scene Manager 结构） |
| S8 | 场景模板 ScenePresetsPanel | `panels/space-panel.tsx:130-132` | spaceSlot·传统分支 | `<ScenePresetsPanel layout onApply active>`（panels/scene-presets-panel.tsx:26）→ `onApply`（= `onApplyCreative`，room-organizer.tsx:1815）落盘 | 点击 | 与 openTemplates（S10）、业务下拉 templates（creative-studio.tsx:1441）重复 | **留**：模板是空间脸的事；业务下拉 templates 档建议收口指向同一处 |
| S9 | 展开/收起 | `panels/space-panel.tsx:142-145` | spaceSlot·传统分支 | 本地 `expanded` state | 点击 | 无 | 留（面板密度控制） |
| S10 | openTemplates（「场景模板」入口） | `room-organizer.tsx:352-356` | CreativeAssistant `onOpenTemplates` prop（:2198） | `showAgent('space')`（:337）+ 聚焦 `#agent-panel section[aria-label="场景模板"] button` | 回调 | 与 S8 同一目标 | **合并**：openTemplates 直接复用 S8，不另开跳转 |
| S11 | StructuralPropertiesPanel 结构属性 | `panels/space-panel.tsx:148` | spaceSlot（两分支都挂） | `<StructuralPropertiesPanel/>`（panels/structural-properties-panel.tsx:18） | 选中物料后 | 无 | 留（选中态属性段，C 板「选中驱动整换」范本） |
| S12 | 新建空白空间确认卡 | `panels/space-panel.tsx:149-160` | spaceSlot | `pressNew('blank')`（:71）→ `isUntouched` ? `startBlank()` : `setConfirm(true)`；确认 → `onApply(createBlankVenue(layout))`（:66） | 点击 | 与 AC3「新建空白空间」同一 `pressNew`（经 `onRegisterNew` :82 注册给 spaceNewRef） | **合并**：确认卡保留（破坏性动作要确认），入口按钮化到 omnibox |
| S13 | 左轨「地图选址」MapRailButton | `panels/agent-panel.tsx:1563-1568` | 左轨工具组（不随脸切换） | `agent.startMapVenuePicker` → `MapVenueOverlay`（:1611，挂载 room-organizer.tsx:2135）→ `AmapVenuePicker`（panels/amap-venue-picker.tsx:38）圈地 + `SiteCaptureCard`（:1659，panels/site-capture-card.tsx:22）采集单 | 点击左轨钮 | 采集单「上传重建」回传（:1630-1638）又走 `onReconUpload` → openAholo recon，与 S5 汇合 | **留**：地图选址是独立入口（户外立壳），不并入 omnibox；但采集单回传重建要与 recon 档显式合并 |
| S14 | 「场地观感」按钮（lux3d 抽屉） | `room-organizer.tsx:2012` | 画布工具轨（leftMode==='lux3d'） | `setLeftMode('lux3d')` + `<Lux3dDirectTest>`（:2155，panels/lux3d-direct-test.tsx:462） | 点击 | 与 S4/S5 的打开目标同一浮层 | **留但去重**：它是浮层开着后的「切回观感」开关，不是独立入口 |
| S15 | CreativeAssistant 业务下拉「场地重建」 | `panels/creative-studio.tsx:1441`（option `rebuild`）；`openRebuild` :1401 | 业务工作区（business 下拉） | `setPlanCategory('rebuild')` → `<CreativeBriefPanel view="rebuild">`（:984）→ `useReconstructionPanel` 的 `zones.rebuild`（reconstruction-panel.tsx:224/636） | 下拉选择 | **第三路重建入口**，与 S4/S5/采集单回传同管线 | **砍/收口**：重建面板（reconstruction-panel）本体复用不重写，但入口从业务下拉撤掉，统一到空间脸 omnibox recon 档 |
| S16 | VenueLibraryPanel「我的场地/可参观模板」 | `panels/venue-library-panel.tsx:15`；挂载 room-organizer.tsx:2040 | 左栏侧栏 sidePanel==='venue' | 「打开/参观/用作模板」按钮（:50/:69/:77），详情卡写「参观占位」（:33） | **生产零入口**（`setSidePanel('venue')` 全仓零调用，grep 实证） | 死代码 | **砍**：生产不可达，仅 2 个测试断言其 JSX 存在；S3 连同测试一起清理 |

### 1.2 物料脸入口

| # | 入口名 | file:line | 所在脸/槽位 | 承载组件与跳转目标 (file:line) | 触发方式 | 重复度判定 | 处置建议 |
|---|---|---|---|---|---|---|---|
| M1 | 物料库 triad 三卡「我的生成/收藏/库」 | `panels/online-model-library.tsx:318-328` | materialSlot（ScendanceLibrary :163 → OnlineModelLibrary cardMode） | `pickPane` 切 mine/fav/lib（:316），展开 :377 | 点击卡 | 低重复 | **留，这就是物料脸主体**；按 C 板形态 2 补搜索置顶 + 右侧详情列 |
| M2 | 库分类 chips + 搜索框（shelf 形态） | `panels/online-model-library.tsx:385-402` | OnlineModelLibrary shelf（底部抽屉形态） | `setBucket`/`setQuery`；chips 含 全部/收藏/生成/类目/自定义标签 | 点击/输入 | cardMode 下分类折叠在结果区（:354-363） | **合并**：cardMode 补齐常驻搜索框（现 cardMode 仅在 query/bucket 时才出工具条 :354） |
| M3 | 物料 tile 点击加入 | `panels/online-model-library.tsx:416-424`（线上）、:444-456（生成件） | 物料库网格 | `addOnline`（:191）→ `loadOnlineCatalogItem` → `latest.current.onAdd` → `placeFromCatalog`（room-organizer.tsx:1039） | 点击 | 真能力 | 留 |
| M4 | 物料 tile 拖拽入画布 | `panels/online-model-library.tsx:417-423` | 物料库网格 | `draggable` + `dataTransfer.setData(CATALOG_DRAG_MIME, 'online:slug')`（lib/catalog-drag.ts） | 拖拽 | 真能力，但落点规则未显式化（C 板形态 4 缺口） | 留，补落点三档说明（§4.4） |
| M5 | 收藏/挂标签 | `panels/online-model-library.tsx:294/:305/:433/:465` | 物料库网格 | `toggleFavorite`/`toggleAssignment`/`addCustomTag`（lib/material-library-meta.ts） | 点击星/针 | 无 | 留 |
| M6 | 「生成物料」星（MaterialCreateCell，composer 档） | `panels/agent-chat.tsx:148` 挂载；组件 `panels/material-create-cell.tsx:14` | 物料脸聊天左下角 | 菜单「通过描述生成物料」(:126)/「拍照图片生成物料」(:127) → `submitMaterialGenerate`（lib/material-generate.ts）text/image（material-create-cell.tsx:57/:71）→ `addPendingMaterial` | 点击星 | 与 M7（OnlineModelLibrary :409 tile 档）同一组件两 variant；与 GeneratedModelLibrary（M8）同属生成管线 | **合并**：这是物料脸真生成入口，位置从「聊天左下角」移到库网格头部「＋」（C 板 PlayCanvas 菜单）；composer 档随 chat 退役 |
| M7 | 「生成」块（MaterialCreateCell，tile 档） | `panels/online-model-library.tsx:409` | 物料库 shelf 轨首 | 同 M6 | 点击 | 同 M6 | 与 M6 合并为一个头部「＋」 |
| M8 | GeneratedModelLibrary 云端生成任务列表 | `room-organizer.tsx:2198`（CreativeAssistant `generationPanel`）；组件 `panels/generated-model-library.tsx:44` | 业务工作区生成面板 | `listGenerationJobs`、engine 默认 `hy3d`（:69）、`markGenerationAdded`（:124） | 打开业务面板 | 与 M6 生成管线同后台但不同 UI（一个提交、一个看任务） | **留，收编**：这是物料脸「我的生成」pane 的云端数据源；S3 把它并到 M1「我的生成」，不再藏在业务下拉 |
| M9 | MaterialCustomization 材质改 | `panels/creative-studio.tsx:1451` | 业务「物料工具/model customize」 | `<MaterialCustomization onApply={applyMaterial}>`（panels/material-customization.tsx:27） | 业务下拉 | 与「材质拖到已放物料」（C 板形态 4 第三档）相关 | **留**：材质能力本体复用；入口后置到选中物料的属性段（不进 S3 主刀） |
| M10 | MaterialCheckinPanel 到场点验 | `panels/scene-delivery-panel.tsx:252` | 执行资料（delivery 视图） | `<MaterialCheckinPanel onSave onExport>`（panels/material-checkin-panel.tsx:43） | 执行视图 | 属交付侧，非物料脸 | **不动**：归 S2/S4 交付链，S3 不碰 |

### 1.3 入口去重结论（给施工卡）

- **建场/重建收敛为一路**：S4/S5/S15 + 地图采集单回传（S13 尾部）+ AC1/AC2（§2）全部指向 `openAholoWorkflow(kind)`。S3 只留一个「＋生成场地」omnibox，内部 world/recon 两档，文案用「生成场地 / 上传照片重建场地」，不出现管线名。
- **换场地收敛为一路**：S1 chip + S12 确认卡 + AC3/AC4「＋菜单项」。S3 把新建/模板收进环境行列表头部。
- **物料生成收敛为一路**：M6（composer 星）+ M7（tile 块）+ M8（云端任务）。S3 物料库头部「＋」= 提交入口，「我的生成」pane = 任务列表。
- **死代码直接砍**：S16 VenueLibraryPanel（生产零入口）。

---

## 2. 任务二：非活动脸共用 composer 的实际行为（真能力 vs 假聊天）

### 2.1 先纠一个前提：S1.0 后两脸根本不走 AgentPanel 的 send()

S1.0 把 AgentPanel 自带 composer（`#composer` form，agent-panel.tsx:1944）门控在 `{conversation && <>…</>}`（:1934），而 `conversation = bingo || activity`（:1804）。因此：

- **活动/审校脸**：用 AgentPanel 的 `.ap-feed` 气泡 + `#composer` 输入条，消息走 `agent.send()`（:1232），落到 `LayoutAgentProvider` 的 `agent.bubbles`（Bubbles 渲染 :1872），是真对话引擎。
- **空间/物料脸**：不渲染 `.ap-feed`、不渲染 `#composer`；它们渲染的是 `chatSlot`（agent-panel.tsx:1932 `{!conversation && chatSlot}`）= `<AgentChat>`（room-organizer.tsx:2017 传入）。**两脸的底部输入条是 AgentChat.tsx 自己的 form（:113），与 AgentPanel 是两套对话、两套存储。**

所以「空间/物料仍共用 composer」这句话的准确含义是：两脸共用的是 **AgentChat 这一个组件**（space/material 各传不同 `agent` prop），而不是活动脸那套真对话。

### 2.2 workbench-agent.ts 口令函数表（本轮字符串复核，行号与 s2 审计完全一致，无漂移）

| 函数 | 行号（workbench-agent.ts） | 正则要点 | 在 send() 的落点（agent-panel.tsx） | 空间/物料脸可达？ |
|---|---|---|---|---|
| `isStopCommand` | :77 | 停一下/停 | :1243 stop/withdrawProposal | 否（活动脸专属） |
| `isGenerateCommand` | :83-88 | 换一版/出一版/生成布置 | :1304 → resolveBriefTurn 生成链 | 否 |
| `isEstimateCommand` | :91-93 | 按图纸估 | :1261 estimateAndGenerate | 否 |
| `isReviewCommand` | :99-103 | 体检/改一版/太挤/动线 | :1295 reviewNow() | 否（S2 已按钮化） |
| `isClientReviewCommand` | :106-110 | 客户评审/评审包 | :1250 与 :1297 onOpenReview | 否 |
| `isMaterialListCommand` | :113-115 | 清单/物料表 | :1256 与 :1291 replyMaterialList | 否 |
| `isCopyDraftCommand` | :118-120 | 文案/宣传语 | :1293 replyDraft | 否 |
| `isExportCommand` | :127-131 | 导出/交接/搭建方 | :1255 与 :1303 proposeExport | 否 |
| `isZoneCommand` | :134-136 | 换区/搬到…区 | :1294 replyZone | 否 |
| `parseMaterialRequest` | :167-181 | 加 N 把椅子/桌子… | :1279 addMaterials(request) | 否 |
| `isGenericMaterialRequest` | :184-186 | 加物料没点名 | :1292 回 MATERIAL_REQUEST_HINT（:188） | 否 |
| `prepareAholoAsk` | :354-365 | 文生场景/文生物件 | :1269，**且只做偏转**：world→「切到空间用 Aholo World」、物件→「切到物料的生成物料入口」（:1274-1275） | 否（活动脸只会把人推走） |

**关键结论**：`send()` 整条口令路由（含 isZoneCommand / isMaterialListCommand / isGenericMaterialRequest / parseMaterialRequest / prepareAholoAsk）都挂在 `LayoutAgentProvider` 状态机里，**只对活动脸（door）可达**。空间/物料脸打这些口令**根本不会触发它们**——它们的输入走的是 AgentChat.submit()，与上表零交集。S3 不需要在 send() 里为空间/物料加任何分支；要动的是 AgentChat.submit() 本身。

### 2.3 AgentChat.submit() 真实分支（agent-chat.tsx:72-103）

```
submit(text):
  appendAgentChatMessage(agent,'you',text)
  if space:
    /传统.*空间|切换.*传统|空白.*空间/  → onSelectSpaceWorkflow('traditional')  (:77-82)  真
    /切回.*Aholo|世界模型|高斯/i        → onSelectSpaceWorkflow('aholo')       (:83-85)  真（仅 set，不弹窗）
    /重建|真实场地|实景|现场照片…/     → onOpenAholo('recon')                (:87-98)  真
    /Aholo|世界模型|高斯|生成.*空间/  → onOpenAholo('world', text)          (:89-98)  真
    其余                              → append('agent', readout(facts))     (:101)   假
  if material:
    （无任何 if）                     → append('agent', readout(facts))     (:101)   假
```

- 三个回调由 room-organizer.tsx:2017 注入：`onNewSpace → spaceNewRef.current?.(mode)`（:231）、`onOpenAholo → openAholoWorkflow`（:1894）、`onSelectSpaceWorkflow → setSpaceWorkflow`（:218）。
- readout()（:27-32）= `场地 X ㎡，这一层 N 件物料` + 一句固定 hint（空间：「空间默认走 Aholo World…高斯场景…」；物料：「物料负责物件规格和模型…」）。纯字符串拼接，不碰任何 state/管线。

### 2.4 真能力清单（有状态/有管线动作）

| 动作 | file:line | 真实效果 |
|---|---|---|
| 切传统空间流程 | agent-chat.tsx:78 | `setSpaceWorkflow('traditional')` → SpacePanel 切到模板/空白分支（space-panel.tsx:124） |
| 切回 Aholo 流程 | agent-chat.tsx:84 | `setSpaceWorkflow('aholo')` → SpacePanel 切到生成分支（space-panel.tsx:99） |
| 口令触发 world 生成 | agent-chat.tsx:93 | `openAholoWorkflow('world', text)` → Lux3dDirectTest 浮层（room-organizer.tsx:2155），带入 prompt |
| 口令触发 recon 重建 | agent-chat.tsx:93 | `openAholoWorkflow('recon')` → 同一浮层 recon 档 |
| 「＋」菜单·Aholo 世界模型 | agent-chat.tsx:138 | `onSelectSpaceWorkflow('aholo') + onOpenAholo('world')` |
| 「＋」菜单·Aholo 重建 | agent-chat.tsx:139 | `onOpenAholo('recon')` |
| 「＋」菜单·新建空白空间 | agent-chat.tsx:142 | `onNewSpace('blank')` → spaceNewRef → SpacePanel.pressNew('blank')（space-panel.tsx:71） |
| 「＋」菜单·从模板开始 | agent-chat.tsx:143 | `onNewSpace('template')` → 滚到 `.sc-space-templates`（space-panel.tsx:74） |
| 物料「生成物料」提交 | material-create-cell.tsx:57/:71 | `submitMaterialGenerate` 真提交 Aholo 文生/图生任务 |
| 库卡点击/拖拽放件 | online-model-library.tsx:191/:417 | `placeFromCatalog` → 画布真落件（过三道门同 onApply 链） |
| 环境行选中/换楼层/移除 | environment-preview.tsx:67/:73/:76 | `selectEnvironment`/`setEnvironmentFloor`/`removeEnvironment` 真改环境槽 |

### 2.5 假聊天清单（仅文案回执，无 state/管线副作用）

| 场景 | file:line | 回执内容 |
|---|---|---|
| 空间脸任意不匹配 4 条正则的自由文本 | agent-chat.tsx:101 | readout：拼面积+件数 + 固定 hint（含「高斯」） |
| 物料脸任意自由文本（**全部**） | agent-chat.tsx:101 | readout：件数 +「物料负责物件规格和模型；生成后再交给 Bingo…」hint |
| 切回 Aholo 分支的文案 | agent-chat.tsx:79 相邻仅传统分支 append | 仅传统分支额外 append「已切换到传统空间流程…」——切回分支（:84）未 append，但也无管线弹窗，属半真半假 |

**假聊天占比**：空间脸聊天输入约 3/4 落入假回执（除 4 条正则外全假）；物料脸 100% 假。这正是 C 板「面板单位是行和卡，不是话」要消灭的形态。

---

## 3. 任务三：agent-chat.tsx 与 AgentPanel 的边界图

### 3.1 两套对话的硬边界

| 维度 | AgentPanel（活动/Bingo） | AgentChat（空间/物料） |
|---|---|---|
| 组件 | panels/agent-panel.tsx:1753 `AgentPanel` | panels/agent-chat.tsx:39 `AgentChat` |
| 服务哪张脸 | door、bingo（`conversation` :1804） | space、material（:61 对 door/bingo 直接 `return null`） |
| 气泡流 | `.ap-feed` + `<Bubbles>`（:1855/:1872）= `agent.bubbles` | `.ap-chat-feed`（:108）= `threads[agent]`（agent-chat-store.ts:46） |
| 输入条 | `#composer` form（:1944），maxLength 600 | `.ap-composer-compact` form（:113），maxLength 400 |
| 消息存储 | `LayoutAgentProvider` 状态机 + `assistant-sessions`（lib/assistant-sessions.ts）会话体系 | **独立 localStorage** `scendance.agent-chat.v1`（agent-chat-store.ts:25），每线留 40 条（:27） |
| 触发动作 | `agent.send()` → workbench-agent 全口令 + scene-script 生成链 | 仅 4 条 space 正则 + onNewSpace/onOpenAholo/onSelectSpaceWorkflow + MaterialCreateCell |
| 建议词 | `AGENT_INPUT_SUGGESTIONS` door/bingo 组（typed-suggestion.tsx:18-19） | 同一份表的 space/material 组（:20-21） |
| 挂载点 | room-organizer.tsx:2017 主面板 | 同 :2017 `chatSlot`，位置在 `{!conversation && chatSlot}`（agent-panel.tsx:1932） |

### 3.2 边界结论（S3 后各职责去留）

- **AgentPanel 保持不动**：它是活动脸唯一真对话与生成入口（S1.0 已定），S3 一行不改。
- **AgentChat 的真动作（onNewSpace/onOpenAholo/onSelectSpaceWorkflow/MaterialCreateCell）上收为面板控件**：
  - onOpenAholo(world/recon) → 空间脸 omnibox（C 板形态 3）；
  - onNewSpace(blank/template) → 环境行列表头部「＋」；
  - onSelectSpaceWorkflow → 行列表头部模式段 toggle（已在 SpacePanel 有，space-panel.tsx:91）；
  - MaterialCreateCell → 物料库头部「＋」。
- **AgentChat 的假聊天气泡 + textarea 退役**：`threads` feed（:108-112）与 form（:113-152）不再作为「对话」存在；改为一条**短指令框**（omnibox，可收起、默认折叠），不再有来回气泡。
- **agent-chat-store.ts 的去向（待拍板，不写码）**：它是 localStorage 假聊天历史，退役后可 (a) 整文件删除（含 agent-chat.react.test.tsx），或 (b) 改造为「动作执行日志」（只记用户点了什么按钮，不记寒暄）。建议 (a)，因为 C 板原则 1「一屏不出现对话气泡」。
- **AGENT_INPUT_SUGGESTIONS 的 space/material 组（typed-suggestion.tsx:20-21）**：space 组例句「用 Aholo 世界模型…」「切换到传统空间模板」是旧聊天时代的产物，S3 随 omnibox 改为「一句话范例 placeholder」（C 板 §1.5），不再是 ghost 打字建议。

边界图（文字版）：
```
左轨四形 ── door/bingo ─→ AgentPanel（真对话，不动）
        ── space ──────→ 环境行列表(SpacePanel/EnvironmentPreview) + [＋生成场地 omnibox]
        │                  ↑ onNewSpace/onOpenAholo/onSelectSpaceWorkflow（原 AgentChat 动作上收）
        ── material ────→ 物料库网格(OnlineModelLibrary) + 右侧详情列 + [＋物料 omnibox]
                           ↑ MaterialCreateCell 上收到库头部
AgentChat.tsx ── 气泡+聊天 form 退役；其 store(scendance.agent-chat.v1) 待拍板删除/转日志
```

---

## 4. 任务四：S3 分步施工卡（按 C 板四形态）

> 每步给落点 file:line 与改动形状；「改哪里」「不要动什么」分开写。红线见 §4.5。

### 4.1 形态 1：环境行列表（空间脸场地/环境条目化）

**现状**：EnvironmentPreview（environment-preview.tsx:14）已是行雏形——每行有选中（:67）、楼层 select（:73）、移除（:76），头部有「＋添加场景」菜单（:41）。SpacePanel（space-panel.tsx:20）外层包了工作流 toggle（:88-98）、生成按钮（:105-112）、模板段（:125-133）。

**分步**：
1. **改哪里** `space-panel.tsx:88-123`：把 Aholo 分支的「生成高斯空间/重建真实场地」两钮（:106/:109）从常驻按钮降级为「＋」菜单项（与 SpacePanel 工作流 toggle 并存但收起）；把 :116「当前高斯环境」段改名为「环境」并直接渲染 EnvironmentPreview（现 :118）。
2. **改哪里** `environment-preview.tsx`：给每行补「眼睛显隐」与「Solo」两个动作图标（C 板 §1.1）；active 行语义已存在（:66 `is-current`）。显隐/暂存字段复用现有 `environments` 数组结构，不新增 wire schema。
3. **改哪里** `agent-panel.tsx:1922-1928`：删空间脸两个 chip（S1 新建/换场地、S2 图纸与照片），因为动作已收进行列表头部；SpacePanel 常驻 `spaceSlot`（:1929）。
4. **不要动**：EnvironmentPreview 的 onSelect/onRemove/onSetFloor/onClear 回调链（room-organizer.tsx:1166/:1274/:1292/:1285）、splatState 加载/挂环境管线（room-organizer.tsx:1131/:1815-1862）、reconstruction-panel hook。
5. **不要动**：ScenePresetsPanel（space-panel.tsx:131）、StructuralPropertiesPanel（:148）——模板与结构属性是空间脸真内容，保留。

### 4.2 形态 2：物料库网格 + 右侧详情列

**现状**：OnlineModelLibrary cardMode（online-model-library.tsx:271-382）已有 triad 三卡（:318-328）+ 网格（:333/:337/:366-369）；但**没有右侧详情列**，搜索框只在 query/bucket 时出现（:354），生成件来源 prompt/时间/模型版本不展示。

**分步**：
1. **改哪里** `online-model-library.tsx:329-376`（sc-lib-results 区）：在网格右侧加一列详情（选中某 tile 时展示 name / 来源 prompt / 生成时间 / engine 版本）；现有 GeneratedModelLibrary（generated-model-library.tsx）的 job 元数据（prompt、engine、时间）是数据源，「我的生成」pane 直接读它。
2. **改哪里** `online-model-library.tsx:354-363`：搜索框常驻（现 shelf 形态 :399-402 已有，cardMode 对齐）。
3. **改哪里** `materialSlot` 挂载（room-organizer.tsx:2017）：ScendanceLibrary（scendance-workspace.tsx:127）本身不改，只在 OnlineModelLibrary 内部加详情列；MaterialCreateCell 从 agent-chat.tsx:148 移到库头部（与 online-model-library.tsx:409 的 tile 档合并为一个「＋」）。
4. **不要动**：addOnline 放置链（:191）、拖拽 MIME（:419）、收藏/标签 meta（lib/material-library-meta.ts）、GeneratedModelLibrary 的云端任务轮询逻辑（generated-model-library.tsx:100-130）。
5. **不要动**：MaterialCustomization（creative-studio.tsx:1451）与 MaterialCheckinPanel（scene-delivery-panel.tsx:252）——后者属交付链，材质入口后置到选中物料属性段。

### 4.3 形态 3：单框 omnibox（收非活动脸对话入口为短指令/动作框）

**现状**：AgentChat（agent-chat.tsx:105-153）有完整气泡 feed + 输入条；真动作只有 4 条正则 + 「＋」菜单。

**分步**：
1. **改哪里** `agent-chat.tsx:108-112`：退役气泡 feed（`threads.map` 列表）——不再渲染来回气泡。
2. **改哪里** `agent-chat.tsx:113-152`：把 form 收为一条**可收起的短指令框**（默认折叠成「＋动作」一行，展开才输入）；placeholder 给「一句话范例」（如空间：「生成一个可容纳 80 人的发布会场地」；物料：「一把户外折叠椅」），不给功能名词。
3. **真动作按钮化**：space 框旁放「生成场地 / 照片重建 / 新建空白 / 从模板」四个动词钮（对应现 :138-143）；material 框旁放「描述生成 / 图片生成」（MaterialCreateCell 已具备）。
4. **改哪里** `agent-chat.tsx:77-100`：4 条 space 正则分支保留但改为直接触发按钮等价物（不再依赖人打正则句子）；物料分支（:101 假聊天）整段删除。
5. **不要动**：AgentPanel 的 `#composer`（agent-panel.tsx:1944）——活动脸对话原样保留；LayoutAgentProvider / send() 口令路由一行不改。
6. **store 去向**：agent-chat-store.ts（localStorage 假历史）随 feed 退役删除，或转动作日志（待拍板，见 §3.2）。

### 4.4 形态 4：拖入画布落点三档

**C 板落点三档**（以 C 板 §1.7/§1.8 为准）：① 拖进 3D 视口 = 放到当前选中物附近/子级；② 拖到空画布 = 新放一件；③ 材质类拖到已放物料上 = 换材质（Blender 类型决定落点）。

**现状**：拖拽只在 online-model-library.tsx:417-423 设置 `CATALOG_DRAG_MIME='online:slug'`，落点由 useItemPlacement（room-organizer.tsx:999）统一按拖拽平面 Y 落件（placeFromCatalog :1039），**没有按「拖到哪」分档**；材质拖到物料上换材质的路径不存在。

**分步**：
1. **改哪里** `lib/catalog-drag.ts` + `use-item-placement.ts`：读拖拽目标——若落在已选中物料附近，提示「关联摆放」；落在空地，新放一件。落点说明写进 placement-hint.tsx（panels/placement-hint.tsx:14）。
2. **材质档**：MaterialCustomization（creative-studio.tsx:1451）已有 `applyMaterial` 能力；S3 只补「材质卡拖到画布物料上 = 触发材质改」的拖拽接线，不重写材质面板本体。
3. **不要动**：placeCatalogItem 过三道门的落盘链（onApplyCreative room-organizer.tsx:1815）、capturePlacement 守卫（lib/catalog-placement-guard.ts）。

### 4.5 红线（硬约束，写进卡面）

- **不动 3D/生成管线**：Aholo/HY-3D/Lux3dDirectTest/reconstruction-panel/scene-script 一律不重写，只收入口与文案。
- **不新增 wire schema**：环境/物料/生成件的存储结构（lib/types.ts、environment-preference.ts、material-library-meta.ts）不加字段；显隐/Solo 用现有 `environments` 或纯本地 UI state。
- **不绕 onApplyCreative 三道门**：任何新落件/换环境都必须过 room-organizer.tsx:1815 的 `onApplyCreative`（绿框预览→唯一确认→撤销）。
- **「场地|物料双 Tab」只写文档决定，本轮不实现**（Non-goal，台账 §3-D）。
- **视觉**：沿用冷石+品牌绿 token，不引入紫/靛色系，不新增依赖。
- **文案禁词清洗清单（本轮实读，S3 必须随面板化一并改）**：
  - space-panel.tsx:89「生成或重建高斯场景」、:92「默认 · 高斯空间」、:104「生成可漫游的 3D 高斯空间」、:107「生成高斯空间」、:116 aria「当前高斯环境」、:121「挂为高斯环境」
  - environment-preview.tsx:42「添加高斯场景」、:43「可添加的高斯场景」、:79「添加一个高斯场景开始布置」
  - agent-chat.tsx:29 hint「走 Aholo World 世界模型生成 Gaussian 高斯场景」、:95「3DGS 高斯场景」、:138 按钮「Aholo 世界模型 · 高斯空间」
  - 建议替换：「场地/环境/空间场景」；world/recon 作内部模式名不上界面。

### 4.6 测试缺口（现有测试静态盘点，未运行）

**现有相关测试（glob 实存 + 静态读）**：

| 测试文件 | 覆盖主题（实读） |
|---|---|
| `panels/space-panel.react.test.tsx` | 3 个 it（:30/:44/:55）：模板+环境+新建空白 onApply；点环境 onSelect；移除环境 onRemove |
| `panels/agent-chat.react.test.tsx` | 2 个 it（:31/:40）：物料聊天左下角有「生成物料」星且菜单两项；空间聊天「＋」菜单「新建空白空间」调 onNewSpace('blank') |
| `panels/reconstruction-panel.react.test.tsx` | reconstruction hook 表单保护/入口（:31/:375/:473），与 S3 重建入口收口相关 |
| `panels/online-model-library` 无独立 .test.tsx（其行为由 creative-studio.react.test.tsx / scendance-workspace.react.test.tsx 间接覆盖，待核验） |
| `lib/workbench-agent.test.ts`（实存 13.8KB） | 口令识别函数单测——s2 审计曾标「待核验是否存在」，本轮确认存在 |

**按四形态应补用例**：
- 形态 1（环境行列表）：行显隐/Solo 切换；「＋」菜单 world/recon/空白/模板四钮均触发对应回调；SpacePanel 在 traditional 与 aholo 两分支下 EnvironmentPreview 都渲染。
- 形态 2（物料库）：选中 tile 右侧详情列展示来源 prompt/engine/时间；搜索框常驻可用；「＋」合并 MaterialCreateCell 后菜单两项仍在（沿用 agent-chat.react.test.tsx:31 的断言迁移）。
- 形态 3（omnibox）：空间/物料脸不再渲染来回气泡（agent-chat feed 断言为 null）；短指令框 placeholder 为范例句；四个真动词钮与按钮化动作等价。
- 形态 4（拖入落点）：拖到选中物附近 vs 空地的 placement-hint 文案分叉；材质拖到物料上触发材质改（可后置）。
- 回归注意：agent-chat.react.test.tsx 现断言「空间聊天无生成按钮」「物料聊天有生成星」——S3 把生成星移到库头部后，这两条断言要改写而非删除。

---

## 5. 待核验清单（编号）

1. **VenueLibraryPanel 死代码确认**：本轮 grep `setSidePanel('venue')` 全仓零命中，判定生产不可达；但 `noteVenueThreeIntent`（room-organizer.tsx:1895/:2136、lib/venue-library.ts:121）仍在被调用，「我的场地」收藏数据（useVenueLibrary hook）是否有其他读方——待核验删面板前是否要保留收藏数据。
2. **online-model-library 是否有独立测试**：本轮未找到 `online-model-library.react.test.tsx`，其 cardMode 三卡行为可能只在 creative-studio/scendance-workspace 测试时间接覆盖，待核验。
3. **GeneratedModelLibrary 与 OnlineModelLibrary「我的生成」合并的数据源**：云端 job 列表（generated-model-library.tsx）与本地生成件（online-model-library.tsx:28 `generatedMaterialCards`）是两套来源，合并 pane 时是否去重——待产品/实现拍板。
4. **agent-chat-store 去留**：删整文件 vs 转动作日志，待 owner 拍板（影响 agent-chat.react.test.tsx 处置）。
5. **Solo 隔离**：C 板 §1.1 待 owner 决策空间脸是否做显式 Solo（当前多场地叠加同画布），本轮只在施工卡列为可选项。
6. **Aholo 是否属禁词**：硬边界只点名「高斯/WorldGen」；现有 UI 大量出现「Aholo 世界模型」（含按钮、hint、建议词），是否一并清洗为「生成场地」类通用词——待 owner 拍板。
7. **Lux3dDirectTest 浮层与 openAholoWorkflow 的非门**：`onOpenAholo={luxDirectVisible ? openAholoWorkflow : undefined}`（room-organizer.tsx:2017）受 `NEXT_PUBLIC_LUX3D_RAIL`（:251）开关控制；omnibox 化后该环境开关的文案降级是否影响入口——待核验。

---

## 6. 边界合规自检

- **只读**：全程 Read/Grep/Glob；未写 frontend 任何文件，未跑 git/dev server/npm/vitest/build/tsc。
- **禁区**：未访问 `frontend/public/ia-board` junction，未访问旧快照 `C:\幕景\Scendance2026`；grep 均限定 `frontend\components\room-organizer`（排除 node_modules/out/.next）。
- **产物**：仅本文件 `docs/plans/ia-next-prep-2026-11-04\s3-entry-audit.md`；未写 index.md / s2-playbook-and-decisions.md / s4-execution-pack.md。
- **行号**：全部本轮字符串匹配重新钉死（s2 审计的 workbench-agent.ts 口令函数行号复核一致）；漂移处已就地注明；未编造数字/URL/API，无法判定项一律进 §5 待核验。
- **文案/视觉**：建议的新文案用「生成场地/环境/空间场景/物料」，未出现「高斯/WorldGen」；未建议紫/靛色系，未建议新增依赖。
