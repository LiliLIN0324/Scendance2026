# Agent 底座语料（agent-corpus）

## 这是什么

户外 Agent 的「养料」：把散在权威文档里的空间规则、场景模板、场地要素和物料参数，收成**可机读、可校验、可被提示词/校验器/回归测试直接消费**的文件。

| 文件 | 内容 | 上游真源 |
|---|---|---|
| `layout-assertions.json` | 80 条布局判据 + 12 条规范冲突，含优先级、来源等级、判据表达式、格数 | `docs/plans/2026-11-05-activity-space-norms.md` |
| `event-templates.json` | 7 类活动模板：识别词、容量公式、必备设施、关键判据、代码支持状态 | 同上 §1–§7；代码 `outdoor-event-logic.ts` |
| `site-evidence.schema.json` | 场地证据摘要的目标 schema（要素类型、确定性、来源、布局权重） | `frontend/lib/site-intelligence/types.ts` 的实际枚举 |
| `site-evidence.example.json` | 按上述 schema 手写的一个最小样例（合成场地，非真实项目） | —— |
| `cases/cases.json` | 成熟案例：43 案底图核对 + 20 个自有场地 / 30 个档案 + 3 条事故复盘（只记布局失效模式） | `deliverables/…/06_卫星图活动试验/`、`04_场地档案与演练/` |
| `material-references.csv` | 物料外部参考值（商家页面），逐行带 URL、取数日期、置信度；**不写回规范表** | 公开商家页面（未核） |
| `cases/eval-cases.json` | 27 条评测样本（10 layout + 17 failure，含 1 条对照），failure 自带可执行夹具 | 案例库 + `docs/59` |
| `threshold-sensitivity.json` + `threshold-ledger.csv` | 15 条阈值的绑定审计与安全区间；实测哪些阈值执行器真读 | 判据表 + 17 份夹具（见 `docs/60`） |
| `venue-layouts/layouts.json` + `coverage.csv` | 5 份自有档案抽成布局（DXF/GeoJSON/草稿），含 sha256 与 caveats；实测 0 条判据可算 | `04_场地档案与演练/`（见 `docs/61`） |
| `sites/yanguan.json` + `yanguan-check.json` | OSM 真实建筑轮廓（ODbL）与一次真实数据回执：GEN-07 退距 9.8 m | `sites/raw/` 的 Overpass 导出（见 `docs/62`） |
| `materials.csv` | 物料尺寸与部署参数；尺寸取自代码，重量/风载等未有的标 `待核` | `site-plan-facilities.ts`、`oneplan-library-size.ts` || `frontend/lib/agent-corpus/` | 执行器：11 条可算判据 + 69 条 `unsupported` 原因码；提示词摘要生成器（21 条 / 1600 字符预算） | `layout-assertions.json` |

## 三条硬规矩

1. **数值只能来自上游，不得在此新增。** 改判据先改 `activity-space-norms`，再同步本目录；`tests/agent-corpus.test.ts` 会核对每个 `id` 在规范文档里存在。
2. **缺的写 `待核`，不写估计值。** 物料表里 `待核` 表示代码与规范都没有可信来源，Agent 遇到必须反问，不得自行假设。
3. **来源等级不得上调。** A=国标有条文号，B=地方/公安/行业口径，C=经验值。C 级在对外文案里只能说「建议值」。

## 与代码的关系（2026-11-18 实况）

- **判据已有执行器，但未接进运行时**：`frontend/lib/agent-corpus/`（`evaluate.ts` / `geometry.ts` / `prompt-digest.ts`）能把 `facilities / zones / nodes / obstacles` 直接算成回执，已实现 11 条判据，其余 69 条带原因码进 `unsupported`。它现在只被 `tests/agent-corpus-eval.test.ts` 调用，没有接进 Agent 主链与面板。
- 已落码的几何校验只有 `agent-proposal.ts` 的 `BBOX_OVERLAP` / `OUT_OF_BOUNDS`，以及室内 `plan-scoring.ts` 的容量与罚分；执行器的 11 条**尚未**接入落笔前预检。
- 场地证据运行时已经有 `water` 要素与岸线排布（`openfreemap-water.ts`、`outdoor-shoreline-layout.ts`）；schema 里的 `layoutWeight`、`precisionM`、`constraints`、`gaps` 是**目标字段**，当前快照不产出。

## 谁能改

与 `data/building-heights.json` 不同，本目录**没有生成脚本**，是手工维护的规格数据。改动要求：

1. 上游规范或代码先改；
2. 本目录同步；
3. 跑 `npm test`（`tests/agent-corpus.test.ts` 必须绿）；
4. 提交信息写清「上游改了什么、这里跟了什么」。
