import { canonical } from '../../../../supabase/functions/_shared/domain';
import { productionObjectBasis } from '../../../lib/production-plan';
import { layoutToBackendScene } from './backend-adapter';
import type { RoomLayout } from './types';
import type { Handoff } from '../../../../supabase/functions/_shared/delivery-contract';

export const HANDOFF_STATUS_LABELS: Record<Handoff['status'] | 'needs_review', string> = {
  todo: '未开始', doing: '进行中', review: '待验收', accepted: '已验收', needs_review: '需复核',
};

export function blankHandoff(): Handoff {
  return { ownerName: '', dueDate: '', acceptance: '', status: 'todo', evidenceUrls: [], evidenceNote: '' };
}

/** Stable local review basis, independent of expiring asset loading URLs. */
export async function handoffBasis(layout: RoomLayout, itemId: string, acceptance: string): Promise<string> {
  const floor = layout.floors.find(entry => entry.items.some(item => item.id === itemId));
  const item = floor?.items.find(entry => entry.id === itemId);
  if (!floor || !item) throw new Error('物件已被移除，请重新打开工作单。');
  const scene = layoutToBackendScene(layout);
  const object = scene.objects.find(entry => entry.id === itemId);
  const production = productionObjectBasis(layout.productionPlan, itemId);
  const basis = canonical({
    ...(production ? { production } : {}),
    itemId, type: item.type, materialId: object?.materialId ?? null, assetId: object?.assetId ?? null,
    floorId: floor.id, venue: scene.venue, structure: scene.schemaVersion === 2 ? scene.structure : null,
    size: [item.width, item.depth, item.height], color: item.color,
    position: item.position ?? null, rotation: item.rotation ?? 0, elevation: item.elevation ?? 0,
    mirrored: item.mirrored ?? false, acceptance: acceptance.trim(),
  });
  if (!globalThis.crypto?.subtle) throw new Error('请使用安全连接或本机浏览器核对工作单。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function effectiveHandoffStatus(layout: RoomLayout, itemId: string): Promise<Handoff['status'] | 'needs_review'> {
  const handoff = layout.floors.flatMap(floor => floor.items).find(item => item.id === itemId)?.handoff;
  if (!handoff) return 'todo';
  if ((handoff.status === 'review' || handoff.status === 'accepted') &&
      handoff.reviewedBasis !== await handoffBasis(layout, itemId, handoff.acceptance)) return 'needs_review';
  return handoff.status;
}
