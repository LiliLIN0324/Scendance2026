/** 左轨「空间」：三颗等距立方体，对照产品稿里的立方簇。 */
export function SpaceIcon({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 1.6 17 4.3v5.4L12 12.4 7 9.7V4.3L12 1.6Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/>
      <path d="M12 4.4v5.2M7 4.3 12 7.1 17 4.3" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/>
      <path d="M3.2 10.4 8.2 13.1v5.4l-5-2.7v-5.4Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/>
      <path d="M3.2 13.1 8.2 15.8M8.2 13.1v5.4" stroke="currentColor" strokeWidth="1.35"/>
      <path d="M15.8 13.1 20.8 10.4v5.4l-5 2.7v-5.4Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/>
      <path d="M15.8 15.8 20.8 13.1M15.8 13.1v5.4" stroke="currentColor" strokeWidth="1.35"/>
    </svg>
  );
}
