import { SHORTCUT_CATALOG } from '../lib/shortcut-catalog';

function Keys({ value }: { value: string }): JSX.Element {
  return (
    <>
      {value.split(' / ').map((key, index) => (
        <kbd key={`${key}-${index}`}>{key}</kbd>
      ))}
    </>
  );
}

/**
 * 设置页的快捷键参考。只渲染 catalog 里的真实绑定，不做可编辑键位。
 */
export function ShortcutReference(): JSX.Element {
  return (
    <div className="sc-shortcut-reference">
      <p className="sc-shortcut-legend">
        <span>按键：左为 Windows / Linux，右为 macOS</span>
        <span>只列当前已绑定的键</span>
      </p>
      <div className="sc-shortcut-groups">
        {SHORTCUT_CATALOG.map(group => (
          <section key={group.id} className="sc-shortcut-group" aria-labelledby={`sc-shortcut-${group.id}`}>
            <header className="sc-shortcut-group-head">
              <h4 id={`sc-shortcut-${group.id}`}>{group.title}</h4>
              {group.description ? <p>{group.description}</p> : null}
            </header>
            {group.entries.length > 0 && (
              <dl className="sc-shortcut-list">
                {group.entries.map(entry => (
                  <div key={`${group.id}-${entry.action}`} className="sc-shortcut-row">
                    <dt>{entry.action}</dt>
                    <dd>
                      <span className="sc-shortcut-keys">
                        <Keys value={entry.keys.win} />
                        <span className="sc-shortcut-sep" aria-hidden="true">/</span>
                        <Keys value={entry.keys.mac} />
                      </span>
                      {entry.note ? <small>{entry.note}</small> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {group.notes && group.notes.length > 0 && (
              <ul className="sc-shortcut-notes">
                {group.notes.map(note => <li key={note}>{note}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
