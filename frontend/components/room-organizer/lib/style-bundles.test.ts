import { describe, expect, it } from 'vitest';
import {
  buildStyleBundleItems,
  listStyleBundles,
  matchStyleBundleCommand,
  paletteFromPrompt,
  saveCustomStyle,
  STYLE_BUNDLES,
  STYLE_CUSTOM_KEY,
} from './style-bundles';

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key: string) { return map.has(key) ? map.get(key)! : null; },
    setItem(key: string, value: string) { map.set(key, value); },
  };
}

describe('style bundles', () => {
  it('ships more than three built-in moods', () => {
    expect(STYLE_BUNDLES.length).toBeGreaterThanOrEqual(8);
    expect(STYLE_BUNDLES.every(bundle => bundle.prompt.trim().length > 0)).toBe(true);
  });

  it('builds a colored set that fits a room', () => {
    const bundle = STYLE_BUNDLES.find(entry => entry.key === 'cream-lounge')!;
    const built = buildStyleBundleItems(bundle, { width: 8, depth: 8 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.items.length).toBeGreaterThanOrEqual(4);
    expect(built.items.some(item => item.type === 'sofa' && item.color === '#E8DCC8')).toBe(true);
  });

  it('turns a style prompt into a usable palette and saved custom style', () => {
    const store = memoryStore();
    const palette = paletteFromPrompt('雾蓝极简发布会', 'lounge');
    expect(palette.swatches).toHaveLength(4);
    const saved = saveCustomStyle({ name: '雾蓝发布', prompt: '雾蓝极简发布会，哑光金属', setKey: 'lounge' }, store);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(store.getItem(STYLE_CUSTOM_KEY)).toContain('雾蓝发布');
    expect(listStyleBundles(store)[0]?.key).toBe(saved.bundle.key);
    const match = matchStyleBundleCommand('按雾蓝发布配一套', store);
    expect(typeof match).toBe('object');
    if (match && match !== 'open') expect(match.key).toBe(saved.bundle.key);
  });

  it('matches spoken style commands', () => {
    const match = matchStyleBundleCommand('按奶油会客配一套');
    if (match && match !== 'open') expect(match.key).toBe('cream-lounge');
    else expect(match).toBeNull();
    expect(matchStyleBundleCommand('按风格配一套')).toBe('open');
    expect(matchStyleBundleCommand('帮我出方案')).toBeNull();
  });
});
