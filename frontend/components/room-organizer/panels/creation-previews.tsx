/**
 * 创作卡预览台里的自有示意。凝土色实体，不是线稿，也不是别的产品的模型。
 * 只在「文生 / 图生」两张卡上当摆设，点开始创作不会把它们送去生成。
 */

export function ConcreteFoldingChair(): JSX.Element {
  return (
    <svg className="gs-create-figure" viewBox="0 0 240 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gs-chair-back" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E4E0D9" />
          <stop offset="1" stopColor="#C4C0B8" />
        </linearGradient>
        <linearGradient id="gs-chair-seat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F1EEE8" />
          <stop offset="1" stopColor="#D4D0C8" />
        </linearGradient>
        <linearGradient id="gs-chair-leg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9A968F" />
          <stop offset="1" stopColor="#6F6C66" />
        </linearGradient>
      </defs>
      <ellipse cx="124" cy="182" rx="62" ry="8" fill="rgba(20,20,22,0.10)" />
      <g fill="none" stroke="#C8C4BC" strokeWidth="7" strokeLinecap="round">
        <path d="M98 116 L168 176" />
        <path d="M166 112 L102 174" />
      </g>
      <path d="M150 38 L166 46 L172 114 L156 108 Z" fill="#A7A39C" />
      <path d="M76 44 C86 36 136 30 152 38 L156 108 C146 116 92 124 82 116 Z" fill="url(#gs-chair-back)" />
      <path d="M156 108 L172 114 L168 122 L152 116 Z" fill="#8E8A84" />
      <path d="M92 146 L186 132 L186 144 L92 158 Z" fill="#AEA9A2" />
      <path d="M68 114 L92 146 L92 158 L68 126 Z" fill="#C9C5BD" />
      <path d="M68 114 L156 102 L186 132 L92 146 Z" fill="url(#gs-chair-seat)" />
      <path d="M78 118 L150 108" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="3" strokeLinecap="round" />
      <g fill="none" stroke="url(#gs-chair-leg)" strokeWidth="8.5" strokeLinecap="round">
        <path d="M62 126 L134 188" />
        <path d="M130 122 L66 184" />
      </g>
      <circle cx="98" cy="154" r="5" fill="#5E5B56" />
      <circle cx="98" cy="154" r="2.2" fill="#D9D5CE" />
    </svg>
  );
}

export function ConcreteWayfindingSign(): JSX.Element {
  return (
    <svg className="gs-create-figure" viewBox="0 0 240 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gs-sign-board" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E7E3DC" />
          <stop offset="1" stopColor="#CFCBC3" />
        </linearGradient>
        <linearGradient id="gs-sign-post" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#D5D1CA" />
          <stop offset="0.35" stopColor="#B7B3AC" />
          <stop offset="1" stopColor="#8A867F" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="184" rx="46" ry="8" fill="rgba(20,20,22,0.10)" />
      <ellipse cx="120" cy="174" rx="28" ry="8" fill="#B7B3AC" />
      <ellipse cx="120" cy="170" rx="28" ry="8" fill="#D8D4CD" />
      <rect x="112" y="116" width="16" height="56" rx="3" fill="url(#gs-sign-post)" />
      <path d="M178 52 L192 38 V112 L178 126 Z" fill="#A8A49D" />
      <path d="M46 52 L60 38 H192 L178 52 Z" fill="#F4F1EC" />
      <rect x="46" y="52" width="132" height="74" rx="8" fill="url(#gs-sign-board)" />
      <rect x="58" y="64" width="108" height="50" rx="4" fill="#E4E0D9" />
      <path d="M54 60 V118" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
