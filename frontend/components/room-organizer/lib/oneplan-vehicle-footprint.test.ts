import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { facilityFootprint } from './plan-footprint-geometry';
import { libraryFootprint } from './oneplan-library-size';
import { PLAN_VEHICLE_SLUGS } from './oneplan-catalog';
import { CURATED_MANIFEST_ASSETS } from './oneplan-library';

interface ManifestAsset {
  slug: string;
  kind: string;
  name_zh: string;
  category_zh: string;
  viewBox?: string;
}

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'public/oneplan-icons/manifest.json'), 'utf8'),
) as { assets: ManifestAsset[] };

/** 抓取包 + 本地补的车型素材（清扫车 / 自行车）。 */
const allAssets = [...manifest.assets, ...CURATED_MANIFEST_ASSETS] as ManifestAsset[];

/** 库里这台车的登记信息：取 scale 版优先，没有就用 icon 版（出租车只有 icon）。 */
function manifestOf(slug: string): ManifestAsset | undefined {
  const all = allAssets.filter(a => a.slug === slug);
  return all.find(a => a.kind === 'scale-fg') ?? all.find(a => a.kind === 'scale-bg') ?? all[0];
}

/** 库条目拿到的默认占地（2D 画布和 3D 落位共用这一份）。 */
function footprintOf(slug: string) {
  const asset = manifestOf(slug)!;
  return libraryFootprint({
    slug: asset.slug,
    kind: asset.kind === 'icon' ? 'icon' : 'scale',
    categoryZh: asset.category_zh,
    ...(asset.viewBox ? { viewBox: asset.viewBox } : {}),
  });
}

const FRAME = {
  width: 100,
  depth: 100,
  scaleX: 1,
  scaleZ: 1,
  clampPoints: false,
  toShell: (p: { x: number; y: number }) => ({ x: p.x, z: p.y }),
};

/** three 的 R_y(φ)：本地 (x,z) → 世界 (x·cosφ + z·sinφ, −x·sinφ + z·cosφ)，与 3D 落位同一式。 */
function threeBoxCorners(
  center: { x: number; z: number },
  size: { width: number; depth: number },
  rotationDeg: number,
) {
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const hw = size.width / 2;
  const hd = size.depth / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([dx, dz]) => ({ x: center.x + dx! * cos + dz! * sin, z: center.z - dx! * sin + dz! * cos }));
}

describe('2D 占地 vs 3D 落位：尺寸与旋转必须同一套（2026-11-16）', () => {
  it('车组每台车都有真车比例，不再是 1.5×1.5 的正方形', () => {
    const expected: Record<string, [number, number]> = {
      bus: [12, 2.5],
      coach: [12, 2.5],
      hgv: [12, 2.5],
      van: [5.4, 2],
      'pickup-truck': [5.5, 2],
      ambulance: [5.5, 2],
      forklift: [3.2, 1.4],
      'food-trailer': [6, 2.5],
      'enclosed-trailer': [6, 2.5],
      'toilet-trailer': [6, 2.5],
      'fire-engine': [8, 2.6],
      'police-car': [4.5, 1.8],
      taxi: [4.5, 1.8],
      car: [4.5, 1.8],
      caravan: [6, 2.2],
      'golf-cart': [2.7, 1.2],
      motorcycle: [2.2, 0.8],
      sweeper: [4, 2],
      bicycle: [1.8, 0.6],
    };
    for (const { slug } of PLAN_VEHICLE_SLUGS) {
      const want = expected[slug];
      expect(want, `车组多了没登记尺寸的 slug：${slug}`).toBeTruthy();
      const got = footprintOf(slug);
      expect({ slug, ...got }).toEqual({ slug, width: want![0], depth: want![1] });
    }
  });

  it('车组素材一律横版（竖版已就地烘成横版，运行期不再靠转 90° 兜底）', () => {
    const iconDir = path.resolve(process.cwd(), 'public/oneplan-icons');
    const viewBoxOf = (file: string): [number, number] => {
      const vb = /viewBox="([^"]+)"/.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? '';
      const [w, h] = vb.split(/[\s,]+/).map(Number).slice(2);
      return [w!, h!];
    };
    for (const { slug } of PLAN_VEHICLE_SLUGS) {
      const scale = path.join(iconDir, 'scale-fg', `${slug}.svg`);
      const icon = path.join(iconDir, 'icon', `${slug}.svg`);
      const file = fs.existsSync(scale) ? scale : icon;
      expect(fs.existsSync(file), `${slug} 找不到素材`).toBe(true);
      const [w, h] = viewBoxOf(file);
      expect({ slug, landscape: w >= h }, `${slug} 素材还是竖版：${w}×${h}`).toEqual({ slug, landscape: true });
    }
  });

  it('出租车有了平面比例图（原来只有 24×24 的字形，放到 4.5×1.8 m 就糊）', () => {
    const iconDir = path.resolve(process.cwd(), 'public/oneplan-icons');
    expect(fs.existsSync(path.join(iconDir, 'scale-fg', 'taxi.svg'))).toBe(true);
    expect(fs.existsSync(path.join(iconDir, 'scale-bg', 'taxi.svg'))).toBe(true);
    const curated = CURATED_MANIFEST_ASSETS.filter(a => a.slug === 'taxi');
    expect(curated.map(a => a.kind).sort()).toEqual(['scale-bg', 'scale-fg']);
  });

  it('车组里没有 1.5×1.5 这种正方形占地', () => {
    for (const { slug } of PLAN_VEHICLE_SLUGS) {
      const { width, depth } = footprintOf(slug);
      expect(Math.abs(width - depth), `${slug} 被当成正方形了`).toBeGreaterThan(0.3);
    }
  });

  it('2D 四角与 three 的 R_y(φ) 完全重合（0° / 30° / 90° / 135° / 180°）', () => {
    const size = { width: 12, depth: 2.5 };
    for (const deg of [0, 30, 90, 135, 180, 270, -45]) {
      const facility = {
        position: { x: 40, y: 60 },
        rotationDeg: deg,
        size,
      };
      const corners2d = facilityFootprint(facility, FRAME);
      const center = FRAME.toShell(facility.position);
      const corners3d = threeBoxCorners(center, size, deg);
      corners2d.forEach((corner, index) => {
        expect(corner.x).toBeCloseTo(corners3d[index]!.x, 9);
        expect(corner.z).toBeCloseTo(corners3d[index]!.z, 9);
      });
    }
  });

  it('转 90° 后占地宽深互换、转 180° 与 0° 重合（旋转语义没被写反）', () => {
    const facility = { position: { x: 0, y: 0 }, rotationDeg: 0, size: { width: 12, depth: 2.5 } };
    const extent = (deg: number) => {
      const corners = facilityFootprint({ ...facility, rotationDeg: deg }, FRAME);
      const xs = corners.map(c => c.x);
      const zs = corners.map(c => c.z);
      return {
        width: Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000,
        depth: Math.round((Math.max(...zs) - Math.min(...zs)) * 1000) / 1000,
      };
    };
    expect(extent(0)).toEqual({ width: 12, depth: 2.5 });
    expect(extent(90)).toEqual({ width: 2.5, depth: 12 });
    expect(extent(180)).toEqual({ width: 12, depth: 2.5 });
  });
});
