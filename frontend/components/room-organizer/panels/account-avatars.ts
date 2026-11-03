import { useCallback, useMemo, useSyncExternalStore, type CSSProperties } from 'react';

export interface AvatarPreset {
  id: string;
  name: string;
  src: string;
}

export interface AvatarTone {
  id: string;
  name: string;
  bg: string;
  ink: string;
}

/** 统一规格：256×256 圆形裁切、同一人物骨架、扁平纸感插画，不含照片人像。 */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: '01', name: '陶土 · 短发', src: '/assets/avatars/preset/01.svg' },
  { id: '02', name: '雾蓝 · 中分', src: '/assets/avatars/preset/02.svg' },
  { id: '03', name: '沙金 · 丸子头', src: '/assets/avatars/preset/03.svg' },
  { id: '04', name: '石墨 · 鸭舌帽', src: '/assets/avatars/preset/04.svg' },
  { id: '05', name: '梅子 · 长波波', src: '/assets/avatars/preset/05.svg' },
  { id: '06', name: '橄榄 · 卷发', src: '/assets/avatars/preset/06.svg' },
  { id: '07', name: '砖红 · 齐刘海', src: '/assets/avatars/preset/07.svg' },
  { id: '08', name: '松烟 · 贝雷帽', src: '/assets/avatars/preset/08.svg' },
  { id: '09', name: '赭石 · 双马尾', src: '/assets/avatars/preset/09.svg' },
  { id: '10', name: '麦色 · 圆框', src: '/assets/avatars/preset/10.svg' },
];

/** 首字母圆片的十档色，逐档取自同名插画里那件衣服的颜色；沙金太亮，字用墨色，其余用纸白。 */
export const AVATAR_TONES: AvatarTone[] = [
  { id: '01', name: '陶土', bg: '#B25B44', ink: '#FFFFFF' },
  { id: '02', name: '雾蓝', bg: '#46657A', ink: '#FFFFFF' },
  { id: '03', name: '沙金', bg: '#C29C5C', ink: '#141416' },
  { id: '04', name: '石墨', bg: '#3D4148', ink: '#FFFFFF' },
  { id: '05', name: '梅子', bg: '#8A5F72', ink: '#FFFFFF' },
  { id: '06', name: '橄榄', bg: '#6D7252', ink: '#FFFFFF' },
  { id: '07', name: '砖红', bg: '#9C4A3C', ink: '#FFFFFF' },
  { id: '08', name: '松烟', bg: '#39434A', ink: '#FFFFFF' },
  { id: '09', name: '赭石', bg: '#A66E3F', ink: '#FFFFFF' },
  { id: '10', name: '麦色', bg: '#7A6045', ink: '#FFFFFF' },
];

const STORAGE_PREFIX = 'scendance.avatar.v1:';

function seedHash(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return hash;
}

export function avatarForSeed(seed: string): AvatarPreset {
  return AVATAR_PRESETS[seedHash(seed) % AVATAR_PRESETS.length];
}

/**
 * 按账号 ID 分档，所以同一个人换设备、刷新都不会变；同团队撞色时按名单顺序顺延到下一档，
 * 名单顺序由云端固定，因此左轨和成员表算出来的必然是同一套。
 */
export function avatarTonesFor(members: readonly { userId: string }[]): Map<string, AvatarTone> {
  const taken = new Set<string>();
  const tones = new Map<string, AvatarTone>();
  for (const member of members) {
    let index = seedHash(member.userId) % AVATAR_TONES.length;
    for (let step = 0; step < AVATAR_TONES.length; step += 1) {
      if (!taken.has(AVATAR_TONES[index].id)) break;
      index = (index + 1) % AVATAR_TONES.length;
    }
    taken.add(AVATAR_TONES[index].id);
    tones.set(member.userId, AVATAR_TONES[index]);
  }
  return tones;
}

export function avatarToneStyle(tone: AvatarTone | undefined): CSSProperties | undefined {
  return tone ? { '--sc-avatar-bg': tone.bg, '--sc-avatar-ink': tone.ink } as CSSProperties : undefined;
}

export function loadAvatar(userId: string | null | undefined): AvatarPreset {
  const seed = userId || 'guest';
  if (typeof window === 'undefined') return avatarForSeed(seed);
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + seed);
    return AVATAR_PRESETS.find(item => item.id === stored) ?? avatarForSeed(seed);
  } catch {
    return avatarForSeed(seed);
  }
}

export function saveAvatar(userId: string | null | undefined, id: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_PREFIX + (userId || 'guest'), id); } catch { /* 本地存储不可用时只影响下次打开的默认值。 */ }
  for (const listener of [...avatarListeners]) listener();
}

const avatarListeners = new Set<() => void>();

/**
 * 头像选完存在这台设备的 localStorage 里，所以本机只认得出「我自己」那一张：
 * 凡是我自己的圆片都跟着它换，别的人还没存过，只能继续用字母圆片。
 * 要让同事选的头像在两台设备上都一致，得把这张选择放进云端成员表。
 * 选一次要左轨、成员表、对话顶栏同时换脸，所以订阅存储变化，不等刷新。
 */
export function useAvatarPresetsFor(members: readonly { userId: string }[], currentUserId: string | null | undefined): Map<string, AvatarPreset> {
  const subscribe = useCallback((listener: () => void) => {
    avatarListeners.add(listener);
    return () => { avatarListeners.delete(listener); };
  }, []);
  const stored = useSyncExternalStore(subscribe, () => {
    if (typeof window === 'undefined') return null;
    try { return window.localStorage.getItem(STORAGE_PREFIX + (currentUserId || 'guest')); } catch { return null; }
  }, () => null);
  return useMemo(() => {
    if (!currentUserId) return new Map();
    const mine = AVATAR_PRESETS.find(item => item.id === stored) ?? avatarForSeed(currentUserId);
    return new Map(members.filter(member => member.userId === currentUserId).map(member => [member.userId, mine]));
  }, [members, currentUserId, stored]);
}
