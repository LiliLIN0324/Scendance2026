export type PresetKey =
  | 'gym' | 'popup' | 'bar' | 'cafe' | 'conference'
  | 'lawn' | 'market' | 'museum' | 'office' | 'studio';

export const PRESET_KEYS: readonly PresetKey[];

/** Converts one archived template into the `Preset_Structure` / `Preset_Objects` layout. */
export function convertPreset(buffer: Buffer, key: PresetKey): Buffer;

/** Gym and popup: the source exporter split fixtures across layers, so their grouping is authored here. */
export function convertGymOrPopup(buffer: Buffer, key: 'gym' | 'popup'): Buffer;

/** The eight template archives: grouping comes from the per-key layer plan. */
export function convertArchivePreset(buffer: Buffer, key: PresetKey, plan: unknown): Buffer;

export function packageScenePresets(root: URL): Promise<void>;
