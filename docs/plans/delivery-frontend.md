# 场景物料到执行交接：前端实施方案

## PetitMaker、AIHOT 的实际采用与操作减繁复核（2026-10-10）

本轮回应用户“学了哪些、逻辑关系仍不对、需要干净”。只读复核当前共享工作树，并读取用户当前选中的18518正常页面；未点击、填写、改用户存档、运行模型、修改产品代码或重复构建测试。当前源码有42e之后的紧凑布局候选，不能把它描述为18518已经呈现的界面。导演正在独立release-1.0.1副本整合与检查；本次结论不扩入已冻结的两CSS收尾增量，也不改其版本、Git、构建或发布范围。

通过agent-reach的GitHub CLI重新核对两个官方固定提交：PetitMaker `4e120e50c844198649454eec6069ac65a062a732`（2026-10-04），AIHOT `8ef28ebcd167b311ffab8c0308181e2912262ae2`（2026-10-09）。阅读本地固定源码与现码，不运行上游程序。研究报告中的“尚未实施”保留为当时快照，当前采用状态以本节和实际实现为准。

| 来源 | 实际采用 | 当前范围 |
| --- | --- | --- |
| [PetitMaker ObjectShelf](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/bars/ObjectShelf.tsx#L192) | 按需展开素材、全库搜索、横向单排卡片；收起保持查询 | 现码已实现；最新紧凑尺寸属于待整合候选，素材点击仍沿幕景原添加语义 |
| [PetitMaker frame-layout](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/frame-layout.tsx#L30) | 工具、素材、助手让出真实画布空间；按剩余宽高适应场地 | 使用幕景原画布与相机；未复制上游布局平台或引擎。最终两CSS轨道折列仍由导演独立验收 |
| [PetitMaker Shell](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/Shell.tsx#L562)及相关IO/Agent研究 | 统一选择与撤销、聊天收起不重建、导出失败结束、隐藏保存及可信公共资产恢复 | 已有实现；属性默认完整展开仍未达到按需详情目标。Glyph分享图、持久撤销栈、巨幅PNG分块未采用 |
| [AIHOT receipts](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/providers/receipts.ts#L122) | 稳定请求身份、查询原任务、run内工具回执与确认checkpoint后再提升候选 | 已有实现；不等于整条模型对话跨进程续跑，未采用上游30分钟自动付费重试 |
| [AIHOT analyze](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/editorial/analyze.ts#L508)及[runs](https://github.com/KKKKhazix/AIHOT/blob/8ef28ebcd167b311ffab8c0308181e2912262ae2/packages/backend/src/admin/runs.ts#L16) | 结果绑定当前输入、人工接纳优先；有效候选保留时仍显示处理中断 | 活动任务建议现已接摘要选择、原请求GET找回、人工勾选、稳定任务ID与保存读回；不是新闻系统，也不证明真实模型或云端效果 |

**操作目标。** 围绕同一场活动，用户能预判下一步去哪里、点击会改变什么、关闭后哪些内容保留。一个主入口对应一个目的；快捷入口可以存在，但必须指向相同动作和同一份状态。界面使用三至四层字体及统一间距；每项说明仅服务眼前的一次判断。

| 用户目的 | 主落点 | 应遵守的关系 |
| --- | --- | --- |
| 摆场地、添加物料、选择场景模板 | 画布与素材架 | 连续添加或普通选中不应无意打断正在做的事；修改详情由明确动作展开 |
| 调整现有物件 | 选中物件后的属性 | 收起面板与取消选择分别命名；嵌入属性只有一个关闭面板的控件 |
| 整理需求、场地依据、分工执行、合同与交付 | 活动资料 | 分类选择展示资料，不兼做跨面板跳转；浏览资料不改变助手工作模式 |
| 描述问题、请求建议、核对并确认结果 | 助手 | 用户明确请求建模时才切建模输入；关闭保草稿，重新打开保原任务 |

**当前四个具体关系缺口。** 这些是现码只读发现，尚未作为本轮浏览器行为验收。

1. `creative-studio.tsx:1306/1341`的资料分类“场景模板”实际关闭资料并转去素材架，分类值仍是原值；模板又有底部标签。建议删资料中的这一跳转选项，保留素材架主入口。
2. `creative-studio.tsx:1291/1344`的“活动需求”和“图纸与尺寸”只有焦点不同，都显示完整需求与场地表单。建议统一为“需求与场地”的一个资料入口，图纸保留组内直达动作，避免同一表单呈现为两页。
3. `creative-studio.tsx:1296/1345`的左侧“物料建模”只切工具内容，却提示去聊天填写；它不切右侧工作模式，窄屏资料打开还会收起聊天。建议建模请求只在助手执行；需要快捷动作时明确命名“到助手描述物料”，保留原草稿并切到正确输入。材质与历史模型仍保其真实用途。
4. `room-organizer.tsx:427/1307`的选中会展开完整属性，窄屏会收聊天；嵌入属性另有`item-context-popover.tsx:89`关闭按钮。外层收栏、内层取消选择的结果不同。建议先统一关闭语义，随后独立验证连续添加、选中与按需展开的关系。

顺序先清理重复的模板分类，再分别验证同表单入口、建模直达和选择/关闭。每轮仍只做一个明确增量；不因本报告整体更换导航或新增空页面。此前已修关闭资料自动弹回、旧编辑路径提示和建模示例覆盖草稿，不重复列为待修。首次资料现码默认需求，恢复备份后转执行资料是查看恢复结果，不代表系统判断活动进入执行阶段。

本轮三文件读取指纹：CreativeAssistant `f170252a8a61c3c5adfdc05faae762b9acf6b118a26caff6e966ac0635be6af8`；RoomOrganizer `e0637ce75d5aa4fedd01b65bf7c93b8b05356978b6bf05fc28817444c90c304d`；ItemContextPopover `06747a6f999a1e751f2d4cc676db745d8ad39958062a7a0efa01d6d51191a591`。本轮测试/构建为零；既有334项、父候选build、导演真实投影与界面结果继续按原范围记录，不用于宣称上述四项已修复。

## 用户最新反馈：操作逻辑减繁（2026-10-10，下一独立增量）

用户在正常18518预览提出“目前学了PetitMaker和AIHOT哪些，逻辑关系仍不对，从第一性原理需要干净”。上一60源完整包已冻结并由导演发布42e78c；本节及之后RoomOrganizer改动为下一增量，不追加到旧60源验收或覆盖其out。冻结时的本文副本保留在C:/幕景/development-evidence/activity-delivery-final-frontend-document.md。

已借鉴的机制：PetitMaker的紧凑底部工具、按需素材架、统一选择/历史与助手显示独立；AIHOT的当前输入绑定、原请求回读、人工确认优先及“有候选同时有处理中断”的明确提示。底部素材、模板归一、本机活动与场景连接的编号区分已存在，不重新报为待修问题。源码依据为petitmaker-code-study.md、petitmaker-adoption-roadmap.md、aihot-code-adoption-20261010.md及当前creative-studio.tsx的PARTIAL_RUN_NOTICE/consumeRun。

动作唯一落点：选物件到左侧属性；加素材/选模板到底部素材架；需求、图纸、合同、执行与评审到左侧活动资料；问题、候选和确认到右侧助手。每个开关遵守显式打开/关闭意图，保留未保存输入；深层校验和验收工具不呈现为日常操作。

只读代码审查得到四个具体卡点：显式关闭资料后，取消物件选择会因businessOpen残留而恢复资料；属性提示仍指向“场景预设”和“助手→物料工具”旧入口；助手收起后的处理中/待确认只在sr-only可见；建模示例按钮会直接覆盖非空草稿。桌面首次展开助手需另按用户偏好审视，不能抹掉已保存的主动展开选择。字体继续限制三至四层，间距与图标保持统一。

本轮仅先修第一项：RoomOrganizer.closeLeftPanel同步清businessOpen，再收起左栏。docked资料portal继续挂载，资料再次打开仍保留草稿；取消选择只恢复用户此前仍打开的资料。其它三项保留为后续独立可验增量，不随本轮加入新模块或改变公共契约。候选navigation-close-build-copy使用旧固定1950源与唯一RoomOrganizer新覆盖，Node24类型检查及完整npm构建分别退出0；独立隐藏浏览器通过正常点击、填表与2D画布选择，实际复现旧18518关闭后资料弹回，新18524保持关闭，手动重开仍是完全相同未保存草稿。两边全流程存档原字节不变，各30次本机静态GET，无模型或API调用；六个HTTP产物与out逐字节相同。候选manifest为b12f40fc...，Room新源为b90919c8...，普通预览http://127.0.0.1:18524/?local=1，证明C:/幕景/development-evidence/nav-close-acceptance.json。两个自有浏览器context已关闭，服务PID20632保留，页面没有验收工具。此证明只覆盖本轮关闭/返回与草稿保持，不借旧181或公模检查冒充新的整站验收。

## 长期目标与执行节奏（2026-10-07）

本对话已建立长期目标：让团队自己的活动需求、场地物料、人员／外包分工、执行排期、变更复核、验收与复盘，在现有幕景里形成少步骤、可保存和可交接的操作。共享优先级以 [flow/plan.md](../../flow/plan.md) 为准；本对话只负责前端及本文，公共契约由后端负责人提供。每轮一个有证据的小增量，使用明确标注的独立演练样例或用户提供的真实资料，不编造真实活动事实，不覆盖其他 Agent 修改。

早期曾建立本对话的定时续跑。用户随后明确要求删除全部定时任务，导演已执行删除；当前不再按10:00／16:00自动续跑，也不重建自动化。长期目标保留，按用户和导演明确分配的小增量逐步执行，沿用本对话及 GPT-6.1-Sol / ultra 设置。只在实质进展、失败或阻塞变化时通知；没有可推进工作或状态变化时保持安静，不重复整套检查或生成例行空报告。

每轮先读适用规则、共享计划、当前分支及其他人的修改，实际试用一个卡点并阅读相关成熟官方案例，再实现最小可逆改进，完成必要测试、独立浏览器观察和保存／导出回读。3157 保持共享热更新；不主动停服、另起同端口服务或同时运行 build/dev。生产构建由导演协调。本地、mock、正式后端和真实活动验收分别报告；不自动付费、对外发消息、读取密钥或操作生产数据。

### 当前增量：任务建议的披露、原请求恢复与保存闭合（2026-10-10，最终本机候选按范围验收收口）

导演正式安排继续完整承办主线：原活动安排新增可展开任务建议区，不加工作模式或运行队列。只选需求文字、原任务和物件，通过冻结helper生成白名单，再由共享activityTaskContextSchema校验归一化、显示实际摘要并明确勾选发送。已有登录、远端绑定及有效lease才允许模型入口，不为建议创建或上传场景；本机activityId与远端projectId分开。

BackendSession使用原后端冻结的4个typed客户端方法，未复制TaskDTO或用Scene parser解释结果。本机单个当前marker先提交读回再POST；POST网络/坏JSON/错误DTO未知时只GET原request，事务内同run只prepare一次，完整proposal和任务ID持久保留。勾选后的accepted只拟写，先存operations+receipt意图，再经原layout保存桥strict读回，最后closed；未确认保原ID。重开可只核原保存结果，真实写失败另有明确同批本机重试，不重发模型请求。

实读PetitMaker固定4e120...的core/gates、session/erase-records及既有完整Agent采用报告，采用人工门槛、上下文撤销后未知结果不盲重复、统一已核保存状态；没有移植其浏览器BYOK、游戏规则或全量日志。agent-reach GitHub后端核固定commit来源；专业完成条件只采用既有原版runbook的具体动作、预期结果与失败待核方法，不生成现场安全数字、负责人、计划时间、费用或证据。原商业31源和24原件断言在其冻结时成立，之后新任务对父UI/hook的授权修改不冒称仍与旧副本0drift。

新增store模块15与冻结helper35同批50、外置真实fake-indexeddb4分别通过；Root四套Session/Creative/SceneDelivery/EventOperations367及Workspace38是此前接线范围，最终view/Hook检查另记，不相加冒充全产品。Workspace覆盖原eventOperations缺席时的首批建议，不要求先手工造空任务。服务端只接明确复核的选定摘要和本次要求；首次人工保存前，客户端用typed GET核原run完整结果及当前有限、有效lease，等待期间身份、来源或lease变化拒绝迟到写入。TaskDTO.expiresAt表示运行deadline，不人为另造提案TTL；进入saving后只核本机原保存，不再网络请求。类型、计划与弧度朝向只调整人类阅读，不改原摘要/hash或扩冻结契约。

**历史54组合实际回执。** activity-task-workbench-build-copy与rehearsal同3e650基线，1947源/54overlay，17项源核对、完整types与双build退出0；单批10套542相关检查通过，不和旧批或下一组合相加。真实空活动原eventOperations缺席，经摘要/勾选首次加1todo，保存、刷新及明确恢复既有场景连接后同ID；没有先手工造空ops。假设30人39件/20任务明确披露已存需求+3原任务+2物件，模拟POST结果已提交后连接丢失，原request GET取回同run，人工保存前fresh GET核complete，再保存/刷新成为21。旧20全部字段、原layout除新增任务、brief/制作/点验/原图都不变，真实原时间表与CSV有新增标题/完成条件/ID；artifact10断言全过，导演独立读回亦通过。模型替身预flight2次另记，空UI+1与30人UI+1，恢复/重开0新model，0外部provider。保持API/日期/人员/现场/真实云边界，receipt为activity-task-54-browser-receipt.json；这批out不含后述恢复修复和公模6，不覆盖它冒称最新版。

**恢复修复与最终60组合。** 隐藏保存第一listener被导演3项红反证（HUD未更新、旧timer重复写、Quota后丢pending），改成功flush更新状态并废旧timer、失败保pending/error；真实Hook证据与浏览器原生事件分别记。之后真实桥还发现两个P2：新页核已存任务保新geometry却永等旧geometry；同页首次提交成功、读回失败后改geometry被expected对象reference挡死。最终d2fec...仅放行实际raw等原pendingJSON、同活动和当前任务仍是原before或pending的只读核对，hold目标保当前geometry+已核ops；人工任务变更/其它提案/未提交写/外部覆盖仍拒，达到目标后恢复geometry autosave。原恢复2与hidden3共5绿、相关hook71通过，不把mock persist代理当真实桥证据。

导演交公共模型恢复6文件（可信catalogue ID/路径/字节摘要；自定义、私有、错hash和旧origin不能回退），Root只纳冻结源，不改consumer。首60组合由54基线叠Hook/view修复与公模6，1950源/60overlay，[18项源证明](C:/幕景/development-evidence/activity-delivery-final-source-proof.json)三方0drift，完整types退出0、7套181相关检查通过；其中3套Hook71已包含在181内，没有另造final71日志。导演最终d2 Hook探针2套5另记；公模owner3套43为受控fetch模块范围，不与181、历史542相加。最初全树types的owner在途错误只作失败历史，最终没有降低类型检查。首60直接Next构建虽成功，却漏掉package-pages静态素材，原输出保留，不计完整分发包。

**最终完整候选。** 新建activity-delivery-packaged-build-copy及对应rehearsal-copy，均保同1950/60源和manifest SHA `6622b04f582d8ac12ec8c4b2a11741c970122a0ca7c254ac8edb116561271371`；两份完整npm build退出0，[完整包13项证明](C:/幕景/development-evidence/activity-delivery-packaged-source-proof.json)全过。每包529真实GLB、1163派生资源的input/public/out字节一致，out各1236文件。正常release为 [packaged frontend/out](C:/幕景/development-evidence/activity-delivery-packaged-build-copy/frontend/out)，[源清单](C:/幕景/development-evidence/activity-delivery-packaged-build-copy/source-manifest.json)与[输出清单](C:/幕景/development-evidence/activity-delivery-packaged-build-copy/output-manifest.json)分别固定；演练release及精确输出SHA见[最终回执](C:/幕景/development-evidence/activity-delivery-final-acceptance.json)。正常预览为 [task-delivery.localhost:18518](http://task-delivery.localhost:18518/?local=1)，当前可见正式页无演练控件，截图为[clean-workbench.jpg](C:/幕景/development-evidence/activity-delivery-browser-packaged-clean-workbench.jpg)。

**真实恢复、显示与任务下载。** 这组实际操作发生在此前同60源的裸Next演练页，不冒称在新完整包重跑。专属host显式arm，原主存档真实写入后仅一次读回故障，UI仍21项、main已22；手工把座椅0.55改0.6，只核原保存后22任务闭合且保当前几何，再改0.65及90°、普通刷新仍同新增ID `831c7dd3-1da1-498a-9acf-86e5a4fb7a0f`，原21全部字段及39物件、需求、制作、点验和原图保留。新todo负责人/计划时间/实际时间/证据未知保持空。真实V4、22行CSV、执行表与完整交接HTML均已下载，原件与副本SHA一致；[独立11项回读](C:/幕景/development-evidence/activity-delivery-browser-readback-proof.json)全过，JSON仅createdAt、新任务、座椅宽和rotation四处增量。两选择组实际全22/39、各160px滚动，末任务/末物件可勾选再取消；原table Z `-1.7999999999999998`仅显示为-1.8，原rotation π/2仅显示90°。旧Task IAB CSS1280×720/DPR1.75与JPEG实际1280×720分开记录，不沿用为新Edge模型图尺寸。

**新完整包公共模型与反例。** Edge原UI用filechooser载入自制layout，经普通main存档冷重开，没有V4预检补CDN或evaluate写Storage/React。ID-only实际显真实折叠椅，原glbUrl仍缺席；canonical expired URL真实API403两次且Origin允许，随后同包本地真实GLB200两次。原资源28168字节/SHA `eb631b23a79b71a6f20e779d7441b3ef19f5f29192ab25d168065324950af3f6`与实际导出场景GLB39212字节分开：后者含场地结构和真实折椅，glTF2/10meshes/35accessors；Scene JSON4506字节为v2/schema2单对象，HTML7636字节有objectId但无完整assetId，sourceUrl/license/材料SHA均null，不补造。目标id、assetId和原完整signed URL保留；导出后同源重开另见4件物料，来源未核、不归因于产品或其他人，**不能称整场raw全等**。private/custom组合反例实际404两次，原id/assetId/URL三字段投影相同，拒绝GLB、无公共fallback或占位GLB下载；没有把它升为private403或整份layout全等。[公模独立12项回读](C:/幕景/development-evidence/activity-delivery-public-browser-proof.json)及[最终case](C:/幕景/development-evidence/activity-delivery-browser-packaged-case-proof.json)全过/pending0，仅支持上述范围。导演独立uppercase legacy兼容另证cold/render/保原ID，fullDelivery未验；早期“缺v2导致门禁”推断已撤回，不从generic门禁猜因。

这轮仍为fake Auth/Storage/固定Model加真实API/PGlite。旧Task epoch仅1模型替身、0外部provider；新包模型epoch没有登录或模型请求，immutable trace为0model/0external，不能据新epoch的0抹去旧Task生成。故障控件仅专属演练host显式arm，正常release out没有注入。公共模型最初404已定位漏package-pages，未加假资源路由掩盖；rehearsal ENOSPC失败[原日志](C:/幕景/development-evidence/activity-delivery-packaged-rehearsal-enospc.log)保留。C盘曾Free0，Root/导演cache删除自动审批均blocked by policy、未执行；后续约719MB空间来源未知，不归因于清理，仅重试同源已有副本后完整build0。服务跨epoch失去监听的原因亦未核，不以盘满/构建推因果。管线、ENOSPC、路径/chooser/BOM、HTTP探针及真实截图格式等已归[Windows参考](C:/Users/endTree/.codex/skills/windows-local-artifacts/references/scendance-monorepo-check-cwd.md)，quickvalidate0。

**局限与交接。** IAB两自有页和导演headless页仍visible；panel不可见不等native hidden，当前扩展也没有已文档化的后台inactive选项。受控Hook5通过不冒称原生隐藏、手机挂起/丢弃通过，没有在真实浏览器派发假hidden充验收。共享3157仍由导演单独协调，当前固定release目录与manifest交导演后再由其决定切换；旧54、裸60输出、商业原件、源资料与依赖保留。本轮没有stage/commit/push/部署或自动化，真实云、收费模型、现场与客户批准/签署未验，长期完整承办目标尚未完成。下一步按用户最新反馈，先审当前跳转、术语与入口职责，统一活动操作逻辑；不代写导演计划或提前实现。

### 前一增量：合同与约定的正式界面接入（2026-10-10，本机候选已验收并冻结）

导演已验收下述底架组合并明确继续flow/tasks/commercial-ui-integration.md。本轮只在现有「资料分类」挂唯一CommercialDossierPanel，新增「合同与约定」，没有新顶栏或助手模式。资料分类往返保留面板与编辑基线；品牌、登录、项目管理及退出走原source flush，未保存的约定、报告和恢复预检须先处理。本机活动首次打开即核持久layout.id，身份未保存时不读合同；实际layoutStore/controller/API/账号/本机或正式云模式及离开用单调epoch取消旧操作。普通几何、任务或场景服务绑定不取消合同草稿。正式云模式禁读本机档案，不把同ID等同授权；本机档案按活动归属，仍没有账户级隔离。

专业依据先读docs/plans/professional-skill-basis.md及其原版contract-review Skill，仅采用双方、范围、原件来源和缺失事实核对方法。本界面不自动审法、补金额或套付款比例。冻结商业面板、公共契约、storage/backup保持原实现，不扩V1–V4；Root负责CommercialWorkspace及Room父接线，子owner分别冻结分类、持久身份和CloudPanel导航，所有人保留他人修改。

相关单套检查分别为Creative 189、CloudPanel 61、持久身份三套37、真实Host接线8，均通过；商业面板55属于原owner的冻结模块基线，不能与本轮或彼此相加当全产品验证。完整frontend strict types退出0，两独立固定生产build退出0；既有lint/静态导出warnings保留。正常与明确fake API副本以3e65023固定归档加31 overlay、1934源码建成，来源及字节/EOL差异以commercial-workspace-source-proof.json逐项记录，不能把工作树CRLF和归档LF的摘要冒称相同。后端在途activityTask新接口未纳入本合同候选，未改共享3157或缓存。

实际首次未改默认布局即可保存一份明确演练约定，普通刷新后找回；业务包与活动包projectId相同。随后恢复独立30人假设活动（39物件、20任务），分别登记客户委托与供应外包，自制未签署PDF62518/62889字节通过真实上传、保存、刷新找回、按钮下载；两份下载SHA与原PDF逐字节一致。供应约定固定第1版后新建补充草稿，旧版摘要和原件仍在；金额、日期、地点及签署保持未知。第三约定只登记1外链和1缺失来源，外链未自动获取，缺主体和范围明确提示。

正常V4活动备份和独立商务包实际下载；另一个本机来源先恢复同ID活动，再预检确认3份约定/2原件/1外链/1缺失，恢复后导出files完全相同，records只有三个重新建立CAS基线的draftToken变化。活动V4当商务包、异项目包和故意损坏base64包分别明确拒绝；其后导出records/files与恢复前完整全等，没有以空列表或恢复成功掩盖失败。商业包和V4仍各自覆盖，不把合同塞到活动备份。

真实两页面同源编辑同一客户草稿：A保存，B再保存被拒并保留B输入；A下载包仅含A修改。演练后恢复原文保存，没有改固定历史。未保存约定真实阻品牌跳转、登录、新建活动和活动备份；各操作保留原活动和输入，放弃只回当前基线。本地fake Auth/Storage、真实API/PGlite副本中，未保存又真实阻退出；图纸「准备场景连接」不调用模型，绑定后同一未存约定输入保留、业务包仍本机ID；放弃后退出204成功，按活动再次读出的records/files与连接后相同。commercial-auth-trace只有路由/状态而没有payload，不据此声称已验证请求中的私有字段；真实云和生产账号未验。

人工报告另在commercial-restore隔离来源试用，说明反复标注是假设界面操作、PDF未签署且无真实签章；签署日期为空。原报告→追加更正→追加作废三条历史保留、固定版与原件不变。正常用户演练预览仍0签署报告；报告链测试不冒充真实所见签署、验签或生效。商业资料是内部事实管理，未做银行收付、发票、自动合同条款或对外发送。

完整回执C:/幕景/development-evidence/commercial-workspace-acceptance.json。机器回读commercial-workspace-artifact-readback-proof.json的24项与source-proof的10项分别全部成立，身份/导航/报告/并发各UI proof和实际包同目录。正常可试用页http://commercial-workbench.localhost:18504/?local=1，原生CSS1280×720完整图commercial-workspace-final-native.jpg与lists-native.jpg；截图实际为JPEG，旧`.png`引用保留而不转码，不按文件名推测像素。没有给用户页设置仿真，闭态狗狗与动效保留。原件上传初次卡点是分区展开状态/文件选择监听，已按实际DOM展开后成功，原件未转换；Windows路径、filechooser、截图编码、PowerShell本机探针客户端差异已归入windows-local-artifacts自有参考并validate通过。

本轮无stage/commit/push/部署、自动化、真实付费模型或真实活动签署。长期目标未完成；下一段待导演新活动任务typed接口冻结和明确前端接线范围后，继续在已有活动安排中做建议预览、人工选择、保存与读回，不自行启用在途API或新建工作台。

### 前一增量：PetitMaker底部素材与工作台减繁（2026-10-10，本机组合候选已验收并冻结）

**最终回执。** bottom-shelf-focus-final-build-copy与对应rehearsal副本同一3e650基线，1932源/25overlay完全相等、与当时工作树0drift、index空；两生产build退出0/11静态页、完整strict types退出0。最终Root目标lint0错误/9既有warnings；同一Creative单套185、catalog+Library三套36分别记录，IO owner39与后端owner127是已冻结模块检查，不能相加冒充全产品测试。复用官方PetitMaker固定4e120...的物品架/滚动/选中层级原理，不复制游戏美术或状态引擎。

原生1280×720实际从舞台类别做全库「沙滩」查询找到椅/伞，点击座椅类别清query，24→30分页；收起重开、2D后保分类/scroll/分页/聊天草稿。实际公网catalog添加沙滩折叠椅5→6，物件id8eb90f1d-c310-4269-9916-61e3f7a6eddb稳定；宽0.7、旋转90°，撤销0°/重做90°，切3D、刷新重开后布局与brief全部同值。并在最终18500以真实预检/确认恢复同一演练。模板真实回焦最初落物料库，Root仅一行改为明确目标标签；最终active/selected均场景模板、资料hidden、toolbar仅1。此前编辑/IO路径在18496，18500只差这纯焦点行、同CSS/guard/IO；未假称在18500重跑全部无关循环。

实际PNG按钮下载2163×1127，PIL解码且人工打开看到6物件/示意平面；普通PNG800×600原字节保留，6000×4000变1500×1000 JPEG，6000×1变1500×1 JPEG。故意无效PNG实际显示处理失败、busy释放/输入恢复，下载回读旧图/布局/brief全等。所有是自制明确演练图，不是实测场地；V2原件/V4协议未改。bottom-shelf-artifact-readback-proof.json最终39断言全过，与IO模块39是两种检查，分开报告。

导演全新独立Chrome/profile的真实假设30人/39件场景复验390×720、561×720与390×480：canvas bottom332/332/190.406，shelf top344/344/202.406，无叠盖；搜索宽87、中心命中自身、可输入看沙滩结果，收起重开及2D/3D保query。1280图亦实际查看。回执director-bottom-fixed-width-proof.json核25源码0drift；不是本对话IAB仿真或手机真机，未重跑本对话物件/图片/Producer循环。

新Agent演练实际在focus-final-rehearsal/18502，Node24载入本次冻结runner3231.../ai3c84...与真实本地API/PGlite；Auth/Storage/模型是明确替身。checkpoint先提交再模拟DATABASE_ERROR，仅2次固定回复（get_scene→submit）、checkpoint1/fail1，不再旧producer6次往返；结构化503后真实点查询原任务，1GET/by-request取回complete+error+1candidate，尚未应用/确认启用/未过期，固定中断提示可见，create仍1、0外部模型/私有业务字段。不是实际供应商收费或真实云验收。最终bottom-shelf-latest-producer-ui-proof.json与trace收口，原导航旧producer证据不混用。

完整机器回执C:/幕景/development-evidence/bottom-shelf-focus-final-acceptance.json；精确源表bottom-shelf-focus-final-source-proof.json；正常预览http://shelf-workbench.localhost:18500/?local=1，完整JPEG1280×720 bottom-shelf-focus-final-native.jpg。Root Room SHA f29b73bff8a79be837e1f77df93c0e49135b2df23c9a54a4c6533a30a9a28e69、globals80ce1c87c548720ecb59886406ba9ae502fb061cef3a7e27f4a3224d6d866b79；模块/IO/后端其余精确摘要以25文件manifest为准。上述是冻结完成时状态，接下段父接线改动不冒称仍工作树零漂移。3157、旧out/用户资料/分支保留，没有新stage/commit/push/部署/定时，真实付费模型/真实活动/签署未验，整个长期目标尚未完成。

导演已核人类选择“常驻工具栏，素材按需展开”，随后又明确底栏只是例子、全面学习含后端Agent。前端本轮据固定官方源码ObjectShelf/use-scroll-row与已核页面体验，复用唯一ScendanceLibrary/OnlineModelLibrary/ScendanceViewTools：顶栏素材入口迁到底部单一工具条；素材架默认关闭、分类与全库搜索一行、有限高横向卡片。Online一直挂载，收起/切模板/2D保query/24批/scroll/busy；资料继续独立左抽屉、选中属性才出现、聊天独立，数据中模板发现跳到同一底部实例并返回原未存表单。无新工作台、协议、坐标或状态引擎；原预设/灯光/结构/图层/放置路径保留。

真实网络边界组件先复现旧点击代码：同一act内本机A→B→A、下载完成后仍误加一件并选中。新小guard捕获现有不可变layout/floor并同步订阅layoutStore及controller身份、Root controller/API epoch；身份/画布变化永久失效，filter/折叠/视角不失效，调用最新onAdd前再核，finally释放订阅。拖入仍保旧state快照并补同guard。真实调用链红绿和相称回归由唯一catalog owner收口；页面与下载/重开证据尚待，未提前宣称好用。

Root外部模板跳转新回归、原导航/partial一起单套185/185通过；完整types退出0，Root目标lint0错误/9既有warnings。新增模块6项及catalog回归是分别报告的模块范围，不相加当全量。初次未设Node webstorage选项的测试是运行时环境失败，已按同一原配置正确禁experimental webstorage后再跑；无源码或存储文件损坏，不降低TS。独立最终副本需叠已冻结IO4及导演后端冻结源，实际PNG/参考图和新Agent终态再各核一条。合同UI与任务Agent主线仍排后。

第一固定UI-only副本bottom-shelf-ui-build-copy：3e650基线加20overlay、1932source；明确未纳当时后端B在途五文件，生产build退出0。仅自有HTTP18492已服务，匿名正常原生1280×720实际打开素材、保聊天草稿、单个toolbar、无横向溢出；截图bottom-shelf-first-overlay.jpg为失败诊断：素材架300px覆盖原644px画布部分场景，且内滚动多16px。Root已将唯一Viewport包在sc-scene-viewport，通过CSS给底架让空间（原ResizeObserver自行调整、无新坐标逻辑），统一卡片预览缩16px、低高度紧凑、保所有视角按钮；isActive往返也进入同一placement epoch。此修后源码尚需下一固定组合构建/UI，18492旧out保持用于对照，不称最终通过。root导演已建立独立无界面Chrome承担390/561/1280QA，本对话没有再试共享IAB尺寸。

### 前一增量：入口与页面逻辑梳理及partial提示（2026-10-10，本地候选已验收）

固定3e650归档加原十文件候选，normal与显式fake API两构建的1927源码/10overlay摘要完全一致；单套184/184、完整types和生产build退出0/11静态页。独立1280×720原生浏览器实际从执行→素材→资料恢复原分类/未存任务标题；未存导出门禁保留，放弃后V4回读除createdAt所有域相同。来源是navigation-current-build-copy，与后续底部新布局分开，不用这张旧导航图验新底架。

partial本机真实API/PGlite/迁移，Auth/Storage及模型明确替身，0外部调用。直接POST有效候选显示提示；结构化503后实际“查询原任务”走一次GET/by-request，原candidate有效/确认按钮启用，中断提示可见，没有新增model/checkpoint（旧producer6固定模型往返/1checkpoint）。明确请把指令走原direct、仅一POST/apply成功/可撤销；带“仅”的演练语句按原安全分类先preview，作为diagnostic保留。clean正常2固定往返/1checkpoint，没有中断提示。丢网络响应则原writeBlocked正确拒绝候选，未削弱保护强迫演练通过。导航及这些旧producer前端提示证据收口navigation-and-partial-acceptance.json；它们不是导演新checkpoint异常停止模型增量的联调证据，后者需在最新固定源码另核。真实模型、生产云、真实活动未验，无Git写入或部署。

用户686×719原生页的两条批注：右侧三条杠实际打开左侧栏，与「资料」入口的含义冲突；要求整理页面逻辑。只读核实际RoomOrganizer／CreativeAssistant映射，确认旧汉堡只toggle sidebarCollapsed，恢复原leftMode（素材／属性／资料），「打开工具面板」名称因此不真实；资料每次request却强行reset plan/brief，导致执行或图纸重开跳到需求。

当前实际页面地图如下，不把尚未接入的商务面板／任务建议写成已可用功能：

| 区域 | 当前内容与用途 | 当前事实／梳理结论 |
| --- | --- | --- |
| 场景画布 | 3D／2D、物件编辑、参考底图、视角、撤销、画面导出 | 作为主区域，不因切资料重建场景或编造场地事实。 |
| 左侧素材 | 物料库、场景预设、图层；预设页另有灯光与结构微调 | 放置／编辑工具，素材库与AI物料生成用途不同。 |
| 左侧选中物料 | ItemContextPopover尺寸、旋转、复制、删除等 | 选择物件后的上下文，不是新的活动资料页。 |
| 活动需求、图纸与尺寸 | 同一CreativeBriefPanel，planCategory目前只改变标签和定位焦点 | 两入口内容重叠，暂保同一实例／草稿；后续需要同实例hidden分区，不先拆成两份数据。 |
| 执行资料 | 活动安排、逐件物料工作单、制作计划、数量点验；时间表及内部交接导出 | 操作保存在既有同一活动和物件身份，未知时间／数量保持未知。 |
| 方案评审 | 说明、人工画面核对、客户HTML、本机冻结历史 | 当前编辑与冻结历史分别展示，不当现场验收或签署。 |
| 场景模板 | 与素材中的「场景预设」复用ScenePresetsPanel | 重复入口需统一主入口及名称；本轮不删有用内容或新增模型调用。 |
| 物料工具 | 生成、材质调整、历史模型 | 与放置素材区分；是否联网／付费仍由现有明确操作控制。 |
| 右侧助手、账户 | 场景策划／物料建模对话；账户与本机活动／场景连接 | 两者独立于左侧内容；收起态狗狗保留动效，开态不挡发送。 |

本轮首先纠正入口层级：顶栏明确「素材／资料／助手」，移除含糊三条杠；素材打开素材内容，资料首次需求、后续恢复原分类，不回到brief。左侧放明确关闭按钮，关闭和切换均hidden保留输入及SourceFlush，不卸载业务表单；选中物料及原六分类暂保。Root仅拥有RoomOrganizer／globals，子owner在已冻结partial补丁之上改CreativeAssistant请求与相称回归，避免同文件并发。完整地图不是声称本轮已重写所有表单；两处内容重叠列为下一段明确整理项。

在用户批注前，AIHOT首项partial提示已取得旧码红、新179项绿并冻结（dfc41...／5218...），这是模拟React响应层结果；尚待独立真实浏览器故障演练，未冒称真实模型或生产验收。它的两文件补丁保留在本轮候选中，优先完成用户新的入口卡点，再补对应mock API路径，不因为改导航自动重试付费请求。

### 前一增量：胶囊空宽与狗狗动画（2026-10-10，本地候选已验收）

用户新增反馈「动画没了／右边空白」，随后截图明确圈的是狗狗胶囊内部右侧，并非页面白板。当前用户原生页16实测innerWidth686、workbench686，清可能残留尺寸设置前后相同，未刷新／改输入；原胶囊180px、文字右侧空85.83px、animation none。按真实根因只改creative-studio.css，不修改页面布局、TSX或测试，也不恢复开态浮控。

胶囊width:auto配viewport max-width，保48高／38头像／gap8／原padding／bottom104／z21。新原生候选实测宽110.74、文字右侧16.57px正常边距，无页面溢出。仅胶囊内狗狗恢复原4s无限呼吸，以及细指针hover的0.65s摇摆两轮；实际computedStyle分别cr-breathe/infinite及cr-think/2。聊天展开后胶囊节点0、消息头像animation none。减少动态效果规则经CSS解析及独立优先级审查确认覆盖hover为none/transform none，本轮未用媒体仿真冒称真设备偏好验收。

本轮IAB全程原生尺寸，不发Emulation设置；用户页只读及清旧设置未改变实测宽。独立候选取得83张真实Page.screencastFrame、时间跨度4.2345秒、29个不同transform，原始1280×720帧与时间戳保存在capsule-breath-native/proof.json。由实际帧原样时序编码为capsule-breath-actual.mp4（144×64裁出胶囊及周边），首帧已解码查看，确有狗狗与Binggo，没有空录屏；全页图capsule-motion-final-native.jpg保留上下文。不是合成动画、截图替代录屏或生图资产修改。

副本capsule-motion-build-copy继续固定98ea9613加原十文件候选，与上一轮十文件摘要比较仅这一CSS变化；1912源与十文件摘要构建后无漂移，index空，生产build/type/lint检查退出0、11静态页，既有警告保留。只做与CSS相称的解析／宽度／真实动效检查，没有重复168、模块176、备份或打印；它们分别保留上一轮基线，未冒充本轮结果。新CSS SHA e5f1dd664797105350fe7af7ee46f6fe92f35a6c5432fcefcac6afce3114be44。

当前预览http://capsule-motion.localhost:18486/?local=1，正常原生尺寸且收起态可看动态。回执capsule-motion-acceptance.json及capsule-motion-source-proof.json。该CSS不读写活动数据，已保存的演练按同一runbook备份载入供观察；正式云／付费模型／真实活动／真设备触摸未验。旧18484用户页及其out、原输入与3157保留，没有Git写入或部署。下一步仍按导演已明确队列处理partial AgentRun安全提示，再接已冻结商务模块，避免与新任务建议领域owner并行改其两文件。

### 前一增量：收起态狗狗入口与冻结交接导出整合（2026-10-10，本地候选已验收）

用户最新校正优先：截图中的狗狗胶囊在聊天收起时应保留，不能将其与展开态挡发送的小头像一起删除。只改creative-studio三文件，将已有AssistantMascot以38px复用为「狗狗＋Binggo」入口，唯一显示条件为`!studio.expanded`；点击走原openChat，不恢复首次提示、悬停计时器、呼吸动画或虚假在线绿点。聊天展开后该右下节点完全不存在，消息旁30px头像继续保留。顶栏助手、X／Escape与已验收的有限8帧回焦保护不变，工作模式和两份草稿保留。

胶囊180×48，right16／bottom104，z21低于参考底图22及工具25。独立CUA dog-entry-check.localhost:18484在1280×720、561×719、390×844观察无横向溢出、胶囊与画布工具矩形无交叠；1280全部可见工具中心不被狗狗遮挡，561真实点击2D可进入平面。390胶囊可直接点开，展开capsuleCount=0、发送中心为本按钮、原dog-entry-rehearsal草稿仍在；Escape关闭后胶囊1个且focus回「打开助手」。`dog-entry-ui-proof.json`记录本轮实际状态。所有尺寸仿真只用于临时页，之后清设置并关闭，不碰用户18480／18482页。

同一次自然构建按导演明确交接叠入原owner已冻结的execution-timetable-export.ts/.test.ts和production-plan-export.ts/.test.ts，不改这四文件。时间表的非空现场核对说明置于任务主区，内部逐件工作单显示原item.notes，客户公开文件不因此公开内部备注。原owner四套176及导演已做的真实打印是模块／打印基线，本轮不相加也不冒称再次运行；本轮只补现有工作台按钮实下载和独立文件回读。

固定98ea9613归档加六项此前UI候选及四项冻结导出源码，副本collapsed-dog-runbook-build-copy。1912项源／十项工作树摘要构建后一致、index空、无私密env，未纳入商务WIP或新AIHOT partial-run提示切片。新唯一同批相关168项、完整types、生产build（11静态页）退出0；既有hooks／导入／img／rewrites及JSDOM canvas提示保留，不与旧168／173／470叠加。产品lint无错误、文案1064字符clean；无新增依赖和新图。

实际恢复导演独立execution-workbench-runbook-rehearsal-v4.json（39物件／20任务，仅演练签到接力完成条件作已注明的假设补充），真实按钮下载时间表61757字节SHA256 0ae48c4790ae823f6d904b2e72c26c921d5b8d6d065a639767bca0e1fee2b377；内部交接80721字节SHA256 22756c763d51691344b94d94419c45527fefd5f0066fe003b5d1ce9f070b41db。独立HTMLParser回读确认两条非空任务说明均在可打印主区、39行物件备注保留、签到接力文字在两份文件；回执runbook-ui-download-readback-proof.json。原候选HTML及旧下载未覆盖，不重做无关打印。实际V4再下载107526字节SHA256 4f01b60009b9ce0985457547658c9d597280380500f267e2de14e04f37cb3a9f，除createdAt外全部域与独立输入相同；dog-entry-runbook-backup-proof.json记录保存／导出回读，没有执行或完成任何真实活动任务。

当前预览http://dog-entry.localhost:18484/?local=1，保留收起态狗狗便于用户试用。最终页从未仿真，原生CSS1280×720／DPR1.75／工作台1280，完整截图dog-entry-final-closed-native.jpg。回执collapsed-dog-runbook-acceptance.json及十文件精确SHA collapsed-dog-runbook-source-proof.json。旧18480／18482及3157、用户资料和输入未刷新或改动；此轮没有Git写入／推送／部署、真实云、付费模型或真触摸硬件验收。

下一步按导演已分配的AgentRun部分完成提示切片推进：普通有效候选与后续中断应明确区分，不能自动重试付费任务；商务组件仍等原owner正式冻结后再接共享身份与flush，不抢写其三文件。不以本轮狗狗或导出修复关闭整体长期目标。

### 前一增量：消息气泡、选项卡与顶部助手入口（2026-10-09～10，本地候选已验收）

按用户提供的Grok Bot对话框参考图实施：删除右下萌宠及其首次提示、悬停偏好与占位，顶部「助手」开关重新打开，聊天X／Escape收起。助手头像仅在消息旁以30px显示，回复用气泡；原有最多三项实际准备入口改为竖向A/B/C选项卡，可关闭及明确「查看建议」恢复，不增加第二个输入框，不自动发生成。原工作模式、两份草稿、来源／提案保护、保存失败提示和收起时待处理读屏状态保留。参考图是用户直接设计方向；前一轮Fluent／Material官方导航依据仍只支持任务分组取舍，不冒称成熟产品证明幕景可用性。

同时落实此前批注：移除全局底栏，原物料数与面积移画布标题；本机保存状态留顶栏及窄屏聊天告警。字体18／16／14／12四层，8／16／24主间距，素材三等分标签及两等宽卡片、正方形预览和固定文字行。业务选择器已修成实际`.cr-business-content.cr-workspace-content`，实机字体四值且无额外层级；初次选错class时七层字体的截图只作失败诊断。Root去掉窄屏打开业务后重复closeRequest，避免显式聊天回焦抢走任务／需求字段。CloudPanel增加纯onClose回焦回调，修账户弹层跨窄屏关闭时落BODY的旧实证，不改账户数据。

代码只改六文件：room-organizer.tsx、globals.css、creative-studio.tsx/.css/.react.test.tsx及cloud-panel.tsx；源从已发布98ea9613固定归档加这六项建立，1912源码摘要和六项工作树摘要已核无漂移。商务WIP及导演新分配的两项导出修复未混入。当前chat-panel-refinement-build-copy独立build与完整types已过，相关最终同文件168项通过；首次两次build类型失败及完整tsc发现的RTL参数失败保留记录，修正确effect返回／无效ref分支／getByRole参数后再通过，不降低配置。既有hooks、导入、img、静态rewrites警告保留；Root入口lint无错误，文案1718字符检查clean。后续窄屏回焦源码修订须另建最终副本并重新作相称检查，不能用上述168冒充修订后结果。

实际CUA独立演练恢复原execution-workbench-after-task-save-v4.json，39物件／20任务。1280×720、561×719、390×844均无横向溢出，发送按钮启用时中心实际命中本按钮，corner launcher／global footer均0；截图像素已各核对应尺寸。选项卡关闭回「查看建议」、恢复回卡、桌面X及Escape回顶部、两份草稿与模式往返均已观察。561从时间表选项进入执行任务后焦点保在「执行工作单」；390聊天已关闭后打开资料焦点保在「客户需求」。最后发现390 X关闭后顶栏恢复而实际焦点仍BODY，已唯一交原chat owner修可见性与回焦等待，尚不宣称这点已通过。

本轮实际下载V4为107136字节，SHA256 5fab48061774a3aa88f84aff32d5ca2e68a6347cdd5a5506fef1bdf90dd9e01a；与原演练除本次createdAt外全部域全等，layout（含全部任务／制作计划）、brief、materialCheckins和sourceDocuments均不变。回读为chat-panel-backup-readback-proof.json。新预览曾先提供http://chat-panel.localhost:18480/?local=1；用户打开时本对话还留390临时验收Emulation，导致左窄／右白，已立即清而不刷新，原生CSS841恢复、工作台宽相同、无溢出，截图chat-panel-restored-native-size.jpg。该页现在用户使用，后续不覆盖它的out或继续仿真，最终修订另建副本／端口并只在临时URL检查，展示前清尺寸。文件选择最初JS反斜杠路径误读，改正斜杠后相同V4立即可恢复，未转码或改权限。两项经验均已补windows-local-artifacts的自有scendance-monorepo-check-cwd参考。

**最终收口。** 窄屏显式X／Escape关闭改为至多8帧等待顶栏入口可见、确认实际获焦；重新打开或用户已转向其他可见控件时取消，并保留cleanup。原390回归只拓展同一case验证隐藏首帧→可见次帧、重开取消及不抢其它按钮焦点；最终新同批168项、完整types与chat-panel-focus-final-build-copy生产build（11静态页）退出0，不叠加前面168或旧173。新1912项源及六文件摘要构建后无漂移，index为空，manifest/source-proof明确排除商务和新导出WIP。

真正独立临时URL chat-panel-check.localhost:18482的390实机已核X／Escape后activeElement为「打开助手」BUTTON，草稿focus-rehearsal-draft重开仍原样；从聊天进需求焦点留「客户需求」，无角落浮控或横向溢出，发送中心仍本按钮。收口proof为chat-panel-final-focus-proof.json、截图chat-panel-final-focus-390.jpg；已清测试Emulation并关闭临时页。最终当前预览http://chat-panel-final.localhost:18482/?local=1，以原39物件／20任务独立假设演练恢复，仅截图正常原生页，从未给它设置仿真。其原生CSS1280×720、DPR1.75、工作台宽1280，完整JPEG为chat-panel-final-native.jpg，不能把其2240×1260像素称作1280×720原图。18480用户页及其out保持，不再覆盖或刷新。

最终回执为C:\幕景\development-evidence\chat-panel-final-acceptance.json，六文件精确摘要为chat-panel-final-source-proof.json；前述导出回读发生在最后纯焦点补丁前，明确标为本轮数据回读而不虚报再次下载。记录最新回焦检查与旧版失败证据的关系，不重跑与焦点无关的数据／打印循环。字体与三宽度布局证据在最终纯焦点修补前取得，CSS/root未再变；最新390及正常原生页再次确认无遮挡和无溢出。

本地匿名演练与实际浏览器观察分别记录，未调用真实云／付费模型／客户资料；不是设备触摸或真实活动验收。3157与用户旧页保留，本地此轮不stage／commit／push／部署。上一完整22项已随98ea9613发布，不能与本轮未提交六文件混称同一候选。下一步按导演新分配的唯一冻结导出owner四文件，另做实际按钮下载与独立runbook演练核对；本轮当前18482尚不含两导出fix或合同面板，不提前宣称已集成。

### 前一增量：执行时间表与精简工作台（2026-10-09，本地候选已验收）

按导演的执行时间表验收及用户两条界面批注推进：前端只接已有scene-delivery-panel入口，execution-timetable-export两文件由模块负责人冻结，未覆盖；随后精简顶栏与聊天导航。资料集中为业务区有明确标签的六项分类，聊天最多三个当前阶段建议；时间表与物料建议分别定位活动安排／物料工作单，重复导航保留原输入和聊天模式，不自动发AI、导出或提交。用户最新要求的顶栏外圆角和外留白均归零，浅栏约54px，活动名与本机保存状态仍可见。窄屏聊天仅一层标题，收起时用带可访问名称和title的44px头像开关，位于画布工具上方，不覆盖2D。

时间表复用prepareBackup及唯一V3/V4解析，一致读取已保存的任务和点验；明确absent合法，not-in-file拒绝。每次生成新UUID及时间，HTML冻结本次源，不受后续修改影响。实际回归先红后绿修复需求ready变化迟到下载，以及ready往返／A→B→A恢复原refs仍可下载的缺口；源epoch变化后旧结果不能恢复有效。导航首挂materials被原默认effect覆回operations也有真红，合并为唯一初始化／导航effect。四个执行子面板继续hidden保留，任务与物料草稿往返不卸载。

最终同批八套470项通过，含交付入口、正式时间表模块、制作交接、活动任务、Provider导航、账户及评审捕获；不与此前232／60／161／386等交叉批次数量相加。完整类型检查通过，相关入口和顶栏实现lint零错误；Provider八条、旧测试一条及构建所示既有警告保留。文案检查通过。后续只有贴边／头像CSS和title微调，最终独立生产build重新核类型、11静态页exit0。固定HEAD 309932f只读归档加19项明确候选源码；1902项副本源码及19项工作树摘要构建后不变，未引入在途商务契约，也未使用暂存区。第一次提前启动的构建被停止，未计为通过。

实际CUA使用独立本地演练，原源item-dimensions-after-v4.json，39物件／20任务／座椅宽0.55及原点验、图纸。真实按钮下载A为60667字节，SHA256 7e4d5f366d592dccbaf0b20b24f7a2caaf3d2db7113406c53b24af5db6661b8e；task100标题改为“演练：确认活动目标与交付范围（本次导航试用）”时，未保存阻导出且输入保留。保存后B为60715字节，SHA256 bda568782214e30b466558d2212621a9dcf4f2f53fe107e00813c7a19bc36e17，取得新编号，A保持原字节；刷新后任务标题找回。实际V3/V4备份亦下载回读。独立HTMLParser／JSON审查125项成立：任务展示字段、日期／负责人索引及链接正确；完整V3布局仅这一标题变化，物件、需求、计划、账册保持。117保留原accepted并显示有效需复核；20／18／18对应未收2／未还0。正式HTML未包含完整task JSON及reviewedBasis原hash，不能把展示字段回读宣称完整任务序列化。未知计划日期由单元边界验证，本轮20任务均有假设计划日期；全部实际时间仍未知。

最终预览为http://execution-workbench.localhost:18468/?local=1，候选副本execution-workbench-ready-build-copy。1280×720、561×719、390×844均核真实CSS视口及原始JPEG像素尺寸，顶／左右贴边、radius0、无页面横向溢出，头像与工具矩形无交叠。六分类逐项打开既有页面，聊天模式保持plan；建议materials／operations定位、聊天草稿返回找回、账户头像仍进入原本机活动dialog已实际核对。新布局返回场景后实际捕获2D 533×613与3D 804×612，分别等于当时可见canvas的实际尺寸；未逐图核对不能下载。演练中明确勾选底图许可、逐图检查后，两PNG原字节进入178483字节HTML，SHA256 a312439cc709ba45d223e84364dbdd0a9a68f673cbece5856d7be6faa7ae6812；保存原本机冻结库后下载逐字节一致。导演也独立解码两PNG核一致，不是只用组件测试冒充实机。

成熟依据通过agent-reach／Jina实际读[Microsoft Fluent Toolbar](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage)的任务相关命令分组与低频操作折叠，以及[Material M2导航指南](https://m2.material.io/design/navigation/)的分类、深入与返回状态。浅色贴边顶栏、阶段成果建议和具体入口是幕景本轮取舍，不宣称官方案例直接证明可用性。仍需用户试用判断。

回执为C:\幕景\development-evidence\execution-workbench-ready-acceptance.json，独立文件回读为execution-timetable-ui-readback-proof.json，最终三幅图为execution-workbench-final-{1280,561,390}-scene.jpg；原始capture、当前／历史评审HTML及真实V3/V4均同目录。普通浏览器viewport曾改到选中旧页、普通截图也按外层面板缩放，错误命名已由准确原始截图覆盖；只用已文档化CUA tab能力调整尺寸和捕获，无产品数据注入，结束清临时尺寸。UTF-8控制台输出及截图尺寸识别经验已补windows-local-artifacts自有参考，不转码有效源文件。

边界：匿名本地演练与本机IndexedDB，不是真实云协作、付费模型、真实活动或客户批准；没有合同UI。历史评审仍独立下载，不随V3/V4迁移。共享3157未停服或同缓存build，旧18462保留；本轮未stage／commit／push／部署。下一步交导演收完整候选并根据用户试用确定后续切片，不自行扩模块或重建定时任务。

### 前一增量：方案评审说明草稿与本机冻结文件（2026-10-09，本地候选已验收）

按导演交接接手八个评审库／父面板／Provider文件，并将真实生产接线回归`creative-studio.react.test.tsx`作为必要第九文件。保存两段文字和已核对的客户HTML，复用原forms复合键`['project-review-library',JSON.stringify([apiUrl,userId??null,scope])]`；未增加一级工作区或内部交接库。公开选项、逐图审批、历史画面均不随文字载入恢复，历史标为原生成时的冻结副本，不作当前内容自动比对。

独立审查复现恢复等待期间仍可输入新说明、切活动后丢失的阻断。真实Provider→CreativeAssistant→ProjectReviewPanel→Library两条回归先红后绿：新增输入锁承接backupPending，说明／许可／载入／放弃拒绝晚到修改，但不使评审自己准备时的backupPending取消生成；被未保存说明拒绝恢复后，补同步来源标记的重新渲染，放弃后可以正常生成。没有在恢复事务末尾强行再次flush。StrictMode初始读挂起也先红后绿，cleanup清操作种类后重放可发第二次读取，旧返回不能覆盖新数据及草稿CAS版本。

最终同批七套386项、完整`tsc --noEmit --incremental false`通过；新增库／子面板及相关测试lint零警告，Provider、现有图片和旧测试Hook警告分别保留，不宣称整个前端零警告。独立副本由固定HEAD 309932f只读归档加明确九个工作树文件建立，不使用暂存区；11静态页build exit0，1900项副本源码及九个本轮源码摘要未变。共享3157、旧18456／18458／18460均未停或覆盖。

实际CUA独立来源`http://review-library.localhost:18462/?local=1`载入既有30人／39物件／20任务／演练原图与点验V4。UI保存两段说明→生成无图和一图文件→保存本机冻结副本→刷新明确载入／预览／下载，四个公开开关均false，已批准画面及旧当前HTML也清除。无图20685字节SHA256 881daedb6997c8c047a0f3525a7eda6ebf8c1f5a6e242f4726af35d02414707f；含实际2D演练画面的文件147478字节SHA256 0965ffad6b2e0f044c4b13943c56f73d1e72684ffd485456aa50793b7c87260b。下载与原生成字节一致，座椅宽0.45→0.55同活动来源改变后，历史字节／编号／时间仍原样。

实机还验证折叠评审且返回素材后，未保存说明仍阻新建与完整备份，输入保留；放弃后备份可下载且39物件／20任务／计划／账册与源演练一致。新活动说明及文件列表空，旧活动两份文件和独立说明可找回；新活动未保存说明也阻打开旧活动，保存后放行。两页同身份原生IndexedDB草稿CAS：旧版保存拒绝、输入保留，当前获胜内容不覆盖，明确重读后重试成功。未手工改React或IDB，未破坏真实资料。

阶段实机回执`C:\幕景\development-evidence\project-review-library-acceptance.json`，生成／下载HTML与关键截图同目录，最终图`review-library-final-history.jpg`。当前原活动保留可试用，第二并发页已关闭。实际浏览器使用匿名本地身份；账号／API变化、读取／配额故障由单元和集成边界验证，真实云、真实客户批准和模型效果未验。评审库不随V3／V4迁移，仍需单独下载。按用户“大版本更新，不用随时git”偏好，暂存区为空，没有提交／推送／部署。本段完成后按导演已定范围接现有执行时间表入口。

Windows检查的目录／配置扩展名误判已修，并归现有windows-local-artifacts的`references/scendance-monorepo-check-cwd.md`，从原定位参考链接，不修改有效业务文件或转码。

### 前一增量：本地活动的材质场景服务（2026-10-09，源码冻结，待整合验收）

导演明确分配本轮仅`frontend/components/room-organizer/panels/material-customization.tsx`及`.react.test.tsx`，样式无需修改。BackendSession场景绑定由另一个负责人维护，`frontend/lib/geometry-workbench.ts`及Provider／CloudPanel／RoomOrganizer共享接线由导演维护，本对话不覆盖。已有执行资料的本地活动需要使用远端场景处理，同时保留自己的活动编号；这不等于把完整活动转成云项目。

材质页scope仍为`apiUrl:userId:layout.id`（本机活动ID），seed.projectId和Context.projectId使用`geometryProjectId(controller,layout.id)`得到的真实远端ID。Context独立捕获binding、身份epoch、编辑会话、版本及租约代次；候选project_id及应用结果id校验远端ID，落本机解码使用当前layout.id并通过既有mergeProposalPresentation保留当前任务、制作计划及原物件工作单。独立数量账册不进Scene或Layout，正常新增点验记录可以继续操作，不因几何应用回滚。账号、API、映射、A→B→A、布局、编辑权或候选过期会拒绝迟到结果。

免费材质槽GET与制作候选、提案、资产授权、GLB准备、确认应用前后均使用导演的`assertGeometryActionSource`核对来源。有效场景绑定允许本地任务／计划／工作单／账册；本机账册损坏或读取失败仍停止。普通完整云项目及URL含project的路径继续使用旧严格资料门禁，没有借场景服务放开完整云转换。发出Scene时仅本地活动工作区清空objects.notes，customize仅发送既有材质修改契约，不发送执行资料、账册或私密备注；应用按稳定物件ID恢复当前本机备注及v2缓存备注。因BackendSession.proposalState会在draft不同步时改变localRevision，本地路径先在来源校验后同步脱敏Scene，再重捕Context，保留原候选／资产幂等机制；远端映射加入proposalKey，换场景后不复用旧提案编号。

已登录且配置了服务的本地活动在尚无可用编辑权时显示「准备当前活动的场景服务」。该显式按钮只调用`ensureGeometryWorkbenchReady(scene,name,localActivityId)`，不自动制作材质、准备提案或应用；连接失败保留颜色等输入，同目标重检保留仍有效的材质槽选择。连接自身创建远端绑定可完成，期间本机布局、选择、账号或API变化会停；读取账册结束后还须当前映射等于此次准备返回的project.id，不能把另一有效远端映射报为本次就绪。未登录沿原登录前提，普通云项目沿原编辑权路径。

成熟依据本轮用agent-reach／Jina实际阅读[Blender官方材质分配](https://docs.blender.org/manual/en/latest/render/materials/assignment.html)：材质与共享网格关联会影响共用对象，与实例关联可以让同几何使用不同材质；材质槽明确指定作用范围。幕景保持先选稳定物件ID与实际槽、创建独立派生版本、对比后确认的既有流程，不把源资产全局改写，也不声称本轮验证了真实模型生成或UV处理。

最终同批一个文件42项全部通过（26项原有回归＋16项本地场景服务及跨入口用例），完整typecheck、两文件ESLint零警告、产品文案237项clean及实际两文件diff检查通过。明确标注的独立演练夹具携带任务、计划、工作单、私密备注及约定20／实收18／归还18，实际执行渲染→制作预览→确认应用的受控界面步骤，读回mock请求与onApply布局：本机ID、资料和备注保留，wire没有私密哨兵；后补零数量原始记录仍保留、汇总短缺2／待归还0。失败检查覆盖免费检查／连接／制作／应用读取失败、错误远端候选、映射及账号变化、准备失败输入保留、没有租约不自动制作，以及全部旧幂等／槽选择／GLB／普通云保护。本批与此前41项、数量门禁及导演整合测试有重叠，不相加。

**跨入口同步复核。** 导演追加核查“普通Agent／重建先把含备注Scene放到controller.draft，再打开材质页”的版本自增风险。产品源码原已在来源核对后、制作提案前按需`setDraft(baseScene)`，紧接`captured=context()`重捕localRevision，并未在组件mount写草稿。本次不改产品源码，仅新增一个测试，按真实Scene schema、canonical比较及BackendSession的parse／dirty／revision增量／订阅通知语义模拟提案同步边界：原草稿版本7含私密备注；mount及免费检查无同步；明确预览只脱敏同步一次到8且通知一次，提案准备与应用发现草稿已相同、不再自增；预览／应用成功，本机ID、备注及业务资料保留。该单项1／1、完整文件42／42、ESLint／diff及完整`tsc --noEmit --incremental false`通过。它是贴近真实SDK语义的网络边界模拟，未重演真实Auth、租约或服务器；不声称发现或修复了新的产品缺陷，原两文件再次冻结。

两文件冻结摘要与依赖／API见`C:\幕景\development-evidence\material-geometry-workbench-final-source-hashes.json`。证据为前端jsdom、真实共享schema及来源helper、模拟网络／资产加载；不是独立浏览器或真实服务验收。保存重开、V3及导出回读、正式静态构建和独立浏览器试用由导演接线后完成。本对话未build、修改3157、改视口、调用真实模型或云数据，未提交、推送或部署。下一步只验收现有接线，不扩大材质功能。

### 前一增量：独立本机活动与再打开（2026-10-09，源码冻结，导演整合）

导演明确分配本轮五个新文件：`frontend/lib/local-activities.ts/.test.ts`及`frontend/components/room-organizer/panels/local-activities-panel.tsx/.css/.react.test.tsx`。当前活动改名或套用布置仍属于同一项目，不能当作新活动复制。本轮增加独立的新建／打开入口；Provider、CloudPanel入口、source-storage复合键和已有未提交表单门禁由导演及另一个负责人维护，本对话不覆盖。

面板导出`LocalActivitiesPanel`及`LocalActivitiesPanelProps`，接收`layout`、`actions:LocalProjectBackupActions`、`disabled?`、`onComplete?`。先`actions.prepareBackup()`，再将完整V3归档到forms复合键`['local-activity',projectId]`，原生事务提交后独立读回校验；任一步失败保留当前活动和新名称输入，不执行切换。同编号旧归档的点验事实使用既有共享merge合并，旧的空／缺少新增记录的快照不能清掉原收还记录；原编号内容冲突或更正分叉停止写入。损坏归档不覆盖、不删除，列表明确提示无法读取的份数。

新建先填写名称，再选择空场地或沿用当前布置。空场地使用既有10×8米示例尺寸、零物件，界面明确提示可按实际修改。沿用保留物件／结构编号、米制位置、尺寸、转角、资产来源及可用公开资产引用；新活动使用独立`house-UUID`项目编号。两种方式都生成brief absent、materialCheckins absent的V3，沿完整`actions.restoreBackup()`恢复，不走会保留旧业务资料的几何onApply。沿用清除旧任务、制作计划、物件工作单、备注、方案历史、内部图层、底图、来源图片、墙线证据及图像绑定的标定尺寸，保留独立实测约束；不把旧图上的归一化点解释为新场地的米制坐标。私有临时模型授权URL沿既有layoutForExport剥离，稳定assetId不伪造。

打开归档也先保存并读回当前活动，再重新读取目标V3并调用原完整恢复事务；目标本机点验账册与归档按原编号合并由Provider保证，不以档案时间覆盖较新的事实。异步准备、归档、目标读取绑定布局／项目epoch，A→B→A也拒绝旧操作；恢复自身的目标项目变化须允许，外部禁用再启用仍取消迟到的完成提示。导演挂载位置为「账户与项目」，仅本地且无待打开云项目时显示，`disabled`只传外部cloud busy，不包含面板动作自身的backupPending。

成熟依据本轮用agent-reach／Exa与Jina实际阅读[Rentman新建与复制项目](https://support.rentman.io/hc/en-us/articles/360013590720-Create-or-Duplicate-a-Project)及[项目模板](https://support.rentman.io/hc/en-us/articles/360013367659-Project-Templates)。前者区分空项目和复制项目，后者明确实际人员／运输排班不会直接复制。幕景采用独立项目入口和明确沿用范围，本段只复制物理布置，不预填新的人员、供应方、费用、地点或活动日期。

最终同批两套24项通过（纯逻辑13、界面11），本轮源码／测试ESLint零警告、产品文案214项clean，新文件空白及文档差异检查通过；不与旧批次相加。覆盖V3往返、复合键隔离、原子合并、冲突、读写失败、v2几何／资产保留／隐私清除，以及异步项目／布局／禁用ABA、归档失败保留输入和完整恢复调用。两种成功时序（真实flushSync更换布局prop后Promise结束、Promise先结束而父prop后渲染）均确认onComplete一次、名称清空且目标活动notice保留，当前受控界面未复现实机卡点，不称已修复。

完整类型检查在04:36通过；04:39新复核读到导演刚加的`creative-studio.react.test.tsx:1116`整合测试使用getByRole不支持的exact参数而失败，本对话五个文件未报错。导演随后已修正该测试参数，并报告新活动＋Provider三套157项通过；本对话按要求不重跑全量、不改其文件，最终完整类型检查由导演进行。导演真实Provider prepare／归档／flushSync恢复整合测试证据为`local-activity-provider-test.log`，157项与本对话24项有重叠，不相加。五个新源码／样式／测试文件均已冻结，API与摘要见`C:\幕景\development-evidence\local-activities-final-source-hashes.json`。

导演独立execution.localhost演练已新建零物件／零任务／brief及ledger absent的新ID并真实下载V3读回，也已打开原39物件活动；本对话另读回`C:\幕景\development-evidence\local-activity-empty-v3.json`确认版本3、新ID、零件、无tasks／plan及brief／ledger absent。但实际弹层未关闭、名称未清和完成提示未出现，仍须源码冻结后在独立生产构建复核，不能把该次热更新页面观察或24项模拟检查称作最终入口验收。生产构建、最终浏览器、保存重开和导出回读由导演负责，本对话未运行build、修改3157、调用真实云或生图。V3不打包原图／照片二进制或模型缓存，本机同ID资料可保留，不承诺跨设备完整素材迁移。

**导演静态实机回执。** 正式独立构建已验证新建沿用原39件布置且不含旧执行资料，弹层自动关闭、名称清空、完成提示正确；打开原归档仍保留约定20／实收18／归还18。本轮未放松时序或隔离守卫，此前热更新页面的完成现象未在正式静态构建复现。视觉实机另发现CloudPanel位于.sc-header内，旧header按钮规则使新入口出现白字近白底；导演已明确接手`local-activities-panel.css`，提高仅本机活动按钮及hover的选择器优先级并重新构建。本对话不覆盖该CSS，其他四个源码／测试文件继续冻结；样式修订后的最终构建与对比度验收仍由导演收尾，不扩大本轮范围。

### 前一增量：制作计划与本机保存（源码冻结，待整合实机验收）

导演已授权按冻结的production-plan-contract接入岗位班次、计划到离场、物料取得与运输安装依据、预算覆盖范围及人工估算。只记录计划，未知保持null，不把估算写成报价／实付或把计划时间写成实际到场。旧项目无块表示未记录，显式创建后才有productionPlan；引用使用原taskIds／objectIds，孤立引用保留并显示。

接线契约：独立ProductionPlanPanel接收`layout`、`disabled?`、`onUpdate?:(value:ProductionPlan|undefined)=>void`；SceneDeliveryPanel增加`onUpdateProductionPlan`同签名和「制作计划」页签。导演拥有的CreativeStudioProvider／StudioValue向下透传该回调；RoomOrganizer回调先commitHistoryNow，再actions.setProductionPlan(value)。动作／parser已落盘，不建立平行保存真源。Root本对话不改creative-studio、room-organizer、use-review-capture或评审模块。

制作字段由RoomLayout可选productionPlan、schema／whitelist／legacy parser及原persistence链保存，完整备份V2由备份负责人接入。公开分享递归剥整个计划，根及方案簿里的计划都会触发现有本地业务云门禁。场景转换仍用于读几何，云连接／写入不能把不支持的计划默默丢掉。

设计版本与模板应用保留当前项目的活动任务、制作计划及同编号物料工作单；几何版本切换不回滚后来的完成证据和实际时间，不采用另一活动的业务资料。物件／楼层复制沿现有新物件编号机制，原任务及计划关联保持，不把原工作单或取得记录自动绑给新物件。命名另存是同项目的存储槽位，并不是新活动复制。完整项目打开和备份恢复按完整目标替换，不能被这条几何保留规则拦成混版。

岗位配置或取得／运输安装范围变化纳入对应任务／物料工作单的核对依据，缺失引用保留；原状态、证据和实际时间不篡改，由原有效状态显示需复核。仅预算／估算变化不等于现场验收变化，更新财务提示而不强制无关任务重核。金额由精确十进制字符串转换为安全整数分，最多两位小数；空与0不同，总额沿共享summary区分已知部分和未知覆盖。

新增共享入口需求为上述制作回调，以及当前项目几何应用的最新资料保护：onApplyCreative先读取`current = layoutStore.getState().layout`，使用`preserveCurrentActivity(current,next)`，再沿原canApplyLayoutGeometry／commitHistoryNow／snapshotBeforeReplace／applyLayout链应用。人工场地草稿的sceneKey只含几何，不能发现草稿期间新增的制作计划；这层保护防止旧草稿带回旧任务／计划／工作单。现有ScenePresetsPanel已在本对话最小接入同一helper防止模板替换丢活动资料；onLoadLayout及完整恢复不得套该规则。相关UI、动作、回读与最终验收结果完成后追加，不以前一阶段已放行的520输入构建替代本段验证。

**已实做界面与检查。** 现有交付面板第三页「制作计划」支持显式创建、整份草稿取消／保存、岗位班次人数／来源与计划到离场、取得方式／规格／来源／运输安装、预算范围及依据和人工估算。三类记录可按原ID多选任务／物件，失联或歧义保留并提示，可明确移除关联；非法金额和时间留在草稿，不能回写旧值。金额空／零／已知、预算上限空／零／已知分别呈现，只显示已知部分合计和未知范围。原ISO offset／毫秒在未编辑时保持，显示及新填时间按北京时间。成功提示绑定采用版本，Undo清除，Redo不复活；跨项目／外部变化保留草稿并阻止覆盖。叶子控件与第三页25项回归为其中子批，不与最终批相加。

最终同一批17套408项全部通过，覆盖制作界面、动作、精确金额、相关任务与工单复核、缺失关联、物件复制、设计／模板保留当前活动、存储／JSON／分享及备份V2／恢复。新helper还验证旧几何草稿应用时保护后来更新的活动数据。完整typecheck（--incremental false）通过；lint导入顺序提示已在本对话所有权内修正，差异检查通过，四个产品文件的严格文案716项clean。此前211／117／59／433及后端17项、备份负责人60项均为分批或其他责任方证据，不相加当本轮总数。

成熟依据本轮经agent-reach／Jina重新阅读[Rentman项目时间安排](https://support.rentman.io/hc/en-us/articles/360013599680-Time-Schedule-of-your-Project)：人员、设备和运输的安排时段与使用时段需要区分并关联。幕景采用岗位到离场独立于活动任务时间、通过原编号关联取得／运输安装范围的做法；不抄自动报价、库存可用性或未获授权的真实班次。受控样例为独立演练签到岗、演练椅子及人工估算，不当作真实活动、供应方或报价。

本对话23个数据／界面／逻辑／测试文件冻结摘要见C:\幕景\development-evidence\production-plan-final-source-hashes.json，公共契约及备份模块列为依赖，不冒认所有权。备份负责人已完成默认新写V2、严格兼容V1及legacy；本对话将旧“version2未知”UI夹具改99后，导演已明确接手local-project-backup-panel及其测试，本对话不再修改。导演已接onUpdateProductionPlan透传与actions回调；仍须确认上述最新资料保护，并在独立浏览器实际填写→保存→撤销→刷新→备份导出／恢复，删除引用后回读，核公开分享不外带，最后统一构建。当前不是整段实机验收或平台完成。未build、推送、停3157、修改视口或调用真实AI／云生产资料。

**时间输入复核（2026-10-09）。** 导演独立production.localhost演练中，CUA fill两日期后DOM.value有值且validity为true，保存与真实V2下载仍为null；随后同样填入再用原生ArrowUp／ArrowDown使年份往返，保存后的到离时间正确保留。因此不能称普通用户输入普遍丢失，低层CUA／React事件交互根因尚未确认。新增两端真实fireEvent.change同批→保存的用例在旧handler就1／1通过，非红转绿。

本次仅production-plan-panel.tsx／同名测试做防御增强：在事件处理器同步取value／badInput，状态更新器只用捕获值并合并当前草稿的另一端，不在延后回调里重读DOM，也不借保存时读DOM绕过React草稿。转换、ISO／毫秒保留、时区、校验、保存接口与共享文件均未改。最终完整叶子文件12／12、完整typecheck、两文件lint、文案396项及diff通过；不与408项基线相加。两文件再次冻结并更新原23文件清单；本增强不宣称修复CUA fill，导演继续以原生输入及实际下载回读验收。

导演随后实际下载V2确认：计划到场2026-10-17T12:30:00+08:00、离场14:15:00+08:00；1岗位／2人，10件已有＋20件租赁关联，人工估算1000.50元＋1项未知，预算上限5000元，原20任务／39物件及简报一致。这些是独立演练证据，不是真实活动或报价。本对话按导演要求停止所有代码变更；工人可读交接出口由评审负责人提供productionPlanHandoffHtml纯helper，导演接导出按钮，本对话不新增模块或改已冻结面板。

### 前一增量：生成后人工编辑矩形场地

录音B的11:00明确提出生成后缺少场地编辑，14:23强调真实尺寸和出入口。只读审查确认：总宽／总深原来仅为生成约束，已有v2外框被正确保护；门洞微调藏在场景预设中，墙端点核对仅在needs_review任务出现。导演已授权本轮补人工编辑，保持原保护，不扩自动识别、收费模型、评审或人员预算。

**现有入口与操作。** 在原「图纸与尺寸」的ReconstructionPanel顶部显示当前场地宽深及「编辑当前场地」。打开独立草稿，修改总宽／总深及现有门窗的距墙起点、宽、高、离地高度；灰色虚线与绿色草稿对照，橙色门窗变化单列。任意修改取消人工核对勾选；勾选并通过全部校验后才沿原onApply应用，一组撤销和原本机保存继续生效。取消不写主场景，重建候选或待核对任务须先处理，编辑期间不能并行生成或采点。未创建假任务或新表单协议。

**几何与记录。** 独立venue-edit helper读取当前真实编辑布局，首步仅支持四条闭合轴对齐外墙及明确四角矩形轮廓。固定wire参考角(0,0)，只移动高X／高Z外边界；普通物料、内墙和柱的米制位置、ID、实际尺寸、旋转和锁定保持，编辑器居中坐标由原adapter重新换算。门窗不增删、不换归属墙，保留offset距墙start的米制语义；所属墙移动导致门洞位置变化会在预览提示。显式总宽深及直接编辑的门宽高约束保ID更新，其他实测／图上／耦合约束保持，冲突必须处理。未修改结构的识别状态不自动变已确认。

复杂／不闭合轮廓、独立venue.entrances缓存、受影响挂墙物件、内墙或旋转柱越界、门窗越墙及新增／加重碰撞明确拒绝，保留原场景和编辑草稿。复用sceneV2Schema、dimensionConflicts、adapter及原canApplyLayoutGeometry；不导入会移动全部物料的自动校准函数，不新增公共API或改后端契约。

**失效与底图。** 草稿绑定当前场景、项目epoch、来源身份和Blob、编辑会话／租约代次／版本。同项目有新编辑、A→B→A、换图、租约到期或会话变化会清除主画布预览并阻止旧草稿；确认时再读最新controller，不把本地应用报成云保存。原图registration完整保留；宽深改变后原frame对应不可继续采用，须重新采点确认，同frame仅门洞编辑保持固定参照。修改已采用场景也使旧重建任务结果失效，不能被旧结果覆盖。

**成熟依据。** 本轮通过agent-reach／Jina实际阅读[SketchUp官方缩放说明](https://help.sketchup.com/en/sketchup/scaling-your-model-or-parts-your-model)，借鉴明确选定修改范围、固定参考点、输入尺寸和确认。幕景选择只改场地边界且保留物料实际米制位置，这是针对活动场地的实现取舍，并未照搬整场或选组比例缩放。

**正式副本反馈小修。** 导演已在独立正式构建副本实际恢复reference-before-visibility演练备份，核对原图三点后将10×8改为11×8并确认，原图对应停用；Undo回10×8后原对应恢复ready。这是初版功能的实机证据，同时复现成功提示仍称已应用、待生成width仍11的矛盾。此次仅修reconstruction-panel.tsx及其UI测试：成功提示绑定应用后的sceneKey，撤销或后续布局变化时清除，Redo不复活；原重建输入明确为待提交生成尺寸，宽／深／层高与当前场地不同则列出双方值。用户后续输入完整保留，不在Undo时自动回写。

本次小修完整UI文件26／26通过，包括Undo→Redo、同项目后续编辑、用户新填宽深保留及差异提示消失；完整typecheck、实现和测试lint、文案1180项与diff通过。几何helper、CSS、保存协议和共享入口均未修改，前述78项为初版基线，不充当本次重新运行。五文件冻结清单已更新，仅实现／UI测试两项摘要变化；导演继续同步最新源补独立构建及这条状态回归的实际浏览器验收，本对话未操作其正式副本。

**当轮验证与冻结。** 最终同一批5套78项全部通过，包含10个新增界面路径、23个几何／往返用例及原底图／重建保护，不能与子批8项、旧53项或历史基线相加。完整typecheck（--incremental false）与四个TS文件ESLint通过；初次typecheck发现测试直接修改只读坐标，已改为替换坐标对象并在最终批通过，未放宽类型。文案1181项clean、diff检查通过。受控演练为12×8米矩形和独立合成物件；实际步骤覆盖预览→改宽／门宽→重勾核对→一次回调、非法门洞、取消、同项目新编辑、项目往返、换Blob、即时租约代次变化和到期。parseStoredLayout及原备份序列化／解析证明完整结构和约束往返，属于代码层回读，尚非浏览器下载或真实云验收。

源码仅reconstruction-panel.tsx／CSS／同名测试和新venue-edit.ts／同名测试五文件；SHA清单保存于C:\幕景\development-evidence\venue-edit-final-source-hashes.json。没有修改creative-studio、room-organizer、use-import-export或客户评审模块，这些共享入口由导演整合。当前源冻结，导演继续独立build、桌面／窄屏浏览器、实际确认／撤销／刷新和备份导出回读；本对话未build、推送、停止3157或调用真实AI。录音驱动的长期目标仍含评审、执行等后续项，当前增量不代表平台完成。

### 上一轮反馈小修：常驻聊天开关、底部控件与独立资料状态（已验收）

用户指出展开后右下开关消失、设置应在输入框下方、查看执行资料后无法聊天。本轮真实根因是展开态CSS隐藏launcher，settings放在消息区顶部，以及共享的plan/model/delivery状态被业务入口和恢复导航写成delivery，进而隐藏composer。仅修改 `creative-studio.tsx`／CSS／同名UI测试三文件，没有改Root布局、Provider业务逻辑、数据协议、底图或备份保护。

对话状态现仅plan／model，资料状态独立；需求、图纸、执行、模板及恢复后的资料导航不改聊天模式／草稿，唯一输入框始终可用。初次plan、收起重开保最后真实对话模式，正常换项目保持原清稿隔离。切model不自动打开资料或收起窄屏聊天，用户可明确点「物料工具」再选择椅子；材质预览与原单件intent／确认保护沿用。

同一个右下开关在展开与收起时都可达，展开态40px图标，底部54px避开全局状态条；输入区控件及说明右侧留出空间。唯一模式下拉、原direct／JEV设置及发送按钮集中在同一个composer底部toolbar，settings为图标details向上弹出，显示真实短状态；Escape先合设置并回summary焦点，下一次才关闭聊天。左侧Portal资料新增独立Escape处理，已被嵌套控件消费的事件不再重复处理，回真实业务入口；legacy外部shortcut仍沿原关闭／焦点策略。去掉重复聊天标题，欢迎缩为真实能力的一句说明，没有添加供应商／模型切换假功能。

最终同一界面批次43项全部通过，76项Provider保存／未涉及路径按范围未运行；覆盖资料导航不改chat意图与两稿、390／768切模式不跳走、五处真实资料入口Escape、settings实控／禁用／IME及双Escape、恢复顺序、JEV／运行／原任务／候选及旧浮窗兼容。完整typecheck（`--incremental false`）、文案993条与diff通过；lint无错误，有8条原有／非阻断提示，不报成无警告。冻结三文件SHA256在 `C:\幕景\development-evidence\chat-controls-final-source-hashes.json`；未构建、推送、停止3157或修改浏览器视口。

导演最终独立chat-controls副本build exit0／11页，511源码摘要与当前冻结实现一致。1280／768／390浏览器验收通过，常驻开关、输入下模式与设置、两份草稿保持、资料／设置Escape焦点和窄屏无重叠／横向溢出均已实测；772bd44已上传原开发分支。受控提案测试不算真实AI调用，Root本轮未进行真实模型请求。该轮已收口四项反馈，继续保持助手交互冻结。

### 前一轮有限目标：画布持续可见的停靠工作台（源码冻结）

用户明确授权定目标并执行后，本轮依录音三种核心能力、普通人可用及独立可隐藏长对话列落实布局。Figma标签及四段导航仍为讨论候选，没有新增营销、美术、办公室等模块。成熟做法实读 [Miro Sidekicks](https://help.miro.com/hc/en-us/articles/30139627329042-Sidekicks) 的旁侧对话与显式选取画布对象作为上下文，以及 [SketchUp AI Assistant](https://help.sketchup.com/en/ai-assistant) 对帮助／单件生成的不同入口；本轮只是采用相关交互，没有接入这些产品的AI。

默认桌面为250px工具／素材、持续可见的中央画布和340px停靠聊天。收起聊天实际释放列宽；中窄屏先收工具，按需资料／属性与聊天互斥，手机默认聊天关闭、打开抽屉可返回场景。没有新增canvas resize机制、重置相机或修改场景；复用原ResizeObserver与逐事件点击坐标。

需求、图纸核对、执行资料和模板按需进入左侧稳定host，首次开启才挂业务组件，之后隐藏保留原实例与草稿；不会默认启动隐藏的重建表单写入／查询。右侧保留唯一composer、原任务查询、候选与人工确认保护，并明确当前整个场景、单件／选中物料或人工执行核对范围。选中属性嵌入左侧，编辑／锁定功能复用原组件；原底图与备份WIP完整保留，Provider及相关数据协议未改。

最终相关UI与页面同一批次3套92项通过，40项原Provider保存事务按范围未重复运行；新增docked／embedded用例及旧兼容用例有重叠，不与子批次相加。完整typecheck（`--incremental false`）、文案1245条和diff检查通过；lint无错误，保留Assistant的8条非阻断提示。本轮冻结仅7个布局实现／CSS／测试文件，精确路径和SHA256见 `C:\幕景\development-evidence\docked-workspace-final-source-hashes.json`，未修改前轮底图实现以扩大本轮范围。

主前端独立frontend.localhost实际观察：1280×720工具250、画布634、聊天340；聊天关闭画布974、草稿重开保留；按需需求左420时画布464，返回素材恢复634。选择椅子仍model且显示单件范围，回plan保原未发送草稿，只有一个composer。768默认工具隐藏、聊天340、画布392；390默认聊天关闭、画布约362，打开及返回场景可操作，均无文档横向溢出。临时viewport已reset，截图 `development-evidence/docked-workspace-desktop-final.jpg` 已保存；没有发出真实AI请求，也未操作用户127.0.0.1／其他导演资料。

导演已经独立dev验证画布634→974、椅子仍model、草稿及左侧桌子属性，并开始复制511项源码后的独立构建／冷启动验收。本轮不据开发中HMR中间态宣称产品故障或稳定性完成。完整生产副本、物件命中、2D／3D切换、窄屏、底图／备份实际入口由导演验收；受控提案测试不算真实AI能力验收。源码已收口，不再改页面／视口、进行美化或重跑全仓检查；本对话不build、push或停止3157，下一轮继续由用户反馈决定。

### 已收口：主画布参考底图（基线54e5876）

2026-10-08导演最终回执：独立生产副本build通过，511条源码清单与当前实现一致。旧图上传、透明度0及刷新；v2本地上传／选择、放大的采点区、人工确认后主画布显示；关闭工作区后CSS稳定；墙厚提交后对应仍有效及撤销，均已在稳定页面实测。用户要求仔细核原文和变化中的Figma、逐项交流；本轮不再新增功能，保留当前源码与未提交文档，等待下一步明确方向。未提交／推送、未部署线上不冒称发布完成。

用户明确继续后，导演安排本轮完成旧底图及v2图纸在主画布的可用闭环；没有恢复定时任务，也没有混入预算、人员或客户评审功能。参考 [SketchUp官方二维图像与描图](https://help.sketchup.com/en/sketchup/importing-and-using-2d-images) 的导入、定位、调整及顶视描图做法（本轮通过agent-reach实读）；幕景复用原三点对应和既有保存路径，用户确认图像位置与尺度后才作设计参照，不把摆放参考图等同实测正确。

**入口及数据路径。** 主画布右上「参考底图」提供显示开关与透明度。旧PNG/JPG/WebP图经原`readImageAsDataUrl`缩图、额外实际解码检查后进入原`floorPlanImage`；错误、取消或读取期间换场景不覆盖原图。旧图明确标为按场地范围放置的示意图，保留原fit规则。显隐与透明度在ViewSettings中，只改变主画布；图片存在性仍保持原外墙／基础／入口规则，隐藏及透明度0显示不透明地面，不用删除图片完成隐藏。

v2入口「选择图纸并核对对应」直达原策划页的图纸核对区；本地按实测尺寸创建的场地可上传原图并人工标点，无需AI／云识别。Blob仍在同scope的source-storage，原Form.registration扩展固定worldWidth/worldDepth、图像尺寸、可信source身份、坐标框架basis及人工confirmationId，不新建wire协议或表单真源。原ReconstructionPanel仍是唯一写者，一条队列协调自动保存、flush及人工确认／回读。主画布新hook只读取原sources/forms，按当前scope解析唯一平面图，验证真正解码尺寸后生成临时URL；提交后通知只读视图重新读取，切scope或迟到回调撤销旧URL，不把旧图挂入新画布。

**对应规则。** 三个像素点分别对应Scene角点原点、X端点和Z端点；逆仿射用于2D，3D再显式减场地半宽／半深一次。三点与采点会话绑定scope/source/坐标框架，换图后不能拼入旧图点；旧记录无世界尺度或未人工采用时保持待核对。校验有限数、像素边界、点间距离、相对退化及矩阵条件数，拒绝近共线病态输入，保留正常旋转、错切和镜像。固定框架内移墙／门窗不撤图、不重算比例；场地宽深、项目或来源改变要求重核，不自动更改结构confirmed状态。

核对当前设计的采点区复用原容器，桌面高度`clamp(300px,60dvh,560px)`，390px等窄屏为280px，业务列继续滚动，确认按钮保持可达。新图纸为独立参考层，正常2D与拖动重绘同步显隐／透明度；3D使用同一四角仿射，不参与拾取。物料编辑产生同值映射时不重复载纹理，换scene及迟到纹理有清理。

**验证与冻结。** 最终同一相关批次12套164项通过，40项原Provider备份／需求存储用例按范围未运行；涵盖矩阵及来源、原核对流程、确认／补偿队列、读取与解码失败、A→B→A、入口焦点／原实例、旧图实底、2D普通／拖动及3D资源生命周期。与各子批次有重叠，不相加。完整typecheck（`--incremental false`）、文案2068条与diff检查通过；本轮7个相关实现文件lint无错误，有9条非阻断提示，未报成无警告。源码摘要在 `C:\幕景\development-evidence\reference-image-final-source-hashes.json`，覆盖25个本轮实现／测试／CSS文件；本对话没有build、停止3157、提交或推送。

- 主前端在独立frontend.localhost真实选择合成PNG、重开后仍可使用旧图，2D显隐可操作，前后摘要为5件物料／80平方米。截图为`development-evidence/reference-legacy-2d-visible.jpg`及hidden对照；上传取消、错误和迟到不覆盖的细分支为受控UI测试证据。没有修改用户127.0.0.1、discussion.localhost或导演reference.localhost资料。
- 导演独立reference.localhost已实走本地v2、A两点→切B为0/3、重新标点确认、刷新ready、正向与旋转B、2D／3D方向及显隐。显隐前后的两份真实下载layout／brief／coverage逐值一致；合成图700×580、10×8米、60px/m及中心转换按真值核，不算真实场地或模型识别。证据为`reference-v2-3d-visible-final.png`、`reference-v2-3d-hidden.png`、`reference-v2-2d-visible.png`等；最终放大采点区、宽深变更及legacy稳态复验由导演在冻结后继续。

**稳定性回执与验证界限。** 编程期间出现动态CSS失挂：只有app/layout.css，助手与底图控件position变static并被画布遮挡。独立页面普通刷新后恢复fixed／absolute，原filechooser流程才成功；当时没有据此宣称全部情况是无害HMR。源码冻结后，导演已在生产副本核到关闭工作区CSS稳定，并完成build和511条实现清单核对。该诊断和Windows校验脚本默认GBK读取问题已进入 [现有Windows排障skill](C:/Users/endTree/.codex/skills/windows-local-artifacts/SKILL.md)，UTF-8模式技能校验通过；不存在文件及PowerShell glob错误按已有路径规则纠正，没有转码或重建正常源码。

改变宽深的失效规则已由相关单测覆盖；在真实UI通过本地手动创建来改当前宽深，仍被既有复杂结构保护拒绝，这是保留的正确边界，不为验收新增尺寸编辑器或削弱保护。坏存储、迟到结果和确认补偿等受控故障测试不冒称浏览器原生事务故障注入；正式云图片、跨设备对应同步、真实活动和现场测量精度未验收。本轮止于本地底图对照，不继续增加边界或业务功能。

私有来源不自动进入公开分享、客户评审或现执行交付GLB；截图包含用户当时选择显示的参考。v2原图及registration仍为本机附件／Form依赖，不在布局／简报备份内，不能声称跨设备恢复其图片或真实云同步。原legacy蓝图导出规则保持，本轮没有扩客户评审附件白名单。

### 前一轮：展开工作区的业务与聊天分列（2026-10-07）

导演已依据用户最新讨论及Figma草图放行这一项有限界面增量。完整分析由导演维护在 [讨论与草图分析](discussion-and-sketch-review.md)，本对话只落实业务和聊天分列，不把探索项、手绘占位或私密语音内容写入产品和公开资料。

原唯一 `.cr-chat-feed` 同时容纳业务表单、消息和提案，消息自动滚动会带走正在填写的表单。现保留同一棵React树，业务进入独立 `.cr-workspace-content`，聊天的消息、运行／原任务恢复、候选／提案和通知进入独立聊天滚动区；唯一发送框固定在聊天列底部。展开标题为「活动工作区」，桌面宽度不小于900px时两列，浮窗及窄屏堆叠。三模式、两份未发送草稿、项目隔离、备份恢复导航和提案确认保持原逻辑，没有修改Provider、存储、共享协议或后端。

展开界面可以收起聊天；收起只隐藏DOM，保留聊天草稿与表单实例，业务列占满可用宽度。有运行、原任务待核对、候选／提案或助手提示时，工具条仍可发现并重新打开。执行交付和模板仍只查看既有运行与待处理提案，不新增执行AI或发送能力。选物料快捷按钮会展开聊天并聚焦原物料草稿；关闭重开收起聊天的工作区时焦点回到可见入口。业务和聊天的两组展开／浮窗滚动位置独立保留。

本轮仅拥有 `creative-studio.tsx` 的Assistant区域、其CSS和相关UI回归；其他未提交修改均保留。3157继续由导演exec77682运行，前一轮生产build通过及452源文件hash核对是基线，不算本轮UI构建。主前端在独立 `frontend.localhost` 实测1280×720下业务列约823px、聊天列约424px，两列独立overflow:auto；滚动业务至约707px时聊天保持0，收起聊天后业务扩为约1247px且只有一个发送框。真实截图保存于 `C:\幕景\development-evidence\activity-workspace-chat-columns.jpg`。导演另在独立 `discussion.localhost` 核对草稿、策划／建模往返、选椅、执行页无发送框、浮窗往返及390px无横溢，视口已恢复；没有调用真实模型或改变用户127.0.0.1资料。

**最终冻结回执。** 同一批Assistant相关UI回归68项通过、40项未运行，覆盖直接入口、简报交互、项目隔离、统一Agent、原任务与JEV，以及3个相关预览／派发用例；未重跑Provider备份与原需求存储。回归实际复现材质调整页在聊天收起后重开的焦点留在幕后，已在原焦点分支补通用处理。最终完整typecheck（`--incremental false`）通过；其间发现新增测试使用了Testing Library不支持的`exact`选项，删除多余选项后，原Generation实例／草稿／焦点测试单项再过，不与68项相加。产品文件lint无错误，保留4条原有非阻断提示；文案978条clean、差异检查通过。

主前端在最终源码完整刷新后实走「材质调整→收起聊天→Escape→顶栏重开」：模式仍为model，聊天仍收起，activeElement为「展开聊天」，`focusInsideWorkspace=true`，发送框DOM仍唯一。这是本地真实浏览器证据；运行恢复／候选／提案的错误和待处理分支由受控UI测试验证，没有调用真实模型或验收正式云协作。本轮production build及独立副本与最终源的hash一致仍由导演核验，不把前轮构建成功算成本轮放行。

本轮源码已冻结，可由导演完成统一构建。本对话没有提交推送、build、停止3157或接客户评审UI。用户要求今天先收工，后续按导演明确的小增量安排继续；日报／周报与团队飞书、私人Today只讨论衔接，不新建日报系统、定时任务或自动读取私人数据。

### 前一轮：首次入口、人工简报与完整备份（2026-10-07）

当前以用户最新反馈和共享计划为准：首次入口、主要内容的清晰度、人工活动简报，以及完整备份导出／预检／恢复／撤销一起收尾。下方早期入口和导出切片记录是历史依据，已被导演的完整恢复接入安排及用户最新的设计要求更新，不能继续据此停止在导出按钮。

**首次入口与流程。** 原顶部「执行工作单」通过 `deliveryOpenRequest` 强制进入执行交付，这是首次打开看到后期工具的直接原因。主入口现为「活动工作区」，首次进入展开的策划页并聚焦原活动简报；再次进入保留当前模式和草稿。沿用原策划／建模／执行三模式、模板资源和展开／恢复能力。首屏呈现「活动简报 → 场地与物料 → 分工排期 → 验收交接」及一项主要操作；活动草稿、演练、已保存简报、示例尺寸待核和分工条数按实际记录显示。模式不代表活动所处阶段，有文字或证据也不自动代表真实事实已确认。

**人工简报。** 在原需求描述内显式添加共享的人工提纲，保留原文，重复点击不重复添加，超过1800字拒绝而不截断。目标、观众、范围、约束及到达／进入／观看／交流／离开体验由人填写；纯未填提纲不能触发整场生成。没有新表单真源、后台协议或模型调用。

**完整备份。** 使用独立负责人冻结的文件模块；原Provider串行协调真实需求保存、读回、恢复与补偿，专用回调完整替换布局并核对本机保存。确认前仅校验和预检；取消、坏文件、切项目及迟到结果保留当前资料。相同项目ID恢复会刷新需求并取消旧自动保存，原生Web Locks避免另一页面占用项目时覆盖；锁不可用或当前已打开云项目时明确拒绝恢复。恢复成功后留在执行交付；当前页可撤销这次恢复，新编辑后拒绝盲目覆盖。照片附件和模型文件不嵌入备份，无稳定归档ID的模型引用明确提示且预检不加载。收尾反例已关闭：当前项目的恢复／撤销补偿未完成时拒绝导出，防止旧布局与文件需求混合；重试完成后可正常导出，其他未受影响项目仍可备份。

**成熟做法与推断。** 已按agent-reach阅读 [Rentman项目时间安排](https://support.rentman.io/hc/en-us/articles/360013599680-Time-Schedule-of-your-Project)、[Cvent内部执行日程](https://www.cvent.com/en/blog/events/event-itinerary) 及 [Blender工作区](https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html)。本项目据此区分活动的操作顺序和工作工具，先说明目标，再安排布场／活动／撤场的工作、时间、责任和物料；采用是结合当前源码的设计判断，仍须用户实际试用。

**数学研究的可用部分。** 本轮实际阅读OpenAI于2026-10-06发布的 [Sharing AI progress in mathematics](https://openai.com/index/sharing-ai-progress-in-mathematics/)：研究强调可检查证明、公开材料和独立核验，其中使用的内部前沿模型尚未发布。幕景借用其验证纪律，把“不因切模式丢草稿”“默认建议不冒充真实需求”“恢复与导出不能混用两版资料”写成规则，构造反例并分别核对存储和真实文件。普通回归测试不是完整程序的形式化证明，数学研究也不能证明界面好用或审美正确。

**生图与设计。** 按用户明确的“生图模型”要求，通过环境内置image_gen生成原创透明图标并复制进项目；接口没有具体模型选择，不猜型号。图标用于起步提示，关键含义由文字表达，避免靠装饰理解流程。项目资产为 [activity-planning-v1.png](../../frontend/public/assets/workflow/activity-planning-v1.png)，完整提示词与来源见 [活动规划图标记录](../../frontend/docs/evidence/activity-planning-icon.md)。未读取密钥、未调用外部付费API，没有替换原有角色素材。

**本轮证据与冻结回执。** 源码已冻结，可由导演统一生产构建。整合批次10套194项通过，覆盖Provider、需求存储、备份面板、交付面板、整体恢复、本机持久化与hydrate、流程提示、页面及照片。此后只修补偿未完成时的导出一致性：Provider／需求存储111项通过；最终提示调整后备份事务29项再过。两条同ID恢复／撤销的“文件需求写成功→布局提交拒绝→需求补偿拒绝→立即导出拒绝→解除故障重试后导出正确”及不同目标B失败而当前A仍正确导出均有受控测试。各批次有重叠，不相加、不把194项冒称包含后来新增反例。最新迟到scope重置的4项相关回归和焦点断言由界面负责人另核通过。最终完整typecheck（`--incremental false`）、产品文案1637条和差异检查通过。8个相关实现文件lint退出0、无错误，有8条非阻断提示（5条import顺序、固定装饰img建议及2条Hook依赖提示）；没有把有提示的结果报成无警告。

- 主前端在独立 `frontend.localhost` 打开通用入口，实见plan、大工作区、简报焦点、已加载图标及无横向溢出；1280×720内工作区范围为(16,16)至(1264,704)。见 [首次打开截图](../../frontend/docs/evidence/activity-start-workspace.jpg)。没有编辑或刷新用户127.0.0.1资料。
- 导演在独立 `director.localhost` 实际下载A（17人／7任务／D-01及原文提纲）；完整预检B不改A，确认恢复B（30人／39物料／20任务），撤销回A并刷新通过。同项目双页面锁拒绝覆盖，关闭另一页后重试成功；同ID恢复立即及刷新均保持30人，不被19人的旧保存覆盖。坏JSON明确仍保留上一份A候选，取消保持B。再次下载B，与源演练文件的layout／brief／coverage逐值一致；见 [备份恢复截图](../../frontend/docs/evidence/backup-restored-project.jpg) 及 `C:\幕景\development-evidence\backup-ui-acceptance.json`。
- 上述是本地真实浏览器、下载和回读证据；故障注入与保存补偿由受控测试验证，未做浏览器原生IndexedDB配额／事务失败注入。没有调用真实AI、完成正式云协作或真实活动验收。本轮production build仍由导演在最终源码冻结后统一执行；本对话不停止3157、不运行build、不提交或推送。

下一步依共享计划接入同一时点的客户图文评审包；独立负责人已有文件模块，但本轮没有接入其按钮或画面捕获。人工简报与图文评审两部分均完成才算第一增量完成，费用、现场变化、复盘及真实协作仍属于后续目标。

### 第一阶段选择与依据（历史记录）

第一阶段沿用现有工作单，先解决可靠导出，再把它变成主工作台里一次点击可达的操作。之前需要依次进入 Binggo、模型与交付、场景交付；直接入口复用同一实例、表单、选择与保存链路，保持画布，不复制另一套任务数据。状态筛选和批量分工分别留作后续小增量，不与本次入口混成大型工作台改造。

2026-10-07 已按 agent-reach 阅读以下官方内容；表中的幕景选择是结合当前源码的推断。

| 成熟做法 | 本轮采用 |
|---|---|
| [Asana My Tasks](https://asana.com/features/project-management/my-tasks)：专门入口集中呈现执行任务 | 主工作台显示名称明确的「执行工作单」入口 |
| [Planner My Tasks / My Day](https://support.microsoft.com/en-us/planner/training/manage-your-tasks-with-my-tasks-and-my-day)：聚焦任务仍关联原计划 | 直接打开现有场景交付，不再建任务真源 |
| [Planner 组织团队任务](https://support.microsoft.com/en-US/Planner/training/organize-your-team-s-tasks-in-microsoft-planner)：任务列表呈现负责人、进度和期限并可筛选 | 后续在已有列表做必要筛选，当前保留稳定实例关联 |

本轮具体小目标：①修复后端审查已复现的旧布局 JSON／分享中的临时授权地址，只清理导出副本并保留资产标识、公共稳定地址及本地样例；②主工作台一次点击打开现有执行工作单，聚焦内容，关闭／Escape 后焦点回到入口，普通场景与完整模板的门禁保持一致。每项单独记录回归与浏览器结果后冻结，避免与下一阶段混验。

下一阶段的 `RoomLayout.eventOperations` 已由导演安排后端提供唯一共享契约。本对话等**契约冻结与本阶段生产构建回执**后再写准备／布场／活动／撤场任务，保留计划／实际、负责人／外包区分；本轮不提前加入这些字段，不复制现有 IndexedDB 活动需求真源。

### 活动安排接入前的只读核对（2026-10-07，历史记录）

共享 `event-operations-contract.ts` 已落盘并有冻结回执；接入前前端还没有 `RoomLayout.eventOperations`。以下保留当时的只读核对；后续已获导演接入指令，实施结果见本页第二增量记录。

| 接入点 | 必须保持的行为 |
|---|---|
| types／schema | 直接引用共享类型与校验，加入可选字段和白名单；旧布局不自动多一场活动，无效字段不得静默剥离 |
| reducer／历史／保存 | 复用稳定布局 ID、既有 action 和完整快照；几何与活动安排同时保存、撤销、恢复，不另建历史真源 |
| 物件删除与任务关联 | 保留任务及原 objectIds，派生断链；同 ID 撤销恢复可重新连接，新同名物件不得被自动挂回 |
| 编辑 JSON／分享／交付 | 编辑备份保留活动，公开分享递归剥除活动资料；交付封套将 operations 放在严格 Scene 外，复用现有资产地址清理与快照编号 |
| 云操作保护 | 扩展现有 guard 到根及 designBook 的活动元数据，空 tasks 也需保护；交付转换继续可用，不误称已云保存 |
| 核对依据与时间 | 计划、实际分开；输入显式使用北京时间偏移，未知实际保持空。无物料任务有自己的摘要，不能直接调用会要求物件存在的 handoffBasis |

需求仍读取现有 `useCreativeBrief`／CreativeStudioProvider 与 IndexedDB `${layout.id}:brief`。已核到读取和自动写入错误被吞掉，且 hook 没有暴露 ready／error；下一阶段需展示失败，并防止读取失败后用默认“24人”等建议写回。稳定布局 ID 可复用 store 的 withHouseId，不复制一份活动需求。

真正“复制活动”与保存备份要分开：仅复制物件不新增任务；若显式复制整场演练，须重建任务 UUID、按实际实例映射重挂关联，并清除实际时间、进度、证据和旧依据。命名布局保存保留原 ID，不能冒称已经完成活动复制。

后续实施须逐项留下共享契约建议中 E1–E9 的测试与浏览器证据；本次没有运行这些尚未实现的前端用例，没有运行构建或改变 3157 服务。

### 2026-10-07 · 第一增量实现冻结与交接

本轮先完成旧导出风险修复，再完成直接入口，均只改前端，不混入 EventOperations。代码已收口，后续浏览器回读和生产构建由导演接手。

- **旧布局 JSON／分享**：共用 `frontend/lib/layout-export.ts` 清理导出副本，未知归档 assetId 去除临时 glbUrl，已知公共资产回到既有目录的稳定地址；不凭 source 标签判断是否公开。递归覆盖 designBook，JSON 保留 handoff，分享继续剥除执行资料；当前画布、几何和本机保存不变。4 项假 token 回归先复现失败，再修复通过；重开保留资产编号，缺素材明确拒绝交付，重新授权路径通过 mock 与已有本地 GLB 验证。
- **直接入口**：主工作台新增「执行工作单」按钮，一次点击打开并聚焦现有交付工作单；收起／Escape 后返回原入口，原 Binggo 路径仍可使用。没有创建第二套页面、数据模型或任务系统。390px 溢出采用既有紧凑品牌样式修复，断点由 380px 提前到 480px；保留三个功能按钮及其 accessible name，590px 布局不变。
- **最终检查**：6 套相关测试、115 项通过，覆盖文件／分享、直接入口、面板、交付与复核；前端 typecheck、文案检查和 diff 检查通过。导出修复另有 8 套、236 项定向通过记录；这两个批次有重叠，不相加冒充唯一测试数量。没有本轮生产 build，没有停启 3157。
- **浏览器已验**：独立 `localhost.` 来源使用系统默认 5 件物料，在首桌工作单标注“本机演练，非真实现场验收”。入口一次点击打开，五件实例和采购三类保留，演练工作单保存后刷新仍显示进行中。590px 下工作单、账户和物料菜单均可见；导演另已确认 590px 的打开焦点与 Escape 返回入口。首个截图曾处于样式热更新中间态，重新读取页面后已替换为最终样式截图。
- **导演回读通过**：390px 修复后工作单横向范围 84–192、账户 196–332、物料菜单 338–370，均在视口内，文档没有横向溢出，单击后工作单焦点正确。590px 单击与 Escape 返回入口此前已通过；临时 viewport 已 reset。生产 build 由导演在本次冻结后统一执行。

QA 页已保留交接：Codex In-app Browser `browserId=2`、`tabId=1`，地址 `http://localhost.:3157/?local=1`。临时 viewport override 已恢复默认。截图见 [590px 演练截图](../../frontend/docs/evidence/delivery-entry-590.jpg)。未刷新用户正在查看的 127.0.0.1 页面。

本轮没有扩查样例导入：尝试用“演练 · 执行入口检查”的 3 件分享样例启动后，页面仍呈现系统默认 5 件；已按导演安排改用明确标注的默认演练样例。该观察尚未定位原因，不将其当成已修复的数据问题，也不与本轮入口验收混在一起。

### 2026-10-07 · 第二增量：活动安排实现冻结

第一增量生产构建已由导演完成并恢复 3157。收到接入授权后，本轮在原「执行工作单」内加入「活动安排／物料工作单」两页签。活动安排直接引用后端冻结的 [唯一共享契约](../../supabase/functions/_shared/event-operations-contract.ts)，内嵌可选 `RoomLayout.eventOperations`；不改严格 Scene、云端接口或数据库。普通旧布局保持原读取与几何修复行为。

阶段安排参考本轮已阅读的 [Rentman 项目时间安排](https://support.rentman.io/hc/en-us/articles/360013599680-Time-Schedule-of-your-Project) 和 [Cvent 活动时间线](https://www.cvent.com/en/blog/events/event-timeline)。结合现有源码，本轮采用准备、布场、活动、撤场分组，独立记录计划区间与实际区间，并将阶段与进度分别呈现。任务可不关联物料，也可多任务关联同一实例；负责人、承接团队、时间与完成条件未知时允许草稿，明确显示待安排。

已有任务时，首屏保留需求摘要和资料类型，需求详情与新增表单收起，先展示任务。每行显示负责人、完整计划日期区间和北京时间；原始未开始任务不反复显示实际时间缺项。新增任务展开并聚焦一次；修改已有任务不抢焦点。错误提示放在折叠区外，保存失败时保留填写内容。空任务可显式载入六项「30人演练安排」，每次生成新任务 UUID、清除进度／实际时间／人员／证据／关联，不替换场景或活动需求。

活动需求继续使用 CreativeStudio 原 IndexedDB `${scope}:brief`。读取、保存状态向工作单公开；读取失败不把建议值写回。载入期间仅合并用户实际修改的字段。快速切 scope 时，离开的输入先尝试保存到原 scope，失败保留该 scope 的内存草稿；晚到结果不能覆盖新 scope 的需求或提示。云准备前先完成原 scope 资料写入，失败停止。根和 designBook 中出现本地活动元数据（即使任务为空）均触发现有云覆盖保护。

核对依据覆盖任务标题、阶段、计划、责任／承接方、完成条件、资料类型、关联 ID、关联物件形状与规格、摆放及场地结构。真实楼梯形状／前段、沙发形状、相机支架及墙面旋转等变化会进入需复核；视角、显示灯光和续签素材地址不误触发。删除物料保留任务及旧 ID，派生断链，不按同名重挂；同 ID 撤销恢复可重新连接。修改计划不会写实际时间，确认完成也不补造时间。原证据与旧摘要保留，须明确重新核对才能更新。

活动 CSV 与 Scene 交付封套复用同一不可变快照编号和时间，记录北京时间界面约定、项目名称／ID、资料类型及计划／实际原时区值。内部核对摘要不进入交付封套。完整模板或其他不受支持几何仍阻止模型／Scene／物料导出，但纯文字活动安排仍可查看、编辑和独立导出。普通编辑 JSON helper 保留完整活动字段与摘要，公共分享递归剥离活动及物件执行资料，原布局不变；暂时授权素材地址继续清理。

| 用例 | 本轮证据与边界 |
|---|---|
| E1 原真源与无物料 | Provider／任务 UI／共享契约回归通过；导演实际修改原需求至30人后，工作单读取同一需求，签到任务无需物料 |
| E2 保存与恢复 | reducer、store、历史、自动保存、恢复点定向回归通过；导演刷新后保留需求、六任务、需复核与人工实际时间 |
| E3 断链 | 删除／同名新增／撤销回归通过；导演浏览器删除首桌后，任务和原 ID 保留、CSV显示断链，撤销恢复 |
| E4 时间 | 跨午夜、时区、毫秒、空值、倒序与非法日期回归通过；导演计划09:00–09:30、实际09:05–09:40独立录入，改计划结束至09:35后实际保持09:40 |
| E5 核对 | 无物料与实际楼梯／沙发／相机形状变更、条件／责任／计划／结构变更回归通过；导演计划变更显示需复核，原现场说明保留 |
| E6 复制与替换 | 显式演练模板重建任务 UUID且清记录、单物件／楼层复制不复制任务、同 ID 规格替换复核及历史回退通过。本轮没有整场活动复制界面，不宣称任意全场复制与实例重映射已完成 |
| E7 分享与文件 | 编辑 JSON helper往返、嵌套副本清理、公共分享剥离、CSV转义及快照一致回归通过；导演实际下载活动CSV与交付JSON编号一致。交付JSON不是完整可恢复项目备份 |
| E8 云边界 | CloudPanel、Agent自动准备、原scope写入失败／复制失败回归通过，失败不覆盖原本地资料；真实云活动协作未验收 |
| E9 失败保护 | 重复UUID大小写别名、关联ID限长／碰撞、无说明／摘要的完成状态、未知字段、存储失败回归通过；父层拒绝保存时 UI保留草稿且不提示成功 |

**最终检查**：收口运行两个互不重叠的批次，14套418项与8套141项，共22套559项全部通过；包括任务／交付 UI、依据、schema、reducer、store、Brief／CloudPanel、分享、编辑文件、保存、历史和焦点。`npm run typecheck` 通过；本轮五个主要产品文件 lint无警告；文案检查1638条为 clean；diff检查通过。Node26测试继续仅在进程中禁用实验webstorage，没有修改浏览器存储、全局配置、依赖或锁文件。本轮没有运行生产build、停启3157、提交或修改暂存区；生产构建由导演接手。

**开发热更新保护**：只在development使用Webpack `import.meta.webpackHot.data`／dispose接续布局及当前楼层，重建actions；普通刷新和生产运行保持既有本机hydrate行为。store与隔离DOM模拟验证保留六任务、原scope及未保存修改，模拟刷新仍从本机回读。此证据证明该热替换机制受到保护，尚未证明导演此前裸localhost旧任务缺失一定由它造成；没有清空存储、重装或更改用户资料。用法依据 [Webpack官方HMR API](https://webpack.js.org/api/hot-module-replacement/)。

**来源隔离与下一轮**：前端QA继续 `http://localhost.:3157/?local=1`，导演后续使用 `http://director.localhost:3157/?local=1`，用户127.0.0.1页面保持原资料。本轮独立QA显式载入六项演练，既有需求没有被模板覆盖；保存后刷新仍为六任务，需求详情及新增表单收起。590px首屏可见准备任务和布场标题，见 [活动安排首屏截图](../../frontend/docs/evidence/event-operations-590.jpg)。临时视口已恢复，tab1已保留交接。可见的完整项目备份／恢复单列下一增量，由新对话先负责 `frontend/lib/local-project-backup.ts`、测试及 `docs/plans/local-project-backup.md`；当前代码冻结，不把未挂载的旧JSON入口、Scene交付包或内存草稿称为完整备份。长期目标与定时续跑保持active，成本、执行回填和复盘等后续闭环仍未完成。

收口检索曾误把PowerShell下的位置参数glob当成文件路径，并在frontend工作目录重复添加frontend前缀。已改为字面目录加 `rg -g '*test*'`、相对于实际cwd的Git pathspec，纠正后两项检查退出0；经验已补入 [Windows本地产物排障skill](C:/Users/endTree/.codex/skills/windows-local-artifacts/SKILL.md)，技能校验通过。该检索写法错误不代表源码文件损坏。

### 下一增量接入预检：场景与活动备份（2026-10-07）

**导航增量已发布**：2026-10-07本机HEAD与origin跟踪分支均为c827a315e5b4b35748c2437d91dd36f8fe98f241；导演回执确认远端SHA一致。production构建日志完成静态导出，3157回读HTTP200；最终178项、typecheck及代码检查通过，390／590px与服务重启后的七任务／D-01回读由导演验证。已验收导航保持稳定，发布冻结已解除。

**原先导出切片已被完整闭环安排取代。** 导演随后明确安排完整备份导出→预检确认→恢复→刷新回读；用户最新指令进一步要求先处理首次入口、主要内容与生图设计。当前实施及结果见本文上方。下列预检保留为当时依据，不再表示仅规划导出或禁止已授权的恢复开发。

- 保存协调放在原CreativeStudioProvider，先flush当前真实需求，再readback原 `${layout.id ?? 'local'}:brief`；成功读到undefined才是absent。`studio.scope`为api/user/project复合值，不能当作文件模块的layout scope。
- 导出开始捕获当前布局、需求编辑版本、账号／项目及操作序号；每个await后复核，改需求、改布局、A→B→A或卸载均停止过期输出。重复点击复用已有busy／pending保护，不排出多份旧文件。只切工作模式或尺寸不会改真源。
- 尚未读取完成、flush／readback失败时准确报错并保留当前输入；默认建议24人、hasSavedBrief=false及旧的读取错误不能伪装成缺省需求。立即点击导出须等待当次真实编辑保存，不能抢在250ms自动保存前拿旧需求。
- 最小相关验收是：同scope当前编辑需求与六任务／两种工单字段进入文件；成功无需求保持absent；读取／保存拒绝及导出中编辑／切项目／重复点击不输出旧内容；实际下载文件经冻结解析器读回，核对全部字段与摘要。保存失败、单元mock和原生浏览器下载分别报告。
- 后续完整恢复切片仍按下方协议：校验候选→明确替换确认→目标需求写入／回读→同scope Provider重载→布局提交→失败回滚，取消与坏文件保留原资料。届时再单列实际恢复、刷新回读与同ID冲突验收。

用户后续试用明确指出工作单难理解、空间不足及椅子跳回策划，导演已在d215af9上传后优先放行工作区重构。本轮目标、成熟官方依据、状态图与完成证据见 [Binggo工作区方案](workspace-modes.md)。该增量源码已冻结可构建：最终10套178项、typecheck、lint、文案与差异检查通过；独立演练确认模式/关闭往返保留草稿，展开顶部操作可点。剩余窄屏及production构建由导演接手；备份恢复UI本轮继续未接入，以下预检保留供后续实施。

独立备份对话已完成并冻结文件模块，回执为29项测试及typecheck通过；主前端可引用 [接入顺序](local-project-backup.md)，不修改其文件协议或所属模块。当前活动安排仍由导演验收，本次仅核源码与准备接入，不解除本轮产品代码冻结、不运行build或重复已通过的测试。

本轮实读 [Notion官方导出说明](https://www.notion.com/help/export-your-content) 和 [draw.io官方打开文件说明](https://www.drawio.com/docs/manual/open-diagram-file/)。前者说明重新上传导出内容不能立即重建工作空间，后者区分打开文件与导入当前图，并明确当前修改的替换行为。本项目采用的具体做法是：在现有工作单中明确区分「场景与活动备份」和交付文件；选择恢复文件后先校验、展示覆盖范围及候选摘要，再明确确认替换。照片附件与模型文件不在该备份内，旧布局未包含需求与新版文件明确无需求分别呈现，取消或坏文件不改当前资料。

源码预检已确认以下接入条件，待下一轮放行后实施并用独立演练来源验收。

| 接入条件 | 现有入口及须补齐的行为 |
|---|---|
| 需求真源 | `frontend/lib/source-storage.ts` 的 `flushSourceScope/readSourceForm/storeSourceForm`；导出先flush，读取 `${scope}:brief` 的真实存储值，再核scope和布局快照未变。`hasSavedBrief=false`不能直接当作无需求 |
| 同ID恢复 | Provider读取effect依赖scope与重试序号，单独apply同ID布局不会重读需求；恢复须在原Provider提供串行入口，先停旧自动写入／等待写队列，再写并回读目标需求，明确重载该scope |
| 失败与取消 | 文件校验及候选预览不写存储。确认后保留当前布局、原需求及目标scope原值；写入／回读／应用任一步失败回滚，回滚失败保持原草稿与候选并显示准确错误 |
| 整体替换 | `RoomOrganizer.onLoadLayout`已有快照、apply及历史清理；`onApplyCreative`有AI几何门禁且可能合并当前designBook，不能直接作为备份恢复入口。旧快照只含布局，不能宣称它同时恢复需求 |
| 并发失效 | 文件读取、flush与回读各步核操作序号、项目scope、布局身份及需求编辑版本；切项目、新编辑、云状态变化或候选过期立即停止。目标scope占用检查须有实际证据，不能靠模块校验假设不存在另一编辑器 |

独立Provider预检进一步确认：恢复需清理目标scope的旧 `briefDrafts`，否则切换回来仍可能取到恢复前的内存草稿；A→B→A不能只比较当前scope文字，须比较操作序号。最小接入形态为由原Provider主持 `restoreLocalProject(candidate, commitLayout)`，串行协调保存队列、目标需求读写、布局提交及回滚，父级提供专用的整体替换回调。此处是下一轮接口建议，不是已实现的恢复能力；没有新需求表或并行真源。

Windows读取预检曾误猜组件lib中的source-storage路径，已通过文件清单及 `@/*` 别名核到 `frontend/lib/source-storage.ts`并成功读回；该经验补入同一排障skill。本次没有改名、迁移或重建源文件，没有访问用户127.0.0.1资料。

实施安排更新（2026-10-07）。用户明确要求在现有分支进行增量功能开发，本轮落实普通物料场景的本地执行工作单、持久保存与可审阅交付导出。空间建模、真实尺寸、出入口及可编辑性的后续选型仍由导演统筹；本轮围绕现有受支持场景实施执行交接，不创建第二套工作台。

审查稿，2026-10-07。核对仓库 `C:\幕景\Scendance2026`，分支 `codex/delivery-research-20261007`，源码基线 `d139da72694cca53809eba444ee1c5b909cdb627`。

本文初稿记录了源码核对和实施建议；本轮已开始按下列最小范围修改前端。执行记录导入后端负责人提供的唯一共享契约 `supabase/functions/_shared/delivery-contract.ts`，不扩展云场景协议或迁移。原源码证据行号对应上述基线，修改后以实际文件为准。

本轮实现采用 `FurnitureItem.handoff`、共享 `handoffSchema/Handoff/handoffLimits`、派生的需复核状态和现有编辑历史。共享契约允许最多 5 个证据链接，也允许以验收说明作为证据；已验收必须有链接或说明，以及核对依据。界面在现有场景交付面板填写工作单、定位物件，并导出逐实例执行 CSV、聚合采购 CSV 和含 execution 包层的场景 JSON v2。核对依据包括标准场景的 venue/structure，使用原生 Web Crypto 的 SHA-256 保存固定长度摘要，避免复杂结构超过共享字段上限；相机和灯光不纳入依据。核对计算完成前明确显示正在核对并停止导出，不以未计算的结果显示已验收。核对依据仅保存在本机，不随交付包输出。

## 1. 推荐的最小切入

在现有 Binggo 的「场景交付」面板增加**本地逐物件执行表**，先用于团队自己承接的一场布展。沿用现有场景、物件 ID、选择、撤销和本地保存；记录负责人、期限、验收条件、状态和证据链接，并导出执行 CSV。现有聚合物料 CSV 继续用于采购核对。

首轮验收使用单层普通场景中的八类内置活动物料；已归档资产沿用现有场景校验与导出能力，同样可在本地记录执行信息。完整场馆模板继续受现有交付门禁约束。本轮不引入看板、排期系统、邀请、消息通知、文件上传或客户发布页。

本地首版是同一浏览器中的执行记录与文件交接。第二台设备要接手修改、外包人员要回传验收、或团队要共享负责人和状态时，必须先接正式后端契约。不能用团队演示页或浏览器存储宣称已完成团队协作。

## 2. 已核对的真实链路

| 能力 | 当前实现与证据 | 对本方案的影响 |
|---|---|---|
| 交付入口 | `room-organizer.tsx:1247` 挂载助手；`creative-studio.tsx:460,485,488,494` 提供「Binggo · Agent → 模型与交付 · DeepSeek → 场景交付」 | 在原面板扩展，不新建工作台或全局入口 |
| 三种导出 | `scene-delivery-panel.tsx` 已有「导出场景 GLB」「导出场景 JSON」「导出物料清单 CSV」 | 保留现有名称和下载失败处理，新增「导出执行清单 CSV」 |
| 逐物件场景 | `backend-adapter.ts:88,175` 保留对象 ID、尺寸、位置、角度、颜色和备注；交付 JSON 包含 `scene.objects` | 执行行绑定 `FurnitureItem.id`，不按名字或数组序号绑定 |
| 采购聚合 | `scene-delivery.ts:32` 按资产版本或物料类型、尺寸、颜色、来源合组；累加数量并保留 `objectIds` | 继续复用，负责人和状态不进入采购分组 |
| 本地持久化 | `persistence.ts:268` 保存整个 layout；`schema.ts:359,415` 白名单解析；`version-history.ts:460` 恢复时同样解析 | 新字段必须进入校验与白名单，不能只增加 TypeScript 类型 |
| 编辑与选择 | `layout-reducer.ts:416,963,998` 的 `updateItem → patchItem`；`scene-layers-panel.tsx:89` 的 `selectOnly` | 复用原编辑与选择系统 |
| 云项目 | `backend-session.ts:735,1086` 使用编辑租约、generation 和 expectedRevision；`cloud-panel.tsx:103` 重新构造场景 | 云场景保存不等于执行记录保存，回读需专门适配 |
| 团队页面 | `account-team-demo.tsx:18,29,44` 使用虚构成员及组件本地状态，并明确标注演示 | 不从这里读取负责人、权限或真实成员 ID |

源码路径均相对仓库根目录；上述前端文件位于 `frontend/components/room-organizer/`，`backend-session.ts` 位于 `frontend/lib/`。

## 3. 用户操作与面板内容

1. 在现有本地体验中搭好场景，等待工作台出现「已保存到本机」。打开右下角「Binggo · Agent」，进入「模型与交付 · DeepSeek」的「场景交付」。
2. 面板展示「执行物件」与「采购汇总」两个区块。执行物件一行对应一件物料，显示名称、短编号、规格、负责人、期限和状态；打开一行后填写验收条件及证据链接。没有记录时显示「未分配」。
3. 点击「定位物件」复用 `useSelection().selectOnly(item.id)`，沿用当前画布的选中效果。首版不承诺自动飞到物件或新相机视角。
4. 负责人填写实际姓名或外包团队名称，期限使用原生日期输入，验收条件写可检查的结果，例如「12 把椅子按当前位置摆放，尺寸与采购规格核对完成」。一件物料可以有自己的条件；首版不把这句话自动扩散到其他物件。
5. 状态由用户填写「未开始 → 进行中 → 待验收 → 已验收」。待验收要求负责人、期限和验收条件齐全；已验收还要求证据链接或验收说明及非空核对依据。每次保存和回读都检查这些条件，不能在已验收后清空必填项或全部证据；用户需先退回进行中再清空。用户明确重新确认验收才能更新核对依据。
6. 查看采购汇总，核对数量及「规格与采购待确认」提示。下载场景 JSON、执行 CSV 和采购 CSV，必要时下载现有 GLB，将文件交给执行方。首版由用户自行发送文件。

本地编辑区固定显示「执行资料保存在此浏览器」。云项目展示现有场景导出与物件信息，但本地执行字段不开放编辑，提示「云项目执行记录待接入」。保存失败沿用工作台错误状态，不能出现执行资料已保存的独立假成功提示。

## 4. 复用信息与最小数据模型

执行行的名称、尺寸、颜色、场景位置、角度、物料类型和来源均从当前物件派生。`notes` 继续保留设计备注；结构化验收条件单独保存，不把负责人和期限塞进备注或模型生成提示词。

推荐在 `FurnitureItem` 增加可选的 `handoff` 本地字段；每个实例自带记录，不另建 objectId 关联表或独立 store。以下仅为本地编辑类型建议，不是新的 API wire schema。

| 字段 | 用途与校验建议 |
|---|---|
| `ownerName` | 实际负责人文字，去首尾空白，最多 80 字；首版不伪造 userId |
| `dueDate` | 可选 `YYYY-MM-DD` 日历日期，验证真实日期；按项目采用的北京时间解释，不擅自转为设备午夜时间戳 |
| `acceptance` | 可检查的验收条件，最多 1000 字 |
| `status` | `todo / doing / review / accepted`，缺省为 `todo` |
| `evidenceUrls` | 共享契约限制最多 5 个 http/https 链接，每个最多 2048 字；不上传文件，不自动抓取内容 |
| `evidenceNote` | 最多 1000 字，记录实际检查结果或证据说明；已验收可用此说明或链接满足证据条件 |
| `reviewedBasis` | 明确提交验收或重新确认时，保存标准场景 venue/structure、物件规格／摆放及验收条件的 SHA-256 摘要；不使用临时签名地址，不包含负责人或状态 |

`reviewedBasis` 的输入至少包括物件类型、归档资产标识、尺寸、颜色、位置、旋转、所在楼层 ID、标准场地／结构与验收条件文本。交付 helper 比较当前依据摘要与已记录摘要；已待验收或已验收的物件、场地结构或验收条件发生变化后，表格和导出显示「需复核」，保留原依据和证据。用户重新核对后才能更新依据。这样拖动、旋转、改尺寸和批量替换共用一项检查，撤销回到原依据后也能自然恢复原显示。

实施时一并更新 `isFurnitureItem`、`ITEM_KEYS` 和嵌套 handoff 的限长、字段白名单及 `sanitizeItemPatch`。旧草稿没有 handoff 时照常打开。新字段不能混入目录类型：`CatalogItem` 的 `Omit` 需要排除 handoff。

## 5. 执行表与采购清单的区别

| 项目 | 逐物件执行表／执行 CSV | 现有聚合采购清单／物料 CSV |
|---|---|---|
| 一行代表 | 一个场景实例，数量固定为 1 | 一组同资产版本或物料类型、规格、颜色、来源的实例 |
| 关联 | 一个完整 `objectId` | 一组完整 `objectIds`，数量等于 ID 数量 |
| 内容 | 当前摆放、负责人、期限、条件、状态、需复核标记、证据 | 规格、数量、资产版本、来源许可和采购待确认说明 |
| 修改入口 | 修改相应物件的 handoff | 从场景重新聚合，不编辑聚合行覆盖实例 |
| 用途 | 布置、运输后核对、安装与验收交接 | 询价、租赁和采购核对 |

例如两把同规格、同颜色的椅子分别由甲和乙负责：执行表保留两行及两个 ID，采购表是一行、数量 2、两个 objectIds。一把改了尺寸或颜色后采购表拆组；只改负责人或执行状态不拆组。名称不是唯一标识，同名不同规格不能合并。

场馆入口、结构门窗和柱体不作为采购物料，也不进入本地首版的物料执行表。其几何仍由现有场景导出处理；首版不把建筑验收混入物料执行任务。

## 6. 保存、复制与删除的规则

| 操作 | 要求 |
|---|---|
| 自动保存／刷新／关闭后重开 | handoff 和 reviewedBasis 随整个 layout 保存、白名单回读，保持对象 ID 关联；刷新后的撤销历史仍遵守现有行为 |
| 恢复点恢复 | 恢复同一快照中的物件与执行记录，不能把新场景几何和旧执行状态拼接；利用已有底层能力验证，不在本轮扩建恢复点管理界面 |
| 修改规格、摆放或场地尺寸 | 通过依据比较显示需复核，旧证据保留；不把旧验收自动视为适用于新方案 |
| 复制物件／粘贴／复制楼层／从自定义物料集新增 | 新 ID 的实例清除 handoff；原物件保持原记录，尤其不能复制已验收状态及证据 |
| 删除物件／批量删除／清空／删除楼层 | 执行记录随物件移除，当前表和新导出不留下孤儿 ID；状态提示说明执行资料随物件删除，可通过现有撤销恢复 |
| 删除后撤销／重做 | 撤销同时恢复 ID、执行字段及证据；重做同时移除；不生成第二条记录 |
| 整场替换／加载另一方案 | 使用原有替换保护与快照路径；新方案不能继承旧方案 handoff，旧导出文件也不能被当作当前状态 |
| 相同方案内批量替换 | 仅相同 ID 的实例可保留记录，并检查规格依据；新 ID 不按名称猜测继承；重复 ID 修复不能猜测执行记录归属 |

相关复制入口包括 `layout-reducer.ts:438,779`、`clipboard.ts:101`；清除与替换入口包括 `layout-reducer.ts:410,575,685,805`。还需检查实例进入自定义物料集、图层、方案分支和分享编码的路径：交付对象之外的公开分享不得顺带包含负责人和证据链接。

`applyLayout` 也用于撤销重放，不能在这个通用入口无差别把所有状态改成需复核。现有选中 ID 清理逻辑应继续生效，删除后的「定位物件」不得选择已不存在的对象。

## 7. 导出安排与边界

### 文件内容

- **执行 CSV**新增，逐实例导出 objectId、名称、物料类型、楼层、米制规格、场景坐标、旋转、负责人、期限、验收条件、记录状态、有效状态及证据链接。坐标沿用现有 adapter 的西北角原点与角度定义，不能直接把编辑器居中的坐标或弧度当作交付坐标。
- **物料 CSV**继续复用 `deliveryMaterials`，不填单一负责人或单一已完成状态；保留采购待确认、许可与来源信息。
- **场景 JSON**在现有 `scendance-scene-delivery` 文件包层加入逐实例 `execution` 数组，使用完整 objectId 关联 `scene.objects`，并将文件包版本升级到 2。标准 `scene` 本身保持现有严格后端 schema；包层的本地执行数据不透传到云 API。
- **GLB**沿用现有几何、材质和重载复检，保留 `deliveryObjectId` 供执行 CSV 对照。GLB 导出成功不代表执行状态已验收。不要为了本轮扩展而改造三维导出引擎。

表格文件继续复用 UTF-8 BOM、CRLF、引号转义和公式前缀防护，新增的姓名、验收条件和链接同样必须走字段转义。不得输出授权令牌或临时私有资产签名 URL；证据由用户填写可供执行方访问的长期链接，首版不保证其权限或长期可用性。

同一次交付的 JSON 和两份 CSV 应来自同一个不可变场景快照，携带相同交付编号及生成时间，文件名也带编号。面板在第一次下载时捕获快照，后续下载复用；场景或执行字段发生变化后旧快照失效，下次下载创建新编号。复用当前导出期间对场景、账号、项目和挂载状态的检查；不能下载切换前的旧结果。此编号是文件交付标识，不冒充云端 revision。用户选择下载 GLB 时，其文件名也必须使用该快照的同一编号；不新增发布服务或压缩包依赖。

文件包是可审阅交接材料；首版不承诺把交付包 JSON 或执行 CSV 导入并覆盖工作台。自动保存和恢复点的恢复能力另行验收，不能把「导出场景 JSON」等同于已经有完整备份恢复界面。

### 普通物料与完整模板

| 场景 | 首版行为 |
|---|---|
| 单层普通内置活动物料，通过当前转换校验 | 本地执行字段可编辑；场景 JSON、执行 CSV、采购 CSV、GLB 按当前能力导出 |
| 已归档公共库或云资产 | 保留当前导出和资产授权规则，可在本地记录执行信息；云项目执行编辑关闭，采购仍是待确认规格 |
| `scenePreset` 或任何 `glbNode` 存在 | 完整场景模板门禁继续阻止所有交付导出，包括新增执行 CSV；不给出假成功或零行清单 |
| 在完整模板中另加普通桌椅 | 仍按完整模板处理；首版不静默抽出部分物件，也不把固定场馆物件算成采购物料 |
| 本地建筑入口扩展、多层、镜像、不支持的结构或未归档本地 GLB | 沿用现有明确拒绝，不删掉不支持的内容后导出 |

门禁真源是 `scene-delivery.ts:15` 的 `deliveryScene`，执行表和新导出必须共用其结果。不能只检查 `scenePreset` 而漏掉孤立 `glbNode`。如果以后要从完整模板抽出活动布置，必须先定义固定设施与可交付物料的可靠标识、场地参考和拆分规则，再由前后端共同扩展。

## 8. 实施顺序与预计触点

| 步骤 | 实施内容 | 进入下一步的条件 |
|---|---|---|
| 1 | 在 `lib/types.ts`、`lib/schema.ts` 增加可选本地 handoff；更新 `hooks/layout-reducer.ts` 的 patch 校验及复制清除，`lib/clipboard.ts` 清除粘贴记录；检查自定义物料集与分享编码 | 旧草稿可读，新字段保存后回读不丢，复制得到干净新实例 |
| 2 | 在现有交付 helper 中派生逐物件行、验收依据和采购对应关系；复用转换与模板门禁 | 同 ID 可稳定关联，删除无孤儿，规格变化需复核，采购分组保持原语义 |
| 3 | 扩展 `panels/scene-delivery-panel.tsx`，通过现有 editor／selection context 编辑和定位；必要时由 `creative-studio.tsx` 传递现有回调 | 键盘可填写和定位；执行编辑进入原撤销与自动保存；云项目编辑状态明确 |
| 4 | 增加执行 CSV、JSON 包层 execution 和同一快照编号；复用当前下载与过期检查 | 三份表述相互对应，旧快照不会在场景改变后下载，现有 GLB 复检不回退 |
| 5 | 在云创建、打开、获取编辑权和 Agent 自动准备云项目的前端边界保护本地执行资料 | 不丢资料，不向严格 Scene schema 塞字段，不出现云执行资料已保存提示 |
| 6 | 按下表跑本地测试与浏览器验收，再决定是否进入正式后端联调 | 每项验收有结果和证据，运行时改动范围由导演另行批准 |

本轮按用户最新授权实施步骤 1–5，并执行相关定向测试与 typecheck。依赖由导演统一安装，生产构建与浏览器验收由导演统一执行；本任务不改依赖、共享契约、后端域类型或迁移。

### 本地首版的云转换保护

当前 `layoutToBackendScene` 会枚举既有字段，回读也会重建物件；`cloud-panel.tsx:103` 只特意保留同项目的 designBook/itemLayers，`creative-brief.ts:52` 的提案合并只保留名称、图标与 groupId。新的 handoff 如果不保护，创建项目、获取编辑权或应用返回场景就可能消失。

最小本地试点采用明确限制：已有 handoff 的当前草稿，阻止云创建、云场景覆盖及获取编辑权；Agent 的 `ensureWorkbenchReady` 自动云准备入口也要在转换前检查，保留草稿并说明执行资料暂不能迁入云项目。不要只保护「保存到云端」按钮。

这项保护放在**云操作前端边界**，不能在通用 `layoutToBackendScene` 中一概拒绝 handoff，因为现有交付 JSON、CSV 和 GLB 同样依赖该转换。普通交付导出仍需使用标准 Scene 几何，执行字段单独进入文件包。解除这些限制要么接入正式执行记录契约，要么实现有明确恢复入口的本地方案隔离；首版不靠确认弹窗后静默丢弃字段。

## 9. 跨设备协作的正式接口依赖

以下是前端所需能力清单，不指定新 endpoint 或数据库表名。以 `supabase/functions/_shared/domain.ts` 和 `client/scene-client.ts` 经审查后的契约为唯一接口真源。

| 业务触发 | 正式后端需提供 | 前端需要验证 |
|---|---|---|
| 第二台设备查看或接手修改 | 项目范围执行记录读写、稳定 objectId 关联、schema 版本、权限、冲突规则 | 重新登录／打开项目能取到同一执行记录；失败保留本地草稿 |
| 真正给团队成员分配 | 真实成员／外包身份及可分配范围 | ownerId 来自真实成员结果；展示名是快照或解析结果，不用演示成员 ID |
| 同时改场景与执行资料 | 场景 revision 与执行 revision 的关联、删除／替换对执行记录的策略、明确的事务或冲突结果 | 旧场景不能覆盖新验收；孤儿引用得到明确结果；执行资料是否共用编辑租约由后端决定 |
| 外包只回填状态和证据 | 授权范围、字段级写入规则、并发版本和必要操作记录 | 执行方无需取得场景编辑权也不能随意改几何；不同人员的更新不会互相覆盖 |
| 附件、客户验收或发布交付版 | 持久附件／证据授权、服务端记录人和时间、交付版快照及访问方式 | 文件重开仍可访问；几何变化导致复核；客户可见范围由服务端控制 |

现有 expectedRevision、sessionId 和 generation 证明的是场景写入保护。执行表多个人同时更新是否仍使用同一租约，需要后端明确，不能照搬现有场景整包保存，也不能把这些执行字段临时塞入 notes。

跨设备功能只有在正式环境完成双设备／双账号读写、冲突和权限验收后才能标记完成。现有 HTTP、处理器及测试数据库联调证据不能代替真实服务验收。

## 10. 验收场景

| 编号 | 操作 | 必须看到的结果 |
|---|---|---|
| A1 真实入口 | 本地体验 → Binggo → 模型与交付 → 场景交付 | 出现当前方案执行表和原有导出，不新增第二工作台；完整键盘操作可完成 |
| A2 保存重开 | 为两把椅子填不同负责人、日期、条件和证据，待本地保存完成后刷新、关闭再打开 | 原 ID、字段、状态、证据和依据均恢复；没有显示云执行资料已保存 |
| A3 旧格式与无效输入 | 打开不含 handoff 的旧草稿；输入非法日期、状态、协议或过长字段；待验收／已验收后清空必填项或最后一条证据 | 旧草稿正常；无效更新被明确拒绝而不覆盖有效记录，需先退回状态再清空；回读执行相同条件，校验不可静默剥离执行字段 |
| A4 两种清单 | 同规格两把椅子分给不同人，再修改其中一把的颜色或尺寸 | 先为执行两行、采购一行数量 2；修改后采购拆组，执行仍按原 ID 关联 |
| A5 复制路径 | 单项复制、粘贴、复制楼层、自定义物料集新增 | 新实例获得新 ID 且无负责人、期限、完成状态、证据；原实例资料保留 |
| A6 删除断链 | 删带证据的物件，再做批量删、清空或删楼层；撤销和重做 | 当前表及新 JSON/CSV 无已删 ID；定位不会指向不存在物件；撤销恢复完整记录，重做移除 |
| A7 复核 | 验收后拖动、旋转、改尺寸、改场地尺寸或验收条件，再撤销 | 修改后显示并导出需复核，保留旧证据；撤销到原依据后恢复原有效状态；重新验收更新依据 |
| A8 恢复和替换 | 通过已有恢复底层还原快照；整场替换；同 ID 批量替换 | 快照几何和执行资料一起恢复；不同方案不串资料；相同 ID 的变化进入复核，不按同名继承 |
| A9 导出一致 | 从同一面板快照下载 JSON、执行 CSV、采购 CSV、GLB | 编号对应；JSON execution IDs 是 scene.objects 的有效子集；每组 objectIds 数量等于 quantity；单位、坐标、CSV 中文和转义正确；GLB ID 可对照 |
| A10 导出失效 | 准备 GLB 或加载导出模块时改场景／执行字段、切账号／项目或卸载面板 | 旧结果不下载；再次导出取新快照；失败不删除草稿或证据 |
| A11 门禁 | 分别测试 scenePreset、孤立 glbNode、模板上新增普通物料、本地入口扩展、多层和未归档本地 GLB | 按原门禁阻止包括执行 CSV 在内的交付导出；不省略失败部分，也不输出假采购数量 |
| A12 保存失败 | 存储不可用或配额不足时编辑执行字段 | 原记录仍可查看，明确提示本地保存失败；仍可导出当前交付内容，不宣称刷新后可恢复 |
| A13 云保护 | 带 handoff 的草稿尝试创建云项目、打开云方案、获取编辑权或让 Agent 自动准备云项目 | 操作在覆盖或转换前停止，草稿和执行记录保留；普通交付导出仍可用；无越过真实契约的请求 |
| A14 分享边界 | 用现有分享入口编码含 handoff 的方案 | 未经明确交付操作的公共场景分享不含负责人、证据或执行验收信息 |

本地首版验收按 A1–A14 分别记录测试与浏览器结果。完整模板导出及跨设备回填仍分别作为后续范围，不通过扩大本轮声明来算完成。

## 11. 本轮验证状态与后续检查

本轮已完成实际前端实现并在 2026-10-07 冻结代码，集成检查结果如下。

- 前端 `npm run typecheck` 通过。
- 保存、白名单、实例生命周期、复制、分享、恢复点及原持久化测试 10 套、439 项通过；交付、SHA-256 复核和界面测试 4 套、41 项通过；云项目保护与 Agent 测试 2 套、67 项通过。共 16 个相关套件、547 项通过。
- 新回归覆盖同尺寸场地的结构／出入口变更、相机／灯光不误触发、128 墙场景的摘要大小、负角度保持数值、验收条件修改后需复核及明确重新确认后恢复已验收。
- 界面文案检查与 `git diff --check` 通过。
- 导演在独立 localhost 浏览器来源确认了工作单已验收后的刷新保留，以及修改验收条件后需复核、原说明保留。导出浏览器验收由导演继续核对，本任务未扩大为真实云端执行记录或跨设备实时协作验收。

Node 26 的实验 webstorage 会遮蔽测试环境的 jsdom localStorage。涉及浏览器存储的套件使用进程级 `NODE_OPTIONS=--no-experimental-webstorage` 重跑通过；没有改全局配置、依赖或锁文件。生产 build 由导演关闭 3157 预览服务后统一执行，本任务遵照最新安排没有运行 build 或停止服务。

既有 `scene-delivery.test.ts`、`scene-delivery-integrity.test.ts` 的采购分组、缺模型、模板门禁和 GLB 重载复检保持通过；新增 `scene-handoff.test.ts`、`handoff-persistence.test.ts` 及扩展面板测试覆盖执行字段、保存回读、删除断链和复核。它们证明本地与 mock 行为，不证明真实团队云端协作。

实施后在 `frontend` 运行相关的 schema、reducer、clipboard、persistence／version-history、交付及面板测试，再运行 `npm run typecheck` 和 `npm run build`；按 `frontend/AGENTS.md` 完成相关检查并记录结果。新增测试应围绕持久化、ID 生命周期、复核和导出一致这些数据损失风险，不扩建无关测试框架。正式接口接入后再单列真实云项目和双账号／双设备验收，和本地、mock 结果分别报告。
