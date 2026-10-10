# 活动执行安排：最小契约建议

2026-10-07。**本地共享契约及前端活动安排已接入；云接口和迁移尚未实施。** 当前功能、验证与限制见 [开发检查点](../DELIVERY-PROGRESS-2026-10-07.md)。下文保留设计依据与验收要求；可见备份/恢复界面和真实云协作仍待完成。

实现：[event-operations-contract.ts](../../supabase/functions/_shared/event-operations-contract.ts)，导出 eventOperationsSchema/eventOperationTaskSchema、EventOperations/EventOperationTask、eventOperationPhases/eventOperationsLimits。新契约69项与原handoff65项共134项通过，根类型检查通过；证据数组校验复用原规则，没有改变handoff语义。

默认活动文档为 `{"schemaVersion":1,"dataKind":"unspecified","tasks":[]}`。任务必须显式提供UUID、标题和阶段；未提供的责任/承接方/条件/证据文字为空，四个时间为null、objectIds/evidenceUrls为空数组、status为todo，reviewedBasis缺省。任务UUID按大小写等价去重但输出保持原值；物件关联编号支持128字符且逐字保留。

导演的 [30人演练样例](../examples/30-person-rehearsal-operations.json) 已实际解析通过：6任务覆盖四阶段，dataKind=rehearsal，负责人、计划/实际时间和完成证据均未编造。本聊天亦直接复核了这些空值和todo状态；这不是前端链路或真实活动验收。

## 结论

复用现有 CreativeBrief 作为需求真源，场地与方案继续来自 Scene。只增加一个本地 `RoomLayout.eventOperations?` 文档及其中的活动任务，沿用现有布局编辑、撤销、保存、恢复和导出链路。活动任务可不关联物料，才能表达签到、主持、供应方到场、联排及撤场交接。

现有每件物料的 handoff 保持原义；活动任务不是把物料工作单换一个名字。一把椅子可以关联布场和撤场两项任务，而两项任务有独立负责人、计划与结果。

## 已有信息及真实保存边界

| 信息 | 当前真源与保存 | 可复用及限制 |
| --- | --- | --- |
| 活动类型、人数、需求/目标、必需项、风格、现场条件 | `CreativeBrief`；StudioContext 中编辑，IndexedDB `forms` 的 `${layout.id ?? 'local'}:brief` 保存 | 读取该表单，不在新文档复制目标、人数或场地尺寸。默认“品牌快闪/24人”不是用户确认的真实事实；演练可以明确采用30人。现有界面及生成前校验支持1–40人，扩大规模另审查 |
| 图片/重建条件 | IndexedDB sources 与 scope 对应的重建 Form | 不是第二份活动需求；不将照片存在推断为已经识别或实测 |
| 场地和物件 | `Scene.venue`、`Scene.objects`；本地 RoomLayout 经 adapter 转换，云项目保存严格 Scene | 尺寸、入口、物件规格直接引用，不重复维护。backendSceneV2 可保留 v2 来源与设计信息 |
| 场景方案 | `SceneV2.design` 的 concept、highlights、requirements；随 Scene 保存在 projects.scene | 要求已有 text/status/reason/objectIds，没有稳定 requirement ID。设计 satisfied 不代表现场验收；V1 没有 design |
| 逐物件执行 | `item.handoff`；本地布局保存、撤销、恢复与交付导出保留 | ownerName/dueDate/acceptance/status/evidence 已存在，但一件物料只有一条记录，不能表示四阶段多任务 |
| 对话与 AI 需求上下文 | React messages/acceptedDecisions/lastExplanation；请求中的 `agentContextSchema.brief` 是拼接字符串 | 会话状态及服务调用快照不是结构化需求真源，不从 AI 记录自动生成已确认活动目标或执行结果 |
| 云项目 | 项目 ID/name/studio/revision/lease/scene | current_editor 表示编辑权，不是活动负责人。copySourceScope 只在本浏览器复制资料/Brief到新scope，不等于需求已正式保存到云端 |

当前可执行源码没有另一个名为 eventBrief/EventBrief 的独立模型。活动需求界面和图纸重建入口均读取同一 CreativeBrief。

## 本轮建议的领域对象

下列字段建议已经批准并落到上述唯一共享schema；前端引用该实现，不并行声明另一套校验。根文档 `eventOperations` 不复制 Brief/Scene，也不写入 notes。

```ts
type EventOperations = {
  schemaVersion: 1;
  dataKind: 'unspecified' | 'rehearsal' | 'real';
  tasks: EventOperationTask[];
};

type EventOperationTask = {
  id: string;                       // 新任务 UUID，不是物料 UUID
  title: string;
  phase: 'preparation' | 'setup' | 'event' | 'teardown';
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  ownerName: string;
  contractorName: string;
  acceptance: string;
  status: 'todo' | 'doing' | 'review' | 'accepted';
  objectIds: string[];               // [] 合法，单个实例可属于多任务
  actualStartedAt: string | null;
  actualFinishedAt: string | null;
  evidenceNote: string;
  evidenceUrls: string[];
  reviewedBasis?: string;
};
```

- `dataKind` 缺省为 unspecified，演练由操作者显式选择 rehearsal，真实项目由用户确认后选择 real。旧布局没有 eventOperations 仍可读，不自动创建活动或虚构客户、日期、费用。
- 四阶段分别是准备、布场、活动、撤场；它们不是进度状态。主持/签到等无物料任务使用空 objectIds，不制造虚假三维物件。
- ownerName 为实际责任人或负责团队的展示文字；contractorName 为可选承接/外包团队，允许空，不创建账号、通讯录或授权。未分配负责人、未完整排时间和未填条件可保存 todo/doing 草稿，但界面和导出明确标记。
- 时间为真实 RFC3339 字符串，必须带 Z 或明确时区偏移；首版界面按 Asia/Shanghai 输入/展示，空值为 null。不能依赖设备默认时区猜时间。两端均有值时，计划或实际的结束早于开始均拒绝；允许相等表示瞬时交接。跨午夜按完整日期比较，不只比较时分。
- 计划时间与实际时间严格分开。改计划不能改实际，点“完成”不能把计划结束复制成实际完成；未知实际时间仍为 null，并标明尚未记录。
- 建议 review/accepted 至少要求 ownerName 与 acceptance 非空；accepted 必須有非空 evidenceNote 和当前 reviewedBasis，证据链接可补充。活动任务完成须能说明发生了什么；与物件 handoff 现有“链接或说明”规则分开，不回改其已上线语义。未排计划时间仍显示缺项，不为了录入临时现场任务编造计划。
- 已实施上限：500项；title 120、ownerName/contractorName各80、acceptance/evidenceNote各1000字符；objectIds最多500且去重、每个编号最多128字符；链接复用 handoffLimits 的5条/2048字符及协议规则；reviewedBasis为 `sha256:` 加64位小写hex。复用字段常量/校验，严格拒绝未知字段；限额不等于自动生成这些数据。完整时间必须含秒和明确时区，最多三位小数；年份0000、未知偏移-00:00和倒序均拒绝。

任务 ID 与物件 ID 均需稳定。复制整份活动为新演练时重建任务 ID，并重映射确实复制成功的实例 ID；清进度、实际时间、证据和核对依据。仅复制一件物料，不复制或自动创建活动任务。

## 关联与变更检查

objectIds 关联当前布局的实例，普通交付时对照 SceneObject.id。materialId 是类别、assetId 是模型资产、BOM 行是聚合，都不能替代实例。旧非UUID布局不静默换编号，正式云保存仍需既有 Scene 校验或明确迁移。

新关联必须存在，且只能来自本活动布局。物件删除后保留任务与原关联 ID，派生 missingObjectIds 明示断链；不按同名、同 asset、同规格重挂，不自动删除主持任务或验收记录。导出只标为待核对；同 ID 撤销恢复可恢复连接，换 ID 需明确重选并重新核对。

reviewedBasis 在明确核对时记录，覆盖任务标题、阶段、计划时间、责任/承接方、验收条件、关联ID及关联物件/场地依据；相机和灯光显示设置不进入。上述依据变化后派生 needs_review，保留旧证据；不自动挪所有任务时间或改旧实际记录。无物料任务也会因计划、责任或条件变化进入复核。

不将 `SceneV2.design.requirements` 的数组下标或文本当任务的稳定外键。首版可读取它帮助人工填写 acceptance，但不自动同步状态；确实需要长期关联时再单独批准稳定 requirement ID 的兼容扩展。

## 保存落点与前端接入

**推荐内嵌 RoomLayout.eventOperations，可选字段。** 这是现有布局的活动执行元数据，沿用同一 reducer、历史快照和本机保存事务，比另建 `${scope}:operations` 的 IndexedDB 边表更容易保证“几何 + 安排”同时撤销/恢复。

CreativeBrief 继续使用原 `${scope}:brief`，不能因新面板再开一份需求存储。使用活动安排前确保布局已有稳定 id，避免多个无id草稿共用 local scope。Brief 保存/读取错误应可见，不在失败时用默认“24人”覆盖已有事实。

前端负责人需要明确接入类型、schema白名单、reducer校验、恢复点/持久化、复制/导入、公共分享及各导出入口。普通编辑JSON可以保留活动安排作为同版本备份；公共场景分享默认剥离负责人、承接方、证据与活动安排；交付封套把 operations 放在 scene 外，声明演练/真实、时间偏移和导出来源，不携带短期签名URL。

云准备、创建、打开和 Agent 自动准备等可能替换布局的入口，需把 eventOperations 纳入现有本地 handoff 保护。未具备正式云保存前，不透传到严格 Scene，也不默默丢弃；只保留本地完成范围的诚实提示。

## 后续正式云保存边界

未来将结构化 Brief 与 EventOperations 作为项目级独立元数据，而不是 Scene v3 或物件 notes。可采用一个版本化项目JSON承载两者，服务端成为正式真源；本地已有Brief入口转为同一模型的缓存/草稿，而不形成两份互相覆盖的事实。

正式接口必须复用项目成员、有效租约、expectedRevision和项目行锁。场景与任务引用的变更在同一事务校验，删除保留断链并失效旧核对；异常不部分保存。服务端身份、记录时间、不可变验收和附件授权另审查，不能将本地 actualFinishedAt/ownerName 当成服务端审计。

发布/分享需要冻结的活动快照和专用字段白名单，不读实时项目安排；执行过双账号/跨设备真实读写及冲突验证后，才能声称云协作完成。本轮不新增接口或执行迁移。

## 建议的实现顺序与验收

1. 导演确认上述字段、保存落点及任务完成规则后，后端提供唯一共享 schema/types。将现有 CreativeBrief 提为同字段共享校验时保留存储键，默认值仍是界面建议而非用户事实。
2. 前端接入一场明确标注的30人演练，任务覆盖准备、布场、活动、撤场，含无物料签到/主持。时间和负责人未确定时留空并可见，禁止自动补实际完成。
3. 定向验证旧布局、刷新/关闭重开、撤销/恢复、复制、公开分享、云保护和导出，再由导演统筹构建与浏览器回读。

最少验收：无物料任务可保存；倒序/非法时间拒绝而原资料不丢；同物件多阶段任务身份不串；删除关联显示断链；改计划不改实际、旧核对需复核；已完成必须有说明；任务/需求/场景来源清楚；演练不冒充真实项目；导出和重开保留全部本地字段，外部材料无内部签名地址。不要以字段schema测试替代这些完整链路。

源码依据：[CreativeBrief](../../frontend/components/room-organizer/lib/creative-brief.ts)、[需求编辑与准备](../../frontend/components/room-organizer/panels/creative-studio.tsx)、[IndexedDB真源](../../frontend/lib/source-storage.ts)、[Scene与设计契约](../../supabase/functions/_shared/domain.ts)、[AI上下文](../../supabase/functions/_shared/agent-contract.ts)、[项目会话](../../frontend/lib/backend-session.ts)、[物件handoff](../../supabase/functions/_shared/delivery-contract.ts)。

## 冻结回执与前端可执行用例

契约冻结摘要（SHA-256）：`c2baae258c8c7f28f592a3cf03efbc94c73b908c47d8d160b313884b1d880831`。冻结只代表共享校验稳定，**不能据此宣布以下链路已经完成**。前端接入后分别留下测试/浏览器证据，不用重跑无关全量检查代替复现。

| 用例 | 操作 | 应观察的行为 |
| --- | --- | --- |
| E1 旧布局与初始化 | 打开无eventOperations的旧布局，再显式创建一项签到任务 | 旧布局正常且不凭空多一场活动；标题/阶段需明确，时间和负责人空值可见；Brief仍来自原scope:brief |
| E2 保存与恢复 | 在独立演练场景填写两项不同阶段任务，包含完整时区计划、人工实际时间与证据；保存后刷新、关闭重开、撤销/恢复点 | UUID、dataKind、四个时间、状态、关联和证据完整回读；几何与活动安排恢复到同一版本；失败保留原布局和当前草稿，不能显示已保存 |
| E3 断链 | 任务关联两件物料，删除其中一件；再新建同名同asset物料，最后撤销原删除 | 原关联ID和任务保留，明确列出missingObjectIds且不得定位到新物料；同ID撤销恢复连接，新ID必须显式重选；旧验收不得伪称当前关联有效 |
| E4 计划与实际 | 先留四个时间空，再填写跨午夜及不同偏移；输入倒序/假闰日；已记录实际后改计划 | 合法时间按真实瞬间比较，空实际保持null；倒序/非法日期拒绝且有效记录不丢；计划变更不改实际，不从计划或系统当前时间补历史事实 |
| E5 核对依据 | 录入明确负责人、条件、说明并人工确认；再改阶段/责任/计划/条件/关联物件或场地；用无物料主持任务重复计划/条件修改 | 状态显示需复核、原说明与依据保留，明确重新确认后更新；无物料任务不依赖虚假3D物件；相机/显示灯光不误触发，活动实际完成未知仍诚实保留 |
| E6 复制与替换 | 复制整场演练、只复制物件、替换物料或恢复历史 | 新活动重建任务UUID，只有已复制实例才重映射关联；清实际/完成/证据/依据；单物件复制不自动复制活动任务；同ID替换引发复核而非串到同名对象 |
| E7 分享与文件 | 普通编辑JSON往返；交付封套/活动清单；公共场景分享；嵌套designBook快照 | 编辑备份保留全部活动字段；明确交付材料保留必要任务、时区和演练来源；公共分享剥离活动安排/负责人/承接方/证据且递归清副本；所有对外出口不带归档资产临时授权URL，原layout不变 |
| E8 云边界 | 有本地活动安排时尝试云准备/创建/打开/获取编辑权及Agent自动准备 | 未有正式接口前明确保护本地元数据，不静默覆盖、不塞Scene、不提示已云同步；取消操作仍可保存、导出本地资料 |
| E9 无效输入及存储失败 | 导入重复UUID大小写别名、128/129字符关联ID、已完成但无说明/摘要、未知字段；模拟浏览器存储写入失败 | 契约一致拒绝非法数据，128字符编号保持原值；不悄悄剥离活动字段或截断ID，不覆盖原有效布局；保留草稿并显示真实失败，不自动标完成 |

共享契约134项定向测试已完成；前端已完成本地活动安排接入及相关回归，浏览器已验证基础排期、保存、复核、断链和交接导出，详见开发检查点。可见完整备份恢复、真实云协作、生产迁移、客户签字和真实现场验收仍未完成。
