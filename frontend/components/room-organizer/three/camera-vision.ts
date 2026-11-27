import type { FurnitureItem } from '../lib/types';

/**
 * Height (metres) at which the legacy security-camera body sits above the
 * floor on a classic storey. The vision-cone overlay was retired in 2c
 * (D4: 户外目录不再保留摄像头 / 视锥类目); this mount-height helper is still
 * read by the legacy camera mesh builder and its wall-mount height test.
 */
export const CAMERA_MOUNT_HEIGHT = 2.3;
/** The camera head sits this far below the top of its mount run (the item's height). */
const CAMERA_HEAD_CLEARANCE = 0.1;

/**
 * Where a camera's body actually mounts: the default height, or lower under
 * a low ceiling (#277). The catalog height doubles as the wall-mount run and
 * the furniture effect fits it to the storey, so a flush camera on a 1.1 m
 * loft no longer hangs 1.2 m above its ceiling.
 */
export function cameraMountHeight(item: Pick<FurnitureItem, 'height'>): number {
  return Math.max(CAMERA_HEAD_CLEARANCE, Math.min(CAMERA_MOUNT_HEIGHT, item.height - CAMERA_HEAD_CLEARANCE));
}
