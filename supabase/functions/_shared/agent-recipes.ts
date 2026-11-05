/**
 * 活动场地配方库：纯数据 + 纯函数。
 *
 * 职责只有两件事：
 *  1. `matchRecipes` —— 从用户 brief 里按中文别名检出最相关的场景配方；
 *  2. `renderRecipes` —— 把选中的配方压成可直接塞进系统提示词的中文短文本。
 *
 * 不拼提示词、不调模型、不读 IO、不用随机。
 * 数值全部来自 docs/plans/activity-space-norms-2026-11-05.md，1 格 = 1 米；
 * 每条规则的 note 开头标明来源级别（A 国标 / B 地方或公安口径 / C 经验值）。
 */

export type ActivityKind = 'family' | 'elder' | 'market' | 'stage' | 'camp' | 'exhibition' | 'generic';

/** 分区：key 供程序引用，share 是相对面积占比（百分数整数），adjacency 写前后左右关系。 */
export interface RecipeZone {
  key: string;
  label: string;
  share: number;
  adjacency: string;
}

/** 判据：cells 是格数阈值（整数格），note 注明来源与级别。 */
export interface RecipeRule {
  id: string;
  check: string;
  cells: number;
  note?: string;
}

export interface ActivityRecipe {
  kind: ActivityKind;
  label: string;
  aliases: string[];
  intent: string;
  zones: RecipeZone[];
  layout: string[];
  hardRules: RecipeRule[];
  softRules: RecipeRule[];
  antiPatterns: string[];
  completionChecks: string[];
  objects: string[];
}

/** 人群限定类配方（亲子 / 适老）在同等命中长度下优先：人群约束比场景名词更具体。 */
const KIND_WEIGHT: Record<ActivityKind, number> = {
  family: 1.2, elder: 1.2, market: 1, stage: 1, camp: 1, exhibition: 1, generic: 0.5,
};

const family: ActivityRecipe = {
  kind: 'family',
  label: '亲子活动区',
  aliases: ['亲子', '亲子活动', '儿童', '儿童活动区', '遛娃', '小朋友', '游乐区', '亲子乐园'],
  intent: '让看护者与孩子的距离小于孩子跑开的距离',
  zones: [
    { key: 'play', label: '儿童活动区', share: 55, adjacency: '居中，四周被缓冲环包住' },
    { key: 'care', label: '看护休憩带', share: 30, adjacency: '沿活动区一侧连续，视线不被遮挡' },
    { key: 'buffer', label: '缓冲过渡带', share: 15, adjacency: '夹在活动区与通道或摊位之间' },
  ],
  layout: [
    '先用 2 格跌落缓冲环定设备位，再排看护座椅',
    '设备主面朝看护带，看护座椅至设备 ≤8 格',
    '3–6 岁与 6–8 岁分两块，区界留 3 格',
    '出入口 ≥2 个、净宽 ≥2 格，避开车行流线',
  ],
  hardRules: [
    { id: 'KID-01', check: '设备垂直投影外扩 2 格内不得有任何他物', cells: 2, note: 'A级 GB/T 34272-2017 §5.10.2.3；跌高 >1.5 m 时按 2/3H+0.5 增加' },
    { id: 'KID-03', check: '游玩区上方 3 格净空内不得有枝叶、棚架或悬挂物', cells: 3, note: 'A级 GB/T 34272-2017 §4.11.3.1' },
    { id: 'KID-08', check: '儿童区边界距车行道 ≥5 格且设连续物理隔离', cells: 5, note: 'C级 经验值 + 场地安全通行做法' },
    { id: 'KID-10', check: '出入口 ≥2 个、净宽 ≥2 格，不得正对车行流线', cells: 2, note: 'A级 GB 50763-2012 §3.5.1' },
    { id: 'GEN-06', check: '通道与悬挂物底边净高 ≥3 格', cells: 3, note: 'A级 GB/T 36731-2018 §6.2.6.1' },
  ],
  softRules: [
    { id: 'KID-05', check: '3–6 岁与 6–8 岁分区，区界留 ≥3 格缓冲', cells: 3, note: 'C级 经验值' },
    { id: 'KID-06', check: '看护座椅至最近设备 ≤8 格，视廊内无 ≥2 格高遮挡', cells: 8, note: 'C级 经验值，无强制标准' },
    { id: 'KID-11', check: '活动区投影遮荫 ≥40%（每 100 格 ≥40 格）', cells: 40, note: 'C级 经验值' },
  ],
  antiPatterns: [
    '不要把设备贴着通道边摆，否则 2 格跌落空间会被通道吃掉，KID-01 直接否决',
    '不要用低分枝乔木给活动区遮荫，否则树冠侵入 3 格自由空间',
    '不要让看护座椅背对活动区，否则看护形同虚设',
    '不要在唯一出入口正前方放设备，否则进出与跌落空间重叠',
  ],
  completionChecks: [
    '每个设备外扩 2 格内无他物',
    '看护座椅至最近设备 ≤8 格且视廊无 ≥2 格遮挡',
    '出入口 ≥2 个、净宽 ≥2 格',
    '活动区上方 3 格净空无悬挂物',
  ],
  objects: ['游乐设施', '看护座椅', '遮阳乔木', '柔性铺装', '边界护栏', '分类垃圾桶'],
};

const elder: ActivityRecipe = {
  kind: 'elder',
  label: '适老休憩区',
  aliases: ['老人', '适老', '适老化', '老年', '长者', '休憩区', '座椅', '康养'],
  intent: '让轮椅能到每一个停留点，并且坐下与起身都有支撑',
  zones: [
    { key: 'seat', label: '座椅休憩带', share: 45, adjacency: '沿散步道一侧，每 ≤15 格一处' },
    { key: 'loop', label: '环形散步道', share: 35, adjacency: '成环不回头，净宽 ≥2 格' },
    { key: 'node', label: '回转与停留节点', share: 20, adjacency: '设在通道节点与端头，不占座椅带' },
  ],
  layout: [
    '先用 2×2 格回转节点串起主环，再填座椅',
    '主园路净宽 ≥2 格，每 ≤15 格设 ≥2 格错车段',
    '座椅沿路每 ≤15 格一处，带靠背与扶手',
    '遮荫优先于景观，树冠底留 ≥3 格净高再种',
  ],
  hardRules: [
    { id: 'ELD-01', check: '任一可达节点留 2×2 格完整空区供轮椅回转', cells: 2, note: 'A级 GB 50763-2012 §3.11.2' },
    { id: 'ELD-02', check: '室外通行净宽 ≥2 格，主园路 ≥2 格', cells: 2, note: 'A级 GB 50763-2012 §3.5.1' },
    { id: 'ELD-04', check: '坡道纵坡 ≤1:12，起终点平台深 ≥2 格', cells: 2, note: 'A级 GB 50763-2012 §3.4.4' },
    { id: 'ELD-08', check: '每 10 个座椅配 ≥1 个 2×2 格轮椅停留位', cells: 2, note: 'A级 GB 51192-2016 §3.5.4-3' },
    { id: 'ELD-10', check: '休憩区至卫生间服务半径 ≤250 格', cells: 250, note: 'A级 GB 51192-2016 §3.5.3-2' },
  ],
  softRules: [
    { id: 'ELD-03', check: '2 格净宽区段每 ≤15 格设 ≥2 格错车段', cells: 2, note: 'A级 JGJ 450-2018 §5.6.3（室外借用）' },
    { id: 'ELD-06', check: '步行路径每 ≤15 格设一处带靠背可坐点', cells: 15, note: 'C级 经验值' },
    { id: 'ELD-09', check: '休憩区遮荫 ≥50%（按格数统计）', cells: 50, note: 'C级 经验值' },
  ],
  antiPatterns: [
    '不要把座椅排成无靠背长凳，否则老人起身没有支撑',
    '不要让 1.5 格宽的摊间通道充当适老主路，轮椅无法错车',
    '不要把回转点只画在图上而不留真实空区，判定看的是整格空格',
    '不要在唯一散步道上设台阶，高差处必须给坡道',
  ],
  completionChecks: [
    '任一可达节点存在 2×2 格空区',
    '主园路全程净宽 ≥2 格，每 15 格有错车段',
    '每 10 个座椅配 ≥1 个 2×2 格轮椅位',
    '所有高差处有坡道且平台 ≥2 格',
  ],
  objects: ['靠背座椅', '扶手', '坡道', '轮椅停留位', '遮荫乔木', '标识牌'],
};

const market: ActivityRecipe = {
  kind: 'market',
  label: '户外市集',
  aliases: ['市集', '集市', '周末市集', '摊位', '摆摊', '快闪', '夜市', '摊点'],
  intent: '让摊位排得下、人走得动、明火管得住',
  zones: [
    { key: 'stall', label: '摊位阵列', share: 60, adjacency: '沿通道两侧成排，排长 ≤40 格' },
    { key: 'aisle', label: '主次通道', share: 30, adjacency: '主通道 3 格贯穿全场，次通道 2 格接主通道' },
    { key: 'service', label: '明火与服务区', share: 10, adjacency: '独立组团，置于下风向边界' },
  ],
  layout: [
    '先定 ≥3 格主通道走向，再向两侧排 3×3 格摊位',
    '摊位纵向与横向间距均留 2 格',
    '明火餐饮独立成组团，置于下风向并退 6 格',
    '连续排长每 40 格断开 2 格作横向疏散口',
  ],
  hardRules: [
    { id: 'MKT-02', check: '摊位纵向与横向间距均 ≥2 格', cells: 2, note: 'B级 东营市城市便民摊点群设置管理导则' },
    { id: 'MKT-03', check: '主通道 ≥3 格、次通道 ≥2 格', cells: 3, note: 'B级 东营导则；荆州市夜市示范街方案' },
    { id: 'MKT-04', check: '应急通道 ≥3 格且直通场外，全程不得被摊位占用', cells: 3, note: 'B级 重庆北碚区临时占道经营点设置规划' },
    { id: 'MKT-06', check: '明火与餐饮摊位集中分区，与其他摊位 ≥6 格并置于下风向', cells: 6, note: 'B级 荆州市夜市示范街建设实施方案' },
    { id: 'MKT-09', check: '遮阳棚底净高 ≥3 格，材料阻燃', cells: 3, note: 'B级 东营导则' },
    { id: 'MKT-11', check: '摊位距固定建筑外墙 ≥3 格', cells: 3, note: 'C级 经验值 + 消防检查口径' },
  ],
  softRules: [
    { id: 'MKT-01', check: '单摊 3×3 格（9 格），不得超 9 格', cells: 9, note: 'C级 会展标摊行业惯例；地方导则多为 2–5 ㎡' },
    { id: 'MKT-05', check: '背靠背摊位间距 ≥1 格（共用背板可为 0）', cells: 1, note: 'C级 经验值' },
    { id: 'MKT-10', check: '摊位投影 ≤场地 35%（每 100 格 ≤35 格）', cells: 35, note: 'C级 经验值' },
    { id: 'MKT-12', check: '连续摊位排长 ≤40 格，每 40 格设 ≥2 格横向断口', cells: 40, note: 'C级 经验值' },
  ],
  antiPatterns: [
    '不要把明火摊混在主排里，否则 6 格分区一破整排作废',
    '不要用主通道补摆摊位，否则疏散宽度不足',
    '不要排出超过 40 格不断口的整排，消防与掉头都做不了',
    '不要把摊位顶到建筑外墙 3 格以内',
  ],
  completionChecks: [
    '主通道 ≥3 格、次通道 ≥2 格全程贯通',
    '明火组团与最近普通摊位 ≥6 格',
    '应急通道从场地内直通外部出入口',
    '连续排长不超过 40 格',
  ],
  objects: ['摊位帐棚', '摊桌', '灭火器', '分类垃圾桶', '明火隔离栏', '导视牌'],
};

const stage: ActivityRecipe = {
  kind: 'stage',
  label: '小型户外演出',
  aliases: ['演出', '舞台', '音乐会', '音乐节', '观众区', '表演', 'live'],
  intent: '先按人数算容量与通道，再谈舞台好不好看',
  zones: [
    { key: 'stage', label: '舞台与设备', share: 20, adjacency: '一端，台口正对观众区中轴' },
    { key: 'audience', label: '观众区', share: 55, adjacency: '在首排退距之后，被通道切成若干块' },
    { key: 'back', label: '后台与缓冲', share: 15, adjacency: '舞台后方 ≥6 格，与观众区物理隔离' },
    { key: 'foh', label: '调音位', share: 10, adjacency: '观众区中轴，距舞台 15–25 格，独立围栏' },
  ],
  layout: [
    '先定台口线与朝向，再退 5 格排首排',
    '按 1 格/人核算站位容量，通道面积另计',
    '主通道沿两侧通到后排，宽度取 4/6/8 格',
    '后台留 6 格、侧台留 3 格，与观众区硬隔离',
  ],
  hardRules: [
    { id: 'STG-01', check: '站立 ≥1 格/人，临时座席 ≥1 格/人', cells: 1, note: 'B级 地方公安口径（深圳、无锡、郑州；座席 0.75 ㎡ 向上取整为 1 格）' },
    { id: 'STG-02', check: '首排距舞台 ≥5 格；台高 >1.5 m 时按 5+4×(H−1.5) 增加', cells: 5, note: 'B级 郑州市公安局大型活动安全管理规范 §34' },
    { id: 'STG-03', check: '<5000 人主通道 ≥4 格（3.5 m 向上取整），5000–15000 人取 6/3 格', cells: 4, note: 'B级 无锡市大型群众性活动安全管理办法 §38' },
    { id: 'STG-05', check: '观众区与舞台间设高 >1.2 m、立杆间距 ≤2 格的实体护栏', cells: 2, note: 'A级 GB/T 36731-2018 §6.2.5.3' },
    { id: 'STG-07', check: '通道净宽 ≥2 格、净高 ≥3 格', cells: 2, note: 'A级 GB/T 36731-2018 §6.2.6.1' },
    { id: 'GEN-03', check: '疏散主通道 ≥3 格且直通场外', cells: 3, note: 'B级 地方公安口径；GB 50016-2014 §5.5.18' },
  ],
  softRules: [
    { id: 'STG-08', check: '舞台后 ≥6 格、侧台 ≥3 格，与观众区物理隔离', cells: 6, note: 'C级 经验值' },
    { id: 'STG-11', check: '歌舞综合类最远视距 ≤30 格，语言类 ≤20 格', cells: 30, note: 'C级 经验值，未引条文号' },
    { id: 'STG-09', check: '调音位距舞台 15–25 格，位于中轴并独立围栏', cells: 15, note: 'C级 经验值' },
  ],
  antiPatterns: [
    '不要用场地毛面积算容量，首排退距、通道与调音位都要先扣掉',
    '不要把调音位塞进观众区中轴却不围栏，人流会把它当通道',
    '不要在舞台与观众之间只拉警戒带，判定要的是实体护栏',
    '不要把主通道只留一侧，另一侧观众没有疏散路径',
  ],
  completionChecks: [
    '首排到台口 ≥5 格',
    '主通道全程 ≥4 格且两侧直通出口',
    '舞台与观众区之间有 >1.2 m 实体护栏',
    '容量核算已扣除退距、通道与调音位',
  ],
  objects: ['舞台台面', '桁架', '护栏', '观众围栏', '调音台', '临时厕所'],
};

const camp: ActivityRecipe = {
  kind: 'camp',
  label: '户外营地',
  aliases: ['露营', '营地', '帐篷', '营位', '野营'],
  intent: '每个营位都能独立进出，且火与帐篷之间留够距离',
  zones: [
    { key: 'pitch', label: '营位组团', share: 55, adjacency: '成组团铺开，位与位之间留间距' },
    { key: 'service', label: '卫浴与服务', share: 25, adjacency: '服务中心在营地入口，服务半径 ≤250 格' },
    { key: 'buffer', label: '绿地缓冲', share: 20, adjacency: '包住营位组团，隔开停车与明火' },
  ],
  layout: [
    '先按 20 格营位铺组团，位间留 2 格',
    '帐篷之间按 4 格排，明火区外撤 10 格',
    '停车区留在营地外，距最近营位 ≥30 格',
    '乔木枝下留 3 格净空，不压帐篷与通道',
  ],
  hardRules: [
    { id: 'CMP-01', check: '单营位 ≥20 格', cells: 20, note: 'A级 GB/T 31710.3-2015 §6.2.6' },
    { id: 'CMP-02', check: '营位间距 ≥2 格', cells: 2, note: 'A级 GB/T 31710.3-2015 §6.2.9' },
    { id: 'CMP-03', check: '帐篷之间 ≥4 格；明火与烧烤区距帐篷 ≥10 格', cells: 4, note: 'C级 经验值（消防口径，各地不一致）' },
    { id: 'CMP-05', check: '乔木枝下净空 ≥3 格', cells: 3, note: 'A级 GB/T 31710.3-2015 §6.2.2' },
    { id: 'GEN-06', check: '通道净高 ≥3 格', cells: 3, note: 'A级 GB/T 36731-2018 §6.2.6.1' },
  ],
  softRules: [
    { id: 'CMP-11', check: '停车区距最近营位 ≥30 格，机动车不得进入露营区', cells: 30, note: 'A级 GB/T 31710.3-2015 §5.2.6 + C级 经验值' },
    { id: 'CMP-09', check: '营地至卫生间服务半径 ≤250 格', cells: 250, note: 'A级 GB/T 31710.3-2015 §6.4.2' },
    { id: 'CMP-06', check: '营地绿地率 ≥50%（每 100 格 ≥50 格）', cells: 50, note: 'A级 GB/T 31710.3-2015 §5.2.5' },
    { id: 'CMP-08', check: '垃圾集中站距功能区 ≥50 格且位于下风向', cells: 50, note: 'A级 GB/T 31710.3-2015 §6.5.2' },
  ],
  antiPatterns: [
    '不要把帐篷按 2 格间距排，2 格是服务间距，防火要 4 格',
    '不要让明火区贴着帐篷，10 格以内一票否决',
    '不要在机动车能开进来的地方划营位，车辆不得进入露营区',
    '不要用大乔木压住营位，枝下必须留 3 格',
  ],
  completionChecks: [
    '每个营位 ≥20 格、位间 ≥2 格',
    '帐篷之间 ≥4 格，明火区距帐篷 ≥10 格',
    '乔木枝下净空 ≥3 格',
    '停车区距最近营位 ≥30 格',
  ],
  objects: ['帐篷', '天幕', '烧烤炉', '垃圾箱', '淋浴间', '指路牌'],
};

const exhibition: ActivityRecipe = {
  kind: 'exhibition',
  label: '户外展览',
  aliases: ['展览', '展位', '展会', '展陈', '打卡', '游线', '展区'],
  intent: '通道宽度决定能设几排展，先定通道再定展位',
  zones: [
    { key: 'booth', label: '展位组团', share: 60, adjacency: '贴着通道外侧，尽端式组团' },
    { key: 'aisle', label: '主次通道', share: 30, adjacency: '主通道 5 格成环，次通道 3 格接入' },
    { key: 'buffer', label: '出入口缓冲', share: 10, adjacency: '出入口内退 ≥3 格，兼作打卡位' },
  ],
  layout: [
    '先定 ≥5 格主通道与 ≥3 格次通道，再排展位',
    '通道 <8 格只单侧设展，≤3 格不设展',
    '打卡位外挂通道侧，前方留 3×3 格',
    '每 ≤50 格设一处 ≥4 格遮阳避雨点',
  ],
  hardRules: [
    { id: 'EXH-01', check: '主通道 ≥5 格、次通道 ≥3 格', cells: 5, note: 'A级 JGJ 218-2010 §4.2.7' },
    { id: 'EXH-02', check: '通道 ≤8 格只可单侧设展，≤3 格不得设展', cells: 8, note: 'B级 郑州市公安局大型活动规范 §35' },
    { id: 'EXH-09', check: '悬挂展品、标识与灯架底边 ≥3 格', cells: 3, note: 'A级 GB 50763-2012 §3.5.2-4' },
    { id: 'GEN-03', check: '疏散主通道 ≥3 格且直通场外', cells: 3, note: 'B级 地方公安口径；GB 50016-2014 §5.5.18' },
    { id: 'GEN-01', check: '室外通行净宽 ≥2 格', cells: 2, note: 'A级 GB 50763-2012 §3.5.1' },
  ],
  softRules: [
    { id: 'EXH-03', check: '展品投影四周留 ≥1 格观展净距，大型装置 ≥2 格', cells: 1, note: 'C级 经验值' },
    { id: 'EXH-05', check: '任一游线断面净宽 ≥3 格', cells: 3, note: 'C级 经验值' },
    { id: 'EXH-07', check: '游线每 ≤50 格设一处遮阳避雨点，单处 ≥4 格', cells: 50, note: 'C级 经验值' },
    { id: 'EXH-08', check: '打卡位前方净空 ≥3×3 格，不得压主通道', cells: 3, note: 'C级 经验值' },
    { id: 'EXH-11', check: '展位距出入口 ≥3 格作集散缓冲', cells: 3, note: 'C级 经验值' },
  ],
  antiPatterns: [
    '不要在主通道两侧都设展却不把通道做到 8 格',
    '不要把打卡位画进通道，3×3 格正好堵死 3 格通道',
    '不要让展台地台侵入通道净宽线',
    '不要把展品贴在出入口 3 格以内',
  ],
  completionChecks: [
    '主通道 ≥5 格、次通道 ≥3 格全程贯通',
    '双侧设展处通道 ≥8 格',
    '任一游线断面 ≥3 格',
    '悬挂物底边 ≥3 格',
  ],
  objects: ['展墙', '展台', '射灯', '打卡装置', '遮阳棚', '导视牌'],
};

const generic: ActivityRecipe = {
  kind: 'generic',
  label: '通用活动场地',
  aliases: ['通用', '其他', '活动场地'],
  intent: '先把通行与疏散的骨架定下来，再往里塞活动内容',
  zones: [
    { key: 'main', label: '主活动区', share: 60, adjacency: '居中，四周留缓冲' },
    { key: 'aisle', label: '环形通道', share: 25, adjacency: '包住主活动区，两端接出入口' },
    { key: 'edge', label: '边界缓冲', share: 15, adjacency: '靠墙与靠出入口的一圈' },
  ],
  layout: [
    '先定 ≥3 格疏散主通道与 ≥2 个出入口',
    '沿通道外扩 2 格作为物件缓冲带',
    '大件靠边、小件居中，每 15 格留 2×2 格回转点',
    '悬挂物与棚架底边留 3 格净高',
  ],
  hardRules: [
    { id: 'GEN-01', check: '室外通行净宽 ≥2 格（室内 ≥2 格）', cells: 2, note: 'A级 GB 50763-2012 §3.5.1' },
    { id: 'GEN-03', check: '疏散主通道 ≥3 格且直通场外', cells: 3, note: 'B级 地方公安口径；GB 50016-2014 §5.5.18' },
    { id: 'GEN-05', check: '消火栓、灭火器 2 格内禁占', cells: 2, note: 'A级 GB 50016-2014 §8.1 + 常规消防检查口径' },
    { id: 'GEN-06', check: '通道与悬挂物底边净高 ≥3 格', cells: 3, note: 'A级 GB/T 36731-2018 §6.2.6.1' },
  ],
  softRules: [
    { id: 'GEN-02', check: '主要人流通道 ≥2 格', cells: 2, note: 'A级 GB 50763-2012 §3.5.1-1' },
    { id: 'GEN-07', check: '临时设施距固定建筑外墙 ≥3 格', cells: 3, note: 'C级 经验值 + 消防车道禁占' },
    { id: 'EXH-11', check: '物件距出入口 ≥3 格作集散缓冲', cells: 3, note: 'C级 经验值（借用展览场景的集散缓冲口径）' },
  ],
  antiPatterns: [
    '不要先摆物件再找通道，主通道会被挤到 1 格',
    '不要把物件压住消防设施 2 格净空',
    '不要在唯一出入口前堆物',
    '不要把悬挂物降到 3 格净高以下',
  ],
  completionChecks: [
    '主通道 ≥3 格且两端通到出入口',
    '出入口 ≥2 个',
    '任意物件与墙、与他物之间 ≥1 格',
    '所有悬挂物底边 ≥3 格',
  ],
  objects: ['桌椅', '隔断', '标识牌', '绿植', '垃圾桶', '照明'],
};

/** 全部配方，顺序即同分时的先后次序。 */
export const ACTIVITY_RECIPES: ActivityRecipe[] = [family, elder, market, stage, camp, exhibition, generic];

const GENERIC = generic;

/**
 * 按 brief 里的中文别名命中情况选配方。
 * 打分：每个命中别名计 `长度²`（越长越具体），同类多次命中累加，再乘 KIND_WEIGHT。
 * brief 为空或全无命中时返回 [generic]；最多返回 limit 条（默认 2）。
 */
export function matchRecipes(brief: string, limit: number = 2): ActivityRecipe[] {
  const capped = Math.max(1, Math.floor(limit));
  const text = (brief ?? '').trim();
  if (!text) return [GENERIC];
  const scored = ACTIVITY_RECIPES
    .map((recipe, index) => {
      let hit = 0;
      for (const alias of recipe.aliases) {
        if (alias.length > 0 && text.includes(alias)) hit += alias.length * alias.length;
      }
      return { recipe, index, score: hit * KIND_WEIGHT[recipe.kind] };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (scored.length === 0) return [GENERIC];
  return scored.slice(0, capped).map(entry => entry.recipe);
}

/** 从 note 开头取来源级别，例如「A级 GB/T ...」→「A级」。 */
function gradeOf(rule: RecipeRule): string {
  const matched = (rule.note ?? '').match(/^(A|B|C)级/);
  return matched ? `${matched[1]}级` : 'C级';
}

type Keep = { layout: number; soft: number; anti: number; completion: number };

function renderBlock(recipe: ActivityRecipe, keep: Keep): string {
  const lines: string[] = [
    `【配方·${recipe.label}】本质：${recipe.intent}`,
    `分区：${recipe.zones.map(zone => `${zone.label} ${zone.share}%`).join(' / ')}`,
  ];
  if (keep.layout > 0) {
    lines.push(`套路：${recipe.layout.slice(0, keep.layout).map((step, i) => `${i + 1}) ${step}`).join(' ')}`);
  }
  // 硬判据永不裁剪：它是提示词里唯一能一票否决的部分。
  lines.push(`硬判据：${recipe.hardRules.map(rule => `[${rule.id}] ${rule.check}（${gradeOf(rule)}）`).join('；')}`);
  if (keep.soft > 0) {
    lines.push(`软判据：${recipe.softRules.slice(0, keep.soft).map(rule => `[${rule.id}] ${rule.check}（${gradeOf(rule)}）`).join('；')}`);
  }
  if (keep.anti > 0) lines.push(`常见错误：${recipe.antiPatterns.slice(0, keep.anti).join('；')}`);
  if (keep.completion > 0) lines.push(`完成判据：${recipe.completionChecks.slice(0, keep.completion).join('；')}`);
  return lines.join('\n');
}

/**
 * 渲染成可直接注入系统提示词的中文短文本。
 * 超出 maxChars（默认 1200）时按 软判据 → 常见错误 的顺序逐条让路；
 * 仍超出则继续让出 完成判据 → 套路。分区与硬判据始终保留。
 */
export function renderRecipes(recipes: ActivityRecipe[], opts: { maxChars?: number } = {}): string {
  if (recipes.length === 0) return '';
  const maxChars = Math.max(1, Math.floor(opts.maxChars ?? 1200));
  const keep: Keep[] = recipes.map(recipe => ({
    layout: recipe.layout.length,
    soft: recipe.softRules.length,
    anti: recipe.antiPatterns.length,
    completion: recipe.completionChecks.length,
  }));
  const text = () => recipes.map((recipe, i) => renderBlock(recipe, keep[i])).join('\n\n');

  let out = text();
  if (out.length <= maxChars) return out;
  const order: (keyof Keep)[] = ['soft', 'anti', 'completion', 'layout'];
  for (const key of order) {
    let changed = true;
    while (changed && out.length > maxChars) {
      changed = false;
      for (let i = 0; i < recipes.length; i++) {
        if (keep[i][key] <= 0) continue;
        keep[i][key] -= 1;
        changed = true;
        out = text();
        if (out.length <= maxChars) return out;
      }
    }
  }
  return out;
}
