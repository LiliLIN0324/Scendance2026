# 第三方图标素材清单（OnePlan 物件库快照）

本目录保存一组第三方图标素材，用于本地原型阶段的视觉对齐与排版验证。素材著作权归 OnePlan（app.oneplan.io）所有，本项目**未取得再分发或商用许可**；可用范围与禁止事项见「权利与使用限制」。

每个文件均为原始响应的逐字节副本（未重绘、未改色）。**完整台账**（含每条素材的源 URL、字节数与 SHA-256）在本文件旁的 [manifest.audit.json](manifest.audit.json)，只留本目录、不进产物；前端运行时读的是由它生成的精简清单 `frontend/public/oneplan-icons/manifest.json`（只含名称/类目/路径/viewBox），生成脚本：`node scripts/sync-oneplan-manifest.mjs`。

## 来源

| 项 | 值 |
| --- | --- |
| 素材来源 | OnePlan 物件库（`app.oneplan.io`）公开 CDN 路径 |
| 资源主机 | `https://cdn.oneplan.io/images/templates/`（公开可直取，无需登录凭证） |
| 本站采集记录 | `oneplan-study/network-capture.json`（2026-11-09T18:50:42.733Z） |
| 名称表 | `oneplan-study/sticker-taxonomy.zh.json`（454 个物件名，中英双语） |
| 文件总数 | 549（15834 KiB） |

## 台账去哪儿了（方案 C）

下表是完整台账的内容与当前存放位置。它跟 `frontend/public/` 已经完全分开，不再随 `next build` 进产物：

| 文件 | 现状 | 说明 |
| --- | --- | --- |
| `manifest.audit.json` | 本目录 | 549 条完整台账（源 URL / 字节数 / SHA-256 / 探测统计），仅仓库内保留 |
| `manifest.json` | `frontend/public/oneplan-icons/` | 运行期精简清单，由 `scripts/sync-oneplan-manifest.mjs` 生成 |
| `NAMES.md` | 本目录 | 物件名 ↔ 文件对照表（含 CDN 上无文件的物件名清单） |
| `gallery.html` | 本目录 | 静态浏览页；已不随站点发布，只作本地查阅 |
| `ATTRIBUTION.md` | 本目录 | 本文件 |

构建后守卫：`node scripts/check-oneplan-artifacts.mjs`（已接在 `npm run build` 末尾）。它扫 `frontend/out` 与 `.next`，只要台账文件或含 `cdn.oneplan.io` / `sha256` 的文本重新出现在产物里，构建就会失败。

## 目录

| 目录 | 数量 | 含义 |
| --- | ---: | --- |
| `icon/` | 245 | 地图符号（放置物件时画在平面图上的贴纸） |
| `scale-fg/` | 149 | 物件真实尺度的前景图形（随比例缩放） |
| `scale-bg/` | 149 | 物件真实尺度的底形 / footprint |
| `area/` | 3 | 面域底形（人群区 / 通用区 / 停车区） |
| `categories/` | 3 | 物件库分类图标 |

上表五个目录仍在 `frontend/public/oneplan-icons/`（运行时直接取图），台账四件套已全部移出 public，见上一节。

## 文件与清单口径

- 目录内 549 个文件，对应 548 个独立素材；其中 1 个是按命名规则补齐的（物件库按需加载，未展开的物件不会出现在网络记录里）。
- 缺失判定：资源主机为 Cloudflare + S3。`403 + application/xml + AccessDenied` 视为该 key 不存在（本轮 3216 次）；`403 + text/html + "Just a moment..."` 视为限流，按 2s/4s/8s 退避重试，仍失败者记入完整台账的 `unresolved_probes`（0 次）。
- 分类清单 454 个名字的覆盖：同时有符号与尺度的 4、只有符号的 230、只有尺度图形的 111、CDN 上两样都没有的 109。
  - 只有符号/只有尺度不是抓漏：OnePlan 本身对不同物件给的文件不同（例如人流角色 Security / Medical 用透明圆点 + 文字，不给独立图形）。
  - 两样都没有的那批，见 [NAMES.md](NAMES.md) 附录——它们在 CDN 上确实没有同名文件，一般是按角色/文字渲染，或命名与本快照不同。

## 用法

```tsx
// 作为静态资源直取（Next public 目录，无需 import；也不进 bundle）
<img src="/oneplan-icons/icon/stage.svg" alt="舞台" width={24} height={24} />
```

- 每个文件自带 `viewBox`（多为 `0 0 24 24`，见 manifest），`<img>` 尺寸自定。
- 用 `<img>` 时无法通过 `currentColor` 换色；需要跟主题色走时把 SVG 内联，改 `fill` / `stroke`。
- `icon/<slug>` 与 `scale-fg/<slug>`、`scale-bg/<slug>` 同名成对，便于切「符号态 / 真实尺度态」。
- 体量：中位文件约 1 KiB；18 个农场/集市插画图标 >600 KiB（描边路径极长），批量渲染前建议 svgo 压缩或按需加载。

## 权利与使用限制

- **权利归属**：本目录素材是 OnePlan 的产品资产，并非开源图标库；著作权归 OnePlan，本项目对其**未取得再分发、商用或衍生作品许可**。
- **允许的用途**：仅限本地原型、内部视觉对齐与设计比对。
- **禁止的用途**：不得随产品、站点、安装包或对外文档发布；不得用于对外演示、投标或客户交付；不得再分发或上传到公开仓库。
- **对外发布的前置条件**：任何对外发布或客户交付前，必须把 `icon/`、`scale-fg/`、`scale-bg/`、`area/`、`categories/` 替换为自绘或已获授权素材（本页历史 H4-a 口径即「同风格自绘，不直接使用 OnePlan 素材」）。
- 本目录只含图像资源，不含 OnePlan 的代码、接口数据或账号凭证。

## 附：本项目补充的两枚图标（非 OnePlan 来源）

下列文件不是 CDN 副本，是后来补的，按各自许可使用：

| 文件 | 图形 | 来源 | 许可 |
| --- | --- | --- | --- |
| `icon/tourist.svg` | 行人（游客/参观者） | Fluent UI System Icons `person-walking-24-filled`（Microsoft），重排进 0 0 24 24 网格并加同套外圈 | MIT |
| `icon/audience.svg` | 三头 + 两排座位（观众） | 本项目自绘，照 icon/ 里 24×24 白字形规范 | 随项目 |

说明：OnePlan 没有可用的观众图形（Cricket pack 的 Spectator Services 登记的是透明通用点），库内也没有合适的游客图形（`school-children` 是大人牵小孩，已弃用但文件保留）。

## 附：CDN 上无同名文件的物件名（109）

- Camping Area（露营区）— Areas
- Crowd Area（人群聚集区）— Areas
- Generic Area（通用区域）— Areas
- Parking Area（停车区）— Areas
- Pedestrian Route（步行流线）— Routes
- Vehicle Route（车辆流线）— Routes
- Cone Line（锥桶线）— Barriers
- Crowd Control Barrier（人群管制护栏）— Barriers
- Front of Stage Barrier（舞台前护栏）— Barriers
- High Perimeter Fence（高围挡）— Barriers
- Mesh Fence（网状围栏）— Barriers
- Signage Frame 2 Sides（双面导视架）— Branding and Signage
- Signage Frame 4 Sides（四面导视架）— Branding and Signage
- Lighting Tower (Permanent)（照明塔（永久））— Electrical
- Lighting Tower (Temporary)（照明塔（临时））— Electrical
- Food Vendor（食品摊位）— Food and Beverage
- Beach Chair（沙滩椅）— Furniture
- ADA Viewing Platform（无障碍观景台（ADA））— Structures
- Canopy Tent（篷顶帐篷）— Structures
- Office Trailer（办公拖车房）— Structures
- ADA Restroom（ADA 无障碍卫生间）— Toilets
- Men's Urinal（男厕小便池）— Toilets
- Portable Restroom（移动卫生间）— Toilets
- Restroom Trailer（卫生间拖车）— Toilets
- Broadcast Truck（转播车）— Vehicles
- Cargo Van（货运面包车）— Vehicles
- City Bus（城市公交）— Vehicles
- Fire Truck（消防车）— Vehicles
- Police Patrol Car（巡逻警车）— Vehicles
- Semi-Truck（半挂卡车）— Vehicles
- Dumpster（大型垃圾箱）— Waste
- Trash（垃圾桶）— Waste
- Custom Dot（自定义点位）— Workforce
- Fire（消防人员）— Workforce
- Manager（经理/负责人）— Workforce
- Medical（医护人员）— Workforce
- Security（安保）— Workforce
- Steward（场务）— Workforce
- Supervisor（主管）— Workforce
- Volunteer（志愿者）— Workforce
- Accreditation Manager（证件认证经理）— Cricket pack
- Boundary Advertising/LEDS（边界广告/LED）— Cricket pack
- Boundary Rope and Toblerones（边界绳与三角墩）— Cricket pack
- Broadcast Manager（转播经理）— Cricket pack
- Cricket Operations Manager（板球运营经理）— Cricket pack
- DJ（DJ）— Cricket pack
- Doping Control Officer（反兴奋剂官）— Cricket pack
- Field of Play Access（赛场通道）— Cricket pack
- Flood Light（泛光灯）— Cricket pack
- Groundsperson（场地管理员）— Cricket pack
- High 45（High 45 机位）— Cricket pack
- Hospitality Manager（接待经理）— Cricket pack
- LED Operator（LED 操作员）— Cricket pack
- Match Officials（赛事裁判官员）— Cricket pack
- Media（媒体）— Cricket pack
- Media Operations Manager（媒体运营经理）— Cricket pack
- Mid Reverse Wicket（中路反向三柱门机位）— Cricket pack
- Mid Wicket（中路三柱门机位）— Cricket pack
- Net Bowler（网前投球手位）— Cricket pack
- Perimeter Fence（围界护栏）— Cricket pack
- Player & Match Officials（球员与裁判官员）— Cricket pack
- Press Box Scorer（记者席记分员）— Cricket pack
- Reverse Slips（反向滑垒机位）— Cricket pack
- Roaming（游动机位）— Cricket pack
- Scoreboard Operator（记分牌操作员）— Cricket pack
- Spectator Services（观众服务）— Cricket pack
- Sponsorship Manager（赞助经理）— Cricket pack
- Stump Cam（三柱门摄像头）— Cricket pack
- Taxi Loadzone（出租车上下客区）— Cricket pack
- Ultra Motion（超高速摄影）— Cricket pack
- Access Control（门禁控制）— Biathlon pack
- Access Point Vehicle Main（车辆主入口）— Biathlon pack
- Access Point Vehicle Secondary（车辆次入口）— Biathlon pack
- AED Defibrillator（AED 除颤仪）— Biathlon pack
- Badge Scanning（证件扫描）— Biathlon pack
- Camera Crane Left（摄像摇臂（左））— Biathlon pack
- Camera Crane Right（摄像摇臂（右））— Biathlon pack
- Doping Control（反兴奋剂检查）— Biathlon pack
- Electrical Cable（电缆）— Biathlon pack
- Finish Line（终点线）— Biathlon pack
- Intermediate on Course（赛道中间点）— Biathlon pack
- LED Screen（LED 屏）— Biathlon pack
- Paramedic（急救员）— Biathlon pack
- Power（电力点）— Biathlon pack
- Referee（裁判）— Biathlon pack
- Setup（搭建/布置点）— Biathlon pack
- Shooting Range (Inc Safety Zone)（射击靶场（含安全区））— Biathlon pack
- Start Line（起跑线）— Biathlon pack
- TV Tripod Left（电视三脚架（左））— Biathlon pack
- TV Tripod Right（电视三脚架（右））— Biathlon pack
- Visual Check（目视检查点）— Biathlon pack
- Barrier Concord（康科德护栏）— Race pack
- Bike Course（骑行赛道）— Race pack
- Bike Racks: Double-sided（自行车架（双面））— Race pack
- Bike Racks: Single-sided（自行车架（单面））— Race pack
- Dismount Area（下车区）— Race pack
- Dismount Line（下车线）— Race pack
- Mount Area（上车区）— Race pack
- Mount Line（上车线）— Race pack
- Pin And Tape（别针与胶带）— Race pack
- Run Course（跑步赛道）— Race pack
- Swim Course（游泳赛道）— Race pack
- Timing Mat（计时毯）— Race pack
- Transition racks: Double-sided（转换区车架（双面））— Race pack
- Transition racks: Single-sided（转换区车架（单面））— Race pack
- Maintenance（维保）— Fairs, Shows & Markets pack
- Performer（表演者）— Fairs, Shows & Markets pack
- Traffic Marshall（交通指挥员）— Fairs, Shows & Markets pack
- Vendor Seller（摊主/商贩）— Fairs, Shows & Markets pack
