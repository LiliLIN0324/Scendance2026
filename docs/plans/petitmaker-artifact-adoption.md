# PetitMaker 成果与数据流对照

2026-10-10。本文接续已冻结的 [UI 与许可研究](petitmaker-code-study.md)，只查成果、数据和失败处理，不重复前五个界面机制或后端 Agent loop。上游为 `C:/幕景/upstream-references/PetitMaker` 固定提交 [4e120e50c844198649454eec6069ac65a062a732](https://github.com/Stry233/PetitMaker/commit/4e120e50c844198649454eec6069ac65a062a732)，本机 HEAD 与 GitHub 官方 API 一致，提交时间为 2026-10-04T11:00:11Z。幕景链接指检查时的当前工作树，前端仍有其他执行者，行号可能随他们的改动移动。

**导演已采纳并授权实施两个文件处理增量：普通 PNG 失败反馈；示意底图转换的失败终止与尺寸保护。** V4、原件、评审快照、恢复与版本记录已有对应能力，不另做分享格式或替换现有存储。源码研究后，实施仅涉及本文末尾列出的两个文件与两个新增回归文件；没有安装或运行上游依赖、脚本、模型、服务，没有浏览器操作或 Git 写入，也没有重新执行已冻结模块的测试。下述“具体缺口”为修复前源码观察，最新改动与实际验收另列于末尾。

## 一、上游实际成果链

| 成果 | 实际路径 | 携带的数据和边界 |
|---|---|---|
| 可编辑 JSON | [buildSaveFile](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/json-codec.ts#L123) → [serializeWithSections](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/export-json.ts#L198) | 地图核心、notes、注释、可选 provenance/generation/history/session/stats/catalogInfo 与 manifest。可选段由选项决定；不是包含所有应用资源的目录备份。catalogInfo 只描述已使用物件，不打包模型或图片资产。 |
| 可见 PNG | [ExportPanel](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/chrome/modals/export/ExportModal.tsx#L209) → compose/capture/encode → download 或调用者提供的 delivery | 合成地图、可选注释、图层/3D缩略图、说明等画面。332–339 行是普通 PNG 编码；可编辑数据由另行画进图片的可见 PetitGlyph 条带承载，不是秘密 PNG chunk。 |
| 可恢复地图的分享图 | [buildShareCode](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/share/export.ts#L24) → [encodeMapPayload](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/share/codec/payload.ts#L195) → Glyph → 画入 PNG | 可编辑地图、注释、notes、自定义模板及少量来源说明。不能等同完整 JSON：不带完整撤销历史和逐格 provenance；条带容量不足时可能明确省略可省略 notes，甚至只有图片。 |
| 图片恢复 | [inspectImportFile](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/import-file.ts#L68) → [readRasterImage](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/raster-image.ts#L13) → [importFromRaster](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/share/import.ts#L20) | 从像素识别 Glyph，解码、核内容摘要、建立新的地图。没有条带的普通图片返回 `no-payload`，不是用视觉模型猜一份可编辑地图。 |
| 本机工作存档 | [writeAutosave](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/autosave.ts#L65) / [readAutosave](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/autosave.ts#L192) | 一个本机偏好键里的地图、匹配撤销尾部和可选相机，不是跨项目或跨域事务。压缩异步结果有 revision 检查，页面隐藏/离开会同步 flush；空间不足可去 history，再去 provenance。 |

工程分层清楚：`io/json-codec` 和 `io/save-format` 管基础格式与迁移；`io/export-json`/`import-sections` 管可选段；`io/share/{codec,glyph,crypto,raster}` 管分享载体；`io/export` 管尺寸、排版、分块绘制和编码；UI modal 负责预览、选项、取消和交付结果。可学习的是边界和失败结果，不需要把游戏对象、算术编码/Glyph、Pixi 或全部依赖加入幕景。

### 检查、安装与格式版本

[ImportInspection](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/import-file.ts#L31) 返回预览和 `commit`，检查阶段不写当前地图。`readyImport` 59–62 行提交时 `loadMap(state)`，安装新 executor/rule registry，再还原可选段；它是整图替换，不合并跨来源的旧撤销历史。[applyOptionalSections](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/import-sections.ts#L34) 分别还原 generation、session、history，失败返回 dropped，由 UI 提示。核心已经加载时，损坏的可选 history 不使整个地图失败。

[SaveFile](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/save-format/types.ts#L33) 当前核心格式 v2；可选段有独立校验，不都随 appVersion 升级。[migrateToCurrent](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/save-format/migrate.ts#L24) 将缺 version 当旧 v1，按纯 JSON 迁移链提升，拒绝未来版本或缺失迁移路径，并拷贝后盖版本章。[deserializeParsed](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/json-codec.ts#L263) 检查网格规模、模板等；296–306 行会跳过目录未知或坐标非法的物件，377–387 行会过滤无效注释。不能把该流程描述成严格保留全部外来记录，也不应用这种过滤或 dropped 语义处理幕景商务版本、点验事实或合同原件。

### 来源、注释与 hash 的含义

[buildManifest](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/export-json.ts#L136) 写 appVersion、saveVersion、template/catalog hash 与 exportedAt；[verifyIntegrity](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/export-json.ts#L208) 比较去掉自身字段的紧凑 JSON CRC-32。编辑后仍可导入，只加 `modified-after-export` 提示；没有 CRC 的旧文件不因此报警。它是编辑诊断，不是客户批准、身份签名或恢复码。

分享 payload 的 [contentBytes](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/share/codec/payload.ts#L147) 与 [decodeMapPayload](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/share/codec/payload.ts#L229) 核对无密钥 SHA-256：当前 frame 覆盖 canonical 地图、注释、notes、自定义模板；provenance 标志、生成说明及时间等元信息不全在该内容摘要里。`import.ts` 33–38 行明确只有 frame 来源标志，没有逐格 provenance。因此摘要一致只说明相关内容一致，不证明作者、签字、采用或完整历史。

[image-ownership](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/image-ownership.ts#L17) 在本机保存最近 128 条 canonical 地图加 notes 的内容摘要，交付后才登记，共享文件没有该浏览器身份。它只帮助本机识别曾导出的相同内容。[image-attribution](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/core/provenance/image-attribution.ts#L5) 为图片导入保存原 notes 和内容单位，改动比例不到 30% 时保留原说明；该比例是 Petit 产品规则，不是著作权、合同或审批标准，不移植到幕景。

原始照片/图纸、私人资料或合同原件没有通过这个地图分享 codec 被打包。幕景即使以后增加“图片带编辑数据”，也必须另行制定明确白名单、逐项披露和恢复协议；本轮没有这样的需求证据，不作为候选。

### 错误处理与测试证据

- [import-limits](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/import-limits.ts#L3) 在读取前限制文件字节和物件规模；[raster-image](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/raster-image.ts#L13) 对可读 PNG 头先估尺寸，尝试缩小解码，其他路径再按实际尺寸缩放，输出至少 1×1，`finally` 释放 bitmap/object URL/canvas。其 Image 回退仍可能先解全图，不是对所有格式都保证零大图分配。
- [deviceCanvasLimits](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/export/canvas-limits.ts#L18) 实测设备画布，结合 [canvasFitScale](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/export/sizing.ts#L43) 与 [renderBanded](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/export/banded.ts#L74) 分块合成大 PNG，可取消并报告进度。幕景当前普通截图只导出现有视口，尚无高清整场长图需求，不复制大画布探测、分块 PNG 编码器或进度 UI。
- [ExportModal](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/chrome/modals/export/ExportModal.tsx#L276) 的分享码失败可以保留普通图片出口并明确提示；336–387 行将编码、交付异常接到失败反馈，取消不记录成功。不能把这种“图仍能导出”的降级套到原件包：原件字节校验不通过时，幕景应保持失败，不能自动改成仅元数据包。浏览器下载发起也不证明用户磁盘已成功落盘。
- [export-json-e2e](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/export-json-e2e.test.ts#L19) 构建→全段导出→导入→undo；[import-file](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/import-file.test.ts#L47) 检查无写、明确 commit、变更 CRC 提示、超限不读、缩放及 decode 错误；[import-hardening](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/import-hardening.test.ts#L26) 网格、数值、history 与迁移输入不变；[share/import-export](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/share/import-export.test.ts#L37) 编码→像素恢复和篡改不产生错误地图；[png-stream](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/export/png-stream.test.ts#L77) 真 PNG 分块解码后逐字节比较；[autosave](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/autosave.test.ts#L190) 地图和匹配 history、配额失败保旧记录、页面生命周期；[image-attribution](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/image-attribution.test.ts#L97) 成功交付前后本机 receipt 的区别。这些是读到的测试设计，不是本轮运行通过证据。

## 二、幕景实际能力与不移植项

| 对照事项 | 当前实现及结论 |
|---|---|
| 可编辑数据和图片分工 | [local-project-backup.ts](../../frontend/lib/local-project-backup.ts:18) 的 V4 明确覆盖布局、需求、活动/工作单/制作、独立点验历史及可选源图和表单；`modelFiles:false`。普通 [PNG](../../frontend/components/room-organizer/lib/file-io.ts:254) 只是当前画面，不含可编辑包。完整活动包不包含商务域、评审库、聊天或撤销栈；这属于明示范围，不因上游“keep everything”而扩包。 |
| 真正 JSON 恢复入口 | [local-project-backup-panel.tsx](../../frontend/components/room-organizer/panels/local-project-backup-panel.tsx:61) 先选文件、读取、预检和展示，再明确确认；支持 V1–V4 与裸布局旧文件。[creative-studio.tsx](../../frontend/components/room-organizer/panels/creative-studio.tsx:423) 执行完整恢复。已有 inspect/commit 的对应机制，不重建另一导入 UI。旧 ActionsPanel、SidebarDrawer 和未被解构的 `useImportExport.handleImport` 不能当当前主入口。 |
| 源图原始字节 | [source-backup.ts](../../frontend/lib/source-backup.ts:77) 保持原 Blob 字节、验证格式和实际解码尺寸；每图 5 MiB、最多 12 张，不代取云端缺失字节。该格式没有 SHA 字段，不误称所有域都靠 hash；[source-storage.ts](../../frontend/lib/source-storage.ts:163) 同事务读图片/表单，227 行逐字节比较，252 行在独占锁内按预期快照替换，保护全局图片 ID。已强于游戏单键 autosave 的需求。 |
| 冻结、恢复与撤销 | [creative-studio.tsx](../../frontend/components/room-organizer/panels/creative-studio.tsx:304) flush、读回并检查 scope/account/edit epoch；V4 编码后再比源图快照。恢复按域写入、读回、失败补偿，补偿未完成保留 recovery；撤销检查恢复后有没有新记录。点验事实历史合并，V4 源图明确替换，旧 V3 不动源图；文件未含域不能当 absent 擦除。上游整图替换、可选段丢弃、quota 去 provenance 不适合迁入。 |
| 布局落盘 | [local-project-restore.ts](../../frontend/lib/local-project-restore.ts:20) 写存储→解析读回→应用→页面核对；失败回退前检查当前仍是本次写入，不覆盖后来记录。已有对应机制。 |
| 客户评审画面与版本 | [project-review.ts](../../frontend/lib/project-review.ts:233) 白名单冻结，304 行检查图的 snapshotId、scope/revision、捕获时间、目标与明确公开许可。[project-review-workflow.ts](../../frontend/lib/project-review-workflow.ts:110) 等资源和帧、重新绘制、编码前后检查；[use-review-capture.ts](../../frontend/components/room-organizer/hooks/use-review-capture.ts:53) 核视图、参考图、模型和布局；私有底图须显式勾选。已有同一版本图/数据联系，不用本机 receipt 或 30%阈值代替。source revision 为不透明版本标记，不是图片 SHA。 |
| 评审历史库 | [project-review-library.ts](../../frontend/lib/project-review-library.ts:12) 保存 ID、标题、时间、source 与静态 HTML；同编号不同正文拒绝覆盖，草稿 CAS，历史追加。它没有完整可编辑布局或评审 snapshot，不在 V4 中。这里记录边界，不凭“全面学习”默认扩成跨域备份。 |
| 客户采用与内容摘要 | [scene-handoff.ts](../../frontend/components/room-organizer/lib/scene-handoff.ts:16) / [event-operations.ts](../../frontend/components/room-organizer/lib/event-operations.ts:60) 的 basis 摘要只做相关内容变更复核，不包括整个项目和图片库，也不作批准。评审采用有显式人工记录及对应版本，不替换为 CRC、Glyph hash 或图片 receipt。 |
| 商务与交付 | 冻结的 [commercial-dossier-storage](../../frontend/lib/commercial-dossier-storage.ts:115) 和 [commercial-dossier-backup](../../frontend/lib/commercial-dossier-backup.ts:131) 核真实 bytes/SHA-256，manifest 分 included/external/missing，独立工程边界保持。[scene-delivery.ts](../../frontend/components/room-organizer/lib/scene-delivery.ts:97) 是另一交付格式，备份预检明确拒绝把它当可恢复包。合同原件、私人资料与内部交接不自动进入公共图片或客户评审。 |

幕景测试源码已覆盖 V4 原图往返、错误图片不写、跨项目、图片 ID 冲突、最终事务检查、读回补偿、旧 V3 保源图、点验历史冲突/撤销，以及评审来源/画面变化、私有参考图门控和逐图公开。此次没有复跑，以导演已有冻结验收结果为准。

## 三、仅两项可实施候选

### 候选 A：普通截图接住所有编码与下载发起失败

**实际触发。** [room-organizer.tsx](../../frontend/components/room-organizer/room-organizer.tsx:917) 当前只从 `useImportExport` 取 `handleScreenshot`，1345 行交给 [ScendanceViewTools](../../frontend/components/room-organizer/panels/scendance-workspace.tsx:81) 的“画面”按钮。[use-import-export.ts](../../frontend/components/room-organizer/hooks/use-import-export.ts:46) 先同步渲染 3D，再调用 `downloadCanvasAsPng(...).then(...)`，只处理 `toBlob` 回调给 null。

**具体缺口。** [file-io.ts](../../frontend/components/room-organizer/lib/file-io.ts:254) 的 `toBlob` 同步抛出（例如 SecurityError）会使返回 Promise reject，实际调用处没有 rejection 处理；渲染同步抛错也没有统一通知。异步 `toBlob` 回调内 URL 创建或下载点击抛错，同样没有可靠 Promise 终止处理。这里是源码可证实的错误通道缺失，本轮没有用真实浏览器制造故障，不能声称已复现或已修好。

**最小增量。** 借上游 [ExportModal 336–387](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/chrome/modals/export/ExportModal.tsx#L336) 编码、交付、失败反馈完整闭合的思路。在现有 PNG helper 内明确结束编码/下载步骤的异常，在真实调用处接住渲染及异步失败，并复用现有 notice。可以保留 `Promise<boolean>` 接口，不新增导出服务、payload、来源 hash 或模态面板。创建过 object URL 的路径仍需释放；失败不得点击下载或显示成功。成功只表示浏览器已接到下载发起，不声明磁盘读回成功。

**实际验收。** 对 helper 做正常 PNG、回调 null、同步 `toBlob` SecurityError、回调内 URL/点击失败和 URL 释放验证；对当前 hook 做 render 失败及 Promise reject 的明确失败通知，确认无 unhandled rejection、只提示一次、无成功提示和失败下载。现有 [file-io.test.ts](../../frontend/components/room-organizer/lib/file-io.test.ts:9) 未测试此 PNG 分支，需有针对性的回归。最后由前端在其自有浏览器真实点“画面”，打开所得 PNG 核内容和尺寸；单测不能代替这一核验。

### 候选 B：示意底图缩小失败结束读取，不回退到超限原图

**实际触发。** [room-organizer.tsx](../../frontend/components/room-organizer/room-organizer.tsx:1337) 渲染当前 [ReferenceImageControls](../../frontend/components/room-organizer/panels/reference-image-controls.tsx:25)。旧布局上传示意图调用 [readImageAsDataUrl](../../frontend/components/room-organizer/lib/file-io.ts:44) → `downscaleDataUrl`。当前控件已有 PNG/JPEG/WebP、10 MB门控、解码尺寸检查，以及异步期间布局变化/项目切换/卸载保护；这些不需再实现。

**具体缺口。** [downscaleDataUrl](../../frontend/components/room-organizer/lib/file-io.ts:69) 缩放到 1500px 长边；极长极窄图的短边 `Math.round` 可变成 0；需要缩小时 `getContext('2d')` 失败会 resolve 原始大图，绕开缩小意图。`Image.onload` 中的绘制或 `toDataURL` 抛错不被 catch/reject，外层 Promise 可能一直 pending，控件的 `finally` 不执行，界面停在“正在读取图片…”。其 `onerror` 返回原 data URL 再让控件做第二次解码，虽当前控件最终能拒绝损坏图，转换层结果仍缺少明确失败语义。

**最小增量。** 借 [raster-image 53–72](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/raster-image.ts#L53) 的有效尺寸、至少 1px、异常向外传递及释放资源：保留现有 1500px 长边、白底 JPEG 0.85和当前10 MB门控；给转换的加载/绘制/编码路径明确 resolve 或 reject，需要缩小却不能转换时失败并保留旧图。校验宽高为正，转换尺寸最少 1×1，转换异常结束 Promise 并清理临时图/画布。无需复制设备巨幅探测、PNG 条带编码或引入新的图片依赖。

这里处理的是旧布局的**示意预览**。不修改 V4 原件 bytes、照片 storage、图纸表单、对应点或商务原件，不把重编码 JPEG 冒充原始文件。仅这一改动也不能承诺所有图片格式都避免原尺寸解码；若后续出现真实解码内存问题，再单独研究有界 bitmap/header 路径。

**实际验收。** helper 测试正常小图保留、正常大图输出长边≤1500且短边≥1、透明图白底、Image 解码失败、需要缩小但无 context、drawImage/toDataURL 抛错都在限定测试时间内 reject，旧图不被替换。当前 [reference-image-controls.react.test.tsx](../../frontend/components/room-organizer/panels/reference-image-controls.react.test.tsx:8) mock 了 helper，可保留其10 MB/身份/布局保护覆盖，并增加真实错误结果的 busy 结束与失败提示；不能把控件 mock 通过当转换算法已验证。前端在其自有浏览器上传合法大图和窄图、再取消/切项目，核尺寸、错误后可再次上传、旧图保留。若为了错误测试引入 seam，只隔离浏览器读取/编码，不增加生产架构。

## 四、交接边界

导演确认实际缺口后，可先分段实施 A，再实施 B；两项集中在 `file-io.ts` 与截图 hook，涉及共享前端文件，须先协调前端所有权并保留其现行修改。不要顺带重写 UI、schema、V4、source-storage、商业冻结模块或 Agent loop。实现后报告真实修改、针对性测试与前端实际浏览器结果，不能以本文代替交付。

上游代码/素材许可继续以冻结的 [许可研究](petitmaker-code-study.md) 为准。本次只引用代码机制，未复制 logo、图标、插画、目录数据、地图或模型；没有增加第三方运行依赖。上述工程保护不构成专业法律规则。

Windows 双仓库查读期间有一次在上游 CWD 中误读幕景相对路径，以及一次猜错 `venue-photo.ts`；已改为幕景绝对路径并按 `rg --files` 找到实际 `reference-image.ts`。正常文件未损坏、未新建替代文件。复用并窄补 [windows-local-artifacts 的路径与原生命令规则](C:/Users/endTree/.codex/skills/windows-local-artifacts/references/windows-cli-linux-boundary.md)：自有构建脚本经 PS5.1 误读中文路径，改为 UTF-8 BOM 后正确；原生 stderr 警告导致 `NativeCommandError`，改为仅在该命令范围完整捕获输出并据真实退出码判断。图片失败终止规则另补入其 [图片参考](C:/Users/endTree/.codex/skills/windows-local-artifacts/references/browser-image-readiness.md)，Skill 校验已通过。没有改系统代码页、全局环境或业务素材。

## 五、实施与验收记录

- [file-io.ts](../../frontend/components/room-organizer/lib/file-io.ts:44) 保持 `readImageAsDataUrl(file): Promise<string>`，小图原 data URL、1500px、白底 JPEG 0.85 成功行为保持。FileReader abort/error/无效结果和 Image 解码、无效自然尺寸、context/绘制/编码失败均明确 reject；缩后每边至少1px，临时图和画布释放。新的错误文案为固定中文，当前控件保旧图和结束 busy 的逻辑不变。
- [downloadCanvasAsPng](../../frontend/components/room-organizer/lib/file-io.ts:254) 继续 `Promise<boolean>`；同步编码或异步回调中 URL/DOM/点击失败返回 false，创建过的 object URL 延迟释放。没有增加编辑数据、hash 或图片共享协议。
- [截图 hook](../../frontend/components/room-organizer/hooks/use-import-export.ts:46) 继续 `handleScreenshot(): void`，2D/3D成功路径保持；render抛错、helper false 或意外 rejection 提示“画面导出失败，请稍后重试。”，不显示原异常的私有 URL，也不添成功声明。

回归先验证原版：截图6项中4失败，另有2个未处理拒绝；图片helper19项中13失败。修改后 [图片回归](../../frontend/components/room-organizer/lib/file-io-images.test.ts:1) 20项、[截图回归](../../frontend/components/room-organizer/hooks/use-import-export.react.test.tsx:1) 6项通过；增加的异步编码回调失败检查确认URL在失败后也延迟释放。原有 `file-io.test.ts` 与 `reference-image-controls.react.test.tsx` 共13项仍通过，保留可编辑JSON、私有加载URL剥离、底图10MB和身份/布局保护。四个目标文件ESLint退出0，新增可见文案扫描clean/checked63。真实正常下载/参考图上传由前端下一固定副本另验；本文不声明浏览器已通过。

| 文件 | SHA-256 |
|---|---|
| `frontend/components/room-organizer/lib/file-io.ts` | `6ed4a56ff815cd05d0f61a2e8a88edbcf115c4728977d7d83b9eae7a1f645a5c` |
| `frontend/components/room-organizer/lib/file-io-images.test.ts` | `2e429dc3b2c12ad4ca802f224922a8fcae2cd2449bc717cc46e0a0741921c57a` |
| `frontend/components/room-organizer/hooks/use-import-export.ts` | `ca0cedc691096142c1d106104a9b82d96e7f4f3cc8ba805f5ed76f4224404483` |
| `frontend/components/room-organizer/hooks/use-import-export.react.test.tsx` | `9dcb69758c274aeba8484622f8e4bd7f30d707231e3e44d833ce7cfebfb1ca11` |

证据目录为 `C:/幕景/development-evidence/petitmaker-artifact-io-20261010`，含原版red、修复green、原有caller、类型及目标lint日志；独立构建副本在其 `fixed-build/Scendance2026`，排除 `.env*`、原 `.next/out` 和依赖目录后，只用现有依赖junction，不安装、不触主工作树构建缓存或服务。构建与全前端类型检查的最终结果，以该目录 `build-proof.json` 与本文后续状态补充为准。

最终状态：四文件目标lint退出0；全前端 `tsc --noEmit --incremental false` 退出0（strict、exactOptionalPropertyTypes保持）。独立副本 `npm run build` 退出0，完成编译、类型校验和静态导出；`build-proof.json`确认四个原文件与副本SHA保持相同。构建保留既有其他模块import-order及静态export/rewrites警告，未修改那些模块。类型检查最初发现本次测试unused local，最小修正后又遇到前端同事正在写的测试unused import；后者由其负责人修，重跑才记通过，前次日志均保留。四个交付文件到此冻结，后续只针对新的真实失败再改或复测。没有启动浏览器或服务，没有磁盘PNG读回、真图上传或云端AI验收主张。
