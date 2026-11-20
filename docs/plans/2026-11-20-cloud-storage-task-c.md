# 任务 C：案例库与共享实施记录

日期：2026-11-20。状态：**本地实现完成，聚焦测试通过；云端验收与工作台接线（B）未做。** 仅工作区补丁，未 add/commit/push、未迁移、未部署。

## 本轮做了什么（按用户指令顺序）

1. **修复重复打开案例覆盖个人修改**（V11 前端路径）
   - `panels/space-panel.tsx` `openReplicaCase`：已有 `replica-<id>` 本机记录时不再重写——重复点击、官方初始方案更新都不覆盖个人副本；写入后复读校验，存储静默失败时明确报「浏览器未能保存案例副本」，不假成功。
   - **副本不继承云端身份**：新建副本是全新记录，不写 `remoteActivityId`/`remoteRevision`；副本的云端身份只能由它自己后续同步建立。测试断言副本字段为空、既有副本不被触碰。
2. **云端国内案例目录与独立另存**（C08/C11）
   - 新模块 `lib/cloud-cases.ts`（C 独占）：按 **A 的 `supabase/functions/_shared/cloud-storage-contract.ts` v1** 定义 zod 契约，`detectCloudCaseSession()` 对 backendSession 做运行时能力探测（9 个方法名逐一探测）。A 尚未把方法挂上 `backend-session.ts`，此时所有操作明确失败（`unavailable`），**生产不用 localStorage 模拟云端目录/管理员权限**；A 落码后自动接通。
   - `panels/cloud-case-catalog.tsx`（C 独占）：空间面板「国内案例」段下的云端目录。未接 controller 不占位；controller 有但服务端未接通显示「不可用」；加载失败给原因+重试；空目录如实说明。卡片元信息来自服务端公开清单。
   - **只读查看**：「查看」取 `readCloudCase` 详情，`manifest.outdoor` 过 `sitePlanDataSchema` 后用既有 `CaseThumb` 画 2D 只读缩略，不进画布、不改状态；预览文案明确「2D 示意；3D 与编辑请使用此案例另存副本」。
   - **独立另存**：「使用此案例」= `ensureCloudCaseCopyRecord()`：读公开 manifest → 校验户外规划 → 落独立个人副本（`replica-<稳定ID>`）→ 走既有 `requestOutdoorProjectSwitch` 同页切换；已有副本续用不覆盖。静态 CN 案例种子迁移后同一稳定 ID 收敛到同一份个人副本（幂等）。
3. **发布更新链**（C09/C10）
   - `panels/case-admin.tsx`（C 独占）：分享卡新增「案例」页签（`ShareTab` 扩为 `'share'|'publish'|'cases'|'export'`，传入 `controller` 才出现）。
     - 权限：`getCloudCapabilities` 服务端判定 `superAdmin`，未确认/失败/非管理员都如实说明；每次写操作服务端复核。
     - 流程：保存草稿（`upsertCloudCase`，`provenance` 必填——来源/授权说明）→ 发布/更新（`publishCloudCase`，`expectedRevision` 取动作时快照的已保存版本）→ 历史（`listCloudCaseVersions`）→ 恢复（`restoreCloudCase`）→ 下架（`unpublishCloudCase`，说明影响范围：目录与稳定入口失效、已发固定交付不受影响）。
     - **发布失败保留原入口**：只报错，不清发布链接、不改公众版本、不动草稿行。
     - CAS：`expectedVersion`（草稿版本）随动作现读快照，渲染值只做提示。
   - 分享语义补齐（沿用上一轮补丁并测试锁定）：交给客户的是受控发布链接；/site 场地快照降级为显式标注「固定副本，不随项目更新，无法远程撤回」的离线入口；撤销匹配带 `shareId`。

## 文件与所有权

- **修改（C 独占范围）**：`panels/space-panel.tsx`、`panels/share-menu.tsx`、`panels/share-panel.tsx`、`panels/space-browser.css`（云端目录样式，仅 space-panel 引入）、`app/view/page.tsx`（上轮：离线快照边界文案）、对应测试 `space-panel.react.test.tsx`、`share-menu.react.test.tsx`。
- **新增（C 独占，报告声明所有权）**：`lib/cloud-cases.ts` + `lib/cloud-cases.test.ts`、`panels/cloud-case-catalog.tsx` + `.react.test.tsx`、`panels/case-admin.tsx` + `case-admin.css` + `.react.test.tsx`。
- **未动**：A 的 `backend-session.ts`/`client`/`supabase`、B 的 `room-organizer.tsx`/`outdoor-plan-overlay.tsx`/`cloud-panel.tsx`/上传队列模块、主计划与 INDEX、既有录像/快照。本轮未执行 git 操作。

## 给 A 的确认与请求

- 契约已按 `cloud-storage-contract.ts` v1 对齐：`CloudCasePublic/Draft/Version` 字段（`status`/`publicationId`/`revision`/`createdAt`）、`caseWriteSchema.provenance` 必填、稳定 ID 正则 `cloudCaseIdPattern` 同步到前端预检。
- 请在 `backend-session.ts` 挂上 9 个方法（名字/签名见 `cloud-cases.ts` 的 `CloudCaseSessionContract`，已导出）；`detectCloudCaseSession` 会自动接通，C 不自建传输。
- **请钉死 `manifest.outdoor` 的包裹方式**：前端兼容「直接是 SitePlanData」或「`.plan` 字段下是 SitePlanData」两种，都对不上就拒绝另存；建议契约明确写死一种。
- `readCloudCase` 公开 payload 请保证不含 `sources`（契约已是 `Omit<CompleteManifest,'sources'>`），`assets` 只含 published 可见集合。

## 给 B 的集成要求（room-organizer 一侧由 B 修改）

1. `room-organizer.tsx` 的 `<SpacePanel variant="card" …/>`（约 ：5210）透传 `controller={controller}`——不传则云端目录段不出现。
2. `panels/scendance-workspace.tsx` 两处 `<ShareMenu …/>`（约 ：1058、:1269）透传 `controller={controller}`（需先把 controller 从 room-organizer 传进 scendance-workspace）；不传则分享卡无「案例」页签。
3. 换项目/打开案例副本继续走既有 `requestOutdoorProjectSwitch` 路径；请确保切换时旧项目的云绑定/租约不带入新项目（`case-activity-alignment` 的「绑定中不动身份」例外，请给副本项目一条明确出路，避免副本编辑沿用旧云项目身份推送）。
4. `saveCompleteProject` 的 manifest.outdoor 请按上面「给 A」的钉死格式放完整户外 payload；C 只消费 `readCloudCase`。
5. 恢复（历史版本切换）由服务端改指针，C 不动画布；无需 B 提供恢复回调。若 B 在 cloud-panel 收编分享入口，请按 C12 语义区分四类链接，勿把编辑地址称公共分享。

## 验证（命令与原始结果）

- 聚焦测试（PowerShell，`frontend/` 下）：
  `npx vitest run components/room-organizer/lib/cloud-cases.test.ts components/room-organizer/panels/cloud-case-catalog.react.test.tsx components/room-organizer/panels/case-admin.react.test.tsx components/room-organizer/panels/space-panel.react.test.tsx components/room-organizer/panels/share-menu.react.test.tsx components/room-organizer/lib/outdoor-project-store.test.ts`
  → `Test Files 6 passed (6)；Tests 99 passed (99)`（其中 C 新增/更新：cloud-cases 13、catalog 4、case-admin 10、space-panel 17、share-menu 29）。
- 类型检查：`npm run typecheck` → **C 独占文件零错误**；剩余错误全部位于 A/B 在途文件（`../supabase/functions/_shared/cloud-storage.ts`、`../tests/fixtures.ts`、`hooks/use-cloud-archive.ts`、`lib/cloud-archive.ts`、`lib/local-inventory.ts`、`lib/save-status.ts`、`panels/cloud-panel.tsx`、`room-organizer.tsx`），属并行任务半成品，C 不代改。
- Lint（限定 C 文件）：`npx eslint <C 文件>` → `0 errors, 2 warnings`（两条 `@next/next/no-img-element` 为 space-panel 既有扫描卡 `<img>`，非本轮引入）。
- 并行期间工作区被 A/B 同步改动过（share-menu 撤回逻辑、B 上传队列等）；C 的改动基于最新共享状态重放，未覆盖他人补丁。

## 未验部分（如实）

- 真实管理员 UUID、真实登录、`superAdmin` 服务端判定、V08–V11 云端验收（发布→目录→只读→另存→官方更新不覆盖副本）**均未执行**——backendSession 方法与数据库/Edge 审核未落地。
- `readCloudCase` 的 2D 只读预览只覆盖户外 manifest；室内场景（`manifest.scene`）的只读展示与 `/view` 页接入完整分享（`readCompleteShare`）属 C12/C13 剩余项，待契约钉死后再接。
- 管理页表单未做封面（coverAssetId）选择，沿用既有草稿值或空；待 B 的资产归档接通后补。
- 生产构建/全局检查由总集成串行执行（遵循第 8 节协作规则）。
