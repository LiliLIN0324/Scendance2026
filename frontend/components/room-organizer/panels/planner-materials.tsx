'use client';

import { useMemo, useState } from 'react';
import { useRoomEditor } from '../contexts';
import { EVENT_CATALOG } from '../lib/constants';
import { ScendanceLibrary } from './scendance-workspace';

type LibraryProps = Parameters<typeof ScendanceLibrary>[0];

const FIRST = ['table', 'chair', 'reception', 'backdrop'] as const;

/**
 * 第一次摆东西：点桌子或椅子，它进到场地上。
 * 生成、收藏、导入和整库是「库里没有这件」时才展开，不跟第一下摆放并列。
 */
export function PlannerMaterials(props: LibraryProps): JSX.Element {
  const { layout } = useRoomEditor();
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState(false);
  const [notice, setNotice] = useState('');
  const needle = query.trim();
  const matches = useMemo(() => {
    const list = EVENT_CATALOG.filter(item => !needle || item.name.includes(needle));
    if (!needle) return EVENT_CATALOG.filter(item => (FIRST as readonly string[]).includes(item.materialId ?? ''));
    return list;
  }, [needle]);

  const place = (materialId: string) => {
    const item = EVENT_CATALOG.find(entry => entry.materialId === materialId);
    if (!item) return;
    const id = props.placeCatalogItem(item, {
      x: layout.width / 2 - item.width / 2 - 0.4,
      z: -(layout.height / 2 - item.depth / 2 - 0.4),
    });
    setNotice(id ? `「${item.name}」已放到场地上，可以拖动。` : `「${item.name}」这次没放成。`);
  };

  return (
    <div className="sc-planner" aria-label="摆东西">
      <p className="sc-planner-lead">点一件，就放到场地中间。</p>
      <label className="sc-planner-search">找一件
        <input aria-label="找物料" value={query} placeholder="椅子、桌子、签到台" onChange={event => setQuery(event.target.value)} />
      </label>
      {matches.length > 0
        ? <ul className="sc-planner-items">
          {matches.map(item => (
            <li key={item.materialId}>
              <button type="button" onClick={() => place(item.materialId ?? '')}>{item.name}</button>
            </li>
          ))}
        </ul>
        : <p className="sc-planner-note">这几件常用的里没有「{needle}」。可以打开下面的库，或做一件没有的。</p>}
      {notice && <p className="sc-planner-note" role="status">{notice}</p>}
      <button type="button" className="sc-planner-quiet" aria-expanded={library} onClick={() => setLibrary(value => !value)}>
        {library ? '收起库' : '从库里找别的，或做一件没有的'}
      </button>
      {library && <ScendanceLibrary {...props} />}
    </div>
  );
}
