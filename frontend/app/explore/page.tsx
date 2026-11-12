'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  createResearchArea,
  lookupPlace,
  DEFAULT_RESEARCH_RADIUS_M,
  RESEARCH_SATELLITE_STYLE,
  XIHU_LOCAL_NAME,
  XIHU_LOCAL_PLACE,
} from '@/components/room-organizer/lib/research-area';
import styles from './explore.module.css';
import type { ResearchArea } from '@/components/room-organizer/lib/research-area';
import type { FormEvent } from 'react';

const fallbackImage = '/explore-assets/west-lake.webp';

export default function ExplorePage() {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<ResearchArea>();
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState('');
  const [failedImage, setFailedImage] = useState('');
  const searchRequest = useRef<AbortController>();

  useEffect(() => () => {
    searchRequest.current?.abort();
  }, []);

  function showPinghu() {
    searchRequest.current?.abort();
    setSearching(false);
    setNotice('');
    setArea(createResearchArea(XIHU_LOCAL_PLACE, DEFAULT_RESEARCH_RADIUS_M, RESEARCH_SATELLITE_STYLE));
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = query.trim();
    if (keyword.length < 2 || searching) return;
    if (keyword.includes('平湖秋月') || ['西湖', '杭州西湖', '西湖风景名胜区'].includes(keyword)) {
      showPinghu();
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

  const title = area?.name ?? XIHU_LOCAL_NAME;
  const image = area?.imageUrl ?? fallbackImage;

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
          {image === failedImage
            ? <p className={styles.notice}>当前底图加载失败，请重新定位或返回西湖。</p>
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={image} alt={area ? title : '西湖总览底图'} onError={() => setFailedImage(image)} />}
          {!area && <button className={styles.poi} onClick={showPinghu}>定位平湖秋月</button>}
          <div className={styles.credit}>{area ? '底图 © 高德地图' : '图片 © OpenStreetMap 贡献者'}</div>
        </section>
        <aside className={styles.sidebar}>
          <div><h2>{title}</h2><p>{area ? area.address || '通用路网底图' : '杭州 · 西湖风景名胜区'}</p></div>
          {area && <button onClick={showPinghu}>返回平湖秋月</button>}
          <section aria-label="图层">
            <h3>图层</h3>
            <div className={styles.row}><span>通用地图</span><small>显示中</small></div>
          </section>
          <section aria-label="漫游">
            <h3>漫游</h3>
            <div className={styles.row}><span>步行</span><small>待接入实景与路线</small></div>
            <div className={styles.row}><span>驾车</span><small>待接入道路路线</small></div>
          </section>
        </aside>
      </div>
    </main>
  );
}
