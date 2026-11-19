import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** Draft design parameters, not a building-code or egress certification. */
export const WEDDING_DEFAULTS = {
  guests: 60, seatsPerTable: 10, aisleM: 2.5, serviceAisleM: 1.5,
  rowClearanceM: 0.65, chairGapM: 0.3, photographerM: 2,
  tableDiameterM: 1.8,
} as const;

/** Paired seating blocks share a focal point and leave the processional axis clear. */
export function ceremonySeats(input: {
  focus: PlanPoint; count: number; width: number; depth: number; columns: number;
}): Array<{ position: PlanPoint; rotationDeg: number }> {
  const { focus, width, depth, columns } = input;
  return Array.from({ length: input.count }, (_, index) => {
    const row = Math.floor(index / (columns * 2));
    const side = index % 2 ? 1 : -1;
    const column = Math.floor(index / 2) % columns;
    const x = focus.x + side * (WEDDING_DEFAULTS.aisleM / 2 + 0.6 + Math.hypot(width,depth) / 2 + column * (Math.hypot(width,depth) + WEDDING_DEFAULTS.chairGapM));
    const y = focus.y - WEDDING_DEFAULTS.photographerM - 1 - depth / 2 - row * (depth + WEDDING_DEFAULTS.rowClearanceM);
    // Chair forward is local +y; turn each seat toward the ceremony centre.
    return { position: { x, y }, rotationDeg: -Math.atan2(focus.x - x, focus.y - y) * 180 / Math.PI };
  });
}

/** Tables are social groups; stagger groups around a shared aisle, keeping full service envelopes. */
export function banquetCenters(box: { w: number; e: number; s: number; n: number }, envelope: number): PlanPoint[] {
  const cx = (box.w + box.e) / 2, pitch = envelope * 2 + WEDDING_DEFAULTS.serviceAisleM;
  const points: PlanPoint[] = [];
  for (let row = 0; row < 40; row++) {
    const y = box.s + envelope + 0.6 + row * pitch;
    if (y + envelope > box.n) break;
    for (let group = 0; group < 40; group++) {
      const offset = WEDDING_DEFAULTS.aisleM / 2 + 0.5 + envelope + group * pitch;
      if (cx + offset - envelope > box.e && cx - offset + envelope < box.w) break;
      for (const side of [-1, 1]) {
        const point = { x: cx + side * offset, y: y + (group % 2) * pitch / 2 };
        if (point.x - envelope >= box.w && point.x + envelope <= box.e && point.y + envelope <= box.n) points.push(point);
      }
    }
  }
  return points;
}
