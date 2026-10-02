# Foundation 视觉参考研究

研究日期：2026-10-02（America/Chicago）。范围为公开页面的 HTML、其实际引用的 CSS/JS；下文先记录原站源码事实与迁移建议；本项目的实现及验收记录见文末。

## 已核实：跨页一致性

[首页](https://www.thefoundation.house/)、[Programs](https://www.thefoundation.house/programs)、[Contact](https://www.thefoundation.house/contact) 引用同一个 CSS 文件及 Webflow 交互包，均包含 `nav-container`、`button-div`、`body-copy`、`hero-title`、`glass-light` 和 `load_grid`。统一感有明确的共享样式与组件结构支撑。

三页也共享 Lenis 1.2 秒指数缓出滚动配置、GSAP 3.11.3 / ScrollTrigger 引用和 0.8 秒页面遮罩淡入淡出。首页额外引用 GSAP 3.10.4；这是现有实现事实，不建议照搬重复依赖。页面引用 Webflow、jQuery、Vimeo 和 Three.js 相关代码，不能仅凭效果归因为某一个动画库。[首页源码](https://www.thefoundation.house/) · [Programs 源码](https://www.thefoundation.house/programs) · [Contact 源码](https://www.thefoundation.house/contact)

## 已核实：颜色、字体与玻璃

| 用途 / CSS token | 值 |
|---|---|
| `--charcoal` / `--body-copy-grey` | `#2b2b2b` / `#7a7a7a` |
| `--violet` | `#a459ff` |
| `--concrete` | `#f1f3f6` |
| `--blue` / `--green` | `#7ea2ad` / `#cfedd9` |
| `--white` / `--black` | 白 / 黑 |

字体为 Helvetica Now Display，加载 400、500、700 字重；主标题 `h1` 使用 11vw 字号、8.2vw 行高、−0.6vw 字距和大写。卡片圆角常见 0.3em；按钮圆角 500px。[共享 CSS](https://cdn.prod.website-files.com/66f603e5069e2b5cc1f8ec86/css/battalion-somefolk.webflow.0dfdeb3af.css)

| 选择器 | 背景模糊 | 叠色 / 其他层 |
|---|---:|---|
| `.nav-container` | 10px | `#0a0a0a3d`；300° 白色渐变，`#ffffff38` → `#fff0`，55% 处透明；0.2em 圆角 |
| `.button-div.is-faded` | 8px | `#ffffff1a` |
| `.quote-box.is-blur` | 18px | `#0000000d` |
| `.careers-cta`（Contact 页面存在） | 30px | `#00000026`；0.3em 圆角 |
| `.nav-container.is-footer` | 无 | `#00000014` |

以上均来自 `backdrop-filter` 及其 WebKit 前缀。导航内部另有 `.glass-light`：8em 方形白色径向渐变、35px 元素模糊、CSS 初始透明度 0.4。玻璃感因此来自背景模糊、透明叠色与独立光斑，而非单纯降低不透明度。[共享 CSS](https://cdn.prod.website-files.com/66f603e5069e2b5cc1f8ec86/css/battalion-somefolk.webflow.0dfdeb3af.css)

## 已核实：动效参数

| 交互 | 源码定义 |
|---|---|
| 导航玻璃高光 | `Glass IN`：延迟 100ms、800ms `outExpo` 到透明度 0.26；`Glass OUT`：300ms 退出 |
| 指针跟随高光 | `Glass Move`：横向 −15vw → 15vw；连续事件 smoothing=88，仅 desktop/main |
| 按钮箭头 | 两个箭头交替位移 6px；进入 400ms `outExpo`，第二个延迟 200ms；退出 500ms `inOutExpo` |
| 导航文字 | 500ms `ease`，悬停透明度 0.58，退出恢复 1 |
| Hero 视差 | `Hero Scroll`：图片 Y 从 −8% 到 25%，遮罩透明度 0.12 到 1，受滚动进度控制 |

这些是导出的交互定义，连续动画中的 duration 字段不等于用户看到的固定播放时长。[Webflow 交互包](https://cdn.prod.website-files.com/66f603e5069e2b5cc1f8ec86/js/webflow.schunk.e858353eb173962f.js)

页面还加载 Three.js 模型脚本：桌面加载品牌 GLB，正面 `#a459ff`、侧面 `#8548ce`；相机随指针缓动，模型围绕 Y 轴随 `#trigger360` 滚动转一圈。此处是品牌模型效果，不证明页面所有房屋图片都是实时 3D。[页面引用的模型脚本](https://cdn.jsdelivr.net/gh/kujira22/kujira_webgl@main/Battalion/13/app.js)

## 对本项目的迁移建议（设计判断，非原站事实）

- 先统一页面背景、正文灰阶、强调色、按钮和导航，再安排各子页内容；避免每页单独发明视觉语言。
- 用浅混凝土灰承托内容，紫色标识关键行动，蓝灰与薄荷绿用于少量辅助区域。原站色值可作为参考，仍需按本项目文字尺寸验证对比度。
- 玻璃优先用于悬浮导航、工具栏和覆盖在场景上的面板；长正文和密集表格使用清晰的实色底。保留可见的场景背景，模糊才有空间层次。
- 将交互反馈、面板出现和品牌展示分为不同节奏；借鉴缓出和轻位移，不必复制营销站 0.8 秒整页遮罩或首页数秒滚动锁定。
- 中文继续使用适配中文的现有字体；不要直接下载并复用参考站字体。用字重、行距和字号层级建立相似秩序。
- 实现时加入 reduced-motion、无 `backdrop-filter` 时的实色退化方案，并在移动设备验证玻璃叠层性能。

## 验证边界

源码采样覆盖首页及两个子页；未在本研究中测量浏览器实际帧率、计算样式、对比度或所有断点。`/battalion-tpo` 在此次直接请求中返回 404。Jina Reader 返回 401 后改为直接读取公开网站与其明确引用的资源。临时取证文件保存在 `/tmp/foundation-study/`；未保存或复制其商业图片、视频、字体或模型到项目。


## 本项目实现与验收

实现日期：2026-10-02。覆盖当前 `frontend/` 工作台、物料库 / 场地 / 清单面板、物料属性、云项目弹层、加载及错误恢复界面，同时统一根目录活动场景页和 `models.html` 素材预览页。

- 色彩：炭灰 `#2b2b2b`、混凝土灰 `#f1f3f6`、冷灰蓝 `#e8eef1`；紫色 `#a459ff` 限于强调，浅底文字采用更深的 `#7435b8`，次级文字采用 `#59636d`。
- 材质：顶部半透明炭灰导航；10px 模糊工具条与 18px 模糊面板；白色渐变高光、细边框及内侧高光。原有模型、材质与灯光保留，编辑器背景色从共享 token 读取。
- 动效：160ms 交互反馈，180ms 内容进入，220–280ms 面板进入；只给进入动效添加位移与透明度。保留原生滚动及连续编辑操作；减少动态效果与不支持背景模糊时均有回退。
- 修复手机视图下的层叠：属性面板高于物料抽屉；抽屉关闭后隐藏且不接收焦点 / 指针。
- 原有状态、数据协议及保存逻辑保持不变；没有新增依赖、复制原站商业素材或进行部署。

验证：

| 检查 | 结果 |
|---|---|
| 前端 TypeScript / 生产构建（含 lint） | 通过 |
| 恢复、云面板、持久化、schema、后端适配器既有测试 | 5 个文件、171 个测试通过 |
| CSS 解析 / model-preview.js 语法 / git diff --check | 通过 |
| 编辑器浏览器验证 | 1440px 桌面；390px 与 320px 手机宽度；三种面板、属性、云项目弹层、加载界面、2D / 3D 切换、添加物料、修改宽度、撤销通过 |
| 手机层叠复核 | 同时打开抽屉和属性时，宽度输入框中心点命中该输入框 |
| 活动场景页 | 1280px 桌面与 390px 手机宽度；5/5 模型载入；视角切换与时间轴 48h / 3h 状态切换通过 |
| 模型预览页 | 1280px 桌面与 390px 手机宽度；桌子 / 椅子模型切换通过 |

本轮是本地 UI 验收。云项目浏览器检查覆盖“后端尚未连接”界面，不等同于真实云端登录、保存或发布验收；减少动态效果和背景模糊回退经过源码复核，未进行系统设置切换或多浏览器真机性能测试。

截图：[工作台](evidence/foundation-ui/editor-desktop.jpg)、[云项目](evidence/foundation-ui/cloud-desktop.jpg)、[手机工作台](evidence/foundation-ui/editor-mobile.jpg)、[活动场景](evidence/foundation-ui/venue-desktop.jpg)、[素材页](evidence/foundation-ui/model-desktop.jpg)。
