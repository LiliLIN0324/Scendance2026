import { Suspense } from 'react';
import { BootSkeleton, WorkspaceShell } from '@/components/workspace-shell';
import { AuthProvider } from '@/lib/auth-provider';
import { Inter, Noto_Sans_SC, Playfair_Display } from 'next/font/google';
import type { Metadata } from 'next';
import './globals.css';
import './cloud.css';
import './auth.css';
import './workspace.css';
import './assets.css';
import './share.css';

// 设计规范 v2.3 裁决：西文与数字 = Inter，Arial 只做降级。next/font 在构建时
// 自托管字体文件，运行时不依赖 Google CDN（部署在大陆也可用）。
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-sc',
  display: 'swap',
});

// 品牌字标衬线定版：英文 Playfair Display，S 用 Italic 500 做锚点。
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '幕景 Scendance · 活动布置工作台',
  description: '用真实三维物料规划活动场地，与团队协作保存布置方案。',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Stale-chunk recovery for the GitHub Pages static export. index.html is cached
// for ~10 min, so a returning visitor within that window loads cached HTML whose
// hashed `_next/static/chunks/*.js` URLs were replaced by the new deploy and now
// 404 — breaking the app before any React code runs. Two guarded recovery paths,
// inline in <head> so they run before the app chunks:
//   1. A capture-phase resource-error / unhandledrejection listener (fast path).
//   2. A watchdog: if the editor hasn't signalled ready within 20 s (the stuck
//      "Loading the lot…" state), reload once. This catches failures the error
//      events miss. `window.__pcReady` is set once the editor module loads
//      (see app/page.tsx). The generous timeout avoids spurious reloads on
//      slow connections, and the sessionStorage guard makes the reload
//      one-shot either way.
const CHUNK_RECOVERY_SCRIPT = `(function(){
  var K='pc-chunk-reload';
  function reloadOnce(){
    try{ if(sessionStorage.getItem(K)==='1') return; sessionStorage.setItem(K,'1'); }catch(e){}
    location.reload();
  }
  window.addEventListener('error',function(e){
    var t=e&&e.target;
    if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')){
      var u=t.src||t.href||'';
      if(u.indexOf('/_next/static/')!==-1) reloadOnce();
    }
  },true);
  window.addEventListener('unhandledrejection',function(e){
    var r=e&&e.reason, m=r?(r.name+' '+r.message):String(r||'');
    if(/ChunkLoadError|Loading chunk|dynamically imported module/i.test(m)) reloadOnce();
  });
  setTimeout(function(){ if(location.pathname==='/' && !window.__pcReady) reloadOnce(); }, 20000);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Extensions such as Trancy inject root attributes before hydration.
  // Limit the escape hatch to html; descendants still validate normally.
  return (
    <html lang="zh-CN" suppressHydrationWarning className={`${inter.variable} ${notoSansSC.variable} ${playfair.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${notoSansSC.variable} ${playfair.variable}`}><Suspense fallback={<BootSkeleton />}><AuthProvider><WorkspaceShell>{children}</WorkspaceShell></AuthProvider></Suspense></body>
    </html>
  );
}
