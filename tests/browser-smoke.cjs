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
  '<div id="mcs-sites"></div><canvas id="mcs-canvas"></canvas><div id="mcs-image-state"></div><button id="mcs-retry-image" hidden></button>' +
  '<textarea id="mcs-caption"></textarea><div id="mcs-caption-progress"></div>' +
  '<button id="mcs-copy-image" disabled></button><button id="mcs-download-image" disabled></button>' +
  '<button id="mcs-copy-caption" disabled></button><button id="mcs-next-caption" hidden></button>' +
  '<div id="mcs-toast"></div></section></body></html>';
}

async function setup(isAjax) {
  const dom = new JSDOM(html(isAjax), {
    url: 'https://main.example.com/wp-admin/admin.php?page=PostingBulkPost&id=123',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const $ = require('jquery')(window);
  window.jQuery = $;
  window.mcsShare = {
    title: 'خبر جديد',
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
  assert.equal(document.getElementById('mcs-caption').value.split('روابط الخبر:').length, 2);
  assert.equal(document.getElementById('mcs-next-caption'), null, 'No legacy split caption button');
  assert.match(document.getElementById('mcs-caption').value, /bawsalamashhad.com/);

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

  console.log('PASS: MainWP AJAX final-result timing, multi-select, reorder-ready state, popup reopen and synchronous mode');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
