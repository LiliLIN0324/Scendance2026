/** Product mark: the green Door Hall agent avatar, matching the shared agent identity system. */
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
      <image href="/assets/rail/door.png" x="4" y="4" width="40" height="40" preserveAspectRatio="none" />
      <rect x="16.5" y="17.1" width="4.2" height="9.4" rx="2.1" transform="rotate(12 16.5 17.1)" fill="white" />
      <rect x="25.4" y="16.3" width="4.2" height="9.4" rx="2.1" transform="rotate(12 25.4 16.3)" fill="white" />
    </svg>
  );
}
