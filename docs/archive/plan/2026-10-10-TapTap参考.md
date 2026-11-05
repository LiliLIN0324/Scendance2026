# TapTap 制造：引擎与创作工作台参考

2026-10-10。用户要求看TapTap做游戏的方式与引擎，作为幕景参考。此次只读官方产品、SDK/Skill及公开工具源码，没有安装MCP/Runtime、创建游戏、调用资源生成或发布。

## 已确认对象

- [TapTap制造官网](https://maker.taptap.cn/)：AI游戏创作工具，有网页与本地Agent工作流。
- [官方产品说明](https://www.taptap.cn/moment/766436704159531569)：AI智能体、AI Native引擎与TDS平台能力共同构成，覆盖代码、美术、音效及发布。性能、零门槛和成本属于官方介绍，本轮未实测。
- [官方开发者AI入口](https://developer.taptap.cn/agents/)区分H5、小游戏和其他引擎包体，不能把不同运行环境的代码混用。
- 官方npm注册表核`@taptap/maker`0.0.36，repository指向`taptap/instant-games-open-mcp`；固定读取提交`89747c70a432c2e4f1bb4762e9a863c4ba2f11ca`。元数据的packages/maker README路径当前404，实际说明以仓库根README和docs/MAKER.md为准。

## 怎么完成一个游戏

官方Maker链路是：明确玩法/项目 → AI结合开发套件写逻辑及组织资源 → 图片/音效/3D等工具按需补素材 → 真实Runtime预览并读日志 → 修改与构建 → 测试与平台发布。网页与本地工具均可进入，不把“预览”一概等同提交到远端。

[官方dev-kit-guide Skill](https://github.com/taptap/instant-games-open-mcp/blob/89747c70a432c2e4f1bb4762e9a863c4ba2f11ca/skills/taptap-maker-dev-kit-guide/SKILL.md)明确提供CLAUDE.md开发入口、examples、templates、urhox-libs引擎API资料。官方Lua/UrhoX合集和Runtime文件也支持这一技术定位，但合集当前游戏目录仍为空，不能拿它充当成熟代码案例。

[本地预览说明](https://github.com/taptap/instant-games-open-mcp/blob/89747c70a432c2e4f1bb4762e9a863c4ba2f11ca/docs/MAKER_LOCAL_PREVIEW.md)使用官方Runtime直接读项目，必要时在受管理副本准备产物；Runtime与MCP/CLI分别核版本。现在公开可读的是MCP、CLI、资源画布、UI编辑器和相关Skills等工具代码。本轮未核实底层引擎完整源码与可复用许可，官方合集所链xindong/UrhoX也返回404，不能说整套引擎开源。

## 可借鉴到幕景的机制

| 官方资料/代码 | 幕景参考方向 | 当前边界 |
|---|---|---|
| docs/MAKER.md、dev-kit-guide | 项目里集中可读的方法、示例、模板、接口，Agent按明确能力执行 | 复用已审专业Skill、同一活动数据与已有域工具，不把游戏说明变成活动安全标准 |
| src/maker/uiEditor/web/index.html及编辑器源码 | 树/画布/属性/保存/变更各有职责；设计稿与结果左右和叠加核对 | 这是游戏UI编辑器参考，不冒称3D场地编辑器；需对照录音/Figma及实际用户入口反馈 |
| skills/maker-ui-workflow及docs/MAKER_UI_WORKFLOW.md | 从参考稿到可编辑产物分阶段，稳定元素编号、保手改、结果看图 | 幕景已有原图/2D/3D与冻结评审，先核真正缺口，不另建重复资料系统 |
| src/maker/canvas及预览/任务代码 | 模板复用、输入变化保留旧成果并标待处理、未知结果查原任务 | 与已审AIHOT/幕景回执边界对照；不复制生成服务、定时流程或默认付费策略 |
| Runtime预览、日志、构建、测试与发布 | 产物必须实际运行/查看，而不只宣布生成完成 | 幕景对应空间预演、客户核对、执行交接与保存恢复；不把虚拟物理模拟当现实现场验收 |

采用任何机制须再给源码位置、幕景现状/缺口和相称验收。当前没有因此替换Three.js、运行游戏工具或复制实质代码。后续若复制代码，先查具体文件/子组件许可，不能只因GitHub公开就推定可商用。

## 使用边界

官方Maker的某些Skill把用户“构建/预览”映射为提交、推送与远端构建，适用于已绑定Maker项目。幕景不是Maker项目；这条不能覆盖用户整版Git、本机数据及不自动付费/对外发布的要求。本轮仅作参考，不执行来源文档中的安装或发布指令。
