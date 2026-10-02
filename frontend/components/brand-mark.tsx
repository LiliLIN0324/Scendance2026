/**
 * The product mark: three leaning bars, darkest-teal to white (#brand).
 *
 * This is the single source of the logo. It is an SVG rather than three styled spans so the
 * app header, the landing page, the confirmation card and the browser icon
 * (`app/icon.svg`, same geometry) cannot drift apart, and so it stays sharp at any size.
 *
 * The viewBox is the geometry the header always used: a 32×36 box whose bars lean by
 * `skewY(-15°)`, sized 22 / 34 / 27 px tall with 7px widths and 3px gaps.
 */
export interface BrandMarkProps {
  /** Height of the mark in px; the width follows the 32:36 ratio. */
  size?: number;
  className?: string;
}

export function BrandMark({ size = 36, className }: BrandMarkProps): JSX.Element {
  return <svg className={className} viewBox="0 -4.3 32 36" width={(size * 32) / 36} height={size}
    fill="none" aria-hidden="true" focusable="false">
    <g transform="skewY(-15)">
      <rect x="2.5" y="7" width="7" height="22" rx="1" fill="#ffffff" />
      <rect x="12.5" y="1" width="7" height="34" rx="1" fill="#8fb8b5" />
      <rect x="22.5" y="4.5" width="7" height="27" rx="1" fill="#0e7c78" />
    </g>
  </svg>;
}
