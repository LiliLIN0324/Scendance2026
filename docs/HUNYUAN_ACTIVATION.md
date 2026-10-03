# 混元 3D 手工开通与接入

官方资料核对日期：2026-10-02。对应 PLAN.md 的 `HY-3D-3.0 / LowPoly` 单道具异步生成；不涉及登录注册。本指南只记录文档核对和配置步骤，没有执行真实生成或业务验收。

## 当前停止点

TokenHub 接口适配、持久化任务、轮询和私有 GLB 归档代码已经具备；腾讯账号实名认证、服务开通、API Key 创建、实际价格和条款确认需要账号持有人手工完成。**在用户确认这些步骤完成前，混元生成保持未开通，不上传混元密钥、不启用生成轮询、不充值、不购买套餐、不提交测试生成。** 网页入口或后端接口存在不代表提供商已开通。

其他项目、素材和分享功能的发布可以继续。付费生成验收由用户自行发起，不把配置预检或模拟响应测试记为真实生成成功。

## 1. 在腾讯控制台完成开通

1. 登录 [TokenHub 控制台](https://console.cloud.tencent.com/tokenhub/)。如账号尚未实名认证，先按控制台要求完成，再开通 TokenHub。[官方快速入门](https://cloud.tencent.com/document/product/1823/130058)
2. 在模型广场找到 **HY-3D-3.0**，确认账号能够使用该模型。不要换成 HY-3D-3.1：本项目需要的 LowPoly 模式不适用于 3.1。[HY-3D 调用指南](https://cloud.tencent.com/document/product/1823/137181)
3. 如控制台提供免费体验包，可按需手工领取；官方当前列出 HY-3D-3.0 体验额度，但领取资格、余额及期限以账号页面为准。免费额度用尽且未开启后付费时服务停止；是否开启后付费由用户自行决定，助手不自动开启。[新人免费体验包](https://cloud.tencent.com/document/product/1823/130053)
4. 阅读模型详情的计费信息及账号开通时展示的服务条款，按下文记录费用上界与条款。此阶段不点击示例中的生成或 API 调试按钮。

新开通服务使用 TokenHub；旧混元平台保留既有已购服务，但已停止支持新购模型服务。[旧平台迁移说明](https://cloud.tencent.com/document/product/1804/126189)

## 2. 创建项目专用 API Key

打开 [TokenHub API Key 管理](https://console.cloud.tencent.com/tokenhub/apikey)，按本项目现有配置选择**广州**，创建一个便于识别的 Scendance 专用 Key。访问范围选择限定范围，仅授权 HY-3D-3.0 对应的默认推理服务。使用普通 TokenHub 模型服务 API Key，不混用 Coding Plan 或 Token Plan 的 Key。[API Key 管理](https://cloud.tencent.com/document/product/1823/130090)

如果子账号不能创建 Key，需由主账号按腾讯官方指引授予相应 TokenHub 权限；官方 HY-3D 指南列出的策略为 `QcloudTokenhubFullAccess`。权限操作由账号持有人处理。[HY-3D 权限说明](https://cloud.tencent.com/document/product/1823/137181)

**当前接入只需要 TokenHub API Key，不需要 SecretId/SecretKey。** SecretId/SecretKey 用于 `ai3d.tencentcloudapi.com` 的 TC3 签名接口；当前代码使用 TokenHub 的 Bearer 鉴权，不走该签名接口。[腾讯云 API 公共参数](https://cloud.tencent.com/document/api/1804/120832)

创建后的完整 Key 只保存到受限本机文件，不能放进网页环境变量、Git、截图或聊天。

## 3. 核对费用与条款

### 单次费用与应用预算

官方模型价格页的检索快照列出 HY-3D-3.0 为 **15–60 积分/次、0.12 元/积分**，折合 1.8–7.2 元。此次完整价格页抓取超时；这些数值不能代替用户账号内最新的价格确认，也不能说明本项目参数必然消耗最高档积分。[官方模型价格](https://cloud.tencent.com/document/product/1823/130055)

`GENERATION_MAX_TASK_CENTS` 应填写用户核对后的**单次生成保守费用上界，单位为人民币分**。例如，只有确认当前账号和本项目参数的单次费用不高于 7.20 元后，720 分才是可用的预留示例；本指南不预填该数值，也不将其记为已确认价格。

当前数据库的三维预算是**全站累计 15000 分（150 元）的应用内预留上限**，不是每个工作室的额度，也不是每天重置。新任务按上述单次上界预留；未知、失败或模型不符合应用要求的任务不会自动返还预留。应用预留不是腾讯实际账单，也不能控制同一账号在其他应用中的消费。官方计费还区分生成失败、部分结果、超时及重复提交，最终应以模型结果和账单核对。[3D 计费方式](https://cloud.tencent.com/document/product/1823/130054)

TokenHub API Key 控制台的“额度上限”单位目前明确为 **tokens**。不能把该设置描述成已经确认可限制 3D 积分或人民币支出的硬上限。当前 TokenHub HY-3D 查询文档也没有声明实际消耗积分字段，因此代码没有伪造积分用量；实际费用仍需控制台账单核对。[Key 限额说明](https://cloud.tencent.com/document/product/1823/130090)、[查询返回字段](https://cloud.tencent.com/document/product/1823/137181)

### 条款记录

腾讯的 [混元生 3D 服务条款](https://cloud.tencent.com/document/product/1804/122967) 指向 [大模型服务条款](https://cloud.tencent.com/document/product/301/97822)。用户还需核对 TokenHub 开通页面是否展示补充或不同条款，确认本项目生成模型的保存、使用和客户分享用途适用。

完成实际阅读后，才填写 `HUNYUAN_TERMS_URL` 和 `HUNYUAN_TERMS_REVIEWED_AT`。URL 应指向实际适用的官方条款；日期填写实际阅读日期 `YYYY-MM-DD`。不要用产品介绍页替代条款，也不要把本文核对日期当成用户已经阅读的日期。这两个字段是应用保存的授权来源记录，不代表自动完成法律合规判断。

## 4. 将配置保存到受限本机文件

使用当前任务的持久工作树保存配置，避免发布临时目录清理后丢失：

```text
/Users/lwc/.codex/worktrees/fc82/场景规划Agent产品开发/.env.hunyuan.local
```

该工作树的 `.gitignore` 中 `.env*` 已确认覆盖此文件；发布工作树 `/private/tmp/scendance-api-release` 也通过 `.env.*` 忽略同名配置。不要将唯一的密钥副本放进临时发布目录。也可使用用户自选的受限文件，只需告知准确路径。

可以在本机执行以下命令建立或打开文件；`touch` 不会覆盖已有内容：

```sh
umask 077
touch '/Users/lwc/.codex/worktrees/fc82/场景规划Agent产品开发/.env.hunyuan.local'
chmod 600 '/Users/lwc/.codex/worktrees/fc82/场景规划Agent产品开发/.env.hunyuan.local'
open -e '/Users/lwc/.codex/worktrees/fc82/场景规划Agent产品开发/.env.hunyuan.local'
```

只填写以下混元配置，保留其他服务的现有设置。空值是待填写项，不能直接上传当作有效配置：

```dotenv
HUNYUAN_API_MODE=tokenhub
HUNYUAN_API_KEY=
GENERATION_MAX_TASK_CENTS=
HUNYUAN_TERMS_URL=
HUNYUAN_TERMS_REVIEWED_AT=
```

文件中不要加入 Supabase service role、公钥、DeepSeek Key 或 `GENERATION_WORKER_SECRET`，不要使用它覆盖现有完整环境文件。现有配置预检脚本默认读取 `.env.local` 和 `.env.edge.local`，不会自动读这份独立文件；后续由助手按用户提供的路径执行不输出值的专门预检与定向上传。

## 5. 用户完成后回传什么

只需告诉当前助手：

> 已完成 TokenHub 开通、模型价格和适用条款确认。混元配置已保存到：`实际文件绝对路径`。

**不要回传 Key 内容、文件全文或包含 Key 的截图。** 单纯保存本机文件不会更新云端服务。收到上述确认后，助手才能继续检查字段与费用上界、定向配置专用 Supabase 项目，并在确认队列情况后启用轮询；不自动充值或发起生成验收。

启用轮询会处理已有排队任务，可能触发提供商计费，不能把启用定时器当作无业务影响的操作。如果存在未完成或提交结果未知的任务，应先核对其状态；不得在这些任务存在时切换 `HUNYUAN_API_MODE`，也不得通过重建请求 ID 重复提交结果未知的任务。

## 当前接口核对记录

当前代码请求 `https://tokenhub.tencentmaas.com/v1/api/3d/submit` 和 `/query`，使用 Bearer 鉴权；提交参数固定为 `model=hy-3d-3.0`、`generate_type=LowPoly`、`polygon_type=triangle`。官方说明 LowPoly 下 `face_count` 不生效，默认输出含 GLB，任务 ID 有效期为 24 小时，符合现有异步轮询与及时归档设计。[HY-3D 调用指南](https://cloud.tencent.com/document/product/1823/137181)

旧腾讯云 API 文档仍可辅助核对模型参数，但字段大小写、鉴权和地址不能直接用于 TokenHub；参见 [旧提交参数](https://cloud.tencent.com/document/api/1804/123447)和[旧查询参数](https://cloud.tencent.com/document/api/1804/123448)。本轮无需修改现有 TokenHub 请求适配器。
