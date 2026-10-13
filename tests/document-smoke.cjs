'use strict';
// Integration-quality archive test: 30 links, PDF annotation targets + selectable text, Word hyperlinks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const JSZip = require('jszip');
const { PDFDocument, PDFName, PDFString } = require('pdf-lib');
const { buildPdf, buildDocx } = require('./document-export-build.cjs');

async function main() {
  const px = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL0AAAAASUVORK5CYII=', 'base64');
  const photo = new Blob([px],{type:'image/png'});
  const sites = Array.from({length:30},(_,i) => ({url:'https://www.news'+String(i+1)+'.example.com/?p='+String(200+i)}));
  const pdfBlob = await buildPdf({cardBlob:photo,sites});
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  assert.equal(String.fromCharCode(...pdfBytes.slice(0,4)),'%PDF');
  const pdf = await PDFDocument.load(pdfBytes);
  assert.ok(pdf.getPageCount() > 0, 'PDF created');
  let count = 0, clickable = 0;
  for (const page of pdf.getPages()) {
    const list = page.node.Annots();
    if (!list) continue;
    count += list.size();
    for (const item of list.asArray()) {
      const dict = pdf.context.lookup(item);
      const action = pdf.context.lookup(dict.get(PDFName.of('A')));
      const uri = action.get(PDFName.of('URI'));
      const value = uri instanceof PDFString ? uri.decodeText() : String(uri);
      assert.ok(value.includes('/?p='), 'Each clickable PDF link is a shortlink');
      clickable++;
    }
  }
  assert.equal(count,30,'All 30 links preserved as annotations');
  assert.equal(clickable,30);

  const docxBlob = await buildDocx({title:'خبر سعودي جديد',photoBlob:photo,photoWidth:640,photoHeight:360,sites});
  const zip = await JSZip.loadAsync(await docxBlob.arrayBuffer());
  assert.ok(zip.file('word/media/photo.png'),'DOCX embeds the photo');
  const xml = await zip.file('word/document.xml').async('string');
  const rel = await zip.file('word/_rels/document.xml.rels').async('string');
  assert.ok(xml.includes('خبر سعودي جديد'),'Arabic title stays editable in Word');
  assert.equal((xml.match(/<w:hyperlink /g)||[]).length,30,'30 real Word hyperlinks');
  assert.equal((rel.match(/TargetMode="External"/g)||[]).length,30,'DOCX clickable external relationships');
  assert.ok(rel.includes('news30.example.com/?p=229'),'Last site is included');
  assert.ok(!xml.includes('%D8'),'No encoded Arabic URL slug in document');
  fs.writeFileSync('/tmp/mcs-test-export.pdf', Buffer.from(pdfBytes));
  fs.writeFileSync('/tmp/mcs-test-export.docx', Buffer.from(await docxBlob.arrayBuffer()));
  console.log('PASS: PDF /Word files, 30 clickable links, picture and Arabic title');
}
main().catch(e=>{ console.error(e);process.exitCode=1; });
