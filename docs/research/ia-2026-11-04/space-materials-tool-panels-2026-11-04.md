# 分片 C（空间 / 物料）IA 重划调研：工具面板如何不人格化、生成动作如何收进库面板

> 日期：2026-11-04
> 范围：幕景 S3「空间 / 物料面板化」的对标调研与可执行原则。空间＝场与壳的工具面板；物料＝道具库与生成工具面板。两者**不是人格**，不维持对称式聊天窗。
> 代码事实口径：只引用导演台账 `docs/plans/ia-role-rework-ledger-2026-11-04.md` 已核实行号，以及本分片 2026-11-04 当天在活枝（`feat/smart-build-scene-script` 工作树）实测的 grep 结果；未实测的标「待核验」。
> 文案纪律：界面建议文案遵守 2026-10-29 备忘录禁词（重建、高斯、splat、WorldGen、Object、Composer、模式库不上界面）；内部管线名只出现在本文分析区。
> 配套灵感板：同目录 `space-materials-tool-panels-2026-11-04.html`。

---

## 0. 一页结论

1. **空间/物料面板的正确形态不是「把聊天窗删掉」，而是一整套「选中态驱动的属性段 + 行列表 + 库网格」。** SuperSplat 是本分片挖到的最干净范本：零聊天、零人格，一切交互是行（一行＝一个场景捕获）、可折叠数值段（选中才出现）、动作图标条（状态只给右上角短词）。
2. **AI 生成是「库内动作」，不是面板身份。** Spline 的深层做法比表面重要：它确实有 Agent 标签页，但 Objects（场景树）与 Assets（资产库）是侧栏同级标签——AI 只是侧栏三个标签之一，不是外壳人格。幕景空间/物料脸**连这个 Agent 标签都不要**：生成收进库面板的「＋」与短指令条（Marble omnibox / Meshy 创建条的形态）。
3. **场（空间）与物（物料）在导航上的正确分层是「场景列表 / 环境槽」对「资产库 / 网格卡」两种不同结构**，不是两个长得一样的聊天窗。场是「层」（一行一个、可显隐、可 Solo、可变换对齐）；物是「卡」（预览图、可搜索、可拖入画布）。Omniverse 的 Stage/Layer 与 Meshy 的 My Assets 分别示范了两端。
4. **拖入舞台的落点规则是库面板的隐藏核心。** PlayCanvas Editor 示范了三档落点（拖进视口＝当前选中的子级；拖进树空区＝挂顶层）；Blender 示范了「资产类型决定落点」（对象进场景、材质直接拖到对象上）。幕景 `placeCatalogItem` 已有放置动作（room-organizer.tsx:2017），缺的是落点规则与入库归档流程的显式化。
5. **避法已由备忘录钉死，本分片再次验证：** Meshy 模式侧栏（Assets/Image/Model/Print/Animate 并排作产品地图）与 Spline 深色工具坞密度，对幕景都是反例——它们是「工具箱 catalog」，不是「安静的方案工作台」。

---

## 1. 对标产品逐节

### 1.1 SuperSplat（PlayCanvas）——纯工具面板的最干净范本

- 官方：<https://superspl.at/editor>（在线即用，无安装）；仓库：<https://github.com/playcanvas/supersplat>（MIT LICENSE，已在仓库页 Resources 区与 LICENSE 文件核实；PlayCanvas 官方博客与论坛多次声明同一仓库 MIT 开源）
- 文档：Scene Manager <https://developer.playcanvas.com/user-manual/supersplat/editor/scene-management/>；Studio 左面板 <https://developer.playcanvas.com/user-manual/supersplat/studio/>

**交互骨架（全部已在文档页核实）：**

- **导航分轨**：左面板**一个面板三个标签**——Scene（Look & Tone / Post Effects / Cameras 分组段）、Annotations（场景标注列表）、Assets（天空盒图、碰撞体几何等场景资产上传）。视口居中，右侧/底部是属性与直方图。没有任何「模式」「人格」「向导」。
- **库结构（Scene Manager）**：当前项目里每个导入的场景文件是**一行**；点行＝设为 active（该行成为选择、变换、颜色、测量的唯一目标）；行首眼睛＝显隐（隐藏的行不进导出）；头部 Solo 钮＝隔离查看某一行而不改变显隐设置；双击行名改名；trash 删行（删行不可撤销，删高斯点可撤销——它明确区分了「删整个文件」与「删内容」两种动作的撤销语义）。
- **拖入/导入**：File > Import、Scene Manager 头部 import 钮、**直接拖支持的文件进视口**——三条等价路径，导入＝往项目里加行，不替换已有内容。File > New 才是另起项目（有确认）。
- **生成入口**：**没有 AI 生成。** 它是纯工具：底部工具条是动作图标（撤销/重做/选择模式/对齐/导出等），模式状态只以右上角短词出现（如「Centers Mode」）。
- **面板语言**：属性以**可折叠段**组织——Transform（Position/Rotation/Scale 数值）与 Colors 都是「选中 active 行之后才出现在行列表下方」的段；颜色调整带「Apply」烘焙按钮（改完要显式应用）。

**偷什么：**

- 「一行＝一个场景」的行列表 + active 行语义，直接映射幕景空间脸的环境槽列表（现 `environment` 槽已带 onSelect/onRemove/onSetFloor/onClear，room-organizer.tsx:2017）。
- Solo 隔离查看、显隐与导出绑定、双击改名、删除分级（删文件 vs 删内容）——物料库/环境列表的交互语言。
- 「选中才出现的可折叠属性段」——空间脸无选中时只给场景级设置（背景/光照/环境），选中时才换成选中项属性。

**避什么：**

- 直方图、Splat Data 统计、Centers/Rings 编辑模式这种技术人面板——幕景空间脸只做「场与壳」，不做点级编辑（那是内部管线）。
- 它的深色高密度皮肤只是 PlayCanvas 自家审美，幕景沿用冷石+品牌绿，只借结构不借皮。

**幕景落点：** 空间脸 `agent-panel.tsx:2006-2014`（现只有「新建/换场地」「图纸与照片」两个 chip + spaceSlot）→ 改造为「环境行列表（active/显隐/Solo）＋选中态属性段」；reconstruction-panel.tsx、splat-state 环境槽**复用**，S3 只收入口不重写管线（台账 §3-C）。

**待 owner 决策：** Solo 隔离在幕景「多个已捕获场地叠加在同画布」的场景下要不要做成显式能力，还是先只做显隐。

---

### 1.2 Spline——AI 是侧栏的一个标签，不是外壳人格

- 官方 UI 文档：<https://docs.spline.design/basics/understanding-splines-ui>；3D 库：<https://docs.spline.design/designing-in-3-d/3d-library>；导入：<https://docs.spline.design/doc/how-to-import-content/docE4wufWKXL>

**交互骨架（已在官方文档核实）：**

- **导航分轨**：编辑器左侧栏**三个标签**——Agent（AI 助手，编辑器默认打开就落在它）、Objects（场景树＝Outliner）、Assets（资产浏览器＋团队库）。上方 Scenes 列表在同一文件内的多个场景间切换。右侧 Property Panels：**无选中时是场景级设置**（背景色、灯光、模拟、效果、雾、天空、环境阴影、颜色）；**选中对象后整套换成该对象属性**。
- **库结构（Objects / Assets）**：Outliner 列出场景内每个对象、可嵌套、可搜索（文档明确「nested and searchable」），上方有搜索框；Assets 标签是资产浏览器；侧栏底部「Library」钮快速打开免费 3D 模型库，点库中项＝新建对象进场景。
- **拖入**：拖放兼容文件类型直接进视口；主菜单/侧栏底部/Home 右上角都有 Open/Import，⌘+O/Ctrl+O 同效。
- **生成入口**：Agent 标签是对话式 AI（「builds and edits the scene for you」）；工具坞「＋」展开对象全集清单（primitive/text/路径/导入模型），箭头钮＝Transform（移动/缩放/旋转选中物）。
- **面板语言**：stage 上方 Preview | Edit | Code 三态；选中驱动右侧属性整换。

**偷什么：**

- **「选中驱动整换」**——无选中＝场景设置，有选中＝对象属性。这是工具面板不人格化的核心语法（幕景空间脸可直接借用）。
- 侧栏底部「Library」快捷库钮、「＋」展开对象清单——库是面板内动作入口，不是独立人格。
- Scenes 列表（同文件内多场景切换）——对幕景「同一活动方案下多个场地/壳」的潜在分层有参考（后置，不进 S3）。

**避什么：**

- 备忘录已判：工具坞密度、Objects/Assets/Code 同级首屏、inspector 墙、深色「设计工具味」。幕景不学它的密度，只学「标签内收纳」。
- **Agent 标签默认打开**这个做法——幕景空间/物料脸**默认落点必须是库/列表，不是 AI 对话**（这是与 Spline 的关键分野）。

**幕景落点：** 物料脸 `materialSlot`（room-organizer.tsx:2017，现挂 ScendanceLibrary）→ 库为主体、「＋」生成是库内动作（台账 §3-D 已写明的口径，Spline 是佐证）；共用 composer（agent-panel.tsx:2030-2056）在空间/物料脸收为工具动作而非对话。

**待 owner 决策：** 物料脸内「库」与「已生成件」（generated-model-library）是否需要 Spline 式的子标签切换，还是同一网格内分组。

---

### 1.3 Meshy Workspace 3.0——统一资产库是正面，模式侧栏是反面

- 官方发布博客：<https://www.meshy.ai/blog/workspace-3-0>（已核实的镜像页 <https://meshy.cn/id/blog/workspace3>，2026-05-12 发布；内容一致）

**交互骨架（已在官方博客核实）：**

- **导航分轨**：左窄条图标轨＝Assets / Image / Model / Print / Animate 六个**任务模块**（外加新 Scene、Video 模块）。Workspace 下拉里集成「My Assets ＋ My Projects」。
- **库结构（My Assets 统一视图）**：Images / Models 两个子标签合并在统一资产视图下；顶部「Search my generation」搜索框；中央网格预览卡；**右侧详情列**＝该资产的 prompt 全文＋生成时间戳＋模型版本（如 Meshy 6）＋参考图缩略。分页与网格/列表切换在底栏。
- **拖入/放置**：生成的模型在 Model 模块内带底部工具条（Texture / Remesh / Rig / Download / Send to Animate），不离开页面完成后处理。
- **生成入口**：Discover 页顶部 **Integrated Creation Bar**（上传图＋prompt 合一），可一键切 3D Model / Image；**curated prompt preset** 让第一次出结果就够好；生成条左下角标耗时与积分消耗。
- **面板语言**：参数以分组形式排在左栏（Aspect Ratio / Number / Stylization / Multi-view / Pose / Image References），底部固定 Generate 条。

**偷什么：**

- **My Assets 的解剖**：搜索框＋Image/Model 子标签＋网格卡＋右侧「prompt/时间/模型版本」详情列。这是幕景物料库（generated-model-library.tsx 为主体）最直接的对照结构。
- **prompt preset**：库内「＋生成」给的不是空输入框，而是几条 curated 短指令卡片——生成动作收进库面板后的文案形态参照。
- 生成条标「耗时/消耗」的诚实短词——状态只给短词，不给人格话术。

**避什么（备忘录已钉死，本分片再次验证）：**

- **左模式侧栏作产品地图**（Assets/Image/Model/Print/Animate 并排）＝工具箱 catalog。幕景物料脸绝不能长成这样。
- 深色霓虹皮肤。

**幕景落点：** 物料库（generated-model-library.tsx、material-customization.tsx、material-checkin-panel.tsx）→ 需改造：补「搜索＋类型子标签＋网格卡＋右侧生成详情列」；「＋生成」入口参考 Integrated Creation Bar 与 prompt preset 形态。

**待 owner 决策：** 物料库是否要像 Meshy 那样显示「生成来源 prompt 与模型版本」——这关系到库卡片的信息密度上限。

---

### 1.4 NVIDIA Omniverse——Stage 与 Layer 的重型分轨（理念参照，不抄结构）

- Layers 文档：<https://docs.omniverse.nvidia.com/extensions/latest/ext_core/ext_layers.html>；Asset Browser：<https://docs.nvidia.com/learning/physical-ai/assembling-digital-twins/latest/optimization-data/adding-props-stage.html>；RTX Remix Layout Tab：<https://docs.omniverse.nvidia.com/kit/docs/rtx_remix/latest/docs/toolkitinterface/remix-toolkitinterface-layouttab.html>

**交互骨架（已核实）：**

- **导航分轨**：Stage（USD 场景）是本体；Layers 面板按「Simulation / Assets / Layout / Animation」分层组织——资产层是所有静态件的仓库，布局层负责摆放朝向，动画层只管动画意见。Layout Tab 同时并列四个面板：Layers、Bookmarks（收藏树）、Selection History（最近选中资产列表）、Selection（选中件的 mesh 属性）。
- **库结构**：Asset Browser 是**按需安装/开启的扩展**（Window > Extensions 搜 "NVIDIA Asset Browser"），非常驻左栏——官方还注明「只在需要时开启以降低启动开销」。
- **拖入**：资产从 Asset Browser 拖入 Stage，经 Layout 层定位。

**偷什么：**

- **「资产仓库」与「布局摆放」是两件事**的概念分离——这正是幕景「物料库」与「画布布置」分层的重型版本佐证：库是仓库，摆放是画布动作，不该混在一个聊天里。
- **Asset Browser 按需开启、非常驻**——库面板的常驻/按需取舍：幕景物料脸是左轨四形之一（常驻），但库内的高级筛选/批量视图可以是按需展开。
- Selection History（最近选中资产）——物料库可后置一个「最近用过」分组。

**避什么：**

- USD 层叠、Bookmarks、工程化面板密度——重型 DCC 工具，幕景是活动方案产品，不引入层叠概念。
- 它的学习曲线与面板墙。

**幕景落点：** 理念层佐证「物料库＝仓库、画布＝摆放」的分层；对应台账 §3-D「库为主体，生成是库内动作」。Selection History 类「最近用过」分组→后置。

---

### 1.5 World Labs Marble——生成收进一条 omnibox，作品收进 Gallery

- 官方文档总览：<https://worldlabs.mintlify.app/>；prompt 指南：<https://docs.worldlabs.ai/marble/create/prompt-guides/index>；图像提示：<https://docs.worldlabs.ai/marble/create/prompt-guides/image-prompt>；世界模型博客：<https://www.worldlabs.ai/blog/marble-world-model>

**交互骨架（已核实）：**

- **导航分轨**：三区——**Gallery**（浏览社区世界＋自己的世界＝作品库）、**Create**（生成工作区）、**Studio**（高级：Compose 多世界拼接、Record 电影镜头）。
- **库结构**：Gallery 即作品网格；世界以卡片存在。
- **生成入口（omnibox）**：Create 的核心是**单条 prompt 输入框**；文本（≤2000 字符）、单图、多图（可指定前后左右朝向）、全景、视频、Chisel 粗排 3D 结构——**所有输入类型进同一个框**；拖图进框自动展开 2D 输入模式；另有 curated preset 可随机 roll。生成后还有 Pano edit（选区域＋自然语言改）、Click and expand（点未探索区延展）、Variation（同起点出变体）。
- **面板语言**：「Describe a location, such as 'A warm, rustic cabin living room with a glowing stone fireplace…'」——prompt 指南直接给范例句，不是抽象功能名。

**偷什么：**

- **「一个框收所有生成输入」**——文本/图/视频都进同一 omnibox，拖入自动切模式。这是空间脸「生成场地」输入形态的最佳参照：不做多个生成模式 Tab（那是 Meshy 反面），做一个框＋类型芯片。
- **Gallery 与 Create 分离**——作品库与生成工作区是两区。对幕景：物料库（作品）与「＋生成」（工作区）在面板内分区而非分人格。
- prompt 范例句直接写进指南占位——幕景工具面板的 placeholder 应给「一句话范例」，不给功能名词。
- Variation/Expand 这类「在已有结果上续写」的动作，比「重新生成」更贴方案迭代（后置参考）。

**避什么：**

- Chisel 粗排 3D 建模、Studio Compose 多世界拼接——重型，幕景不引入。
- 移动端功能裁剪（桌面才有完整编辑流）——幕景可参考「移动端降级但不重排 IA」的诚实标注。

**幕景落点：** 空间脸「生成场地」入口（现 `openAholoWorkflow(kind: 'world'|'recon')`，room-organizer.tsx:1894）→ 需改造：统一为「一个生成框＋输入类型芯片」，world/recon 作为内部模式不上界面（禁词纪律）。

**待 owner 决策：** 空间脸生成框的 placeholder 用「范例句」还是「功能名」——建议范例句。

---

### 1.6 Polycam Scenes——layers 面板加捕获，技术人 UI 作反面

- 帮助中心：<https://learn.poly.cam/hc/en-us/articles/35174492720404-How-to-Create-a-Scene>；扫描工作流博客：<https://poly.cam/blog/how-to-scan-a-building-interior-exterior-and-multi-story-workflows>

**交互骨架（已核实）：**

- **导航分轨**：Scene 编辑器左侧 **layers 面板**；「Add 钮在 layers 面板内」加更多捕获；场景可移动/旋转/缩放对齐（备忘录 10-29 已核实）。
- **库结构**：每个捕获＝一层。
- **生成入口**：无 AI——它是把已完成的多个捕获「并排组织进一个空间」（与 Extend 连续扫描互补）。

**偷什么：**

- 「Add 在 layers 面板内」——加层动作就在列表面板里，不跳别处。幕景空间脸「加一个已捕获场地」的动作就该在环境行列表内头部。
- 捕获叠加对齐的产品语义（多捕获并置＝一个空间）对幕景「多个场地素材叠在同一画布」有直接对应。

**避什么：**

- 备忘录已判：layers/snap/swap 作默认＝技术人 UI。幕景空间脸只保留行列表与显隐，对齐/吸附收为后置。

**幕景落点：** 空间脸环境槽列表（room-organizer.tsx:2017 environment）→ 需改造：头部「＋加捕获/场地」在面板内；吸附对齐后置。

---

### 1.7 PlayCanvas Editor——资产面板的「＋」与拖入落点规则

- 导入模板教程：<https://developer.playcanvas.com/en/tutorials/importing-first-model-and-animation/>；FAQ：<https://developer.playcanvas.com/user-manual/faq/>；模板：<https://developer.playcanvas.com/user-manual/editor/templates/>

**交互骨架（已核实）：**

- **库结构**：**ASSETS 面板在屏幕底部**（不是左栏）；面板内「＋」钮展开 New Asset 菜单（Upload / 新建各类资产）；可把电脑文件**直接拖进 Assets 面板**完成上传；资产可在面板内拖文件夹归档。
- **拖入舞台的落点三档（核心）**：
  1. 资产拖进 3D 视口＝作为**当前选中 Entity 的子级**；
  2. 拖进 hierarchy 里某个 Entity＝作为该 Entity 的子级；
  3. 拖进 hierarchy 空区＝挂到场景顶层。
- **生成入口**：无 AI——纯编辑器。

**偷什么：**

- **「＋」展开 New Asset 菜单**（Upload / 新建类型二选一）——物料库面板内「＋」的动作结构，比空输入框诚实。
- **拖入落点三档规则**——物料从库到画布（幕景 `placeCatalogItem`，room-organizer.tsx:2017）需要同样的「落点语义」：拖到选中物附近＝关联摆放；拖到空画布＝新放一件。
- 资产可拖文件夹归档——物料库的入库归档流程（生成件→进库→可分组）参照。

**避什么：** 底部大资产面板的密度——幕景库是右栏卡片槽（materialSlot variant="card"），不照搬底栏。

**幕景落点：** 物料脸 materialSlot（ScendanceLibrary，scendance-workspace.tsx:127）→ 需改造：「＋」菜单结构＋拖入落点规则显式化。

---

### 1.8 Blender Asset Browser——资产类型决定落点

- 官方手册：<https://docs.blender.org/manual/en/latest/editors/asset_browser.html>（Blender 5.2 LTS 手册「Asset Browser / Using Assets」节，已实际打开核实）

**交互骨架（已核实）：**

- **库结构**：左＝Asset Library 区（catalog 树：选中某目录只列该目录及子目录资产，双击改名、可拖换父级）；中央＝选中目录的资产网格（Thumbnails 预览模式，大小可调）；右＝Asset Details 区（元数据：Name/Source/License/Author、Preview 预览图、Tags 标签，N 键开关）。头部有按资产类型 Filter 与 Online/Offline 来源筛选。
- **拖入落点按类型分**：对象与世界拖进场景；**材质直接拖到对象上**；几何节点拖到对象上加修改器——**资产类型决定拖上去落在哪**；拖集合＝以实例加入。

**偷什么：**

- **catalog（目录）分组＋预览卡**——物料库的分类结构参照（目录不是模式 Tab，是筛选）。
- **「资产类型决定落点」**——物料（道具）拖进画布＝新摆放；材质类拖到已放物料上＝换材质（幕景 material-customization.tsx 已有材质能力，这条直接对应）。

**避什么：** 手动生成预览图、catalog 文件管理——重型，幕景生成件预览图应由生成管线自动产出。

**幕景落点：** 物料库分类（catalog 式筛选，非模式 Tab）＋材质拖到已放物料（material-customization.tsx）。

---

## 2. 五主题横切总结

### 2.1 场/物分轨 IA（Tab vs 左轨 vs 面板切换）

| 产品 | 场（场景/Stage）结构 | 物（资产）结构 | 取舍 |
|---|---|---|---|
| SuperSplat | Scene Manager **行列表**（一行一捕获） | Assets 标签（天空盒/碰撞体等场景级上传） | 同一左面板三标签，场是行 |
| Spline | Scenes 列表＋Outliner 树 | Assets 标签＝资产浏览器 | 侧栏三标签，场是树 |
| Meshy | 无（它是纯件生成器） | My Assets 网格卡 | 反面：六模式侧栏 |
| Omniverse | Stage＋Layers 工程分层 | Asset Browser 按需开启 | 重型分层 |
| Marble | Gallery 世界卡 | 同左 | 作品即场 |
| Polycam | layers 行（一捕获一层） | 无 | 行列表 |
| PlayCanvas | hierarchy 树 | 底部 Assets 面板 | 库与树分两区 |
| Blender | 场景 | Asset Browser catalog | 库是独立工作区 |

**结论：** 幕景已拍板「空间/物料是左轨四形之二」（不加第五图标，台账 D1）。面板内部正确结构是：**空间＝环境行列表（场/壳）；物料＝库网格卡**。两者不要长成一样——场是「层/行」（显隐、Solo、对齐），物是「卡/网格」（搜索、预览、拖入）。「场地｜物料」双 Tab 仅文档定案、代码后置（台账 §3-D）。

### 2.2 库面板解剖（分类/搜索/预览卡/过滤/网格密度/空态）

最佳参照＝Meshy My Assets ＋ Blender catalog ＋ PlayCanvas「＋」菜单：

- **搜索框置顶**（Meshy「Search my generation」）——必备。
- **类型子标签**（Images / Models，Blender catalog）——筛选，不是模式切换。
- **网格预览卡**＋右侧详情列（prompt/时间/模型版本）——生成件必须带来源上下文。
- **「＋」菜单**（PlayCanvas：Upload / 新建类型）——加资产动作在面板内头部。
- **空态**：本分片各产品文档未给空态细节（**待核验**），幕景物料库空态建议：「还没有物料——从活动方案生成，或点＋上传/生成」一句短词，不放人格话术。

### 2.3 拖入舞台（库→画布放置→选中变换→入库归档）

- **落点三档**（PlayCanvas）：拖视口＝当前选中子级；拖树空区＝顶层。
- **类型决定落点**（Blender）：道具进画布新摆放；材质拖到已放道具上换材质。
- 幕景现状：`placeCatalogItem`（room-organizer.tsx:2017）已有放置动作；`capturePlacement` 已带到场点验（material-checkin-panel.tsx）。**缺**：落点规则显式化、拖入后的选中变换入口、生成件→入库归档流程的统一。
- 选中后变换：SuperSplat Transform 数值段（Position/Rotation/Scale）是「选中态属性段」参照。

### 2.4 生成入口收纳（面板内「＋」/短指令/inline 生成态）

| 产品 | 生成入口形态 | 判词 |
|---|---|---|
| Marble | omnibox 单框＋输入类型芯片＋范例句 placeholder | **正面**：一个框收所有输入 |
| Meshy | Integrated Creation Bar＋curated preset＋耗时/消耗短词 | **正面**：生成条常驻 Discover，preset 给首次结果 |
| Spline | Agent 标签（对话）＋工具坞「＋」对象清单 | **混合**：只学「＋」清单，不学 Agent 默认打开 |
| SuperSplat | 无生成 | **对照**：纯工具面板也成立 |
| Omniverse | 无生成 | **对照** |

**结论：** 幕景空间/物料脸的生成入口＝**库/列表面板内的「＋」菜单（上传/生成/从方案来）＋一条短指令框（范例句 placeholder）**，不是聊天人格。生成完成后结果**落回库网格**（Meshy 路径），不弹独立生成页。

### 2.5 去人格化模式总结（见第 3 节原则清单）

---

## 3. 工具面板如何不人格化——给幕景 S3 的原则清单（可执行）

1. **面板的单位是「行」和「卡」，不是「话」。** 空间脸列环境＝一行一行（可显隐、可 Solo、可改名）；物料脸列资产＝一张一张卡（预览图、来源短词）。任何一屏不出现对话气泡。
2. **选中驱动整换。** 无选中＝场景级设置段（环境/背景/光照的短词开关）；有选中＝选中项的属性段（变换数值、材质、来源）。同一面板，内容随选中态换（Spline/SuperSplat 共同语法）。
3. **生成是「＋」和「一条框」，不是「一张脸」。** 面板头部「＋」菜单（上传/生成/从方案来）＋短指令框（placeholder 给范例句，不给功能名词）；生成结果落回库网格，不弹人格对话框（Marble/Meshy 语法）。
4. **状态只给短词，不给情绪。** 模式状态（如「Centers Mode」式）出现在右上角短词；生成耗时/消耗给数字短词（Meshy）；不出现「我来帮你」「这就为你」式话术。
5. **动作按钮用动词，属性用名词。** chip 是「新建/换场地」「图纸与照片」（现 agent-panel.tsx:2010-2011 已是这个语言，保留）；属性段用「位置/旋转/缩放」「材质」这类名词，不用「智能布置」「一键美化」。
6. **空态是一句诚实话，不是欢迎语。** 「还没有物料——从活动方案生成，或点＋」短词一句。
7. **删除分级。** 删整个条目（行/卡）与删条目内内容是两种动作，撤销语义不同（SuperSplat 已示范）；面板文案要区分「移除」与「删除」。
8. **库与画布的边界靠落点规则维持。** 从库拖到画布＝摆放（落点三档）；材质类拖到已放物料＝换材质；不出现「把聊天里的一句话拖进画布」。
9. **默认落点是库/列表，不是 AI。** 空间/物料脸打开时落在行列表或库网格；生成框是面板内一个可收起的条，不是首屏主体（与 Spline「默认开 Agent」分野）。
10. **禁词纪律在面板语言上同样生效。** 面板文案用「场地/环境/物料/件/来源/尺寸」；内部管线名（world/recon 等）只进代码注释与调研文档，不上界面。

---

## 4. 核心建议（≤5 条，给 S3）

1. **空间脸改「环境行列表」范式**：以 SuperSplat Scene Manager 为结构范本（行/active/显隐/Solo/双击改名），承接现有 environment 槽（room-organizer.tsx:2017）与 reconstruction-panel.tsx；先产出「空间脸全部入口对照表」（现已实测：新建/换场地 agent-panel.tsx:2010、图纸与照片 :2011、openAholoWorkflow room-organizer.tsx:1894、spaceNewRef :231、lux3d 场地观感面板 :2012），再砍重复——S3 红线是只收口、不重写管线。
2. **物料脸按 Meshy My Assets 解剖重构库**：搜索框＋类型子标签＋网格卡＋右侧「prompt/时间/来源」详情列，以 generated-model-library.tsx 为主体；「＋」菜单学 PlayCanvas（上传/生成/从方案来）；空态一句诚实短词。
3. **生成收为面板内「＋＋一框」**：空间脸生成场地统一为「一个生成框＋输入类型芯片」（Marble omnibox 语法），world/recon 模式不上界面；物料脸生成＝库内「＋生成」＋curated 短指令 preset（Meshy），结果落回库网格。共用 composer（agent-panel.tsx:2030-2056）在空间/物料脸收为这条短指令框，不再是对话窗。
4. **拖入落点三档显式化**：道具拖到选中物附近＝关联摆放；拖到空画布＝新放一件；材质拖到已放物料上＝换材质（Blender 类型落点语法）。落点规则写进 placeCatalogItem（room-organizer.tsx:2017）的交互说明。
5. **双 Tab「场地｜物料」本轮只落文档定案**（台账 §3-D 已列后置），S3 不动轨；「最近用过」「Variation 变体」「吸附对齐」列后置清单。

---

## 5. 参考链接总表（全部已实际打开核实）

| 产品 | 链接 | 核实内容 |
|---|---|---|
| SuperSplat Editor | <https://superspl.at/editor> | 在线编辑器入口 |
| SuperSplat 仓库 | <https://github.com/playcanvas/supersplat> | MIT LICENSE、开源声明、编辑器 UI 截图 |
| SuperSplat Scene Manager | <https://developer.playcanvas.com/user-manual/supersplat/editor/scene-management/> | 行列表/active/显隐/Solo/改名/删除/导入 |
| SuperSplat Studio | <https://developer.playcanvas.com/user-manual/supersplat/studio/> | 左面板三标签 Scene/Annotations/Assets |
| Spline UI | <https://docs.spline.design/basics/understanding-splines-ui> | 侧栏 Agent/Objects/Assets、Outliner、选中驱动属性 |
| Spline 3D Library | <https://docs.spline.design/designing-in-3-d/3d-library> | Library 钮在侧栏底部 |
| Spline 导入 | <https://docs.spline.design/doc/how-to-import-content/docE4wufWKXL> | 拖文件进视口 |
| Meshy Workspace 3.0 | <https://meshy.cn/id/blog/workspace3> | 统一资产库、创建条、prompt preset、模式模块 |
| Omniverse Layers | <https://docs.omniverse.nvidia.com/extensions/latest/ext_core/ext_layers.html> | 资产层/布局层分离 |
| Omniverse Asset Browser | <https://docs.nvidia.com/learning/physical-ai/assembling-digital-twins/latest/optimization-data/adding-props-stage.html> | 按需开启的扩展 |
| Omniverse Layout Tab | <https://docs.omniverse.nvidia.com/kit/docs/rtx_remix/latest/docs/toolkitinterface/remix-toolkitinterface-layouttab.html> | Layers/Bookmarks/Selection History/Selection 四面板 |
| Marble 总览 | <https://worldlabs.mintlify.app/> | Gallery/Create/Studio 三区 |
| Marble prompt 指南 | <https://docs.worldlabs.ai/marble/create/prompt-guides/index> | 文本≤2000 字符、范例句 |
| Marble 图像提示 | <https://docs.worldlabs.ai/marble/create/prompt-guides/image-prompt> | 拖图进 omnibox |
| Marble 世界模型 | <https://www.worldlabs.ai/blog/marble-world-model> | Chisel 粗排 |
| Polycam Scenes | <https://learn.poly.cam/hc/en-us/articles/35174492720404-How-to-Create-a-Scene> | layers 面板 Add 钮 |
| PlayCanvas 导入教程 | <https://developer.playcanvas.com/en/tutorials/importing-first-model-and-animation/> | 拖入落点三档 |
| PlayCanvas FAQ | <https://developer.playcanvas.com/user-manual/faq/> | 拖文件进 Assets 面板 |
| PlayCanvas 模板 | <https://developer.playcanvas.com/user-manual/editor/templates/> | 拖模板进场景/树 |
| Blender Asset Browser | <https://docs.blender.org/manual/en/latest/editors/asset_browser.html> | 左 catalog 树/中央预览网格/右详情区；类型决定落点 |

---

## 6. 放弃候选及原因

| 候选 | 放弃原因 |
|---|---|
| Hyper3D Rodin / WorldGen | 备忘录 10-29 已判「object list＋New/Add/Remove 作 primary＝compose lab」，且内部管线名 WorldGen 属禁词；本分片不再重复调研，结论沿用备忘录评分（Fit 2/5）。 |
| Viggle PINOC Scene | 备忘录已覆盖其「world-first 大气」氛围参考；它是「描述→进入空间」的生成产品而非工具面板，对「面板化」主题增益有限，本分片不展开。 |
| Dora AI / Luma | 属「一句话生成整包」的生成主路径参照，不是空间/物料面板参照；归活动分片，不重复。 |
| Unity / Unreal 的内容浏览器 | 未在本轮联网核实到可引用的官方文档页；属重型引擎，与幕景轻量 Web 工作台距离远。**列为未能核实而放弃的候选**，避免未核实结论进灵感板。 |
| Twinmotion / Enscape | 未核实；同上，属建筑渲染工具而非活动方案面板。 |

---

## 7. 待 owner 决策点汇总（回 S3）

1. 空间脸 Solo 隔离查看是否做显式能力，还是先只做显隐。
2. 物料脸「库」与「已生成件」是否需要子标签切换，还是同一网格内分组。
3. 物料库卡片是否显示生成来源 prompt 与模型版本（信息密度上限）。
4. 空间脸生成框 placeholder 用「范例句」还是「功能名」（建议范例句）。
5. 双 Tab「场地｜物料」定案文案（本轮只文档定案）。

— End —
