# 场景与活动备份

2026-10-08 更新为 V2。文件模块位于 `frontend/lib/local-project-backup.ts`，恢复布局提交模块位于 `frontend/lib/local-project-restore.ts`；界面与需求事务由 root/主前端负责。文件读取只返回候选，实际恢复需走已有验证、确认和保存链，不改变活动安排、物料工作单或制作计划的共享契约。

## 文件格式与覆盖范围

格式为 `scendance-local-project-backup`，新写版本 `2`。显式兼容读取旧 V1 与无封套布局 JSON；V1 仍使用其原固定覆盖声明，不能夹带制作计划。`createdAt` 为包含明确时区的 ISO 创建时间。整个 UTF-8 JSON 文件上限沿用布局输入的 8 MiB，读前检查文件大小，读后检查实际字节数；超限拒绝，不截断。

```json
{
  "format": "scendance-local-project-backup",
  "version": 2,
  "createdAt": "2026-10-07T09:30:00.000Z",
  "coverage": {
    "layout": true,
    "creativeBrief": true,
    "eventOperations": true,
    "materialHandoffs": true,
    "reviewedBasis": true,
    "productionPlan": true,
    "attachments": false,
    "modelFiles": false
  },
  "layout": "此处为完整可编辑 RoomLayout 对象",
  "brief": { "status": "absent" }
}
```

上例的 `layout` 占位说明不是可导入样本。覆盖标记说明文件能保留这些记录；原布局没有活动安排、制作计划或某件物料的工单时，文件仍保持缺省。不会创造负责人、期限、人数、金额或已完成事实。

文件包含可编辑布局、设计方案快照、活动安排、物料工单、制作计划及两类核对依据，并明确记录活动需求的存在状态。制作计划仅包含共享契约允许的计划字段，未知金额保持 `null`，不扩写确认报价、实际到场、费用发生或收付款事实。已有布局内嵌底图随布局保存，但没有打包 IndexedDB 中的照片、其他图纸附件、重建表单、聊天、模型文件或账号资料。它是本地工作副本，不能称云备份、全部资料包或服务端审计。

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
validateLocalProjectRestoreCandidate(candidate: unknown): LocalProjectRestoreCandidate;
```

`snapshot.scope` 必须等于 `layout.id ?? 'local'`。`ready` 由调用方在当前资料成功 flush、完成读取后提供；`loading / saving / error` 均阻止导出。模块无法独立证明外部保存动作已完成，因此调用方不能将错误转换为 `absent`，也不能仅凭界面默认值构造已保存需求。

成功读回 `forms/<scope>:brief` 为 `undefined` 时，传 `absent`；读回真实 `CreativeBrief` 时，传 `present`。需求按现有 10 字段严格校验，不 trim、不截短文字、不补默认值。保留空串、可选字段缺省、`false`、有限数字人数，包括本地可保存的 `0`、小数和超出生成上限的草稿值。生成服务的 1–40 人与指令长度限制不能用于否定本地备份。

恢复候选包含 `source`、可选 `backupVersion`、`createdAt`、`layout`、`brief` 和 `layoutWasRepaired`。`backupVersion` 对封套文件为 `1 / 2`，无封套 legacy 不填。新格式的需求只允许 `present / absent`，不允许读取状态混入文件。新布局复用 `parseStoredLayout` 后做键顺序无关的语义比较；共享执行契约可补齐未提供的默认值，合法可选 `undefined` 按 JSON 缺省保存，归档地址净化也明确允许。已提供值必须保留，非法执行资料、未知布局字段、文字截短、编号改写或记录丢失会拒绝。导出在序列化前验证真实输入，不允许函数、循环引用、自定义 `toJSON` 或稀疏数组先被 JSON 静默改写；输出与传入原对象分离。

旧的多层或单层 `RoomLayout` JSON 继续通过已有兼容解析器，候选标为 `source: 'legacy-layout'`、`createdAt: null`、`brief: { status: 'not-in-file' }`。原解析器发生白名单清理、几何修复或单层迁移时，`layoutWasRepaired: true`，接入方必须明确提示。`not-in-file` 表示该文件没有备份需求，不能推断原项目没有需求，更不能认领当前浏览器其他项目的需求。合法断链任务引用仍保留原 ID，重复或修复后会错误关联的执行 ID 明确拒绝。

`format: 'scendance-scene-delivery'` 的交付封套明确拒绝。它没有完整可编辑布局与核对依据，不能猜着转换成恢复资料。未知格式、未知版本、非法需求或覆盖范围、坏 JSON 和过大文件同样拒绝。

## 主前端接入顺序

1. 捕获当前项目 scope、布局版本和操作序号；禁用重复恢复操作。先 `flushSourceScope(currentScope)`，等当前需求及资料保存完成。flush 或读取失败时保留当前项目并显示错误。
2. 导出时，在同一 scope 读取实际已保存需求，并核 scope/布局版本未变，再构造快照。`hasSavedBrief: false` 可能表示尚未保存的编辑，不能直接当无需求；`INITIAL_BRIEF` 的默认 24 人也不能成为文件事实。调用序列化函数后使用已有下载机制，入口与文件名均称“场景与活动备份”。
3. 恢复时，先读取并验证整个文件；候选返回前不要清空需求、修改场景或保存文件里的局部数据。显示项目名、时间、覆盖范围、需求状态及旧格式修复提示。确认替换并保存必要的当前恢复点后，确定目标 scope；无布局 ID 时必须显式使用已有本地 scope 规则。
4. 将目标 scope 的原需求单独保留为回滚值。在同一串行操作内，`present` 保存候选需求；`absent` 使用已有 `deleteSourceForm` 明确让读取结果恢复到 `undefined`。旧格式 `not-in-file` 必须提示文件未包含需求，并明确隔离目标 scope 的旧资料，不能无提示继承浏览器同 ID 的需求。删除后应实际回读验证，不能写 `null` 代替缺省。
5. 每个异步步骤后检查当前 scope、操作序号和目标是否仍一致；目标 scope 已被另一编辑器占用或项目发生切换时停止操作。先保存并回读验证目标需求，再通过既有 applyLayout 流程应用候选布局，并让 Provider 重新读取对应 scope；不得由旧 scope 的 debounce/flush 覆盖刚恢复的需求。
6. 任一步失败都保留原项目。已写目标表单但未应用布局时，撤回该次写入到保留的目标原值；回滚失败要保留候选与原草稿并显示准确错误，不报恢复成功。禁止先换布局再等待需求写入，因为异步切换会串资料。

备份模块只给候选和明确状态，不执行以上存储事务。UI 的替换确认、恢复点、持久化回读、同 scope Provider 更新及失败回滚须在接入验收中证明，单元测试不能代替它们。

## 验证与接入验收

2026-10-07：`npm test -- lib/local-project-backup.test.ts` 的 29 项通过，`npm run typecheck -- --incremental false` 通过。覆盖真实 `INITIAL_LAYOUT` 加稳定项目 ID/合法活动安排的往返、共享默认值与键顺序/可选缺省、文件往返与嵌套快照、两类全部执行字段/核对依据、同名物件和断链 ID、无需求与读取/保存失败区分、scope 错配、旧格式、交付封套/未知版本/非法字段拒绝、8 MiB 读前与 UTF-8 读后边界、地址净化不改原对象、自定义序列化和非 JSON 值拒绝，以及没有网络、存储或 DOM 副作用。独立对抗审阅复现的序列化前丢值/改项目 ID、继承数组序列化器及过深非法对象问题均已修复并加入拒绝测试。按本轮协调要求未跑 production build、未启动或停止预览。

主前端接入后验收：在独立演练项目保存真实需求、活动任务与物料工单 → 导出文件 → 明确替换回原布局 → 刷新后回读需求与两类核对依据；再核无需求、新旧文件、同 ID 已有需求、快速切项目、读取失败、保存拒绝、坏文件及取消确认保留原资料。恢复后的核对状态由现有依据比较逻辑计算，文件保存已验收记录不代表当前现场重新验收。

## 接入审阅附录 · 2026-10-07

本附录是独立只读准备，基于 `c827a31` 工作副本中读取到的保存与加载链路，不是备份入口已完成的验收回执。纯模块与原 29 项测试保持冻结，本轮没有运行它们、修改代码、导航或读写浏览器存储。主前端正在接入，成品需按实际新代码重新核验。

### 最小演练输入

以下值供主前端的内存存储替身、受控 Promise 和独立演练项目使用；不要写入用户当前项目。活动事实为空，任务仅标为演练。

```ts
const briefOld = {
  event: '恢复演练', guests: 0, description: 'A-旧草稿', mustHave: '', allowIdeas: false,
};
const briefFile = { ...briefOld, description: 'A-文件恢复' };
const briefOther = { ...briefOld, description: 'B-原需求' };
const layoutA = {
  id: 'backup-review-a', name: 'A-原布局', width: 10, height: 8,
  floors: [{ id: 'ground', name: '活动场地', floorColor: '#ece8de', items: [{
    id: 'review-item-1', type: 'table', name: '演练桌',
    width: 1.2, depth: 0.6, height: 0.75, color: '#c6a580', icon: '▱',
    position: { x: 0, z: 0 }, rotation: 0,
  }] }],
};
const layoutFileA = { ...layoutA, name: 'A-文件布局', width: 12 };
const layoutB = { ...layoutA, id: 'backup-review-b', name: 'B-原布局' };
// 用已冻结 serializeLocalProjectBackup 生成 present 文件；absent 文件仅改快照状态。
const presentSnapshot = {
  state: 'ready', scope: 'backup-review-a', brief: { status: 'present', value: briefFile },
} as const;
const absentSnapshot = {
  state: 'ready', scope: 'backup-review-a', brief: { status: 'absent' },
} as const;
// 旧格式输入直接 JSON.stringify(layoutFileA)，没有 format 或 brief。
```

测试记录须同时区分界面需求、Provider 的当前 scope/修订、`forms/backup-review-a:brief` 的读回值和主布局保存值。仅断言点击回调被调用、提示“恢复成功”或画布尺寸变化，不能证明资料一致。受控等待用延迟 Promise 和假时钟，不靠随机睡眠。

### 四类风险与反例

| 编号 | 最小触发时序 | 必须观察的结果 | 可以抓住的错误实现 |
|---|---|---|---|
| S1 同 scope、旧 debounce | 当前是 A，保存值为 `briefOld`；在表单输入 `A-待保存编辑`，在 250ms 保存定时器触发前恢复同 ID 的 present 文件。完成确认后推进定时器，调用一次正常 flush，再读回并重新打开。 | 当前布局为 `layoutFileA`，界面与保存需求均为 `briefFile`；晚到的旧保存不能把它改回。取消确认则保留 `A-待保存编辑` 和原布局。 | 只写目标表单并 apply 同 ID 布局，假定 scope effect 会重读；旧 `briefValueRef`、dirty 状态或定时器仍保存旧值。 |
| S2 同 scope、排队写入 | 输入 A 新草稿，100ms 发起恢复 flush 并延迟该笔保存；250ms 定时器再排一笔旧草稿。先释放 flush 等待的第一笔，让恢复写入及回读完成，再释放第二笔旧写入。另做在等待期间切到 B 的变体。 | 释放全部写入并再推进 300ms 后，A 读回仍为文件需求，随后 flush、切出切回和刷新也一致；切到 B 的变体保持 B 原布局/`briefOther`，A 恢复停止或按明确取消语义回滚。 | 只等待 flush 所发的那笔保存，却没处理等待期间新排的旧 debounce；旧写入最后落盘，或等待期间切项目后把 A 候选应用到 B。 |
| F1 确认前及目标写入失败 | 使用 present 文件，分别注入 `file.text()` 拒绝、当前 flush 拒绝、目标需求写入事务 abort、写后读回错误。目标已有需求时留存 `briefOld`。 | 无成功提示，原布局、原需求及可继续编辑的草稿保留；未验证的候选不应用；原值为缺省的分支仍读回 `undefined`。 | 读到部分资料就清空需求；把写入错误吞成 absent；只等待 IDB request 成功而未等事务完成或未核读回。 |
| F2 写入后应用失败与回滚失败 | 目标需求写入 `briefFile` 成功后，让应用布局失败/拒绝；再分别让回滚成功和回滚写入失败。另对已应用但主布局本地保存失败注入 storage 拒绝。 | 回滚成功时目标原需求恢复为 `briefOld`、原布局仍在；回滚失败时保留原草稿与候选并给准确错误，不能报恢复完成。主布局保存失败不能算“刷新可恢复”。 | `onApply` 被调用就报成功；未检查 reducer 最终布局或自动保存结果；补偿写入失败仍关闭错误状态。 |
| L1 legacy 与 absent | 目标 A 已存 `briefOld`，分别恢复同 ID 的 `JSON.stringify(layoutFileA)` 与新格式 absent 文件；再做文件 ID=B、浏览器已有 B 原需求的分支。 | 预检区分“旧文件未包含活动需求”和“备份明确无已保存需求”。确认按明确隔离/清理策略执行后，目标键读回 `undefined`，当前表单未被标为已保存 24 人；取消则不清目标需求。B 原需求绝不能无提示成为文件需求。 | 将 not-in-file 当作“保留当前需求”，或写 `null` 代替缺省；同 ID 写库后 Provider 仍显示旧需求并在随后 flush 写回。 |
| M1 未归档外部模型 | 仅把演练物件改为 `type: 'glb-asset'`，加 `glbUrl: 'https://backup-review.invalid/model.glb'`，不加 `assetId`。另用 `http://127.0.0.1:9/review.glb` 和加假查询 `?token=FAKE_REVIEW_ONLY` 的变体；同样放到一份 designBook 方案中。 | 读取/预检阶段不触发网络；预检说明外部模型仅有引用、文件未打包模型，不能承诺跨设备可用。取消不加载模型。确认后用网络替身返回 404/失效内容，保存稳定物件 ID、尺寸与原引用并显示资源失败，不能换成同名默认模型或伪造资产 ID。 | 把结构解析成功等同模型已恢复；预检时提前应用候选触发 fetch；把 loopback 当跨设备公共资源；仅检查主布局漏掉方案快照中的依赖。 |

### 当前代码依据与最小接入约束

同 scope 需显式切换恢复操作的版本/代次并同步 Provider。当前 `creative-studio.tsx` 的需求读取 effect 只依赖 `scope / briefLoadAttempt / saveBrief`（约 109–142 行），同 ID apply 不会自然触发重新读取。保存定时器为 250ms（约 143–146 行），`saveBrief` 用 `briefSaveQueue` 排队（约 89–106 行）；revision 比较只控制成功后的 dirty/error 标记，并不撤销已经发出的写入。单独在存储层写文件需求不在该队列内。最小验收必须释放旧 Promise 并读回，不能只看恢复瞬间的表单。

S2 特别要求在 flush 等待期间推进 250ms：当前 flush 不取消定时器，也没有证明等待返回时整个保存队列已静止。主前端可以在恢复交接时清除旧定时器、等待已排队的保存，并使迟到操作失效；验收关心的是最终读回及表单一致，不限定新增抽象。现有需求 React 测试已经覆盖读取失败、保存重试和 A→B→A 草稿隔离，尚不能证明这些备份恢复时序；mock 保存也不能代替成品的真实 IDB 读回。

失败必须覆盖两个存储域。`source-storage.ts` 的 `transact` 在 transaction complete 才 resolve（约 32–47 行）；这是实际保存完成边界。主布局走另一条 localStorage 保存链，`use-layout-persistence.ts` 约 234–265 行会在 debounce 后调用 `saveLayout`，失败只设置保存错误。恢复入口不能因需求已存或 `applyLayout` 返回就声称刷新可恢复；应按主前端最终实现验证布局与需求都完成保存，并证明部分写入后的补偿路径。

恢复应走明确的完整替换路径。当前 `room-organizer.tsx` 的 `onApplyCreative` 会做几何应用检查，并在候选没有 designBook 时继承当前 designBook（约 1103–1111 行）；这类 AI 候选行为不能无条件作为完整文件恢复语义。`applyLayout` reducer 对非法活动元数据可返回原 state（`layout-reducer.ts` 约 862 行），因此需要观察最终 store，而非只统计 callback 次数。原恢复点机制不会自行打包独立需求表单，补偿所需的目标原需求必须另行保留。

legacy 的 `not-in-file` 与新文件 `absent` 都不许可认领目标键中的旧需求，但预检文案必须区分来源。当前 Provider 用 `saved !== undefined` 判已保存，`null` 会被误记为已保存；清理后必须同步内存的 ready/dirty/hasSavedBrief 与旧保存队列，再实际读回 `undefined`。此处不要求新建存储系统，采用主前端负责的既有表单存储入口即可。

模型引用存在一个明确的冻结边界。`layoutForExport` 仅在物件有 `assetId` 时清理/替换归档加载地址（约 17–23 行）；无 ID 的合法 HTTPS、相对路径与 loopback HTTP 地址由 `isGlbUrl` 接受并原样保留。它不会自动鉴别无 ID URL 中的短期授权查询，也不会证明 URL 是公开、长期或跨设备可用。应用布局后 `use-glb-assets.ts` 约 16–18 行会启动 `ensureGlbAsset`，下载使用 `credentials: 'omit'`，资源错误保留在 cache 状态。读取阶段无网络不能替代确认后模型失败的验收。

因此 M1 的假 token 变体在当前纯模块中会留在文件文本，不能写“全部临时授权均已清除”。接入层至少明确显示未归档外部依赖；对疑似授权地址的导出是否阻止，由导演与主前端决定，不能猜出归档资产 ID、猜着改地址，或暗中删掉整件物料。本只读轮不改变此契约，后续如要收紧格式需单独协调模块变更。云端适配器现有 `LOCAL_ASSET_NOT_UPLOADED` 拒绝也不能作为本地模型可恢复的证明。

成品审阅回执须给出每个用例的实际状态、注入时序、两类保存读回及失败提示；未运行的用例保持“待验收”。本附录只准备了验收输入与反例。

### 未冻结协调代码独立审阅 · 2026-10-07

本次读取了 `source-storage.ts` 新锁接口、Provider 的 `prepareBackup / restoreBackup / undoRestore` 及邻接测试。主前端仍在改动，以下是本轮快照的复现记录，不是 UI 完成回执；只更新本附录，未修改实现或测试源码、未导航或访问真实浏览器存储、未运行全量测试或 build。

原 S1/S2 的基本风险已获得实际处理：`beginBackupOperation` 同步清理旧 timer，`backupPending` 使 timer 不再重排，`flushBackupBase` 等待当前保存队列；恢复前释放本页面共享 lease，再取去重排序的独占锁，adopt 同步更新同 scope 的内存需求。当前正常路径没有复现自锁或晚到 W2 覆盖。已有定向用例也覆盖恢复前 dirty 保存、旧 deferred 保存、100ms/250ms 时序和 A→B→A 操作失效。仍需成品的真实保存读回，不能由 mock 测试推断入口上线。

#### [P2] 撤销的部分补偿失败会造成内存与保存值不一致，并阻断重试

状态：原反例复验已关闭。下文保留发现时的历史时序；最新结果见本附录“原核心反例复验”。

位置为 `creative-studio.tsx` 的 `undoRestore`：本轮复读约 309–310 行的 `currentBrief / point.afterBrief` 比较，以及约 326–330 行顺序执行的两笔补偿。普通 `restoreBackup` 有 `failedRollback` 保留与重试路径，撤销这条双 scope 分支没有对应记录。

使用附录 A/B 输入，先将 A 恢复到 B，B 原需求为 `briefOther`、恢复后的需求为 `briefFile`。按以下顺序注入失败。

1. 撤销将 A 需求写回 `briefOld`，成功。
2. 撤销将 B 需求写回 `briefOther`，写入成功，但随后 B 读回失败。
3. catch 开始补偿，使第一笔 A 补偿写入失败。
4. 当前同一个 try 中的第二笔 B 补偿不会执行，B 持久化仍为 `briefOther`，画布/表单仍停在 B 的恢复态与 `briefFile`。
5. 解除存储故障后再次撤销，flush 读到 B 的 `briefOther`，与 `point.afterBrief` 不同，在 310 行拒绝“活动需求已变化”。页面虽保留恢复点并提示重试，重试无法继续。

已通过运行时内存注入一项 React 反例验证全部状态与第二次拒绝；未往仓库写入该测试。反例只运行这一项，其他测试跳过，也没有真实 IDB 或网络动作。最小修复方向是独立尝试各笔补偿，保留尚未完成的补偿值和受影响 scope，并让重试先在保护锁内完成它们；不要为了绕过失败而关闭新编辑保护。需要补的持久测试为“撤销第二 scope 写成功/读失败 + 第一补偿失败 + 解除故障后重试”，现有普通恢复失败回滚用例不能覆盖。

#### [P2] 取消未取得的共享 lease 会使 ready 正常完成

状态：原反例复验已关闭。下文描述修复前的 lease 行为，当前取消已拒绝等待写者。

位置为 `source-storage.ts` 约 29 行 `catch` 和 32 行 `Promise.race`。请求在取消且 `released` 为 true 时吞掉 AbortError；随后 request 的完成分支也正常返回，因而一个从未得到共享锁的 lease 仍会把 `ready` resolve。已用实际模块和内存 FIFO LockManager 复现。

```ts
await withSourceRestoreLock(['A'], async () => {
  const lease = registerSourceEditor('A'); // 共享请求等待此处独占锁释放
  const writer = lease.ready.then(writeBrief);
  await lease.release();                 // 取消未授予请求
  await writer;                          // 当前会进入 writeBrief，独占锁仍持有
});
```

这是锁接口的已证契约缺陷。本轮没有证明现有 Provider 会因此造成生产资料覆盖，因为其通常先 drain queue 再 release；不要把接口反例扩大为已发生的数据丢失。`release()` 可以幂等且不因正常取消失败，但 acquisition 的 `ready` 必须仅在真正授予共享锁后成功，取消等待应使等待写者拒绝或明确取消。缺测试为“独占锁内注册共享 lease → 等待 ready 的写者 → 取消未授予 lease → 写者不得进入”。

#### [P3] 测试 LockManager 丢掉未启动的等待者

状态：原反例复验已关闭。下文保留旧替身的失败序列，当前 E0→E1→S2 已完整通过。

位置为 `creative-studio.react.test.tsx` 的 `installBackupLocks`，约 630 行 `for (const waiting of entry.waiting.splice(0)) ... break`。它先移走全部等待者，再在首个请求使锁不可用时 break；后续等待者没有放回队列，可能永久悬挂。内存提取当前 helper 复现序列为独占 E0 → 排队独占 E1 → 排队共享 S2；释放 E0、E1 后 S2 仍不进入。这是测试替身缺陷，不是浏览器 Web Locks 的行为。新增多等待者/切项目测试前，应保留未启动项并按各等待请求自身的授予条件处理。

#### 尚未证明的边界与验证范围

- 缺少“目标写入已开始且独占锁持有期间，切到 C 或卸载 Provider”的完整时序。需要延迟目标写入，切 scope/卸载后释放 Promise，观察失败补偿、当前新 lease 的归属、旧 lease 的释放，以及 C 新编辑可保存。现有 A→B→A 与 100ms switch 主要发生在原 flush 等待阶段，不能证明这一更晚的 cleanup 分支。
- `commitRestoredLayout` 的真实工作台接入尚未落盘；现有 React Trial 的拒绝测试在 layout state 变化前抛错。需在最终主前端回调中证明失败发生前的布局持久化/应用顺序，或测试部分应用后抛错的补偿边界。本轮不把尚未接入的回调当成生产缺陷，也不催扩大 UI 范围。
- 子审阅 source-storage 定向 5 项通过；本轮 Provider 的 `complete local backup transactions` 定向 21 项通过，另运行 1 项内存注入反例确认撤销缺陷。原 29 项纯模块测试未重复。测试文件在协作期间增加新用例，因此这些数量仅描述本轮实际执行快照。
- 本机 Node `v26.2.0` 的默认 WebStorage 在 jsdom 初始化前暴露不可用 `localStorage`，最初定向执行全部停在 beforeEach 的 `.clear()`，没有进入恢复逻辑。仅对本次测试进程设置 `NODE_OPTIONS=--no-experimental-webstorage` 并让 worker 继承后，21 项通过。直接给主 Node 命令加此 flag 未传到 worker，不能据第一次失败误报为 21 个恢复缺陷；未改变项目配置或持久化 Node localStorage 文件。

审阅首个 source-storage 快照摘要为 `3D31B1D9…AB73D00`；随后负责人修改了 release 的错误吞吐，复读为 `74C5A657…BB22F984`，ready 的上述取消逻辑仍相同。Provider 复读摘要为 `CA8CE8E2…DE7A21CF`；测试替身复读为 `2935DE48…FE9942B7`。这些均为未冻结工作副本，后续修复应按新源码和新增定向测试重新核验。

### 小范围 UI 核查 · 2026-10-07

本轮仅查看新备份面板和真实模型加载路径，用实际序列化函数加面板预检运行 4 项内存用例；实现与测试源码均未改，其他 25 项面板用例跳过，未运行全量检查、build、浏览器或网络。未重复上一轮撤销/lease 审查。

#### [P3] 旧类型携带 GLB 地址时漏掉具体依赖提示

`local-project-backup-panel.tsx` 约 15–17 行的 `hasExternalModel` 只识别 `type === 'glb-asset'`。真实编辑器支持物件保留旧 `type: 'chair'` 并另带 `glbUrl`：`schema.ts` 约 145/164 行分别校验 type 字符串和合法地址，没有两者必须配对的限制；`use-glb-assets.ts` 约 15–18 行对所有物件按 `assetId ?? glbUrl` 发起加载；`furniture-builders.ts` 约 104 行也在普通椅子分支之前按 `type === 'glb-asset' || assetId || glbUrl` 选择模型渲染。因此这是实际支持的路径，不能把它当非法导入忽略。

最小反例沿用附录 layoutA 的一个物件，仅增加地址，保留其旧类型。

```ts
const legacyChair = {
  id: 'legacy-chair-1', type: 'chair', name: '旧椅模型',
  width: 1, depth: 1, height: 1, color: '#ffffff', icon: '🪑',
  position: { x: 0, z: 0 }, rotation: 0,
  glbUrl: 'https://backup-review.invalid/legacy-chair.glb',
}; // 无 assetId
```

将该物件分别放入文件主布局 `floors[0].items`、以及 `designBook.variants[0].layout.floors[0].items`，调用实际 `serializeLocalProjectBackup` 并选入面板。两例均通过校验，地址原样保留，预检存在，但“文件或方案快照含外部模型引用”这一具体提示未出现。确认回调收到的候选仍为 `type: 'chair' + glbUrl`，没有归档 ID。面板原本的通用说明“模型只保留引用”仍可见，因此本项仅报告具体依赖识别遗漏，不宣称所有覆盖说明消失或数据损坏。

这两例与一个无 `glbUrl` 的普通 chair 对照均在内存验证：确认前 fetch 次数为零、恢复回调未调用；对照同样不显示外部引用提示，正确。只应按实际存在的模型地址与归档引用判定，不应把所有普通 chair 都标成外部模型。designBook 变体在预检时不加载，真正切方案时 `scene-layers-panel.tsx` 约 74 行会逐件加载目标方案的 glbUrl；具体提示应递归覆盖其依赖。

#### 保留上一份候选是有意行为，提示可更明确

现有面板测试明确保留已预检候选。第四项内存用例先选择项目名为“上一份A项目”的合法文件，再选择坏 JSON 的 B。B 错误出现后，预检的项目仍明确显示 A，确认回调也收到 A 而非 B；没有提前应用、网络或错恢复，不能当作数据破坏，也无需强制清空 A。

目前 `choose` 的 catch（约 65–66 行）只显示本次读取错误，没有明确说候选来自上一次成功预检。可读性建议是在保留候选时补充“新文件未通过检查；下方仍是上一份已预检的 A”，引用仍显示的项目名即可。此建议不改变保留候选、原生文件选择取消或重试语义，不属于恢复流程阻断。

四项内存用例均验证了上述现状并通过；这是缺口与有意行为的复现，不能记成缺口已修复。面板本轮摘要为 `F9E8207E…77954E8`，邻接测试摘要为 `0BFA1EA5…44911842`，仍属未冻结工作副本。

### 原核心反例复验 · 2026-10-07

只重放原撤销、lease 取消和测试锁等待者三条失败时序，不改实现或测试文件、不导航或访问真实浏览器存储、不跑全量/build，也未重复原 29 项模块测试。三个原审阅项均关闭；结论限于这些原反例。

| 原发现 | 复验的同一触发时序 | 当前实际结果 |
|---|---|---|
| 撤销部分补偿失败 | A→B 恢复；撤销时 B 原需求写成功但读回失败，A 补偿写入失败；随后解除存储故障并再次撤销。 | 第一笔 A 补偿失败没有阻断 B 补偿，B 保存值重新与页面文件需求一致；`undoRecovery` 保留待处理的补偿。第二次撤销先在保护锁内核对/修复记录，再完成正常撤销，A/B 均读回各自原需求，当前布局恢复 A，恢复点清除。1 项运行时内存 React 复验通过。 |
| 取消未授予 shared lease | 独占 A 持有期间注册排队共享 lease，挂接 `ready.then(writer)`，调用 release 取消。 | `ready` 拒绝，writer 未进入，独占锁仍持有；退出后可再次取得独占锁。实际模块提取转译后的原序列通过。 |
| 测试锁丢 waiter | 独占 E0 持有时依次排队独占 E1、共享 S2；释放 E0，再释放 E1。 | E0、E1、S2 均完整进入并退出，S2 没有丢失。实际测试 helper 提取后的原序列通过。 |

当前关键位置：`creative-studio.tsx` 约 329–340 行在重试前核对并处理 `undoRecovery`，约 360–363 行逐笔尝试全部补偿；`source-storage.ts` 约 25/29/35 行只在真正授予时 resolve ready，取消未授予 lease 时 reject；测试 helper 约 697–698 行把未启动的等待者放回队列。复验开始、结束的三个源码 SHA256 一致。

| 文件 | 当前 SHA256 |
|---|---|
| `frontend/lib/source-storage.ts` | `50a17942e2652d2b0f92b12fde9e34dfa3c133a7d96d326798aa8d37f1e5ec50` |
| `frontend/components/room-organizer/panels/creative-studio.tsx` | `d74ae066adcab5f8431d48b808b67c70c2bc80d08990f09c1f179a038c30f646` |
| `frontend/components/room-organizer/panels/creative-studio.react.test.tsx` | `83792834647fcb8c9c2612e983a9174d1012a4f1d070f111431931b7b36edf93` |

仍需证明的非 UI 条件保持独立：实际两个上下文的原生 Web Locks/IDB 事务失败与回读，目标写入已开始且独占持有期间切 scope/卸载后的补偿及 lease 归属；测试 helper 的 E0→E1→S2 时序可保留为持久回归。本轮没有重放这些新场景，也没有将其记为当前缺陷。真实 room-organizer 接入尚未冻结，其最终布局持久化与需求事务的应用边界应在负责人冻结后核验；未接回或尚在实现的回调不作为生产缺陷。

## 制作计划配套 V2 · 2026-10-08

制作计划依赖已冻结的 `supabase/functions/_shared/production-plan-contract.ts`，不复制其 schema。默认新写 V2，并用 `coverage.productionPlan: true` 声明可保存根布局及方案簿中原有的制作计划；这不表示所有项目都已录入计划。无块保持未记录，显式空块由共享契约规范化，未知人数或金额为 `null`，明确 `0` 与未知区别保留。岗位、取得方式、供应/运输/安装说明、预算与人工估算及原任务/物件关联均随原 `RoomLayout` 保存，不建立第二份计划真源。

| 输入 | 读取行为 |
|---|---|
| V2 封套 | 严格校验新增覆盖声明与共享计划契约，保留全部原值；错误则只报错，不写存储或替换项目 |
| 原 V1 封套 | 使用独立严格 V1 schema，覆盖键完全沿用旧格式；根或任一方案快照出现 `productionPlan` 即拒绝混版，不偷添键、不静默剥离；成功候选标 `backupVersion: 1` |
| 无封套多层/旧单层布局 | 沿已有 parser 兼容，需求仍为 `not-in-file`；合法计划可保留。发生项目、楼层、物件、任务 ID 或计划字段丢失/改写时拒绝，不能让缺失引用被修复后新编号冒领。合法单层迁移可创建原迁移规则的 ground 容器，仍显示 `layoutWasRepaired` |
| 未知版本、未来事实字段或非法计划 | 明确拒绝；不降级成无计划、0金额或旧格式 |

原四个文件 API 签名保持，新增统一 `validateLocalProjectRestoreCandidate(candidate: unknown): LocalProjectRestoreCandidate`。`LocalProjectBackup.version` 现为 2，`LOCAL_PROJECT_BACKUP_COVERAGE` 为 V2，新增 `LOCAL_PROJECT_BACKUP_V1_COVERAGE` 仅供旧格式识别/验证。恢复候选增加可选 `backupVersion: 1 | 2`，无封套文件不填。旧 V1 文件重新导出会升级 V2，同时保持原本没有制作计划的状态。

`prepareLocalRestoreLayout` 和 `commitLocalRestoreLayout` 均在分配必要项目 ID或触布局存储前，复用完整 V2 校验取得候选。commit 仍按原同步布局保存→完整回读→应用→核对路径执行；仅计划被存储或 reducer 丢掉，也不能报恢复成功。失败补偿保留原内存/原保存的完整计划；第三方已改的新保存不会被旧补偿覆盖。代码没有访问新数据库、图片附件、模型文件或账户资料，原 8 MiB 与资源引用边界不变。

本阶段制作计划是可编辑计划，不含实际到场、确认报价、费用发生或收付款事实。文件恢复是编辑档案恢复；选择设计快照的计划语义由前端负责，不能宣称现实发生的业务事件也被撤销。未来加入事实前须另审版本、只读/补偿和导出边界。

验证：备份 53 项、布局恢复 16 项，共 69 项定向通过；最终整体前端 `npm run typecheck -- --incremental false` 退出 0，四个模块/测试文件 eslint 以 `--max-warnings 0` 退出 0，差异检查通过。含根/方案计划完整 V2 往返、缺省/空块、V1 固定键与混版拒绝、legacy多层/单层、未知金额/明确零、非法金额/记录/未来事实字段、稳定及断链引用、恢复再撤销原计划、只丢计划的读回/应用拒绝、应用后抛错、补偿拒绝与第三方新保存保护，以及直接候选的版本来源、缺省版本兼容、legacy需求语义和非 JSON 值拒绝。首次 typecheck 曾只报前端在途 `layout-reducer.ts:210` 的 TS2790，已交负责人处理；本对话未修改该文件，新增 validator 的本模块类型窄化错误也已修复，最终检查通过。

独立只读审阅未发现这四个模块中的阻断缺陷，但发现 Provider 直接候选重包 V2 会丢来源约束的配套点。现已按 root 授权集中到 `validateLocalProjectRestoreCandidate`：显式 `backupVersion: 1` 的根/任一方案计划混入会拒绝，未知版本拒绝；V2 完整保留制作计划；legacy 只允许 `not-in-file`、null 创建时间和无封套版本。返回为独立候选，保留已预检的 `layoutWasRepaired` 标记。

为兼容旧调用者，`source: 'backup'` 的候选可省略 `backupVersion` 或传 `undefined`；此时按当前完整 V2 数据规则校验，不自动补计划，也不在返回中伪造来源版本。只有调用方显式声明 V1 才施加 V1 不含制作计划的限制。文件读取入口始终提供真实 `1 / 2`，不采用缺省规则绕过文件版本校验。Root 应使用这个统一函数替换手工候选检查与一律 serialize→parse 重包 V2 的校验步骤；接入后的 Provider 全链仍由 root 验收。

Root/前端集成仍需验证预检的 V1/V2 范围提示、实际 Provider 需求事务配合、同 scope/跨 scope 的计划恢复、Undo 及失败补偿重试、新计划编辑使旧 Undo 失效，以及保存后刷新回读。此处 16 项恢复测试验证的是布局域与原补偿链，不能代替整工作台浏览器验收。根负责集成及统一构建，本轮未启停服务、未 production build、未付费或 push。
