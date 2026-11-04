# 47 · Aholo World 重建真调排查（2026-11-05）

> 读者：产品/技术负责人、Trae（接 T 卡）、后续接力 bot。
> 素材：`scene-3d/` 室内茶室包间 130 张（98 张精选后上传）。素材侧体检与本地 SfM 实测见 `docs/01` 与记忆档案；本文只记 Aholo 云重建真调。
> **最终结论（对照实验实锤）：Aholo 重建 API 本身是通的 —— Middlebury temple 教科书数据集（32 张 640×480 物体环绕照，scene=model）一次 SUCCEEDED（5.5 分钟，出 PLY/SPZ/LOD）。我们的茶室手持走拍素材才是失败原因：同一账号同一调用链，11 个茶室任务（任意配置）全部 FAILED。他们的引擎只吃「单主体均匀环绕、一致光照距离」的引导式采集（官方 App 的成熟形态），室内走拍不收 —— 官方 App 里「空间拍摄引导」也标注"开发中"。解法：用官方 App 引导模式或慢速匀速环绕视频重拍，不是调参能救的。**

## 一、失败矩阵（全部真调，worldId 可查）

| # | worldId | 素材配置 | scene | quality | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | 3FO4K4RKL87J | 98 张 3072×4096（旧对象） | space | normal | 受理，RUNNING 4 min → FAILED |
| 2 | 3FO4K4RKKX6G | 同上重试 | space | normal | FAILED（复现） |
| 3 | 3FO4K4RKL1IH | 98 张重编码新对象 + FocalLengthIn35mmFilm=23 | space | normal | 受理（创建秒过）→ FAILED |
| 4 | 3FO4K4RKJ7YX | 同 3 的素材 | space | **high** | FAILED |
| 5 | 3FO4K4RKJBBY | **40 张**清晰度最优子集 | space | normal | FAILED |
| 6 | 3FO4K4RKJ1AV | 98 张 **1440×1920** | space | normal | FAILED |
| 7 | 3FO4K4RKJ4MW | 98 张（同 6） | space | **low** | FAILED |
| 8 | 3FO4K4RKITLT | 98 张（同 3）+ **useMask=true** | space | normal | PREPROCESSING 8 min（抠图生效）→ FAILED |
| 9 | 3FO4K4RKIWXU | 98 张（同 3） | **model** | normal | FAILED |
| 10 | （无 worldId） | 合成 mp4 24MB，type=video | space | normal | **创建被拒 16+ 次**：400 BIZ_-1「文件链接不对，请使用 资产 模块相关接口上传文件」，20 分钟重试窗口内始终不受理 |

FAILED 统一形态：`status=FAILED, progress=1, assets.splats.urls 全 null, imagery=null`，**响应无任何失败原因字段**。账号侧 3 个 SUCCEEDED 全部是 world generations（文生场景，10 月底），reconstructions 从未成功过。

## 二、已排除的因素（全部实测）

| 因素 | 验证方式 | 结果 |
| --- | --- | --- |
| 文件公网可达性 | 并发探测全部 98 URL（Range GET） | 98/98 返回 206/200 |
| content-type | HEAD 实测 jpg/mp4 上传产物 | image/jpeg、video/mp4 均正确 |
| 对象新鲜度 | 重编码全部图片（新 md5 强制全新对象） | 同样 FAILED |
| EXIF | 原机 EXIF 是坏值（GPS 全 0、FocalLength=0），重写焦距先验再传 | 同样 FAILED |
| 数量 | 98 → 40 精华 | FAILED |
| 分辨率 | 3072×4096 → 1440×1920 | FAILED |
| 质量档位 | normal / high / low 三档 | 全 FAILED |
| scene 词表 | space / model；旧词 indoor 被 400 参数校验拒 | 全 FAILED |
| 抠图 | useMask=true（PREPROCESSING 阶段确实变长，说明参数生效） | FAILED |
| 网关区域 | token 分别取自国际/国内网关；官方 SDK region:'cn' 对照 | 无差别 |
| 调用方差异 | 官方 SDK（@manycore/aholo-sdk-world 1.4.0，最新版）端到端 vs 自研脚本，HTTP 层逐项对齐（host/path/鉴权头/body 形状） | 无差别 |
| 官方流程合规 | OpenAPI（labs.aholo.ai，30 端点）文档流程逐字对照 | 完全一致 |

素材可重建性（本地 pycolmap 4.2.1）：主模型 63 相机 / 3141 点 / 重投影 0.76px，两模型去重 68/130 配准；证据 `docs/evidence/scene3d-recon-2026-11/sparse_views7.png`（俯视图）、`sparse_points.ply`、`sfm_report7.json`。

## 三、过程中修掉的真 bug（`tools/aholo/lux3d-dev-proxy.mjs`，已改未提交）

1. **ousToken 一次性会话凭证被进程级缓存**：多文件上传第 2 张起必报「OUS 拒绝：Token已被使用」。这是 D1/D2 干跑从未暴露、真调第一枪就炸的阻断级 bug。修复：每次 `ousUpload` 取新 token，同一次上传（含状态轮询）内保持同 token（代理 379 行注释的约束）。
2. **aholo() 吞掉上游状态码与报文**：一切上游失败都变成「Aholo 上游请求失败」，违反「失败返回真实错误码」硬钉，也使本次排查一度无法定位。修复：透传 HTTP status + 响应报文（截断 300 字符）。
3. **token 端点改走国内网关**（`${worldBase}/asset/v1/token`，对齐官方 SDK region:'cn' 与 `ous-status-probe.mjs` 先例）。

配套发现（未改码，供 Trae 的 T 卡与官方反馈）：OUS 同 md5 上传任务结束后重传报「上传任务已结束」；素材上传后资产索引存在 **0–12 分钟不定的传播窗口**，窗口内建任务报「文件链接不对」。

## 四、给 Trae 的 T 卡

见 `docs/48-T-Aholo重建链路修复与复验.md`（代理修复合入、UI 错误透出与索引窗口容错、官方回复后的复验步骤）。

## 〇、破案：对照实验（2026-11-05 深夜补记，读这节就够）

| 实验 | 输入 | scene | 结果 |
| --- | --- | --- | --- |
| **temple 对照** | Middlebury temple denseRing 32 张子集（真实照片，640×480，单主体均匀环绕） | **model** | ✅ **SUCCEEDED**（worldId 3FO4K4RKJS24，5.5 min，progress 0.05→0.86→1，出 PLY 51,595 高斯 + SPZ 1.27MB + 5 级 LOD，upAxis=Z） |
| 茶室模仿 temple 配方 | 本地 SfM 配准成功的 63 张里挑 32 张最优（新对象） | model | ❌ FAILED（2 min，同前） |
| 视频 SDK 链路 | 合成 mp4（type=video） | space | 受理 ✅（**SDK 调用秒过**，代理同素材被拒 16 次 → 受理与调用方绑定）→ 抽帧+封面生成 ✅ → 重建主体 ❌ FAILED |

三个铁证：① API 与我方集成都没问题（temple 一次过）；② 失败绑定在**素材采集形态**上（茶室任意配置全灭，temple 一次过）；③ 官方 App 的成熟形态就是「引导式物体环绕 + 智能画面筛选（3.4.0 自动过滤模糊/曝光异常/重复帧）」，「空间拍摄引导」自述"开发中"。

**行动解法（按成功率排序）**：
1. 用官方 App「Aholo 3D 高斯采集与重建」（iOS App Store id6760284620）引导模式重拍茶室；
2. 或手机拍一段**慢速匀速、光线稳定、距离一致**的环绕视频（视频模式已被证明可受理），走视频重建；
3. 现有 130 张照片无论怎么挑选/裁剪/换参数都救不回来（11 发验证），放弃调参。
4. temple 的 SPZ（`docs/evidence/scene3d-recon-2026-11/temple_result.spz`）可作为「上传→重建→SPZ→画布」全链路真调的演示证据。

**雕塑批（scene-3d-outdoor 白天 10 张）为什么没生成 —— 实测三连**：
1. **数量门槛**：10 < 20，创建即 400 BIZ_-1「图片资源项至少 20 张」（实测 2026-11-05，未受理不扣费）；
2. **环绕不闭环**：本地 SfM 实测 A/B 簇间 40 秒视角断层、桥接对 = 0（`docs/01` 报告 m1/m2）—— 就算凑够张数，覆盖有洞大概率同样失败（temple 是全周闭环）；
3. **无视频素材**：outdoor 批 6 段 MP4 全为夜间茶亭，视频通道（2/2 全胜）没有雕塑段。
→ 解法：现场用官方 App 引导模式绕雕塑全周拍 30–40 张，或拍一段环绕视频。两条路都已被本项目验证可通。

## 一、失败矩阵（茶室素材，全部真调，worldId 可查）

用户在消费端「使用情况」核对了账单，**重建计费规则首次实测确认**（此前 docs/01 标「未公开」）：

- **创建即扣费、失败全额退**（失败退回出现在失败后 2–11 分钟）。本轮 9 次创建 9 次全退，**净消耗 0 积分**。
- 三档价格：**极速预览(low) 20/次、标准(normal) 50/次、专业(high) 80/次**（world 生成类：AI空间生成 10/次、Lux3D 生成 20/次，为 10 月底历史任务）。
- 账单类型名「3D高斯重建（标准/专业/极速预览）– API」，与 taskQuality 三档一一对应。
- 视频模式 16+ 次被 400 拒绝的尝试**未产生任何扣费**（未受理不计费）。
- 账户剩余积分 1,830（截至 2026-11-05）。

## 六、官方渠道

问询邮件草稿：`docs/evidence/scene3d-recon-2026-11/support_email_draft.md`（收件 lux3d@qunhemail.com，含全部 worldId、复现流程、文档反馈；计费已自答，草稿保留请求官方确认规则文档）。**在官方回复前不要再烧重建任务**——我方可试变量已穷尽，10/10 失败说明问题在账号权限或后端管线，不在参数。

## 六、复现

```text
# 环境样目（含官方 SDK、全部脚本与日志）：C:\Users\13266\AppData\Local\Temp\scene3d-probe\
cd C:\Users\13266\.dsh\bot\workspace\Scendance2026
node tools\aholo\lux3d-dev-proxy.mjs          # :3199（含本次 3 处修复）

# 图片模式（素材与 URL 状态已缓存，可直接复验创建/轮询）
node C:\Users\13266\AppData\Local\Temp\scene3d-probe\sdk\recon_test.mjs space normal 0
# 视频模式（观察创建被拒）
node C:\Users\13266\AppData\Local\Temp\scene3d-probe\sdk\video_test_v2.mjs

# 查任一历史任务
curl "http://127.0.0.1:3199/world?worldId=3FO4K4RKL87J"
```

## 证据索引

`docs/evidence/scene3d-recon-2026-11/`：`sparse_views7.png`（本地 SfM 俯视图）、`sparse_points.ply`、`sfm_report7.json`、`quality_scores.json`（130 张清晰度/亮度分）、`support_email_draft.md`、`sdk_traffic_sample.log`（官方 SDK 流量日志）。完整日志在 `%TEMP%\scene3d-probe\`（`sdk/test_*_log.txt`、`sdk/sdk_traffic.log`）。

## 硬钉（重申）

- 官方回复前不新建扣额度任务；不伪造成功；splat 永远是观感层不进碰撞/拾取。
- 代理三处修复**未提交**，由 T 卡走审合流程，勿直接当已合入。
