# 场景类别建筑图

## 首屏背景轮播

首屏 `.hero` 的背景是**一层一张**的 `.hero-shot`，按 `introduction.html` 里 `HERO_SHOTS`
表的顺序交叉淡入淡出，右下角跟着显示场景名。

命名规则就是「两位序号 + 场景名」，序号对齐下方「三维场景」轨道的顺序；右下角显示的名字
直接取文件名去掉序号的部分，所以改名之后名字会自动跟着变，不用再动代码。

轮播的图来自 `introduction.html` 里 `SCENES[].image`（和「三维场景」轨道、场景库面板共用
同一份数据），加图：丢进本目录，再给对应的场景补一个 `image: 'NN场景名.png'` 字段。

第一张写在 HTML 的 `style` 里（无 JS 也能看到、首屏立刻出图），其余几张由脚本在快轮到它时
才设 `background-image`，避免首屏一次拉好几兆。用的是 `center/cover`，比例差太多会被裁掉
关键部分，建议宽高比接近 16:9（约 1600×900 以上）。

## 场景类别（暂未使用）

七类行业做法那一段已经从官网页移除，下面这套按类别 key 命名的图暂时没有页面在用
（数据与渲染保留在 `introduction.html` 末尾，容器不在时不执行）：

corp.jpg  企业机构
brand.jpg 品牌商业
sport.jpg 赛事体育
culture.jpg 文化展览
show.jpg  演艺娱乐
city.jpg  城市公共
edu.jpg   教育科研

图片会被复制到 /showcase/assets/scenes/ 供官网使用；建议横向 16:9 或 3:2、宽边 1600px 以上。
