'use strict';
/* Model toolbar: drag a local or online 3D model into the venue scene.
 *
 * Local models are served from this repository (assets/library/...); online
 * models come from the 3dassets.dev CDN, which sends Access-Control-Allow-Origin:*
 * so the browser can fetch both their preview image and their GLB directly.
 *
 * A tile sets the drag payload the canvas listens for; the canvas turns the drop
 * point into a floor position and asks the renderer to place the model there.
 */
(() => {
  const DRAG_TYPE = 'application/x-scendance-model';
  const panel = document.getElementById('model-toolbar');
  const canvas = document.getElementById('scene');
  const tabsEl = document.getElementById('toolbar-tabs');
  const railEl = document.getElementById('toolbar-rail');
  const gridEl = document.getElementById('toolbar-grid');
  const countEl = document.getElementById('toolbar-count');
  const searchEl = document.getElementById('toolbar-search');
  const statusEl = document.getElementById('toolbar-status');
  if (!panel || !canvas || !gridEl || !searchEl) return;

  const state = {
    tab: 'local',
    bucket: 'all',
    query: '',
    local: null,
    online: null,
    loading: false,
  };

  const COLLAPSE_KEY = 'scendance-toolbar-collapsed';

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.kind = kind || '';
    statusEl.hidden = !message;
  }

  /* ------------------------------------------------------------------ data */
  async function loadLocal() {
    if (state.local) return state.local;
    const response = await fetch('../assets/library/catalogue.json');
    if (!response.ok) throw new Error('本地模型清单加载失败（HTTP ' + response.status + '）');
    const catalogue = await response.json();
    state.local = {
      buckets: [{ key: 'all', label: '全部', icon: '✨', count: catalogue.modelCount }]
        .concat((catalogue.buckets || []).map(b => ({ key: b.key, label: b.label, icon: b.icon, count: b.count }))),
      models: catalogue.models.map(m => ({
        slug: m.slug,
        name: m.zh,
        subtitle: m.name,
        bucket: m.bucket,
        subcategory: m.subcategory,
        width: m.sizeMeters[0],
        depth: m.sizeMeters[1],
        height: m.sizeMeters[2],
        thumb: m.thumb,
        glb: m.glb,
        page: m.pageUrl,
        online: false,
      })),
    };
    return state.local;
  }

  async function loadOnline() {
    if (state.online) return state.online;
    const response = await fetch('../assets/library/online.json');
    if (!response.ok) throw new Error('线上模型清单加载失败（HTTP ' + response.status + '）');
    const payload = await response.json();
    const buckets = {};
    for (const model of payload.models) buckets[model.bucket] = (buckets[model.bucket] || 0) + 1;
    const LABELS = {
      seating: ['坐具', '💺'], tables: ['桌台', '🪑'], exhibition: ['展陈摊位', '🏪'],
      stage: ['舞台音响', '🎤'], sports: ['体育器材', '🏀'], plants: ['绿植景观', '🪴'],
      lighting: ['照明标识', '💡'], structure: ['建筑结构', '⛺'], logistics: ['后勤服务', '🧰'],
      food: ['餐饮', '🍽️'], digital: ['数码办公', '💻'], decor: ['装饰陈设', '🖼️'],
      vehicles: ['交通载具', '🚗'],
    };
    state.online = {
      buckets: [{ key: 'all', label: '全部', icon: '✨', count: payload.count }]
        .concat(Object.keys(buckets).map(key => ({
          key,
          label: (LABELS[key] || [key])[0],
          icon: (LABELS[key] || ['', '📦'])[1],
          count: buckets[key],
        }))),
      models: payload.models.map(m => ({
        slug: m.slug,
        name: m.name,
        subtitle: m.subcategory,
        bucket: m.bucket,
        subcategory: m.subcategory,
        width: m.width,
        depth: m.depth,
        height: m.height,
        thumb: m.thumb,
        glb: m.glb,
        page: m.page,
        online: true,
      })),
    };
    return state.online;
  }

  /* --------------------------------------------------------------- render */
  function shortName(name) {
    const cut = name.indexOf('(');
    return (cut === -1 ? name : name.slice(0, cut)).trim() || name;
  }

  function matches(model, query) {
    if (!query) return true;
    const haystack = (model.name + ' ' + (model.subtitle || '') + ' ' + (model.subcategory || '')).toLowerCase();
    return haystack.includes(query);
  }

  function render() {
    const source = state.tab === 'local' ? state.local : state.online;
    if (!source) return;

    // Tabs
    if (tabsEl) {
      tabsEl.querySelectorAll('button').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
        button.classList.toggle('is-active', button.dataset.tab === state.tab);
      });
    }

    // Category rail
    if (railEl) {
      railEl.replaceChildren(...source.buckets.map(bucket => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = state.bucket === bucket.key ? 'is-active' : '';
        button.setAttribute('aria-pressed', String(state.bucket === bucket.key));
        button.title = bucket.label + '（' + bucket.count + '）';
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = bucket.icon;
        const label = document.createElement('span');
        label.className = 'toolbar-rail-label';
        label.textContent = bucket.label;
        button.append(icon, label);
        button.addEventListener('click', () => { state.bucket = bucket.key; render(); });
        return button;
      }));
    }

    // Tiles
    const query = state.query.trim().toLowerCase();
    const visible = source.models.filter(model =>
      (state.bucket === 'all' || model.bucket === state.bucket) && matches(model, query));

    if (countEl) countEl.textContent = visible.length + ' 个';

    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'toolbar-empty';
      empty.textContent = state.tab === 'local'
        ? '本地 ' + source.models.length + ' 个模型里没有匹配项，切到「线上模型」试试。'
        : '没有匹配的线上模型，换个词试试。';
      gridEl.replaceChildren(empty);
      return;
    }

    gridEl.replaceChildren(...visible.map(model => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'toolbar-tile';
      tile.draggable = true;
      tile.title = model.name + (model.subtitle ? ' · ' + model.subtitle : '')
        + '\n' + model.width.toFixed(2) + ' × ' + model.depth.toFixed(2) + ' × ' + model.height.toFixed(2) + ' m'
        + '\n拖到场地里放置';

      const thumb = document.createElement('span');
      thumb.className = 'toolbar-thumb';
      const img = document.createElement('img');
      img.src = model.thumb;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      // A broken preview must not leave an empty hole in the grid.
      img.addEventListener('error', () => { img.remove(); thumb.textContent = '▨'; }, { once: true });
      thumb.append(img);

      const name = document.createElement('span');
      name.className = 'toolbar-name';
      name.textContent = state.tab === 'local' ? model.name : shortName(model.name);

      const dims = document.createElement('span');
      dims.className = 'toolbar-dim';
      dims.textContent = model.width.toFixed(2) + ' × ' + model.depth.toFixed(2) + ' m';

      tile.append(thumb, name, dims);
      tile.addEventListener('dragstart', event => {
        const payload = JSON.stringify({ glb: model.glb, name: model.name, width: model.width, depth: model.depth, height: model.height });
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(DRAG_TYPE, payload);
        // Some browsers hide custom types during dragover; text/plain keeps the
        // drop target detectable and gives a readable fallback payload.
        event.dataTransfer.setData('text/plain', model.name);
        panel.classList.add('is-dragging');
      });
      tile.addEventListener('dragend', () => panel.classList.remove('is-dragging'));
      return tile;
    }));
  }

  /* ---------------------------------------------------------------- wiring */
  if (tabsEl) {
    tabsEl.addEventListener('click', async event => {
      const button = event.target.closest('button[data-tab]');
      if (!button || button.dataset.tab === state.tab) return;
      state.tab = button.dataset.tab;
      state.bucket = 'all';
      setStatus('');
      if (state.tab === 'online' && !state.online) {
        state.loading = true;
        setStatus('正在加载线上模型清单…');
        try {
          await loadOnline();
          setStatus('');
        } catch (error) {
          setStatus(error.message, 'error');
          return;
        } finally {
          state.loading = false;
        }
      }
      render();
    });
  }

  searchEl.addEventListener('input', () => { state.query = searchEl.value; render(); });

  // The collapse control belongs to the page shell (main.js drives #shell), so the
  // toolbar deliberately does not add a second one.

  /* The canvas owns the raycast, so placement goes through the renderer. It is
     created asynchronously by app.js, hence the polling handshake. */
  canvas.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE) && !event.dataTransfer.types.includes('text/plain')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    canvas.classList.add('is-drop-target');
  });
  canvas.addEventListener('dragleave', () => canvas.classList.remove('is-drop-target'));
  canvas.addEventListener('drop', event => {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    canvas.classList.remove('is-drop-target');
    let model;
    try { model = JSON.parse(raw); } catch { return; }
    if (!model || !model.glb) return;

    const renderer = window.sceneRenderer;
    if (!renderer || typeof renderer.placeModelFromClient !== 'function') {
      setStatus('场景还在加载，请稍后再试。', 'error');
      return;
    }

    // A remote model is a cold fetch of a few hundred KB; say so, and say when it
    // finishes, so a slow drop never looks like a dead one.
    const remote = /^https?:/i.test(model.glb);
    setStatus((remote ? '正在从线上载入 ' : '正在载入 ') + model.name + '…');
    renderer.placeModelFromClient(event.clientX, event.clientY, model)
      .then(record => {
        setStatus('已放入：' + model.name + '（点击可选中并拖动）', 'ok');
        if (record) renderer.setSelected(record);
      })
      .catch(error => {
        const message = error && error.message ? error.message : String(error);
        setStatus('模型载入失败：' + message + (remote ? '（线上模型需要联网，可改用本地模型）' : ''), 'error');
      });
  });

  /* ------------------------------------------------------------------ boot */
  (async () => {
    setStatus('正在加载本地模型…');
    try {
      await loadLocal();
      setStatus('');
      render();
    } catch (error) {
      setStatus(error.message, 'error');
    }
  })();
})();
