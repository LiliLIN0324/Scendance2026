/**
 * The product mark: three parallelogram bars from the v2.4 design mock (幕景 logo).
 * Geometry matches scendance-figma upgrade states `#logo-mark` (fill #56794d).
 */
export interface BrandMarkProps {
  /** Height of the mark in px; width follows the design viewBox ratio. */
  size?: number;
  className?: string;
}

export function BrandMark({ size = 31, className }: BrandMarkProps): JSX.Element {
  const height = size;
  const width = (size * 29) / 31;
  return (
    <svg
      className={className}
      viewBox="23.5 16.5 29 31"
      width={width}
      height={height}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M24 22.95 31 20.1V44.1L24 46.95Z" fill="#56794d" />
      <path d="M34.5 19.75 41.5 17.2V40.9L34.5 43.6Z" fill="#56794d" />
      <path d="M45 17.05 52 20V38.05L45 40.95Z" fill="#56794d" />
    </svg>
  );
}
