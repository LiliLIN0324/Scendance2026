# 场景与活动备份

2026-10-07。文件模块位于 `frontend/lib/local-project-backup.ts`，界面接入由主前端负责。本增量不写浏览器存储、不替换当前项目、不改冻结的活动安排或物料工作单契约。

## 文件格式与覆盖范围

格式为 `scendance-local-project-backup`，版本 `1`。`createdAt` 为包含明确时区的 ISO 创建时间。整个 UTF-8 JSON 文件上限沿用布局输入的 8 MiB，读前检查文件大小，读后检查实际字节数；超限拒绝，不截断。

```json
{
  "format": "scendance-local-project-backup",
  "version": 1,
  "createdAt": "2026-10-07T09:30:00.000Z",
  "coverage": {
    "layout": true,
    "creativeBrief": true,
    "eventOperations": true,
    "materialHandoffs": true,
    "reviewedBasis": true,
    "attachments": false,
    "modelFiles": false
  },
  "layout": "此处为完整可编辑 RoomLayout 对象",
  "brief": { "status": "absent" }
}
```

上例的 `layout` 占位说明不是可导入样本。覆盖标记说明文件能保留这些记录；原布局没有活动安排或某件物料的工单时，文件仍保持缺省。不会创造负责人、期限、人数或已完成事实。

文件包含可编辑布局、设计方案快照、活动安排、物料工单及两类核对依据，并明确记录活动需求的存在状态。已有布局内嵌底图随布局保存，但没有打包 IndexedDB 中的照片、其他图纸附件、重建表单、聊天、模型文件或账号资料。它是本地工作副本，不能称云备份、全部资料包或服务端审计。

归档模型继续使用稳定 `assetId`。调用现有 `layoutForExport`，只保留已确认的公共映射地址或去掉临时 `glbUrl`，包括嵌套设计方案；不会读取或携带加载授权。恢复后私有资产仍可能需要重新获取项目授权。无归档 ID 的合法本地样例或独立 GLB 地址沿用现有布局契约；文件仅保存引用，不验证资源是否可用，不请求网络。

## 冻结 API

```ts
type BackupBrief =
  | { status: 'present'; value: CreativeBrief }
  | { status: 'absent' };

type BackupBriefSnapshot =
  | { state: 'ready'; scope: string; brief: BackupBrief }
  | { state: 'loading' | 'saving' | 'error'; scope: string };

createLocalProjectBackup(layout, snapshot, createdAt?): LocalProjectBackup;
serializeLocalProjectBackup(layout, snapshot, createdAt?): string;
parseLocalProjectBackupJson(text): LocalProjectRestoreCandidate;
readLocalProjectBackupFile(file): Promise<LocalProjectRestoreCandidate>;
```

`snapshot.scope` 必须等于 `layout.id ?? 'local'`。`ready` 由调用方在当前资料成功 flush、完成读取后提供；`loading / saving / error` 均阻止导出。模块无法独立证明外部保存动作已完成，因此调用方不能将错误转换为 `absent`，也不能仅凭界面默认值构造已保存需求。

成功读回 `forms/<scope>:brief` 为 `undefined` 时，传 `absent`；读回真实 `CreativeBrief` 时，传 `present`。需求按现有 10 字段严格校验，不 trim、不截短文字、不补默认值。保留空串、可选字段缺省、`false`、有限数字人数，包括本地可保存的 `0`、小数和超出生成上限的草稿值。生成服务的 1–40 人与指令长度限制不能用于否定本地备份。

恢复候选包含 `source`、`createdAt`、`layout`、`brief` 和 `layoutWasRepaired`。新格式的需求只允许 `present / absent`，不允许读取状态混入文件。新布局复用 `parseStoredLayout` 后做键顺序无关的语义比较；共享执行契约可补齐未提供的默认值，合法可选 `undefined` 按 JSON 缺省保存，归档地址净化也明确允许。已提供值必须保留，非法执行资料、未知布局字段、文字截短、编号改写或记录丢失会拒绝。导出在序列化前验证真实输入，不允许函数、循环引用、自定义 `toJSON` 或稀疏数组先被 JSON 静默改写；输出与传入原对象分离。

旧的多层或单层 `RoomLayout` JSON 继续通过已有兼容解析器，候选标为 `source: 'legacy-layout'`、`createdAt: null`、`brief: { status: 'not-in-file' }`。原解析器发生白名单清理、几何修复或单层迁移时，`layoutWasRepaired: true`，接入方必须明确提示。`not-in-file` 表示该文件没有备份需求，不能推断原项目没有需求，更不能认领当前浏览器其他项目的需求。合法断链任务引用仍保留原 ID，重复或修复后会错误关联的执行 ID 明确拒绝。

`format: 'scendance-scene-delivery'` 的交付封套明确拒绝。它没有完整可编辑布局与核对依据，不能猜着转换成恢复资料。未知格式、未知版本、非法需求或覆盖范围、坏 JSON 和过大文件同样拒绝。

## 主前端接入顺序

1. 捕获当前项目 scope、布局版本和操作序号；禁用重复恢复操作。先 `flushSourceScope(currentScope)`，等当前需求及资料保存完成。flush 或读取失败时保留当前项目并显示错误。
2. 导出时，在同一 scope 读取实际已保存需求，并核 scope/布局版本未变，再构造快照。`hasSavedBrief: false` 可能表示尚未保存的编辑，不能直接当无需求；`INITIAL_BRIEF` 的默认 24 人也不能成为文件事实。调用序列化函数后使用已有下载机制，入口与文件名均称“场景与活动备份”。
3. 恢复时，先读取并验证整个文件；候选返回前不要清空需求、修改场景或保存文件里的局部数据。显示项目名、时间、覆盖范围、需求状态及旧格式修复提示。确认替换并保存必要的当前恢复点后，确定目标 scope；无布局 ID 时必须显式使用已有本地 scope 规则。
4. 将目标 scope 的原需求单独保留为回滚值。在同一串行操作内，`present` 保存候选需求；`absent` 明确让读取结果恢复到 `undefined`。旧格式 `not-in-file` 必须提示文件未包含需求，并明确隔离目标 scope 的旧资料，不能无提示继承浏览器同 ID 的需求。当前没有删除表单的公开函数；由主前端负责人在已有存储层落实缺省语义，若采用 `storeSourceForm(key, undefined)`，应实际回读验证，不能写 `null` 代替缺省。
5. 每个异步步骤后检查当前 scope、操作序号和目标是否仍一致；目标 scope 已被另一编辑器占用或项目发生切换时停止操作。先保存并回读验证目标需求，再通过既有 applyLayout 流程应用候选布局，并让 Provider 重新读取对应 scope；不得由旧 scope 的 debounce/flush 覆盖刚恢复的需求。
6. 任一步失败都保留原项目。已写目标表单但未应用布局时，撤回该次写入到保留的目标原值；回滚失败要保留候选与原草稿并显示准确错误，不报恢复成功。禁止先换布局再等待需求写入，因为异步切换会串资料。

备份模块只给候选和明确状态，不执行以上存储事务。UI 的替换确认、恢复点、持久化回读、同 scope Provider 更新及失败回滚须在接入验收中证明，单元测试不能代替它们。

## 验证与接入验收

2026-10-07：`npm test -- lib/local-project-backup.test.ts` 的 29 项通过，`npm run typecheck -- --incremental false` 通过。覆盖真实 `INITIAL_LAYOUT` 加稳定项目 ID/合法活动安排的往返、共享默认值与键顺序/可选缺省、文件往返与嵌套快照、两类全部执行字段/核对依据、同名物件和断链 ID、无需求与读取/保存失败区分、scope 错配、旧格式、交付封套/未知版本/非法字段拒绝、8 MiB 读前与 UTF-8 读后边界、地址净化不改原对象、自定义序列化和非 JSON 值拒绝，以及没有网络、存储或 DOM 副作用。独立对抗审阅复现的序列化前丢值/改项目 ID、继承数组序列化器及过深非法对象问题均已修复并加入拒绝测试。按本轮协调要求未跑 production build、未启动或停止预览。

主前端接入后验收：在独立演练项目保存真实需求、活动任务与物料工单 → 导出文件 → 明确替换回原布局 → 刷新后回读需求与两类核对依据；再核无需求、新旧文件、同 ID 已有需求、快速切项目、读取失败、保存拒绝、坏文件及取消确认保留原资料。恢复后的核对状态由现有依据比较逻辑计算，文件保存已验收记录不代表当前现场重新验收。
