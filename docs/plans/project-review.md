# 客户方案评审包 · 第一增量 B

## 2026-10-09 · 原图公开范围与操作衔接检查点

工作台已接入实际平面/三维捕获和逐张核对。最新检查发现：三维显示全部楼层时，选中上层仍可能显示底层原图；捕获端此前只按当前楼层判断，遗漏原图公开许可。现按实际渲染范围判断，旧底图和已标定原图均受保护；没有允许公开时不编码图片。二维上层、隐藏底图或透明度为零时，不再等待看不见的底图解码。

演练活动通过实际界面生成同一快照的二维、三维两张图，分别核对后下载自包含HTML。修改座椅位置后，工作台显示评审已过期并移除旧下载入口。已经下载的离线文件仍是当时快照，不会自动获得后续变更；重新分享前需重新生成。

同轮实操还发现图层选择一组物料会跳到单件属性，遮住批量工具。选择来源已区分：图层类别、自建组和全部物料保持图层；查看单件或画布选择打开属性，同一个主物件再次点击也能打开。仅有一件的自建组同样保留批量入口。

此检查点使用明确标注的假设活动和示意原图，不代表真实测量、客户确认、现场执行或云协作。下文保留初始模块协议及历史接入说明，当前运行状态以最新检查点和开发进展为准。

2026-10-07。本轮目标是一个可集成的快照与离线 HTML 文件模块，不增加第二份项目数据源。文件模块完成不等于客户评审 UI、真实画面捕获、客户确认或完整产品升级已经验收。

模块位于 `frontend/lib/project-review.ts`。来源仍是原 `RoomLayout`、原 `CreativeBrief` 和调用者明确提供的人工记录；不读取存储，不请求网络，不加载模型，不调用生成服务，不访问账号或浏览器资料。HTML 文件不承担可编辑项目恢复；恢复继续使用原备份模块。

## 最小 API

| 函数 | 返回与边界 |
|---|---|
| `createProjectReviewSnapshot(input)` | 同步、脱离原对象、递归冻结的白名单快照；拒绝未完成读取/保存、scope 错配、重复实例身份及非普通数据 |
| `projectReviewIsStale(snapshot, source)` | 比较调用者提供的项目 scope 与不透明 revision；不访问实时项目，不猜内容是否已经保存 |
| `attachProjectReviewImages(snapshot, images, currentSource)` | 返回新的冻结快照，不改变旧快照；拒绝过期来源、图片快照/时间/目标错配与未获准分享的图片 |
| `projectReviewHtml(snapshot)` | 返回 UTF-8 自包含 HTML 字符串；文本转义，重新核验完整图片协议；不触发下载、自动打印或发布 |

```ts
const frozen = createProjectReviewSnapshot({
  layout: stableLayout,
  briefSnapshot: stableBriefSnapshot,
  snapshot: { id: reviewId, generatedAt: new Date().toISOString() },
  source: { scope: stableLayout.id ?? 'local', revision: editorEpoch },
  dataState: 'saved', // 两个来源都已完成保存/读取；否则明确为 unsaved-draft
  dataKind: 'rehearsal', // 与已有 eventOperations 的明确标识一致
  disclosure: { brief: true, design: false }, // 制作者主动选择可公开文字
  notes: [],
});

// 原生保存/下载入口由主前端接入，模块只返回文件内容。
if (projectReviewIsStale(frozen, readCurrentReviewSource())) {
  throw new Error('项目内容已变化，请重新冻结评审包。');
}
const html = projectReviewHtml(frozen);
// 由既有下载工具以 text/html;charset=utf-8 保存 html。
```

以上变量名是接入协议示意，不表示已存在这些 UI 函数。`snapshot.id/generatedAt` 沿用既有 `DeliverySnapshot` 形状；`briefSnapshot` 沿用备份模块的 ready/scope 概念。本模块不要求先生成备份文件，也不依赖 Scene JSON 转换。

## 同一时点与过期检查：调用方必须做的事

1. 在现有工作台取得同一个项目的布局、需求、方案簿与明确分享的人工记录。保存状态为 `saved` 时，先等待两类来源的保存/读取都成功；任何失败不能降格为默认需求或假保存成功。只讨论稳定的未保存内容时，明确使用 `unsaved-draft`，需求仍不能处在 loading/saving/error。
2. 分配一个新的评审快照 ID，保留冻结时间。`source.scope` 和需求 scope 必须都等于 `layout.id ?? 'local'`。
3. `source.revision` 由现有 UI 拥有，必须包含布局、需求、方案簿内的版本内容、人工意见、采用决定的变化，以及项目/身份切换和恢复操作的 epoch。即使恢复到相同项目 ID、云修订号没变或旧保存晚到，也必须使旧包失效。只传云 revision、只比较顶层 layout 引用、只比较数量都不足够。revision 不应直接包含账号、令牌或私有 URL。
4. 创建快照后，若需要画面，用冻结的当前布局或采用布局渲染；不能读取另一份实时草稿并给它贴旧 ID。等图片资源实际就绪，再捕获。调用者保留与本次渲染对应的 `snapshotId/source/target`，在捕获前后、附图前后及实际下载前读取最新来源令牌并检查。
5. 来源变化时丢弃迟到画面，并建立新快照；不能仅把旧图的编号、时间或 revision 改成新值。临时画面 URL 的清理由捕获方承担，模块只接受已取得的 data URL。

纯函数只能检查提供的令牌和元数据是否一致，不能证明像素确实由该布局产生，也不能发现调用者错误重复使用 revision。这需要主前端真实捕获与变更试用验收。离线文件无法主动查询后续编辑、意见或撤销；再次分享旧文件前需要工作台过期检查。不同相机视角可属于同一内容快照，但必须准确记录画面来源。

## 当前编辑版本、采用版本与真实客户意见

`designBook.activeId` 是可编辑的方案标签，不是不可变内容修订，也不是客户采用记录。当前布局始终读取冻结时顶层 `layout`，不能拿尚未刷新的 active variant 副本代替。没有方案簿时版本编号写未记录。

采用版本默认缺失，文件明确写“未记录”。可选 `adoption` 必须包含本轮 `snapshotId`、一致的 `source {scope, revision}`、已有 `variantId`、`basis/sourceLabel/recordedAt/dataKind` 和 `decision`：

- `team-selection` 表示团队明确选定，不表示客户同意。
- `client-confirmation` 还需要对应的、相同资料类型的客户确认 note，目标为 adopted。这是调用者明确提供的记录，不是电子签字或服务端审计。
- 采用当前 active 版本时，冻结当前顶层编辑内容；采用其他版本时，冻结指定 variant 的白名单内容。两者均绑定本次快照，而不是把同一个可编辑标签视作永远不变的版本。
- 不允许沿用旧快照 ID/revision 下的采用记录。调用者不能给旧客户确认重新贴本轮 ID/revision；如果只有对旧内容的确认，应保留旧文件，本轮采用状态保持未记录。未来的不可变版本归档由后续公共契约切片承接，本模块不另建数据库或可变版本库。

`notes` 只接受明确的 `team-check/client-feedback/client-confirmation/pending`，每条附原文、来源、记录时间、资料类型、current/adopted 目标和原物件 ID。所有物件关联按 ID 而非名称查找，缺失 ID 保留并标需复核。记录时间不能晚于冻结时间。没有真实客户意见时保持待补；演练意见、编辑器 apply、团队自查、物料工单 accepted 均不能自动变成真实客户确认。演练项目的已有资料类型不能在导出时改成 real。

V2 设计说明/亮点/要求直接取原 `backendSceneV2.design`，不重造结构化简报。要求的原 satisfied/partial/unmet 状态保留，只作为设计记录；当前布局已缺少关联物件时另标需复核，不宣称已经满足或已现场核验。普通方案没有设计记录时保持待补，可通过明确来源的人工说明参与评审。

## 客户文件白名单与显示层

冻结的评审投影保留场地名称、尺寸、选定的楼层/物件几何、稳定模型编号、必要建筑几何和原设计关联。它不是完整可恢复布局，也没有将完整 `RoomLayout` 或 `Scene` 原样塞进 HTML。

不自动包含原照片、`floorPlanImage`、私有/临时 `glbUrl`、来源图片资产资料、账号和租约、聊天、`notes`、物料工单/活动任务的内部责任与证据、reviewedBasis 或上游 `price`。`disclosure.brief/design` 必须显式提供，未经选择的原需求/设计文字不会进入文件。字段白名单不等于对自然语言中的个人信息做自动识别，制作人仍要检查自己明确分享的文字、物件名称和图片。

正文面向客户：目标、人数、场地、布局示意/静态画面、设计理由、采用与意见状态、待确认项和概念物料数量。原始 UUID、来源代码、逐件定位与快照协议进入可折叠附录。中文类型、尺寸取位和角度换算只发生在显示层，不改快照中的尺寸、坐标、弧度或实例身份。概念数量不是库存、供应商规格或采购承诺；本模块没有活动报价字段，金额未知保持未记录，不能把上游演示价格当报价。

完整模板的 `glbNode` 只说明模板模型节点，不说明物件固定：桌椅等可移动节点不归为固定结构。只有明确出入口、门窗、柱子结构标识才作结构分类。模板节点独立模型交付受限和业务上是否固定是两回事。

## 画面、安全与交付边界

图片必须由调用者明确批准用于客户评审，包含来源说明、捕获时间和 current/adopted 目标。允许来源是编辑器静态捕获或明确提供的评审图片；不从原资料自动挑图。只接受内嵌 PNG/JPEG/WebP，检查 MIME、base64 和文件标识，每图不超过 4 MiB，最多 6 张，编码后的 data URL 合计不超过 12 MiB。该检查不是完整图片解码器，实际显示仍须验证。HTTP/file/blob URL、SVG、HTML 和类型伪装均拒绝。附图与 HTML 输出共用完整校验，不能绕过附图 API 塞入早于冻结的图片或不存在采用版本的图片。

HTML 对动态文字和属性转义，示意图颜色只用安全十六进制值；没有脚本、内联事件、远端字体/库、自动打印或外部资源链接。CSP 禁止脚本、对象、表单及外部加载。输入含函数、getter、自定义对象或 toJSON 时先拒绝，不执行输入回调。

矩形普通布局复用既有 `layoutToSvg`，明确标“编辑示意、非实测、非施工图”，不包装成完整三维或图纸还原。完整场馆、多边形或 V2 结构不用简化矩形图冒充完整场地，继续提供文字与明确附加的同快照静态画面。原照片与底图不进入自动示意。

本模块不调用 Three.js 交付管线。完整模板、未归档模型、多层、部分本地建筑扩展、底图/多边形等已识别限制及依据独立列出；稳定资产 ID 不代表模型已授权或文件已交付。限制扫描并非完整 Scene JSON/GLB 门禁验收，没有列出限制也不表示转换已通过。模型门禁失败不阻止评审文件产生。

## 本轮证据与后续接入

- 最终四文件交付已冻结：`frontend/lib/project-review.ts`、`frontend/lib/project-review.test.ts`、本说明与下列示例 HTML。快照模块与正文渲染已完成本轮可验收范围；当前模块不接 UI。
- 现有30人样例输出 [community-open-day-review.html](../examples/community-open-day-review.html)，来源为原备份与明确标注的演练人工说明。人数、10×8米、39件示意物料和假设预算背景保留；没有编造采用版本、真实客户意见、供应商报价、实际反馈或现场验收。
- 2026-10-07 最新渲染对应的48项定向测试通过，覆盖来源冻结、待定/演练/草稿保真、当前与采用版本/物件对应、缺失关联、Scene JSON 门禁失败后的评审出口、图片同快照/过期、注入与隐私，以及显示层与样例实际内容。样例正文汇总为6组共39件；移除折叠附录后正文无内部类型、原UUID、浮点尾数或弧度，附录保留逐件追溯。相同尺寸但不同未归档模型不误并，非当前采用版本不把项目名冒充版本名。测试是模块证据，不是 UI 接入证据。
- 前端完整类型检查通过，最终复核禁用增量缓存；本轮不运行生产 build、不停启3157、不提交/推送。共享分支其他改动保留。
- 实际文件已被独立浏览器打开；导演已重新加载33573字节的新正文，看到短状态、目标、人数、场地与后续布局，正文未再出现调用方、原UUID或浮点尾数。模块测试继续确认39个示意物件、无外部资源、无脚本；这不代替导演后续静态页面复查。
- 附录使用原生 `details`，默认没有 `open` 属性，因此默认折叠。外部可见文字提醒完整打印前展开附录并核对预览；本轮不自动打印、不承诺打印时自动展开。已提供A4页边距、重复表头、行/画面尽量避免跨页、附录另页和打印色彩样式。
- 未完成范围仍是：真实工作台按钮、保存之后的评审回读、真实三维捕获、异步变更过期试用、下载交互、打印预览/纸面输出或真实客户沟通验收。静态页面复查和打印尝试交由导演；CSS 与 DOM 检查不作为实际打印验收。

在 frontend 目录复现：

```powershell
npm test -- lib/project-review.test.ts --maxWorkers=1
npm run typecheck -- --incremental false
```

显式重建样例（普通测试只读已生成文件）：

```powershell
$env:SCENDANCE_WRITE_REVIEW_EXAMPLE = '1'
npm test -- lib/project-review.test.ts --maxWorkers=1
$reviewExampleExit = $LASTEXITCODE
Remove-Item Env:SCENDANCE_WRITE_REVIEW_EXAMPLE
if ($reviewExampleExit -ne 0) { throw '评审样例重建测试未通过。' }
```

本切片只交付模块、说明和可检查示例。主前端后续沿原工作台整合评审入口与同快照捕获；完整范围仍按 [产品升级计划](product-evolution.md) 推进。

## 导演实际打印验收

2026-10-07：最终模块51项定向测试及完整前端类型检查通过。导演在独立浏览器打开真实HTML，通过浏览器打印引擎输出A4，再用Poppler逐页渲染检查。已修复默认折叠附录独占空页、布局标题与首图分离、物件长标签重叠和倒置；默认客户版为3页，评审编号始终可见，打印文件另附页码。快照原始名称和几何保持不变，逐件追溯仍在HTML的可展开附录中。

可检查的[三页PDF样例](../examples/community-open-day-review.pdf)与HTML采用同一评审编号。本次实际打印验证的是默认关闭附录的这份演练内容；不代表任意项目、展开附录、多楼层或真实图片捕获的所有打印组合均已验收。真实工作台入口与捕获仍待整合，真实客户意见仍未记录。

## 2026-10-08 最小工作台接入计划与 props

录音 C01:06:53 的本轮落点是帮助客户对照需求、平面与三维看懂方案。本切片不建设客户审批库或新版本库。实施顺序为独立准备/捕获辅助模块 → 独立评审面板 → 根与主前端接入现有工作台 → 根执行构建和真实浏览器验收。

本对话维护 `frontend/lib/project-review-workflow.ts`、对应测试、`frontend/components/room-organizer/panels/project-review-panel.tsx`、CSS和React测试；原 `project-review.ts` 仅补未批准画面的来源/格式验证复用接口。共享 `creative-studio.tsx`、`room-organizer.tsx`、`use-import-export.ts` 和渲染/保存hooks仍归主前端，不在本对话并行修改。矩形场地编辑由另一负责人继续。

面板契约：

```ts
interface ProjectReviewBase {
  layout: RoomLayout;
  briefSnapshot: BackupBriefSnapshot;
  source: ProjectReviewSource;
  dataState: 'saved' | 'unsaved-draft';
  dataKind: 'unspecified' | 'rehearsal' | 'real';
}
interface ProjectReviewPanelActions {
  getSource(): ProjectReviewSource;
  prepare(): Promise<ProjectReviewBase>;
  capture?(snapshot: ProjectReviewSnapshot, options: { includeReference: boolean }): Promise<ProjectReviewCapture>;
}
interface ProjectReviewPanelProps {
  source: ProjectReviewSource;
  actions: ProjectReviewPanelActions;
  disabled?: boolean;
}
// ProjectReviewCapture 是不含 approvedForCustomer 的单张当前画面。
```

`source` props须在布局、需求、同ID恢复、切项目或身份变化时更新，`getSource`用于每次异步边界和下载前复核。revision采用不透明epoch，不放账号、令牌或私有地址；仅切换二维/三维视图不改变业务来源，同一内容快照可补充不同视角。`prepare`复用现有需求flusher/保存回读与操作保护，不把默认需求或失败读回当真实来源；当前布局未经保存确认时明确为草稿。准备期间的业务内容变化取消整次准备。

`capture`由主前端接现有真实canvas/renderer/scene/camera，调用本切片的 `captureProjectReviewCanvas(snapshot, adapter, {includeReference})`。适配器提供 `getState()`、`waitForReady(source)`、同步 `render()`：

- `getState`含当前source、canvas、完整已提交frameRevision、viewLabel、ready/assetsReady，以及pendingPreview/interacting/privateReferenceVisible。frameRevision在对应布局、资源和显示效果真正提交并绘制后才更新，不可用引擎isReady或单独家具编号代替。
- `waitForReady`只等待本次画面已有资源及渲染完成，不发起付费生成或云写入。若资源失败，拒绝画面；二维也须保证对应当前布局已重绘。
- 模块在等待前、绘制前、绘制后和编码后检查来源、frameRevision与canvas身份。三维同步重绘后在同一任务中取PNG，避免未开启preserveDrawingBuffer造成空图。
- 有未应用候选、拖拽/分区草稿时拒绝画面，不隐藏候选root来冒充已提交布局。底图默认不允许，但用户可明确勾选“允许在评审画面中包含当前参考底图”，传 `includeReference:true`；画面标明含已允许公开的参考底图，捕获后仍须核对批准。不能用一律排除原图的文字包替代原图/平面/三维帮助客户理解的目标。
- 等待期间切视图/canvas，或编码期间绘制版本/视图变化，仅拒绝这次画面；业务来源未变时文字快照仍可保留，用户可重试或明确无图导出。同一快照可追加二维/三维画面，最多6张，不能为旧像素重贴新快照编号。

面板默认不公开需求/设计文字，制作者主动勾选。简短说明和待确认项只作为本次文件的明确手工记录，不自动读取内部工单联系人或私密原始转录。捕获画面先本地显示，核对批准后才附入客户HTML；批准不是客户确认。捕获失败保留有效文字快照，须明确选择无图出口。预览使用无脚本sandbox iframe，下载复用既有文本下载工具；不自动分享或打印。

本切片验收覆盖：准备/捕获/编码期间的变化与卸载取消，缺需求/保存失败/草稿保真，画面资源/候选/底图门禁，画面批准前不进入HTML，捕获失败明确无图，编辑/恢复/切项目后旧包过期并禁止下载，联系人/转录不自动导出。根负责真实2D/3D、模板与模型加载失败、实际文件回读与打印验收；模拟canvas测试只证明保护协议。

### 2026-10-08 独立模块冻结回执

上述面板、CSS、React测试、workflow与测试已落盘；原 `project-review.ts` 增加未批准画面单张/整组验证接口，复用既有数量、大小和来源校验。捕获数据仍不含 `approvedForCustomer`；逐张核对后才附入客户文件。追加超限或失败保留原已核对画面与原文件，同一内容快照最多补充6张二维/三维画面。底图许可默认关闭，用户明确允许后仍需核对捕获结果。

捕获状态读取会复制来源与原子状态，避免复用可变 `ref.current` 绕过等待、绘制和编码比较；本轮参考底图许可也在入口固定。已覆盖等待中原地改来源/视图/canvas、绘制中原地改版本、迟到许可改变和canvas尺寸变化的反例。

3套定向测试共111项通过（原模块51、workflow27、面板33），完整前端类型检查通过，面板文案检查 `--strict` 通过。首次联合类型检查曾遇共享二维捕获缺 `hasCollision`，根补齐后最终检查通过；本切片没有修改该共享hook。

本回执冻结的是独立代码与接入契约。根已接共享入口，仍需其完成生产构建、真实2D/3D与底图捕获、多图同编号、变更失效、下载回读和打印检查。本切片没有操作浏览器/服务、运行build、提交/推送，未把1px或合成PNG测试数据当真实画面证据。

### 2026-10-08 当前工作台内容的实际打印复核

根从默认5物件项目实际捕获三维与二维画面、核对并下载同一快照HTML，确认下载内容SHA一致；修改布局后旧包失效。使用该真实导出内容做打印紧凑化，未改变正文、图片字节或业务数据：布局不再强制另页，标题/摘要与首图保留避免断页关联，SVG限高100mm、截图限高95mm，居中保持比例，不裁剪内容。

根已用 `C:/幕景/development-evidence/workbench-review-print-compact.html` 实际打印，得到 `C:/幕景/development-evidence/workbench-review-compact.pdf`，311892字节、3页A4，并逐页查看 `workbench-review-compact-1.png` 至 `-3.png`。回执确认标题与首图同页、图片居中保比例、表格文字无截断，较先前5页版减少大片空白。原真实HTML与紧凑预览除style外字节完全一致。本项打印样式据此冻结，不继续美化扩展。

最终端到端边界仍保留：根从新build的工作台重新生成、下载，并核对新打印样式实际进入文件；上述样式替换后的实际打印不能代替这一项。根对三维参考图按当前referenceUrl等待mesh/纹理就绪、受控捕获失败原因和面板提示的修改继续保留；这不表示此前首帧failed的原因已被解释，其新增回归结果以根的后续回执为准。
