# 客户方案评审包 · 第一增量 B

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
