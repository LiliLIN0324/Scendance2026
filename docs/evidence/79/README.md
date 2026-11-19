# #79 发布证据门禁

> 这是**证据台账的机器校验**，不是发布结论。结论仍只由 `walkthrough.json` 的 11 条用例和人的签字决定。

## 命令

```bash
npm run check:79   # 只验台账自洽；当前 2/11 也应通过（exit 0）
npm run gate:79    # 发布闸门；必须 11/11 全绿且 signoff=signed，否则 exit 1
```

`check:79` 可放在日常检查里，防止台账被改坏；`gate:79` 只在真正准备解除门禁时跑。两者都不联网。

## 校验规则

1. **单一台账**：`docs/evidence/79/walkthrough.json` 必须 `schemaVersion=2`，case `1..11` 各出现一次，不能多也不能少。
2. **计数重算**：`counts.pass/partial/blocked/fail/na` 必须与 ledger 逐条重算一致；`counts.note` 不能为空。手填数字对不上就失败。
3. **结论规则**：只有 `browser=pass && cloud=pass` 才允许 `conclusion=pass`；任一维度没到 pass，结论写成 pass 就失败。非 pass 必须写 `gap`。
4. **证据路径**：每条用例的 `evidence` 必须至少有一个 `docs/evidence/79/...` 路径，且文件真实存在；相对文件名按同条证据的前一个完整路径解析。
5. **证据指纹**：只对**台账实际引用**的 JSON 做 SHA-256。
   - 同一份内容出现在多个 case、且 basename 不同 → 失败（典型：把 `case01.json` 复制成 `case09.json` 当 #9 证据）。
   - 同一份内容、同 basename 的链式证据（如 `07/08/09` 共用的 `chain-07-08-09.json`）→ 允许，但打印提示。
   - 文件名里的 `caseNN` 与所在目录不一致 → 失败。
   - 未被引用的失败样本保留在目录里做审计，不参与结论，也不触发指纹失败。
6. **签字边界**：`signoff.status` 只能是 `pending-human` / `signed`；`signed` 必须有 `signedBy`、可解析的 `signedAt`，且 11/11 全绿。agent 不能代签。
7. **部署缺口清单**：`deployGap.partialCases/blockedCases/remainingCases` 必须由 ledger 重算得出；`resolvedCases` 表示“因本次部署修复而转绿的 case”，只校验它是 pass 的子集，不强行等于全部 pass。

## 当前读数（2026-11-19）

```text
[79] 台账 11/11 · pass 2 / partial 9 / blocked 0 / fail 0 / n/a 0
[79] 签字状态：pending-human
[79] 提示：发布未就绪：2/11 全绿（partial 9，blocked 0）
[79] 证据台账自洽：计数、维度、路径、指纹、签字边界均通过
```

`npm run gate:79` 当前会以 exit 1 结束，并明确打印“证据未齐 11/11”。这是预期行为：**2/11 不是通过，不能签成通过**。

## 参考的成熟发布门禁原则

- **单一事实源**：状态只从 `walkthrough.json` 读，表格和清单都由它派生。
- **派生值重算**：计数、剩余用例、已解决用例不手填；与 `in-toto` / SLSA 的“产物可追溯、元数据可验证”原则一致，但本脚本不声称实现完整 attestation。
- **内容指纹**：对实际引用的证据做哈希，识别改名复制和跨用例错放。
- **证据与批准分离**：机器只验证据边界；放行必须由人签字，且签字不能掩盖未完成证据。

## 不做什么

- 不改任何用例结论，不新增 pass，不代替人签字。
- 不访问网络、不调用模型、不产生费用。
- 不并入 `npm run gate`：代码发布门禁不应依赖一份仍在推进的验收台账；需要时显式跑 `gate:79`。
