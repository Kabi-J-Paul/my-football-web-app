/* Pitchify — UI helpers: icons, escaping, cards, skeletons, toasts */
const UI = (() => {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- icons ---------- */
  const PATHS = {
    bolt: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>',
    pulse: '<path d="M3 12h4l2.5-7 4 14L16 12h5"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    arrows: '<path d="M7 7l-4 4 4 4M3 11h13a4 4 0 010 8h-1M17 17l4-4-4-4M21 13H8a4 4 0 000 8h1"/>',
    stretch: '<path d="M12 4.5a1.8 1.8 0 100-.1M12 8v5m0 0l-3.5 6M12 13l3.5 6M8 10.5l4-1 4 1"/>',
    star: '<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8L3.5 9.8l5.9-.8L12 3.6z"/>',
    fire: '<path d="M12 3s5 4.5 5 9a5 5 0 01-10 0c0-1.6.6-3 1.5-4 0 1.5 1 2.5 2 2.5 0-3 1.5-5.5 1.5-7.5z"/>',
    check: '<path d="M4 12.5l5.5 5.5L20 6.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5l3.4 2.5-1.3 4h-4.2l-1.3-4L12 6.5zM4.5 10.5l3.7 1M19.5 10.5l-3.7 1M8 19l1.5-4M16 19l-1.5-4"/>',
  };

  function icon(name, size = 20, extra = '') {
    const d = PATHS[name] || PATHS.ball;
    return '<svg class="ic ' + extra + '" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  const ACCENTS = { lime: 'var(--lime)', green: 'var(--green)', sand: 'var(--sand)', mint: 'var(--mint)', violet: 'var(--violet)' };

  /* ---------- formatting ---------- */
  function titleCase(s) {
    return String(s || '').replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  }
  function formatTime(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------- media ---------- */
  function mediaHtml(item) {
    const alt = esc(titleCase(item.name)) + ' exercise demonstration';
    if (item.gifUrl) {
      return '<img src="' + esc(item.gifUrl) + '" alt="' + alt + '" loading="lazy" decoding="async">';
    }
    return '<div class="ph">' + esc(titleCase(item.name || 'Exercise')) + '</div>';
  }

  /** Swap broken GIFs for a clean placeholder tile */
  function bindImgErrors(root) {
    (root || document).querySelectorAll('.ex-media img, .sheet-media img, .s-thumb img').forEach(img => {
      img.addEventListener('error', () => {
        const tile = document.createElement('div');
        tile.className = 'ph';
        tile.textContent = img.alt ? img.alt.replace(/ exercise demonstration$/, '') : 'Preview unavailable';
        img.replaceWith(tile);
      }, { once: true });
    });
  }

  /* ---------- exercise card ---------- */
  function exerciseCard(item, opts = {}) {
    const fav = !!opts.fav;
    const bp = (item.bodyParts || []).slice(0, 1).map(titleCase).join('');
    const eq = (item.equipments || []).slice(0, 1).map(titleCase).join('');
    const tgt = (item.targetMuscles || [])[0];
    return '' +
      '<div class="ex-card" role="button" tabindex="0" data-open="' + esc(item.exerciseId) + '" ' +
        'aria-label="Open ' + esc(titleCase(item.name)) + '" style="animation-delay:' + (opts.i || 0) * 35 + 'ms">' +
        '<span class="ex-media">' + mediaHtml(item) + '</span>' +
        '<button class="ex-star' + (fav ? ' is-on' : '') + '" type="button" data-fav="' + esc(item.exerciseId) + '" ' +
          'aria-pressed="' + fav + '" aria-label="' + (fav ? 'Remove from favorites' : 'Save to favorites') + '">' +
          icon('star', 16) + '</button>' +
        '<span class="ex-body">' +
          '<span class="ex-name">' + esc(titleCase(item.name)) + '</span>' +
          '<span class="ex-tags">' +
            (bp ? '<span>' + esc(bp) + '</span>' : '') +
            (eq ? '<span>' + esc(eq) + '</span>' : '') +
            (tgt ? '<span class="tag-muscle">' + esc(titleCase(tgt)) + '</span>' : '') +
          '</span>' +
        '</span>' +
      '</div>';
  }

  function skeletons(n = 8) {
    let out = '';
    for (let i = 0; i < n; i++) {
      out += '<div class="skel"><div class="sk-media shimmer"></div>' +
        '<div class="sk-line shimmer"></div><div class="sk-line short shimmer"></div></div>';
    }
    return out;
  }

  /* ---------- toasts ---------- */
  function toast(message, opts = {}) {
    const host = document.getElementById('toasts');
    if (!host) return () => {};
    const el = document.createElement('div');
    el.className = 'toast ' + (opts.type || '');
    const iconChar = opts.type === 'error' ? '⚠' : opts.type === 'success' ? '✓' : 'ℹ';
    el.innerHTML = '<span class="t-icon" aria-hidden="true">' + iconChar + '</span>' +
      '<span class="t-body"><span>' + esc(message) + '</span>' +
      (opts.actionLabel ? '<br><button class="t-action" type="button">' + esc(opts.actionLabel) + '</button>' : '') +
      '</span>' +
      '<button class="t-close" type="button" aria-label="Dismiss">×</button>';
    host.appendChild(el);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 350);
    }
    el.querySelector('.t-close').addEventListener('click', close);
    const act = el.querySelector('.t-action');
    if (act) act.addEventListener('click', () => { close(); if (opts.onAction) opts.onAction(); });
    setTimeout(close, opts.timeout || 6000);
    return close;
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('pitchify:theme', theme); } catch (e) { /* ignore */ }
  }

  /* ---------- served-by badge (same-origin header read) ---------- */
  async function readServedBy() {
    const el = document.getElementById('served-by');
    const footer = document.getElementById('site-footer');
    if (!el || !footer) return;
    try {
      const res = await fetch(window.location.href.split('#')[0], { method: 'HEAD', cache: 'no-store' });
      const v = res.headers.get('x-served-by');
      if (!v) return;                    // local / no LB: keep the badge hidden
      el.textContent = 'served by: ' + v;
      footer.hidden = false;
    } catch (e) { /* offline or header blocked — stay hidden */ }
  }

  return {
    esc, icon, titleCase, formatTime,
    mediaHtml, bindImgErrors, exerciseCard, skeletons, toast,
    applyTheme, readServedBy,
    ACCENTS,
  };
})();
