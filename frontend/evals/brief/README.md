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
