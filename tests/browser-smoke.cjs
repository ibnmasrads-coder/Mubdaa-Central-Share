/* eslint-disable no-console */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const plugin = fs.readFileSync(path.join(__dirname, '..', 'assets', 'share.js'), 'utf8');

function html(ajax) {
  const sites = ajax ?
    '<div class="site-bulk-posting" site-id="101"><a>جوهر السعودية</a></div><div class="site-bulk-posting" site-id="102"><a>بوصلة المشهد</a></div>' :
    '<div class="item"><a href="admin.php?page=managesites&dashboard=101">جوهر السعودية</a><a class="mainwp-may-hide-referrer" href="https://www.jawharksa.com/test-article/" target="_blank">View Post</a></div>';
  return '<!doctype html><html><body>' +
  '<div id="mainwp-posting-post-modal">' + sites + '<div class="actions"></div></div>' +
  '<section id="mcs-share-panel" hidden>' +
  '<div id="mcs-status"></div><button id="mcs-close"></button><div id="mcs-warning" hidden></div>' +
  '<textarea id="mcs-title"></textarea><div id="mcs-selected-count"></div>' +
  '<button id="mcs-select-all"></button><button id="mcs-select-none"></button>' +
  '<span id="mcs-recovery-status"></span><button id="mcs-retry-recovery" hidden></button>' +
  '<div id="mcs-sites"></div><canvas id="mcs-canvas"></canvas><div id="mcs-image-state"></div><button id="mcs-retry-image" hidden></button>' +
  '<input id="mcs-omit-www" type="checkbox"><input id="mcs-split-captions" type="checkbox">' +
  '<div id="mcs-split-settings" hidden><select id="mcs-split-count"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div><div id="mcs-caption-groups" hidden></div>' +
  '<textarea id="mcs-caption"></textarea><div id="mcs-caption-progress"></div>' +
  '<button id="mcs-copy-image" disabled></button><button id="mcs-download-image" disabled></button>' +
  '<button id="mcs-copy-caption" disabled></button><button id="mcs-download-pdf" disabled></button><button id="mcs-download-docx" disabled></button>' +
  '<div id="mcs-toast"></div></section></body></html>';
}

async function setup(isAjax, recoveryStatus = 'confirmed') {
  const dom = new JSDOM(html(isAjax), {
    url: 'https://main.example.com/wp-admin/admin.php?page=PostingBulkPost&id=123',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const $ = require('jquery')(window);
  window.jQuery = $;
  window.fetch = async (_url, options) => {
    const params = new URLSearchParams(options?.body || '');
    if (params.get('action') === 'mcs_recover_site') {
      return { ok: true, json: async () => ({
        success: true, data: recoveryStatus === 'confirmed' ?
          { status:'confirmed', url:'https://www.bawsalamashhad.com/?p=876', post_id:876 } :
          { status:'ambiguous' }
      }) };
    }
    const ids = params.getAll('sites[]');
    const result = {};
    if (ids.includes('101')) result['101'] = 'https://www.jawharksa.com/?p=310';
    if (ids.includes('102')) result['102'] = 'https://www.bawsalamashhad.com/?p=875';
    return { ok:true, json:async()=>({success:true,data:{links:result}}) };
  };
  window.mcsShare = {
    title: 'خبر جديد',
    postId: 123,
    shortlinksEndpoint: 'https://main.example.com/wp-admin/admin-ajax.php',
    shortlinksNonce: 'test',
    recoveryEndpoint: 'https://main.example.com/wp-admin/admin-ajax.php',
    recoveryNonce: 'test',
    captionGuide: 1024,
    hasImage: false,
    maxCaption: 900,
    strings: { noImage: 'لا توجد صورة بارزة.', imageError: 'فشل الصورة', copyFailed: 'فشل النسخ' }
  };
  window.eval(plugin);
  await new Promise(resolve => setTimeout(resolve, 25));
  return { dom, window, $ };
}

function send($, id, result, total = 2) {
  const data = 'action=mainwp_post_postingbulk&post_id=123&site_id=' + id + '&total=' + total;
  $( $.global?.document || global.document ).trigger('unused');
  // jQuery listens for the event on this window's document, from $.getHandler-like closure.
}

async function main() {
  const ajax = await setup(true);
  const document = ajax.window.document;
  const panel = document.getElementById('mcs-share-panel');
  assert.equal(panel.hidden, true, 'panel not shown before final child-site response');
  function emit(id, markup) {
    ajax.$(document).trigger('ajaxSuccess', [
      {},
      { data: 'action=mainwp_post_postingbulk&post_id=123&site_id=' + id + '&total=2' },
      { result: markup }
    ]);
  }
  emit(101, '<span>Created <a class="mainwp-may-hide-referrer" target="_blank" href="https://www.jawharksa.com/article/">View Post</a></span>');
  assert.equal(panel.hidden, true, 'panel waits for all sites');
  emit(102, '<span>Created <a class="mainwp-may-hide-referrer" target="_blank" href="https://www.bawsalamashhad.com/article/">View Post</a></span>');
  assert.equal(panel.hidden, false, 'panel immediately opens when last response arrives');
  assert.equal(document.querySelectorAll('#mcs-sites input[type="checkbox"]').length, 2);
  assert.equal(document.getElementById('mcs-selected-count').textContent, '2 محدد');
  assert.match(document.getElementById('mcs-caption').value, /jawharksa.com/);
  assert.equal(document.getElementById('mcs-caption').value.split('\n').length, 2);
  assert.equal(document.getElementById('mcs-next-caption'), null, 'No legacy split caption button');
  assert.match(document.getElementById('mcs-caption').value, /bawsalamashhad.com/);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(document.getElementById('mcs-caption').value,
    'https://www.jawharksa.com/?p=310\nhttps://www.bawsalamashhad.com/?p=875',
    'Verified per-site share shortlinks replace long URLs after MainWP results');

  document.getElementById('mcs-omit-www').click();
  assert.ok(!document.getElementById('mcs-caption').value.includes('www.'), 'www stripped only when explicitly enabled');
  document.getElementById('mcs-omit-www').click();
  assert.ok(document.getElementById('mcs-caption').value.includes('www.'), 'default www restored');
  document.getElementById('mcs-split-captions').click();
  const parts = [...document.querySelectorAll('#mcs-caption-groups textarea')].map(x => x.value);
  assert.equal(parts.length, 2, 'opt-in two-group split');
  assert.equal(parts.join('\n'), document.getElementById('mcs-caption').value, 'no URLs lost in split');
  document.getElementById('mcs-split-count').value = '4';
  document.getElementById('mcs-split-count').dispatchEvent(new ajax.window.Event('change'));
  assert.equal(document.querySelectorAll('#mcs-caption-groups textarea').length, 2, 'no empty groups');
  document.getElementById('mcs-split-captions').click();
  assert.equal(document.getElementById('mcs-caption-groups').hidden, true, 'grouping off by default');

  document.getElementById('mcs-select-none').click();
  assert.equal(document.getElementById('mcs-selected-count').textContent, '0 محدد');
  assert.equal(document.getElementById('mcs-copy-caption').disabled, true);
  document.getElementById('mcs-select-all').click();
  assert.equal(document.getElementById('mcs-selected-count').textContent, '2 محدد');
  document.getElementById('mcs-close').click();
  assert.equal(panel.hidden, true);
  document.getElementById('mcs-reopen').click();
  assert.equal(panel.hidden, false, 'reopen works without re-publishing');
  ajax.dom.window.close();

  const sync = await setup(false);
  assert.equal(sync.window.document.getElementById('mcs-share-panel').hidden, false,
    'synchronous MainWP publishing renders panel immediately');
  assert.match(sync.window.document.getElementById('mcs-caption').value, /jawharksa.com/);
  sync.dom.window.close();

  // Regression: copying a long set of published links must never split at 900/1024 chars.
  const many = await setup(true);
  const manyDoc = many.window.document;
  many.window.mcsShare.captionGuide = 1024;
  let copied = null;
  Object.defineProperty(many.window.navigator, 'clipboard', {
    value: { writeText: async text => { copied = text; } },
    configurable: true
  });
  manyDoc.querySelectorAll('.site-bulk-posting').forEach(row => row.remove());
  for (let id = 201; id <= 210; id++) {
    const site = manyDoc.createElement('div');
    site.className = 'site-bulk-posting';
    site.setAttribute('site-id', String(id));
    const anchor = manyDoc.createElement('a');
    anchor.textContent = 'موقع ' + id;
    site.appendChild(anchor);
    manyDoc.getElementById('mainwp-posting-post-modal').prepend(site);
  }
  for (let id = 201; id <= 210; id++) {
    many.$(manyDoc).trigger('ajaxSuccess', [{}, {
      data: 'action=mainwp_post_postingbulk&post_id=123&site_id=' + id + '&total=10'
    }, {
      result: '<a class="mainwp-may-hide-referrer" target="_blank" href="https://news-' + id + '.example.com/story/' + 'a'.repeat(160) + '">View Post</a>'
    }]);
  }
  const fullText = manyDoc.getElementById('mcs-caption').value;
  assert.ok(fullText.length > 1024, 'long share text passes the image-caption guideline');
  assert.match(fullText, /news-210.example.com/, 'last site present without truncation');
  assert.equal(manyDoc.getElementById('mcs-next-caption'), null, 'no chunking button at large volume');
  assert.equal(manyDoc.getElementById('mcs-copy-caption').disabled, false);
  manyDoc.getElementById('mcs-copy-caption').click();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(copied, fullText, 'one-click clipboard contains every selected URL');
  many.dom.window.close();

  // A 503/invalid child response does not imply the post was not created.
  const recovered = await setup(true);
  const rd = recovered.window.document;
  recovered.$(rd).trigger('ajaxSuccess', [{}, {
    data:'action=mainwp_post_postingbulk&post_id=123&site_id=101&total=2'
  }, {
    result:'<a class="mainwp-may-hide-referrer" target="_blank" href="https://www.jawharksa.com/article/">View Post</a>'
  }]);
  recovered.$(rd).trigger('ajaxSuccess', [{}, {
    data:'action=mainwp_post_postingbulk&post_id=123&site_id=102&total=2'
  }, { result:'Error 503. Service Unavailable' }]);
  assert.equal(rd.getElementById('mcs-sites').querySelectorAll('.mcs-site').length, 1, 'unconfirmed child initially excluded');
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal(rd.getElementById('mcs-sites').querySelectorAll('.mcs-site').length, 2, 'verified readback restores falsely failed site');
  assert.match(rd.getElementById('mcs-caption').value, /p=876/, 'recovered confirmed post ID is shared');
  recovered.dom.window.close();

  const ambiguous = await setup(true, 'ambiguous');
  const ad = ambiguous.window.document;
  ambiguous.$(ad).trigger('ajaxSuccess', [{}, {
    data:'action=mainwp_post_postingbulk&post_id=123&site_id=101&total=2'
  }, { result:'<a class="mainwp-may-hide-referrer" target="_blank" href="https://www.jawharksa.com/article/">View Post</a>' }]);
  ambiguous.$(ad).trigger('ajaxError', [{}, {
    data:'action=mainwp_post_postingbulk&post_id=123&site_id=102&total=2'
  }]);
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal(ad.getElementById('mcs-sites').querySelectorAll('.mcs-site').length, 1, 'ambiguous match is never shared');
  assert.equal(ad.getElementById('mcs-retry-recovery').hidden, false, 'unconfirmed sites remain available to recheck');
  ambiguous.dom.window.close();

  console.log('PASS: MainWP publish results, verified recovery, ambiguity fail-closed, optional www and grouped captions');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
