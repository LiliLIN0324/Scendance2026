/**
 * The product mark 「门厅」: a solid ink block (the venue) with an arched doorway
 * cut into its bottom edge, and a sage-green circle (the arriving guest) standing
 * in the opening. 方为空间、圆为人——Scendance = scene + attendance.
 *
 * Geometry lives on a 48 grid with a 40-unit live area (4-unit optical padding):
 * outer radius 10, doorway 20 wide with an r10 arch, guest d10 at (24, 35) —
 * 5 units clear of the arch, 4 units clear of the sill, so the circle never
 * touches a line (v1 failed by letting the two tangent at zero clearance).
 * Path is always ink (#141416); accent circle is always brand green (#4A7C59).
 */
export interface BrandMarkProps {
  /** Height of the mark in px; the mark is square, so width equals height. */
  size?: number;
  className?: string;
}

export function BrandMark({ size = 28, className }: BrandMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M14,4 H34 A10,10 0 0 1 44,14 V34 A10,10 0 0 1 34,44 H14 A10,10 0 0 1 4,34 V14 A10,10 0 0 1 14,4 Z M14,44 V34 A10,10 0 0 1 34,34 V44 Z"
      />
      <circle cx="24" cy="35" r="5" fill="#4A7C59" />
    </svg>
  );
}