# 场景类别建筑图

## 首屏背景

hero-court.png —— 官网页（`introduction.html`）首屏 `.hero` 的背景图，由 `.hero` 的
三层 `background` 中间那层引用（下层是深绿渐变兜底，上层是左侧压暗遮罩）。

换图：直接替换本文件即可，不用改 CSS。注意宽高比要接近 1.6（1587×991 或 1920×1200），
因为用的是 `center/cover`，比例差太多会被裁掉关键部分。

## 场景类别

把 7 张建筑图按类别 key 命名放进本目录，官网页会自动按 tab 切换：

corp.jpg  企业机构
brand.jpg 品牌商业
sport.jpg 赛事体育
culture.jpg 文化展览
show.jpg  演艺娱乐
city.jpg  城市公共
edu.jpg   教育科研

图片会被复制到 /showcase/assets/scenes/ 供官网使用；建议横向 16:9 或 3:2、宽边 1600px 以上。换成 .png 时同步改 introduction.html 里 DATA 下面的 image.src 后缀。
