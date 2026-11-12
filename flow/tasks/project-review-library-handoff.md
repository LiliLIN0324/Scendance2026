# 方案评审草稿与冻结文件 · 执行交接

最新用户发布偏好：按完整版本集中交付，不再随时Git。此前前端“验收后自行commit/push”安排已撤销；本轮继续本地整合、测试、独立build和实机验收，报告版本候选与必要暂存状态，等待导演统一安排版本发布。已推送309932f保持不变，不撤回。只读Git核查仍可做，禁止动他人暂存或把小修拆成连续推送。

2026-10-09，用户明确“你也可以负责计划，其他对话执行”。主线程转为范围、优先级、协作顺序和验收统筹，前端对话接手本轮实施收尾。当前全部下列前端代码已冻结，主线程和子agent不再改这8文件。

状态更新：后端309932f已推送。恢复等待期丢稿P2及迟到载入、恢复拒绝后继续生成、StrictMode初读已修并完成独立复验；386项、types与独立build通过。当前由前端完成真实浏览器验收后保留本地候选，与执行时间表一并整合，按最新用户要求集中发布。creative-studio.react.test.tsx已纳入第9文件；历史问题细节见flow/进展.md。

## 责任与发布顺序

- 前端执行：幕景 · 前端交付流程，01a11491-022e-7a70-b757-cd8917e0fbcd。
- 独立备份审查：幕景 · 本地备份与恢复，01a1153f-af97-7591-a5e9-96174a442bc4，评审库复验已完成，现仅执行独立时间表模块。
- 后端执行：幕景 · 后端交付契约，01a11491-0859-7602-9b97-37a2c8e3254f，8个UUID修复文件已发布309932f。
- 前端完成本地测试/实机收口及后续时间表集成，暂不暂存或提交；按完整版本由导演统筹。不得合main/部署/调用付费模型/重建定时任务。

## 本轮前端8文件

1. frontend/lib/project-review-library.ts
2. frontend/lib/project-review-library.test.ts
3. frontend/components/room-organizer/panels/project-review-library.tsx
4. frontend/components/room-organizer/panels/project-review-library.react.test.tsx
5. frontend/components/room-organizer/panels/project-review-panel.tsx
6. frontend/components/room-organizer/panels/project-review-panel.react.test.tsx
7. frontend/components/room-organizer/panels/project-review-panel.css
8. frontend/components/room-organizer/panels/creative-studio.tsx

新4文件当前可能未跟踪，不得用checkout-index漏掉它们。其他后端/研究文档/flow改动都不属于前端发布。

## 实现约定

- 复用source-storage readSourceRecord/updateSourceForm，compound key为['project-review-library', JSON.stringify([apiUrl,userId??null,scope])]。
- 草稿只有summary/pending各1000字，显式保存/载入/放弃。公开brief/design/includeImage/includeReference和逐图批准不持久化；根onLoadDraft使用initialSettings再加两文字，完整身份变化清许可、作废当前file。
- 根identityMatches在渲染时阻止旧ready/file/draft传给新身份；新子组件收到空draft，避免误判旧身份遗留为新草稿dirty。
- file保存仅接根ready file，原snapshot id/title/generatedAt/source和生成HTML冻结。历史始终独立预览下载，不塞回根prepared/file，不改成当前revision。
- 每文件40MiB、每库20份/96MiB，不自动驱逐；只支持应用生成的静态客户HTML，回读与写入都校验tag/attribute/CSS/data-image/CSP，以及正文编号、标题、附录冻结时间与metadata一致。下载前fresh读回核同id内容。
- 草稿CAS认可版本独立draftRevision，仅初始/显式read、确认load或save并核实readback成功更新。不得因file-save/download/remove读取全库而偷换草稿CAS。A保存r2、B写r3、A回读失败，再点保存必须仍拒绝直到显式重读。原文字保留。
- registerSourceFlush(scope)阻未保存文字或正在saveDraft的活动切换/备份；基线来自本次挂载或成功save/load，不把没载入历史草稿与空编辑器的差异当dirty。
- 历史库不纳入V3/V4活动备份，UI明确需单独下载文件。原评审即使本机库读失败仍可生成/直接下载，库不能写空覆盖。
- 顶部新增原生details“本机草稿与文件”，内部紧凑历史details；没有新增一级模式。

## 已有检查，仍需执行者最终核验

- 存储worker：library50 + existing project-review51=101通过；metadata增量也在内。
- UI worker：29组件回归通过，含CAS时序和三个无关文件操作不接受新草稿revision；最终typecheck在交接时仍只读执行，无代码改动。
- 根：ProjectReviewPanel35项通过，包含载入文字清全部许可、同scope换账号/API清旧内容；review-library-parent-tests.log、review-library-types.log在C:/幕景/development-evidence。此日志先于UI最后CAS收口，应最终合跑。
- 当前未做本轮最终build/真实IDB/浏览器验收，不能据单测称本机持久化已实测通过。

## 最终验收路径

1. 相称合跑新库、新子组件、原panel、相关Provider/备份/评审回归，typecheck和lint。
2. 单独副本build，不在3157运行的frontend/.next中构建；此前副本reference-read-build-copy仍服务18456/18458/18460，更新会影响这些测试页，先核存活、留存结果再操作。
3. 实机18460是30人演练、39物件20任务、有一张原图和3点；id c0a00000-0000-4000-8000-000000000900。上一轮验收椅宽.55，其他记录保留。可以在新隔离origin演练，别覆盖用户真实资料。
4. 填两段演练说明→保存草稿→明确勾选范围生成无图/有图文件（图片须人工确认）→保存冻结文件→刷新。载入草稿只有文字、全部公开选项仍false；历史可预览下载，下载字节与生成时完全一致。
5. 修改当前文字/布局再生成新版本，旧文件保持旧时间/编号/内容；不得说旧文件已和当前项目自动比对。未保存说明确实阻切活动，保存或放弃后可继续。
6. 另页并发、读失败、未批准图片等故障以测试验证，不手工破坏真实浏览器IDB。保存后必须读回验证；失败不能写成成功。
7. 截图与实际下载留证据，发布前把未完成/限制写清；后端发布结束并获导演消息后，明确8文件及相关说明单独提交推送原分支，报告commit和验证范围。

## 工具与运行注意

Node26/JSDOM测试临时NODE_OPTIONS=--no-experimental-webstorage。Windows中文CLI回执用进程PYTHONIOENCODING=utf-8，不转码业务文件。浏览器只用CUA，不通过evaluate改React/IDB；文件chooser/download等待必须先注册并catch超时。2D点击后的第一帧可能仍3D，先核DOM和实际捕获像素再判bug。不要因过期exec handle盲目重启服务，先查监听/进程。
