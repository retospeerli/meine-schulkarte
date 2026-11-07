import test from 'node:test';
import assert from 'node:assert/strict';
import {layout} from '../core.mjs';
import {orderedContourLevels,bookletPageContent,ContourBookletPdf} from '../contourbook.mjs';

const config={source:'grau',paper:'A4',orientation:'quer',e:2693000,n:1231000,scale:25000,margin:5,dpi:508};
const l=layout(config);
const small=(offset=0)=>[[l.b.minE+100+offset,l.b.minN+100],[l.b.minE+300+offset,l.b.minN+300]];
const result={levels:[
  {height:620,paths:[small(250)]},
  {height:600,paths:[small(0),small(800)]},
  {height:610,paths:[small(1400)]}
]};

function memorySink(){
  const chunks=[];
  return {
    chunks,closed:false,aborted:false,
    async write(data){chunks.push(Buffer.from(data));},
    async close(){this.closed=true;},
    async abort(){this.aborted=true;},
    get buffer(){return Buffer.concat(chunks);}
  };
}

test('Büchlein sortiert drei Höhenstufen aufsteigend',()=>{
  assert.deepEqual(orderedContourLevels(result).map(x=>x.height),[600,610,620]);
});
test('Alle getrennten Konturen derselben Höhe bleiben auf einer Seite',()=>{
  const s=bookletPageContent(orderedContourLevels(result)[0],l,{index:0,total:3});
  assert.equal((s.match(/\bm\n/g)||[]).length,2);
  assert.match(s,/600 m  \|  1:25000  \|  1\/3/);
  assert.equal((s.match(/\nS\n/g)||[]).length,2);
});
test('Bei 0 mm Rand wird keine Höhenangabe über Schnittlinien geschrieben',()=>{
  const noMargin=layout({...config,margin:0});
  const s=bookletPageContent(result.levels[0],noMargin,{index:0,total:3});
  assert.doesNotMatch(s,/\bBT\b/);
});
test('Ein gültiges mehrseitiges Vektor-PDF wird gestreamt',async()=>{
  const sink=memorySink();
  const book=new ContourBookletPdf(sink,l,result,{strokeMm:0.16});
  const meta=await book.create();
  const pdf=sink.buffer.toString('latin1');
  assert.equal(meta.pages,3);
  assert.ok(sink.closed&&!sink.aborted);
  assert.match(pdf,/\/Count 3/);
  assert.equal((pdf.match(/\/Type \/Page\b/g)||[]).length,3);
  assert.equal((pdf.match(/\/MediaBox \[0 0/g)||[]).length,3);
  assert.ok(pdf.indexOf('(600 m')<pdf.indexOf('(610 m'));
  assert.ok(pdf.indexOf('(610 m')<pdf.indexOf('(620 m'));
  assert.match(pdf,/startxref\n\d+\n%%EOF\n$/);
});
test('Abgebrochener Export hinterlässt keinen als fertig gemeldeten PDF-Stream',async()=>{
  const sink=memorySink();
  const b=new ContourBookletPdf(sink,l,result);
  const controller=new AbortController();controller.abort();
  await assert.rejects(b.create(controller.signal),{name:'AbortError'});
  assert.equal(sink.aborted,true);
  assert.equal(sink.closed,false);
});
