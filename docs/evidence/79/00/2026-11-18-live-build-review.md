# 线上构建复核：三处修复是否已部署（2026-11-18 晚）

> 目的：闭合上一轮留下的缺口——「当前线上 runtime 已换，扫 chunk 未命中标记，**无法确认**线上构建含三处修复」。
> 边界：本复核只证明**部署包里包含修复代码与文案**；不等于真机界面验收通过。#3 / #6 的界面表现仍按 `docs/plans/2026-11-18-79-walkthrough-checklist.md` §2 走真机走查，本文件不产生任何一条 `pass`。

## 1. 环境与方法

| 项 | 读数 |
| --- | --- |
| 复核时间 | 2026-11-18 22:12（UTC+8） |
| 正式站 | `https://scendance-scene-planner-ewz.pages.dev/`（规范域名；旧拼写 `scendance-scence-...` NXDOMAIN，订正记录见 `../02/2026-11-18-case02-same-name-poi.md`） |
| 观察到的 runtime | 首页首次返回 `webpack-595ae1bed8581778.js`；`/editor.html`、`/review.html`、`/view.html` 与二次刷新首页均为 `webpack-c7786768e52dd0b5.js`。595 构建对应的懒 chunk `9150.417608cc6b3349bc.js` 已 404，被部署轮换下线；**复核时稳定 runtime 为 c778** |
| 抓取范围 | 首页 + editor / review / view / projects / plan-share / explore / guide / pricing / auth / tdt-probe / 404 各 HTML 的 `script[src]`；两个 runtime 的 chunk 清单（显式 id 映射、16 位 hash 表、8 位前缀表）；已下载 JS 内递归引用的 `static/chunks/*.js` |
| 样本量 | 73 个 JS chunk，约 10.18 MB |
| 主应用包 | `/_next/static/chunks/9150.98974b54efc4f8c2.js`（2,573,590 字节），三处修复标记全部落在这一包内 |

检索方式：全文检索中文文案的 UTF-8 原文；同时对 `\uXXXX` 转义形式做了核对，线上产物未使用转义形式。压缩后局部标识符被重命名，导出函数原名（如 `roadIntentFromRequest`）检索不到，因此核对依据是**中文文案 + 分支结构上下文**，不是符号名。

## 2. 三处修复逐条核对

### 2.1 #6 超时单列一档（`frontend/lib/agent-error-view.ts`）

线上片段（9150 包，原序保留）：

```js
case"timeout":return{message:"服务商这次没在时限内返回，本次未执行；请稍后重试，或把这一句拆短一点再试。",stamp:"响应超时",tone:"warn"}
```

同一包内其余四档文案也在：`输入需调整`（invalid）、`活动问答暂未启用`（disabled/unavailable）、`该模型额度已用完…`（quota_exhausted）、`这次问答没有完成；服务商可能仍在处理或计费…`（兜底）。**timeout 分支与兜底档已分开。**

### 2.2 #3 原话选路（`frontend/components/room-organizer/lib/route-proposal.ts`）

线上片段（9150 包，`routeIntentNote` 压缩后的等价分支）：

- 点名要走：`e.preferred.length&&t.push("按你点名的「".concat(e.preferred.join("、"),"」排的到场候选。"))`
- 明确不要：`e.excluded.length&&t.push("按你说的没有用「".concat(e.excluded.join("、"),"」。"))`
- 排除后只剩唯一一条：`e.keptExcluded…"你想排除，但这一带路网里只有它，先留着候选，核对时可以在画布上改。"`
- 点名但路网里没有：`e.notFound&&t.push("你点名的路这一带路网里没找到，仍按道路等级挑了到场候选；也可以自己在画布上画一条。")`

四个分支与源码 `routeIntentNote(intent)` 一一对应；旧口径兜底句 `这些线是按道路等级挑的到场候选…` 仍在，作为无 intent 时的回落。

### 2.3 日期与证据不跨轮（`outdoor-release-status-card.ts`）

线上反编译等价函数：

```js
function ph(e){
  var t;
  return e && Object.keys(e.seen).length > 0
    ? (null == e || null == (t = e.asOf) ? void 0 : t.trim()) || "本轮走查，日期未填"
    : "2026-11-17 正式站走查第二轮";
}
```

与本地源码 `evidenceAsOf()` 逐分支一致：本轮标过证据 → 认本轮日期，没填就显示「本轮走查，日期未填」；一条没标 → 整列回落对照表快照，日期跟着快照走。走查板提示串 `本轮证据会标注` 也在同一包内。

## 3. 干扰项（避免下一轮误判）

`1351-134e403767f93d9c.js`、`725-9734d00377e2f764.js` 里也出现「响应超时」字样，但属于 **AI 生成服务商**的 `PROVIDER_TIMEOUT` 文案（`生成服务商响应超时，稍后再试。` / `AI 响应超时，请稍后手动重试。`），与 `agentErrorView` 的 #6 超时档不是同一份代码。

判 #6 超时档是否上线，必须用完整超时文案 `服务商这次没在时限内返回` 作标记；单搜「响应超时」会把生成服务商的旧文案也算进来。

## 4. 覆盖与局限（不掩盖）

- **source map 未部署**：`9150.98974b54efc4f8c2.js.map` 404，worker 的 `worker-CnszsmU-.js.map` 同样 404；无法回溯到源码行号，只能按文案与分支结构核对。
- **读不出部署 commit**：静态导出 HTML 不带 commit hash；但线上含 v4.17.11 才有的字符串 `本轮走查，日期未填`，说明线上构建不早于提交 `3d2a2dfb`。
- **两次 runtime 轮换**：复核窗口内别名在 595 / c778 两个构建之间切过；记录以最终稳定的 c778 为准。下一轮复核若再扫不到标记，先核对当前 runtime 与 chunk 哈希，别拿旧构建当验收对象。
- **本复核不替代真机走查**：包内有文案 ≠ 界面链路走得通。#3「改口在界面上生效」、#6「四类阻塞分别可分辨」仍需登录态浏览器按清单 §2 取证。

## 5. 复现步骤

1. `GET /` 与各路由 HTML，收集全部 `/_next/static/chunks/*.js`。
2. 下载 webpack runtime，解析 `a.u` 中的显式 id 映射、16 位 hash 表与 8 位前缀表，补全懒加载 chunk；再从已下载 JS 里递归提取 `static/chunks/*.js` 引用。
3. 全文检索 §2 的中文标记（UTF-8 原文 + `\uXXXX` 转义两种形式）。
4. 命中后取上下文核对分支；先用 §3 的干扰项清单排除同名串。
5. 对照本地源码分支结构确认等价，记录 runtime 哈希、chunk 哈希与命中偏移。

## 6. 结论

线上 c778 构建的 9150 主包已包含：#6 超时单列档、#3 原话选路四个分支、日期不跨轮三态。上一轮「无法确认当前构建含三处修复」的缺口本轮闭合；发布门禁状态不变——11 条里仍只有 #2 一条三类全绿，门禁解除只能由人签字。
