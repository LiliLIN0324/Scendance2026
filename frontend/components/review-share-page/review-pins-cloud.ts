/**
 * G4：评审钉的跨设备读写（Supabase RPC）。
 *
 * 链接仍自带方案快照；这里只按分享版本键（review-v2:<sha256>）存取钉。
 * 未配置公开 Supabase 配置时返回 disabled，调用方继续走本机 localStorage。
 */

import { getBackendConfig } from '@/lib/backend-session';
import type { ReviewPin } from '../room-organizer/lib/review-pins';

export type ReviewPinWithFloor = ReviewPin & {
  floorId?: string | undefined;
  author?: string | undefined;
  createdAt?: string | undefined;
};

type CloudPinRow = {
  id: string;
  share_key: string;
  floor_id: string;
  body: string;
  item_id: string | null;
  x: number;
  y: number;
  z: number;
  pin_offset: readonly [number, number, number] | null;
  camera: ReviewPin['camera'];
  status: ReviewPin['status'];
  author: string | null;
  created_at: string;
};

type CloudResult<T> = { ok: true; value: T } | { ok: false; reason: 'disabled' | 'network' | 'bad-response' };

function publicConfig(): { url: string; anonKey: string } | null {
  const config = getBackendConfig();
  if (config.error || !config.url || !config.anonKey) return null;
  return { url: config.url, anonKey: config.anonKey };
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<CloudResult<T>> {
  const config = publicConfig();
  if (!config) return { ok: false, reason: 'disabled' };
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, reason: 'bad-response' };
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

function toPin(row: CloudPinRow): ReviewPinWithFloor {
  return {
    id: row.id,
    text: row.body,
    itemId: row.item_id,
    x: row.x,
    y: row.y,
    z: row.z,
    offset: row.pin_offset,
    camera: row.camera,
    status: row.status,
    floorId: row.floor_id,
    author: row.author ?? undefined,
    createdAt: row.created_at,
  };
}

export async function listReviewPinsCloud(shareKey: string): Promise<CloudResult<ReviewPinWithFloor[]>> {
  if (!shareKey) return { ok: false, reason: 'disabled' };
  const result = await rpc<CloudPinRow[]>('review_pins_list', { p_share_key: shareKey });
  if (!result.ok) return result;
  if (!Array.isArray(result.value)) return { ok: false, reason: 'bad-response' };
  return { ok: true, value: result.value.map(toPin) };
}

export async function appendReviewPinCloud(input: {
  shareKey: string;
  pin: ReviewPin;
  floorId: string;
  author?: string;
}): Promise<CloudResult<CloudPinRow>> {
  return rpc<CloudPinRow>('review_pins_append', {
    p_share_key: input.shareKey,
    p_id: input.pin.id,
    p_floor_id: input.floorId,
    p_body: input.pin.text,
    p_item_id: input.pin.itemId,
    p_x: input.pin.x,
    p_y: input.pin.y,
    p_z: input.pin.z,
    p_offset: input.pin.offset,
    p_camera: input.pin.camera,
    p_author: input.author ?? null,
  });
}
