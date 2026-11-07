# 雕塑 T-Pose 派生 + 回 Aholo 绑骨（第 3 轮）

原雕塑 GLB 全程只读未改：`docs/evidence/aholo/sculpture-img2-3d/4676340-unpacked/MODEL.glb`（985,424 B，mtime 未变）。

## 1. Blender 安装

| 项 | 值 |
| --- | --- |
| 版本 | **Blender 4.5.10 LTS**（build 2026-05-19，hash `6dc0b208d1b5`） |
| 路径 | `D:\tools\blender\blender-4.5.10-windows-x64\blender.exe` |
| 内置 Python | 3.11.11，glTF 插件 `export_scene.gltf` 可用 |
| winget | `winget install BlenderFoundation.Blender.LTS.4.5` **失败**，退出码 1602（MSI 需管理员提权，非交互下被取消） |
| 实际方式 | 官方 zip 便携解压。`download.blender.org` 直连被 Cloudflare 拦（curl 只拿到 61,548 B 的 "Just a moment" 页面）；`Invoke-WebRequest` 也在 360,664,687/398,911,842 B 处 EOF 中断且服务端不支持 Range 续传 |
| 镜像 | `https://mirrors.tuna.tsinghua.edu.cn/blender/release/Blender4.5/blender-4.5.10-windows-x64.zip` |
| 下载 | **398,911,842 B / 27 s**，SHA256 `EF6D846B8015F47ADE6DF3F9322CE17419080A5D922FA562B6C966064FE30DCE` |
| 解压 | `tar -xf`（bsdtar，`Expand-Archive` 对截断包报「找不到中央目录结束符」）/ 15 s |
| 验证 | `blender --version` 打出上表版本；`--background --python-expr` 打印 `BPY_VERSION=4.5.10 LTS`、`PY=3.11.11`、`GLTF_ADDON=True` |

## 2. T-Pose 派生（数字全部来自 bpy）

脚本 `derive_tpose_v5.py`（最终采用）、`derive_tpose_v4.py`（旋转版对照）、`analyze_silhouette.py`（逐层量测 + 正交剪影）、`render_glb.py`（四视图）、`diag_coords.py`（坐标系探针）。

| 指标 | 原始 MODEL.glb | 派生 MODEL-tpose.glb | 差 |
| --- | --- | --- | --- |
| 宽 x | 0.846073 m | **1.406383 m** | **+0.560310** |
| 深 y | 0.842209 m | 0.842209 m | 0.000000 |
| 高 z | 1.800000 m | 1.800000 m | 0.000000 |
| 顶点 | 19,883 | 19,883 | 0 |
| 三角面 | 28,888 | 28,888 | 0 |
| 字节 | 985,424 | 812,712 | −172,712 |
| 臂展/身高 | 0.470 | 0.781 | — |

- 米制、Y-up（`export_yup=True`）、底面贴地（bbox min z = 0），包围盒 x 对称 ±0.703192。
- 被移动顶点 6,948 / 19,883（34.9%）；参数 `DX=0.36 m, DZ=+0.08 m`，手部团簇球半径 `0.24 m`。
- 方法：对「臂袖带」(`|x|` 0.10→0.20 渐变、`z` 0.78→1.52 m 渐入渐出) 做横向平移，并把检出的胸前交叠手团簇一并外移。

逐层 max|x|（5 cm 切片，终版）：0.75 m 以下 0.33–0.50（未动区 + 亚像素级外扩）；**0.90–1.45 m 跃升到 0.66–0.70**；1.50 m 处硬截断回落 0.2121 —— 外张质量集中在 0.90–1.45 m 一条板状带，上沿有明显断层。

### 变形最明显的位置
1. **臂袖带 0.90–1.45 m**：整片被外推 0.36 m，形成一条 ±0.70 m 的水平板状体，这是宽度的全部来源。
2. **胸前手部团簇**（中心 `(-0.0038, 0.2312, 1.0783)`）：被左右撕开并外移，交叠处布料拉伸。
3. **肩部（1.35–1.50 m）**：与头颈同高的衣料被左近距牵引后，1.50 m 处出现台阶。

图：`orig-front/back/left/right.png`（原始四视图）、`tpose-front.png`（v4 旋转版，可见被拉出的是**肩部衣料**而不是手臂）、`tpose5-sil-front/side.png`、`tpose-final-sil-front/side.png`（终版正交剪影）。

### 为什么 v1–v4 都没成
- **自动权重全废**：`Bone Heat Weighting: failed to find solution for one or more bones`，手臂骨骼对顶点权重覆盖率为 0，形变完全不发生（宽 0.846 不变）。
- **envelope**：只到 0.964（+14%），仍不足。
- **固定肩点胶囊权重（R=0.20）**：最好 0.9895。
- **绕肩刚性旋转（解析解算，手臂正好水平）**：宽度 1.102029（+30.2%），但剪影显示**手臂仍抱在胸前**，被甩出去的是肩部衣料；且旋转会把袖料送到 1.84 m（高过头顶），方向本身是错的。根本原因：单手到肩的距离仅 0.409 m，且臂袖与袍身是同一张融合网格，没有可独立驱动的臂部件。

## 3. 回 Aholo 绑骨（3 次，含 1 次允许的重试）

同一端点 `POST /lux3d/v1/animations/rig/task/create`，body `{modelUrl}`，同一凭据与 OUS 上传通道。积分接口不返回。

| # | 提交物 | taskId | 终态耗时 | 轮询 | 终态 | 失败原文 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 原始 MODEL.glb | 4734738 | 191 s | 38 | 4 | `{"error":{"code":"MODEL_NOT_RIGGABLE","message":"主体为类人形角色，但双臂弯曲抱于身前，不符合可绑骨的T-Pose或A-Pose站姿要求。"}}` |
| 2 | MODEL-tpose.glb（DX 0.34） | 4736139 | 28 s | 6 | 4 | `{"error":{"code":"MODEL_NOT_RIGGABLE","message":"主体为类人形角色，但双臂屈肘交叠于身前，不符合可绑骨基础站姿要求。"}}` |
| 3 | MODEL-tpose.glb（DX 0.36 / HANDR 0.24） | 4736194 | 23 s | 5 | 4 | `{"error":{"code":"MODEL_NOT_RIGGABLE","message":"主体为类人形角色，但其手臂呈抱臂姿态，不符合可绑骨的T-Pose或A-Pose基础站姿要求。"}}` |

三次全部 `MODEL_NOT_RIGGABLE`，**无任何绑骨产物**（`outputs` 只有错误 JSON 或 `false`），因此 `retarget`（`rigModelUrl` 必填）无法提交，`skins`/`JOINTS_0`/`WEIGHTS_0`/`animations` 四项核验无对象可查。重试额度已用尽，按约定停止。

注意第 2、3 次的判语从「双臂弯曲抱于身前」变成「屈肘交叠 / 抱臂姿态」——说明分类器确实读到了几何外张，但仍判定手臂形态是抱臂；宽度从 0.846 推到 1.406 也没改变这个结论。

## 4. 结论

这尊雕塑**无法通过几何变形做出可绑骨的 T/A-Pose**：手臂与袍身、底座是一张融合网格，Bone Heat 自动权重在手臂骨骼上无解，只能靠手工胶囊/平移权重；而任何足以「张开双臂」的位移或旋转都会把大片衣料拉成板状或布片，且姿势分类器仍读作抱臂。

可选的其它路线（均未执行，需另立任务）：
1. 放弃绑骨，雕塑在场景里保持静止（与「地图上不动就不动」一致）。
2. 用 Aholo 的 text2-3d / img2-3d 重新生成一尊**手臂下垂或张开**的雕塑再绑骨，而不是改造这一尊。
3. 找人工建模重拓扑出可分离的手臂，或换一个通用人形模型穿这尊的贴图——工程量远超本轮范围。
