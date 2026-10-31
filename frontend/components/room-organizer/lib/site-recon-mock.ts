/**
 * D1/D2 场地重建干跑与本场包状态文案。
 * 干跑：不打 Aholo、不扣额度；只验证「采集单 → 选素材 → 完成 → 挂预览」形状。
 * 真调：关掉干跑后须过扣额度确认闸，成功后挂本场 .spz 替换宴会厅样例。
 */

export const MOCK_RECON_TASK_PREFIX = 'mock-recon-';

/** 与 lux3d recon 任务号规则一致：字母数字、下划线、短横，≤128。 */
export function makeMockReconTaskId(now = Date.now()): string {
  return `${MOCK_RECON_TASK_PREFIX}${now}`;
}

export function isMockReconTask(taskid: string): boolean {
  return taskid.startsWith(MOCK_RECON_TASK_PREFIX);
}

/** 干跑「任务完成」详情：无签名产物链接，挂载走 onHangMockScene（等同 D0 hangDemo）。 */
export function mockReconSuccessDetail(): {
  status: number;
  statusLabel: string;
  outputs: string[];
  progress: number;
} {
  return { status: 3, statusLabel: '干跑完成', outputs: [], progress: 1 };
}

/** 采集单/重建入口统一禁令：高德瓦片与卫星图不是现场素材。 */
export const RECON_MATERIAL_BAN =
  '禁止把高德瓦片、卫星截图当重建素材；须现场手机按采集单拍照或绕场视频。';

/** 干跑挂载后：明确仍是宴会厅样例，不是本场包。 */
export const VENUE_PACKAGE_MISSING =
  '仍缺本场包：当前挂的是历史宴会厅样例 .spz（观感层演示），不是本场现场重建。关干跑并上传现场素材后，真成功可挂本场产物替换样例。';

/** 干跑挂载按钮旁短注（成功后）。 */
export const MOCK_HANG_DONE_NOTE =
  '已挂干跑环境预览（历史宴会厅样例 .spz，非本场包），未扣额度。splat 只作观感层。';

/** 真调提交前必须勾选的扣额度确认闸。 */
export const CREDIT_CONFIRM_LABEL = '我确认本次提交将消耗 Aholo 额度';

/** 真成功挂本场后的状态。 */
export const VENUE_PACKAGE_HUNG =
  '已挂本场观感层 .spz，已替换宴会厅样例；splat 只作观感，不进碰撞/落盘几何。';
