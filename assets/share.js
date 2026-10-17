/* global mcsShare, jQuery, ClipboardItem */
(function ($) {
  'use strict';
  if (typeof mcsShare === 'undefined') return;

  const state = {
    sites: new Map(),
    failed: new Map(),
    completed: new Set(),
    recoveryStarted: false,
    recovering: false,
    beginRequestStarted: false,
    beginRequest: null,
    expected: 0,
    opened: false,
    dismissed: false,
    image: null,
    cardBlob: null,
    cardReady: false,
    captionText: '',
    imageError: '',
    imageUrl: '',
    shortlinksReady: false,
    shortlinksRequest: null,
    refreshTimer: 0
  };

  const el = (id) => document.getElementById(id);
  const sourceImage = new Image();
  sourceImage.decoding = 'async';

  function safeUrl(input) {
    try {
      const url = new URL(input, window.location.href);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
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
      state.failed.delete(String(id));
      const old = state.sites.get(String(id));
      state.sites.set(String(id), {
        id: String(id),
        name: name || siteName(id),
        url: link,
        shareUrl: old?.shareUrl || '',
        selected: old ? old.selected : true
      });
    } else if (!state.sites.has(String(id))) {
      // A failed acknowledgement is not proof that the remote post was not created.
      state.failed.set(String(id), { id: String(id), name: name || siteName(id) });
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
      if (String(p.get('post_id')) !== String(mcsShare.postId)) return null;
      const id = p.get('site_id');
      if (!id || !/^\d+$/.test(id) || Number(id) < 1) return null;
      return {
        siteId: p.get('site_id'),
        postId: p.get('post_id'),
        total: Math.min(500, Math.max(0, Number(p.get('total') || 0)))
      };
    } catch (e) { return null; }
  }

  // Stamp the beginning of the real publish (not page load), even if the editor
  // spent a long time preparing the article on the posting screen.
  $(document).ajaxSend(function (_event, _xhr, settings) {
    const args = parseAjaxData(settings.data);
    if (!args || state.beginRequestStarted || !mcsShare.recoveryEndpoint) return;
    state.beginRequestStarted = true;
    const params = new URLSearchParams();
    params.set('action', 'mcs_recovery_begin');
    params.set('post_id', String(mcsShare.postId));
    params.set('nonce', mcsShare.recoveryNonce);
    state.beginRequest = fetch(mcsShare.recoveryEndpoint, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString()
    }).then(response => response.ok).catch(() => false);
  });

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
      const nativeSiteLink = parent?.querySelector('a[href*="dashboard="]')?.getAttribute('href') || '';
      const actualSiteId = nativeSiteLink ? new URL(nativeSiteLink, window.location.href).searchParams.get('dashboard') : null;
      const id = String(actualSiteId || (index + 1));
      state.sites.set(id, { id, name, url: target, shareUrl: '', selected: true });
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
    el('mcs-status').textContent = 'تم جمع ' + state.sites.size + ' روابط مؤكدة من ' + state.expected + ' مواقع';
    renderSites();
    fetchConfirmedShortlinks();
    if (state.failed.size && !state.recoveryStarted) {
      state.recoveryStarted = true;
      el('mcs-recovery-status').textContent = 'هناك مواقع لم تؤكد MainWP نتيجتها؛ جاري التحقق من المقالات المنشورة دون إعادة نشر.';
      window.setTimeout(recoverFailed, 1500);
    }
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
      if (s.recovered) {
        const recovered = document.createElement('small');
        recovered.textContent = 'تأكد وجود المقال بعد خطأ الاتصال — تحقق من صورته البارزة';
        name.appendChild(recovered);
      }
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

  function selectedLink(s) {
    const original = s.shareUrl || s.url;
    if (!el('mcs-omit-www')?.checked) return original;
    try {
      const url = new URL(original);
      if (url.hostname.toLowerCase().startsWith('www.')) {
        url.hostname = url.hostname.slice(4);
      }
      return url.href;
    } catch (err) { return original; }
  }

  function selectedLinks() { return selectedSites().map(selectedLink); }

  function recalcCaption() {
    const links = selectedLinks();
    el('mcs-selected-count').textContent = links.length + ' محدد';
    // Always retain the full list, regardless of optional grouping or character count.
    state.captionText = links.join('\n');
    el('mcs-caption').value = state.captionText;
    el('mcs-copy-caption').disabled = !state.captionText;
    if (el('mcs-download-pdf')) el('mcs-download-pdf').disabled = !links.length;
    if (el('mcs-download-docx')) el('mcs-download-docx').disabled = !links.length;

    const length = state.captionText.length;
    const grouping = !!el('mcs-split-captions')?.checked;
    const settings = el('mcs-split-settings');
    const area = el('mcs-caption-groups');
    settings.hidden = !grouping;
    area.hidden = !grouping || !links.length;
    area.textContent = '';

    if (grouping && links.length) {
      const count = Math.min(links.length, Number(el('mcs-split-count').value) || 2);
      const groups = Array.from({ length: count }, () => []);
      links.forEach((link, index) => {
        groups[Math.min(count - 1, Math.floor(index * count / links.length))].push(link);
      });
      groups.forEach((group, index) => {
        const value = group.join('\n');
        const row = document.createElement('div');
        row.className = 'mcs-group';
        const header = document.createElement('div');
        header.className = 'mcs-caption-head';
        const title = document.createElement('strong');
        title.textContent = 'المجموعة ' + (index + 1) + ' من ' + count + ' — ' + value.length + ' حرف';
        if (value.length > mcsShare.captionGuide) title.textContent += ' (قد تتجاوز حد الكابشن)';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'نسخ المجموعة ' + (index + 1);
        button.addEventListener('click', async () => {
          if (await copyText(value)) toast('تم نسخ المجموعة ' + (index + 1) + ' كاملة.');
        });
        header.append(title, button);
        const preview = document.createElement('textarea');
        preview.readOnly = true;
        preview.rows = Math.min(5, group.length + 1);
        preview.dir = 'ltr';
        preview.value = value;
        row.append(header, preview);
        area.appendChild(row);
      });
    }

    if (!length) {
      el('mcs-caption-progress').textContent = 'لم يتم تحديد مواقع';
    } else if (length > mcsShare.captionGuide) {
      el('mcs-caption-progress').textContent = length + ' حرف — النص الكامل محفوظ؛ استخدم تقسيم المجموعات اختياريًا';
    } else {
      el('mcs-caption-progress').textContent = length + ' حرف — انسخ النص كاملًا';
    }
  }

  async function recoverFailed() {
    if (state.recovering || !state.failed.size || !mcsShare.recoveryEndpoint) return;
    state.recovering = true;
    if (state.beginRequest) await state.beginRequest;
    const retry = el('mcs-retry-recovery');
    retry.hidden = true;
    const pending = [...state.failed.values()];
    let restored = 0;
    for (const site of pending) {
      // Read-only, sequential calls avoid amplifying the server pressure that caused 503.
      if (state.sites.has(site.id)) { state.failed.delete(site.id); continue; }
      const data = new URLSearchParams();
      data.set('action', 'mcs_recover_site');
      data.set('post_id', String(mcsShare.postId));
      data.set('site_id', site.id);
      data.set('nonce', mcsShare.recoveryNonce);
      el('mcs-recovery-status').textContent = 'التحقق من ' + site.name + ' — ' + (restored + 1) + ' روابط مسترجعة';
      try {
        const response = await fetch(mcsShare.recoveryEndpoint, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: data.toString()
        });
        const result = response.ok ? await response.json() : null;
        const candidate = result?.success ? result.data : null;
        if (candidate?.status === 'confirmed' && typeof candidate.url === 'string') {
          const link = safeUrl(candidate.url);
          if (link) {
            // Keep previously selected successful sites in their original order; recovered
            // sites are never inserted as duplicates or mixed with unrelated publishes.
            state.sites.set(site.id, {
              id: site.id, name: site.name,
              url: link, shareUrl: link, selected: true, recovered: true
            });
            state.failed.delete(site.id);
            restored++;
            renderSites();
          }
        }
      } catch (error) {
        console.warn('[Mubdaa Central Share] Child readback unavailable', site.id);
      }
    }
    state.recovering = false;
    const missing = state.failed.size;
    el('mcs-recovery-status').textContent = restored + ' روابط تم استرجاعها بعد خطأ الاتصال؛ ' +
      (missing ? missing + ' مواقع ما زالت غير مؤكدة. لا تعِد النشر قبل مراجعتها.' : 'جميع روابط المواقع أصبحت مؤكدة.');
    retry.hidden = !missing;
    el('mcs-status').textContent = 'روابط مؤكدة: ' + state.sites.size + ' من ' + state.expected;
  }

  async function fetchConfirmedShortlinks() {
    if (state.shortlinksRequest || !state.sites.size || !mcsShare.shortlinksEndpoint) return;
    const ids = [...state.sites.keys()];
    const params = new URLSearchParams();
    params.set('action', 'mcs_shortlinks');
    params.set('post_id', String(mcsShare.postId));
    params.set('nonce', mcsShare.shortlinksNonce);
    ids.forEach(id => params.append('sites[]', id));
    state.shortlinksRequest = (async () => {
      try {
        const response = await fetch(mcsShare.shortlinksEndpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: params.toString()
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!data.success) throw new Error(data?.data?.message || 'No ID confirmation');
        const links = data?.data?.links || {};
        let confirmed = 0;
        ids.forEach(id => {
          const site = state.sites.get(id);
          if (site && typeof links[id] === 'string' && /^https?:\/\//.test(links[id])) {
            site.shareUrl = links[id];
            confirmed++;
          }
        });
        state.shortlinksReady = true;
        recalcCaption();
        if (confirmed < ids.length) {
          toast('تم تأكيد روابط قصيرة لـ ' + confirmed + ' من ' + ids.length +
            ' موقع؛ بقية الروابط ستظل أصلية منعًا لتخمين معرّف المقال.');
        }
      } catch (error) {
        console.warn('[Mubdaa Central Share] Could not confirm child IDs', error);
        toast('تعذر جلب معرّفات المقالات؛ الروابط الأصلية محفوظة كبديل آمن.');
      } finally {
        state.shortlinksRequest = null;
      }
    })();
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
      el('mcs-download-pdf').disabled = !selectedSites().length;
      el('mcs-download-docx').disabled = !selectedSites().length;
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
    el('mcs-omit-www').addEventListener('change', recalcCaption);
    el('mcs-split-captions').addEventListener('change', recalcCaption);
    el('mcs-split-count').addEventListener('change', recalcCaption);
    el('mcs-retry-recovery').addEventListener('click', recoverFailed);
    el('mcs-retry-image').addEventListener('click', () => {
      el('mcs-retry-image').hidden = true;
      el('mcs-image-state').textContent = 'جاري إعادة تحميل الصورة…';
      loadImageEarly();
    });
    el('mcs-copy-image').addEventListener('click', copyImage);
    el('mcs-download-image').addEventListener('click', downloadImage);
    el('mcs-download-pdf').addEventListener('click', () => exportFile('pdf'));
    el('mcs-download-docx').addEventListener('click', () => exportFile('docx'));
    el('mcs-copy-caption').addEventListener('click', async () => {
      const text = state.captionText;
      if (text && await copyText(text)) {
        toast('تم نسخ الروابط كلها (' + selectedSites().length + ' مواقع) دفعة واحدة، دون حذف أو تقسيم.');
      }
    });
  }

  async function exportFile(kind) {
    const button = el(kind === 'pdf' ? 'mcs-download-pdf' : 'mcs-download-docx');
    if (!selectedSites().length || !window.MCSExport) {
      toast('حدد موقعًا واحدًا على الأقل وتأكد من تحميل مكتبة التصدير.'); return;
    }
    button.disabled = true;
    try {
      // Preserve the unmodified photo in Word; PDF uses the titled ready-made image card.
      const src = state.image;
      let w = 0, h = 0, photoBlob = null;
      if (src && src.naturalWidth > 0 && src.naturalHeight > 0) {
        const scale = Math.min(1, 1600 / Math.max(src.naturalWidth, src.naturalHeight));
        w = Math.max(1, Math.round(src.naturalWidth * scale));
        h = Math.max(1, Math.round(src.naturalHeight * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const context = cv.getContext('2d');
        if (context) {
          context.drawImage(src, 0, 0, w, h);
          photoBlob = await new Promise(resolve => cv.toBlob(resolve, 'image/png'));
        }
      }
      const data = {
        title:el('mcs-title').value.trim() || mcsShare.title,
        cardBlob:state.cardBlob,
        photoBlob,
        photoWidth:w,
        photoHeight:h,
        // Documents use the verified original URLs, not optional WhatsApp formatting.
        sites:selectedSites().map(s=>({url:s.shareUrl || s.url}))
      };
      if (!data.sites.length) throw new Error('اختر موقعًا واحدًا على الأقل');
      await window.MCSExport[kind](data);
      toast('تم تجهيز ' + (kind === 'pdf' ? 'PDF' : 'Word') +
        (state.cardReady && photoBlob ? ' بالصورة والروابط' : ' بالروابط كاملة بدون صورة') + '؛ أرفقه كمستند في واتساب.');
    } catch (err) {
      toast('تعذر إنشاء الملف: ' + (err?.message || String(err)));
      console.error('[Mubdaa Central Share] Document export failed',err);
    } finally { button.disabled = false; }
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
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
      state.imageUrl = URL.createObjectURL(blob);
      sourceImage.onload = function () {
        state.image = sourceImage;
        state.imageError = '';
        el('mcs-retry-image').hidden = true;
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
    el('mcs-retry-image').hidden = false;
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
