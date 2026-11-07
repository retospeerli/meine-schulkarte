import test from 'node:test';
import assert from 'node:assert/strict';
import {IncrementalA0Pdf,openLargePdfOutput} from '../streamedpdf.mjs';
import {layout} from '../core.mjs';
import {printPixels,selectPrintAssets,expectedNativeDpi} from '../printdata.mjs';
import {writeFile} from 'node:fs/promises';

const tinyJpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjKKKK/ts/i8//2Q==','base64');
function captureSink(){
  const chunks=[];let aborted=false,closed=false;
  const sink={async write(x){chunks.push(Buffer.from(x));},async close(){closed=true;},async abort(){aborted=true;}};
  return {sink,getData:()=>Buffer.concat(chunks),wasClosed:()=>closed,wasAborted:()=>aborted};
}
const exampleA0=layout({paper:'A0',orientation:'hoch',margin:5,scale:10000,dpi:508,e:2693000,n:1231000});
test('A0 508 dpi exact printable pixels, regardless of print-streaming',()=>{
  const p=printPixels(exampleA0);
  assert.equal(p.width,16620); assert.equal(p.height,23580);
  assert.ok(p.blocks>1500&&p.blocks<1600);
  assert.equal(exampleA0.groundW,8310);assert.equal(exampleA0.groundH,11790);
});
test('stream writer produces 1-page genuine A0 PDF with two JPEG image objects and xref',async()=>{
  const out=captureSink();
  const pdf=await new IncrementalA0Pdf(out.sink,{pageWidthMm:841,pageHeightMm:1189,scale:10000}).start();
  await pdf.imageJpeg(tinyJpeg,{width:8,height:8,xMm:5,yMm:5,widthMm:100,heightMm:100});
  await pdf.imageJpeg(tinyJpeg,{width:8,height:8,xMm:105,yMm:5,widthMm:100,heightMm:100});
  const info=await pdf.finish(),bytes=out.getData(),txt=bytes.toString('latin1');
  assert.ok(out.wasClosed()); assert.equal(info.images,2);
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.includes('/Count 1'));
  assert.ok(txt.includes('/MediaBox [0 0 2383.9370079 3370.3937008]'));
  assert.equal((txt.match(/\/Subtype \/Image/g)||[]).length,2);
  assert.ok(txt.includes('/Filter /DCTDecode'));
  assert.ok(txt.includes('/F1 6 0 R'));
  assert.ok(txt.includes('startxref'));
  assert.ok(txt.includes('%%EOF\n'));
});
test('A0 writer abort can clean incomplete output',async()=>{
  const out=captureSink();
  const pdf=await new IncrementalA0Pdf(out.sink,{pageWidthMm:841,pageHeightMm:1189}).start();
  await pdf.abort();assert.ok(out.wasAborted());assert.equal(out.wasClosed(),false);
});
test('SWISSIMAGE selects 2m COG at 1:50k but 10cm COG at 1:25k',()=>{
  const features=[{id:'test1',assets:{
    coarse:{href:'https://data.geo.admin.ch/swissimage-dop10_2025_2693-1231_2_2056.tif'},
    fine:{href:'https://data.geo.admin.ch/swissimage-dop10_2025_2693-1231_0.1_2056.tif'},
    second:{href:'https://data.geo.admin.ch/swissimage-dop10_2025_2694-1231_0.1_2056.tif'}
  }}];
  const a=selectPrintAssets(features,{mode:'luftbild',preferMeters:50000*.0254/508});
  assert.equal(a.length,2);
  assert.ok(a.find(x=>x.key==='2693-1231')?.gsd===2);
  const b=selectPrintAssets(features,{mode:'luftbild',preferMeters:25000*.0254/508});
  assert.equal(b.length,2);
  assert.ok(b.find(x=>x.key==='2693-1231')?.gsd===.1);
  assert.equal(expectedNativeDpi(50000,2),635);
});

test('complete A0 geometry: 1,551 JPEG blocks stream into one valid xref table',async()=>{
  const out=captureSink();
  const pdf=await new IncrementalA0Pdf(out.sink,{pageWidthMm:841,pageHeightMm:1189,scale:10000}).start();
  let blocks=0;
  const W=16620,H=23580,C=512;
  for(let y=0;y<H;y+=C)for(let x=0;x<W;x+=C){
    const bw=Math.min(C,W-x),bh=Math.min(C,H-y);
    await pdf.imageJpeg(tinyJpeg,{width:8,height:8,xMm:5+x/20,yMm:5+y/20,widthMm:bw/20,heightMm:bh/20});
    blocks++;
  }
  const done=await pdf.finish();
  const result=out.getData().toString('latin1');
  assert.equal(blocks,1551);
  assert.equal(done.images,1551);
  assert.ok(result.includes('xref\n0 1558\n'));
  assert.ok(result.endsWith('%%EOF\n'));
  assert.ok(out.wasClosed());
});

test('browser Save File Picker is requested before the first byte is written',async()=>{
 const calls=[],output=captureSink();
 const host={showSaveFilePicker:async opts=>{
   calls.push('picker');assert.ok(opts.suggestedName.endsWith('.pdf'));
   return {name:opts.suggestedName,createWritable:async()=>{calls.push('file');return output.sink;}};
 }};
 const result=await openLargePdfOutput('SWISSIMAGE_A0.pdf',{host});
 assert.deepEqual(calls,['picker','file']);
 assert.equal(result.method,'disk');
 const pdf=await new IncrementalA0Pdf(result.sink,{pageWidthMm:841,pageHeightMm:1189}).start();
 assert.equal(calls[0],'picker');
 await pdf.abort();
 assert.equal(output.wasAborted(),true);
});
