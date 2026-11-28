'use client';

import Link from 'next/link';
import { ArrowLeft, Info } from '@/components/solid-icons';
import { PriceCard } from '@/components/pay/price-card';
import { MembershipPlans } from '@/components/pay/membership-plans';
import './pricing.css';

/**
 * 购买页：会员订阅（月 / 年）在上，按次重建在下。
 * 订阅区块是 components/pay/membership-plans（支付宝当面付结账），
 * 按次卡片是 components/pay/price-card；档位真值都在后端 pay_skus。
 */
export default function PricingPage(): JSX.Element {
  return (
    <main className="sc-pricing">
      <header className="sc-pricing-head">
        <Link className="sc-pricing-back" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          回工作台
        </Link>
        <h1>会员与购买</h1>
        <p>订阅管持续做方案的能力；重建次数是算力，单独加购。</p>
      </header>

      <MembershipPlans />

      <section className="sc-pricing-times" aria-label="按次重建">
        <h2>按次重建</h2>
        <PriceCard />
        <p className="sc-pricing-note">
          <Info size={14} aria-hidden="true" />
          提交重建时预扣 1 次；重建失败或超时未出结果自动返还次数；整单未使用可在 7 天内申请原路退款。
        </p>
      </section>

      <p className="sc-pricing-note">
        需要先拍素材？<Link href="/guide/capture">去拍摄场地</Link>。
      </p>
    </main>
  );
}
