export interface ReviewReferenceInput {
  name?: string;
  event: string;
  guests: number;
  mustHave?: string | undefined;
  venueConditions?: string | undefined;
  style?: string | undefined;
  palette?: string | undefined;
  atmosphere?: string | undefined;
  area?: number | null;
  items?: number;
}

export interface ReviewReference { summary: string; pending: string }

const REVIEW_SUMMARY_PREFIX = '【方案简述参考 ·';

function eventFocus(event: string): string {
  if (/婚礼|婚宴/.test(event)) return '重点保证仪式、就餐与合影互不挡路，主通道留出上菜和走动空间。';
  if (/露营|派对|聚会/.test(event)) return '用围合座位和灯串形成主要停留区，保留到出口的通道。';
  if (/工作坊|培训|课堂/.test(event)) return '每位参与者有可操作的台面，讲师区与投影视线无遮挡。';
  if (/黑客松|编程|比赛/.test(event)) return '工位成组、电源可达，留出讨论角与顺畅的主通道。';
  if (/市集|展览|展销/.test(event)) return '摊位沿主动线排布，摊前留停留空间，出口留缓冲。';
  if (/快闪|发布|品牌/.test(event)) return '入口留拍照和缓冲位，展示、试用与收银互不挡路。';
  return '入口留缓冲，主要功能区不互相挡路，保留一条顺畅的主通道。';
}

function eventPending(event: string): string {
  if (/婚礼|婚宴/.test(event)) return '仪式、就餐、合影分区与上菜动线需与场地方确认。';
  if (/露营|派对|聚会/.test(event)) return '户外天气、地面固定与夜间照明用电需确认。';
  if (/工作坊|培训|课堂/.test(event)) return '插座、投影位置与讲师区视线需现场确认。';
  if (/黑客松|编程|比赛/.test(event)) return '工位电源、网络与夜间使用规则需确认。';
  if (/市集|展览|展销/.test(event)) return '摊位尺寸、卸货口与主通道宽度需场地方确认。';
  if (/快闪|发布|品牌/.test(event)) return '进场时间、用电位置与收银位置需确认。';
  return '场地使用时间、用电与进场路线需确认。';
}

function areaText(area: number | null | undefined): string {
  return typeof area === 'number' && Number.isFinite(area) && area > 0 ? `约 ${Number(area.toFixed(1))} ㎡` : '';
}

function clip(value: string | undefined, limit: number): string {
  const text = value?.trim() ?? '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * 评审页的「方案简述 / 待确认」参考：只按已填的活动资料与本机规则拼一版，
 * 不是客户原话，也不替人确认任何现场条件。空字段才由面板调用。
 */
export function buildReviewReference(input: ReviewReferenceInput): ReviewReference {
  const event = clip(input.event, 24) || '这场活动';
  const guests = Number.isInteger(input.guests) && input.guests > 0 ? input.guests : null;
  const area = areaText(input.area);
  const items = Number.isInteger(input.items) && (input.items ?? 0) > 0 ? input.items! : null;
  const name = clip(input.name, 40);
  const scope = [area, items ? `${items} 件物料` : ''].filter(Boolean).join('，');
  const opening = name ? `本方案为“${name}”准备` : '本方案按当前活动布置';
  const mustHave = clip(input.mustHave, 160);
  const venueConditions = clip(input.venueConditions, 160);
  const style = clip(input.style, 80);
  const palette = clip(input.palette, 80);
  const atmosphere = clip(input.atmosphere, 80);
  const extras = [
    mustHave ? `必须保留：${mustHave}` : '',
    venueConditions ? `现场条件：${venueConditions}` : '',
    style ? `风格：${style}` : '',
    palette ? `配色：${palette}` : '',
    atmosphere ? `氛围：${atmosphere}` : '',
  ].filter(Boolean);
  const summary = [
    `${REVIEW_SUMMARY_PREFIX} ${event}${guests ? ` · ${guests} 人` : ''}】`,
    `${opening}${scope ? `，${scope}` : ''}。${eventFocus(event)}`,
    ...extras,
    '以上为方案说明参考；实际尺寸、材质与数量以现场复核和最终确认为准。',
  ].join('\n');
  const pending = [
    '【待确认参考】',
    `1. ${eventPending(event)}`,
    '2. 场地实测尺寸、入口净宽与可用层高。',
    '3. 用电位置、总功率与进场/撤场时间。',
    '4. 重点物料的颜色、材质、交期与备货数量。',
    '5. 搭建、撤场与运输的责任分工。',
  ].join('\n');
  return { summary, pending };
}
