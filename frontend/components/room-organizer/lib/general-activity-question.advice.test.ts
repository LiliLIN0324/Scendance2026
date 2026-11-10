import { describe, expect, it } from 'vitest';
import { isGeneralActivityQuestion } from './general-activity-question';

describe('意见/风险评估类提问是咨询，不进布置管线（2026-11-11 线上事故）', () => {
  it('「你觉得我这场布置还有什么风险」是咨询——即使带「这场」和「布置」', () => {
    expect(isGeneralActivityQuestion('你觉得我这场布置还有什么风险')).toBe(true);
    expect(isGeneralActivityQuestion('你认为这个场地布置怎么看')).toBe(true);
    expect(isGeneralActivityQuestion('这场活动有什么风险吗')).toBe(true);
  });

  it('夹带动作动词的不是咨询，走原有路由', () => {
    expect(isGeneralActivityQuestion('帮我看看布置还有什么风险，顺便出一版')).toBe(false);
    expect(isGeneralActivityQuestion('把舞台挪到左边，你觉得呢')).toBe(false);
  });
});
