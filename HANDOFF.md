# HANDOFF.md — 长会话交接单

> 维护规则：永远只维护这一份（不另起 `HANDOFF-2.md`）。新会话开场第一句先读它，结束前必须更新。
> 最后更新：2026-11-05

---

## 一、当前任务

Scendance2026：把「拍照/视频采集 → 3DGS 重建 → Web 画布交付」这条链路做成可售产品；这一轮在推**小程序采集器可用性 + 按次付费闭环**（可用率、定价、付费通道三件套）。

## 二、已完成（2026-11-05 这批）

- **导出合成 3DGS 打通**：`paintFrame` 接进导出管线，成图 1920×1080、2,722,871 B；与「无点云」对照逐像素 diff 69.24%（证据见 `COLLAB.md:24`，产物在 `exports/effect-splat-guides-off-1920x1080-20261105-083425.png`）。
  - **但这条分支没被真正走到**：默认场景（酒店大堂）没有 `splatGuide` 三组物件，`guides:false` 是空操作；新图与旧图字节完全相同，只能说明「没改坏」，不能说明「guides 生效」。
- **小程序 0.1.2 已上传**：包体 1,253,737 B（CLI 体积报告 `.temp/mp-automator/preview-layer.txt`），编译无报错，AppID `wxd16c2833f4591a29`。
- **采集页两个真机 bug 已修**：
  - 「太远」恒触发：原判据量的是**照片短边像素**而非距离；改为硬拦只留糊/重复，偏小偏暗偏亮降级软提示，桩数据 0/5 → 3/5。
  - 层判定接上姿态：`|beta|` <72° 俯拍 / 72–108° 平视 / >108° 仰拍，±6° 滞回；手动选层后姿态再动 8° 收回判定权；`beta==null` 时出第 4 颗胶囊「无法判定」并锁快门。
- **docs 全量审计**：138 份，1,683,622 → 1,682,572 字节；4 处重复合并（−1,710 B）、4 处过时修正；报告 `.reports/docs-audit-2026-11/audit.md`。
- **Web 体检**：P0 4 / P1 7 / P2 7（共 18 条，W-01–W-18），全表 `.reports/web-audit-2026-11/issues.md`。
- **`COLLAB.md` 已建立**：与 Qoder（LiliLIN0324）的文件所有权边界 + 提交纪律。

## 三、卡住的问题

- **体验版二维码**：只能在 `mp.weixin.qq.com` 后台生成，CLI 与插件都做不到；登录态拿不到（Chrome 只有 Default profile、Cookies 被占用）。**需要用户扫码**。
- **computer-use 扩展**：包本体在 `D:\Programs\Trae CN\resources\app\extensions\byted-solo.builtin-mcp\node_modules\@byted-solo\computer-use-mcp`（v0.81.3），`plugin-config.json` 里 `user_enabled` / `app_origin_enabled` 均为 true（08:02 写入），但 IDE 主进程 00:29 启动 → 运行期从未注册。**需要 `Developer: Reload Window`**。
- **价格两套账**：代码 `pay_skus` 仍是 `scan_1 = 490`（¥4.90），`docs/45` 定 ¥9.99 / ¥24.99；`PAY_DAILY_JOB_LIMIT` 3 次/天 vs `docs/45` 的 1 次/月。**没人拍板，未改**。
- **待删文档**：5 份共 62,049 B（34、team/reports/A/A01、33、27、42-1.0.1），清单已出，未执行。
- **产品开关**：「三层覆盖」删不删、姿态不可用时是否允许手动拍摄，都等用户点头。

## 四、下一步计划

1. 修 `.next` 冲突（dev 与 build 共用 `frontend/.next`，导致 `/pricing`、`/review/<id>` 500）：用 `NEXT_DIST_DIR` 分离后一次解决 3 条 P0。
2. W-04：Web 端补上传/分片直传通道（24h，最大缺口）。
3. 研究线：#3 微信虚拟支付后台实测（能否建商户号、发 1 分钱沙箱单）→ #2 五个不同场景各 1 条 60s 视频，测成功率 p。
4. 找一个带 `sceneAnchor` 的地理底图场景，重跑导出 A/B，把 `guides:false` 分支真正压到。

## 五、踩过的坑（救命用）

- 微信开发者工具装在 **D 盘**：`D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`；扫 C 盘与 `%LOCALAPPDATA%` 都会判错。
- 「太远」判据量的是**照片短边像素**，不是距离；手机 `takePhoto quality:'high'` 普遍短边 720。
- 层判定曾读默认 `layerIndex=1`，全页没接 `onDeviceMotionChange`，所以「怎么拍都是视线」。
- 3000 端口 500 **不是代码缺陷**：dev 与 build 共用 `frontend/.next`（`next.config.mjs:11` 默认 `'.next'`）；`NEXT_DIST_DIR=.next-local` 起在 3020，12 条路由全 200。
- 模拟器里 `beta` 必然 null，在模拟器上验姿态判定无效。
- 提交 `8362728` 是 Qoder（LiliLIN0324）把整个工作区一次性 `add` 收进去（**108 文件、+63,085 行**），不是它写了新功能。
- `.gitignore:45` 把 `docs/evidence/aholo/` 放宽成整个 `docs/evidence/`，以后新证据无法入库。
- `miniprogram-automator` 在根 `package.json:30` 的 `dependencies`，应归 `devDependencies`。
- `frontend/.local-map*.mjs`、`.local-final.mjs` 这类调试脚本 `.gitignore` 无对应规则；当前目录已清理，谁再生成谁记得别被 `git add` 带上。
