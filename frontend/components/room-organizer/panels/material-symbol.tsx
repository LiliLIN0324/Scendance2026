import type { CSSProperties, HTMLAttributes } from 'react';
import { MATERIAL_SYMBOL_CODEPOINTS } from '@/components/material-symbol-codepoints';

// IconPark SVG paths (Apache 2.0). Their filled theme uses a solid lens and
// white negative-space symbols, matching the zoom/search family in the spec.
const ICON_PARK_LOUPE_PATHS: Record<string, { lens: string; detail?: string }> = {
  iconpark_search_solid: {
    lens: 'M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z',
    detail: 'M26.657 14.3431C25.2093 12.8954 23.2093 12 21.0001 12C18.791 12 16.791 12.8954 15.3433 14.3431',
  },
  iconpark_zoom_in_solid: {
    lens: 'M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z',
    detail: 'M21 15L21 27M15.0156 21.0156L27 21',
  },
  iconpark_zoom_out_solid: {
    lens: 'M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z',
    detail: 'M15 21L27 21',
  },
};

// These source glyphs looked noticeably lighter in the variable font at wght
// 300. Use their official Material Symbols Rounded filled SVG counterparts.
const MATERIAL_SYMBOL_FILLED_SVG_ASSETS = new Set([
  'corporate_fare', 'groups', 'select_all', 'ios_share',
  'undo', 'redo', 'arrow_upward', 'attach_file', 'more_horiz',
  'progress_activity', 'refresh', 'replay', 'autorenew', 'fullscreen',
  'fullscreen_exit', 'tune',
]);

/** Bundled Google Material Symbols Rounded variable glyphs with one shared visual grade. */
export interface MaterialSymbolProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number;
}

export function MaterialSymbol({ name, size = 20, className, style: customStyle, 'aria-label': ariaLabel, 'aria-hidden': ariaHidden, ...props }: MaterialSymbolProps): JSX.Element {
  const opticalSize = Math.max(20, Math.min(48, size));
  const codePoint = MATERIAL_SYMBOL_CODEPOINTS[name];
  // 2026-11-12：码点表没有的名字会**静默渲染成空白**（户外右轨的 square_foot / expand_more
  // 就这样空过）。开发态留一条告警，避免再出现「按钮没图标」却查不到原因。
  if (!codePoint && !ICON_PARK_LOUPE_PATHS[name] && !MATERIAL_SYMBOL_FILLED_SVG_ASSETS.has(name)
    && typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn(`[MaterialSymbol] 未登记的图标名：${name}`);
  }
  const loupePaths = ICON_PARK_LOUPE_PATHS[name];
  const renderedSvgSize = size * 0.78;
  const materialSvgStyle: CSSProperties = {
    width: size,
    height: size,
    flex: 'none',
    backgroundColor: 'currentColor',
    maskImage: `url('/material-symbols/rounded/${name}-fill.svg')`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: 'contain',
    WebkitMaskImage: `url('/material-symbols/rounded/${name}-fill.svg')`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: 'contain',
  };
  const style: CSSProperties = {
    ...customStyle,
    display: 'inline-flex',
    flex: 'none',
    width: size,
    height: size,
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '"Material Symbols Rounded"',
    fontSize: size,
    fontWeight: 300,
    fontStyle: 'normal',
    lineHeight: 1,
    letterSpacing: 'normal',
    fontFeatureSettings: 'normal',
    fontVariationSettings: `"FILL" 1, "wght" 300, "GRAD" 0, "opsz" ${opticalSize}`,
    textTransform: 'none',
    whiteSpace: 'nowrap',
  };

  return <span {...props} className={['sc-material-symbol', className].filter(Boolean).join(' ')} style={style} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : (ariaHidden ?? true)} role={ariaLabel ? 'img' : undefined}>{loupePaths ? <svg width={renderedSvgSize} height={renderedSvgSize} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><path d={loupePaths.lens} fill="currentColor" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />{loupePaths.detail && <path d={loupePaths.detail} stroke={name === 'iconpark_search_solid' ? 'currentColor' : '#fff'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}<path d="M33.2216 33.2217L41.7069 41.707" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg> : MATERIAL_SYMBOL_FILLED_SVG_ASSETS.has(name) ? <span style={materialSvgStyle} aria-hidden="true" /> : codePoint ? String.fromCodePoint(codePoint) : ''}</span>;
}
