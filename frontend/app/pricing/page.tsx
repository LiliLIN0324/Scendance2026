'use client';

import Link from 'next/link';
import { ArrowLeft, Info } from '@/components/solid-icons';
import { PriceCard } from '@/components/pay/price-card';
import './pricing.css';

/**
 * 独立的「按次重建」购买页。
 * 采集页第 07 步与工作台设置里的入口都指向这里；卡片本体是 components/pay/price-card。
 */
export default function PricingPage(): JSX.Element {
  return (
    <main className="sc-pricing">
      <header className="sc-pricing-head">
        <Link className="sc-pricing-back" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          回工作台
        </Link>
        <h1>按次重建</h1>
        <p>
          一次 = 一次重建任务，与照片张数无关。买到的次数归属当前设备，扫完直接在工作台打开 3D。
        </p>
      </header>

      <PriceCard />

      <p className="sc-pricing-note">
        <Info size={14} aria-hidden="true" />
        提交重建时预扣 1 次；重建失败或超时未出结果自动返还次数；整单未使用可在 7 天内申请原路退款。
      </p>

      <p className="sc-pricing-note">
        需要先拍素材？<Link href="/guide/capture">去拍摄场地</Link>。
      </p>
    </main>
  );
}
