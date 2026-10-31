# T-05 生成完再亮确认 + 座位不够给改方案 · 自检

> 2026-10-27 · 卡：`docs/T-05-TASK-CARD.md` · 环境：`http://127.0.0.1:3026/editor`（headless Chrome + CDP，1440×900，未登录本地工作台，演示规则生成）
> 结论：§6 十一条验收全部 **PASS**。未 commit / push / 部署 / 开 PR，停等验收。

## 1. §6 验收 checkbox

| 验收问题 | 结论 | 证据 |
|---|---|---|
| 本地生成期间右栏无绿「确认布置」、无可聚焦 `#step-cta` | **PASS** | 真机生成中 DOM：`progress=true, cta=false, greens=0`；提案卡整张不渲染。`01-generating.png`；单测「shows only progress while generating…」 |
| 云端忙 / 恢复中不出现可点的绿色确认 | **PASS** | 云端忙时卡片只留「正在整理这一版…」，`#step-cta` 与「放弃」都不渲染；stale 时无绿钮、原因留在卡内。单测「never shows a green confirm while the cloud is still writing this version」「drops the green confirm when the cloud preview has gone stale」 |
| 生成完成后右栏恰一颗绿色「确认布置」；blocked / stale / expired 不出绿钮 | **PASS** | 真机每张提案卡 `.sc-agent-panel .btn-primary` 数量 = 1；blocked 时卡片不渲染确认钮，只留原因与「撤回 / 换一版」。`02-seat-gap.png`、`04-seated.png` |
| 深工具候选卡在 `studio.busy` 时无确认，busy 结束才出现 | **PASS** | 深工具候选卡改为 `stale → busy → 确认/放弃` 三选一；应用在途时只剩「正在整理这一版…」。单测「hides the confirm while the cloud is still writing this version」 |
| 30 人 / 12×9 的提案卡显示座位缺口与「加座，再排一版」文字链 | **PASS** | 真机：`座位 16 / 30 · 还差 14`，文字链 `.ap-link`，非绿钮。`02-seat-gap.png` |
| 点「加座，再排一版」：旧确认立即消失、进入进度；新预览前不写画布、不自动应用 | **PASS** | 真机点击后：`progress=true, cta=false, card=false`，对话气泡出现「加座，再排一版」；`onApply` 在确认前 0 次。`03-seat-regenerating.png`；单测量 `onApply` 未调用 |
| 座位优先新版：能补则 `seats >= guests` 并如实播报；补不齐则如实说最多多少座 | **PASS** | 12×9：新版 `按 30 人摆了 30 座`、改法链消失、仍一颗绿钮，确认后 35 件物料无重叠。5×4：新版 `座位 7 / 30 · 还差 23`，改法链消失，卡内与对话同时说「这版最多摆 7 座…」。`04-seated.png`、`07-small-venue-short.png`；单测 4 条座位优先用例 |
| 全流程 `.sc-agent-panel .btn-primary` 最多一颗 | **PASS** | 真机逐状态采样：生成中 0、提案 1、改法重排中 0、新版提案 1、确认后 0。单测覆盖导出预览叠加时唯一绿钮仍是「确认导出」 |
| 确认布置、撤销、导出、左栏简报、左轨三图标未被本卡改变 | **PASS** | 确认后摘要「108 ㎡ · 35 件物料 · 没有重叠」；撤销后画布回 5 件、摘要卡消失、右栏提示「画布改过了…」。`05-confirmed.png`、`06-undone.png`；既有 T-UI / T-03 测试全绿 |
| 新测试全绿；`npx tsc --noEmit` 干净；本卡 JS/TS 文件 eslint 0 error | **PASS** | 三套件 **3 files / 249 tests passed**；tsc 退出码 0；eslint **0 error**（18 条既有 warning，未新增） |
| 真机走一遍：生成中无确认 → 一颗确认 → 座位缺口改法链 → 再预览 → 补齐/补不齐两种文案 → 确认/撤销 | **PASS** | 12×9 补齐路径与 5×4 补不齐路径各走一遍，截图见 §2 |

## 2. 真机走查

方法：dev server `127.0.0.1:3026`；app 内浏览器截图仍返回 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，改用本机 Chrome headless + CDP 驱动与截图。截图存 `C:\Users\13266\AppData\Local\Temp\t05-shots\`（临时目录、不入库）。

### 2.1 12×9 / 30 人：补齐路径

1. 对话发「30 人，室内 12×9」→ 生成中只出五步进度，`#step-cta` 不存在、绿钮 0 颗（`01-generating.png`）。
2. 最后一帧落稳 → 提案卡出现：`座位 16 / 30 · 还差 14`、文字链「加座，再排一版」、唯一绿「确认布置」（`02-seat-gap.png`）；对话气泡同时说「只摆得下 16 座，其余 14 位按站立留空」。
3. 点「加座，再排一版」→ 旧卡与绿钮立即消失，右栏回到「正在定舞台位置 · 2/5」，画布只显示候选线框；`onApply` 未被调用（`03-seat-regenerating.png`）。
4. 新版落稳 → `按 30 人摆了 30 座`，改法链消失，仍恰一颗绿「确认布置」（`04-seated.png`）。
5. 点「确认布置」→ 摘要卡「108 ㎡ · 35 件物料 · 没有重叠，也没超出场地」；画布 4 组餐桌共 30 座（`05-confirmed.png`）。
6. 点画布工具栏「撤销」→ 画布回 5 件物料，摘要卡与绿钮清空，对话提示「画布改过了（撤销或手动调整）…」（`06-undone.png`）。

### 2.2 5×4 / 30 人：补不齐路径

1. 首版：`座位 4 / 30 · 还差 26`，文字链存在，绿钮 1 颗。
2. 点「加座，再排一版」→ 生成中无确认；新版：`座位 7 / 30 · 还差 23`，改法链消失，卡内写「场地最多摆得下 7 座；要再多人，得换更大的场地或按站立留空。」，对话同步「这版最多摆 7 座，还差 23 位…」，仍只有一颗绿钮（`07-small-venue-short.png`）。没有把站立人数算成已坐，也没有暗示再点一次就能补齐。

## 3. 本轮改动要点（仅非显然项）

- **确认时机**：右栏 `proposal` 只在 `phase === 'proposed'` 时暴露；生成中与暂停（逐帧未完）都不给出提案卡，避免确认一颗「应用的是最后一帧、但人只看到半截」的钮。
- **点不动就不亮**：`blocked`（含云端 stale / expired / 动了锁定件）时不渲染确认钮，原因行保留；云端 `busy` 时卡片只留「正在整理这一版…」。
- **座位如实数**：`proposePlan` 的 `seats` 改为对最终候选里 `chair` + `dining-chair` 逐件计数（含锁定件，不含站立人数）；`seatPriority` 只在点击「加座」后为真。
- **加座边界**：座位优先只给这一版新摆的桌子补座，先试桌边角位，再用既有 1 米网格找空位；每次落座都过 `hasCollisions` + `canApplyLayoutGeometry`，并额外拒绝压在餐桌上的椅子（碰撞层把「椅在桌上」当有意叠放，不能借这条规则凑数）。
- **诚实文案**：普通版缺口说「只摆得下 X 座，其余 N 位按站立留空」；点击加座后仍不足改说「这版最多摆 X 座，还差 N 位；可以换更大的场地，或按站立留空」，卡片同时撤掉改法链。
- **深工具同一规则**：`creative-studio` 候选卡在 `studio.busy` 时收起「确认布置 / 放弃」，只显示安静进度；busy 结束且预览未 stale 才恢复。
- 涉及：`lib/agent-proposal.ts` + `.test.ts`、`panels/agent-panel.tsx` + `.css` + `.react.test.tsx`、`panels/creative-studio.tsx` + `.react.test.tsx`（均在卡 §3 In 列表内）。

## 4. 测试与环境

- 卡 §7 三套件：`npx vitest run components/room-organizer/lib/agent-proposal.test.ts components/room-organizer/panels/agent-panel.react.test.tsx components/room-organizer/panels/creative-studio.react.test.tsx` → **3 files / 249 tests passed**。
  - `agent-proposal.test.ts`：19 条（含新增 4 条座位优先）。
  - `agent-panel.react.test.tsx`：18 条（含新增 4 条确认时机 / 座位改法）。
  - `creative-studio.react.test.tsx`：212 条（含新增 1 条忙时不亮确认）。
- `npx tsc --noEmit`：退出码 0。
- `npx eslint`（卡 §7 六个 JS/TS 文件）：**0 error**，18 warning（均为全库既有 `react-hooks/exhaustive-deps` / `no-img-element`，本卡未新增）。

## 5. 待核（未扩 scope）

1. **云端座位策略**：按卡 §2 待核 ②，座位优先只在本地规则生成器生效；深工具 / 云端提案不计算 `seats`，因此座位行与改法链只出现在本地提案上。接真模型后的座位策略另开卡。
2. **小场地既有挤碰**：5×4 场景里背景板与餐椅本就有 2 处挤碰（普通版同样存在），本卡没有放大它；座位优先版的可确认性仍以 `blocked` 几何闸为准。材质名 `Dining Chair` 未本地化也是既有文案，不在本卡范围。
3. **暂停态的提案卡**：本卡把暂停（逐帧未完）归入「预览未落稳」，因此暂停时只显示进度与「接着摆」，不显示提案卡。若验收希望暂停时仍能看到半截提案，需要另开卡设计「暂停到哪一帧就确认哪一帧」的语义。
4. **深工具忙时的真机证据**：离线演示环境没有云端应用在途的窗口，此条由单测覆盖；真机只走了本地补齐 / 补不齐、确认与撤销。

## 6. 停手

按卡 §8：未 commit、未 push、未部署、未开 PR、未开下一张卡。等用户验收。
