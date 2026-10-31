# 更新记录

## v2.2.0 · 地图圈画进 3D + 卫星贴地参考 · 2026-10-31

地图上圈画场地，进编辑器就是真轮廓壳体；卫星贴地可开关，只作参考。

- **地图圈画 → 真轮廓壳体**：户外选址在地图上圈画后，演示 L 与户外场地按真实多边形立成壳体，不再只落矩形盒子。
- **卫星贴地参考可开关**：开=真卫星贴地，关=素色地面；圈外浅色半透明垫，圈内清晰、圈外不抢戏。
- **硬钉**：卫星图仅供参考，不可作重建素材；高德只定场，不参与重建管线。
- **采集单 / 流线 → Aholo**：现场采集指引与干跑重建接上；环境预览可挂云端 E2E 样例场景。
- **旅程 / 规范 HTML 与过程归档**：视觉旅程与产品规范页更新；十月过程文档迁入 `docs/archive/process-2026-10/`。

## 活动资料分区：图纸与照片 ｜ 场地重建 — 2026-10-30

「图纸与照片」一屏里堆了十几个按钮，看不出哪些是看图纸、哪些是跑重建。按内容分家，状态只留一份。

- **图纸与照片**：上传卡与图纸列表、参考底图、已知尺寸与尺寸清单（含与当前场地的差异提示）、原图三点对应、进阶 · 编辑当前场地。
- **场地重建**：连接场景服务前置卡、重新识别、本次照片生成模式、局部修改要求、「生成布置预览」、任务进度、结构核对（比例闸 + 平面图）、三维候选与确认应用。
- **状态共用一份**：重建面板改为 `useReconstructionPanel`，由 `CreativeBriefPanel` 顶部调用一次，页签只决定放哪一块。切页签不打断进行中的识别、不丢候选，没保存的尺寸输入照样在；备份恢复结束后自动重读图纸表单，不再沿用恢复前的旧值。
- **去向互相指**：图纸页末尾「去场地重建出 3D 预览」，重建页开头说明「图纸、照片与已知尺寸在『图纸与照片』页核对」；页签导航与标题栏分类下拉同步补上「场地重建」，「图纸与尺寸」统一改叫「图纸与照片」。
- **跨页签按钮补外观**：这两个「去…」按钮挂在 `.cr-hint` 里、不在 `.rc-panel` 内，`.rc-secondary` 的边框样式原本够不着，截图里看着像一行灰字。样式选择器补上 `.cr-hint .rc-secondary`，无头 Chrome 实测已和面板里其他次级按钮一致（1px 描边 + 纸白底）。
- **左栏顶那两枚标签删了**：实测「活动资料」只是当前状态的自报家门（真入口在左轨图纸/地图，进来后下面一排页签才是导航），删掉；「活动简报」实际只干返回一件事，改叫「返回简报」，最后连它也撤了——回简报点左轨阶段钮即可（`selectWorkbenchMode` 会把左栏切回活简报），这枚按钮在 rail 布局里本来就 `display:none`，只是 DOM 残留。简报页本来就不渲染这排标签。
- **分类页签也撤了，导航归左轨**：抽屉里那排 客户需求 / 图纸与照片 / 场地重建 / 物料工具 不再和左轨各说一套——左轨「场地资料」组变成 地图 / 图纸 / 重建 三枚，客户需求与物料工具回到简报「更多资料」的 活动需求表、物料建模（一直都在），抽屉一次只显示一块。两块之间仍用「去场地重建出 3D 预览」「去图纸与照片」互指。顺带把随之变空的 44px 标题条与 `.cr-business-links` 样式一起删掉。
- **抽屉底那行「当前场景 N 件物料 · 已选中 N 件」撤了**：它讲的是整个场景，和正在做的图纸/重建无关，且件数简报里已有（物料 行）、选中对象有「选中物料」那一栏。CSS 一并清掉；原测试里靠这行判断「商业档案打开时资料面板已隐藏」，改成直接断言 `#agent-panel-plan` 的 hidden。
- **「核对原图与当前设计」改回它本职的名字**：它做的其实是「选一张平面图 → 标三个对应点 → 看叠加 → 用于当前设计」，叫核对只覆盖了第三步。标题改成「原图对应（三点定标）」，开头一句交代四步；确认后状态改成「已用于当前设计：图名 · 3 个对应点 · 仅保存在本机」，不再是「已核对」这种分不清做没做的说法。
- **上传和选择并成一个门**：原来「上传平面图」一行 + 「核对平面图」下拉，传完还得回下拉再选一次。现在只有一个「平面图」下拉，上传是它最后一项「上传新平面图…」（点开系统选文件，选完回到下拉）；空态按手里的条件说人话——有上传入口就说「先上传一张，或从照片里选一张」，没有就说「请先到《图纸与照片》上传或选一张」，不再把「云端引用不会自动改成本机来源」这种内部规则甩出来。
- **场地重建里的叠图只做查看**：同一块在「核对识别结构」里是待核对态，原来也摆着「重新标记三个对应点」，却没有确认按钮，标完交不出去。现在那里只保留下拉、叠加图和透明度，配一句「橙色为识别出的墙线，绿色为门、蓝色为窗；只用于对照」，标点与确认只留在「图纸与照片」。图纸页删掉那张和叠图无关的「当前设计结构核对图」。

## 生成资产本机化 + 3DGS 环境预览 — 2026-10-30

Aholo 那条两小时就失效的链接不再进图纸；场景生成也能真的看见。

- **落盘换本机地址**：签名产物先落到 `.cache/aholo/`，文件名就是资产号，页面只认 `http://127.0.0.1:3199/asset/<uuid>.glb`。同一任务号重复点不二次下载。
- **图纸只存资产号**：保存时剪掉会过期的链接，重开按资产号回本机取，GLB 走原来的拖拽、吸附与撤销管线。
- **物料抽屉多一档「生成物件」**：左轨第二枚图标，先列仓库留档的那几件、再列本机这次落盘的，点一下就摆进场地；不是只给一次的一键按钮。第三枚「环境预览」同样先列留档场景。
- **环境预览（Spark 2.4.0）**：场景生成取回单包 `.spz`（没有才退 `.ply`，不解析 LOD 元数据），按场地最长边等比铺成 3D 背景。点云待在自己的渲染栈里，不参与拾取、不撞几何；场地壳体只在那两趟之间让位，退出原样复原，机位也还回进来之前的那一帧。
- **朝向有实测依据**：Aholo 不给竖直轴时按 Z-up，判据是那条历史 PLY 的三轴范围（x 23.38 / y 15.51 / z 3.57，最短是 z）。
- **代理侧**：物件 GLB 仍守 10 MiB，3DGS 场景包收到 150 MiB；产物下载超时 60 秒放到 300 秒。
- **生成素材留档**：本机产物按内容去重存进 `assets/generated/`（2 个物件 GLB、2 个 3DGS 场景 SPZ、接口全景图与缩略图，约 20 MB），`manifest.json` 记中文名、真实尺寸、校验值与来源；`.cache/aholo/` 那些重复副本继续不入库。
- 已知待收：本机那条落盘记录和留档的同一件物件会排成两张卡；「退出预览」在画布和货架各挂了一份，而卡片本身还不是开关。
- 未做：LOD 根块截断降级、场景包从界面删除、云端发布带本机资产。详见 `docs/AHOLO-ASSET-AND-SPLAT-PREVIEW-2026-10-30.md`。

## v2.0.0 — 活动方案全流程 — 2026-10-28

一条路：选活动 → 定场地 · 人数 → 生成方案 → 预览确认 → 导出。对话可以加速，不负责考试。建议先停在预览，唯一确认之后才写入。

- **首屏**：活动卡、场地与人数，一颗「生成方案」。空闲没有绿色主按钮，按钮旁不放说明书。
- **三块视图**：布置 / 物料 / 执行资料是同一份方案，不是三件产品。
- **左轨**：只留布置 / 评审 / 执行。设置不再占第四枚图标。晴光收在画布场边，聊天可关。
- **深收口**：首屏不出现场景 / 物件 / 合成入口、工具坞、氛围、六页执行台和 n/N 进度。厂商名退出可见文案。导出按钮不再用绿色。
- 生成算法、几何和配色体系未改。

## 活动主路径收口：一确认、三轨、简报跟聊天 — 2026-10-28

- **确认只在最后一帧落稳后亮**：生成中、云端忙、恢复中、预览过期或基线变了，右栏不亮「确认布置 / 确认导出」。连着云项目时不再在云端忙碌时退回本地生成并亮确认。
- **右栏只有一个对话**：工作台已挂 Agent 面板时，旧晴光聊天不再展开抢主路径，避免第二颗「确认布置」。深工具里的「生成布置预览」强制先预览。
- **左栏简报跟当句走**：聊天里的人数、活动类型（含酒会）、室内外和长宽在同一轮写进活动简报；未保存的表单默认值不再冒充已说的人数和类型。座位不够仍写「座位 X / Y · 还差 Z」，人数不自动改小。
- **左轨阶段只有三枚**：布置 / 评审 / 执行留在「工作流程」里。设置不进这组，也不再占左轨第四枚图标；账户仍从顶栏「项目」进。

## 画布静默：四周收短、说明自动淡出 — 2026-10-27（T-06）

- **空闲先看见场**：画布顶左只留一行 `3D 场景 · 12 × 9 m`；物料件数与面积改成点一下尺寸才展开，不再常驻第二行。
- **右竖条只露四颗**：撤销 / 2D·3D / 视角 / 更多；重做、网格吸附、标注尺寸、看全场、缩放、导出效果图都收进「更多 ▾」（默认折叠，点空白或 Esc 收起）。导出选项在「更多」内一层展开，返回箭头回列表。
- **预览说明会消失**：AI 预览说明出现后约 2 秒淡出；指针重新进入画布再闪一次，不再整句常驻挡场。
- **空闲不再挂引导气泡**：画布中央不再有「说一句需求就能出方案」；生成中、生成失败、重叠警告、漫游退出等提示保留。
- **物料库把手更轻**：去箭头、缩小、变浅，只剩「库」义；点开仍是原来的抽屉。
- 验证：卡 §7 两套件 **2 files / 32 tests passed**；`npx tsc --noEmit` 退出码 0；eslint 本卡文件 **0 error**（3 条既有 warning）。真机（`127.0.0.1:3026/editor`，headless Chrome/CDP）：四颗竖条、更多内 7 项与导出面板、说明 2s 淡出与回场再闪、出提案/确认/撤销与 30 人座位缺口回归均通过。全量与既有欠账见 `docs/T-06-SELF-CHECK.md`。
- 涉及：`frontend/components/room-organizer/panels/scendance-workspace.tsx` + `.react.test.tsx`、`room-organizer.tsx`、`panels/agent-panel.tsx`、`app/globals.css`、`panels/creative-studio.css`、`docs/T-06-SELF-CHECK.md`。
- 待核（未扩 scope）：① 竖条与把手的既有样式在 `app/globals.css`、说明基础样式在 `creative-studio.css`，按卡片「最小增量」只动画布层；② 顶栏明细为点开而非悬停；③ 引导气泡整颗删除，文件错误只留右栏报告；④ 提案态手动打开画布导出面板会与右栏确认同时出现两颗绿（既有样式，本卡未新增绿钮）；⑤ **未 commit / push / 部署 / 开 PR**，停等验收。

## 生成完再亮确认 + 座位不够给改方案 — 2026-10-27（T-05）

- **确认只在最后一帧落稳后出现**：右栏提案只在 `proposed` 暴露；生成中、暂停（逐帧未完）、云端忙都不给可点的绿色「确认布置」；blocked / stale / expired 时不出绿钮，只留原因。
- **云端忙同一规则**：深工具候选卡在 `studio.busy` 时收起「确认布置 / 放弃」，只显示「正在整理这一版…」；忙完且未 stale 才恢复。
- **座位行与一点击改法**：有 `guests` 时提案卡显示 `座位 X / N · 还差 M`（够坐写「按 N 人摆了 X 座」）；不足时给文字链「加座，再排一版」，点击后旧确认立即消失、重新走预览，确认前不写画布。
- **座位优先生成器**：只给这一版新摆的桌子先补桌边角位、再按 1 米网格找空位；每次落座过碰撞与几何闸，并拒绝把椅子叠到桌面上充数；`seats` 按实际椅子件数如实计数。
- **补不齐的诚实**：加座后仍不足时改为「这版最多摆 X 座，还差 N 位；可以换更大的场地，或按站立留空」，同时撤掉改法链，不暗示再点一次就能补齐。
- 验证：卡 §7 三套件 **3 files / 249 tests passed**；`npx tsc --noEmit` 退出码 0；eslint 本卡文件 0 error（18 条既有 warning）。真机（`127.0.0.1:3026/editor`，headless Chrome/CDP）：12×9 / 30 人 16→30 座补齐并确认、撤销回 5 件；5×4 / 30 人 4→7 座，如实报「最多 7 座」；全流程绿钮最多一颗。证据见 `docs/T-05-SELF-CHECK.md`。
- 涉及：`room-organizer/lib/agent-proposal.ts` + `.test.ts`、`panels/agent-panel.tsx` + `.css` + `.react.test.tsx`、`panels/creative-studio.tsx` + `.react.test.tsx`、`docs/T-05-SELF-CHECK.md`。
- 待核（未扩 scope）：① 座位优先只在本地规则生成器生效，云端提案不计算 `seats`；② 暂停（逐帧未完）时不显示提案卡，若需「暂停到哪帧确认哪帧」另开卡；③ 已随 v1.3.2 提交并推送（2026-10-27），未部署、未开 PR。

## 活动组织流程 AI-Native 框架钉版（docs only）— 2026-10-27

- 新增 docs/ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md：本阶段真相源——先升级活动布置/组织主流程（chat-first、安静 UI、左轨三图标、空闲零绿钮），3D 后谈；明确 Out（3DGS/mood/按钮旁说明书/四段左轨）；给 Qoder 3–5 张卡序，首卡「可见交互收口」。docs/AI-NATIVE-FOR-EXECUTORS.md 顶部加指针。未改产品代码、未 commit/push。


## 编辑器从表单壳翻成 chat-first：左轨只留三图标、空闲零绿钮、导出走意图→预览→一确认 — 2026-10-27（T-UI）

- **左轨只切对话上下文**：布置 / 评审 / 执行三枚模式图标只改聊天上下文，不再把主舞台换成六 Tab 表单；第四枚「工具」钮已移除。左栏默认「活动简报」（名称 / 人数 / 场地尺寸），对话说「80 人、12×9 米」左栏数字直接更新；七件深工具改由「活动简报」底部折叠区或「活动资料」上下文签显式点击打开，且打开时回到上次分类，挂载不自开。
- **空闲态零绿主钮**：右栏隐藏 `n/4` 向导进度与常驻绿「导出给搭建方」；只有提案/预览卡出现时才有一颗绿主钮，全屏同时只允许一颗。提案待确认时打开导出预览，`确认布置` 降为描边 chip，唯一绿钮是 `确认导出`；导出卡只保留一颗通栏主钮 + 「先不了」文字链。
- **导出链路**：对话「导出给搭建方 / 出交接」→ 右栏预览卡 → 「确认导出」→ 既有本机导出；不再空闲挂绿钮。
- **布置确认文案统一**：提案链路的「确认应用」全部改「确认布置」；`directApply` 默认 `false`，直应用开关深埋。
- **Undo 同步修复**：画布工具栏「撤销」后右栏清掉 `planReady` / 预览卡 / 提案态，与画布一致。
- **六 Tab 退出主路径**：六 Tab 只在显式点开的「执行资料」深工具里；主路径看不到。深工具抽屉恢复「活动简报 / 执行资料」上下文签与收起钮，程序化聚焦容器不再画默认黑框；简报页 292px、深工具 380px。演示条保留。
- 验证：卡片四套件 251 条、相邻三套件 106 条全绿；`npx tsc --noEmit` 退出码 0；eslint 本卡 JS/TS 文件 0 error（12 条既有 warning）。真机（`127.0.0.1:3026/editor`，headless Chrome/CDP）：空闲零绿、左栏无六 Tab、简报跟聊天、导出唯一确认、撤销清右栏、深工具抬头逐项通过。全量 3647 过 / 4 失败：3 个 HEAD 既有欠账（backend-generation / 评审 HTML 快照 / scene-presets）+ share 负载偶发（单跑通过），非本卡回归。截图与逐条证据见 `docs/T-UI-SELF-CHECK.md`。
- 涉及：`room-organizer.tsx`、`lib/workbench-mode.ts` + `.test.ts`、`lib/workbench-agent.ts` + `.test.ts`、`panels/agent-panel.tsx` + `.css` + `.react.test.tsx`、`panels/creative-studio.tsx` + `.react.test.tsx`、`panels/scene-delivery-panel.tsx`、`docs/T-UI-SELF-CHECK.md`。
- 待核（未扩 scope）：① 深「执行资料」内仍保留六 Tab，主路径不可见；② 材质版本工具有「确认应用到选定物件」，属另一操作，非提案确认；③ 根与 `frontend` 的 `package.json` 仅去 BOM（跑测试的环境修复，不在 In 列表）；④ 三份框架文档按用户指示未提交；⑤ 未 commit / push / 部署，合入只由人。

## T-UI 交互可见改任务卡已开给 Qoder — 2026-10-26

- 新增 `docs/T-UI-VISIBLE-INTERACTION.md`：要求把编辑器从六 Tab 表单壳砍成 chat-first（左轨仍三图标、空闲零绿钮、导出走意图→预览→一确认、Undo 同步清 `planReady`）；本条只记开卡，实现未提交。

## 交付两条路说清：离线 HTML 主流程，云端只读链接次入口 — 2026-10-26（T-04）

- 评审页顶部新增「客户交付两条出口」：**离线评审 HTML** 写明不依赖登录、生成后由人下载发送、文件冻结在生成时；**云端只读链接** 写明需要登录并保存云项目、发布后由人复制链接、系统不会自动发给客户、撤销后已下载文件收不回。离线 HTML 仍是主流程，云发布是次入口——两条都保留，**没有替 PM 裁决主出口**。
- 「打开发布管理」从评审页直达账户面板的「发布管理」（`cloud-panel` 新增可选 `publicationRequest`）；未登录时给「去登录」并说明先保存云项目，未绑定云项目时指向「我的项目」；面板打开不生成链接、不发送。
- 右栏评审态主钮从假的「生成评审链接」改为始终可用的「准备客户评审」，未登录也能打开评审页；执行态标题与说明补「本机内部资料」，导出仍在原处，不宣称云端执行协作。
- 评审说明/待确认两栏新增本机规则参考（`lib/review-copy.ts`）：按活动类型、人数、实测面积、物料件数、必需项、风格/配色/氛围拼「方案简述参考」与「待确认参考」；只填空字段，已有手写内容不覆盖并显示「需要时先清空对应栏再生成」；填入后是普通可编辑文本，改了要重新生成评审包。文案不含消防/疏散/合规结论，也不写「已发送 / 已通知客户」。
- 客户页 `/view/` 加回归断言：无表单控件、无 Agent 输入、无素材库/租约/编辑权/内部备注、无编辑/保存/撤销/发布/登录按钮；撤销后刷新 `SHARE_NOT_FOUND` 移除快照并提示。发布面板补一句「发布后由你复制链接发送；系统不会自动通知客户。」
- 真机（`127.0.0.1:3026/editor`，未登录，场景 46 件 / 96 ㎡）：评审页两条出口可见 → 生成说明/待确认参考 → 手改加入「已核对入口。」→ 生成评审包（iframe `srcdoc` 21,458 字符，含手改内容，无表单控件与内部资料）→ 点下载提示「已发起下载，请确认文件已保存」→ 切执行页看到「执行 · 本机内部资料」→ 导出完整交接 HTML（逐件物料工作单 46 行、场景实例 46 行，均与画布一致）→ 切回布置仍 46 件 / 96 ㎡。点击「打开发布管理」实际打开「发布管理」，未登录显示先登录说明。
- 测试：7 files / 339 tests passed；`npx tsc --noEmit` 干净；eslint 本卡文件 0 error（25 条既有 warning）。
- 涉及：`lib/review-copy.ts` + `.test.ts`（新增）、`lib/project-review-workflow.ts`、`panels/project-review-panel.tsx` + `.css` + `.react.test.tsx`、`panels/agent-panel.tsx` + `.react.test.tsx`、`panels/cloud-panel.tsx` + `.react.test.tsx`、`panels/creative-studio.tsx` + `.react.test.tsx`、`room-organizer.tsx`、`panels/scene-delivery-panel.tsx`、`components/business/publication-panel.tsx` + `.react.test.tsx`、`app/view/page.react.test.tsx`、`docs/T-04-SELF-CHECK.md`。
- 待核（未扩 scope）：① 主出口策略 `C.publish-dual-exit` 仍待 PM，本卡不选边；② 登录后的云项目发布/撤销真机路径未跑（本轮无账号/云项目）；③ `/view/` 真机未打开（无分享 token），只读与撤销拒绝为单测覆盖；④ 评审 HTML 下载的落盘位置未在 in-app Browser 找到，文件是否真正保存待人工确认；⑤ 切换阶段时选中与撤销栈为空态，未制造变化再切；⑥ 电子签/收付款/开票/意见回流/双账号执行协同全部 out；T-03 仍在等验收，14 键与座位数算法挂下一轮。

## 客户需求不再给空提纲：✦ 直接生成一段可改的参考 — 2026-10-26

- 左栏「客户需求」右上角的 ✦ 从「插入空白提纲」改成**按当前活动类型、人数、必需项、场地条件与风格/配色/氛围拼一段填好的参考文字**：默认是目标 / 观众 / 布置三句，按活动类型分（快闪、派对、工作坊、黑客松、市集、婚礼各一套，其他活动回退到通用版）；不是客户原话，提示文案明说「已按当前活动类型和人数生成参考（本机规则），可直接改」。
- 保留原文与旧数据：已有手写需求时只把参考接在后面，重按 ✦ 会**刷新上一段参考**而不是越叠越长；旧版空白骨架（`活动目标：` 等空行，含标题已被迁移删掉的版本）在读取和生成时都会被清掉，不再出现「标题没了、再点一次又多一条」的重复模板。超长时原文字不动、报错说明。
- 空骨架不再挡住生成按钮：迁移后字段为空就禁用「生成布置预览」并提示点 ✦；生成出参考后按钮自动可用。
- 纯函数放在 `lib/creative-brief.ts`（`buildBriefReference` / `composeBriefReference` / `isBlankBriefScaffold`），删除 `appendCreativeBriefTemplate` / `MANUAL_BRIEF_TEMPLATE`；`migrateBriefDescription` 复用同一套清理。
- 验证：`creative-brief` 15 条 + `creative-studio` 面板 208 条全绿；`npx tsc --noEmit` 干净；eslint 改动文件 0 error。无头 Chrome 实测（独立 profile、未碰现场数据）：空字段点 ✦ → 填入 116 字参考，生成按钮由禁用转可用，控制台 0 报错；截图在 `%TEMP%\scendance-brief-shots`。
- 涉及：`lib/creative-brief.ts` + `.test.ts`、`panels/creative-studio.tsx`、`panels/creative-studio.react.test.tsx`。

## 漫游小人不再换成灰机器人：走路的一直是彩色小人 — 2026-10-26

- `useNpcs` 删掉 rigged `people.glb` 分支、`riggedModelReady` 参数与动作交叉淡化，NPC 一律用 `buildHumanFigure` 的程序化彩色小人；`room-organizer.tsx` 只按「布局里有没有放置的人」决定是否加载 GLB，`usePeopleModel` 不再因「人群」开关被打开而下载。
- 放置的人仍会在模型加载后换成 rigged 模型；漫游小人是环境示意，不再参与这次升级。`people-model.ts` 里仅漫游使用的 `WALK_CLIP_SPEED` 一并删除。
- 验证：`tsc` 干净，people-model / workbench-agent / layout-review 共 42 条全绿；无头 Chrome 实测「人群 + 漫游」开启后 `people.glb` 请求数为 0、控制台 0 报错，彩色小人正常走动。
- 涉及：`hooks/use-npcs.ts`、`room-organizer.tsx`、`hooks/use-people-model.ts`、`three/people-model.ts`、`assets/README.md`。

## 快速优化：一句话体检，一条改法只出预览 — 2026-10-26（T-03 ③）

- 在已确认的画布布置上，说「看看哪里有问题」「体检」「改一版」「太挤了」即触发一次几何体检：`lib/layout-review.ts` 新增纯函数 `reviewLayout`，只报重叠（按连通组）、压墙/压柱、出界、入口/楼梯留空、桌间过道（< 0.9 m）和座椅拉椅空间（< 0.45 m）；**不写消防/疏散/无障碍结论**。没有入口/门数据时明说「入口通道我不猜」，不虚构。
- 每条问题最多一颗「按这条改：…」：`proposeReviewFix` 只移动可动物料，锁定件 / 结构标记 / 挂墙件 / 户外件一律不动；找不到稳妥落点就返回 `moved=0` 并说明是 `locked` 还是 `no-spot`，不给假按钮。拉椅空间按「桌+临界椅」整组平移并复查组内不再临界；桌间过道改完用实际 OBB 间距复核。
- 点改法复用 T-02 的预览管线：蓝框 = 新位置，琥珀线框 = 原位；右栏到 **3/4 优化**，卡片写「改法预览 / 只挪位置，其他没动 · 挪了 N 件」，主钮仍是「确认布置」，次要「撤回」。**点改法、撤回都不写 `localStorage` / 场景 / 撤销栈**；确认才一次 `applyLayout`，撤销一步整体退回。
- 过期保护：点改法时按当前帧重新体检，问题已不成立就回「画布刚变过，这条现在不成立了」，不套用旧候选。已有未确认预览时拒绝第二次体检，先请人确认或撤回。
- `lib/workbench-agent.ts` 新增 `isReviewCommand`；`PlanProposal` 只加 `moved?` / `kind?: 'review'` / `skipped?` 三个可选字段，不动生成算法。
- 真机（`127.0.0.1:3026/editor`，体育馆样例 22 件）：体检报 6 把椅子背后 0.35 m → 点改法预览 20 件、`localStorage` 119591 字节 / 哈希 2084829914 不变 → 撤回后撤销仍禁用、哈希不变 → 再改并确认，哈希变 2993763508 / 119309 字节、撤销可用 → 撤销一步回到 2084829914 / 119591 字节、撤销再禁用。截图本轮可用：画布显示「AI 修改预览 · 尚未加入场景 · 半透明为候选，线框为原位置」。
- 测试：`layout-review` 15 条 + `workbench-agent` 22 条 + 面板 4 条 = 41 条全绿；`npx tsc --noEmit` 干净；eslint 本卡文件 0 error（9 条既有 warning）。
- 涉及：`lib/layout-review.ts` + `.test.ts`（新增）、`lib/workbench-agent.ts` + `.test.ts`、`lib/agent-proposal.ts`、`panels/agent-panel.tsx`、`panels/agent-panel.react.test.tsx`（新增）、`docs/T-03-SELF-CHECK.md`。
- 待核（未扩 scope）：① 画布工具栏「撤销」退回后，右栏仍停在 `planReady` 的旧回显（T-02 既有同步缺口）；② 样例场无入口，入口留空分支只有单测；③ 锁件只有单测/面板测，真机未造锁件；④ 内墙边的起身空间这版不量，报告会注明；⑤ 14 键口径与座位数算法仍挂下一轮，T-04 未动，氛围未点名不开。

## 左栏那几件事都能说一句就办：改人数/类型、加物料、出清单、写文案 — 2026-10-26（T-02 ④ 第4节）

- 右栏对话成唯一生成入口后，左栏还在的业务不再要求人开第二套表单：`send()` 按「命令 → 意图」路由，新增 `parseMaterialRequest`（中文数字、量词吞数、50 件上限）、`isMaterialListCommand`、`isCopyDraftCommand`、`isZoneCommand` 四条纯函数。
- **改人数 / 活动类型**：`parseBriefSentence` 认出来以后 `noteBrief()` 先写 ref 再 setState —— 不这么写，`runLocal()` 读的是上一帧，人数会丢；随后 `syncStudioBrief()` 回写左栏表单，左栏 select 对聊天里的新词（如「婚礼」）出现同名自定义项。左栏人数表单只收 1–40，超过时右栏明说「80 人这个数先留在右栏，左边没改」，不假装两边一致。
- **加物料**：「加两把椅子」「再加一张桌子」→ 本地候选 + 画布预览，仍然「确认布置」才落盘。已经有一版本地候选时接在它上面继续加，不逼人先确认；云端那一版还没确认时先说清，不去叠。`proposeAddition()` 用 1 m 网格找空位、跳过锁件与结构标记，一次请求只长一帧（加 10 把椅子不该播 10 帧），点完到出话实测 ~1.0 s（997 ms）。
- **出物料清单**：按画布 `floorRows()` 汇总「名字 ×数量」，带锁定件备注、未确认预览备注和「复制清单」动作；不从表单重建，也不新开页。
- **写段文案**：用已收集的活动名/人数/场地/物料起一份草稿，只在对话里，带「复制草稿」；明写「没写进活动资料」。
- **米数口径跟着复盘卡**：清单和文案都只在场地说过尺度、或壳体已经立起来时才报 ㎡；否则写「场地尺寸还没定」，不拿画布那块空地当场地真相（这一条是本轮实测抓到的：初版清单把 12×9 画布报成了 108 ㎡）。
- **换区做不到**：画布没有分区层，也没有可点的换区入口；如实回一句并指向「换一版 / 画布上直接拖」，记进暂留清单，不硬删业务。
- 顺手修：① 确认布置后的播报改报最终物料总数（原来只报新增的 2 件，实际落盘 25 件）；② 清单里默认桌椅的英文名 `Dining Chair` / `Dining Table` 只在显示层映射成「椅子 / 桌子」；③ 加物料不再把基线帧也播一遍（`shownSteps` 从 1 起）。
- 真机实测（in-app Browser 1129×772，`/editor` 未登录，未接真 API）：加 1 把椅子 997 ms 出「按你说的加了椅子…」；「出物料清单」→「物料清单 · 29 件」+ 9 行 + 复制清单；「写段文案」→「【品牌快闪】/ 室内，场地尺寸还没定，24 人。…」+ 复制草稿。全过程 `localStorage['scendance-editor-local-v1']` 停在 8705 字节，撤回后不变。复制按钮本机无法验证：面板 `visibilityState=hidden`，`navigator.clipboard` 与 `execCommand('copy')` 都被拒；已加 textarea + execCommand 降级，需要你打开面板点一次。
- 测试：`workbench-agent` 21 条、`agent-proposal` 15 条全绿（含一次请求一帧、50 件上限、中文数字、量词默认 1 件、移动不是加、清单/文案/换区四条意图）；`npx tsc --noEmit` 干净；eslint 改动文件 0 error（余下全是既有 import/order 与 hook warning）。
- 涉及：`panels/agent-panel.tsx`、`panels/agent-panel.css`、`lib/workbench-agent.ts` + `.test.ts`、`lib/agent-proposal.ts` + `.test.ts`、`panels/creative-studio.tsx`、`lib/creative-brief.ts`、`docs/T-02-SELF-CHECK.md`。
- 暂留（按钮都还在，没删业务）：图纸 / 现场照片导入、执行资料（CSV / 点验 / 备份）、方案评审与评审链接、场景模板、物料工具建模与材质、合同约定、导出效果图、2D/3D / 视角 / 网格吸附 / 显示尺寸 / 全屏 / 缩放。
- 待核（未动）：① 聊天能设 80 人、左栏表单只收 1–40，两个口径并存；② 复制动作只有降级路径，隐藏面板里验不了；③ 预设场景刷新后右栏仍回到 1/4「3D 场地」（既有，与本节无关）；④ 基线里的 `Dining Table` 被 `backend-adapter` 判「不在活动目录中」，导致主布局显示「本地草稿」存不上（既有，先记着）；⑤ `House Plant` / `Flowerpot` 仍是物料库原名，未改。

## 拖平面图就能推进布置；次要工具条能藏则藏 — 2026-10-26（T-02 ④ 第2节）

- 拖图不再停在「底图铺好了，然后呢」：`acceptFile()` 收下图片后分两条。已经说过长宽的，铺好底图直接按那组米数出一版预览；没说过长宽的，只给**一颗当场能点的气泡动作「按图纸估一版」**（`Bubble.action` + `.ap-bubble-action` 胶囊），点一下估完尺寸立刻出预览，不用再补一句「出方案」。这颗动作只出现在「拖了图纸、还差一步」这一条气泡上，不是第二套生成入口 —— 话锋一变、气泡过期就没有了。拖拽监听仍只有 `agent-panel.tsx:308` 一处 window `drop`，一次拖放 = 一个文件气泡 = 一颗动作；上一轮看到的「两次估尺寸、两版并发」是探针把历史遗留的两颗动作都点了，不是产品重复监听。
- 左轨第二组工具默认收起：三颗阶段图标（空间布置 / 项目评审 / 方案执行）原位不动，选中物料也在，紧跟一颗 **「工具」** 开关（`aria-expanded` / `aria-controls="sc-rail-tool-group"`，默认收起），点开才是活动需求 / 图纸尺寸 / 执行资料 / 方案评审 / 场景模板 / 物料工具 / 合同约定 七颗，按钮名字随状态切成「收起工具」。`globals.css` 加一条 `.sc-rail-tool-group` 的纵向布局，展开后第 7 颗底边 507 < 716，左轨不出现滚动条。
- 中间的氛围条默认收成一颗 **「氛围」** 胶囊：漫游 / 人群 / 天气 / 时段 四项藏进 `#sc-atmosphere-group`，`aria-expanded` 同步；只要漫游开着、人群开着、天气不是晴、时段不是正午，就自动展开 —— 人得找得到关掉它的地方。视觉上 `is-open` 时胶囊换成浅绿底 + 深绿字，跟工具列的展开态一个语言。右侧冻结的 14 键工具列、物料库把手都没动。
- **一个真 bug，顺手修了**：新加的「拖图 → 按图纸估一版」第一次必定被自己判成「画布在这期间被改过了，这版预览先作废」，提案卡根本不出现。根因不是拖放，是 `agent-panel.tsx` 里那条从「尺寸表单」时代留下的副作用 —— 长宽 state 一变就把 `layout.width/height` 再 apply 一次；表单砍掉后它没有输入可服务，却仍会在出方案途中改一次画布，`proposalBase` 和 `live` 的对象身份对不上，预览刚立起来就作废。把那条副作用整段删掉。删完露出它的另一半职责：预设 / 云端场景 `raiseVenue()` 返回 `null`，不重搭壳体，桌椅按新尺度摆、边界却还是旧的，21 件里 20 件被判出界。于是把「按本次尺度对齐规划边界」收进 `runLocal()`：`venue` 为空且长宽不一致时，先 `applyLayout({...current, width, height})` 并等一帧，再读 `live.current` 算候选 —— 基线因此包含这次对齐，既不再作废，也不再丢件。和 T-01 立壳体一样，这属于「场地真相先落、物料确认前不落」。
- 撤回文案跟着改口：从「画布还是你确认前的样子」改成「**撤了，物料没动**」。拖进来的底图和这次估出来的场地长宽是用户自己的导入 / 估算（T-01 的场地本来就不随撤回拆掉），原文案把「物料没动」说成了「整张画布没动」，不准确。
- 真机实测（in-app Browser 1129×772，`/editor` 本地路径，未接真 API；探针前先备份三个 `scendance-editor-local-v1*` key）：合成 1600×1000 PNG 拖到 window → 1 个 `ap-user is-file` 气泡、1 颗「按图纸估一版」；点它 → 1 条估尺寸播报、1 版预览，卡「5290 ㎡ · 新摆 21 件 · 要撤 29 件旧的」，**零「先作废」**；点「撤回」→ 物料仍 29 件、预览收回。另一条主路径：输入框发「80 人发布会，室内 12×9」→ 卡「108 ㎡ · 新摆 16 件 · 要撤 29 件旧的」，同样零作废。最终状态复查：左轨 5 颗按钮、`#sc-rail-tool-group` 不存在、工具 `aria-expanded=false`；氛围胶囊 77×28、`aria-expanded=false`；右栏 305×716、左抽屉 380。探针结束把三个 key 按备份写回（逐字节相同，`scendance-editor-local-v1` 8706 字节），删掉 `__probe_backup`，刷新后聊天回到开场白。截图仍拿不到：面板 `visibilityState=hidden`，`take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，这轮只做了 DOM 结构 + 几何复查。
- 测试：`scendance-workspace.react.test.tsx` 首条改成「默认收起 → 点「氛围」才展开」，另加 1 条「真开了下雨就保持展开」，原来的漫游 / 人群 / 天气 / 时段用例前面补一次「氛围」点击；13 条全绿。`agent-proposal` 11 条、`venue-shell` 9 条全绿（合计 33）。`npx tsc --noEmit` 干净；`npx eslint` 改了的三份文件 0 error（`<img>` 与 import 顺序是既有 warning）。
- 涉及：`panels/agent-panel.tsx`、`panels/agent-panel.css`、`panels/scendance-workspace.tsx`、`panels/workbench-shelf.css`、`panels/scendance-workspace.react.test.tsx`、`room-organizer.tsx`、`app/globals.css`。
- 待核（未动）：① 「中间次要工具条」这次按两处理解都做了 —— 画布底部的氛围条，和左轨第二组的七颗业务工具；冻结的 14 键列、三颗阶段图标一个没动，若你指的是别处请点名；② 回显卡的「尺寸还没定」与提案卡 5320 ㎡ 同屏两个真相（§1 遗留，属读数口径决定）；③ 预设 / 云端场景现在会在预览前把 `layout.width/height` 对齐到这次尺度（与旧表单副作用同一效果），撤回后场地停在新尺度 —— 是否算「场地真相」的一种，需要你拍板；④ 拖入的底图与估出的长宽在撤回后保留，属用户自己的导入 / 估算，未回滚；⑤ 生成多了一次「等一帧再算」的等待，实测约 5–6 秒才出预览卡，若嫌慢可把五帧步进的 `STEP_DELAY_MS` 调短；⑥ 这次没有像素级复核（浏览器面板隐藏），只有结构与几何数据。

## 生成入口只剩对话：右栏尺寸表单与大绿钮砍掉 — 2026-10-26（T-02 ③ 砍双入口）

- 截图钉（2026-10-26 夜）指的就是这一处：左栏活动简报有 01/02 加「生成布置方案」绿钮，右栏 Agent 又摆了一套场地尺寸加「让晴光出方案」——**同一个动作两个入口，还分属两套语义**（右栏那套走本地候选，左栏那套走工作室），用户点哪个都在赌。这一条把右栏那个入口拆了，主入口只留右栏对话。
- `panels/agent-panel.tsx` 删掉的控件：长 / 宽两个 `ap-dim` 输入框（连带 `sanitizeDimInput` 的实时清洗、`checkDim` 的红框与「最大 500 m，是不是填成了厘米？」那条 inline error）、「让晴光出方案」那颗 `.btn-primary` 大绿钮（`id="step-cta"` 从此只属于提案卡的「确认布置」）、「按图纸填长宽」和「按图纸比例估」两条文字链、「改一下设置再出」、「生成中/待确认」期间的 `#cta-hint.is-ok` 那一行。`DimInput` 和 `SummaryCard` 两个组件本体一并删，`.ap-dims / .ap-dim / .ap-times / .ap-dim-error` 六条 CSS 规则同批清掉（文案、图标、aria、样式一起走，不留孤儿）。
- **保留**的只有「室内 / 户外」两颗 radio —— 它既不是尺寸表单也不是生成入口，是场地真相的开关，砍掉就没地方改室内外了。它现在待在那张只读回显卡（`RecapCard`）的标题行里。
- 卡片退回成「对话已收集字段」的**只读回显**：`场地 · 室内/户外` + 一行米数（`室内 · 12 × 9 m`，带「折算 / 估的」后缀，没说过就写「尺寸还没定」）+ `发布会 · 80 人` + 一句提示「要改就说一句：「12×9」「80 人发布会」「按图纸估」」。原来的 `lengthText/widthText` 两份 state、`touchTimer`/`scheduleTouch`、`setLengthText`/`setWidthText`/`editSettings()` 全删，回显只由一个 `recap` 计算出来，一页不再有两个真相。
- 生成改成**说话触发**。`lib/workbench-agent.ts` 新增三条纯函数：`isGenerateCommand`（「出方案 / 就按这个出 / 先摆」= `first`，「换一版 / 换个方案 / 重新摆」= `again`；「80 人发布会，室内 12×9」这种纯描述句返回 `null`，它不是命令词）、`isEstimateCommand`（「按图纸估 / 按图纸比例估一下」，把原来的图纸链搬进对话）、`hasBriefSignals`（句子里有没有活动/人数/室内外/面积/长宽/时间任一要素）。生成条件是「命令词或任一要素」，两者都不沾就不空跑一趟，只回一句「这场大概多少人、室内还是户外？」。`canGenerate` 与 `sanitizeDimInput` 随之删掉——它们只服务那颗绿钮和那两个输入框。
- 一句话生成最容易踩的坑是**读到旧米数**：`setBrief` 之后马上读 state 还是上一帧的值。所以尺寸不再从 state 里捞，改成从那句话现算 —— `scaleFrom(extraction)`（说过长宽用长宽，只给面积就折算，都没有才回落到画布现状），再一路透传进 `runGeneration → startGeneration → runLocal/cloudRun`。云端那一趟的面积读数也改取 `scale.length × scale.width`，不再取未更新的 `layout`。
- 有底图时**不报假米数**这条硬钉跟着搬进对话：图纸只当参照，说过长宽或面积才生成，否则先回一句「还没拖图纸 / 它只当参照，说一句「12×9」或「300 平米」」。`estimateFromPlan()` 同理，没有底图直接说「我按不出比例」，不硬猜。
- 超出「砍控件」的一步，明确报备：`send()` 里云端那趟现在带 `{ requirePreview: true }`。入口只剩下对话以后，聊天就是唯一的生成触发点，若云端仍走 `directApply` 自动落盘，等于把「确认前不写进画布」从唯一入口上漏掉。`directApply` 默认值本身没动（仍待核）。失败卡的绿「重试」降级成文字链（走 `retry()`，只重跑上一句，不另算一套入口），「改一句再说」把焦点送回输入框；画布上那颗 `#empty-state` 浮窗 pill 改为聚焦 `#ap-input`，文案「说一句需求就能出方案 →」。
- 左栏「生成布置方案」不再当主路径：类名加 `is-manual`，从实心绿主钮降成描边次要按钮（`creative-studio.css` 新增四条规则，`.cr-brief-footer .cr-generate.is-manual` 排在绿色规则之后才压得住），底下提示改成「想快就在右栏跟晴光说一句；这里是逐项细填后再生成，照片需单独确认。」。**按钮文案一个字没改**，`creative-studio.react.test.tsx:1168` 那两条按名字断言的用例照旧绿；`.cr-generate` 还被 `reconstruction-panel.tsx:547/571` 复用，那边不受影响（新样式只挂在 `.is-manual` 上）。
- 真机实测（in-app Browser 视口 1129×772，`/editor` 本地路径，未接真 API）：右栏 `.ap-dims` 命中 0、空态 `.btn-primary` 命中 0；左栏那颗钮类名 `cr-generate is-manual`；输入框打「80 人发布会，室内」→ 走 `#gen-progress` 五帧 → 提案卡「5320 ㎡ · 新摆 21 件 · 要撤 29 件旧的」，唯一绿钮 `#step-cta`「确认布置」（卡高 151）；点「撤回」→ `.btn-primary` 归零、回显卡重新出现「室内 · 尺寸还没定 / 发布会 · 80 人」，`scendance-editor-local-v1` / `-versions` / `-versions-meta` 三个 key 与测试前**逐字节相同**（探针备份 `__probe_backup` 校验后已删）。
- 一个差点把我骗过去的坑：in-app Browser 里那份 `layout.css?v=…` 是**旧 chunk**，`document.styleSheets` 只剩 1 个 sheet、`.cr-generate` / `.ap-card` 规则全部查不到，于是新加的 `.is-manual` computed 出来是透明底 + 无边框，看着像"优先级没打赢"。硬刷新后 sheet 数变 3、`.cr-generate.is-manual` 命中、computed 才是对的下发（白底 `#767a70` 描边 500，254×38）。**改 CSS 后验收前先 `navigate_page reload`，别拿旧 chunk 的 computed 当结论。** 截图仍拿不到：面板 `visibilityState=hidden`，`take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，这轮只做了 DOM 结构 + computed 复查（逐节点 `scrollWidth <= clientWidth`，没有文字被裁）。
- 测试：`lib/workbench-agent.test.ts` 去掉 `canGenerate`/`sanitizeDimInput` 用例，新增 2 条（对话是唯一生成入口 / 句子没要素就先问一句），17 条全绿。`npx tsc --noEmit` 干净；定向 `vitest run`：workbench-agent + creative-studio.react = 224 条全绿，agent-proposal + venue-shell + room-dimension-input + reference-image-controls = 32 条全绿。
- 涉及：`panels/agent-panel.tsx`、`panels/agent-panel.css`、`lib/workbench-agent.ts`、`lib/workbench-agent.test.ts`、`panels/creative-studio.tsx`、`panels/creative-studio.css`。
- 待核（未动）：① `docs/T-02-PROMPT-FOR-ZCODE.md` §4.2-2 与 `AI-NATIVE-FOR-EXECUTORS.md` §2 仍写「一屏一张预填卡 + 一个绿主按钮」，与更晚的截图钉冲突，本卡只读文档没改；② `directApply` 默认 `true` vs 蓝图「默认仍预览」；③ 工作室与 `reconstruction-panel.tsx:571` 还各留一颗「确认应用」，那是那两个面板自己的入口，摘掉等于改它们的契约；④ 左栏「活动简报」仍不跟聊天同步（聊天说 80 人发布会，01 段还是默认类型 + 手填人数）；⑤ `MAX_ROOM_DIMENSION` 100 vs 卡片 1–500 m；⑥ 墙色 `#e8dcc4` 对比度；⑦ 回显卡的米数读数沿用 T-02 ② 那条「说过用说的 → 场地立过用场地的 → 都没有才说『尺寸还没定』」，于是在**有地面但没砌墙**的老场景上会出现同一屏两个真相：提案卡写 5320 ㎡、回显写「尺寸还没定」。要不要让回显也读画布现状并加「画布现状」后缀，是个口径决定，没静默改。

## 云端真 AI 的那一版，也要在晴光栏点「确认布置」才算数 — 2026-10-26（T-02 ② AI native 收口）

- 上一轮把本地候选的「建议 → 预览 → 确认」钉死了，但**登录并连上云项目以后，右栏那颗绿钮就失去了权力**：`generate()` 的云端分支 `await` 完直接 `setPhase('ready')`，卡片写「这一版布置」——它把一份还没人点头的 AI 提案说成了成品；真正落盘与否全在 `creative-studio` 里 `directApply` 那条自动 `applyCandidate` 的路上。这一条补上云端这一路。
- `panels/creative-studio.tsx`：`generate(message, options)` 多一个**按调用点生效**的 `requirePreview`，晴光栏触发的那一趟强制 `executionMode:'preview'`，不自动 apply。不动 `directApply` 的默认值 —— 创意工作室自己聊天里的「明确指令直接应用」是被两条测试钉住的行为（`creative-studio.react.test.tsx:2705`、`:2736`），改默认值等于跨卡改语义；蓝图 §3.3-5 写的是「默认仍预览」，与本仓现状冲突，**标待核、不静默修好**。`useStudioAgent()` 同步把 `preview / stale / expired / applyPreview / discardPreview / cancelRun` 放出来（只放宽类型，不加逻辑）。
- `lib/workbench-agent.ts` 新增纯函数 `pendingPlanOf(differences, warnings, nameOf)`：把「这一版动了什么」从提案差异与服务端警告里算成一套读数（新摆 / 挪动 / 要撤 / 动了几个锁定件 / 重叠名），`OVERLAP` 与 `OUT_OF_BOUNDS` 之外的警告（如 `LOW_CONFIDENCE`）不计进重叠，同一件在两条警告里也只数一次。本地候选与云端提案从此共用同一个读数。
- `panels/agent-panel.tsx`：卡片不再认 `PlanProposal`，改认 `ProposalView`（`viewOfLocalPlan` 折算本地、`cloudViewOf` 折算云端），于是**同一张卡、同一颗绿钮**管两路。云端确认按住的条件在这里算实：过期、基线/需求/编辑权变了（`stale`）、动了锁着的物料。按钮路由按 `lastSource` 分流：撤回 → 云端 `discardPreview()`（预览真收回才叫撤回）、停一下 → 云端 `cancelRun()`、换一版 → 云端重跑并带上「换一版不同的布局」。聊天里云端顺手回的提案也会被 `adoptCloudProposal` 接回这张卡，不再有「画布挂着绿框、右栏却没有确认入口」的空档。
- `confirmCloud()` 只按下开关，播报交给一个等 `preview / busy` 变化的 effect：`applyPreview()` 成功会清空预览、失败留预览加一句原因，而这两件事发生在它自己那一帧渲染里，await 的下一行读到的还是旧快照 —— 靠读 `studioRef.current` 猜成功，就会又犯「报假已保存」那个错。空手回来的云端跑法现在进 `generateFailed`（「这次没出成，场地和设置都还在」），不再进 `ready`。
- 顺手修一个当面装傻的口子：提案挂在那儿时打「停一下」，原来被 `parseBriefSentence` 当成需求回一句「记下了：场地尺寸还没定」，还把预览清了。`send()` 先认命令 —— 正在摆走 `stop()`，摆好没确认走 `withdrawProposal()`。
- 真机实测（1440×900，`/editor` 本地路径，控制台真实事件 + `localStorage` 回读）：点「让晴光出方案」→ `planProposed`，卡「5320 ㎡ · 新摆 21 件 · 要撤 27 件旧的」，一屏只有一颗 `.btn-primary`；输入框打「停一下」→ `撤了，画布还是你确认前的样子`、存档仍 27 件；点「确认布置」→ `planReady`、21 件物料，点「撤销」一步 → 回到 27 件；「停一下 / 接着摆」在五帧中途生效（停在第 2 步，接着摆续到第 5 步）；`?agentFail=1` → `generateFailed` + 头像 `-40-issue.png`。云端那一路只有契约与读数可测，**没登录、没真付费调用，需要人登录后实测一次**。
- 测试：`lib/workbench-agent.test.ts` 加 3 条 `pendingPlanOf`（云端读数 + 重叠去重、锁定件计数且 `LOW_CONFIDENCE` 不算重叠、空提案全 0）。`npx tsc --noEmit` 干净；`vitest run`（workbench-agent / agent-proposal / creative-studio.react / event-operations-panel）4 文件 268 条全绿，含那两条 `directApply` 默认行为。
- 涉及：`panels/agent-panel.tsx`、`panels/creative-studio.tsx`、`lib/workbench-agent.ts`、`lib/workbench-agent.test.ts`。
- 待核（未动）：① `directApply` 默认 `true` 与蓝图 §3.3-5「默认仍预览」相反，等你拍板；② 云端提案在创意工作室面板仍留第二颗「确认应用」（它是那个面板自己的入口，摘掉等于改它的契约）；③ 晴光栏聊天框直接发出的指令仍沿用工作室语义（明确指令可直接应用），要不要一并强制预览，与 ① 是同一个决定。

## 布置提案只在画布上预览，点「确认布置」才落盘 — 2026-10-26（T-02 ②）

- `lib/agent-proposal.ts` 从一颗 `proposePlan` 拆成两颗纯函数。原来它同时干两件事：砌 T-01 的场地壳、摆物料，五帧候选里壳和物料混在一起，「确认前不写场景」这条硬钉根本做不到 —— 壳一旦进候选，预览就得改画布。现在 `raiseVenue()` 只负责场地真相（墙、门洞、长宽、层高来源），`proposePlan()` 只负责 `objects`。
- `raiseVenue()` 立完壳先问几何闸：旧物料塞得进新壳就原样留着（`cleared: 0`），塞不进才清场，只留锁定件与结构标记；锁定件压在新墙体或边界上时**抛人话**（「锁着的 X、Y 压在新墙体或边界上，先解锁挪开它们」），不再让 reducer 静默把整批动作吞掉。已有 `scenePreset` / `backendSceneV2` 的场地直接返回 `null` —— 本卡不动场地真相。
- 右栏接线（`panels/agent-panel.tsx`）：候选一帧一帧走 `onPreview`，全程不 `dispatch`，所以自动存档、撤销栈、别人的选中态都看不见提案。主按钮文案 **「确认布置」**，次要走文字链 **「撤回」/「换一版」**，一屏只剩这一颗绿钮（发送键一并去绿）。确认才 `onApply` 一次进撤销栈；提案存在期间 `layout` 被人工改过 → `invalidateProposal` 自动作废。
- 「停一下 / 接着摆」在提案模型下重新说得通：停只收回预览（画布本来就没动），候选留在 ref 里记住播到第几帧，接着摆从那一帧续上。
- 撤回后原来会退回「1/4 · 3D 场地 · 尺寸还没定」，可画布上四面墙已经立着了 —— 这是假退步。新增 `venueUp`（画布带 `backendSceneV2` / `backendVenue` / 内墙）：场地立过就停在 **2/4 空间布置**，卡片米数改读「填过/说过用填的 → 场地已立用场地的 → 都没有才说还没定」，面积折算与图纸估算仍带「折算 / 估的」后缀。
- 首屏三宫格开场卡（`.ap-intro` / `.ap-badge` / `.ap-starts`）与布置步里的「看看下雨天」删掉：那是 T-03 的氛围码，而且和聊天引导句重复。对应 CSS 规则一并清掉。进度条改对话四步（3D 场地 / 空间布置 / 优化 / 交付），抬头状态点只许「做好了 / 发现问题」两种说法，晴光头像按 ask / done / issue 三态切 `qingguang-3d-40-*.png`，不用角标叠头像。
- 提案卡文案去重：`108 ㎡ · 16 件物料 · 新摆 16 件` 同一页报两遍件数，改成 `108 ㎡ · 新摆 16 件 · 要撤 5 件旧的`；`PlanProposal.materials` 随之删掉（画布和收尾卡都有件数）。第二次点按钮的用户气泡从「就按这个出方案」改成「按这个场地再出一版」。
- 真机实测（1440×900，CDP 真实鼠标 + `localStorage` 回读）：说「80人发布会 室内 12x9」→ 卡片 `12 × 9 m`、存档仍 `10x8 / 5 件物料`；点「让晴光出方案」→ 存档变 `12x9`、`6 件（1 门洞 + 5 旧物料）`，**候选的 16 件物料一件都没落盘**，抬头 `2/4 空间布置`，画布挂「AI 修改预览 · 尚未加入场景」，绿框新摆、红框要撤；点「撤回」→ 预览收回、存档一字未动；再点按钮 → 「按这个场地再出一版」出第二版；点「确认布置」→ 存档 `17 件（16 物料 + 1 门洞）`、抬头「● 做好了 3/4 优化」；`Ctrl+Z` 一步 → 退回 `6 件`。全程 console 无报错。
- 顺带纠正一次误判：截图里四面墙看着消失，实为 `#e8dcc4` 墙色压在 `#f9f9f9` 画布底上对比不足；把墙 mesh 强制染红重截，北/西两面完整立着，`applyWallDisplay` 的剖切（藏近墙、留远墙）也正常。数据侧 `backendSceneV2.structure.walls` 四条 `exterior/confirmed`、长 12/9/12/9、层高 4 m。**墙色对比度是视觉问题，本卡没动。**
- 测试：`lib/agent-proposal.test.ts` 按拆分后的 API 重写为 11 条（壳体四墙 + 门洞标记跟 `mainEntrance.openingId` 对齐、旧物料塞得进就留、塞不进才清、锁件压墙抛错、preset 场地返回 null、户外不砌墙、五帧单调增长、`removing`/`keptLocked` 不重计、换一版只换槽位、12×9 零重叠零丢件、`added + keptLocked` 等于候选物料数）。`npx tsc --noEmit` 干净；全量 `vitest run` 3577 条 6 失败，全在既有白名单（`page.test.tsx`、`backend-generation.test.ts` 的 STALE_PROPOSAL、`project-review`、`scene-presets`）；`share` 的 deflate 计时、`agent-preset-flow` 超时、`scene-delivery` 只在并行满载时红，单跑全绿。
- 涉及：`lib/agent-proposal.ts`、`lib/agent-proposal.test.ts`、`panels/agent-panel.tsx`、`panels/agent-panel.css`、`lib/workbench-agent.ts`（`AgentState` 加 `planProposed`）、`room-organizer.tsx`（把 `onPreview` / `onApply` 接进 provider）。
- 待核（未动）：卡片写人工 L×W 允许 1–500 m，`lib/schema.ts` 的 `MAX_ROOM_DIMENSION` 仍是 100；卡片那颗「按图纸填长宽」点开的是文件选择器，名字和动作不完全对得上。

## 换一版不再清空桌椅：壳体门洞是场地真相，不是物料 — 2026-10-25（T-01 ①）

- 「换一版」点下去，16 件物料只剩 2 件：桌子全没了。根因不在生成器，在 reducer —— `hooks/layout-reducer.ts:200` 对 `addItems` 这类结构动作做**整批**几何否决（`canApplyLayoutGeometry` → `canApplyStructuralChange`），一批里只要有一件越界或撞墙，整批静默丢弃。原来第 3 步把 1–4 组餐桌当一批提交，槽位又按 `depth/8 + 2.6` 这种拍出来的数算，`shift=0` 的那一版正好穿进前墙，于是四组一起消失。
- 槽位算法收进纯函数 `lib/furniture-sets.ts` 的 `setPlacementSlots(set, w, d, variant, { clearNorthOfZ })`：先按物料组自身的外扩半尺寸（旋转后的包围盒，不是半间房）算出可用带，四角槽位全部落在墙内；彼此footprint会重叠的槽位直接丢（窄房自然退化成 1 组）；`clearNorthOfZ` 让桌椅待在背景板南边。`variant` **只轮换顺序**，不改可行域 —— 换一版换的是用哪几个槽，不是能不能放。
- 摆放改成逐组 `addItems`：一组放不下只少一组，不再带走其它桌。
- 清场改成只清物料：`replaceItems(items.filter(isStructuralMarker))`。T-01 的壳体把主入口落成带 `structuralOpeningId` 的门洞标记，跟着清场一起删等于悄悄把主入口抹了。`lib/structural-layout.ts` 新增 `isStructuralMarker()`（门洞 / 柱 / 出入口标记），`materialCount()` 复用它。
- 左栏「当前场景：17 件物料」和 Agent 说的「16 件物料」对不上，也是同一件事：那颗门洞被当成物料数了。`panels/creative-studio.tsx` 改口 `materialCount(sceneItems)`。
- 播报口径跟着修：本地模式下人在聊天里说过的人数与活动名存进 provider 的 `brief`（`parseBriefSentence` 喂），收尾胶囊优先读它 —— 原来读的是 `studio.brief`，聊天说 60 人沙龙、胶囊写「品牌快闪 · 24 人」，属于当面撒谎。
- 真机实测（1440×900，CDP 真实鼠标 + 自动存档回读）：12×9 室内连点三次「换一版」，每次都是 `桌 3 / 椅 12 / 门洞标记 1`，桌心在 (±4.23, −2.87) 与 (±4.23, 3.08) 之间轮换，第 5 步仍报「没有重叠，也没超出场地」，左栏「当前场景：16 件物料」。壳体播报原文：「场地立起来了：12 × 9 m，室内壳子，四面外墙、正面留了一个主入口，门位标的是待确认，层高没听你说，先按默认 4 m。」未给尺度时依旧只说「尺寸还没定」，不报假米数。
- 测试：`lib/furniture-sets.test.ts` 加 6 条 `setPlacementSlots` 用例（12×9 / 8×6 / 5×4 三档 × variant 0–5 全部在墙内、槽位互不重叠、避开舞台、换一版只换顺序、3×3 不给槽位），`lib/venue-shell.test.ts` 加 1 条「清场后门洞标记仍在且不算物料」。`npx tsc --noEmit` 干净；`npx vitest run`（venue-shell / workbench-agent / backend-adapter / structure-v2 / venue-edit / furniture-sets / hooks）30 文件 517 用例全绿。
- 涉及：`lib/furniture-sets.ts`、`lib/furniture-sets.test.ts`、`lib/structural-layout.ts`、`lib/venue-shell.test.ts`、`panels/agent-panel.tsx`、`panels/creative-studio.tsx`。
- 待核（未动）：卡片写人工 L×W 允许 1–500 m，代码里 `lib/schema.ts` 的 `MAX_ROOM_DIMENSION` 是 100；左栏「活动简报」仍是固定的 7 个活动类型 + 手填人数，没跟聊天同步。

## 属性面板改成双击才弹 — 2026-10-23

- 从物料库把物料放到场地上，不再顺手掀开「物料属性」：四个放置入口（点物料卡、拖到画布、冲突后补点一次、生成模型库加入）一律只选中、不开面板。
- 单击画布里的物料也只选中。要看尺寸/颜色/朝向，**双击那一件**，或者点工具轨的「选中物料」。面板已经开着时，单击别的物料仍然实时切换内容。
- 双击由两个视图各自的拾取层上报「打到了哪一件」：3D 在 `dblclick` 上补一次射线，2D 补一次 `hitTest2DItems`。没有拿当前选中项代替 —— 试过，双击空地也会把上次选中那件的面板掀起来。另外 Chrome 的 `pointerdown.detail` 恒为 0（实测），点击计数只在 `dblclick` 上，所以只能挂 `dblclick`，不能在按下时猜。
- 收起左栏时工具轨那颗按钮的悬停说明改成「先在画布上双击一件物料」，把新手势带出来。
- 真机实测（1440×900，CDP 真实鼠标事件）：放置沙滩折叠椅 → 物料数 5→6、左栏保持收起；单击空间绿植 → 左栏仍收起；同点双击 → 左栏 `has-properties` 打开、属性面板可见；关掉后再双击打不到物料的位置 → 保持收起。
- 涉及：`three/drag-handlers.ts`、`hooks/use-canvas-2d-interaction.ts`、`room-organizer.tsx`、`panels/scendance-workspace.tsx`，以及 `three/drag-handlers.test.ts`、`hooks/use-canvas-2d-interaction.react.test.ts`（各加 2 条双击用例）、`panels/scendance-workspace.react.test.tsx`（放置断言改 `keepPanel`）。

## 左栏不再自己弹开 + Agent 关闭后的浮窗卡片 — 2026-10-23

- 左栏改成只由按钮开合。原来在画布点一件物料，刚关掉的左栏会自己掀起来：`creative-studio` 把「工作区是否展开」回报给左栏的那条 effect 依赖了父组件回调，而回调按 `leftMode` 建，点选物料把 `leftMode` 一切 → 回调换身份 → effect 重跑 → 把还留着的 `workspaceExpanded=true` 重新报一遍，左栏就开了。回报回调改走 ref，effect 只在展开状态真的变化时跑（`resizeWorkspace` 里本来就有直接调用，不会漏报）。
- 同一轮真机复查又抓到一颗接错的按钮：选中某件物料后点工具轨「活动需求」，左栏纹丝不动。原因是跟随选中项的那条 effect 也听 `leftMode`，刚切到活动资料就被按回「选中物料」。改成只在选中项真的变化时才跟着换内容，实测「选中物料 ⇄ 活动需求」来回切都生效。
- 工具轨新增常驻的「选中物料」一颗（未选中时禁用并说明「先在场地里点选一件物料」）：左栏收起时面板内那颗切换按钮是 `display:none`，点不到，没有这颗就等于关上门再没有把手。
- Agent 栏右上角那颗 × 关掉后，原来只剩一条 34px 通高竖排把手——看不出能点、也看不出 Agent 在做什么。换成画布右上角一张浮窗卡片：头像 + 「晴光 Agent · 状态」+「第 N/5 步 · 阶段名」，点一下恢复整栏。实测 1440×900 下卡片 168×44，命中测试落在卡片自身。
- 卡片位置按工具列那颗「撤销」的悬停纸条定：一开始右缘压在 1376，正好把往左探出的纸条切掉半截（放大截图才看得出来）。改成让开 `--sc-rail-width + 62px`、层级降到工具列之下，实测纸条完整可读。
- 画布上「Agent 已先填好，确认就出方案 →」那颗胶囊，在 Agent 栏关着时点下去只 `focus()` 一个不存在的 `#step-cta`，毫无反应；改成找不到就把浮窗卡片点开。
- 物料属性面板顶上的英文眉标 `OBJECT PROPERTIES` 删掉（下面就是「物料属性」，窄屏那条规则本来就把它藏了），随之清掉两条已无人用的 `.sc-eyebrow` 规则。
- 涉及：`panels/creative-studio.tsx`、`room-organizer.tsx`、`panels/agent-panel.tsx`、`panels/item-context-popover.tsx`、`app/globals.css`。

## Agent 栏右上角：是关掉，不是收起 — 2026-10-23

- 右栏 Agent 头部那颗按钮点下去整个面板消失、只剩右缘一条竖排「Agent」把手——这是关闭，但悬停写的是「收起 Agent」、图标还是 `》|`（收合符号）。改成「关闭 Agent」+ × 图标；把手仍写「打开 Agent」，关—开读起来对得上。
- 顺带把「关闭 / 收起」分工定下来：真正只折叠、面板还在原地的才叫收起 —— 聊天区内的「收起聊天 / 展开聊天」（带 `aria-expanded`）、物料库的「收起物料库 / 展开物料库」保持不动；`creative-studio` 头部那颗 × 与隐藏的助手入口按钮一并改成「关闭聊天 / 关闭助手」。
- 真机复查顺手抓到一处压住：氛围条（漫游/人群/晴朗/正午）底边 888，物料库把手顶边 866，1440×900 下把手被压掉左半截「物料库」三字。氛围条改 `bottom: 44px` 让出把手那一行，实测两档（1440×900、1280×700）各留 10px 间隙；抽屉展开时仍走原来的 `--sc-shelf-height` 抬升规则。
- 涉及：`panels/agent-panel.tsx`、`panels/creative-studio.tsx`、`room-organizer.tsx`、`panels/workbench-shelf.css`、`panels/creative-studio.react.test.tsx`。

## 中文界面里的英文残留 — 2026-10-23

- 多选胶囊整条改中文：`N items selected · drag to move together` → 「N 件 · 已选中 · 拖动即整体移动」，`Copy / Group / Ungroup / Save as set` → 复制 / 成组 / 解组 / 存为组合，悬停说明与「组合名称」输入框一并跟上（原来写的是 `Set name`、`My set`）。
- 提示文案改中文并去掉不存在的指引：分享链接复制成功/被拒、备份文件过大、存储已满、超上限只载入一部分、本机布置打不开 —— 原先指向的 `Manage → Saved Layouts → History` 在本产品里没有这个入口，改成只说「原件已另存一份，不会被覆盖」。
- 读屏与悬停标签改中文：`Dismiss`→关闭提示、`Link to copy`→待复制的链接、`View options`→视图选项、`Wall visibility`→墙体显示、`Apply paint to`→墙面刷漆范围、`Pick a custom colour`→自选颜色、`Delete the recovered copy`→删除恢复出来的副本；墙面朝向 `All/N/E/S/W` → 全部/北/东/南/西。
- 文件读取抛出的英文错误（`Invalid layout file`、`Invalid image dimensions`、`Canvas unavailable`、`Image encoding failed`、超体积提示）统一中文，同步 4 处测试断言。
- 涉及：`panels/viewport.tsx`、`panels/chip-controls.tsx`、`panels/status-toast.tsx`、`panels/view-options.tsx`、`panels/wall-paint-panel.tsx`、`panels/recovery-entry.tsx`、`room-organizer.tsx`、`hooks/use-import-export.ts`、`hooks/use-layout-persistence.ts`、`lib/persistence.ts`、`lib/file-io.ts`。

## 参考底图搬进「图纸尺寸」 — 2026-10-23

- 「参考底图」不再浮在画布右上角：改由 `referenceImagePanel` 插槽渲染到左栏「图纸与尺寸」→「图纸与场地对应核对」区块，紧挨「更多：图纸重建与场地核对」，跟同区折叠行同样式（11px 灰字 + 原生展开三角、内容左侧细线缩进）。
- 上一轮为让开工具列加的右上偏移随之删除（`globals.css` 里两条 `.sc-scene-viewport .sc-reference-image*` 规则与一条已失效的 `.sc-reference-image-trigger` 规则一并清掉）。实测画布右上角浮层数量归零。
- 删掉重复说明：旧场景的「旧图按场地宽深示意放置，不代表已标定或实测准确。」与上方 notice 同义，移除；面板内控件块高度 320px → 254px。
- 涉及：`panels/reference-image-controls.tsx`、`panels/reference-image-controls.css`、`panels/creative-studio.tsx`、`room-organizer.tsx`、`app/globals.css`。

## 真机复查：压住与裁切 — 2026-10-23

- 用无头 Chrome 在 1440×900、1280×700、1280×600 三档实测截图，专挑只有真机才看得出来的毛病。
- 画布右上角「参考底图」和 Agent 胶囊被工具列压掉半截：两者右移让开 46px 纸条，实测重叠归零。
- 工具列改为按内容收高（仍保证不越进抽屉），不再在按钮下面拖出一条约 180px 的空白纸条。
- 场景模板卡两处硬伤：轨道继承了旧库的 18px 下边距、白留一截；名称行 18px 装不下 22px 的字，模板名被裁掉半行。现在轨道铺满、名称行 20px，缩略图 69px → 85px。
- 「独立本地预览」标记从视口底部中央移到顶栏，不再盖住抽屉里的卡片和灯光选项。
- 涉及：`app/globals.css`、`panels/workbench-shelf.css`、`panels/agent-panel.css`、`components/workspace-shell.tsx`。

## 工作台尺寸与手感 — 2026-10-23

- 抽屉默认加高到 212px（最低可拖到 176px）：缩略图从约 37px 高变成 60px 上下，模板图约 86px，看得出是什么再点。
- 横向轨道不再画滚动条：改用两端渐隐提示还有内容（`data-overflow`），卡片文字不会被滚动条压住；悬停卡片取消上移，避免被轨道上边缘切掉。
- 右侧工具列收进画布：14 个等大圆盘 → 10 个 32px 方按钮 + 白纸底板，高度限制在画布内，不再一路压到抽屉上；悬停/聚焦即在左侧浮出名称。
- 氛围四项（漫游、人群、天气、时段）搬到画布左下角一条带文字的胶囊栏，天气与时段直接显示当前值；弹出菜单朝上开。
- 空白场地卡改成绿描边白底，不再灰扑扑；画布抬头收成一行轻标注；右侧 Agent 栏宽度改为 `clamp(284px,27vw,336px)`，把宽度还给 3D 画布。
- 涉及：`app/globals.css`、`hooks/use-horizontal-rail.ts`、`panels/workbench-shelf.css`、`panels/scendance-workspace.tsx`、`panels/creative-studio.css`、`panels/agent-panel.css`。

## 物料抽屉改横排 — 2026-10-23

- 抽屉保持一行高：物料卡与场景模板都横着走，滚轮/触控板直接变横向滚动，删掉卡片区域的纵向下拉。
- 键盘：轨道聚焦后 ← → 走一张卡，PageUp/PageDown 翻页，Home/End 到两端；拖到末尾出现「再显示 24 个」，不再单独占一行计数。
- 场景模板与「长方形/正方形/L 形」空白场地合进同一条轨道，缩略图在上、名称在下；替换已有布置时改成卡内确认，不再弹浏览器对话框。
- 删掉重复文字：模板描述只在悬停与读屏名里出现；「桌椅、展台和人物都可移动…概念方案」「空白场地形状，尺寸可再改」「共 528 个 · 已显示 24 个」等说明行移除。
- 抽屉顶边仍可拖动调高（本机记住高度），拖高只放大缩略图。
- 涉及：`hooks/use-horizontal-rail.ts`（新增）、`panels/online-model-library.tsx`、`panels/scene-presets-panel.tsx`、`panels/venue-shape-presets.tsx`、`panels/scendance-workspace.tsx`、`panels/workbench-shelf.css`、`app/globals.css`。

## 3D 效果图导出 — 2026-10-23

- 右侧工具条「导出效果图」弹出面板：视角（跟随当前 / 整体 / 俯视 / 人视）× 画质（标清 1× / 高清 2× / 超清 3×），一键下载 PNG。
- 高分辨率导出：渲染时按倍率提升 pixelRatio 并重绘，完成后恢复相机与渲染器原状，画布不闪动。
- 2D 平面模式回退为现有截图路径（按当前分辨率导出）。
- 涉及：`hooks/use-import-export.ts`（`exportRenderImage`）、`panels/scendance-workspace.tsx`（导出面板）、`room-organizer.tsx`、`panels/workbench-shelf.css`。

## 编辑器 IA Phase 1 — 2026-10-16

- 顶层模式：`布置 | 评审 | 执行`（左窄流程轨 + 画布优先浮层）；策划 brief 嵌在布置，无独立策划模式。
- 执行壳：交付面板 tabs 含导出 / 本机备份；评审模式浮层「发给客户」。
- 降级：合同、重建、场地照片、流程指南进「更多」或一次性教练；代码保留。
- 氛围：布置工具条「漫游｜人群｜天气｜时段」；保留 weather/NPC/walkthrough 引擎；与「现场灯光」文案分离。详见 [docs/EDITOR_IA_PHASE1.md](docs/EDITOR_IA_PHASE1.md)。

## Phase 1.5 — 氛围内联修正 — 2026-10-16

- 氛围从左浮层 `AtmospherePanel` 改为底栏胶囊内联：**漫游｜人群｜天气▾｜时段**（默认全关；人群旁注「约 3 人」）。
- 不再与素材架抢白板；引擎 hooks 未改。详见 [docs/EDITOR_IA_PHASE1.md](docs/EDITOR_IA_PHASE1.md)。

## 1.0.1 — 2026-10-10

活动场地与执行工作台合入main：紧凑单排素材、侧边工具和助手共享画布，按剩余比例完整取景；资料关闭与未发送草稿保留。任务候选、合同原件、执行时间表、项目成果及可信公共模型恢复沿用已核流程。保留main的自有Supabase、Tokendance网关、匿名登录、域名及标准资源打包配置，根与前端版本同步1.0.1。

具体功能和验证边界见[1.0.1发布说明](docs/RELEASE-1.0.1.md)。Pages自动部署前端；新后台任务接口和数据库、真实模型与现场效果分别验收。

## 1.0.0 — 2026-10-09

- **自有部署**：后端改为自有 Supabase 项目 `wkhfvnzgopjdzxlmycks`；前端由 Cloudflare Pages 通过 GitHub 集成自动构建发布，地址 `https://scendance-scene-planner-ewz.pages.dev`。DeepSeek 仍直连官方 `api.deepseek.com`（`deepseek-flash`），使用自有 API key。
- **文档整顿**：1.0 之前的发布与验收记录整体移入 [docs/archive/](docs/archive/)，活文档中的旧项目与旧域名引用一并更正。
- **版本号**：根目录与 `frontend/` 均从 `0.6.0` 升到 `1.0.0`。
- **清理旧原型**：删除根目录独立静态原型的 `index.html`、`app.js`、`style.css`、`models.html`、`model-preview.js`、`serve.py`、`preview-webgl-desktop.jpg`、`preview-webgl-mobile.jpg`、`VALIDATION.md` 及 `docs/mockups/`。`renderer-webgl.js` 因官网三维演示仍在使用而保留。
- **验证边界**：本次只改部署配置、发布脚本目标与文档；未改产品功能、数据库结构或 Edge Function 逻辑。

## 开发分支工作台检查点 — 2026-10-10

活动任务建议接入人工选择、摘要确认、稳定提案、保存读回及原执行表；合同原件可在资料分类管理。底部素材按需展开，Agent异常持久化停止继续执行，修改已有物件遵守选中范围。公共模型在可信编号和来源核对后恢复，保存失败及新几何继续编辑保持可核对。

本机演练、真实模型与正式云分别记录，包版本仍为0.6.0。详见[功能与验证边界](docs/DELIVERY-PROGRESS-2026-10-10-WORKBENCH.md)。

## 0.6.0 — 2026-10-03

图纸与照片重建的独立预览版本，开发分支为 `codex/floorplan-to-3d`，尚未合并至 main 或部署到原站。

- 新增 Scene v2：多边形场地、参数化墙体、门窗开口、柱子、来源证据及确认尺寸；保留 v1 读取并阻止静默降级保存。
- 支持最多 12 张图纸或照片、私有来源上传、尺寸清单和图上两点标定；照片提供还原现场和重新布置模式。
- 接入独立重建队列、识别与规划调用、待核对状态、候选预览和确认应用，包含预算、去重、编辑租约及版本检查。
- 前后端共用放置校验，覆盖移动、旋转、缩放、复制、批量操作及 AI 应用；无效拖放回到有效位置。
- 支持结构编辑、保存恢复及撤销重做；保留原版默认墙面、地板和材质参数。
- 提供独立持久化本地预览：`npm run dev:floorplan`。详细验证见 [验收记录](docs/archive/floorplan-verification.md)。
- **验证边界**：本地测试与构建通过；真实 DeepSeek／混元调用、识别精度及独立 Supabase 云环境仍待配置和验收。本版本不代表真实识别已验收。

## 0.5.0 — 2026-10-03

官网首屏与全站视觉重做，并把官网接入生产构建。

- **首屏**：背景换成场地渲染图（三层 `background`：左侧压暗遮罩 + 场地图 + 深绿兜底，
  图片缺失时自动回退到兜底层，不会变成白块）；移除首屏的三维画布窗口
  （画布自带浅灰底，压在深色场地图上会变成亮矩形），改为设计稿里的浮动信息卡；
  实时三维演示保留在下方「三维场景」段。
- **顶栏**：编号导航改为 5 项并与页面真实章节一一对应（含高亮跟踪，
  此前占 7 屏的「场景类别」不在导航里、也无法被高亮）；去掉模糊 / 光斑 / 投影，
  改实心深绿胶囊；品牌贴左、动作按钮贴右。
- **段落节奏**：所有段落高度改用屏高 `svh` 限定（短段有下限、长段有上限），
  大字号做「vw 管宽屏 + svh 管矮屏」双重封顶。
- **字号层级**：全站字号从实测 29 种收敛到 8 种（另加品牌字 1 种），
  集中在 `:root` 令牌 + 样式表末尾的单一覆盖层。
- **配色**：全站从深青改为暖绿，工作台、云项目面板、品牌标与 favicon 同步。
- **官网打包**：`scripts/package-pages.mjs` 输出到 `frontend/public/`，
  打包前清空 `showcase/`（此前递归拷贝不删文件，改名前的旧图会一直被打进产物）；
  构建脚本自动包含 `/introduction` 介绍页。
- 新增 `assets/scenes/`：首屏背景图与场景类别素材。

## 0.4.0 — 2026-10-02

- 根目录静态首页替换：旧的「体育馆 / 48 小时黑客松」展示页改为「幕景 Scendance」产品首页。首屏保留透视三维视口，下方新增俯视三维建模区；两个视口共用 `renderer-webgl.js` 与同一套分区数据，点击任一视口会同步选中。
- 旧首页留档为 `docs/mockups/legacy-venue-index.html`，不再从站点入口链接。（1.0.0 已随旧原型删除。）
- 首页「导出方案」的 Markdown 标题与下载文件名由「场域 · 体育馆黑客松」改为「幕景 Scendance」。
- 全仓品牌名「场域」改为「幕景」，含 `frontend/` 的实现文案与测试断言。
- 主色统一为深青 `#0e7c78`；首页与工作台双向导航（首页「进入场景」↔ 工作台品牌 logo 回官网）。
- 合并 `feat/model-library`：新增 `scene/` 模型场景模板与模型库工具。

## 0.1.0 — 2026-10-02

首次整理后的 Scendance 项目版本。

- 活动场地编辑工作台：三维 / 二维视图、八类活动物料、属性编辑、撤销 / 重做、本地保存及 JSON 导入导出。
- Supabase 后端与前端接口集成：项目、编辑租约、版本校验保存、私有资产授权；保留本地 HTTP 联调与回归测试。
- Foundation 视觉参考改版：统一工作台、云项目弹层、加载 / 恢复界面、体育馆展示和模型预览的配色、玻璃材质及动效。
- 响应式面板、键盘焦点、减少动态效果和无背景模糊回退；修复手机属性面板被抽屉遮挡的问题。
- 保留模型来源、上游许可、设计研究及验收截图。

### 目录

- `frontend/`：当前可编辑工作台。
- `supabase/`、`client/`、`scripts/`、`tests/`：后端、接口辅助与验证。
- 根目录 `index.html`、`models.html`：独立体育馆展示与模型预览。（1.0.0 已删除。）
- `docs/`：设计参考、接口、部署和验证记录。

### 验证与边界

本轮视觉改版已通过前端 TypeScript、生产构建（含 lint）、171 项相关测试及桌面 / 手机宽度浏览器检查，详见 [视觉验收](docs/FOUNDATION_DESIGN_REFERENCE.md)。既有联调证据见 [前后端联调](docs/INTEGRATION.md)。

此版本不代表生产部署或真实 Supabase 云端完整验收。真实账号交接、第三方生成与客户发布仍需按部署文档继续验收；本地测试与云端能力分别记录。
