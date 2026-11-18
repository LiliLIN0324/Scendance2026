'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { PLANNING_RADIUS, PLANNING_SURFACE, PLANNING_TYPOGRAPHY } from '@/lib/outdoor-plan-tokens';
import {
  bomToCsv,
  bomToMarkdown,
  buildBom,
  buildPriceTable,
  materialLabel,
  type BomFacility,
} from '../lib/plan-bom';
import { formatMoney, type CurrencyCode } from '../../../../supabase/functions/_shared/plan-editor';
import { readStudioSettingsCache, subscribeStudioSettings } from '../lib/studio-settings-cache';
import { buildQuoteHtml, withQuoteField, type PlanQuote } from '../lib/quote-document';

const QUOTE_FIELDS = [
  { key: 'projectName', label: '项目名', placeholder: '报价单抬头' },
  { key: 'client', label: '客户', placeholder: '客户名称' },
  { key: 'validUntil', label: '有效期', placeholder: '2026-12-31' },
  { key: 'preparedBy', label: '报价人', placeholder: '报价人 / 公司' },
] as const;

export interface PlanBomPanelProps {
  facilities: readonly BomFacility[];
  quote?: PlanQuote | undefined;
  onPriceModel: (slug: string, unitPrice: number | null) => void;
  onQuoteChange: (quote: PlanQuote | undefined) => void;
  /** 团队抬头。方案字段空着时，导出用这些值。 */
  headerFallback?: {
    companyName?: string;
    contact?: string;
    currency?: CurrencyCode;
    logoUrl?: string;
  };
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const quietButtonStyle = {
  padding: '2px 8px',
  borderRadius: PLANNING_RADIUS.sm,
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  background: 'transparent',
  color: PLANNING_SURFACE.panelText,
  cursor: 'pointer',
  fontSize: PLANNING_TYPOGRAPHY.hint,
} as const;

/**
 * 选中设施时的物料清单与报价。
 * 单价写回同型号设施和 plan.priceBook；抬头写回 plan.quote，不留在组件局部状态。
 */
export function PlanBomPanel({ facilities, quote, onPriceModel, onQuoteChange, headerFallback }: PlanBomPanelProps) {
  const [open, setOpen] = useState(false);
  const team = useSyncExternalStore(subscribeStudioSettings, () => readStudioSettingsCache(), () => null);
  const fallback = headerFallback ?? {
    ...(team?.companyName ? { companyName: team.companyName } : {}),
    ...(team?.quoteContact ? { contact: team.quoteContact } : {}),
    ...(team?.currency ? { currency: team.currency } : {}),
    ...(team?.logoUrl ? { logoUrl: team.logoUrl } : {}),
  };
  const currency = quote?.currency ?? fallback.currency ?? 'CNY';
  const money = (amount: number) => formatMoney(amount, currency);
  const bom = useMemo(() => (open ? buildBom(facilities) : null), [open, facilities]);
  const priceRows = useMemo(() => (open ? buildPriceTable(facilities) : []), [open, facilities]);
  const markdown = bom ? bomToMarkdown(bom) : '';

  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        aria-label="物料清单"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        style={{ ...quietButtonStyle, alignSelf: 'flex-start', background: PLANNING_SURFACE.fieldBg }}
      >
        物料清单
      </button>
      {open && bom && (
        <div>
          <div
            aria-label="清单内容"
            style={{
              maxHeight: 260,
              overflow: 'auto',
              borderRadius: PLANNING_RADIUS.sm,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              padding: '2px 6px',
            }}
          >
            {bom.lines.length === 0 ? (
              <p style={{ margin: '6px 0', color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint }}>
                清单为空：先布置道具。
              </p>
            ) : bom.lines.map((line, index) => (
              <div
                key={line.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto',
                  columnGap: 8,
                  alignItems: 'start',
                  padding: '5px 0',
                  borderBottom: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ opacity: 0.5, marginRight: 4 }}>{index + 1}</span>
                    {line.name}
                  </div>
                  <div style={{ color: PLANNING_SURFACE.panelText, opacity: 0.6, fontSize: 10 }}>
                    {line.width} × {line.depth} m · {materialLabel(line.material)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap', color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint }}>
                  <div>×{line.count} · {line.unitPrice === null ? '未定价' : money(line.unitPrice)}</div>
                  <div style={{ opacity: 0.62, fontSize: 10 }}>{line.subtotal === null ? '未计入金额' : `小计 ${money(line.subtotal)}`}</div>
                </div>
              </div>
            ))}
            {bom.lines.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0 3px', color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint, fontWeight: 600 }}>
                <span>合计 {bom.total} 件</span>
                <span>
                  {bom.unpricedCount > 0 ? `${bom.unpricedCount} 件未定价` : ''}
                  {bom.totalAmount > 0 ? ` · ${money(bom.totalAmount)}` : ''}
                </span>
              </div>
            )}
          </div>
          <p style={{ margin: '4px 2px 0', color: PLANNING_SURFACE.panelText, opacity: 0.72, fontSize: PLANNING_TYPOGRAPHY.hint }}>
            {bom.lines.length === 0
              ? '放置设施后可以按型号定价，并导出清单或报价单。'
              : bom.unpricedCount === bom.total
                ? '价格：尚未填写单价，本清单不含金额；未定价项不虚构单价。'
                : bom.unpricedCount > 0
                  ? `已定价 ${money(bom.totalAmount)}；${bom.unpricedCount} 件未定价，未计入金额。`
                  : `已定价合计 ${money(bom.totalAmount)}。`}
          </p>
          <div style={{ marginTop: 6, maxHeight: 180, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {priceRows.map(row => (
              <div key={`${row.slug ?? row.name}-${row.unitPrice ?? 'x'}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint }}>
                  {row.name} × {row.count}
                </span>
                <input
                  aria-label={`单价-${row.name}`}
                  type="number"
                  min={0}
                  defaultValue={row.unitPrice ?? ''}
                  placeholder={row.unitPrice === null ? '未定价' : ''}
                  disabled={!row.slug}
                  title={row.slug ? '按型号改价，同款一起改' : '没有型号，不能按型号定价'}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  onBlur={event => {
                    if (!row.slug) return;
                    const raw = event.target.value.trim();
                    if (raw === '') {
                      onPriceModel(row.slug, null);
                      return;
                    }
                    const value = Number(raw);
                    if (!Number.isFinite(value) || value < 0) return;
                    onPriceModel(row.slug, value);
                  }}
                  style={{
                    width: 78,
                    padding: '2px 6px',
                    borderRadius: PLANNING_RADIUS.sm,
                    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                    background: PLANNING_SURFACE.fieldBg,
                    color: PLANNING_SURFACE.panelText,
                    fontSize: PLANNING_TYPOGRAPHY.hint,
                  }}
                />
                <span style={{ color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint }}>元</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {QUOTE_FIELDS.map(field => (
              <label key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, fontSize: PLANNING_TYPOGRAPHY.hint, color: PLANNING_SURFACE.panelText }}>
                <span style={{ width: 42, flex: '0 0 auto', opacity: 0.72 }}>{field.label}</span>
                <input
                  aria-label={`报价单-${field.label}`}
                  value={quote?.[field.key] ?? ''}
                  placeholder={field.placeholder}
                  maxLength={field.key === 'validUntil' ? 40 : 120}
                  onChange={event => onQuoteChange(withQuoteField(quote, field.key, event.target.value))}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '2px 6px',
                    borderRadius: PLANNING_RADIUS.sm,
                    border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                    background: PLANNING_SURFACE.fieldBg,
                    color: PLANNING_SURFACE.panelText,
                    fontSize: PLANNING_TYPOGRAPHY.hint,
                  }}
                />
              </label>
            ))}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(markdown).catch(() => {}); }}
              style={quietButtonStyle}
            >
              复制
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ ...quietButtonStyle, border: 'none' }}>
              关闭
            </button>
            <button
              type="button"
              onClick={() => downloadText('物料清单.csv', bomToCsv(buildBom(facilities)), 'text/csv;charset=utf-8')}
              style={quietButtonStyle}
            >
              导出 CSV
            </button>
            <button
              type="button"
              onClick={() => downloadText('物料清单.md', markdown, 'text/markdown;charset=utf-8')}
              style={quietButtonStyle}
            >
              导出 Markdown
            </button>
            <button
              type="button"
              onClick={() => downloadText(
                '物料报价单.html',
                buildQuoteHtml({
                  projectName: quote?.projectName?.trim() || '户外活动布置',
                  bom: buildBom(facilities),
                  generatedAt: new Date().toLocaleString('zh-CN'),
                  note: '价格为项目内定价；未定价项需补齐后出正式报价，浏览器打印可另存为 PDF。',
                  ...(quote?.client?.trim() ? { client: quote.client.trim() } : {}),
                  ...(quote?.validUntil?.trim() ? { validUntil: quote.validUntil.trim() } : {}),
                  ...(quote?.preparedBy?.trim() || fallback.contact ? { preparedBy: quote?.preparedBy?.trim() || fallback.contact || '' } : {}),
                  ...(quote?.companyName?.trim() || fallback.companyName ? { companyName: quote?.companyName?.trim() || fallback.companyName || '' } : {}),
                  ...(quote?.logoUrl || fallback.logoUrl ? { logoUrl: quote?.logoUrl || fallback.logoUrl || '' } : {}),
                  currency,
                }),
                'text/html;charset=utf-8',
              )}
              style={quietButtonStyle}
            >
              导出报价单
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
