# 工作台布局对标与规范目标方向（2026-11-21）

> 状态：**对标结论 + 候选目标方向，待评审拍板**。本仓设计尚未完全定下来，文中「锁定」与「开放决策」分开标注；规范文档（`docs/05-设计规范.md`）的措辞回改排在 D1–D5 评审之后，不先把现状代码当终稿。
> 触发：Flowith 第七/八轮草图把「AI 协作」画成最右常驻对话栏；规范残留 v2.4/v2.6 旧「右栏 Agent」措辞。已实测线上实盘 AI 对话在左栏堆栈，但左栏方案是不是终局、属性面板该不该挪右，都还没拍板。

## 1. 实盘现状（2026-11-21 晚，代码 + 两个线上域名实测）

工作台 `/editor` 桌面布局（`globals.css` L1909–1916 网格）：

| 区域 | 现状承载 | 代码指针 |
| --- | --- | --- |
| 左轨 56px | 导航入口：门厅 / Bingo / 空间 / 物料 / 创作 / 户外规划 / 消息 + 轨脚保存态、设置、账户 | `room-organizer.tsx` L5046、L5183 |
| 左栏堆栈 | 上下文卡：户外规划、Bingo 会话、拍摄场地、成员私聊、创作（生成）；两张同开可上下换序、拖分隔条改高度、可抓成独立小窗（上限两枚） | `lib/left-stack.ts` L17–L24、L89 |
| 中画布 | 地图规划面（边界/分区/动线/出入口/物件/标注），2D↔3D 同源 | — |
| 右轨 + 角区浮层 | 编辑器动作工具（撤销/重做/选择/测量/视图/漫游/网格/吸附/缩放/分享/导出/氛围）；地图角区惯例参照 Google/Mapbox/MapLibre | `docs/plans/tool-rail-unification-2026-11-13.md` §1.2 |

- AI 对话 `#agent-panel`（Bingo）挂在左列堆栈内，与空间/物料/创作/户外/消息同列切换；实测矩形 x=69、宽 400，右半屏枚举不到任何对话/抽屉面板。旧创作室聊天 `.cr-assistant.is-docked` 已 `display:none`（`globals.css` L1927）。
- 选中物属性面板（空间/物料/人物）目前走左抽屉，不在右轨。

## 2. 成熟案例对标

| 产品 | AI 对话落位 | 另一侧栏放什么 | 可分离形态 | 证据 |
| --- | --- | --- | --- | --- |
| Figma（Design 文件 Agent） | **左侧导航栏**开 persistent 聊天侧栏（与 Layers/Assets 同侧）；画布上另有 on-canvas 提示框 | 右栏 = 属性 / 原型 / 评论 / 导出 | 可 Pop out 成独立窗口 | Figma Learn「Work with the Figma agent」「right sidebar」两篇帮助文档 |
| Miro（Sidekicks） | 非常驻侧栏：创建栏上方入口 + 底部 prompt 框，对话浮在画布侧 | 无固定对话栏 | 新建板打开即 Sidekick 模态 | Miro Help Center「Sidekicks evolve AI creation」 |
| Cursor | **右侧副栏**：Agent Mode / Chat / Bug Finder | 左栏 = 文件资源管理器 / 扩展 | — | CodeAnt 对比评测；Cursor 社区论坛布局帖 |
| VS Code + Copilot | Chat 视图新版默认**右侧副侧栏**，可拖到主侧栏、编辑器页、独立窗口 | 主侧栏（左）= 资源管理器/搜索/源码管理 | 侧栏 / 编辑器页 / 独立窗三态 | VS Code 官方「Use the Chat view」「Chat view locations」文档 |
| PetitMaker 谷地工坊 | **锚定左轨的可停靠浮动卡**（`shell-assistant-panel` + dock-pin），展开不挤窄画布 | 右轨 = 视图切换等编辑器动作 | 停靠 / 浮动 | 本仓 `docs/plans/petitmaker-playtest-2026-11-05.md` N2 |
| Slack / Discord 类 | Bot 在左频道/私信列表，不是独立对话栏 | — | — | 本仓 `docs/plans/sidebar-entry-unification-2026-11-12.md` §4.3 |

### 2.1 规律（不是「AI 必须左」或「AI 必须右」）

1. **侧栏归属由角色决定**：资产/导航所在的一侧放对话；对面一侧放属性/检查器。Figma 把 Agent 放左（资产同侧）、属性放右；Cursor/VS Code 把文件 explorer 占左，AI 只能去右副栏。
2. **对话可脱离栏位是标配**：Figma pop-out、VS Code 三态停靠、PetitMaker 浮动卡——长期运行/对照画布时拖成独立小窗，而不是常驻一条窄栏把画布挤窄。
3. **地图编辑器的右侧角区留给工具**：缩放/归位/图层/视角这类地图控件按角区惯例排布，不与对话抢栏位（`tool-rail-unification` §5/§8）。

## 3. 候选目标方向（待评审，不是终稿）

按角色分工对照，幕景的左栏已经是「资产与上下文卡」一侧（空间/物料/人物/户外规划），右轨是编辑器动作与地图控件。候选口径：

- **T1 四区**：左轨（导航入口）｜左栏上下文堆栈（Bingo 对话 + 空间/物料/人物/户外/创作卡）｜画布｜右轨工具簇 + 地图角区浮层。**不设常驻右对话栏**。
- **T2 对话卡同栈、可脱窗**：Bingo 作为左堆栈一张卡，沿用现有换序/拖高/拖出小窗机制（`left-stack.ts`），对齐 Figma pop-out 与 PetitMaker 浮动卡；不新增第二条对话承载链。
- **T3 画布是主角**：任何面板展开不挤压画布到不可用；浮动小窗上限两枚、级联错位（现状常量已在）。
- **T4 窄屏**：左栏收成浮层卡片，对话随轨切换；不仿 Cursor 右副栏聊天。

> 这套方向与 Figma「Agent 与资产同侧」、PetitMaker 左轨可停靠卡一致；与 Cursor/VS Code 右副栏聊天的差异，来自我方左栏已被上下文卡占住、右轨已被编辑器动作占住——两边都没有空出一条对话栏。

### 3.1 推荐口径（2026-11-21 晚，待评审确认；不是已拍板终稿）

基于现有前端实测结构给出的倾向性建议，逐条对应 §4 开放决策：

- **D2 对话归属：锁定左堆栈，不开右副栏停靠位。** 左堆栈已承载上下文卡，Bingo 是其中一张；右轨已排编辑器动作与地图角区，没有空出的常驻对话栏。「对话贴画布」的诉求由现有脱窗小窗机制覆盖（上限两枚、级联错位），不再单开右栏。
- **D3 属性面板：从画布左上浮卡迁到右侧临时检查器。** 现状选中物走 `.sc-canvas-share` 浮卡（`left:12 top:52`，宽约 380px，压在画布左上，与左堆栈抢位置）；建议改为选中物件时右侧展开检查器、取消选中收回窄工具轨，左堆栈的对话与上下文卡不被顶替。分工对齐 Figma 右栏属性。
- **D1 缺省态：** 上下两张卡各占一半（沿用现状 `first=outdoor, ratio=0.5`），Bingo 不默认全高；可脱窗。
- **D4 入口归属：** 人物、版本历史本轮不上左轨；人物维持左卡平级页签，历史走抽屉。
- **D5 评审摘要栏：** 编辑工作台内不设右摘要栏；只读评审视图是否要右侧大纲/清单/评论，排远期再议。

草图见 `deliverables/Flowith-IA反馈-2026-11-21/推荐布局-主态-v1.jpg`、`推荐布局-选中属性态-v1.jpg`；残留偏差见反馈文档 §12。

## 4. 开放决策（设计未定，评审后再锁，不替现状代码默认）

| 编号 | 待拍板 | 现状 | 对标参照 | 推荐倾向（§3.1） |
| --- | --- | --- | --- | --- |
| D1 | Bingo 对话卡缺省态：收起 / 半高 / 沿用上次堆栈顺序 | 默认户外规划卡在上，Bingo 待点开 | PetitMaker 浮动卡可关；VS Code 侧栏可显隐 | 上下各半，不默认全高 |
| D2 | 是否给对话开放**右侧副栏停靠位**（可左可右），还是锁定左堆栈 | 只在左堆栈 | Cursor/VS Code 右副栏；Figma 左 persistent | 锁定左堆栈，不开右副栏 |
| D3 | 选中物属性面板归属：留左浮卡，还是迁到右侧检查器（选中物料/人物时右栏变属性） | 画布左上浮卡 `.sc-canvas-share`，非专属检查栏 | Figma 右栏属性/原型/评论 | 右侧临时检查器，选中展开、取消收回 |
| D4 | 人物入口、版本历史是否上左轨常驻 | 人物左卡平级页签；历史走抽屉；均待评审 | — | 本轮不上左轨 |
| D5 | 评审 / 只读分享视图是否需要右侧摘要栏（方案大纲、物料清单、评论） | `/review` 已有可评论只读页，右侧无摘要栏 | Figma 评论在右栏 | 编辑工作台不设；远期再议 |

## 5. 规范订正清单（D1–D5 收口后落到 `docs/05-设计规范.md`）

以下条目当前是 v2.4/v2.6 旧右栏布局的残留措辞，回改口径随 D2/D3 结论定，本轮先标位置、不动规范正文：

| 位置 | 现状措辞 | 处理 |
| --- | --- | --- |
| §3 断点 L108 | `641–1024` 窄桌面「右栏折叠」 | 核对是否指旧右栏；按 T1/T2 改为左栏浮层 |
| §3 栅格 L110 | 只写「左轨 + 画布 + 侧栏按左卡宽度」 | 补右工具轨与角区浮层的角色说明 |
| §2 入口表 L202 | 「左轨 Bingo｜打开/收起右栏助手对话」 | 改为左栏堆栈助手卡（D2 终稿） |
| §2 入口表 L206 | 「右栏 Agent｜唯一生成入口」 | 改为左栏 Bingo 会话卡；右轨不含对话 |
| §1 缺省态 L263 | 「面板（右栏 / 抽屉 / 底条）」 | 补左栏堆栈作为面板承载位 |
| 代码注释 | `agent-panel.css` L1「v2.6 右栏 Agent」；`creative-studio.tsx` L2202/L2264「右栏由 AgentPanel 接管」 | 随代码注释订正，不进规范正文 |

> L463 设置浮层「左栏『画布』」是模态内部左右分栏，与工作台右轨无关，不在本次订正范围。

## 6. 边界与不做

- 本备忘只定布局目标方向与待拍板清单；不改 `docs/05-设计规范.md` 正文、不改代码、不出新草图。
- 不把线上中间态（去室内化解耦进行中）写成终局规范；现状证据只用于对照，不用于锁定。
- 不引入无限节点画布、多分支并行对比；方案对照仍走版本历史与提案预览。
- 对标只取布局与承载惯例；AllSeated/Prismm/LTX/Boords/FLORA/酷家乐的资产命名结构不照搬（见反馈文档 §2.6）。

## 7. 参考来源

内部：

- `docs/plans/petitmaker-playtest-2026-11-05.md` N2（左轨可停靠浮动卡）
- `docs/plans/sidebar-entry-unification-2026-11-12.md` §4.3（Slack/Discord/Notion/ChatGPT 助手位对照）
- `docs/plans/tool-rail-unification-2026-11-13.md` §1.2、§5、§8（导航族 vs 工具族、地图角区惯例）
- `frontend/components/room-organizer/lib/left-stack.ts`（堆栈/脱窗机制）
- `deliverables/Flowith-IA反馈-2026-11-21.md` §10.1（线上实测与线框偏差记录）

外部（2026-11-21 检索）：

- Figma Learn：Work with the Figma agent in design files — https://help.figma.com/hc/en-us/articles/37998629035799-Work-with-the-Figma-agent-in-design-files
- Figma Learn：Layer properties in the right sidebar — https://help.figma.com/hc/en-us/articles/360039832014
- Miro Help Center：Sidekicks evolve AI creation — https://help.miro.com/hc/en-us/articles/33881743175954-Sidekicks-evolve-AI-creation-in-Miro
- VS Code Docs：Use the Chat view — https://code.visualstudio.com/docs/agents/run/chat-view
- VS Code Docs：Use GitHub Copilot（Chat view locations）— https://code.visualstudio.com/docs/editor/github-copilot
- CodeAnt AI：Cursor vs Windsurf vs GitHub Copilot — https://www.codeant.ai/blogs/best-ai-code-editor-cursor-vs-windsurf-vs-copilot
