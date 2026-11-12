# 商务本机记录与原件包接线交接

2026-10-09。本轮只新增存储、独立包及对应测试，没有接线界面、改V1–V4、签署或收付。固定JSON契约是 `supabase/functions/_shared/commercial-dossier-contract.ts`；本轮不修改它。最终界面与原生浏览器验收另由前端执行，测试通过不代表合同功能已完成。

## 本机容器与界面边界

入口为 `frontend/lib/commercial-dossier-storage.ts`。专用键是 `['commercial-domain', projectId]`，单个forms记录包含 `{schemaVersion:1,storageToken,dossier,originals}`。公共dossier仅用冻结契约，Blob只在私有originals中；其键是附件UUID小写，公共编号原拼写保留。没有存入layout、AI、分享、客户评审、时间表或云Scene。

每个读写动作都必须传同步 `CommercialContextGuard`。界面须在读取前判定明确本机活动，捕获稳定本地projectId、模式和单调epoch，并在guard里核当前仍一致。正式云项目不能悄悄按相同ID读取；账户、活动来源或模式变化须使旧guard失效。库只执行这个同步上下文守卫，不证明账号授权、团队权限或加密。不可传async guard，不能在正式界面用空guard冒充边界检查。

读取返回 `CommercialRead`，只有真正没有记录才为 `{status:'absent',projectId}`；否则为 `{status:'present',projectId,value}`，打开数据库、schema、实际原件读取或摘要错误会reject，不能解释为absent或清空。UI自行保留loading/error状态和上层输入，guard通过后再展示结果。

## 稳定存储接口

```ts
readCommercialSnapshot(projectId, guard): Promise<CommercialRead>
prepareCommercialOriginal(metadata, blob): Promise<PreparedCommercialOriginal>
verifyCommercialOriginal(attachment, blob): Promise<void>
validateCommercialSnapshot(projectId, value): Promise<CommercialStoredSnapshot>
saveCommercialDraft(projectId, input, guard): Promise<CommercialRead>
freezeCommercialVersion(projectId, agreementId, expectedDraftToken, metadata, guard): Promise<CommercialRead>
appendCommercialSignatureReport(projectId, report, additions, guard): Promise<CommercialRead>
discardCommercialDraft(projectId, agreementId, expectedDraftToken, guard): Promise<CommercialRead>
restoreCommercialSnapshot(projectId, incoming, expectedDraftTokens, guard): Promise<CommercialRead>
```

`prepareCommercialOriginal`的metadata类型为 `Omit<CommercialAttachment,'sourceState'|'mimeType'|'byteSize'|'sha256'>`，调用方保存真实File.name及录入信息。它核原字节的基础PDF/PNG/JPEG标识、大小和SHA，生成local-file元数据；不压缩、重编码或外链下载。基础格式检查不证明文档正文、签署人、法律效力或安全预览，后续界面不要用这些结果显示平台验签。

草稿input包含agreementId、direction、dataKind、expectedDraftToken（首次或无目标草稿为null）和不带token的draft，可带attachmentRefs、prepared originals及cleanupUnreferenced。业务内容修改后换目标token；同内容保留token。固定版本metadata仅id、recordedAt、recordedBy、fixingNote，在事务内取当前草稿内容及前版，生成不可变版本并关闭草稿。这不是签署。人工报告包括reported_signed、correction或void，始终追加到确切固定版本；固定/报告的ID与录入信息由明确动作提供，未确认读回前勿重新造ID重复提交。

同一forms原生事务保存记录及原件。异步字节读取/摘要在事务前，updater内同步核guard、目标draftToken、预先核验容器的storageToken，并调用公共历史守卫。合法模块的每次写都换storageToken；遇其他页面合法更新最多重试3次，原草稿token仍须一致。不要绕过这些接口对专用键直接put、沿用revision或只写Blob；revision协议保护异步核验到同步事务的间隙，不是任意同源脚本篡改存储的授权或隔离机制。现有Blob在写前和读回都重新核实际SHA；同大小不同字节会被明确拒绝/诊断，不能只用size称原件一致。

只有transaction complete并独立读回本次操作的草稿/原件一致才返回。当前仍存在的所有原件照常逐件核实际字节，全部固定版本、原报告、更正/作废历史及其证据照常核历史守卫。本次新加但暂未引用的原件也必须确认；恢复明确确认输入包携带的原件。无关草稿的临时附件可以在提交与读回之间合法解除引用/丢弃，不因此误报本次操作。读回也可包含合法新追加历史，不要求整容器JSON精确等于提案。若已经commit但本次草稿/原件读回失败或scope变更，抛 `CommercialReadbackError`，其committed为true；保留输入、重新读取核对，不说未提交，不盲回滚或删除已追加事实。事务前/事务失败则旧完整容器保留。保存/恢复不是现实业务撤销入口。

普通草稿解除文件引用并明确cleanup后，只清该约定的未引用临时附件。固定版本及所有原报告、更正、作废引用的附件永久保留。discard只丢弃可变草稿及其未用原件，不能删除固定版本或报告。local-file声明却缺实际Blob或SHA不符是读取/保存错误；external-reference/missing可保留未知，不能假称已存原件。

## 独立包

入口为 `frontend/lib/commercial-dossier-backup.ts`。

```ts
encodeCommercialBackup(snapshot, metadata): Promise<CommercialBackup>
serializeCommercialBackup(snapshot, metadata): Promise<string>
preflightCommercialBackupJson(text, targetProjectId): Promise<CommercialRestoreCandidate>
restoreCommercialBackupJson(text, projectId, expectedDraftTokens, guard): Promise<CommercialRead>
```

专用format为scendance-commercial-domain-backup，version为1；生成id/generatedAt由调用方固定提供。coverage的commercialDossier/originalFiles表示台账与本次已有原件覆盖，逐件manifest仍明确included、external-reference或missing，不能一概说所有原件已携带。初版仅完整台账与已有原件包；local-file实际读取/格式/摘要失败整包停止，不自动降级台账出口。PDF/PNG/JPEG每件10MiB，项目原件32MiB；base64有编码上限，最终UTF-8 JSON另限64MiB。这是内部离线档案，没有加密、对外披露许可或电子签证明。

present包的dataKind必须等于dossier性质；absent包为null，不制造性质声明。headerless旧布局只有现有parser认可信且无需修复时才认not-in-file，否则拒绝。

encode/serialize为纯函数，不自行读取存储或推断当前界面身份。UI须用本次guard通过的快照，编码前后及实际下载前再次检查模式、projectId和epoch；项目切换后不得把旧原件包下载当成新项目出口。

预检不写存储，整个包的版本、strict JSON、project、资料性质、历史图、清单、规范base64、实际长度/格式/SHA均通过后才给present候选。合法V1–V4无此领域返回not-in-file，界面应明确所选文件不是商务包；损坏文件不能落成undefined或表面成功。absent/not-in-file恢复只重读目标不删除，任意损坏不能借noop接口放行。

同项目恢复使用公共merge作不可变历史并集，冲突、分叉、跨project或不同资料性质整笔拒绝。包中草稿有变动时，expectedDraftTokens必须来自目标本次读取的agreementId→token/null，不能取来源包token。新目标草稿生成新token，同内容幂等保留目标token，来源无草稿不清目标草稿。不会自动重编号为新项目，不提供删除签署事实的撤销恢复。

下一步由前端按此守卫与错误契约接到现有商务资料入口，完成真实保存/刷新、并发、原件下载和独立包往返后再报告功能完成。

## 初次冻结与验证（下节有更新）

2026-10-09 21:04至21:06，北京时间。新增storage40项、backup61项共101项通过；连同source-storage事务/快照、material-checkin-storage及source-backup共6套160项通过。冻结商业契约另复验19项通过。实际跨两模块的完整包测试没有mock storage，使用同一串行IDB替身保存后导出，再恢复到同项目空目标，核原字节、记录及新目标token；这不证明真实浏览器双页或账户边界已接线。

全frontend `tsc --noEmit --incremental false`通过，当前配置strict和exactOptionalPropertyTypes均为true；四新文件ESLint `--max-warnings 0`通过。没有运行frontend build、浏览器或服务，没有stage/commit/push。

| 新文件 | SHA-256 |
| --- | --- |
| frontend/lib/commercial-dossier-storage.ts | 02b592a22c515230f941adfc72a90788bc6730f47d9856b56b14cc603d870320 |
| frontend/lib/commercial-dossier-storage.test.ts | 4a33177a4d05d481b066e5cb8b7c2a526d90b80e073642eee756e7b8b8dcb5fc |
| frontend/lib/commercial-dossier-backup.ts | 3dab556c704e7ec5f037605b41b1e390dd43f4c2280ef96450164dbac65f39f0 |
| frontend/lib/commercial-dossier-backup.test.ts | bba4dc66b88d840f3e2e41a4a9327fa4e5bf7897556da343e8b86f73320ee6a9 |

冻结公共契约818fbccd6f20107ac439fb6a382bdf32086d1444e7051e2ee2862ad8134f690d、其原测试1e722814f37ce9c833656bb3562eeab66e528f2704a0e571f066a2c26a5ac78b均保持不变。独立只读存储审查的增量数组取值器P2已修并由零调用/无写入回归闭环；包提交后guard失效丢committed诊断的P2也已修。读取原字节前的单件/增量容量及重复ID检查均有拒绝时arrayBuffer零调用证据。

## 无关临时原件清理的读回修正

2026-10-09 21:39，北京时间。后端独立探针 `development-evidence/commercial-readback-cleanup-probe.mjs/.json` 实证旧P2：B已提交且本身完整，另一页合法discard A后仅A临时原件不见，旧全量文件循环却把B报为已提交未确认。原反例及旧SHA保留，未修改探针、包、公共契约或source-storage。

仅storage/test解冻修正内部确认集合，公共API不变。提交读回完整历史守卫和当前全量原件验证保留；确认本次新增附件、被本次草稿引用的原件及恢复输入原件，不再要求所有无关临时附件永存。四条新回归使用真实存储API和串行IDB替身，只有save/freeze/discard合法业务动作，未靠raw put制造竞争。

修前43项中仅A清理反例失败；修后storage44项通过，包含A合法discard不妨碍B成功、B自己的草稿被freeze或自己被discard仍committed不确定，以及B新加未引用原件被同内容cleanup清掉仍报不确定（其draft内容/token均未变）。合法无关追加原回归继续通过。storage44+backup61共105项；连同4套现有事务/原件测试共164项通过，strict/exactOptional typecheck及两storage文件零警告静态检查通过。独立后端原探针复验已通过，该指定P2关闭；本结果不替代真实界面或双页验收。

当前重新冻结storage SHA-256为 `14feda7c39637736bc7a19b6ce8d47e8473fe9bdf21f51dcdd730858a0793f06`，其test为 `92df2a84f926b50ad732bb00dd6d4e050d2cb988803d379283099244e3672452`。包两文件仍为上表3dab556c…/bba4dc66…，source-storage仍30f31e692bdb9e70df458ee9d8e860fe6ff9b0660b2f86a822192f92610db114，公共契约及其测试仍原冻结摘要。

独立复验入口为 [commercial-readback-cleanup-probe.mjs](C:/幕景/development-evidence/commercial-readback-cleanup-probe.mjs)，结果为 [commercial-readback-cleanup-probe.json](C:/幕景/development-evidence/commercial-readback-cleanup-probe.json)。后端保持原API、输入及B提交后A清理的时序，仅更新临时探针最终期望。竞争分支A清理成功后B返回API success，返回值deepEqual当前仅B的最新快照；B的token、内容、原件字节与SHA均保留，无竞争对照仍成功。没有raw put/seed、浏览器或真实用户IDB操作，7个受保护源码/测试摘要未变。本次只更新交接结论，四商务源码/测试继续冻结，不追加开发或测试。
