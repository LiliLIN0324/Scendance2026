'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  addFloorPlanRepaintHandler,
  canvasToWorld,
  get2DViewTransform,
  render2DTopDown,
} from '../room-organizer/canvas-2d/render';
import { HIT_SLOP_PX, hitTest2DItems } from '../room-organizer/hooks/use-canvas-2d-interaction';
import { floorKeepOut } from '../room-organizer/lib/floor-keep-out';
import { hasCollisions } from '../room-organizer/lib/geometry';
import { planFloorIndex } from '../room-organizer/lib/street';
import { floorElevation } from '../room-organizer/lib/storeys';
import {
  pinAnchor,
  pinSubject,
  planPointToCanvas,
  type ReviewPin,
  type ReviewPinDraft,
} from '../room-organizer/lib/review-pins';
import { ReviewPinLayer, type ReviewPinMark } from '../room-organizer/panels/review-pin-layer';
import '../room-organizer/panels/review-pin-layer.css';
import { dragThresholdPx } from '../room-organizer/three/drag-handlers';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../room-organizer/lib/types';

export function ReviewPlanSheet({
  layout,
  floor,
  floorIndex,
  pins,
  activePinId,
  pinDraft,
  onAnchor,
  onFocusPin,
  onCommitPin,
  onCancelPin,
}: {
  layout: RoomLayout;
  floor: FloorLayout;
  floorIndex: number;
  pins: readonly ReviewPin[];
  activePinId: string | null;
  pinDraft: ReviewPinDraft | null;
  onAnchor(anchor: { itemId: string | null; x: number; z: number }): void;
  onFocusPin(id: string): void;
  onCommitPin(text: string): void;
  onCancelPin(): void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<{ addEventListener(): void; removeEventListener(): void } | null>(null);
  const floorY = floorElevation(layout.floors, floorIndex);

  const itemOrigin = useCallback((itemId: string | null) => {
    if (!itemId) return null;
    const item = floor.items.find((entry) => entry.id === itemId);
    return item?.position ? { x: item.position.x, y: floorY, z: item.position.z } : null;
  }, [floor.items, floorY]);

  const reviewMarks = useMemo<ReviewPinMark[]>(() => pins.map((pin, index) => {
    const point = pinAnchor(pin, itemOrigin(pin.itemId));
    return { id: pin.id, n: index + 1, status: pin.status, x: point.x, y: point.y, z: point.z };
  }), [pins, itemOrigin]);

  const toScreen = useCallback((point: { x: number; y: number; z: number }) => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return null;
    return planPointToCanvas(point, layout, get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout));
  }, [layout]);

  const draftLabel = pinDraft
    ? (pinDraft.itemId ? pinSubject(pinDraft.itemId, floor.items) : '地面')
    : '';

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    const paint = (): void => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const keepOut = floorKeepOut(layout, planFloorIndex(layout.floors, floor));
      render2DTopDown({
        canvas,
        layout,
        floor,
        selectedItemId: null,
        showMeasurements: false,
        showWiFiSignals: false,
        showHeatmap: false,
        showFloorPlan: Boolean(layout.floorPlanImage && planFloorIndex(layout.floors, floor) === 0),
        hasCollision: (item) =>
          hasCollisions(item, floor.items, layout.width, layout.height, { keepOut, interiorWalls: floor.interiorWalls }),
      });
    };

    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(host);
    const offRepaint = addFloorPlanRepaintHandler(paint);
    return () => {
      observer.disconnect();
      offRepaint();
    };
  }, [layout, floor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let reviewPress: {
      pointerId: number;
      downClientX: number;
      downClientY: number;
      threshold: number;
      itemId: string | null;
      x: number;
      z: number;
    } | null = null;

    const clientToWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const transform = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout);
      return canvasToWorld(clientX - rect.left, clientY - rect.top, transform, layout);
    };

    const hitSlopWorld = (): number => {
      const { scale } = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout);
      return HIT_SLOP_PX / scale;
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || reviewPress) return;
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const hit = hitTest2DItems(floor.items, world.x, world.z, hitSlopWorld());
      reviewPress = {
        pointerId: event.pointerId,
        downClientX: event.clientX,
        downClientY: event.clientY,
        threshold: dragThresholdPx(event.pointerType),
        itemId: hit?.id ?? null,
        x: world.x,
        z: world.z,
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!reviewPress || event.pointerId !== reviewPress.pointerId) return;
      const dx = event.clientX - reviewPress.downClientX;
      const dy = event.clientY - reviewPress.downClientY;
      if (dx * dx + dy * dy >= reviewPress.threshold * reviewPress.threshold) reviewPress = null;
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (!reviewPress || event.pointerId !== reviewPress.pointerId) return;
      const press = reviewPress;
      reviewPress = null;
      onAnchor({ itemId: press.itemId, x: press.x, z: press.z });
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [floor.items, layout, onAnchor]);

  return (
    <div className="rsp-plan-stage" ref={hostRef}>
      <canvas ref={canvasRef} aria-label={`${layout.name}，${floor.name}平面预览`} role="img" />
      <ReviewPinLayer
        pins={reviewMarks}
        activeId={activePinId}
        draft={pinDraft ? { x: pinDraft.x, y: pinDraft.y, z: pinDraft.z } : null}
        draftLabel={draftLabel}
        toScreen={toScreen}
        controlsRef={controlsRef}
        cameraReady
        onFocus={onFocusPin}
        onCommit={onCommitPin}
        onCancel={onCancelPin}
      />
    </div>
  );
}

export function itemNames(items: readonly FurnitureItem[]): { id: string; name: string }[] {
  return items.map((item) => ({ id: item.id, name: item.name.trim() || '未命名物件' }));
}
