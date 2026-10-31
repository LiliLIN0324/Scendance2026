import { CATALOG_GROUPS } from './catalog-taxonomy';
import type { FurnitureCategory, GameMode } from './types';

/**
 * What a Build Tools tile selects: a catalog category, or the interior
 * wall-draw tool, which has no catalog items of its own.
 */
export type BuildToolKey = FurnitureCategory | 'walls';

/**
 * Structure tools first, then event groups in catalog order (舞台, 签到, 展位,
 * 座席, …). Legacy home chips (bedroom, kitchen, bathroom) are not tools;
 * saved items with those keys still resolve through the group table.
 */
export const BUILD_TOOLS: readonly BuildToolKey[] = [
  'structure',
  'walls',
  ...CATALOG_GROUPS.map(group => group.key).filter(key => key !== 'structure'),
];

const STRUCTURE_KEYS: ReadonlySet<BuildToolKey> = new Set<BuildToolKey>(['walls', 'structure']);

/** True for the tools that build the house itself: walls and openings/stairs. */
export function isStructureCategory(key: BuildToolKey): boolean {
  return STRUCTURE_KEYS.has(key);
}

/**
 * The Build Tools a mode exposes. DESIGN is structure only, FURNISH is
 * furniture only, and EXPLORE has no build HUD at all. Together the two
 * build modes cover every tool exactly once, so nothing becomes
 * unreachable — switching mode is how you get to the other half.
 */
export function categoriesForMode(mode: GameMode): readonly BuildToolKey[] {
  switch (mode) {
    case 'build':
      return BUILD_TOOLS.filter(isStructureCategory);
    case 'buy':
      return BUILD_TOOLS.filter((key) => !isStructureCategory(key));
    case 'live':
      return [];
  }
}

/**
 * The tool to show as selected in `mode`: the user's pick when the mode
 * offers it, otherwise the mode's first tool. Lets the HUD keep one
 * selection across mode switches without an effect to patch it up.
 */
export function resolveToolForMode(mode: GameMode, selected: BuildToolKey): BuildToolKey {
  const tools = categoriesForMode(mode);
  return tools.includes(selected) ? selected : (tools[0] ?? selected);
}

/**
 * The catalog category a tool browses. The wall tool has no items, so it
 * shows the openings that go on walls instead of the whole catalog.
 */
export function catalogCategoryForTool(tool: BuildToolKey): FurnitureCategory {
  return tool === 'walls' ? 'structure' : tool;
}
