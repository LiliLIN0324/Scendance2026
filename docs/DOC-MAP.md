# Scendance 文档地图（DOC-MAP）

> 全仓 md 的逐份台账。**本页由一次性扫盘生成（2026-11-21），不是手工维护的索引**——分类与阅读时机看 [INDEX.md](INDEX.md)，口径与旧号映射看 [README.md](README.md)。
> 口径：路径与体量为实测；`最后改动` 取 `git log -1` 的提交日期，未入库文件标「未入库」；某一句话在 `docs/` 根目录与仓库根由人工定性，其余为**该文档自述的标题/首句**截断（不是评审结论）。
> 规模：仓库内共 **513 份 md**；`docs/` 内 390 份，合计 2907 MB（含图片/HTML/JSON 等非 md 文件）。

## 一、全景

| 位置 | md | 文件总数 | 体量 | 入库 md | 收什么 |
| --- | ---: | ---: | ---: | ---: | --- |
| docs/（根目录） | 54 | 56 | 1 MB | 54 | 现行规格 / 计划 / 参考：01–63 编号 + 4 份无编号 |
| docs/plans/ | 126 | 174 | 15.5 MB | 126 | 在建方案与批次交付记录 |
| docs/archive/ | 108 | 134 | 4 MB | 108 | 历史：report / plan / visual / research / legacy / example |
| docs/evidence/ | 71 | 1226 | 2871 MB | 53 | 实测证据（截图、探针 JSON、抓取脚本）+ 混入的重建素材 |
| docs/research/ | 21 | 25 | 0.4 MB | 21 | 调研长文 |
| docs/contracts/ | 5 | 5 | 0 MB | 5 | 前后端契约文档 |
| docs/quality/ | 2 | 4 | 0 MB | 2 | 质量口径与检查 |
| docs/oneplan-icons/ | 2 | 4 | 0.7 MB | 2 | OnePlan 图标与说明 |
| docs/visual-2026/ | 0 | 63 | 10.9 MB | 0 | 2026 视觉稿与交付 HTML |
| docs/figures/ | 0 | 27 | 2.9 MB | 0 | 阶段页 HTML 与配图 |
| docs/images/ | 0 | 1 | 0.4 MB | 0 | 单篇配图 |
| docs/examples/ | 0 | 3 | 0.1 MB | 0 | 被测试直接读取的样例 |
| docs/release-notes/ | 1 | 1 | 0 MB | 1 | 版本说明 |
| flow/ | 28 | 28 | 0.4 MB | 28 | 任务卡 + 决策 + 进展流水 |
| 仓库根 | 11 | 28 | 1.6 MB | 11 | 协作 / 交接 / 变更 / 记忆 |
| frontend/ | 25 | 5065 | 1103.1 MB | 19 | 前端模块自带说明 |
| 其他（tools/assets/deliverables/development-research/data/supabase/scene/learning-library/.github） | 33 | 2499 | 465.5 MB | 32 | 工具、素材、交付物、调研、数据、运维、CI |
| agent 草稿（.zwork/.zcode/.agents/.memsearch/.trae） | 26 | 74 | 4.2 MB | 0 | 未入库的运行产物与技能定义 |

> 统计口径：`md` 为本页收录的 md 份数；`文件总数` 与`体量` 为该目录下全部文件（已排除 `node_modules`、`.next`、`out`、`.git`）；`入库 md` 为受 git 跟踪的 md 份数，未入库即为本机独有。

## 二、`docs/` 根目录（现行：50 份编号 + 4 份无编号）

编号占用：1/2/3/4/5/6/7/9/11/12/13/14/15/16/19/21/22/23/24/25/26/27/28/29/32/33/36/37/39/40/41/42/43/44/45/46/47/48/49/50/55/56/57/58/59/60/61/62/63。缺号：8/10/17/18/20/30/31/34/35/38/51/52/53/54（多为历史归档留下的空号）。

**重号：46 号被 2 份占用**
- 46：`46-虚拟场地纸面模式规格-20261117.md` / `46-Agent运行卫生上线手册-20261116.md`

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [01-素材与3D重建.md](01-%E7%B4%A0%E6%9D%90%E4%B8%8E3D%E9%87%8D%E5%BB%BA.md) | 45.9 | 2026-11-19 | 西湖素材核查 + 重建路线真源：32 张里 24 张有效、自评 49 分，结论「现有素材不能重建」 |
| [02-交付与Agent能力.md](02-%E4%BA%A4%E4%BB%98%E4%B8%8EAgent%E8%83%BD%E5%8A%9B.md) | 45.9 | 2026-11-21 | Golden Path 第④步命令契约 + 六项交付能力缺口与优先级 |
| [03-测试与构建健康度.md](03-%E6%B5%8B%E8%AF%95%E4%B8%8E%E6%9E%84%E5%BB%BA%E5%81%A5%E5%BA%B7%E5%BA%A6.md) | 11.6 | 2026-11-04 | 发版前健康度：tsc / vitest / build 现状（2026-11-04 快照，以复跑为准） |
| [04-Golden-Path-规格与实测.md](04-Golden-Path-%E8%A7%84%E6%A0%BC%E4%B8%8E%E5%AE%9E%E6%B5%8B.md) | 34.6 | 2026-11-04 | 五步链路规格、G1–G7 阻塞排序；对投资人或客户讲进度用这一份 |
| [05-设计规范.md](05-%E8%AE%BE%E8%AE%A1%E8%A7%84%E8%8C%83.md) | 40.1 | 2026-11-20 | 视觉与交互规范真源（色板/圆角/控件）；`brand-tokens.test.ts` 直读此文件，勿改名 |
| [06-产品定位钉.md](06-%E4%BA%A7%E5%93%81%E5%AE%9A%E4%BD%8D%E9%92%89.md) | 4.5 | 2026-11-05 | 对外话术与产品定位（用户钉死，不动） |
| [07-商业计划书.md](07-%E5%95%86%E4%B8%9A%E8%AE%A1%E5%88%92%E4%B9%A6.md) | 3.5 | 2026-11-05 | 精简钉版商业计划：叙事与成本结构 |
| [09-平面图上传主路径.md](09-%E5%B9%B3%E9%9D%A2%E5%9B%BE%E4%B8%8A%E4%BC%A0%E4%B8%BB%E8%B7%AF%E5%BE%84.md) | 1.3 | 2026-11-05 | 平面图上传主链路的 KEEP/KILL 判据（产品钉） |
| [11-AI系统提示词.md](11-AI%E7%B3%BB%E7%BB%9F%E6%8F%90%E7%A4%BA%E8%AF%8D.md) | 7.8 | 2026-11-17 | SYSTEM_PROMPT 副本；改提示词须与 `supabase/functions/_shared/ai.ts` 同步 |
| [12-AI使用额度.md](12-AI%E4%BD%BF%E7%94%A8%E9%A2%9D%E5%BA%A6.md) | 0.8 | 2026-11-05 | 应用内 AI 额度取消的记录与语义出处 |
| [13-HTTP-API与前端接入.md](13-HTTP-API%E4%B8%8E%E5%89%8D%E7%AB%AF%E6%8E%A5%E5%85%A5.md) | 16.2 | 2026-11-05 | scene-api 接口口径真源（contracts/ 指向它） |
| [14-后端设计.md](14-%E5%90%8E%E7%AB%AF%E8%AE%BE%E8%AE%A1.md) | 9.8 | 2026-11-05 | 后端职责与结构；改后端结构前读 |
| [15-按次付费与额度.md](15-%E6%8C%89%E6%AC%A1%E4%BB%98%E8%B4%B9%E4%B8%8E%E9%A2%9D%E5%BA%A6.md) | 16.1 | 2026-11-05 | 付费/额度唯一真源：收款→到账次数→预扣→失败返还（旧号 45） |
| [16-小程序变现调研与接入路线.md](16-%E5%B0%8F%E7%A8%8B%E5%BA%8F%E5%8F%98%E7%8E%B0%E8%B0%83%E7%A0%94%E4%B8%8E%E6%8E%A5%E5%85%A5%E8%B7%AF%E7%BA%BF.md) | 4.8 | 2026-11-05 | 小程序三通道变现对比；等认证 + 备案（旧号 46） |
| [19-西湖户外重建接力.md](19-%E8%A5%BF%E6%B9%96%E6%88%B7%E5%A4%96%E9%87%8D%E5%BB%BA%E6%8E%A5%E5%8A%9B.md) | 10.5 | 2026-11-13 | recon 配方实录，前端 use-camera-presets 注释引用（旧号 49） |
| [21-双端入口与统一任务表.md](21-%E5%8F%8C%E7%AB%AF%E5%85%A5%E5%8F%A3%E4%B8%8E%E7%BB%9F%E4%B8%80%E4%BB%BB%E5%8A%A1%E8%A1%A8.md) | 37.1 | 2026-11-13 | 一个账号、一张任务表、两个入口的双端模型（旧号 51） |
| [22-资产台账与3DGS可编辑方案.md](22-%E8%B5%84%E4%BA%A7%E5%8F%B0%E8%B4%A6%E4%B8%8E3DGS%E5%8F%AF%E7%BC%96%E8%BE%91%E6%96%B9%E6%A1%88.md) | 13.3 | 2026-11-05 | 529 个 GLB 台账 + 3DGS 可编辑路线 |
| [23-智能采集升级提案.md](23-%E6%99%BA%E8%83%BD%E9%87%87%E9%9B%86%E5%8D%87%E7%BA%A7%E6%8F%90%E6%A1%88.md) | 9.1 | 2026-11-07 | 图片→视频采集升级，S1–S3 已落码，S4/S5 未排卡（旧号 53） |
| [24-Web端三个产品问题.md](24-Web%E7%AB%AF%E4%B8%89%E4%B8%AA%E4%BA%A7%E5%93%81%E9%97%AE%E9%A2%98.md) | 9.2 | 2026-11-05 | Web 端三个产品问题与优先级 1/2/3（旧号 54） |
| [25-Scendance需求清单.md](25-Scendance%E9%9C%80%E6%B1%82%E6%B8%85%E5%8D%95.md) | 15.3 | 2026-11-13 | 36 张 SC 卡的派发与认领真源 |
| [26-品牌规划.md](26-%E5%93%81%E7%89%8C%E8%A7%84%E5%88%92.md) | 6.9 | 2026-11-08 | 品牌四件套落地（P0 已回填，P1/P2 待点卡） |
| [27-首单需求卡-HallD5演练.md](27-%E9%A6%96%E5%8D%95%E9%9C%80%E6%B1%82%E5%8D%A1-HallD5%E6%BC%94%E7%BB%83.md) | 9.6 | 2026-11-09 | SC-02 首单需求卡；SC-03/04/05/19 的固定验收输入 |
| [28-价格口径对照.md](28-%E4%BB%B7%E6%A0%BC%E5%8F%A3%E5%BE%84%E5%AF%B9%E7%85%A7.md) | 17.5 | 2026-11-07 | 代码 / 产品文档 / 付款渠道三方价格差异（SC-34，待拍板） |
| [29-重建样本归档.md](29-%E9%87%8D%E5%BB%BA%E6%A0%B7%E6%9C%AC%E5%BD%92%E6%A1%A3.md) | 15.6 | 2026-11-13 | 茶室失败 / 寺庙成功 / 西湖视频成功三组对照档案（SC-25） |
| [32-SC19-容量边界复验.md](32-SC19-%E5%AE%B9%E9%87%8F%E8%BE%B9%E7%95%8C%E5%A4%8D%E9%AA%8C.md) | 27.8 | 2026-11-13 | 容量边界复验记录；4 个测试文件的回归注释钉着此路径 |
| [33-西湖新素材分段清单.md](33-%E8%A5%BF%E6%B9%96%E6%96%B0%E7%B4%A0%E6%9D%90%E5%88%86%E6%AE%B5%E6%B8%85%E5%8D%95.md) | 8.4 | 2026-11-07 | 36 段素材 + XH 系候选清单（XH-01） |
| [36-MP-DEL交付包规格.md](36-MP-DEL%E4%BA%A4%E4%BB%98%E5%8C%85%E8%A7%84%E6%A0%BC.md) | 13.6 | 2026-11-08 | 交付包 v1 冻结规格（B1/B2 已完成，B3 验收未做） |
| [37-MP-PLAN风格brief规格.md](37-MP-PLAN%E9%A3%8E%E6%A0%BCbrief%E8%A7%84%E6%A0%BC.md) | 4.2 | 2026-11-08 | 三风格 brief 规格（C1 已落码，C2 盲评未做） |
| [39-Aholo能力与用途评估-20261108.md](39-Aholo%E8%83%BD%E5%8A%9B%E4%B8%8E%E7%94%A8%E9%80%94%E8%AF%84%E4%BC%B0-20261108.md) | 15.5 | 2026-11-10 | Aholo 重建能力评估与选型参考（已脱敏，只探索未改码） |
| [40-地标高度清单-20261109.md](40-%E5%9C%B0%E6%A0%87%E9%AB%98%E5%BA%A6%E6%B8%85%E5%8D%95-20261109.md) | 33.2 | 2026-11-10 | 西湖 S1–S52 逐栋高度依据；`scripts/build-building-heights.py` 硬编码引用 |
| [41-缺失地标补录方案-20261109.md](41-%E7%BC%BA%E5%A4%B1%E5%9C%B0%E6%A0%87%E8%A1%A5%E5%BD%95%E6%96%B9%E6%A1%88-20261109.md) | 19.2 | 2026-11-10 | 1543 栋缺失地标补录方案，待拍板 |
| [42-地理优先主线改造清单-20261111.md](42-%E5%9C%B0%E7%90%86%E4%BC%98%E5%85%88%E4%B8%BB%E7%BA%BF%E6%94%B9%E9%80%A0%E6%B8%85%E5%8D%95-20261111.md) | 13.3 | 2026-11-12 | 「地点→平面→3D」主线三刀；前端 5 处注释引用 |
| [43-Agent场地理解与自动排布P0计划-20261112.md](43-Agent%E5%9C%BA%E5%9C%B0%E7%90%86%E8%A7%A3%E4%B8%8E%E8%87%AA%E5%8A%A8%E6%8E%92%E5%B8%83P0%E8%AE%A1%E5%88%92-20261112.md) | 28.7 | 2026-11-13 | V-1～V-5 施工卡真源，点卡前零改码 |
| [44-户外V1-V5-Box收尾验收-20261113.md](44-%E6%88%B7%E5%A4%96V1-V5-Box%E6%94%B6%E5%B0%BE%E9%AA%8C%E6%94%B6-20261113.md) | 41.4 | 2026-11-13 | V1–V5 收尾清单与待验收项；浏览器验收当时被代理 403 挡住 |
| [45-户外Agent-V1-V5对话主链重构矩阵-20261113.md](45-%E6%88%B7%E5%A4%96Agent-V1-V5%E5%AF%B9%E8%AF%9D%E4%B8%BB%E9%93%BE%E9%87%8D%E6%9E%84%E7%9F%A9%E9%98%B5-20261113.md) | 42.8 | 2026-11-13 | 按 V1–V5 重构对话主链的阶段核对与接线边界（43 号承上） |
| [46-虚拟场地纸面模式规格-20261117.md](46-%E8%99%9A%E6%8B%9F%E5%9C%BA%E5%9C%B0%E7%BA%B8%E9%9D%A2%E6%A8%A1%E5%BC%8F%E8%A7%84%E6%A0%BC-20261117.md) | 5.3 | 2026-11-17 | 虚拟场地「白纸起稿」一等公民规格，V-P1～V-P3 已落码（46 重号之一） |
| [46-Agent运行卫生上线手册-20261116.md](46-Agent%E8%BF%90%E8%A1%8C%E5%8D%AB%E7%94%9F%E4%B8%8A%E7%BA%BF%E6%89%8B%E5%86%8C-20261116.md) | 6.6 | 2026-11-16 | agent_rpc 读不锁行 / deadline 续期 / 收尾退款 / 事件脱锁的上线与回滚（46 重号之一） |
| [47-户外Agent设计智能升级计划-20261117.md](47-%E6%88%B7%E5%A4%96Agent%E8%AE%BE%E8%AE%A1%E6%99%BA%E8%83%BD%E5%8D%87%E7%BA%A7%E8%AE%A1%E5%88%92-20261117.md) | 36.9 | 2026-11-20 | 43 的续篇：让规划本身有设计含量，卡号 A1–E3 |
| [48-PetitMaker-Agent对标实测-20261121.md](48-PetitMaker-Agent%E5%AF%B9%E6%A0%87%E5%AE%9E%E6%B5%8B-20261121.md) | 8 | 2026-11-21 | PetitMaker 四轮实机对标 + 差距表（49 号卡的对标依据） |
| [49-Agent工具循环与双交付形态-对标收敛卡-20261121.md](49-Agent%E5%B7%A5%E5%85%B7%E5%BE%AA%E7%8E%AF%E4%B8%8E%E5%8F%8C%E4%BA%A4%E4%BB%98%E5%BD%A2%E6%80%81-%E5%AF%B9%E6%A0%87%E6%94%B6%E6%95%9B%E5%8D%A1-20261121.md) | 8.6 | 2026-11-21 | Phase F 开工卡 F1–F5（47 号的下一阶段） |
| [50-谷地工坊交互逻辑拆解与落地卡-20261121.md](50-%E8%B0%B7%E5%9C%B0%E5%B7%A5%E5%9D%8A%E4%BA%A4%E4%BA%92%E9%80%BB%E8%BE%91%E6%8B%86%E8%A7%A3%E4%B8%8E%E8%90%BD%E5%9C%B0%E5%8D%A1-20261121.md) | 8.1 | 2026-11-21 | Phase F 交互层配套：P1–P10 拆解 + I1–I6 落地卡 |
| [55-小程序上线路线与主体约束.md](55-%E5%B0%8F%E7%A8%8B%E5%BA%8F%E4%B8%8A%E7%BA%BF%E8%B7%AF%E7%BA%BF%E4%B8%8E%E4%B8%BB%E4%BD%93%E7%BA%A6%E6%9D%9F.md) | 15.9 | 2026-11-13 | 小程序上线三件卡点：备案认证 / 已备案 HTTPS 域名 / 匿名限流重建入口 |
| [56-小程序定位重构.md](56-%E5%B0%8F%E7%A8%8B%E5%BA%8F%E5%AE%9A%E4%BD%8D%E9%87%8D%E6%9E%84.md) | 15.5 | 2026-11-13 | 小程序=微信里的 Scendance 窗口，不再承担采集与重建 |
| [57-Agent底座语料-场地证据与判据集-20261118.md](57-Agent%E5%BA%95%E5%BA%A7%E8%AF%AD%E6%96%99-%E5%9C%BA%E5%9C%B0%E8%AF%81%E6%8D%AE%E4%B8%8E%E5%88%A4%E6%8D%AE%E9%9B%86-20261118.md) | 11.6 | 2026-11-18 | 判据集 / 模板 / 物料参数 / 场地证据 schema 的机读件说明（数据在 data/agent-corpus） |
| [58-成熟案例库与物料参考-20261118.md](58-%E6%88%90%E7%86%9F%E6%A1%88%E4%BE%8B%E5%BA%93%E4%B8%8E%E7%89%A9%E6%96%99%E5%8F%82%E8%80%83-20261118.md) | 10.4 | 2026-11-20 | 43 案底图核对 + 20 个自有场地档案 + 3 条事故复盘 |
| [59-Agent评测集与打分口径-20261118.md](59-Agent%E8%AF%84%E6%B5%8B%E9%9B%86%E4%B8%8E%E6%89%93%E5%88%86%E5%8F%A3%E5%BE%84-20261118.md) | 8 | 2026-11-19 | 27 条评测样本 + 纯函数打分器；判断 Agent 变好变差前先看 |
| [60-阈值审计与案例校准-20261118.md](60-%E9%98%88%E5%80%BC%E5%AE%A1%E8%AE%A1%E4%B8%8E%E6%A1%88%E4%BE%8B%E6%A0%A1%E5%87%86-20261118.md) | 8 | 2026-11-19 | 15 条阈值实测：13 生效、2 没人读、3 贴边界；改判据数值前必看 |
| [61-真实场地档案抽取-20261118.md](61-%E7%9C%9F%E5%AE%9E%E5%9C%BA%E5%9C%B0%E6%A1%A3%E6%A1%88%E6%8A%BD%E5%8F%96-20261118.md) | 6.9 | 2026-11-19 | 5 份自有档案抽成布局后 0 条判据可算（档案是演练件） |
| [62-OSM建筑轮廓与真实数据判据-20261118.md](62-OSM%E5%BB%BA%E7%AD%91%E8%BD%AE%E5%BB%93%E4%B8%8E%E7%9C%9F%E5%AE%9E%E6%95%B0%E6%8D%AE%E5%88%A4%E6%8D%AE-20261118.md) | 5.3 | 2026-11-19 | OSM 8 栋真实建筑下 GEN-07 首次算出 9.8 m |
| [63-Agent合格度与断点审计-20261121.md](63-Agent%E5%90%88%E6%A0%BC%E5%BA%A6%E4%B8%8E%E6%96%AD%E7%82%B9%E5%AE%A1%E8%AE%A1-20261121.md) | 24.3 | 2026-11-21 | 三层判据 + 十三项检查 + 七处断点；判断 Agent 合不合格先看这份 |
| [COMPASS_TURN_ARROWS_PLAN.md](COMPASS_TURN_ARROWS_PLAN.md) | 6.4 | 2026-11-16 | 3D 罗盘两侧转向箭头复刻交接单（2026-11-16） |
| [INDEX.md](INDEX.md) | 19.4 | 2026-11-21 | 文件清单页：按用途归类 + 什么时候读（手工维护） |
| [medium-layout-fix-list.md](medium-layout-fix-list.md) | 11.8 | 2026-11-16 | 769–1080 px 中等宽度布局改造记录（已按 B 方案落地） |
| [README.md](README.md) | 9.8 | 2026-11-13 | docs 唯一入口：现状结论、文档地图、旧号映射、维护规则 |

> INDEX 覆盖检查：54/54 份已在 [INDEX.md](INDEX.md) 登记。

## 三、`docs/plans/`（在建方案，按最后改动倒序）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [2026-11-20-79-closure-runbook.md](plans/2026-11-20-79-closure-runbook.md) | 22.3 | 2026-11-21 | 目标：把台账从 3/11 全绿 推到 11/11，最后由人签字。本方案逐条写清：判据、现状、还差什么、谁来做、人工照点步骤、证据落点。 |
| [2026-11-20-79-closure-snapshot.md](plans/2026-11-20-79-closure-snapshot.md) | 35.5 | 2026-11-21 | 配套交接计划：docs/plans/2026-11-20-79-jieyu-handoff-plan.md。本快照只记本轮真实状态、已验证命令输出… |
| [2026-11-20-79-jieyu-handoff-plan.md](plans/2026-11-20-79-jieyu-handoff-plan.md) | 21.9 | 2026-11-21 | 目的：让新的 agent 不靠猜、不重跑已经完成的证据，把 79 从 3/11 解到 11/11，最后由人签字。 |
| [2026-11-20-权限体系建设方案.md](plans/2026-11-20-%E6%9D%83%E9%99%90%E4%BD%93%E7%B3%BB%E5%BB%BA%E8%AE%BE%E6%96%B9%E6%A1%88.md) | 16.5 | 2026-11-20 | 定位：上游 生成物可见性与权限分层研究 已盘点现状规则；本文回答三个问题——成熟产品怎么做权限分层、我们的目标模型长什么样、分几期落地。 |
| [2026-11-20-生成物可见性权限分层研究.md](plans/2026-11-20-%E7%94%9F%E6%88%90%E7%89%A9%E5%8F%AF%E8%A7%81%E6%80%A7%E6%9D%83%E9%99%90%E5%88%86%E5%B1%82%E7%A0%94%E7%A9%B6.md) | 14.6 | 2026-11-20 | 状态：现状调研 + 方案建议，分层归属尚未拍板。本文只盘点现有代码与迁移的真实规则，不另起并行 schema；涉及 migration / 契约的… |
| [2026-11-20-cloud-storage-deployment-runbook.md](plans/2026-11-20-cloud-storage-deployment-runbook.md) | 13.3 | 2026-11-20 | 日期：2026-11-20。用户已指定两位管理员邮箱并要求接手完成，无需再次逐项审批。本次执行结果见下表；下文保留可复用步骤，不能把步骤本身当成验… |
| [2026-11-20-cloud-storage-integration-acceptance.md](plans/2026-11-20-cloud-storage-integration-acceptance.md) | 45.5 | 2026-11-20 | 日期：2026-11-20（第一轮验收 + 第二轮收口，同日完成）。验收人：总集成验收（独立于 A/B/C 三个执行任务）。 |
| [2026-11-20-cloud-storage-sharing-cases-execution.md](plans/2026-11-20-cloud-storage-sharing-cases-execution.md) | 26.3 | 2026-11-20 | 日期：2026-11-20。状态：已实施并上线：C00–C13 主链在 ac2d3777／3730ff7b 合流并部署，生产真实探针已过；C14/… |
| [2026-11-20-cloud-storage-task-a.md](plans/2026-11-20-cloud-storage-task-a.md) | 10.6 | 2026-11-20 | 状态：本轮补丁已落码并通过本地专项验证；接口为待人审草案，未部署、未迁移、未提交。 不猜测管理员 UUID；首授/撤权与桶扩容的具体变更见审核 S… |
| [2026-11-20-cloud-storage-task-b.md](plans/2026-11-20-cloud-storage-task-b.md) | 12.7 | 2026-11-20 | 日期：2026-11-20。状态：本地实现完成；云端验收未做（真实管理员账号、数据库/Edge 人审、干净设备验收都不具备）。按主计划 §8：仅交… |
| [2026-11-20-cloud-storage-task-c.md](plans/2026-11-20-cloud-storage-task-c.md) | 8.2 | 2026-11-20 | 日期：2026-11-20。状态：本地实现完成，聚焦测试通过；云端验收与工作台接线（B）未做。 仅工作区补丁，未 add/commit/push、… |
| [2026-11-20-cross-loop-inbox-plan.md](plans/2026-11-20-cross-loop-inbox-plan.md) | 10.7 | 2026-11-20 | 口径：本轮只做计划与现状核对，未在本计划内改代码、未提交、未部署。 |
| [2026-11-20-editor-copy-cut-review.md](plans/2026-11-20-editor-copy-cut-review.md) | 29.7 | 2026-11-20 | 状态：已执行（2026-11-20，按「全部同意」）。 A/B 组已落地到代码，C 组原样未动，D 组只收集未改。执行记录与验证证据见 §八。 |
| [2026-11-20-execution-data-agent-mapping.md](plans/2026-11-20-execution-data-agent-mapping.md) | 14.6 | 2026-11-20 | 口径：第一性原理拆解后的本地方案对照，本轮未改代码、未提交、未部署。 |
| [2026-11-20-people-registry-unification.md](plans/2026-11-20-people-registry-unification.md) | 21.9 | 2026-11-20 | 生成日期：2026-11-20 状态：P1–P3 已实施，P4 真机走查部分完成（实施记录见 §十三） |
| [2026-11-20-publish-flow-closure-plan.md](plans/2026-11-20-publish-flow-closure-plan.md) | 20.8 | 2026-11-20 | 日期：2026-11-20。状态：已实施（P0-A/P0-B/P1-A/P1-B 代码与测试完成，P2 未开工），验收记录见 §8。 |
| [2026-11-20-publish-flow-interface-contract.md](plans/2026-11-20-publish-flow-interface-contract.md) | 14.1 | 2026-11-20 | 日期：2026-11-20。状态：生效中（集成方维护；A/B 有异议在各自报告里提出，由集成方合入本文）。 |
| [2026-11-20-publish-remaining-acceptance-plan.md](plans/2026-11-20-publish-remaining-acceptance-plan.md) | 16.7 | 2026-11-20 | 日期：2026-11-20。状态：计划，待执行。 |
| [2026-11-20-supabase-usage-budget-plan.md](plans/2026-11-20-supabase-usage-budget-plan.md) | 6.9 | 2026-11-20 | 日期：2026-11-20。状态：P0 已执行，P1 起待批。 |
| [2026-11-20-venue-agent-baseline-and-acceptance.md](plans/2026-11-20-venue-agent-baseline-and-acceptance.md) | 38.8 | 2026-11-20 | 日期：2026-11-20。角色：集成与验收（协调入口）。配套计划：2026-11-20-venue-agent-interaction-desi… |
| [2026-11-20-venue-agent-interaction-design-plan.md](plans/2026-11-20-venue-agent-interaction-design-plan.md) | 12.9 | 2026-11-20 | 日期：2026-11-20。状态：P0 真实页面验收已补做（浏览器自动化通道本轮恢复，2D 链路走通并留证）；P1 看懂与修改、P2 设计质量已落… |
| [2026-11-20-venue-agent-interaction-handoff.md](plans/2026-11-20-venue-agent-interaction-handoff.md) | 16.3 | 2026-11-20 | 对应设计稿：docs/plans/2026-11-20-venue-agent-interaction-design-plan.md。 |
| [2026-11-08-单Agent工具矩阵.md](plans/2026-11-08-%E5%8D%95Agent%E5%B7%A5%E5%85%B7%E7%9F%A9%E9%98%B5.md) | 6.1 | 2026-11-19 | 状态：工作区设计与事实盘点，2026-11-08。产品中只有一个活动 Agent；Bingo、空间、物料是用户工作区与能力入口，不各自代表一个自主… |
| [2026-11-16-outdoor-evidence-matrix.md](plans/2026-11-16-outdoor-evidence-matrix.md) | 35.6 | 2026-11-19 | 下面这段是 statusCardSnapshot() 在「默认台账」下的输出，逐字段被测试钉住，不是手抄： |
| [2026-11-18-79-handoff-next-agent.md](plans/2026-11-18-79-handoff-next-agent.md) | 9 | 2026-11-19 | 用途：把「不依赖真机的部分」做完之后，剩下需要真机 / 登录态 / 系统权限 / 人决策的事项按条目交清，下一个 agent 按单取证、回填、不越… |
| [2026-11-18-79-walkthrough-checklist.md](plans/2026-11-18-79-walkthrough-checklist.md) | 20.9 | 2026-11-19 | 用途：把「11 条验收用例 0 条三类全绿」变成可执行、可回填、可签字的证据采集。 |
| [2026-11-19-agent-t2-t3-handoff.md](plans/2026-11-19-agent-t2-t3-handoff.md) | 3.9 | 2026-11-19 | 2026-11-19；用户要求从 T2 直接开发。后续明确“没有搜索服务，先接好可配置服务”“不用验收，继续做下一个”。因此停止验收与构建，不执行… |
| [2026-11-19-chat-first-event-agent-cutoff-report.md](plans/2026-11-19-chat-first-event-agent-cutoff-report.md) | 5.4 | 2026-11-19 | 计划正本：docs/plans/2026-11-19-chat-first-event-agent-execution.md（用户指令：不做公益案… |
| [2026-11-19-chat-first-event-agent-execution.md](plans/2026-11-19-chat-first-event-agent-execution.md) | 18.9 | 2026-11-19 | 日期：2026-11-19。性质：待实施计划，不是完工报告。 |
| [2026-11-19-chat-first-event-agent-progress.md](plans/2026-11-19-chat-first-event-agent-progress.md) | 22.3 | 2026-11-19 | 计划正本：docs/plans/2026-11-19-chat-first-event-agent-execution.md |
| [2026-11-19-chat-first-event-agent-t0-baseline.md](plans/2026-11-19-chat-first-event-agent-t0-baseline.md) | 10.4 | 2026-11-19 | 计划正本：docs/plans/2026-11-19-chat-first-event-agent-execution.md |
| [2026-11-19-chat-first-event-agent-t1-plan.md](plans/2026-11-19-chat-first-event-agent-t1-plan.md) | 8.4 | 2026-11-19 | 依据：T0 基线 docs/plans/2026-11-19-chat-first-event-agent-t0-baseline.md 的 G4… |
| [2026-11-19-contest-wedding-next-plan.md](plans/2026-11-19-contest-wedding-next-plan.md) | 88.1 | 2026-11-19 | 依据：main 代码现状 + 会议纪要《智能纪要：3D赛事参赛方案研讨会议 2026年11月19日》 |
| [2026-11-19-huajia-material-bom.md](plans/2026-11-19-huajia-material-bom.md) | 94.7 | 2026-11-19 | 生成日期：2026-11-19（2026-11-19T17:00+08:00） 作者：幕景策划（Agent 产出的文档与数据文件） |
| [2026-11-19-huajia-plan-handover.md](plans/2026-11-19-huajia-plan-handover.md) | 10.5 | 2026-11-19 | 2026-11-19｜幕景 Scendance｜面向：林丽丽（婚礼策划）、终树（幕景） |
| [2026-11-19-zero-photo-lane.md](plans/2026-11-19-zero-photo-lane.md) | 45.4 | 2026-11-19 | 这份文档只讲两件事：这套链路该怎么对用户说，以及哪些话不能说。 |
| [2026-11-16-outdoor-agent-progress.md](plans/2026-11-16-outdoor-agent-progress.md) | 233.5 | 2026-11-18 | 计划见 户外 Agent 强化执行计划。每轮执行先更新「当前续跑点」，完成后更新「执行记录」。所有状态以实际文件差异、提交和验收输出为准。 |
| [2026-11-16-vehicle-entity-contract-118.md](plans/2026-11-16-vehicle-entity-contract-118.md) | 39.2 | 2026-11-18 | 2026-11-16 · Scendance2026 · feat/people06-labor · HEAD 46ec7e80（= origin… |
| [2026-11-17-b1-b4-execution-cards.md](plans/2026-11-17-b1-b4-execution-cards.md) | 11.2 | 2026-11-18 | 计划基线：main e0e1cdf8（2026-11-17）。开工前先 git fetch && git rebase origin/main，文… |
| [2026-11-17-c1-generation-run.md](plans/2026-11-17-c1-generation-run.md) | 50 | 2026-11-18 | 两轮实跑，结论从 BLOCKED 翻到 PASS（任务侧）： |
| [2026-11-17-decouple-execution-plan.md](plans/2026-11-17-decouple-execution-plan.md) | 16.4 | 2026-11-18 | 用途：分派给执行 agent 的可落地切片计划。依据 outdoor-map-decommission-2026-11-13.md 退役框架与 2… |
| [2026-11-17-event-producer-bot-gap-plan.md](plans/2026-11-17-event-producer-bot-gap-plan.md) | 22.7 | 2026-11-18 | 输入：Event Producer Bot 提示词全文（Getting started、Skill 2–8 的使用时机、Routines 三段结构… |
| [2026-11-17-event-profile-p0-contract.md](plans/2026-11-17-event-profile-p0-contract.md) | 19.2 | 2026-11-18 | 配套：docs/plans/2026-11-17-event-producer-bot-gap-plan.md（v3，P0-1/P0-5）。 |
| [2026-11-17-g1-closure-status.md](plans/2026-11-17-g1-closure-status.md) | 15.7 | 2026-11-18 | 口径：只读盘点 origin/main，不改代码、不拆旧链。对照 docs/plans/outdoor-map-decommission-2026… |
| [2026-11-18-79-rootcause-and-gaps.md](plans/2026-11-18-79-rootcause-and-gaps.md) | 12.4 | 2026-11-18 | --- |
| [2026-11-18-c-decisions-card.md](plans/2026-11-18-c-decisions-card.md) | 9.3 | 2026-11-18 | 一页用完：拍板、留痕、解锁。本卡不是开工单，拍板后按 §5 的切片另开。 |
| [2026-11-18-lux3d-generation-closure.md](plans/2026-11-18-lux3d-generation-closure.md) | 9.7 | 2026-11-18 | 代码侧能自己做的缺口今天补完了：排队卡住时人能看懂原因、触发器脚本能装得成且装完能自证、 |
| [2026-11-18-settings-cases.md](plans/2026-11-18-settings-cases.md) | 8 | 2026-11-18 | 日期：2026-11-18 |
| [2026-11-18-settings-layers.md](plans/2026-11-18-settings-layers.md) | 40.5 | 2026-11-18 | 日期：2026-11-18 |
| [2026-11-18-shortcut-learning.md](plans/2026-11-18-shortcut-learning.md) | 9.2 | 2026-11-18 | 日期：2026-11-18 |
| [2026-11-19-outdoor-acceptance-rollup.md](plans/2026-11-19-outdoor-acceptance-rollup.md) | 6.7 | 2026-11-18 | 固定数据一列来自代码 FIXEDDATAEVIDENCE（轮次 102 口径：有实存测试文件才算，轮次 103 用 node:fs 钉住文件存在）… |
| [2026-11-19-outdoor-m7-pr-draft.md](plans/2026-11-19-outdoor-m7-pr-draft.md) | 4.9 | 2026-11-18 | 本文件是给「网络恢复后开 PR」用的逐字草稿：标题、正文、验证输出都按实际跑过的结果写死。 |
| [2026-11-16-handoff-v5-generation.md](plans/2026-11-16-handoff-v5-generation.md) | 9.2 | 2026-11-17 | 性质：只改统一生成面板与提交回执链路；未 commit / push / PR / 部署；未点击真实生成、未消耗额度。 |
| [2026-11-17-indoor-deadcode-audit-3e376b41.md](plans/2026-11-17-indoor-deadcode-audit-3e376b41.md) | 10.3 | 2026-11-17 | 本文是 2026-11-17-indoor-shell-reference-scan.md 的续篇：上一轮只做引用面分档，本轮在干净远端基线上做全… |
| [2026-11-17-m2-facility-finish-slices.md](plans/2026-11-17-m2-facility-finish-slices.md) | 8.7 | 2026-11-17 | A1/A2/A1-5 切片：纯函数 / 契约新增 / 对照测试层，不接壳体、不动会话与历史绑定。本文件记录已落部分与后续可执行切片，供 G2 解锁… |
| [2026-11-17-m3-foundations-slices.md](plans/2026-11-17-m3-foundations-slices.md) | 5 | 2026-11-17 | 目标：把不依赖拍板、不碰壳体装配的 plan 侧纯函数先做完，供 G2 解锁后直接接线。 |
| [2026-11-17-outdoor-inspector-fit.md](plans/2026-11-17-outdoor-inspector-fit.md) | 3.6 | 2026-11-17 | 不是层叠问题，是宽度问题：属性卡的宽度由内容决定，而「3D 模型候选」那一排是横向滚动条， |
| [2026-11-17-roam-behavior-layer.md](plans/2026-11-17-roam-behavior-layer.md) | 25.6 | 2026-11-17 | 2026-11-17 · 用户口径：「有流线就固定在流线里走；从外面进到一个分区，就在这个分区里自由活动；看到椅子就坐下。」 |
| [2026-11-16-outdoor-agent-upgrade.md](plans/2026-11-16-outdoor-agent-upgrade.md) | 28.8 | 2026-11-16 | 2026-11-16 · Scendance2026 · 配套 执行进度 |
| [2026-11-16-outdoor-release-rollback.md](plans/2026-11-16-outdoor-release-rollback.md) | 6.6 | 2026-11-16 | 能单笔干净回退的只有 4 笔（git apply -R 零冲突）： |
| [2026-11-16-people-asset-pipeline.md](plans/2026-11-16-people-asset-pipeline.md) | 14.1 | 2026-11-16 | 原始人物 GLB 39.93 MB / 382,720 三角面，可压到 hero 3.52 MB（零削面）、 |
| [outdoor-map-decommission-2026-11-13.md](plans/outdoor-map-decommission-2026-11-13.md) | 56 | 2026-11-16 | 基底 HEAD 2cb342c2（merge origin/main 110）。本文是对 outdoor-map-unification-2026… |
| [outdoor-walk-roadmap-2026-11-14.md](plans/outdoor-walk-roadmap-2026-11-14.md) | 32.8 | 2026-11-16 | 基底：三期落点文档 outdoor-walk-avatar-third-person-2026-11-14.md（avatar / 三视角 / 坐… |
| [tool-rail-unification-2026-11-13.md](plans/tool-rail-unification-2026-11-13.md) | 23.5 | 2026-11-16 | 状态：方案阶段，未改代码。按既定偏好：本地分支攒改动 → tsc + 定向测试 + 真机验收通过后再一次性推 main，不逐小改开 PR。 |
| [indoor-decouple-targets-2026-11-14.md](plans/indoor-decouple-targets-2026-11-14.md) | 25 | 2026-11-14 | 基底：本地 main HEAD 492dcc8b（远端 origin/main f6409fb6，仅差一个 .dsh/skills 手册 comm… |
| [outdoor-first-person-walk-2026-11-13.md](plans/outdoor-first-person-walk-2026-11-13.md) | 10.7 | 2026-11-14 | 范围：户外 3D 组件只做裸第一人称步行；纯视图层接入，不挡旧 M3 退役链。 |
| [outdoor-walk-avatar-third-person-2026-11-14.md](plans/outdoor-walk-avatar-third-person-2026-11-14.md) | 14.3 | 2026-11-14 | 基底：main 已含一期「裸第一人称步行」（21a05ef8）与视觉收口（ff800d28）。 |
| [commercial-agreements.md](plans/commercial-agreements.md) | 7.9 | 2026-11-13 | 2026-10-09。来源是用户新增要求“是不是应该加入什么合同一类的，毕竟是全流程承办”，以及已授权产品计划中的报价、收付款与业务变更。下文为设… |
| [delivery-frontend.md](plans/delivery-frontend.md) | 151.9 | 2026-11-13 | 本轮回应用户“学了哪些、逻辑关系仍不对、需要干净”。只读复核当前共享工作树，并读取用户当前选中的18518正常页面；未点击、填写、改用户存档、运行… |
| [discussion-and-sketch-review.md](plans/discussion-and-sketch-review.md) | 12.8 | 2026-11-13 | 2026年10月7日。依据本次讨论、Figma 草图和当前开发分支。目标是让两人的小团队能从客户需求走到活动现场交付，同时让客户看懂空间方案。 |
| [executor-readback-review.md](plans/executor-readback-review.md) | 9.2 | 2026-11-13 | 2026-10-10。以第一次接到布展/执行外包材料的读者视角，只读指定下载文件。结论：可以复述演练流程和多数检查动作，不能据此承接或启动真实活动… |
| [hangzhou-isometric-map-research.md](plans/hangzhou-isometric-map-research.md) | 8 | 2026-11-13 | 2026-11-07。拟议独立仓库名 scendance-hangzhou-map-lab，先做西湖东岸小样。目标是让用户在杭州城市尺度搜索、平移… |
| [outdoor-map-unification-2026-11-13.md](plans/outdoor-map-unification-2026-11-13.md) | 56 | 2026-11-13 | 状态：规划 + 分阶段落地。按既定偏好本地攒好、tsc + 测试 + 真机验收通过后再一次性推 main，不逐小改开 PR。 |
| [playtest-matrix-2026-11-05.md](plans/playtest-matrix-2026-11-05.md) | 17.7 | 2026-11-13 | 日期：2026-11-05 · 站点：https://petitmaker.com.cn/ · 模型：Qwen 3.8 Max（百炼工作空间，监督… |
| [reliability-loop.md](plans/reliability-loop.md) | 48.2 | 2026-11-13 | 建立日期：2026-10-07（Asia/Shanghai）。用户已授权长期执行、对抗性检查、成熟案例调研及有依据的优化。本文用于本项目，不维护用… |
| [sidebar-entry-unification-2026-11-12.md](plans/sidebar-entry-unification-2026-11-12.md) | 27.4 | 2026-11-13 | 状态：规划讨论；首个代码改动（Bingo 徽标）已合入 main。后续按既定偏好本地攒好、tsc + 测试 + 真机验收通过后再一次性推 main… |
| [2026-11-11-people05-crowd-uniform-batch.md](plans/2026-11-11-people05-crowd-uniform-batch.md) | 2.4 | 2026-11-12 | 日期：2026-11-11（Asia/Shanghai） |
| [2026-11-11-演示回放系统.md](plans/2026-11-11-%E6%BC%94%E7%A4%BA%E5%9B%9E%E6%94%BE%E7%B3%BB%E7%BB%9F.md) | 4.4 | 2026-11-11 | 日期：2026-11-11 · 对标：petitmaker.com.cn 首页自动演示 + 帮助中心「新手提示」卡组 |
| [2026-11-08-isometric-sf-拆解与复刻差异诊断.md](plans/2026-11-08-isometric-sf-%E6%8B%86%E8%A7%A3%E4%B8%8E%E5%A4%8D%E5%88%BB%E5%B7%AE%E5%BC%82%E8%AF%8A%E6%96%AD.md) | 25.9 | 2026-11-10 | 日期：2026-11-08 |
| [2026-11-10-outdoor-event-planning.md](plans/2026-11-10-outdoor-event-planning.md) | 53.2 | 2026-11-10 | 2026-11-10 · 产品与技术评审稿 |
| [circle-draw-save-fix-2026-11-08.md](plans/circle-draw-save-fix-2026-11-08.md) | 7.1 | 2026-11-10 | 2026-11-08 · 对应 平湖秋月场地流程 的圈画保存。 |
| [hangzhou-city-art-execution.md](plans/hangzhou-city-art-execution.md) | 5.9 | 2026-11-10 | 2026-11-07。目标：参考 Isometric SF，以杭州真实地理结构制作精细等距城市地图；首轮只验收西湖东岸样区。原二维滤镜和 city… |
| [hangzhou-iso-hubin-capture.md](plans/hangzhou-iso-hubin-capture.md) | 3.5 | 2026-11-10 | 2026-11-08。样片范围暂定西湖三公园岸线、湖滨路与东坡路一侧。目标是在同一斜视画面里核对建筑屋顶和立面、岸线树冠、步道与开敞铺装。现有 D… |
| [outdoor-2d-one-flow-2026-11-10.md](plans/outdoor-2d-one-flow-2026-11-10.md) | 9.9 | 2026-11-10 | 日期：2026-11-10 · 分支 feat/outdoor-2d · 作者：协作会话（用户口述需求，AI 整理） |
| [2026-11-08-智能建造验证记录.md](plans/2026-11-08-%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E9%AA%8C%E8%AF%81%E8%AE%B0%E5%BD%95.md) | 34.6 | 2026-11-09 | 本记录对应 codex/chat-integration 工作区，不等于原 main 已提交或上线。产品方向为一个活动 Agent；Bingo、空… |
| [2026-11-09-标注候选应用边界.md](plans/2026-11-09-%E6%A0%87%E6%B3%A8%E5%80%99%E9%80%89%E5%BA%94%E7%94%A8%E8%BE%B9%E7%95%8C.md) | 5.3 | 2026-11-09 | 标注实验目前仅供预览，默认关闭。模拟工作台中，Agent 读取用户绘制的预留区后生成一个冲突物件，界面提示冲突，原场景保持不变。这使用固定模拟回复… |
| [2026-11-09-正式站闭环验收清单.md](plans/2026-11-09-%E6%AD%A3%E5%BC%8F%E7%AB%99%E9%97%AD%E7%8E%AF%E9%AA%8C%E6%94%B6%E6%B8%85%E5%8D%95.md) | 7.4 | 2026-11-09 | 基准是已部署的 main a6143abc（Cloudflare 部署 c641ce56）。本文只规定怎么验收、以及当前代码里还会让闭环失败的位置… |
| [2026-11-09-production-conversation.md](plans/2026-11-09-production-conversation.md) | 3.6 | 2026-11-09 | Supabase Secrets 写入实际返回当前账号没有所需权限。官方要求生产 Secrets 由 Owner 或 Administrator … |
| [HANDOFF-CONVERSATION-DEPLOY.md](plans/HANDOFF-CONVERSATION-DEPLOY.md) | 2.7 | 2026-11-09 | 本文件只记录对话接入这一轨。智能建造、区域协议和其它工作树不在范围内。 |
| [2026-11-07-幕景四个入口与智能建造架构.md](plans/2026-11-07-%E5%B9%95%E6%99%AF%E5%9B%9B%E4%B8%AA%E5%85%A5%E5%8F%A3%E4%B8%8E%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E6%9E%B6%E6%9E%84.md) | 7.6 | 2026-11-08 | 这份图用于共同讨论产品结构。产品决定：只做一个活动 Agent。 Bingo、空间与物料是用户可直接操作、活动 Agent 可逐步调用的工作台与工… |
| [2026-11-07-幕景智能建造闭环图.md](plans/2026-11-07-%E5%B9%95%E6%99%AF%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E9%97%AD%E7%8E%AF%E5%9B%BE.md) | 7.9 | 2026-11-08 | 这是用于讨论和持续修改的设计图，不代表图中每个环节都已经实现。它对应活动策划与空间布置，而不是通用聊天。代码进度以实际运行和测试为准。 |
| [2026-11-07-智能Chat验收清单.md](plans/2026-11-07-%E6%99%BA%E8%83%BDChat%E9%AA%8C%E6%94%B6%E6%B8%85%E5%8D%95.md) | 10 | 2026-11-08 | 配套主计划与 Terra 工程任务单。以下是验收要求，不是已通过清单。执行者填写实际证据与限制；代码、模拟模型、真实模型、真实场地分开记录。 |
| [2026-11-07-智能Chat主计划.md](plans/2026-11-07-%E6%99%BA%E8%83%BDChat%E4%B8%BB%E8%AE%A1%E5%88%92.md) | 11.2 | 2026-11-08 | 2026-11-07 · 供 GPT-6.1 Terra 执行、独立评审者验收。本文是实施计划，不是功能完成声明。 |
| [2026-11-07-Agent能力与工具盘点.md](plans/2026-11-07-Agent%E8%83%BD%E5%8A%9B%E4%B8%8E%E5%B7%A5%E5%85%B7%E7%9B%98%E7%82%B9.md) | 9 | 2026-11-08 | 盘点日期：2026-11-07，工具数量与真实调用状态更新至 2026-11-08。对象是 chat-integration 当前工作区；与原 m… |
| [2026-11-08-幕景总体架构与产品演进路线.md](plans/2026-11-08-%E5%B9%95%E6%99%AF%E6%80%BB%E4%BD%93%E6%9E%B6%E6%9E%84%E4%B8%8E%E4%BA%A7%E5%93%81%E6%BC%94%E8%BF%9B%E8%B7%AF%E7%BA%BF.md) | 7.4 | 2026-11-08 | 状态：规划与工作区核查，2026-11-08。目标是让用户从模糊活动想法出发，在资料不完整时获得可看、可改、可核验和可交接的方案。产品只设一个活动… |
| [brief-request-guard-draft.md](plans/brief-request-guard-draft.md) | 2.1 | 2026-11-08 | 状态：未部署、未接入付费派发。新增专用表与 RPC，不改既有表；默认关闭时旧接口行为保持兼容。设置 BRIEFREQUESTGUARD 为非空且不… |
| [minimax-brief-first-sample-runbook.md](plans/minimax-brief-first-sample-runbook.md) | 4 | 2026-11-08 | 状态：尚未执行真实模型请求。此方案只安排一次合成输入的 /brief/extract，不运行六轮 Agent，不创建或修改真实活动，不部署、不变更… |
| [minimax-budget-transaction-design.md](plans/minimax-budget-transaction-design.md) | 6.9 | 2026-11-08 | 状态：设计草案，没有可部署 RPC，也没有启用真实 MiniMax 工具调用。当前未完成请求与费率策略的可信绑定、跨事务防绕过和真实服务费用核验，… |
| [2026-11-06-智能建造计划-评审版.md](plans/2026-11-06-%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E8%AE%A1%E5%88%92-%E8%AF%84%E5%AE%A1%E7%89%88.md) | 8.3 | 2026-11-06 | 这份文档是给外部评审者看的自包含版本。目标、架构、阶段、验收全部写在这里，不依赖其他内部文档。 |
| [2026-11-06-智能建造究极计划-v2.md](plans/2026-11-06-%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E7%A9%B6%E6%9E%81%E8%AE%A1%E5%88%92-v2.md) | 10 | 2026-11-06 | v1 的问题：太迷恋「生成一个好看布局」。v2 按外部评审升级，北极星推到—— |
| [activity-case-studies-2026-11-05.md](plans/activity-case-studies-2026-11-05.md) | 15.6 | 2026-11-05 | 2026-11-05 ｜ 面向「AI 场地搭建智能体」配方库 ｜ 1 格 = 1 m，与 activity-space-norms-2026-11… |
| [activity-space-norms-2026-11-05.md](plans/activity-space-norms-2026-11-05.md) | 34.3 | 2026-11-05 | 2026-11-05 ｜ 面向「AI 空间搭建智能体」的可执行约束集 ｜ 1 格 = 1 米 |
| [agent-migration-map-2026-11-05.md](plans/agent-migration-map-2026-11-05.md) | 30.1 | 2026-11-05 | --- |
| [ai-spatial-agents-deep-dive-2026-11-05.md](plans/ai-spatial-agents-deep-dive-2026-11-05.md) | 6.9 | 2026-11-05 | 目标：为 TS 后端 + 格子地图 + 物件 footprint 的场地规划智能体找「代码可读、可直接抄」的实现，重点看「模型自由输出 vs 引擎… |
| [ai-spatial-agents-survey-2026-11-05.md](plans/ai-spatial-agents-survey-2026-11-05.md) | 10 | 2026-11-05 | 核验方式：GitHub 页面、论文页、官网直接抓取；star 为抓取当日约数，标「未知」表示未取到可信数字，未做估算。凡搜到的营销页/内容农场（如… |
| [batch10-agent-steering-delivery-2026-11-05.md](plans/batch10-agent-steering-delivery-2026-11-05.md) | 3.1 | 2026-11-05 | 日期 2026-11-05｜依据 docs/plans/petitmaker-agent-teardown-2026-11-05.md §10 第… |
| [batch11-agent-phase-progress-delivery-2026-11-05.md](plans/batch11-agent-phase-progress-delivery-2026-11-05.md) | 2.2 | 2026-11-05 | 日期 2026-11-05｜依据 docs/plans/petitmaker-agent-teardown-2026-11-05.md §10 第… |
| [batch12-validate-receipt-delivery-2026-11-05.md](plans/batch12-validate-receipt-delivery-2026-11-05.md) | 4.1 | 2026-11-05 | 日期 2026-11-05｜来源：并行调研（Voyager / MAC / I-Design / Holodeck / SWE-agent / O… |
| [batch13-agent-phase-persist-delivery-2026-11-05.md](plans/batch13-agent-phase-persist-delivery-2026-11-05.md) | 3.6 | 2026-11-05 | 日期 2026-11-05｜接第 11 批（阶段化进度） |
| [batch7-outcome-audit-delivery-2026-11-05.md](plans/batch7-outcome-audit-delivery-2026-11-05.md) | 13.5 | 2026-11-05 | --- |
| [batch8-agent-run-timeline-delivery-2026-11-05.md](plans/batch8-agent-run-timeline-delivery-2026-11-05.md) | 11.2 | 2026-11-05 | --- |
| [v340-alignment-audit.md](plans/ia-next-prep-2026-11-04/v340-alignment-audit.md) | 1.8 | 2026-11-05 | v3.4.0 主干与 IA 四角色大体对齐：MobileAgentDock 是纯启动器、Lux3D 入库只是后端资产 API、door 矢量化与依… |
| [intergenerational-and-constrained-2026-11-05.md](plans/intergenerational-and-constrained-2026-11-05.md) | 8.4 | 2026-11-05 | 2026-11-05 ｜ 面向「AI 场地搭建智能体」 ｜ 1 格 = 1 m ｜ 取整沿用 activity-space-norms-2026-… |
| [m1-m5-gap-roadmap-2026-11-05.md](plans/m1-m5-gap-roadmap-2026-11-05.md) | 7.1 | 2026-11-05 | --- |
| [petitmaker-agent-teardown-2026-11-05.md](plans/petitmaker-agent-teardown-2026-11-05.md) | 18.5 | 2026-11-05 | 日期：2026-11-05 · 对象：https://petitmaker.com.cn （星布谷地地图编辑器，2D/3D 星球地图） |
| [petitmaker-playtest-2026-11-05.md](plans/petitmaker-playtest-2026-11-05.md) | 13.8 | 2026-11-05 | --- |
| [smart-build-next-phase-2026-11-05.md](plans/smart-build-next-phase-2026-11-05.md) | 35.1 | 2026-11-05 | --- |
| [index.md](plans/ia-next-prep-2026-11-04/index.md) | 9.5 | 2026-11-04 | 日期：2026-11-04 |
| [s2-playbook-and-decisions.md](plans/ia-next-prep-2026-11-04/s2-playbook-and-decisions.md) | 24 | 2026-11-04 | --- |
| [s3-entry-audit.md](plans/ia-next-prep-2026-11-04/s3-entry-audit.md) | 36 | 2026-11-04 | --- |
| [s4-execution-pack.md](plans/ia-next-prep-2026-11-04/s4-execution-pack.md) | 37.5 | 2026-11-04 | 审计日期：2026-11-04（第二轮，在 docs/plans/ia-s1-prep-2026-11-04/s4-cleanup-invento… |
| [ia-role-rework-ledger-2026-11-04.md](plans/ia-role-rework-ledger-2026-11-04.md) | 31.9 | 2026-11-04 | 日期：2026-11-04 |
| [index.md](plans/ia-s1-prep-2026-11-04/index.md) | 14.1 | 2026-11-04 | 日期：2026-11-04 |
| [s11-gallery-card.md](plans/ia-s1-prep-2026-11-04/s11-gallery-card.md) | 27.2 | 2026-11-04 | 日期：2026-11-04 |
| [s2-review-audit.md](plans/ia-s1-prep-2026-11-04/s2-review-audit.md) | 32 | 2026-11-04 | --- |
| [s4-cleanup-inventory.md](plans/ia-s1-prep-2026-11-04/s4-cleanup-inventory.md) | 25.3 | 2026-11-04 | 审计日期：2026-11-04（快照口径，见下「活体漂移警告」） |

## 四、`docs/archive/`（历史，原文不改写）

### 4.1 report/（44 份 md）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [08-Aholo资产与3DGS预览.md](archive/report/08-Aholo%E8%B5%84%E4%BA%A7%E4%B8%8E3DGS%E9%A2%84%E8%A7%88.md) | 8.9 | 2026-11-13 | 仓：C:\Users\13266\.dsh\bot\workspace\Scendance2026 |
| [10-AI场景助理接入.md](archive/report/10-AI%E5%9C%BA%E6%99%AF%E5%8A%A9%E7%90%86%E6%8E%A5%E5%85%A5.md) | 3.6 | 2026-11-13 | 2026-10-02。基于已上线前端分支 codex/scendance-first-launch 的 c727f00，在独立分支… |
| [17-Aholo重建真调排查.md](archive/report/17-Aholo%E9%87%8D%E5%BB%BA%E7%9C%9F%E8%B0%83%E6%8E%92%E6%9F%A5.md) | 8.9 | 2026-11-13 | 读者：产品/技术负责人、Trae（接 T 卡）、后续接力 bot。 |
| [2026-10-02-登录接入.md](archive/report/2026-10-02-%E7%99%BB%E5%BD%95%E6%8E%A5%E5%85%A5.md) | 3.3 | 2026-11-05 | 目标项目：wkhfvnzgopjdzxlmycks。与 CharlesTech 的用户、密钥及邮件服务隔离。 |
| [2026-10-02-项目交接归档.md](archive/report/2026-10-02-%E9%A1%B9%E7%9B%AE%E4%BA%A4%E6%8E%A5%E5%BD%92%E6%A1%A3.md) | 2.9 | 2026-11-05 | 归档于 2026-10-09：本文为 2026-10-02 的交接快照，入口、功能范围与本地验证命令均已由 README 取代，保… |
| [2026-10-09-本轮验证记录.md](archive/report/2026-10-09-%E6%9C%AC%E8%BD%AE%E9%AA%8C%E8%AF%81%E8%AE%B0%E5%BD%95.md) | 8 | 2026-11-05 | 归档于 2026-10-09：本文为 2026-10-02 首次后端配置阶段记录，其中的额度与部署状态已作废，仅用于追溯。当前入口… |
| [2026-10-09-编辑器首次上线.md](archive/report/2026-10-09-%E7%BC%96%E8%BE%91%E5%99%A8%E9%A6%96%E6%AC%A1%E4%B8%8A%E7%BA%BF.md) | 2.4 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-场景模板发布.md](archive/report/2026-10-09-%E5%9C%BA%E6%99%AF%E6%A8%A1%E6%9D%BF%E5%8F%91%E5%B8%83.md) | 5.1 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-独立后端部署.md](archive/report/2026-10-09-%E7%8B%AC%E7%AB%8B%E5%90%8E%E7%AB%AF%E9%83%A8%E7%BD%B2.md) | 8.4 | 2026-11-05 | 本文为原交付过程记录，所述分离工作树路径属于历史环境。当前完整仓库的入口与部署边界见 项目交接（已归档）。 |
| [2026-10-09-访客入口发布.md](archive/report/2026-10-09-%E8%AE%BF%E5%AE%A2%E5%85%A5%E5%8F%A3%E5%8F%91%E5%B8%83.md) | 3.4 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-混元3D启用.md](archive/report/2026-10-09-%E6%B7%B7%E5%85%833D%E5%90%AF%E7%94%A8.md) | 6 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-开放工作台发布.md](archive/report/2026-10-09-%E5%BC%80%E6%94%BE%E5%B7%A5%E4%BD%9C%E5%8F%B0%E5%8F%91%E5%B8%83.md) | 5.7 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-图纸重建发布.md](archive/report/2026-10-09-%E5%9B%BE%E7%BA%B8%E9%87%8D%E5%BB%BA%E5%8F%91%E5%B8%83.md) | 6.5 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-图纸重建验收.md](archive/report/2026-10-09-%E5%9B%BE%E7%BA%B8%E9%87%8D%E5%BB%BA%E9%AA%8C%E6%94%B6.md) | 9.2 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-账户面板发布.md](archive/report/2026-10-09-%E8%B4%A6%E6%88%B7%E9%9D%A2%E6%9D%BF%E5%8F%91%E5%B8%83.md) | 3.7 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-中文模型库整合.md](archive/report/2026-10-09-%E4%B8%AD%E6%96%87%E6%A8%A1%E5%9E%8B%E5%BA%93%E6%95%B4%E5%90%88.md) | 7.8 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-AI助理配置.md](archive/report/2026-10-09-AI%E5%8A%A9%E7%90%86%E9%85%8D%E7%BD%AE.md) | 2.8 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-Binggo资产升级.md](archive/report/2026-10-09-Binggo%E8%B5%84%E4%BA%A7%E5%8D%87%E7%BA%A7.md) | 5.2 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-Cloudflare建站.md](archive/report/2026-10-09-Cloudflare%E5%BB%BA%E7%AB%99.md) | 3.6 | 2026-11-05 | 归档于 2026-10-09：本文为 2026-10-02 首次后端配置阶段记录，其中的 Cloudflare 账号与 Pages… |
| [2026-10-09-debug1003修复.md](archive/report/2026-10-09-debug1003%E4%BF%AE%E5%A4%8D.md) | 10 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-DeepSeek回退.md](archive/report/2026-10-09-DeepSeek%E5%9B%9E%E9%80%80.md) | 5.5 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-DeepSeek上线.md](archive/report/2026-10-09-DeepSeek%E4%B8%8A%E7%BA%BF.md) | 5.1 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-Plan后端审计.md](archive/report/2026-10-09-Plan%E5%90%8E%E7%AB%AF%E5%AE%A1%E8%AE%A1.md) | 15.8 | 2026-11-05 | 归档于 2026-10-09：本文为 2026-10-02 首次后端配置阶段记录，审计对象是当时的实现状态，已被后续发布取代，仅用… |
| [2026-10-09-Plan接口发布.md](archive/report/2026-10-09-Plan%E6%8E%A5%E5%8F%A3%E5%8F%91%E5%B8%83.md) | 7.4 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-09-v041兼容验收.md](archive/report/2026-10-09-v041%E5%85%BC%E5%AE%B9%E9%AA%8C%E6%94%B6.md) | 9.9 | 2026-11-05 | 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 README，当前… |
| [2026-10-28-T-Aholo物料入口.md](archive/report/2026-10-28-T-Aholo%E7%89%A9%E6%96%99%E5%85%A5%E5%8F%A3.md) | 4.1 | 2026-11-05 | 开卡日期：2026-10-28 |
| [2026-10-30-D0地图圈画验收.md](archive/report/2026-10-30-D0%E5%9C%B0%E5%9B%BE%E5%9C%88%E7%94%BB%E9%AA%8C%E6%94%B6.md) | 3.5 | 2026-11-05 | 2026-11-05 口径修正：本文记录 2026-10-30 历史界面；「左轨『地图』/ 地图圈画」已并入场景地面层锚定，不再是… |
| [2026-10-30-D1采集上传验收.md](archive/report/2026-10-30-D1%E9%87%87%E9%9B%86%E4%B8%8A%E4%BC%A0%E9%AA%8C%E6%94%B6.md) | 4 | 2026-11-05 | 2026-11-05 口径修正：本文记录 2026-10-30 历史界面；「左轨『地图』」已并入场景地面层锚定，不再是独立入口。现… |
| [2026-10-30-D1流线站位验收.md](archive/report/2026-10-30-D1%E6%B5%81%E7%BA%BF%E7%AB%99%E4%BD%8D%E9%AA%8C%E6%94%B6.md) | 2.1 | 2026-11-05 | 2026-11-05 口径修正：本文记录 2026-10-30 历史界面；「左轨地图 / 地图圈画」已并入场景地面层锚定，不再是独… |
| [2026-10-30-D2场地观感验收.md](archive/report/2026-10-30-D2%E5%9C%BA%E5%9C%B0%E8%A7%82%E6%84%9F%E9%AA%8C%E6%94%B6.md) | 1.7 | 2026-11-05 | 2026-11-05 口径修正：本文记录 2026-10-30 历史界面；「地图演示圈画」已并入场景地面层锚定，不再是独立入口或独… |
| [2026-10-30-D2真重建验收.md](archive/report/2026-10-30-D2%E7%9C%9F%E9%87%8D%E5%BB%BA%E9%AA%8C%E6%94%B6.md) | 2.4 | 2026-11-05 | 仓：本机 Scendance2026 · 未 commit / push · 不开云端 |
| [2026-10-30-D3轮廓壳体验收.md](archive/report/2026-10-30-D3%E8%BD%AE%E5%BB%93%E5%A3%B3%E4%BD%93%E9%AA%8C%E6%94%B6.md) | 2.7 | 2026-11-05 | 2026-11-05 口径修正：本文记录 2026-10-30 历史界面；「左轨地图 / 地图圈画」已并入场景地面层锚定，卫星贴地… |
| [2026-10-31-T-3D验收细节.md](archive/report/2026-10-31-T-3D%E9%AA%8C%E6%94%B6%E7%BB%86%E8%8A%82.md) | 4.5 | 2026-11-05 | 领队：平面图转3D空间 · 只写规格，不改本地 Scendance2026 |
| [2026-11-01-十八席会诊.md](archive/report/2026-11-01-%E5%8D%81%E5%85%AB%E5%B8%AD%E4%BC%9A%E8%AF%8A.md) | 15.9 | 2026-11-05 | 评估对象：Scendance2026（v3.0.1，2026-11-01 工作区现状） |
| [2026-11-03-三态文案审计.md](archive/report/2026-11-03-%E4%B8%89%E6%80%81%E6%96%87%E6%A1%88%E5%AE%A1%E8%AE%A1.md) | 25.1 | 2026-11-05 | 范围：frontend/ 下所有 .tsx / .ts 中面向用户的「空 / 加载 / 错误」三态文案（排除 nodemodule… |
| [2026-11-04-测试构建健康度.md](archive/report/2026-11-04-%E6%B5%8B%E8%AF%95%E6%9E%84%E5%BB%BA%E5%81%A5%E5%BA%B7%E5%BA%A6.md) | 10.7 | 2026-11-05 | 结论：当前不能作为可发布基线。 vitest 256 个套件里 14 个红（一轮全量 43 条用例失败，复跑并行任务新引入的在线模… |
| [2026-11-04-交付能力审计.md](archive/report/2026-11-04-%E4%BA%A4%E4%BB%98%E8%83%BD%E5%8A%9B%E5%AE%A1%E8%AE%A1.md) | 27.7 | 2026-11-05 | 范围：多角度效果图、场景漫游、物料清单、方案分享、客户评审、执行资料导出。 |
| [2026-11-04-项目清理记录.md](archive/report/2026-11-04-%E9%A1%B9%E7%9B%AE%E6%B8%85%E7%90%86%E8%AE%B0%E5%BD%95.md) | 16.4 | 2026-11-05 | 第一轮：盘点 + 仅删低风险项。未使用 git clean -f / git reset --hard，未提交、未推送。 |
| [2026-11-04-GoldenPath体检.md](archive/report/2026-11-04-GoldenPath%E4%BD%93%E6%A3%80.md) | 12.2 | 2026-11-05 | 方式：隔离快照（独立 .next，端口 3300）真实点击，playwright 走查；只读源码，未改源码、未 commit/pu… |
| [2026-11-05-地图圈画偏移.md](archive/report/2026-11-05-%E5%9C%B0%E5%9B%BE%E5%9C%88%E7%94%BB%E5%81%8F%E7%A7%BB.md) | 2.7 | 2026-11-05 | 2026-11-05 口径修正：地图是场景地面层，不是独立入口或独立定位状态；本文的「地图选址 / 圈画」按场景地面层锚定理解。偏… |
| [30-SC04-场地输入核对.md](archive/report/30-SC04-%E5%9C%BA%E5%9C%B0%E8%BE%93%E5%85%A5%E6%A0%B8%E5%AF%B9.md) | 20.8 | 2026-11-13 | 验收要求（SC-04 卡原文）：对已知尺寸场地复测至少 3 处；未确认比例或门信息时，页面明确显示其状态。 |
| [31-SC05-保存恢复核对.md](archive/report/31-SC05-%E4%BF%9D%E5%AD%98%E6%81%A2%E5%A4%8D%E6%A0%B8%E5%AF%B9.md) | 22.1 | 2026-11-13 | 原文验收点：刷新恢复同版数据；无访问权的会话看不到私有内容；缺资产有定位信息，失败后可重试或回到可编辑草稿。 |
| [34-依赖漏洞分类清点.md](archive/report/34-%E4%BE%9D%E8%B5%96%E6%BC%8F%E6%B4%9E%E5%88%86%E7%B1%BB%E6%B8%85%E7%82%B9.md) | 21.9 | 2026-11-13 | 执行日期 2026-11-07；执行者 ZCode（Agent）。本文为本次唯一新增文件，未改动任何代码、未执行 git 提交。 |
| [35-XH02-单段重建回执.md](archive/report/35-XH02-%E5%8D%95%E6%AE%B5%E9%87%8D%E5%BB%BA%E5%9B%9E%E6%89%A7.md) | 3.9 | 2026-11-13 | 执行者：ZCode 会话（用户当面确认「0233 双档」后发起；0233 被 2 GiB 上限拒收后按 docs/33 对照候选顺… |

### 4.2 plan/（37 份 md）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [18-T-Aholo重建链路修复与复验.md](archive/plan/18-T-Aholo%E9%87%8D%E5%BB%BA%E9%93%BE%E8%B7%AF%E4%BF%AE%E5%A4%8D%E4%B8%8E%E5%A4%8D%E9%AA%8C.md) | 3.5 | 2026-11-13 | 上一棒：DSH bot（2026-11-05 真调排查，10 任务全败于 Aholo 后端，见 docs/17）。 |
| [20-场地资产地理底图提案.md](archive/plan/20-%E5%9C%BA%E5%9C%B0%E8%B5%84%E4%BA%A7%E5%9C%B0%E7%90%86%E5%BA%95%E5%9B%BE%E6%8F%90%E6%A1%88.md) | 10.1 | 2026-11-13 | 2026-11-05。西湖茶亭视频重建 2/2 成功（极速 3FO4K4RKIQ9S / 标准 3FO4K4RKK337，证据 d… |
| [2026-10-07-分阶段产品计划.md](archive/plan/2026-10-07-%E5%88%86%E9%98%B6%E6%AE%B5%E4%BA%A7%E5%93%81%E8%AE%A1%E5%88%92.md) | 6.2 | 2026-11-05 | 2026-10-07。用户已确认完整优化方向。长期目标是文化与品牌项目的空间体验设计、数字预演和制作协作；近期按创意方案、客户评审… |
| [2026-10-07-工作区模式.md](archive/plan/2026-10-07-%E5%B7%A5%E4%BD%9C%E5%8C%BA%E6%A8%A1%E5%BC%8F.md) | 13.8 | 2026-11-05 | 2026-10-07。用户直接要求按成熟案例确定目标并执行，保证好用，最重要内容先呈现；同时提出可放大缩小，并反馈选择椅子后无说明… |
| [2026-10-07-活动执行契约.md](archive/plan/2026-10-07-%E6%B4%BB%E5%8A%A8%E6%89%A7%E8%A1%8C%E5%A5%91%E7%BA%A6.md) | 15.7 | 2026-11-05 | 2026-10-07。本地共享契约及前端活动安排已接入；云接口和迁移尚未实施。 当前功能、验证与限制见 （已失效：../DELIV… |
| [2026-10-07-交付恢复核查.md](archive/plan/2026-10-07-%E4%BA%A4%E4%BB%98%E6%81%A2%E5%A4%8D%E6%A0%B8%E6%9F%A5.md) | 3.6 | 2026-11-05 | 2026-10-07。只读核对当前前端源码，并用实际模块和独立合成演练验证；前端仍由其负责人修改。新检查脚本位于 check-lo… |
| [2026-10-07-最小交付契约.md](archive/plan/2026-10-07-%E6%9C%80%E5%B0%8F%E4%BA%A4%E4%BB%98%E5%A5%91%E7%BA%A6.md) | 30.6 | 2026-11-05 | 最新范围（2026-10-07）：普通物料场景的本地执行工作单和可审阅导出已实现，复用既有编辑与持久化。下文云交付方案保留为后续候… |
| [2026-10-07-Agent开源参考.md](archive/plan/2026-10-07-Agent%E5%BC%80%E6%BA%90%E5%8F%82%E8%80%83.md) | 19.4 | 2026-11-05 | 本记录从2026-10-07开始，保留各阶段的研究、实现与验证。用户明确要求学习 AIHOT、DeepSeek Harness 的… |
| [2026-10-08-场景对话同屏.md](archive/plan/2026-10-08-%E5%9C%BA%E6%99%AF%E5%AF%B9%E8%AF%9D%E5%90%8C%E5%B1%8F.md) | 4.6 | 2026-11-05 | 本轮目标是让用户提出需求、查看场景、核对修改并确认应用时，始终知道自己正在操作什么。首先调整界面布局，沿用现有场景、资料、提案和保… |
| [2026-10-08-场景活动备份.md](archive/plan/2026-10-08-%E5%9C%BA%E6%99%AF%E6%B4%BB%E5%8A%A8%E5%A4%87%E4%BB%BD.md) | 41.3 | 2026-11-05 | 2026-10-08 更新为 V2。文件模块位于 frontend/lib/local-project-backup.ts，恢复布… |
| [2026-10-08-对话状态检查.md](archive/plan/2026-10-08-%E5%AF%B9%E8%AF%9D%E7%8A%B6%E6%80%81%E6%A3%80%E6%9F%A5.md) | 3.8 | 2026-11-05 | 2026-10-08 用户试用反馈：展开后右下角开关消失、助手设置应靠近输入框、重开聊天后出现执行交付且无法输入。 |
| [2026-10-08-制作计划契约.md](archive/plan/2026-10-08-%E5%88%B6%E4%BD%9C%E8%AE%A1%E5%88%92%E5%A5%91%E7%BA%A6.md) | 10.4 | 2026-11-05 | 2026-10-08定义共享契约；2026-10-09已接入前端类型、界面、本地保存、V2备份恢复、公开分享剥离和云转换保护，并提… |
| [2026-10-09-本地场景服务.md](archive/plan/2026-10-09-%E6%9C%AC%E5%9C%B0%E5%9C%BA%E6%99%AF%E6%9C%8D%E5%8A%A1.md) | 7.2 | 2026-11-05 | 目的：同一活动在建立执行资料后，继续用助手规划空间、调整单件和处理图纸。本地活动编号不变，远端项目只用于场景处理；它不等于整场活动… |
| [2026-10-09-成果流程借鉴.md](archive/plan/2026-10-09-%E6%88%90%E6%9E%9C%E6%B5%81%E7%A8%8B%E5%80%9F%E9%89%B4.md) | 4.9 | 2026-11-05 | 2026-10-09。依据用户提供的37页企业手册，重点核对第16、17、24、25、29页的文字与第16、17页界面。以下是产品… |
| [2026-10-09-客户方案评审.md](archive/plan/2026-10-09-%E5%AE%A2%E6%88%B7%E6%96%B9%E6%A1%88%E8%AF%84%E5%AE%A1.md) | 24.4 | 2026-11-05 | 现有客户评审入口新增「本机草稿与文件」。两段手写说明可显式保存、载入或放弃，按服务地址、账号和活动编号隔离。载入只恢复文字，公开范… |
| [2026-10-09-物料点验契约.md](archive/plan/2026-10-09-%E7%89%A9%E6%96%99%E7%82%B9%E9%AA%8C%E5%A5%91%E7%BA%A6.md) | 6.3 | 2026-11-05 | 2026-10-09。独立事实账册，共享契约已实现，集成由整合者负责。不进入RoomLayout、设计快照、几何撤销、公开分享或A… |
| [2026-10-09-制作计划导出.md](archive/plan/2026-10-09-%E5%88%B6%E4%BD%9C%E8%AE%A1%E5%88%92%E5%AF%BC%E5%87%BA.md) | 10 | 2026-11-05 | 2026-10-09。当前接口为 frontend/lib/production-plan-export.ts 的异步函数 pro… |
| [2026-10-09-专业能力依据.md](archive/plan/2026-10-09-%E4%B8%93%E4%B8%9A%E8%83%BD%E5%8A%9B%E4%BE%9D%E6%8D%AE.md) | 5.5 | 2026-11-05 | 2026-10-09。用户明确要求：专业问题必须先找专业Skill，不由Agent自行编造行业规则。本记录约束后续活动、商务与市场… |
| [2026-10-10-活动任务接模型.md](archive/plan/2026-10-10-%E6%B4%BB%E5%8A%A8%E4%BB%BB%E5%8A%A1%E6%8E%A5%E6%A8%A1%E5%9E%8B.md) | 18.9 | 2026-11-05 | 2026-10-10。本文保存已完成的只读调查，供后续指定 owner 实施；不是已上线接口或已完成的 Agent 流程。本轮只新… |
| [2026-10-10-AIHOT源码采用.md](archive/plan/2026-10-10-AIHOT%E6%BA%90%E7%A0%81%E9%87%87%E7%94%A8.md) | 14.9 | 2026-11-05 | 2026-10-10。研究与首项实施范围已确认；本记录不代表产品改进已经完成。第一项由现有前端 owner 实施，后端状态和应用契… |
| [2026-10-10-PetitMaker-Agent.md](archive/plan/2026-10-10-PetitMaker-Agent.md) | 24.4 | 2026-11-05 | 2026-10-10。完成指定版本的完整 Agent 链路调查，并实施两个后端增量：checkpoint 持久化异常停止后续模型/… |
| [2026-10-10-PetitMaker差距.md](archive/plan/2026-10-10-PetitMaker%E5%B7%AE%E8%B7%9D.md) | 13.5 | 2026-11-05 | 2026-10-10。固定上游为 4e120e50c844198649454eec6069ac65a062a732，读取本机 C:… |
| [2026-10-10-PetitMaker成果.md](archive/plan/2026-10-10-PetitMaker%E6%88%90%E6%9E%9C.md) | 25.9 | 2026-11-05 | 2026-10-10。本文接续已冻结的 UI 与许可研究，只查成果、数据和失败处理，不重复前五个界面机制或后端 Agent loo… |
| [2026-10-10-PetitMaker路线.md](archive/plan/2026-10-10-PetitMaker%E8%B7%AF%E7%BA%BF.md) | 5.6 | 2026-11-05 | 2026-10-10。用户明确：素材移到底部只是举例，其他能改善使用与执行的机制也可以改，包括后端 Agent。沿现有开发目标推进… |
| [2026-10-10-PetitMaker源码.md](archive/plan/2026-10-10-PetitMaker%E6%BA%90%E7%A0%81.md) | 13.6 | 2026-11-05 | 2026-10-10。供幕景界面取舍使用的只读研究，尚未实施UI迁移或体验验收。检查对象是 C:/幕景/upstream-refe… |
| [2026-10-10-TapTap参考.md](archive/plan/2026-10-10-TapTap%E5%8F%82%E8%80%83.md) | 4.1 | 2026-11-05 | 2026-10-10。用户要求看TapTap做游戏的方式与引擎，作为幕景参考。此次只读官方产品、SDK/Skill及公开工具源码，… |
| [2026-10-16-AI原生升级.md](archive/plan/2026-10-16-AI%E5%8E%9F%E7%94%9F%E5%8D%87%E7%BA%A7.md) | 20.4 | 2026-11-05 | 用途：给后续实现模型/工程师的机器可读 + 人可读交接规格。 |
| [2026-10-27-活动流程AI原生.md](archive/plan/2026-10-27-%E6%B4%BB%E5%8A%A8%E6%B5%81%E7%A8%8BAI%E5%8E%9F%E7%94%9F.md) | 11 | 2026-11-05 | 【过程稿 · 已作废 · 2026-11-03】 本文的 IP 与左轨方案（晴光 / 三图标）已被 Bingo / 四形体左轨取代… |
| [2026-10-27-Agent框架选型.md](archive/plan/2026-10-27-Agent%E6%A1%86%E6%9E%B6%E9%80%89%E5%9E%8B.md) | 4.6 | 2026-11-05 | 背景：布置 Agent 此前为纯客户端规则状态机，对话失配即归零、陷入重复提问。2026-10-27 已落地规则加固（brief-… |
| [2026-10-28-Aholo集成规划.md](archive/plan/2026-10-28-Aholo%E9%9B%86%E6%88%90%E8%A7%84%E5%88%92.md) | 11.9 | 2026-11-05 | 本文是 Aholo(群核科技)Lux3D / World API 接入幕景 Scendance2026 的总入口规划,遵循仓库规格… |
| [2026-10-29-09-Taste与IA备忘录(SCOPED).md](archive/plan/2026-10-29-09-Taste%E4%B8%8EIA%E5%A4%87%E5%BF%98%E5%BD%95%28SCOPED%29.md) | 18.9 | 2026-11-05 | Scope: public product references + opinionated KEEP/KILL for firs… |
| [2026-11-02-空间物料Chat设计.md](archive/plan/2026-11-02-%E7%A9%BA%E9%97%B4%E7%89%A9%E6%96%99Chat%E8%AE%BE%E8%AE%A1.md) | 12.2 | 2026-11-05 | 2026-11-02 · 状态：设计稿，未实现 |
| [2026-11-04-新手指引重写.md](archive/plan/2026-11-04-%E6%96%B0%E6%89%8B%E6%8C%87%E5%BC%95%E9%87%8D%E5%86%99.md) | 12.1 | 2026-11-05 | 2026-11-05 口径：地图是场景的地面层，不是独立入口、独立搜索或独立定位状态。 文中旧称「地图选址 / 地图圈画」一律改称… |
| [2026-11-04-Agent空间能力.md](archive/plan/2026-11-04-Agent%E7%A9%BA%E9%97%B4%E8%83%BD%E5%8A%9B.md) | 25.1 | 2026-11-05 | 范围：只审计 workbench-agent.ts 与 agent-proposal.ts，以及它们被 agent-panel.t… |
| [2026-11-04-GoldenPath规格.md](archive/plan/2026-11-04-GoldenPath%E8%A7%84%E6%A0%BC.md) | 10.3 | 2026-11-05 | 目标：普通用户 10 分钟内完成一次真实空间创作，结果可直接发给潜在客户。 |
| [original-scene-edit-design.md](archive/plan/original-scene-edit-design.md) | 1.9 | 2026-11-13 | 当前状态：普通项目与分享读取返回中性只读投影；若投影不同于原始场景，旧接口的取编辑权、保存、提案应用和生成均保守拒绝。项目成员可在… |
| [reconstruction-edit-review-design.md](archive/plan/reconstruction-edit-review-design.md) | 3.9 | 2026-11-13 | 状态：隔离实验，尚未接入应用，也没有数据库迁移。人工修改继续暂停。 |

### 4.3 visual/（2 份 md）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [2026-10-31-视觉方向.md](archive/visual/2026-10-31-%E8%A7%86%E8%A7%89%E6%96%B9%E5%90%91.md) | 3.8 | 2026-11-05 | 状态：待用户点头 · 未点头不改产品仓代码 |
| [2026-11-03-视觉稿说明.md](archive/visual/2026-11-03-%E8%A7%86%E8%A7%89%E7%A8%BF%E8%AF%B4%E6%98%8E.md) | 1.3 | 2026-11-05 | 【过程稿 · 已作废 · 2026-11-03】 仅作历史对照，不代表当前实现；以 design-spec-2026 为准。 |

### 4.4 research/（15 份 md）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [2026-10-25-3DGS调研.md](archive/research/2026-10-25-3DGS%E8%B0%83%E7%A0%94.md) | 5.4 | 2026-11-05 | 定稿同步自 Cursor Page（2026-10-25）。splat = 观感层；布置真相仍是 glTF。未点头不进产品代码。 |
| [2026-10-27-Agent在场感.md](archive/research/2026-10-27-Agent%E5%9C%A8%E5%9C%BA%E6%84%9F.md) | 7.6 | 2026-11-05 | 日期：2026-10-27（Asia/Shanghai） |
| [2026-11-01-场景脚本评审.md](archive/research/2026-11-01-%E5%9C%BA%E6%99%AF%E8%84%9A%E6%9C%AC%E8%AF%84%E5%AE%A1.md) | 49.4 | 2026-11-05 | 只读探测，不写任何文件。全部实测脚本都用这一套；PowerShell 会剥掉双引号，所以 JS 里只用单引号。 |
| [2026-11-01-生成机制收口.md](archive/research/2026-11-01-%E7%94%9F%E6%88%90%E6%9C%BA%E5%88%B6%E6%94%B6%E5%8F%A3.md) | 21.2 | 2026-11-05 | 2026-11-01 ｜ 基线：线上 3.0.0（https://scendance-scene-planner-ewz.page… |
| [2026-11-01-生成链路基线.md](archive/research/2026-11-01-%E7%94%9F%E6%88%90%E9%93%BE%E8%B7%AF%E5%9F%BA%E7%BA%BF.md) | 18.9 | 2026-11-05 | 只读审计：不改业务代码、不提交、不部署。工作树含未提交在研改动（frontend/components/room-organize… |
| [2026-11-01-生成链路索引.md](archive/research/2026-11-01-%E7%94%9F%E6%88%90%E9%93%BE%E8%B7%AF%E7%B4%A2%E5%BC%95.md) | 1.7 | 2026-11-05 | 一句话 → 计划工件 → 确定性校验 → 一次终态提交。结论与规格见各篇；本仓只文档，场景脚本代码不在本仓。 |
| [2026-11-01-五系统交叉验证.md](archive/research/2026-11-01-%E4%BA%94%E7%B3%BB%E7%BB%9F%E4%BA%A4%E5%8F%89%E9%AA%8C%E8%AF%81.md) | 33.1 | 2026-11-05 | 目的：拿外部系统验证我们从 PetitMaker / oddeNova 提炼的共性，并找出幕景 3.0 还缺的机制。 |
| [2026-11-01-音乐生成链路.md](archive/research/2026-11-01-%E9%9F%B3%E4%B9%90%E7%94%9F%E6%88%90%E9%93%BE%E8%B7%AF.md) | 47.7 | 2026-11-05 | 研究日期：2026-11-01 ｜ 研究人：oddenova-analyst（Team task-2）｜ 目的：为幕景 Scend… |
| [2026-11-01-智能建造链路.md](archive/research/2026-11-01-%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E9%93%BE%E8%B7%AF.md) | 50.6 | 2026-11-05 | 本报告只回答一个问题：「一句自然语言 / 一个配方参数」是怎么变成「地图上真实的建造结果」的，并把这条链路拆成幕景可以对齐的阶段。… |
| [2026-11-04-3D重建路线.md](archive/research/2026-11-04-3D%E9%87%8D%E5%BB%BA%E8%B7%AF%E7%BA%BF.md) | 43.3 | 2026-11-05 | 日期：2026-11-04 |
| [2026-11-04-素材核查缺口.md](archive/research/2026-11-04-%E7%B4%A0%E6%9D%90%E6%A0%B8%E6%9F%A5%E7%BC%BA%E5%8F%A3.md) | 26 | 2026-11-05 | 核查范围：scene-3d/（32 个文件，206,311,868 B） |
| [2026-11-04-协作模式调研.md](archive/research/2026-11-04-%E5%8D%8F%E4%BD%9C%E6%A8%A1%E5%BC%8F%E8%B0%83%E7%A0%94.md) | 21.7 | 2026-11-05 | 只读调研，未改代码。日期：2026-11-04。来源见文末，不确定处已标注。 |
| [2026-11-04-Agent与人协作.md](archive/research/2026-11-04-Agent%E4%B8%8E%E4%BA%BA%E5%8D%8F%E4%BD%9C.md) | 22.3 | 2026-11-05 | 日期：2026-11-04 · 范围：只读研究 + 最小一步代码落地（未提交、未推送） |
| [2026-11-04-GoldenPath缺口.md](archive/research/2026-11-04-GoldenPath%E7%BC%BA%E5%8F%A3.md) | 16.3 | 2026-11-05 | 输入：01-素材核查与采集缺口.md、02-3D重建技术路线调研.md（03-agent-空间能力设计.md 不存在，Agent … |
| [38-Taste与IA备忘录.md](archive/research/38-Taste%E4%B8%8EIA%E5%A4%87%E5%BF%98%E5%BD%95.md) | 18.9 | 2026-11-13 | Scope: public product references + opinionated KEEP/KILL for firs… |

### 4.5 legacy/（9 份 md）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [2026-10-02-本地运行与维护.md](archive/legacy/2026-10-02-%E6%9C%AC%E5%9C%B0%E8%BF%90%E8%A1%8C%E4%B8%8E%E7%BB%B4%E6%8A%A4.md) | 11.7 | 2026-11-05 | 本说明适用于工作区根目录后端。第 1–2 节是可直接执行的本地运行与构建步骤；第 3–4 节是 2026-10-02 首次云端部署… |
| [2026-10-07-Cloudflare部署.md](archive/legacy/2026-10-07-Cloudflare%E9%83%A8%E7%BD%B2.md) | 8.1 | 2026-11-16 | 记录日期：2026-10-07（Asia/Seoul）。 |
| [2026-10-29-AI接力手册.md](archive/legacy/2026-10-29-AI%E6%8E%A5%E5%8A%9B%E6%89%8B%E5%86%8C.md) | 26.7 | 2026-11-10 | 给下一任 AI / 云 Agent / Cursor Agent 的完整交接。 |
| [2026-11-02-版本更新文案.md](archive/legacy/2026-11-02-%E7%89%88%E6%9C%AC%E6%9B%B4%E6%96%B0%E6%96%87%E6%A1%88.md) | 7.5 | 2026-11-05 | 这份规范管一件事：每个版本的更新记录要写到用户能直接看懂、能照着点一遍的程度。 |
| [2026-11-04-晴光IP还原锚.md](archive/legacy/2026-11-04-%E6%99%B4%E5%85%89IP%E8%BF%98%E5%8E%9F%E9%94%9A.md) | 4.7 | 2026-11-05 | 来源（本机，勿再到 /workspace 找）： |
| [2026-11-04-提供商配置.md](archive/legacy/2026-11-04-%E6%8F%90%E4%BE%9B%E5%95%86%E9%85%8D%E7%BD%AE.md) | 3.4 | 2026-11-05 | 目标项目：wkhfvnzgopjdzxlmycks。最新接口复核与发布归属见 PLANAPIRELEASE.md。用户已授权与图纸… |
| [2026-11-04-邮件验证码找回.md](archive/legacy/2026-11-04-%E9%82%AE%E4%BB%B6%E9%AA%8C%E8%AF%81%E7%A0%81%E6%89%BE%E5%9B%9E.md) | 4.4 | 2026-11-05 | 目标项目：wkhfvnzgopjdzxlmycks。前端基于用户确认的 codex/complete-project-versio… |
| [2026-11-04-自建Supabase教程.md](archive/legacy/2026-11-04-%E8%87%AA%E5%BB%BASupabase%E6%95%99%E7%A8%8B.md) | 12.6 | 2026-11-05 | 目标项目：wkhfvnzgopjdzxlmycks |
| [2026-11-04-DeepSeek发布操作.md](archive/legacy/2026-11-04-DeepSeek%E5%8F%91%E5%B8%83%E6%93%8D%E4%BD%9C.md) | 4.6 | 2026-11-05 | 辅助脚本 scripts/deepseek-release.py 只针对项目 wkhfvnzgopjdzxlmycks。inspe… |

### 4.6 example/（1 份 md）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [2026-10-14-开放日样例.md](archive/example/2026-10-14-%E5%BC%80%E6%94%BE%E6%97%A5%E6%A0%B7%E4%BE%8B.md) | 8.4 | 2026-11-05 | 2026-10-07。实际活动尚未确定；按用户授权建立可替换的假设，用来检验幕景能否帮助两人承接并执行一场活动。以下日期、场地、角… |

## 五、`docs/evidence/`（证据，md 部分）

体量：本地 1226 个文件 / 2871 MB，其中 `aholo/` 占 2374 MB（`.glb/.spz` 重建素材，不是验收证据）；入库 undefined 个文件，其余被 `.gitignore` 白名单挡在版本控制外。

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [2026-11-04-混元资产核查.md](evidence/2026-11-04-%E6%B7%B7%E5%85%83%E8%B5%84%E4%BA%A7%E6%A0%B8%E6%9F%A5.md) | 3.4 | 2026-11-05 | 日期：2026-10-03。范围：仓库内 5 个实际 GLB；未发起付费生成，未访问腾讯控制台或改变供应商。 |
| [2026-11-18-live-build-review-round5.md](evidence/79/00/2026-11-18-live-build-review-round5.md) | 4.7 | 2026-11-19 | 补充 2026-11-18-live-build-review.md（c778 构建）。第四轮留档记「runtime 已轮换到 w… |
| [2026-11-18-live-build-review.md](evidence/79/00/2026-11-18-live-build-review.md) | 6.3 | 2026-11-18 | 目的：闭合上一轮留下的缺口——「当前线上 runtime 已换，扫 chunk 未命中标记，无法确认线上构建含三处修复」。 |
| [2026-11-19-deploy-gap.md](evidence/79/00/2026-11-19-deploy-gap.md) | 5.7 | 2026-11-19 | 2026-11-19 已解决：scene-api 本轮发到 v64，随后观测到 v65（01:46:40Z，非本轮操作）；2026… |
| [2026-11-19-deploy-resolution.md](evidence/79/00/2026-11-19-deploy-resolution.md) | 5.5 | 2026-11-19 | 对应缺口：2026-11-19-deploy-gap.md。本文只记本轮实际做了什么、读到了什么、哪些仍没做。 |
| [2026-11-19-case01-round6.md](evidence/79/01/2026-11-19-case01-round6.md) | 3.6 | 2026-11-19 | 口径：正式站 + 真实云端 + 真实账号；台架 docs/evidence/79/tools/case-01-09-blank-u… |
| [2026-11-19-case01-round7.md](evidence/79/01/2026-11-19-case01-round7.md) | 3.7 | 2026-11-19 | 口径：正式站 + 真实账号 + 真实云端；台架 docs/evidence/79/tools/case-01-blank-mate… |
| [2026-11-19-case01-v10-formal.md](evidence/79/01/2026-11-19-case01-v10-formal.md) | 4.4 | 2026-11-20 | 1. 新开无痕浏览器，进入站点；云端找回弹窗选择「先不用」，本机空白活动 house-... 为 0 分区 / 0 边界 / 16… |
| [2026-11-19-case01-v8.md](evidence/79/01/2026-11-19-case01-v8.md) | 2 | 2026-11-19 | 结论：仍为 partial。空白项目和组合需求已复现；当前站点把“杭州湖滨银泰in77 … 户外广场”解析成“湖滨银泰in77 广… |
| [2026-11-19-case01-v9-local.md](evidence/79/01/2026-11-19-case01-v9-local.md) | 3.7 | 2026-11-19 | 本地构建通过到「范围确认」，但还不是正式站/云端 pass。 |
| [2026-11-18-case02-same-name-poi.md](evidence/79/02/2026-11-18-case02-same-name-poi.md) | 8.3 | 2026-11-18 | 口径：三类证据（固定数据 / 真实浏览器 / 真实云端）。本文件只登记真实浏览器与真实云端两列的读数； |
| [2026-11-18-case02-selection-readback.md](evidence/79/02/2026-11-18-case02-selection-readback.md) | 2.7 | 2026-11-18 | 承接第三轮 2026-11-18-case02-same-name-poi.md。上一轮抓取窗口漏了「选中之后有没有 projec… |
| [2026-11-18-case03-blocked.md](evidence/79/03/2026-11-18-case03-blocked.md) | 0.8 | 2026-11-18 | 结论：blocked，浏览器列 / 云端列均未取得真机证据。 |
| [2026-11-18-case03-round5-supplement.md](evidence/79/03/2026-11-18-case03-round5-supplement.md) | 2.1 | 2026-11-19 | 第四轮 blocked 登记见 2026-11-18-case03-blocked.md。本轮在边界非空的活动 A 上发出了明确的… |
| [2026-11-19-case04-v10-formal.md](evidence/79/04/2026-11-19-case04-v10-formal.md) | 5.6 | 2026-11-20 | 从云端找回弹窗打开 house-lrvrntin（行文本 新活动场地 / 版本 4 · 11/19 19:04）： |
| [2026-11-19-case04-v2-v5.md](evidence/79/04/2026-11-19-case04-v2-v5.md) | 3.4 | 2026-11-19 | 结论：仍为 partial。v5 从已保存的 v4 云端草稿继续，预算句已得到“已记下整体活动预算 20 万元”，但人数句明确失败… |
| [2026-11-19-case04-v9-local.md](evidence/79/04/2026-11-19-case04-v9-local.md) | 2.5 | 2026-11-19 | 本地构建通过「只改人数、不动现有分区」；云端仍未写，故不判正式 pass。 |
| [2026-11-18-case05-cdp-offline-supplement.md](evidence/79/05/2026-11-18-case05-cdp-offline-supplement.md) | 3.3 | 2026-11-18 | 承接 2026-11-18-case05-offline.md。上一轮断网只做到页面级 fetch/XHR/onLine 注入，<… |
| [2026-11-18-case05-offline.md](evidence/79/05/2026-11-18-case05-offline.md) | 9.5 | 2026-11-18 | 结论：浏览器列 partial（不构成通过）、云端列未声明。 |
| [2026-11-18-case06-blocked.md](evidence/79/06/2026-11-18-case06-blocked.md) | 0.8 | 2026-11-18 | 结论：blocked，四类阻塞本轮均未分别触发，未取得界面文案证据。 |
| [2026-11-19-case06-not-logged-in.md](evidence/79/06/2026-11-19-case06-not-logged-in.md) | 4.3 | 2026-11-19 | 口径：正式站 + 真实浏览器 + 无任何会话（不注入 cookie、不注入 localStorage） |
| [2026-11-19-case06-trigger-runbook.md](evidence/79/06/2026-11-19-case06-trigger-runbook.md) | 14.5 | 2026-11-19 | 口径：只读 runbook。本轮只读代码与文档，没有改任何云端环境变量、没有部署、没有重新构建前端、没有提交。 |
| [2026-11-18-case07-blocked-no-proposal.md](evidence/79/07/2026-11-18-case07-blocked-no-proposal.md) | 3.7 | 2026-11-18 | 这一轮在正式站带登录态尝试推进提案链（7 → 8 → 9）与 3、6 真机复核，全部停在前置条件不满足，按清单 §6 记 bloc… |
| [2026-11-18-case07-round5-supplement.md](evidence/79/07/2026-11-18-case07-round5-supplement.md) | 5.2 | 2026-11-19 | 第四轮 blocked 登记见 2026-11-18-case07-blocked-no-proposal.md。本轮在正式站带登… |
| [2026-11-19-case07-08-round6.md](evidence/79/07/2026-11-19-case07-08-round6.md) | 6.8 | 2026-11-19 | 口径：正式站 https://scendance-scene-planner-ewz.pages.dev/ + 真实云端 + 真实… |
| [2026-11-18-case08-blocked.md](evidence/79/08/2026-11-18-case08-blocked.md) | 0.9 | 2026-11-18 | 结论：三个子场景均 blocked，未取得写请求 / revision 对账证据。 |
| [2026-11-18-case08-round5-supplement.md](evidence/79/08/2026-11-18-case08-round5-supplement.md) | 3.8 | 2026-11-19 | 第四轮全 blocked 登记见 2026-11-18-case08-blocked.md。本轮在活动 A（house-uat5t… |
| [2026-11-18-case09-blocked.md](evidence/79/09/2026-11-18-case09-blocked.md) | 0.6 | 2026-11-18 | 结论：blocked，未取得撤销前后物件数 / 几何回读证据。 |
| [2026-11-18-case09-round5-supplement.md](evidence/79/09/2026-11-18-case09-round5-supplement.md) | 3.1 | 2026-11-19 | 第四轮 blocked 登记见 2026-11-18-case09-blocked.md。本轮在活动 A 应用一版物料提案后，找到… |
| [2026-11-19-case09-round6.md](evidence/79/09/2026-11-19-case09-round6.md) | 4.2 | 2026-11-19 | 口径：正式站 + 真实云端 + 真实账号；台架 docs/evidence/79/tools/case-09-reapply.mjs |
| [2026-11-19-case09-v3.md](evidence/79/09/2026-11-19-case09-v3.md) | 2.5 | 2026-11-19 | 结论：不转 pass。本次拿到了比第六轮更完整的浏览器链，但没有拿到同轮 PUT /outdoor-plans 与 revisio… |
| [2026-11-19-log-correlation-round6.md](evidence/79/10/2026-11-19-log-correlation-round6.md) | 6.3 | 2026-11-19 | 口径：正式项目 wkhfvnzgopjdzxlmycks 的只读日志查询；使用本机已登录的 Supabase CLI 凭据，令牌只… |
| [2026-11-19-log-correlation-runbook.md](evidence/79/10/2026-11-19-log-correlation-runbook.md) | 11.3 | 2026-11-19 | 口径：只读 runbook。本轮只读代码与文档，没有登录 Supabase 控制台、没有调用 Management API、没有读… |
| [2026-11-18-case11-exports.md](evidence/79/11/2026-11-18-case11-exports.md) | 5.1 | 2026-11-18 | 结论：浏览器列 partial（不构成通过），云端列 n/a（导出为本机产物，零写）。 |
| [2026-11-18-case11-round5-button-matrix.md](evidence/79/11/2026-11-18-case11-round5-button-matrix.md) | 1.6 | 2026-11-19 | 第四轮产物计数证据见 2026-11-18-case11-exports.md（CSV / JSON / GLB / DXF / … |
| [2026-11-19-case05-11-round6.md](evidence/79/11/2026-11-19-case05-11-round6.md) | 4 | 2026-11-19 | 方法升级：第五轮用页面级注入（覆写 fetch/XHR/onLine），本轮改用 Playwright context.setOf… |
| [2026-11-19-signoff-checklist.md](evidence/79/2026-11-19-signoff-checklist.md) | 15.1 | 2026-11-21 | 本文件是给人签字用的，不是结论。结论口径：一条用例 = 固定数据 ✅ 且 真实浏览器 = pass 且 真实云端 = pass；兜… |
| [2026-11-20-main-baseline-crosscheck.md](evidence/79/2026-11-20-main-baseline-crosscheck.md) | 7.3 | 2026-11-21 | 1. 先同步基线再复跑：79 证据基于旧基线，main 已重构户外规划链路；在旧基线上继续复跑 8/9 价值有限。建议把 79 分… |
| [README.md](evidence/79/README.md) | 4.8 | 2026-11-19 | 这是证据台账的机器校验，不是发布结论。结论仍只由 walkthrough.json 的 11 条用例和人的签字决定。 |
| [README.md](evidence/aholo/people03-hanfu-rig/README.md) | 0.9 | 未入库 | 1. 重跑 PEOPLE-02：四视图生成时强制 T-Pose / A-Pose（双臂外展），再 G1 → PEOPLE-03。 |
| [README.md](evidence/aholo/people03b-hanfu-rig/README.md) | 0.9 | 未入库 | 日期：2026-11-07（Asia/Shanghai） |
| [RERUN.md](evidence/aholo/people04-hanfu-batch/song-m/RERUN.md) | 0.4 | 未入库 | Archived failed batch as song-m-v1 (rig 4979487 RIGELIGIBILITYINC… |
| [BRIEF.md](evidence/aholo/people05-crowd-uniform-batch/BRIEF.md) | 2.4 | 未入库 | 日期：2026-11-11（Asia/Shanghai） |
| [README.md](evidence/aholo/sculpture-rig-tpose/README.md) | 6.2 | 2026-11-07 | 原雕塑 GLB 全程只读未改：docs/evidence/aholo/sculpture-img2-3d/4676340-unpa… |
| [README.md](evidence/aholo/sculpture-rig/README.md) | 2.5 | 2026-11-07 | 日期：2026-11-06（Asia/Shanghai） |
| [README.md](evidence/C1/README.md) | 1.3 | 2026-11-08 | 同一场地图纸、3 个风格词，出 3 套完整方案；本轮只证可自动验的部分。 |
| [H-batch-summary-2026-11-10.md](evidence/H-batch-summary-2026-11-10.md) | 4 | 2026-11-10 | 二十五轮接力 · 分支 feat/outdoor-2d（本地，未 push/未 tag/未部署，按用户拍板） |
| [H1c-migrate-tokens-2026-11-10.md](evidence/H1c-migrate-tokens-2026-11-10.md) | 3.9 | 未入库 | 2026-11-10 接力轮 · 分支 feat/outdoor-2d · 卡 H1-c（依赖 H1-b 前端侧已满足） |
| [README.md](evidence/H2b-boundary-zones-2026-11-10/README.md) | 6.5 | 未入库 | 控制台：当前页 0 error / 0 warning（历史 8780/8782 端口的旧会话错误与本页无关）。 |
| [README.md](evidence/H2c-facility-templates-2026-11-10/README.md) | 3.7 | 未入库 | 卡片：H2-c 设施模板拖放（占地预览/单击提交/Esc 取消/放置即选中）。 |
| [README.md](evidence/H2d-routes-nodes-workers-2026-11-10/README.md) | 5.4 | 未入库 | 日期：2026-11-10 08:00–08:40（08:00 接力轮） |
| [README.md](evidence/H3a-measure-stats-2026-11-10/README.md) | 4.9 | 未入库 | 1. 页面加载：顶栏 plan-overview-stats = 「场地 24,000 m² · 分区 3 · 设施 3 · 动线… |
| [README.md](evidence/H3b-conflicts-2026-11-10/README.md) | 4.6 | 未入库 | 2026-11-10 11:00 接力轮 · 分支 feat/outdoor-2d · 演示页 /outdoor-plan（OSM… |
| [README.md](evidence/H3c-info-panel-legend-2026-11-10/README.md) | 4.3 | 未入库 | 基线：feat/outdoor-2d @ 1e6c440（H3-b）。本轮改动：新增 site-plan-legend.ts(.t… |
| [README.md](evidence/H4a-visual-tokens-2026-11-10/README.md) | 5.2 | 未入库 | AI生成 |
| [README.md](evidence/H4b-interactions-2026-11-10/README.md) | 2.4 | 2026-11-10 | 1. 清 localStorage 后引导 1/3「这是你的场地画布」出现 → 完成 → 2/3「右侧是图层栈」→ 完成后引导消失… |
| [README.md](evidence/H5a-exports-2026-11-10/README.md) | 2.3 | 2026-11-10 | 1. 菜单四项状态正确：PNG/CSV/只读分享可点，GeoJSON 禁用「即将上线」 |
| [README.md](evidence/H5b-share-pdf-2026-11-10/README.md) | 2.5 | 2026-11-10 | 1. 分享弹窗：链接输入框（http://localhost:8783/plan-sharesnapshot=…）、复制链接按钮、… |
| [TRIAL-LOG.md](evidence/marble-trial/TRIAL-LOG.md) | 2.6 | 未入库 | 时间：2026-11-05 |
| [README.md](evidence/measure-2026-11-05/README.md) | 1.9 | 未入库 | 同一套代码里有两处必须能重复量出来的硬指标：真实空间的落位、布置的落地与比例。下面这条流程不依赖截图肉眼判断，任何一次改动后都能原… |
| [noon-report-2026-11-10.md](evidence/noon-report-2026-11-10.md) | 5.5 | 2026-11-10 | 2026-11-10 中午验收 · 分支 feat/outdoor-2d · 目标「争取完成空间布局」 |
| [README.md](evidence/outdoor-default-anchor-2026-11-11/README.md) | 3.7 | 未入库 | 用户指令（承接同日「底图为什么消失」的诊断）：户外规划默认带地理锚点（默认铺真地图），右侧加一枚按钮隐藏地理底图（切回 P4-b … |
| [README.md](evidence/outdoor-layers-tools-2026-11-11/README.md) | 4.5 | 未入库 | 用户指令：把画布顶部的编辑模式横条（浏览/画边界/编辑边界/画分区/放设施/画动线/放节点/布人员/测量 + 撤销）全部收进左栏「… |
| [README.md](evidence/outdoor-library-oneplan-2026-11-11/README.md) | 5.1 | 未入库 | 用户指令：① 物件库面板「完全和参考图（OnePlan）做的一样」——添加物件/已放置两页签、搜索框、两级可折叠分组树（组→子组→… |
| [README.md](evidence/SC-16/README.md) | 3.9 | 2026-11-08 | 本轮把「出包 → 下载 → 打开链接」整条链路跑成可复现的验收，按 docs/24 的 1-1～1-6 逐条给结论。 |
| [support_email_draft.md](evidence/scene3d-recon-2026-11/support_email_draft.md) | 3.6 | 未入库 | 主题：World 重建接口（/world/v1/reconstructions）图片模式全部 FAILED、视频模式无法受理 ——… |
| [tdt-probe-2026-11-10.md](evidence/tdt-probe-2026-11-10.md) | 5.7 | 2026-11-10 | 2026-11-10 · 二十四轮 · 分支 feat/outdoor-2d · 蓝天图 key 未到位，涉及真实瓦片/额度项如实… |
| [README.md](evidence/V5a-coldstone-reskin-2026-11-10/README.md) | 2.6 | 2026-11-12 | 户外 2D 规划不是独立产品：需与主产品接上、视觉完全服从主产品设计系统。 |
| [2026-11-18-round2.md](evidence/walk-2026-11-18-round2/2026-11-18-round2.md) | 4.5 | 2026-11-18 | 这一轮补的是上一轮列出的边界，对应提交 694398f6（相机防穿 / 化身加载兜底 / 无坐姿下沉对位）。 |
| [2026-11-19-walk-audit.md](evidence/walk-2026-11-18-round2/2026-11-19-walk-audit.md) | 4.5 | 2026-11-19 | 这一轮把漫游从「能走」往「能出结论」推：走一遍之后要能说清哪里走不到、哪条流线被挡、 |
| [walkthrough-2026-11-18.md](evidence/walk-2026-11-18/walkthrough-2026-11-18.md) | 5.7 | 2026-11-18 | 这一轮把「户外第一人称漫游」的三件事第一次真机跑了一遍：W1 玩家被场地物件挡住、W2 自己的身体与走动能起身、W3 岗位按 E … |

## 六、`docs/research/`（调研长文）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [2026-11-12-户外2D3D对齐-排查与收口.md](research/2026-11-12-%E6%88%B7%E5%A4%962D3D%E5%AF%B9%E9%BD%90-%E6%8E%92%E6%9F%A5%E4%B8%8E%E6%94%B6%E5%8F%A3.md) | 27.3 | 2026-11-13 | 集成工作树：C:\mujing\Scendance2026-integ，分支 integrate/agent-outdoor-newmain。 |
| [_findings-browser-2026-11-11.md](research/_findings-browser-2026-11-11.md) | 20.8 | 2026-11-11 | --- |
| [_findings-code-2026-11-11.md](research/_findings-code-2026-11-11.md) | 17 | 2026-11-11 | --- |
| [2026-11-10-yuquan-flower-show-photo-index.md](research/2026-11-10-yuquan-flower-show-photo-index.md) | 14.1 | 2026-11-11 | 本索引记录 2026 年 11 月公开文章中的 94 个图片地址。按原文分组与顺序编号，已按地址去重。核对链接时，87 个地址返回图片类型，浙江在… |
| [2026-11-11-全线压测-多代理扫查.md](research/2026-11-11-%E5%85%A8%E7%BA%BF%E5%8E%8B%E6%B5%8B-%E5%A4%9A%E4%BB%A3%E7%90%86%E6%89%AB%E6%9F%A5.md) | 23 | 2026-11-11 | 合并自同日两份草稿：findings-browser-2026-11-11.md（浏览器三车道三轮实测）与 findings-code-2026-… |
| [2026-11-11-线上走查-广州45人切片.md](research/2026-11-11-%E7%BA%BF%E4%B8%8A%E8%B5%B0%E6%9F%A5-%E5%B9%BF%E5%B7%9E45%E4%BA%BA%E5%88%87%E7%89%87.md) | 12.1 | 2026-11-11 | 走查环境：https://scendance-scendance-scene-planner-ewz.pages.dev（线上站，上游 main … |
| [2026-11-11-petitmaker-界面模式走查-补充.md](research/2026-11-11-petitmaker-%E7%95%8C%E9%9D%A2%E6%A8%A1%E5%BC%8F%E8%B5%B0%E6%9F%A5-%E8%A1%A5%E5%85%85.md) | 9.6 | 2026-11-11 | 对象：petitmaker.com.cn，同一会话续跑（任务「在友邻中心南侧沙滩边种2棵椰子树」从暂停→批准→拒绝→停止全程跟了一遍）。 |
| [2026-11-11-petitmaker-agent-run-学习.md](research/2026-11-11-petitmaker-agent-run-%E5%AD%A6%E4%B9%A0.md) | 4.5 | 2026-11-11 | 对象：petitmaker.com.cn（用户接入 MiniMax M3.1 Flash 自定义端点后首次真跑） |
| [2026-11-06-真实场地基准-HallD5.md](research/2026-11-06-%E7%9C%9F%E5%AE%9E%E5%9C%BA%E5%9C%B0%E5%9F%BA%E5%87%86-HallD5.md) | 13.2 | 2026-11-09 | 用途：这是 P1「真实活动纵向闭环」的已知答案对照，不是已发生的真实活动记录。 |
| [2026-11-09-模型接入与智能体运行.md](research/2026-11-09-%E6%A8%A1%E5%9E%8B%E6%8E%A5%E5%85%A5%E4%B8%8E%E6%99%BA%E8%83%BD%E4%BD%93%E8%BF%90%E8%A1%8C.md) | 1.9 | 2026-11-09 | 仓库已有 bailian-qwen 服务端适配，并在隔离本机环境用百炼真实模型进行过单次虚构需求测试。该结果不证明正式站已接入，也不证明任意活动或… |
| [2026-11-06-智能建造-实现与验收.md](research/2026-11-06-%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0-%E5%AE%9E%E7%8E%B0%E4%B8%8E%E9%AA%8C%E6%94%B6.md) | 9.4 | 2026-11-08 | 状态：进行中，尚不能称为真实活动交付完成。 本文只记录能核对的范围，不把模拟模型响应、公开参考图或本地测试当成真实现场验收。 |
| [2026-11-07-公开活动与缺资料验收.md](research/2026-11-07-%E5%85%AC%E5%BC%80%E6%B4%BB%E5%8A%A8%E4%B8%8E%E7%BC%BA%E8%B5%84%E6%96%99%E9%AA%8C%E6%94%B6.md) | 5.7 | 2026-11-08 | 这是一个用于开发和对抗测试的组合案例：真实公开场地参考 + 开放许可模型参考 + 虚构活动与库存。它不是已举办的活动，也没有取得场地方确认。文中方… |
| [2026-11-07-活动会话迁移设计-未启用.md](research/2026-11-07-%E6%B4%BB%E5%8A%A8%E4%BC%9A%E8%AF%9D%E8%BF%81%E7%A7%BB%E8%AE%BE%E8%AE%A1-%E6%9C%AA%E5%90%AF%E7%94%A8.md) | 5.9 | 2026-11-08 | 本文件描述待设计能力，不是已部署的迁移功能。现阶段会话保留在原活动作用域，可从历史入口只读查看；切换 ID 不会自动把旧需求写入目标项目。首次连接… |
| [2026-11-07-开源智能Chat可复用方法.md](research/2026-11-07-%E5%BC%80%E6%BA%90%E6%99%BA%E8%83%BDChat%E5%8F%AF%E5%A4%8D%E7%94%A8%E6%96%B9%E6%B3%95.md) | 5.8 | 2026-11-08 | 2026-11-07。审阅公开源码与许可证，不等于安装、运行或验证产品效果；本记录仅借鉴机制，不复制代码或引入新依赖。 |
| [2026-11-06-智能建造差距矩阵与路线图.md](research/2026-11-06-%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E5%B7%AE%E8%B7%9D%E7%9F%A9%E9%98%B5%E4%B8%8E%E8%B7%AF%E7%BA%BF%E5%9B%BE.md) | 21.3 | 2026-11-06 | 姊妹篇：《2026-11-06-智能建造对标升级.md》。上文给机制拆解，本文给一张可对照的四层差距矩阵，并把 P0/P1/P2/P3 重新排成三… |
| [2026-11-06-智能建造对标升级.md](research/2026-11-06-%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0%E5%AF%B9%E6%A0%87%E5%8D%87%E7%BA%A7.md) | 19.8 | 2026-11-06 | 本文综合三份平行研究稿（约束图/LLM分工、走廊连通、打分维度），给出对 Scendance2026 现有 plan- 模块的升级规格。只产规格，… |
| [README.md](research/generation/README.md) | 2.3 | 2026-11-05 | 一句话 → 计划工件 → 确定性校验 → 一次终态提交。结论与规格见各篇；2026-11-01 六篇成文时场景脚本还只是设计，自 feat/sma… |
| [scendance-smart-build-p4-2026-11-04.md](research/generation/scendance-smart-build-p4-2026-11-04.md) | 19.4 | 2026-11-05 | 工作树实况记录，不是复盘文章。分支 feat/smart-build-scene-script（自 tip 110f348 v3.3.0 开枝），… |
| [activity-ai-workbench-gallery-2026-11-04.md](research/ia-2026-11-04/activity-ai-workbench-gallery-2026-11-04.md) | 24 | 2026-11-04 | 日期：2026-11-04 |
| [review-bingo-canvas-annotation-2026-11-04.md](research/ia-2026-11-04/review-bingo-canvas-annotation-2026-11-04.md) | 25.9 | 2026-11-04 | 日期：2026-11-04 ｜ 分片：B（审校 Bingo）｜ 基线分支：feat/smart-build-scene-script（台账 a87… |
| [space-materials-tool-panels-2026-11-04.md](research/ia-2026-11-04/space-materials-tool-panels-2026-11-04.md) | 32.8 | 2026-11-04 | 日期：2026-11-04 |

## 七、`docs/` 其余子目录（contracts / quality / oneplan-icons / release-notes / examples）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [vitest-baseline-63b11ae1.md](quality/vitest-baseline-63b11ae1.md) | 14.3 | 2026-11-18 | 用途：合入前先跑全量。失败文件不在本台账，或同一文件 failed 数明显上涨，才算回归；台账本身是既有环境债，不是待修清单。 |
| [ATTRIBUTION.md](oneplan-icons/ATTRIBUTION.md) | 11.5 | 2026-11-17 | 本目录保存一组第三方图标素材，用于本地原型阶段的视觉对齐与排版验证。素材著作权归 OnePlan（app.oneplan.io）所有，本项目未取得… |
| [NAMES.md](oneplan-icons/NAMES.md) | 50.1 | 2026-11-17 | 本文件是 manifest.audit.json 的人读版：454 个物件库名称、549 个素材文件全部在表内。 |
| [vitest-baseline-0a59f7b0.md](quality/vitest-baseline-0a59f7b0.md) | 11.3 | 2026-11-17 | 用途：合入前先跑全量。失败文件不在本台账，或同一文件 failed 数明显上涨，才算回归；台账本身是既有环境债，不是待修清单。 |
| [4.0.0.md](release-notes/4.0.0.md) | 2.5 | 2026-11-06 | 这一版不再是「能摆家具」，而是「会判断布局好不好」。核心变化三件事，全部可在草案卡上直接看到。 |
| [2026-10-14-参数化资产契约.md](contracts/2026-10-14-%E5%8F%82%E6%95%B0%E5%8C%96%E8%B5%84%E4%BA%A7%E5%A5%91%E7%BA%A6.md) | 2.1 | 2026-11-05 | 纯数据契约为 supabase/functions/shared/parametric-contract.ts。parametricParamet… |
| [2026-10-14-预设场景契约.md](contracts/2026-10-14-%E9%A2%84%E8%AE%BE%E5%9C%BA%E6%99%AF%E5%A5%91%E7%BA%A6.md) | 2.2 | 2026-11-05 | Scene.scenePreset 可选，只接受 gym、popup、bar、cafe、conference、lawn、market、museum… |
| [2026-10-14-资产定制契约.md](contracts/2026-10-14-%E8%B5%84%E4%BA%A7%E5%AE%9A%E5%88%B6%E5%A5%91%E7%BA%A6.md) | 3.3 | 2026-11-05 | 纯数据契约：supabase/functions/shared/asset-customization-contract.ts。场景仍使用 dom… |
| [2026-10-14-DeepSeek-Agent契约.md](contracts/2026-10-14-DeepSeek-Agent%E5%A5%91%E7%BA%A6.md) | 3.5 | 2026-11-05 | 唯一 wire schema 在 supabase/functions/shared/agent-contract.ts。POST /projec… |
| [2026-11-04-Supabase业务契约.md](contracts/2026-11-04-Supabase%E4%B8%9A%E5%8A%A1%E5%A5%91%E7%BA%A6.md) | 3.5 | 2026-11-05 | 场景类型与校验真源：supabase/functions/shared/domain.ts。HTTP 完整协议见 31-HTTP-API与前端接入… |

## 八、`flow/`（任务卡与流水）

### 8.1 根文件

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [进展.md](../flow/%E8%BF%9B%E5%B1%95.md) | 191.5 | 2026-11-13 | 本地提交因仓库尚无Git作者署名而未创建；不虚构用户姓名/邮箱、不修改全局身份。已保存包含二进制图片的完整暂存差异到 C:\幕景\deve… |
| [decisions.md](../flow/decisions.md) | 8.3 | 2026-11-13 | 目标仍为自己完成一场活动。第一版工作单解决了物料执行，但活动中的签到、主持、供应方到场、联排、撤场交接不能依附于一件三维物料，下一阶段必须… |
| [plan.md](../flow/plan.md) | 9.8 | 2026-11-13 | 用户授权日期：2026-10-07。优先让我们自己能接住并完成活动策划、布展和执行项目，再以真实项目反馈改进平台。允许在已授权范围直接进行… |

### 8.2 `flow/tasks/`

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [activity-task-api-implementation.md](../flow/tasks/activity-task-api-implementation.md) | 5 | 2026-11-13 | 2026-10-10。root在PetitMaker组合核心验收后，正式授权原后端实施此前只读activity-task-agent-in… |
| [activity-task-suggestions.md](../flow/tasks/activity-task-suggestions.md) | 5.1 | 2026-11-13 | 2026-10-10。AIHOT源码候选2来自用户“学习优化幕景”与既有活动策划执行目标；不是把资讯评分搬成现场事实。当前Agent只读S… |
| [aihot-code-learning.md](../flow/tasks/aihot-code-learning.md) | 4 | 2026-11-13 | 2026-10-10。用户明确要求“AIHOT开源项目扒代码，定个目标进行学习优化我们这个项目”。本阶段纳入现有幕景持续开发目标，不用新的… |
| [binggo-launcher-refinement.md](../flow/tasks/binggo-launcher-refinement.md) | 5.7 | 2026-11-13 | 2026-10-09。用户认为桌面右下角“Binggo · Agent”长胶囊冗长，提供两张Grok“新建 Bot”状态图，希望研究动效及… |
| [commercial-domain-proposal.md](../flow/tasks/commercial-domain-proposal.md) | 32.9 | 2026-11-13 | 2026-10-09。状态：首切片方向、默认币种／原件格式／容量／独立包、本机身份及草稿边界均获导演审定；后续有界任务已完成最小公共JSO… |
| [commercial-storage-handoff.md](../flow/tasks/commercial-storage-handoff.md) | 11.8 | 2026-11-13 | 2026-10-09。本轮只新增存储、独立包及对应测试，没有接线界面、改V1–V4、签署或收付。固定JSON契约是 supabase/fu… |
| [commercial-ui-integration.md](../flow/tasks/commercial-ui-integration.md) | 7.5 | 2026-11-13 | 原前端完成真实接线，入口为资料 → 资料分类 → 合同与约定。固定普通候选 http://commercial-workbench.loc… |
| [compact-canvas-frame.md](../flow/tasks/compact-canvas-frame.md) | 2.7 | 2026-11-13 | 2026-10-10，来自用户五张 PetitMaker 参考截图及直接反馈。优先于上一段示例文案清理；已完成的关闭资料与草稿保护保留。 |
| [director-acceptance.md](../flow/tasks/director-acceptance.md) | 9.6 | 2026-11-13 | 2026-10-10。PR1 merge commit2b658cf8918a905c66d4670805fc599565454fa1，a… |
| [editor-appearance-mode.md](../flow/tasks/editor-appearance-mode.md) | 49.9 | 2026-11-21 | 2026-11-19。用户反馈编辑器左侧面板一片纯白、长时间盯很亮眼，提出加外观模式：跟随系统、浅色、深色、跟随底图。结论：做三档，不做「… |
| [execution-timetable-acceptance.md](../flow/tasks/execution-timetable-acceptance.md) | 2.8 | 2026-11-13 | 用户已明确要求继续完成；样稿数据和视觉核对通过后进入生产实现。本段服务录音A执行与外包交接、录音B执行者看得懂的结果要求，不新增业务模块。 |
| [layout-intent-review.md](../flow/tasks/layout-intent-review.md) | 2.7 | 2026-11-13 | 来源顺序：用户最新明确说明 → 录音原文中的具体需求及讨论语气 → 当前Figma草图 → 分析建议。录音中的探索和举例不是自动执行指令。… |
| [local-activity-ai-next.md](../flow/tasks/local-activity-ai-next.md) | 2.7 | 2026-11-13 | 依据录音 B 09:16、11:00 和 C 53:20，以及用户要求先自己用于活动策划执行。2026-10-09 后端对话只读核查确认：… |
| [petitmaker-agent-checkpoint-failure.md](../flow/tasks/petitmaker-agent-checkpoint-failure.md) | 3.3 | 2026-11-13 | 总后端A+B已冻并模块验收：root读ai.ts单行shared modify existing-ID守卫，实核ai3c84f1c5...… |
| [petitmaker-file-io-reliability.md](../flow/tasks/petitmaker-file-io-reliability.md) | 2.6 | 2026-11-13 | 2026-10-10模块正式验收：root读delivery/build proof实际exit0，实核4路径与冻结副本SHA一致，新增2… |
| [petitmaker-workbench-refinement.md](../flow/tasks/petitmaker-workbench-refinement.md) | 7 | 2026-11-13 | root新固定版尺寸/浏览正式通过：focus-final-build-copy实际服务18500/PID69144，新Chrome独立p… |
| [production-plan-contract-audit.md](../flow/tasks/production-plan-contract-audit.md) | 2.3 | 2026-11-13 | 2026-10-08，后端对话在772bd44基础只读审计，尚未实施新字段。 |
| [project-review-library-handoff.md](../flow/tasks/project-review-library-handoff.md) | 6.6 | 2026-11-13 | 最新用户发布偏好：按完整版本集中交付，不再随时Git。此前前端“验收后自行commit/push”安排已撤销；本轮继续本地整合、测试、独立… |
| [public-model-cold-reopen.md](../flow/tasks/public-model-cold-reopen.md) | 4.5 | 2026-11-13 | 2026-10-10。来自 PetitMaker 恢复链的有界学习，详见已冻 petitmaker-recovery-followup.m… |
| [quantity-checkin-next.md](../flow/tasks/quantity-checkin-next.md) | 1.9 | 2026-11-13 | 2026-10-09只读审计结论。依据录音中外包执行监管、执行方照材料完成活动的方向，以及本轮“租20、到18、还18”的演练。这里是设计… |
| [recording-delivery-matrix.md](../flow/tasks/recording-delivery-matrix.md) | 13.6 | 2026-11-13 | 最新补记2026-10-10：main/tag1.0.1已正式发布，2b658cf；原图/平面/三维、客户评审、内部制作交接、任务建议/合… |
| [reference-plan-acceptance.md](../flow/tasks/reference-plan-acceptance.md) | 3 | 2026-11-13 | 用户于2026-10-07明确继续。起点为已上传54e5876；本轮实现由主前端负责，导演验收，后端只读核坐标。原3157预览保持运行。 |
| [version-candidate-plan.md](../flow/tasks/version-candidate-plan.md) | 7.4 | 2026-11-13 | 最新发布补记：42e78cca6122122670e8ea3a4edf6ab38c9d8c4e已推开发分支，PR1草稿附当前任务；sour… |
| [workbench-simplification.md](../flow/tasks/workbench-simplification.md) | 3.5 | 2026-11-13 | 2026-10-09。用户在review-library.localhost:18462的561×719窄屏直接指出两处：聊天上方五个工作… |
| [workspace-entry-consistency.md](../flow/tasks/workspace-entry-consistency.md) | 2.1 | 2026-11-13 | 2026-10-10。42e完整检查点发布后，根据用户在原前端对话的直接使用反馈继续。本段对应录音C18:04长对话独立可收起、C53:2… |

## 九、仓库根（11 份）

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [AGENTS.md](../AGENTS.md) | 5.2 | 2026-11-19 | 仓库总约定：技术栈、目录、命令、代码风格、提交规范、禁止事项 |
| [ASSET-SOURCES.md](../ASSET-SOURCES.md) | 6.4 | 2026-11-05 | 素材来源与授权溯源（不得删除或篡改） |
| [BACKEND.md](../BACKEND.md) | 2.3 | 2026-11-05 | 后端速查 |
| [CHANGELOG.md](../CHANGELOG.md) | 274.1 | 2026-11-21 | 版本变更日志（274 KB，`npm run check:changelog` 校验） |
| [COLLAB.md](../COLLAB.md) | 31.8 | 2026-11-20 | 多人/多 AI 协作纪律（含 evidence 提交白名单的来源） |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 2.3 | 2026-11-18 | 外部贡献流程 |
| [HANDOFF.md](../HANDOFF.md) | 696.7 | 2026-11-20 | 跨会话交接流水（697 KB，历史段落按当时状态记录，不追改） |
| [MEMORY.md](../MEMORY.md) | 2.1 | 2026-11-21 | 项目长期记忆：已确认事实与决策 |
| [PLAN.md](../PLAN.md) | 20.4 | 2026-11-07 | 早期总计划（v0.2 活动工作室定位） |
| [README.md](../README.md) | 7.7 | 2026-11-19 | 仓库门面：项目简介与快速启动 |
| [SUPABASE-EGRESS-AUDIT.md](../SUPABASE-EGRESS-AUDIT.md) | 2.6 | 2026-11-20 | Supabase 出网流量审计记录 |

## 十、其他模块

### 10.1 `frontend/`

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [SCENE-PRESETS.md](../frontend/docs/SCENE-PRESETS.md) | 1.7 | 2026-11-19 | 10 套完整场景模板（体育馆 · 黑客松、青序 · 香氛快闪、琥珀间 · 酒吧、慢调咖啡 · SLOW NOTES、学术会议 · … |
| [README.md](../frontend/README.md) | 15.6 | 2026-11-19 | 1.0.1发布说明：（已失效：../docs/42-1.0.1发布说明.md）。保留main既有自有Supabase、Tokend… |
| [README.md](../frontend/lib/site-intelligence/README.md) | 11.1 | 2026-11-13 | Owned directory only; no plan writes, model calls, proxy changes … |
| [README.md](../frontend/evals/brief/README.md) | 4.2 | 2026-11-09 | 这 13 条是人工编写的合成示例，不是现场数据或模型实测。覆盖长者不等于轮椅、明确行动辅助、签到/舞台否定和待定、1 人、人数冲突… |
| [agent-eval-baseline.README.md](../frontend/scripts/agent-eval-baseline.README.md) | 1.2 | 2026-11-08 | 在仓库根目录运行： |
| [evaluate-live-dialogues.README.md](../frontend/scripts/evaluate-live-dialogues.README.md) | 2.4 | 2026-11-08 | 先启动专用、独立端口的本机试用。脚本只接受服务状态为 ready 且使用计数符合预期的试用，不读取密钥，不读取用户项目；登录的是该… |
| [CHANGELOG.md](../frontend/CHANGELOG.md) | 8.9 | 2026-11-07 | 当前版本 v2.0.0。活动方案全流程与深收口见仓库根目录 CHANGELOG.md。以下保留前端历史记录。 |
| [VERIFICATION-v0.2.0.md](../frontend/docs/VERIFICATION-v0.2.0.md) | 1.5 | 2026-11-07 | 2026-10-02；基于 version 分支 ceb41a1。只更改前端与文档。 |
| [VERIFICATION-v0.3.0.md](../frontend/docs/VERIFICATION-v0.3.0.md) | 2.8 | 2026-11-07 | 日期：2026-10-02。范围：frontend 与授权交接文档；后端与共享协议未修改。 |
| [scoring-flow-spec.md](../frontend/lib/scoring-flow-spec.md) | 5.5 | 2026-11-06 | 本文件冻结两个新纯函数模块的导出签名，供两个子任务并行实现后再由 UI 串联。 |
| [AGENT-ENTRY.md](../frontend/docs/AGENT-ENTRY.md) | 4.1 | 2026-11-04 | 后续的真实资源读取、操作与 HY3 转接已上线，见 docs/BINGGOSCENEAGENT.md（2026-11-04 已从 … |
| [ATTRIBUTION.md](../frontend/public/icon-park/ATTRIBUTION.md) | 0.4 | 2026-11-03 | The search, zoom-in, and zoom-out loupe glyphs are adapted from t… |
| [ATTRIBUTION.md](../frontend/public/material-symbols/ATTRIBUTION.md) | 0.9 | 2026-11-03 | The product UI uses a locally subsetted Material Symbols Rounded … |
| [README.md](../frontend/app/fonts/README.md) | 0.6 | 2026-10-31 | 内置字体授权说明：Inter / Playfair Display 均为 OFL-1.1，随包分发依据 |
| [README.md](../frontend/components/room-organizer/assets/README.md) | 0.9 | 2026-10-27 | Rigged, animated mannequin used for placed people. Wandering NPCs… |
| [AGENTS.md](../frontend/AGENTS.md) | 1 | 2026-10-10 | This directory belongs to role A (Sandraddd). Read README.md befo… |
| [ASSET-SOURCES.md](../frontend/ASSET-SOURCES.md) | 1.6 | 2026-10-10 | public/assets/models/.glb and public/assets/catalogue.json are by… |
| [activity-planning-icon.md](../frontend/docs/evidence/activity-planning-icon.md) | 1.5 | 2026-10-10 | 2026-10-07。按用户明确的生图模型要求，使用当前环境内置imagegen生图能力生成原创透明PNG；未走外部API或读取A… |
| [MATERIAL_CAPABILITY_SOURCES.md](../frontend/docs/MATERIAL_CAPABILITY_SOURCES.md) | 3.5 | 2026-10-10 | 核对日期：2026-10-02。实现文件为 frontend/lib/material-capabilities.ts，测试文件为… |
| [README.md](../frontend/public/showcase/assets/brand/logo-2026/README.md) | 6.2 | 未入库 | 主标志是 「AI 的门」（door 版）：绿色圆角方块 + 白色拱形门洞，无绿点，主色 35624A。 |
| [README.md](../frontend/public/showcase/assets/brand/README.md) | 6.2 | 未入库 | 品牌主标志是 「AI 的门」（door 版）：绿色圆角方块 + 白色拱形门洞，主色 35624A，无绿点。 |
| [README.md](../frontend/public/showcase/assets/generated/README.md) | 1 | 未入库 | Aholo 接口在本机生成过、并且确认要留下的 3D 场景与物件。工作台的「生成物件 / 环境预览」列表读的是浏览器本机记录，换浏… |
| [README.md](../frontend/public/showcase/assets/library/README.md) | 3 | 未入库 | 网站工作台从 merged.json 延迟加载统一目录：529 个不重复模型、19 个中文分类，其中 528 项纳入工作台和 Ag… |
| [README.md](../frontend/public/showcase/assets/models/README.md) | 4.4 | 未入库 | 这里只有 5 个 GLB，是早期精选的测试/示例固定件（fixture），不是素材库。 |
| [README.md](../frontend/public/showcase/assets/scenes/README.md) | 1.5 | 未入库 | 首屏 .hero 的背景是一层一张的 .hero-shot，按 introduction.html 里 HEROSHOTS |

### 10.2 tools / assets / deliverables / development-research / data / supabase / scene / learning-library / .github

| 文件 | KB | 最后改动 | 一句话 |
| --- | ---: | --- | --- |
| [63-飞书版-Agent合格度与断点.md](../deliverables/63-%E9%A3%9E%E4%B9%A6%E7%89%88-Agent%E5%90%88%E6%A0%BC%E5%BA%A6%E4%B8%8E%E6%96%AD%E7%82%B9.md) | 11 | 2026-11-21 | 一句话：不是模型多聪明，而是它说的话能追到证据、做的事能撤回、失败的时候有名字。 |
| [outdoor-boundary-close-fix-2026-11-18.md](../deliverables/outdoor-boundary-close-fix-2026-11-18.md) | 9.8 | 2026-11-20 | 给终树审阅。代码仍在本地工作区，未 commit、未推 main、未开 PR、未部署 Pages。 未经终树说「合」，不做合入与发… |
| [outdoor-map-editing-fix-acceptance-2026-11-20.md](../deliverables/outdoor-map-editing-fix-acceptance-2026-11-20.md) | 27.7 | 2026-11-20 | §0–§6 保留独立验收时的历史结论；后续补齐及最新验证结果见 §7，不将旧的「未通过」表当作当前修复状态。 |
| [outdoor-map-editing-interaction-audit-2026-11-20.md](../deliverables/outdoor-map-editing-interaction-audit-2026-11-20.md) | 31.3 | 2026-11-20 | 查过的编辑对象共 12 类：设施（内置模板 / 活动包 / 物料卡 / 生成件）、分区、用地红线、设计范围、墙、动线、出入口节点、… |
| [pr-wip-outdoor-tests.md](../deliverables/pr-wip-outdoor-tests.md) | 3.4 | 2026-11-20 | Draft。不要直接合入。 本分支是未完成现场的存档，基线 b997da81，比 main 落后 143 个提交，合并前必须先 r… |
| [BATCH-NOTES-20261119.md](../tools/aholo/BATCH-NOTES-20261119.md) | 7.1 | 2026-11-20 | 账号 2576 credits 当天过期（截图口径；API 无余额查询接口，净消耗以 task/list 的 consumedCr… |
| [README.md](../data/agent-corpus/README.md) | 4.1 | 2026-11-19 | 户外 Agent 的「养料」：把散在权威文档里的空间规则、场景模板、场地要素和物料参数，收成可机读、可校验、可被提示词/校验器/回… |
| [agent-task.md](../.github/ISSUE_TEMPLATE/agent-task.md) | 0.8 | 2026-11-18 | 工单模板：用 issue 给 agent 派任务（线/类别 + 一句话目标） |
| [README.md](../tools/replica-geo/README.md) | 2.1 | 2026-11-18 | 把 OnePlan 参考图钉到真实影像上，重描成米制 ENU 几何，再写回产品 spec 与核对报告。 |
| [H-batch-summary-2026-11-10.md](../deliverables/H-batch-summary-2026-11-10.md) | 4 | 2026-11-13 | 二十五轮接力 · 分支 feat/outdoor-2d（本地，未 push/未 tag/未部署，按用户拍板） |
| [noon-report-2026-11-10.md](../deliverables/noon-report-2026-11-10.md) | 4.1 | 2026-11-13 | 2026-11-10 中午验收 · 分支 feat/outdoor-2d · 目标「争取完成空间布局」 |
| [tdt-probe-2026-11-10.md](../deliverables/tdt-probe-2026-11-10.md) | 5.8 | 2026-11-13 | 2026-11-10 · 二十四轮 · 分支 feat/outdoor-2d · 蓝天图 key 未到位，涉及真实瓦片/额度项如实… |
| [building-heights-stats.md](../data/building-heights-stats.md) | 5.4 | 2026-11-10 | 自动生成，请勿手改；唯一写入方见 OWNERSHIP.md。生成日期 2026-11-09。 |
| [OWNERSHIP.md](../data/OWNERSHIP.md) | 5.4 | 2026-11-10 | 只有 scripts/build-building-heights.py 可以写这个文件。任何人不手工编辑 JSON。 |
| [README.md](../assets/brand/logo-2026/README.md) | 6.2 | 2026-11-07 | 主标志是 「AI 的门」（door 版）：绿色圆角方块 + 白色拱形门洞，无绿点，主色 35624A。 |
| [README.md](../assets/brand/README.md) | 6.2 | 2026-11-07 | 品牌主标志是 「AI 的门」（door 版）：绿色圆角方块 + 白色拱形门洞，主色 35624A，无绿点。 |
| [research-a-constraint-graph.md](../development-research/research-a-constraint-graph.md) | 11.5 | 2026-11-06 | 研究对象：FlairGPT（arXiv 2501.04648）+ OpenAI Cookbook《Evaluating Groun… |
| [research-b-corridor.md](../development-research/research-b-corridor.md) | 13.8 | 2026-11-06 | 研究线子任务 B 交付物。只产规格，不改产品代码。 |
| [research-c-scoring-dimensions.md](../development-research/research-c-scoring-dimensions.md) | 15.8 | 2026-11-06 | 范围：只产规格，不改产品代码。 |
| [pull_request_template.md](../.github/pull_request_template.md) | 0.7 | 2026-11-04 | 命令与真实输出贴在这里 |
| [README.md](../assets/models/README.md) | 4.4 | 2026-11-04 | 这里只有 5 个 GLB，是早期精选的测试/示例固定件（fixture），不是素材库。 |
| [README.md](../tools/aholo/walkthrough/README.md) | 1.6 | 2026-11-04 | 在浏览器里直接走进 Aholo World 生成的 3DGS 场景：不登录、不调接口、不扣额度，只读 |
| [README.md](../assets/generated/README.md) | 1 | 2026-10-30 | Aholo 接口在本机生成过、并且确认要留下的 3D 场景与物件。工作台的「生成物件 / 环境预览」列表读的是浏览器本机记录，换浏… |
| [3d-expert.agent.md](../.github/agents/3d-expert.agent.md) | 6 | 2026-10-22 | 「3D 生成专家」子 agent 定义：GLB 生成/烘制/校验/优化与查看器的可用范围 |
| [README.md](../tools/units-preview/README.md) | 2.7 | 2026-10-22 | 单位闸门（图纸标注毫米/厘米/米 → 米）的可视化预览。给不跑真实识别的人看效果用。 |
| [README.md](../assets/library/README.md) | 3 | 2026-10-10 | 网站工作台从 merged.json 延迟加载统一目录：529 个不重复模型、19 个中文分类，其中 528 项纳入工作台和 Ag… |
| [README.md](../assets/scenes/README.md) | 1.5 | 2026-10-10 | 首屏 .hero 的背景是一层一张的 .hero-shot，按 introduction.html 里 HEROSHOTS |
| [README.md](../scene/README.md) | 5.1 | 2026-10-10 | 把模型拖进无限网格场景，用固定日光和实时阴影查看效果。不依赖账号、后端或 API Key。 |
| [reconstruction-development.md](../supabase/ops/reconstruction-development.md) | 6.6 | 2026-10-10 | Use the independent scendance-floorplan checkout and a separate S… |
| [README.md](../tools/blender/README.md) | 6.2 | 2026-10-10 | 用 Blender 的 Python 接口（bpy）做三维建模的可行性探索。 |
| [README.md](../tools/catalog/README.md) | 3.7 | 2026-10-10 | Rebuild, verify and audit the scene template's model library. |
| [README.md](../tools/floorplan/README.md) | 6.2 | 2026-10-10 | 将平面图栅格转成米制、轴对齐的墙体矩形，供 .local-dev/blender-demo/plan.html 消费。 |
| [README.md](../learning-library/oneplan-siteplans/README.md) | 5.6 | 未入库 | 爬取自 OnePlan 灵感库（2026-11-17），共 45 个真实活动案例的高清场地规划图（site plan）。 |

## 十一、agent 草稿（未入库）

这些目录不进版本控制：`.zwork/`（运行产物）、`.zcode/`（计划草稿）、`.agents/`（技能）、`.memsearch/`（记忆缓存）、`.trae/`（编辑器会话）。删除不影响仓库，但可能丢失当时的会话上下文。

| 文件 | KB | 一句话 |
| --- | ---: | --- |
| [INDEX.md](../.zwork/artifacts/0717c3a3-dccb-4543-ae60-e97a3d8fbabc/INDEX.md) | 16.1 | 与 README.md 的分工：README 讲「为什么这么分、旧号怎么查」，本页讲「现在到底有哪些文件」。 |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/1565d288-7121-479f-b4aa-d72a620ce913/2026-11-20-people-registry-unification.md) | 19.8 | 生成日期：2026-11-20 状态：计划，未实施（本文不含任何已完成声明） |
| [INDEX.md](../.zwork/artifacts/21c4a659-11a6-48ab-95a3-ea39e5f1dacb/INDEX.md) | 16.2 | 与 README.md 的分工：README 讲「为什么这么分、旧号怎么查」，本页讲「现在到底有哪些文件」。 |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/3ea43a6e-dced-457b-afb8-02ab5d6436bf/2026-11-20-people-registry-unification.md) | 20 | 生成日期：2026-11-20 状态：计划，未实施（本文不含任何已完成声明） |
| [persistence-undo.md](../.zwork/artifacts/713f1d04-6ccd-4e6e-8fd5-6e7ff7d90fb5/persistence-undo.md) | 14.8 | 审计对象：frontend/components/room-organizer/lib/outdoor-project-s… |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/749440ae-6774-48ca-84b6-c0dd94114faf/2026-11-20-people-registry-unification.md) | 19.7 | 生成日期：2026-11-20 状态：计划，未实施（本文不含任何已完成声明） |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/80d53974-7563-466b-bcc2-32f48eafbb37/2026-11-20-people-registry-unification.md) | 21.8 | 生成日期：2026-11-20 状态：P1–P3 已实施，P4 真机走查部分完成（实施记录见 §十三） |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/87808bf0-6c7b-41e9-8e39-fc2bc15b626f/2026-11-20-people-registry-unification.md) | 20 | 生成日期：2026-11-20 状态：计划，未实施（本文不含任何已完成声明） |
| [INDEX.md](../.zwork/artifacts/98515b4f-aca7-4b49-b79a-9bc401e70672/INDEX.md) | 16.1 | 与 README.md 的分工：README 讲「为什么这么分、旧号怎么查」，本页讲「现在到底有哪些文件」。 |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/9ed441a9-4f40-44eb-9006-749ca0ffd8e7/2026-11-20-people-registry-unification.md) | 19.6 | 生成日期：2026-11-20 状态：计划，未实施（本文不含任何已完成声明） |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/bbae4941-fdfc-4a07-b5a5-e54fafc8c01f/2026-11-20-people-registry-unification.md) | 19.7 | 生成日期：2026-11-20 状态：计划，未实施（本文不含任何已完成声明） |
| [2026-11-20-people-registry-unification.md](../.zwork/artifacts/be180002-819d-4143-a384-77bd6e8fed10/2026-11-20-people-registry-unification.md) | 21.9 | 生成日期：2026-11-20 状态：P1–P3 已实施，P4 真机走查部分完成（实施记录见 §十三） |
| [CHANGELOG.md](../.zwork/artifacts/fd70728f-d78a-4513-936b-d951e6478c78/CHANGELOG.md) | 262.8 | 这一版把「谁可以出现在场地上」从两份并列清单收成一张登记表。以前物料库「不同人群」里保安、警察、志愿者、主管、管理员各有三… |
| [0-研究员.md](../.zwork/runs/867d3395/0-%E7%A0%94%E7%A9%B6%E5%91%98.md) | 2.8 | 审计已完成，只读操作，未改任何源码。报告：3d-parity.md |
| [1-研究员.md](../.zwork/runs/867d3395/1-%E7%A0%94%E7%A9%B6%E5%91%98.md) | 2.3 | 审计完成。整体置信：高（只读，未改任何源文件）。报告：panel-canvas-sync.md |
| [2-研究员.md](../.zwork/runs/867d3395/2-%E7%A0%94%E7%A9%B6%E5%91%98.md) | 2.1 | 审计完成，报告在 .tmp-audit/persistence-undo.md。 |
| [plan-sess_27b473d0-3dc6-4ffa-ba4e-385c0391aac8.md](../.zcode/plans/plan-sess_27b473d0-3dc6-4ffa-ba4e-385c0391aac8.md) | 4.4 | 未入库 | agent 会话计划草稿（按 session 自动生成，无标题） |
| [plan-sess_6baf284d-8a14-414c-818d-e31b61bcead1.md](../.zcode/plans/plan-sess_6baf284d-8a14-414c-818d-e31b61bcead1.md) | 5.3 | 用户指出：户外卡内 3D 与退出户外后的主画布 3D「应该一模一样，现在是各渲染各的，等于写了两个 tsx」。属实——ou… |
| [plan-sess_6c6b5b81-1cfc-4c06-a6bd-2bb67528f866.md](../.zcode/plans/plan-sess_6c6b5b81-1cfc-4c06-a6bd-2bb67528f866.md) | 4 | 未入库 | agent 会话计划草稿（按 session 自动生成，无标题） |
| [plan-sess_9716f736-8398-4444-923a-fa1583dbdc9b.md](../.zcode/plans/plan-sess_9716f736-8398-4444-923a-fa1583dbdc9b.md) | 8.1 | 未入库 | agent 会话计划草稿（按 session 自动生成，无标题） |
| [plan-sess_b853b358-8098-4aa9-8d47-0b1e60cc41b1.md](../.zcode/plans/plan-sess_b853b358-8098-4aa9-8d47-0b1e60cc41b1.md) | 0.9 | 1. 去掉「户外草稿 · 已存 …」：organizer 左轨 foot 的户外分支整段删除（3792–3797）——户外… |
| [plan-sess_c67ba7bc-6c58-4787-9ffa-01e5f307e83e.md](../.zcode/plans/plan-sess_c67ba7bc-6c58-4787-9ffa-01e5f307e83e.md) | 4.7 | 现状:登录注册是 /auth 整页(IntroPage = 营销故事 + 登录卡);工作台里账户弹窗的「登录」按钮会跳走整… |
| [plan-sess_fabbda39-fed2-40c8-8f28-18148d60cb2d.md](../.zcode/plans/plan-sess_fabbda39-fed2-40c8-8f28-18148d60cb2d.md) | 4.5 | 谷地工坊（petitmaker.com.cn）与我们的 agent-panel 是同形态产品（地图编辑器 + Agent … |
| [SKILL.md](../.agents/skills/aholo-reality-skill/SKILL.md) | 8.1 | Aholo Reality reconstructs photos and videos into 3D Gaussian… |
| [2026-11-18.md](../.memsearch/memory/2026-11-18.md) | 2 | <!-- session:session-eddd7401-e6a9-4a93-b6d8-24d8a6ccc5d9 tur… |
| [conversation-trace-plan.md](../.trae/documents/conversation-trace-plan.md) | 6.9 | 线上账号 lily1326685527@gmail.com 有 42 天使用史，但 sceneprivate.agentr… |

未入库 md 合计：51 份（含 docs/evidence 被忽略的 18 份）。

## 十二、已知问题（2026-11-21 实测）

1. **编号 46 重号**：`46-虚拟场地纸面模式规格-20261117.md` / `46-Agent运行卫生上线手册-20261116.md`——内容无关，均保留原路径。
2. **编号缺 14 个**：8/10/17/18/20/30/31/34/35/38/51/52/53/54，多数已归档但号段不复用，新读者容易以为文档丢了。
3. **`plans/` 无日期前缀 49 份**：文件名看不出新旧，只能靠 git 时间。
4. **证据目录与素材混放**：`evidence/` 2871 MB 中 2374 MB 是重建产物；为拦住它们，`.gitignore` 写了 20+ 行逐目录白名单。
5. **索引手工维护必然漂移**：本轮已把 INDEX 的 7 份漏收与 4 个子目录计数修正；README §一 的「现状四句话」仍停在 2026-11-04。
6. **体量集中**：`HANDOFF.md` 697 KB、`CHANGELOG.md` 274 KB、`plans/2026-11-16-outdoor-agent-progress.md` 233 KB、`flow/进展.md` 192 KB——单文件过大，检索与 diff 都吃力。

## 十三、维护规则

- 新增文档先落四层：`docs/` 根=现行规格、`docs/plans/`=在建、`docs/evidence/`=证据、`docs/archive/`=历史；不属于任何一层就不要建。
- 命名：新文档用 `YYYY-MM-DD-主题.md`，不再占编号（编号已冻结）；`plans/` 内一律带日期前缀。
- 本页更新方式：重新扫盘生成，不手工逐条改。生成脚本本轮为一次性使用、**未入库**；若要把「扫盘生成」常态化，应提交到 `scripts/` 并在 CI 里校验（需人 review）。
- 本页不写结论、不替代 INDEX：只回答「有哪些文件、多大、什么时候动过」。
