import type { AnchorKind, CalibrationConfidence, GroundAnchor, ScanAxis } from '../lib/site-capture';

export type CalibrationHudMeters = Readonly<{ width: number; depth: number; height: number }>;

export type CalibrationHudModel = Readonly<{
  visible: boolean;
  summary: string;
  scale: number;
  yawDeg: number;
  groundY: number;
  originX: number;
  originZ: number;
  meters?: CalibrationHudMeters;
  reference?: Readonly<{ axis: ScanAxis; knownMeters: number; measuredMeters: number }>;
  deviationPct?: number;
  confidence?: CalibrationConfidence;
  anchors: readonly GroundAnchor[];
}>;

export type CalibrationHudActions = Readonly<{
  calibrate(input: { axis: ScanAxis; knownMeters: number }): void;
  setYaw(yawDeg: number): void;
  setGround(y: number): void;
  setOrigin(origin: { x: number; z: number }): void;
  addAnchor(input: { kind: AnchorKind; x: number; z: number }): void;
  removeAnchor(id: string): void;
  reset(): void;
}>;

const INK = 'rgba(62, 58, 52, 0.9)';
const INK_SOFT = 'rgba(86, 78, 66, 0.62)';
const HAIRLINE = 'rgba(86, 78, 66, 0.16)';
const HAIRLINE_SOFT = 'rgba(86, 78, 66, 0.09)';
const PAPER = 'rgba(253, 252, 249, 0.94)';

function fieldStyle(input: HTMLInputElement | HTMLSelectElement): void {
  Object.assign(input.style, {
    width: '58px',
    padding: '2px 5px',
    border: `1px solid ${HAIRLINE}`,
    borderRadius: '4px',
    background: 'rgba(255, 255, 255, 0.72)',
    color: INK,
    fontSize: '11px',
    lineHeight: '16px',
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
  } satisfies Partial<CSSStyleDeclaration>);
}

function actionStyle(button: HTMLButtonElement): void {
  Object.assign(button.style, {
    padding: '2px 7px',
    border: `1px solid ${HAIRLINE}`,
    borderRadius: '4px',
    background: 'transparent',
    color: INK,
    cursor: 'pointer',
    fontSize: '11px',
    lineHeight: '16px',
    fontFamily: 'inherit',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener('mouseenter', () => { button.style.background = 'rgba(86, 78, 66, 0.07)'; });
  button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
}

function row(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    display: 'flex', alignItems: 'center', gap: '6px',
    paddingTop: '7px', marginTop: '7px', borderTop: `1px solid ${HAIRLINE_SOFT}`,
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

function label(text: string, width = 'auto'): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  Object.assign(el.style, { color: INK_SOFT, fontSize: '11px', lineHeight: '16px', flex: `0 0 ${width}`, whiteSpace: 'nowrap' });
  return el;
}

function numberInput(value: number, testid: string, step = 0.1): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'number';
  el.step = String(step);
  el.value = String(value);
  el.dataset.testid = testid;
  fieldStyle(el);
  return el;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 空间标定入口：常驻一枚 24px 图标角标，点开就是比例 / 朝向 / 原点 / 基准面 / 锚点的标定面板。
 * 常驻层只留图标，状态（已标定 / 粗标 / 可疑）用图标颜色编码，全文只在 title 与面板里说，
 * 不再用「空间标定：未标定（1:1）」整条文字占画布底边。视觉保持发丝边、无嵌套卡片。
 */
export function createCalibrationHud(container: HTMLElement, actions: CalibrationHudActions): Readonly<{
  update(model: CalibrationHudModel): void;
  dispose(): void;
}> {
  const wrap = document.createElement('div');
  wrap.dataset.testid = 'site-calibration-hud';
  Object.assign(wrap.style, {
    position: 'absolute',
    // 与光照 ⓘ 并排成一组：ⓘ 在 16px，标定图标紧跟其后（24 + 6 间隙）。
    left: '46px',
    bottom: '16px',
    zIndex: '400',
    display: 'none',
    flexDirection: 'column-reverse',
    alignItems: 'flex-start',
    gap: '6px',
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.dataset.testid = 'site-calibration-toggle';
  toggle.title = '打开空间标定：比例 / 朝向 / 原点 / 基准面 / 锚点';
  Object.assign(toggle.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    padding: '0',
    borderRadius: '999px',
    border: `1px solid ${HAIRLINE}`,
    background: 'rgba(253, 252, 249, 0.86)',
    backdropFilter: 'blur(6px)',
    color: 'rgba(62, 58, 52, 0.82)',
    fontSize: '12px',
    lineHeight: '16px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>);
  // 标尺图标：一眼读作「量尺/标定」，比一个字母 + 状态点更省地方。
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 14 14');
  icon.setAttribute('width', '13');
  icon.setAttribute('height', '13');
  icon.setAttribute('aria-hidden', 'true');
  Object.assign(icon.style, { display: 'block', pointerEvents: 'none' } satisfies Partial<CSSStyleDeclaration>);
  icon.innerHTML =
    '<rect x="0.7" y="4.2" width="12.6" height="5.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
    '<path d="M3.4 4.4v2.2M6.4 4.4v3M9.4 4.4v2.2" stroke="currentColor" stroke-width="1"/>';
  toggle.append(icon);
  let open = false;

  const panel = document.createElement('div');
  panel.dataset.testid = 'site-calibration-panel';
  Object.assign(panel.style, {
    display: 'none',
    flexDirection: 'column',
    width: '252px',
    padding: '10px 11px 11px',
    border: `1px solid ${HAIRLINE}`,
    borderRadius: '10px',
    background: PAPER,
    backdropFilter: 'blur(8px)',
    boxShadow: '0 8px 22px rgba(60, 50, 40, 0.08)',
    color: INK,
    fontSize: '11px',
    lineHeight: '16px',
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>);

  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '8px' } satisfies Partial<CSSStyleDeclaration>);
  const title = document.createElement('span');
  title.textContent = '空间标定';
  Object.assign(title.style, { fontSize: '12px', fontWeight: '600', letterSpacing: '0.02em', flex: '1 1 auto' });
  const hint = document.createElement('span');
  hint.textContent = '实景 ↔ 场地';
  Object.assign(hint.style, { color: INK_SOFT, fontSize: '10px' });
  head.append(title, hint);

  // 比例
  const scaleRow = row();
  const scaleLabel = label('比例');
  const scaleValue = document.createElement('span');
  Object.assign(scaleValue.style, { flex: '1 1 auto', textAlign: 'right' });
  scaleRow.append(scaleLabel, scaleValue);

  const calibrateRow = row();
  const knownInput = numberInput(12, 'site-calibration-known-width', 0.01);
  const axisSelect = document.createElement('select');
  axisSelect.dataset.testid = 'site-calibration-axis';
  for (const option of [{ value: 'x', text: '宽' }, { value: 'z', text: '深' }, { value: 'y', text: '高' }] as const) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.text;
    axisSelect.appendChild(item);
  }
  fieldStyle(axisSelect);
  axisSelect.style.width = '46px';
  const calibrateButton = document.createElement('button');
  calibrateButton.type = 'button';
  calibrateButton.textContent = '按已知尺寸标定';
  calibrateButton.dataset.testid = 'site-calibration-apply-scale';
  actionStyle(calibrateButton);
  calibrateButton.style.flex = '1 1 auto';
  calibrateRow.append(knownInput, axisSelect, calibrateButton);

  const errorLine = document.createElement('div');
  Object.assign(errorLine.style, { color: INK_SOFT, fontSize: '10.5px', lineHeight: '15px', marginTop: '5px' } satisfies Partial<CSSStyleDeclaration>);

  // 朝向
  const yawRow = row();
  const yawInput = numberInput(0, 'site-calibration-yaw', 1);
  const yawButton = document.createElement('button');
  yawButton.type = 'button';
  yawButton.textContent = '应用朝向';
  yawButton.dataset.testid = 'site-calibration-apply-yaw';
  actionStyle(yawButton);
  yawButton.style.flex = '1 1 auto';
  yawRow.append(label('朝向°'), yawInput, yawButton);

  // 原点
  const originRow = row();
  const originXInput = numberInput(0, 'site-calibration-origin-x', 0.1);
  const originZInput = numberInput(0, 'site-calibration-origin-z', 0.1);
  const originButton = document.createElement('button');
  originButton.type = 'button';
  originButton.textContent = '应用原点';
  originButton.dataset.testid = 'site-calibration-apply-origin';
  actionStyle(originButton);
  originButton.style.flex = '1 1 auto';
  originRow.append(label('原点 X/Z'), originXInput, originZInput, originButton);

  // 基准面
  const groundRow = row();
  const groundInput = numberInput(0, 'site-calibration-ground-y', 0.05);
  const groundButton = document.createElement('button');
  groundButton.type = 'button';
  groundButton.textContent = '应用基准高度';
  groundButton.dataset.testid = 'site-calibration-apply-ground';
  actionStyle(groundButton);
  groundButton.style.flex = '1 1 auto';
  groundRow.append(label('基准 Y'), groundInput, groundButton);

  // 锚点
  const anchorRow = row();
  const anchorXInput = numberInput(0, 'site-calibration-anchor-x', 0.1);
  const anchorZInput = numberInput(0, 'site-calibration-anchor-z', 0.1);
  const anchorList = document.createElement('div');
  Object.assign(anchorList.style, { display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '5px' } satisfies Partial<CSSStyleDeclaration>);
  const kindButtons: HTMLButtonElement[] = [];
  for (const option of [{ kind: 'stage', text: '舞台位' }, { kind: 'entrance', text: '入口' }, { kind: 'custom', text: '锚点' }] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `+${option.text}`;
    button.dataset.testid = `site-calibration-add-${option.kind}`;
    actionStyle(button);
    button.addEventListener('click', () => {
      actions.addAnchor({
        kind: option.kind,
        x: Number(anchorXInput.value) || 0,
        z: Number(anchorZInput.value) || 0,
      });
    });
    kindButtons.push(button);
  }
  const anchorAddRow = document.createElement('div');
  Object.assign(anchorAddRow.style, { display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', flexWrap: 'wrap' } satisfies Partial<CSSStyleDeclaration>);
  anchorAddRow.append(anchorXInput, anchorZInput, ...kindButtons);

  // 重置
  const resetRow = row();
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = '恢复 1:1 默认';
  resetButton.dataset.testid = 'site-calibration-reset';
  actionStyle(resetButton);
  resetButton.style.flex = '0 0 auto';
  const summaryLine = document.createElement('span');
  Object.assign(summaryLine.style, { color: INK_SOFT, fontSize: '10px', lineHeight: '15px', flex: '1 1 auto', textAlign: 'right' } satisfies Partial<CSSStyleDeclaration>);
  resetRow.append(resetButton, summaryLine);

  panel.append(head, scaleRow, calibrateRow, errorLine, yawRow, originRow, groundRow, anchorRow, anchorAddRow, anchorList, resetRow);
  wrap.append(toggle, panel);
  container.appendChild(wrap);

  toggle.addEventListener('click', () => {
    open = !open;
    panel.style.display = open ? 'flex' : 'none';
  });
  calibrateButton.addEventListener('click', () => {
    const known = Number(knownInput.value);
    if (!Number.isFinite(known) || known <= 0) return;
    actions.calibrate({ axis: axisSelect.value as ScanAxis, knownMeters: known });
  });
  yawButton.addEventListener('click', () => {
    const raw = Number(yawInput.value);
    if (Number.isFinite(raw)) actions.setYaw(raw);
  });
  originButton.addEventListener('click', () => {
    const x = Number(originXInput.value);
    const z = Number(originZInput.value);
    if (Number.isFinite(x) && Number.isFinite(z)) actions.setOrigin({ x, z });
  });
  groundButton.addEventListener('click', () => {
    const y = Number(groundInput.value);
    if (Number.isFinite(y)) actions.setGround(y);
  });
  resetButton.addEventListener('click', () => actions.reset());

  let shown: string | null = null;
  let lastYaw: number | null = null;
  let yawDelta: number | null = null;
  let editing = false;
  for (const input of [knownInput, yawInput, originXInput, originZInput, groundInput, anchorXInput, anchorZInput]) {
    input.addEventListener('focus', () => { editing = true; });
    input.addEventListener('blur', () => { editing = false; });
  }

  function renderAnchors(anchors: readonly GroundAnchor[]): void {
    anchorList.replaceChildren();
    if (!anchors.length) {
      const empty = document.createElement('span');
      empty.textContent = '还没有锚点：填 X/Z 后点上面的按钮。';
      Object.assign(empty.style, { color: INK_SOFT, fontSize: '10px', lineHeight: '15px' });
      anchorList.appendChild(empty);
      return;
    }
    for (const anchor of anchors) {
      const line = document.createElement('div');
      Object.assign(line.style, { display: 'flex', alignItems: 'center', gap: '5px' } satisfies Partial<CSSStyleDeclaration>);
      const text = document.createElement('span');
      text.textContent = `${anchor.label} (${round2(anchor.x)}, ${round2(anchor.z)})`;
      Object.assign(text.style, { flex: '1 1 auto', fontSize: '10.5px', color: INK });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `删除 ${anchor.label}`;
      remove.dataset.testid = `site-calibration-remove-${anchor.id}`;
      actionStyle(remove);
      remove.style.padding = '0 5px';
      remove.addEventListener('click', () => actions.removeAnchor(anchor.id));
      line.append(text, remove);
      anchorList.appendChild(line);
    }
  }

  return {
    update(model) {
      if (!model.visible) {
        if (shown !== null) {
          shown = null;
          open = false;
          panel.style.display = 'none';
          wrap.style.display = 'none';
        }
        return;
      }
      wrap.style.display = 'flex';
      const summary = model.summary;
      if (shown !== summary) {
        shown = summary;
        // 图标颜色即状态：可疑=赭、粗标=黄褐、正常=墨。全文只在 title / aria-label 里。
        toggle.style.color = model.confidence === 'suspect'
          ? 'rgba(176, 116, 52, 0.95)'
          : model.confidence === 'coarse' ? 'rgba(150, 120, 66, 0.9)' : 'rgba(62, 58, 52, 0.82)';
        toggle.setAttribute('aria-label', `空间标定：${summary}`);
        toggle.title = model.reference
          ? `${summary}（扫描实测 ${model.reference.measuredMeters} m ↔ 已知 ${model.reference.knownMeters} m）`
          : summary;
      }
      if (lastYaw !== null && Math.abs(model.yawDeg - lastYaw) > 0.05) yawDelta = round1(model.yawDeg - lastYaw);
      lastYaw = model.yawDeg;

      const pct = model.deviationPct;
      scaleValue.textContent = `${round2(model.scale)}×${pct === undefined ? '' : `　偏差 ${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`}`;
      if (!editing) {
        knownInput.value = String(model.reference?.knownMeters ?? 12);
        yawInput.value = String(round1(model.yawDeg));
        originXInput.value = String(round2(model.originX));
        originZInput.value = String(round2(model.originZ));
        groundInput.value = String(round2(model.groundY));
      }
      const reference = model.reference;
      errorLine.replaceChildren();
      if (reference) {
        const beforeM = round1(reference.measuredMeters);
        const afterM = round1(reference.measuredMeters * model.scale);
        const errorM = round1(Math.abs(afterM - reference.knownMeters));
        errorLine.textContent = `扫描${reference.axis.toUpperCase()} ${beforeM} m → 标定 ${afterM} m（已知 ${round1(reference.knownMeters)} m，残差 ${errorM} m）；比例修正 ${((model.scale - 1) * 100).toFixed(1)}%`;
      } else {
        const meters = model.meters;
        errorLine.textContent = meters
          ? `当前落位 ${meters.width} × ${meters.depth} m，未用已知尺寸标定。`
          : '未用已知尺寸标定：按上游 1:1 米制放置。';
      }
      const yawText = yawDelta === null ? `朝向 ${round1(model.yawDeg)}°` : `朝向 ${round1(model.yawDeg)}°（本次修正 ${yawDelta > 0 ? '+' : ''}${yawDelta}°）`;
      summaryLine.textContent = yawText;
      renderAnchors(model.anchors);
    },
    dispose() {
      wrap.remove();
    },
  };
}
