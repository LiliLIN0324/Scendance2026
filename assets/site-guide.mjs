const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const desktop = matchMedia('(hover: hover) and (pointer: fine)');
const nativeCursor = 'input, textarea, select, [contenteditable], #site-plan, .nv-stage canvas';

export function installSiteGuide({agent, launcher}) {
  if (document.documentElement.classList.contains('map-embed')) return;
  const brand = document.querySelector('#site-wordmark');
  const nav = document.querySelector('#nav');
  const welcome = agent.querySelector('.agent-welcome');
  const tour = agent.querySelector('.agent-tour');
  const title = agent.querySelector('#site-agent-title');
  const choices = tour.querySelector('.guide-choices');
  const pin = agent.querySelector('[data-guide-pin]');
  const cursorToggle = agent.querySelector('[data-guide-cursor]');
  const tail = document.querySelector('#guide-tail');
  const nextSection = document.querySelector('#blank');
  const mapFace = launcher.querySelector('img');
  const traveler = document.createElement('img');
  traveler.id = 'guide-traveler';
  traveler.src = mapFace.src;
  traveler.alt = '';
  traveler.hidden = true;
  document.body.append(traveler);
  const headings = [...document.querySelectorAll('.hero-site-caption, #site-cases-heading, #cap-title, #about h2')];
  const links = Array.from(nav.querySelectorAll('a'));
  const optionLinks = links.map(link => {
    const option = link.cloneNode(true);
    choices.append(option);
    return option;
  });
  let opener;
  let pinned;
  let cursorEnabled = true;
  let following = false;
  let flight;
  let mousePoint;
  let lastMapPoint;
  let pointer;
  let lastTail;
  let panelPoint;
  let frame;

  document.body.append(agent);

  function mapPoint() {
    const rect = mapFace.getBoundingClientRect();
    return {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2};
  }

  function cursorPoint() {
    return mousePoint && {x:mousePoint.x + 14, y:mousePoint.y + 13};
  }

  function showCompanion() {
    traveler.hidden = !flight;
    launcher.classList.toggle('is-away', following || Boolean(flight));
    document.body.classList.toggle('has-xiaojing-cursor', following && !flight);
  }

  function syncCompanion(animate = true) {
    // The white section can cover the sticky hero while the hero itself is still in view.
    const home = mapPoint();
    const mapVisible = nextSection.getBoundingClientRect().top > home.y + 43 && home.y >= 0;
    const next = desktop.matches && cursorEnabled && !mapVisible;
    if (home.y >= 0 && home.y < innerHeight) lastMapPoint = home;
    if (next === following && (animate || !flight)) return;
    const start = flight?.point ?? (next ? lastMapPoint : cursorPoint());
    following = next;
    flight = null;
    lastTail = null;
    tail.replaceChildren();
    if (animate && !reducedMotion.matches && start && mousePoint && !document.hidden) {
      const trip = {point:start};
      flight = trip;
      const begin = performance.now();
      function draw(now) {
        if (flight !== trip) return;
        const target = following ? cursorPoint() : mapPoint();
        const t = Math.max(0, Math.min(1, (now - begin) / 370));
        if (!target || t === 1) {
          flight = null;
          showCompanion();
          return;
        }
        const ease = 1 - (1 - t) ** 3;
        trip.point = {
          x:start.x + (target.x - start.x) * ease,
          y:start.y + (target.y - start.y) * ease - Math.sin(t * Math.PI) * 35,
        };
        traveler.style.transform = `translate3d(${trip.point.x - 15}px,${trip.point.y - 15}px,0)`;
        requestAnimationFrame(draw);
      }
      draw(begin);
    }
    showCompanion();
  }

  function placePanel(point = panelPoint) {
    const margin = 12;
    const gap = 18;
    const width = agent.offsetWidth;
    const height = agent.offsetHeight;
    const origin = opener.getBoundingClientRect();
    const x = point?.x ?? origin.left;
    const y = point?.y ?? origin.bottom;
    const right = x + gap;
    const left = x - width - gap;
    const below = y + gap;
    const above = y - height - gap;
    const xs = right + width <= innerWidth - margin ? [right, left] : [left, right];
    const ys = below + height <= innerHeight - margin ? [below, above] : [above, below];
    const bounds = headings.map(heading => heading.getBoundingClientRect());
    let best;
    for (const candidateY of ys) {
      for (const candidateX of xs) {
        const clampedX = Math.max(margin, Math.min(candidateX, innerWidth - width - margin));
        const clampedY = Math.max(margin, Math.min(candidateY, innerHeight - height - margin));
        const overlap = bounds.reduce((area, rect) => area +
          Math.max(0, Math.min(rect.right, clampedX + width) - Math.max(rect.left, clampedX)) *
          Math.max(0, Math.min(rect.bottom, clampedY + height) - Math.max(rect.top, clampedY)), 0);
        const score = overlap + Math.hypot(candidateX-clampedX, candidateY-clampedY);
        if (!best || score < best.score) best = {x:clampedX, y:clampedY, score};
      }
    }
    agent.style.left = best.x + 'px';
    agent.style.top = best.y + 'px';
  }

  function setPinned(value) {
    pinned = value;
    pin.setAttribute('aria-pressed', String(value));
    pin.textContent = value ? '已固定' : '固定面板';
  }

  function close(restoreFocus = false) {
    agent.hidden = true;
    brand.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-in-guide');
    if (restoreFocus) {
      const origin = opener?.getBoundingClientRect();
      (origin?.bottom > 0 && origin.top < innerHeight && !opener.classList.contains('is-away') ? opener : brand).focus({preventScroll:true});
    }
  }

  function flyNav() {
    if (reducedMotion.matches || !desktop.matches) return;
    links.forEach((link, index) => {
      if (getComputedStyle(link).visibility === 'hidden') return;
      const from = link.querySelector('span').getBoundingClientRect();
      const to = optionLinks[index].querySelector('svg').getBoundingClientRect();
      const token = document.createElement('span');
      token.className = 'guide-flying-icon';
      token.append(link.querySelector('svg').cloneNode(true));
      token.style.left = from.left + from.width / 2 + 'px';
      token.style.top = from.top + from.height / 2 + 'px';
      token.setAttribute('aria-hidden','true');
      document.body.append(token);
      const dx = to.left + to.width / 2 - from.left - from.width / 2;
      const dy = to.top + to.height / 2 - from.top - from.height / 2;
      const flight = token.animate([
        {transform:'translate(0, 0) scale(.85)'},
        {transform:`translate(${dx * .45}px, ${dy * .45 - 32}px) rotate(-12deg)`, offset:.45},
        {transform:`translate(${dx}px, ${dy}px) rotate(0) scale(.55)`, opacity:0},
      ], {duration:340 + index * 55, easing:'cubic-bezier(.25,.6,.35,1)'});
      flight.finished.then(() => token.remove(), () => token.remove());
    });
  }

  function open(event, introduction) {
    const trigger = event.currentTarget;
    if (!agent.hidden && opener === trigger) {
      close(true);
      return;
    }
    opener = trigger;
    welcome.hidden = !introduction;
    tour.hidden = introduction;
    title.textContent = introduction ? '嗨，我是小景。' : '想去哪里？';
    panelPoint = event.detail && desktop.matches ? {x:event.clientX, y:event.clientY} : null;
    setPinned(!panelPoint);
    agent.hidden = false;
    placePanel();
    brand.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-expanded', 'true');
    if (!introduction) {
      flyNav();
      nav.classList.add('is-in-guide');
    } else {
      nav.classList.remove('is-in-guide');
    }
    if (!event.detail) (introduction ? welcome.querySelector('a') : optionLinks[0]).focus({preventScroll:true});
  }

  function navigate(event) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = event.currentTarget.getAttribute('href');
    if (!href.startsWith('#')) {
      close();
      return;
    }
    const destination = document.getElementById(href.slice(1));
    if (!destination) return;
    event.preventDefault();
    close();
    const url = new URL(location.href);
    url.hash = href;
    if (href === '#site-cases') {
      url.searchParams.delete('activity');
      url.searchParams.delete('tool');
    }
    if (location.href !== url.href) history.pushState(history.state, '', url);
    if (href === '#site-cases') window.dispatchEvent(new HashChangeEvent('hashchange'));
    destination.scrollIntoView({block:'start', behavior:'instant'});
    destination.tabIndex = -1;
    destination.focus({preventScroll:true});
  }

  [...links, ...optionLinks].forEach(link => link.addEventListener('click', navigate));
  brand.addEventListener('click', event => {
    event.preventDefault();
    open(event, false);
  });
  launcher.addEventListener('click', event => open(event, true));
  agent.querySelector('.agent-close').addEventListener('click', () => close(true));
  pin.addEventListener('click', () => setPinned(!pinned));
  cursorToggle.addEventListener('click', () => {
    cursorEnabled = !cursorEnabled;
    cursorToggle.setAttribute('aria-pressed', String(cursorEnabled));
    syncCompanion(false);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !agent.hidden) close(agent.contains(document.activeElement));
  });
  window.addEventListener('pointerdown', event => {
    if (!agent.hidden && !event.target.closest('#site-agent, #site-wordmark, #agent-launch')) close();
  }, {passive:true});
  window.addEventListener('resize', () => {
    syncCompanion(false);
    if (!agent.hidden) placePanel();
  }, {passive:true});
  window.addEventListener('scroll', () => syncCompanion(), {passive:true});
  window.addEventListener('wheel', event => {
    if (desktop.matches) mousePoint = {x:event.clientX, y:event.clientY};
  }, {passive:true});

  window.addEventListener('pointermove', event => {
    if (!desktop.matches || event.pointerType !== 'mouse') return;
    const {clientX:x, clientY:y} = event;
    mousePoint = {x, y};
    if (event.buttons || event.target.closest(nativeCursor) || agent.contains(event.target)) {
      pointer = lastTail = null;
      return;
    }
    pointer = mousePoint;
    if (!pinned && !agent.hidden && !frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Leave room to move from the cursor into the panel and use its controls.
        if (!pointer || pinned || agent.hidden || (panelPoint && Math.hypot(pointer.x-panelPoint.x, pointer.y-panelPoint.y) < 44)) return;
        panelPoint = pointer;
        placePanel();
      });
    }
    if (!following || flight || reducedMotion.matches) return;
    const previous = lastTail;
    if (previous && Math.hypot(x-previous.x, y-previous.y) < 10) return;
    lastTail = pointer;
    if (!previous) return;
    while (tail.children.length >= 22) tail.firstElementChild.remove();
    const spark = document.createElement('i');
    spark.style.left = x + 'px';
    spark.style.top = y + 'px';
    spark.style.setProperty('--spark-angle', Math.atan2(y-previous.y, x-previous.x) + 'rad');
    spark.style.setProperty('--spark-length', Math.min(44, 10 + Math.hypot(x-previous.x, y-previous.y)) + 'px');
    tail.append(spark);
    spark.addEventListener('animationend', () => spark.remove(), {once:true});
  }, {passive:true});
  function clearTrail() {
    mousePoint = null;
    pointer = lastTail = null;
    tail.replaceChildren();
  }
  document.documentElement.addEventListener('pointerleave', clearTrail);
  window.addEventListener('blur', clearTrail);
  reducedMotion.addEventListener('change', () => {
    clearTrail();
    syncCompanion(false);
  });
  desktop.addEventListener('change', () => syncCompanion(false));
  syncCompanion(false);
  return close;
}
