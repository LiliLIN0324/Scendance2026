'use client';

/**
 * 户外统一交付面板（分享 / 导出 / 送审）：替代旧 ExportMenu 下拉 + ShareDialog 弹窗。
 *
 * 结构对齐定稿 B：头部标题 + 活动名 / 发布态 chip；左栏交付对象三档轻量权限选择器，
 * 按对象显隐「在线分享 / 送审 Bingo / 导出资料」三段；导出项勾选 + 二级参数 + 规划中折叠区；
 * 右栏方案预览 / 二维码占位 / 状态行；底部「已选 N 项 + 导出所选资料」。
 *
 * 能力边界（按户外真实后端）：只读链接 / PNG / CSV / GeoJSON / PDF 已接通，回调由宿主注入；
 * 云发布网页、3D 漫游链接、送审评审、机位册 HTML、交接包 HTML 尚缺户外对应链路，面板内禁用
 * 并注明待接通，不绑可点动作、不做假按钮。
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  DELIVERY_AUDIENCES,
  DELIVERY_SEGMENTS,
  enabledDeliveryExports,
  futureDeliveryExports,
  segmentVisible,
  type DeliveryAudience,
  type DeliveryExportId,
} from '../lib/site-plan-guide';
import { PLANNING_RADIUS, PLANNING_SPACING, PLANNING_SURFACE, PLANNING_TEXT } from '@/lib/outdoor-plan-tokens';

/* ---------------- 回调面（宿主注入已接通后端） ---------------- */

export interface DeliveryExportHandlers {
  /** PNG 单帧：按当前 2D 帧出图。 */
  onExportPng?: () => void;
  /** 物料清单 CSV。 */
  onExportCsv?: () => void;
  /** GeoJSON 几何。 */
  onExportGeoJson?: () => void;
  /** PDF 演示稿排版。 */
  onPrintDeck?: () => void;
}

export interface OutdoorDeliveryPanelProps {
  open: boolean;
  onClose: () => void;
  /** 活动 / 方案名（头部 chip）。 */
  activityName: string;
  /** 方案摘要行，如「84.7 × 100 m · 12 件」。 */
  summaryMeta: string;
  /** 只读分享链接（/plan-share）；空串表示尚未生成。 */
  shareLink: string;
  handlers: DeliveryExportHandlers;
  /** 预览缩略图 dataURL（可选；缺省用占位帧）。 */
  previewImage?: string | null;
}

/* ---------------- 线性图标（定稿 A 款同风格） ---------------- */

function PanelIcon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const DocIcon = () => (
  <PanelIcon>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </PanelIcon>
);

const CubeIcon = () => (
  <PanelIcon>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </PanelIcon>
);

/* ---------------- 面板 ---------------- */

export function OutdoorDeliveryPanel({
  open,
  onClose,
  activityName,
  summaryMeta,
  shareLink,
  handlers,
  previewImage,
}: OutdoorDeliveryPanelProps) {
  const [audience, setAudience] = useState<DeliveryAudience>('client');
  const [checked, setChecked] = useState<ReadonlySet<DeliveryExportId>>(() => new Set<DeliveryExportId>(['png']));
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});
  const [paramSelection, setParamSelection] = useState<Record<string, Record<'view' | 'scale', number>>>({});
  const [futureOpen, setFutureOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const exportSegment = DELIVERY_SEGMENTS.find(seg => seg.id === 'export')!;
  const exportVisible = segmentVisible(exportSegment, audience);

  const toggleCheck = (id: DeliveryExportId) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSub = (id: string) => {
    setOpenSubs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const selectParam = (itemId: DeliveryExportId, groupKey: 'view' | 'scale', optionIndex: number) => {
    setParamSelection(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], [groupKey]: optionIndex },
    }));
  };

  const copyShareLink = () => {
    if (!shareLink) return;
    void navigator.clipboard?.writeText(shareLink).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => { /* 剪贴板被拒：用户可手动复制输入框内容 */ });
  };

  // 计数只算当前可见导出段内、已接通且勾选的项；规划中折叠项不计入。
  const selectedCount = exportVisible
    ? [...checked].filter(id => enabledDeliveryExports.some(item => item.id === id)).length
    : 0;

  const exportSelected = () => {
    for (const id of checked) {
      if (id === 'png') handlers.onExportPng?.();
      else if (id === 'csv') handlers.onExportCsv?.();
      else if (id === 'geojson') handlers.onExportGeoJson?.();
      else if (id === 'pdf') handlers.onPrintDeck?.();
    }
  };

  const visibleSegments = DELIVERY_SEGMENTS.filter(seg => segmentVisible(seg, audience));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="分享"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(20, 20, 22, 0.32)',
        fontFamily: 'inherit',
        padding: 16,
      }}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(980px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: PLANNING_RADIUS.lg,
          background: PLANNING_SURFACE.panelBg,
          border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
          boxShadow: '0 18px 48px rgba(20, 20, 22, 0.14)',
          color: PLANNING_SURFACE.panelText,
          overflow: 'hidden',
        }}
      >
        {/* 头部 */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `${PLANNING_SPACING.lg}px ${PLANNING_SPACING.xl}px ${PLANNING_SPACING.md}px`, borderBottom: `1px solid ${PLANNING_SURFACE.fieldBg}` }}>
          <strong style={{ fontSize: 17, fontWeight: 700 }}>分享</strong>
          <span style={chipStyle}>{activityName || '未命名方案'}</span>
          <span style={chipStyle}>未发布</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: PLANNING_TEXT.muted }}>发布不通知对方，链接由你自己发</span>
          <button type="button" onClick={onClose} aria-label="关闭" style={iconButtonStyle}>×</button>
        </header>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 560px) minmax(0, 1fr)', gap: 0, minHeight: 0 }}>
          {/* 左栏：动作 */}
          <div style={{ borderRight: `1px solid ${PLANNING_SURFACE.fieldBg}`, padding: `${PLANNING_SPACING.md}px ${PLANNING_SPACING.lg}px`, overflowY: 'auto', minWidth: 0 }}>
            {/* 交付对象选择器 */}
            <div role="tablist" aria-label="交付对象" style={{ display: 'flex', gap: 6, marginBottom: 6, background: PLANNING_SURFACE.fieldBg, borderRadius: 11, padding: 4 }}>
              {DELIVERY_AUDIENCES.map(aud => (
                <button
                  key={aud.id}
                  type="button"
                  role="tab"
                  aria-selected={audience === aud.id}
                  onClick={() => setAudience(aud.id)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: audience === aud.id ? '#ffffff' : 'transparent',
                    borderRadius: 8,
                    padding: '7px 8px',
                    font: 'inherit',
                    fontSize: 12,
                    fontWeight: 600,
                    color: audience === aud.id ? PLANNING_SURFACE.panelText : PLANNING_TEXT.muted,
                    cursor: 'pointer',
                    boxShadow: audience === aud.id ? '0 1px 3px rgba(20,20,22,0.12)' : 'none',
                  }}
                >
                  {aud.label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 10, color: '#a6aab2', margin: `0 2px ${PLANNING_SPACING.md}px`, lineHeight: 15 }}>
              {DELIVERY_AUDIENCES.find(aud => aud.id === audience)?.note}
            </p>

            {visibleSegments.map(seg => (
              <section key={seg.id} style={{ marginBottom: PLANNING_SPACING.md }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: PLANNING_TEXT.muted, letterSpacing: '.05em', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {seg.title}
                  <span style={{ fontWeight: 400, color: '#a6aab2' }}>{seg.tag}</span>
                </div>

                {seg.id === 'online' && (
                  <>
                    {/* 方案网页：只读链接可复制 / 打开；云发布待户外链路接通 */}
                    <div style={actStyle}>
                      <div style={actRowStyle}>
                        <div style={iconTileStyle}><DocIcon /></div>
                        <div style={mainStyle}>
                          <div style={nameStyle}>方案网页</div>
                          <div style={descStyle}>固定当前版本生成网页，附二维码；之后改方案不影响这一版</div>
                        </div>
                      </div>
                      <div style={rowActionsStyle}>
                        <button type="button" disabled title="户外云发布链路待接通" style={disabledBtnStyle}>发布当前版本</button>
                        <button type="button" onClick={copyShareLink} disabled={!shareLink} style={secondaryBtnStyle}>{copied ? '已复制' : '复制链接'}</button>
                        <button type="button" onClick={() => shareLink && window.open(shareLink, '_blank')} disabled={!shareLink} style={secondaryBtnStyle}>打开</button>
                      </div>
                    </div>

                    {/* 3D 漫游：户外快照链路待接通，整行禁用 */}
                    <div style={{ ...actStyle, ...disabledActStyle }}>
                      <div style={actRowStyle}>
                        <div style={iconTileStyle}><CubeIcon /></div>
                        <div style={mainStyle}>
                          <div style={nameStyle}>3D 漫游</div>
                          <div style={descStyle}>带上场景快照，打开可转动角度查看，无法编辑</div>
                        </div>
                      </div>
                      <div style={rowActionsStyle}>
                        <button type="button" disabled title="户外 3D 快照链路待接通" style={disabledBtnStyle}>生成漫游链接</button>
                        <button type="button" disabled style={disabledBtnStyle}>复制</button>
                        <button type="button" disabled style={disabledBtnStyle}>打开</button>
                        <button type="button" disabled style={disabledBtnStyle}>重新生成</button>
                      </div>
                    </div>
                  </>
                )}

                {seg.id === 'review' && (
                  <>
                    <div style={statusStyle}>
                      <span style={statusTitleStyle}>待审 v1</span>
                      <span style={statusMetaStyle}>评审会话与回执链路待接通</span>
                      <span style={{ flex: 1 }} />
                      <button type="button" disabled style={disabledBtnStyle}>发评审链接</button>
                      <button type="button" disabled style={disabledBtnStyle}>去 Bingo</button>
                    </div>
                    <div style={linkBoxStyle}>
                      <input readOnly value="/review/#layout=待接通" aria-label="评审链接" style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 11, color: PLANNING_TEXT.muted, outline: 'none', minWidth: 0, fontFamily: 'ui-monospace, monospace' }} />
                      <button type="button" disabled style={disabledBtnStyle}>复制</button>
                      <button type="button" disabled style={disabledBtnStyle}>打开对方所见</button>
                    </div>
                  </>
                )}

                {seg.id === 'export' && (
                  <>
                    {enabledDeliveryExports.map(item => {
                      const isChecked = checked.has(item.id);
                      const subOpen = !!openSubs[item.id];
                      return (
                        <div key={item.id} style={actStyle}>
                          <div style={actRowStyle}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={isChecked}
                              aria-label={`勾选 ${item.label}`}
                              onClick={() => toggleCheck(item.id)}
                              style={{ ...checkStyle, ...(isChecked ? checkOnStyle : {}) }}
                            >
                              {isChecked ? '✓' : ''}
                            </button>
                            <div style={mainStyle}>
                              <div style={nameStyle}>{item.label}</div>
                              <div style={descStyle}>{item.desc}</div>
                            </div>
                            {item.params && (
                              <button type="button" aria-label={`展开 ${item.label} 参数`} aria-expanded={subOpen} onClick={() => toggleSub(item.id)} style={arrowStyle}>
                                ›
                              </button>
                            )}
                          </div>
                          {item.params && subOpen && (
                            <div style={subStyle}>
                              {item.params.map(group => {
                                const selected = paramSelection[item.id]?.[group.optionsKey] ?? 0;
                                return (
                                  <div key={group.optionsKey}>
                                    <div style={subLabelStyle}>{group.label}</div>
                                    <div style={optsStyle}>
                                      {group.options.map((option, index) => (
                                        <button
                                          key={option}
                                          type="button"
                                          onClick={() => selectParam(item.id, group.optionsKey, index)}
                                          style={{ ...optStyle, ...(selected === index ? optOnStyle : {}) }}
                                        >
                                          {option}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* 工程备份：不在交付清单，归设置 · 存档 */}
                    <div style={noteRowStyle}>
                      <div style={mainStyle}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: PLANNING_TEXT.soft }}>工程备份</div>
                        <div style={{ fontSize: 11, color: PLANNING_TEXT.muted, marginTop: 1 }}>存档与恢复在「设置 · 存档」管理，不随交付导出</div>
                      </div>
                    </div>

                    {/* 规划中折叠区：未接通链路，不参与导出计数 */}
                    <div style={futureStyle}>
                      <button type="button" aria-expanded={futureOpen} aria-label="展开规划中格式" onClick={() => setFutureOpen(value => !value)} style={futureHeadStyle}>
                        <span style={{ flex: 1, textAlign: 'left', fontSize: 12, fontWeight: 600, color: PLANNING_TEXT.soft }}>规划中</span>
                        <span style={{ fontSize: 10, color: '#a6aab2' }}>待后续版本 · {futureDeliveryExports.length} 项</span>
                        <span style={{ color: '#a6aab2', fontSize: 14, transform: futureOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
                      </button>
                      {futureOpen && (
                        <div style={{ padding: `0 ${PLANNING_SPACING.md}px ${PLANNING_SPACING.sm}px`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {futureDeliveryExports.map(item => (
                            <div key={item.id} style={{ ...actStyle, background: '#fff', opacity: 0.55 }}>
                              <div style={actRowStyle}>
                                <div style={{ ...checkStyle, cursor: 'not-allowed' }} />
                                <div style={mainStyle}>
                                  <div style={{ ...nameStyle, color: PLANNING_TEXT.muted }}>{item.label}</div>
                                  <div style={descStyle}>{item.desc}</div>
                                  <div style={{ fontSize: 10, color: PLANNING_TEXT.muted, marginTop: 2 }}>{item.disabledHint}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            ))}
          </div>

          {/* 右栏：预览与状态 */}
          <div style={{ padding: `${PLANNING_SPACING.md}px ${PLANNING_SPACING.lg}px`, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', minWidth: 0 }}>
            <div style={previewStyle}>
              <div style={{ height: 200, borderRadius: 10, background: '#fff', border: `1px solid ${PLANNING_SURFACE.fieldBg}`, position: 'relative', overflow: 'hidden' }}>
                {previewImage
                  ? <img src={previewImage} alt="方案平面预览" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  : (
                    <svg width="100%" height="100%" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                      <rect x="0" y="0" width="300" height="200" fill="#fff" />
                      <g stroke="#EFEFF1" strokeWidth="1">
                        <line x1="50" y1="0" x2="50" y2="200" /><line x1="100" y1="0" x2="100" y2="200" />
                        <line x1="150" y1="0" x2="150" y2="200" /><line x1="200" y1="0" x2="200" y2="200" />
                        <line x1="250" y1="0" x2="250" y2="200" />
                        <line x1="0" y1="50" x2="300" y2="50" /><line x1="0" y1="100" x2="300" y2="100" /><line x1="0" y1="150" x2="300" y2="150" />
                      </g>
                      <rect x="28" y="34" width="110" height="64" rx="6" fill="#EEF3EF" stroke="#C6DCC9" />
                      <rect x="150" y="34" width="120" height="40" rx="6" fill="#F7F0E2" stroke="#E6D3AC" />
                      <rect x="28" y="116" width="70" height="54" rx="6" fill="#F4F5F7" stroke="#E4E4E7" />
                      <rect x="112" y="116" width="158" height="54" rx="6" fill="#F4F5F7" stroke="#E4E4E7" />
                    </svg>
                  )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: PLANNING_TEXT.muted }}>
                <span>方案预览</span>
                <span>{summaryMeta}</span>
              </div>
            </div>

            <div style={qrRowStyle}>
              <div style={qrStyle}>二维码</div>
              <div style={{ fontSize: 11, color: PLANNING_TEXT.muted, lineHeight: 17 }}>
                发布后这里出二维码，手机扫码看到的就是同一版；后续编辑不改已发布版本。
              </div>
            </div>

            <div style={statStyle}>
              <div style={statRowStyle}>
                <span style={{ ...dotStyle, background: '#a6aab2' }} />
                <span style={statKeyStyle}>方案网页</span>
                <span style={{ flex: 1, color: PLANNING_TEXT.soft, fontSize: 12 }}>未发布</span>
              </div>
              <div style={statRowStyle}>
                <span style={{ ...dotStyle, background: '#a6aab2' }} />
                <span style={statKeyStyle}>3D 漫游</span>
                <span style={{ flex: 1, color: PLANNING_TEXT.soft, fontSize: 12 }}>未生成</span>
              </div>
              <div style={statRowStyle}>
                <span style={{ ...dotStyle, background: '#a6aab2' }} />
                <span style={statKeyStyle}>评审</span>
                <span style={{ flex: 1, color: PLANNING_TEXT.soft, fontSize: 12 }}>未送审</span>
              </div>
            </div>
          </div>
        </div>

        {/* 底部主钮 */}
        <footer style={{ padding: `${PLANNING_SPACING.md}px ${PLANNING_SPACING.xl}px`, borderTop: `1px solid ${PLANNING_SURFACE.fieldBg}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: PLANNING_TEXT.muted }}>已选 {selectedCount} 项</span>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={exportSelected}
            style={{ ...primaryBtnStyle, marginLeft: 'auto', padding: '9px 18px', fontSize: 13 }}
          >
            {selectedCount === 0 ? '导出所选资料' : `导出 ${selectedCount} 项资料`}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ---------------- 内联样式（复用 tokens，冷石画廊白） ---------------- */

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  color: PLANNING_TEXT.muted,
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  borderRadius: 999,
  padding: '3px 10px',
};

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 10,
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  background: 'transparent',
  color: PLANNING_SURFACE.panelText,
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  marginLeft: 4,
};

const actStyle: React.CSSProperties = {
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  borderRadius: 12,
  padding: '8px 11px',
  background: '#fff',
  marginBottom: 6,
};

const disabledActStyle: React.CSSProperties = {
  background: PLANNING_SURFACE.fieldBg,
  opacity: 0.55,
  cursor: 'not-allowed',
};

const actRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 };
const mainStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const nameStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const descStyle: React.CSSProperties = { fontSize: 11, color: PLANNING_TEXT.muted, marginTop: 2, lineHeight: 15 };
const iconTileStyle: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, background: PLANNING_SURFACE.fieldBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: PLANNING_TEXT.soft, flex: 'none' };

const rowActionsStyle: React.CSSProperties = { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 };

const primaryBtnStyle: React.CSSProperties = {
  border: '1px solid #141416',
  background: '#141416',
  color: '#fff',
  fontWeight: 600,
  fontSize: 12,
  lineHeight: '20px',
  borderRadius: 10,
  padding: '7px 11px',
  cursor: 'pointer',
  font: 'inherit',
};

const secondaryBtnStyle: React.CSSProperties = {
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  background: '#fff',
  color: PLANNING_TEXT.soft,
  fontSize: 12,
  lineHeight: '20px',
  borderRadius: 9,
  padding: '7px 11px',
  cursor: 'pointer',
  font: 'inherit',
};

const disabledBtnStyle: React.CSSProperties = {
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  background: PLANNING_SURFACE.fieldBg,
  color: PLANNING_TEXT.muted,
  fontSize: 12,
  lineHeight: '20px',
  borderRadius: 9,
  padding: '7px 11px',
  cursor: 'not-allowed',
  font: 'inherit',
};

const checkStyle: React.CSSProperties = {
  flex: 'none',
  width: 18,
  height: 18,
  border: '1.5px solid #e4e4e7',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: 12,
  padding: 0,
};

const checkOnStyle: React.CSSProperties = { background: PLANNING_SURFACE.selectedBorder, borderColor: PLANNING_SURFACE.selectedBorder };

const arrowStyle: React.CSSProperties = {
  flex: 'none',
  width: 24,
  height: 24,
  border: 'none',
  background: 'transparent',
  color: '#a6aab2',
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 7,
};

const subStyle: React.CSSProperties = {
  marginTop: 10,
  paddingTop: 10,
  borderTop: `1px solid ${PLANNING_SURFACE.fieldBg}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
};

const subLabelStyle: React.CSSProperties = { fontSize: 10, color: PLANNING_TEXT.muted, fontWeight: 600, marginBottom: 5 };
const optsStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

const optStyle: React.CSSProperties = {
  fontSize: 11,
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  background: '#fff',
  borderRadius: 8,
  padding: '6px 10px',
  color: PLANNING_TEXT.soft,
  cursor: 'pointer',
};

const optOnStyle: React.CSSProperties = {
  background: PLANNING_SURFACE.activeBg,
  borderColor: PLANNING_SURFACE.selectedBorder,
  color: '#3a6247',
  fontWeight: 600,
};

const noteRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  border: `1px dashed ${PLANNING_SURFACE.panelBorder}`,
  borderRadius: 12,
  padding: '9px 12px',
  background: PLANNING_SURFACE.fieldBg,
  marginBottom: 6,
};

const futureStyle: React.CSSProperties = {
  marginTop: 6,
  border: `1px dashed ${PLANNING_SURFACE.panelBorder}`,
  borderRadius: 12,
  background: PLANNING_SURFACE.fieldBg,
};

const futureHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  width: '100%',
  padding: '9px 12px',
  background: 'transparent',
  border: 'none',
  font: 'inherit',
  cursor: 'pointer',
};

const statusStyle: React.CSSProperties = {
  border: '1px solid #e6d3ac',
  background: '#F7F0E2',
  borderRadius: 12,
  padding: '11px 13px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 6,
};

const statusTitleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: PLANNING_SURFACE.warnText };
const statusMetaStyle: React.CSSProperties = { fontSize: 11, color: PLANNING_TEXT.muted };

const linkBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: PLANNING_SURFACE.fieldBg,
  borderRadius: 9,
  padding: '7px 10px',
};

const previewStyle: React.CSSProperties = {
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  borderRadius: 14,
  background: PLANNING_SURFACE.fieldBg,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const qrRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  borderRadius: 14,
  padding: 12,
};

const qrStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  border: '1.5px dashed #a6aab2',
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#a6aab2',
  fontSize: 10,
  flex: 'none',
};

const statStyle: React.CSSProperties = {
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  borderRadius: 14,
  padding: '6px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  fontSize: 12,
  padding: '6px 0',
  borderBottom: `1px solid ${PLANNING_SURFACE.fieldBg}`,
};

const statKeyStyle: React.CSSProperties = { color: PLANNING_TEXT.muted, width: 74, flex: 'none' };
const dotStyle: React.CSSProperties = { width: 7, height: 7, borderRadius: '50%', flex: 'none' };
