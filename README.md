# 幕景 Scendance

**把真实户外场地变成能搭建的 3D 空间，再让一个会做设计的 Agent 把方案摆进去。**

客户说一句「杭州的园林婚礼，80 人 8 桌」，它给候选场地并说明哪些已经重建好；人选定之后，七个分区、三条流线，按阶段一层层摆到真实场地上，人确认一步，场景才动一步。

生成模型给的是「看起来对」。幕景补的是**量得准、摆得下、交得出**——真实尺寸、真实地面、执行团队能直接照着搭。

## 参赛信息

| 项 | 内容 |
| --- | --- |
| 赛事 | Aholo 全球 3D AI 黑客松 |
| 赛道 | 真实场景 → 可编辑空间 → 可执行方案 |
| 评分权重 | 群核技术栈 30% · 有趣 25% · 创新 20% · 完成度 20% · 传播 5% |
| Demo 场景 | 西湖园林 · 中式户外园林婚礼 · 80 人 / 8 桌 · 七个分区 / 三条流线 |
| 必交材料 | 项目报告书、完整 Demo（含真实运行画面）、小红书 `#Aholo黑客松`、源代码 |
| 已重建资产 | `docs/evidence/aholo/xh02-0233-normal/`（22.2 MB，1,256,418 点） |

「西湖园林」是 Demo 里的展示名，不指认任何具体园子或酒店。

## 一条方案是怎么长出来的

业务口径七个环节，代码口径是 Agent 的八个阶段——两个数字不一样是正常的，前者对客户与执行团队说，后者是会话内部的推进顺序。

| # | 业务环节 | 谁在做 | 产出 |
| --- | --- | --- | --- |
| 1 | 选场地 | Agent（`place`） | 按人数、风格、能否 3D 预览给候选 |
| 2 | 高德地图圈选 | Agent（`scope`） | 锚点 + 边界，成为后续所有尺寸的坐标系 |
| 3 | 现场采集 | 手机端导引 | 数量、层数、重叠、尺度基准达标的素材 |
| 4 | 场景重建 | **Aholo Reality** | 3DGS 场景 `.spz`，真实地面与天光的底 |
| 5 | 空间布置 | 幕景画布（`zones → main-routes → objects → sub-routes → people`） | 七分区、三流线的 2D/3D 同源方案 |
| 6 | 定制物料 | **Lux3D**（`refine-3d`） | GLB 归一化后进物料库，原位替换体块 |
| 7 | 交付 | 幕景导出 | 机位图册、物料清单 CSV、DXF 平面、只读分享链接 |

Agent 的每一步都是「提案 → 预览 → 人确认 → 才写画布」，确认、驳回、作废都进复核台账 —— `lib/agent-proposal.ts`、`lib/review-ledger.ts`。

## 群核技术栈用在哪

| 能力 | 在幕景里的位置 | 少了它会怎样 |
| --- | --- | --- |
| Aholo Reality | 把手机拍的照片/视频重建成 3DGS 场地，`.spz` 进画布当真实底 | 只剩卫星图和想象力，摆位全靠猜 |
| Lux3D | 婚礼物料不能买标准件：拱门、迎宾牌、签到台在对话框里直接生成 GLB | 每个人都在等定制打样 |

照片/视频不是点一下就出可编辑几何：采集不达标就重建不出来，这条硬约束写在 [docs/01-素材与3D重建.md](docs/01-素材与3D重建.md)。重建出的 3DGS **只提供观感，不提供精确几何**——量尺与碰撞由矢量壳和 GLB 承担。

## 实景包怎么进画布

从 Aholo Reality 下载的 `.spz` / `.ply`，在「场景库 → 实景扫描 → 上传」直传本机资产代理，登记后立刻能在 3D 里看。派生 LOD 也按约定自动挂载：

```text
frontend/public/scans/<文件名主干>/
  jiangnan-village.spz    L0 全量
  lod-1.spz               L1 1/4
  lod-2.spz               L2 1/8
  lod-meta.json           三档索引（source 必须与上传文件同名）
```

上传时探到同名目录，就随资产记录一起登记 `lodUrl`，预览按相机距离换档 —— `lib/scan-upload.ts`、`three/splat-preview.ts`。实测一份 953 万点的社区场景：402.5 / 100.7 / 50.7 MB 三档，首屏先挂最粗那档。

## 跑起来

Node.js ≥ 24.15（或 ≥ 26）。

```bash
npm ci
npm --prefix frontend ci
npm --prefix frontend run dev     # http://localhost:3000，同时拉起 127.0.0.1:3199 代理
npm --prefix frontend run typecheck
npm test                          # 根：后端 tests/
npm --prefix frontend run test    # 前端 Vitest
npm --prefix frontend run build   # 静态导出到 frontend/out
```

官网与新手指引在 `/introduction`、`/guide`，构建时由 `scripts/package-pages.mjs` 复制进 `public/`。

---

# 工程附录

## 环境变量

根 `.env.local` 供脚本与 Edge Functions，`frontend/.env.local` 只放公开配置；键名见两处 `.env.example`。

| 组 | 键名 |
| --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（旧名 `NEXT_PUBLIC_SUPABASE_ANON_KEY`）、`SUPABASE_SERVICE_ROLE_KEY` |
| Lux3D | `LUX3D_API_KEY`、`LUX3D_BASE_URL`、`LUX3D_TERMS_URL`、`LUX3D_TERMS_REVIEWED_AT`、`NEXT_PUBLIC_LUX3D_DIRECT_URL`（可选直连中转） |
| AMap | `NEXT_PUBLIC_AMAP_KEY`、`NEXT_PUBLIC_AMAP_SECURITY_CODE`、`NEXT_PUBLIC_AMAP_STATIC_KEY` |
| 对话模型 | `SILICONFLOW_API_KEY`、`AGENT_CHAT_BASE_URL`、`AGENT_CHAT_KEY`、`AGENT_CHAT_MODEL`、`TOKENDANCE_API_KEY` |
| 底图 Carto | `CARTO_KEY`（Pages 运行时环境变量，本地写根 `.env.local`。浏览器不读，统一走同源 `/api/carto-tiles`） |

## 目录结构

```
frontend/                    Next.js 工作台（静态导出）
  app/view/                  只读分享查看器
  components/room-organizer/ 编辑器：2D/3D 画布、面板、Agent、导出
  lib/share-snapshot.ts      分享快照编解码
client/scene-client.ts       前后端契约客户端
supabase/functions/          scene-api / generation-worker / reconstruction-worker
supabase/migrations/         25 个数据库迁移
assets/library/              529 个 GLB 物料
scripts/                     打包、dev 代理、配置校验
docs/                        文档，入口 docs/README.md
```

路径缩写：`lib/`、`hooks/`、`panels/` 默认相对 `frontend/components/room-organizer/`。

## 编辑器能力清单

**编辑**：2D 平面与 3D 场景双视图状态不丢；拖动、旋转、缩放、复制、框选、对齐、锁定；撤销/重做按动作成组 —— `panels/scendance-workspace.tsx`、`lib/alignment.ts`、`hooks/use-history.ts`。

**分享与交付**：只读分享 `/view#s1=` 内嵌快照无需后端；云项目走分享 token（需后端已部署）。导出含机位图册（4 机位 + 离线 HTML）、物料清单 CSV、DXF 平面、按比例打印/PDF —— `frontend/lib/share-snapshot.ts`、`lib/plan-export/`。

## 已知边界

- **照片/视频不是点一下就出可编辑几何**：采集不达标就重建不出来，西湖 24 张历史素材实测 0/32 坐标、覆盖 102.6°，判定不可用。
- **3DGS 只提供观感**：不能当量尺或碰撞体，摆位精度由 GLB / 矢量壳承担。
- **云端资产链路需自行部署**：仓库内有 25 个迁移与 3 个 Edge Function 源码，各环境是否已部署需确认；未上云的本地资产会阻止云端保存（`LOCAL_ASSET_NOT_UPLOADED`）。
- **本机扫描/生成物默认只登记在当前浏览器**：跨设备依赖云端资产链路 —— `lib/aholo-assets.ts`。
- **移动端是紧凑版**：≤ 768px 走窄屏 HUD 与抽屉，部分桌面面板能力受限。
- **交付导出不支持完整场景预设与建筑入口扩展**：这两类方案明确拒绝导出，不做降级。

## 拆出去的两个仓

| 仓库 | 内容 |
| --- | --- |
| [`LiliLIN0324/scendance-capture`](https://github.com/LiliLIN0324/scendance-capture) | 现场采集器（2026-11-05 独立） |
| [`LiliLIN0324/scendance-scene-library`](https://github.com/LiliLIN0324/scendance-scene-library) | 10 套场景模板库（2026-11-19 独立） |

## 文档

唯一入口：[docs/README.md](docs/README.md)。
