# 全量 vitest 基线失败台账 · origin/main @ 0a59f7b0

> 用途：合入前先跑全量。**失败文件不在本台账，或同一文件 failed 数明显上涨，才算回归**；台账本身是既有环境债，不是待修清单。
> 台账只在 main 基线变化时更新；分支合入不需要改它。

## 1. 采集口径

| 项 | 值 |
| --- | --- |
| 提交 | `0a59f7b0`（origin/main） |
| 命令 | `cd frontend && npx vitest run` |
| 环境 | Windows · Node v26.2.0 · npm 11.13.0 · vitest ^4.1.10 |
| 采集时间 | 2026-11-17 |
| 复跑要求 | Node 必须与台账同版本档（本台账 v26.2.0）；engines 要求 `>=24.15 <25 \|\| >=26`，Node 22 不满足、禁止用于全量/build；24 与 26 混跑会让失败集漂移，结果不可比 |
| 原始日志 | 本机 `%TEMP%\scendance-vitest-merged.log`（UTF-16LE，不入库） |

## 2. 汇总

| 指标 | 数值 |
| --- | --- |
| Test Files | **111 failed** / 547 passed（658） |
| Tests | **1710 failed** / 7110 passed / 73 skipped（8893） |

对照基线 `13258414`：112 failed / 542 passed（654 文件）。当前基线多出 4 个新测试文件，且全部在通过侧，失败文件数由 112 降到 111。

## 3. 已知 flaky（单独复跑可通过）

- `components/room-organizer/three/structure-satellite.test.ts`
- `components/room-organizer/three/agent-preset-flow.test.ts`
- `components/room-organizer/three/scene-presets.test.ts`
- `components/room-organizer/three/plan-traffic-layer.test.ts`
- `components/room-organizer/lib/share.test.ts`

> 这些文件在并行全量下受计时/资源影响；失败时先单独 `npx vitest run <file>` 复跑，不要直接记为回归。

## 4. 使用方式

1. 待合分支在干净 worktree 跑 `npx vitest run`，保留完整日志；
2. 从日志提取失败文件：`node -e` 按 `❯ <file> (N tests | M failed)` 解析，或直接用 `--reporter=json`；
3. 与本台账 CSV（`vitest-baseline-0a59f7b0.csv`）按文件对比：
   - 台账外的新失败文件 → 先复跑；仍失败即回归；
   - 台账内文件 failed 数上涨 → 先复跑；仍上涨即回归；
   - 台账内文件消失或 failed 数下降 → 允许，顺手更新台账；
4. 合并后若要刷新台账，用同一命令重采集并替换 CSV/Markdown，文件名带 main 提交号。
5. **锚点刷新**：台账锚定采集时的 main 提交；main 进入里程碑（失败集稳定）后重新采集，新增 `vitest-baseline-<sha>.md/.csv`，旧台账保留为历史债务快照。不要用旧台账的绝对失败数对照新 main，只用它判断「分支相对其基线是否新增失败」。

## 5. 失败文件清单（111）

| 文件 | failed | total | skipped |
| --- | ---: | ---: | ---: |
| `app/error.test.ts` | 8 | 10 | 0 |
| `app/global-error.react.test.tsx` | 4 | 4 | 0 |
| `app/layout.react.test.tsx` | 6 | 6 | 0 |
| `app/page.test.tsx` | 9 | 9 | 0 |
| `app/projects/page.react.test.tsx` | 14 | 14 | 0 |
| `components/intro/auth-card.test.tsx` | 16 | 16 | 0 |
| `components/review-share-page/review-share-page.react.test.tsx` | 11 | 11 | 0 |
| `components/room-organizer/components/outdoor-facility-generate.test.tsx` | 12 | 12 | 0 |
| `components/room-organizer/components/outdoor-plan-overlay.merge.react.test.tsx` | 7 | 7 | 0 |
| `components/room-organizer/hooks/use-assistant-sessions-active.react.test.tsx` | 5 | 5 | 0 |
| `components/room-organizer/hooks/use-import-export-capability.test.tsx` | 2 | 2 | 0 |
| `components/room-organizer/hooks/use-layout-persistence-capability.react.test.ts` | 3 | 3 | 0 |
| `components/room-organizer/hooks/use-layout-persistence-switch-race.react.test.ts` | 8 | 8 | 0 |
| `components/room-organizer/hooks/use-layout-persistence.hydrate.react.test.ts` | 7 | 7 | 0 |
| `components/room-organizer/hooks/use-layout-persistence.react.test.ts` | 72 | 74 | 0 |
| `components/room-organizer/hooks/use-layout-persistence.share-budget.react.test.ts` | 1 | 1 | 0 |
| `components/room-organizer/hooks/use-material-checkins.react.test.tsx` | 3 | 9 | 0 |
| `components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx` | 58 | 58 | 0 |
| `components/room-organizer/hooks/use-scene-effects.react.test.ts` | 1 | 15 | 0 |
| `components/room-organizer/hooks/use-silent-cloud-attach.react.test.tsx` | 20 | 20 | 0 |
| `components/room-organizer/hooks/use-splat-calibration-readonly.react.test.tsx` | 2 | 2 | 0 |
| `components/room-organizer/lib/aholo-assets.test.ts` | 13 | 13 | 0 |
| `components/room-organizer/lib/aholo-model-placement.test.ts` | 12 | 15 | 0 |
| `components/room-organizer/lib/asset-cloud.test.ts` | 6 | 6 | 0 |
| `components/room-organizer/lib/assistant-brief-memory.test.ts` | 17 | 17 | 0 |
| `components/room-organizer/lib/bingo-feedback.test.ts` | 1 | 5 | 0 |
| `components/room-organizer/lib/cloud-material-draft.test.ts` | 1 | 3 | 0 |
| `components/room-organizer/lib/environment-position-transaction.test.ts` | 7 | 7 | 0 |
| `components/room-organizer/lib/environment-preference.strict.test.ts` | 12 | 12 | 0 |
| `components/room-organizer/lib/environment-preference.test.ts` | 4 | 4 | 0 |
| `components/room-organizer/lib/environment-write-reconciliation.test.ts` | 9 | 9 | 0 |
| `components/room-organizer/lib/event-layout-agent.test.ts` | 2 | 15 | 0 |
| `components/room-organizer/lib/facility-generated-models.test.ts` | 6 | 27 | 0 |
| `components/room-organizer/lib/library-lease.test.ts` | 5 | 5 | 0 |
| `components/room-organizer/lib/library.test.ts` | 12 | 17 | 0 |
| `components/room-organizer/lib/local-scans.test.ts` | 6 | 6 | 0 |
| `components/room-organizer/lib/local-seating-draft.test.ts` | 1 | 13 | 0 |
| `components/room-organizer/lib/lux3d-import.test.ts` | 8 | 8 | 0 |
| `components/room-organizer/lib/outdoor-plan-adoption.test.ts` | 5 | 5 | 0 |
| `components/room-organizer/lib/pending-brief.test.ts` | 9 | 9 | 0 |
| `components/room-organizer/lib/persistence.test.ts` | 28 | 51 | 0 |
| `components/room-organizer/lib/place-search.test.ts` | 3 | 22 | 0 |
| `components/room-organizer/lib/plan-facility-models.test.ts` | 1 | 31 | 0 |
| `components/room-organizer/lib/plan-ground-capture.test.ts` | 2 | 9 | 0 |
| `components/room-organizer/lib/reported-inventory.test.ts` | 13 | 13 | 0 |
| `components/room-organizer/lib/review-link-versions.test.ts` | 6 | 6 | 0 |
| `components/room-organizer/lib/review-share.test.ts` | 2 | 2 | 0 |
| `components/room-organizer/lib/safe-storage.test.ts` | 3 | 3 | 0 |
| `components/room-organizer/lib/scene-delivery.test.ts` | 1 | 24 | 0 |
| `components/room-organizer/lib/scene-layers.test.ts` | 12 | 13 | 0 |
| `components/room-organizer/lib/share-records.test.ts` | 4 | 8 | 0 |
| `components/room-organizer/lib/site-calibration-capability.test.ts` | 7 | 7 | 0 |
| `components/room-organizer/lib/unlinked-venue-export.test.ts` | 11 | 11 | 0 |
| `components/room-organizer/lib/venue-facts-storage.test.ts` | 9 | 9 | 0 |
| `components/room-organizer/lib/version-history-capability.test.ts` | 4 | 4 | 0 |
| `components/room-organizer/lib/workspace-write-guards.react.test.tsx` | 5 | 5 | 0 |
| `components/room-organizer/panels/activity-task-workspace.react.test.tsx` | 55 | 55 | 0 |
| `components/room-organizer/panels/agent-chat-capability.test.ts` | 3 | 3 | 0 |
| `components/room-organizer/panels/agent-panel.react.test.tsx` | 449 | 450 | 1 |
| `components/room-organizer/panels/amap-venue-picker.react.test.tsx` | 17 | 17 | 0 |
| `components/room-organizer/panels/bingo-audit-card.react.test.tsx` | 15 | 15 | 0 |
| `components/room-organizer/panels/bingo-feedback-import.react.test.tsx` | 6 | 6 | 0 |
| `components/room-organizer/panels/bingo-rail-button.react.test.tsx` | 8 | 8 | 0 |
| `components/room-organizer/panels/bingo-review-refresh.react.test.tsx` | 5 | 5 | 0 |
| `components/room-organizer/panels/cloud-panel.react.test.tsx` | 83 | 83 | 0 |
| `components/room-organizer/panels/creative-studio.react.test.tsx` | 318 | 364 | 46 |
| `components/room-organizer/panels/generated-model-library.react.test.tsx` | 23 | 23 | 0 |
| `components/room-organizer/panels/generation-sheet.react.test.tsx` | 8 | 8 | 0 |
| `components/room-organizer/panels/local-activities-panel.react.test.tsx` | 1 | 26 | 0 |
| `components/room-organizer/panels/local-activities-startup-save.react.test.tsx` | 2 | 2 | 0 |
| `components/room-organizer/panels/map-venue-overlay.react.test.tsx` | 6 | 6 | 0 |
| `components/room-organizer/panels/online-model-library.react.test.tsx` | 40 | 40 | 0 |
| `components/room-organizer/panels/plan-card-safety.react.test.tsx` | 2 | 7 | 0 |
| `components/room-organizer/panels/project-review-panel.react.test.tsx` | 1 | 39 | 0 |
| `components/room-organizer/panels/recovery-entry.react.test.tsx` | 5 | 5 | 0 |
| `components/room-organizer/panels/scendance-workspace.react.test.tsx` | 7 | 32 | 0 |
| `components/room-organizer/panels/scene-delivery-panel.react.test.tsx` | 4 | 98 | 0 |
| `components/room-organizer/panels/session-history-panel.react.test.tsx` | 5 | 5 | 0 |
| `components/room-organizer/panels/share-menu.react.test.tsx` | 7 | 10 | 0 |
| `components/room-organizer/panels/space-panel.react.test.tsx` | 4 | 4 | 0 |
| `components/room-organizer/panels/team-view.react.test.tsx` | 7 | 7 | 0 |
| `components/room-organizer/panels/venue-facts-panel.react.test.tsx` | 5 | 5 | 0 |
| `components/room-organizer/panels/venue-picker.react.test.tsx` | 12 | 12 | 0 |
| `components/room-organizer/restore-startup-gate.react.test.tsx` | 15 | 15 | 0 |
| `components/room-organizer/room-organizer-annotation-capture.react.test.tsx` | 3 | 3 | 0 |
| `components/room-organizer/room-organizer-annotation-offline.react.test.tsx` | 3 | 3 | 0 |
| `components/room-organizer/room-organizer-canvas-session.react.test.tsx` | 7 | 7 | 0 |
| `components/room-organizer/room-organizer-catalog-placement.react.test.tsx` | 3 | 3 | 0 |
| `components/room-organizer/room-organizer-dialogue-review.react.test.tsx` | 3 | 3 | 0 |
| `components/room-organizer/room-organizer-environment-position.react.test.tsx` | 4 | 4 | 0 |
| `components/room-organizer/room-organizer-map-preservation.react.test.tsx` | 2 | 2 | 0 |
| `components/room-organizer/room-organizer-outcome.react.test.tsx` | 1 | 1 | 0 |
| `components/room-organizer/room-organizer-route-provenance.react.test.tsx` | 4 | 4 | 0 |
| `components/room-organizer/room-organizer-session-generation.react.test.tsx` | 6 | 6 | 0 |
| `components/room-organizer/room-organizer-switch-guard.react.test.tsx` | 1 | 1 | 0 |
| `components/room-organizer/room-organizer-venue-epoch.react.test.tsx` | 1 | 1 | 0 |
| `components/room-organizer/room-organizer-zone-race.react.test.tsx` | 6 | 6 | 0 |
| `components/room-organizer/three/plan-traffic-layer.test.ts` | 1 | 14 | 0 |
| `components/room-organizer/three/structure-satellite.test.ts` | 1 | 9 | 0 |
| `lib/backend-integration.test.ts` | 1 | 12 | 0 |
| `lib/brand-tokens.test.ts` | 1 | 5 | 0 |
| `lib/delivery-private-text.test.ts` | 1 | 2 | 0 |
| `lib/local-auto-login.test.ts` | 5 | 9 | 0 |
| `lib/local-fresh-activity.test.ts` | 3 | 3 | 0 |
| `lib/local-project-backup.test.ts` | 1 | 84 | 0 |
| `lib/local-project-restore.test.ts` | 3 | 20 | 17 |
| `lib/original-review-ledger-idb.test.ts` | 9 | 9 | 0 |
| `lib/pay/client.test.ts` | 5 | 5 | 0 |
| `lib/public-asset-recovery.test.ts` | 1 | 20 | 0 |
| `lib/shared-seating-placement.test.ts` | 4 | 4 | 0 |
| `lib/verify-live-agent-direct.test.ts` | 1 | 4 | 0 |
