import { PDFDocument, StandardFonts, PDFString, rgb } from 'pdf-lib';
import JSZip from 'jszip';

// Browser-side generation; embedded libraries are bundled locally, no CDN.
const clean = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const urlsOf = sites => (sites || []).map(s => String(s.url || '')).filter(s => /^https?:\/\/[^\s<>]+$/i.test(s));
const bytes = async b => new Uint8Array(await b.arrayBuffer());
function saveFile(blob, suffix) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'mubdaa-news-share.' + suffix;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export async function buildPdf({cardBlob, sites}) {
  const links = urlsOf(sites);
  if (!cardBlob || !links.length) throw new Error('يجب تجهيز الصورة وتحديد المواقع قبل التصدير');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Mubdaa - Published article');
  pdf.setSubject('Article image with live clickable links');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(await bytes(cardBlob));
  const pw = 595.28, ph = 841.89, margin = 42, maxTextWidth = pw - margin * 2;
  let page = pdf.addPage([pw,ph]);
  const scale = Math.min(maxTextWidth / image.width, 420 / image.height);
  const w = image.width * scale, h = image.height * scale;
  page.drawImage(image, { x:(pw-w)/2, y:ph-45-h, width:w, height:h });
  let y = ph - 45 - h - 31;
  function newPage() { page = pdf.addPage([pw,ph]); y = ph - 56; }
  for (const url of links) {
    // Link remains selectable real text, no rasterized URL list.
    let tail = url;
    while (tail) {
      if (y < 55) newPage();
      let n = tail.length;
      while (n > 1 && font.widthOfTextAtSize(tail.slice(0,n), 11) > maxTextWidth) n--;
      const visible = tail.slice(0,n);
      page.drawText(visible, {x:margin, y, size:11, font, color:rgb(0.02,0.33,0.64)});
      const ann = pdf.context.obj({
        Type:'Annot', Subtype:'Link',
        Rect:[margin,y-3,margin + font.widthOfTextAtSize(visible,11),y+13],
        Border:[0,0,0],
        A:{S:'URI',URI:PDFString.of(url)}
      });
      page.node.addAnnot(pdf.context.register(ann));
      tail = tail.slice(n);
      y -= 21;
    }
    y -= 6;
  }
  return new Blob([await pdf.save()],{type:'application/pdf'});
}

function imageXml(cx,cy) {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/>' +
    '<wp:docPr id="1" name="Featured article photo"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="photo.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>';
}
function arabicParagraph(text) {
  return '<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr><w:r>' +
    '<w:rPr><w:rtl/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">' + clean(text) +
    '</w:t></w:r></w:p>';
}

export async function buildDocx({title, photoBlob, photoWidth, photoHeight, sites}) {
  const links = urlsOf(sites);
  if (!photoBlob || !links.length) throw new Error('يجب تجهيز الصورة وتحديد المواقع قبل التصدير');
  if (!photoWidth || !photoHeight) throw new Error('تعذر قراءة مقاسات الصورة');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  const factor = Math.min(5257800/(photoWidth*9525), 3600000/(photoHeight*9525),1);
  const cx = Math.round(photoWidth*9525*factor), cy = Math.round(photoHeight*9525*factor);
  const content = [arabicParagraph(title), imageXml(cx,cy), arabicParagraph('روابط المقالات المنشورة')];
  let relations = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/>';
  links.forEach((url,i) => {
    const id = 'rId' + (i+3);
    relations += '<Relationship Id="'+id+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="'+clean(url)+'" TargetMode="External"/>';
    content.push('<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:hyperlink r:id="'+id+'" w:history="1">' +
      '<w:r><w:rPr><w:color w:val="1251A8"/><w:u w:val="single"/><w:sz w:val="21"/></w:rPr>' +
      '<w:t xml:space="preserve">'+clean(url)+'</w:t></w:r></w:hyperlink></w:p>');
  });
  zip.file('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+relations+'</Relationships>');
  zip.file('word/media/photo.png',await bytes(photoBlob));
  zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>'+content.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850"/></w:sectPr>' +
    '</w:body></w:document>');
  return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

if (typeof window !== 'undefined') {
  window.MCSExport = {
    pdf: async data => saveFile(await buildPdf(data),'pdf'),
    docx: async data => saveFile(await buildDocx(data),'docx')
  };
}
