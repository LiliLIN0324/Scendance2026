# #5 补充：CDP 网络栈离线（2026-11-18 第四轮）

> 承接 `2026-11-18-case05-offline.md`。上一轮断网只做到页面级 `fetch/XHR/onLine` 注入，`<img>` 瓦片不被覆盖。本轮换会话内置产品浏览器，经其后端 CDP 在**网络栈层级**模拟离线，补上瓦片那一格；但云端 revision 前后对照仍没拿到，#5 云端列继续不声明。

## 1. 手段与环境

- 浏览器：会话内置产品浏览器，`Browser.getVersion` 返回 Chrome `147.0.7727.149`、JS `14.7.173.28`，CDP 通道经 bu 后端可达。
- 命令：`Network.enable` → `Network.emulateNetworkConditions({offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0})`；恢复时 `offline: false`、吞吐 `-1`。
- 与上一轮的区别：这一层断在网络栈，`fetch`、`XHR`、`<img>` 瓦片都走同一条通道，上一轮「瓦片没被注入覆盖」的缺口由本手段补上。

## 2. 离线窗口读数（本轮 CDP 离线那一轮）

| 观察项 | 读数 |
| --- | --- |
| `navigator.onLine` | `false` |
| console | `ERR_INTERNET_DISCONNECTED` |
| 检索候选 | 仍显示上一轮缓存的「街心公园 / 学府树中街…」条目；全页无「离线 / 失败 / 缓存 / 重试」降级文案 |
| 写请求 | 离线窗口内 **0** 条（无 `outdoor-plans` / `outdoor-history` / `chat/stream` 出网） |
| 本地 plan 键 | 离线前后长度一致（见下） |
| 底图瓦片 | 网络栈离线一并被挡（`<img>` 不再加载） |
| 恢复后 | `offline=false` → `onLine=true`；只有 token 续期与 `messages/unread` 轮询恢复 200，无失败请求静默重放 |

本轮离前基线本地 plan 键长度（`scendance-outdoor-plan-v1:<projectId>`）：

| projectId | 字节 |
| --- | --- |
| `house-uat5t1nz` | 10726 |
| `9a889d2b-0e71-45bd-90b7-d9f36f7b665d` | 333 |
| `default-outdoor` | 10727 |
| `house-3448ed0f-462b-4ddf-8b60-50fd3cc0effb` | 339 |

## 3. 两个缺陷的本轮状态

| 缺陷 | 本轮 |
| --- | --- |
| ① 离线检索无降级文案、本地缓存冒充结果 | **再次复现**：网络栈离线层级下，检索侧仍只出缓存候选、无降级提示。 |
| ② 断网点确认后写入进行态约 1 分钟不收口 | **本轮未复现**：会话内没有待确认提案，没有可点的「确认并应用」；该缺陷维持上一轮登记，不在本轮翻案。 |

产品口径仍待定（不替产品拍板）：离线检索要不要出降级文案；断网写入进行态超时后如何收口/报错。

## 4. 仍未闭合的缺口

1. **云端 revision 前后对照读数仍拿不到** → #5 云端键继续不点，零写证据只有「写请求 0 + 本地键不变」这一侧。
2. **CDP 会话在导航后重附失败**：本轮稍后想复跑一次离线取证，`Network.emulateNetworkConditions` 返回 `-32001: Session with given id not found`；`Network.enable` 不报错但目标会话已失效。本轮离线读数来自导航前那一轮，复跑未取到新读数。
3. 断网仍是浏览器 CDP 模拟，不是系统级断网（非管理员、改不了 hosts/防火墙）。

## 5. 结论

#5 维持 **partial（不构成通过）**：缺陷①在更强的网络栈离线层级再次复现；缺陷②未复现但也未被证伪；云端列未声明。
