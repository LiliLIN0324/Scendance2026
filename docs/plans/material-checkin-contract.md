# 数量点验契约 v1

2026-10-09。独立事实账册，共享契约已实现，集成由整合者负责。不进入RoomLayout、设计快照、几何撤销、公开分享或AI；根按真实 `layout.id` 存入IndexedDB forms专用键，并在备份V3 envelope单列。本批仅拥有共享契约、对应测试和本说明，不改现有计划/Scene/路由/迁移/前端/备份。

## 确定接口

`materialCheckinLedgerSchema`、`optionalMaterialCheckinLedgerSchema`、`materialCheckinSheetSchema`、`materialCheckinAgreementSchema`、`materialCheckinEventSchema`。

类型 `MaterialCheckinLedger/MaterialCheckinSheet/MaterialCheckinAgreement/MaterialCheckinEvent/MaterialCheckinProjection/MaterialCheckinSummary`。函数：

- `mergeMaterialCheckinLedgers(existing, incoming): MaterialCheckinLedger`：两个完整、合法、同项目同性质的账册快照，按UUID身份幂等并集；冲突抛 `MaterialCheckinConflict`，不覆盖原值。不是缺少目标的增量patch API。
- `projectMaterialCheckinEvents(sheet): MaterialCheckinProjection`：最新约定及有效收/还事件，原记录全部保留；不自动认定现场/双方认证。
- `materialCheckinSummary(sheet): MaterialCheckinSummary`：仅同一单、同单位的已核记录数量和待核问题，不计算金额、全局库存或遗失。

根形状：`{schemaVersion:1, projectId, dataKind, sheets:[]}`。projectId必填，保留原拼写，合并时逐字相同；调用方须绑定真实持久layout.id，不用项目名称或无ID草稿的公共local回退冒充身份。性质复用unspecified/rehearsal/real；缺省账册仍undefined，只有显式创建才产生空sheets。

每单：`{id, acquisitionId, acquisitionSnapshot:{title,supplierName,specificationNote}, unit:'piece'|'set', agreements:[...], events:[...]}`。标题、单位和当时取得依据为不可变头信息；同一取得行可有不同单，不跨单加总。snapshot是当时依据留档，不是第二份当前计划。

约定版本：`{id, supersedesId?, agreedQuantity:number|null, basisNote, recordedAt, recordedBy}`。恰好一个根，新增版本指向当前前版，保留原数/依据；已知数量含0需依据。单内不能缺目标、循环、分叉或跨单指向。

收/还事件：`{id, kind:'receive'|'return', batchRef, quantity:number|null, checkState:'pending'|'checked'|'disputed', occurredAt:string|null, fromPartyName,toPartyName,evidenceNote,evidenceUrls,recordedAt,recordedBy}`。每批是增量，不是累计快照。checked须数量已知、批次及双方文字非空，并有说明或证据链接；只是录入人声明已核，不是电子签字。时间严格带时区，发生时间可未知，不从计划复制。

更正：`{id,kind:'correction',targetId,reason,replacement:{batchRef,quantity,checkState,occurredAt,fromPartyName,toPartyName,evidenceNote,evidenceUrls},recordedAt,recordedBy}`。完整替换当前有效记录内容，方向仍取最初receive/return；更正后仅算一次。目标可为本单原事件或其前版更正，不能覆盖void。

作废：`{id,kind:'void',targetId,reason,evidenceNote,evidenceUrls,recordedAt,recordedBy}`。保留原记录及依据，不代表现实反向交接。有效版本按target/supersedes链决定；多设备录入时钟倒退可保存，保留原时刻并标待核，不能为通过校验伪造时间。误方向/单位或错单须作废错误记录并新建正确记录，不默改不可变头信息。

所有记录UUID在账册内唯一，大小写只作身份比较、不改输出。数量为非负安全整数或null，单位不自动换算；首次仅可数实物，米/面积、退换借调和损坏计价另定口径。没有记录或未核/争议批次时数量总额保持未知，明确checked 0才是0。

## 投影、汇总与接入边界

Projection：`{agreement,effectiveEvents,voidedRootIds}`；有效事件包含 `rootEventId/effectiveEventId/kind`、完整有效内容及有效录入信息。有效版本和作废不能删除原来源，图结构无效时拒绝投影。

Summary：`{sheetId,acquisitionId,unit,agreementId,agreedQuantity,knownReceivedQuantity,knownReturnedQuantity,receivedQuantity,returnedQuantity,notReceivedQuantity,notReturnedQuantity,overReceivedQuantity,overReturnedQuantity,pendingEventIds,disputedEventIds,issues,needsReview}`。问题码为超收、超还、未知/争议、未知/矛盾时点、先还后收、整数合计溢出或约定未知。`recording-time-conflict`扫描完整原始约定/事件链（含作废之前的更正），其eventIds也可包含约定版本ID。空/部分未核的总额为null；空方向已核小计是数学0，不代表实收/实还已核为0。已核小计不证明资料覆盖完整。超量不夹成0、不输出负库存，差额待核；不能推遗失、质量合格或合同结清。

演练20约定/18已收/18已还：约定未实收2、实收范围待还0。12+6收和5+13还同结果；无退还记录不当已还0。事件实际发生时间用于时序核对，录入时间只留痕，迟录/超还可保存并标待核。

账册更正/作废、基准版本必须追加，merge以原ID去重，同ID不同内容冲突；不能依标题、数量或时间合并。同项目备份恢复需先保留当前原账，完整合法并集有分叉/冲突则人工核对，不静默退回旧现场事实；旧V1/V2缺账册表示未含资料。切方案/应用候选/几何撤销不导入或回卷账册，复制新活动不复制现场事实。数量仅供相应收齐/归还任务的人工验收及复核，原accepted/证据保留，不能自动完成。

后续由根完成专用forms存储、scope/并发/失败保护、备份V3、内部点验出口、公开/客户披露及云门禁。同批端到端试用才放行；外部证据文件不因有链接就被备份打包。v1不提供费用、支付、全球库存、审批或真实性认证。

## 本批验证

24项定向回归、根类型检查及共享模块Deno检查通过。覆盖严格JSON（getter不执行）、完整更正、未知与0、20/18/18、批次累加、更正/作废/基准链、ID大小写、同项目幂等并集与冲突、溢出和真实/录入时序。时钟倒退独立复现后改为待核，等时刻、等价时区与递增时间不误报；后续作废不会隐藏早期冲突。没有运行服务、供应商调用、数据库迁移、整项目构建或集成验收，本回执仅覆盖共享契约。
