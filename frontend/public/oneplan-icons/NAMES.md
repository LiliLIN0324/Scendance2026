# OnePlan 物件名 ↔ 图标文件对照表

本文件是 [manifest.json](manifest.json) 的人读版：454 个物件库名称、549 个素材文件全部在表内。

- 素材文件共 **549** 个（icon 245 / scale-fg 149 / scale-bg 149 / area 3 / categories 3）。
- **395 个 slug / 549 个文件全部有中文名**：其中 345 个 slug 直接来自物件库名称表（`sticker-taxonomy.zh.json`），50 个是 CDN 文件名与显示名不一致、我按语义补充命名的（manifest 里 `name_source` 标 `curated`，本表以 `*` 标记）。
- 一个物件可能只有 `scale-*` 而没有 `icon`：OnePlan 这类物件在画布上按真实占地画，不提供 24×24 符号。
- 附录列出 109 个**在 CDN 上没有任何同名文件**的物件名（不是抓漏，见 ATTRIBUTION.md 的完整性口径）。

## 列含义

| 列 | 含义 |
| --- | --- |
| 中文名 / English | 物件库显示名；`*` 为本次补充命名 |
| icon | `oneplan-icons/icon/<slug>.svg` —— 24×24 地图符号 |
| scale-fg / scale-bg | `oneplan-icons/scale-fg|scale-bg/<slug>.svg` —— 真实尺度前景 / 底形 |

### 活动区域·流线与通行 / 出入口与通行图标 · Areas Routes & Access / Entry and Access Icons

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 步行通道 | Pedestrian Access | `/oneplan-icons/icon/pedestrian-access.svg` | — | — |
| 车辆通道 | Vehicle Access | `/oneplan-icons/icon/vehicle-access.svg` | — | — |
| 出口闸门 | Exit Gate | `/oneplan-icons/icon/exit-gate.svg` | — | — |
| 储物柜 | Lockers | `/oneplan-icons/icon/lockers.svg` | — | — |
| 电梯 | Elevator | `/oneplan-icons/icon/elevator.svg` | — | — |
| 气球拱门 | Balloon arch | `/oneplan-icons/icon/balloon-arch.svg` | — | — |
| 入口闸门 | Entry Gate | `/oneplan-icons/icon/entry-gate.svg` | — | — |
| 手环领取点 | Wristband Collection | `/oneplan-icons/icon/wristband-collection.svg` | — | — |
| 售票处 | Ticket Office | `/oneplan-icons/icon/ticket-office.svg` | — | — |
| 疏散椅 | Evacuation chair | `/oneplan-icons/icon/evacuation-chair.svg` | — | — |
| 无障碍坡道 | Accessible Ramp | `/oneplan-icons/icon/accessible-ramp.svg` | — | — |
| 无障碍停车 | Accessible Parking | `/oneplan-icons/icon/accessible-parking.svg` | — | — |
| 验票点 | Ticket Check | `/oneplan-icons/icon/ticket-check.svg` | — | — |
| 闸机 | Turnstile | `/oneplan-icons/icon/turnstile.svg` | — | — |
| 证件认证/通行证核验 | Accreditation | `/oneplan-icons/icon/accreditation.svg` | — | — |

### 活动区域·流线与通行 · Areas, Routes & Access

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 人群区底纹 | Crowd area pattern | — | — | — |
| 通用区底形 | Generic area footprint | — | — | — |

### 分类图标 · Category icons

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 工作人员（分类图标） | Workforce (category icon) | — | — | — |
| 活动区域·流线与通行（分类图标） | Areas, Routes & Access (category icon) | — | — | — |
| 基础设施（分类图标） | Infrastructure (category icon) | — | — | — |

### 设施物料 / 视听设备 · Infrastructure / Audio Visual

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 大屏 | Large Screen | — | `/oneplan-icons/scale-fg/large-screen.svg` | `/oneplan-icons/scale-bg/large-screen.svg` |
| 扩声音箱 | PA Speakers | `/oneplan-icons/icon/pa-speakers.svg` | — | — |
| DJ 位 | DJ Location | `/oneplan-icons/icon/dj-location.svg` | — | — |

### 设施物料 / 品牌与导视 · Infrastructure / Branding and Signage

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 刀旗/羽毛旗 | Feather Flag | `/oneplan-icons/icon/feather-flag.svg` | — | — |
| 灯杆旗 | Lamp Post Banner | `/oneplan-icons/icon/lamp-post-banner.svg` | — | — |
| 栏杆柱/一米线立柱 | Stanchion | `/oneplan-icons/icon/stanchion.svg` | — | — |
| 易拉宝 | Pull up banner | `/oneplan-icons/icon/pull-up-banner.svg` | — | — |
| 指示牌 | Sign | `/oneplan-icons/icon/sign.svg` | — | — |

### 设施物料 / 转播摄像 · Infrastructure / Broadcast

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 固定机位 | Camera Fixed | `/oneplan-icons/icon/camera-fixed.svg` | — | — |
| 航拍无人机 | Camera Drone | `/oneplan-icons/icon/camera-drone.svg` | — | — |
| 三脚架机位 | Camera Tripod | `/oneplan-icons/icon/camera-tripod.svg` | — | — |
| 摄像船 | Camera Boat | `/oneplan-icons/icon/camera-boat.svg` | — | — |
| 摄像平台 | Camera Platform | `/oneplan-icons/icon/camera-platform.svg` | — | — |
| 摄像摇臂 | Camera Crane | `/oneplan-icons/icon/camera-crane.svg` | — | — |
| 手持机位 | Camera Handheld | `/oneplan-icons/icon/camera-handheld.svg` | — | — |
| Jimmy 摄像车 | Camera Jimmy | `/oneplan-icons/icon/camera-jimmy.svg` | — | — |
| Skycam | Skycam | `/oneplan-icons/icon/skycam.svg` | — | — |

### 设施物料 / 电力与弱电 · Infrastructure / Electrical

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 保温箱/冷藏箱 | Esky | `/oneplan-icons/icon/esky.svg` | — | — |
| 冰箱 | Fridge | `/oneplan-icons/icon/fridge.svg` | — | — |
| 打印机 | Printer | `/oneplan-icons/icon/printer.svg` | — | — |
| 电池储能系统 | Battery Energy Storage System | — | `/oneplan-icons/scale-fg/battery-energy-storage-system.svg` | `/oneplan-icons/scale-bg/battery-energy-storage-system.svg` |
| 电动车充电桩 | EV Charge Point | `/oneplan-icons/icon/ev-charge-point.svg` | — | — |
| 电脑 | Computer | `/oneplan-icons/icon/computer.svg` | — | — |
| 发电机 | Generator | — | `/oneplan-icons/scale-fg/generator.svg` | `/oneplan-icons/scale-bg/generator.svg` |
| 发电机位 | Generator Point | `/oneplan-icons/icon/generator-point.svg` | — | — |
| 防火墙 | Firewall | `/oneplan-icons/icon/firewall.svg` | — | — |
| 风扇 | Fan | `/oneplan-icons/icon/fan.svg` | — | — |
| 过线垫 | Cable Matting | — | `/oneplan-icons/scale-fg/cable-matting.svg` | `/oneplan-icons/scale-bg/cable-matting.svg` |
| 冷冻柜 | Freezer | `/oneplan-icons/icon/freezer.svg` | — | — |
| 临时供电 | Temporary Power | `/oneplan-icons/icon/temporary-power.svg` | — | — |
| 路灯 | Street lamp | `/oneplan-icons/icon/street-lamp.svg` | — | — |
| 配电箱 | Distribution Board | — | `/oneplan-icons/scale-fg/distribution-board.svg` | `/oneplan-icons/scale-bg/distribution-board.svg` |
| 取暖器 | Heater | `/oneplan-icons/icon/heater.svg` | — | — |
| 网线/以太网 | Ethernet | `/oneplan-icons/icon/ethernet.svg` | — | — |
| 无线电塔 | Radio Tower | `/oneplan-icons/icon/radio-tower.svg` | — | — |
| 无障碍低矮过线垫 | ADA Low profile Cable Matting | — | `/oneplan-icons/scale-fg/ada-low-profile-cable-matting.svg` | `/oneplan-icons/scale-bg/ada-low-profile-cable-matting.svg` |
| 永久供电 | Permanent Power | `/oneplan-icons/icon/permanent-power.svg` | — | — |
| 油箱/燃料箱 | Fuel Cube | — | `/oneplan-icons/scale-fg/fuel-cube.svg` | `/oneplan-icons/scale-bg/fuel-cube.svg` |
| WiFi | WiFi | `/oneplan-icons/icon/wifi.svg` | — | — |

### 设施物料 / 餐饮 · Infrastructure / Food and Beverage

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 吧台 | Bar | `/oneplan-icons/icon/bar.svg` | — | — |
| 冰淇淋 | Ice cream | `/oneplan-icons/icon/ice-cream.svg` | — | — |
| 鸡尾酒吧 | Cocktail Bar | `/oneplan-icons/icon/cocktail-bar.svg` | — | — |
| 酒吧/葡萄酒吧 | Wine Bar | `/oneplan-icons/icon/wine-bar.svg` | — | — |
| 快餐 | Fast Food | `/oneplan-icons/icon/fast-food.svg` | — | — |
| 啤酒 | Beer | `/oneplan-icons/icon/beer.svg` | — | — |
| 起泡酒吧 | Prosecco Bar | `/oneplan-icons/icon/prosecco-bar.svg` | — | — |
| 曲奇/饼干 | Cookies | `/oneplan-icons/icon/cookies.svg` | — | — |
| 热饮 | Hot Drinks | `/oneplan-icons/icon/hot-drinks.svg` | — | — |
| 烧烤 | Barbeque | `/oneplan-icons/icon/barbeque.svg` | — | — |
| 市集摊位 | Market Stall | `/oneplan-icons/icon/market-stall.svg` | `/oneplan-icons/scale-fg/market-stall.svg` | `/oneplan-icons/scale-bg/market-stall.svg` |
| 糖果 | Candy | `/oneplan-icons/icon/candy.svg` | — | — |

### 设施物料 / 家具 · Infrastructure / Furniture

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 吧桌与长凳 | Bar Table and Bench | — | `/oneplan-icons/scale-fg/bar-table-and-bench.svg` | `/oneplan-icons/scale-bg/bar-table-and-bench.svg` |
| 草捆 | Hay bale | — | `/oneplan-icons/scale-fg/hay-bale.svg` | `/oneplan-icons/scale-bg/hay-bale.svg` |
| 懒人沙发 | Beanbag | — | `/oneplan-icons/scale-fg/beanbag.svg` | `/oneplan-icons/scale-bg/beanbag.svg` |
| 沙发 | Sofa | — | `/oneplan-icons/scale-fg/sofa.svg` | `/oneplan-icons/scale-bg/sofa.svg` |
| 托盘/卡板 | Pallet | — | `/oneplan-icons/scale-fg/pallet.svg` | `/oneplan-icons/scale-bg/pallet.svg` |
| 野餐桌 | Picnic Table | — | `/oneplan-icons/scale-fg/picnic-table.svg` | `/oneplan-icons/scale-bg/picnic-table.svg` |
| 椅子 | Chair | — | `/oneplan-icons/scale-fg/chair.svg` | `/oneplan-icons/scale-bg/chair.svg` |
| 圆桌 | Round Table | — | `/oneplan-icons/scale-fg/round-table.svg` | `/oneplan-icons/scale-bg/round-table.svg` |
| 圆桌与椅 | Round Table and Chairs | — | `/oneplan-icons/scale-fg/round-table-and-chairs.svg` | `/oneplan-icons/scale-bg/round-table-and-chairs.svg` |
| 长凳 | Bench | — | `/oneplan-icons/scale-fg/bench.svg` | `/oneplan-icons/scale-bg/bench.svg` |
| 折叠椅 | Folding Chair | — | `/oneplan-icons/scale-fg/folding-chair.svg` | `/oneplan-icons/scale-bg/folding-chair.svg` |
| 桌椅组合 | Table and Chairs | — | `/oneplan-icons/scale-fg/table-and-chairs.svg` | `/oneplan-icons/scale-bg/table-and-chairs.svg` |
| 桌子 | Table | — | `/oneplan-icons/scale-fg/table.svg` | `/oneplan-icons/scale-bg/table.svg` |

### 设施物料 / 地面与铺道板 · Infrastructure / Ground and Trackway

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 地面保护垫 | Ground Protection Mats | — | `/oneplan-icons/scale-fg/ground-protection-mats.svg` | `/oneplan-icons/scale-bg/ground-protection-mats.svg` |
| 混凝土墩 | Concrete Block | — | `/oneplan-icons/scale-fg/concrete-block.svg` | `/oneplan-icons/scale-bg/concrete-block.svg` |
| 金属铺道板 | Metal Trackway | — | `/oneplan-icons/scale-fg/metal-trackway.svg` | `/oneplan-icons/scale-bg/metal-trackway.svg` |
| 铝制铺道板 | Aluminum Trackway | — | `/oneplan-icons/scale-fg/aluminum-trackway.svg` | `/oneplan-icons/scale-bg/aluminum-trackway.svg` |
| 塑料铺道板 | Plastic Trackway | — | `/oneplan-icons/scale-fg/plastic-trackway.svg` | `/oneplan-icons/scale-bg/plastic-trackway.svg` |

### 设施物料 / 兴趣点/功能点 · Infrastructure / Points of Interest

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 充气城堡 | Bouncy castle | `/oneplan-icons/icon/bouncy-castle.svg` | — | — |
| 除颤仪 AED | Defibrillator | `/oneplan-icons/icon/defibrillator.svg` | — | — |
| 慈善 | Charity | `/oneplan-icons/icon/charity.svg` | — | — |
| 动物园 | Zoo | `/oneplan-icons/icon/zoo.svg` | — | — |
| 多信仰静室 | Multi faith room | `/oneplan-icons/icon/multi-faith-room.svg` | — | — |
| 福利/关怀点 | Welfare Point | `/oneplan-icons/icon/welfare-point.svg` | — | — |
| 复古展示 | Vintage display | `/oneplan-icons/icon/vintage-display.svg` | — | — |
| 公里标志 | KM Marker | `/oneplan-icons/icon/km-marker.svg` | — | — |
| 换轮站 | Wheel station | `/oneplan-icons/icon/wheel-station.svg` | — | — |
| 活动管理办公室 | Event Management Office | `/oneplan-icons/icon/event-management-office.svg` | — | — |
| 活动指挥中心 | Event Control | `/oneplan-icons/icon/event-control.svg` | — | — |
| 急救点 | First Aid Point | `/oneplan-icons/icon/first-aid-point.svg` | — | — |
| 计时点 | Timing Point | `/oneplan-icons/icon/timing-point.svg` | — | — |
| 嘉年华 | Carnival | `/oneplan-icons/icon/carnival.svg` | — | — |
| 奖牌点 | Medal | `/oneplan-icons/icon/medal.svg` | — | — |
| 领奖台 | Podium | `/oneplan-icons/icon/podium.svg` | — | — |
| 露营 | Camping | `/oneplan-icons/icon/camping.svg` | — | — |
| 绿植 | Plant | `/oneplan-icons/icon/plant.svg` | — | — |
| 拍照点 | Photo Point | `/oneplan-icons/icon/photo-point.svg` | — | — |
| 失物招领 | Lost Property | `/oneplan-icons/icon/lost-property.svg` | — | — |
| 手工艺 | Arts and crafts | `/oneplan-icons/icon/arts-and-crafts.svg` | — | — |
| 问询处 | Information Point | `/oneplan-icons/icon/information-point.svg` | — | — |
| 无障碍观景台 | Accessible Viewing Platform | `/oneplan-icons/icon/accessible-viewing-platform.svg` | — | — |
| 舞台 | Stage | `/oneplan-icons/icon/stage.svg` | `/oneplan-icons/scale-fg/stage.svg` | `/oneplan-icons/scale-bg/stage.svg` |
| 休息区 | Relax Zone | `/oneplan-icons/icon/relax-zone.svg` | — | — |
| 烟花 | Fireworks | `/oneplan-icons/icon/fireworks.svg` | — | — |
| 医院 | Hospital | `/oneplan-icons/icon/hospital.svg` | — | — |
| 影视/放映 | Film | `/oneplan-icons/icon/film.svg` | — | — |
| 周边商品 | Merchandise | `/oneplan-icons/icon/merchandise.svg` | — | — |
| 主题乐园 | Themepark | `/oneplan-icons/icon/themepark.svg` | — | — |
| 走失人员点 | Missing Persons Point | `/oneplan-icons/icon/missing-persons-point.svg` | — | — |
| ATM 取款机 | ATM | `/oneplan-icons/icon/atm.svg` | — | — |
| VIP | VIP | `/oneplan-icons/icon/vip.svg` | — | — |

### 设施物料 / 安全与安防 · Infrastructure / Safety and Security

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 360° 安防摄像头 | 360 Security Camera | `/oneplan-icons/icon/360-security-camera.svg` | — | — |
| 安检点 | Security Checkpoint | `/oneplan-icons/icon/security-checkpoint.svg` | — | — |
| 防撞柱 | Bollard | `/oneplan-icons/icon/bollard.svg` | — | — |
| 风险评估标记 | Risk assessment pin | `/oneplan-icons/icon/risk-assessment-pin.svg` | — | — |
| 监控摄像头 | CCTV Camera | `/oneplan-icons/icon/cctv-camera.svg` | — | — |
| 紧急出口 | Emergency Exit | `/oneplan-icons/icon/emergency-exit.svg` | — | — |
| 警察 | Police | `/oneplan-icons/icon/police.svg` | — | — |
| 灭火器 | Fire Extinguisher | `/oneplan-icons/icon/fire-extinguisher.svg` | — | — |
| 疏散集合点 | Evacuation Meeting Point | `/oneplan-icons/icon/evacuation-meeting-point.svg` | — | — |
| 消防瞭望塔 | Fire towers | `/oneplan-icons/icon/fire-towers.svg` | — | — |
| 消防栓 | Fire Hydrant | `/oneplan-icons/icon/fire-hydrant.svg` | — | — |
| 应急通道入口 | Emergency Access Point | `/oneplan-icons/icon/emergency-access-point.svg` | — | — |

### 设施物料 / 构筑物 · Infrastructure / Structures

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 充气拱门 | Inflatable Arch | — | `/oneplan-icons/scale-fg/inflatable-arch.svg` | `/oneplan-icons/scale-bg/inflatable-arch.svg` |
| 浮桥/趸船 | Pontoon | — | `/oneplan-icons/scale-fg/pontoon.svg` | `/oneplan-icons/scale-bg/pontoon.svg` |
| 桁架拱门 | Truss Arch | — | `/oneplan-icons/scale-fg/truss-arch.svg` | `/oneplan-icons/scale-bg/truss-arch.svg` |
| 集装箱 | Shipping Container | — | `/oneplan-icons/scale-fg/shipping-container.svg` | `/oneplan-icons/scale-bg/shipping-container.svg` |
| 脚手架塔 | Scaffold Tower | — | `/oneplan-icons/scale-fg/scaffold-tower.svg` | `/oneplan-icons/scale-bg/scaffold-tower.svg` |
| 快搭帐篷 | Pop-up Tent | — | `/oneplan-icons/scale-fg/pop-up-tent.svg` | `/oneplan-icons/scale-bg/pop-up-tent.svg` |
| 龙门架 | Gantry | — | `/oneplan-icons/scale-fg/gantry.svg` | `/oneplan-icons/scale-bg/gantry.svg` |
| 楼梯 | Stairs | — | `/oneplan-icons/scale-fg/stairs.svg` | `/oneplan-icons/scale-bg/stairs.svg` |
| 蒙古包 | Yurt | — | `/oneplan-icons/scale-fg/yurt.svg` | `/oneplan-icons/scale-bg/yurt.svg` |
| 木屋小屋 | Wooden Chalet | — | `/oneplan-icons/scale-fg/wooden-chalet.svg` | `/oneplan-icons/scale-bg/wooden-chalet.svg` |
| 坡道 | Ramp | — | `/oneplan-icons/scale-fg/ramp.svg` | `/oneplan-icons/scale-bg/ramp.svg` |
| 球员休息席/防空洞式掩体 | Dugout | — | `/oneplan-icons/scale-fg/dugout.svg` | `/oneplan-icons/scale-bg/dugout.svg` |
| 人行天桥 | Pedestrian Bridge | — | `/oneplan-icons/scale-fg/pedestrian-bridge.svg` | `/oneplan-icons/scale-bg/pedestrian-bridge.svg` |
| 帐篷 | Tent | — | `/oneplan-icons/scale-fg/tent.svg` | `/oneplan-icons/scale-bg/tent.svg` |
| 折返坡道 | Switch Back Ramp | — | `/oneplan-icons/scale-fg/switch-back-ramp.svg` | `/oneplan-icons/scale-bg/switch-back-ramp.svg` |
| 钟形帐篷 | Bell Tent | — | `/oneplan-icons/scale-fg/bell-tent.svg` | `/oneplan-icons/scale-bg/bell-tent.svg` |
| 转弯坡道 | Ramp Turning | — | `/oneplan-icons/scale-fg/ramp-turning.svg` | `/oneplan-icons/scale-bg/ramp-turning.svg` |
| 自行车架 | Bike Rack | — | `/oneplan-icons/scale-fg/bike-rack.svg` | `/oneplan-icons/scale-bg/bike-rack.svg` |

### 设施物料 / 卫生间 · Infrastructure / Toilets

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 母婴更衣台 | Baby Change | `/oneplan-icons/icon/baby-change.svg` | — | — |
| 卫生间（临时） | Toilets (Temporary) | `/oneplan-icons/icon/toilets-temporary.svg` | — | — |
| 卫生间（永久） | Toilets (Permanent) | `/oneplan-icons/icon/toilets-permanent.svg` | — | — |
| 无障碍更衣卫生间 | Changing Places Toilet | `/oneplan-icons/icon/changing-places-toilet.svg` | — | — |
| 无障碍卫生间 | Accessible Toilet | `/oneplan-icons/icon/accessible-toilet.svg` | — | — |
| 中性卫生间 | Gender neutral toilet | `/oneplan-icons/icon/gender-neutral-toilet.svg` | — | — |

### 设施物料 / 交通管理 · Infrastructure / Traffic Management

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 道路变窄 | Road Narrows | `/oneplan-icons/icon/road-narrows.svg` | — | — |
| 道路封闭 | Road Closed | — | `/oneplan-icons/scale-fg/road-closed.svg` | `/oneplan-icons/scale-bg/road-closed.svg` |
| 道路施工 | Roadworks | `/oneplan-icons/icon/roadworks.svg` | — | — |
| 分流/改道 | Diversion | — | `/oneplan-icons/scale-fg/diversion.svg` | `/oneplan-icons/scale-bg/diversion.svg` |
| 固定式可变情报板 | VMS Fixed | `/oneplan-icons/icon/vms-fixed.svg` | — | — |
| 国家限速 | National Speed Limit | `/oneplan-icons/icon/national-speed-limit.svg` | — | — |
| 合流 | Merge | `/oneplan-icons/icon/merge.svg` | — | — |
| 红绿灯 | Traffic Lights | `/oneplan-icons/icon/traffic-lights.svg` | — | — |
| 积水/洪水 | Flood | `/oneplan-icons/icon/flood.svg` | — | — |
| 减速带 | Bumps | `/oneplan-icons/icon/bumps.svg` | — | — |
| 禁止掉头 | No U-Turn | `/oneplan-icons/icon/no-u-turn.svg` | — | — |
| 禁止驶入 | No entry | `/oneplan-icons/icon/no-entry.svg` | `/oneplan-icons/scale-fg/no-entry.svg` | `/oneplan-icons/scale-bg/no-entry.svg` |
| 禁止停车 | No Parking | — | `/oneplan-icons/scale-fg/no-parking.svg` | `/oneplan-icons/scale-bg/no-parking.svg` |
| 路面湿滑 | Slippery | `/oneplan-icons/icon/slippery.svg` | — | — |
| 排队 | Queues | `/oneplan-icons/icon/queues.svg` | — | — |
| 前方道路封闭 | Road Ahead Closed | — | `/oneplan-icons/scale-fg/road-ahead-closed.svg` | `/oneplan-icons/scale-bg/road-ahead-closed.svg` |
| 前方红绿灯 | Traffic Lights Ahead | — | `/oneplan-icons/scale-fg/traffic-lights-ahead.svg` | `/oneplan-icons/scale-bg/traffic-lights-ahead.svg` |
| 请减速 | Reduce Speed Now | — | `/oneplan-icons/scale-fg/reduce-speed-now.svg` | `/oneplan-icons/scale-bg/reduce-speed-now.svg` |
| 绕行 | Detour | — | `/oneplan-icons/scale-fg/detour.svg` | `/oneplan-icons/scale-bg/detour.svg` |
| 人行过街点 | Crossing Point | `/oneplan-icons/icon/crossing-point.svg` | `/oneplan-icons/scale-fg/crossing-point.svg` | `/oneplan-icons/scale-bg/crossing-point.svg` |
| 手持停牌过街 | Lollypop crossing | `/oneplan-icons/icon/lollypop-crossing.svg` | — | — |
| 停车场关闭 | Car Park Closed | — | `/oneplan-icons/scale-fg/car-park-closed.svg` | `/oneplan-icons/scale-bg/car-park-closed.svg` |
| 停止 | Stop | `/oneplan-icons/icon/stop.svg` | — | — |
| 通行/Go | Go | `/oneplan-icons/icon/go.svg` | — | — |
| 危险 | Danger | — | `/oneplan-icons/scale-fg/danger.svg` | `/oneplan-icons/scale-bg/danger.svg` |
| 危险路段 | Hazard | `/oneplan-icons/icon/hazard.svg` | — | — |
| 违停拖移 | Towaway | `/oneplan-icons/icon/towaway.svg` | — | — |
| 移动式可变情报板 | VMS Mobile | `/oneplan-icons/icon/vms-mobile.svg` | — | — |
| 右转 | Turn Right | — | `/oneplan-icons/scale-fg/turn-right.svg` | `/oneplan-icons/scale-bg/turn-right.svg` |
| 直行 | Straight | — | `/oneplan-icons/scale-fg/straight.svg` | `/oneplan-icons/scale-bg/straight.svg` |
| 注意学生 | School Children | `/oneplan-icons/icon/school-children.svg` | — | — |
| 锥桶 | Cone | `/oneplan-icons/icon/cone.svg` | — | — |
| 左转 | Turn Left | — | `/oneplan-icons/scale-fg/turn-left.svg` | `/oneplan-icons/scale-bg/turn-left.svg` |

### 设施物料 / 交通接驳 · Infrastructure / Transport

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 出租车 | Taxi | `/oneplan-icons/icon/taxi.svg` | — | — |
| 船只 | Boat | `/oneplan-icons/icon/boat.svg` | — | — |
| 公交/大巴站 | Bus/Coach Station | `/oneplan-icons/icon/bus-coach-station.svg` | — | — |
| 公交站 | Bus Stop | `/oneplan-icons/icon/bus-stop.svg` | — | — |
| 火车站 | Train Station | `/oneplan-icons/icon/train-station.svg` | — | — |
| 机场 | Airport | `/oneplan-icons/icon/airport.svg` | — | — |
| 交通服务台 | Transport Desk | `/oneplan-icons/icon/transport-desk.svg` | — | — |
| 摩托车 | Motorbike | `/oneplan-icons/icon/motorbike.svg` | — | — |
| 停车 | Parking | `/oneplan-icons/icon/parking.svg` | — | — |
| 停车换乘 | Park and Ride | `/oneplan-icons/icon/park-and-ride.svg` | — | — |
| 有轨电车 | Tram | `/oneplan-icons/icon/tram.svg` | — | — |
| 直升机停机坪 | Helipad | `/oneplan-icons/icon/helipad.svg` | — | — |
| 装卸区 | Load Zone | `/oneplan-icons/icon/load-zone.svg` | — | — |
| 自行车停车 | Cycle Parking | `/oneplan-icons/icon/cycle-parking.svg` | — | — |

### 设施物料 / 车辆 · Infrastructure / Vehicles

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 餐饮拖车 | Food Trailer | — | `/oneplan-icons/scale-fg/food-trailer.svg` | `/oneplan-icons/scale-bg/food-trailer.svg` |
| 叉车 | Forklift | — | `/oneplan-icons/scale-fg/forklift.svg` | `/oneplan-icons/scale-bg/forklift.svg` |
| 大巴 | Coach | — | `/oneplan-icons/scale-fg/coach.svg` | `/oneplan-icons/scale-bg/coach.svg` |
| 大屏车 | Large Screen Truck | — | `/oneplan-icons/scale-fg/large-screen-truck.svg` | `/oneplan-icons/scale-bg/large-screen-truck.svg` |
| 房车 | Caravan | — | `/oneplan-icons/scale-fg/caravan.svg` | `/oneplan-icons/scale-bg/caravan.svg` |
| 封闭拖车 | Enclosed Trailer | — | `/oneplan-icons/scale-fg/enclosed-trailer.svg` | `/oneplan-icons/scale-bg/enclosed-trailer.svg` |
| 高尔夫球车 | Golf Cart | — | `/oneplan-icons/scale-fg/golf-cart.svg` | `/oneplan-icons/scale-bg/golf-cart.svg` |
| 活塞式飞机 | Piston Aircraft | — | `/oneplan-icons/scale-fg/piston-aircraft.svg` | `/oneplan-icons/scale-bg/piston-aircraft.svg` |
| 剪叉升降车 | Scissor lift | — | `/oneplan-icons/scale-fg/scissor-lift.svg` | `/oneplan-icons/scale-bg/scissor-lift.svg` |
| 轿车 | Car | — | `/oneplan-icons/scale-fg/car.svg` | `/oneplan-icons/scale-bg/car.svg` |
| 救护车 | Ambulance | — | `/oneplan-icons/scale-fg/ambulance.svg` | `/oneplan-icons/scale-bg/ambulance.svg` |
| 摩托车 | Motorcycle | — | `/oneplan-icons/scale-fg/motorcycle.svg` | `/oneplan-icons/scale-bg/motorcycle.svg` |
| 摩托艇 | Motor Boat | — | `/oneplan-icons/scale-fg/motor-boat.svg` | `/oneplan-icons/scale-bg/motor-boat.svg` |
| 皮卡 | Pickup Truck | — | `/oneplan-icons/scale-fg/pickup-truck.svg` | `/oneplan-icons/scale-bg/pickup-truck.svg` |
| 伸缩臂叉装车 | Telehandler | — | `/oneplan-icons/scale-fg/telehandler.svg` | `/oneplan-icons/scale-bg/telehandler.svg` |
| 特警车辆 | SWAT Police Vehicle | — | `/oneplan-icons/scale-fg/swat-police-vehicle.svg` | `/oneplan-icons/scale-bg/swat-police-vehicle.svg` |
| 拖拉机 | Tractor | — | `/oneplan-icons/scale-fg/tractor.svg` | `/oneplan-icons/scale-bg/tractor.svg` |
| 卫星转播车 | Satellite Van | — | `/oneplan-icons/scale-fg/satellite-van.svg` | `/oneplan-icons/scale-bg/satellite-van.svg` |
| 橡皮艇/小艇 | Dinghy | — | `/oneplan-icons/scale-fg/dinghy.svg` | `/oneplan-icons/scale-bg/dinghy.svg` |
| 直升机 | Helicopter | — | `/oneplan-icons/scale-fg/helicopter.svg` | `/oneplan-icons/scale-bg/helicopter.svg` |
| Spitfire 战机 | Spitfire Aircraft | — | `/oneplan-icons/scale-fg/spitfire-aircraft.svg` | `/oneplan-icons/scale-bg/spitfire-aircraft.svg` |

### 设施物料 / 垃圾与回收 · Infrastructure / Waste

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 垃圾与回收点 | Waste and Recycling Point | `/oneplan-icons/icon/waste-and-recycling-point.svg` | — | — |

### 设施物料 / 供水与卫生 · Infrastructure / Water and Sanitation

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 便携固定水箱 | Portable static tank | `/oneplan-icons/icon/portable-static-tank.svg` | — | — |
| 补水点 | Water Refill Point | `/oneplan-icons/icon/water-refill-point.svg` | — | — |
| 补水站 | Water Refill Station | — | `/oneplan-icons/scale-fg/water-refill-station.svg` | `/oneplan-icons/scale-bg/water-refill-station.svg` |
| 浮标 | Buoy | `/oneplan-icons/icon/buoy.svg` | — | — |
| 供水接口 | Water connection point | `/oneplan-icons/icon/water-connection-point.svg` | — | — |
| 救生冲浪板 | Lifeguard Surfboard | `/oneplan-icons/icon/lifeguard-surfboard.svg` | — | — |
| 救生摩托艇 | Lifeguard jet ski | `/oneplan-icons/icon/lifeguard-jet-ski.svg` | — | — |
| 救生皮划艇 | Lifeguard Kayak | `/oneplan-icons/icon/lifeguard-kayak.svg` | — | — |
| 救生圈 | Liferaft Ring | `/oneplan-icons/icon/liferaft-ring.svg` | — | — |
| 淋浴 | Shower | `/oneplan-icons/icon/shower.svg` | — | — |
| 皮划艇 | Kayak | `/oneplan-icons/icon/kayak.svg` | — | — |
| 潜水装备 | Scuba | `/oneplan-icons/icon/scuba.svg` | — | — |
| 水泵 | Water pump | `/oneplan-icons/icon/water-pump.svg` | — | — |
| 水槽 | Sink | `/oneplan-icons/icon/sink.svg` | — | — |
| 洗手站 | Hand wash station | `/oneplan-icons/icon/hand-wash-station.svg` | — | — |
| 医疗船 | Medical Boat | `/oneplan-icons/icon/medical-boat.svg` | — | — |
| 饮水补给站 | Drinks station | `/oneplan-icons/icon/drinks-station.svg` | — | — |
| 饮水喷泉 | Water Fountain | `/oneplan-icons/icon/water-fountain.svg` | — | — |

### 物件库扩展包 / 冬季两项活动包 · Object library packs / Biathlon pack

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 靶标控制 | Targets Control | — | `/oneplan-icons/scale-fg/targets-control.svg` | `/oneplan-icons/scale-bg/targets-control.svg` |
| 队伍打蜡车 | Team Wax Truck | — | `/oneplan-icons/scale-fg/team-wax-truck.svg` | `/oneplan-icons/scale-bg/team-wax-truck.svg` |
| 更衣室 | Changing Room | `/oneplan-icons/icon/changing-room.svg` | — | — |
| 滑雪急救员 | Ski Paramedic | `/oneplan-icons/icon/ski-paramedic.svg` | — | — |
| 滑雪摄像 | Ski Cameras | `/oneplan-icons/icon/ski-cameras.svg` | — | — |
| 局域网插座 | Lan Socket | `/oneplan-icons/icon/lan-socket.svg` | — | — |
| 赛道交叉口 A | Course Crossroad A | — | `/oneplan-icons/scale-fg/course-crossroad-a.svg` | `/oneplan-icons/scale-bg/course-crossroad-a.svg` |
| 赛道交叉口 B | Course Crossroad B | — | `/oneplan-icons/scale-fg/course-crossroad-b.svg` | `/oneplan-icons/scale-bg/course-crossroad-b.svg` |
| 射击枪架 | Shooting Racks | `/oneplan-icons/icon/shooting-racks.svg` | — | — |
| 水池 | Water Pool | `/oneplan-icons/icon/water-pool.svg` | — | — |
| 隧道出入口 | Tunnel Entry/Exit | `/oneplan-icons/icon/tunnel-entry-exit.svg` | — | — |
| HB 转播车 | HB Van | — | `/oneplan-icons/scale-fg/hb-van.svg` | `/oneplan-icons/scale-bg/hb-van.svg` |
| OB 转播车 | OB Truck | — | `/oneplan-icons/scale-fg/ob-truck.svg` | `/oneplan-icons/scale-bg/ob-truck.svg` |
| P1 | P1 | `/oneplan-icons/icon/p1.svg` | — | — |
| P2 | P2 | `/oneplan-icons/icon/p2.svg` | — | — |
| P3 | P3 | `/oneplan-icons/icon/p3.svg` | — | — |
| P4 | P4 | `/oneplan-icons/icon/p4.svg` | — | — |

### 物件库扩展包 / 圣诞活动包 · Object library packs / Christmas pack

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 冰雕 | Ice Sculpture | `/oneplan-icons/icon/ice-sculpture.svg` | — | — |
| 充气圣诞老人 | Inflatable Santa | `/oneplan-icons/icon/inflatable-santa.svg` | — | — |
| 德式香肠 | Bratwurst | `/oneplan-icons/icon/bratwurst.svg` | — | — |
| 篝火坑 | Fire Pit | `/oneplan-icons/icon/fire-pit.svg` | — | — |
| 滑冰 | Ice Skating | `/oneplan-icons/icon/ice-skating.svg` | — | — |
| 滑梯 | Slide | `/oneplan-icons/icon/slide.svg` | — | — |
| 滑雪橇 | Sledding | `/oneplan-icons/icon/sledding.svg` | — | — |
| 火锅/芝士火锅 | Fondue | `/oneplan-icons/icon/fondue.svg` | — | — |
| 精灵 | Elf | `/oneplan-icons/icon/elf.svg` | — | — |
| 烤栗子 | Roasted Chestnuts | `/oneplan-icons/icon/roasted-chestnuts.svg` | — | — |
| 礼品 | Gifts | `/oneplan-icons/icon/gifts.svg` | — | — |
| 摩天轮 | Ferris Wheel | — | `/oneplan-icons/scale-fg/ferris-wheel.svg` | `/oneplan-icons/scale-bg/ferris-wheel.svg` |
| 木制驯鹿 Rudolf | Wooden Rudolf | `/oneplan-icons/icon/wooden-rudolf.svg` | — | — |
| 取暖穹顶 | Warming Dome | `/oneplan-icons/icon/warming-dome.svg` | — | — |
| 热红酒 | Mulled Wine | `/oneplan-icons/icon/mulled-wine.svg` | — | — |
| 热巧克力 | Hot Chocolate | `/oneplan-icons/icon/hot-chocolate.svg` | — | — |
| 圣诞花环 | Christmas Garland | `/oneplan-icons/icon/christmas-garland.svg` | — | — |
| 圣诞树 | Christmas tree | `/oneplan-icons/icon/christmas-tree.svg` | — | — |
| 糖渍水果 | Candied Fruits | `/oneplan-icons/icon/candied-fruits.svg` | — | — |
| 星星 | Star | `/oneplan-icons/icon/star.svg` | — | — |
| 耶稣诞生场景 | Nativity Scene | `/oneplan-icons/icon/nativity-scene.svg` | — | — |
| Crokicurl | Crokicurl | `/oneplan-icons/icon/crokicurl.svg` | — | — |

### 物件库扩展包 / 板球活动包 · Object library packs / Cricket pack

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 备用三柱门 | Alternate Wickets | — | `/oneplan-icons/scale-fg/alternate-wickets.svg` | `/oneplan-icons/scale-bg/alternate-wickets.svg` |
| 边界计算器（男） | Boundary Calculator Men | — | `/oneplan-icons/scale-fg/boundary-calculator-men.svg` | `/oneplan-icons/scale-bg/boundary-calculator-men.svg` |
| 边界计算器（女） | Boundary Calculator Women | — | `/oneplan-icons/scale-fg/boundary-calculator-women.svg` | `/oneplan-icons/scale-bg/boundary-calculator-women.svg` |
| 滑垒机位 | Slips | `/oneplan-icons/icon/slips.svg` | — | — |
| 回放大屏 | Replay Screen | `/oneplan-icons/icon/replay-screen.svg` | — | — |
| 轻型压路机 | Light roller | — | `/oneplan-icons/scale-fg/light-roller.svg` | `/oneplan-icons/scale-bg/light-roller.svg` |
| 三柱门罩布 | Wicket Covers | — | `/oneplan-icons/scale-fg/wicket-covers.svg` | `/oneplan-icons/scale-bg/wicket-covers.svg` |
| 视线挡板 | Sight Screen | — | `/oneplan-icons/scale-fg/sight-screen.svg` | `/oneplan-icons/scale-bg/sight-screen.svg` |
| 训练三柱门 | Training Wickets | — | `/oneplan-icons/scale-fg/training-wickets.svg` | `/oneplan-icons/scale-bg/training-wickets.svg` |
| 婴儿车存放 | Stroller Storage | `/oneplan-icons/icon/stroller-storage.svg` | — | — |
| 重型压路机 | Heavy Roller | — | `/oneplan-icons/scale-fg/heavy-roller.svg` | `/oneplan-icons/scale-bg/heavy-roller.svg` |

### 物件库扩展包 / 集市·展会·市集包 · Object library packs / Fairs, Shows & Markets pack

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 蹦极蹦床 | Bungee Trampoline | — | `/oneplan-icons/scale-fg/bungee-trampoline.svg` | `/oneplan-icons/scale-bg/bungee-trampoline.svg` |
| 飞碟射击 | Clay Pigeon Shooting | `/oneplan-icons/icon/clay-pigeon-shooting.svg` | — | — |
| 花卉园艺 | Floriculture | `/oneplan-icons/icon/floriculture.svg` | — | — |
| 镜子迷宫 | Mirror Maze | `/oneplan-icons/icon/mirror-maze.svg` | — | — |
| 捞鸭游戏摊 | Duck Pond Booth | `/oneplan-icons/icon/duck-pond-booth.svg` | — | — |
| 犁地表演 | Ploughing | `/oneplan-icons/icon/ploughing.svg` | — | — |
| 毛绒玩具 | Stuffed Toys | `/oneplan-icons/icon/stuffed-toys.svg` | — | — |
| 牛奶瓶投掷游戏 | Milk Bottle Toss | `/oneplan-icons/icon/milk-bottle-toss.svg` | — | — |
| 牛仔餐车 | Chuck Wagon | `/oneplan-icons/icon/chuck-wagon.svg` | — | — |
| 牛仔竞技小丑 | Rodeo Clown | `/oneplan-icons/icon/rodeo-clown.svg` | — | — |
| 农业竞赛 | Agricultural Competition | `/oneplan-icons/icon/agricultural-competition.svg` | — | — |
| 骑牛 | Bull Riding | `/oneplan-icons/icon/bull-riding.svg` | — | — |
| 气球 | Balloons | `/oneplan-icons/icon/balloons.svg` | — | — |
| 青年农夫俱乐部 | Young Farmers Club | `/oneplan-icons/icon/young-farmers-club.svg` | — | — |
| 绕桶赛马 | Barrel Racing | `/oneplan-icons/icon/barrel-racing.svg` | — | — |
| 赛马 | Horse Racing | `/oneplan-icons/icon/horse-racing.svg` | — | — |
| 伞兵游乐设施 | Paratrooper | — | `/oneplan-icons/scale-fg/paratrooper.svg` | `/oneplan-icons/scale-bg/paratrooper.svg` |
| 手杖工匠行会 | Stickmakers Guild | `/oneplan-icons/icon/stickmakers-guild.svg` | — | — |
| 树篱修剪技艺 | Hedgelaying | `/oneplan-icons/icon/hedgelaying.svg` | — | — |
| 套圈 | Ring Toss | `/oneplan-icons/icon/ring-toss.svg` | — | — |
| 挽马 | Draft Horses | `/oneplan-icons/icon/draft-horses.svg` | — | — |
| 旋转飞椅 | Chair-O-Planes | — | `/oneplan-icons/scale-fg/chair-o-planes.svg` | `/oneplan-icons/scale-bg/chair-o-planes.svg` |
| 旋转木马 | Carousel | — | `/oneplan-icons/scale-fg/carousel.svg` | `/oneplan-icons/scale-bg/carousel.svg` |
| 园艺 | Horticulture | `/oneplan-icons/icon/horticulture.svg` | — | — |

### 物件库扩展包 / 路跑/铁人三项活动包 · Object library packs / Race pack

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 5 公里 | 5km | — | `/oneplan-icons/scale-fg/5km.svg` | `/oneplan-icons/scale-bg/5km.svg` |
| 补给站 | Feed Station | `/oneplan-icons/icon/feed-station.svg` | — | — |
| 补给站-电解质 | Aid Station - Electrolyte | `/oneplan-icons/icon/aid-station-electrolyte.svg` | — | — |
| 补给站（200m） | Aid Station 200m | — | `/oneplan-icons/scale-fg/aid-station-200m.svg` | `/oneplan-icons/scale-bg/aid-station-200m.svg` |
| 打气筒投放点 | Bike Pump Drop Off | `/oneplan-icons/icon/bike-pump-drop-off.svg` | — | — |
| 电视转播船 | TV Boat | `/oneplan-icons/icon/tv-boat.svg` | — | — |
| 罚时区 | Penalty Box | `/oneplan-icons/icon/penalty-box.svg` | — | — |
| 罚时区（200m） | Penalty Box 200m | — | `/oneplan-icons/scale-fg/penalty-box-200m.svg` | `/oneplan-icons/scale-bg/penalty-box-200m.svg` |
| 混合接力区 | Mixed Relay Zone | `/oneplan-icons/icon/mixed-relay-zone.svg` | — | — |
| 急救摩托车 | Paramedic Motorbike | `/oneplan-icons/icon/paramedic-motorbike.svg` | — | — |
| 计时赛坡道 | Time Trial Ramp | — | `/oneplan-icons/scale-fg/time-trial-ramp.svg` | `/oneplan-icons/scale-bg/time-trial-ramp.svg` |
| 接力交接 | Relay Handover | `/oneplan-icons/icon/relay-handover.svg` | — | — |
| 禁止跟骑起点 | No Draft Start | — | `/oneplan-icons/scale-fg/no-draft-start.svg` | `/oneplan-icons/scale-bg/no-draft-start.svg` |
| 禁止跟骑终点 | No Draft End | — | `/oneplan-icons/scale-fg/no-draft-end.svg` | `/oneplan-icons/scale-bg/no-draft-end.svg` |
| 禁止气动姿势起点 | No Aero Start | — | `/oneplan-icons/scale-fg/no-aero-start.svg` | `/oneplan-icons/scale-bg/no-aero-start.svg` |
| 禁止气动姿势终点 | No Aero End | — | `/oneplan-icons/scale-fg/no-aero-end.svg` | `/oneplan-icons/scale-bg/no-aero-end.svg` |
| 可扔垃圾区起点 | Littering Start | — | `/oneplan-icons/scale-fg/littering-start.svg` | `/oneplan-icons/scale-bg/littering-start.svg` |
| 可扔垃圾区终点 | Littering End | — | `/oneplan-icons/scale-fg/littering-end.svg` | `/oneplan-icons/scale-bg/littering-end.svg` |
| 跑步出口 | Run Out | `/oneplan-icons/icon/run-out.svg` | — | — |
| 骑行出口 | Bike Out | `/oneplan-icons/icon/bike-out.svg` | — | — |
| 骑行入口 | Bike In | `/oneplan-icons/icon/bike-in.svg` | — | — |
| 涉水穿越 | Water Crossing | — | `/oneplan-icons/scale-fg/water-crossing.svg` | `/oneplan-icons/scale-bg/water-crossing.svg` |
| 特殊需求区 | Special Needs | — | `/oneplan-icons/scale-fg/special-needs.svg` | `/oneplan-icons/scale-bg/special-needs.svg` |
| 维修点 | Repair | — | `/oneplan-icons/scale-fg/repair.svg` | `/oneplan-icons/scale-bg/repair.svg` |
| 维修点（200m） | Repair 200m | — | `/oneplan-icons/scale-fg/repair-200m.svg` | `/oneplan-icons/scale-bg/repair-200m.svg` |
| 游泳出口 | Swim out | `/oneplan-icons/icon/swim-out.svg` | — | — |
| 游泳入口 | Swim in | `/oneplan-icons/icon/swim-in.svg` | — | — |
| 游泳疏散点 | Swim Evacuation Point | `/oneplan-icons/icon/swim-evacuation-point.svg` | — | — |
| 终点 | Finish | — | `/oneplan-icons/scale-fg/finish.svg` | `/oneplan-icons/scale-bg/finish.svg` |
| 转换区 | Transition Zone | `/oneplan-icons/icon/transition-zone.svg` | — | — |
| 自行车技师 | Bike Mechanic | `/oneplan-icons/icon/bike-mechanic.svg` | — | — |

### 图元与底衬 · Primitives

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 等边三角形底面 | Equilateral triangle footprint | — | `/oneplan-icons/scale-fg/triangle-equilateral.svg` | `/oneplan-icons/scale-bg/triangle-equilateral.svg` |
| 叠加图层 | Overlay image | `/oneplan-icons/icon/overlayimage.svg` | — | — |
| 动线·点线 | Route — dotted line | `/oneplan-icons/icon/route-dot.svg` | — | — |
| 动线·实线 | Route — solid line | `/oneplan-icons/icon/route-solid.svg` | — | — |
| 动线·虚线 | Route — dashed line | `/oneplan-icons/icon/route-dash.svg` | — | — |
| 方格矩形底 | Chequered rectangle | — | `/oneplan-icons/scale-fg/chequered-rect.svg` | `/oneplan-icons/scale-bg/chequered-rect.svg` |
| 方格圆底 | Chequered circle | — | `/oneplan-icons/scale-fg/chequered-circ.svg` | `/oneplan-icons/scale-bg/chequered-circ.svg` |
| 矩形底面 | Rectangle footprint | — | `/oneplan-icons/scale-fg/rectangle.svg` | `/oneplan-icons/scale-bg/rectangle.svg` |
| 三角形底面 | Triangle footprint | — | `/oneplan-icons/scale-fg/triangle.svg` | `/oneplan-icons/scale-bg/triangle.svg` |
| 透明底衬 | Transparent sticker base | `/oneplan-icons/icon/transparent.svg` | — | — |
| 椭圆底面 | Ellipse footprint | — | `/oneplan-icons/scale-fg/ellipse.svg` | `/oneplan-icons/scale-bg/ellipse.svg` |
| 文本框 | Text box | `/oneplan-icons/icon/textbox.svg` | — | — |
| 圆点底衬 | Circle sticker base | `/oneplan-icons/icon/circle.svg` | — | — |

### 设施与构筑物 · Structures & Facilities

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 便携舱房 | Portable cabin | — | `/oneplan-icons/scale-fg/portable-cabin.svg` | `/oneplan-icons/scale-bg/portable-cabin.svg` |
| 便携厕所 | Portable toilet | — | `/oneplan-icons/scale-fg/portable-toilet.svg` | `/oneplan-icons/scale-bg/portable-toilet.svg` |
| 大型垃圾箱 | Large waste container | — | `/oneplan-icons/scale-fg/large-waste-container.svg` | `/oneplan-icons/scale-bg/large-waste-container.svg` |
| 观景平台 | Viewing platform | — | `/oneplan-icons/scale-fg/viewing-platform.svg` | `/oneplan-icons/scale-bg/viewing-platform.svg` |
| 垃圾桶 | Waste container | `/oneplan-icons/icon/waste-container.svg` | — | — |
| 拉伸棚 | Stretch tent | — | `/oneplan-icons/scale-fg/stretch-tent.svg` | `/oneplan-icons/scale-bg/stretch-tent.svg` |
| 男用小便舱 | Men's urinal pod | — | `/oneplan-icons/scale-fg/mens-urinal-pod.svg` | `/oneplan-icons/scale-bg/mens-urinal-pod.svg` |
| 沙滩躺椅 | Deck chair | — | `/oneplan-icons/scale-fg/deck-chair.svg` | `/oneplan-icons/scale-bg/deck-chair.svg` |
| 射击场 | Shooting range | — | `/oneplan-icons/scale-fg/shooting-range.svg` | `/oneplan-icons/scale-bg/shooting-range.svg` |
| 食品摊贩 | Food trader | `/oneplan-icons/icon/food-trader.svg` | — | — |
| 无障碍便携厕所 | Accessible portable toilet | — | `/oneplan-icons/scale-fg/accessible-portable-toilet.svg` | `/oneplan-icons/scale-bg/accessible-portable-toilet.svg` |
| 照明塔（固定） | Lighting tower (permanent) | `/oneplan-icons/icon/permanent-lighting-tower.svg` | — | — |
| 照明塔（临时） | Lighting tower (temporary) | `/oneplan-icons/icon/temporary-lighting-tower.svg` | — | — |
| 指示牌架·双面 | Signage frame — 2 sides | — | `/oneplan-icons/scale-fg/signage-frame-2.svg` | `/oneplan-icons/scale-bg/signage-frame-2.svg` |
| 指示牌架·四面 | Signage frame — 4 sides | — | `/oneplan-icons/scale-fg/signage-frame-4.svg` | `/oneplan-icons/scale-bg/signage-frame-4.svg` |

### 车辆与拖车 · Vehicles & Trailers

| 中文名 | English | icon | scale-fg | scale-bg |
| --- | --- | --- | --- | --- |
| 巴士 | Bus | — | `/oneplan-icons/scale-fg/bus.svg` | `/oneplan-icons/scale-bg/bus.svg` |
| 巴士（斜置） | Bus (rotated) | — | `/oneplan-icons/scale-fg/bus-rotated.svg` | `/oneplan-icons/scale-bg/bus-rotated.svg` |
| 厕所拖车 | Toilet trailer | — | `/oneplan-icons/scale-fg/toilet-trailer.svg` | `/oneplan-icons/scale-bg/toilet-trailer.svg` |
| 大屏转播车（斜置） | Large screen truck (rotated) | — | `/oneplan-icons/scale-fg/large-screen-truck-rotated.svg` | `/oneplan-icons/scale-bg/large-screen-truck-rotated.svg` |
| 高尔夫球车（斜置） | Golf cart (rotated) | — | `/oneplan-icons/scale-fg/golf-cart-rotated.svg` | `/oneplan-icons/scale-bg/golf-cart-rotated.svg` |
| 轿车（斜置） | Car (rotated) | — | `/oneplan-icons/scale-fg/car-rotated.svg` | `/oneplan-icons/scale-bg/car-rotated.svg` |
| 警车 | Police car | — | `/oneplan-icons/scale-fg/police-car.svg` | `/oneplan-icons/scale-bg/police-car.svg` |
| 警车（斜置） | Police car (rotated) | — | `/oneplan-icons/scale-fg/police-car-rotated.svg` | `/oneplan-icons/scale-bg/police-car-rotated.svg` |
| 救护车（斜置） | Ambulance (rotated) | — | `/oneplan-icons/scale-fg/ambulance-rotated.svg` | `/oneplan-icons/scale-bg/ambulance-rotated.svg` |
| 食品拖车（斜置） | Food trailer (rotated) | — | `/oneplan-icons/scale-fg/food-trailer-rotated.svg` | `/oneplan-icons/scale-bg/food-trailer-rotated.svg` |
| 厢式货车 | Van | — | `/oneplan-icons/scale-fg/van.svg` | `/oneplan-icons/scale-bg/van.svg` |
| 厢式货车（斜置） | Van (rotated) | — | `/oneplan-icons/scale-fg/van-rotated.svg` | `/oneplan-icons/scale-bg/van-rotated.svg` |
| 消防车 | Fire engine | — | `/oneplan-icons/scale-fg/fire-engine.svg` | `/oneplan-icons/scale-bg/fire-engine.svg` |
| 消防车（斜置） | Fire engine (rotated) | — | `/oneplan-icons/scale-fg/fire-engine-rotated.svg` | `/oneplan-icons/scale-bg/fire-engine-rotated.svg` |
| 重型货车 | HGV / semi-truck | — | `/oneplan-icons/scale-fg/hgv.svg` | `/oneplan-icons/scale-bg/hgv.svg` |
| 重型货车（斜置） | HGV (rotated) | — | `/oneplan-icons/scale-fg/hgv-rotated.svg` | `/oneplan-icons/scale-bg/hgv-rotated.svg` |
| 转播车 | Outside broadcast truck | — | `/oneplan-icons/scale-fg/outside-broadcast-truck.svg` | `/oneplan-icons/scale-bg/outside-broadcast-truck.svg` |

## 附录：CDN 上没有同名文件的物件名（109）

| 中文名 | English | 分类 / 扩展包 |
| --- | --- | --- |
| 露营区 | Camping Area | Areas |
| 人群聚集区 | Crowd Area | Areas |
| 通用区域 | Generic Area | Areas |
| 停车区 | Parking Area | Areas |
| 步行流线 | Pedestrian Route | Routes |
| 车辆流线 | Vehicle Route | Routes |
| 锥桶线 | Cone Line | Barriers |
| 人群管制护栏 | Crowd Control Barrier | Barriers |
| 舞台前护栏 | Front of Stage Barrier | Barriers |
| 高围挡 | High Perimeter Fence | Barriers |
| 网状围栏 | Mesh Fence | Barriers |
| 双面导视架 | Signage Frame 2 Sides | Branding and Signage |
| 四面导视架 | Signage Frame 4 Sides | Branding and Signage |
| 照明塔（永久） | Lighting Tower (Permanent) | Electrical |
| 照明塔（临时） | Lighting Tower (Temporary) | Electrical |
| 食品摊位 | Food Vendor | Food and Beverage |
| 沙滩椅 | Beach Chair | Furniture |
| 无障碍观景台（ADA） | ADA Viewing Platform | Structures |
| 篷顶帐篷 | Canopy Tent | Structures |
| 办公拖车房 | Office Trailer | Structures |
| ADA 无障碍卫生间 | ADA Restroom | Toilets |
| 男厕小便池 | Men's Urinal | Toilets |
| 移动卫生间 | Portable Restroom | Toilets |
| 卫生间拖车 | Restroom Trailer | Toilets |
| 转播车 | Broadcast Truck | Vehicles |
| 货运面包车 | Cargo Van | Vehicles |
| 城市公交 | City Bus | Vehicles |
| 消防车 | Fire Truck | Vehicles |
| 巡逻警车 | Police Patrol Car | Vehicles |
| 半挂卡车 | Semi-Truck | Vehicles |
| 大型垃圾箱 | Dumpster | Waste |
| 垃圾桶 | Trash | Waste |
| 自定义点位 | Custom Dot | Workforce |
| 消防人员 | Fire | Workforce |
| 经理/负责人 | Manager | Workforce |
| 医护人员 | Medical | Workforce |
| 安保 | Security | Workforce |
| 场务 | Steward | Workforce |
| 主管 | Supervisor | Workforce |
| 志愿者 | Volunteer | Workforce |
| 证件认证经理 | Accreditation Manager | Cricket pack |
| 边界广告/LED | Boundary Advertising/LEDS | Cricket pack |
| 边界绳与三角墩 | Boundary Rope and Toblerones | Cricket pack |
| 转播经理 | Broadcast Manager | Cricket pack |
| 板球运营经理 | Cricket Operations Manager | Cricket pack |
| DJ | DJ | Cricket pack |
| 反兴奋剂官 | Doping Control Officer | Cricket pack |
| 赛场通道 | Field of Play Access | Cricket pack |
| 泛光灯 | Flood Light | Cricket pack |
| 场地管理员 | Groundsperson | Cricket pack |
| High 45 机位 | High 45 | Cricket pack |
| 接待经理 | Hospitality Manager | Cricket pack |
| LED 操作员 | LED Operator | Cricket pack |
| 赛事裁判官员 | Match Officials | Cricket pack |
| 媒体 | Media | Cricket pack |
| 媒体运营经理 | Media Operations Manager | Cricket pack |
| 中路反向三柱门机位 | Mid Reverse Wicket | Cricket pack |
| 中路三柱门机位 | Mid Wicket | Cricket pack |
| 网前投球手位 | Net Bowler | Cricket pack |
| 围界护栏 | Perimeter Fence | Cricket pack |
| 球员与裁判官员 | Player & Match Officials | Cricket pack |
| 记者席记分员 | Press Box Scorer | Cricket pack |
| 反向滑垒机位 | Reverse Slips | Cricket pack |
| 游动机位 | Roaming | Cricket pack |
| 记分牌操作员 | Scoreboard Operator | Cricket pack |
| 观众服务 | Spectator Services | Cricket pack |
| 赞助经理 | Sponsorship Manager | Cricket pack |
| 三柱门摄像头 | Stump Cam | Cricket pack |
| 出租车上下客区 | Taxi Loadzone | Cricket pack |
| 超高速摄影 | Ultra Motion | Cricket pack |
| 门禁控制 | Access Control | Biathlon pack |
| 车辆主入口 | Access Point Vehicle Main | Biathlon pack |
| 车辆次入口 | Access Point Vehicle Secondary | Biathlon pack |
| AED 除颤仪 | AED Defibrillator | Biathlon pack |
| 证件扫描 | Badge Scanning | Biathlon pack |
| 摄像摇臂（左） | Camera Crane Left | Biathlon pack |
| 摄像摇臂（右） | Camera Crane Right | Biathlon pack |
| 反兴奋剂检查 | Doping Control | Biathlon pack |
| 电缆 | Electrical Cable | Biathlon pack |
| 终点线 | Finish Line | Biathlon pack |
| 赛道中间点 | Intermediate on Course | Biathlon pack |
| LED 屏 | LED Screen | Biathlon pack |
| 急救员 | Paramedic | Biathlon pack |
| 电力点 | Power | Biathlon pack |
| 裁判 | Referee | Biathlon pack |
| 搭建/布置点 | Setup | Biathlon pack |
| 射击靶场（含安全区） | Shooting Range (Inc Safety Zone) | Biathlon pack |
| 起跑线 | Start Line | Biathlon pack |
| 电视三脚架（左） | TV Tripod Left | Biathlon pack |
| 电视三脚架（右） | TV Tripod Right | Biathlon pack |
| 目视检查点 | Visual Check | Biathlon pack |
| 康科德护栏 | Barrier Concord | Race pack |
| 骑行赛道 | Bike Course | Race pack |
| 自行车架（双面） | Bike Racks: Double-sided | Race pack |
| 自行车架（单面） | Bike Racks: Single-sided | Race pack |
| 下车区 | Dismount Area | Race pack |
| 下车线 | Dismount Line | Race pack |
| 上车区 | Mount Area | Race pack |
| 上车线 | Mount Line | Race pack |
| 别针与胶带 | Pin And Tape | Race pack |
| 跑步赛道 | Run Course | Race pack |
| 游泳赛道 | Swim Course | Race pack |
| 计时毯 | Timing Mat | Race pack |
| 转换区车架（双面） | Transition racks: Double-sided | Race pack |
| 转换区车架（单面） | Transition racks: Single-sided | Race pack |
| 维保 | Maintenance | Fairs, Shows & Markets pack |
| 表演者 | Performer | Fairs, Shows & Markets pack |
| 交通指挥员 | Traffic Marshall | Fairs, Shows & Markets pack |
| 摊主/商贩 | Vendor Seller | Fairs, Shows & Markets pack |
