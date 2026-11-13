'use client';

/**
 * Bingo「按风格配一套」：内置色调 + 提示词自存。
 * 点一套就整组落画布；也可写一句风格提示词存下来下次再用。
 */
import { useMemo, useState } from 'react';
import {
  deleteCustomStyle,
  listStyleBundles,
  saveCustomStyle,
  STYLE_SET_OPTIONS,
  type StyleBundle,
} from '../lib/style-bundles';
import './style-bundle-panel.css';

function StyleThumb({ bundle, small = false }: { bundle: StyleBundle; small?: boolean }): JSX.Element {
  return <span className={`sc-style-thumb${small ? ' is-small' : ''}`} aria-hidden="true">
    {bundle.swatches.map(color => <span className="sc-style-swatch" key={`${bundle.key}-${color}`} style={{ background: color }}/>)}
  </span>;
}

export function StyleBundlePanel({ disabled = false, paletteOnly = false, note, onPick, onClose }: {
  disabled?: boolean;
  paletteOnly?: boolean;
  note?: string;
  onPick(bundle: StyleBundle): void;
  onClose?(): void;
}): JSX.Element {
  const [tick, setTick] = useState(0);
  const bundles = useMemo(() => listStyleBundles(window.localStorage).filter(b=>!paletteOnly||!['home-office','bedroom'].includes(b.setKey)), [tick,paletteOnly]);
  const custom = bundles.filter(bundle => bundle.custom);
  const presets = bundles.filter(bundle => !bundle.custom);
  const [prompt, setPrompt] = useState('');
  const [setKey, setSetKey] = useState<string>('lounge');
  const [formNote, setFormNote] = useState('');

  const save = () => {
    const normalizedPrompt = prompt.trim();
    const styleName = normalizedPrompt
      .replace(/^(想要|希望|请帮我|帮我|做一个|做一套|需要|来一个)/u, '')
      .split(/[，。；、,.!?！？\n]/u)[0]
      .trim()
      .slice(0, 20) || '我的灵感';
    const result = saveCustomStyle({ name: styleName, prompt: normalizedPrompt, setKey }, window.localStorage);
    if (!result.ok) { setFormNote(result.message); return; }
    setFormNote(`收到，我按「${result.bundle.name}」来配一套。`);
    setPrompt('');
    setTick(value => value + 1);
    onPick(result.bundle);
  };

  return <div className="sc-style-panel" role="dialog" aria-label="按风格配一套">
    <header className="sc-style-panel-head">
      <div>
        <strong>按风格配一套</strong>
        <p>{paletteOnly?'现有设施配色预览；不新增模板物件、不改变占地或通路。':'选一套气质，或写一句提示词存成自己的风格。'}</p>
      </div>
      {onClose && <button type="button" className="sc-style-panel-close" aria-label="关闭风格套" onClick={onClose}>收起</button>}
    </header>

    <div className="sc-style-options" aria-label="风格卡片列表">
      {custom.length > 0 && <>
        <p className="sc-style-section">我存的风格</p>
        <ul className="sc-style-list" aria-label="自存风格">
          {custom.map(bundle => <li key={bundle.key}>
            <button
              type="button"
              className="sc-style-btn"
              disabled={disabled}
              onClick={() => onPick(bundle)}
              aria-label={`按${bundle.name}配一套`}
              title={`${bundle.prompt}\n${bundle.note}`}
            >
              <StyleThumb bundle={bundle}/>
              <span className="sc-style-body">
                <strong>{bundle.name}</strong>
                <small>{bundle.prompt}</small>
              </span>
            </button>
            <button
              type="button"
              className="sc-style-remove"
              aria-label={`删除风格 ${bundle.name}`}
              disabled={disabled}
              onClick={() => { deleteCustomStyle(bundle.key, window.localStorage); setTick(value => value + 1); }}
            >删除</button>
          </li>)}
        </ul>
      </>}

      <p className="sc-style-section">推荐风格</p>
      <ul className="sc-style-list" aria-label="风格套">
        {presets.map(bundle => <li key={bundle.key}>
          <button
            type="button"
            className="sc-style-btn"
            disabled={disabled}
            onClick={() => onPick(bundle)}
            aria-label={`按${bundle.name}配一套`}
            title={`${bundle.prompt}\n${bundle.note}`}
          >
            <StyleThumb bundle={bundle}/>
            <span className="sc-style-body">
              <strong>{bundle.name}</strong>
              <small>{bundle.prompt}</small>
            </span>
          </button>
        </li>)}
      </ul>
    </div>

    <form className="sc-style-save" aria-label="描述想要的布置风格" onSubmit={event => { event.preventDefault(); save(); }}>
      <p className="sc-style-section">说说你想要的感觉</p>
      <label className="sc-style-field sc-style-prompt-field">
        <textarea aria-label="描述想要的空间氛围" value={prompt} maxLength={80} disabled={disabled} placeholder="比如：雾蓝色、安静克制，带一点金属感，适合新品发布会" onChange={event => setPrompt(event.target.value)}/>
      </label>
      {!paletteOnly && <fieldset className="sc-style-sets">
        <legend>这套主要用在</legend>
        <div className="sc-style-set-chips">
          {STYLE_SET_OPTIONS.map(option => <button
            key={option.key}
            type="button"
            aria-pressed={setKey === option.key}
            disabled={disabled}
            onClick={() => setSetKey(option.key)}
          >{option.label}</button>)}
        </div>
      </fieldset>}
      <button type="submit" className="sc-style-save-act" disabled={disabled || !prompt.trim()}>{paletteOnly?'预览这套配色':'让 Bingo 按这个感觉配一套'}</button>
      {(formNote || note) && <p className="sc-style-note" role="status">{formNote || note}</p>}
    </form>
  </div>;
}

export function StyleBundleThumb({ bundle, small }: { bundle: StyleBundle; small?: boolean }): JSX.Element {
  return <StyleThumb bundle={bundle} {...(small === undefined ? {} : { small })}/>;
}
