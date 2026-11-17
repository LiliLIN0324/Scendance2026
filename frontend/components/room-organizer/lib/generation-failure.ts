/**
 * 生成任务失败原因的人话。
 *
 * 为什么要有这个模块：2026-11-17 起，worker 会把**供应商自己的**拒绝码与文案落进
 * `provider_usage.vendorError`（在此之前它被整个丢掉）。不翻译的话，用户看到的只有一句
 * 「生成失败」，而真正的线索——生产 C1 实跑拿到的 `no credits`（服务商账号没额度）——被埋在库里，
 * 谁也看不见，更不知道下一步该做什么。
 *
 * 这里只做一件事：把库里的原文翻成一句能照着做的中文。
 * 不碰提交、不碰额度、不改任何服务端契约；形状不认识就退回通用文案，宁可少说，不可乱说。
 */

/** worker 落库的供应商拒绝信息。 */
export interface VendorRejection {
  vendorCode: string;
  vendorMessage: string;
}

/**
 * 从 `provider_usage` 里取出供应商拒绝信息。
 *
 * 形状对不上就当作没有：这份数据是服务端写的，客户端只读，
 * 读不懂时退回通用文案比「猜一个原因」安全。
 */
export function vendorRejectionOf(providerUsage: unknown): VendorRejection | null {
  if (!providerUsage || typeof providerUsage !== 'object') return null;
  const raw = (providerUsage as { vendorError?: unknown }).vendorError;
  if (!raw || typeof raw !== 'object') return null;
  const vendorCode = typeof (raw as { vendorCode?: unknown }).vendorCode === 'string'
    ? (raw as { vendorCode: string }).vendorCode : '';
  const vendorMessage = typeof (raw as { vendorMessage?: unknown }).vendorMessage === 'string'
    ? (raw as { vendorMessage: string }).vendorMessage : '';
  if (!vendorCode && !vendorMessage) return null;
  return { vendorCode, vendorMessage };
}

/** 供应商原话里出现这些词时，给的是「下一步该做什么」，而不是把英文原样甩回给用户。 */
const VENDOR_HINTS: { match: RegExp; text: string }[] = [
  { match: /no\s*credit|no\s*balance|insufficient|quota|余额|额度/i, text: '生成服务商那边额度不足，需要先给那个服务商账号充值。' },
  { match: /invalid\s*(api\s*)?key|unauthor|forbidden|authentication|401|403|鉴权|密钥/i, text: '生成服务商不认这个密钥，请检查设置里的服务商密钥。' },
  { match: /content\s*(policy|filter)|sensitive|moderation|违规|审核/i, text: '生成服务商判定这次内容不让过，换个描述再试。' },
  { match: /rate\s*limit|too\s*many|busy|限流|繁忙/i, text: '生成服务商当前请求太多，等一会儿再试。' },
  { match: /no\s*such\s*model|unknown\s*model|model[_ ]?not[_ ]?found|invalid\s*model|模型/i, text: '生成服务商不认这个模型版本，检查设置里的模型名。' },
];

/** 没有供应商原话时，按服务端错误码给通用说法。 */
const ERROR_CODE_TEXT: Record<string, string> = {
  PROVIDER_REJECTED: '生成服务商拒绝了这次请求。',
  PROVIDER_FAILED: '生成服务商这次没做完，再生成一次试试。',
  PROVIDER_TIMEOUT: '生成服务商响应超时，稍后再试。',
  PROVIDER_HTTP_ERROR: '生成服务商暂时不可用，稍后再试。',
  PROVIDER_NO_GLB: '生成服务商没有产出模型文件，再生成一次试试。',
  PROVIDER_INVALID_JSON: '生成服务商返回的内容读不出来，再生成一次试试。',
  GENERATION_POLL_FAILED: '查询生成进度失败，刷新一下任务状态。',
  TEXTURE_GEOMETRY_CHANGED: '源模型的几何已经变了，这次纹理版本作废，需要重新生成。',
  BUDGET_EXCEEDED: '本次额度不足，请联系管理员。',
};

/**
 * 提交结果未知时的统一文案。断网/超时/5xx/响应读不懂都可能已经创建了收费任务，
 * 这时唯一的正确动作是去查任务记录与费用，而不是再点一次。
 */
export const UNKNOWN_SUBMISSION_NOTICE = '结果未知：可能已经创建任务并计费。先查任务记录与费用，不重试。';

/** 供应商原话最长展示这么多字，避免后端塞进一整段 HTML 撑坏版式。 */
const MAX_VENDOR_MESSAGE = 200;

/** 失败任务需要的最小信息：状态、服务端错误码、供应商用量（原话在这里）。 */
export interface GenerationFailureSource {
  state: string;
  error_code?: string | null;
  provider_usage?: unknown;
}

/**
 * 失败时给一句话；不是失败就返回空串，调用方直接渲染即可。
 *
 * 优先级：供应商原话 > 服务端错误码 > 兜底。
 * 供应商原话最具体（「no credits」和「content rejected」要做的下一步完全不同），
 * 所以它排第一；错误码是第二手的，可能已经丢掉了供应商那边的细节。
 */
export function generationFailureText(job: GenerationFailureSource): string {
  if (!['failed', 'rejected', 'submit_unknown'].includes(job.state)) return '';
  if (job.state === 'submit_unknown') return UNKNOWN_SUBMISSION_NOTICE;
  const rejection = vendorRejectionOf(job.provider_usage);
  if (rejection) {
    const hint = VENDOR_HINTS.find(item => item.match.test(rejection.vendorMessage));
    if (hint) return hint.text;
    const code = rejection.vendorCode ? `（${rejection.vendorCode}）` : '';
    const message = rejection.vendorMessage.slice(0, MAX_VENDOR_MESSAGE);
    return `生成服务商拒绝了这次请求${code}${message ? `：${message}` : '。'}`;
  }
  const code = job.error_code ?? '';
  if (code) return ERROR_CODE_TEXT[code] ?? `生成未完成（${code}）。`;
  return '这次生成没有完成，可以重新生成一次。';
}
