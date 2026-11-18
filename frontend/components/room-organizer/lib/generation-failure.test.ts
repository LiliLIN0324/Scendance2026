import { describe, expect, it } from 'vitest';
import { UNKNOWN_SUBMISSION_NOTICE, generationFailureText, generationProgressText, vendorRejectionOf } from './generation-failure';

/**
 * 失败原因必须是「能照着做的下一步」，不是「生成失败」四个字。
 *
 * 2026-11-17 生产 C1 实跑：任务 failed、error_code=PROVIDER_REJECTED，worker 已经把供应商原话
 * （`no credits` = 服务商账号没额度）落进 provider_usage.vendorError。
 * 如果前端不读它，用户看到的就是一句没有信息量的「生成失败」，而真相只在库里躺着。
 */
describe('生成失败原因的人话', () => {
  it('非失败状态不给文案，避免在正常任务上多出一行噪音', () => {
    expect(generationFailureText({ state: 'ready' })).toBe('');
    expect(generationFailureText({ state: 'processing', error_code: 'PROVIDER_REJECTED' })).toBe('');
    expect(generationFailureText({ state: 'queued' })).toBe('');
  });

  it('供应商原话优先：额度不足要说出「去充值」，而不是把英文甩回给用户', () => {
    const text = generationFailureText({
      state: 'failed',
      error_code: 'PROVIDER_REJECTED',
      provider_usage: { vendorError: { vendorCode: '-1', vendorMessage: 'no credits' } },
    });
    expect(text).toContain('额度不足');
    expect(text).toContain('充值');
    expect(text).not.toContain('no credits');
  });

  it('认识几种常见供应商原话：密钥不对、内容被拦、请求过多、模型不认', () => {
    const of = (vendorMessage: string): string => generationFailureText({
      state: 'failed',
      provider_usage: { vendorError: { vendorCode: '-1', vendorMessage } },
    });
    expect(of('invalid api key')).toContain('密钥');
    expect(of('content policy violation')).toContain('内容');
    expect(of('rate limit exceeded')).toContain('太多');
    expect(of('no such model')).toContain('模型');
  });

  it('供应商原话不认识时，原样带着拒绝码显示，但截断到 200 字', () => {
    const text = generationFailureText({
      state: 'failed',
      provider_usage: { vendorError: { vendorCode: 'E-42', vendorMessage: 'x'.repeat(400) } },
    });
    expect(text).toContain('E-42');
    expect(text.length).toBeLessThan(260);
  });

  it('没有供应商原话时，按服务端错误码给通用说法', () => {
    expect(generationFailureText({ state: 'failed', error_code: 'PROVIDER_TIMEOUT' })).toContain('超时');
    expect(generationFailureText({ state: 'failed', error_code: 'PROVIDER_NO_GLB' })).toContain('模型文件');
    expect(generationFailureText({ state: 'failed', error_code: 'SOMETHING_NEW' })).toContain('SOMETHING_NEW');
    expect(generationFailureText({ state: 'failed', error_code: null })).toContain('重新生成');
  });

  it('提交结果未知：只能去查记录与费用，不能让用户再点一次', () => {
    expect(generationFailureText({ state: 'submit_unknown' })).toBe(UNKNOWN_SUBMISSION_NOTICE);
    expect(UNKNOWN_SUBMISSION_NOTICE).toContain('不重试');
  });

  it('provider_usage 形状不认识时当作没有，绝不猜一个原因', () => {
    expect(vendorRejectionOf(null)).toBeNull();
    expect(vendorRejectionOf(undefined)).toBeNull();
    expect(vendorRejectionOf('nope')).toBeNull();
    expect(vendorRejectionOf({})).toBeNull();
    expect(vendorRejectionOf({ vendorError: 'boom' })).toBeNull();
    expect(vendorRejectionOf({ vendorError: { vendorCode: 1, vendorMessage: 2 } })).toBeNull();
    expect(generationFailureText({ state: 'failed', provider_usage: { vendorError: 'boom' } })).toContain('重新生成');
  });

  it('入库被上限挡住要说清是文件太大，而不是笼统的失败', () => {
    // 2026-11-17 生产 C1 实跑：供应商出好了模型，我们自己的入库上限把它挡在门外，
    // 任务落到 rejected + FILE_TOO_LARGE。用户看到的必须说得出「模型太大、没进库」，
    // 而不是「生成失败」——后者会让人以为是描述写得不对，白跑一遍。
    const text = generationFailureText({ state: 'rejected', error_code: 'FILE_TOO_LARGE' });
    expect(text).toContain('入库上限');
    expect(text).toContain('模型库');
  });

  it('只有码没有文案时也要说得出话', () => {
    const text = generationFailureText({
      state: 'failed',
      provider_usage: { vendorError: { vendorCode: 'E-7', vendorMessage: '' } },
    });
    expect(text).toContain('E-7');
    expect(text.length).toBeGreaterThan(0);
  });

  it('国内密钥打到国际网关（BIZ_14001）要说网关不匹配，不能误导成钥匙无效', () => {
    const text = generationFailureText({
      state: 'failed',
      provider_usage: { vendorError: { vendorCode: 'BIZ_14001', vendorMessage: 'gateway not support this key' } },
    });
    expect(text).toContain('api.aholo.cn');
    expect(text).toContain('网关');
    expect(text).not.toContain('gateway not support');
  });
});

/**
 * 2026-11-17 生产任务停在 `queued`：面板只显示「云端生成中 · queued」，
 * 用户看不出是触发器没装（运维问题），只会以为描述写错，再点一次 = 再扣一次额度。
 */
describe('排队卡住时的人话', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');

  it('刚排队不报，避免正常任务被误判成故障', () => {
    expect(generationProgressText({ state: 'queued', created_at: '2026-11-18T09:59:30Z' }, now)).toBe('');
  });

  it('排队超过 3 分钟：明说后台没接单、是运维问题、别重复提交', () => {
    const text = generationProgressText({ state: 'queued', created_at: '2026-11-18T09:52:00Z' }, now);
    expect(text).toContain('8 分钟');
    expect(text).toContain('没有接单');
    expect(text).toContain('触发器');
    expect(text).toContain('不是描述写错');
    expect(text).toContain('不要重复提交');
  });

  it('处理中按 40 分钟兜底，没到就不打扰', () => {
    expect(generationProgressText({ state: 'processing', created_at: '2026-11-18T09:50:00Z' }, now)).toBe('');
    const late = generationProgressText({ state: 'processing', created_at: '2026-11-18T09:00:00Z' }, now);
    expect(late).toContain('60 分钟');
    expect(late).toContain('不要重复提交');
  });

  it('没有创建时间就不猜；终态不走进度文案', () => {
    expect(generationProgressText({ state: 'queued' }, now)).toBe('');
    expect(generationProgressText({ state: 'queued', created_at: '不是时间' }, now)).toBe('');
    expect(generationProgressText({ state: 'failed', created_at: '2026-11-18T09:00:00Z' }, now)).toBe('');
    expect(generationProgressText({ state: 'ready', created_at: '2026-11-18T09:00:00Z' }, now)).toBe('');
  });
});
