/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneGeoDots, type SceneGeoDotMark } from './scene-geo-dots';
import type * as React from 'react';

/** 一颗锚点投到世界原点的场地点位。 */
const dot: SceneGeoDotMark = { id: 'venue-a', name: '茶亭样例', x: 0, z: 0 };

type ChangeControls = { addEventListener(type: 'change', listener: () => void): void; removeEventListener(type: 'change', listener: () => void): void };

/** 可手动触发 change 的假 OrbitControls。 */
function fakeControls(): ChangeControls & { emit(): void } {
  const listeners = new Set<() => void>();
  return {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    emit: () => listeners.forEach(listener => listener()),
  };
}

function mount(props: {
  controlsRef: React.RefObject<ChangeControls | null>;
  toScreen?: (point: { x: number; y: number; z: number }) => { x: number; y: number } | null;
  dots?: readonly SceneGeoDotMark[];
}) {
  const toScreen = props.toScreen ?? (() => ({ x: 120, y: 80 }));
  return render(
    <SceneGeoDots
      dots={props.dots ?? [dot]}
      focusedId={null}
      toScreen={toScreen}
      controlsRef={props.controlsRef}
      cameraReady
      onPick={() => undefined}
    />,
  );
}

afterEach(cleanup);

describe('SceneGeoDots 点位层挂载（MAP-03）', () => {
  it('控件晚于相机就绪时自动重试绑定，点位不停在空列表（走查实测的竞态）', async () => {
    const controlsRef = { current: null as ChangeControls | null };
    mount({ controlsRef });
    // 控件还没建好：先没有按钮，重试定时器在跑
    expect(screen.queryByTestId('scene-geo-dots')).not.toBeNull(); // dots 非空 → 容器在
    expect(screen.queryByTestId('scene-geo-dot-venue-a')).toBeNull();
    // 120ms 后控件就位 → 重挂监听 → update 立即投放
    const controls = fakeControls();
    controlsRef.current = controls;
    await waitFor(() => expect(screen.queryByTestId('scene-geo-dot-venue-a')).not.toBeNull(), { timeout: 1500 });
    expect(screen.getByTestId('scene-geo-dot-venue-a').textContent).toContain('茶亭样例');
  });

  it('监听绑上后随 controls change 重投影（相机动了点位跟着走）', async () => {
    const controls = fakeControls();
    const controlsRef = { current: controls as ChangeControls | null };
    let screenPoint = { x: 100, y: 60 };
    mount({ controlsRef, toScreen: () => screenPoint });
    await waitFor(() => expect(screen.queryByTestId('scene-geo-dot-venue-a')).not.toBeNull());
    const before = (screen.getByTestId('scene-geo-dot-venue-a').getAttribute('style') || '').match(/left:\s*(\d+(?:\.\d+)?)px/)?.[1];
    screenPoint = { x: 300, y: 90 };
    controls.emit();
    // setPlaced 走 React 批处理，DOM 要到下一次提交才更新
    await waitFor(() => {
      const after = (screen.getByTestId('scene-geo-dot-venue-a').getAttribute('style') || '').match(/left:\s*(\d+(?:\.\d+)?)px/)?.[1];
      expect(after).toBe('300');
    });
    expect(before).toBe('100');
  });

  it('投影在视锥外（toScreen 为 null）的点位不渲染按钮', async () => {
    const controls = fakeControls();
    const controlsRef = { current: controls as ChangeControls | null };
    mount({ controlsRef, toScreen: () => null });
    await waitFor(() => expect(screen.queryByTestId('scene-geo-dots')).not.toBeNull());
    // change 来了也还是 null → 不出按钮
    controls.emit();
    expect(screen.queryByTestId('scene-geo-dot-venue-a')).toBeNull();
  });

  it('没有点位时不渲染容器', () => {
    const controlsRef = { current: fakeControls() as ChangeControls | null };
    mount({ controlsRef, dots: [] });
    expect(screen.queryByTestId('scene-geo-dots')).toBeNull();
  });
});
