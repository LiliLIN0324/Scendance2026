/** A short role so layout talk can name an Aholo asset. Old procedural layout stays the fallback. */

export type LayoutAssetRole = '舞台' | '灯' | '桌子' | '椅子' | '签到台';

export function layoutRoleFromAssetName(name: string): LayoutAssetRole | null {
  const text = name.replace(/\s+/g, '');
  if (!text) return null;
  if (/舞台|讲台/.test(text)) return '舞台';
  if (/签到|接待/.test(text)) return '签到台';
  if (/灯/.test(text) && !/桌|椅/.test(text)) return '灯';
  if (/椅/.test(text) && !/桌/.test(text)) return '椅子';
  if (/桌/.test(text)) return '桌子';
  return null;
}

export function layoutRoleNote(role: LayoutAssetRole): string {
  return `角色：${role}`;
}

export function layoutRoleFromNote(notes: string | undefined): string {
  return /^角色：([\u4e00-\u9fa5]{1,4})$/.exec((notes ?? '').trim())?.[1] ?? '';
}
