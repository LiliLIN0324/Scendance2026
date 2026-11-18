# 线上构建复核 · 第五轮补扫（2026-11-18 晚）

> 补充 `2026-11-18-live-build-review.md`（c778 构建）。第四轮留档记「runtime 已轮换到 `webpack-69b585…`，离线扫 22 个 chunk 未命中标记，当前构建是否含三处修复无法确认」。本轮在真实已登录浏览器里按 `performance.getEntriesByType('resource')` 取**实际已加载**的 JS 清单复核，缺口闭合。
> 边界不变：本复核只证明**线上部署包内包含修复代码与文案**；不等于真机界面验收通过。#3 / #6 的界面表现仍按走查清单取证，本文件不产生任何一条 `pass`。

## 1. 环境与样本

| 项 | 读数 |
| --- | --- |
| 复核时间 | 2026-11-18 晚（UTC+8） |
| 正式站 | `https://scendance-scene-planner-ewz.pages.dev/`（活动 A `house-uat5t1nz`，户外编辑器已挂载） |
| 已加载 runtime | `webpack-572c7ae83f07f05b.js`；HTML 另引用 `webpack-ff25e07df95569b0.js`（别名轮换） |
| 样本范围 | 页面 `performance` 资源表列出的 **39 个 JS chunk**，共 **9 287 420 字节**；不再只依赖 HTML `<script>` 与 runtime 映射表 |
| 目标包 | `572.99434d17a781f822.js`，**2 897 579 字节**，户外组织器懒加载主包（dot 分隔命名，第四轮 dash 分隔正则漏抓） |

## 2. 三处修复逐条命中（572 包内原文上下文）

### 2.1 #6 超时单列一档

```js
quota_exhausted: return {message:"该模型额度已用完或欠费，请在上方切换其它模型，或联系管理员充值。", stamp:"额度不足", tone:"warn"};
case "timeout": return {message:"服务商这次没在时限内返回，本次未执行；请稍后重试，或把这一句拆短一点再试。", stamp:"响应超时", tone:"warn"};
default: return cR // 兜底档
```

timeout 分支与额度档、兜底档分开；完整超时文案 `服务商这次没在时限内返回` 命中（按复核记录 §3，单搜「响应超时」会撞上生成服务商旧文案）。

### 2.2 #3 原话选路四分支

```js
e.preferred.length && t.push("按你点名的「".concat(e.preferred.join("、"), "」排的到场候选。"))
e.excluded.length && t.push("按你说的没有用「".concat(e.excluded.join("、"), "」。"))
e.keptExcluded.length && t.push("「".concat(e.keptExcluded.join("、"), "」你想排除，但这一带路网里只有它，先留着候选，核对时可以在画布上改。"))
e.notFound && t.push("你点名的路这一带路网里没找到，仍按道路等级挑了到场候选；也可以自己在画布上画一条。")
// 无 intent 回落："这些线是按道路等级挑的到场候选；哪个口真能走，等你核对后写进规划。"
```

四个分支与源码 `routeIntentNote(intent)` 一一对应，旧等级兜底句仍在。

### 2.3 日期与证据不跨轮

```js
function fw(e) {
  var t;
  return e && Object.keys(e.seen).length > 0
    ? (null == e || null == (t = e.asOf) ? void 0 : t.trim()) || "本轮走查，日期未填"
    : "2026-11-17 正式站走查第二轮";
}
```

与本地 `evidenceAsOf()` 三态一致：标过证据 → 认本轮日期，没填显示「本轮走查，日期未填」；一条没标 → 回落快照日期。同包内走查板提示串 `本轮证据会标注` 与常量 `本轮走查，日期未填` 均在。

### 2.4 附带命中

- 旧提案失效文案：「当前规划已变化，旧提案已失效；请基于最新场地重算。」（epoch 失效分支两处）
- 边界守卫文案：「地图上还没有可核对的活动边界；请点『在地图上手画活动范围』…」

## 3. 复核方法教训（供下一轮）

1. **懒加载 chunk 是 dot 分隔命名**（`<id>.<hash>.js`），第四轮只按 `<id>-<hash>.js` 解析 runtime 表，漏抓了户外组织器主包。复核必须以 `performance.getEntriesByType('resource')` 的真实加载清单为准，不能只扫 HTML `<script>`。
2. 入口 HTML bundle 不含户外聊天卡文案（「确认并应用这一版」「撤回预览」「走查记录」在入口包内同样搜不到），这些只在懒加载组织器包里。
3. 线上不发 source map；标识符被压缩，核对依据仍是中文文案 + 分支结构上下文，不是符号名。

## 4. 结论

当前线上构建（runtime `572c7ae8` / HTML `ff25e07`）的户外组织器包 `572.99434d…` **包含**：#6 超时单列档、#3 原话选路四分支、日期不跨轮三态，以及 epoch 失效与边界守卫文案。第四轮「无法确认当前构建含三处修复」的缺口本轮闭合。

发布门禁状态不变：11 条里仍只有 #2 一条三类全绿；包内有代码不等于真机走查通过，门禁解除只能由人签字。
