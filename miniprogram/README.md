# 现场采集器 · 微信小程序骨架

独立轻工具：**选/拍照片 → 逐张快检 → 提交重建 → 拿 3D 结果**。无登录、无账号、无项目、无付费、不接工作台。

## 怎么跑

1. 微信开发者工具 → 导入项目 → 选择本目录 `miniprogram/`。
2. AppID：已填入真实 AppID `wxd16c2833f4591a29`（见 `project.config.json`），用开发者工具登录同一主体账号即可预览/上传。
3. 编译即可看到 `pages/index`；模拟器没有真实相机，用「相册 / 批量」兜底；真机预览才能验证 `<camera>`。
4. 重建服务目前是 `services/recon.js` 的 **mock**：25–40 秒、非匀速进度、可手动触发三类失败，不用填 `config.js` 也能跑通全流程。接真实服务时只改该文件的 `submit / poll / cancel` 三个函数（契约见下）。
5. 工程配置口径：`compileType = miniprogram`（原生小程序，非插件/云开发项目）；`miniprogramRoot = "./"`（本目录即小程序根，无嵌套）；`libVersion = 3.0.0`（覆盖本项目用到的全部接口：`wx.chooseMedia` 2.10.0、`wx.createOffscreenCanvas` 2.16.1、`wx.getWindowInfo`/`wx.getDeviceInfo` 2.20.1，3.0.0 均满足）。

## UI 定稿：B 景深拟物（2026-11）

13 屏源见 `.reports/ui-b-2026-11/screens.html`，token 见同目录 `report.md` 第二节。这一版只改**材质层**，版式沿用上一版；`<camera>` 与快门 / 覆盖环 / 准星 / 箭头仍自绘，只按 token 调数值。

### 毛玻璃与降级规则

- 检测：`utils/glass.js → glassClass()` 读 `wx.getDeviceInfo().platform`，iOS / devtools / mac 挂 `glass-on`，其余不挂。
- 启用：`.glass-on .b-glass` = `rgba(0,0,0,.42)` + `backdrop-filter: blur(18px) saturate(120%)` + 四边 `1px rgba(255,255,255,.14)` + 圆角 18 + `0 16px 48px rgba(0,0,0,.48)`。
- 降级：`.b-glass` 本体 = `rgba(0,0,0,.62)` + **仅顶部** 1px `rgba(255,255,255,.14)` 亮边，保留圆角与阴影。没有模糊时 .42 压不住照片，也撑不起四边细线，所以加厚底色、只留顶部亮边保住边界。
- 检测是平台启发式（小程序没有 `CSS.supports`）；宁可 Android 多走降级，也不让文字悬在没模糊的 .42 上。
- 原生 `<camera>` 不参与 WebView 绘制：`backdrop-filter` 只能模糊 WebView 内容，**糊不到相机画面**；取景页玻璃胶囊仍靠底色 + 亮边保证可读性，不依赖模糊。

### 取景压暗

`<camera>` 不吃 `filter`，用一层 `.dim`（`rgba(0,0,0,.38)`，约等于 brightness .62）叠在相机上，再叠 `.b-vig-mid`（径向 55% 暗角）。两层都 `pointer-events:none`，否则快门点不到。

### 品牌绿

`#4A7C59` 只在三处：主按钮填充（`.btn-green`）、快门可用态（`.shutter.is-ready .shutter__core`）、覆盖环已拍段（`.ring__tick.is-on .ring__bar`）。TDesign 的 `--td-brand-color` 被压成中性灰，避免链接 / loading / cell 图标泛绿。

### 14 条 token 落点

| token | 值 | 文件 / 类 |
|---|---|---|
| 背景压暗曲线 | `to top, rgba(6,8,6,.94) 0% → .70 26% → .34 46% → .04 72% → 0 100%` | `app.wxss` `.b-veil` |
| 顶部补压 | `to bottom, rgba(6,8,6,.58) 0% → .26 34% → transparent`，高 260 | `app.wxss` `.b-top-scrim` |
| 毛玻璃 · 底 | `rgba(0,0,0,.42)` | `app.wxss` `page --b-glass-bg` / `.glass-on .b-glass` |
| 毛玻璃 · 亮边 | `1px solid rgba(255,255,255,.14)` | `app.wxss` `--b-glass-line` / `.b-glass` / `.glass-on .b-glass` |
| 毛玻璃 · 模糊 | `blur(18px) saturate(120%)` | `app.wxss` `.glass-on .b-glass` |
| 圆角三档 | 卡片 18 / 按钮 14 / 胶囊 22 | `app.wxss` `--b-card` `--b-btn` `--b-pill`、`.b-pill`、`--td-button-border-radius: 28rpx` |
| 阴影两档 | `0 16px 48px rgba(0,0,0,.48)` / `0 8px 24px rgba(0,0,0,.38)` | `app.wxss` `--b-shadow-float` `--b-shadow-btn`、`.btn-glass` |
| 快门双环 | 外 90 / 内 66 / 外描边 3 / 内描边 2 / 环间距 9；按下 `.94` + 内环 58 | `capture/index.wxss` `.shutter` `.shutter__core` `.shutter.is-down` |
| 暗角强度 | `inset 0 0 140px 40px rgba(0,0,0,.55)` | `app.wxss` `.b-vig`；`index.wxml` / `capture/index.wxml` `.b-vig` |
| 取景暗角 | `radial-gradient(118% 86% at 50% 44%, transparent 40%, rgba(3,5,4,.40) 78%, rgba(3,5,4,.64) 100%)` | `app.wxss` `.b-vig-mid`；`capture/index.wxml` `.b-vig-mid` |
| 文字不透明度 | `.96 / .72 / .45` | `app.wxss` `--b-w1/2/3`、`.t-cover` `.t-title` `.t-body` `.t-aux` |
| 品牌绿用法 | `#4A7C59` 仅主按钮 / 快门可用 / 覆盖环已拍 | `app.wxss` `--b-green` `.btn-green`；`capture/index.wxss` `.shutter.is-ready` `.ring__tick.is-on` |
| 字号四档 | 32/1.28/500 · 24/1.42/500 · 14/1.6/400·500 · 12/1.7/400 | `app.wxss` `.t-cover` `.t-title` `.t-body` `.t-aux` |
| 覆盖环 | 260 / 24 段 / 15° / 缺口 5° / 线宽 3 / 未拍 `.34` / 已拍绿 / 缺口琥珀 | `capture/index.js` `buildRingTicks()`（24 桶 × 15°）；`capture/index.wxss` `.ring` `.ring__tick` `.ring__bar` `.is-on` `.is-gap` |

### 已知做不到 / 偏离

| 项 | 处理 |
|---|---|
| `backdrop-filter` 支持不一致 | 平台启发式检测 + `.62` 兜底；无法像浏览器那样 `CSS.supports` 精确探测。 |
| `filter: brightness` 对 `<camera>` 无效 | 改用 `.dim` 半透明黑 view（`.38`），`pointer-events:none`。 |
| 毛玻璃糊不到相机画面 | `backdrop-filter` 只作用于 WebView 内容；取景浮层靠 `.42/.62` 底色 + 亮边可读，不依赖模糊。 |
| 09 屏进度条颜色 | `screens.html` 09 用品牌绿进度条，但 token 7 限定绿只在三处；实现改 `rgba(255,255,255,.72)`，绿只留给按钮 / 快门 / 覆盖环。 |
| 08 屏「缺 N 张 / 补拍」 | 未单独成屏：覆盖环 + 层标签 + 快门继续拍已承载同一动作；没有新增「缺 N 张」计数卡，避免改版式。 |
| 11 屏「拍摄失败」 | 未单独做纯黑失败页：失败瞬间出 verdict 胶囊（太暗/失败），快门即重拍，功能等价。 |
| Android 误判 | 平台启发式可能把个别支持模糊的 Android 也降级；优先保证可读性，不追极限效果。 |


## UI 组件库：TDesign 小程序版 1.17.0

依赖：`tdesign-miniprogram@1.17.0`（`npm i tdesign-miniprogram`）。**没有 `tdesign-icons-miniprogram` 这个包**（npm 404），图标由 `tdesign-miniprogram/icon` 自带。

### 接入方式

- 页面级 `usingComponents` 局部注册（`pages/index`、`pages/capture`、`pages/result` 的 json），不往 `app.json` 全局灌。
- `miniprogram_npm/` 是**按需裁剪后的依赖闭包**（14 个 TDesign 组件目录 + `tslib`，221 文件 / 407,155 B），不是完整 dist。完整 dist 是 1,177 文件 / 1,512,547 B，会把主包顶到 2.20 MB。
- **在开发者工具点「构建 npm」会用完整 dist 覆盖这个目录。** 保留手工裁剪目录，或构建后按当前组件重新裁；`project.config.json → packOptions.ignore` 已排除 `node_modules/` 与 `package-lock.json`。
- 深色：TDesign 的暗色 token 只在 `@media (prefers-color-scheme: dark)` 里生效；这里把它转成 `.td-dark` 类写进 `app.wxss`，三个页面根节点加 `td-dark`，即强制暗色、不跟随系统。B 定稿把 TDesign 的 `--td-brand-color` 系列压成中性灰（`#3F423F` 等），品牌绿只由 `.btn-green` 在按钮上局部注入；其余背景/文字/边框/阴影全部用 TDesign 暗色 token。

### 保留自绘（不要动）

只这四样 + 相机本身，原因都是**相机叠层，组件库没有对应组件**：

| 元素 | 类名 | 原因 |
|---|---|---|
| 快门 | `.shutter / .shutter__core` | 与覆盖环同心、按张数/可提交/提交中变色的物理快门 |
| 覆盖环 | `.ring / .ring__tick / .ring__bar` | 360° 覆盖度刻度，数据驱动逐格点亮 |
| 准星 | `.cross / .cross__*` | 取景中心四点框，必须在 `<camera>` 正上方 |
| 指向箭头 | `.arrow / .arrow--left/right` | 最大空洞方向提示，贴屏幕左右边缘 |
| 相机 | 原生 `<camera>` | 取景流本身 |

另外两处也保留自绘/原生，原因是不适合换成库组件：判定短胶囊 `.verdict` 与「对准场地」`.wait`（瞬时反馈叠在取景画面上，TDesign Toast 是居中遮罩弹层）；结果页 4 张预览缩略图（原生 `<image>`，不是图标/控件）。

### 图标替换（自绘 path → TDesign name）

| 位置 | 原自绘 | 换成 |
|---|---|---|
| 封面 ⓘ | CSS 圆点 + 竖线 | `info-circle` |
| 取景页 ⓘ | `.info__dot` + `.info__stem` | `info-circle` |
| 取景页相册入口 | `.album__back` + `.album__front` 双方框 | `image` |
| 相机不可用空态 | `.ready__scope / __c / __stem / __tip` 取景框 + 下箭头 | 相册缩略图 + `t-button`（从相册导入） |
| 结果页「导出模型」 | `.ic-cube` 立方体 | `view-module` |
| 结果页「预览图存相册」 | `.ic-file` 文件 | `image` |
| 结果页「原始文件」 | `.ic-file` 文件（第二份） | `file-copy` |
| 结果页右侧下载 | `.dl__stem / .dl__tip / .dl__tray` | `download` |
| 结果页「复制链接」 | 纯文字 | 不再用图标（B 定稿改整宽品牌绿主按钮） |

### 组件替换对照

| 文件 / 位置 | 原实现 | 换成 | 为什么 |
|---|---|---|---|
| `pages/index` 开始 | `.cta` 自绘胶囊 | `t-button theme=default size=large block` + `t-class=btn-glass` | B 封面是玻璃按钮，不再用实心主按钮 |
| `pages/index` 说明 | `wx.showModal` | `t-popup placement=bottom close-btn` + `.b-glass` | 半屏说明可承载多行文案，样式统一 |
| `pages/capture` 引导 3 点 | `.dot / .dot.is-current` | 自绘 3 点，套 `.welcome__dots` 28 高玻璃胶囊 | B 定稿要求三点装进胶囊；`t-steps` 无法套胶囊，已从依赖闭包移除 |
| `pages/capture` 层切换 | `.bar` 三条无字横杠 | `t-tag`（低 / 视线 / 高） | 原横杠没有语义，标签把「当前层」写清楚 |
| `pages/capture` 空态按钮 | `.ready__btn` | `t-button` + `t-class=btn-glass` | 同上 |
| `pages/capture` ⓘ 半屏 | `.sheet` 自制遮罩 + 卡片 | `t-popup` + `.hint.b-glass` | 遮罩、圆角、关闭按钮、动效都由库处理 |
| `pages/capture` 欢迎 CTA | `.welcome__btn` | `t-button theme=primary block` + `t-class=btn-green` | 第 3 屏唯一品牌绿主按钮 |
| `pages/result` 处理中 | `.bar / .bar__fill` | `t-progress`（白 `.72`）+ `t-loading` | 进度条与加载指示交给库；绿只留三处 |
| `pages/result` 产物列表 | `.row` + `.ic-*` + `.dl*` | `t-cell-group` + `t-cell`（`left-icon` / `right-icon`） | 单元格自带分隔线、点击态、图标位 |
| `pages/result` 失败按钮 | `.primary` | `t-button theme=primary block` + `t-class=btn-green` | 同上 |
| `pages/result` 复制链接 | `.link` 纯文字 | `t-button theme=primary block` + `t-class=btn-green` | B 定稿 10 屏是整宽品牌绿主按钮 |
| `pages/result` Toast | `wx.showToast` | 保留 | 系统轻提示不遮挡内容；库 Toast 带遮罩，复制/保存场景不需要 |
| `pages/capture` 判定胶囊 | `.verdict` | 保留自绘 + `.b-glass .b-pill` | 叠在取景画面上的瞬时反馈，库无对应 |
| 快门 / 覆盖环 / 准星 / 箭头 / camera | 自绘 | **保留** | 相机叠层，库无对应 |

### 照片与裁切

| 位置 | 文件 | 源 / 用法 |
|---|---|---|
| 封面整屏 | `assets/brand/cover.jpg` | `bg-01-cover` 780×1688，`aspectFill` |
| 引导 A / B / C 整屏 | `assets/guide/bg-a.jpg` · `bg-b.jpg` · `bg-c.jpg` | `bg-02/03/04-guide-*` 780×1688，`aspectFill` |
| 引导 C 卡内截图 | `assets/guide/editor-crop.jpg` | 真实编辑器裁切 |
| 相机不可用缩略 / 09 卡内缩略 | `assets/guide/album-thumb.jpg` | 场地全景缩略 |
| 结果页 4 张预览（mock） | 复用封面 + 三张引导图 | 仅 mock 占位，真实产物由 `recon.poll` 返回 |

## 阈值单一真源（重要）

- 真源：`frontend/lib/capture-guide/scoring.ts`、`frontend/lib/capture-guide/image-analysis.ts`、`frontend/lib/capture-guide/shot-rules.ts`。
- 生成物：`lib/thresholds.js`（**请勿手改**），由 `scripts/gen-thresholds.mjs` 抽取写入。
- 改了网页端阈值后：
  ```bash
  node miniprogram/scripts/gen-thresholds.mjs          # 重新生成
  node miniprogram/scripts/gen-thresholds.mjs --check  # 校验是否漂移（可进 CI）
  ```
- 为什么选「生成 + 校验」而不是手抄两份：手抄必然漂移，而改 `frontend/` 加共享包会破坏现有构建边界（本期约定不动 `frontend/`）。抽取失败会直接抛错，把漂移变成显式失败。
- 已做一致性验证：用 30 组随机样本对比上游 TS 与本目录 `utils/scoring.js`，总分 / 结论 / 各项得分 **0 处不一致**。

### 模糊度阈值（256×256 实测）

统一在 **256×256 灰度**上算 4 邻域拉普拉斯方差（网页端与小程序同尺度）。样本：`scene-3d/*.jpg` 前 20 张清晰 + 后 8 张分别加 σ=12/16/24/40 高斯模糊。

| 组 | 中位数 | 区间 |
|---|---|---|
| 清晰（n=20） | 756.0 | 87.7 – 1798.9（p10 = 230.3） |
| 模糊 σ=12 | 35.4 | 1.9 – 178.6 |
| 模糊 σ=16 | 19.1 | 1.6 – 74.1 |
| 模糊 σ=24 | 6.6 | 1.4 – 17.9 |
| 模糊 σ=40 | 2.6 | 1.4 – 4.0 |

- 选定 **60**：清晰误杀 **0/20（0%）**；全量 130 张清晰图误杀 5 张（3.8%，都是低纹理空墙）；σ≥24 真糊片召回 100%，σ=16 87.5%，σ=12 75%。
- 旧值 **15**：σ=16 只召回 37.5%、σ=12 只有 25%，等于不拦；新阈值把「能看出糊」的片子挡住了，且不误杀正常照片。
- 备注：清晰组最小值 87.7 与阈值 60 留 46% 余量；再往上抬到 80 会把空墙类正常照片误杀。

## 重建服务契约（mock，真接口由 ZCode 提供）

`services/recon.js` 是**唯一网络层**，页面不直接调用 `wx.request` / `wx.uploadFile`。当前 mock 行为：

- `submit(job)`：创建 jobId 并写 storage，返回 `Promise<jobId>`；
- `poll(jobId)`：按 `startedAt` 推算进度，总时长 25–40 s；前 5 s 慢（0→12%）、中段快（12→90%）、90% 停 4.5 s 后再到 100%。切后台或杀进程后按时钟续算，不会从头开始；
- `cancel(jobId)`；调试用 `forceFail(jobId, code)`（结果页长按处理中卡片触发）与 `resume()`（封面「继续上次重建」）。

返回字段：

```
queued / processing: { status, progress, etaMinutes }
done:                { status, progress, modelUrl, rawUrl, size{w,d,h,unit},
                       upAxis, normalized, previewUrls[4] }
failed:              { status, progress, code: LOW_COVERAGE|LOW_LIGHT|TIMEOUT, message }
```

真实替换点（只改这三个函数，页面与字段不用动）：

| 函数 | 建议实现 | 必须返回 |
|---|---|---|
| `submit(job)` | 先 `wx.uploadFile` 逐帧，再 `POST {API_BASE}/reconstructions` | `jobId` |
| `poll(jobId)` | `GET {API_BASE}/reconstructions/:id` | `status/progress`；done 时补六个产物字段 |
| `cancel(jobId)` | `POST {API_BASE}/reconstructions/:id/cancel` | 任意 |

上游已有的重建入口需要登录态 + project（`frontend/lib/backend-session.ts:1246`）。独立工具没有这些，真实服务需要一条**匿名、限流、带一次性任务 token** 的最小入口。

## 身份与额度契约（预接线，`services/account.js`）

变现预接线见 `docs/46`：静默登录（`wx.login` 换 openid，无登录 UI）+ 额度三栏 + 预扣/返还 + 广告发券 + 虚拟支付包装。`config.API_BASE` 为空时全部 no-op，行为与 mock 版完全一致。免费额度沿用 docs/45 的 `PAY_DAILY_JOB_LIMIT = 3 次/天`，付费 SKU 复用 `scan_1/3/10`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `{API_BASE}/session` | `{ code }` → `{ openid, token }`；付费次数锚 openid，免费额度锚设备键 |
| GET | `{API_BASE}/scan/quota` | `{ free, adBonus, purchased, dailyLimit }` |
| POST | `{API_BASE}/scan/consume` | 预扣，幂等键 `scan:{owner}:{jobId}:1`；402 `INSUFFICIENT_CREDITS` |
| POST | `{API_BASE}/scan/release` | `{ jobId, reason }` 失败/超时返还 |
| POST | `{API_BASE}/scan/ad-bonus` | 激励视频发券（UV 破千开流量主后启用） |
| POST | `{API_BASE}/pay/virtual/order` | 虚拟支付签单（认证+备案过审后可用），前端只调 `wx.requestVirtualPayment` |

## 隐私配置

- `app.json → permission.scope.camera.desc`：「拍摄现场照片，用于重建 3D」（16 字，≤20）。
- `requiredPrivateInfos` 只列 `getLocation`：本项目只调 `wx.getLocation`；`chooseMedia`、`camera` 不属于该清单（清单针对位置/地址类隐私接口）。
- 相机或相册被拒：`pages/capture` 用 `wx.getSetting` 读取 `scope.camera`，弹「一句话 + 去设置」按钮（`wx.openSetting`），不静默失败；用户主动取消选择不弹。

### 可直接粘贴到小程序后台的隐私保护指引文案

> 摄像头：用于拍摄场地照片并生成 3D 模型。
>
> 相册：用于从相册选择已拍好的场地照片，参与 3D 重建；以及将重建预览图保存到相册。
>
> 位置信息：用于核验机位定位覆盖与原地旋转判定，不上传位置以外的信息。
>
> 剪贴板：用于复制模型与原始文件的下载链接。

## 记录 / 分享 / 导出（2026-11-05 预接线）

- **记录**：`services/history.js` 本地历史（终态写入，最新在前，留 20 条，离线可用）。云端记录以 openid 维度走 `GET {API_BASE}/reconstructions?mine=1`（后端未建，契约位已留）。
- **分享**：capture/result 均已声明 `onShareAppMessage`；capture 另有 `onShareTimeline`。结果页分享卡片带 jobId 直达——**模型可读性由后端 URL 鉴权决定**（若产物 URL 要签名，分享链接需带短时 token，接入真实后端时定）。
- **导出**：结果页「导出模型到聊天」（`wx.downloadFile` + `wx.shareFileMessage`，发文件传输助手即带走）与「预览图存相册」（远程图 `downloadFile` → `saveImageToPhotosAlbum`，拒绝授权走 openSetting 引导）。mock 阶段预览图为包内资源，存相册会提示「后端接入后即可保存」。
- **账号**：无登录页。静默 openid（`services/account.js`）已够付费与云端记录锚定；头像昵称等资料能力（button open-type="chooseAvatar"）待有社交/协作需求再议。

## 包体清单

| 目录 | 文件数 | 字节 |
|---|---|---|
| assets | 7 | 970,283 |
| pages | 12 | 55,698 |
| utils | 3 | 23,977 |
| services | 3 | 15,281 |
| lib | 1 | 1,898 |
| miniprogram_npm（TDesign 裁剪闭包） | 221 | 407,155 |
| 根文件（app.* / config / sitemap / package） | 6 | 12,593 |
| **主包合计** | **253** | **1,486,885（1.42 MB）** |

不含 `scripts/`、`README.md`、`project.config.json`、`node_modules/`、`package-lock.json`（均已 ignore）。主包上限 2 MB，**未超，无需分包**。

| 口径 | 字节 | 主包占比 |
|---|---|---|
| 迁移前（无 TDesign） | 792,456（0.76 MB） | 38% |
| 引入 TDesign **全量 dist** | 2,305,003（2.20 MB） | **超 2 MB** |
| 引入 TDesign **按需裁剪** | 1,214,523（1.16 MB） | 58% |
| **B 定稿（照片 + 材质，当前）** | **1,486,885（1.42 MB）** | **71%** |

B 版增量拆解：总 +272,362 B。

| 项 | 字节 |
|---|---|
| 新增 / 替换照片（封面重裁 + 3 张引导 + 编辑器截图 + 相册缩略） | +767,974 |
| 删除旧引导图 `step-top/layer/result.jpg` | −490,025 |
| 删除未使用的 `steps` + `step-item` 组件目录 | −14,912 |
| 代码（`glass.js`、WXSS/WXML/JS 等） | +9,325 |
| 毛玻璃 CSS / SVG 噪点 data URI | 0（纯样式，无新二进制） |

- 已删无引用素材：`assets/guide/bad-dark.jpg` + `bad-spin.jpg`（−110,165 B）；B 版再删 `step-*.jpg`（−490,025 B）。
- 若后续还要加素材：3 张引导图（713,076 B）压到 1280×960 / q62（约 60–80 KB/张，−350 KB）；仍不够再把引导图放 CDN 或独立分包。
- 触发分包阈值时的建议：`assets/guide` 三张整屏图与 `pages/capture` 先不动（首屏路径），把结果页 `pages/result` + 历史/导出做成 `subPackages` 分包（约 −50 KB），素材再上 CDN。

## 已知限制

- `CameraContext.onCameraFrame` 的分辨率与帧率取决于 `frame-size`（本页设为 `medium`），官方未给固定数值，**需真机实测**；本骨架未做实时取帧 UI，只在拍照后快检。
- 模拟器不能取流；`<camera>` 在开发者工具里通常只显示占位。
- 离屏画布（`wx.createOffscreenCanvas`）依赖基础库版本；不支持时会明确报错，不会静默算错。
- `wx.getLocation` 需在小程序后台申请接口权限并配置隐私保护指引；未授权时按「无 GPS」评分，会压低总分。
- 结果页默认「复制链接到浏览器」，因为 `web-view` 需要另配**业务域名**（已备案 + 校验文件），骨架不预置。
- TDesign 图标字体来自 `tdesign.gtimg.com` CDN（`icon.wxss` 内 `@font-face`）：离线或 CDN 不可达时图标会不显示；要彻底离线可把字体文件放本地并改 `@font-face`。
- 本骨架未接入上传断点续传：弱网大图集需要后端支持分片或对象存储直传。

## 未验证项

- 未在微信开发者工具中打开过（本机未运行该工具），WXML/WXSS 未经工具编译校验；已做 `node --check` 语法检查与评分 parity 校验。
- TDesign 组件（`t-button / t-popup / t-tag / t-icon / t-progress / t-loading / t-cell / t-cell-group`）未真机/模拟器渲染验证；`miniprogram_npm` 为手工裁剪闭包，未经开发者工具「构建 npm」校验。
- B 材质层（`backdrop-filter` 启用/降级、`.dim` 压暗、覆盖环 24 段、快门双环按下态）未真机验证；iOS / Android 的实际模糊效果与 `glassClass` 判定需各取一台真机看。
- 真机 `<camera>`、`onCameraFrame` 分辨率、iOS 离屏画布行为均未实测。
