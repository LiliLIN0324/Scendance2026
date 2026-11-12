# 可信公共模型：普通本机冷重开

2026-10-10。来自 PetitMaker 恢复链的有界学习，详见已冻 petitmaker-recovery-followup.md；不是泛化资源平台或V4模型文件打包。

## 已证实的缺口

本机应用公共素材后可能保存签名 URL。登出后冷缓存普通 saveLayout/loadLayout 路径继续拿旧 URL，受控403下 useGlbAssets 和交付准备均失败。可信发货公模存在本地资源；渲染拒绝旧URL不是几何丢失，交付已拒绝占位，不称静默输出坏模型。V4预检已补公共URL，初次文件恢复假设被反证，不能修不存在的V4缺口。真实账号到期未上机。

## 唯一ownership

原“幕景 · 本地备份与恢复”实施独立可信公模resolver及测试、use-glb-assets.ts与scene-delivery.ts两consumer及对应必要回归。真实路径按import定位；online-models.ts优先只读，必要改映射先报。原前端继续任务UI/BackendSession/持久化hook，不并改这些consumer；不回退别人的修改。

不改共享契约、SQL/client、V4/modelFiles、原GLB、美术或历史存档，不重写存档URL。只从当前已核素材表的具体assetId取得可信解析；private、unknown、伪public标签不得fallback。先核已知ID带自定义/变体URL的合法语义，不能回卷真实变体到公模。浏览器渲染和交付用同一解析，不把占位记为ready。

接线前补充：已知公共ID加任意自定义URL的401/403仍不足以确认原地址是同一个公共模型。缺URL可依据可信目录；有URL先保留成功加载。授权失效后的fallback还须确认该地址对应同ID的可信资源路径/来源，不能依据public-looking网址或可伪造标签。已知公共ID带私有、自定义、变体或无法确认的路径，仍保原失败，不静默换为默认素材。现固定HTTP错误文本可窄匹配，网络/取消/404/格式失败不fallback；本轮不为此扩通用错误框架。必须增加“已知公共ID＋自定义私URL403”不回退测试。

owner重新核 assets.ts 的 owner/id/sha256.glb、backend 固定 scene-assets bucket、API签名记录、asset-ids精确别名及merged真实GLB摘要后，root接受具体谓词：精确同ID目录alias，或当前可信backend origin＋固定 `/storage/v1/object/sign/scene-assets/<owner UUID>/<same asset UUID>/<catalogue SHA>.glb` 路径并有token。SHA仅判断此签名恢复时lazy读取，避免大目录进入首屏。配置缺失、跨旧环境、ID/hash/host不符保持失败，不猜原身份。渲染使用既有公开后端配置，交付沿controller当前config，不另设开关。语义已定，修复/相关测试与真实UI仍未完成。

## 完成证据

- 原受控冷缓存403失败用例修前红、修后恢复可信GLB；两个consumer结果一致。
- 私有、未知和伪public不能误用公共模型，已有授权错误保留；原存档及assetId不变。
- 现素材/CDN/V4/模型重开相关回归与严格类型检查通过，精确源码hash冻结。
- 原前端纳入新的固定组合，真实浏览器核冷加载及可交付画面；受控模型和真实Auth过期分开记录。

当前已分配实施，尚未修复或验收。页面hidden保存另由原前端持有，不并行写该hook。没有付费/Git/正式部署或定时任务。

## 当前代码验收（2026-10-10，UUID补充版）

原owner六文件实现已完成；root实读解析与两consumer/测试边界，并按delivery-proof.ownedFiles核工作树及自有fixed副本六摘要全部一致。当前20 helper＋6真实渲染hook＋17交付检查合计43通过，严格类型、目标lint和自有隔离build退出0。大写合法公共UUID对应小写目录/签名路径用例先红后绿，内部仅查可信canonicalID，原item.id/assetId、cache key及存档不写回。新resolver SHA9ae9dfb0816ed532b7d67f89bfb16998b83d263af4a6db4d1d92c3be8df0fdf1，测试e61625218f9162489c8a929eecf573fd1cdd071a3da6426825a5ad742394af6a；其余四文件hash及完整表见工作区外petitmaker-public-asset-recovery-20261010/frozen-six.json。

旧202相关检查及两缓存并发观测是before-UUID历史，不重复计为新包结果。越界主frontend构建和根643检查不算此片验收；事故单独报告，root已用已验固定out恢复3157，未回退共享源。当前六版browser/真实Auth过期仍未验。代码包正式交原前端纳任务建议后的新固定组合，需普通本机冷开、模型实际可见与交付非占位、私有/unknown/错hash/跨源拒绝及原资料保持，不能由单测或V4预检代替。
