import type { RoomLayout, ScenePresetKey } from './types';

/**
 * The archived complete scenes the workbench can open. `name` and `description`
 * are the card copy, `width`/`depth` are the venue footprint in metres (used for
 * the floor, camera fit and area readout — NOT the whole model bounds), and
 * `height` is the storey height. The GLB itself is built by
 * `scripts/package-scene-presets.mjs` into `public/scene-presets/<key>/`.
 */
interface ScenePreset {
  name: string;
  description: string;
  width: number;
  depth: number;
  height: number;
}

// A Record of the ScenePresetKey union, so a preset added to one side without
// the other fails the typecheck instead of silently missing from the panel.
export const SCENE_PRESETS = {
  gym: { name: '体育馆 · 黑客松', description: '25 支团队 · 100 位参与者', width: 70, depth: 76, height: 6 },
  popup: { name: '青序 · 香氛快闪', description: '12 × 8 米 · 24 位来访者', width: 12, depth: 8, height: 3.5 },
  bar: { name: '琥珀间 · 酒吧', description: '12 × 9 米 · 吧台与 3 组卡座', width: 12, depth: 9, height: 3.4 },
  cafe: { name: '慢调咖啡 · SLOW NOTES', description: '12 × 9 米 · 咖啡吧台与 14 席', width: 12, depth: 9, height: 3.25 },
  conference: { name: '学术会议 · 共知', description: '24 × 18 米 · 96 位观众', width: 24, depth: 18, height: 5.3 },
  lawn: { name: '室外草坪 · 旷野有约', description: '28 × 20 米 · 60 位来宾', width: 28, depth: 20, height: 4.3 },
  market: { name: '风物市集 · 户外市集', description: '30 × 22 米 · 12 个摊位', width: 30, depth: 22, height: 4.3 },
  museum: { name: '留白之间 · 美术馆展区', description: '20 × 14 米 · 展厅与展品', width: 20, depth: 14, height: 4.1 },
  office: { name: '办公室 · 留白', description: '14 × 10 米 · 8 个工位', width: 14, depth: 10, height: 3.3 },
  studio: { name: '留白 · 摄影工作室', description: '12 × 10 米 · 摄影棚与器材', width: 12, depth: 10, height: 4.3 },
} as const satisfies Record<ScenePresetKey, ScenePreset>;

export type { ScenePresetKey };

/** Every packaged preset, in panel order. Validation accepts exactly these. */
export const SCENE_PRESET_KEYS = Object.keys(SCENE_PRESETS) as ScenePresetKey[];

export function presetModelUrl(key: ScenePresetKey): string { return `/scene-presets/${key}/${key}.glb`; }
export function editorItemLimit(layout: RoomLayout): number { return layout.scenePreset ? 500 : 50; }
