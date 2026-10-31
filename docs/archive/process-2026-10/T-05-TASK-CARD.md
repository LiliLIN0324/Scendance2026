# T-05 生成完再亮确认 + 座位不够给改方案 · 任务卡

> 卡号：**T-05**（对话主路径的确认时机与座位缺口）
> 用户点名：2026-10-27「下一卡再开『生成完再亮确认 + 座位不够给改方案』」。
> 依赖：v1.3.1（T-UI 可见交互收口已发布）。本卡不重开左轨、左栏简报、导出确认、Undo 的行为。
> 依据：`docs/ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md` §4「提案 / 预览仅一颗确认」、§5「布置确认」；`docs/T-03-TASK-CARD.md`「只报冲突 + 可一点改法」的同一套纪律。

---

## 1. 一句话任务

让「确认布置」只在**这一版真正生成完、预览已经停在画布上**时亮起；当这版座位数不够时，右栏如实报出缺口，并给一条**一次点击的改法**（补座位再排一版），仍然先预览、由人确认，不自动应用。

---

## 2. 现状核对（开卡前已读代码）

| 现象 | 代码现状 | 本卡处理 |
|---|---|---|
| 主路径确认时机 | 右栏 `ProposalCard` 只在 `phase === 'proposed' \| 'paused'` 时出现，本地逐帧预览期间显示 `GenProgress`，理论上不会提前出确认 | 保留；补回归断言，防止以后把确认提前 |
| 云端 / 深工具确认时机 | 深工具 `creative-studio` 的候选卡在 `studio.busy` 时仍渲染「确认布置」（只是 disabled）；云端预览若先到、任务未收尾，存在「看起来能点、点了没回音」的窗口 | **统一 gate**：生成中 / 云端忙 / 预览未落稳时不显示绿色确认，只显示安静的进度；完成后才亮 |
| 座位缺口 | `agent-proposal.ts` 按人数算桌组，但被面积上限（`areaSets * 2`）和实际槽位截断，`seats` 可能小于 `guests` | 保留「不塞爆场地」的边界；新增**座位优先**的改法入口，先尽量补座，仍不够就如实报场地最多能摆多少 |
| 座位缺口目前只说不动 | `planLines` 只在聊天气泡里说「只摆得下 X 座，其余 N 位按站立留空」；`ProposalCard` 没有座位行，也没有改法入口 | 卡片增加「座位 X / 30 · 还差 N」与文字链「加座，再排一版」；不新增第二颗绿钮 |
| 现有「换一版」 | `regenerate()` 只递增 seed，换的是布局变体，不针对座位缺口 | 新增**座位优先**的定向重排；复用现有 preview / confirm 链路，不自动应用 |
| 一屏一绿 / Undo / 导出 | v1.3.1 已收口 | **本卡不重开**；新入口只能用文字链或 chip，不能变成第二颗 `btn-primary` |

### 待核（不替产品裁决）

1. **场地的物理上限**：如果座位优先仍然补不齐，本卡只如实报「这版最多 X 座」，不承诺换更大场地、不自动减人数；换场地/减人仍由人在对话里决定。
2. **云端真 AI 的座位算法**：本卡只保证云端忙时不亮确认；座位优先的重排只在本地规则生成器上生效（演示环境默认走本地）。接真模型后的座位策略另开卡。
3. **座位怎么定义**：沿用现有 `dining-chair` 计数（餐桌一组 4 座）；散椅是否计入，由实现按物料能力决定，但播报必须和计数一致，不许虚报。

---

## 3. In（本卡只改这些路径）

| 路径 | 改动 |
|---|---|
| `frontend/components/room-organizer/lib/agent-proposal.ts` | `PlanInput` 增加可选的座位优先意图；座位优先时先尽量加桌组/散椅，仍受场地边界与重叠校验约束；`seats` 如实计数，不虚报 |
| `frontend/components/room-organizer/lib/agent-proposal.test.ts` | 新增：同一人数下座位优先的座位数不低于普通版；仍放不下时 `seats < guests` 如实返回；不产生重叠/出界 |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | `ProposalCard` 增加座位行与「加座，再排一版」文字链；确认按钮只在预览完成且未忙/未 stale/未 blocked 时以绿色出现；生成中与云端忙时不渲染绿色确认；座位优先重排走现有 `runGeneration` / `proposePlan`，确认前不落盘 |
| `frontend/components/room-organizer/panels/agent-panel.css` | 只补座位行与改法文字链的必要样式；不新增绿色主钮样式 |
| `frontend/components/room-organizer/panels/agent-panel.react.test.tsx` | 新增：生成中无 `#step-cta`；完成后恰有一颗绿确认；座位不足时显示缺口与文字链；点文字链先出进度、旧确认消失、新预览确认前不调用 `onApply`；blocked/stale 时无绿确认 |
| `frontend/components/room-organizer/panels/creative-studio.tsx` | 深工具候选卡在 `studio.busy` 时不出「确认布置」，改为安静的「正在整理这一版…」；busy 结束且 preview 稳定后才显示确认 |
| `frontend/components/room-organizer/panels/creative-studio.react.test.tsx` | 新增：busy 时无确认按钮；busy 结束后出现且可应用；座位文案不重复 |
| `docs/T-05-SELF-CHECK.md` | 新增：验收 checkbox + 真机证据 + 待核 |
| `CHANGELOG.md` | 追加 T-05 一条（实现完成后） |

---

## 4. Out（明确不做）

- **不提前亮确认**：生成中、云端忙、恢复中、预览未落稳，都不显示可点的绿色「确认布置」。
- **不自动应用**：座位优先只出新预览；仍然只有人点「确认布置」才写进画布。
- **不虚报座位**：补不齐就说这版最多多少座，不把站立人数算成已坐、不改 `guests` 来「凑够」。
- **不新增第二颗绿钮**：「加座，再排一版」只能是文字链或 chip，不能与「确认布置」并排成两颗绿。
- **不改场地几何算法**：不重写壳体、墙、动线；只在现有物料与边界内补座。
- **不接真 LLM / 新 API**；不做 3DGS、mood、天气、NPC；不改 14 键、不改左轨三图标、不换 logo。
- **不重开 T-UI 范围**：左栏简报、导出确认、Undo 同步、深工具抬头都不在本卡改。
- **不新增聊天意图解析**：本卡的改法入口是右栏文字链；「加座」类口令若要做，另开小卡。

---

## 5. 交互钉

1. **生成中只有进度，没有确认**：本地逐帧预览、云端等待、恢复原任务时，右栏不出现绿色确认；不让用户点一个「点了也没回音」的钮。
2. **生成完才亮**：最后一帧预览落稳后，右栏出现**唯一一颗**绿色「确认布置」，并给一句轻提示「这版好了；确认才写进画布」。不自动抢输入框焦点。
3. **点不动就不亮**：`blocked` / `stale` / `expired` / 云端忙时，确认按钮不能以绿色可点的样子出现；原因仍用现有文案说明。
4. **座位行**：有 `guests` 时在提案卡显示 `座位 12 / 30 · 还差 18`；够坐时写 `按 30 人摆了 30 座`；不重复聊天里已经说过的一长段。
5. **改法链**：座位不足时显示文字链「加座，再排一版」；点击后旧确认立即消失、进入生成进度，生成完再出新的唯一确认；不自动应用。
6. **补不齐的诚实**：新一版仍不足时，说「这版最多摆 X 座，还差 N 位；可以换更大的场地，或按站立留空」，不继续暗示再点就能补齐。
7. **一屏一绿**：整个过程中 `.sc-agent-panel .btn-primary` 最多一颗；座位改法、撤回、换一版都走文字链/chip。
8. **深工具同一规则**：`creative-studio` 的候选卡在 `studio.busy` 时不显示确认；完成后才显示，且仍是一颗绿钮。
9. **不改变确认后的行为**：确认布置仍一次落盘、进撤销栈；Undo 仍清空右栏；导出链路不动。

---

## 6. 验收 checkbox（PASS/FAIL）

- [ ] 本地生成（四步进度）期间，右栏没有绿色「确认布置」、没有可聚焦的 `#step-cta`。
- [ ] 云端忙 / 恢复中时，右栏与深工具都不出现可点的绿色确认；只显示进度或安静提示。
- [ ] 生成完成后，右栏恰有一颗绿色「确认布置」；`blocked` / `stale` / `expired` 时不出绿钮，原因可见。
- [ ] 深工具候选卡在 `studio.busy` 时无确认按钮，busy 结束后才出现。
- [ ] 30 人 / 12×9 这类会缺座的提案，卡片显示「座位 X / 30 · 还差 N」与文字链「加座，再排一版」。
- [ ] 点「加座，再排一版」：旧确认立即消失、进入生成进度；新预览出来前不写画布；不自动应用。
- [ ] 座位优先的新版：能补则 `seats >= guests` 并如实播报；补不齐则如实说「这版最多 X 座」，不虚报。
- [ ] 全流程 `.sc-agent-panel .btn-primary` 最多一颗；座位入口不是绿钮。
- [ ] 确认布置、撤销、导出、左栏简报、左轨三图标均未被本卡改变。
- [ ] 新测试全绿；`npx tsc --noEmit` 干净；本卡 JS/TS 文件 eslint 0 error。
- [ ] 真机（`127.0.0.1:3026/editor`）走一遍：生成中无确认 → 生成完一颗确认 → 座位不足出改法链 → 点它再预览 → 补不齐/补齐两种文案 → 确认/撤销；证据写进 `docs/T-05-SELF-CHECK.md`。

---

## 7. 自测命令

```bash
cd frontend
npx vitest run components/room-organizer/lib/agent-proposal.test.ts \
  components/room-organizer/panels/agent-panel.react.test.tsx \
  components/room-organizer/panels/creative-studio.react.test.tsx
npx tsc --noEmit
npx eslint components/room-organizer/lib/agent-proposal.ts \
  components/room-organizer/lib/agent-proposal.test.ts \
  components/room-organizer/panels/agent-panel.tsx \
  components/room-organizer/panels/agent-panel.react.test.tsx \
  components/room-organizer/panels/creative-studio.tsx \
  components/room-organizer/panels/creative-studio.react.test.tsx
```

---

## 8. 交付纪律

- 未 commit、未 push、未部署、未开 PR；合入只由人点名。
- 只改 §3 列出的路径；发现蓝图与代码现状不符就停手标「待核」，不静默扩 scope。
- 做完先按 §6 自测，把结果写进 `docs/T-05-SELF-CHECK.md`，再向用户报告并停等验收。
- 一次只做这一张卡；不重开 T-UI / T-03 / T-04，不接真模型，不做 3DGS / mood / 14 键。

版本 2026-10-27 · 用户点名下一卡后开卡 · 实现 AI 只改本卡 In 列表。
