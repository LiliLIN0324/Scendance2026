'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Minus, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import {
  findSubscriptionSku,
  subscriptionSkuFor,
  formatYuan,
  type BillingCycle,
  type PlanCode,
  type SubscriptionSku,
} from '@/lib/pay/skus';
import {
  createOrder,
  deviceOwnerKey,
  fetchEntitlement,
  getOrder,
  getSubscription,
  isMockMode,
  modeLabel,
  payProvider,
  type PayMode,
  type PayOrderView,
  type SubscriptionView,
} from '@/lib/pay/client';
import './membership-plans.css';

/** 档位卡展示数据：权益与迁移 seed 的 entitlements 一一对应；off 项灰显。 */
interface PlanCard {
  plan: PlanCode;
  name: string;
  tagline: string;
  recommended?: boolean;
  monthlyCents: number | null;
  yearlyCents: number | null;
  /** [文案, 是否包含]；企业版没有下单动作。 */
  features: [string, boolean][];
  footerFact?: string;
}

const PLAN_CARDS: PlanCard[] = [
  {
    plan: 'free',
    name: '免费版',
    tagline: '1 个席位，先试一个方案。',
    monthlyCents: 0,
    yearlyCents: 0,
    features: [
      ['1 个方案', true],
      ['720p 导出（带幕景页脚）', true],
      ['1 次极速重建 / 月', true],
      ['物料清单导出', false],
      ['白标客户分享', false],
    ],
  },
  {
    plan: 'pro',
    name: '专业版',
    tagline: '1 个席位，个人做方案长期用。',
    recommended: true,
    monthlyCents: 9900,
    yearlyCents: 99900,
    features: [
      ['方案数不限', true],
      ['1080p 导出（去水印）', true],
      ['2 次标准重建 / 月', true],
      ['物料清单导出', true],
      ['白标客户分享', false],
    ],
  },
  {
    plan: 'team',
    name: '团队版',
    tagline: '3 个席位起步，团队改同一份方案。',
    monthlyCents: 39900,
    yearlyCents: 399900,
    features: [
      ['3 个席位，增席 ¥99 / 席 / 月', true],
      ['8 次标准重建 / 月', true],
      ['白标客户分享', true],
      ['共享素材库与模板', true],
      ['版本与审批留痕', true],
    ],
  },
  {
    plan: 'free', // 企业版不进线上支付，下单按钮不渲染
    name: '企业版',
    tagline: '10 个席位起步，执行团队整包交付。',
    monthlyCents: null,
    yearlyCents: 1280000,
    features: [
      ['10 个席位', true],
      ['4K 导出（去水印）', true],
      ['私有素材库', true],
      ['对公合同 + 专票', true],
    ],
    footerFact: '线下合同，不进线上支付。',
  },
];

function planLabel(plan: PlanCode): string {
  if (plan === 'pro') return '专业版';
  if (plan === 'team') return '团队版';
  return '免费版';
}

function formatExpiry(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
}

interface CheckoutState {
  skuCode: string;
  order: PayOrderView | null;
  mode: PayMode;
  busy: boolean;
  error: string;
  qr: string;
  payUrl: string;
  subscription: SubscriptionView | null;
  /** 爱猹收通道：平台生成的支付宝收银链接与二维码（无本地订单对象）。 */
  purchaseUrl?: string;
  qrImageUrl?: string;
  purchased?: boolean;
}

export function MembershipPlans({ variant = 'full' }: { variant?: 'full' | 'modal' } = {}) {
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    getSubscription()
      .then(result => setSubscription(result.subscription))
      .catch(() => setSubscription(null));
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const poll = (orderId: string, tries: number) => {
    stopPolling();
    if (tries <= 0) return;
    pollTimer.current = window.setTimeout(async () => {
      try {
        const result = await getOrder(orderId);
        setCheckout(state => (state ? { ...state, order: result.order, mode: result.mode } : state));
        if (result.order.status === 'paid') {
          const sub = await getSubscription();
          setSubscription(sub.subscription);
        } else {
          poll(orderId, tries - 1);
        }
      } catch {
        poll(orderId, tries - 1);
      }
    }, 2000);
  };

  // 爱猹收通道轮询：无本地订单，直接轮询权益直到 granted。
  const pollEntitlement = (kind: 'membership' | 'team', tries: number) => {
    stopPolling();
    if (tries <= 0) return;
    pollTimer.current = window.setTimeout(async () => {
      try {
        const { entitlement } = await fetchEntitlement(kind);
        if (entitlement.access === 'granted') {
          const sub = await getSubscription();
          setSubscription(sub.subscription);
          setCheckout(state => (state ? { ...state, purchased: true } : state));
          return;
        }
        pollEntitlement(kind, tries - 1);
      } catch {
        pollEntitlement(kind, tries - 1);
      }
    }, 2000);
  };

  const buy = async (sku: SubscriptionSku) => {
    if (checkout?.busy) return;
    setCheckout({ skuCode: sku.code, order: null, mode: isMockMode() ? 'mock' : 'live', busy: true, error: '', qr: '', payUrl: '', subscription: null, purchased: false });
    try {
      if (payProvider === 'aichashou') {
        // 爱猹收通道：权益托管在平台，access 直接给出支付宝收银链接与二维码。
        const kind = sku.planCode === 'team' ? 'team' : 'membership';
        const { entitlement } = await fetchEntitlement(kind);
        if (entitlement.access === 'purchase_required' && entitlement.purchase) {
          setCheckout(state =>
            state
              ? {
                  ...state,
                  busy: false,
                  purchaseUrl: entitlement.purchase!.url,
                  qrImageUrl: entitlement.purchase!.qr_code_url ?? '',
                }
              : state,
          );
          pollEntitlement(kind, 60);
          return;
        }
        if (entitlement.access === 'granted') {
          const sub = await getSubscription();
          setSubscription(sub.subscription);
          setCheckout(state => (state ? { ...state, busy: false, purchased: true } : state));
          return;
        }
        throw new Error(entitlement.reason?.message ?? '支付暂不可用，请稍后再试');
      }
      const result = await createOrder({ sku: sku.code, ownerKey: deviceOwnerKey() });
      setCheckout(state =>
        state ? { ...state, order: result.order, mode: result.mode, subscription: result.subscription ?? null } : state,
      );
      setSubscription(state => result.subscription ?? state);
      if (result.order.status === 'pending') {
        setCheckout(state => (state ? { ...state, payUrl: result.payUrl ?? result.qrCode ?? '' } : state));
        poll(result.order.id, 60);
      }
    } catch (cause) {
      setCheckout(state => (state ? { ...state, error: cause instanceof Error ? cause.message : '创建订单失败' } : state));
    } finally {
      setCheckout(state => (state ? { ...state, busy: false } : state));
    }
  };

  const currentPlan = subscription?.planCode ?? 'free';

  const order = checkout?.order ?? null;
  const aichashouPurchased = checkout?.purchased === true;
  const aichashouPending = !order && payProvider === 'aichashou' && Boolean(checkout?.purchaseUrl) && !aichashouPurchased;
  const paid = order?.status === 'paid' || aichashouPurchased;
  const pending = order?.status === 'pending' || aichashouPending;

  // 结账抽屉展示所需档位信息，直接由下单 SKU code 反查。
  const checkoutSku = checkout ? findSubscriptionSku(checkout.skuCode) : undefined;

  useEffect(() => {
    // 真实通道二维码：内容来自支付宝预下单返回的 qr_code，不拿订单号凑。
    const url = pending ? checkout?.payUrl || order?.providerOrderId || '' : '';
    if (!url || checkout?.mode === 'mock') {
      setCheckout(state => (state && state.qr ? { ...state, qr: '' } : state));
      return;
    }
    QRCode.toDataURL(url, { margin: 1, width: 240 })
      .then(data => setCheckout(state => (state ? { ...state, qr: data } : state)))
      .catch(() => setCheckout(state => (state ? { ...state, qr: '' } : state)));
  }, [order, pending, checkout?.payUrl, checkout?.mode]);

  return (
    <section className="mem" aria-label="会员订阅">
      <div className="mem-toolbar">
        <div className="mem-cycle" role="group" aria-label="计费周期">
          <button
            type="button"
            className={`mem-cycle-btn${cycle === 'monthly' ? ' mem-cycle-btn--on' : ''}`}
            aria-pressed={cycle === 'monthly'}
            onClick={() => setCycle('monthly')}
          >
            按月
          </button>
          <button
            type="button"
            className={`mem-cycle-btn${cycle === 'yearly' ? ' mem-cycle-btn--on' : ''}`}
            aria-pressed={cycle === 'yearly'}
            onClick={() => setCycle('yearly')}
          >
            按年
          </button>
        </div>
        <span className="mem-status">
          当前：{planLabel(currentPlan)}
          {subscription?.periodEnd ? ` · 有效期至 ${formatExpiry(subscription.periodEnd)}` : ''}
        </span>
      </div>

      <div className="mem-grid">
        {PLAN_CARDS.map(card => {
          const isEnterprise = card.plan === 'free' && card.monthlyCents === null;
          // 弹窗（OnePlan 式）只放免费锚点 + 两个可购档；企业版留在 /pricing 全页。
          if (isEnterprise && variant === 'modal') return null;
          // 爱猹收单档 ¥1,000 上限：团队版年付（¥3,999）超限，通道上固定月付 ¥399，
          // 年付等公司主体直连（pay_skus 原价保留）或平台提额后再恢复。
          const teamMonthlyOnly = payProvider === 'aichashou' && card.plan === 'team';
          const cardCycle = teamMonthlyOnly ? 'monthly' : cycle;
          const isCurrent = !isEnterprise && card.plan === currentPlan;
          const price = cardCycle === 'yearly' ? card.yearlyCents : card.monthlyCents;
          const teamBuyable = true;
          const sku =
            !isEnterprise && !isCurrent && card.plan !== 'free' && teamBuyable
              ? subscriptionSkuFor(card.plan, cardCycle)
              : null;
          return (
            <article key={card.name} className={`mem-card${card.recommended ? ' mem-card--hot' : ''}`}>
              <header className="mem-card-head">
                <h3 className="mem-card-name">
                  {card.name}
                  {card.recommended && <span className="mem-badge">推荐</span>}
                </h3>
                <p className="mem-card-tagline">{card.tagline}</p>
              </header>
              <div className="mem-price">
                {isEnterprise ? (
                  <>
                    <b>¥12,800</b>
                    <i>/年起</i>
                  </>
                ) : (
                  <>
                    <b key={cardCycle} className="mem-swap">{formatYuan(price ?? 0)}</b>
                    <i>/{cardCycle === 'yearly' ? '年' : '月'}</i>
                  </>
                )}
              </div>
              {!isEnterprise && price !== null && price > 0 && cardCycle === 'yearly' && (
                <p key="yearly-note" className="mem-price-note mem-swap">月均 {formatYuan(Math.round(price / 12))}，按年一次付清</p>
              )}
              <ul className="mem-features">
                {card.features.map(([text, on]) => (
                  <li key={text} className={on ? '' : 'mem-feature--off'}>
                    {on ? (
                      <Check size={13} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Minus size={13} strokeWidth={2} aria-hidden="true" />
                    )}
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              {card.footerFact && <p className="mem-card-fact">{card.footerFact}</p>}
              {sku && (
                <button type="button" className="mem-cta" disabled={checkout?.busy} onClick={() => buy(sku)}>
                  {checkout?.busy && checkout?.skuCode === sku.code ? (
                    <Loader2 size={15} strokeWidth={1.75} className="mem-spin" />
                  ) : (
                    <QrCode size={15} strokeWidth={1.75} />
                  )}
                  升级{card.name}
                </button>
              )}
              {isCurrent && (
                <button type="button" className="mem-cta mem-cta--ghost" disabled>
                  当前方案
                </button>
              )}
            </article>
          );
        })}
      </div>

      {checkout && (order || checkout.purchaseUrl || checkout.purchased) && (
        <section className="mem-checkout" aria-label="结账">
          <header className="mem-checkout-head">
            {pending && <span className="mem-pill mem-pill--wait">等待支付结果</span>}
            {paid && <span className="mem-pill mem-pill--live">已开通</span>}
            <span className={`mem-mode mem-mode--${checkout.mode}`}>{modeLabel(checkout.mode)}</span>
            <button
              type="button"
              className="mem-back"
              onClick={() => {
                stopPolling();
                setCheckout(null);
              }}
            >
              ← 返回
            </button>
          </header>
          <h3 className="mem-checkout-title">
            升级{planLabel(checkoutSku?.planCode ?? 'pro')} · {checkoutSku?.cycle === 'monthly' ? '按月' : '按年'}
          </h3>
          <dl className="mem-rows">
            <div>
              <dt>
                {planLabel(checkoutSku?.planCode ?? 'pro')} · {checkoutSku?.cycle === 'monthly' ? '按月' : '按年'}
                （{formatYuan(checkoutSku?.amountCents ?? order?.amountCents ?? 0)} /{' '}
                {checkoutSku?.cycle === 'monthly' ? '月' : '年'}）
              </dt>
              <dd>{formatYuan(checkoutSku?.amountCents ?? order?.amountCents ?? 0)}</dd>
            </div>
            <div>
              <dt>内含标准重建</dt>
              <dd>{checkoutSku?.planCode === 'team' ? '8 次 / 月' : '2 次 / 月'}</dd>
            </div>
            <div>
              <dt>席位</dt>
              <dd>{checkoutSku?.planCode === 'team' ? '3' : '1'}</dd>
            </div>
            <div className="mem-row-total">
              <dt>应付</dt>
              <dd>{formatYuan(checkoutSku?.amountCents ?? order?.amountCents ?? 0)}</dd>
            </div>
          </dl>
          {pending && (checkout.qr || checkout.qrImageUrl) && (
            <div className="mem-qrbox">
              <img
                className="mem-qr"
                src={checkout.qr || checkout.qrImageUrl}
                alt="支付宝支付二维码"
                width={240}
                height={240}
              />
              {checkout.purchaseUrl ? (
                <a className="mem-alipay" href={checkout.purchaseUrl} target="_blank" rel="noopener noreferrer">
                  打开支付宝支付页
                </a>
              ) : (
                <span className="mem-alipay">支付宝扫码支付</span>
              )}
              <span className="mem-fact">扫码后由支付宝异步通知确认；30 分钟内未支付订单自动失效。</span>
            </div>
          )}
          {pending && !checkout.qr && !checkout.qrImageUrl && (
            <span className="mem-fact">支付通道已创建，等待支付宝回调；回调丢失时本页会自动查询补偿。</span>
          )}
          {paid && (
            <span className="mem-fact">
              {subscription?.periodEnd
                ? `${planLabel(subscription.planCode)}已开通，有效期至 ${formatExpiry(subscription.periodEnd)}。`
                : '已支付，开通中；权益可在本页刷新查看。'}
              到期后方案转只读，不删除数据；不自动续费。
            </span>
          )}
          {checkout.error && <span className="mem-error">{checkout.error}</span>}
        </section>
      )}
    </section>
  );
}
