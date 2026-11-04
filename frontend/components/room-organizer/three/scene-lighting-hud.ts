export type SceneLightingHudView = Readonly<{
  visible: boolean;
  /** 自动匹配得到的基准曝光。 */
  reference: number;
  /** 人工覆盖系数，1 = 完全使用自动匹配。 */
  override: number;
  /** 场景感知亮度 0..1。 */
  perceived: number;
  /** 场景色温估计（K）。 */
  kelvin: number;
}>;

export type SceneLightingHudHandlers = Readonly<{
  onExposure(delta: number): void;
  onReset(): void;
}>;

const HAIRLINE = '1px solid rgba(86, 78, 66, 0.16)';
const PAPER = 'rgba(253, 252, 249, 0.92)';
const INK = 'rgba(62, 58, 52, 0.82)';
const MUTED = 'rgba(62, 58, 52, 0.55)';

/**
 * 光照角标：画布左下角一个 ⓘ 圆钮，点开只有一行场景摘要和一个曝光微调，
 * 没有面板、没有滑块墙。图标本身就是入口，文案全部收进浮层里。
 */
export function createSceneLightingHud(
  container: HTMLElement,
  handlers: SceneLightingHudHandlers
): Readonly<{ update(view: SceneLightingHudView): void; dispose(): void }> {
  const root = document.createElement('div');
  root.dataset.testid = 'scene-lighting-hud';
  Object.assign(root.style, {
    position: 'absolute',
    left: '16px',
    bottom: '16px',
    zIndex: '401',
    display: 'none',
    fontFamily: 'inherit',
    userSelect: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.role = 'trigger';
  button.title = '场景光照匹配';
  button.setAttribute('aria-label', '场景光照匹配');
  Object.assign(button.style, {
    width: '24px',
    height: '24px',
    padding: '0',
    borderRadius: '999px',
    border: HAIRLINE,
    background: PAPER,
    backdropFilter: 'blur(6px)',
    color: MUTED,
    fontSize: '13px',
    lineHeight: '22px',
    fontStyle: 'normal',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  } satisfies Partial<CSSStyleDeclaration>);
  button.textContent = 'i';
  button.style.fontFamily = 'Georgia, "Times New Roman", serif';

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute',
    left: '0',
    bottom: '32px',
    width: '196px',
    padding: '10px 12px',
    borderRadius: '10px',
    border: HAIRLINE,
    background: PAPER,
    backdropFilter: 'blur(10px)',
    boxShadow: '0 8px 24px rgba(40, 34, 26, 0.08)',
    color: INK,
    fontSize: '12px',
    lineHeight: '17px',
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = '光照已随场景匹配';
  Object.assign(title.style, { fontWeight: '500', color: INK, marginBottom: '2px' } satisfies Partial<CSSStyleDeclaration>);

  const meta = document.createElement('div');
  Object.assign(meta.style, { color: MUTED, fontVariantNumeric: 'tabular-nums' } satisfies Partial<CSSStyleDeclaration>);

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px',
    paddingTop: '8px', borderTop: HAIRLINE,
  } satisfies Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.textContent = '曝光';
  Object.assign(label.style, { color: MUTED, flex: '0 0 auto' } satisfies Partial<CSSStyleDeclaration>);

  const value = document.createElement('span');
  Object.assign(value.style, {
    flex: '1 1 auto', textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: INK,
  } satisfies Partial<CSSStyleDeclaration>);

  const nudge = (delta: number, text: string) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    Object.assign(el.style, {
      width: '20px', height: '20px', padding: '0', borderRadius: '6px', border: HAIRLINE,
      background: 'transparent', color: INK, cursor: 'pointer', fontSize: '13px', lineHeight: '18px',
    } satisfies Partial<CSSStyleDeclaration>);
    el.addEventListener('click', event => {
      event.stopPropagation();
      handlers.onExposure(delta);
    });
    return el;
  };

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '恢复自动';
  Object.assign(reset.style, {
    marginTop: '6px', padding: '0', border: 'none', background: 'transparent',
    color: MUTED, cursor: 'pointer', fontSize: '11px', lineHeight: '15px', display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  reset.addEventListener('click', event => {
    event.stopPropagation();
    handlers.onReset();
  });

  row.append(label, nudge(-0.05, '−'), value, nudge(0.05, '+'));
  panel.append(title, meta, row, reset);
  root.append(panel, button);
  container.appendChild(root);

  const setOpen = (open: boolean) => {
    panel.style.display = open ? 'block' : 'none';
    button.style.color = open ? INK : MUTED;
  };

  button.addEventListener('click', event => {
    event.stopPropagation();
    setOpen(panel.style.display === 'none');
  });
  // 画布的指针事件不能被浮层吞掉：浮层内点空白也不冒泡到 canvas。
  for (const el of [root, panel]) {
    el.addEventListener('pointerdown', event => event.stopPropagation());
    el.addEventListener('wheel', event => event.stopPropagation());
  }

  let shown = { visible: false, override: 1 } as { visible: boolean; override: number };
  return {
    update(view) {
      if (!view.visible) {
        if (shown.visible) {
          shown = { visible: false, override: view.override };
          setOpen(false);
          root.style.display = 'none';
        }
        return;
      }
      if (!shown.visible) {
        root.style.display = 'block';
        button.style.background = PAPER;
      }
      shown = { visible: true, override: view.override };

      const perceivedPct = Math.round(Math.max(0, Math.min(1, view.perceived)) * 100);
      const kelvin = Math.round(view.kelvin / 100) * 100;
      meta.textContent = `亮度 ${perceivedPct}% · 色温 ${kelvin}K`;
      value.textContent = (view.reference * view.override).toFixed(2);
      reset.style.display = Math.abs(view.override - 1) > 0.005 ? 'block' : 'none';
      // 覆盖生效时纽扣上留一个极轻的实心点，表示「这一档是你调过的」。
      button.style.color = Math.abs(view.override - 1) > 0.005 ? INK : MUTED;
    },
    dispose() {
      root.remove();
    },
  };
}
