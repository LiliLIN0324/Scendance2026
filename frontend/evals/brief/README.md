# 活动需求离线评测（合成样本）

这 13 条是人工编写的合成示例，不是现场数据或模型实测。覆盖长者不等于轮椅、明确行动辅助、签到/舞台否定和待定、1 人、人数冲突和历史人数、仅面积、厘米和英寸、事实缺失及提示注入。

在仓库根目录执行：

```powershell
node scripts/run-ts.mjs frontend/evals/brief/run.ts
```

默认仅读取 `cases.json` 与 `synthetic-responses.json`，后者是人写的模拟输出，并非模型输出。全程不联网、不读取密钥；自动检查通过数仅代表这些模拟输入经过当前代码后的结果。失败会返回非零退出码，缺失输出单独计数，不能当成通过。

以后在用户明确启用并授权某一提供方后，可通过已有应用按各条原文取得模型 JSON，并由操作者把输出存成以样本 id 为键的 JSON 对象。独立执行：

```powershell
$env:BRIEF_EVAL_RESPONSES = '本机模型输出文件的路径'
node scripts/run-ts.mjs frontend/evals/brief/run.ts
Remove-Item Env:BRIEF_EVAL_RESPONSES
```

运行器只读取文件，不启动服务、不调用提供方，也不收集密钥。不要将密钥或真实客户资料放进输出文件。样本外输入、模型调用的授权、成本和隐私处理仍由实际运行环境负责。

自动项使用现有提取 schema、原文连续引用验证、人工逐例标注的预期字段/决定/证据要素，以及实际 resolver 的追问状态与关键事实记忆；它不评价自由文本语义。报告中的 `questionForHumanReview`、`modelReplyForHumanReview` 和 `manualReview` 必须逐项人工判定：问题是否问对了、是否暗示刻板印象、是否包含安全通过等无依据表述。自动通过不等于语义正确、整体通过或真实模型合格；恶意提供的证据可以是原文引用却仍表达相反语义，必须结合人工复核。当前单轮、13 条、无现场与统计代表性；要评估多轮和稳定性需要扩充独立标注样本并重复测量。

## 复合要求覆盖评测

`coverage-cases.json` 另列 6 条人工编写和逐项标注的虚构案例，覆盖人数、复合硬要求、已有椅子、签到未定、普通问答和明确否定。每一项分别报告 `recognized`（结构化识别）、`reported_unhandled`（明确报告未处理）、`missing`（遗漏）或 `contradicted`（与标注冲突）。`coverage` 检查模型原始字段；`systemCoverage` 单独显示当前系统解析后的结果，不能把实验性人数规则当作真实答案或模型能力。`unlabeled` 列出模型产生但本案例没有标注的固定字段名称，须补标或人工核对，不会输出模型字段值。若 `extraction` 为 `invalid`，原始字段观察不代表输出通过结构或证据校验。证据必须来自用户原话，但原文引用本身不证明语义正确。一个事项被明确报告为未处理也不代表它已经满足。

在仓库根目录运行：

```powershell
node scripts/run-ts.mjs frontend/evals/brief/run-coverage.ts
```

默认读取人工编写的 `coverage-synthetic-responses.json`，不联网、不调用模型、不接触真实项目。该模拟数据**故意遗漏暖白灯光要求**，因此命令预期返回非零并报告 `compound_light` 的缺项；这证明评测能发现该漏项，不是某个真实模型的实测成绩。可用 `BRIEF_COVERAGE_RESPONSES` 指向已取得的模型 JSON 文件（以案例编号为键；不要写入密钥或真实客户资料），但需人工检查语义及证据。

评测 API 可另接收由测试执行器或人工独立采集的场景结果：只有候选确实应用、用户确认、每条人工标为交付必需的要求和预先列出的关键安全项均有相应记录时，才显示 `observed_ready_for_human_review`。未解决的活动需求、未标注输出、没有此类结果、只有预览、或关键检查为 `unknown`/`violated` 均不能升级为已就绪；`not_applicable` 必须由案例预先允许。命令行默认不提供这些结果，因此不会报告已交付。采集记录本身仍需核验；案例评分不构成规范合规、场地方确认或现场验收。
