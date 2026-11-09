/** Short Chinese hints for a refused move or a preview that does not fit. No rule codes. */

const HINT: Readonly<Record<string, string>> = {
  BBOX_OVERLAP: '和旁边叠了。先说「往东挪 0.5 米」，或撤开挡住的那件。',
  OUT_OF_BOUNDS: '出了场地边。往里收，或先把场地加大。',
  KEEP_OUT_BAND: '踩进留白了。换一边放。',
  STRUCTURAL: '离墙或过道太近。留出过道再放。',
  E_KEEP_OUT: '压到过道了。把座位往里收。',
  E_SET_BLOCKED: '这组和旁边叠了。先挪开，或说「换一版」。',
  E_ROLE_UNFIT: '这块地摆不下一组桌椅。把场地加大，或少坐几人。',
  E_FINAL_GEOMETRY: '出了场地边或压到墙。往里收，或先加大场地。',
  TARGET_NOT_FOUND: '没找到这件。点名舞台、桌子或灯。',
  LOCKED: '这件锁着。先解锁再改。',
  NO_SPOT: '附近没有空位。先挪开一件，或换一版。',
  UNKNOWN_ASSET: '这个物件还对不上。到物料里点名后再加。',
  TARGET_AMBIGUOUS: '有好几件同名。说「左边第二张」再改。',
};

export function revisionRefusalText(conflicts: readonly { code: string; message: string; alternative?: { x: number; z: number } | undefined }[]): string {
  const first = conflicts[0];
  if (!first) return '没改成。点名要动的物件，再说方向和米数。';
  const hint = HINT[first.code] ?? '这步被挡住了。换个位置，或先说清要动哪一件。';
  const alt = first.alternative ? `可试 (${first.alternative.x}, ${first.alternative.z})。` : '';
  return `${first.message}。${hint}${alt}`;
}

export function layoutChatHint(input: {
  overlapCount?: number | undefined;
  blocked?: string | null | undefined;
  refusals?: readonly { code: string; message: string }[] | undefined;
}): string | null {
  if ((input.overlapCount ?? 0) > 0) return HINT.BBOX_OVERLAP!;
  const refusal = input.refusals?.find(item => HINT[item.code]);
  if (refusal) return HINT[refusal.code]!;
  if (input.blocked && /边界|越界|墙|通道|过道/.test(input.blocked)) return HINT.OUT_OF_BOUNDS!;
  return null;
}
