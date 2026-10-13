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
    captionText: '',
    imageError: '',
    imageUrl: '',
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
    const root = new DOMParser().parseFromString(html, 'text/html');
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
      installReopenButton();
      const panel = el('mcs-share-panel');
      if (!panel) return;
      panel.hidden = false;
      el('mcs-title').value = mcsShare.title || '';
    }
    el('mcs-status').textContent = 'اكتمل النشر — ' + state.sites.size + ' موقع ناجح من ' + state.expected;
    renderSites();
    if (state.imageError) showImageError();
    else if (state.image) scheduleCard();
    else el('mcs-image-state').textContent = 'جاري تحميل الصورة الأصلية…';
  }

  function installReopenButton() {
    const modal = el('mainwp-posting-post-modal');
    const actions = modal?.querySelector('.actions');
    if (!actions || el('mcs-reopen')) return;
    const button = document.createElement('button');
    button.id = 'mcs-reopen';
    button.type = 'button';
    button.className = 'ui primary button';
    button.textContent = 'إعادة فتح مشاركة واتساب';
    button.addEventListener('click', () => {
      state.dismissed = false;
      el('mcs-share-panel').hidden = false;
    });
    actions.prepend(button);
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
    // No arbitrary length cut, no splitting, one clipboard operation for every link.
    state.captionText = selected.length ?
      'روابط الخبر:\n\n' + selected.map(s => s.name + '\n' + s.url).join('\n\n') : '';
    el('mcs-caption').value = state.captionText;
    el('mcs-copy-caption').disabled = !state.captionText;
    const length = state.captionText.length;
    if (!length) {
      el('mcs-caption-progress').textContent = 'لم يتم تحديد مواقع';
    } else if (length > mcsShare.captionGuide) {
      el('mcs-caption-progress').textContent = length + ' حرف — قد يتجاوز حد وصف الصورة؛ الصقه كرسالة نصية واحدة بعد الصورة';
    } else {
      el('mcs-caption-progress').textContent = length + ' حرف — انسخ النص كاملًا';
    }
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
      const copied = document.execCommand('copy');
      field.value = state.captionText;
      return copied;
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
      const text = state.captionText;
      if (text && await copyText(text)) {
        toast('تم نسخ الروابط كلها (' + selectedSites().length + ' مواقع) دفعة واحدة، دون حذف أو تقسيم.');
      }
    });
  }

  async function loadImageEarly() {
    if (!mcsShare.hasImage) {
      state.imageError = mcsShare.strings.noImage;
      return;
    }
    try {
      // Download first, while the central post and its media reference still exist.
      // A fetch response preserves the actual HTTP error; Image.onerror does not.
      const response = await fetch(mcsShare.imageEndpoint, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'image/png,image/jpeg,image/webp' }
      });
      if (!response.ok) {
        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const detail = (parsed.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 130);
        throw new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));
      }
      const blob = await response.blob();
      if (!/^image\/(jpeg|png|webp)$/.test(blob.type) || !blob.size) {
        throw new Error('استجابة الخادم ليست ملف صورة JPEG/PNG/WebP صالحًا');
      }
      state.imageUrl = URL.createObjectURL(blob);
      sourceImage.onload = function () {
        state.image = sourceImage;
        state.imageError = '';
        if (state.opened) {
          warning('');
          scheduleCard();
        }
      };
      sourceImage.onerror = function () {
        state.imageError = 'المتصفح لم يتمكن من قراءة الصورة المستلمة';
        if (state.opened) showImageError();
      };
      sourceImage.src = state.imageUrl;
    } catch (err) {
      state.imageError = err?.message || 'فشل غير معروف';
      if (state.opened) showImageError();
    }
  }

  function showImageError() {
    const message = mcsShare.strings.imageError + ' (' + state.imageError + ')';
    warning(message);
    el('mcs-image-state').textContent = message;
    console.warn('[Mubdaa Central Share] Source photo failed:', state.imageError);
  }

  $(function () {
    if (!el('mcs-share-panel')) return;
    setupControls();
    discoverExpected();
    loadImageEarly();
    readSynchronousResults();
  });
})(jQuery);
