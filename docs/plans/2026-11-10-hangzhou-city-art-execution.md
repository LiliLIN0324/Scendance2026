# 杭州真实结构与等距城市画风执行计划

2026-11-07。目标：参考 Isometric SF，以杭州真实地理结构制作精细等距城市地图；首轮只验收西湖东岸样区。原二维滤镜和 city3d 白模均不是视觉交付。

## 范围与基线
- 样区 WGS84：120.149–120.163 E、30.245–30.258 N；地形背景先取 120.06–120.18 E、30.17–30.28 N。
- 数据和产物：D:/Scendance2026/hangzhou-map-lab；仓库保存计划、状态及可复现脚本说明。保留现有主产品与原型。
- 已有：卫星图约 4 m/px；291 栋建筑（仅 2 栋有高度/层数标签）；61 个绿地面（只解析闭合 way，尚未重建 relation）。
- 固定视角插画瓦片与自由旋转三维模型分开验收；AI 补全不能标为实测。

## 顺序、交付物与验收
1. **输入来源核查（执行中）**：核查 Google Photorealistic 3D Tiles 的杭州覆盖、可用性及接入条件；评估公开倾斜摄影、自采 AHOLO 资产。记录官方证据，不把全球覆盖宣传视为杭州可用的证明。若无法确认覆盖，进入多源结构路线。
2. **地形与绿地（执行中）**：按样区裁剪 Copernicus GLO-30 DSM 和 ESA WorldCover 2021 10 m 分类；保存 GeoTIFF、范围、CRS、分辨率、nodata、min/max、来源。核对山体、湖面、城市的地类。DSM 含树冠及建筑，不等同裸地 DTM，不直接用于楼基叠高。绿地边界优先 OSM，栅格补覆盖；单树位置无来源时只作示意。
3. **建筑与高度**：对比 OSM、Overture 与研究数据的样区覆盖，统计有效高度比例和分布。GlobalBuildingAtlas 有非商业限制的高度/LoD1 部分，仅记录研究候选，不能直接并入产品。保留 observed/levels-derived/model-estimated/default 四类来源；缺值保持缺值。
4. **影像质量**：检查可合法获取的高分辨率正射或三维渲染输入，选同一区域对比真实细节；瓦片放大不算提升分辨率。保存采集日期、实际分辨率和可用范围。
5. **真实结构渲染**：统一 WGS84→GCJ-02 边界与米制空间，固定相机输出原始卫星、建筑轮廓、地形及地类叠加的对照。至少 3 个控制点和一段距离，报告残差；地形高程基准与相对楼高分别记录。
6. **精细风格样板**：结构通过后再生成同视角城市插画，补屋顶、立面、树冠、道路和阴影；比较原图、结构图、风格图，检查道路/岸线/地标漂移。上一轮待返回的生成只作为艺术试验。
7. **瓦片与接入**：样板视觉通过后做 2×2 拼接、两级缩放、边缘/色彩一致性和定位；再通过 manifest 接入 Scendance，保持场地锚点。独立仓库发布和全杭州扩展后置。

## 本轮完成条件
计划入库工作区；至少实际取得一种新数据并检查内容；给出来源与缺口清单。不能只凭网页资料宣布数据已到位或样板已达标。

## 已核查来源
- 作者流程：https://www.justinchavez.com/blog/isometric-sf/
- DSM：https://registry.opendata.aws/copernicus-dem/
- 地类：https://esa-worldcover.org/en/data-access （2021 数据，不能当成最新地貌）
- 建筑研究候选：https://github.com/zhu-xlab/GlobalBuildingAtlas （按数据分项核查许可、CRS及模型误差）

## 执行记录
等待数据裁剪结果回填。

### 2026-11-07 首轮实际执行结果
- 已成功按 WGS84 范围 120.06–120.18 / 30.17–30.28 裁剪两项官方公开栅格，并读回内容。
- Copernicus GLO-30：396×432，554,204 B，高程值约 -1.00～414.55 m；这是样区 DSM 数值范围，不代表已验证绝对高程精度。文件 data/xihu-dsm30.tif。
- ESA WorldCover 2021：1320×1440，120,909 B；包含树木、草地、耕地、建成区、裸地、水体、湿地分类。文件 data/xihu-worldcover2021.tif。无缺失像元，完整性不等于分类准确。
- 原始数据 SHA-256、实际边界、分辨率和分类计数保存在 data/raster-report.json；可复现 fetch-rasters.py 和 prepare-terrain.py 位于实验目录。
- 数据核验页 http://127.0.0.1:3051/terrain.html：1:1 垂直比例，DSM 与地类分别依照真实边界映射；42768 顶点、84710 三角形。Playwright Chrome 已加载并切换北向俯视，pageerror 为空。证据 terrain-preview.png / terrain-top.png。图面整体分布目视可辨，尚未完成控制点残差和垂直基准验收。
- 绿地闭合 way 提取：data/east-shore-green.geojson，共 61 面，relations 尚未组装。
- Google 官方 https://developers.google.com/maps/documentation/javascript/3d/coverage 说明三维限覆盖区；官方国家表的 2D/3D 混合列不能证明杭州有摄影测量三维。本轮未证实杭州覆盖，路线保持多源结构。
- Overture 同范围下载已启动，结果待核验，不能预报高度覆盖率。
- 本轮基于旧白模与斜视卫星输入的 ImageGen 请求返回 network error，无图片产物；不替代后续真实结构样板。CLI 生图备用路径未启用。

### 2026-11-07 3D 场景补充（DEM 接入）
- city3d.html 已把第 2 步的 DSM 接入三维场景：220×200 地形网格（44,421 顶点，1:1 垂直），按卫星图的 GCJ-02 墨卡托 UV 披覆；地形高程 1.5–401.8 m（卫星四至范围内）。
- OSM 水面按 DSM 水位 7.65 m 铺半透明水体；东岸 61 个绿地面散布 303 棵示意树；291 栋 OSM 建筑补窗格立面/屋顶材质与阴影，基座取足迹周边最低 DSM 高度（规避 30 m DSM 的屋面污染）。
- Playwright Chrome 实测：建筑/树木开关、东岸/全湖/俯视切换无 pageerror；东岸俯视与卫星街区目视吻合。证据 city3d-preview.png / city3d-alignment.png / city3d-overview.png；复跑 `node check.cjs`。
- 仍缺：3 个控制点残差与一段已知距离的量测、可信建筑高度（OSM 仅 2 栋有标签）、Isometric SF 风格样板。当前仍是结构+素材原型，不算视觉交付。
