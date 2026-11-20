# 右上角发布：剩余验收与并行执行计划

日期：2026-11-20。状态：计划，待执行。

范围：`2026-11-20-publish-flow-closure-plan.md` 里 P0/P1 已落地之后的剩余部分——真实环境验收、PUB-03 收尾、P2 三项。本文不重复主计划的问题分析，只把「还没验、还没做」拆成能分别认领、分别验收的 8 个计划，并写清哪些能并行、哪些必须串行。接口口径仍以 `2026-11-20-publish-flow-interface-contract.md` 为准。

## 1. 已完成到哪一步（证据边界）

代码层面 P0-A / P0-B / P1-A / P1-B 已实现并推送：`083b6975`（功能）、`e37aa0db`（计划状态回填），远端 `refs/heads/main` 已核对为 `e37aa0db`。

本轮实跑结果：

```text
npx tsc --noEmit                       → exit 0
npm --prefix frontend run build        → exit 0，20 条路由 prerender，oneplan 产物违规 0 条
vitest（发布链 7 个文件）              → Test Files 7 passed (7)，Tests 103 passed (103)
eslint（发布链 6 个文件）              → 0 errors，49 warnings（既有 import-order/hook 风格项）
```

**这不等于验收通过。** 以上全部是单测与静态检查，没有真实浏览器画面、没有真实云端回执。主计划 §6 的 V01–V20 里，绝大多数仍然只有「代码已实现」或「只有单测级证据」，因此本文把剩余工作定为验收与收口，而不是继续堆功能。

## 2. 剩余缺口（按主计划编号）

| 缺口 | 现状 | 缺什么 |
| --- | --- | --- |
| PUB-03 恢复入口 | 只接了 `login`（账户中心登录卡）与 `archive-page`（账户中心「归档」页） | 保存当前修改、取回编辑权、版本冲突三条没有现成一键入口，界面只说明原因 |
| PUB-14 评审开关 | 开关与链接并列，未标生效边界 | 改权限后旧链接／新链接各自何时生效，未证实也未写死 |
| Bingo 语义 | 「送到 Bingo」的进与出未统一 | V17 进入／送出／待评／回执的对应关系无证据 |
| PUB-13 导出反馈 | 导出触发即关，部分回调无结果 | 图/清单/几何/演示稿缺进行中、完成、失败与重试 |
| 真实环境验收 | 无 | 本地工作台画面、真实云端发布/上传/撤销、跨设备记录、390px 与纯键盘 |
| 环境前置 | 主计划 §1.1 记过 `clientReferenceManifest` 运行时错误 | 未确认是否仍在；本轮 build 通过，但 dev 侧未复测 |

## 3. 八个计划

### 3.1 可并行（P1–P5）

| # | 计划 | 目标 | 落点（独占） | 出口判据 | 预估 |
| --- | --- | --- | --- | --- | --- |
| P1 | 预检恢复入口收口 | 保存当前修改 / 取回编辑权 / 版本冲突三条接到预检动作，回来只重查不自动发布 | `components/room-organizer/room-organizer.tsx`、`panels/cloud-panel.tsx` | V01–V03、V06：从未登录、本地草稿、只读、冲突四种起步都能走完发布 | 4–6 h |
| P2 | 评审开关生效规则 | 标清改权限后旧链接与新链接各自何时生效，并使界面与行为一致 | `panels/share-menu.tsx`、`lib/review-share*` | V16：改权限后复制旧链接与生成新链接的行为与文案一致，意见归属原方案版本 | 3–4 h |
| P3 | 导出范围与结果反馈 | 四类导出各有进行中/完成/失败/重试，选择范围时绑定明确版本 | `panels/share-panel.tsx` 导出段、导出句柄 | V18：四类导出分别可验，失败不靠关菜单表示成功 | 4–5 h |
| P4 | Bingo 进入/送出语义 | 统一「进入／送出／待评／回执」用词与状态归属 | `panels/bingo-status*`、相关入口 | V17：进入与送出状态一致，客户反馈能回到对应方案版本 | 3–4 h |
| P5 | 客户页一致性补测 | 发布摘要与客户页逐类对账（物件/内置道具/外部模型/户外/附件/缺模型） | `app/view/page.tsx`、`components/business/scene-preview.tsx` | V13：手机与桌面数量、位置、尺寸、楼层范围、附件一致，无编辑控件 | 3–5 h |

### 3.2 必须串行（S1–S3）

| # | 计划 | 为什么不能拆 | 出口判据 | 预估 |
| --- | --- | --- | --- | --- |
| S1 | 前置环境 | `npm run dev` 只起一份（3000 + 3199 代理），`build` 写同一个 `out/`，测试并发会互相拖垮；环境不成立则 P1–P5 的浏览器证据全部作废 | dev 首页可渲染、无 `clientReferenceManifest`；记录版本与启动命令 | 0.5–2 h（若复现，+2–4 h 诊断） |
| S2 | 真实云端链路 | 同一项目同一 revision 链（首发→修改→新版→换设备→旧版撤回），服务端按 `expectedRevision` CAS，拆给两个执行者会互相打回；且需授权项目与额度 | V10、V12：版本差异清楚、旧链接仍是原版、刷新/换设备后仍可管理、令牌不可恢复时如实说明 | 3–5 h（含真实等待） |
| S3 | 矩阵回填 | 要等 P1–P5 与 S2 都出证据，才能逐条写「通过／不适用／未覆盖」 | 主计划 §6 全表有结论，未覆盖项写明原因，不用累计用例数替代 | 4–6 h |

## 4. 并行编排与冲突边界

**结论：3 条并行通道 + 1 条串行验证道，墙钟约 1 个工作日。** 加执行者数量不再缩短，因为下限由 S1→S2 的真实等待决定。

| 组合 | 分配 | 墙钟 |
| --- | --- | --- |
| 3 个 | P1 / P2+P3 / P4+P5，S1–S3 由主控道串行 | 约 8–10 h |
| 5 个 | P1–P5 各一个，S1–S3 仍串行 | 同上，不会更快 |
| 1 个 | P1→P3→P2→P4→P5→S1→S2→S3 | 约 20–34 h（3–5 个工作日） |

为什么不能按「功能模块」无限切：

1. **文件是热点，不是模块。** 剩余三块工作全压在 `share-menu.tsx`、`share-panel.tsx`、`room-organizer.tsx` 上。本轮已观测：改 `share-menu` 的预检状态，`room-organizer-publish` 4 条用例连带失败；再改 `share-panel` 的主按钮显隐，又触发同一批 4 条。上一轮的三方分工（A=share-menu、B=share-panel+view、集成=room-organizer）就是按文件所有权切出来的，本文沿用。
2. **一台机器只有一条构建与验证通道。** COLLAB 已记：全量 765 文件并发跑出 16 个失败，其中 6 个隔离复跑 145 例全绿，属内存抖动。多个执行者同时跑 build + vitest，等于互相制造假失败。
3. **云端按数据串行。** v4 与 v5 不能并发发布到同一项目，CAS 会互相拒绝。

**其他任务的在途改动必须原样保留。** 当前工作树里还有「全局新手引导」任务的未提交改动（`onboarding/`、`COLLAB.md`、`HANDOFF.md`、`app/globals.css`、`frontend/tsconfig.json`、`site-plan-guide*`、若干删除的截图、`.tmp-audit/`、`snap-*.yml`、`deliverables/*.mp4`）。任何计划的提交都不得 `git add -A`，也不得借这次提交把它们带进去；`room-organizer.tsx` 若同时含两类改动，需按 hunk 分离（`083b6975` 已按此做）。

## 5. 验收矩阵映射

| 用例 | 归属 | 当前证据 |
| --- | --- | --- |
| V01–V03、V05、V06 | P1 + S2 | 代码已实现；只有单测级（`publish-flow` / `share-panel`），无浏览器复现 |
| V04 | P1 + S2 | 单测级（归档缺口文案、fail-closed） |
| V07、V08 | 已完成 | 单测级（`room-organizer-publish` 4 例：捕获 revision、跨活动拒绝、缺口阻断、未挂项目） |
| V09 | 已完成 | 单测级（结果待确认两条：有记录/无记录） |
| V10 | S2 | 无证据 |
| V11 | P5 + S2 | 单测级（发布成功但复制失败的文案分离） |
| V12 | S2 | 单测级（令牌丢失如实说明、记录以服务端为准） |
| V13 | P5 | 部分（`view/page` 新增对外可见内容用例） |
| V14 | P5 | 无真机证据（到期提示在页内已实现） |
| V15 | S2 | 单测级（撤回后链接行与记录同步） |
| V16 | P2 | 无（P2 未开工） |
| V17 | P4 | 无（P2 未开工） |
| V18 | P3 | 无（P2 未开工） |
| V19 | S1 + P5 | 无真机证据（页签方向键与焦点有面板级用例） |
| V20 | S2 | 无（需三种真实账号） |

## 6. 证据与汇报规则

- 本地保存 / 模拟接口 / 真实浏览器 / 真实云端**分开汇报**，不互相冒充；单测通过只能写「单测级」。
- 每个计划收尾回填：改了哪些文件、原始复现步骤、命令与原始输出、覆盖了哪些 V、哪些没覆盖及原因。
- 截图与日志不得带令牌、签名资源地址或账号凭据；测试发布记录按获授权范围清理。
- 不新增并行 wire schema；Edge 契约、迁移、根依赖与治理配置的改动不在此计划授权内。

## 7. 需要人决定或提供的事项

| 事项 | 影响 | 谁定 |
| --- | --- | --- |
| QA 项目、三账号与写入额度 | S2 能否做；没有就只能标「未验证」 | 用户授权 |
| 手机或可改视口环境 | V11、V19 的真机证据 | 用户提供 |
| 普通发布是否补幂等键、`GET /shares` 是否回可撤销标识 | 「结果待确认」的可信上限；属 Edge 契约，需人 review | 仓库管理员 |
| 新手引导那批未提交改动的归属与提交时机 | 决定 `room-organizer.tsx` 后续是否仍要按 hunk 分离 | 用户拍板 |

## 8. 执行回填

| 计划 | 状态 | 证据／未覆盖项 |
| --- | --- | --- |
| S1 前置环境 | 已完成（可用） | dev 3000 首页可渲染、`Ready in 1967ms`、`clientReferenceManifest` 未复现；证据与边界见 §9 |
| P1 恢复入口 | 待执行 | — |
| P2 评审开关 | 待执行 | — |
| P3 导出反馈 | 待执行 | — |
| P4 Bingo 语义 | 待执行 | — |
| P5 客户页一致性 | 待执行 | — |
| S2 云端链路 | 部分完成（真实云端） | V10 通过、V15 局部通过、V12 部分；完整分享 422 `DEPENDENCY_INCOMPLETE` 未覆盖；见 §10 |
| S3 矩阵回填 | 待执行 | 依赖 P1–P5、S2 |

## 9. S1 执行记录

日期：2026-11-20。执行者：主控道（S1 串行道）。

**环境**：Windows；Node v24.22.2；npm 11.19.1；`frontend` 版本 4.17.16；Next.js 15.5.29（`package.json` 声明 `^15.5.26`）。

**启动命令（根目录，未改任何代码）**：`npm --prefix frontend run dev`
→ `node ../scripts/package-pages.mjs && node ../scripts/dev-with-amap-proxy.mjs`（dev 3000 + 共享 3199 高德/Aholo 代理）。

**原始输出摘录**：

```text
Packaged /introduction, /guide and /showcase in ...\frontend\public\
[Aholo dev-proxy] http://127.0.0.1:3199 · 密钥已读到
[dev] 3199 地图代理已随 dev 启动
   ▲ Next.js 15.5.29
   - Local:        http://localhost:3000
   ✓ Ready in 1967ms
 ○ Compiling / ...
 ✓ Compiled / in 26.4s (3448 modules)
 GET / 200 in 27832ms
 GET / 200 in 43ms / 48ms / 60ms
```

- `curl http://localhost:3000/` → `status=200 time=0.049s size=18649`，`title=幕景 Scendance · 活动布置工作台`。
- 内置浏览器（Chrome 引擎）打开 http://localhost:3000/ → 标题同上；工作台完整渲染：活动/Bingo/空间/物料/创作/户外规划/消息导航、「新会话」Agent 面板、本机活动「经典案例 · Scotiabank Hockey Day Canada」、2D 平面画布与罗盘、工具条（分享、2D/3D 切换、放大缩小、漫游）、账户菜单；**无错误浮层**。
- dev 日志全文扫描 `clientReferenceManifest|Error|error|Unhandled|failed|500` → **0 条匹配**。
- `curl http://127.0.0.1:3199/health` → `status=200`；监听端口 3000、3199 均在。

**结论：可用。主计划 §1.1 的 `clientReferenceManifest` 运行时错误未复现。** dev 保留在 3000（本机工作台），3199 代理为共享单例，留作其余 lane 使用。

**证据边界（不得外推）**：

1. 「无运行时错误」的依据是「无错误浮层 + dev 日志 0 条错误 + 完整 UI 渲染」，**未逐条捕获 `console.error`/`console.warn` 流**，因此不能写成「console 完全干净」。
2. 开工时 3000 已被 13:52 遗留的旧 dev 实例占用（`next start-server`，父进程已退出，无法取得其 stdout）。对该实例的首次请求返回 `HTTP 500` 且响应体长度为 0，重试即 200。该实例已终止，**无法判定这次 500 是否就是 `clientReferenceManifest`**（无日志、无复现路径），如实记为「未定位的历史状态」；本轮新起的 dev 冷启动与首屏均无此现象。
3. 首页首次编译 26.4s 属 dev 按需编译（3448 modules），不是启动耗时；到 `Ready` 为 1.967s。
4. 本轮清理了两个并存 dev（旧 3000、误起的 3001 副本）与它们的父进程，只保留一份 dev + 一份 3199 代理，避免后续 lane 并发抢端口。

## 10. S2 执行记录

日期：2026-11-20。执行者：主控道（S2 串行道）。

**授权口径**：用户本轮确认「没有 QA 项目 id，本人与科智的邮箱账号已提供」。因此没有使用虚构 QA 项目，而是在 **A（用户本人管理员）的个人工作室**新建一个可删的专用 QA 项目；口令与令牌只从既有本机 `.env.local` 读取，命令行不回显、报告与提交不落任何 token。未新建账号、未重置密码、未发登录邮件。

**对象**：`S2 发布验收（主控 2026-11-20，可删）`，projectId `44667a73-6316-439d-b083-f546291b99db`（保留供人工核对，分享已全部撤销）。

**路径与端点**（按 `frontend/lib/backend-session.ts`、`client/scene-client.ts` 现行契约，未改 wire）：`GET /projects/:id` → `POST /projects/:id/publish`（真实返回 201）→ `POST /projects/:id/lease/acquire` → `PUT /projects/:id/scene` → 再次 `publish` → `GET /projects/:id/shares` → `DELETE /projects/:id/shares/:shareId` → `POST /share/read`。

**原始输出（脱敏，脚本 `.tmp/s2-publish-chain.mjs` / `.tmp/s2-ui-check.mjs`）**

```json
{"name":"V10 新版发布：两个版本各自独立，旧链接仍是原版","status":"passed","original":12,"edited":15,"oldShareWidth":12,"newShareWidth":15}
{"name":"V12 服务端清单不含链接与令牌，只有版本与撤回态","status":"passed","count":3,"leaks":false}
{"name":"V12 完整分享令牌只回一次","status":"not-covered","why":"422 DEPENDENCY_INCOMPLETE（需 published 口径归档）"}
{"name":"V15（局部）撤回只撤指定 shareId，其他版本仍可读","status":"passed","oldLinkStatus":404,"newLinkStatus":200}
{"oldLinkCode":"SHARE_NOT_FOUND","deleteStatus":200}
{"name":"收尾","revokedRemaining":2,"newLinkAfterCleanup":404,"rows":[{"revision":0,"revoked":true},{"revision":0,"revoked":true},{"revision":1,"revoked":true}]}
```

真实浏览器（Playwright Chromium，全新上下文＝另一台设备，生产站）：

```text
live:    title=幕景 Scendance · 活动布置工作台 | 客户只读方案 | 已发布 · 版本 1 | 15 × 10 米 | 此页包含：三维布置、物料清单与模型来源说明；资料原件与扫描文件不随普通发布公开。 | 物料清单 共 0 件 | pageErrors=[]
revoked: 暂时无法查看方案 | 分享链接不存在或已撤销，请联系方案发布者。
```

截图：`.tmp/s2-ui/share-live.png`、`.tmp/s2-ui/share-revoked.png`（不含令牌）。

**结论**

| 用例 | 结论 | 证据 |
| --- | --- | --- |
| V10 版本差异、旧链接仍是原版 | **通过（真实云端）** | revision 0→1；两次发布 shareId/publicationId 全不同；旧链接 venue 宽 12（原版）、新链接 15（新版）；客户页显示「已发布 · 版本 1」「15 × 10 米」 |
| V12 令牌不可恢复、记录以服务端为准 | **部分通过** | `GET /projects/:id/shares` 3 行，无 `token`/`url`/`tokenHash`/`storagePath`；**完整分享** `POST /cloud/projects/:id/shares` 返回 422 `DEPENDENCY_INCOMPLETE`，该半条未覆盖 |
| V15 撤回只影响这一条 | **通过（局部）** | 撤 rev0 一条后 `SHARE_NOT_FOUND`，同版本另一条与 rev1 仍 200；撤回后页面如实提示「不存在或已撤销」 |
| 刷新/换设备后仍可管理 | **部分** | 以干净上下文打开链接 + 服务端 shares 清单为准（不依赖本机缓存）；**未走查工作台内的分享记录面板 UI** |
| 三账号（B/C）与手机 390px | **未覆盖** | 本轮只用 A；B/C 未参与，移动端未测 |

**没验证什么 / 不得外推**

1. 完整分享（`/view/#c…`）的 token 只回一次与重放 `token:null`：422 阻断，未验。此前 11-20 云存储验收的真实 API 证据不能直接搬到本轮发布链。
2. 「换设备后管理」只做到「服务端清单为准 + 干净上下文可读链接」，没有在第二台设备的界面里实际撤回/核对记录行。
3. 脚本里的编辑标志正则（`/编辑|在设计|拖动|摆放/`）会命中视图提示文案，属**误报**；「无编辑控件」以截图人工核对为准，不以该布尔为据。
4. 本轮未跑 typecheck/build/vitest（S2 只做真实链路），未改任何产品代码或 wire 契约。

**收尾与影响**：3 条 QA 分享全部撤销（`newLinkAfterCleanup=404`），租约已释放；QA 项目保留（内含标题、venue 尺寸等测试内容，无真实业务数据），可由用户按需删除。
