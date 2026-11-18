import { useMemo, useState } from 'react';
import { SHORTCUT_CATALOG } from '../lib/shortcut-catalog';
import type { ShortcutEntry } from '../lib/shortcut-catalog';

type Platform = 'win' | 'mac';
export type ShortcutReferenceMode =
  | 'all'
  | 'build-edit'
  | 'build-transform'
  | 'build-view'
  | 'outdoor'
  | 'annotate'
  | 'limits';
type ModeFilter = ShortcutReferenceMode;

const MODE_FILTERS: readonly { id: ModeFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'build-edit', label: '编辑' },
  { id: 'build-transform', label: '变换' },
  { id: 'build-view', label: '视图' },
  { id: 'outdoor', label: '户外' },
  { id: 'annotate', label: '标注' },
  { id: 'limits', label: '例外' },
];

function splitAlternatives(value: string): string[] {
  return value.split(' / ').map(part => part.trim()).filter(Boolean);
}

function splitChord(value: string, platform: Platform): string[] {
  if (platform === 'mac') {
    const modifierRun = value.match(/^([⌘⌥⇧⌃]+)(.+)$/);
    if (modifierRun) return [...Array.from(modifierRun[1]!), modifierRun[2]!];
  }
  return value.split('+').map(part => part.trim()).filter(Boolean);
}

function Keys({ value, platform }: { value: string; platform: Platform }): JSX.Element {
  return (
    <>
      {splitAlternatives(value).map((chord, chordIndex) => (
        <span className="sc-shortcut-chord" key={`${chord}-${chordIndex}`}>
          {chordIndex > 0 && <span className="sc-shortcut-or">或</span>}
          {splitChord(chord, platform).map((key, keyIndex) => (
            <span className="sc-shortcut-key" key={`${key}-${keyIndex}`}>
              {keyIndex > 0 && platform === 'win' && <span className="sc-shortcut-plus" aria-hidden="true">+</span>}
              <kbd>{key}</kbd>
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/** 搜索时说“cmd / option / del”也要能找到键帽上的符号。 */
function tokenVariants(token: string): readonly string[] {
  switch (token) {
    case 'cmd':
    case 'command':
      return ['⌘'];
    case 'ctrl':
    case 'control':
      return ['ctrl'];
    case 'alt':
    case 'option':
    case 'opt':
      return ['⌥'];
    case 'shift':
      return ['shift', '⇧'];
    case 'del':
    case 'delete':
      return ['delete', '⌫'];
    case 'esc':
    case 'escape':
      return ['esc'];
    case 'return':
      return ['return'];
    case 'enter':
      return ['enter'];
    case 'pageup':
      return ['pageup'];
    case 'pagedown':
      return ['pagedown'];
    case 'backspace':
      return ['backspace'];
    default:
      return [token];
  }
}

function matchesTokens(text: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = normalize(text);
  return tokens.every(token => tokenVariants(token).some(variant => haystack.includes(variant)));
}

function entryHaystack(entry: ShortcutEntry): string {
  return [entry.action, entry.keys.win, entry.keys.mac, entry.note ?? ''].join(' ');
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'win';
  return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`) ? 'mac' : 'win';
}

/**
 * 设置页的快捷键参考。只渲染 catalog 里的真实绑定，不做可编辑键位。
 * 搜索、模式筛选与平台强调都是本地状态，不写存储。
 */
export interface ShortcutReferenceProps {
  /** 画布速查按当前语境先落到某一组；设置页保持「全部」。 */
  initialMode?: ShortcutReferenceMode;
}

export function ShortcutReference({ initialMode = 'all' }: ShortcutReferenceProps = {}): JSX.Element {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ModeFilter>(initialMode);
  const [platform, setPlatform] = useState<Platform>(detectPlatform);

  const visibleGroups = useMemo(() => {
    // `Ctrl+Z` 与 `Ctrl Z` 都拆成两个 token；别名再把 cmd / del 翻成键帽符号。
    const tokens = normalize(query).split(/[\s+]+/).filter(Boolean);
    return SHORTCUT_CATALOG
      .filter(group => mode === 'all' || group.id === mode)
      .map(group => {
        const allNotes = group.notes ?? [];
        const metaMatches = matchesTokens([group.title, group.description ?? ''].join(' '), tokens);
        const matchingEntries = group.entries.filter(entry => matchesTokens(entryHaystack(entry), tokens));
        const matchingNotes = allNotes.filter(note => matchesTokens(note, tokens));

        // 搜到组名但组内条目本身不含关键词时，展示整组；否则只留命中的条目。
        const entries = tokens.length === 0 || (metaMatches && matchingEntries.length === 0)
          ? group.entries
          : matchingEntries;
        const notes = tokens.length === 0 || (metaMatches && matchingNotes.length === 0)
          ? allNotes
          : matchingNotes;

        return { group, entries, notes, visible: entries.length > 0 || notes.length > 0 };
      })
      .filter(item => item.visible);
  }, [mode, query]);

  const entryCount = visibleGroups.reduce((count, item) => count + item.entries.length, 0);
  const noteCount = visibleGroups.reduce((count, item) => count + item.notes.length, 0);
  const filtered = query.trim().length > 0 || mode !== 'all';
  const countText = entryCount === 0 && noteCount > 0
    ? `${noteCount} 条例外说明`
    : `${entryCount} 条操作${noteCount > 0 ? ` · ${noteCount} 条例外` : ''}`;

  const resetFilters = () => {
    setQuery('');
    setMode('all');
  };

  return (
    <div className="sc-shortcut-reference">
      <div className="sc-shortcut-toolbar">
        <div className="sc-shortcut-search" role="search">
          <span className="sc-shortcut-search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              }
            }}
            placeholder="搜索操作、按键或备注，例如：吸附 / G"
            aria-label="搜索快捷键"
            autoComplete="off"
            spellCheck={false}
          />
          {query && <button type="button" className="sc-shortcut-search-clear" aria-label="清除搜索" onClick={() => setQuery('')}>×</button>}
        </div>
        <div className="sc-shortcut-platform-switch" role="group" aria-label="键位显示平台">
          <button type="button" aria-pressed={platform === 'win'} onClick={() => setPlatform('win')}>Windows / Linux</button>
          <button type="button" aria-pressed={platform === 'mac'} onClick={() => setPlatform('mac')}>macOS</button>
        </div>
      </div>

      <div className="sc-shortcut-meta">
        <p className="sc-shortcut-legend">
          <span>按键：左为 Windows / Linux，右为 macOS</span>
          <span>只列当前已绑定的键；切平台只强化，不隐藏另一列</span>
        </p>
        <p className="sc-shortcut-count" role="status">{filtered ? `显示 ${countText}` : `共 ${countText}`}</p>
      </div>

      <div className="sc-shortcut-filters" role="group" aria-label="快捷键模式">
        {MODE_FILTERS.map(item => (
          <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {visibleGroups.length > 0 ? (
        <div className="sc-shortcut-groups">
          {visibleGroups.map(({ group, entries, notes }) => (
            <section key={group.id} className="sc-shortcut-group" aria-labelledby={`sc-shortcut-${group.id}`}>
              <header className="sc-shortcut-group-head">
                <h4 id={`sc-shortcut-${group.id}`}>{group.title}</h4>
                {group.description ? <p>{group.description}</p> : null}
              </header>
              {entries.length > 0 && (
                <dl className="sc-shortcut-list">
                  {entries.map(entry => (
                    <div key={`${group.id}-${entry.action}`} className="sc-shortcut-row">
                      <dt>{entry.action}</dt>
                      <dd>
                        <span className="sc-shortcut-keys">
                          <span className={`sc-shortcut-platform ${platform === 'win' ? 'is-primary' : ''}`} data-platform="win">
                            <Keys value={entry.keys.win} platform="win" />
                          </span>
                          <span className="sc-shortcut-sep" aria-hidden="true">/</span>
                          <span className={`sc-shortcut-platform ${platform === 'mac' ? 'is-primary' : ''}`} data-platform="mac">
                            <Keys value={entry.keys.mac} platform="mac" />
                          </span>
                        </span>
                        {entry.note ? <small>{entry.note}</small> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {notes.length > 0 && (
                <ul className="sc-shortcut-notes">
                  {notes.map(note => <li key={note}>{note}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="sc-shortcut-empty" role="status">
          <strong>没有匹配的快捷键</strong>
          <span>试试操作名、键名，或“漫游 / 锁定”这类例外说明。</span>
          <button type="button" onClick={resetFilters}>清除搜索与筛选</button>
        </div>
      )}
    </div>
  );
}
