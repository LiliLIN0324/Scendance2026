# 48 · T-Aholo重建链路修复与复验（给 Trae）

> 上一棒：DSH bot（2026-11-05 真调排查，10 任务全败于 Aholo 后端，见 `docs/17`）。
> 本卡是给 Trae 的接力卡：三件独立小事 + 一条复验线。一张卡一次做完，分支开发、合入由人。
> **硬钉**：官方回复（lux3d@qunhemail.com）前不新建扣额度重建任务；不伪造成功；splat 不进碰撞/拾取/落盘几何。

## 背景 30 秒版

室内茶室 130 张实拍（`scene-3d/`），本地 SfM 证明可重建（63 相机/0.76px）。Aholo World 重建真调 10 连败：图片模式创建都受理但 RUNNING 2–4 分钟必然 FAILED（无原因返回）；视频模式创建被「文件链接不对」持续拒绝。排查结论：账号权限或后端管线问题，参数侧无可再试变量。官方问询邮件草稿已备（`docs/evidence/scene3d-recon-2026-11/support_email_draft.md`）。

## T-1 · 代理修复审合 + 补测试（可立即做）

`tools/aholo/lux3d-dev-proxy.mjs` 有 **3 处未提交的修复**（真调中实锤的阻断级 bug）：

| # | bug | 修复 | 验证方式 |
| --- | --- | --- | --- |
| 1 | ousToken 一次性凭证被进程级缓存 → 多文件上传第 2 张起必报「Token已被使用」 | `ous(fresh)`：每次 `ousUpload` 取新 token，单次上传内同 token（见函数内注释） | 同进程连续 POST 两个文件到 `/recon-upload`，第二个不再 502 |
| 2 | `aholo()` 吞上游状态/报文 → 只回「Aholo 上游请求失败」 | 透传 `upstream HTTP <status>: <body前300字符>` | 断网/错 key 时错误信息含上游真实码 |
| 3 | token 走国际网关 | 改 `${worldBase}/asset/v1/token`（对齐官方 SDK region:'cn'） | `/recon-upload` 后 URL 域名与 SDK 批次一致 |

要求：跑通 `tools/aholo/lux3d-dev-proxy.test.mjs` 既有测试并为 #1/#2 补用例；分支提交；**动树前先 `git status` 重查**（多 bot 并行，本卡的 diff 在工作树里未提交，别覆盖）。

## T-2 · UI 容错与错误透出（`panels/lux3d-direct-test.tsx`）

1. 真调失败时把代理返回的 `error` 详情全文上屏（现在上游错误已带真实原因，别再截断成一句话）。
2. 「上传并开始重建」链路加**建任务退避重试**：上传完成后立即 create 若遇「文件链接不对」，按 60s 间隔重试至 20 分钟（资产索引传播窗口 0–12 分钟不定，实测数据在 docs/17）；期间给用户明确状态文案「素材索引中，X 秒后重试（第 N 次）」，不要静默或谎报成功。
3. 同 md5 文件重传会报「上传任务已结束」——UI 重传前按文件名+大小做本地去重提示。

## T-3 · 官方回复后的复验线（等邮件回音）

1. 若官方开通/修复：用缓存状态直接复验（不重传）——`node %TEMP%\scene3d-probe\sdk\recon_test.mjs space normal 0`（98 URL 已缓存）。
2. 成功后走现有链路挂画布：`/asset` 落盘 SPZ → 环境预览抽屉 → 「挂本场环境预览（替换样例）」，并按 `docs/01` §3.4 契约登记元数据（upAxis、采集日期、尺度依据——本批**无尺度基准**，需拿室内已知长度标定后才能 1:1 摆物料）。
3. 把官方答复要点回填 `docs/17` §五，并更新 `docs/15` M3 段落的「待真机验证」状态。

## 失败即停

- 官方未回复期间新建任何扣额度重建任务
- 把 FAILED 任务说成部分成功、或用样例 SPZ 冒充本场包
- 未跑 `lux3d-dev-proxy.test.mjs` 就合入代理修复
- 覆盖工作树里未提交的代理 diff
