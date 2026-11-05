# 第 11 批交付：阶段化进度

日期 2026-11-05｜依据 `docs/plans/petitmaker-agent-teardown-2026-11-05.md` §10 第 1 条

## 为什么要它

幕景运行条原来写 `DeepSeek 正在处理（3/6）`——这是引擎的内部账：用户读不出「还要多久、在干什么」，而 `DeepSeek` 这个词本身对策划师零信息。谷地工坊的做法是阶段名（"第 2/4 阶段：先固定背景板再排桌椅"）：它描述工作推进到哪，不是机器转了几圈。

## 四段工作

| 序 | 阶段 | 落在这一段的工具 |
|---|---|---|
| 1 | 看现状 | `get_scene` `inspect_zone` `search_resources` `inspect_materials` `get_bom` |
| 2 | 定落点 | `find_free_areas` `create_parametric_model` `start_lux3d_model` |
| 3 | 出方案 | `validate_candidate` `customize_material` |
| 4 | 交付 | `submit_candidates` |

进度行：`第 2/4 阶段 · 定落点 · 第 3/6 轮`。阶段在前当主标题，轮数在后当预算读数——轮数是真实的（6 轮硬上限），只是不该充当主标题。

## 两个判据

1. **阶段只前进不后退。** 模型常走「校验 → 回头再看一眼局部 → 再校验」，若按最后一次工具算，进度会 3→1→3 往回跳。这里保留已到达的最远阶段：回头读细节是细化，不是退回原点。
2. **归属由编译期强制。** `phaseOfTool` 的类型是 `Record<keyof typeof schemas, AgentPhase>`，将来往 `schemas` 加第 12 个工具而不给阶段归属，会直接编译不过——不能默默退化成「看现状」。

## 验证

- `tests/agent-progress.test.ts` 6 例：序号、只前进不后退、原地不动、进度行形态、轮数越界（不写「第 0 轮」「3/2 轮」）、每段都有名字与说明。
- `tests/agent-space-tools.test.ts` 新增 1 例，跑真实 `executeAgentRun`，断言轮首两行正是 `第 1/4 阶段 · 看现状 · 第 1/6 轮` / `第 2/4 阶段 · 定落点 · 第 2/6 轮`，且旧的 `DeepSeek 正在处理` 不再出现。
- 后端全量 719 例：716 过，3 例（`config` / `merged-library` / `local-persistence`）在并发满载下超时，单跑或三个合跑均全过，属既有负载敏感点，与这批无关。
