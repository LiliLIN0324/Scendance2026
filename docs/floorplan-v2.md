# 活动场地图纸与照片重建：开发与验收

本分支 `codex/floorplan-to-3d` 从 `origin/main` 的 `edc5341` 建立，工作目录为独立的 `scendance-floorplan`。原工作目录、原分支及原站数据不参与本地运行；本阶段不合并、不部署。

## 启动独立预览

使用 Node 24.15–24.x 或 26+，在本目录运行：

```sh
npm run dev:floorplan
```

- 页面：`http://127.0.0.1:3026`
- 测试 API：`http://127.0.0.1:54336`
- 测试账号：`owner@scendance.test` / `local-integration-only`
- 数据目录：`.local-dev/floorplan/`，已被 Git 忽略。PGlite 数据库和私有图片跨进程重启保存。
- 打开“云项目”中的“人工实测场地 · 本地验收”，获取编辑权后可保存和检查三维编辑。

这个运行器使用真实应用 API、SQL 迁移及独立 PostgreSQL 兼容数据库；认证与对象存储是明确标注的本地测试替身。它不读取 `SUPABASE_URL` 或 service role 来连接原站。登录会话在 API 重启后需重新登录。样例结构由代码人工设定，不能作为图片识别效果证据。

真实识别只在本目录 `.env.local` 配置 `DEEPSEEK_API_KEY` 后运行，不存在模拟成功的默认识别。预算配置 `RECONSTRUCTION_MAX_REQUEST_CENTS` 包含识别图像和思考规划的保守预留；账本同时执行原有总预算与每日预算。真实混元单体生成另需现有 `HUNYUAN_*`、`GENERATION_*` 配置。密钥只放服务端，不放 `NEXT_PUBLIC_*`。

调整端口或保留另一个独立数据集可设置 `SCENDANCE_DEV_WEB_PORT`、`SCENDANCE_DEV_API_PORT`、`SCENDANCE_DEV_DATA`。已经执行的开发迁移若被修改，运行器会拒绝重新执行并保留旧数据；请指定一个新的数据子目录验收，不覆盖旧数据库。

## 数据与接口

权威契约在 `supabase/functions/_shared/domain.ts`，重建任务契约在 `reconstruction-contract.ts`。前端引用这些契约；所有单位为米、XZ 平面，编辑器中心原点和角度转换集中在 `backend-adapter.ts`。

`Scene v2` 包含多边形轮廓、参数墙、归属墙的门窗、柱子、物件、来源图片、尺寸约束、识别状态、设计说明和材质。墙线可携带原图归一化位置证据，用于平面图叠加核对。照片不采用全图像素比例尺。新客户端可以读取 v1；普通保存不允许将 v2 降级，防止旧客户端覆盖结构数据。

新增接口均位于现有 `scene-api` 路由下：

- `POST /assets/sources`：multipart 来源图片上传；PNG/JPEG/WebP，每张不超过 5 MB、最长边不超过 4096 像素。
- `GET /projects/:id/sources`：项目私有来源列表；每项目最多 12 张。
- `DELETE /projects/:id/sources/:assetId`：解除项目来源关联；历史仍引用的资产不直接销毁。
- `POST /projects/:id/reconstructions`：包含编辑租约、场景、来源、尺寸、模式和要求的去重请求。
- `GET /projects/:id/reconstructions/:jobId`：轮询原任务，刷新后不重发计费请求。
- `POST /projects/:id/history/restore`：受租约、版本、场景及原提案约束的显式撤销恢复。

数据库迁移 `supabase/migrations/20261003090000_scene_v2_reconstruction.sql` 独立包含 v2 支持、来源关联、重建队列、计费预留、提案与私有分享处理。后端变更应作为独立审查范围，不能只发布前端。

重建队列由 `supabase/functions/reconstruction-worker/index.ts` 处理，与单体资产生成队列分开。云测试环境需要执行迁移、配置 `RECONSTRUCTION_WORKER_SECRET` 并由服务端定时调用 worker；仅部署 API 不会自动消费队列。现有混元 worker 保持独立。运行本地预览时，运行器会自动轮询两条队列，仅在对应真实密钥存在时调用服务。

## 用户流程与约束

1. 在需求面板添加图纸、照片或混合图片。自动类型建议基于文件名及图像特征，可逐张纠正；来源原文件与表单保存在 IndexedDB，生成时上传至项目私有来源库。
2. 填写整体尺寸、文字尺寸或在图纸上选择两点。文字解析形成可编辑清单，随后关联墙、门窗或柱子。照片每次生成须选择“还原现场”或“重新布置”。
3. 识别调用与创意规划调用分开。识别使用 `deepseek-flash` 图像输入；规划开启思考。不可见区域和模型识别结果不能自行成为“用户确认”。
4. 核对原图证据与米制平面结构，补充尺寸、修正关联与结构。全局宽深高及关联参考距离可以校准；无法唯一确定的局部约束和矛盾尺寸保持待核对，不通过拉伸未知结构假装求解。
5. 规划保留结构、尺寸、锁定与保留对象，输出设计说明、物件关联亮点和逐项要求结果。几何、尺寸、数量以及资产引用校验后才形成可应用候选。
6. 三维候选不会直接改写编辑场景。确认应用沿用提案的租约、版本和哈希检查；编辑或变更输入会使旧候选失效。

普通物件使用已有资产或参数物料。异形装饰通过现有混元 LowPoly 单体流程按需生成；未生成的资产保持缺项说明。Qwen 不自动切换到生产识别。当前版本依赖用户核对尺寸和遮挡区域，不承诺单张照片自动测得完整建筑。

## 防穿墙和保存

`structural-geometry.ts` 为前后端共享的纯几何校验：包含旋转后完整物体占地、墙厚、墙高、开口范围、柱子、凹多边形边界及有限制的挂墙规则。墙隐藏只影响展示。移动最终位置通过即可，允许跨房间重新放置。

新增、拖动、键盘、旋转、缩放、复制和批量修改在 reducer 处统一校验，整批通过或拒绝；拖放回到最后有效位置，新增无法放下时保留待放置状态。旧冲突可以逐步消除，不能增加或加重。后端保存和 AI 提案再次校验，不能依赖前端变红提示。

已确认尺寸的 1 毫米阈值用于数据计算与保存一致性，不能表述为图片识别精度。模型识别准确率需使用人工标注的实际图纸和照片另行评测。

## 验证方法

```sh
npm run typecheck
npm test -- --maxWorkers=2
npm run check:edge
npm --prefix frontend run typecheck
npm --prefix frontend test -- --maxWorkers=2
npm --prefix frontend run build
```

本地联调测试需允许绑定 loopback 端口。`tests/local-persistence.test.ts` 检查数据库与私有来源在重启后恢复；前端重建联调测试调用真实 API 与 PGlite，模型返回使用显式测试响应，不能算真实识别验收。详细执行结果和未验证项另见 `docs/archive/floorplan-verification.md`。
