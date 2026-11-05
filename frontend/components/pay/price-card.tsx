'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Info, Loader2, QrCode, ReceiptText, ScanLine } from 'lucide-react';
import QRCode from 'qrcode';
import { PAY_SKUS, formatYuan, type SkuCode } from '@/lib/pay/skus';
import {
  createOrder,
  deviceOwnerKey,
  getOrder,
  isMockMode,
  latestPaidOrder,
  modeLabel,
  type PayMode,
  type PayOrderView,
} from '@/lib/pay/client';
import './price-card.css';

function formatTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function PriceCard({ compact = false }: { compact?: boolean }) {
  const [sku, setSku] = useState<SkuCode>('scan_3');
  const [order, setOrder] = useState<PayOrderView | null>(null);
  const [mode, setMode] = useState<PayMode>(isMockMode() ? 'mock' : 'live');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [qr, setQr] = useState('');
  const [payUrl, setPayUrl] = useState('');
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    const paid = latestPaidOrder();
    if (paid) setOrder(paid);
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    // 真实通道：二维码内容由后端下单时返回（支付宝 qr_code），不要拿订单号当内容。
    const url = order?.status === 'pending' ? payUrl || order.providerOrderId : null;
    if (!url || mode === 'mock') {
      setQr('');
      return;
    }
    QRCode.toDataURL(url, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [order, mode, payUrl]);

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
        setOrder(result.order);
        setMode(result.mode);
        if (result.order.status === 'pending') poll(orderId, tries - 1);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '查询订单失败');
      }
    }, 2000);
  };

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await createOrder({ sku, ownerKey: deviceOwnerKey() });
      setOrder(result.order);
      setMode(result.mode);
      setPayUrl(result.payUrl ?? result.qrCode ?? '');
      if (result.order.status === 'pending') poll(result.order.id, 60);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建订单失败');
    } finally {
      setBusy(false);
    }
  };

  const paid = order?.status === 'paid';
  const pending = order?.status === 'pending';

  return (
    <div className={`pay-card${compact ? ' pay-card--compact' : ''}`}>
      <header className="pay-head">
        <span className="pay-icon" aria-hidden>
          <ScanLine size={16} strokeWidth={1.75} />
        </span>
        <span className="pay-title">按次重建</span>
        <button
          type="button"
          className="pay-info-btn"
          aria-label="定价与退款说明"
          aria-expanded={showInfo}
          onClick={() => setShowInfo(value => !value)}
        >
          <Info size={16} strokeWidth={1.75} />
        </button>
        <span className={`pay-mode pay-mode--${mode}`}>{modeLabel(mode)}</span>
      </header>

      {showInfo && (
        <div className="pay-info">
          <span>一次 = 一次重建任务，与照片张数无关；单张照片不计数。</span>
          <span>成本主要是重建 GPU 与存储：单任务平台成本约 ¥1–3，按 3 次包折算单次 ¥3.30。</span>
          <span>提交时预扣 1 次；重建失败或超时自动返还；整单未使用可在 7 天内申请原路退款。</span>
        </div>
      )}

      <div className="pay-skus">
        {PAY_SKUS.map(item => (
          <button
            key={item.code}
            type="button"
            className={`pay-sku${sku === item.code ? ' pay-sku--on' : ''}`}
            onClick={() => setSku(item.code)}
            aria-pressed={sku === item.code}
          >
            {item.badge && <span className="pay-sku-badge">{item.badge}</span>}
            <span className="pay-sku-title">{item.title}</span>
            <span className="pay-sku-price">{formatYuan(item.amountCents)}</span>
            <span className="pay-sku-note">
              {item.times > 1 ? `单次 ${formatYuan(item.unitCents)}` : item.note}
            </span>
          </button>
        ))}
      </div>

      <div className="pay-actions">
        <button type="button" className="pay-btn" onClick={buy} disabled={busy}>
          {busy ? <Loader2 size={16} strokeWidth={1.75} className="pay-spin" /> : <QrCode size={16} strokeWidth={1.75} />}
          {pending ? '等待支付结果' : paid ? '再买一单' : mode === 'mock' ? '模拟支付（本地）' : '去支付'}
        </button>
        {order && (
          <span className="pay-remaining">
            {paid ? `剩余 ${order.remaining} 次` : '支付后自动到账'}
          </span>
        )}
      </div>

      {error && <span className="pay-error">{error}</span>}
      {pending && qr && <img className="pay-qr" src={qr} alt="支付宝支付二维码" width={220} height={220} />}
      {pending && !qr && <span className="pay-hint">支付通道已创建，等待支付宝回调；回调丢失时本页会自动查询补偿。</span>}

      {order && (
        <section className="pay-receipt" aria-label="支付凭证">
          <header className="pay-receipt-head">
            <span className="pay-icon" aria-hidden>
              <ReceiptText size={16} strokeWidth={1.75} />
            </span>
            <span>支付凭证</span>
            {paid && (
              <span className="pay-receipt-state">
                <Check size={14} strokeWidth={1.75} /> 已支付
              </span>
            )}
            <span className="pay-receipt-mode">{modeLabel(mode)}</span>
          </header>
          <dl className="pay-receipt-rows">
            <div>
              <dt>订单号</dt>
              <dd className="pay-mono">{order.id}</dd>
            </div>
            <div>
              <dt>金额</dt>
              <dd>{formatYuan(order.amountCents)}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{formatTime(order.paidAt ?? order.createdAt)}</dd>
            </div>
            <div>
              <dt>扫描次数</dt>
              <dd>{order.timesPurchased} 次</dd>
            </div>
          </dl>
          <span className="pay-receipt-foot">凭证可截图；真实收款以支付宝账单为准。</span>
        </section>
      )}
    </div>
  );
}
