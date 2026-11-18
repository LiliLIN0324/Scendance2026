# PR 草稿 · 户外走查与发布事实链（M7 第一批）

> 本文件是给「网络恢复后开 PR」用的逐字草稿：标题、正文、验证输出都按实际跑过的结果写死。
> 开 PR 时整段复制到 GitHub；**不要**把本文件当作已合并的证据。

## 标题

```
feat(outdoor): 户外走查记录本与发布事实链（M7 第一批，28 文件）
```

## 分支

- 源：`agent/outdoor-m7-walkthrough-wire`
- 目标：`main`
- 本地 HEAD：`388a87a5`（47 笔，含 10 个 `Merge branch 'main'` 同步点）
- 基线：`main` = `b9266188`
- 规模：`28 files changed, 3322 insertions(+), 32 deletions(-)`

## 为什么

M7 要回答一个问题：**11 条验收用例，各自到底有没有证据，缺什么**。这一批不做判断自动化，只把「证据」变成可记录、可导出、可核对的事实链：

1. **走查记录本**（`outdoor-walkthrough-book.ts`）——逐条标「看过 / 看过且通过」，不可变、永不下结论；
2. **浏览器证据可注入**（`outdoor-browser-evidence`）——不传记录时与旧行为逐字一致，避免破旧调用；
3. **发布状态一次算齐**（`outdoor-release-bundle.ts`）——卡片、快照、`allGreen`、`gateReady` 共用同一份台账，避免同一条事实算两遍算出两个数；
4. **待补清单 + CSV + 下一步**（`outdoor-release-gaps.ts` / `outdoor-release-csv.ts`）——把台账翻成能贴进工单的清单，CSV 五列**故意不含结论列**；
5. **会话报告扩段**（`outdoor-session-report.ts`）——`[发布状态快照]` `[走查标记]` `[云端声明]` `[逐条判断]` `[待补清单]` `[报告来源]`，末行固定写「本报告只报事实，不构成发布结论」；
6. **面板与导出接线**（`outdoor-walkthrough-board/section`、`outdoor-workflow-card`）——11 行三键、走查日期、导出 CSV 按钮、开跑前检查折叠块，全部受控且可注入，不传就不渲染。

## 验证（固定数据，全部在本分支 HEAD 上跑过）

走查 / 户外相关全部测试文件（69 个）：

```bash
cd frontend
npm test -- $(git diff --name-only main...HEAD | grep -E 'outdoor-.*\.test\.tsx?$|walkthrough.*\.test\.tsx?$' | sed 's#^frontend/##')
```

```text
Test Files  69 passed (69)
Tests  760 passed (760)
```

类型检查：

```bash
cd frontend
npx tsc --noEmit
# 输出 0 行（无错误）
```

合并前总检（整目录 `components/room-organizer`，556 文件）：

```text
分支：Test Files  526–528 passed / 28–30 failed（556）  Tests 6679 通过 / 518 失败 / 56 跳过（7253）
main：对同一批失败文件跑基线（28 文件）→ 23 文件失败 / 511 测试失败
差集：5 文件只在分支失败，单独跑 = 121/121 全过，错误文本全是 Test timed out in 5000ms / 20000ms
```

**结论：本批新增回归 0 条**（在可判定范围内）。那 23 个失败文件在 `main` 上本来就红，本批未触碰；5 个差集文件是并行超时，属那些文件自身测试体量，本批未改。

## 刻意没做（评审时请重点看这几条）

- **不产生「可发布」结论**：卡片、CSV、报告、自检、下一步提示都不下结论；报告末行固定「不构成发布结论」。
- **不从标记推判断**：全绿只由 `isAllGreen()` 从台账算，不从「我标过看过」推。
- **空集合两义分开**：`gaps: []` 表示算过且无缺口；不传表示没算——空台账一律写「没有台账」，不写「无缺口」。
- **不改他人文件**：`main` 上那 23 个红文件、5 个并行超时文件，本批零改动。
- **没跑真实浏览器 / 真实云端**：9222 调试端口连续 56 轮不可用，#2（同名地点地图选中）与 #5（部分地图 / 离线 / 无路网）仍只有固定数据与离线用例，**浏览器、云端两类全部未验**。
- **没推 origin**：本机到 `github.com` 的 TLS 握手连续 10 轮失败（`schannel: failed to receive handshake`），这 47 笔只在本地。

## 建议拆分评审（47 笔一次看不完）

1. **证据层**（`outdoor-walkthrough-*`、`outdoor-browser-evidence`）：先看「标了才算看过、永不下结论」这条线是否成立；
2. **台账与状态**（`outdoor-release-bundle/status-card`）：确认「同一条事实只算一次」；
3. **清单与导出**（`outdoor-release-gaps/csv`、`outdoor-report-download`）：确认 CSV 没有结论列是有意的；
4. **报告**（`outdoor-session-report`、`outdoor-report-sections`）：确认末行固定免责句、缺段只说缺段；
5. **界面**（`outdoor-walkthrough-board/section`、`outdoor-workflow-card`）：确认全部受控、不传不渲染。

## 合并后仍需人做的事

- 用登录态浏览器跑 #2、#5，把结果填进 `docs/plans/2026-11-16-outdoor-evidence-matrix.md`；
- 云端一类证据需真实云端核实，agent 无授权，未做。
