/**
 * Template entry point.
 *
 * Interaction rules on the canvas:
 *   - press on empty grid  -> orbit the camera (OrbitControls)
 *   - press on a model     -> select it; drag to slide it across the grid
 *   - click empty grid     -> clear the selection
 *   - drop a toolbar tile  -> place that model where the pointer is
 *
 * The camera is disabled only for the duration of a model drag, so orbiting stays
 * on the primary mouse button the rest of the time.
 */

import { SceneRenderer } from './scene-renderer.js';

const $ = id => document.getElementById(id);
const canvas = $('scene');
const statusEl = $('scene-status');

function setStatus(message, kind) {
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.dataset.kind = kind || '';
  statusEl.hidden = !message;
}

let renderer = null;

function boot() {
  try {
    renderer = new SceneRenderer(canvas, {
      onSelection: model => {
        const panel = $('selection-panel');
        const nameEl = $('selection-name');
        const sizeEl = $('selection-size');
        if (!panel || !nameEl) return;
        if (!model) {
          panel.hidden = true;
          return;
        }
        panel.hidden = false;
        nameEl.textContent = model.name;
        if (sizeEl) sizeEl.textContent = `#${model.index + 1}`;
      },
    });
    window.sceneRenderer = renderer;
    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus('三维场景无法启动，请使用支持 WebGL 2 的浏览器。', 'error');
    return;
  }

  bindModelDragging();
  bindStageActions();
  bindSidebar();
  renderer.frameAll();
}

/* ---------------------------------------------------------- model dragging */

function bindModelDragging() {
  let dragging = null;      // the placed record being moved
  let pressPoint = null;    // screen position of the initial press
  let movedEnough = false;  // distinguishes a click from a drag

  const isToolbarDrag = event => event.dataTransfer?.types?.includes('application/x-scendance-model');

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    // A toolbar drag is delivered through the drag-and-drop events, not pointers.
    if (isToolbarDrag(event)) return;

    const hit = renderer.pickPlaced(event.clientX, event.clientY);
    pressPoint = { x: event.clientX, y: event.clientY };
    movedEnough = false;

    if (!hit) {
      renderer.setSelected(null);
      return;
    }

    renderer.setSelected(hit);
    dragging = hit;
    // Stop the orbit for this gesture so the model moves instead of the camera.
    renderer.controls.enabled = false;
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', event => {
    if (!dragging || !pressPoint) return;
    if (!movedEnough) {
      const dx = event.clientX - pressPoint.x;
      const dy = event.clientY - pressPoint.y;
      if (Math.hypot(dx, dy) < 3) return;   // ignore jitter so a click stays a click
      movedEnough = true;
    }
    const point = renderer.groundPointFromClient(event.clientX, event.clientY);
    // `live: true` keeps the shadow map out of the per-frame path; it is rebuilt
    // once on pointerup. Rebuilding it every frame is what made dragging stutter.
    if (point) renderer.moveModel(dragging, point, { live: true });
  });

  const endDrag = event => {
    if (dragging) {
      canvas.releasePointerCapture?.(event.pointerId);
      dragging = null;
      renderer.controls.enabled = true;
      // One shadow rebuild for the finished position.
      renderer.refreshShadows();
    }
    pressPoint = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Delete the selection with Delete / Backspace, matching the footer hint.
  window.addEventListener('keydown', event => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (!renderer.selected) return;
    event.preventDefault();
    const name = renderer.removeModel(renderer.selected);
    if (name) setStatus(`已删除：${name}`, 'ok');
  });
}

/* ------------------------------------------------------------ stage clicks */

function bindStageActions() {
  const fit = $('fit-view');
  if (fit) fit.addEventListener('click', () => renderer.frameAll());

  const removeLast = $('remove-last');
  if (removeLast) {
    removeLast.addEventListener('click', () => {
      const name = renderer.removeModel(renderer.selected ?? undefined);
      setStatus(name ? `已移除：${name}` : '场景里还没有模型', name ? 'ok' : '');
    });
  }

  const clear = $('clear-models');
  if (clear) {
    clear.addEventListener('click', () => {
      const removed = renderer.clearModels();
      setStatus(removed ? `已清空 ${removed} 个模型` : '场景里还没有模型', removed ? 'ok' : '');
    });
  }

  const deselect = $('deselect');
  if (deselect) deselect.addEventListener('click', () => renderer.setSelected(null));
}

/* ------------------------------------------------------------------ chrome */

function bindSidebar() {
  const shell = $('shell');
  const collapse = $('sidebar-collapse');
  if (!shell || !collapse) return;

  const apply = collapsed => {
    shell.classList.toggle('is-collapsed', collapsed);
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.setAttribute('aria-label', collapsed ? '展开工具栏' : '收起工具栏');
    collapse.textContent = collapsed ? '›' : '‹';
    // The stage changed width, so the drawing buffer has to follow.
    requestAnimationFrame(() => renderer.resize());
  };

  let collapsed = false;
  try { collapsed = window.localStorage.getItem('scendance-sidebar') === '1'; } catch { /* storage blocked */ }
  apply(collapsed);

  collapse.addEventListener('click', () => {
    const next = !shell.classList.contains('is-collapsed');
    apply(next);
    try { window.localStorage.setItem('scendance-sidebar', next ? '1' : '0'); } catch { /* ignore */ }
  });
}

boot();

/* The toolbar reports placement results here so the user always sees an outcome. */
window.sceneStatus = setStatus;
