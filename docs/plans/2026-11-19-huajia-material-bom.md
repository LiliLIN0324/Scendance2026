# 花家山庄室外草坪 · 物料清单与 BOM

> 生成日期：2026-11-19（2026-11-19T17:00+08:00）　|　作者：幕景策划（Agent 产出的文档与数据文件）
>
> **范围**：只做**室外草坪**。室内（仙子厅 / 百花厅 / 桂香园 / 杜鹃厅 / 水仙楼大堂）只作为**雨备退路**一句带过，**不做室内分区**。
>
> **本文不是验收结论**：文中所有数量都是「按暂定口径推算」的排期草案，草坪面积未现场核实；没有任何一项被写成「已验收」「已上线」。
>
> **两处最容易出事的地方**：(1) 草坪面积三套口径互相冲突（1500 / 600 / 1200 m²），本清单一律不拿它当设计真值；(2) 37 件生成件里有 18 件的**提示词自述尺寸与 GLB 实测尺寸不一致**，下文「尺寸偏差表」逐条列了实测值与影响。

## 一、场地事实与硬约束

### 1.1 位置（GCJ-02，出处 S6）

| POI | 经度 | 纬度 |
| --- | --- | --- |
| 大堂 | 120.132327 | 30.223452 |
| 桂花楼（1 层） | 120.132514 | 30.223436 |
| 中餐厅 | 120.132438 | 30.223415 |
| 会议厅 | 120.13235 | 30.223429 |
| 宿舍楼 | 120.133213 | 30.223256 |
| 杜鹃楼 | 120.13143 | 30.222685 |
| 水仙楼（3 号楼） | 120.130728 | 30.223674 |
| 停车场 | 120.133678 | 30.224685 |
| 停车场出入口 | 120.134025 | 30.22538 |
| 地上停车场 | 120.134091 | 30.225341 |
| 雅谷泉（园区八景之一，滴翠湖一带） | 120.133025 | 30.225175 |
| **主点：杭州花家山庄** | **120.132272** | **30.223908** |

> 坐标来自平台自己的高德检索结果，不是官方测绘数据；用于排位和估距，不能当施工图用。

### 1.2 场地规模与宴会厅（出处 S7 / S11）

- 占地约 158 亩、绿地 95% 以上；「一湖、三楼、八景」。
- 宴会厅：仙子厅 1 楼 26×18 m / 层高 7.5 m / 450 m² / 无柱无窗 / 最多约 30 桌；百花厅 3 楼 24×20 m / 层高 5.5 m；桂香园 1 号楼；杜鹃厅 220 m²（3 楼）；水仙楼大堂 300 m²（1 楼、高 10 m、无柱）。

### 1.3 草坪面积：三套口径并存，**不作为设计真值**

| 口径 | 面积 | 说明 | 出处 | 状态 |
| --- | --- | --- | --- | --- |
| 园景草坪 | 1500 m² | — | S8 | 待现场核实 |
| 湖景草坪 | 600 m² | — | S9 | 待现场核实 |
| 户外草坪（可容 300 人，「草坪形状端正、中间没有树木遮挡」） | 1200 m² | — | S10 | 待现场核实 |

> 三套口径互相冲突，本清单一律不把草坪面积当设计真值；分区数量按「布置口径」暂定，现场量测后重排。

### 1.4 硬约束（出处 S12）

- 西湖景区单双号限行（尾号单双日）
- 非合作婚庆入场费 5000 元、LED 屏租用费 4000 元
- 旺季 5 月 / 10 月；双休日建议提前半年预订
- 停车免费

### 1.5 查不到、因此不写的（不编）

- 禁喷花 / 明火 / 雨天预案的明文条款——未查到，不编。
- 官方平面图——未查到。
- 两片草坪的准确边界形状——未查到。
- 精确经纬度的权威来源——上列坐标是平台高德 lookup 结果（GCJ-02），非官方测绘。

## 二、数据来源与可复现命令

| 编号 | 来源 | 内容 |
| --- | --- | --- |
| S1 | Supabase scene_private.assets | owner_id='56356f34-a34f-4745-b418-29e16e1de728' 且 format='glb' 的 37 行；字段 id / name / source / storage_path / metadata / license。 |
| S2 | Supabase scene_private.published_assets | 37/37 行，catalog='scendance-generated'，published_at 2026-11-19T06:04:57Z。 |
| S3 | Supabase scene_private.generation_jobs | 3 件早期生成件（缺 metadata.originalPrompt）的原始提示词。 |
| S4 | assets/library/merged.json | 976 个模型（已注册 528 / 可摆放 975）；字段 slug / name / width / depth / height / license / page / assetId。 |
| S5 | .temp/lib-query.txt、.temp/lib-query2.txt | 本次按品类关键词对 merged.json 的检索结果。 |
| S6 | 平台高德检索（GCJ-02） | 花家山庄及园区各建筑 POI 坐标。 |
| S7 | 花家山庄官网 | 占地约 158 亩、绿地 95% 以上、「一湖、三楼、八景」。 |
| S8 | 官方 / 腾讯新闻口径 | 园景草坪 1500 m²。 |
| S9 | 婚芭莎口径 | 湖景草坪 600 m²。 |
| S10 | 2015 杭州网口径 | 户外草坪 1200 m²、可容 300 人、「草坪形状端正、中间没有树木遮挡」。 |
| S11 | 场地宴会厅公开资料 | 仙子厅 1 楼 26×18 m / 层高 7.5 m / 450 m² / 无柱无窗 / 最多约 30 桌；百花厅 3 楼 24×20 m / 层高 5.5 m；桂香园 1 号楼；杜鹃厅 220 m² 3 楼；水仙楼大堂 300 m² 1 楼高 10 m 无柱。 |
| S12 | 场地公开经营说明 | 西湖景区单双号限行（尾号单双日）；非合作婚庆入场费 5000 元、LED 屏租用费 4000 元；旺季 5 月 / 10 月，双休日建议提前半年预订；停车免费。 |
| S13 | frontend/components/room-organizer/lib/price-book.ts | priceBook 缺省返回 null（未定价），不返回 0；清价即从书里移除。 |
| S14 | merged.json 的 license 与 page 字段 | 静态库素材的出处（CC0-1.0 来自 3dassets.dev；project-authored 为平台自绘）。 |

取数命令（凭据在根 `.env.local`，脚本不打印令牌）：

```powershell
$env:NODE_USE_ENV_PROXY='0'
node .temp/huajia-fetch-assets.mjs          # 37 件生成物料 → .temp/huajia-assets37.json
node .temp/huajia-lib-slugs.mjs              # 静态库引用条目 → .temp/huajia-lib-slugs.json
node .temp/huajia-build-bom.mjs              # 生成本 md + json
```

静态库底数（出处 S4）：**976** 个模型，已注册 528，可摆放 975。

## 三、布置口径（全部为暂定，待现场核实后重排）

| 口径项 | 取值 | 依据 |
| --- | --- | --- |
| 宾客规模 | 目标 250 席（上限 300 席取 80% 留缓冲） | 2015 杭州网口径「户外草坪可容 300 人」；该口径与另两套草坪面积口径冲突，均未现场核实。 |
| 仪式区尺寸 | 净宽 8 m × 进深 6 m | 按平台 lawn 预设 28×20 m 量级反推；非实测，待现场核。 |
| 甜品区 | 甜品长桌 2 张 + 香槟塔 2 座 + 咖啡桌 3 张 | 按 250 席自助取餐估算；待现场核。 |
| 桌数与席数 | 25 桌；aholo 圆桌按 8 席/桌 = 200 席坐席，白木椅按 250 把备（含 50 席备用） | aholo 婚礼圆桌实测直径仅 1.20 m（提示词写 1.8 m），1.2 m 圆桌排 8 席；要坐满 250 席须改用静态库 1.80 m 宴会圆桌（10 席/桌）或加到 32 桌——两者都需现场定。 |
| 单价 | 全部「未定价」 | platform plan.priceBook 缺省即未定价，不返回 0（frontend/components/room-organizer/lib/price-book.ts）。 |
| 草坪面积 | 三套口径并存，不作为设计真值 | 1500 m²（园景草坪）/ 600 m²（湖景草坪）/ 1200 m²（户外草坪，可容 300 人）——全部标待现场核实。 |

> 单价一栏全部是「未定价」：平台 `plan.priceBook` 缺省就是未定价，**不返回 0**（出处 S13）。任何一格写成「0 元」都是错的。

## 四、分区 → 物料 → 数量 → 尺寸 → 单价状态

分区骨架：**丽丽在幕景里实际画的 4 个分区**（仪式区 / 宾客席位区 / 餐饮区 / 迎宾签到区）+ **我方按场地事实补的 6 个点**（垃圾/环卫点 / 指示牌 / 医疗点 / 停车落客 / 装卸 / 雨备）。

### Z1 仪式区

*丽丽在幕景里实际画的 4 分区之一：草坪北端；朝向待现场核；本区为仪式主画面。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 婚礼双拱花门 | aholo `6ba6af9a-871a-4500-be20-536db5bd1b01`（aholo 供应商条款） | 2.40 × 0.66 × 1.98 | 1 | 未定价 | 主仪式门；白玫瑰+淡紫绣球双环，可正对主通道。 |
| 2 | 婚礼花拱门 | aholo `f78f294f-1663-4e49-b197-3c7f8dc48a4f`（aholo 供应商条款） | 2.00 × 0.62 × 1.86 | 1 | 未定价 | 第二拱门/合影备用；提示词写「高约 2.4 m」，实测仅 1.86 m，作次门不作主视觉。 |
| 3 | 半圆弧形婚礼花墙背景板 | aholo `be385dc7-8927-487b-8dbd-7efc8f126a13`（aholo 供应商条款） | 2.40 × 1.51 × 2.38 | 1 | 未定价 | 仪式背景板；实测宽 2.40 m（提示词写 2.5 m），台下需配背架。 |
| 4 | 婚礼香槟布幔花艺柱 | aholo `4923657e-af62-4469-98d3-dedbf45db633`（aholo 供应商条款） | 0.74 × 0.69 × 1.80 | 2 | 未定价 | 背景板两侧对称；实测高 1.80 m（提示词写 2.4 m）。 |
| 5 | 婚礼花柱 | aholo `0bc698c6-d2c9-4091-8483-6039113061e4`（aholo 供应商条款） | 0.73 × 0.69 × 1.80 | 4 | 未定价 | 主通道两侧各 2 根；实测柱径 0.73 m、高 1.80 m。 |
| 6 | 婚礼垂吊花球 | aholo `87221ce6-aab3-4cf3-89a0-0a8a651ee004`（aholo 供应商条款） | 0.45 × 0.43 × 0.53 | 6 | 未定价 | 顶部悬挂花球；需搭挂点，库内无挂点件（见缺口 G12）。 |
| 7 | 婚礼珍珠串帘 | aholo `cb293f67-912b-4b0b-ac98-d0f38b9be787`（aholo 供应商条款） | 2.07 × 0.15 × 2.00 | 3 | 未定价 | 背景板前垂挂，宽 2.07 m。 |
| 8 | 婚礼白纱幔 | aholo `ee6e392d-3ac0-4ee8-b005-9304ad8bb627`（aholo 供应商条款） | 3.00 × 1.94 × 3.46 | 4 | 未定价 | 围合用垂幔片（3.00×1.94×3.46 m）；不是顶棚，顶棚见缺口 G6。 |
| 9 | 婚礼心形绿雕 | aholo `e5e16370-d57d-414a-8b22-5c2dd8fa3c17`（aholo 供应商条款） | 0.46 × 0.30 × 0.60 | 1 | 未定价 | 心形绿雕；小件（0.46×0.30×0.60 m），作台面/地面点缀。 |
| 10 | 婚礼月洞门绿雕 | aholo `2b0e506e-bd1c-4a32-bfb4-6bb4f28bfcb4`（aholo 供应商条款） | 0.94 × 0.53 × 0.95 | 1 | 未定价 | 月洞门绿雕（0.94×0.53×0.95 m），合影背景。 |
| 11 | 菊花绿雕异形装置 | aholo `cd1c284e-40df-4e8b-bcfb-d5347512a4c9`（aholo 供应商条款） | 1.20 × 0.60 × 1.20 | 2 | 未定价 | 弯月形菊花绿雕，入口对景。 |
| 12 | 婚礼落地花瓶 | aholo `cf868de5-a05d-4d9b-9a89-3505d36586df`（aholo 供应商条款） | 0.15 × 0.12 × 0.28 | 6 | 未定价 | 名「落地花瓶」但实测仅 0.28 m 高，实为地面花器，不能当落地瓶用。 |
| 13 | 婚礼烛台三件组 | aholo `4136fdcf-e0e4-4f87-a0c9-0088056570d1`（aholo 供应商条款） | 0.53 × 0.22 × 0.38 | 1 | 未定价 | 三只一组玻璃烛台；提示词写「高 10–25 cm」，实测总高 0.38 m。 |
| 14 | 新娘手捧花 | aholo `a620ce00-c82a-498f-8204-1cb28d8343e6`（aholo 供应商条款） | 0.50 × 0.50 × 0.50 | 1 | 未定价 | 手捧花，模型 0.50 m 见方偏大，摆放时按手持比例缩放。 |
| 15 | 桁架拱门 | 静态库 `scendance-plan-truss-arch`（project-authored） | 4.30 × 0.64 × 3.27 | 1 | 未定价 | 背板支撑骨架（4.30×0.64×3.27 m）。 |
| 16 | 音乐会舞台平台 | 静态库 `orchestra-and-band-instruments-stage-platform-module-6be1e985`（CC0-1.0） | 2.00 × 1.00 × 0.80 | 4 | 未定价 | 仪式台面模块 2.00×1.00×0.80 m，铺 4 块得 4×2 m 台。 |
| 17 | 舞台增高台块 | 静态库 `live-music-venue-and-festival-stage-stage-riser-block-0d3aaf5f`（CC0-1.0） | 1.00 × 1.00 × 0.29 | 4 | 未定价 | 台面垫高块（1.00×1.00×0.29 m）。 |
| 18 | 舞台台阶 | 静态库 `live-music-venue-and-festival-stage-stage-step-unit-f141dc1c`（CC0-1.0） | 1.20 × 1.12 × 1.81 | 2 | 未定价 | 上下台阶，高 1.81 m 明显高于 0.80 m 台面，需现场复核。 |
| 19 | 礼拜堂讲台 | 静态库 `wedding-and-chapel-kit-chapel-lectern-df983527`（CC0-1.0） | 0.50 × 0.40 × 1.15 | 1 | 未定价 | 司仪台（0.50×0.40×1.15 m）。 |
| 20 | 无障碍坡道 | 静态库 `scendance-plan-accessible-ramp`（project-authored） | 1.35 × 6.43 × 1.53 | 1 | 未定价 | 无障碍坡道 1.35×6.43×1.53 m；草坪与硬化面高差未知，用不用待现场核。 |
| 21 | 户外广播立柱音箱 | 静态库 `dog-agility-and-training-field-pa-speaker-post-8d62a208`（CC0-1.0） | 0.72 × 0.56 × 2.98 | 2 | 未定价 | 户外立柱音箱，替代无线的扩声立柱。 |
| 22 | 线阵列音箱 | 静态库 `live-music-venue-and-festival-stage-line-array-speaker-7500d812`（CC0-1.0） | 1.05 × 0.45 × 0.43 | 2 | 未定价 | 线阵列音箱，需桁架或塔架支撑。 |
| 23 | 堆叠式低音音箱 | 静态库 `nightclub-and-dj-booth-speaker-stack-sub-cabinet-77151eb8`（CC0-1.0） | 1.17 × 0.90 × 1.10 | 2 | 未定价 | 低音音箱。 |
| 24 | 人声麦克风与防喷罩 | 静态库 `music-recording-studio-and-instruments-vocal-mic-with--b6c69c11`（CC0-1.0） | 0.69 × 0.61 × 1.66 | 2 | 未定价 | 人声麦克风（带防喷罩）。 |
| 25 | 鼓手增高台 | 静态库 `live-music-venue-and-festival-stage-drum-riser-fb450f31`（CC0-1.0） | 2.40 × 2.00 × 0.75 | 1 | 未定价 | 鼓手增高台 2.40×2.00×0.75 m。 |
| 26 | 花园灯柱 | 静态库 `wedding-and-chapel-kit-lantern-post-c06e501d`（CC0-1.0） | 0.24 × 0.24 × 1.80 | 8 | 未定价 | 花园灯柱，沿通道两侧。 |
| 27 | 冬季提灯 | 静态库 `turning-seasons-winter-lantern-dc1a8170`（CC0-1.0） | 0.30 × 0.30 × 0.51 | 12 | 未定价 | 提灯，沿席位区小径。 |

小计：27 行物料（aholo 14 行 / 静态库 13 行）。

### Z2 宾客席位区

*丽丽在幕景里实际画的 4 分区之一：草坪中南部；数量按 250 席暂定，见「布置口径」。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 婚礼圆桌 | aholo `b15a34fc-f3f2-4c7c-965c-30998ae7487f`（aholo 供应商条款） | 1.20 × 1.20 × 1.05 | 25 | 未定价 | 主桌：实测直径仅 1.20 m（提示词写 1.8 m），按 8 席排布。 |
| 2 | 婚礼白木椅 | aholo `53cbb011-92b8-4c1a-a074-f7390b5ae29c`（aholo 供应商条款） | 0.54 × 0.52 × 0.95 | 250 | 未定价 | 白木梯背椅，0.54×0.52×0.95 m，与白木椅造型配套。 |
| 3 | 婚礼椅背装饰 | aholo `1fb6f4b0-3d1f-41cc-8488-70130d2b70cd`（aholo 供应商条款） | 0.66 × 0.54 × 0.90 | 50 | 未定价 | 椅背花艺带，每 2 椅一条，或每桌 2 条。 |
| 4 | 婚礼宴会桌花 | aholo `7ad8cafa-78ec-4555-8fa8-8232a4aec7ea`（aholo 供应商条款） | 0.60 × 0.62 × 0.39 | 25 | 未定价 | 每桌 1 件桌面花艺（0.60×0.62×0.39 m）。 |
| 5 | 婚礼席位卡 | aholo `13dd8827-79d9-4569-b8ad-ad46361c243d`（aholo 供应商条款） | 0.08 × 0.05 × 0.08 | 250 | 未定价 | 席位卡，金色卡座 + 米白卡纸。 |
| 6 | 婚礼桌号牌 | aholo `17ca104e-689e-4fe8-91c1-fa2a83ecf262`（aholo 供应商条款） | 0.06 × 0.06 × 0.22 | 25 | 未定价 | 桌号牌，每桌 1 个。 |
| 7 | 婚礼菜单卡立牌 | aholo `417ca120-8913-417d-ae21-27c50442b1a4`（aholo 供应商条款） | 0.12 × 0.11 × 0.22 | 25 | 未定价 | 菜单卡立牌，每桌 1 个。 |
| 8 | 婚礼餐盘 | aholo `df5cdeb5-a893-4717-8b88-724e50f928bc`（aholo 供应商条款） | 0.27 × 0.06 × 1.00 | 250 | 未定价 | 餐盘：实测高 0.997 m（含刀叉），盘体本身约 0.27 m，摆放时须压平刀叉（见偏差表 D-06）。 |
| 9 | 婚礼刀叉组 | aholo `9e31b8e7-590a-4e36-bb0a-59e33f34d73f`（aholo 供应商条款） | 0.23 × 0.03 × 0.35 | 250 | 未定价 | 刀叉组（甜品刀/叉/小勺）。 |
| 10 | 婚礼餐巾折花 | aholo `b8e01366-ac62-493d-a19b-1dc55cf16a15`（aholo 供应商条款） | 0.21 × 0.22 × 0.22 | 250 | 未定价 | 餐巾折花。 |
| 11 | 婚礼花瓣盘 | aholo `1ce4bbe0-76a0-40b3-b435-9530c4c7b27d`（aholo 供应商条款） | 0.27 × 0.20 × 0.27 | 25 | 未定价 | 花瓣盘，每桌 1 个。 |
| 12 | 婚礼香槟杯一对 | aholo `69513b81-14ee-4935-b515-d46ecffdd5b6`（aholo 供应商条款） | 0.16 × 0.07 × 0.23 | 50 | 未定价 | 香槟杯一对，每桌 2 对（按 8 席）。 |
| 13 | 户外折叠椅 | aholo `9ccaf007-7398-4c63-933b-4f4e910b75b9`（aholo 供应商条款） | 0.52 × 0.54 × 0.82 | 40 | 未定价 | 折叠椅：备用/长者席；藏青布面与白色主视觉冲突，建议只放侧区或备用量。 |
| 14 | 圆桌 | 静态库 `hotel-and-resort-operations-banquet-round-table-10-958b76ee`（CC0-1.0） | 1.80 × 1.80 × 0.75 | 25 | 未定价 | 1.80 m 宴会圆桌（10 人）；若选它替代 aholo 圆桌，席位可到 10 席、桌布需另配。 |
| 15 | 圆桌与椅 | 静态库 `scendance-plan-round-table-and-chairs`（project-authored） | 2.35 × 2.47 × 0.86 | 4 | 未定价 | 圆桌与椅整套（2.35×2.47×0.86 m），备用桌。 |
| 16 | 木质餐椅 | 静态库 `bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7`（CC0-1.0） | 0.49 × 0.47 × 1.00 | 40 | 未定价 | 木质餐椅备用，棕色不配白绿主视觉。 |
| 17 | 软包餐椅 | 静态库 `bedroom-and-living-room-furniture-dining-chair-upholst-7ec33345`（CC0-1.0） | 0.49 × 0.47 × 1.00 | 40 | 未定价 | 软包餐椅备用。 |
| 18 | 折叠椅 | 静态库 `izakaya-alley-and-ramen-shop-folding-chair-dbe1ca77`（CC0-1.0） | 0.44 × 0.46 × 0.93 | 40 | 未定价 | 折叠椅备用。 |
| 19 | 可叠放座椅 | 静态库 `office-lobby-and-facilities-canteen-stacking-chair-3440c7d8`（CC0-1.0） | 0.46 × 0.51 × 0.89 | 40 | 未定价 | 可叠放座椅备用，收纳效率高。 |
| 20 | 户外圆桌椅（带伞） | 静态库 `scendance-plan-round-table-and-chairs-parasol`（project-authored） | 2.66 × 2.66 × 2.65 | 8 | 未定价 | 带伞圆桌椅（2.66×2.66×2.65 m），遮阳休息用，不作主席。 |
| 21 | 希腊咖啡座遮阳伞 | 静态库 `greek-island-village-and-harbour-cafe-parasol-a99c4044`（CC0-1.0） | 2.80 × 2.80 × 2.35 | 6 | 未定价 | 咖啡座遮阳伞，插在花箱里遮阳。 |
| 22 | 卷边陶土花盆 | 静态库 `almanac-gardens-terracotta-planter-1472f447`（CC0-1.0） | 0.64 × 0.64 × 0.46 | 8 | 未定价 | 陶土花盆，配遮阳伞压重。 |
| 23 | 石花箱 | 静态库 `greek-island-village-and-harbour-stone-planter-5303d8e8`（CC0-1.0） | 1.69 × 0.94 × 1.10 | 4 | 未定价 | 石花箱，通道分隔。 |

小计：23 行物料（aholo 13 行 / 静态库 10 行）。

### Z3 餐饮区

*丽丽在幕景里实际画的 4 分区之一；与席位区分离，避免人流交叉。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 婚礼甜品长桌 | aholo `709ae5c9-c685-4538-b6e4-1a11b1947c71`（aholo 供应商条款） | 2.40 × 0.89 × 1.39 | 2 | 未定价 | 甜品长桌 2.40×0.89×1.39 m，桌布自带。 |
| 2 | 婚礼蛋糕台 | aholo `2a09ecd3-a1a6-4235-8ad1-d5df722319d1`（aholo 供应商条款） | 0.43 × 0.43 × 0.65 | 1 | 未定价 | 蛋糕台（0.43×0.43×0.65 m），与桌面蛋糕一体。 |
| 3 | 婚礼甜品台摆件 | aholo `74808c30-b72b-41f6-89f5-c3b83cfa499f`（aholo 供应商条款） | 0.06 × 0.04 × 0.03 | 12 | 未定价 | 甜品摆件，仅 5.5 cm 见方，作桌面点缀件。 |
| 4 | 婚礼香槟塔 | aholo `c8d2b6ee-e308-483f-a349-dacd159b585d`（aholo 供应商条款） | 0.80 × 0.80 × 0.79 | 2 | 未定价 | 香槟塔 0.80×0.80×0.79 m，需配操作台。 |
| 5 | 婚礼咖啡桌 | aholo `3122e6c6-eb90-407e-b7a2-a2e297c29311`（aholo 供应商条款） | 1.40 × 1.40 × 1.06 | 3 | 未定价 | 咖啡桌 1.40×1.40×1.06 m。 |
| 6 | 带托盘甜品柜台 | 静态库 `indian-bazaar-street-and-temple-sweet-counter-3a98de40`（CC0-1.0） | 1.80 × 0.84 × 1.86 | 1 | 未定价 | 带托盘甜品柜台（1.80×0.84×1.86 m），与 aholo 甜品长桌二选一或并用。 |
| 7 | 起泡酒吧 | 静态库 `scendance-plan-prosecco-bar`（project-authored） | 3.78 × 2.75 × 2.07 | 1 | 未定价 | 起泡酒吧 3.78×2.75×2.07 m，自带吧台与遮阳。 |
| 8 | 一米二模块吧台 | 静态库 `bar-pub-and-brewery-taproom-bar-counter-module-4f0062bc`（CC0-1.0） | 1.20 × 0.74 × 1.05 | 4 | 未定价 | 1.2 m 模块吧台，串接成吧台线。 |
| 9 | 吧台高脚凳 | 静态库 `bakery-and-cafe-bar-stool-counter-ec2e9883`（CC0-1.0） | 0.51 × 0.51 × 1.04 | 8 | 未定价 | 吧台高脚凳。 |
| 10 | 街头餐饮吧凳 | 静态库 `street-food-market-and-food-trucks-bar-stool-aed9cea8`（CC0-1.0） | 0.40 × 0.38 × 1.06 | 8 | 未定价 | 街头餐饮吧凳，备用。 |
| 11 | 四人咖啡桌 | 静态库 `bakery-and-cafe-cafe-table-4-person-bf74a9a9`（CC0-1.0） | 0.80 × 0.80 × 0.75 | 4 | 未定价 | 四人咖啡桌。 |
| 12 | 取暖器 | 静态库 `bakery-and-cafe-outdoor-heater-f41c88ea`（CC0-1.0） | 0.84 × 0.83 × 2.12 | 4 | 未定价 | 户外取暖器；燃油/燃气设备，草坪使用需场地方同意（待核实）。 |
| 13 | 咖啡餐饮拖车 | 静态库 `scendance-plan-food-trailer-coffee`（project-authored） | 2.56 × 4.49 × 2.44 | 1 | 未定价 | 咖啡拖车 2.56×4.49×2.44 m；属带轮车辆，需装卸区通道。 |
| 14 | 池畔桌配遮阳伞 | 静态库 `hotel-and-resort-operations-poolside-table-and-parasol-2a52833a`（CC0-1.0） | 2.24 × 2.24 × 2.38 | 4 | 未定价 | 池畔桌配遮阳伞，餐饮休息位。 |
| 15 | 双沙发遮阳休息区 | 静态库 `scendance-plan-relax-zone-lounge`（project-authored） | 4.80 × 4.20 × 2.53 | 2 | 未定价 | 双沙发遮阳休息区 4.80×4.20×2.53 m。 |
| 16 | 休息区 | 静态库 `scendance-plan-relax-zone`（project-authored） | 6.30 × 4.65 × 2.71 | 2 | 未定价 | 休息区 6.30×4.65×2.71 m。 |
| 17 | 灌木种植箱 | 静态库 `street-food-market-and-food-trucks-planter-with-shrub-0eedba0e`（CC0-1.0） | 0.94 × 0.93 × 1.31 | 6 | 未定价 | 灌木种植箱，餐饮区与席位区做软隔离。 |

小计：17 行物料（aholo 5 行 / 静态库 12 行）。

### Z4 迎宾签到区

*丽丽在幕景里实际画的 4 分区之一；入口动线起点。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 婚礼签到台 | aholo `8c4257f1-bd9c-4035-b26a-553db34217d2`（aholo 供应商条款） | 1.80 × 0.92 × 1.15 | 1 | 未定价 | 签到长桌 1.80×0.92×1.15 m，桌面含笔记本与笔。 |
| 2 | 婚礼签到背景墙 | aholo `bf6aac70-f314-45ec-bc21-03820e428617`（aholo 供应商条款） | 2.40 × 0.74 × 2.29 | 1 | 未定价 | 签到背景墙，实测宽 2.40 m（提示词写 3 m），需背架。 |
| 3 | 婚礼迎宾立牌 | aholo `c13220f0-68cf-4f95-af80-3e5b04eaad2f`（aholo 供应商条款） | 0.97 × 0.77 × 1.80 | 1 | 未定价 | 迎宾立牌 A（与 B 同参考图、同尺寸，内容近乎重复）。 |
| 4 | 婚礼迎宾立牌 | aholo `554f02af-c0df-4c42-92b9-aa1b954ba29a`（aholo 供应商条款） | 0.97 × 0.77 × 1.80 | 1 | 未定价 | 迎宾立牌 B；与 A 重复，建议只留一件或改名区分用途。 |
| 5 | 婚礼路引花牌 | aholo `5a624a1c-f0db-402c-9833-f527a4b9b0df`（aholo 供应商条款） | 0.40 × 0.36 × 1.20 | 6 | 未定价 | 路引花牌，沿签到区到席位区的导引。 |
| 6 | 易拉宝 | 静态库 `scendance-plan-pull-up-banner`（project-authored） | 0.94 × 0.29 × 2.12 | 4 | 未定价 | 易拉宝，签到区与分区入口各一。 |
| 7 | 机场签到台 | 静态库 `airport-terminal-and-ground-operations-check-in-desk-ba7d92dc`（CC0-1.0） | 3.11 × 1.88 × 2.87 | 1 | 未定价 | 备用签到台（3.11×1.88×2.87 m），机场风，可作签到 + 礼金台。 |
| 8 | 绳式礼宾隔离柱 | 静态库 `casino-floor-and-back-rooms-rope-stanchion-4fb93cd2`（CC0-1.0） | 1.29 × 0.36 × 1.03 | 8 | 未定价 | 绳式礼宾隔离柱，排队围合。 |
| 9 | 带绳礼宾隔离柱 | 静态库 `nightclub-and-dj-booth-rope-barrier-post-with-rope-327c14d3`（CC0-1.0） | 1.78 × 0.34 × 0.98 | 8 | 未定价 | 带绳隔离柱（自带一段绳），排队围合。 |
| 10 | 伸缩带隔离柱 | 静态库 `laundrette-and-cleaning-caution-barrier-post-75cbf09d`（CC0-1.0） | 0.64 × 0.37 × 0.98 | 8 | 未定价 | 伸缩带隔离柱，灵活排队。 |
| 11 | 排队隔离栏 | 静态库 `airport-terminal-and-ground-operations-queue-barrier-r-0d620e5a`（CC0-1.0） | 4.94 × 0.42 × 1.22 | 2 | 未定价 | 排队隔离栏 4.94×0.42×1.22 m，签到队列。 |
| 12 | 指示牌架·双面 | 静态库 `scendance-plan-signage-frame-2`（project-authored） | 1.39 × 1.06 × 1.94 | 4 | 未定价 | 双面指示牌架，签到区与各分区入口。 |
| 13 | 指示牌架·四面 | 静态库 `scendance-plan-signage-frame-4`（project-authored） | 1.39 × 1.06 × 1.94 | 2 | 未定价 | 四面指示牌架，路口用。 |
| 14 | 礼品 | 静态库 `wedding-and-chapel-kit-gift-box-stack-562b6e24`（CC0-1.0） | 0.46 × 0.46 × 0.67 | 6 | 未定价 | 伴手礼堆放。 |
| 15 | 酒店大堂沙发 | 静态库 `hotel-and-resort-operations-lobby-sofa-79174bf1`（CC0-1.0） | 2.25 × 0.88 × 0.86 | 2 | 未定价 | 大堂沙发，等候区。 |
| 16 | 布艺沙发（三人） | 静态库 `cozy-home-interiors-sofa-three-seat-8d2d33f9`（CC0-1.0） | 2.30 × 0.76 × 1.05 | 2 | 未定价 | 三人沙发，等候区。 |

小计：16 行物料（aholo 5 行 / 静态库 11 行）。

### Z5 垃圾/环卫点

*我方按场地事实补；含垃圾、回收、厕所、更衣。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 庭院垃圾箱 | 静态库 `tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-f27b6012`（CC0-1.0） | 1.51 × 1.09 × 1.31 | 3 | 未定价 | 庭院垃圾箱 1.51×1.09×1.31 m，主垃圾点。 |
| 2 | 站台垃圾桶 | 静态库 `modern-rail-and-metro-network-waste-bin-57f44ea1`（CC0-1.0） | 0.64 × 0.62 × 1.44 | 6 | 未定价 | 站台垃圾桶，沿主通道两侧。 |
| 3 | 场馆敞口垃圾桶 | 静态库 `football-soccer-club-grounds-waste-bin-15a6b427`（CC0-1.0） | 0.44 × 0.44 × 0.72 | 6 | 未定价 | 敞口垃圾桶，席位区侧路。 |
| 4 | 分类回收桶 | 静态库 `theme-park-rides-and-coasters-theme-park-rides-and-coa-486efc8a`（CC0-1.0） | 1.70 × 0.80 × 1.11 | 3 | 未定价 | 分类回收桶 1.70×0.80×1.11 m。 |
| 5 | 垃圾与回收房 | 静态库 `caravan-park-and-campsite-bin-and-recycling-store-beed8b68`（CC0-1.0） | 2.60 × 1.35 × 1.38 | 1 | 未定价 | 垃圾与回收房 2.60×1.35×1.38 m，临时堆放。 |
| 6 | 移动厕所（两格） | 静态库 `hot-air-balloon-festival-portable-toilet-block-82a4faf8`（CC0-1.0） | 2.38 × 1.32 × 2.44 | 2 | 未定价 | 移动厕所（两格）。 |
| 7 | 无障碍便携厕所 | 静态库 `scendance-plan-accessible-portable-toilet`（project-authored） | 1.74 × 1.70 × 2.26 | 1 | 未定价 | 无障碍便携厕所。 |
| 8 | 厕所拖车 | 静态库 `scendance-plan-toilet-trailer`（project-authored） | 3.29 × 6.09 × 2.98 | 1 | 未定价 | 厕所拖车 3.29×6.09×2.98 m；是否由场地方提供待核实。 |
| 9 | 更衣室 | 静态库 `scendance-plan-changing-room`（project-authored） | 2.66 × 4.28 × 2.50 | 1 | 未定价 | 更衣室。 |
| 10 | 快开更衣帐篷 | 静态库 `beach-surf-and-paddle-kit-pop-up-changing-tent-5762c0fa`（CC0-1.0） | 2.74 × 2.71 × 2.33 | 1 | 未定价 | 快开更衣帐篷，临时补位。 |
| 11 | 婴儿车存放 | 静态库 `scendance-plan-stroller-storage`（project-authored） | 3.90 × 2.40 × 2.38 | 1 | 未定价 | 婴儿车存放。 |
| 12 | 可扔垃圾区起点 | 静态库 `scendance-plan-littering-start`（project-authored） | 0.84 × 0.40 × 2.00 | 3 | 未定价 | 可扔垃圾区起点牌。 |
| 13 | 可扔垃圾区终点 | 静态库 `scendance-plan-littering-end`（project-authored） | 0.84 × 0.40 × 2.00 | 3 | 未定价 | 可扔垃圾区终点牌。 |

小计：13 行物料（aholo 0 行 / 静态库 13 行）。

### Z6 指示牌

*我方按场地事实补；分区入口与疏散导向。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 导视牌（P1） | 静态库 `scendance-plan-p1`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 分区编号牌 P1。 |
| 2 | 导视牌（P2） | 静态库 `scendance-plan-p2`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 分区编号牌 P2。 |
| 3 | 导视牌（P3） | 静态库 `scendance-plan-p3`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 分区编号牌 P3。 |
| 4 | 导视牌（P4） | 静态库 `scendance-plan-p4`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 分区编号牌 P4。 |
| 5 | 排队 | 静态库 `scendance-plan-queues`（project-authored） | 0.84 × 0.40 × 2.00 | 2 | 未定价 | 排队牌。 |
| 6 | 路向导视柱 | 静态库 `ferry-terminal-and-harbour-crossing-ferry-terminal-and-4f8d77f5`（CC0-1.0） | 0.90 × 0.44 × 2.56 | 3 | 未定价 | 路向导视柱 0.90×0.44×2.56 m。 |
| 7 | 步道指示杆 | 静态库 `ski-resort-and-snow-park-trail-sign-post-0fbf6fda`（CC0-1.0） | 1.54 × 0.24 × 2.80 | 4 | 未定价 | 步道指示杆 1.54×0.24×2.80 m，草坪里最耐看的立杆。 |
| 8 | 问询处 | 静态库 `scendance-plan-information-point`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 问询处牌。 |
| 9 | 应急通道入口 | 静态库 `scendance-plan-emergency-access-point`（project-authored） | 0.84 × 0.40 × 2.00 | 2 | 未定价 | 应急通道入口牌。 |
| 10 | 疏散集合点 | 静态库 `scendance-plan-evacuation-meeting-point`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 疏散集合点牌。 |
| 11 | 失物招领 | 静态库 `scendance-plan-lost-property`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 失物招领牌。 |
| 12 | 走失人员点 | 静态库 `scendance-plan-missing-persons-point`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 走失人员点牌。 |
| 13 | 福利/关怀点 | 静态库 `scendance-plan-welfare-point`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 福利/关怀点牌。 |
| 14 | 手环领取点 | 静态库 `scendance-plan-wristband-collection`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 手环领取点牌。 |
| 15 | 车辆通道 | 静态库 `scendance-plan-vehicle-access`（project-authored） | 0.84 × 0.40 × 2.00 | 2 | 未定价 | 车辆通道牌。 |
| 16 | 步行通道 | 静态库 `scendance-plan-pedestrian-access`（project-authored） | 0.84 × 0.40 × 2.00 | 4 | 未定价 | 步行通道牌。 |
| 17 | 无障碍低矮过线垫 | 静态库 `scendance-plan-ada-low-profile-cable-matting`（project-authored） | 0.76 × 0.54 × 0.04 | 2 | 未定价 | 无障碍低矮过线垫 0.76×0.54×0.04 m，过线处防绊。 |

小计：17 行物料（aholo 0 行 / 静态库 17 行）。

### Z7 医疗点

*我方按场地事实补；含急救、饮水、供电。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 急救点 | 静态库 `scendance-plan-first-aid-point`（project-authored） | 3.08 × 3.10 × 3.00 | 1 | 未定价 | 急救点 3.08×3.11×3.00 m，主医疗点。 |
| 2 | 便携急救站（紧凑型） | 静态库 `scendance-plan-first-aid-point-compact`（project-authored） | 2.75 × 2.25 × 2.65 | 1 | 未定价 | 便携急救站（紧凑型），副点。 |
| 3 | 急救用品柜 | 静态库 `football-soccer-club-grounds-first-aid-cabinet-feff73ae`（CC0-1.0） | 0.50 × 0.22 × 0.60 | 2 | 未定价 | 急救用品柜。 |
| 4 | 补水站 | 静态库 `scendance-plan-water-refill-station`（project-authored） | 0.51 × 0.52 × 1.14 | 3 | 未定价 | 补水站。 |
| 5 | 补给站 | 静态库 `scendance-plan-feed-station`（project-authored） | 1.86 × 0.72 × 0.99 | 2 | 未定价 | 补给站。 |
| 6 | 补给站-电解质 | 静态库 `scendance-plan-aid-station-electrolyte`（project-authored） | 1.86 × 0.72 × 1.10 | 2 | 未定价 | 电解质补给站。 |
| 7 | 滑雪急救员 | 静态库 `scendance-plan-ski-paramedic`（project-authored） | 0.86 × 2.04 × 1.90 | 2 | 未定价 | 急救员人形占位（摆位用，真实人员由场地方/医疗方安排）。 |
| 8 | 急救摩托车 | 静态库 `scendance-plan-paramedic-motorbike`（project-authored） | 0.90 × 2.25 × 1.35 | 1 | 未定价 | 急救摩托车占位（园区内道路可达性待核）。 |
| 9 | 救护车 | 静态库 `fire-and-emergency-services-ambulance-f22ce1a5`（CC0-1.0） | 3.37 × 6.01 × 2.76 | 1 | 未定价 | 救护车停靠位占位（3.37×6.01×2.76 m），定位在草坪外可达位置。 |
| 10 | 发电机位 | 静态库 `scendance-plan-generator-point`（project-authored） | 3.55 × 2.47 × 1.67 | 1 | 未定价 | 发电机位 3.55×2.47×1.67 m，需在场地方指定的硬质面。 |
| 11 | 永久供电 | 静态库 `scendance-plan-permanent-power`（project-authored） | 1.50 × 1.15 × 1.53 | 1 | 未定价 | 永久供电点位标记。 |

小计：11 行物料（aholo 0 行 / 静态库 11 行）。

### Z8 停车落客

*我方按场地事实补；对应园区停车场 120.133678, 30.224685 一带。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 公交/大巴站 | 静态库 `scendance-plan-bus-coach-station`（project-authored） | 13.80 × 7.80 × 2.92 | 1 | 未定价 | 大巴站 13.80×7.80×2.92 m，班车落客点。 |
| 2 | 大巴 | 静态库 `scendance-plan-coach`（project-authored） | 2.69 × 12.20 × 3.23 | 3 | 未定价 | 大巴（2.69×12.20×3.23 m），家属大巴车队列占位。 |
| 3 | 停车 | 静态库 `scendance-plan-parking`（project-authored） | 0.84 × 0.40 × 2.00 | 2 | 未定价 | 停车牌。 |
| 4 | 禁止停车 | 静态库 `scendance-plan-no-parking`（project-authored） | 0.84 × 0.40 × 2.00 | 2 | 未定价 | 禁止停车牌（装卸区与草坪入口）。 |
| 5 | 自行车停车 | 静态库 `scendance-plan-cycle-parking`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 自行车停车牌。 |
| 6 | 道闸（抬杆） | 静态库 `car-park-and-road-vehicle-fleet-entry-barrier-7cb4f555`（CC0-1.0） | 3.34 × 0.46 × 1.27 | 1 | 未定价 | 道闸（抬杆），落客区与草坪车行口。 |
| 7 | 无障碍停车 | 静态库 `car-park-and-road-vehicle-fleet-disabled-bay-tile-22090d5f`（CC0-1.0） | 2.50 × 5.00 × 0.04 | 2 | 未定价 | 无障碍停车位 2.50×5.00 m，靠近落客点。 |

小计：7 行物料（aholo 0 行 / 静态库 7 行）。

### Z9 装卸

*我方按场地事实补；物料进出场通道与地面保护。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 装卸区 | 静态库 `scendance-plan-load-zone`（project-authored） | 0.84 × 0.40 × 2.00 | 1 | 未定价 | 装卸区牌。 |
| 2 | 塑料铺道板 | 静态库 `scendance-plan-plastic-trackway`（project-authored） | 2.00 × 1.00 × 0.06 | 20 | 未定价 | 塑料铺道板 2.00×1.00×0.06 m，设备车进场。 |
| 3 | 铝制铺道板 | 静态库 `scendance-plan-aluminum-trackway`（project-authored） | 2.40 × 1.15 × 0.06 | 16 | 未定价 | 铝制铺道板 2.40×1.15×0.06 m，重载段。 |
| 4 | 金属铺道板 | 静态库 `demolition-and-site-clearance-demolition-and-site-clea-016dd84b`（CC0-1.0） | 3.10 × 2.10 × 0.07 | 8 | 未定价 | 金属铺道板 3.10×2.10×0.07 m，门口过渡段。 |
| 5 | 地面保护垫 | 静态库 `scendance-plan-ground-protection-mats`（project-authored） | 2.40 × 1.20 × 0.07 | 30 | 未定价 | 地面保护垫 2.40×1.20×0.06 m，铺在草坪入口与通道。 |
| 6 | 活动指挥中心 | 静态库 `scendance-plan-event-control`（project-authored） | 2.66 × 4.28 × 2.50 | 1 | 未定价 | 活动指挥中心 2.66×4.28×2.51 m。 |

小计：6 行物料（aholo 0 行 / 静态库 6 行）。

### Z10 雨备

*我方按场地事实补；仅列物料；室内只作雨备退路一句话带过，不做室内分区。*

| # | 物料 | 来源 | 单件尺寸（宽×深×高 m） | 数量 | 单价 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 拉伸棚 | 静态库 `scendance-plan-stretch-tent`（project-authored） | 9.46 × 6.32 × 3.50 | 2 | 未定价 | 拉伸棚 9.46×6.32×3.50 m，覆盖席位区或仪式区。 |
| 2 | 钟形帐篷（开口款） | 静态库 `medieval-siege-and-castle-defence-bell-tent-open-88cc714a`（CC0-1.0） | 4.59 × 4.53 × 3.24 | 2 | 未定价 | 钟形帐篷（开口款）4.59×4.53×3.24 m。 |
| 3 | 钟形帐篷 | 静态库 `caravan-park-and-campsite-bell-tent-d7f74bfd`（CC0-1.0） | 4.67 × 4.67 × 2.68 | 2 | 未定价 | 钟形帐篷 4.66×4.66×2.68 m。 |
| 4 | 凉亭式遮棚摊位 | 静态库 `street-food-market-and-food-trucks-gazebo-stall-with-c-e8a7b705`（CC0-1.0） | 3.30 × 3.31 × 2.99 | 4 | 未定价 | 凉亭式遮棚摊位 3.30×3.31×2.99 m，餐饮区雨备。 |
| 5 | 快搭帐篷 | 静态库 `hot-air-balloon-festival-registration-gazebo-1f36ec9a`（CC0-1.0） | 3.34 × 3.34 × 3.00 | 4 | 未定价 | 快搭帐篷 3.34×3.34×3.00 m。 |
| 6 | 俱乐部快搭帐篷 | 静态库 `dog-agility-and-training-field-shade-gazebo-b25e7ce2`（CC0-1.0） | 3.34 × 3.31 × 2.80 | 4 | 未定价 | 俱乐部快搭帐篷 3.34×3.31×2.80 m。 |
| 7 | 赛场快搭遮阳帐篷 | 静态库 `endurance-and-gt-paddock-campsite-gazebo-52bc263d`（CC0-1.0） | 2.90 × 2.90 × 2.90 | 2 | 未定价 | 赛场快搭遮阳帐篷 2.90×2.90×2.90 m。 |
| 8 | 指挥帐篷 | 静态库 `armoured-column-and-field-camp-command-tent-5c85fae1`（CC0-1.0） | 6.05 × 8.20 × 3.61 | 1 | 未定价 | 指挥帐篷 6.05×8.20×3.61 m，雨备主空间。 |
| 9 | 舞台顶棚模块 | 静态库 `live-music-venue-and-festival-stage-stage-roof-canopy--543b5fb3`（CC0-1.0） | 3.00 × 6.31 × 0.54 | 4 | 未定价 | 舞台顶棚模块 3.00×6.31×0.54 m，压在仪式台上方。 |
| 10 | 短跨舞台顶棚 | 静态库 `live-music-venue-and-festival-stage-stage-roof-canopy--f849524b`（CC0-1.0） | 3.00 × 3.31 × 0.54 | 2 | 未定价 | 短跨舞台顶棚 3.00×3.31×0.54 m。 |
| 11 | 遮棚展位 | 静态库 `trading-post-and-barter-market-canopy-market-booth-46c6c10f`（CC0-1.0） | 2.60 × 2.10 × 2.34 | 2 | 未定价 | 遮棚展位 2.60×2.10×2.34 m。 |
| 12 | 带柜台顶棚开放摊位 | 静态库 `indoor-market-hall-and-traders-open-stall-unit-5124bc70`（CC0-1.0） | 2.95 × 2.72 × 2.77 | 2 | 未定价 | 带柜台顶棚开放摊位 2.95×2.72×2.76 m，餐饮雨备。 |

小计：12 行物料（aholo 0 行 / 静态库 12 行）。

### 4.1 静态库素材的出处（license 与 page）

静态库条目的 `license` 与 `page` 就是素材出处（出处 S14）。本清单引用的静态库条目中：

- `project-authored`：52 行
- `CC0-1.0`：60 行

- `CC0-1.0` 的条目 page 指向 `https://3dassets.dev/assets/<slug>`（可在该页找到原始素材页）。
- `project-authored` 是平台自绘条目，`page` 为空，出处即平台自研；这类条目在 `merged.json` 里 `assetId` 未注册。

aholo 生成件的许可与来源：

- license：`https://www.aholo.ai/agreement/termsofuse`（type = `provider-terms`，reviewedAt = 2026-10-28）——**不是 CC0**，是对外分发前必须过一遍的供应商条款。
- source_url：`https://labs.aholo.ai`
- 37 件全部已进公共目录 `scendance-generated`（出处 S2）；`page` 字段对这批件不适用。
- **图生 3D 的参考图**：每件生成件的参考图 asset id 记在 JSON 的 `generatedAssets[].refImageAssetId`，参考图本身是账号内 `source=upload` 的 PNG；其上游素材分组与可见来源见 `docs/plans/2026-11-19-contest-wedding-next-plan.md` 的「参考图分组」一节（小红书参赛素材，引用前需确认图片许可与署名口径）。

### 4.2 附录：静态库引用条目逐条出处

本清单共引用静态库条目 **112** 个（去重后），逐条列出 license 与原始素材页（出处 S14）。

| slug | 名称 | license | 原始素材页（page） | 已注册 assetId |
| --- | --- | --- | --- | --- |
| `scendance-plan-truss-arch` | 桁架拱门 | project-authored | （平台自绘，无外链） | 未注册 |
| `orchestra-and-band-instruments-stage-platform-module-6be1e985` | 音乐会舞台平台 | CC0-1.0 | [原页](https://3dassets.dev/assets/orchestra-and-band-instruments-stage-platform-module-6be1e985) | `237ae710-eac8-5be0-b28f-4e19eadd2e30` |
| `live-music-venue-and-festival-stage-stage-riser-block-0d3aaf5f` | 舞台增高台块 | CC0-1.0 | [原页](https://3dassets.dev/assets/live-music-venue-and-festival-stage-stage-riser-block-0d3aaf5f) | `c35682fb-9233-55a2-810c-1e7d9ca29611` |
| `live-music-venue-and-festival-stage-stage-step-unit-f141dc1c` | 舞台台阶 | CC0-1.0 | [原页](https://3dassets.dev/assets/live-music-venue-and-festival-stage-stage-step-unit-f141dc1c) | `775e1ad4-6262-5187-9c2b-4938f3796c1b` |
| `wedding-and-chapel-kit-chapel-lectern-df983527` | 礼拜堂讲台 | CC0-1.0 | [原页](https://3dassets.dev/assets/wedding-and-chapel-kit-chapel-lectern-df983527) | `f9922ab2-066f-5ba4-9cfa-4dd35663bdf5` |
| `scendance-plan-accessible-ramp` | 无障碍坡道 | project-authored | （平台自绘，无外链） | 未注册 |
| `dog-agility-and-training-field-pa-speaker-post-8d62a208` | 户外广播立柱音箱 | CC0-1.0 | [原页](https://3dassets.dev/assets/dog-agility-and-training-field-pa-speaker-post-8d62a208) | `de8350c8-612c-5490-934c-257ac82e40f9` |
| `live-music-venue-and-festival-stage-line-array-speaker-7500d812` | 线阵列音箱 | CC0-1.0 | [原页](https://3dassets.dev/assets/live-music-venue-and-festival-stage-line-array-speaker-7500d812) | `83d71a3e-8db8-59e2-9a65-7d066e67a754` |
| `nightclub-and-dj-booth-speaker-stack-sub-cabinet-77151eb8` | 堆叠式低音音箱 | CC0-1.0 | [原页](https://3dassets.dev/assets/nightclub-and-dj-booth-speaker-stack-sub-cabinet-77151eb8) | `b516147f-c28e-5b85-9b43-e27df248986b` |
| `music-recording-studio-and-instruments-vocal-mic-with--b6c69c11` | 人声麦克风与防喷罩 | CC0-1.0 | [原页](https://3dassets.dev/assets/music-recording-studio-and-instruments-vocal-mic-with--b6c69c11) | `862c9301-da8c-5e02-bcbe-13054024c03e` |
| `live-music-venue-and-festival-stage-drum-riser-fb450f31` | 鼓手增高台 | CC0-1.0 | [原页](https://3dassets.dev/assets/live-music-venue-and-festival-stage-drum-riser-fb450f31) | `7c324db4-23a1-5568-9884-b487130f5d01` |
| `wedding-and-chapel-kit-lantern-post-c06e501d` | 花园灯柱 | CC0-1.0 | [原页](https://3dassets.dev/assets/wedding-and-chapel-kit-lantern-post-c06e501d) | 未注册 |
| `turning-seasons-winter-lantern-dc1a8170` | 冬季提灯 | CC0-1.0 | [原页](https://3dassets.dev/assets/turning-seasons-winter-lantern-dc1a8170) | `b90cab64-9198-581f-aff8-f1fbf2765795` |
| `hotel-and-resort-operations-banquet-round-table-10-958b76ee` | 圆桌 | CC0-1.0 | [原页](https://3dassets.dev/assets/hotel-and-resort-operations-banquet-round-table-10-958b76ee) | 未注册 |
| `scendance-plan-round-table-and-chairs` | 圆桌与椅 | project-authored | （平台自绘，无外链） | 未注册 |
| `bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7` | 木质餐椅 | CC0-1.0 | [原页](https://3dassets.dev/assets/bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7) | `36b79bbc-bc95-508b-b09d-75729f180b5b` |
| `bedroom-and-living-room-furniture-dining-chair-upholst-7ec33345` | 软包餐椅 | CC0-1.0 | [原页](https://3dassets.dev/assets/bedroom-and-living-room-furniture-dining-chair-upholst-7ec33345) | `7c6d543f-119f-51a1-aa75-8df98dfeb94a` |
| `izakaya-alley-and-ramen-shop-folding-chair-dbe1ca77` | 折叠椅 | CC0-1.0 | [原页](https://3dassets.dev/assets/izakaya-alley-and-ramen-shop-folding-chair-dbe1ca77) | 未注册 |
| `office-lobby-and-facilities-canteen-stacking-chair-3440c7d8` | 可叠放座椅 | CC0-1.0 | [原页](https://3dassets.dev/assets/office-lobby-and-facilities-canteen-stacking-chair-3440c7d8) | `152216e1-96bb-515e-9c97-40cadb0aa1de` |
| `scendance-plan-round-table-and-chairs-parasol` | 户外圆桌椅（带伞） | project-authored | （平台自绘，无外链） | 未注册 |
| `greek-island-village-and-harbour-cafe-parasol-a99c4044` | 希腊咖啡座遮阳伞 | CC0-1.0 | [原页](https://3dassets.dev/assets/greek-island-village-and-harbour-cafe-parasol-a99c4044) | `ec3d08c5-26bc-5d8a-a957-329572c33f8c` |
| `almanac-gardens-terracotta-planter-1472f447` | 卷边陶土花盆 | CC0-1.0 | [原页](https://3dassets.dev/assets/almanac-gardens-terracotta-planter-1472f447) | `f2b418b2-5b97-522f-bde8-4b12b45d2f2c` |
| `greek-island-village-and-harbour-stone-planter-5303d8e8` | 石花箱 | CC0-1.0 | [原页](https://3dassets.dev/assets/greek-island-village-and-harbour-stone-planter-5303d8e8) | 未注册 |
| `indian-bazaar-street-and-temple-sweet-counter-3a98de40` | 带托盘甜品柜台 | CC0-1.0 | [原页](https://3dassets.dev/assets/indian-bazaar-street-and-temple-sweet-counter-3a98de40) | `55036904-9508-5587-ad17-1f018ed79e2f` |
| `scendance-plan-prosecco-bar` | 起泡酒吧 | project-authored | （平台自绘，无外链） | 未注册 |
| `bar-pub-and-brewery-taproom-bar-counter-module-4f0062bc` | 一米二模块吧台 | CC0-1.0 | [原页](https://3dassets.dev/assets/bar-pub-and-brewery-taproom-bar-counter-module-4f0062bc) | `53fc80d0-8598-5e6a-9ed2-a3e455aac36f` |
| `bakery-and-cafe-bar-stool-counter-ec2e9883` | 吧台高脚凳 | CC0-1.0 | [原页](https://3dassets.dev/assets/bakery-and-cafe-bar-stool-counter-ec2e9883) | 未注册 |
| `street-food-market-and-food-trucks-bar-stool-aed9cea8` | 街头餐饮吧凳 | CC0-1.0 | [原页](https://3dassets.dev/assets/street-food-market-and-food-trucks-bar-stool-aed9cea8) | `5cfd393f-9338-5483-95a3-c4ef29fd35b1` |
| `bakery-and-cafe-cafe-table-4-person-bf74a9a9` | 四人咖啡桌 | CC0-1.0 | [原页](https://3dassets.dev/assets/bakery-and-cafe-cafe-table-4-person-bf74a9a9) | 未注册 |
| `bakery-and-cafe-outdoor-heater-f41c88ea` | 取暖器 | CC0-1.0 | [原页](https://3dassets.dev/assets/bakery-and-cafe-outdoor-heater-f41c88ea) | 未注册 |
| `scendance-plan-food-trailer-coffee` | 咖啡餐饮拖车 | project-authored | （平台自绘，无外链） | 未注册 |
| `hotel-and-resort-operations-poolside-table-and-parasol-2a52833a` | 池畔桌配遮阳伞 | CC0-1.0 | [原页](https://3dassets.dev/assets/hotel-and-resort-operations-poolside-table-and-parasol-2a52833a) | 未注册 |
| `scendance-plan-relax-zone-lounge` | 双沙发遮阳休息区 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-relax-zone` | 休息区 | project-authored | （平台自绘，无外链） | 未注册 |
| `street-food-market-and-food-trucks-planter-with-shrub-0eedba0e` | 灌木种植箱 | CC0-1.0 | [原页](https://3dassets.dev/assets/street-food-market-and-food-trucks-planter-with-shrub-0eedba0e) | `e7a02b7e-9abb-5b4c-ac6f-f3fadaeb346e` |
| `scendance-plan-pull-up-banner` | 易拉宝 | project-authored | （平台自绘，无外链） | 未注册 |
| `airport-terminal-and-ground-operations-check-in-desk-ba7d92dc` | 机场签到台 | CC0-1.0 | [原页](https://3dassets.dev/assets/airport-terminal-and-ground-operations-check-in-desk-ba7d92dc) | `e622c71b-4a9f-575f-916e-a60a3642d088` |
| `casino-floor-and-back-rooms-rope-stanchion-4fb93cd2` | 绳式礼宾隔离柱 | CC0-1.0 | [原页](https://3dassets.dev/assets/casino-floor-and-back-rooms-rope-stanchion-4fb93cd2) | 未注册 |
| `nightclub-and-dj-booth-rope-barrier-post-with-rope-327c14d3` | 带绳礼宾隔离柱 | CC0-1.0 | [原页](https://3dassets.dev/assets/nightclub-and-dj-booth-rope-barrier-post-with-rope-327c14d3) | `32fc58bf-cee9-5933-ba7d-7634b1c5a344` |
| `laundrette-and-cleaning-caution-barrier-post-75cbf09d` | 伸缩带隔离柱 | CC0-1.0 | [原页](https://3dassets.dev/assets/laundrette-and-cleaning-caution-barrier-post-75cbf09d) | `5550c766-ba69-59c6-8e61-d32edff50a13` |
| `airport-terminal-and-ground-operations-queue-barrier-r-0d620e5a` | 排队隔离栏 | CC0-1.0 | [原页](https://3dassets.dev/assets/airport-terminal-and-ground-operations-queue-barrier-r-0d620e5a) | `65598c4c-fd34-53d4-a606-ba28e54f19a7` |
| `scendance-plan-signage-frame-2` | 指示牌架·双面 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-signage-frame-4` | 指示牌架·四面 | project-authored | （平台自绘，无外链） | 未注册 |
| `wedding-and-chapel-kit-gift-box-stack-562b6e24` | 礼品 | CC0-1.0 | [原页](https://3dassets.dev/assets/wedding-and-chapel-kit-gift-box-stack-562b6e24) | 未注册 |
| `hotel-and-resort-operations-lobby-sofa-79174bf1` | 酒店大堂沙发 | CC0-1.0 | [原页](https://3dassets.dev/assets/hotel-and-resort-operations-lobby-sofa-79174bf1) | `20f8eeb2-fc1d-5dc1-83cf-456ad17c90fd` |
| `cozy-home-interiors-sofa-three-seat-8d2d33f9` | 布艺沙发（三人） | CC0-1.0 | [原页](https://3dassets.dev/assets/cozy-home-interiors-sofa-three-seat-8d2d33f9) | 未注册 |
| `tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-f27b6012` | 庭院垃圾箱 | CC0-1.0 | [原页](https://3dassets.dev/assets/tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-f27b6012) | `8a9d3744-f7da-5cb2-97a0-a4280a147f25` |
| `modern-rail-and-metro-network-waste-bin-57f44ea1` | 站台垃圾桶 | CC0-1.0 | [原页](https://3dassets.dev/assets/modern-rail-and-metro-network-waste-bin-57f44ea1) | `0cb04de0-8f44-5b22-9785-2c6db0dc8f4f` |
| `football-soccer-club-grounds-waste-bin-15a6b427` | 场馆敞口垃圾桶 | CC0-1.0 | [原页](https://3dassets.dev/assets/football-soccer-club-grounds-waste-bin-15a6b427) | `9fc7e856-3746-5e0e-b3b2-e886125160b5` |
| `theme-park-rides-and-coasters-theme-park-rides-and-coa-486efc8a` | 分类回收桶 | CC0-1.0 | [原页](https://3dassets.dev/assets/theme-park-rides-and-coasters-theme-park-rides-and-coa-486efc8a) | 未注册 |
| `caravan-park-and-campsite-bin-and-recycling-store-beed8b68` | 垃圾与回收房 | CC0-1.0 | [原页](https://3dassets.dev/assets/caravan-park-and-campsite-bin-and-recycling-store-beed8b68) | 未注册 |
| `hot-air-balloon-festival-portable-toilet-block-82a4faf8` | 移动厕所（两格） | CC0-1.0 | [原页](https://3dassets.dev/assets/hot-air-balloon-festival-portable-toilet-block-82a4faf8) | 未注册 |
| `scendance-plan-accessible-portable-toilet` | 无障碍便携厕所 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-toilet-trailer` | 厕所拖车 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-changing-room` | 更衣室 | project-authored | （平台自绘，无外链） | 未注册 |
| `beach-surf-and-paddle-kit-pop-up-changing-tent-5762c0fa` | 快开更衣帐篷 | CC0-1.0 | [原页](https://3dassets.dev/assets/beach-surf-and-paddle-kit-pop-up-changing-tent-5762c0fa) | 未注册 |
| `scendance-plan-stroller-storage` | 婴儿车存放 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-littering-start` | 可扔垃圾区起点 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-littering-end` | 可扔垃圾区终点 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-p1` | 导视牌（P1） | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-p2` | 导视牌（P2） | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-p3` | 导视牌（P3） | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-p4` | 导视牌（P4） | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-queues` | 排队 | project-authored | （平台自绘，无外链） | 未注册 |
| `ferry-terminal-and-harbour-crossing-ferry-terminal-and-4f8d77f5` | 路向导视柱 | CC0-1.0 | [原页](https://3dassets.dev/assets/ferry-terminal-and-harbour-crossing-ferry-terminal-and-4f8d77f5) | `0e3662c6-832b-5dd2-a070-7a83a11b982f` |
| `ski-resort-and-snow-park-trail-sign-post-0fbf6fda` | 步道指示杆 | CC0-1.0 | [原页](https://3dassets.dev/assets/ski-resort-and-snow-park-trail-sign-post-0fbf6fda) | `20975cb3-fa47-5554-88dc-ce4b5d6cbea5` |
| `scendance-plan-information-point` | 问询处 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-emergency-access-point` | 应急通道入口 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-evacuation-meeting-point` | 疏散集合点 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-lost-property` | 失物招领 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-missing-persons-point` | 走失人员点 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-welfare-point` | 福利/关怀点 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-wristband-collection` | 手环领取点 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-vehicle-access` | 车辆通道 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-pedestrian-access` | 步行通道 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-ada-low-profile-cable-matting` | 无障碍低矮过线垫 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-first-aid-point` | 急救点 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-first-aid-point-compact` | 便携急救站（紧凑型） | project-authored | （平台自绘，无外链） | 未注册 |
| `football-soccer-club-grounds-first-aid-cabinet-feff73ae` | 急救用品柜 | CC0-1.0 | [原页](https://3dassets.dev/assets/football-soccer-club-grounds-first-aid-cabinet-feff73ae) | `4d9f7c0f-8245-5625-9589-cf2709198839` |
| `scendance-plan-water-refill-station` | 补水站 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-feed-station` | 补给站 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-aid-station-electrolyte` | 补给站-电解质 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-ski-paramedic` | 滑雪急救员 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-paramedic-motorbike` | 急救摩托车 | project-authored | （平台自绘，无外链） | 未注册 |
| `fire-and-emergency-services-ambulance-f22ce1a5` | 救护车 | CC0-1.0 | [原页](https://3dassets.dev/assets/fire-and-emergency-services-ambulance-f22ce1a5) | 未注册 |
| `scendance-plan-generator-point` | 发电机位 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-permanent-power` | 永久供电 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-bus-coach-station` | 公交/大巴站 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-coach` | 大巴 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-parking` | 停车 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-no-parking` | 禁止停车 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-cycle-parking` | 自行车停车 | project-authored | （平台自绘，无外链） | 未注册 |
| `car-park-and-road-vehicle-fleet-entry-barrier-7cb4f555` | 道闸（抬杆） | CC0-1.0 | [原页](https://3dassets.dev/assets/car-park-and-road-vehicle-fleet-entry-barrier-7cb4f555) | 未注册 |
| `car-park-and-road-vehicle-fleet-disabled-bay-tile-22090d5f` | 无障碍停车 | CC0-1.0 | [原页](https://3dassets.dev/assets/car-park-and-road-vehicle-fleet-disabled-bay-tile-22090d5f) | 未注册 |
| `scendance-plan-load-zone` | 装卸区 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-plastic-trackway` | 塑料铺道板 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-aluminum-trackway` | 铝制铺道板 | project-authored | （平台自绘，无外链） | 未注册 |
| `demolition-and-site-clearance-demolition-and-site-clea-016dd84b` | 金属铺道板 | CC0-1.0 | [原页](https://3dassets.dev/assets/demolition-and-site-clearance-demolition-and-site-clea-016dd84b) | 未注册 |
| `scendance-plan-ground-protection-mats` | 地面保护垫 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-event-control` | 活动指挥中心 | project-authored | （平台自绘，无外链） | 未注册 |
| `scendance-plan-stretch-tent` | 拉伸棚 | project-authored | （平台自绘，无外链） | 未注册 |
| `medieval-siege-and-castle-defence-bell-tent-open-88cc714a` | 钟形帐篷（开口款） | CC0-1.0 | [原页](https://3dassets.dev/assets/medieval-siege-and-castle-defence-bell-tent-open-88cc714a) | 未注册 |
| `caravan-park-and-campsite-bell-tent-d7f74bfd` | 钟形帐篷 | CC0-1.0 | [原页](https://3dassets.dev/assets/caravan-park-and-campsite-bell-tent-d7f74bfd) | 未注册 |
| `street-food-market-and-food-trucks-gazebo-stall-with-c-e8a7b705` | 凉亭式遮棚摊位 | CC0-1.0 | [原页](https://3dassets.dev/assets/street-food-market-and-food-trucks-gazebo-stall-with-c-e8a7b705) | `9cc74a8f-871e-5da0-8b0b-0208d71ff5d0` |
| `hot-air-balloon-festival-registration-gazebo-1f36ec9a` | 快搭帐篷 | CC0-1.0 | [原页](https://3dassets.dev/assets/hot-air-balloon-festival-registration-gazebo-1f36ec9a) | 未注册 |
| `dog-agility-and-training-field-shade-gazebo-b25e7ce2` | 俱乐部快搭帐篷 | CC0-1.0 | [原页](https://3dassets.dev/assets/dog-agility-and-training-field-shade-gazebo-b25e7ce2) | 未注册 |
| `endurance-and-gt-paddock-campsite-gazebo-52bc263d` | 赛场快搭遮阳帐篷 | CC0-1.0 | [原页](https://3dassets.dev/assets/endurance-and-gt-paddock-campsite-gazebo-52bc263d) | 未注册 |
| `armoured-column-and-field-camp-command-tent-5c85fae1` | 指挥帐篷 | CC0-1.0 | [原页](https://3dassets.dev/assets/armoured-column-and-field-camp-command-tent-5c85fae1) | 未注册 |
| `live-music-venue-and-festival-stage-stage-roof-canopy--543b5fb3` | 舞台顶棚模块 | CC0-1.0 | [原页](https://3dassets.dev/assets/live-music-venue-and-festival-stage-stage-roof-canopy--543b5fb3) | `4f969ba6-9933-5377-bdf5-6d4349b20d34` |
| `live-music-venue-and-festival-stage-stage-roof-canopy--f849524b` | 短跨舞台顶棚 | CC0-1.0 | [原页](https://3dassets.dev/assets/live-music-venue-and-festival-stage-stage-roof-canopy--f849524b) | `c896b83b-7fc2-5fb0-b246-586c92dbab2c` |
| `trading-post-and-barter-market-canopy-market-booth-46c6c10f` | 遮棚展位 | CC0-1.0 | [原页](https://3dassets.dev/assets/trading-post-and-barter-market-canopy-market-booth-46c6c10f) | `571bac5d-850d-5419-94db-d9760a30572d` |
| `indoor-market-hall-and-traders-open-stall-unit-5124bc70` | 带柜台顶棚开放摊位 | CC0-1.0 | [原页](https://3dassets.dev/assets/indoor-market-hall-and-traders-open-stall-unit-5124bc70) | `5321b8d8-e48b-52b6-a6f9-2449087a0cec` |

## 五、37 件生成物料全清单

**条数：37 件**（SQL 实测 37 行，见第八节自检）。来源：Supabase `scene_private.assets`，`owner_id='56356f34-a34f-4745-b418-29e16e1de728'` 且 `format='glb'`（出处 S1）。

| # | 名称 | id | 单件尺寸（m） | 生成方式 | 可读描述 |
| --- | --- | --- | --- | --- | --- |
| 1 | 户外折叠椅 | `9ccaf007-7398-4c63-933b-4f4e910b75b9` | 0.52 × 0.54 × 0.82 | 文生（lux3d） | 户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米，四脚带黑色防滑脚垫，可折叠收纳。 |
| 2 | 婚礼宴会桌花 | `7ad8cafa-78ec-4555-8fa8-8232a4aec7ea` | 0.60 × 0.62 × 0.39 | 图生（lux3d） | 白色与浅绿配色的婚礼宴会桌花，圆形花艺底座，白玫瑰白色绣球淡紫蝴蝶兰与桉树叶 |
| 3 | 婚礼路引花牌 | `5a624a1c-f0db-402c-9833-f527a4b9b0df` | 0.40 × 0.36 × 1.20 | 图生（lux3d） | 白色与浅绿配色的婚礼路引花牌：细金色立杆配小花器，插白色洋桔梗与尤加利叶，高约一米 |
| 4 | 婚礼花拱门 | `f78f294f-1663-4e49-b197-3c7f8dc48a4f` | 2.00 × 0.62 × 1.86 | 图生（lux3d） | 婚礼花拱门：金色细金属圆拱框架，攀满白色玫瑰、白色绣球与淡紫色蝴蝶兰，配绿色桉树叶，底部两个小花簇，高约二点四米 |
| 5 | 新娘手捧花 | `a620ce00-c82a-498f-8204-1cb28d8343e6` | 0.50 × 0.50 × 0.50 | 图生（lux3d） | 新娘手捧花：白色玫瑰、白色绣球与淡紫色蝴蝶兰组成的圆形小束，配桉树叶，缎带系握柄，直径约二十五厘米 |
| 6 | 半圆弧形婚礼花墙背景板 | `be385dc7-8927-487b-8dbd-7efc8f126a13` | 2.40 × 1.51 × 2.38 | 图生（lux3d） | 半圆弧形婚礼花墙背景板：浅米色布幔底板，攀爬白色玫瑰、白色绣球与绿叶的弧形花艺，高约二点五米 |
| 7 | 菊花绿雕异形装置 | `cd1c284e-40df-4e8b-bcfb-d5347512a4c9` | 1.20 × 0.60 × 1.20 | 图生（lux3d） | 菊花绿雕异形装置：绿色植物修剪成的弯月形装饰体，表面点缀黄色小菊花，立体雕塑感，高约八十厘米 |
| 8 | 婚礼迎宾立牌 | `c13220f0-68cf-4f95-af80-3e5b04eaad2f` | 0.97 × 0.77 × 1.80 | 图生（lux3d） | 婚礼迎宾立牌：浅木色框架立式告示牌，顶部一排白色玫瑰与绿叶花艺，牌面空白，高约一米二，正面完整入画 |
| 9 | 婚礼迎宾立牌 | `554f02af-c0df-4c42-92b9-aa1b954ba29a` | 0.97 × 0.77 × 1.80 | 图生（lux3d） | 婚礼迎宾立牌：浅木色框架立式告示牌，顶部一排白色玫瑰与绿叶花艺，牌面空白，高约一米二，正面完整入画 |
| 10 | 婚礼花柱 | `0bc698c6-d2c9-4091-8483-6039113061e4` | 0.73 × 0.69 × 1.80 | 图生（lux3d） | 婚礼花柱：圆形立柱通体缠满白色玫瑰、白色绣球与绿叶，柱身直径约五十厘米，高约一米八，完整入画 |
| 11 | 婚礼烛台三件组 | `4136fdcf-e0e4-4f87-a0c9-0088056570d1` | 0.53 × 0.22 × 0.38 | 图生（lux3d） | 婚礼烛台三件组：三只不同高度的透明玻璃烛台一字排开，杯身缠一圈尤加利叶，高约十到二十五厘米，完整入画 |
| 12 | 婚礼蛋糕台 | `2a09ecd3-a1a6-4235-8ad1-d5df722319d1` | 0.43 × 0.43 × 0.65 | 图生（lux3d） | 婚礼蛋糕台：白色圆形台面蛋糕托，下方金色细腿支架，台上摆一只小型白色三层蛋糕，直径约六十厘米，完整入画 |
| 13 | 婚礼香槟塔 | `c8d2b6ee-e308-483f-a349-dacd159b585d` | 0.80 × 0.80 × 0.79 | 图生（lux3d） | 婚礼香槟塔：金色细架搭成的金字塔形香槟杯塔，约七层共二十余只透明酒杯，完整入画 |
| 14 | 婚礼甜品台摆件 | `74808c30-b72b-41f6-89f5-c3b83cfa499f` | 0.06 × 0.04 × 0.03 | 图生（lux3d） | 婚礼甜品台摆件：白色长方形托盘上摆着六块覆盆子慕斯小蛋糕与几颗糖渍橙片，完整入画 |
| 15 | 婚礼圆桌 | `b15a34fc-f3f2-4c7c-965c-30998ae7487f` | 1.20 × 1.20 × 1.05 | 图生（lux3d） | 婚礼圆桌：直径一米八的圆形木桌铺米白色亚麻桌布，桌面中央一只白色小花器，完整入画 |
| 16 | 婚礼白木椅 | `53cbb011-92b8-4c1a-a074-f7390b5ae29c` | 0.54 × 0.52 × 0.95 | 图生（lux3d） | 婚礼白木椅：白色木质梯背餐椅，椅面铺米白色坐垫，完整入画 |
| 17 | 婚礼落地花瓶 | `cf868de5-a05d-4d9b-9a89-3505d36586df` | 0.15 × 0.12 × 0.28 | 图生（lux3d） | 婚礼落地花瓶：哑光米白色落地陶罐花器，高约七十厘米，瓶口插几支白色洋桔梗与绿叶，完整入画 |
| 18 | 婚礼花瓣盘 | `1ce4bbe0-76a0-40b3-b435-9530c4c7b27d` | 0.27 × 0.20 × 0.27 | 图生（lux3d） | 婚礼花瓣盘：浅金色圆形浅口瓷盘，盘中散落白色与淡紫色花瓣，完整入画 |
| 19 | 婚礼桌号牌 | `17ca104e-689e-4fe8-91c1-fa2a83ecf262` | 0.06 × 0.06 × 0.22 | 图生（lux3d） | 婚礼桌号牌：金色小立牌插在浅米色小花器里，牌面空白，高约二十厘米，完整入画 |
| 20 | 婚礼心形绿雕 | `e5e16370-d57d-414a-8b22-5c2dd8fa3c17` | 0.46 × 0.30 × 0.60 | 图生（lux3d） | 婚礼心形绿雕：绿色植物修剪成的心形立体装饰体，表面点缀白色小玫瑰，底座为浅灰色圆台，正面完整入画 |
| 21 | 婚礼月洞门绿雕 | `2b0e506e-bd1c-4a32-bfb4-6bb4f28bfcb4` | 0.94 × 0.53 × 0.95 | 图生（lux3d） | 婚礼月洞门绿雕：绿色植物修剪成的圆形月洞形立体装饰体，表面点缀淡紫色小花与白色绣球，底座为浅灰色圆台，正面完整入画 |
| 22 | 婚礼香槟布幔花艺柱 | `4923657e-af62-4469-98d3-dedbf45db633` | 0.74 × 0.69 × 1.80 | 图生（lux3d） | 婚礼香槟布幔花艺柱：米金色布幔包裹的立柱，柱身一侧攀爬白色绣球与绿叶，直径约六十厘米，高约两米四，完整入画 |
| 23 | 婚礼白纱幔 | `ee6e392d-3ac0-4ee8-b005-9304ad8bb627` | 3.00 × 1.94 × 3.46 | 图生（lux3d） | 婚礼白纱幔：两米宽的白色雪纺纱幔从上方垂落，底边自然起伏堆叠，幔面绑着一串珍珠，完整入画 |
| 24 | 婚礼双拱花门 | `6ba6af9a-871a-4500-be20-536db5bd1b01` | 2.40 × 0.66 × 1.98 | 图生（lux3d） | 婚礼双拱花门：两座相连的圆环形金色细框，一座缠满白色玫瑰与绿叶，另一座缠满淡紫色绣球与桉树叶，正面完整入画 |
| 25 | 婚礼垂吊花球 | `87221ce6-aab3-4cf3-89a0-0a8a651ee004` | 0.45 × 0.43 × 0.53 | 图生（lux3d） | 婚礼垂吊花球：一颗由白色绣球、白玫瑰与绿叶扎成的圆形花球，顶端有细麻绳吊着，完整入画 |
| 26 | 婚礼珍珠串帘 | `cb293f67-912b-4b0b-ac98-d0f38b9be787` | 2.07 × 0.15 × 2.00 | 图生（lux3d） | 婚礼珍珠串帘：一排垂落的珍珠串帘，珍珠大小渐变，底部缀少量白色小花，完整入画 |
| 27 | 婚礼甜品长桌 | `709ae5c9-c685-4538-b6e4-1a11b1947c71` | 2.40 × 0.89 × 1.39 | 图生（lux3d） | 婚礼甜品长桌：两米长的浅木色长桌铺米白桌布，桌面摆着白色小花器与几只玻璃甜品罐，正面完整入画 |
| 28 | 婚礼咖啡桌 | `3122e6c6-eb90-407e-b7a2-a2e297c29311` | 1.40 × 1.40 × 1.06 | 图生（lux3d） | 婚礼咖啡桌：圆形浅木色矮桌铺米色桌布，桌面摆一只白色小花瓶与两只咖啡杯，完整入画 |
| 29 | 婚礼椅背装饰 | `1fb6f4b0-3d1f-41cc-8488-70130d2b70cd` | 0.66 × 0.54 × 0.90 | 图生（lux3d） | 婚礼椅背装饰：一条横向白色花艺带，白玫瑰、白色绣球与绿叶绑在浅木色椅背上，完整入画 |
| 30 | 婚礼席位卡 | `13dd8827-79d9-4569-b8ad-ad46361c243d` | 0.08 × 0.05 × 0.08 | 图生（lux3d） | 婚礼席位卡：米白色卡纸立在一只小巧的金色卡座里，卡面留白，旁有一支白色小花，完整入画 |
| 31 | 婚礼菜单卡立牌 | `417ca120-8913-417d-ae21-27c50442b1a4` | 0.12 × 0.11 × 0.22 | 图生（lux3d） | 婚礼菜单卡立牌：浅金色小立牌夹着米白色菜单卡，卡面留白，顶部一小枝绿叶，完整入画 |
| 32 | 婚礼餐盘 | `df5cdeb5-a893-4717-8b88-724e50f928bc` | 0.27 × 0.06 × 1.00 | 图生（lux3d） | 婚礼餐盘：白色瓷质圆盘带一圈细金边，盘上放一把刀和一把叉，完整入画 |
| 33 | 婚礼香槟杯一对 | `69513b81-14ee-4935-b515-d46ecffdd5b6` | 0.16 × 0.07 × 0.23 | 图生（lux3d） | 婚礼香槟杯一对：两只细长的高脚水晶香槟杯并排，杯身透亮，完整入画 |
| 34 | 婚礼刀叉组 | `9e31b8e7-590a-4e36-bb0a-59e33f34d73f` | 0.23 × 0.03 × 0.35 | 图生（lux3d） | 婚礼刀叉组：一把银色甜品刀、一把银色叉与一把银色小勺整齐并排放在米色餐巾上，完整入画 |
| 35 | 婚礼签到背景墙 | `bf6aac70-f314-45ec-bc21-03820e428617` | 2.40 × 0.74 × 2.29 | 图生（lux3d） | 婚礼签到背景墙：三米宽浅木色网格展板，板上错落挂着白色小花与空白卡片，底部一排小盆栽，完整入画 |
| 36 | 婚礼餐巾折花 | `b8e01366-ac62-493d-a19b-1dc55cf16a15` | 0.21 × 0.22 × 0.22 | 图生（lux3d） | 婚礼餐巾折花：米白色布餐巾折成扇形立放在白色小餐盘上，顶端别一小枝绿叶，完整入画 |
| 37 | 婚礼签到台 | `8c4257f1-bd9c-4035-b26a-553db34217d2` | 1.80 × 0.92 × 1.15 | 文生（lux3d） | 婚礼签到台：一张浅木色长条签到桌，长约一米八，宽约六十厘米，高约七十五厘米，四条方形木腿。桌面铺平整的白色桌布，桌布边缘平直垂下约十厘米，不落地、不堆叠、不起褶。桌面正中摆一本合上的米色空白笔记本、一支黑色签字笔、一只白色小瓷花器插一枝白色小花。写实产品摄影质感，单一主体居中，完整入画，四周留白，无文字、无字母、无水印。 |

> 描述出处：34 件取自 `assets.metadata.originalPrompt`；1 件（户外折叠椅）取自 `metadata.backfill.originalName`；3 件（婚礼宴会桌花 / 婚礼路引花牌 / 婚礼花拱门）的 metadata 没有提示词，取自 `generation_jobs.prompt`（出处 S3）。

### 5.1 分区归属 + 一句使用建议 + 公开建议

| # | 名称 | 归属分区 | 使用建议 | 公开建议 |
| --- | --- | --- | --- | --- |
| 1 | 户外折叠椅 | Z2 宾客席位区 | 折叠椅备用量；藏青布面与白绿主视觉冲突，建议只放侧区或做儿童/长者备用席。 | 保留公开：通用户外家具，泛用性高。 |
| 2 | 婚礼宴会桌花 | Z2 宾客席位区 | 每桌一件的桌面花艺，0.6 m 见方压在 1.2 m 小圆桌上偏满，建议按桌径缩放。 | 保留公开：婚宴桌花是可复用高频品类。 |
| 3 | 婚礼路引花牌 | Z4 迎宾签到区 | 签到区到席位区的导引花牌，1.2 m 高插在花器里。 | 保留公开：路引花牌是户外导通用件。 |
| 4 | 婚礼花拱门 | Z1 仪式区 | 次门或合影背景；实测 1.86 m 高，比主视觉矮一截，不要和双拱花门同框当主门。 | 保留公开：花拱门通用，但建议与「婚礼双拱花门」区分命名，避免普通用户下错件。 |
| 5 | 新娘手捧花 | Z1 仪式区 | 手持道具；模型 0.5 m 见方偏大，摆放时按手持比例缩到 0.3 m 左右。 | 建议收敛：手捧花是单次使用道具，公开后复用率低，且普通用户更可能拿它当摆件。 |
| 6 | 半圆弧形婚礼花墙背景板 | Z1 仪式区 | 仪式背景板；2.4 m 宽需要背架配重，裸摆会倒。 | 保留公开：婚宴花墙背景板可复用，公开时补一句「需配背架」。 |
| 7 | 菊花绿雕异形装置 | Z1 仪式区 | 入口对景的弯月绿雕，注意与「婚礼心形绿雕」「婚礼月洞门绿雕」是同系列三件，不要同时用满。 | 保留公开：绿雕异形装置是园林/展陈通用件。 |
| 8 | 婚礼迎宾立牌 | Z4 迎宾签到区 | 迎宾立牌 A，与 B 同参考图同尺寸，内容近乎重复。 | 建议收敛：与 554f02af 内容重复，二选一保留，另一件下架或改名成不同用途。 |
| 9 | 婚礼迎宾立牌 | Z4 迎宾签到区 | 迎宾立牌 B，重复件。 | 建议收敛：与 c13220f0 重复，二选一。 |
| 10 | 婚礼花柱 | Z1 仪式区 | 主通道立柱，柱径 0.73 m 比常见花柱粗，通道窄时每边只放 1 根。 | 保留公开：花柱是通用婚庆/活动件。 |
| 11 | 婚礼烛台三件组 | Z1 仪式区 | 仪式台烛台组，提示词写 10–25 cm、实测 0.38 m，放桌面不落地。 | 保留公开：烛台三件组是通用桌面摆件。 |
| 12 | 婚礼蛋糕台 | Z3 餐饮区 | 蛋糕台自带小三层蛋糕，摆位时按实际蛋糕尺寸换模型或缩放。 | 保留公开：婚礼蛋糕台通用。 |
| 13 | 婚礼香槟塔 | Z3 餐饮区 | 香槟塔 0.8 m 见方，需配操作台与接水桶（库内无）。 | 保留公开：香槟塔是热门婚庆件。 |
| 14 | 婚礼甜品台摆件 | Z3 餐饮区 | 甜品摆件仅 5.5 cm 见方，只能做桌面点缀，放大会露馅。 | 保留公开但标注尺寸：普通用户容易按「摆件」理解成整台甜品，公开页应写清 5.5 cm。 |
| 15 | 婚礼圆桌 | Z2 宾客席位区 | 主桌，但实测直径 1.2 m（提示词写 1.8 m），按 8 席排；1.8 m 桌要另用静态库圆桌。 | 保留公开但必须改尺寸说明：提示词与实测差 0.6 m，不改会被普通用户当 10 人桌用。 |
| 16 | 婚礼白木椅 | Z2 宾客席位区 | 白木梯背椅，本场主力座椅 250 把，单独 public 意义在于补齐静态库缺口 G02。 | 保留公开：白木椅是婚宴通用件，也是静态库最该补的品类。 |
| 17 | 婚礼落地花瓶 | Z1 仪式区 | 名「落地花瓶」实测仅 0.28 m，只能当地面花器用；要真落地花瓶得另生成。 | 建议改名后公开：「落地花瓶」名不副实，改叫「婚礼地面花器」之类，避免误用。 |
| 18 | 婚礼花瓣盘 | Z2 宾客席位区 | 花瓣盘，每桌 1 个作装饰盘。 | 保留公开：通用瓷盘小件。 |
| 19 | 婚礼桌号牌 | Z2 宾客席位区 | 桌号牌，牌面留白需后期贴号。 | 保留公开：桌号牌通用，但牌面空白应注明需自行贴字。 |
| 20 | 婚礼心形绿雕 | Z1 仪式区 | 心形绿雕小件，点缀用。 | 保留公开：绿雕通用件。 |
| 21 | 婚礼月洞门绿雕 | Z1 仪式区 | 月洞门绿雕，合影背景，1 m 见方。 | 保留公开：绿雕通用件。 |
| 22 | 婚礼香槟布幔花艺柱 | Z1 仪式区 | 米金布幔花艺柱，实测 1.8 m 高（提示词写 2.4 m），与花柱同高、不能分主次。 | 保留公开但修正标注：高度写 1.8 m。 |
| 23 | 婚礼白纱幔 | Z1 仪式区 | 垂幔片做围合；顶棚另采购（缺口 G06）。 | 保留公开但改名更准：叫「白纱幔（垂幔片）」比「白纱幔顶棚」准确。 |
| 24 | 婚礼双拱花门 | Z1 仪式区 | 主仪式门，本场最关键的一件。 | 保留公开：本场代表作，公开价值最高。 |
| 25 | 婚礼垂吊花球 | Z1 仪式区 | 垂吊花球，需顶部吊点构件（库内无，见缺口 G12）。 | 保留公开但注明依赖：吊挂需另配横杆/吊点。 |
| 26 | 婚礼珍珠串帘 | Z1 仪式区 | 珍珠串帘挂背景板前，2.07 m 宽正好单幅。 | 保留公开：串帘是通用婚庆装饰。 |
| 27 | 婚礼甜品长桌 | Z3 餐饮区 | 甜品长桌 2.4 m，自带米白桌布，省一张桌布缺口。 | 保留公开：甜品长桌含桌布，是「一张模型顶一张桌布」的省事件。 |
| 28 | 婚礼咖啡桌 | Z3 餐饮区 | 咖啡桌 1.4 m 见方，餐饮区休息位。 | 保留公开：咖啡桌通用。 |
| 29 | 婚礼椅背装饰 | Z2 宾客席位区 | 椅背花艺带，按椅背弧度套上；每 2 椅 1 条。 | 保留公开：椅背装饰是复用率很高的通用件。 |
| 30 | 婚礼席位卡 | Z2 宾客席位区 | 席位卡，卡面留白需自行写字。 | 保留公开：席位卡通用，小件高复用。 |
| 31 | 婚礼菜单卡立牌 | Z2 宾客席位区 | 菜单卡立牌，每桌 1 个。 | 保留公开：菜单卡立牌通用。 |
| 32 | 婚礼餐盘 | Z2 宾客席位区 | 餐盘模型高 0.997 m（含竖插刀叉），摆位必须压平刀叉或只用盘体，否则穿模。 | 建议先修模型再公开：刀叉竖插导致整体高近 1 m，是几何缺陷不是设计选择。 |
| 33 | 婚礼香槟杯一对 | Z2 宾客席位区 | 香槟杯一对，桌面摆件。 | 保留公开：香槟杯通用。 |
| 34 | 婚礼刀叉组 | Z2 宾客席位区 | 刀叉组，可与餐盘分开摆。 | 保留公开：刀叉组通用。 |
| 35 | 婚礼签到背景墙 | Z4 迎宾签到区 | 签到背景墙，实测 2.4 m 宽（提示词写 3 m）。 | 保留公开：签到背景墙复用率高，但尺寸标注要改成 2.4 m。 |
| 36 | 婚礼餐巾折花 | Z2 宾客席位区 | 餐巾折花，摆在盘上或盘旁。 | 保留公开：餐巾折花通用。 |
| 37 | 婚礼签到台 | Z4 迎宾签到区 | 签到台 1.8 m 长，自带笔记本与笔的细节。 | 保留公开：签到台是高频婚宴件。 |

**公开状态核对**：37/37 件都已在 `scene_private.published_assets` 里，`catalog='scendance-generated'`（出处 S2），也就是说普通用户已经能下到全部 37 件。上表「公开建议」是在「已公开」这个既成事实上的**优化建议**，不是「要不要公开」的待办。

### 5.2 尺寸偏差表（提示词自述 ≠ GLB 实测）

| 编号 | 物料 | id | 提示词说 | 实测（宽×深×高 m） | 对本场的影响 |
| --- | --- | --- | --- | --- | --- |
| D-01 | 婚礼圆桌 | `b15a34fc-f3f2-4c7c-965c-30998ae7487f` | 直径一米八的圆形木桌 | 1.20 × 1.20 × 1.05 m | 每桌少 2 席；25 桌从 250 席变 200 席，或改用静态库 1.80 m 圆桌。 |
| D-02 | 婚礼落地花瓶 | `cf868de5-a05d-4d9b-9a89-3505d36586df` | 哑光米白色落地陶罐花器，高约七十厘米 | 0.15 × 0.12 × 0.28 m | 不是落地花瓶，是 28 cm 地面花器；地面花语义的通道摆件要另生成。 |
| D-03 | 婚礼签到背景墙 | `bf6aac70-f314-45ec-bc21-03820e428617` | 三米宽浅木色网格展板 | 2.40 × 0.74 × 2.29 m | 比预期窄 0.6 m，背架按 2.4 m 做。 |
| D-04 | 婚礼迎宾立牌 | `c13220f0-68cf-4f95-af80-3e5b04eaad2f` | 高约一米二 | 0.97 × 0.77 × 1.80 m | 实为 1.8 m，比预期高 0.6 m；视线遮挡与配重都要重算。 |
| D-05 | 婚礼香槟布幔花艺柱 | `4923657e-af62-4469-98d3-dedbf45db633` | 直径约六十厘米，高约两米四 | 0.74 × 0.69 × 1.80 m | 比预期矮 0.6 m，与 1.8 m 花柱同高，主次分不出来。 |
| D-06 | 婚礼餐盘 | `df5cdeb5-a893-4717-8b88-724e50f928bc` | 白色瓷质圆盘带金边，盘上放一把刀和一把叉 | 0.27 × 0.06 × 1.00 m | 刀叉在模型里竖着插，整体高近 1 m；摆位必须压平或只用盘体，否则穿模。 |
| D-07 | 婚礼甜品台摆件 | `74808c30-b72b-41f6-89f5-c3b83cfa499f` | 白色长方形托盘上摆着六块覆盆子慕斯小蛋糕与糖渍橙片 | 0.055 × 0.035 × 0.031 m | 只有 5.5 cm 见方，托盘与蛋糕疑似只建了一部分；放大即穿帮。 |
| D-08 | 户外折叠椅 | `9ccaf007-7398-4c63-933b-4f4e910b75b9` | 展开尺寸约 45×50×88 厘米，座高 45 厘米 | 0.52 × 0.54 × 0.82 m | 实测比提示词宽 7 cm、高矮 6 cm、座高未在模型体现；作为备用席影响有限。 |
| D-09 | 婚礼花拱门 | `f78f294f-1663-4e49-b197-3c7f8dc48a4f` | 高约二点四米 | 2.00 × 0.62 × 1.86 m | 实为 1.86 m，作次门不作主视觉（与 D-01 同源：提示词尺寸未落进模型）。 |
| D-10 | 婚礼花柱 | `0bc698c6-d2c9-4091-8483-6039113061e4` | 柱身直径约五十厘米，高约一米八 | 0.73 × 0.68 × 1.80 m | 高度对、柱径实测 0.73 m（提示词 0.5 m），粗 0.23 m；通道窄时每边只放 1 根。 |
| D-11 | 婚礼路引花牌 | `5a624a1c-f0db-402c-9833-f527a4b9b0df` | 细金色立杆配小花器……高约一米 | 0.40 × 0.36 × 1.20 m | 实为 1.2 m，比预期高 0.2 m；6 块并排导引时占位比预估长。 |
| D-12 | 新娘手捧花 | `a620ce00-c82a-498f-8204-1cb28d8343e6` | 直径约二十五厘米的圆形小束 | 0.50 × 0.50 × 0.50 m | 实测直径 0.5 m，是提示词的两倍；手持必须缩放到 0.25–0.30 m，否则像花球而不是手捧花。 |
| D-13 | 菊花绿雕异形装置 | `cd1c284e-40df-4e8b-bcfb-d5347512a4c9` | 高约八十厘米 | 1.20 × 0.60 × 1.20 m | 实为 1.2 m，比预期高 0.4 m；入口对景件会比预想更抢眼，且需配重。 |
| D-14 | 婚礼烛台三件组 | `4136fdcf-e0e4-4f87-a0c9-0088056570d1` | 三只不同高度……高约十到二十五厘米 | 0.53 × 0.22 × 0.38 m | 最高一只 0.38 m，超出提示词上限 0.13 m；桌面烛台组按 0.4 m 预留台面高度。 |
| D-15 | 婚礼蛋糕台 | `2a09ecd3-a1a6-4235-8ad1-d5df722319d1` | 白色圆形台面蛋糕托……直径约六十厘米 | 0.43 × 0.43 × 0.65 m | 托盘实测 0.43 m，不是 0.6 m；叠层蛋糕的直径要按 0.43 m 选，否则托不住。 |
| D-16 | 婚礼白纱幔 | `ee6e392d-3ac0-4ee8-b005-9304ad8bb627` | 两米宽的白色雪纺纱幔 | 3.00 × 1.94 × 3.46 m | 实测宽 3.0 m，比预期宽 1 m；围合 8 m 仪式区要 3 幅，不是 4 幅。 |
| D-17 | 婚礼甜品长桌 | `709ae5c9-c685-4538-b6e4-1a11b1947c71` | 两米长的浅木色长桌 | 2.40 × 0.89 × 1.39 m | 实测长 2.4 m，比预期长 0.4 m；2 张并排占位比预估宽。 |
| D-18 | 婚礼签到台 | `8c4257f1-bd9c-4035-b26a-553db34217d2` | 长约一米八，宽约六十厘米，高约七十五厘米 | 1.80 × 0.92 × 1.15 m | 长度对，但宽 0.92 m（提示词 0.6）、高 1.15 m（提示词 0.75）；不是标准 0.75 m 吧台高，签到人员站姿会偏矮，桌面垫高反而要按 1.15 m 备。 |

> 这 10 件不是「模型坏了」，是**图生 3D 不会照抄提示词里的数字**。凡是按提示词尺寸备过料的，这一轮要按实测值重算。

## 六、库内缺口清单

**共 18 条。** 判定口径：不是「库里有近似件就算有」，而是「近似件能不能在这场草坪婚礼里直接顶替用」。

| 编号 | 需要什么 | 库里最接近的是什么 | 为什么不能替代 | 建议走 aholo 还是采购 | 归口 |
| --- | --- | --- | --- | --- | --- |
| G01 | 白色圆桌布（可单独铺、可换色） | aholo「婚礼圆桌」自带米白亚麻桌布但与桌体一体；静态库 hotel-and-resort-operations-banquet-round-table-10-958b76ee 是裸桌无布 | 关键词扫描 merged.json 的 tablecloth / 桌布 / linen 命中 0 条。桌布要按桌径覆盖并垂坠 0.6–0.7 m，桌布与桌一体的模型无法单独铺设、无法换色、也无法给静态库圆桌配布。 | 采购（白色/米白亚麻方布，按 1.80 m 圆桌径配 2.4 m 见方） | 物料 |
| G02 | 白色木梯背椅（Chiavari / 礼宾椅） | bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7（木质餐椅 0.49×0.47×1.00 m）、bedroom-and-living-room-furniture-dining-chair-upholst-7ec33345（软包餐椅）、izakaya-alley-and-ramen-shop-folding-chair-dbe1ca77（折叠椅） | 关键词扫描 chiavari / 白木椅 / 礼宾椅 命中 0 条。静态库三件都是棕色实木或软包餐椅、方档椅背，与 aholo「婚礼白木椅」（梯背、白色漆、米白坐垫）不同款；与 aholo 椅混排会出现两套椅子。 | aholo 已覆盖主需求（婚礼白木椅）；静态库仍建议再生成 1 件白色梯背椅作为可复用库存 | aholo 生成 |
| G03 | 红毯 / 宾客通道地毯 | medieval-mmo-starter-realm-rug-5064c4c7（中世纪地毯 2.54×1.62×0.12 m）、companion-animals-and-pet-home-rug-3aff2413（1.80×1.30×0.024 m）、pets-and-companions-hd-rug-b811e9ad（2.00×1.45×0.026 m） | 全库只有 3 张地毯，关键词地毯 / rug / carpet 命中 3 条，全是方形小尺寸家居毯（最长 2.54 m），材质为绒面/羊毛，没有可拼接的长条红毯。铺 8 m 主通道至少要 4 段拼接，且颜色与材质都不对。 | 采购（户外可走道地毯 1.2 m 宽，按主通道长度备料） | 采购 |
| G04 | 婚礼串灯 / 灯串（围合与树上悬挂） | storybook-christmas-market-festoon-bulb-string-9422da4e（节庆灯泡串 3.09×0.09×0.69 m） | 关键词串灯 / 灯串 / fairy light / bulb 命中 1 条。库里这唯一一条是圣诞市集彩灯串、单段仅 3.09 m；婚礼要 20 m 以上暖白小灯泡，且要能挂在树上或跨通道。 | 采购（暖白 festoon 灯串，不进 GLB） | 采购 |
| G05 | 婚礼尖顶帐篷（pavilion / marquee） | caravan-park-and-campsite-bell-tent-d7f74bfd（钟形帐篷 4.66×4.66×2.68 m）、medieval-siege-and-castle-defence-bell-tent-open-88cc714a（钟形帐篷开口款 4.59×4.53×3.24 m）、hot-air-balloon-festival-registration-gazebo-1f36ec9a（快搭帐篷 3.34×3.34×3.00 m） | 关键词 pavilion / marquee / peaked / 尖顶 命中 0 条（只命中板球「视线挡板」「三柱门罩布」等无关件）。库里全是圆顶或平顶，婚礼尖顶篷是高跨硬结构 + 大跨度，GLB 只能出外观模型，不解决杆件、风载与搭建。 | 采购（4×6 m / 6×9 m 尖顶篷，由搭建方出结构与风载计算） | 采购 |
| G06 | 白色纱幔顶棚（通道 / 席位区上方 canopy） | aholo「婚礼白纱幔」ee6e392d-3ac0-4ee8-b005-9304ad8bb627（3.00×1.94×3.46 m，垂幔片）；静态库 live-music-venue-and-festival-stage-stage-roof-canopy--543b5fb3（舞台顶棚模块 3.00×6.31×0.54 m）、trading-post-and-barter-market-canopy-market-booth-46c6c10f（遮棚展位 2.60×2.10×2.34 m） | aholo 的白纱幔是「从上方垂落、底边起伏堆叠」的幔片，没有顶面、不能承重、不能跨在通道上方固定；静态库的 canopy 类全是摊位/舞台构件，材质与尺寸都不是纱幔顶棚。 | 采购（纱幔顶棚）+ 保留 aholo 幔片做围合装饰 | 采购 |
| G07 | 乐队台 / DJ 台（带台面与器材位） | nightclub-and-dj-booth-riser-platform-module-1e135c35（模块升高平台 2.01×1.01×0.40 m）、orchestra-and-band-instruments-stage-platform-module-6be1e985（音乐会舞台平台 2.00×1.00×0.80 m）、nightclub-and-dj-booth-backdrop-led-panel-module-831305f2（背景发光屏模块 1.00×0.16×1.44 m）、nightclub-and-dj-booth-hanging-speaker-c73e7811（吊挂音箱） | 库里 DJ / booth / bandstand 类命中 31 条，但全是裸平台、箱体、屏模块、耳机，没有一件是「带台面 + 遮光罩 + 器材位」的成品 DJ 台。裸平台拼出来的台子不遮操作员、也不挡逆光。 | aholo 生成 1 件 DJ 台 + 1 件乐队台（参考图已有婚演照片） | aholo 生成 |
| G08 | 香槟塔 / 甜品台 / 蛋糕台（静态库） | aholo 已有：婚礼香槟塔 c8d2b6ee、婚礼甜品长桌 709ae5c9、婚礼蛋糕台 2a09ecd3、婚礼甜品台摆件 74808c30；静态库最近似为 indian-bazaar-street-and-temple-sweet-counter-3a98de40（带托盘甜品柜台 1.80×0.84×1.86 m） | 关键词 香槟塔 / champagne tower / 甜品台 / dessert table 在 merged.json 命中 0 条。静态库那个柜台是印度市集风带托盘柜，不是婚礼甜品台/香槟塔。 | 静态库缺口，aholo 37 件已覆盖；如需扩品类可再生成 1 件带底座的香槟塔 | aholo 已覆盖 |
| G09 | 桌花 / 席位卡 / 桌号牌 / 烛台（静态库） | aholo 已有：婚礼宴会桌花 7ad8cafa、婚礼席位卡 13dd8827、婚礼桌号牌 17ca104e、婚礼烛台三件组 4136fdcf、婚礼菜单卡立牌 417ca120 | 关键词 centerpiece / 桌花 / place card / 席位卡 / 桌号 / candlestick / 烛台 在 merged.json 命中 0 条。这几类小件在静态库里完全空缺。 | 静态库缺口，aholo 37 件已覆盖 | aholo 已覆盖 |
| G10 | 婚宴签到背景墙 / 签到台（静态库） | aholo 已有：婚礼签到背景墙 bf6aac70、婚礼签到台 8c4257f1；静态库最近似为 airport-terminal-and-ground-operations-check-in-desk-ba7d92dc（机场签到台 3.11×1.88×2.87 m） | 机场签到台是机场风、金属工业风、与婚礼白绿主视觉冲突；静态库没有任何婚宴风签到背景板。 | 静态库缺口，aholo 37 件已覆盖 | aholo 已覆盖 |
| G11 | 婚车（头车 / 车队） | 库里车辆只有 fire-and-emergency-services-ambulance-f22ce1a5（救护车）、scendance-plan-coach（大巴）、scendance-plan-bus-coach-station（大巴站）、摩托车与皮卡若干 | 关键词 婚车 / limousine / wedding car 命中 0 条——库里没有乘用车类模型。真实婚车是租赁与涂装问题，GLB 建模不解决。 | 按实际租赁车型与涂装另行确认；本清单不做占位 | 不排入清单 |
| G12 | 草坪照明（地插灯 / 追光灯 / 挂灯点位） | wedding-and-chapel-kit-lantern-post-c06e501d（花园灯柱 0.24×0.24×1.80 m）、turning-seasons-winter-lantern-dc1a8170（冬季提灯 0.30×0.30×0.51 m）、storybook-christmas-market-festoon-bulb-string-9422da4e（节庆灯泡串） | 这三件都是「装饰性」灯具，亮度与光型都不做演出级照明；库里没有地插式草坪灯、追光灯，也没有给垂吊花球用的挂点构件（aholo「婚礼垂吊花球」需要顶部吊点，库内无挂点件）。 | aholo 生成「草坪地插灯」「追光灯」各 1 件 + 1 件花球吊挂横杆；实际灯具仍需采购 | aholo 生成 + 采购 |
| G13 | 宾客动线地面保护（轻质草坪板） | scendance-plan-plastic-trackway（2.00×1.00×0.06 m）、scendance-plan-aluminum-trackway（2.40×1.15×0.06 m）、scendance-plan-ground-protection-mats（2.40×1.20×0.06 m）、demolition-and-site-clearance-demolition-and-site-clea-016dd84b（金属铺道板 3.10×2.10×0.07 m） | 这四件都是**车辆 / 重载**用途的铺道板，厚度 4–7 cm。在草地上对穿高跟鞋的宾客是绊脚与压草风险，对宾客动线不适用。 | 采购（20–30 mm 轻质蜂窝草坪保护板），或把宾客动线改走园路硬质面 | 采购 |
| G14 | 草坪无障碍坡道 / 轮椅席位 | scendance-plan-accessible-ramp（1.35×6.43×1.53 m）、car-park-and-road-vehicle-fleet-disabled-bay-tile-22090d5f（无障碍停车位 2.50×5.00 m）、scendance-plan-ada-low-profile-cable-matting（低矮过线垫 0.76×0.54×0.04 m） | 库里有坡道，但它是「大坡道整段」，没有「草坪面与硬化面之间的一段短过渡板」，也没有轮椅席位标识物或轮椅占位模型。草坪与硬化面高差未知，坡道能不能用也待核。 | 按现场高差采购过渡坡板 + 自制轮椅席位标识；高差须现场量 | 采购 |
| G15 | 帐篷配重、地钉、拉绳（抗风） | （无）— merged.json 无地钉 / 配重块 / 沙袋类条目；摩托车赛道有 "配重底座遮阳伞" motorcycle-racing-and-street-bikes-umbrella-ef9fbcd7（1.80×1.80×2.14 m），是伞具底座不是通用配重 | 抗风配重是施工五金件，GLB 表达不了配重吨位与地钉拉力；而风载计算直接决定雨备帐篷能不能搭。 | 采购（配重砂袋 / 地钉 / 拉绳）+ 由搭建方出风载计算 | 采购 |
| G16 | 宾客雨具（一次性雨衣 / 雨伞分发） | greek-island-village-and-harbour-cafe-parasol-a99c4044（咖啡座遮阳伞 2.80×2.80×2.35 m）、hotel-and-resort-operations-poolside-table-and-parasol-2a52833a（池畔桌配遮阳伞 2.24×2.24×2.38 m） | 这两件是固定立杆遮阳伞，占位大、需配重、不能覆盖 250 人的移动人群；库里没有可分发的一次性雨具件（这类是消耗品，本来也不该有 GLB）。 | 采购（按人数备一次性雨衣），不进 GLB | 采购 |
| G17 | 儿童餐椅 / 儿童座椅 | scendance-plan-stroller-storage（婴儿车存放 3.90×2.40×2.39 m）、office-lobby-and-facilities-canteen-stacking-chair-3440c7d8（可叠放座椅 0.46×0.51×0.89 m） | 库里有婴儿车存放位与普通餐椅，但没有一张儿童餐椅（high chair）。带婴幼儿的宾客没有落座位。 | 采购或租赁儿童椅（数量按到场家庭估） | 采购 |
| G18 | 垃圾袋 / 垃圾箱内衬 / 清运服务 | （静态库有固定垃圾桶本体 6 件：tool-hire-depot-...-yard-waste-bin、modern-rail-...-waste-bin、football-soccer-club-grounds-waste-bin、bunker-shelter-...-waste-bin-foot-pedal、community-sports-hall-...-foyer-bin、dog-agility-...-field-litter-bin） | 库里只有桶体，没有耗材（袋/内衬），也没有清运车辆或清运服务件；活动当天垃圾清运是场地方协议范畴。 | 采购耗材 + 与场地方确认清运时段与垃圾暂存点 | 采购 / 场地方 |

**分档小结**

- **必须采购（8 条）**：G01 白色圆桌布、G03 红毯/通道地毯、G04 串灯、G05 尖顶帐篷、G06 纱幔顶棚、G13 轻质草坪板、G14 无障碍过渡坡板、G16 宾客雨具。
- **建议 aholo 生成（2 条）**：G07 乐队台 / DJ 台、G12 草坪地插灯 + 追光灯 + 花球吊点。
- **aholo 37 件已覆盖、静态库仍空缺（4 条）**：G02 白木椅、G08 香槟塔/甜品台、G09 桌花/席位卡/桌号牌/烛台、G10 签到背景墙/签到台。
- **不排入清单 / 归场地方（3 条）**：G11 婚车、G15 帐篷配重与地钉、G18 垃圾耗材与清运。
- **待补（1 条）**：G17 儿童餐椅。

## 七、机读版字段说明（`.temp/huajia-bom.json`）

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 本文件结构版本号，当前 `1.0`。 |
| `generatedAt` | 本次清单生成时间（本地时区 +08:00）。 |
| `project` | 项目元信息：名称、场地、范围、ownerId、对应文档路径。`scope` 固定写明「仅室外草坪」。 |
| `venue.poi` / `venue.mainPoi` | 场地各 POI 坐标（GCJ-02，高德检索结果），每条带 `source` 编号。 |
| `venue.lawnAreaClaims` | 草坪面积的三套冲突口径，每条带 `source` 与 `status`（一律「待现场核实」）。 |
| `venue.hardConstraints` | 场地硬约束（限行、入场费、旺季、停车），每条带 `source`。 |
| `venue.notFound` | 明确列出「查不到因此不写」的事项。 |
| `assumptions[]` | 布置口径：`key` 口径项 / `value` 取值 / `basis` 依据。 |
| `zones[]` | 分区定义：`id` / `name` / `origin`（分区来源：丽丽实画 vs 我方补）/ `note`。 |
| `bom[]` | 清单行，一行一件物料。字段见下。 |
| `generatedAssets[]` | 37 件生成件全量，含 id、实测尺寸、原始提示词、发布状态、分区与使用/公开建议。 |
| `gaps[]` | 库内缺口：`id` / `need` / `closestInLibrary` / `whyNotSubstitutable` / `recommendedRoute` / `owner`。 |
| `deviations[]` | 尺寸偏差：`id` / `item` / `assetId` / `promptSays` / `measured` / `impact`。 |
| `sources` | 出处字典，键名 S1–S14，正文里用 `[Sxx]` 引用。 |
| `selfCheck` | 本次生成时的自检读数。 |

`bom[]` 每行的字段：

| 字段 | 含义 |
| --- | --- |
| `zone` / `zoneName` | 所属分区 id 与名称。 |
| `name` | 物料名称。 |
| `source` | `aholo-generated`（37 件生成件）或 `static-library`（平台静态库）。**缺口件不在 bom 里**，它们在 `gaps[]`。 |
| `sourceRef` | aholo 件是 asset id；静态库件是 slug。 |
| `catalog` | 公共目录名，生成件为 `scendance-generated`。 |
| `license` / `page` | 素材出处：license 类型；静态库件附 3dassets.dev 原页。 |
| `sizeM` | 单件实测尺寸，`width`/`depth`/`height`，单位米。 |
| `qty` | 数量（暂定值，见 `assumptions`）。 |
| `unitPrice` | 单价，**恒为 `null`**；`null` = 未定价，不是 0 元。 |
| `priceStatus` | 单价状态文案，当前全部为「未定价」。 |
| `note` | 该行的使用说明与注意事项。 |

## 八、自检读数

| 检查项 | 读数 |
| --- | --- |
| SQL 查到的生成物料条数 | 37 |
| 写入 `generatedAssets[]` 的条数 | 37 |
| 进入 `bom[]` 的生成件（去重） | 37 |
| 没进 BOM 的生成件 | 0（全部进表） |
| 没写分区建议的生成件 | 0（全部有） |
| BOM 总行数 | 149（aholo 37 / 静态库 112） |
| 单价非 null 的行 | 0（应为 0） |
| 库内缺口条数 | 18 |
| 尺寸偏差条数 | 18 |
| 分区数 | 10 |
| 同名生成件 | 婚礼迎宾立牌×2 |

> 同名生成件「婚礼迎宾立牌」有 2 条（`c13220f0…`、`554f02af…`），同参考图、同尺寸、内容近乎重复，建议二选一（见 5.1 与 G 组建议）。

---

## 九、刻意没做的事

- 没改任何前端 / 后端代码，没动 `frontend/` 与 `supabase/`。
- 没做室内分区；室内只在第一节作为雨备退路出现一次。
- 没把任何一项写成「已验收」「已上线」「已预订」。
- 没把草坪面积当成设计真值，也没编禁喷花/明火/雨天预案条款、官方平面图、草坪边界形状。
- 没给任何物料填 0 元单价。
- 没把缺口件塞进 `bom[]` 冒充「有货」——缺口单列在 `gaps[]`。
- 没有 git add / commit / push，也没有改 `.gitignore`。
