import type { RoomLayout } from './types';

export const SCENE_PRESETS = {
  gym: { name: '体育馆 · 黑客松', description: '25 支团队 · 100 位参与者', width: 70, depth: 76, height: 6 },
  popup: { name: '青序 · 香氛快闪', description: '12 × 8 米 · 24 位来访者', width: 12, depth: 8, height: 3.5 },
} as const;
export type ScenePresetKey = keyof typeof SCENE_PRESETS;
export function presetModelUrl(key: ScenePresetKey): string { return `/scene-presets/${key}/${key}.glb`; }
export function editorItemLimit(layout: RoomLayout): number { return layout.scenePreset ? 500 : 50; }
