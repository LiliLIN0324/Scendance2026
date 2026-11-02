/**
 * 左轨三枚入口形体：圆环（Bingo）、帐篷（空间）、等距体块（物料）。
 * 24 格、1.7 描边、圆头圆角，形体里各留一枚实心小点；和门厅品牌标一起
 * 构成左轨的四枚图形，不引入第二套图标库。线条继承 currentColor。
 */
const glyph = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false',
} as const;

/** Bingo：开口圆环，缺口留在正下方。 */
export function BingoGlyph(): JSX.Element {
  return <svg {...glyph}>
    <path d="M10.06 19.25A7.5 7.5 0 1 1 13.94 19.25" />
  </svg>;
}

/** 空间：三角屋顶 + 中轴 + 地面点。 */
export function SpaceGlyph(): JSX.Element {
  return <svg {...glyph}>
    <path d="M12 4.2 20.4 19.4H3.6Z" />
    <path d="M12 4.2v11.6" />
    <circle cx="12" cy="17.85" r="1.25" fill="currentColor" stroke="none" />
  </svg>;
}

/** 物料：等距方块，点在右面。 */
export function MaterialsGlyph(): JSX.Element {
  return <svg {...glyph}>
    <path d="M12 3.6 20.2 8.2 12 12.8 3.8 8.2Z" />
    <path d="M3.8 8.2v8.2L12 21.2v-8.4" />
    <path d="M20.2 8.2v8.2L12 21.2" />
    <circle cx="16.35" cy="14.2" r="1.25" fill="currentColor" stroke="none" />
  </svg>;
}
