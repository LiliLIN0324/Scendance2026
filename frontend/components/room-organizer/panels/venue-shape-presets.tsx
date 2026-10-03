'use client';

import { backendSceneToLayout } from '../lib/backend-adapter';
import type { RoomLayout } from '../lib/types';

const SHAPES = {
  rectangle: { name: '长方形', width: 12, depth: 8, path: 'M4 8H44V34H4Z' },
  square: { name: '正方形', width: 10, depth: 10, path: 'M8 4H40V36H8Z' },
  l: { name: 'L 形', width: 12, depth: 10, path: 'M4 4H24V20H44V36H4Z' },
} as const;

export function createVenueShape(base: RoomLayout, key: keyof typeof SHAPES): RoomLayout {
  const { width, depth } = SHAPES[key];
  const polygon = key === 'l'
    ? [{ x: 0, z: 0 }, { x: width / 2, z: 0 }, { x: width / 2, z: depth / 2 }, { x: width, z: depth / 2 }, { x: width, z: depth }, { x: 0, z: depth }]
    : [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
  return backendSceneToLayout({ schemaVersion: 2,
    venue: { width, depth, height: 3, shape: key === 'l' ? 'polygon' : 'rectangle', ...(key === 'l' ? { polygon } : {}), entrances: [] },
    structure: { walls: polygon.map((start, i) => ({ id: crypto.randomUUID(), start, end: polygon[(i + 1) % polygon.length],
      thickness: 0.16, height: 3, kind: 'exterior', status: 'inferred' })), openings: [], columns: [] },
    objects: [], sources: [], dimensions: [], camera: 'overview', lighting: base.backendLighting ?? 'warm',
  }, { name: base.name, ...(base.id ? { projectId: base.id } : {}) });
}

export function VenueShapePresets({ layout, onApply }: { layout: RoomLayout; onApply(layout: RoomLayout): void }): JSX.Element {
  return <section className="sc-shape-presets" aria-label="预设场地形状">
    <p className="sc-note">选择空白场地形状开始布置。预设尺寸为示意，可在下方按实测尺寸核对。</p>
    <div>{(Object.keys(SHAPES) as (keyof typeof SHAPES)[]).map(key => <button type="button" key={key} onClick={() => {
      if (!window.confirm('切换场地形状将清空当前布置，可用撤销恢复。继续吗？')) return;
      onApply(createVenueShape(layout, key));
    }}><svg viewBox="0 0 48 40" aria-hidden="true"><path d={SHAPES[key].path}/></svg><strong>{SHAPES[key].name}</strong><small>{SHAPES[key].width} × {SHAPES[key].depth} m</small></button>)}</div>
  </section>;
}
