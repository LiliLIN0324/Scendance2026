# T-UI 可见交互收口 · 自检（框架首卡）

> 2026-10-27 · 卡：`docs/T-UI-VISIBLE-INTERACTION.md` · 环境：`http://127.0.0.1:3026/editor`（headless Chrome + CDP，未登录本地工作台，演示规则生成）· 未接真 AI / 未碰 3dgs、mood、14 键
> 结论：§5 十条验收全部 **PASS**。需验收拍板的只剩「深工具内部仍保留六 Tab」——只在显式点开后出现，主路径不可见，见 §5 待核 ①。

## 1. §5 验收 checkbox

| 验收问题 | 结论 | 证据 |
|---|---|---|
| 空闲右栏无绿导出钮 | **PASS** | 空闲态 `.sc-agent-panel .btn-primary` 数量 0；抬头无 `n/4` 进度。`01-idle.png` |
| 左栏无六 Tab | **PASS** | 左轨按钮恰为 `布置 / 评审 / 执行` 三枚；左栏默认「活动简报」，无「活动安排 / 物料工作单 / 制作计划 / 数量点验 / 导出 / 本机备份」Tab 条；六 Tab 只在显式打开的执行资料深工具里（见 §2-6）。`01-idle.png`、`14-back-brief.png` |
| 左栏简报跟聊天 | **PASS** | 对话说「场地 12×9 米」→ 简报变 `室内 · 12 × 9 m · 108 m²`，无需表单重填。`02-after-chat.png` |
| 导出意图 → 预览 → 一确认 | **PASS** | 说「导出给搭建方」→ 出「导出完整活动交接」卡；全屏唯一绿钮 `确认导出`（提案待确认时 `确认布置` 已降为描边 chip）；确认后提示「完整活动交接文件已导出，可离线打开与打印」。`03-export-preview.png`、`04-export-done.png` |
| 布置确认文案统一 | **PASS** | 提案预览主钮只有「确认布置」；代码中提案链路的「确认应用」已清零（残留仅材质版本的「确认应用到选定物件」，是另一操作，见待核 ②）。`10-proposal.png` |
| Undo 清右栏 | **PASS** | 确认布置后点画布工具栏「撤销」→ 预览卡/提案态消失、`.btn-primary` 数量 0，右栏提示「画布改过了（撤销或手动调整）…」。`11-confirmed.png`、`12-undone.png` |
| 演示条仍在 | **PASS** | `agent-panel.tsx:1138` 仍渲染「演示环境 · 方案由本机规则生成，未连接真实 AI 模型」，真机可见。`01-idle.png` |
| Out 未破 | **PASS** | 左轨三图标；未动 mood / 3dgs / 真 LLM / 14 键；未 commit / push / 部署 / 开 PR。 |
| 测试 / 类型 / lint | **PASS** | 卡片四套件 **251** 条 + 相邻三套件 **106** 条全绿；`npx tsc --noEmit` 退出码 0；eslint 本卡 JS/TS 文件 **0 error**（12 条既有 `react-hooks/exhaustive-deps` warning）。 |
| 真机证据写入本文件 | **PASS** | 见 §2（截图在 `C:\Users\13266\AppData\Local\Temp\tui-shots\`，临时目录、不入库）。 |

## 2. 真机走查

方法：dev server `127.0.0.1:3026`；因 app 内浏览器截图返回 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，改用本机 Chrome headless + CDP（1440×900）做 DOM 量测与点击，截图存临时目录。

1. **空闲**（`01-idle.png`）：左轨仅三枚流程图标；左栏「活动简报」；右栏零绿钮、无向导进度；演示条在顶部。
2. **简报联动**（`02-after-chat.png`）：对话改场地尺寸后，左栏 `室内 · 12 × 9 m · 108 m²` 同步，画布标题一致。
3. **导出**（`03-export-preview.png`、`04-export-done.png`）：导出预览卡一颗通栏绿钮 + 「先不了」文字链；确认后进入导出完成提示。提案挂起时再开导出预览，DOM 主钮列表仍只有 `["确认导出"]`（新增回归测试锁定）。
4. **布置确认与撤销**（`10-proposal.png`、`11-confirmed.png`、`12-undone.png`）：提案主钮 `确认布置`；确认落盘后撤销，右栏提案卡与绿钮同步清空。
5. **三模式与窄宽**（`05-mode-布置/评审/执行.png`、`06-1100.png`）：切模式只换聊天上下文，左栏不换整页表单；1100px 宽无横向溢出。
6. **深工具回路**（`13-deep-delivery.png` → `16-deep-headed.png`）：显式点开「执行资料」后，抽屉抬头恢复「活动简报 / 执行资料」上下文签与收起钮；程序化聚焦的容器不再画浏览器默认黑框；抽屉 380px，`scrollWidth == clientWidth`；六 Tab 只存在于该深工具内部。`14-back-brief.png` 回简报，`15-collapsed.png` 收起后焦点回当前活动区。

## 3. 本轮改动要点（仅非显然项）

- 左轨第四枚「工具」钮移除；七件深工具改由「活动简报」底部折叠区或「活动资料」上下文签**显式点击**打开。`workspaceOpenRequest` 只在点击时自增，避免挂载自开，并保住「回到上次分类」。
- 一屏一绿：导出预览打开时把提案主钮降为 `chip btn-outline`；导出卡只留一颗通栏主钮 + 文字链；新增回归测试固定该规则。
- 深工具抽屉恢复抬头/上下文签；`[role="group"]:focus` 去浏览器默认描边；简报页 292px、深工具 380px，避免 380px 固定页压窄简报。
- 相关文件：`room-organizer.tsx`、`panels/creative-studio.tsx`、`panels/agent-panel.tsx`、`panels/agent-panel.css` 及对应测试（均在卡 In 列表内）。

## 4. 测试与环境

- `npx vitest run`（卡片四套件）：**4 files / 251 tests passed**。
- 相邻回归（`app/page.test.tsx`、`scene-delivery-panel.react`、`project-review-panel.react`）：**3 files / 106 tests passed**。
- `npx tsc --noEmit`：退出码 0。
- `npx eslint`（卡 §6 八个 JS/TS 文件）：0 error，12 warning（均为全库既有 `react-hooks/exhaustive-deps`，本卡未新增）。
- 全量回归：两跑分别为 **3642 过 / 9 失败**、**3647 过 / 4 失败**。第二跑的 4 个失败中，`share.test` 单跑通过（负载偶发）；`backend-generation` / `project-review` / `scene-presets` 单跑稳定复现，属 HEAD 既有欠账（上一轮已 stash 验证），非本卡回归。首跑多出的 creative-studio 5s 超时在定向与复跑中均通过。

## 5. 待核（未扩 scope）

1. **深工具内部仍见六 Tab**：显式打开「执行资料」后仍有六 Tab；深「活动需求」面板仍有「生成布置预览」，但当前是 `is-manual` 白底描边、不是绿主钮。卡只要求主路径杀掉/隐藏，本轮按「深埋、主路径不可见」实现；若验收要求深工具内也零 Tab，请另点名开卡。
2. **「确认应用到选定物件」**：出现在材质版本工具里，是应用材质而非确认布置；若 §4-4「禁止第二颗确认应用」按字面覆盖所有深工具，需另改。
3. **两份 `package.json` 去 BOM**：为让 vitest 正常解析做的环境修复，不在本卡 In 列表；未提交。若验收要求还原，可单独回退（不影响产品行为）。
4. **三份新框架文档未提交**：`CHANGELOG.md`、`docs/AI-NATIVE-FOR-EXECUTORS.md`、`docs/ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md`，按用户指示先不 commit。

## 6. 停手

按卡 §7：不 commit、不 push、不部署、不开 PR、不开下一张卡。等用户验收。
