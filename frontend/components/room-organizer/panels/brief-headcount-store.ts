'use client';

/**
 * 左栏「活动需求」人数的跨层镜像。
 *
 * 为什么要有这一层：需求人数（CreativeBrief.guests）的真值在 CreativeStudioProvider
 * 的 context 里，而 2D 方案打分（generateScoredPlans 的 targetCapacity）发生在
 * room-organizer 本体——它渲染 provider，但自己不在 provider 树内，读不到 context。
 * 所以在 setBrief 落值时同步一份模块级镜像（与 agent-chat-store 同款模式），
 * 让打分层同步拿到「用户说过要多少人」，B4 超容量话术才会在方案卡上出现。
 *
 * 只镜像 guests 一个字段；写入方是 creative-studio.tsx 的 brief 副作用，
 * 且只在「用户真的表达过人数」时写（脚手架默认 24 不算数，否则小场地会
 * 假触发「装不下 24 人」）。
 */

let headcount: number | null = null;

/** 覆盖镜像值；null 表示当前没有可信的需求人数。 */
export function setBriefHeadcount(value: number | null): void {
  headcount = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** 读当前镜像值；没有时返回 null（打分层就不传 targetCapacity，行为同旧版）。 */
export function getBriefHeadcount(): number | null {
  return headcount;
}
