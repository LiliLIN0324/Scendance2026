/** 顶栏场地简报一行：活动 · 人数 · 米数。左栏不再重复占这一份。 */
export interface VenueBriefFacts {
  event: string | null;
  guests: string | null;
  dims: string;
}

export function venueBriefLine(facts: VenueBriefFacts): string {
  return [facts.event || '活动还没说', facts.guests || '人数还没说', facts.dims].join(' · ');
}
