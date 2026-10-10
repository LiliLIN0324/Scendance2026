# PetitMaker 恢复链后续差距检查

2026-10-10。固定上游为 [4e120e50c844198649454eec6069ac65a062a732](https://github.com/Stry233/PetitMaker/commit/4e120e50c844198649454eec6069ac65a062a732)，读取本机 `C:/幕景/upstream-references/PetitMaker`；幕景为检查时工作树，其他执行者仍在修改。前述 [界面](petitmaker-code-study.md)、[Agent](petitmaker-agent-adoption.md)、[成果流与 IO 修复](petitmaker-artifact-adoption.md) 已完成，不复跑其闭合问题，不修改冻结模块。

本轮只读生产代码，仓库唯一新增文件是本文。临时探针、配置和结果在 `C:/幕景/development-evidence/petitmaker-recovery-followup-20261010`；它们调用真实幕景模块，在独立 Vitest/jsdom 进程及其内存 localStorage 中运行。没有操作用户浏览器、主3157、数据库、账户、模型服务或 Git，也没有真实网络/付费调用。**找到两个新的、范围明确的候选；没有实施修复。**

| 次序 | 当前结果 | 建议 |
|---|---|---|
| 1 | 页面仅隐藏时，最新编辑仍在1500ms待保存窗口内；已实际观测 | 优先采用隐藏事件保存，沿现有保护处理，不新建恢复系统 |
| 2 | 普通本机重开公共模型时，过期加载 URL 没有按可信 ID 找回已发货本地模型；已受控观测 | 由root评审公共ID解析增量；私有/未知ID不回退，文件备份已有能力保持 |

## 1. 页面隐藏时未保存最后一段修改

### 上游机制 → 幕景路径

Petit 的 [flushAutosave](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/autosave.ts#L102) 102–108 行清 pending 和定时器，并立即写当前存档；[bindLifecycle](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/autosave.ts#L114) 117–121 行同时监听 `document.visibilitychange` 的 hidden 状态和 `window.pagehide`。这项可借鉴的是浏览器生命周期事件；不引入其单地图存档、压缩、游戏历史或配额丢弃策略。

幕景真实入口是编辑动作 → 当前 layout → [useLayoutPersistence](../../frontend/components/room-organizer/hooks/use-layout-persistence.ts:250) 的250–284行安排保存；默认 [AUTOSAVE_DEBOUNCE_MS](../../frontend/components/room-organizer/lib/constants.ts:5) 为1500ms。[291–306行](../../frontend/components/room-organizer/hooks/use-layout-persistence.ts:291) 的flush只绑定 `pagehide` 和hook卸载，没有隐藏事件分支。它会保护 held main save，使用最新layout ref写入并记录恢复点；无需重写这些能力。

### 实际隔离观测

探针先使用真实 `useLayoutState`/store 和 `useLayoutPersistence` 完成本机hydrate与身份确认，再将场地宽度10改为11。以下观测均在cleanup前完成，因为cleanup/unmount本身会补保存。

| 边界 | 经过时间 | 内存宽度 | 存档宽度 | 待保存状态 |
|---|---:|---:|---:|---|
| 只发 hidden `visibilitychange`，不发pagehide、不卸载 | 0ms | 11 | 10 | true |
| 同一编辑发pagehide，对照 | 0ms | 11 | 11 | 页面离开路径完成写入 |
| 同一编辑让现有计时器完成，对照 | 1500ms | 11 | 11 | false |

真实模块观测检查3/3、退出0。它们断言**缺失隐藏保存分支的现状**及两个现有成功对照；不是修复测试变绿。hook运行前后SHA均为 `15cc928bf30b94748f7ace9d107a550fcbad87a60a42d107e0c4dbba65175e2b`。

证据为 [探针](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/hidden-save.probe.tsx)、[观测JSON](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/hidden-save-observations.json)、[源码摘要与退出码](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/hidden-save-proof.json)、[运行日志](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/hidden-save-run.log)。

已证明的是隐藏事件不触发待保存编辑写入。若隐藏后定时器未运行、页面又被系统丢弃且没有pagehide/正常卸载，重开会读旧值，这是条件推断；**未做手机系统杀页或真实崩溃实验**。hidden保存也不能消除存储满、存储禁用、进程在事件前死亡等其他失败。

### 最小所有权、修复与必要验收

交给当前前端owner，只需 `frontend/components/room-organizer/hooks/use-layout-persistence.ts` 与其独立回归文件。将 hidden 状态沿现有flush入口处理，卸载时解绑；不得绕过已有hydration/held-save、save epoch、已验证文件恢复和当前活动身份保护，不写独立源图/商务域。不在本次引入持久化撤销栈或新存档格式。

必要回归是 pending edit + hidden 立即落盘；visible状态/无pending不额外写；hidden之后timer、pagehide和unmount不重复提交；held-save保持原不可读存档；已验证restore后的旧pending不回写；quota/blocked失败保留现有错误语义，不能显示假成功。现有 [close/reopen用例](../../frontend/components/room-organizer/hooks/use-layout-persistence.react.test.ts:270) 走unmount，不能替代hidden检查。上游 [autosave.test.ts](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/__tests__/io/autosave.test.ts#L326) 326–365行有hidden、visible和无pending对照，本轮未运行上游测试。修复完成后，前端再在其自有固定副本验证页面切换/隐藏，不用用户现有浏览器作试验。

## 2. 普通本机重开公共模型，过期地址没有找回已发货本地副本

### 上游机制的可用范围

Petit 的 [ModelSpec](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/core/model/model-spec.ts#L66) 是声明式几何；[buildSaveFile](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/json-codec.ts#L123) 保存 `catalogId` 和实例字段，[buildCatalogInfo](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/export-json.ts#L118) 导出用到的名称、占地、类别和load。恢复不依赖用户签名模型URL，可学习稳定身份与应用资源解析分开。它不是幕景外链资产协议，不包含GLB原件；[catalogHash](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/share/canonical.ts#L78) 只含ID/占地/类别，[validateImportedState](https://github.com/Stry233/PetitMaker/blob/4e120e50c844198649454eec6069ac65a062a732/src/io/share/validate.ts#L19) 的drift提示不等于归档模型版本或byte验证。不能直接搬游戏目录校验替代幕景资产身份。

### 当前真实触发链

1. [CloudPanel.acceptScene](../../frontend/components/room-organizer/panels/cloud-panel.tsx:141) 在150行取得授权加载URL、155行预载、160行放进 `backendSceneToLayout(...assets)`，171行交给场景。工作台 [onLoadLayout](../../frontend/components/room-organizer/room-organizer.tsx:1207) 应用布局。
2. [saveLayout](../../frontend/components/room-organizer/lib/persistence.ts:268) 273–275行校验业务资料后直接将布局写JSON，保存已有 `glbUrl`。[退出登录](../../frontend/components/room-organizer/panels/cloud-panel.tsx:244) 清身份/连接UI，未换掉场景；本轮不修改或调用该账户流程。
3. 普通冷重开 [loadLayout](../../frontend/components/room-organizer/lib/persistence.ts:33) 只走 `parseStoredLayout`，由 [hydrateFromLocalSave](../../frontend/components/room-organizer/hooks/use-layout-persistence.ts:152) 和工作台 [onHydrate](../../frontend/components/room-organizer/room-organizer.tsx:713) 应用。此路径不经过 `layoutForExport`。
4. [useGlbAssets](../../frontend/components/room-organizer/hooks/use-glb-assets.ts:15) 17–18行按保存的 `item.glbUrl` 加载；未登录的 [重授权effect](../../frontend/components/room-organizer/panels/creative-studio.tsx:248) 退出。[prepareDeliveryAssets](../../frontend/components/room-organizer/lib/scene-delivery.ts:142) 未登录也只取 `item.glbUrl`，未使用同ID的本地资源。

因此具体场景是**打开云端公共库模型 → 保存到本机 → 退出登录 → 原加载URL失效 → 冷刷新**。签名失效在隔离检查中用受控403模拟；未对真实账户或服务执行这一流程。

### 实际隔离观测及被推翻的假设

可信表 [asset-ids.json](../../assets/library/asset-ids.json) 有528个 `/showcase/assets/library/model/` 别名。抽样ID `6a4e04d0-57a7-528b-863c-41ee15c91fa7` 对应已发货沙滩折叠椅；文件实际存在、28168 bytes，通过现有 `validateGlbBuffer` 结构检查，SHA-256为 `eb631b23a79b71a6f20e779d7441b3ef19f5f29192ab25d168065324950af3f6`。这证明样本资源存在及结构有效，**不声明实际浏览器模型渲染已验收**。

| 观测/对照 | 结果 |
|---|---|
| 正常 `saveLayout → loadLayout → useGlbAssets`，公共ID带模拟过期URL，所有fetch受控403 | 缓存error；界面加载与交付准备共请求旧URL两次，未请求本地别名；交付拒绝 |
| 正常本机重开公共ID但无URL的兼容夹具 | 缓存idle、请求0次；交付要求连接项目。没有找到当前UI自然产生无URL的完整链，只作兼容观察，不能另报主触发 |
| 文件预检对照，输入无URL或旧URL | 自动补 `https://cdn.3dassets.dev/assets/39459/v1/model.glb`，ID匹配可信表；旧私人加载URL被去掉。**文件备份恢复并不存在此前猜测的ID-only idle问题** |

这组真实模块观测4/4、退出0；实际网络被fetch stub拦住。首次探针曾错误地把文件预检当普通本机重开，并用不适合交付的gable roof夹具，2项断言失败；已保留日志、校正scope和合法夹具，再得到上述结果。没有用修生产源码使假设成立。

现有 [checkedLayout](../../frontend/lib/local-project-backup.ts:278) 在297行返回 `layoutForExport(layout)`；[layoutForExport](../../frontend/lib/layout-export.ts:4) 的备用表只选HTTPS CDN，已有精确本地URL时才保留它。[备份测试](../../frontend/lib/local-project-backup.test.ts:595) 已覆盖该授权地址清理和公共URL补齐。这里已有能力保持，不增加V4模型文件、不扩大备份覆盖。

证据为 [探针](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/public-asset.probe.tsx)、[观测JSON](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/public-asset-observations.json)、[源码摘要与退出码](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/public-asset-proof.json)、[运行日志](C:/幕景/development-evidence/petitmaker-recovery-followup-20261010/public-asset-run.log)，以及该目录 `public-asset.first-hypothesis-failure.log` / `public-asset.first-hypothesis-proof.json`。两实际加载/交付模块在首次假设检查前至校正检查后摘要保持不变。

### 最小所有权、采用边界与必要验收

建议root先审此可用性增量：仅根据可信公共ID表找已发货本地GLB，两个消费入口共享同一解析，加载时不改场景文档/保存地址，不按 `source:'public_library'`、名称或任意文件路径推断公开身份。可在现有 `frontend/components/room-organizer/lib/online-models.ts` 的 [ID反查先例](../../frontend/components/room-organizer/lib/online-models.ts:181) 附近放窄的公共模型URL解析，再分配 `hooks/use-glb-assets.ts` 与 `lib/scene-delivery.ts`；原有相关测试及一个冷重开回归属于同一owner。若root更适合独立小helper，可调所有权，不需要新增资产协议、client transport、SQL或共享UI重构。

私有/未知ID继续原授权路径，不能以公共标签冒充公开资源；本地公共资源也沿现有GLB字节检查，不把占位几何算成功。当前 [assembleDeliveryScene](../../frontend/components/room-organizer/lib/scene-delivery.ts:178) 已拒绝未就绪模型，故此问题是公共资源重开可用性，**不是静默导出错误模型**。

必要验收：真实可信公共ID＋过期加载URL＋空缓存＋未登录时能从已发货别名读取且进入ready；缺URL兼容路径同样工作；私有/未知ID和仅伪造public标签不走本地fallback；同ID已有ready缓存不被换成别的版本；迟到旧请求不能覆盖新的成功；本地文件失效时仍明确失败且不交付占位模型。使用本地真实GLB字节的受控请求测试，随后前端固定副本验证真实显示和交付重载；无需付费或真实账户签名过期等待。

## 3. 检查后未增加候选的边界

首次载入不可读存档保留、held-save、应用异常、reset恢复副本、版本拒绝、旧布局明示修复、独立照片原字节与V4来源范围，已有对应保护；本轮没有发现新的确定缺口，不再列功能建议。撤销历史的首次恢复会清内存栈，而Petit能还原匹配历史；幕景已有明确会话边界与独立版本环，前述成果报告也已说明V4不带撤销栈，不重复当Bug或默认扩格式。游戏v1坡道坐标迁移、目录hash和来源改动比例不适用专业场地、客户批准或合同规则。

本轮结论来自两组隔离观测和真实调用链。生产代码始终只读；任何修复仍需root分配所有权后实施。查读中的Windows字面glob/误猜文件路径已改为真实目录配 `-g` 或已定位文件，复用既有 [路径定位Skill](C:/Users/endTree/.codex/skills/windows-local-artifacts/references/windows-cli-linux-boundary.md)，没有转码/替换正常源码，也没有修改该Skill或其他共享文件。
