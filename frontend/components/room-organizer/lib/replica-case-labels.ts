/**
 * OnePlan 复刻案例的界面中文标签。
 *
 * 2026-11-18 用户：「我不是引入了很多海外的案例吗，在界面上汉化」。
 * 规格文件（replica-specs-*.ts）保留 OnePlan 原文案（title/category/region 逐字照抄），
 * 这里是**只给界面看的中文层**：案例名、分类、区域。原文仍在卡片副标题/提示里保留，
 * 方便对着 OnePlan 原案页溯源；中文层缺一条就是界面漏一个字，测试会拦。
 *
 * 译名口径：专有名词（品牌、地名、赛事名）保留原文，事件类型译成中文；
 * 原文已有中文的案例（High Chaparral Park）不重复翻译。
 */

/** 案例名中文层，key = 规格里的 slug。 */
export const REPLICA_TITLE_ZH: Readonly<Record<string, string>> = {
  'scotiabank-hockey-day-canada': 'Scotiabank 加拿大冰球日',
  'north-australia-festival-of-the-arts': '北澳艺术节',
  'the-newport-show': '纽波特农展会',
  'northern-nevada-pride': '内华达北部骄傲节',
  'basildon-pride': '巴西尔登骄傲节',
  'fire-in-the-mountain': '山火音乐节',
  'new-forest-folk-festival': '新森林民谣音乐节',
  mugstock: 'MugStock 音乐节',
  'parkenfestivalen-2023': 'Parkenfestivalen 公园音乐节',
  'riverbend-music-festival': '河湾音乐节',
  'outfield-music-food-arts-festival': 'Outfield 音乐美食艺术节',
  'desert-winefest': '沙漠葡萄酒节',
  '45th-spearfish-festival-in-the-park': '第 45 届 Spearfish 公园节',
  'riverside-festival': '河畔节',
  'national-cherry-festival': '全国樱桃节',
  'ashfield-day': 'Ashfield 社区日',
  'spiltrock-summerjam': 'Spiltrock 夏日音乐节',
  'start-on-the-street': 'stART 街头艺术节',
  'halloween-firework-spooktacular': '万圣节烟花惊魂夜',
  'banbury-town-council-coronation-events': '班伯里镇议会 · 加冕庆典',
  'rotherham-christmas-light-switch-on': '罗瑟勒姆圣诞点灯',
  'fareham-west-scouts-camp24': 'Fareham West 童军 Camp24 露营',
  'victoria-park-brisbane-easter-egg-hunt': '布里斯班维多利亚公园 · 复活节寻蛋',
  'trunk-or-treat': '万圣节后备箱讨糖',
  winterskol: 'Wintersköl 冬季节',
  'high-chaparral-park': 'High Chaparral Park 日全食观测营地',
  'halloween-carnival': '万圣节嘉年华',
  'olney-maryland-national-night-out': 'Olney 警民联欢夜',
  'carols-in-the-park': '公园圣诞颂歌会',
  'mandurah-christmas-pageant': '曼杜拉圣诞巡游',
  'halloween-town': '万圣节小镇',
  'springvale-snow-fest': 'Springvale 冰雪节',
  'christmas-in-july': '七月圣诞',
  'gc-live-starry-nights-at-dean-castle': 'GC Live 迪恩城堡星空夜',
  'rocket-city-fair': '火箭城嘉年华',
  'the-great-fair-of-shalford': 'Shalford 大集市',
  'masters-of-motoring': '汽车大师展',
  'the-great-north-west-switas-truck-show': '西北 Switas 卡车展',
  'trafalgar-square-event-planning-for-crowded-space-course':
    '特拉法加广场 · 拥挤空间活动规划课程',
  'eurovision-song-contest-host-city-bid': '欧洲歌唱大赛 · 主办城市申办',
  'buffalo-marathon-weekend': '布法罗马拉松周末',
  'festival-foods-11-running-events-on-the-same-day': 'Festival Foods 同日 11 场路跑',
  '2023-usa-triathlon-nationals-pto-us-open': '2023 美国铁三全国赛 & PTO 美国公开赛',
  'franklins-gardens-northampton-saints-stadium': "Franklin's Gardens · 北安普顿圣徒主场",
  'senior-pro-rodeo-finals': '资深职业牛仔竞技总决赛',
};

/** OnePlan 分类中文层（规格里 category 的原文是 key）。 */
export const REPLICA_CATEGORY_ZH: Readonly<Record<string, string>> = {
  Festivals: '节庆',
  'Local Governments': '政府 · 社区',
  'Market, Fairs & Shows': '市集 · 展会',
  Education: '教育',
  'Road Events': '路跑赛事',
  Venues: '固定场馆',
};

/** OnePlan 区域中文层（规格里 region 的原文是 key）。 */
export const REPLICA_REGION_ZH: Readonly<Record<string, string>> = {
  'North America': '北美',
  Europe: '欧洲',
  'Australia & NZ': '澳洲 · 新西兰',
};

export type ReplicaCaseLabels = {
  /** 界面主标题。 */
  title: string;
  /** 中文分类。 */
  category: string;
  /** 中文区域。 */
  region: string;
};

/**
 * 取一条案例的中文标签。原文缺失时**退回原文而不是空串**：
 * 宁可界面上出现一个英文名，也不要出现一张没有名字的卡。
 */
export function replicaCaseLabels(
  slug: string,
  raw: { title: string; category: string; region: string },
): ReplicaCaseLabels {
  return {
    title: REPLICA_TITLE_ZH[slug] ?? raw.title,
    category: REPLICA_CATEGORY_ZH[raw.category] ?? raw.category,
    region: REPLICA_REGION_ZH[raw.region] ?? raw.region,
  };
}
