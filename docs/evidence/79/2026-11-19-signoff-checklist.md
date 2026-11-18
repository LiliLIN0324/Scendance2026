# #79 户外发布门禁 · 第六轮验收与签字清单（2026-11-19）

> 本文件是**给人签字用**的，不是结论。结论口径：一条用例 = 固定数据 ✅ **且** 真实浏览器 = `pass` **且** 真实云端 = `pass`。
> `partial` 不算过；`blocked` 单列，既不算过也不算失败；`n/a` 不能顶 `pass`。**agent 不能代签。**

## 一、本轮做了什么（台账快照）

| 项 | 值 |
| --- | --- |
| 走查对象 | 正式站 `https://scendance-scene-planner-ewz.pages.dev/`（真实部署 + 真实云端 + 真实浏览器） |
| 云端项目 | Supabase `wkhfvnzgopjdzxlmycks` |
| 账号 | 走查专用账号 `walkthrough-79@scendance.test`（本轮新建，只用于走查） |
| 登录态做法 | Supabase 管理 API 换会话 → 按 `@supabase/ssr` 真实格式注入 **cookie**（此前五轮注 localStorage 无效） |
| 台架 | `docs/evidence/79/tools/`（Playwright + HAR + CDP 离线 + 管理 API 只读 SQL） |
| 取证产物 | 每条用例一个目录：`docs/evidence/79/<case>/`，含原始 JSON、截图、脚本 |

## 二、11 条用例当前状态（详见 `walkthrough.json`）

| # | 用例 | 固定数据 | 浏览器 | 云端 | 结论 | 本轮新增 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 空白项目 + 组合需求 + 地图确认地点及范围 | ✅ | ✅ | ⛔ | partial | 空白项目建成、6 条候选、红线 12 点入画布、物料库已种入真实素材 |
| 2 | 两个同名地点选其一 | ✅ | ✅ | ✅ | **pass** | 沿用第五轮证据，未重跑 |
| 3 | 有范围、已选设施，发明确小改 | ✅ | — | ⛔ | partial | 模型通道已恢复（此前 provider_error），小改对照未跑完 |
| 4 | 无范围先发设计句，再改预算/人数 | ✅ | 部分 | ⛔ | partial | 前半段复现：零模型请求、只给唯一下一步；后半段未跑 |
| 5 | 地图部分、离线或无路网 | ✅ | 部分 | ⛔ | partial | CDP 级真离线 + HAR（此前只能页面级注入，瓦片验不到） |
| 6 | 未登录 / 功能关闭 / 额度不足 / 网络超时 | ✅ | 部分 | n/a | partial | **未登录分支单独触发并取证**；另三类需改云端环境变量 |
| 7 | 待预览时说「等等」或过时的「确认」 | ✅ | ✅ | ⛔ | partial | 说「等等」→ 旧提案消失、零写、本机不动 |
| 8 | 应用中刷新 / 双点确认 / 切项目 | ✅ | 部分 | ⛔ | partial | 双点确认：只应用一次（zones 0→4），第二次点击按钮已消失 |
| 9 | 确认后撤销，重开旧草稿 | ✅ | 部分 | ⛔ | partial | 撤销整批 + 再应用一次（读数见 `09/`） |
| 10 | 一条真实模型失败 + 一条纯本地成功 | ✅ | 部分 | ⛔ | partial | 真实失败样本（物料摆放「整批未写入」）+ 纯本地成功样本；仍缺服务端日志关联 |
| 11 | 普通聊天 / 室内布局 / 导出 / 旧云 Agent Run | ✅ | 部分 | ⛔ | partial | 导出与旧 run 取证（读数见 `11/`） |

> ⛔ = 云端一栏被**部署缺口**卡住：正式站前端已调用 `PUT /outdoor-plans`，但线上 `scene-api`（2026-11-16 部署）没有该端点，DB 迁移 `20261117180000` / `20261117190000` 也没上 → `scene_private.outdoor_plans` 表不存在，revision 前后对照取不到。证据：`docs/evidence/79/00/2026-11-19-deploy-gap.md`。

## 三、签字前需要人做的三件事

| # | 事 | 为什么必须人做 | 做完之后 |
| --- | --- | --- | --- |
| 1 | **部署 main 的 Edge Functions 到 `wkhfvnzgopjdzxlmycks`，并应用缺失的 10 条迁移**（含 `20261117180000` / `20261117190000`） | 仓库规范要求迁移与 Edge Functions 变更走人 review；且这是**对生产库的写操作** | #7 / #8 / #9 / #5 的云端一栏才可能从 ⛔ 变成 pass；随后重跑 `docs/evidence/79/tools/case-07-08-09-chain-v2.mjs` 即可补齐 |
| 2 | **确认「额度不足 / 网络超时」两类的触发方式** | 这两类要靠云端函数环境变量指向一个返 402 / 25s 不返回的上游，属于配置变更 | 两类可单独取证，#6 才可能从 partial 走向 pass |
| 3 | **在 `walkthrough.json` 上签字** | 门禁解除只能由人签字，agent 不能代签 | 11 条全绿才算解除；现在是 1/11（全绿仅 #2） |

## 四、本轮**没有**做的事（如实列出）

- 没有部署 Edge Functions、没有应用任何数据库迁移、没有改任何云端环境变量；
- 没有改仓库代码（本轮只新增 `docs/evidence/79/` 下的取证脚本与证据文件）；
- 没有重跑 #2（沿用第五轮证据）、没有跑 #8a（应用中刷新）/ #8c（切项目）/ #3 的小改对照；
- 没有为 #10 做服务端日志关联（需要云端日志权限）；
- 没有为了让台账好看而补任何假 `pass`。

## 五、复跑命令

```bash
node docs/evidence/79/tools/case-07-08-09-chain-v2.mjs   # #7 / #8b 链路
node docs/evidence/79/tools/case-01-09-blank-undo.mjs    # #1 空白项目 + #9 撤销再应用
node docs/evidence/79/tools/case-05-offline.mjs          # #5 CDP 离线 + HAR
node docs/evidence/79/tools/case-11-exports.mjs          # #11 导出
node docs/evidence/79/tools/case-11-old-run.mjs          # #11 旧云 Agent Run
node docs/evidence/79/tools/case-06-notlogged.mjs        # #6 未登录分支
```
