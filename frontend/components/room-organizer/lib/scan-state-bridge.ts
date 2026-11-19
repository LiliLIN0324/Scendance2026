import type { SplatScanState } from '../components/outdoor-plan-3d';
import type { SplatPosition } from '../three/splat-preview';

/**
 * 室内点云管线拆除后的测试接缝（2026-11-19，B 方案）。
 *
 * 生产环境里扫描状态只由 OutdoorPlan3D 的 `onScanState` 上报，位置写回只由画布上的
 * 数值控件 / 落点触发；jsdom 里没有 WebGL 与 three 场景，两条入口都够不到。
 * 这里把「上报入口」和「写回入口」暴露成一个空壳对象，组件挂载时接上、卸载时摘掉。
 * 除测试外没有别处读取它。
 */
export const scanStateBridge: {
  pushScanState(state: SplatScanState): void;
  writePosition: ((position: SplatPosition) => void) | null;
} = {
  pushScanState: () => {},
  writePosition: null,
};
