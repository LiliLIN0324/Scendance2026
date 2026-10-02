# 本轮验证记录

日期：2026-10-02（America/Chicago）。目标为本地后端实现和部署材料；没有部署、创建云端账号或调用付费 API。

最终结果：**6 个测试文件、54 项测试全部通过**；TypeScript 检查、两个 Edge Functions 的 Deno 检查、Deno 运行冒烟和新增文件空白检查通过。工作室/项目/分享列表的 SQL 别名歧义已通过回归测试修复。

## 已验证

| 检查 | 证据与覆盖 |
|---|---|
| TypeScript | `npm run typecheck`，严格类型检查 |
| PostgreSQL 迁移与业务 | `npm test`，在 PGlite 实际 PostgreSQL 引擎中创建 Auth/Storage 最小测试边界，执行全部业务迁移 |
| 成员与服务权限 | 匿名/登录角色不能直接读写业务表，不能直接调用业务/任务 RPC；非成员不可访问项目 |
| 编辑租约 | 第二用户/同用户第二会话拒绝；续期/释放；过期不可复活；代次变化使旧写请求失效 |
| 保存与版本 | 相同 revision 的两次竞争请求仅一次成功；旧版本不能覆盖；失效请求不修改云端场景 |
| AI | 两个布局模板、有限命令、锁定对象、边界校验；最多一次修复；本地版本/哈希、云端版本、租约改变使提案失效；一次应用返回撤销前快照 |
| 资产与分享 | 只有项目引用资源可被成员读取；复制后删除一个实例不删除共享资产；内部备注/私人平面图不出现在客户数据；发布不可变；撤销后的新读取失败 |
| 预算和任务 | 同幂等键复用同任务、不同指纹冲突；全局单并发；额度检查；worker token 防旧认领写入；超时不重新提交付费任务 |
| 模型 | 真实二进制 GLB 的 Khronos 验证、尺寸/偏移计算；格式损坏、扩展不兼容、任意下载域名和超限流拒绝 |
| HTTP | Request → 鉴权边界 → Zod → PostgreSQL RPC → Response 的项目/发布/撤销闭环；CORS、未知字段、缺少服务配置保护 |
| Edge 编译 | `npm run check:edge`，两个 Deno 入口通过检查 |
| Deno 实际运行 | `npm run smoke:edge`，载入生产模块，运行 Khronos GLB 校验器并调用 health handler |

测试中的用户认证和 Storage 上传/签名为明确的测试替身，提供商响应受控；没有把它们当作真实 Supabase 或付费模型验收。PGlite 单实例会串行执行请求，竞争保存测试证明数据库版本保护结果，但不替代独立 PostgreSQL 连接的锁等待/死锁测试。

## 真实免费素材导入

执行 `npm run check:public-model`，使用真实公开 API 和模型文件，无固定测试返回：

- 来源：[Poly Haven Chinese Armchair](https://polyhaven.com/a/chinese_armchair)。
- glTF + 1K 纹理打包为 GLB：**1,702,284 bytes**。
- 2,675 个三角面，1个 primitive，3张保留纹理。
- 包围盒尺寸 width=0.8482747674、height=1.5874828653、depth=0.7886627614（模型坐标单位）。
- Khronos 校验无 error，1条 warning；成功经 glTF Transform 读取并计算落地/中心偏移。
- 输出同时记录来源、CC0 页面和获取时间；没有上传到云端或验证浏览器实际绘制。

## 明确未通过完整验收的项目

1. **完整 Supabase 本地栈**：当前主机没有运行 Docker PostgreSQL，`supabase db advisors --local` 与 `migration list --local` 均在 `127.0.0.1:54322` 返回 `ECONNREFUSED`。配置被 CLI 解析，但 Advisors、平台 Auth/Storage/PostgREST 与真实多连接事务待完整本地或测试项目验收。
2. **真实账号登录和两成员协作**：提供初始化脚本和接口，未实际创建/登录账号。
3. **DeepSeek / Hunyuan 真实调用**：依据官方文档实现适配器并验证请求形状/异常状态，但未使用真实凭据、产生任务或核对账单。TokenHub 当前账号入口兼容性待验证。
4. **云端部署与定时任务**：迁移、配置、Vault/cron 安装材料已保存，尚未部署或安装调度。
5. **前端、GLTFLoader、手机及大陆网络**：不在本次实际执行表面内；拖拽、物理尺寸映射、单步撤销、模型资源释放、手机 FPS 和首屏耗时需要前端联调。

这些边界不会被“单元测试通过”替代。完整验收路径和恢复方式见 DEPLOYMENT.md。
