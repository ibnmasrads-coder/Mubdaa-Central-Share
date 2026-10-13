/* global mcsShare, jQuery, ClipboardItem */
(function ($) {
  'use strict';
  if (typeof mcsShare === 'undefined') return;

  const state = {
    sites: new Map(),
    completed: new Set(),
    expected: 0,
    opened: false,
    dismissed: false,
    image: null,
    cardBlob: null,
    cardReady: false,
    captionChunks: [],
    captionIndex: 0,
    refreshTimer: 0
  };

  const el = (id) => document.getElementById(id);
  const sourceImage = new Image();
  sourceImage.decoding = 'async';

  function safeUrl(input) {
    try {
      const url = new URL(input, window.location.href);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch (e) { return ''; }
  }

  function siteRow(id) {
    const rows = document.querySelectorAll('.site-bulk-posting[site-id]');
    return Array.from(rows).find(row => row.getAttribute('site-id') === String(id));
  }

  function siteName(id) {
    const row = siteRow(id);
    if (!row) return 'الموقع ' + id;
    return (row.querySelector('a')?.textContent || 'الموقع ' + id).trim();
  }

  function discoverExpected() {
    const rows = document.querySelectorAll('.site-bulk-posting[site-id]');
    if (rows.length) state.expected = Math.max(state.expected, rows.length);
  }

  function findLink(html) {
    if (!html || typeof html !== 'string') return '';
    const root = document.createElement('div');
    root.innerHTML = html;
    const anchor = root.querySelector('a.mainwp-may-hide-referrer[target="_blank"]');
    return anchor ? safeUrl(anchor.getAttribute('href')) : '';
  }

  function recordResult(id, name, link) {
    if (!id) return;
    state.completed.add(String(id));
    if (link) {
      const old = state.sites.get(String(id));
      state.sites.set(String(id), {
        id: String(id),
        name: name || siteName(id),
        url: link,
        selected: old ? old.selected : true
      });
    }
    discoverExpected();
    if (state.expected > 0 && state.completed.size >= state.expected) {
      finish();
    }
  }

  function parseAjaxData(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const p = new URLSearchParams(raw);
      if (p.get('action') !== 'mainwp_post_postingbulk') return null;
      return {
        siteId: p.get('site_id'),
        postId: p.get('post_id'),
        total: Number(p.get('total') || 0)
      };
    } catch (e) { return null; }
  }

  // The MainWP AJAX response contains the same "View Post" URL shown in its modal.
  $(document).ajaxSuccess(function (_event, xhr, settings, data) {
    const args = parseAjaxData(settings.data);
    if (!args || !args.siteId) return;
    state.expected = Math.max(state.expected, args.total);
    let parsed = data;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (e) { parsed = {}; }
    }
    const link = findLink(parsed?.result);
    recordResult(args.siteId, siteName(args.siteId), link);
  });
  $(document).ajaxError(function (_event, xhr, settings) {
    const args = parseAjaxData(settings.data);
    if (!args || !args.siteId) return;
    state.expected = Math.max(state.expected, args.total);
    recordResult(args.siteId, siteName(args.siteId), '');
  });

  function readSynchronousResults() {
    const native = el('mainwp-posting-post-modal');
    if (!native) return;
    if (native.querySelectorAll('.site-bulk-posting').length) {
      discoverExpected();
      return;
    }
    const entries = native.querySelectorAll('a.mainwp-may-hide-referrer[target="_blank"]');
    entries.forEach((link, index) => {
      const target = safeUrl(link.getAttribute('href'));
      if (!target) return;
      // MainWP's synchronous flow prints one .item with site anchor and View Post anchor.
      const parent = link.closest('.item');
      let name = parent?.querySelector('a[href*="managesites"]')?.textContent?.trim();
      if (!name) name = new URL(target).hostname;
      const id = String(index + 1);
      state.sites.set(id, { id, name, url: target, selected: true });
    });
    state.expected = entries.length;
    if (entries.length) finish();
  }

  function toast(message) {
    el('mcs-toast').textContent = message;
  }

  function finish() {
    if (state.dismissed) return;
    if (!state.opened) {
      state.opened = true;
      const panel = el('mcs-share-panel');
      if (!panel) return;
      panel.hidden = false;
      el('mcs-title').value = mcsShare.title || '';
    }
    el('mcs-status').textContent = 'اكتمل النشر — ' + state.sites.size + ' موقع ناجح من ' + state.expected;
    renderSites();
    if (!mcsShare.hasImage) warning(mcsShare.strings.noImage);
    scheduleCard();
  }

  function warning(s) {
    el('mcs-warning').textContent = s;
    el('mcs-warning').hidden = !s;
  }

  function renderSites() {
    const area = el('mcs-sites');
    area.textContent = '';
    const sites = [...state.sites.values()];
    sites.forEach((s, index) => {
      const row = document.createElement('div');
      row.className = 'mcs-site';
      const label = document.createElement('label');
      label.className = 'mcs-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = s.selected;
      check.addEventListener('change', () => { s.selected = check.checked; recalcCaption(); });
      const name = document.createElement('span');
      name.className = 'mcs-site-name';
      name.textContent = s.name;
      const domain = document.createElement('small');
      domain.textContent = new URL(s.url).hostname;
      name.appendChild(domain);
      label.append(check, name);
      const controls = document.createElement('div');
      controls.className = 'mcs-order';
      [['↑', -1], ['↓', 1]].forEach(([text, step]) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = text;
        btn.setAttribute('aria-label', step === -1 ? 'رفع الموقع' : 'خفض الموقع');
        btn.disabled = (step === -1 && index === 0) || (step === 1 && index === sites.length - 1);
        btn.addEventListener('click', () => {
          const other = sites[index + step];
          if (!other) return;
          const pairs = [...state.sites.entries()];
          const at = pairs.findIndex(([id]) => id === s.id);
          const to = pairs.findIndex(([id]) => id === other.id);
          [pairs[at], pairs[to]] = [pairs[to], pairs[at]];
          state.sites = new Map(pairs);
          renderSites();
        });
        controls.appendChild(btn);
      });
      row.append(label, controls);
      area.appendChild(row);
    });
    recalcCaption();
  }

  function selectedSites() { return [...state.sites.values()].filter(s => s.selected); }

  function recalcCaption() {
    const selected = selectedSites();
    el('mcs-selected-count').textContent = selected.length + ' محدد';
    const groups = selected.map(s => s.name + '\n' + s.url);
    const chunks = [];
    let current = 'روابط الخبر:\n\n';
    for (const group of groups) {
      const next = (current ? current + (current.endsWith('\n\n') ? '' : '\n\n') : '') + group;
      if (current && next.length > mcsShare.maxCaption && current !== 'روابط الخبر:\n\n') {
        chunks.push(current);
        current = group;
      } else {
        current = next;
      }
    }
    if (groups.length) chunks.push(current);
    state.captionChunks = chunks;
    state.captionIndex = 0;
    renderCaption();
  }

  function renderCaption() {
    const chunks = state.captionChunks;
    el('mcs-caption').value = chunks[0] || '';
    el('mcs-caption-progress').textContent = chunks.length ? ('الجزء الأول من ' + chunks.length) : '';
    el('mcs-copy-caption').disabled = chunks.length === 0;
    el('mcs-next-caption').hidden = chunks.length < 2;
    if (chunks.length > 1) el('mcs-next-caption').textContent = 'نسخ الجزء التالي (2/' + chunks.length + ')';
  }

  function wrap(ctx, title, maxWidth) {
    const words = title.replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const tryLine = line ? line + ' ' + word : word;
      if (line && ctx.measureText(tryLine).width > maxWidth) {
        lines.push(line); line = word;
      } else line = tryLine;
    }
    if (line) lines.push(line);
    if (lines.length > 3) {
      const left = lines.slice(0, 3);
      while (ctx.measureText(left[2] + '…').width > maxWidth && left[2].length > 2) left[2] = left[2].slice(0, -1);
      left[2] += '…';
      return left;
    }
    return lines;
  }

  async function createCard() {
    if (!state.image || !state.opened || state.dismissed) return;
    state.cardReady = false;
    el('mcs-copy-image').disabled = true;
    el('mcs-download-image').disabled = true;
    const img = state.image;
    const canvas = el('mcs-canvas');
    const width = 1200;
    const imageHeight = Math.max(360, Math.min(950, Math.round(width * img.naturalHeight / img.naturalWidth)));
    const headerHeight = 190;
    canvas.width = width;
    canvas.height = imageHeight + headerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) { warning('المتصفح لا يدعم تجهيز الصورة بواسطة Canvas.'); return; }

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#172d43'); gradient.addColorStop(1, '#0c172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const title = el('mcs-title').value.trim() || mcsShare.title;
    ctx.fillStyle = '#ffffff';
    let size = 47, lines = [];
    while (size >= 31) {
      ctx.font = 'bold ' + size + 'px Tahoma, Arial, sans-serif';
      lines = wrap(ctx, title, width - 110);
      if (lines.length <= 3) break;
      size -= 2;
    }
    const lh = size + 12;
    let textY = (headerHeight - (lines.length - 1) * lh) / 2 + (size / 3);
    lines.forEach(line => { ctx.fillText(line, width - 55, textY); textY += lh; });

    // Keep the full image; never crop away the edges of a news photo.
    const scale = Math.min(width / img.naturalWidth, imageHeight / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    const x = (width - dw) / 2, y = headerHeight + (imageHeight - dh) / 2;
    ctx.fillStyle = '#edf1f5';
    ctx.fillRect(0, headerHeight, width, imageHeight);
    ctx.drawImage(img, x, y, dw, dh);
    try {
      state.cardBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      state.cardReady = !!state.cardBlob;
      el('mcs-copy-image').disabled = !state.cardReady;
      el('mcs-download-image').disabled = !state.cardReady;
      el('mcs-image-state').textContent = state.cardReady ? 'الصورة الحقيقية جاهزة للنسخ أو التحميل.' : 'فشل حفظ بطاقة الصورة.';
    } catch (e) { warning(mcsShare.strings.imageError); }
  }

  function scheduleCard() {
    if (!state.image) return;
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(createCard, 40);
  }

  async function copyImage() {
    if (!state.cardBlob) return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('No PNG clipboard support');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': state.cardBlob })]);
      toast('تم نسخ الصورة. الصقها الآن في محادثة واتساب باستخدام Ctrl+V.');
    } catch (e) {
      toast(mcsShare.strings.copyFailed);
    }
  }

  function downloadImage() {
    if (!state.cardBlob) return;
    const href = URL.createObjectURL(state.cardBlob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'mubdaa-news-share.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1500);
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (e) {
      // Fallback for browsers without Clipboard API support.
      const field = el('mcs-caption');
      field.value = value;
      field.focus(); field.select();
      return document.execCommand('copy');
    }
  }

  function setupControls() {
    el('mcs-close').addEventListener('click', () => {
      state.dismissed = true;
      el('mcs-share-panel').hidden = true;
    });
    el('mcs-select-all').addEventListener('click', () => {
      state.sites.forEach(s => { s.selected = true; });
      renderSites();
    });
    el('mcs-select-none').addEventListener('click', () => {
      state.sites.forEach(s => { s.selected = false; });
      renderSites();
    });
    el('mcs-title').addEventListener('input', scheduleCard);
    el('mcs-copy-image').addEventListener('click', copyImage);
    el('mcs-download-image').addEventListener('click', downloadImage);
    el('mcs-copy-caption').addEventListener('click', async () => {
      const text = state.captionChunks[0];
      if (text && await copyText(text)) toast('تم نسخ وصف الصورة. الصقه الآن في خانة Caption بواتساب.');
    });
    el('mcs-next-caption').addEventListener('click', async () => {
      const next = state.captionIndex + 1;
      if (next >= state.captionChunks.length) return;
      const text = state.captionChunks[next];
      if (await copyText(text)) {
        state.captionIndex = next;
        el('mcs-caption').value = text;
        el('mcs-caption-progress').textContent = 'الجزء ' + (next + 1) + ' من ' + state.captionChunks.length;
        el('mcs-next-caption').textContent = 'نسخ الجزء التالي (' + (next + 2) + '/' + state.captionChunks.length + ')';
        el('mcs-next-caption').hidden = next + 1 >= state.captionChunks.length;
        toast('تم نسخ الجزء ' + (next + 1) + '؛ أرسله كرسالة نصية بعد الصورة.');
      }
    });
  }

  function loadImageEarly() {
    if (!mcsShare.hasImage) return;
    sourceImage.onload = function () {
      state.image = sourceImage;
      if (state.opened) scheduleCard();
    };
    sourceImage.onerror = function () { if (state.opened) warning(mcsShare.strings.imageError); };
    sourceImage.src = mcsShare.imageEndpoint;
  }

  $(function () {
    if (!el('mcs-share-panel')) return;
    setupControls();
    discoverExpected();
    loadImageEarly();
    readSynchronousResults();
  });
})(jQuery);
