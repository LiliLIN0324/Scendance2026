import { describe, expect, it } from 'vitest';
import { planPointToRoam, planPointToScene, scenePointToPlan } from './plan-scene-frame';

const FRAME = { cx: 8, cy: 6 };

describe('规划坐标 → 场景坐标', () => {
  it('以边界中心为原点，北向翻成 -z', () => {
    expect(planPointToScene({ x: 8, y: 6 }, FRAME)).toEqual({ x: 0, z: 0 });
    expect(planPointToScene({ x: 4, y: 8 }, FRAME)).toEqual({ x: -4, z: -2 });
    expect(planPointToScene({ x: 16, y: 0 }, FRAME)).toEqual({ x: 8, z: 6 });
  });

  it('往返可逆，不丢精度', () => {
    const scene = planPointToScene({ x: 3.25, y: 11.5 }, FRAME);
    expect(scenePointToPlan(scene, FRAME)).toEqual({ x: 3.25, y: 11.5 });
  });

  it('执行器口径：y 分量就是场景 z', () => {
    expect(planPointToRoam({ x: 5, y: 5 }, FRAME)).toEqual({ x: -3, y: 1 });
  });

  it('旧口径（绝对 ENU）会偏一个中心，这组用例就是防回退', () => {
    const scene = planPointToScene({ x: 4, y: 8 }, FRAME);
    // 绝对 ENU 会得到 (4, -8)；差了 (8, 6) 的场地中心。
    expect(scene).not.toEqual({ x: 4, z: -8 });
  });
});
