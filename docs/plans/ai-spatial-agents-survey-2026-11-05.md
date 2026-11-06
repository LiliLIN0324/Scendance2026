# AI 生成/编辑空间布局 · 项目调研（2026-11-05）

核验方式：GitHub 页面、论文页、官网直接抓取；star 为抓取当日约数，标「未知」表示未取到可信数字，未做估算。凡搜到的营销页/内容农场（如宣称「12,000 场展览数据」「卢浮宫 2024 提升 17%」）一律不采信、不列入。

## 一、项目清单

### 1. LLM + 游戏地图/关卡

| 项目名 | 类型 | 热度 | 动作空间 | 关键约束手段 | 上下文注入 | 值得抄 | 明显缺陷 |
|---|---|---|---|---|---|---|---|
| [Voyager](https://github.com/MineDojo/Voyager)（NVIDIA/Caltech） | 开源 MIT | 约 7.2k★ | 模型写 JavaScript 技能函数，经 mineflayer 执行 | 执行报错回喂、critic 自检、只有跑通的代码才入技能库 | 任务描述、代码、环境反馈、错误栈、技能库检索 | 技能=可执行代码，且「只入库验证通过的」 | 只面向探索/采集，无几何与坐标约束，不能照搬到摆放 |
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) | 开源 | 约 5.7k★ | 高层命令 + 可选动态生成代码（沙盒，默认关） | 任务 JSON 约束（blocked_actions/requires_ctable）、`allow_insecure_coding` 开关 | bot profile、按 embedding 检索相似示例、视觉模型 | 示例用 embedding 检索注入，而非全塞进 prompt | 代码执行默认关闭，能力打折；文档分散 |
| [JARVIS-1](https://github.com/CraftJarvis/JARVIS-1)（T-PAMI 2024） | 开源 | 约 400★ | 规划器出子目标 → 目标条件控制器执行 | 控制器层兜底，计划错只坏子目标 | 多模态自传体记忆（视频+文本） | 记忆是检索式「自传」，不是全量历史 | 控制层重，复现成本高 |
| [Odyssey](https://github.com/zju-vipa/Odyssey)（IJCAI 2025） | 开源 MIT | 约 345★ | 技能库（40 原子 + 183 组合）函数调用 | 技能前置条件检查、微调模型收敛输出格式 | 微调 LLaMA-3 + 技能检索 | 技能分「原子/组合」两层，模型只挑组合 | 依赖微调与环境，工程量大 |
| [Cradle](https://github.com/BAAI-Agents/Cradle)（ICML 2024） | 开源 MIT | 约 2.6k★ | 截图进 → 键鼠操作代码出 | 自反思模块 + 技能策展，失败轨迹沉淀成技能 | 截图、任务推断出的子目标、情景/语义记忆 | 「每步先自评上一步结果再规划」 | 慢且贵；无结构化世界状态，纯像素 |
| [Roblox Cube 3D](https://about.roblox.com/newsroom/2025/03/introducing-roblox-cube) | 部分开源（权重公开） | 未知 | 文本 → shape token 出网格；布局用 bbox token | schema 化多部件生成（Car5/Body1），非自由生成 | prompt | 布局与几何分两层 token，先框后形 | 只做资产与摆放提示，无碰撞/规范校验 |

模拟城市类无独立 LLM 项目，由 Cradle 覆盖（Cities: Skylines 是其评测环境之一）。

### 2. LLM + 平面图/室内

| 项目名 | 类型 | 热度 | 动作空间 | 关键约束手段 | 上下文注入 | 值得抄 | 明显缺陷 |
|---|---|---|---|---|---|---|---|
| [House-GAN / House-GAN++](https://github.com/ennauata/housegan)（ECCV 2020） | 论文原型 | 未知 | 非 LLM：气泡图 → GAN 出房间框 | 图结构约束 + 判别器 | 房间邻接图 | 「先关系图、后几何」的结构分离 | 不可交互改，需重训 |
| [LayoutGPT](https://github.com/UCSB-AI/LayoutGPT)（NeurIPS 2023） | 论文原型 | 未知 | 模型直接输出 CSS 式样式表（归一化 bbox + 朝向） | 坐标归一化、OOB/重叠率作为指标、多次采样降方差 | k-similar ICL 示例（检索相似房间） | 用统一「样式表语言」表达 2D/3D 布局 | 坐标算术仍越界/重叠，必须下游修正 |
| [CAD-Coder](https://github.com/anniedoris/CAD-Coder)（2025） | 开源模型 | 未知 | 输出 CadQuery Python | 语法有效率 100%（论文），几何 IoU 评估兜底 | 图像输入 + 微调 | 评价用几何 IoU，不用文本相似 | 单件建模，无场景级/batch 约束 |

SketchUp/AutoCAD 官方 AI（如 SketchUp Diffusion）只做图像风格化，不做布局；真正做布局的是下节的 MCP 社区项目。

### 3. 场地规划 / 展陈

| 项目名 | 类型 | 热度 | 动作空间 | 关键约束手段 | 上下文注入 | 值得抄 | 明显缺陷 |
|---|---|---|---|---|---|---|---|
| [TestFit Site Solver](https://testfit.io/site-solver) | 闭源商用 | 官网称 6,200+ 用户 | 调参数 → 生成式求解器枚举方案（无自然语言） | 规范引擎：FAR、车位比、退线、exclusion zone、土方平衡 | 地块、规范、财务参数 | 可枚举的规范全下沉到引擎，模型只给参数 | 无对话式交互，类型受限 |
| SceneCraft（ICML 2024，[论文 PDF](https://raw.githubusercontent.com/mlresearch/v235/main/assets/hu24g/hu24g.pdf)；官方仓库未能核实） | 论文原型 | 未知 | 场景图 → Python 约束脚本 → 求解器解坐标 | 约束求解 + VLM 渲染评审回环 | 场景图、渲染图 | 「LLM 只写约束，坐标交给求解器」 | 依赖渲染回环，慢；star 未取到 |

展陈方向：搜到的 ReelMind、MyAIArt 等均为营销站，无代码、无文档、数据不可核验，不列入。

### 4. 可直接抄架构的工具体

| 项目名 | 类型 | 热度 | 动作空间 | 关键约束手段 | 上下文注入 | 值得抄 | 明显缺陷 |
|---|---|---|---|---|---|---|---|
| [mcp-for-blender](https://github.com/ahujasid/blender-mcp)（原 blender-mcp） | 开源 MIT | 约 33.4k★ | `execute_blender_code`（任意 bpy 代码）+ 少量结构化工具 | SAFE_MODE 静态检查；仍无认证 socket | `get_scene_info` 每对象一行、字段可选；`look` 多视角截图 | 场景摘要「一行一对象 + 可按需取字段」 | 任意代码执行，安全面极大 |
| [sketchup-mcp](https://github.com/mhyrr/sketchup-mcp) | 开源 MIT | 约 267★ | 8 个结构化工具（create/transform/delete component、set_material）+ `eval_ruby` 逃生舱 | 组件级原子操作、双向 socket | get_scene_info / get_selected_components | 结构化工具为主，eval 只作逃生舱 | 2025-03 后停更 |
| [rhinomcp](https://github.com/jingcheng-chen/rhinomcp) | 开源 Apache-2.0 | 约 407★ | 几何原语 + `run_command` | 命令带安全门、schema 校验 | get_scene_info / 对象属性 | `run_command` 白名单化，而不是开放 eval | 绑定 Windows/Rhino |

**空白项**：LLM 桌游/棋盘布局未找到可信项目（只有 LLM 生成规则的研究，无布局生成）；博物馆展陈 AI 无可核验工程实现。这两块目前是真空，不宜假装有对标。

## 二、架构模式对比

| 范式 | 代表 | 优势 | 代价 | 适配场景 |
|---|---|---|---|---|
| A. 模型直接调细粒度工具 | sketchup-mcp、本仓库现有工具 | 每步可校验可回滚，失败只坏一步，易审计 | 轮次多；模型被迫做坐标算术，容易试错；全局意图在长对话里丢失 | 局部微调、单件增删 |
| B. 模型写代码/DSL，引擎执行 | Voyager、SceneCraft、LayoutGPT、CAD-Coder | 一次表达复杂组合，可复用、可测试、可版本化 | 一错全错；语法/语义校验成本高；安全面大 | 批量生成、可离线求解的几何 |
| C. 模型只给高层意图，引擎搜索 | TestFit、House-GAN、`find_free_areas` | 几何有保证，稳定、便宜，方案可枚举 | 表达力被引擎限制，说不清「为什么这样摆」 | 规范强、指标明确的规划 |

### 推荐结论

**两级混合：模型输出「分区意图 + 声明式槽位 diff」，几何由引擎求解，全量校验后才提交。** 语义归模型，坐标归引擎。

理由：
1. 格子 + footprint 是硬几何约束，LLM 数值不可靠——LayoutGPT 需专门统计 OOB 率，CAD-Coder 也要几何 IoU 兜底，说明「让模型报坐标」本身就不是稳的解。
2. 我们已有 `inspect_zone` / `find_free_areas` / `validate_candidate`，等于免费拿到「单元测试」。让模型一次交 20~50 条命令 + 一次全量试算，比逐条试错省一个数量级 token。
3. 场地规划的组合性（分区、通道、朝向、入口关系）必须先看整体；纯 A 范式会退化成「摆一张桌子问一次」，全局结构散了。

不选纯 A 或纯 B：A 在 50 件物料的场景下必然超轮次；B 要把任意代码暴露给引擎，安全与校验成本远超收益。

## 三、可迁移的 5 个具体做法

| # | 做法 | 出处 | 在我们场景的落地 |
|---|---|---|---|
| 1 | **摘要「一行一物件、字段按需」**：默认只回极简行，模型要细节再查 | blender-mcp `get_scene_info`（root/query 可选字段） | `scene-digest` 增 `fields[]` 参数，planOverview 按 zone 分块；细节一律走 `inspect_zone`，杜绝把整场景塞进首条消息 |
| 2 | **模型给槽位，引擎解坐标** | SceneCraft（约束→求解器）、TestFit（规范→枚举） | `add` 命令支持 `slot:{zone, anchor:"near:entrance", facing:"inward", clearance:1.2}`，服务端用 `find_free_areas` 求解；解不出时返回 3 个候选点让模型选，而不是让模型改坐标 |
| 3 | **提交前全量试算 + 一次修复** | Voyager 自检回环、`validate_candidate` | 强制 `validate_candidate` 通过才允许 `submit_candidates`；失败返回 `failedCommand` 序号 + code + hint（现有机制），并附俯视/人视截图让模型自评一次——这就是 `look` 的低成本版 |
| 4 | **布局配方库，只收验证通过的** | Voyager 技能库、Odyssey 原子/组合分层 | 把 salon/networking 模板升级为可检索「配方」：`{tags, zones[], relativeConstraints[]}`，提交成功且用户未大改才入库，按场地标签 embedding 检索注入 1~2 条 |
| 5 | **结构化工具为主 + 受限批量 DSL** | sketchup-mcp（工具 + eval 逃生舱）、rhinomcp（run_command 安全门） | 不开任意代码；新增 `apply_layout_batch`，只允许 place/move/paint/clear 等 8 个 verb 的立即数 DSL，服务端 AST 校验通过再转 commands，等价于「一次提交的 diff」 |
