/** Vektorbasiertes Graukarton-Büchlein:
 * Seite 1 = Gesamtübersicht aller Höhenlinien.
 * Danach eine identische DIN-Seite pro Höhenstufe.
 * Auf den Stufenseiten wird die wegzuschneidende Fläche schraffiert dargestellt.
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
    for(const path of level.paths)if(!Array.isArray(path)||path.length<2||path.some(pt=>!Array.isArray(pt)||pt.length<2||!pt.slice(0,2).every(Number.isFinite)))
      throw new Error(`Ungültige Kontur bei ${level.height} m.`);
  }
  return levels;
}
function mmX(v){return n(v*P);} // left to right
function mmYFromTop(l,v){return n((l.h-v)*P);} // PDF uses origin bottom-left
function footerY(){return n(1.5*P);}
function closeEnough(a,b,eps=1e-6){return Math.abs(a-b)<=eps;}
function isClosedPath(path){
  if(!Array.isArray(path)||path.length<3)return false;
  const a=path[0],b=path[path.length-1];
  return closeEnough(a[0],b[0])&&closeEnough(a[1],b[1]);
}
function pathCommands(path,l){
  const out=[]; let first=true;
  for(const pt of path){
    const [x,y]=toPaper(l,pt[0],pt[1]);
    out.push(`${mmX(x)} ${mmYFromTop(l,y)} ${first?'m':'l'}`);
    first=false;
  }
  if(isClosedPath(path))out.push('h');
  return out;
}
function rectClipCommands(l){
  return [`${mmX(l.margin)} ${mmYFromTop(l,l.margin)} ${mmX(l.innerW)} ${mmX(l.innerH)} re W n`];
}
function drawPaths(paths,l,{strokeMm=.16,color='0.09 0.12 0.16 RG'}={}){
  const out=[];
  out.push('q');
  out.push(...rectClipCommands(l));
  out.push(`${color} ${n(strokeMm*P)} w 1 J 1 j`);
  for(const path of paths){
    out.push(...pathCommands(path,l));
    out.push('S');
  }
  out.push('Q');
  return out;
}
function closedPaths(paths){return paths.filter(isClosedPath);}
function hatchCommands(l,paths,{spacingMm=3.2,lineMm=.12,color='0.55 0.55 0.55 RG'}={}){
  const keep=closedPaths(paths);
  const out=[];
  out.push('q');
  // Clip to map rectangle MINUS all closed contour polygons using even-odd rule.
  out.push(`${mmX(l.margin)} ${mmYFromTop(l,l.margin)} ${mmX(l.innerW)} ${mmX(l.innerH)} re`);
  for(const path of keep)out.push(...pathCommands(path,l));
  out.push('W* n');
  out.push(`${color} ${n(lineMm*P)} w 1 J 1 j`);
  const left=l.margin, right=l.margin+l.innerW, top=l.margin, bottom=l.margin+l.innerH;
  const diag=l.innerH+l.innerW;
  for(let x=left-l.innerH; x<=right+l.innerH+spacingMm; x+=spacingMm){
    const x1=x, y1=bottom; // top-left origin coordinates
    const x2=x+diag, y2=top;
    out.push(`${mmX(x1)} ${mmYFromTop(l,y1)} m ${mmX(x2)} ${mmYFromTop(l,y2)} l S`);
  }
  out.push('Q');
  return out;
}
function titleBlock(lines,l,{title='Höhenlinienbüchlein'}={}){
  const out=[];
  const startY=l.margin>=12?7.5:3.5;
  out.push(`BT /F1 12 Tf 0.08 0.1 0.14 rg 1 0 0 1 ${mmX(l.margin)} ${n((l.h-startY)*P)} Tm (${pdfText(title)}) Tj ET`);
  let y=startY+4.6;
  for(const line of lines){
    out.push(`BT /F1 7 Tf 0.22 0.25 0.30 rg 1 0 0 1 ${mmX(l.margin)} ${n((l.h-y)*P)} Tm (${pdfText(line)}) Tj ET`);
    y+=3.2;
  }
  return out;
}
function footer(label,l,{source='swissALTI3D'}={}){
  const out=[];
  if(l.margin>=5){
    out.push(`BT /F1 7 Tf 0.12 0.16 0.23 rg 1 0 0 1 ${mmX(l.margin)} ${footerY()} Tm (${pdfText(label)}) Tj ET`);
    if(l.w>=250)out.push(`BT /F1 6 Tf 0.35 0.4 0.48 rg 1 0 0 1 ${mmX(l.w-40)} ${footerY()} Tm (${pdfText(source)}) Tj ET`);
  }
  return out;
}
function allPaths(levels){return levels.flatMap(level=>level.paths);}

export function bookletOverviewPageContent(levels,l,{strokeMm=.16,interval=null,total=1,source='swissALTI3D'}={}){
  if(!(l.w>0&&l.h>0&&l.innerW>0&&l.innerH>0&&l.scale>0))throw new Error('Ungültiges Blattformats oder Massstab.');
  const out=[];
  const min=levels[0].height,max=levels[levels.length-1].height;
  const titleLines=[
    `Gesamtübersicht aller Höhenlinien`,
    `Höhen: ${min} m bis ${max} m${interval?` · Äquidistanz ${interval} m`:''}`,
    `Massstab 1:${l.scale} · ${levels.length} Höhenstufen · Seite 1/${total}`,
    `Ab Seite 2 folgt pro Höhe eine Seite mit schraffierter Schnittfläche.`
  ];
  out.push(...titleBlock(titleLines,l,{title:'Graukarton-Höhenlinienbüchlein'}));
  out.push(...drawPaths(allPaths(levels),l,{strokeMm,color:'0.09 0.12 0.16 RG'}));
  out.push(...footer(`Übersicht  |  1:${l.scale}  |  1/${total}`,l,{source}));
  return out.join('\n')+'\n';
}

export function bookletLevelPageContent(level,l,{strokeMm=.16,index=0,total=1,source='swissALTI3D'}={}){
  if(!(l.w>0&&l.h>0&&l.innerW>0&&l.innerH>0&&l.scale>0))throw new Error('Ungültiges Blattformats oder Massstab.');
  if(!(strokeMm>0&&strokeMm<=5))throw new Error('Ungültige Linienstärke.');
  const out=[];
  const closed=closedPaths(level.paths).length;
  const open=level.paths.length-closed;
  out.push(...titleBlock([
    `Höhenstufe ${level.height} m`,
    `Schraffur = Fläche, die weggeschnitten werden muss`,
    `Konturen dieser Höhe: ${level.paths.length}${open?` · davon ${open} offen am Blattrand`:''}`,
    `Massstab 1:${l.scale} · Seite ${index+1}/${total}`
  ],l,{title:`Höhenstufe ${level.height} m`}));
  out.push(...hatchCommands(l,level.paths));
  out.push(...drawPaths(level.paths,l,{strokeMm,color:'0.09 0.12 0.16 RG'}));
  const label=`${level.height} m  |  Schraffur = wegschneiden  |  1:${l.scale}  |  ${index+1}/${total}`;
  out.push(...footer(label,l,{source}));
  return out.join('\n')+'\n';
}

/** Streaming-Vektor-PDF, komplett ohne jsPDF bzw. Speicherung aller Seiten im RAM. */
export class ContourBookletPdf {
  constructor(sink,l,result,{strokeMm=.16,title='Hoehenlinienbuch',onProgress=()=>{},interval=null}={}){
    if(!sink?.write||!sink?.close||!sink?.abort)throw new Error('PDF-Dateiausgabe nicht verfügbar.');
    if(!(l.w>0&&l.h>0&&l.innerW>0&&l.innerH>0))throw new Error('Ungültiges Papierformat.');
    this.sink=sink;this.l=l;this.levels=orderedContourLevels(result);
    this.strokeMm=strokeMm;this.title=title;this.onProgress=onProgress;this.interval=interval;
    this.offset=0;this.xref=new Map();this.closed=false;this.done=false;
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
          ? bookletOverviewPageContent(this.levels,this.l,{strokeMm:this.strokeMm,total:this.pages,interval:this.interval})
          : bookletLevelPageContent(this.levels[i-1],this.l,{strokeMm:this.strokeMm,index:i,total:this.pages})
        );
        await this.objectStart(streamId);
        await this.write(`<< /Length ${content.length} >>\nstream\n`);
        await this.write(content);
        await this.write('endstream\n');await this.objectEnd();
        const progressLabel=i===0?'Übersicht':`${this.levels[i-1].height} m`;
        if(i===0||i%2===0||i===this.pages-1){
          this.onProgress(`Höhenlinien-Büchlein: Seite ${i+1} von ${this.pages} (${progressLabel}) …`);
          await new Promise(ok=>setTimeout(ok,0));
        }
      }
      await this.objectStart(1);await this.write('<< /Type /Catalog /Pages 2 0 R >>\n');await this.objectEnd();
      await this.objectStart(2);
      const ids=Array.from({length:this.pages},(_,i)=>`${this.pageObjectId(i)} 0 R`).join(' ');
      await this.write(`<< /Type /Pages /Kids [${ids}] /Count ${this.pages} >>\n`);await this.objectEnd();
      await this.objectStart(3);
      await this.write(`<< /Title (${pdfText(this.title)}) /Producer (Schweizer Kartengenerator - ContourBook) /Subject (Uebersicht plus eine Hoehenstufe pro Seite mit Schraffur) >>\n`);
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
      await this.sink.close();this.done=true;this.closed=true;
      return {pages:this.pages,bytes:this.offset};
    }catch(e){await this.abort().catch(()=>{});throw e;}
  }
  async abort(){if(this.closed)return;this.closed=true;await this.sink.abort();}
}
