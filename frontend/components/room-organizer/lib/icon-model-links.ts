import links from '../../../../assets/library/icon-model-links.json';
import type { FacilityModelCandidate } from './plan-facility-models';

interface IconModelSize {
  name: string;
  width: number;
  depth: number;
  height: number;
  trueScale?: boolean;
}

const byIcon: Readonly<Record<string, string>> = links.icons;
// variants 是可选组：清单生成器只写有备用模型的图标，缺这个键时按「没有备用」读，不让整张表读不出来。
const variantsByIcon: Readonly<Record<string, readonly string[]>> =
  (links as { variants?: Readonly<Record<string, readonly string[]>> }).variants ?? {};
const byPackTemplate: Readonly<Record<string, string>> = links.packs;
const models: Readonly<Record<string, IconModelSize>> = links.models;

export function iconModelSlugs(slug: string, kind: string): readonly string[] {
  if ((kind !== 'icon' && kind !== 'scale') || !Object.hasOwn(byIcon, slug)) return [];
  const variants = Object.hasOwn(variantsByIcon, slug) ? variantsByIcon[slug] : [];
  return [byIcon[slug], ...variants];
}

export function packModelSlugs(templateId: string): readonly string[] {
  return Object.hasOwn(byPackTemplate, templateId) ? iconModelSlugs(byPackTemplate[templateId], 'icon') : [];
}

export function isLinkedIconModel(modelSlug: string): boolean {
  return Object.hasOwn(models, modelSlug);
}

export function packagedIconModel(slug: string): FacilityModelCandidate | null {
  if (!isLinkedIconModel(slug)) return null;
  return {
    ...models[slug],
    slug,
    glbUrl: `/showcase/assets/library/model/${slug}.glb`,
    thumb: `/showcase/assets/library/thumb/${slug}.webp`,
  };
}
