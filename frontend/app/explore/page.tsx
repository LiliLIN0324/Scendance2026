'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createResearchArea, lookupPlace } from '@/components/room-organizer/lib/research-area';
import styles from './explore.module.css';
import { ISO_MANIFEST_URL, loadMapRelease } from '@/lib/iso-map-release';
import type { MapRelease } from '@/lib/iso-map-release';
import type { ResearchArea } from '@/components/room-organizer/lib/research-area';
import type { FormEvent } from 'react';

const fallbackImage = '/explore-assets/west-lake.webp';

export default function ExplorePage() {
  const [release, setRelease] = useState<MapRelease>();
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<ResearchArea>();
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'overview' | 'site' | 'drone'>('overview');
  const [showIso, setShowIso] = useState(true);
  const [failedImage, setFailedImage] = useState('');
  const [readyViewer, setReadyViewer] = useState('');
  const [failedViewer, setFailedViewer] = useState('');
  const searchRequest = useRef<AbortController>();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const request = new AbortController();
    void loadMapRelease(ISO_MANIFEST_URL, request.signal).then(setRelease).catch(() => {
      // Keep the bundled overview available if the map publisher is offline.
    });
    return () => {
      request.abort();
      searchRequest.current?.abort();
    };
  }, []);

  function selectMap(next: typeof mode) {
    searchRequest.current?.abort();
    setSearching(false);
    setNotice('');
    setArea(undefined);
    setShowIso(true);
    setMode(next);
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = query.trim();
    if (keyword.length < 2 || searching) return;
    if (keyword.includes('平湖秋月') || ['西湖', '杭州西湖', '西湖风景名胜区'].includes(keyword)) {
      selectMap(keyword.includes('平湖秋月') ? 'site' : 'overview');
      return;
    }
    const request = new AbortController();
    searchRequest.current = request;
    setSearching(true);
    setNotice('');
    try {
      const place = await lookupPlace(keyword, request.signal);
      if (request.signal.aborted) return;
      if (!place) {
        setNotice('暂时无法定位这个地点，请试试城市名加地名。');
        return;
      }
      setArea(createResearchArea(place));
    } catch {
      if (!request.signal.aborted) setNotice('地图搜索暂不可用。');
    } finally {
      if (!request.signal.aborted) setSearching(false);
    }
  }

  const title = area?.name ?? (mode === 'overview' ? '西湖全景' : '平湖秋月');
  let viewer: URL | undefined;
  if (release && !area) {
    viewer = new URL(release.viewer);
    viewer.searchParams.set('scendance', '1');
  }
  const viewerUrl = viewer?.href;
  useEffect(() => {
    if (!viewerUrl) return;
    const activeUrl = viewerUrl;
    const origin = new URL(activeUrl).origin;
    setReadyViewer('');
    setFailedViewer('');
    const timer = window.setTimeout(() => setFailedViewer(viewerUrl), 90000);
    function ready(event: MessageEvent) {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== 'scendance-iso-ready' || event.data?.schemaVersion !== 1) return;
      window.clearTimeout(timer);
      setReadyViewer(activeUrl);
      setFailedViewer('');
    }
    window.addEventListener('message', ready);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', ready);
    };
  }, [viewerUrl]);
  useEffect(() => {
    if (!viewerUrl || readyViewer !== viewerUrl) return;
    frame.current?.contentWindow?.postMessage(
      { type: 'scendance-iso-view', schemaVersion: 1, mode },
      new URL(viewerUrl).origin,
    );
  }, [viewerUrl, readyViewer, mode]);

  const mapImage = area?.imageUrl ?? (showIso ? release?.overview ?? fallbackImage : '/basemap/xihu-scenic-z15.jpg');
  const image = mapImage === failedImage && showIso && !area ? fallbackImage : mapImage;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><Link href="/editor">幕景工作台</Link><h1>地图漫游</h1></div>
        <form className={styles.search} onSubmit={search}>
          <input aria-label="搜索地点" value={query} onChange={event => setQuery(event.target.value)} maxLength={30} placeholder="搜索城市或地点" />
          <button disabled={query.trim().length < 2 || searching}>{searching ? '定位中…' : '定位'}</button>
        </form>
      </header>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <div className={styles.layout}>
        <section className={styles.stage} aria-label={title}>
          {/* The pinned overview also backs the WebGL frame while it starts. */}
          {image === failedImage
            ? <p className={styles.notice}>当前底图加载失败，请重新定位或返回西湖。</p>
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={image} alt={area ? title : '西湖全景底图'} onError={() => setFailedImage(image)} />}
          {viewerUrl && <iframe ref={frame} key={viewerUrl} src={viewerUrl} title={title + '三维底图'} sandbox="allow-scripts allow-same-origin" style={{ visibility: showIso && readyViewer === viewerUrl ? 'visible' : 'hidden' }} />}
          {showIso && viewerUrl && viewerUrl === failedViewer && <p role="status" className={styles.notice}>三维地图暂不可用，正在显示西湖总览。</p>}
          {!area && mode === 'overview' && <button className={styles.poi} onClick={() => selectMap('site')}>定位平湖秋月</button>}
          <div className={styles.credit}>{area || !showIso ? '底图 © 高德地图' : '建筑与路网 © OpenStreetMap 贡献者'}</div>
        </section>
        <aside className={styles.sidebar}>
          <div><h2>{title}</h2><p>{area ? area.address || '通用路网底图' : '杭州 · 西湖风景名胜区'}</p></div>
          {(area || mode !== 'overview') && <button onClick={() => selectMap('overview')}>返回西湖全景</button>}
          <section aria-label="图层">
            <h3>图层</h3>
            <div className={styles.row}><span>通用地图</span><small>{area || !showIso ? '显示中' : '备用'}</small></div>
            {!area && <>
              <button className={styles.row} aria-pressed={showIso} onClick={() => setShowIso(visible => !visible)}><span>西湖 ISO</span><small>{showIso ? '显示中' : '已隐藏'}</small></button>
              {mode !== 'overview' && <div className={styles.row}><span>平湖秋月实景</span><small>待接入</small></div>}
            </>}
          </section>
          <section aria-label="漫游">
            <h3>漫游</h3>
            <button className={styles.row} disabled={!release || Boolean(area)} aria-pressed={!area && mode === 'drone'} onClick={() => selectMap('drone')}><span>无人机</span><small>{area ? '此地暂无航线' : release ? '飞向平湖秋月' : '待载入三维底图'}</small></button>
            <div className={styles.row}><span>步行</span><small>待接入实景与路线</small></div>
            <div className={styles.row}><span>驾车</span><small>待接入道路路线</small></div>
          </section>
          {!area && <small className={styles.version}>底图 {release?.version ?? 'v1.2-2026-11-08 · 总览图'}</small>}
        </aside>
      </div>
    </main>
  );
}
