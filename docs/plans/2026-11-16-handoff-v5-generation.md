# 幕景 V5 生成安全切片交接（2026-11-16）

性质：只改统一生成面板与提交回执链路；未 commit / push / PR / 部署；未点击真实生成、未消耗额度。
分支：`fix/outdoor-walk-control`，基线 HEAD `b997da81`。
范围：生成面板 / link / receipt；未碰 V4、OFM、地图主链、人物与漫游。

## 1. 改动文件

| 文件 | 改动 |
| --- | --- |
| `frontend/components/room-organizer/lib/facility-generated-models.ts` | staged 链接增加 `projectId`；新增 `discardFacilityGenerateLink`；新增提交回执存储（requestId/state/taskid/projectId/facilityId），以及按「项目 + 设施」严格分区的 unknown 查询；测试清理函数同步清回执。 |
| `frontend/components/room-organizer/lib/model-generation.ts` | `submitModelJob` 支持调用方传入 `requestId`（缺省仍生成 UUID）；新增 `UNKNOWN_SUBMISSION_NOTICE` 与 `generationFailureDisposition`（4xx=failed，断网/超时/5xx/坏响应=unknown）。 |
| `frontend/components/room-organizer/panels/generation-sheet.tsx` | 提交前落回执、成功显示任务号、unknown 锁禁止二次提交、失败清理 staged、提交当刻捕获项目/设施避免等待期间串目标；重开面板显示上次回执。 |
| `frontend/components/room-organizer/lib/facility-generated-models.test.ts` | 新增 projectId 链接、staged 清理、回执持久化/重载、unknown 隔离、submitting 残留、failed 不锁等用例。 |
| `frontend/components/room-organizer/lib/model-generation.test.ts` | 新增 requestId 透传/UUID 缺省、失败分类与 unknown 文案用例。 |
| `frontend/components/room-organizer/panels/generation-sheet.react.test.tsx` | 新增成功显示 taskid、unknown 不可重提、重开仍锁、明确拒绝清 staged 的用例。 |

未改：`generation-sheet.ts`（面板状态仓储不需要动）、`outdoor-plan-canvas.tsx`、`outdoor-plan-3d.tsx`、`room-organizer.tsx`、`openfreemap-*`、共享进度文档。
未改合同字段、routeBridge 九个方法签名、session scope、SitePlanData、OutdoorTaskProgress、物料生成入参。
`resolveFacilityGenerateLink` 的候选 / 云资产 / 3D 逻辑未动。

## 2. 现在的行为

### 2.1 成功提交

1. 面板在发请求前生成 `requestId`；
2. `recordFacilityGenerateLink` 记 staged（带提交当刻的 `projectId`、设施 id/名称）；
3. `beginGenerationSubmission` 先写回执 `state='submitting'`；
4. `submitModelJob` 用同一个 `requestId` 调 `createGenerationJob`；
5. 成功后 `consumeFacilityGenerateLink` 落 `taskid ↔ facility` 链接（含 `projectId`）；
6. 回执补 `state='submitted'` 与 `taskid`；
7. 面板提示与服务端回执都显示任务号，例如：`已提交：任务号 <taskid>「描述」…`。

回执存储键：`localStorage['scendance:generation-submissions']`，一条示例：

```json
{
  "requestId": "…",
  "state": "submitted",
  "taskid": "…",
  "projectId": "…",
  "facilityId": "…",
  "facilityName": "…",
  "prompt": "…",
  "submittedAt": 0,
  "updatedAt": 0
}
```

`taskid` 同时可从面板的 `data-testid="generation-receipt"` 读取；重开面板后临时提示会清空，但回执行仍在，便于刷新后核对。

### 2.2 结果未知（unknown 锁）

- 断网、超时、5xx、响应无法解析、非 `SceneApiError` 的未知异常：`generationFailureDisposition` 返回 `unknown`。
- 回执落 `state='unknown'`，**不写 taskid**（服务端没回）；如果是服务端返回 `job.state='submit_unknown'`，则保留 taskid 并同样落 unknown。
- 面板文案固定包含：`先查任务记录与费用，不重试`。
- 主按钮 `disabled`，`title` 也给出同一提示；回车路径在 `submitModel` 里再次拦截，不能靠键盘绕过。
- 刷新后 `submitting` 残留也按未落定处理（页面在请求途中被关掉）；重开面板仍显示 unknown 提示并保持锁定。
- 锁按 `projectId + facilityId` 严格分区：项目 A 设施 f-1 的 unknown 不会锁项目 B，也不会锁项目 A 的 f-2；物料库来路（无设施）与设施来路互不串。
- 产品上刻意没有「解除锁定」按钮：必须人工确认任务记录与费用后处理，避免一键重试造成重复扣费。

### 2.3 明确失败

- 4xx（预算不足、未登录、幂等冲突等）：判定 `failed`，回执落 `state='failed'`，显示服务端可读文案；不产生 unknown 锁。
- 无论 unknown 还是 failed，提交失败都会调用 `discardFacilityGenerateLink` 清掉 staged；下一次生成不会错挂到上一个设施。
- 失败回执保留 `requestId`，便于人工核对这次请求到底有没有落任务。

### 2.4 多项目 / 多设施

- 新落成的 `FacilityGenerateLink` 带 `projectId`；`listFacilityGenerateLinks(facilityId, projectId)` 能按项目隔离。
- 历史遗留的无 `projectId` 链接仍按原逻辑放行（保持兼容），只有新链接是严格隔离的。
- 面板在提交当刻捕获 `facility` 与 `projectId`，等待响应期间用户切换设施/项目也不会把回执或链接写到新目标上。

## 3. 测试与类型检查

环境：仓库内 Node `v24.15.0`（`.tmp-node24/node-v24.15.0-win-x64/node.exe`），frontend 的 vitest 4.1.12。

```text
node_modules/vitest/vitest.mjs run \
  components/room-organizer/lib/facility-generated-models.test.ts \
  components/room-organizer/lib/model-generation.test.ts \
  components/room-organizer/panels/generation-sheet.react.test.tsx \
  components/room-organizer/lib/generation-sheet.test.ts \
  --maxWorkers=1 --testTimeout=15000
```

结果：**4 个测试文件、51 例全部通过**（facility-generated-models 27、model-generation 8、generation-sheet.react 8、generation-sheet 8），`VITEST_EXIT=0`。

```text
node_modules/typescript/bin/tsc --noEmit
```

结果：**TSC_EXIT=0**。

未跑全量 frontend 测试与浏览器 E2E；本轮只覆盖生成面板/link/receipt 相关文件。

## 4. 未做 / 阻塞

- 没有触发真实生成，没有消耗额度；C1 仍未打勾。
- 没有服务端按 `requestId` 反查任务的自动化：目前只持久化 requestId，核对仍需 `GET /jobs`、任务记录或管理端。
- 客户端 `GET /jobs` 不含 `actual_cents`，UI 仍看不到具体扣费金额；C1 的「扣费」需要管理端/后台。
- unknown 锁没有 UI 解除入口；人工确认后可清理对应回执（未来若要产品化，应做「已核对无任务」的显式确认，而不是重试按钮）。
- 未改共享进度文档，未改其他对话正在处理的 V1–V5 文件。
- 历史无 `projectId` 链接仍可能被任一项目轮询到（兼容旧数据，未在本切片改变）。

## 5. C1 真人执行步骤（只跑一次，记录 taskid 与扣费）

前置：

- 真人登录，选择样例项目，确认有编辑权；
- 打开浏览器 DevTools：Network 过滤 `/jobs`，Application 查看 `localStorage`；
- 只选一个设施，只提交一次；网络错误/超时后**不要再点生成**。

步骤：

1. 打开户外场景，点某个设施的属性卡，进入左栏「生成模型」面板（`data-testid="generation-sheet"`），确认目标行是 `用于「设施名」`。
2. 填一句具体描述，勾选「消耗额度」，点一次「生成」。
3. 在面板提示或 `data-testid="generation-receipt"` 记录 **taskid**；同时记录 `localStorage['scendance:generation-submissions']` 里的 `requestId / state / taskid / projectId / facilityId`。
4. 确认 `localStorage['scendance:facility-generate-links']` 对应链接也带同一个 `taskid` 与 `projectId`。
5. 等任务推进；用 `GET /jobs` 或任务记录核对状态，**不要重复提交**。
6. 到管理端/后台核对项目 AI 预算 `reserved_cents / committed_cents` 或 `requests.actual_cents` 的实际扣费。
7. 记录结论：
   - 任务创建、taskid 可查、扣费可核对 → 可判 PASS；
   - 任务创建但金额不可见 → 记 BLOCKED，不写 PASS；
   - 任何网络错误/结果未知 → 停止，先查任务记录与费用，不重试。

红线：

- 不用「导入 GLB」冒充 C1（它不扣额度）。
- 不把 `provider_usage` 当金额，除非确认字段含费用。
- 不在 unknown 后换入口再试；同一设施、同一项目都不要再点。

## 6. 核对入口速查

| 用途 | 位置 |
| --- | --- |
| 最新提交回执 | `localStorage['scendance:generation-submissions']` |
| 设施任务链接 | `localStorage['scendance:facility-generate-links']` |
| 面板回执文本 | `data-testid="generation-receipt"` |
| 面板目标设施 | `data-testid="generation-target"` |
| 主按钮禁用原因 | 主按钮 `title` |
| 任务记录 | 云项目任务列表 / `GET /jobs` |
| 实际扣费 | 管理端预算或 `requests.actual_cents` |
