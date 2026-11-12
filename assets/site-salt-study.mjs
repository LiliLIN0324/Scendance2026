const research = '/research/salt/';
const taihe = 'https://www.taihemusic.cn/news/2221';
const beethoven = 'https://www.beethovencn.com/page110.html?article_id=121';
const museum = 'https://www.xinlvxing.com.cn/news/20241128/5844.shtml';
const fieldwork = 'https://gyy.zjcm.edu.cn/zyytk/202505/45562.html';
const traffic = 'https://hnsgaj.cn/wxpt/html/gctxz/gctxz.aspx';

function figure(file, title, note, source, sourceName, kind = '') {
  const href = research + encodeURI(file);
  return `<figure class="salt-figure ${kind}">
    <a href="${href}" aria-label="查看原图：${title}"><img src="${href}" alt="${title}" loading="lazy" decoding="async"></a>
    <figcaption><strong>${title}</strong><span>${note}</span><a href="${source}">${sourceName} ↗</a></figcaption>
  </figure>`;
}

export function renderSaltStudy(container) {
  container.classList.add('salt-study');
  container.innerHTML = `
    <header class="salt-study-header">
      <h2>古城里的音乐活动怎么布置</h2>
      <p>从节目单上的场地，到院落里的唱片铺，再到音乐之家的展柜。每组资料附现场照片、原文和可用于出图的观察。</p>
      <p class="salt-source"><a href="/introduction?view=inspiration&amp;activity=salt#site-map-panel">在幕景试排签到与接驳 ↓</a><a href="${research}salt-design-brief.html">查看试排工作单 ↗</a></p>
    </header>
    <section class="salt-chapter" aria-labelledby="salt-campus">
      <h3 id="salt-campus">先把活动节点落在园区图上</h3>
      <div class="salt-map-layout">
        ${figure('05_赛事与接待/S07-13.png','盐官潮乐之城度假区导览图','点图查看原件。用于辨认园区地物，馆内入口与楼层另查当届资料。',beethoven,'艺术节章程','salt-map')}
        <div>
          <p>2025 年中德贝多芬青少年弦乐艺术节全国总决赛的章程，列出了参赛者从报到到音乐会经过的几个地点。可以用它核对园区总图是否找得到每一站。</p>
          <dl class="salt-nodes">
            <div><dt>游客服务中心</dt><dd>参赛签到。出图时标出到达入口与集合点，柜台位置向接待方核对。</dd></div>
            <div><dt>盐官音乐之家</dt><dd>排练与决赛。公开材料指向主唱音乐度假酒店 B1，比赛实际用房、入口和音响配置待核。</dd></div>
            <div><dt>主唱酒店 · 涌潮阁宴会厅</dt><dd>配套音乐会。给观众和演出团队分别标明到场时间与现场接应点。</dd></div>
            <div><dt>酒店花园露台</dt><dd>章程列为配套活动场地。实际布置范围和天气备选需要与酒店确认。</dd></div>
          </dl>
          <p class="salt-source"><a href="${research}satellite-comparison.html">对照真实卫星影像 ↗</a><a href="${beethoven}">总决赛章程 ↗</a><a href="https://www.hdm.at/en/museum/hdm-china/">维也纳音乐之家馆方资料 ↗</a></p>
        </div>
      </div>
      <div class="salt-field-note">
        <h4>另一种用法 · 2026 浪潮音乐大赏</h4>
        <p>潮新闻的现场报道记录了三种场地同时使用。典礼在潮城艺术中心，音乐节在后街草坪，主题快闪在音乐之家博物馆。总图可标出三个节目点，各点另备对应的布置图与到场指引。<a href="https://tidenews.com.cn/news.html?id=3552945">现场报道 ↗</a></p>
      </div>
    </section>
    <section class="salt-chapter" aria-labelledby="salt-popup">
      <h3 id="salt-popup">大潮季 · 一间院落里的唱片铺</h3>
      <p class="salt-chapter-intro">太合音乐的预告列出视觉主墙、唱片和互动内容，收官报道提供了落地照片。可以从照片先拆物料，再画它们与步行空间的关系。</p>
      <div class="salt-gallery">
        ${figure('01_大潮季展陈与视觉/S02-02.jpg','院落与展陈全景','先看院门、主墙和陈列区，再给行人经过和停留的位置各留空间。',taihe,'太合音乐收官回顾')}
        ${figure('01_大潮季展陈与视觉/S02-03.jpg','互动站与唱片展示','把互动停留和浏览唱片分别画出来，检查人停下后会不会挡住身后的通行。',taihe,'太合音乐收官回顾')}
        ${figure('01_大潮季展陈与视觉/S02-04.jpg','唱片铺台面与背景','可拆成背景面、台面、陈列物与展签，出图时给各件标编号。',taihe,'太合音乐收官回顾')}
        ${figure('01_大潮季展陈与视觉/S02-06.jpg','游客使用互动设施','在候选图上标一个互动点及等候区。照片可看使用关系，实际净宽须复尺。',taihe,'太合音乐收官回顾')}
      </div>
      <dl class="salt-dates">
        <div><dt>9 月 25 日至 10 月 7 日</dt><dd>2026 年大潮季音乐活动预告所列日期。<a href="https://www.taihemusic.cn/news/2200">活动预告 ↗</a></dd></div>
        <div><dt>9 月 25 日至 9 月 30 日</dt><dd>当期观潮车辆预约适用日期。安排 10 月 1 日到场时，需另查当日交通安排。<a href="${traffic}">当期观潮车辆须知 ↗</a></dd></div>
      </dl>
    </section>
    <section class="salt-chapter" aria-labelledby="salt-museum">
      <h3 id="salt-museum">音乐之家 · 室内展陈参考</h3>
      <p class="salt-chapter-intro">音乐之家同时有器乐展示、声音互动和演奏空间。把不同停留方式分开画，才能核对展柜、排队和观演之间会不会互相占用。</p>
      <div class="salt-gallery">
        ${figure('03_实地调研/S04-07.jpg','展柜与参观停留','观察观看方向和展签阅读点，出图时标出参观者停在哪里。',fieldwork,'浙江音乐学院实地调研')}
        ${figure('04_音乐之家/S06-09.jpg','声音互动展项','展项图标出操作面、停留点和设备位置，另列音量、电源与排队待核项。',museum,'音乐之家开幕报道')}
        ${figure('04_音乐之家/S06-10.jpg','展柜与文字解说','用同一个展件编号关联展柜、展签、照明和安装清单。',museum,'音乐之家开幕报道')}
        ${figure('04_音乐之家/S06-15.jpg','博物馆内演奏空间','分别标出演奏、候场和观众位置，房间净尺寸和设备条件回查场馆。',museum,'音乐之家开幕报道')}
      </div>
    </section>
    <section class="salt-chapter" aria-labelledby="salt-delivery">
      <h3 id="salt-delivery">设计可以先出这三张图</h3>
      <div class="salt-deliverables">
        <article><h4>园区活动总图</h4><p>把签到、排练、演出和备用地点标在一张图上，给每个点写清楼层、开放时间和接应人。模拟一次换场，再查参赛者指引、调音时间和接待清单。</p></article>
        <article><h4>院落快闪布置图</h4><p>先标主墙、唱片台、互动站、等候区和服务点。出图前补核院落实测、临时用电、可用通道和布撤展窗口。</p></article>
        <article><h4>室内展陈与安装图</h4><p>以展件编号串起展柜、说明墙、互动设备与安装顺序。可用馆图、挂载点、设备规格和现场签收需要场地方资料。</p></article>
      </div>
    </section>
    <section class="salt-resources" aria-labelledby="salt-resources-title">
      <div><h3 id="salt-resources-title">原图与设计资料</h3><p>资料包含案例引用的现场照片、导览、节目配图和试排工作单。原始出处见图注。</p></div>
      <div class="salt-resource-links"><a href="${research}index.html">浏览分类素材 ↗</a><a href="/research/salt.zip" download>下载设计资料包 ↓</a></div>
    </section>`;
}
