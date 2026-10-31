# T-03 快速优化 · 任务卡

> 卡号：**T-03**（对话四步 ③ 快速优化）
> 用户点名：2026-10-26「T-02 验收过。T-03 可以开。范围钉死：③快速优化——「改一版」可预览可撤销、不代拖画布、只报冲突/动线+可一点改法；不装合规；氛围未点名不开。」
> 依赖：T-01（可布置壳体）+ T-02（提案 → 预览 → 确认/撤回）。

---

## 1. 一句话任务

在已确认的画布布置上，用手指一句话让晴光做一次**快速体检**：只报**冲突**（重叠 / 出界 / 压墙柱 / 挡住入口留空）和**动线**（桌椅拉椅空间 / 桌间过道），每条给一个**当场可点的改法**。改法只出画布预览，**确认前不写画布**；确认后进撤销栈，一步可整体退回。**不代拖、不装合规、不碰氛围。**

---

## 2. In（本卡只改这些路径）

| 路径 | 改动 |
|---|---|
| `frontend/components/room-organizer/lib/layout-review.ts` | 新增纯函数：`reviewLayout` 体检；`proposeReviewFix` 一点改法；不含 React / 存储 / 网络 |
| `frontend/components/room-organizer/lib/layout-review.test.ts` | 新增：冲突、动线、锁定跳过、无入口不瞎报、无合规词、不 mutate 输入 |
| `frontend/components/room-organizer/lib/workbench-agent.ts` + `.test.ts` | 新增 `isReviewCommand` 意图（体检 / 哪里有问题 / 改一版 / 太挤 / 动线 / 冲突），并补测试 |
| `frontend/components/room-organizer/lib/agent-proposal.ts` | 仅给 `PlanProposal` 加 `moved?` 与 `kind?: 'review'` 两个可选字段；不改生成算法 |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | 对话路由 → 体检播报 → 每问题一个「按这条改」→ 复用现有预览/确认/撤回；卡片与进度步适配「只挪位置」 |
| `frontend/components/room-organizer/panels/agent-panel.css` | 只补体检问题气泡/卡片的必要样式；不改 14 键、左轨、logo |
| `frontend/components/room-organizer/panels/agent-panel.react.test.tsx` | 新增聚焦测试：体检 → 改法预览 → 确认前不变 → 确认一次 apply → 撤回不变 → 锁件报出 |
| `docs/T-03-SELF-CHECK.md` | 新增：验收 checkbox + 真机证据 + 待核 |
| `CHANGELOG.md` | 追加 T-03 一条 |

---

## 3. Out（明确不做）

- **14 键工具列**：不加、不减、不改位置；座位数算法不动（仍挂下一轮）。
- **氛围**：mood / 天气 / Bloom / 室内雨 / bake 进 Scene / NPC / 新开氛围页 —— 本卡零氛围码；用户不点名就不开。
- **合规**：不出现「消防 / 疏散 / 无障碍 / 合规认证 / 验收通过」结论；只报画布上的几何事实。
- **代拖 / 静默 apply**：不直接改 `layout`、不 dispatch、不自动确认；只有人点「确认布置」才 `onApply`。
- **T-04**：评审链接、执行导出、客户页、交付资料全不碰。
- **场地真相**：不改 `venue.site` / 层高 / 墙门环 / 比例；发现尺度问题只提示回 T-01。
- **真 AI / 新 API / 3dgs-demo**：不接、不改、不调。
- **新页面 / 新表单**：不新增第二条生成或优化入口；一切从右栏对话发起。
- **自动整场重排 / 满场排座 / 物理仿真 / 承重计算**：不做。

---

## 4. 交互与文案钉

1. **入口只有对话**：说「看看哪里有问题」「体检」「改一版」「太挤了」等 → 晴光检查**画布当前实际布置**。已有未确认预览时先回：「这一版还在预览里：先点「确认布置」或「撤回」，我再按画布上的实际布置体检。」
2. **体检口径**：先说一句「不是合规审查」。冲突按件报，动线按组报；无入口/门数据时明确说「没有可识别的入口，入口通道我不猜」，不虚构。
3. **一点改法**：每条问题最多一个动作胶囊「按这条改：…」；最多同时给 3 条，其余收成一句「还有 N 条…」。没有稳妥改法就直说「这一条我没想到稳妥的自动改法」，不给假按钮。
4. **预览仍走 T-02 同一套**：点改法 → 蓝框 = 挪到的新位置，琥珀线框 = 原位；右栏卡片主钮仍是**「确认布置」**，次要是**「撤回」**；卡片写明「只挪位置，其他没动」。
5. **确认前不落盘**：`localStorage`、场景、撤销栈都不动；确认才一次 `applyLayout`，撤销一步整体退回。
6. **锁定件**：一律不挪；能改的改，锁着的跳过并在气泡/卡片报出件数。
7. **进度**：改法预览亮对话第 **③ 优化**；不是第四步，也不改左轨三图标。
8. **话术禁词**：「已帮你摆好」「已保存」「消防验收」「合规」；确认前只说「还没落盘」。

---

## 5. 验收 checkbox（PASS/FAIL）

- [ ] 说「看看哪里有问题」→ 右栏报出画布上的冲突/动线问题，且明确「不是合规审查」。
- [ ] 场地无可识别入口/门时，如实说明「入口通道我不猜」，不虚构入口问题。
- [ ] 每条问题最多一颗「按这条改」；无稳妥改法时如实说明，不硬挪。
- [ ] 点改法 → 只出画布预览（蓝框新位 / 琥珀原位），**确认前 `localStorage` 与场景不变**。
- [ ] 点「撤回」→ 预览收回，画布与确认前一致，不产生撤销记录。
- [ ] 点「确认布置」→ 只调用一次 `onApply`，进撤销栈；撤销一步能整体退回。
- [ ] 改法只挪已有物料：`added=0`、不删件；锁定件不动且报出跳过件数。
- [ ] 改法预览亮第 ③ 步；主钮仍是「确认布置」；14 键与左轨三图标未动。
- [ ] 不装合规：问题与改法文案里无消防/疏散/无障碍/合规结论。
- [ ] 氛围未点名不开：本卡零 mood/天气/Bloom/NPC 改动。
- [ ] `layout-review` 与 `workbench-agent` 新测试全绿；面板聚焦测试全绿；`tsc --noEmit` 干净；改动文件 eslint 0 error。
- [ ] 真机（`127.0.0.1:3026/editor`）跑一遍：体检 → 点改法 → 撤回 → 再点改法 → 确认 → 撤销；证据写进 `docs/T-03-SELF-CHECK.md`。

---

## 6. 自测命令

```bash
cd frontend
npx vitest run components/room-organizer/lib/layout-review.test.ts \
  components/room-organizer/lib/workbench-agent.test.ts \
  components/room-organizer/panels/agent-panel.react.test.tsx
npx tsc --noEmit
npx eslint components/room-organizer/lib/layout-review.ts \
  components/room-organizer/lib/layout-review.test.ts \
  components/room-organizer/lib/workbench-agent.ts \
  components/room-organizer/lib/workbench-agent.test.ts \
  components/room-organizer/panels/agent-panel.tsx \
  components/room-organizer/panels/agent-panel.react.test.tsx
```

---

## 7. 交付纪律

- 工作树已有 T-01/T-02 未提交改动；按用户「未另点名不 commit / push / 部署」的硬规则，本卡**不提交、不推送、不部署**，也不擅自开 PR；合入只由人。
- 只改 §2 列出的路径；发现蓝图与代码不符就停手标「待核」，不静默扩 scope。
- 做完先按 §5 自测，把结果写进 `docs/T-03-SELF-CHECK.md`，再向用户报告并停等验收。

版本 2026-10-26 · 用户口头钉死 T-03 范围后开卡 · 实现 AI 只改本卡 In 列表。
