import { describe, expect, it } from 'vitest';
import {
  isMockReconTask,
  makeMockReconTaskId,
  mockReconSuccessDetail,
  MOCK_RECON_TASK_PREFIX,
  RECON_MATERIAL_BAN,
  VENUE_PACKAGE_MISSING,
  MOCK_HANG_DONE_NOTE,
  CREDIT_CONFIRM_LABEL,
  VENUE_PACKAGE_HUNG,
} from './site-recon-mock';

describe('场地重建干跑', () => {
  it('任务号符合 Aholo recon 形状，且可识别为干跑', () => {
    const id = makeMockReconTaskId(1_700_000_000_000);
    expect(id).toBe(`${MOCK_RECON_TASK_PREFIX}1700000000000`);
    expect(/^[a-zA-Z0-9_-]{1,128}$/.test(id)).toBe(true);
    expect(isMockReconTask(id)).toBe(true);
    expect(isMockReconTask('3FO4K4QI6N4V')).toBe(false);
  });

  it('干跑成功详情可直接当任务完成态', () => {
    expect(mockReconSuccessDetail()).toEqual({
      status: 3,
      statusLabel: '干跑完成',
      outputs: [],
      progress: 1,
    });
  });

  it('禁令文案点名高德/卫星，避免被当成重建素材', () => {
    expect(RECON_MATERIAL_BAN).toMatch(/高德/);
    expect(RECON_MATERIAL_BAN).toMatch(/卫星/);
    expect(RECON_MATERIAL_BAN).toMatch(/禁止/);
  });
});

describe('D2 本场包与额度闸文案', () => {
  it('缺本场包文案点名宴会厅样例与观感层', () => {
    expect(VENUE_PACKAGE_MISSING).toMatch(/仍缺本场包/);
    expect(VENUE_PACKAGE_MISSING).toMatch(/宴会厅/);
    expect(VENUE_PACKAGE_MISSING).toMatch(/观感/);
  });

  it('干跑挂载注与真挂载注互斥语义清晰', () => {
    expect(MOCK_HANG_DONE_NOTE).toMatch(/非本场包/);
    expect(VENUE_PACKAGE_HUNG).toMatch(/本场观感层/);
    expect(VENUE_PACKAGE_HUNG).toMatch(/替换/);
  });

  it('扣额度确认闸文案点名消耗额度', () => {
    expect(CREDIT_CONFIRM_LABEL).toMatch(/消耗/);
    expect(CREDIT_CONFIRM_LABEL).toMatch(/额度/);
  });
});
