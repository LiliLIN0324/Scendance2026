# PetitMaker 源码机制研究

2026-10-10。供幕景界面取舍使用的只读研究，尚未实施UI迁移或体验验收。检查对象是 `C:/幕景/upstream-references/PetitMaker` 的固定提交 [4e120e50c844198649454eec6069ac65a062a732](https://github.com/Stry233/PetitMaker/commit/4e120e50c844198649454eec6069ac65a062a732)，本地HEAD及GitHub官方API一致，提交时间为2026-10-04T11:00:11Z。没有安装依赖、执行上游脚本、发AI请求或复制素材。本文唯一写入文件为本报告；官网实际体验由导演负责，共享UI由前端负责。

最贴合当前问题的候选是把现有物料浏览内容组织成“类别与搜索＋限高横向物件架”，并让选中属性按需要展开。幕景已有相应数据和动作入口，可先调整呈现层。下面五个机制分别给出源码证据、对应入口及限制，供导演决定采用范围。

## 先对照幕景现有入口

- [ScendanceLibrary](../../frontend/components/room-organizer/panels/scendance-workspace.tsx:33) 33–62行包含物料库、场景预设、图层三种内容；物料库调用OnlineModelLibrary，`addMaterial`经`placeCatalogItem`放置后`selectOnly(id)`。这三类内容不是同一种卡片，迁移物料浏览不等于把图层、结构表单或业务资料都塞进底部。
- [OnlineModelLibrary](../../frontend/components/room-organizer/panels/online-model-library.tsx:35)已有分类、搜索、加载错误、逐批24项、懒加载缩略图和忙碌状态；115–152行显示当前类别横条、搜索及二维物料网格。分类与搜索联合过滤见[filterOnlineModels](../../frontend/components/room-organizer/lib/online-models.ts:153) 153–164行，输入查询不会自动退出当前类别。
- [room-organizer.tsx](../../frontend/components/room-organizer/room-organizer.tsx:1248) 1248–1261行将素材、选中属性、活动资料安排在同一左侧容器。`inspectSelection`在[378行](../../frontend/components/room-organizer/room-organizer.tsx:378)切到属性内容；`selectOnly` 382–385行会在普通选择后调用它。[globals.css](../../frontend/app/globals.css:530) 530–557行则是竖向可滚内容、双列卡片网格和已有横向类别条。本文引用的是检查时工作树位置，不声明这些共享文件已冻结。

## 五个具体机制

### 1. 底部类别＋搜索＋横向卡片，目录增加只增加滚动

**源实现。** [ObjectShelfBody](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/bars/ObjectShelf.tsx#L192) 192–318行保存类别、查询、滚动偏移，测量原生`clientWidth/scrollWidth`，类别或查询变化时重置滚动。320–390行把外壳固定在底部，类别与搜索保持一行；392–470行是固定卡片高度的横向flex行。[useScrollRow](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/primitives/use-scroll-row.ts#L18) 18–26行使用原生横向overflow并处理滚轮。[shelfItems](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/bars/object-shelf.ts#L185) 185–189行在有查询时跨可放置类别搜索，空查询时按类别取值；ObjectShelf 354–368行在搜索时不标一个类别为当前类，点类别会清查询并放下不属于该类的待放置素材。

**幕景候选。** 保留OnlineModelLibrary的载入、错误、可信目录slug、放置回调及分页保护，把卡片网格改成横向架；类别与搜索直接暴露在素材架上。搜索究竟是当前类还是全库要明确表达，不能只搬搜索框而保留隐含过滤。现有[拖放与点击入口](../../frontend/components/room-organizer/panels/online-model-library.tsx:127) 127–150行可以继续使用。

**限制。** 上游卡片点击在ObjectShelf 460–465行只是通过`setEditMode`进入或退出待放置模式；幕景现在点击会立即加载并添加，两者不是同一语义。迁位置不应顺带制造第二次点击或丢掉拖放/键盘操作。上游`placed`来自地图实例计数，不能当幕景库存。图案、卡片尺寸比例、搜索胶囊SVG和动画均不属于本次建议；幕景应保留可辨认的名称、真实尺寸与加载状态，并用自己的素材。

### 2. 选中对象后先给小操作卡，需要时再展开属性

**源实现。** [SelectionCard](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/chrome/floating/SelectionCard.tsx#L204) 204–227行从统一selection读取目标；`CardBody`在244行默认收起，388–423行提供就地操作，430–467行是展开后的事实/朝向内容，503–575行处理展开入口。素材架里的`selectedItemId`是待放目录项，不能与这个画布实例selection混为一个变量。

**幕景候选。** 利用现有`selectedItem`及ItemContextPopover，将名称、常用操作留在选中摘要中，尺寸、材质、工作单等详情按需展开。未选中时保留素材浏览，不常驻一整张空属性表。现有`inspectSelection/selectOnly`与左侧properties分支已经是准确接入点，可评估是否避免每次连续添加都用属性面板替换素材架。

**限制。** 学的是出现时机与信息层级。游戏格子尺寸、load、放置数、四向旋转不是实物尺寸、承重、库存或现场验收。幕景现有几何校验、物料记录与真实单位保留；原件、合同和执行事实也不能跟随选中卡或布局撤销删除。

### 3. 同一个编辑动作经同一状态与历史，视图只适配坐标

**源实现。** [Canvas2D](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/canvas/map2d/PixiCanvas.tsx#L43) 43–59、191–208行与[Editor3DCanvas](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/canvas/map3d/Editor3DCanvas.tsx#L25) 25–44、81–112行读取同一store的地图/事件/工具。切换视图的[setActiveView](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/canvas/active-view.ts#L26) 26–29行把工具管理器指向当前视图；[CommandExecutor.execute](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/core/commands/command-executor.ts#L193) 193–236行统一校验、应用及历史，459–493行撤销/重做仍走该历史。旋转按钮和快捷键共用动作，见[rotateSelected](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/kit/commands.ts#L129) 129–147行。

**幕景候选。** 新底栏和选中摘要继续调用现有`placeCatalogItem/selectOnly`、编辑actions与history，不再为底栏另建一份场景或撤销链。[ScendanceViewTools](../../frontend/components/room-organizer/panels/scendance-workspace.tsx:76) 76–86行已消费统一history和view状态，可保留既有接口。

**限制。** 不建议迁移Pixi、重写Three.js、导入上游事件总线或全部命令框架。上游校验的对象是游戏地形、水域、道路和摆放；它们不提供活动消防、承重、电气或现场尺寸标准。2D的fit/zoom等实际能力仍应按幕景现有实现及后续验收分别说明。

### 4. Agent展开是界面状态，任务执行器保持一份

**源实现。** [AssistantBlock与Assistant](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/Shell.tsx#L359) 359–388、419–454行以`assistantOpen`开关显示，首次打开后的`everOpened`保留PanelColumn。[PanelColumn](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/agent/PanelColumn.tsx#L166) 166–177行保持单个runner，245–271行将collapse与open/closeManage分开；[PanelShell](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/agent/PanelShell.tsx#L909) 909–921行切管理视图，1116–1118行决定Composer是否出现。收起并不调用暂停/停止。

**幕景候选。** 沿现有Binggo入口逐步展开聊天、设置及详细资料，关闭面板只改变可见性。资料输入和运行控制层保留，避免入口重排造成未保存文本丢失、重建任务或重复付费请求；已有身份/epoch、flush和任务状态保护继续由原所有者接线。

**限制。** 本次仅确认生命周期与呈现代码，不证明Agent输出质量、调用可靠性或费用行为。不能复制其角色、美术徽章或品牌；也不把它的游戏工具目录当幕景Agent权限或业务标准。

### 5. 顶部模式、侧边视图工具、底架共同计算可用空间

**源实现。** [ModeRow](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/Shell.tsx#L562) 562–577行位于左上；`ModeBar` 481–492行仅挂当前模式需要的底部内容，`Rail`在[716行](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/Rail.tsx#L716)组织右侧图层、历史和视图控件。[FrameLayoutProvider](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/frame-layout.tsx#L30) 30行起用剩余视口与dock计算共享plan；[planFrame/railClearanceFor](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/frame.ts#L617) 617、646行提供布局与避让。ObjectShelf 224–228行消费右侧避让量，而不是让卡片穿过控制按钮。[Shell的frameStyle](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/ui/shell/Shell.tsx#L1044) 1044–1055行外层pointer-transparent，仅实际控件重新接收指针。

**幕景候选。** 底部素材架、已有视角工具、聊天和临时属性区共享一个可用空间约定；不要只改`left`为`bottom`，却让工具、聊天输入或卡片相互盖住。优先以现有布局状态和CSS间距重组，不新增一套业务控制器。

**限制。** 不照搬其设计画布坐标、缩放体系或dock过渡动画；它们还依赖原品牌绘图尺寸。桌面、窄屏、键盘焦点、触摸滚动及画布手势是否可用，需要导演的网站观察和前端的幕景实测。本报告没有做这些体验验收。

## 许可按材料分类

下表是固定版本原文的分类与要求，不是对任何实际商业分发的独立法律结论。本次没有移植代码或素材。

| 材料 | 固定副本声明 | 本次处理边界 |
|---|---|---|
| 应用/工具代码及未另列的非素材配置 | Apache-2.0；[ASSET_LICENSES.zh-CN.md](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/docs/ASSET_LICENSES.zh-CN.md#L11) 11–13行明确文件位置不自动决定许可 | 若以后取具体代码，按[LICENSE第4节](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/LICENSE#L89)附许可、标修改、保相关通知及[NOTICE](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/NOTICE)。当前只提机制 |
| 名称/Logo、原创catalog/UI图标、cursor/shell、catalog JSON的model3d等 | [素材许可39–46行](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/docs/ASSET_LICENSES.zh-CN.md#L39)保留所有权利，特定文件另声明除外 | 默认不复制到幕景。助手[美术README](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/assets/agent/README.md#L3)说明素材位置/设计来源，不授予独立复用权；TSX里的内联SVG也不能凭扩展名当Apache素材 |
| 游戏地图、头像、路径图及其他第三方材料 | [素材许可68行起](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/docs/ASSET_LICENSES.zh-CN.md#L68)说明游戏衍生材料及来源，逐项权利审查未完成 | Wiki/网络收集来源不是版权授权，游戏名和角色权利不随代码许可转移 |
| 软件依赖、字体与服务商标识 | 各自许可，见[THIRD_PARTY_NOTICES](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/docs/THIRD_PARTY_NOTICES.md#L3)及licenses/；字体/vendored材料不属于锁文件依赖闭包 | 不为界面研究安装或带入这些依赖。字体分别有阿里字体条款、OFL、MgOpen许可；Lobe图标集MIT不授予品牌商标权。继续用幕景已核字体与素材 |

[LICENSE第6节](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/LICENSE#L138)没有授予产品名/商标使用权。上游允许用户分享自己地图的编辑器导出成果，但[素材许可20–24行](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/docs/ASSET_LICENSES.zh-CN.md#L20)明确区分导出分享与裁切、提取、搬到另一产品；不能拿这项许可覆盖素材迁移。阿里字体许可副本前言还说明来自一致镜像，本次未独立取得动态官方页，不声明已在线复核其官方条款。

## 交给下一步的最小边界

源码最直接支持评估机制1和2：改物料浏览的呈现与选中后的展开层级；保留现有放置、选择、加载、撤销与业务资料真源。机制3–5提供入口和状态保护，不要求整体换架构。哪些内容最终移到底部、首屏高度以及点击/待放置语义，由导演结合真实体验与幕景任务决定；前端在共享UI负责实现与浏览器验收。

这次没有运行上游、测试上游、体验官网、装依赖、改幕景程序、改已冻结合同模块或进行Git写操作。源码/许可结论与界面可用性结论分别记录；游戏规则不作活动现场专业标准。
