/** Vektorbasiertes Graukarton-Büchlein.
 * Blatt 1: alle Höhenlinien zusammen.
 * Danach: je eine Höhenstufe pro identischer DIN-Seite.
 * Jede Seite zeigt immer den Relief-Rand.
 * Auf den Stufenseiten wird zusätzlich nur die nackte Höhenzahl ausgegeben.
 */
import {toPaper} from './core.mjs';

const encoder=new TextEncoder();
const P=72/25.4;
const bytes=x=>typeof x==='string'?encoder.encode(x):x instanceof Uint8Array?x:new Uint8Array(x);
const n=x=>{
  if(!Number.isFinite(x))throw new Error('Ungültige PDF-Koordinate.');
  return Number(x.toFixed(5)).toString();
};
const pdfText=s=>String(s).normalize('NFKD').replace(/[^\x20-\x7e]/g,'?').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');

export function orderedContourLevels(result){
  if(!Array.isArray(result?.levels)||!result.levels.length)throw new Error('Keine Höhenstufen vorhanden.');
  const levels=[...result.levels].sort((a,b)=>a.height-b.height);
  for(const level of levels){
    if(!Number.isFinite(level.height)||!Array.isArray(level.paths))throw new Error('Ungültige Höhenstufe.');
    for(const path of level.paths){
      if(!Array.isArray(path)||path.length<2)throw new Error(`Ungültige Kontur bei ${level.height} m.`);
      for(const pt of path){
        if(!Array.isArray(pt)||pt.length<2||!Number.isFinite(pt[0])||!Number.isFinite(pt[1]))
          throw new Error(`Ungültiger Punkt bei ${level.height} m.`);
      }
    }
  }
  return levels;
}

function mmX(v){return n(v*P);} // mm -> PDF points
function mmYFromTop(l,v){return n((l.h-v)*P);} // top-left mm -> PDF bottom-left pt
function clipRectCommands(l){
  const x=l.margin;
  const y=l.h-l.margin-l.innerH; // lower-left y in mm
  return [`${mmX(x)} ${n(y*P)} ${mmX(l.innerW)} ${mmX(l.innerH)} re W n`];
}
function frameCommands(l,{lineMm=.18}={}){
  const x=l.margin;
  const y=l.h-l.margin-l.innerH;
  return ['q',`0 0 0 RG ${n(lineMm*P)} w`,`${mmX(x)} ${n(y*P)} ${mmX(l.innerW)} ${mmX(l.innerH)} re S`,'Q'];
}
function pathCommands(path,l){
  const out=[];
  let first=true;
  for(const pt of path){
    const [x,y]=toPaper(l,pt[0],pt[1]);
    out.push(`${mmX(x)} ${mmYFromTop(l,y)} ${first?'m':'l'}`);
    first=false;
  }
  return out;
}
function drawPaths(paths,l,{strokeMm=.16}={}){
  if(!(strokeMm>0&&strokeMm<=5))throw new Error('Ungültige Linienstärke.');
  const out=['q',...clipRectCommands(l),`0 0 0 RG ${n(strokeMm*P)} w 1 J 1 j`];
  for(const path of paths){
    out.push(...pathCommands(path,l));
    out.push('S');
  }
  out.push('Q');
  return out;
}
function numberLabelContent(l,value,{fontSizePt=9}={}){
  // Höhe klein und unaufdringlich unten links im Rand, ausserhalb des Relief-Rahmens.
  if(!(l.margin>=4))return [];
  const x=l.margin+1.2;
  const y=l.h-2.2;
  return [`BT /F1 ${n(fontSizePt)} Tf 0 g 1 0 0 1 ${mmX(x)} ${mmYFromTop(l,y)} Tm (${pdfText(String(value))}) Tj ET`];
}
function allPaths(levels){return levels.flatMap(level=>level.paths);}
export function bookletOverviewPageContent(levels,l,{strokeMm=.16}={}){
  return [...frameCommands(l),...drawPaths(allPaths(levels),l,{strokeMm})].join('\n')+'\n';
}
export function bookletLevelPageContent(level,l,{strokeMm=.16}={}){
  return [...frameCommands(l),...drawPaths(level.paths,l,{strokeMm}),...numberLabelContent(l,level.height)].join('\n')+'\n';
}

/** Streaming-Vektor-PDF, komplett ohne jsPDF und ohne Seiteninhalt im RAM. */
export class ContourBookletPdf {
  constructor(sink,l,result,{strokeMm=.16,title='Hoehenlinienbuch',onProgress=()=>{}}={}){
    if(!sink?.write||!sink?.close||!sink?.abort)throw new Error('PDF-Dateiausgabe nicht verfügbar.');
    if(!(l.w>0&&l.h>0&&l.innerW>0&&l.innerH>0))throw new Error('Ungültiges Papierformat.');
    this.sink=sink;
    this.l=l;
    this.levels=orderedContourLevels(result);
    this.strokeMm=strokeMm;
    this.title=title;
    this.onProgress=onProgress;
    this.offset=0;
    this.xref=new Map();
    this.closed=false;
    this.done=false;
    this.pages=this.levels.length+1;
  }
  async write(x){const b=bytes(x);await this.sink.write(b);this.offset+=b.length;}
  async objectStart(id){this.xref.set(id,this.offset);await this.write(`${id} 0 obj\n`);}
  async objectEnd(){await this.write('endobj\n');}
  pageObjectId(index){return 5+index*2;}
  streamObjectId(index){return this.pageObjectId(index)+1;}
  async create(signal){
    if(this.done||this.closed)throw new Error('Datei bereits abgeschlossen.');
    try{
      await this.write('%PDF-1.4\n%ContourBook\n');
      for(let i=0;i<this.pages;i++){
        if(signal?.aborted)throw new DOMException('Abgebrochen.','AbortError');
        const pageId=this.pageObjectId(i),streamId=this.streamObjectId(i);
        await this.objectStart(pageId);
        await this.write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.l.w*P)} ${n(this.l.h*P)}] /Resources << /Font << /F1 4 0 R >> >> /Contents ${streamId} 0 R >>\n`);
        await this.objectEnd();
        const content=bytes(i===0
          ? bookletOverviewPageContent(this.levels,this.l,{strokeMm:this.strokeMm})
          : bookletLevelPageContent(this.levels[i-1],this.l,{strokeMm:this.strokeMm})
        );
        await this.objectStart(streamId);
        await this.write(`<< /Length ${content.length} >>\nstream\n`);
        await this.write(content);
        await this.write('endstream\n');
        await this.objectEnd();
        if(i===0||i%2===0||i===this.pages-1){
          const label=i===0?'Übersicht':`${this.levels[i-1].height}`;
          this.onProgress(`Höhenlinien-Büchlein: Seite ${i+1} von ${this.pages} (${label}) …`);
          await new Promise(ok=>setTimeout(ok,0));
        }
      }
      await this.objectStart(1);
      await this.write('<< /Type /Catalog /Pages 2 0 R >>\n');
      await this.objectEnd();
      await this.objectStart(2);
      const ids=Array.from({length:this.pages},(_,i)=>`${this.pageObjectId(i)} 0 R`).join(' ');
      await this.write(`<< /Type /Pages /Kids [${ids}] /Count ${this.pages} >>\n`);
      await this.objectEnd();
      await this.objectStart(3);
      await this.write('<< /Producer (Schweizer Kartengenerator - ContourBook) >>\n');
      await this.objectEnd();
      await this.objectStart(4);
      await this.write('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n');
      await this.objectEnd();
      const maxId=4+2*this.pages,startXref=this.offset;
      await this.write(`xref\n0 ${maxId+1}\n0000000000 65535 f \n`);
      for(let i=1;i<=maxId;i++){
        const off=this.xref.get(i);
        if(off==null||off>=10000000000)throw new Error(`Ungültiger PDF-Objektverweis ${i}.`);
        await this.write(`${String(off).padStart(10,'0')} 00000 n \n`);
      }
      await this.write(`trailer\n<< /Size ${maxId+1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);
      await this.sink.close();
      this.done=true;this.closed=true;
      return {pages:this.pages,bytes:this.offset};
    }catch(e){
      await this.abort().catch(()=>{});
      throw e;
    }
  }
  async abort(){if(this.closed)return;this.closed=true;await this.sink.abort();}
}
