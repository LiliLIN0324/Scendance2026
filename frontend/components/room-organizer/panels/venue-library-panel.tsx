'use client';

import { Store } from 'lucide-react';
import { useState } from 'react';
import { useVenueLibrary } from '../hooks/use-venue-library';
import {
  VENUE_TEMPLATES,
  venueEntryClassName,
  type VenueTemplate,
} from '../lib/venue-library';
import './venue-library-panel.css';

/**
 * 窄轨上的场地。只留图标。
 * 位置在锁标、晴光、草稿之后，不进轨脚，也不进会话史。
 * 没被 3D 意图点亮时带 is-muted，仍可点开库。
 */
export function VenueRailButton({ open, lit, onToggle }: {
  open: boolean;
  lit: boolean;
  onToggle(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={venueEntryClassName('sc-rail-venue', lit, open)}
      aria-pressed={open}
      aria-label="场地"
      data-venue-lit={lit ? '1' : '0'}
      data-tip="场地"
      title="场地"
      onClick={onToggle}
    >
      <Store size={22} aria-hidden="true" />
    </button>
  );
}

/**
 * 场地库。挂在主画布上，不替换晴光。
 * 「我的场地」开局为空；模板可参观或收进本机收藏，不加载模型。
 */
export function VenueLibraryPanel({ onClose }: { onClose(): void }): JSX.Element {
  const library = useVenueLibrary();
  const [detail, setDetail] = useState<VenueTemplate | null>(null);
  const savedIds = new Set(library.venues.map(item => item.templateId));

  return (
    <aside className="sc-venue-library" aria-label="场地库">
      <header className="sc-venue-library-head">
        <h2>场地</h2>
        <button type="button" onClick={onClose}>收起</button>
      </header>
      {detail && (
        <section className="sc-venue-detail" aria-label="场地详情">
          <span className="sc-venue-swatch" style={{ background: detail.swatch }} aria-hidden="true" />
          <div>
            <strong>{detail.name}</strong>
            <p>{detail.blurb}</p>
            <p>参观占位。</p>
          </div>
        </section>
      )}
      <section className="sc-venue-section" aria-label="我的场地">
        <h3>我的场地</h3>
        {library.venues.length === 0 ? (
          <p className="sc-venue-empty">还没有收藏的经营地点。</p>
        ) : (
          <ul className="sc-venue-list">
            {library.venues.map(venue => (
              <li key={venue.id}>
                <span className="sc-venue-swatch" style={{ background: venue.swatch }} aria-hidden="true" />
                <span className="sc-venue-copy">
                  <strong>{venue.name}</strong>
                  <small>{venue.blurb}</small>
                </span>
                <button type="button" onClick={() => setDetail(venue)}>打开</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="sc-venue-section" aria-label="可参观模板">
        <h3>可参观 / 模板</h3>
        <ul className="sc-venue-list">
          {VENUE_TEMPLATES.map(template => {
            const saved = savedIds.has(template.id);
            return (
              <li key={template.id}>
                <span className="sc-venue-swatch" style={{ background: template.swatch }} aria-hidden="true" />
                <span className="sc-venue-copy">
                  <strong>{template.name}</strong>
                  <small>{template.blurb}</small>
                </span>
                <span className="sc-venue-actions">
                  <button type="button" onClick={() => setDetail(template)}>参观</button>
                  <button
                    type="button"
                    aria-pressed={saved}
                    onClick={() => {
                      library.saveTemplate(template.id);
                      setDetail(template);
                    }}
                  >{saved ? '已收藏' : '用作模板'}</button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      {library.saveFailed && <p className="sc-venue-save" role="status">这场收藏没能写进本机</p>}
    </aside>
  );
}
