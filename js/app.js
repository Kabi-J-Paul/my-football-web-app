/* Pitchify — app shell: router, onboarding, session, browse, detail sheet, timer */
(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* ================= state ================= */
  const S = {
    profile: null,          // { goal, equipment, level }
    draft: { goal: null, equipment: null, level: null },
    pool: [],               // cached exercise objects for the goal
    poolKey: '',
    session: null,          // { date, goal, equipment, level, ids, seed }
    completed: new Set(),
    favorites: new Set(),
    favData: {},            // id -> full exercise object
    browse: {
      query: '', goal: null, bodyPart: '', equip: '', muscle: '',
      sort: 'relevance', favsOnly: false,
      items: [], after: null, hasMore: false, total: 0,
      loading: false, initialized: false,
    },
    view: null,             // visible view name
    underlying: '#/',       // hash to return to when sheet closes
    routeBase: '',          // last non-detail hash
    detailId: null,
  };

  /* ================= storage ================= */
  const LS = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* quota */ } },
    json(key, fallback) {
      const raw = this.get(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    setJson(key, val) { this.set(key, JSON.stringify(val)); },
  };

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayLabel() {
    return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).toUpperCase();
  }

  function loadPersisted() {
    S.profile = LS.json('pitchify:profile', null);
    S.draft = Object.assign({ goal: null, equipment: null, level: null }, S.profile || {});
    S.favorites = new Set(LS.json('pitchify:favorites', []));
    S.favData = LS.json('pitchify:favdata', {});
    const ses = LS.json('pitchify:session', null);
    if (ses) S.session = ses;
    const comp = LS.json('pitchify:completed', null);
    S.completed = new Set(comp && comp.date === todayKey() ? comp.ids : []);
  }
  function saveProfile() { LS.setJson('pitchify:profile', S.profile); }
  function saveFavorites() {
    LS.setJson('pitchify:favorites', Array.from(S.favorites));
    LS.setJson('pitchify:favdata', S.favData);
  }
  function saveSession() { if (S.session) LS.setJson('pitchify:session', S.session); }
  function saveCompleted() {
    LS.setJson('pitchify:completed', { date: todayKey(), ids: Array.from(S.completed) });
  }

  /* ================= pool + session ================= */
  async function ensurePool(force) {
    if (!S.profile) return [];
    const key = S.profile.goal + ':' + S.profile.equipment;
    if (!force && S.pool.length && S.poolKey === key) return S.pool;

    if (!force) {
      const cached = LS.json('pitchify:pool', null);
      if (cached && cached.key === key && Date.now() - cached.ts < 24 * 3600 * 1000) {
        S.pool = cached.items; S.poolKey = key; return S.pool;
      }
    }
    const items = await Goals.buildPlan(S.profile.goal, S.profile.equipment);
    S.pool = items; S.poolKey = key;
    LS.setJson('pitchify:pool', { ts: Date.now(), key, items });
    return items;
  }

  function sessionSeed(extra) {
    return [todayKey(), S.profile.goal, S.profile.equipment, S.profile.level, extra || ''].join('|');
  }

  async function ensureSession() {
    const pool = await ensurePool(false);
    const today = todayKey();
    const p = S.profile;
    let ses = S.session;
    const profileMatches = ses && ses.goal === p.goal && ses.equipment === p.equipment && ses.level === p.level;

    if (!profileMatches || ses.date !== today) {
      const ids = Goals.pickSession(pool, sessionSeed()).map(x => x.exerciseId);
      ses = { date: today, goal: p.goal, equipment: p.equipment, level: p.level, ids, seed: sessionSeed() };
    } else {
      // drop ids that no longer exist in the pool, top up if possible
      const known = new Set(pool.map(x => x.exerciseId));
      ses.ids = ses.ids.filter(id => known.has(id));
      if (ses.ids.length < Goals.SESSION_SIZE && pool.length) {
        const extra = Goals.pickSession(pool, sessionSeed('topup:' + ses.ids.join(',')));
        const have = new Set(ses.ids);
        for (const it of extra) {
          if (ses.ids.length >= Goals.SESSION_SIZE) break;
          if (!have.has(it.exerciseId)) { ses.ids.push(it.exerciseId); have.add(it.exerciseId); }
        }
      }
    }
    S.session = ses;
    saveSession();

    const comp = LS.json('pitchify:completed', null);
    S.completed = new Set(comp && comp.date === today ? comp.ids : []);
    return ses;
  }

  function poolById(id) {
    return S.pool.find(x => x.exerciseId === id) || S.favData[id] || null;
  }

  /* ================= views / router ================= */
  const VIEWS = { onboarding: '#view-onboarding', plan: '#view-plan', browse: '#view-browse', detail: '#view-detail' };

  function showView(name) {
    Object.values(VIEWS).forEach(sel => { const el = $(sel); if (el) el.hidden = true; });
    const el = $(VIEWS[name]);
    if (el) { el.hidden = false; /* restart enter animation */ el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    S.view = name;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    $$('.nav a').forEach(a => a.classList.remove('is-active'));
    if (name === 'plan') { const a = $('.nav a[data-nav="plan"]'); if (a) a.classList.add('is-active'); }
    if (name === 'browse') { const a = $('.nav a[data-nav="browse"]'); if (a) a.classList.add('is-active'); }
  }

  function applyRoute(hash) {
    if (hash === '#/plan') { showView('plan'); renderPlan(); }
    else if (hash === '#/browse') { showView('browse'); renderBrowse(); }
    else if (hash === '#/setup') { showView('onboarding'); renderOnboarding(); }
    else if (hash === '' || hash === '#/') {
      if (S.profile) { showView('plan'); renderPlan(); }
      else { showView('onboarding'); renderOnboarding(); }
    } else { // unknown hash → safe default
      if (S.profile) { showView('plan'); renderPlan(); }
      else { showView('onboarding'); renderOnboarding(); }
    }
  }

  function route() {
    const hash = location.hash || '';
    const m = hash.match(/^#\/exercise\/(.+)$/);
    if (m) {
      if (!document.querySelector('.view:not([hidden])')) {
        applyRoute(S.routeBase || (S.profile ? '#/plan' : '#/'));
      }
      S.underlying = S.routeBase || (S.profile ? '#/plan' : '#/');
      openDetail(decodeURIComponent(m[1]));
    } else {
      closeSheet();
      S.routeBase = hash;
      applyRoute(hash);
    }
  }

  function go(hash) {
    if ((location.hash || '') === hash) route();
    else location.hash = hash;
  }

  /* ================= onboarding ================= */
  function renderOnboarding() {
    const goalHost = $('#goal-grid');
    const eqHost = $('#equip-grid');
    const lvHost = $('#level-grid');

    goalHost.innerHTML = Goals.GOALS.map(g => (
      '<button class="goal-card' + (S.draft.goal === g.id ? ' is-selected' : '') + '" type="button" role="option" ' +
      'aria-selected="' + (S.draft.goal === g.id) + '" data-goal="' + g.id + '" style="--gc:' + (UI.ACCENTS[g.accent] || UI.ACCENTS.lime) + '">' +
        '<span class="g-icon">' + UI.icon(g.icon, 22) + '</span>' +
        '<h3>' + UI.esc(g.name) + '</h3>' +
        '<span class="g-tag">' + UI.esc(g.tagline) + '</span>' +
      '</button>'
    )).join('');

    eqHost.innerHTML = Goals.EQUIPMENT.map(e => (
      '<button class="choice-card' + (S.draft.equipment === e.id ? ' is-selected' : '') + '" type="button" role="option" ' +
      'aria-selected="' + (S.draft.equipment === e.id) + '" data-equip="' + e.id + '">' +
        '<span class="tick">✓</span><strong>' + UI.esc(e.label) + '</strong><span>' + UI.esc(e.hint) + '</span>' +
      '</button>'
    )).join('');

    lvHost.innerHTML = Goals.LEVELS.map(l => (
      '<button class="choice-card' + (S.draft.level === l.id ? ' is-selected' : '') + '" type="button" role="option" ' +
      'aria-selected="' + (S.draft.level === l.id) + '" data-level="' + l.id + '">' +
        '<span class="tick">✓</span><strong>' + UI.esc(l.label) + '</strong><span>' + UI.esc(l.hint) + '</span>' +
      '</button>'
    )).join('');

    const buildBtn = $('#build-plan');
    buildBtn.disabled = !(S.draft.goal && S.draft.equipment && S.draft.level);
    const back = $('#back-to-session');
    if (back) back.hidden = !S.profile;
    showStep(currentStep);
  }

  let currentStep = 1;
  function showStep(n) {
    currentStep = n;
    $$('.onb-step').forEach(el => { el.hidden = Number(el.dataset.step) !== n; });
    $$('.onb-progress .dot').forEach(d => {
      const on = Number(d.dataset.dot) <= n;
      d.classList.toggle('is-on', on);
      if (Number(d.dataset.dot) === n) d.setAttribute('aria-current', 'step');
      else d.removeAttribute('aria-current');
    });
    const back = $('#onb-back');
    if (back) back.hidden = n <= 1;
    syncBackRow();
  }

  function syncBackRow() {
    const row = $('.onb-back-row');
    if (!row) return;
    row.hidden = $$('.onb-back-row .back-btn').every(b => b.hidden);
  }

  function openSetup(step) {
    if (S.profile) S.draft = Object.assign({}, S.profile);
    showStep(step || 1);
    go('#/setup');
  }

  /* ================= plan ================= */
  async function renderPlan() {
    const listHost = $('#session-list');
    const emptyHost = $('#session-empty');
    const side = $('.plan-side');

    if (!S.profile) {
      listHost.innerHTML = '';
      emptyHost.hidden = false;
      if (side) side.hidden = true;
      $('#plan-title').textContent = 'No goal set yet';
      $('#plan-eyebrow').textContent = "TODAY'S SESSION";
      $('#plan-chips').innerHTML = '';
      return;
    }

    emptyHost.hidden = true;
    if (side) side.hidden = false;
    listHost.innerHTML = '<div class="skel" style="padding:18px"><div class="sk-line shimmer"></div><div class="sk-line short shimmer"></div></div>';

    const goal = Goals.getGoal(S.profile.goal);
    const level = Goals.getLevel(S.profile.level);
    const equip = Goals.getEquipment(S.profile.equipment);

    $('#plan-eyebrow').textContent = "TODAY'S SESSION · " + todayLabel();
    $('#plan-title').textContent = goal.name + ' session';
    $('#plan-chips').innerHTML =
      '<span class="chip accent">' + UI.icon('ball', 13) + UI.esc(goal.name) + '</span>' +
      '<span class="chip">' + UI.esc(equip ? equip.label : '') + '</span>' +
      '<span class="chip">' + UI.esc(level ? level.label : '') + '</span>';

    try {
      await ensureSession();
    } catch (err) {
      listHost.innerHTML = '';
      emptyHost.hidden = false;
      if (side) side.hidden = true;
      emptyHost.querySelector('h3').textContent = 'Could not build your session';
      emptyHost.querySelector('p').textContent = err.message || 'The API is unreachable.';
      UI.toast(err.message || 'Failed to load exercises', {
        type: 'error',
        actionLabel: 'Retry',
        onAction: () => renderPlan(),
      });
      return;
    }

    const items = (S.session.ids || []).map(poolById).filter(Boolean);
    if (!items.length) {
      listHost.innerHTML = '';
      emptyHost.hidden = false;
      emptyHost.querySelector('h3').textContent = 'No exercises matched';
      emptyHost.querySelector('p').textContent = 'Your goal returned too few results — try another goal or relax equipment.';
      return;
    }

    const guide = Goals.guidance(S.profile.goal, S.profile.level);
    renderCoach(goal, guide, equip, level);

    listHost.innerHTML = items.map((it, i) => {
      const done = S.completed.has(it.exerciseId);
      const fav = S.favorites.has(it.exerciseId);
      return (
        '<div class="session-item' + (done ? ' is-done' : '') + '" data-id="' + UI.esc(it.exerciseId) + '" style="animation-delay:' + (i * 45) + 'ms">' +
          '<input class="s-check" type="checkbox" ' + (done ? 'checked' : '') + ' data-check="' + UI.esc(it.exerciseId) + '" ' +
            'aria-label="Mark ' + UI.esc(UI.titleCase(it.name)) + ' complete">' +
          '<button class="s-thumb" type="button" data-open="' + UI.esc(it.exerciseId) + '" aria-label="Open ' + UI.esc(UI.titleCase(it.name)) + '">' + UI.mediaHtml(it) + '</button>' +
          '<div class="s-body">' +
            '<p class="s-name">' + UI.esc(UI.titleCase(it.name)) + '</p>' +
            '<div class="s-meta">' +
              (it.bodyParts || []).slice(0, 1).map(b => '<span>' + UI.esc(UI.titleCase(b)) + '</span>').join('') +
              (it.equipments || []).slice(0, 1).map(b => '<span>' + UI.esc(UI.titleCase(b)) + '</span>').join('') +
              (it.targetMuscles || []).slice(0, 1).map(b => '<span>' + UI.esc(UI.titleCase(b)) + '</span>').join('') +
            '</div>' +
          '</div>' +
          '<div class="s-side">' +
            '<span class="s-sets">' + UI.esc(guide.sets) + ' × ' + UI.esc(guide.reps) + '</span>' +
            '<div class="s-actions">' +
              '<button class="star-btn' + (fav ? ' is-on' : '') + '" type="button" data-fav="' + UI.esc(it.exerciseId) + '" ' +
                'aria-pressed="' + fav + '" aria-label="Favorite">' + UI.icon('star', 15) + '</button>' +
              '<button class="star-btn" type="button" data-open="' + UI.esc(it.exerciseId) + '" aria-label="Open details">→</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    UI.bindImgErrors(listHost);
    updateProgress();
    resetTimer(guide.rest);
  }

  function renderCoach(goal, guide, equip, level) {
    $('#coach-list').innerHTML = [
      '<li><strong>' + UI.esc(guide.sets) + ' × ' + UI.esc(guide.reps) + '</strong> per exercise</li>',
      '<li><strong>' + guide.rest + 's rest</strong> between sets — timer is set for you</li>',
      '<li>' + UI.esc(goal.note) + '</li>',
      '<li>Kit: ' + UI.esc(equip ? equip.label : '—') + ' · Level: ' + UI.esc(level ? level.label : '—') + '</li>',
    ].join('');
    $('#timer-hint').textContent = 'Suggested rest for ' + goal.name.toLowerCase() + ': ' + guide.rest + 's.';
  }

  function updateProgress() {
    const ids = (S.session && S.session.ids) || [];
    const done = ids.filter(id => S.completed.has(id)).length;
    const total = ids.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const ring = $('#progress-ring');
    if (ring) ring.style.setProperty('--p', pct);
    $('#progress-count').textContent = done;
    $('#progress-total').textContent = total;
    const complete = total > 0 && done === total;
    $('#progress-copy').textContent = complete
      ? 'Session complete — solid work.'
      : 'Tick exercises off as you complete them.';

    const panel = $('#session-complete');
    if (panel) {
      panel.hidden = !complete || !S.profile;
      if (complete && S.profile) {
        const copy = $('#complete-copy');
        if (copy) {
          copy.textContent = 'All ' + total + ' exercises ticked off — great work. ' +
            'Want to tweak your plan before next time?';
        }
      }
    }
  }

  function revealCompletePanel() {
    const panel = $('#session-complete');
    if (!panel || panel.hidden) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    });
  }

  /* ================= timer ================= */
  const Timer = {
    total: 60, remaining: 60, running: false, endAt: 0, iv: null,
    set(total) {
      if (this.running) return;
      this.total = total; this.remaining = total;
      this.paint();
    },
    paint() {
      const el = $('#timer-display');
      if (!el) return;
      el.textContent = UI.formatTime(this.remaining);
      el.classList.toggle('is-running', this.running);
      el.classList.toggle('is-done', !this.running && this.remaining === 0 && this.total > 0);
    },
    startPause() {
      if (this.running) {
        this.running = false;
        clearInterval(this.iv);
        this.remaining = Math.max(0, Math.round((this.endAt - Date.now()) / 1000));
      } else {
        if (this.remaining <= 0) this.remaining = this.total;
        this.running = true;
        this.endAt = Date.now() + this.remaining * 1000;
        this.iv = setInterval(() => {
          this.remaining = Math.max(0, Math.round((this.endAt - Date.now()) / 1000));
          this.paint();
          if (this.remaining <= 0) {
            this.running = false;
            clearInterval(this.iv);
            this.paint();
            UI.toast('Rest over — next set!', { type: 'success', timeout: 4000 });
          }
        }, 250);
      }
      this.paint();
      $('#timer-start').textContent = this.running ? 'Pause' : 'Start';
    },
    reset(total) {
      clearInterval(this.iv);
      this.running = false;
      this.total = total != null ? total : this.total;
      this.remaining = this.total;
      this.paint();
      const b = $('#timer-start');
      if (b) b.textContent = 'Start';
    },
  };
  function resetTimer(total) { Timer.reset(total); }

  /* ================= browse ================= */
  let searchTimer = null;

  async function fillSelects() {
    try {
      const [bps, eqs, mss] = await Promise.all([
        PitchAPI.bodyParts(), PitchAPI.equipments(), PitchAPI.muscles(),
      ]);
      fill('#f-bodypart', bps, 'All body parts');
      fill('#f-equipment', eqs, 'All equipment');
      fill('#f-muscle', mss, 'All muscles');
    } catch (err) {
      UI.toast(err.message || 'Could not load filter lists', { type: 'error' });
    }
    function fill(sel, list, allLabel) {
      const el = $(sel);
      if (!el) return;
      const prev = el.value;
      el.innerHTML = '<option value="">' + allLabel + '</option>' +
        list.map(x => '<option value="' + UI.esc(x.name) + '">' + UI.esc(UI.titleCase(x.name)) + '</option>').join('');
      if (prev) el.value = prev;
    }
  }

  function renderGoalChips() {
    const host = $('#goal-chips');
    host.innerHTML = Goals.GOALS.map(g =>
      '<button class="chip' + (S.browse.goal === g.id ? ' is-on' : '') + '" type="button" data-goalchip="' + g.id + '">' +
      UI.icon(g.icon, 13) + UI.esc(g.name) + '</button>'
    ).join('');
  }

  function browseParams(after) {
    const b = S.browse;
    const q = { after: after || undefined };
    const g = b.goal ? Goals.getGoal(b.goal) : null;
    if (g) Object.assign(q, g.queries[0]);
    if (b.bodyPart) q.bodyParts = b.bodyPart;
    if (b.equip) q.equipments = b.equip;
    if (b.muscle) q.targetMuscles = b.muscle;
    if (b.query) q.name = b.query;
    return q;
  }

  function sortItems(items) {
    const b = S.browse;
    const arr = items.slice();
    const g = b.goal ? Goals.getGoal(b.goal) : null;
    if (b.sort === 'name-asc') arr.sort((a, c) => String(a.name).localeCompare(String(c.name)));
    else if (b.sort === 'name-desc') arr.sort((a, c) => String(c.name).localeCompare(String(a.name)));
    else if (b.sort === 'bodypart') {
      arr.sort((a, c) =>
        String((a.bodyParts || [])[0] || '').localeCompare(String((c.bodyParts || [])[0] || '')) ||
        String(a.name).localeCompare(String(c.name)));
    } else if (g && g.boost) {
      arr.sort((a, c) => (g.boost.test(c.name || '') ? 1 : 0) - (g.boost.test(a.name || '') ? 1 : 0));
    }
    return arr;
  }

  async function renderBrowse() {
    if (!S.browse.initialized) {
      S.browse.initialized = true;
      renderGoalChips();
      fillSelects();
      await loadBrowse(true);
    }
  }

  async function loadBrowse(reset) {
    const b = S.browse;
    if (b.loading) return;
    b.loading = true;

    const grid = $('#exercise-grid');
    const status = $('#browse-status');
    const loadBtn = $('#load-more');
    const empty = $('#browse-empty');

    if (reset) {
      b.after = null;
      b.items = [];
      grid.innerHTML = UI.skeletons(8);
      empty.hidden = true;
      loadBtn.hidden = true;
      status.innerHTML = 'Loading exercises…';
    }

    try {
      let page;
      if (b.favsOnly) {
        page = { items: Object.values(S.favData), meta: {} };
      } else {
        page = await PitchAPI.fetchPage(browseParams(b.after));
      }

      const seen = new Set(b.items.map(x => x.exerciseId));
      const fresh = page.items.filter(x => !seen.has(x.exerciseId));
      b.items = b.items.concat(fresh);
      b.total = page.meta && page.meta.total != null ? page.meta.total : b.items.length;
      b.hasMore = !b.favsOnly && !!(page.meta && page.meta.hasNextPage);
      b.after = (page.meta && page.meta.nextCursor) || null;

      paintBrowse();
    } catch (err) {
      status.innerHTML = '<span style="color:var(--danger)">' + UI.esc(err.message) + '</span>';
      grid.innerHTML = '';
      if (b.items.length === 0) {
        empty.hidden = false;
        empty.querySelector('h3').textContent = err.isRateLimited ? 'Rate limited' : 'Could not load exercises';
        empty.querySelector('p').textContent = err.message;
        const btn = empty.querySelector('button');
        btn.textContent = 'Retry';
        btn.onclick = () => loadBrowse(true);
      }
      if (err.isRateLimited) {
        UI.toast('The API is rate limiting us — wait a few seconds.', {
          type: 'error', actionLabel: 'Retry now', onAction: () => loadBrowse(true), timeout: 8000,
        });
      } else if (err.isOffline) {
        showBanner('You appear to be offline — showing what we have.', 'Retry', () => loadBrowse(true));
      } else {
        UI.toast(err.message, { type: 'error', actionLabel: 'Retry', onAction: () => loadBrowse(true) });
      }
    } finally {
      b.loading = false;
    }
  }

  function paintBrowse() {
    const b = S.browse;
    const grid = $('#exercise-grid');
    const status = $('#browse-status');
    const loadBtn = $('#load-more');
    const empty = $('#browse-empty');

    let items = b.items;
    if (b.favsOnly) items = items.filter(x => S.favorites.has(x.exerciseId));
    items = sortItems(items);

    if (!items.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.querySelector('h3').textContent = b.favsOnly ? 'No favorites yet' : 'Nothing matched';
      empty.querySelector('p').textContent = b.favsOnly
        ? 'Star exercises to save them here.'
        : 'Try a different search, or relax the filters.';
      const btn = empty.querySelector('button');
      btn.textContent = b.favsOnly ? 'Browse all exercises' : 'Clear filters';
      btn.onclick = b.favsOnly
        ? () => { S.browse.favsOnly = false; $('#f-favs').checked = false; loadBrowse(true); }
        : clearFilters;
      status.innerHTML = '';
      loadBtn.hidden = true;
      return;
    }

    empty.hidden = true;
    grid.innerHTML = items.map((it, i) => UI.exerciseCard(it, {
      fav: S.favorites.has(it.exerciseId),
      i: Math.min(i, 12),
    })).join('');
    UI.bindImgErrors(grid);

    const parts = ['Showing <strong>' + items.length + '</strong> exercise' + (items.length === 1 ? '' : 's')];
    if (!b.favsOnly && b.total > items.length) parts.push('of <strong>' + b.total + '</strong> matching the filters');
    if (b.sort !== 'relevance') parts.push('· sort applies to loaded results');
    if (!b.favsOnly) parts.push('· ' + (PitchAPI.getSource() === 'cache' ? 'from local cache' : 'live from API'));
    if (b.goal) parts.push('· goal: <strong>' + UI.esc(Goals.getGoal(b.goal).name) + '</strong>');
    status.innerHTML = parts.join(' ');

    loadBtn.hidden = !b.hasMore;
    loadBtn.disabled = false;
    loadBtn.textContent = 'Load more exercises';
  }

  function clearFilters() {
    const b = S.browse;
    b.query = ''; b.goal = null; b.bodyPart = ''; b.equip = ''; b.muscle = '';
    b.sort = 'relevance'; b.favsOnly = false;
    $('#search-input').value = '';
    $('#search-clear').hidden = true;
    $('#f-bodypart').value = '';
    $('#f-equipment').value = '';
    $('#f-muscle').value = '';
    $('#f-sort').value = 'relevance';
    $('#f-favs').checked = false;
    renderGoalChips();
    loadBrowse(true);
  }

  /* ================= detail sheet ================= */
  async function openDetail(id) {
    S.detailId = id;
    const sheet = $('#sheet');
    const backdrop = $('#sheet-backdrop');
    sheet.hidden = false;
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    sheet.innerHTML = '<div class="sheet-inner">' +
      '<button class="sheet-close" type="button" aria-label="Close">×</button>' +
      '<div class="skel"><div class="sk-media shimmer"></div><div class="sk-line shimmer"></div><div class="sk-line short shimmer"></div></div>' +
      '<div class="sk-line shimmer" style="margin-top:24px;height:16px"></div>' +
      '<div class="sk-line short shimmer" style="height:14px"></div>' +
      '</div>';

    try {
      const ex = await PitchAPI.getExercise(id);
      if (S.detailId !== id) return; // user moved on
      paintDetail(ex);
    } catch (err) {
      if (S.detailId !== id) return;
      sheet.querySelector('.sheet-inner').innerHTML =
        '<button class="sheet-close" type="button" aria-label="Close">×</button>' +
        '<div class="empty" style="margin-top:40px">' +
          '<h3>' + (err.status === 404 ? 'Exercise not found' : 'Could not load exercise') + '</h3>' +
          '<p class="muted">' + UI.esc(err.message) + '</p>' +
          '<button class="btn btn-ghost" type="button" data-retry-detail="' + UI.esc(id) + '">Retry</button>' +
        '</div>';
      if (!err.isRateLimited) UI.toast(err.message, { type: 'error' });
    }
  }

  function paintDetail(ex) {
    const sheet = $('#sheet');
    const fav = S.favorites.has(ex.exerciseId);
    const inSession = S.session && S.session.ids.indexOf(ex.exerciseId) !== -1;
    const steps = (ex.instructions || []).map(s => UI.esc(String(s).replace(/^Step:\s*\d+[:.)-]?\s*/i, '')));

    sheet.innerHTML = '<div class="sheet-inner">' +
      '<button class="sheet-close" type="button" aria-label="Close">×</button>' +
      '<div class="sheet-media">' + UI.mediaHtml(ex) + '</div>' +
      '<h2 id="sheet-title">' + UI.esc(UI.titleCase(ex.name)) + '</h2>' +
      '<div class="ex-tags">' +
        (ex.bodyParts || []).map(b => '<span>' + UI.esc(UI.titleCase(b)) + '</span>').join('') +
        (ex.equipments || []).map(b => '<span>' + UI.esc(UI.titleCase(b)) + '</span>').join('') +
      '</div>' +

      '<div class="muscle-block"><h4>Primary target</h4><div class="muscle-pills">' +
        (ex.targetMuscles || []).map(m => '<span>' + UI.esc(UI.titleCase(m)) + '</span>').join('') +
      '</div></div>' +
      '<div class="muscle-block"><h4>Secondary</h4><div class="muscle-pills secondary">' +
        ((ex.secondaryMuscles || []).length
          ? ex.secondaryMuscles.map(m => '<span>' + UI.esc(UI.titleCase(m)) + '</span>').join('')
          : '<span class="muted">—</span>') +
      '</div></div>' +

      '<div class="sheet-actions">' +
        '<button class="btn ' + (fav ? 'btn-primary' : 'btn-ghost') + '" type="button" data-fav="' + UI.esc(ex.exerciseId) + '" aria-pressed="' + fav + '">' +
          UI.icon('star', 16) + (fav ? 'Saved' : 'Save') + '</button>' +
        (S.profile
          ? '<button class="btn btn-ghost" type="button" data-add="' + UI.esc(ex.exerciseId) + '"' + (inSession ? ' disabled' : '') + '>' +
            UI.icon('plus', 16) + (inSession ? 'In your session' : 'Add to session') + '</button>'
          : '') +
      '</div>' +

      '<div class="muscle-block"><h4>Form tutorial · ' + steps.length + ' steps</h4></div>' +
      '<ol class="steps">' + steps.map(s => '<li class="step"><span class="n"></span><span>' + s + '</span></li>').join('') + '</ol>' +

      '<div class="muscle-block"><h4>Related exercises</h4></div>' +
      '<div class="related-grid" id="related-grid">' + UI.skeletons(3) + '</div>' +
      '</div>';

    UI.bindImgErrors(sheet);
    loadRelated(ex);
  }

  async function loadRelated(ex) {
    const host = $('#related-grid');
    if (!host) return;
    const muscle = (ex.targetMuscles || [])[0];
    try {
      const page = await PitchAPI.fetchPage(muscle ? { targetMuscles: muscle, limit: 6 } : { bodyParts: (ex.bodyParts || [''])[0], limit: 6 });
      const rel = page.items.filter(x => x.exerciseId !== ex.exerciseId).slice(0, 3);
      if (!host.isConnected) return;
      if (!rel.length) { host.innerHTML = '<p class="muted">No related exercises found.</p>'; return; }
      host.innerHTML = rel.map(x =>
        '<button class="related-card" type="button" data-open="' + UI.esc(x.exerciseId) + '">' +
          '<span class="ex-media">' + UI.mediaHtml(x) + '</span>' +
          '<p>' + UI.esc(UI.titleCase(x.name)) + '</p>' +
        '</button>'
      ).join('');
      UI.bindImgErrors(host);
    } catch (err) {
      if (host.isConnected) host.innerHTML = '<p class="muted">Related exercises unavailable right now.</p>';
    }
  }

  function closeSheet() {
    const sheet = $('#sheet');
    const backdrop = $('#sheet-backdrop');
    if (sheet && !sheet.hidden) {
      sheet.hidden = true;
      sheet.innerHTML = '';
      document.body.style.overflow = '';
    }
    if (backdrop) backdrop.hidden = true;
    S.detailId = null;
  }

  /* ================= favorites ================= */
  async function toggleFavorite(id, btn) {
    const was = S.favorites.has(id);
    if (was) {
      S.favorites.delete(id);
      delete S.favData[id];
    } else {
      S.favorites.add(id);
      const item = poolById(id) || S.session && (S.session.ids || []).includes(id) ? poolById(id) : null;
      if (item) S.favData[id] = item;
      else {
        try { S.favData[id] = await PitchAPI.getExercise(id); }
        catch (e) { /* keep id only */ }
      }
    }
    saveFavorites();

    // reflect on all buttons for this id
    $$('[data-fav="' + id + '"]').forEach(b => {
      const on = S.favorites.has(id);
      b.classList.toggle('is-on', on);
      b.classList.toggle('btn-primary', on && b.classList.contains('btn'));
      b.classList.toggle('btn-ghost', !on && b.classList.contains('btn'));
      b.setAttribute('aria-pressed', String(on));
      if (b.classList.contains('btn')) b.innerHTML = UI.icon('star', 16) + (on ? 'Saved' : 'Save');
    });

    if (S.browse.favsOnly && S.view === 'browse') loadBrowse(true);
    if (btn) UI.toast(was ? 'Removed from favorites' : 'Saved to favorites', { type: was ? '' : 'success', timeout: 2200 });
  }

  /* ================= banner ================= */
  function showBanner(msg, actionLabel, onAction) {
    const el = $('#status-banner');
    if (!el) return;
    el.hidden = false;
    el.innerHTML = '<span>' + UI.esc(msg) + '</span>' +
      (actionLabel ? '<button class="btn btn-sm btn-ghost" type="button">' + UI.esc(actionLabel) + '</button>' : '');
    const b = el.querySelector('button');
    if (b) b.addEventListener('click', () => { el.hidden = true; if (onAction) onAction(); });
  }
  function hideBanner() { const el = $('#status-banner'); if (el) el.hidden = true; }

  /* ================= events ================= */
  function wire() {
    /* topbar */
    $('#theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      UI.applyTheme(next);
    });

    /* onboarding */
    $('#goal-grid').addEventListener('click', e => {
      const card = e.target.closest('[data-goal]');
      if (!card) return;
      S.draft.goal = card.dataset.goal;
      renderOnboarding();
      setTimeout(() => showStep(2), 220);
    });
    $('#equip-grid').addEventListener('click', e => {
      const card = e.target.closest('[data-equip]');
      if (!card) return;
      S.draft.equipment = card.dataset.equip;
      renderOnboarding();
      setTimeout(() => showStep(3), 220);
    });
    $('#level-grid').addEventListener('click', e => {
      const card = e.target.closest('[data-level]');
      if (!card) return;
      S.draft.level = card.dataset.level;
      renderOnboarding();
    });
    $('.onb-progress').addEventListener('click', e => {
      const dot = e.target.closest('[data-dot]');
      if (dot) showStep(Number(dot.dataset.dot));
    });
    $('#build-plan').addEventListener('click', async () => {
      const btn = $('#build-plan');
      if (!(S.draft.goal && S.draft.equipment && S.draft.level)) return;
      const prevProfile = S.profile ? Object.assign({}, S.profile) : null;
      S.profile = { goal: S.draft.goal, equipment: S.draft.equipment, level: S.draft.level };
      saveProfile();
      btn.disabled = true;
      const label = btn.querySelector('.btn-label');
      const prev = label.textContent;
      label.textContent = 'Mapping your session…';
      try {
        await ensurePool(true);
        await ensureSession();
        go('#/plan');
        UI.toast(prevProfile
          ? 'Session rebuilt for ' + Goals.getGoal(S.profile.goal).name + '.'
          : 'Your session is ready.', { type: 'success' });
      } catch (err) {
        UI.toast(err.message || 'Could not build the session', {
          type: 'error', actionLabel: 'Retry',
          onAction: () => $('#build-plan').click(),
        });
        S.profile = prevProfile; saveProfile(); // keep the previous setup if a rebuild fails
      } finally {
        label.textContent = prev;
        btn.disabled = false;
      }
    });
    $('#skip-onb').addEventListener('click', () => go('#/browse'));

    /* plan */
    $('#plan-back').addEventListener('click', () => openSetup(3));
    $('#change-goal').addEventListener('click', () => openSetup(1));
    $('#onb-back').addEventListener('click', () => {
      if (currentStep > 1) showStep(currentStep - 1);
    });
    $('#back-to-session').addEventListener('click', () => go('#/plan'));
    $('#session-complete').addEventListener('click', e => {
      const btn = e.target.closest('[data-change]');
      if (!btn) return;
      if (btn.dataset.change === 'goal') openSetup(1);
      else if (btn.dataset.change === 'equipment') openSetup(2);
      else openSetup(3);
    });
    $('#view-plan').addEventListener('click', e => {
      if (e.target.closest('[data-action="goto-onboarding"]')) go('#/setup');
    });
    $('#shuffle-session').addEventListener('click', async () => {
      if (!S.profile || !S.pool.length) return;
      try {
        await ensureSession();
        const ids = Goals.pickSession(S.pool, String(Date.now())).map(x => x.exerciseId);
        S.session.ids = ids;
        saveSession();
        renderPlan();
        UI.toast('New session generated.', { type: 'success', timeout: 2500 });
      } catch (err) {
        UI.toast(err.message, { type: 'error' });
      }
    });
    $('#timer-start').addEventListener('click', () => Timer.startPause());
    $('#timer-reset').addEventListener('click', () => {
      const g = S.profile ? Goals.guidance(S.profile.goal, S.profile.level) : { rest: 60 };
      Timer.reset(g.rest);
    });

    /* browse controls */
    $('#search-input').addEventListener('input', e => {
      const v = e.target.value;
      $('#search-clear').hidden = !v;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        S.browse.query = v.trim();
        loadBrowse(true);
      }, 320);
    });
    $('#search-clear').addEventListener('click', () => {
      $('#search-input').value = '';
      $('#search-clear').hidden = true;
      S.browse.query = '';
      loadBrowse(true);
    });
    $('#f-bodypart').addEventListener('change', e => { S.browse.bodyPart = e.target.value; loadBrowse(true); });
    $('#f-equipment').addEventListener('change', e => { S.browse.equip = e.target.value; loadBrowse(true); });
    $('#f-muscle').addEventListener('change', e => { S.browse.muscle = e.target.value; loadBrowse(true); });
    $('#f-sort').addEventListener('change', e => { S.browse.sort = e.target.value; paintBrowse(); });
    $('#f-favs').addEventListener('change', e => { S.browse.favsOnly = e.target.checked; loadBrowse(true); });
    $('#goal-chips').addEventListener('click', e => {
      const chip = e.target.closest('[data-goalchip]');
      if (!chip) return;
      const id = chip.dataset.goalchip;
      S.browse.goal = S.browse.goal === id ? null : id;
      renderGoalChips();
      loadBrowse(true);
    });
    $('#load-more').addEventListener('click', () => loadBrowse(false));
    $('#clear-filters').addEventListener('click', clearFilters);

    /* session list interactions */
    $('#session-list').addEventListener('change', e => {
      const cb = e.target.closest('[data-check]');
      if (!cb) return;
      const id = cb.dataset.check;
      if (cb.checked) S.completed.add(id); else S.completed.delete(id);
      saveCompleted();
      const row = cb.closest('.session-item');
      if (row) row.classList.toggle('is-done', cb.checked);
      updateProgress();
      revealCompletePanel();
    });

    /* sheet */
    $('#sheet').addEventListener('click', e => {
      if (e.target.closest('.sheet-close')) { closeSheetAndBack(); return; }
      const retry = e.target.closest('[data-retry-detail]');
      if (retry) openDetail(retry.dataset.retryDetail);
      const add = e.target.closest('[data-add]');
      if (add && S.session && S.profile) {
        const id = add.dataset.add;
        if (!S.session.ids.includes(id)) {
          S.session.ids.push(id);
          saveSession();
          add.disabled = true;
          add.innerHTML = UI.icon('plus', 16) + 'In your session';
          UI.toast('Added to your session.', { type: 'success', timeout: 2500 });
          updateProgress();
        }
      }
    });
    $('#sheet-backdrop').addEventListener('click', closeSheetAndBack);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#sheet').hidden) closeSheetAndBack();
    });

    /* global delegation: open + favorite */
    document.addEventListener('click', e => {
      const favBtn = e.target.closest('[data-fav]');
      if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(favBtn.dataset.fav, favBtn);
        return;
      }
      const openEl = e.target.closest('[data-open]');
      if (openEl) {
        e.preventDefault();
        go('#/exercise/' + encodeURIComponent(openEl.dataset.open));
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest('[role="button"][data-open]');
      if (el) { e.preventDefault(); go('#/exercise/' + encodeURIComponent(el.dataset.open)); }
    });

    /* network status */
    window.addEventListener('offline', () => showBanner('You are offline — the app will use its local cache.'));
    window.addEventListener('online', () => { hideBanner(); UI.toast('Back online.', { type: 'success', timeout: 2500 }); });

    window.addEventListener('hashchange', route);
  }

  function closeSheetAndBack() {
    closeSheet();
    go(S.routeBase || '#/');
  }

  /* ================= init ================= */
  function init() {
    loadPersisted();

    // theme
    if (!document.documentElement.dataset.theme) UI.applyTheme('dark');

    wire();
    UI.readServedBy();

    // liveness check — non-blocking
    PitchAPI.liveness()
      .then(() => hideBanner())
      .catch(err => showBanner('ExerciseDB API unreachable: ' + err.message, 'Retry', () => {
        PitchAPI.liveness().then(hideBanner).catch(e => showBanner('Still unreachable: ' + e.message, 'Retry', () => route()));
      }));

    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
