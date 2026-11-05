# AI 空间/布局生成智能体深度调研（2026-11-05）

> 目标：为 TS 后端 + 格子地图 + 物件 footprint 的场地规划智能体找「代码可读、可直接抄」的实现，重点看「模型自由输出 vs 引擎硬校验」这一层。
> 口径：链接均为真实仓库/论文；已用 WebFetch 读过关键 raw 文件的标「已核实代码」；读不到的标「仅论文/未核实」，不编造 star 数与路径。

## 一、Minecraft 建造智能体

| 项目·链接 | 栈 | 动作空间 | 约束/校验（代码路径·函数） | 上下文注入 | 可直接抄 | 缺陷 |
|---|---|---|---|---|---|---|
| Voyager · github.com/MineDojo/Voyager（已核实代码） | Python + Node(Mineflayer) | 生成并执行 JS | 技能只存 critic 判成功者：`voyager/agents/skill.py` 的 `add_new_skill()`（success 才入库）、`retrieve_skills()`（Chroma top-k）；失败回退靠 `voyager/agents/action.py` 回写执行错误重试；总循环 `voyager/voyager.py` | 每轮：任务 + env 反馈 + 执行错误 + 检索到的 top-5 技能代码（`render_system_message()`） | skill.py「描述向量化 + 代码落盘 skills.json」结构可平移到活动配方库 | 技能无测试/置信度元数据，仅一次成功门 |
| Mindcraft · github.com/kolbytn/mindcraft（已核实代码） | Node.js + Mineflayer | 结构化 `!命令`（白名单）+ 可选 JS（默认关） | `src/agent/coder.js` 生成 JS 后 lint「只许调技能库函数」再沙箱执行；`src/agent/library/skills.js`+`skill_library.js` 预制技能；命令白名单在 `src/agent/commands/actions.js`/`queries.js` | 对话历史 + `src/models/prompter.js` 拼 prompt + 示例 | 「命令白名单 + coder 校验技能调用」= 我们的画/摆工具白名单 | 代码执行默认关，能力弱于 Voyager |
| Odyssey · github.com/zju-vipa/Odyssey | Python(基于 Voyager) | JS 技能调用 | 40 原语 + 183 组合技能库，复用 Voyager skill 机制 | 同 Voyager + 微调 LLaMA-3 注入 Wiki 知识 | 原语/组合技能分层对应「工具分层」 | 依赖微调模型，重 |
| Cradle · github.com/BAAI-Agents/Cradle | Python | 键鼠信号（通用计算机控制） | 6 模块：信息收集/自我反思/任务推断/技能管理/行动计划/记忆；反思模块判定上步是否成功 | 屏幕截图 + 文本 | 「反思过去、总结现在、规划未来」三段式可抄进运行中改道 | 视觉+键鼠，与格子地图不匹配 |

## 二、室内布局生成

| 项目·链接 | 栈 | 动作空间 | 约束注入方式（代码路径） | 上下文注入 | 可直接抄 | 缺陷 |
|---|---|---|---|---|---|---|
| LayoutGPT · github.com/weixi-feng/LayoutGPT（已核实代码，NeurIPS 2023） | Python + GPT-4 | 文本输出 CSS 式坐标 (x,y,w,h) | 约束靠 prompt：few-shot 示例 + 户型文本 + 数量；事后算 OOB 越界率（`eval_scene_layout.py`）；入口 `run_layoutgpt_3d.py`、解析 `parse_llm_output.py` | few-shot 示例 + 户型文本 | 「约束写进 prompt」最轻，可作 map_context 摘要模板 | 无硬校验，坐标是模型猜的 |
| House-GAN · github.com/ennauata/housegan | PyTorch GAN | 生成房间 bbox | 约束 = bubble diagram（邻接图），GNN 编码注入（`models.py`） | 邻接图 | 邻接图=语义约束、bbox=坐标的分工可借鉴 | 需训练，非 LLM，泛化差 |
| ATISS · 原仓库 nv-tlabs/ATISS，可读实现 smartscenes/libsg 的 `libsg/model/atiss.py`（类名已核实） | PyTorch 自回归 Transformer | 逐物体输出类别+位置+朝向+尺寸 | 约束 = 房间布局 mask 特征 + 已放物体序列；连续量用 DMLL 离散化（`AutoregressiveDMLL`） | 布局 mask + 物体序列 | 自回归「顺序放物」贴合「逐件摆」 | 非 LLM，只防穿墙不防语义 |

## 三、混合范式（LLM+求解器）现状 ★核心

**结论：这条路站得住，已有成熟开源先例，做法高度一致——LLM 只产出「空间关系约束」，坐标交给求解器。**

| 项目 | 分工 | 关键实现 | 可核验性 |
|---|---|---|---|
| Holodeck · github.com/allenai/Holodeck（CVPR 2024） | LLM(GPT-4) 产出物体间空间关系约束，CVXPY 解 MILP 落坐标 | `ai2holodeck/generation/milp_utils.py`：`create_nooverlap_constraints`（大 M 法+二元方向变量防重叠）、`create_edge_constraints`（贴墙）、`create_distance_constraints`（近/远软约束）、`create_relative_constraints`（left/right/in front）；prompt 在 `generation/prompts.py`，主流程 `generation/holodeck.py` | **已核实代码**（raw 读过 milp_utils.py） |
| LogicEnvGen · arXiv:2601.13556 | LLM 定义四类空间关系（单目/接触/距离/相对），Z3 解 CSP；冲突触发迭代修正 + 约束松弛 | 论文明确「LLM 数值推理弱→由 solver 落坐标」 | 仅论文，开源代码未核实 |
| SPUR spur-solver · getspur/spur | LLM 把意图翻译成约束表达式，Z3 求可行模型 | Rust crate，`solve_constraints` 接口 + 类型化变量域 | 仓库存在（未逐文件读） |

**对我们意味着什么**：我们的「语义归模型、坐标归引擎」与 Holodeck 完全同构——把 `update_plan` 注释/关系（如「帐篷在舞台东北、距步道≥1 格」）当约束，用引擎或轻量求解器落格子坐标，再用 footprint 碰撞做硬校验。**建议照抄 Holodeck 的约束函数清单**（不重叠/贴边/距离/相对方位），这是可平移到格子地图的最小约束集。

## 四、防打转三件套

| 机制 | 真实项目 | 关键实现要点 | 我们落地 |
|---|---|---|---|
| Reflexion（自我反思） | noahshinn/reflexion（NeurIPS 2023，已核实代码） | 失败后让 LLM 生成「反思」存记忆，下次作上下文；`ReflexionStrategy` 枚举控制是否给上轮反思；`use_memory` 控制持久化（`alfworld_runs/run_reflexion.sh`） | 已有 tripwire+scorecard，可加：失败时让模型写一句「为什么摆不进」回填 map_context |
| Skill library（技能复用） | Voyager `skill.py` | 只有 critic 判成功才 `add_new_skill`；代码+描述双存；Chroma 检索 top-k 注入 | 活动配方库已存在，加「成功才入库 + 向量检索复用」即可 |
| Curriculum（由易到难） | Voyager `curriculum.py` | `CurriculumAgent` 维护完成/失败任务列表 + QA 缓存，按进度提下一个稍难任务 | 已有「阶段化进度」；把「失败任务」纳入下一轮选择，避免反复提同难度 |

## 五、AutoGPT / LangChain 防打转补充

- LangChain `AgentExecutor` 的 `max_iterations`/`max_execution_time` 是硬上限，等价我们的 tripwire；ReAct 提示（论文仓库 `ysymyth/ReAct`）强制「Thought-Action-Observation」循环，每次行动须基于上轮观察——即我们每轮注入 map_context 的依据。
- AutoGPT（github.com/Significant-Gravitas/AutoGPT）靠「循环检测 + 反思提示」但工程松散，**不建议照抄代码**，只取其「上限 + 反思」两个开关。
