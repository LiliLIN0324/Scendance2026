# Binggo 场景资源 Agent

日期：2026-10-03。专属分支：`codex/binggo-scene-tools`。上线代码：`9972522`（后端实现 `f4feabb`）。

## 问题与实现

旧文字策划在浏览器中把帐篷等要求直接挡住，服务端也只接受八类基础模型；DeepSeek 看不到真实资源目录，不能返回资源操作。因此只有聊天入口，无法完成资源库布置。

现在，Agent 将当前完整场景、选中实例、234 项公共资源索引、本人最近 100 项 GLB 资产及场景内已授权资源提供给 DeepSeek。实例 ID 到资源引用的映射让它能按名称识别现有模型。索引约 16 KB，不发送下载地址或存储路径；私人模型尺寸未知时要求补充，不能把原始 GLB 包围盒当作实际尺寸。

模型通过 `add_resource`、`replace_resource` 选择资源，Agent 将已知引用解析为真实资产 ID；原有移动、旋转、删除等操作仍针对实例。严格字段、资源存在、尺寸、边界、结构、锁定、授权、租约与修订校验继续生效。宽深限定 0.02–50 m，高 0.01–30 m；不支持直接修改 GLB 内材质。最多一次修复，保留原有请求和每日预算。

前端文字策划统一使用 modify，支持空场景和现有场景。场景没有变化时只显示回答，不保存或增加撤销历史。新增资源先授权和加载，随后沿用 proposals/apply 与可撤销画布更新。

缺少适合模型时返回最多三个 modelSuggestions：物体名称、原因和单件模型描述。点击“前往 HY3 生成”切换同一个 Agent 的生成页签并预填；已有草稿需用户明确替换，待核对请求不会覆盖，不自动提交收费生成。建议和聊天按账号/项目隔离。

Binggo 小狗图片、动画和主站其他模块未改。图片 SHA-256：`bc146412343ffe23a475ab63d0929e55139376b2962e613accc60a26a35664d2`。完整提示词见 [AI_SYSTEM_PROMPT.md](AI_SYSTEM_PROMPT.md)，接口见 [API.md](API.md#binggo-资源-agent)。

## 验证边界

- 重现旧问题：浏览器组件对“从资源库加入一顶帐篷”不调用 DeepSeek；后端 add_resource 不能通过旧指令 schema。两处均有回归测试。
- 最终集成基线：后端 19 个文件、178 项测试通过；前端 127 个文件、1635 项通过。类型检查、Edge 检查、Next 生产构建、定向 ESLint 与 git diff 检查通过。数据库测试用隔离 PGlite，验证真实授权、提案、幂等重放和 apply；提供商在这些测试中为受控实现。
- 真实 DeepSeek：两次返回有效场景提案，选择真实 Folding Beach Chair，保留原锁定物体，并为库中不存在的定制透明玻璃孔雀生成 HY3 建议。同 requestId 重放保持提案和建议，无新增模型请求。
- 前两次真实链路脚本分别在默认 notes 字段比较、误用 GET 素材授权接口处停止。这是验收脚本错误；已修正，未修改产品去绕过检查。临时项目均已清理。继续调用时得到 `429 DAILY_BUDGET_EXCEEDED`，没有提高预算或更换请求绕过限制。因此没有完成真实提供商连续“加入 → apply → 再移动”验收；该链路由本地数据库与前端回归覆盖。
- 不收费的真实云验收：通过正确 POST 素材授权接口下载 28,168 字节 GLB，验证 glTF 文件头；资产场景使用普通 scene.save 保存并重开一致。这个验证与 proposals/apply 的本地集成证据分开记录。
- 浏览器：预览和正式域名加载新 Agent；两页签、草稿保留、场景物料数、小狗图片正常。手机 390×844 面板 x=12,y=100,w=366,h=624，无横向溢出。HY3 建议点击、预填、已有草稿与请求保护均有前端交互回归；本次没有提交真实 HY3 生成。

## 发布与回退

- 前端以最新线上 `16ced9d` 为基线，保留工作室管理等既有更新。Pages 正式部署：`28d0c30c-52e8-47a3-9bce-20b186a2fd59`，来源 `9972522`，站点 <https://scendance.charlestech.org>。预览 `2d8a95bb.scendance-scene-planner.pages.dev` 与正式版使用同一构建，157 个文件全部命中缓存。
- 前端回退目标：`38cf9680-3f37-41e9-80a1-7f9029262a74`，来源 `16ced9d`。提升前再次确认生产基线没有变化。
- Supabase `scene-api` 从 v10 更新为 ACTIVE v11，bundle SHA-256 `0873d9eb7a62446cf1869a9dd4a1ea3596abc8a91021e0f883fc297883957d5d`。generation-worker v5、reconstruction-worker v2 未变。
- 发布前从线上下载 v10，12 个入口及依赖文件逐字节匹配 `16ced9d`。v10 bundle SHA-256 `1dac66f3e3536459549cb2458fa2a9a980b4facfe0f61f18c49a86e0a87c2eab`，回退可使用该提交的 scene-api。备份与对照证据保存在忽略目录 `output/playwright/binggo-tools-release/backend-before/`。
- 未修改密钥、供应商配置、每日预算或数据库迁移；已在线上的工作室删除修复保持原样。没有合并 main/dev；Pages 的 --branch main 只指定生产环境。

本地浏览器截图、部署日志和脱敏测试证据位于忽略目录 `output/playwright/binggo-tools-release/` 及 `output/playwright/binggo-tools-*.png`，不含凭据或签名 URL。
