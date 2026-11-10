import { isRoundTable, roundTableDiameter } from '../../lib/table-shape';
import { type BuilderContext, material, mesh, cornerPositions, lightenHex } from '../builder-utils';
import type * as ThreeNS from 'three';

const BANQUET_CLOTH = '#F3EFE4';

function parseHex(color: string): [number, number, number] {
  const normalized = color.trim().replace('#', '');
  const hex = normalized.length === 3
    ? normalized.split('').map(channel => channel + channel).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return [0xa0, 0x52, 0x2d];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Radial grain baked into a data texture. No canvas, so node tests can build the mesh. */
function banquetWoodMap(THREE: BuilderContext['THREE'], color: string): ThreeNS.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const [r, g, b] = parseHex(color);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1) - 0.5;
      const v = y / (size - 1) - 0.5;
      const dist = Math.hypot(u, v) * 2;
      const angle = Math.atan2(v, u);
      const ring = Math.sin(dist * 26 + Math.sin(angle * 4) * 0.35);
      const streak = Math.sin(angle * 9 + dist * 4) * 0.04;
      const shade = 0.82 + ring * 0.14 + streak;
      const index = (y * size + x) * 4;
      data[index] = Math.max(0, Math.min(255, Math.round(r * shade)));
      data[index + 1] = Math.max(0, Math.min(255, Math.round(g * shade)));
      data[index + 2] = Math.max(0, Math.min(255, Math.round(b * shade)));
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural banquet round table. The asset library has no round-table GLB
 * (catalogue names are rectangular dining sets), so the top is a cylinder
 * whose diameter is the collision square. A linen disc sits inside a wood rim.
 */
function buildRoundBanquetTable({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const diameter = roundTableDiameter(item);
  const radius = diameter / 2;
  const clothH = item.height * 0.02;
  const topH = item.height * 0.07;
  const baseH = item.height * 0.06;
  const pedestalH = item.height - clothH - topH - baseH;
  const wood = typeof item.color === 'string' ? item.color : '#A0522D';
  const woodMap = banquetWoodMap(THREE, wood);
  const topMat = new THREE.MeshStandardMaterial({
    color: hasCollision ? baseColor : 0xffffff,
    map: woodMap,
    roughness: 0.62,
    metalness: 0.04,
    transparent: hasCollision,
    opacity,
  });
  const top = mesh(THREE, new THREE.CylinderGeometry(radius, radius, topH, 48), topMat);
  top.position.y = item.height - clothH - topH / 2;
  top.userData.part = 'round-top';
  group.add(top);

  const cloth = mesh(
    THREE,
    new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, clothH, 48),
    material(THREE, hasCollision ? baseColor : BANQUET_CLOTH, hasCollision, opacity, { roughness: 0.94, metalness: 0 }),
  );
  cloth.position.y = item.height - clothH / 2;
  cloth.userData.part = 'banquet-cloth';
  group.add(cloth);

  const pedestalMat = material(THREE, hasCollision ? baseColor : lightenHex(wood, -0.28), hasCollision, opacity, { roughness: 0.7, metalness: 0.05 });
  const foot = mesh(THREE, new THREE.CylinderGeometry(radius * 0.28, radius * 0.32, baseH, 24), pedestalMat);
  foot.position.y = baseH / 2;
  foot.userData.part = 'table-foot';
  group.add(foot);
  const column = mesh(THREE, new THREE.CylinderGeometry(radius * 0.09, radius * 0.11, pedestalH, 20), pedestalMat);
  column.position.y = baseH + pedestalH / 2;
  column.userData.part = 'table-pedestal';
  group.add(column);

  group.userData.tableShape = 'round';
  return group;
}

export function buildTableOrDesk(ctx: BuilderContext): ThreeNS.Group {
  if (isRoundTable(ctx.item)) return buildRoundBanquetTable(ctx);
  const { THREE, item, hasCollision, baseColor, opacity } = ctx;
  const group = new THREE.Group();
  const woodMat = material(THREE, baseColor, hasCollision, opacity, { roughness: 0.6, metalness: 0.1 });

  const top = mesh(THREE, new THREE.BoxGeometry(item.width, item.height * 0.1, item.depth), woodMat);
  top.position.y = item.height * 0.95;
  group.add(top);

  const legGeo = new THREE.BoxGeometry(item.width * 0.08, item.height * 0.9, item.depth * 0.08);
  for (const [x, y, z] of cornerPositions(item.width * 0.4, item.height * 0.45, item.depth * 0.4)) {
    const leg = mesh(THREE, legGeo, woodMat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  if (item.type === 'desk') {
    const drawer = mesh(
      THREE,
      new THREE.BoxGeometry(item.width * 0.4, item.height * 0.15, item.depth * 0.8),
      woodMat
    );
    drawer.position.set(item.width * 0.25, item.height * 0.7, 0);
    group.add(drawer);

    const handle = mesh(
      THREE,
      new THREE.CylinderGeometry(0.02, 0.02, item.width * 0.1, 8),
      material(THREE, 0x444444, hasCollision, opacity, { metalness: 0.8, roughness: 0.2 })
    );
    handle.position.set(item.width * 0.25, item.height * 0.7, item.depth * 0.42);
    handle.rotation.z = Math.PI / 2;
    group.add(handle);
  }

  return group;
}
