# WIP：户外方案 v1–v8 快照（279 例测试未过）

> Draft。**不要直接合入。** 本分支是未完成现场的存档，基线 `b997da81`，比 `main` 落后 143 个提交，合并前必须先 rebase。

## 这个 PR 里有什么

- 户外方案 v1–v8 的实现与测试：框选场地、能力基线、人群波动/对话、单行排布与提交/撤销、材质语言入口、语义候选三选一与换一换、BOM 与套系、2D 虚线预览与单价、按型号定价与 CSV/Markdown 导出、项目价格本与 HTML 报价、观演区与市集摊位、舞台锚点、3D 虚影与摊位规则。
- 对应纯逻辑单测、`frontend/scripts/verify-*.mjs` 验证脚本、需求与能力基线文档。
- 测试环境修复：`frontend/test-setup.ts` 把 `localStorage` 补到 `Storage.prototype`，兼容 jsdom 30 / Node 26 的 `--localstorage-file` 警告（支持 `vi.spyOn`）。

## 已完成项（本 PR 之外，已在本轮合入本地 main）

- 车辆实体异步挂载 GLB，Box3 落地。
- 生成按 `owner_id` 串行（#123）迁移与回滚/验证脚本。
- `GENERATION_BUSY` 结构化日志（不含 prompt/请求体）。
- 生成中 BUSY 去重、OSM 底图离线降级、软删除 `plan.trash`。
- BOM 双列布局、加载三态、损坏草稿备份。

以上已在 `feat/plan-vehicle-entities` 提交并快进到本地 `main`（`7e513823`），**尚未推送 origin/main**。

## 未完成项：全量测试 279 例失败

实测命令：

```bash
cd frontend
npx vitest run --silent --reporter=json --outputFile=vitest-report.json
```

结果（EXIT=1）：

| 指标 | 数值 |
| --- | --- |
| 测试文件 | 2008（失败 96） |
| 用例 | 8872 |
| 通过 | 8520 |
| 失败 | 279 |
| 跳过 | 73 |

失败分类：

| 类别 | 数量 |
| --- | --- |
| UI 文案/控件缺失 | 168 |
| 断言不符 | 42 |
| 运行时 TypeError | 36 |
| 被测代码抛错 | 29 |
| 其他 | 4 |

集中文件：

| 文件 | 失败数 |
| --- | --- |
| `panels/agent-panel.react.test.tsx` | 175 / 450 |
| `panels/creative-studio.react.test.tsx` | 21 |
| `lib/scene-layers.test.ts` | 12 |
| `panels/map-venue-overlay.react.test.tsx` | 6 |
| `session-generation` / `route-provenance` / `shared-seating-placement` | 各 4 |
| 其余约 40 个文件 | 各 1–3 |

已定位样本：`agent-panel` 的「移除/调整原场景」用例中，面板停在 `data-state="empty"`，预览候选没有进入 feed，期望的「移除 现有椅子（原场景第 1 件）」文案不存在。看起来是状态机/夹具与组件长期漂移，不是本次 `localStorage` 修复引入。

## 建议修复顺序

1. **agent-panel + creative-studio（196 例）**：先修面板状态推导与夹具，再补文案。
2. **scene-layers + map-venue-overlay（18 例）**：图层顺序与场地覆盖层。
3. **剩余约 40 个文件（65 例）**：逐文件收敛，优先 TypeError 与抛错类。

## 已知瑕疵

- 报价面板的输入框仍是局部 state，未持久化进方案。
- 本快照未 rebase，`main` 上已有 143 个后续提交；直接合并会回退这些提交。
- #123 迁移只在本地验证，**尚未上生产**；上线后需执行 `supabase/ops/verify_per_owner_active_generation.sql`。

## 验收口径

- 以 `npx vitest run` 的实测输出为准，不接受估算或历史数字。
- 上述 279 例清零后，再 rebase 到 `main` 并转正式 PR。
