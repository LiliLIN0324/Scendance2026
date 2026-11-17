/**
 * 3D 保活隐藏（2D 地图态）时的人物推进节拍（B3 补丁）。
 *
 * 户外 3D 组件切回 2D 时**不卸载**，只把 `active` 置 false：渲染循环仍在跑，但每 6 帧
 * 才做一次瓦片 LOD，其余帧直接 return。人物要在这段时间里继续走，否则 2D 人位的
 * 「已进区 / 已落座」状态环会定格在切走那一刻。
 *
 * 为什么不能每帧直接调 `advancePeopleAnimations(dt)`：
 * 隐藏态一帧 dt 只有 16 ms 左右，而循环每 6 帧才往下走一次——按帧推进只有真实速度的
 * 1/6，人看起来在爬。所以这里累计**每一帧**的真实耗时，攒够一个节拍再一次性交出去，
 * 走出来的距离与 3D 态一致，只是采样稀（默认 0.25 s ≈ 4 Hz）。
 *
 * `maxStepSeconds` 是防跳变闸：切标签页回来时累计值可能偏大，宁可少补一点也不要让人
 * 一步穿过障碍。
 */
export interface CrowdIdlePacer {
  /** 每帧调用：累计真实耗时。 */
  tick(deltaSeconds: number): void;
  /** 到了节拍就取走累计值（秒）；没到返回 null，调用方照常早退。 */
  take(): number | null;
  /** 回到活跃态：清掉未用的累计，切回 3D 时不补一大步。 */
  reset(): void;
}

export function createCrowdIdlePacer(stepSeconds: number, maxStepSeconds = 0.5): CrowdIdlePacer {
  const step = Math.max(0.05, stepSeconds);
  const cap = Math.max(step, maxStepSeconds);
  let pending = 0;
  return {
    tick(deltaSeconds: number): void {
      if (deltaSeconds > 0) pending += deltaSeconds;
    },
    take(): number | null {
      if (pending < step) return null;
      const value = Math.min(pending, cap);
      pending = 0;
      return value;
    },
    reset(): void {
      pending = 0;
    },
  };
}
