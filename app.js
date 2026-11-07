import {PAPER,SOURCES,RESOLUTIONS,layout,tilePlan,resolutionZoom,tileSpan,enumerateTiles,tileUrl,toPaper} from './core.mjs?v=2.7';
import {getHeightGrid,newHeightGrid,estimatedHeightTileCount} from './heights.mjs?v=2.7';
import {computeContours,svgForContours} from './contours.mjs?v=2.7';
import {choosePrintProduct,expectedNativeDpi,printPixels} from './printdata.mjs?v=2.7';
import {cartographyForScale,cartographyDescription} from './cartography.mjs?v=2.7';
import {CANTONS,searchRegions,getRegionGeometry,getAdjacentLakeGeometry,fitRegion,applyGeometryPath,highlightParts} from './regions.mjs?v=2.7';
import {createOriginalRasterPdf,colourizeBlock} from './rasterexport.mjs?v=2.7';
import {wmsGetMapUrl,printedBlockBounds} from './mapservice.mjs?v=2.7';
import {IncrementalA0Pdf,openLargePdfOutput} from './streamedpdf.mjs?v=2.7';
import {ContourBookletPdf} from './contourbook.mjs?v=2.9';

const $=id=>document.getElementById(id);
const sheet=$('sheet'),canvas=$('preview'),ctx=canvas.getContext('2d');
const inputs=['paper','orientation','east','north','scale','margin','dpi','interval','sampling','stroke','majorEvery'];
const cache=new Map(),mapPreviewCache=new Map();let mode='karte',contourResult=null,contourLayout=null,aborter=null,renderTimer=null,working=false,selectedRegion=null;
const MASK_LIGHTEN_ALPHA=.26;
const abortErr=()=>new DOMException('Abgebrochen','AbortError');

function cfg(){return {
  source:mode==='kontur'?'grau':mode,
  paper:$('paper').value,orientation:$('orientation').value,
  e:Number($('east').value),n:Number($('north').value),scale:Number($('scale').value),
  margin:Number($('margin').value),dpi:Number($('dpi').value)
};}
function status(s,type=''){$('messages').textContent=s;$('messages').className='messages '+type;}
function errorText(e){return e?.name==='AbortError'?'Abgebrochen.':(e?.message||String(e));}
function format(n,d=0){return Number(n).toLocaleString('de-CH',{maximumFractionDigits:d});}
function setMode(m){
  if(working)return;
  mode=m;document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  $('contourSettings').hidden=m!=='kontur';$('contourExports').hidden=!contourResult||m!=='kontur';
  $('rasterExportOptions').hidden=m==='kontur';
  updateContourPdfLabel();
  schedule();
}
function updateContourPdfLabel(){
  $('pdfButton').textContent=mode==='kontur'
    ? ($('contourBooklet').checked?'Höhenlinien-Büchlein als PDF herunterladen':'Höhenlinien-PDF erstellen')
    : 'Druck-PDF erstellen';
}
function invalidateContours(){contourResult=null;contourLayout=null;$('contourExports').hidden=true;}
function syncScaleChips(){document.querySelectorAll('#scales button').forEach(b=>b.classList.toggle('picked',Number(b.dataset.scale)===Number($('scale').value)));}
function resizeSheet(l){
  const stage=document.querySelector('.paper-stage'), maxW=Math.max(80,stage.clientWidth-40),maxH=Math.max(80,stage.clientHeight-40);
  const k=Math.min(maxW/l.w,maxH/l.h),cw=Math.round(l.w*k),ch=Math.round(l.h*k);
  sheet.style.width=cw+'px';sheet.style.height=ch+'px';
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(cw*dpr);canvas.height=Math.round(ch*dpr);
  ctx.setTransform(canvas.width/l.w,0,0,canvas.height/l.h,0,0);
  return {cw,ch};
}
function renderFrame(l){
  ctx.clearRect(0,0,l.w,l.h);ctx.fillStyle='white';ctx.fillRect(0,0,l.w,l.h);
  ctx.save();ctx.beginPath();ctx.rect(l.margin,l.margin,l.innerW,l.innerH);ctx.clip();
}
function finishFrame(l){
  ctx.restore();
  if(l.margin>0){ctx.strokeStyle='#d7dce5';ctx.lineWidth=.15;ctx.strokeRect(l.margin,l.margin,l.innerW,l.innerH);}
}
function drawContours(l,result){
  ctx.strokeStyle='#243a50';ctx.lineCap='round';ctx.lineJoin='round';
  let i=0;
  for(const lev of result.levels){
    const major=Number($('majorEvery').value),it=Number($('interval').value);
    ctx.lineWidth=(major&&Math.abs(lev.height/(major*it)-Math.round(lev.height/(major*it)))<1e-8)?0.20:0.14;
    for(const path of lev.paths){
      ctx.beginPath();for(let j=0;j<path.length;j++){
        const [x,y]=toPaper(l,path[j][0],path[j][1]);if(!j)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }ctx.stroke();
    }i++;
  }
}
function previewTileZoom(l){
  // Grid resolution needed for screen display (source pixels per CSS preview pixel).
  const perCssPx=l.groundW/(l.innerW*sheet.clientWidth/l.w);
  const z=resolutionZoom(perCssPx,mode);
  for(let i=z;i>=14;i--){if(RESOLUTIONS[i]!=null&&enumerateTiles(l.b,i).length<=125)return i;}
  return 14;
}
function previewTile(key,url){
  if(cache.has(key))return cache.get(key);
  const o={state:'loading',img:null};cache.set(key,o);
  const img=new Image();img.crossOrigin='anonymous';img.decoding='async';
  img.onload=()=>{o.state='ready';o.img=img;if(!renderTimer)schedule(false);};
  img.onerror=()=>{o.state='error';if(!renderTimer)schedule(false);};
  img.src=url;
  if(cache.size>450){for(const [k,v] of cache){if(v.state!=='loading'){cache.delete(k);break;}}}
  return o;
}
function getWmsPreview(l,style){
  // One exact GetMap, not an arbitrary WMTS zoom that may not exist for this map.
  const width=Math.max(1,Math.round(canvas.width*l.innerW/l.w));
  const height=Math.max(1,Math.round(canvas.height*l.innerH/l.h));
  const key=[style.wmts,...[l.b.minE,l.b.minN,l.b.maxE,l.b.maxN].map(v=>v.toFixed(3)),width,height].join(':');
  let entry=mapPreviewCache.get(key);
  if(entry)return entry;
  entry={state:'loading',img:null,width,height};mapPreviewCache.set(key,entry);
  const img=new Image();img.crossOrigin='anonymous';img.decoding='async';
  img.onload=()=>{entry.state='ready';entry.img=img;schedule(false);};
  let usePng=false;
  img.onerror=()=>{
    if(!usePng){
      usePng=true;img.src=wmsGetMapUrl(style.wmts,l.b,width,height,'image/png');return;
    }
    entry.state='error';schedule(false);
  };
  img.src=wmsGetMapUrl(style.wmts,l.b,width,height);
  if(mapPreviewCache.size>12){
    for(const [k,v] of mapPreviewCache)if(v.state!=='loading'&&k!==key){mapPreviewCache.delete(k);break;}
  }
  return entry;
}
function drawWmsPreview(l,style){
  const entry=getWmsPreview(l,style);
  $('tileText').textContent=`WMS-Vorschau: ${entry.state==='ready'?'geladen':entry.state==='error'?'Fehler beim Kartenabruf':'lädt …'} · ${style.label} · ${entry.width} × ${entry.height} Pixel`;
  if(entry.state==='error'){
    ctx.fillStyle='#f0f2f5';ctx.fillRect(l.margin,l.margin,l.innerW,l.innerH);
    status(`Die Karte ${style.label} konnte per WMS nicht geladen werden. Netzwerk oder wms.geo.admin.ch prüfen.`, 'error');
    return;
  }
  if(entry.state!=='ready'){
    ctx.fillStyle='#f0f2f5';ctx.fillRect(l.margin,l.margin,l.innerW,l.innerH);
    return;
  }
  const showGrey=mode==='grau'||Boolean(selectedRegion);
  if(showGrey){
    ctx.filter='grayscale(1)';
    ctx.drawImage(entry.img,l.margin,l.margin,l.innerW,l.innerH);
    ctx.filter='none';
    if(selectedRegion&&mode!=='grau'){
      ctx.fillStyle=`rgba(255,255,255,${MASK_LIGHTEN_ALPHA})`;
      ctx.fillRect(l.margin,l.margin,l.innerW,l.innerH);
    }
  }else ctx.drawImage(entry.img,l.margin,l.margin,l.innerW,l.innerH);
  if(selectedRegion&&mode!=='grau'){
    for(const geometry of highlightParts(selectedRegion)){
      ctx.save();
      applyGeometryPath(ctx,geometry,(e,n)=>toPaper(l,e,n));
      ctx.clip('evenodd');ctx.drawImage(entry.img,l.margin,l.margin,l.innerW,l.innerH);
      ctx.restore();
    }
  }
}
function draw(){
  renderTimer=null;
  let l,plan;
  try {l=layout(cfg());plan=mode==='luftbild'?tilePlan(cfg()):null;}
  catch(e){status(errorText(e),'error');$('cartographyInfo').textContent=errorText(e);$('quality').textContent='Keine massstabsgetreue Landeskarten-Ausgabe möglich.';return;}
  const style=(mode==='karte'||mode==='grau')?cartographyForScale(l.scale):null;
  $('cartographyInfo').hidden=!style;
  if(style){
    $('cartographyInfo').textContent=cartographyDescription(style);
    $('cartographyInfo').classList.toggle('scale-warning',!style.exact);
  }
  resizeSheet(l);renderFrame(l);
  if(mode==='kontur'){
    ctx.fillStyle='#fff';ctx.fillRect(l.margin,l.margin,l.innerW,l.innerH);
    if(contourResult&&contourLayout?.b.minE===l.b.minE&&contourLayout?.b.maxN===l.b.maxN&&contourLayout?.scale===l.scale)drawContours(l,contourResult);
    else {
      ctx.fillStyle='#71829a';ctx.textAlign='center';ctx.font='4px system-ui,sans-serif';
      ctx.fillText('Höhenlinien berechnen',l.w/2,l.h/2);
    }
  }else if(style){
    drawWmsPreview(l,style);
  }else{
    const z=previewTileZoom(l),span=tileSpan(z),tiles=enumerateTiles(l.b,z),size=span*1000/l.scale;
    let missing=0,loaded=0;
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    for(const tile of tiles){
      const [x,y]=toPaper(l,tile.minE,tile.maxN),k=`${mode}:${style?.wmts||SOURCES[mode].id}:${z}:${tile.x}:${tile.y}`;
      const entry=previewTile(k,tileUrl(mode,z,tile.x,tile.y,l.scale));
      if(entry.state==='ready') {
        if((selectedRegion && mode!=='grau') || mode==='grau'){
          ctx.filter='grayscale(1)';
          ctx.drawImage(entry.img,x-.003,y-.003,size+.006,size+.006);
          ctx.filter='none';
          if(mode!=='grau'){
            ctx.fillStyle=`rgba(255,255,255,${MASK_LIGHTEN_ALPHA})`;
            ctx.fillRect(x-.003,y-.003,size+.006,size+.006);
          }
        }else ctx.drawImage(entry.img,x-.003,y-.003,size+.006,size+.006);
        ctx.filter='none';loaded++;}
      else {missing++;ctx.fillStyle='#eaf0f6';ctx.fillRect(x,y,size,size);}
    }
    if(selectedRegion && mode!=='grau'){
      // Each feature is a SEPARATE clipping pass: do not combine municipality
      // and lakes with evenodd, because overlapping polygons would cancel.
      for(const geometry of highlightParts(selectedRegion)){
        ctx.save();
        applyGeometryPath(ctx,geometry,(e,n)=>toPaper(l,e,n));
        ctx.clip('evenodd');
        for(const tile of tiles){
          const [x,y]=toPaper(l,tile.minE,tile.maxN),entry=cache.get(`${mode}:${style?.wmts||SOURCES[mode].id}:${z}:${tile.x}:${tile.y}`);
          if(entry?.state==='ready')ctx.drawImage(entry.img,x-.003,y-.003,size+.006,size+.006);
        }
        ctx.restore();
      }
    }
    if(missing&&missing===tiles.length&&tiles.every(t=>cache.get(`${mode}:${style?.wmts||SOURCES[mode].id}:${z}:${t.x}:${t.y}`)?.state==='error'))status('WMTS-Vorschau konnte nicht geladen werden. Internetzugang oder Zugriff auf swisstopo prüfen.','error');
    $('tileText').textContent=`WMTS: ${loaded}/${tiles.length} Kacheln · ${style?.label||'SWISSIMAGE'} · Zoom ${z}`;
  }
  finishFrame(l);
  const n=mode==='kontur'?'Höhenlinien – swissALTI³D':SOURCES[mode].label;
  $('extentText').textContent=`${(l.groundW/1000).toFixed(2)} × ${(l.groundH/1000).toFixed(2)} km Gelände`;
  $('detailText').textContent=`Zentrum: ${format(l.e)} / ${format(l.n)} · ${n}`;
  $('paperText').textContent=`${cfg().paper} ${cfg().orientation==='quer'?'quer':'hoch'} · 1:${format(l.scale)}`;
  if(mode==='kontur'){
    try{let h=newHeightGrid(l.b,Number($('sampling').value));$('tileText').textContent=`Raster: ${format(h.nx)} × ${format(h.ny)} · ${format(h.nx*h.ny)} Werte · ca. ${format(estimatedHeightTileCount(l.b))} Höhenkacheln (2 m)`;}
    catch(e){$('tileText').textContent=e.message;}
    $('quality').textContent=`Vektor-PDF und SVG: exakt 1:${format(l.scale)} bei 100 % Druck. Höhenraster aus swissALTI³D (2 m Quelldaten).`;
  }else{
    const target=printPixels(l),p=choosePrintProduct(l.scale,mode),expected=expectedNativeDpi(l.scale,p.expectedGsd);
    if($('exportSource').value==='original'){
      $('quality').textContent=`${style?style.label+' · ':''}${mode==='luftbild'?'SWISSIMAGE-Streaming-PDF (A0-fähig)':'Originaldruck'}: ${l.dpi} dpi · ${format(target.width)} × ${format(target.height)} Pixel · ${format(target.blocks)} Blöcke. Quelle: ${p.description}. Erwartete Quellauflösung: ${format(expected)} dpi${mode==='luftbild'?' (SWISSIMAGE je nach Gebiet)':''}. ${expected+1<l.dpi?'Achtung: Quellendetails unter Druck-DPI, keine künstlichen Details!':''}`;
    }else if(style) $('quality').textContent=`${style.label} · WMS-Schnelldruck: ${l.dpi} dpi als PDF-Ausgaberaster. Kein Original-COG: WMS-Kartenbilder ersetzen die originalen 508-dpi-Druckdaten NICHT.`;
    else {const effective=plan.actualDpi,limit=plan.tiles.length>3200;
      $('quality').textContent=`WMTS-Schnelldruck: ${l.dpi} dpi PDF-Ziel · WMTS-Raster: ${plan.resolution} m/Pixel (≈ ${format(effective)} Quellen-dpi) · ${format(plan.tiles.length)} Kacheln${limit?' · zu viele für Browser':''}. Die WMTS-Bilder ersetzen die originalen Druckdaten NICHT.`;}
  }
}
function schedule(debounce=true){
  if(renderTimer)clearTimeout(renderTimer);renderTimer=setTimeout(draw,debounce?90:60);
  syncScaleChips();
}
async function searchPlace(){
  const q=$('searchText').value.trim();if(!q)return;
  status('Suche Ort …');$('searchResults').hidden=true;
  try{
    const url='https://api3.geo.admin.ch/rest/services/ech/SearchServer?type=locations&sr=2056&limit=8&searchText='+encodeURIComponent(q);
    const r=await fetch(url);if(!r.ok)throw new Error('Suchdienst HTTP '+r.status);
    const j=await r.json();const items=(j.results||[]).filter(x=>Number.isFinite(+x.attrs?.x)&&Number.isFinite(+x.attrs?.y));
    const div=$('searchResults');div.replaceChildren();
    if(!items.length){status('Keine Treffer. LV95-Koordinaten können auch direkt eingegeben werden.');return;}
    for(const item of items){
      const b=document.createElement('button');const raw=item.attrs.label||item.attrs.detail||'Ort';
      b.textContent=raw.replace(/<[^>]*>/g,'');
      b.addEventListener('click',()=>{
        // The SearchServer historical attrs order is x=N, y=E, even with sr=2056.
        let e=Number(item.attrs.y),n=Number(item.attrs.x);
        if(e<1800000||n>1700000){e=Number(item.attrs.x);n=Number(item.attrs.y);}
        $('east').value=Math.round(e);$('north').value=Math.round(n);
        invalidateContours();div.hidden=true;schedule();status(`Zentrum gesetzt: ${format(e)} / ${format(n)}.`);
      });div.appendChild(b);
    }
    div.hidden=false;status(`${items.length} Ortsvorschläge.`);
  }catch(e){status('Ortssuche fehlgeschlagen: '+errorText(e),'error');}
}
function freshPdf(l){
  const jsPDF=globalThis.jspdf?.jsPDF;if(!jsPDF)throw new Error('jsPDF nicht geladen. CDN/Internet prüfen.');
  const pdf=new jsPDF({unit:'mm',format:[l.w,l.h],orientation:l.w>l.h?'landscape':'portrait',compress:true,precision:16});
  pdf.setProperties({title:'Schweizer Kartengenerator',subject:`Schweizer Karte, Massstab 1:${l.scale}`,creator:'Schweizer Kartengenerator · © swisstopo Daten'});
  return pdf;
}
function addAttribution(pdf,l){
  const txt=`© swisstopo  ·  1:${format(l.scale)}`;
  pdf.setFont('helvetica','normal');pdf.setFontSize(7);
  const tw=pdf.getTextWidth(txt);const x=l.w-2-tw;
  pdf.setFillColor(255,255,255);pdf.rect(x-1.5,l.h-5.5,tw+3,4.6,'F');
  pdf.setTextColor(35,42,50);pdf.text(txt,l.w-3,l.h-2.4,{align:'right'});
}
function saveBlob(data,name,mime){
  const blob=data instanceof Blob?data:new Blob([data],{type:mime});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),20000);
}
function fileStem(){return `CH_${cfg().paper}_${cfg().orientation}_1-${cfg().scale}_${Math.round(cfg().e)}-${Math.round(cfg().n)}`;}
async function pdfWmsMap(l,signal){
  const style=cartographyForScale(l.scale);
  const total=printPixels(l),chunk=1024;
  const cols=Math.ceil(total.width/chunk),rows=Math.ceil(total.height/chunk);
  const blocks=cols*rows;
  if(blocks>1200)throw new Error(`${blocks} WMS-Druckblöcke wären nötig. Bitte für grosse Formate Originaldruck oder geringere DPI wählen.`);
  const pdf=freshPdf(l);
  pdf.saveGraphicsState();pdf.rect(l.margin,l.margin,l.innerW,l.innerH,null);pdf.clip();pdf.discardPath();
  let count=0;
  for(let iy=0;iy<rows;iy++)for(let ix=0;ix<cols;ix++){
      if(signal?.aborted)throw abortErr();
      const x0=ix*chunk,y0=iy*chunk;
      const w=Math.min(chunk,total.width-x0),h=Math.min(chunk,total.height-y0);
      const bbox=printedBlockBounds(l,total,x0,y0,w,h);
      const url=wmsGetMapUrl(style.wmts,bbox,w,h);
      let response=null;
      for(let attempt=0;attempt<3;attempt++){
        try{
          response=await fetch(url,{signal});
          if(response.ok && (response.headers.get('content-type')||'').startsWith('image/'))break;
          if(response.ok)throw new Error(`WMS lieferte statt einer Karte ${response.headers.get('content-type')||'unbekannten Inhalt'}.`);
          if(attempt===2)throw new Error(`WMS HTTP ${response.status} bei Block ${ix+1}/${iy+1}.`);
        }catch(e){if(signal.aborted)throw abortErr();if(attempt===2)throw e;}
        await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
      }
      if(!response?.ok)throw new Error('Kartenabruf fehlgeschlagen.');
      const mime=response.headers.get('content-type')||'image/jpeg';
      const bmp=await createImageBitmap(new Blob([await response.arrayBuffer()],{type:mime}));
      const raw=document.createElement('canvas');raw.width=w;raw.height=h;
      raw.getContext('2d').drawImage(bmp,0,0,w,h);bmp.close?.();
      const out=colourizeBlock(raw,w,h,selectedRegion,l,total,x0,y0,mode);
      const paperX=l.margin+x0/total.width*l.innerW,paperY=l.margin+y0/total.height*l.innerH;
      const paperW=w/total.width*l.innerW,paperH=h/total.height*l.innerH;
      pdf.addImage(out.toDataURL('image/jpeg',.97),'JPEG',paperX,paperY,paperW,paperH,undefined,'NONE');
      count++;
      if(count%3===0||count===blocks){
        status(`WMS-Kartendruck ${style.label}: ${count}/${blocks} Bildblöcke …`);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
  }
  pdf.restoreGraphicsState();addAttribution(pdf,l);
  return pdf;
}
async function pdfMap(l,signal){
  if(mode==='karte'||mode==='grau')return pdfWmsMap(l,signal);
  const plan=tilePlan(cfg());
  if(plan.tiles.length>3200)throw new Error(`Zu viele Kacheln (${plan.tiles.length}). Papierformat/Massstab kleiner oder Ausgabeziel niedriger wählen.`);
  const pdf=freshPdf(l);
  pdf.saveGraphicsState();pdf.rect(l.margin,l.margin,l.innerW,l.innerH,null);pdf.clip();pdf.discardPath();
  const size=plan.resolution*256*1000/l.scale;
  for(let index=0;index<plan.tiles.length;index+=6){
    if(signal.aborted)throw abortErr();
    const batch=plan.tiles.slice(index,index+6);
    const loaded=await Promise.all(batch.map(async tile=>{
      const url=tileUrl(mode,plan.z,tile.x,tile.y,l.scale);
      let response=null;
      for(let attempt=0;attempt<3;attempt++){
        try{response=await fetch(url,{signal});if(response.ok)break;
        }catch(e){if(signal.aborted)throw abortErr();if(attempt===2)throw e;}
      }
      if(!response?.ok)throw new Error(`WMTS-Kachel ${tile.x}/${tile.y} fehlt (HTTP ${response?.status}). PDF nicht erstellt.`);
      const mime=response.headers.get('content-type')||'';
      if(!mime.includes('image/'))throw new Error('WMTS lieferte keine Bilddaten – Export abgebrochen.');
      return {tile,buffer:new Uint8Array(await response.arrayBuffer())};
    }));
    for(const {tile,buffer} of loaded){
      const [x,y]=toPaper(l,tile.minE,tile.maxN);
      if(selectedRegion || mode==='grau'){
        const bitmap=await createImageBitmap(new Blob([buffer],{type:'image/jpeg'}));
        const base=document.createElement('canvas');base.width=256;base.height=256;
        const bctx=base.getContext('2d');bctx.drawImage(bitmap,0,0,256,256);bitmap.close?.();
        const composited=document.createElement('canvas');composited.width=256;composited.height=256;
        const cctx=composited.getContext('2d');cctx.filter='grayscale(1)';cctx.drawImage(base,0,0);cctx.filter='none';
        if(selectedRegion && mode!=='grau'){
          cctx.fillStyle=`rgba(255,255,255,${MASK_LIGHTEN_ALPHA})`;cctx.fillRect(0,0,256,256);
          for(const geometry of highlightParts(selectedRegion)){
            cctx.save();
            applyGeometryPath(cctx,geometry,(e,n)=>[(e-tile.minE)/plan.resolution,(tile.maxN-n)/plan.resolution]);
            cctx.clip('evenodd');cctx.drawImage(base,0,0);cctx.restore();
          }
        }
        pdf.addImage(composited.toDataURL('image/jpeg',.97),'JPEG',x,y,size,size,undefined,'FAST');
      }else pdf.addImage(buffer,'JPEG',x,y,size,size,undefined,'FAST');
    }
    status(`Druck-PDF: ${Math.min(index+6,plan.tiles.length)}/${plan.tiles.length} WMTS-Kacheln (${plan.resolution} m/Pixel) …`);
    // Yield to browser after each batch to keep buttons responsive.
    await new Promise(ok=>setTimeout(ok,0));
  }
  pdf.restoreGraphicsState();addAttribution(pdf,l);
  return pdf;
}
async function prepareContours(signal){
  const l=layout(cfg());const step=Number($('sampling').value),interval=Number($('interval').value);
  if(!(interval>=1&&interval<=1000))throw new Error('Äquidistanz muss zwischen 1 und 1 000 m liegen.');
  if(step<2||step>50)throw new Error('Rasterprobe muss 2 bis 50 m betragen.');
  const files=[...$('heightFiles').files];
  const grid=await getHeightGrid(l.b,step,{files,onProgress:s=>status(s),signal,retries:2});
  if(signal.aborted)throw abortErr();
  status('Berechne Höhenlinien (Marching Squares) …');
  const result=computeContours(grid,interval);
  if(!result.levels.length)throw new Error('Keine Höhenlinien bei dieser Äquidistanz im Gebiet.');
  contourResult=result;contourLayout={...l,contourInterval:interval};
  $('contourExports').hidden=false;
  schedule(false);
  status(`${result.levels.length} Höhenstufen zwischen ${format(result.min,1)} und ${format(result.max,1)} m · ${format(result.totalSegments)} Liniensegmente.`, 'success');
  return result;
}
function pdfContour(l,result){
  const pdf=freshPdf(l);pdf.saveGraphicsState();pdf.rect(l.margin,l.margin,l.innerW,l.innerH,null);pdf.clip();pdf.discardPath();
  pdf.setDrawColor(20,27,35);pdf.setLineCap('round');pdf.setLineJoin('round');
  const it=Number($('interval').value),major=Number($('majorEvery').value),stroke=Number($('stroke').value);
  for(const lev of result.levels){
    const thick=major>0&&Math.abs(lev.height/(major*it)-Math.round(lev.height/(major*it)))<1e-8;
    pdf.setLineWidth(stroke*(thick?1.45:1));
    for(const path of lev.paths){
      const first=toPaper(l,...path[0]);pdf.moveTo(...first);
      for(let i=1;i<path.length;i++)pdf.lineTo(...toPaper(l,...path[i]));
      pdf.stroke();
    }
  }
  pdf.restoreGraphicsState();addAttribution(pdf,l);return pdf;
}
async function runTask(fn){
  if(working)return;working=true;aborter=new AbortController();
  $('cancel').hidden=false;
  for(const id of ['pdfButton','makeContours','svgAll','zipLevels'])$(id).disabled=true;
  try{await fn(aborter.signal);}catch(e){status(errorText(e),'error');console.error(e);}
  finally{working=false;aborter=null;$('cancel').hidden=true;for(const id of ['pdfButton','makeContours','svgAll','zipLevels'])$(id).disabled=false;}
}
async function downloadPdf(){
  await runTask(async signal=>{
    const l=layout(cfg());
    if(mode==='kontur'){
      if($('contourBooklet').checked){
        // Den Dateidialog VOR dem asynchronen Geländedownload öffnen,
        // da Chromium nach einem await die Nutzeraktivierung verlieren kann.
        const output=await openLargePdfOutput('Graukarton_Hoehenstufen_Buechlein_'+fileStem()+'.pdf',{
          onProgress:s=>status(s)
        });
        let booklet=null;
        try{
          const result=contourResult||await prepareContours(signal);
          if(signal.aborted)throw abortErr();
          booklet=new ContourBookletPdf(output.sink,l,result,{
            strokeMm:Number($('stroke').value),
            title:'Graukarton Hoehenstufen 1:'+l.scale,
            interval:Number($('interval').value),
            onProgress:s=>status(s)
          });
          const info=await booklet.create(signal);
          if(output.reveal)await output.reveal();
          status(`Höhenlinien-Büchlein erstellt: ${info.pages} Seiten inklusive Titelseite/Übersicht, danach je eine Höhenstufe mit schraffierter Schnittfläche, ${l.w} × ${l.h} mm, Massstab 1:${format(l.scale)}. Druck bei 100 %.`, 'success');
        }catch(e){
          if(booklet)await booklet.abort().catch(()=>{});
          else await output.sink.abort().catch(()=>{});
          throw e;
        }
        return;
      }
      const result=contourResult||await prepareContours(signal);
      if(signal.aborted)throw abortErr();status('Erzeuge Vektor-PDF …');
      const pdf=pdfContour(l,result);pdf.save('Hoehenlinien_'+fileStem()+'.pdf');
    }else{
      if(mode==='luftbild'&&$('exportSource').value==='original'){
        // IMPORTANT: open the system Save dialog now, while the click still
        // carries user activation. Delayed picker calls fail in Chrome.
        const output=await openLargePdfOutput('SWISSIMAGE_'+fileStem()+'.pdf',{onProgress:s=>status(s)});
        const streamed=new IncrementalA0Pdf(output.sink,{
          pageWidthMm:l.w,pageHeightMm:l.h,title:'SWISSIMAGE Luftbild '+fileStem(),scale:l.scale
        });
        try{
          await streamed.start();
          const {nativeDpi}=await createOriginalRasterPdf(l,mode,selectedRegion,[...$('mapFiles').files],{
            signal,onProgress:s=>status(s),streamPdf:streamed
          });
          if(signal.aborted)throw abortErr();
          const info=await streamed.finish();
          if(output.reveal)await output.reveal();
          status(`SWISSIMAGE-Druck-PDF fertig: ${l.w} × ${l.h} mm · ${l.dpi} dpi · ${format(info.images)} Bildblöcke · ${format(info.bytes/1e6,1)} MB · Quelle effektiv ca. ${Math.round(nativeDpi)} dpi. Drucken mit 100 %.`, 'success');
        }catch(e){await streamed.abort().catch(()=>{});throw e;}
        return;
      }
      if($('exportSource').value==='original'){
        const {pdf,nativeDpi}=await createOriginalRasterPdf(l,mode,selectedRegion,[...$('mapFiles').files],{
          signal,onProgress:s=>status(s),freshPdf,addAttribution
        });
        if(signal.aborted)throw abortErr();
        pdf.save('Original_'+l.dpi+'dpi_'+fileStem()+'.pdf');
        status(`Druck-PDF mit ${l.dpi} dpi erstellt (Quelle effektiv ca. ${Math.round(nativeDpi)} dpi). Massstab beim Druck 100 %.`, 'success');
        return;
      }
      const pdf=await pdfMap(l,signal);if(signal.aborted)throw abortErr();
      pdf.save('WMTS_'+fileStem()+'.pdf');
    }
    status('PDF erstellt. Beim Ausdrucken 100 % / tatsächliche Grösse wählen.', 'success');
  });
}
function ensureContours(){
  if(!contourResult||!contourLayout)throw new Error('Zuerst Höhenlinien berechnen.');
  if(contourLayout.b.minE!==layout(cfg()).b.minE||contourLayout.b.maxN!==layout(cfg()).b.maxN)throw new Error('Ausschnitt verändert. Höhenlinien erneut berechnen.');
  return {result:contourResult,l:contourLayout};
}
function downloadSvg(){
  try{
    const {result,l}=ensureContours();const stroke=Number($('stroke').value),majorEvery=Number($('majorEvery').value);
    saveBlob(svgForContours(result,l,{stroke,majorEvery}),'Hoehenlinien_'+fileStem()+'.svg','image/svg+xml;charset=utf-8');
    status('SVG-Gesamtkarte erstellt (echte Vektorkonturen).','success');
  }catch(e){status(errorText(e),'error');}
}
async function downloadStageZip(){
  await runTask(async signal=>{
    const Zip=globalThis.JSZip;if(!Zip)throw new Error('JSZip nicht geladen. CDN/Internet prüfen.');
    const {result,l}=ensureContours(),zip=new Zip(),stroke=Number($('stroke').value),majorEvery=Number($('majorEvery').value);
    zip.file('Hoehenlinien_GESAMT.svg',svgForContours(result,l,{stroke,majorEvery}));
    zip.file('README.txt',`Schnittvorlagen aus swissALTI3D (© swisstopo)\nMassstab 1:${l.scale}, Blatt ${l.w} x ${l.h} mm\nÄquidistanz ${l.contourInterval} m; Höhen LN02\nJede Datei enthält die Linien einer Höhenstufe als echte Vektoren.\nAlle Dateien beim Druck 100 Prozent / tatsächliche Grösse.\nRandberührende Kurven sind offene Höhenlinien (KEINE geschlossenen Schneideflächen).\n`);
    for(let i=0;i<result.levels.length;i++){
      if(signal.aborted)throw abortErr();
      const level=result.levels[i].height,name=`Stufe_${String(level).replace('.','_').padStart(5,'0')}m.svg`;
      zip.file(name,svgForContours(result,l,{level,stroke,majorEvery:0}));
      if(i%10===0)status(`Packe Höhenstufe ${i+1}/${result.levels.length} …`);
    }
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}},meta=>status(`Erzeuge ZIP: ${Math.round(meta.percent)} % …`));
    if(signal.aborted)throw abortErr();saveBlob(blob,'Graukarton_Stufen_'+fileStem()+'.zip','application/zip');
    status(`${result.levels.length} separate Höhenstufen als SVG-ZIP erstellt.`,'success');
  });
}

// Political boundaries: searchable municipality, fixed selection of all 26 cantons.
for(const [code,name] of CANTONS){
  const opt=document.createElement('option');opt.value=name;opt.textContent=`${code} – ${name}`;
  $('cantonSelect').appendChild(opt);
}
$('cantonSelect').value='Zug';
function clearRegion({resetType=false}={}){
  selectedRegion=null;$('clearRegion').hidden=true;
  $('regionStatus').textContent='Keine Farbmaske gewählt. Innerhalb der gewählten Gemeinde bzw. des Kantons bleibt die Karte farbig; ausserhalb wird sie heller grau. Bei Gemeinden werden angrenzende Seen farbig mit hervorgehoben.';
  $('regionResults').hidden=true;
  if(resetType){$('regionType').value='none';$('municipalityArea').hidden=true;$('cantonArea').hidden=true;}
  schedule();
}
$('regionType').addEventListener('change',()=>{
  if(working)return;
  const kind=$('regionType').value;
  clearRegion();$('municipalityArea').hidden=kind!=='gemeinde';$('cantonArea').hidden=kind!=='kanton';
});
$('clearRegion').addEventListener('click',()=>clearRegion({resetType:true}));
async function assignRegion(record,kind){
  if(working)return;
  $('regionStatus').textContent=`Lade amtliche Grenze von ${record.name} …`;
  try{
    const geometry=await getRegionGeometry(record.id,kind);
    if($('regionType').value!==kind)return;
    let lakeNames=[],lakeGeometries=[],lakeWarning='';
    if(kind==='gemeinde'){
      $('regionStatus').textContent=`Suche angrenzende Seen bei ${record.name} …`;
      try{
        const extra=await getAdjacentLakeGeometry(geometry);
        lakeGeometries=extra.geometries||[];
        lakeNames=extra.lakes||[];
        if(extra.warnings?.length)lakeWarning=extra.warnings.join(' / ');
      }catch(e){lakeWarning=e.message;console.warn('See-Geometrien konnten nicht geladen werden:',e);}
    }
    selectedRegion={name:record.name,kind,geometry,lakeGeometries,lakeNames};
    const lakeInfo=kind==='gemeinde'?(lakeGeometries.length?
      ` · ${lakeGeometries.length} See${lakeGeometries.length===1?'':'n'} vollständig farbig${lakeNames.length?' ('+lakeNames.slice(0,3).join(', ')+(lakeNames.length>3?' …':'')+')':''}`:
      ' · Kein angrenzender See erkannt') : '';
    const warning=lakeWarning?` · Hinweis: ${lakeWarning}`:'';
    $('regionStatus').textContent=`${kind==='kanton'?'Kanton':'Gemeinde'} ${record.name}: farbig innerhalb, ausserhalb heller grau${lakeInfo}${warning} (${format(geometry.points)} amtliche Grenzpunkte).`;
    $('clearRegion').hidden=false;$('regionResults').hidden=true;
    if($('fitRegion').checked){
      const l=layout(cfg()),f=fitRegion(geometry,l.innerW,l.innerH);
      $('east').value=Math.round(f.e);$('north').value=Math.round(f.n);$('scale').value=f.scale;
      invalidateContours();
    }
    schedule();status(`${record.name} ausgewählt – amtliche Maske geladen.`, 'success');
  }catch(e){status('Grenzdaten fehlgeschlagen: '+errorText(e),'error');$('regionStatus').textContent='Grenzabruf fehlgeschlagen. Keine Maske aktiviert.';selectedRegion=null;schedule();}
}
async function findMunicipality(){
  const q=$('municipalitySearch').value.trim();if(!q)return;
  $('regionStatus').textContent=`Suche politische Gemeinde «${q}» …`;$('regionResults').hidden=true;
  try{
    const matches=await searchRegions(q,'gemeinde');
    if(!matches.length){$('regionStatus').textContent=`Keine politische Gemeinde zu «${q}» gefunden (beide swisstopo-Suchwege geprüft).`;return;}
    const target=$('regionResults');target.replaceChildren();
    for(const record of matches){
      const b=document.createElement('button');b.textContent=record.name;
      b.addEventListener('click',()=>assignRegion(record,'gemeinde'));target.appendChild(b);
    }
    target.hidden=false;$('regionStatus').textContent=`${matches.length} Treffer – eine Gemeinde auswählen.`;
  }catch(e){$('regionStatus').textContent='Gemeindesuche fehlgeschlagen: '+errorText(e);status('Gemeindesuche fehlgeschlagen: '+errorText(e),'error');}
}
$('findMunicipality').addEventListener('click',findMunicipality);
$('municipalitySearch').addEventListener('keydown',e=>{if(e.key==='Enter')findMunicipality();});
$('selectCanton').addEventListener('click',async()=>{
  const name=$('cantonSelect').value;
  $('regionStatus').textContent=`Suche Kanton ${name} …`;
  try{
    const matches=await searchRegions(name,'kanton');
    if(!matches.length)throw new Error('Kanton nicht gefunden.');
    const normalized=x=>x.replace(/<[^>]*>/g,'').toLowerCase().replace(/^kanton\s+/,'').trim();
    const record=matches.find(x=>normalized(x.name)===normalized(name))||matches[0];
    await assignRegion(record,'kanton');
  }catch(e){status('Kantonswahl fehlgeschlagen: '+errorText(e),'error');}
});
$('exportSource').addEventListener('change',schedule);
$('mapFiles').addEventListener('change',()=>{
  status(`${$('mapFiles').files.length} lokale Karten-GeoTIFFs ausgewählt.`);
  if($('mapFiles').files.length&&$('exportSource').value==='wmts')$('exportSource').value='original';
  schedule();
});

for(const id of inputs){
  $(id).addEventListener('change',()=>{if(!['stroke','majorEvery'].includes(id))invalidateContours();schedule();});
  $(id).addEventListener('input',()=>{if(id!=='stroke'&&id!=='majorEvery')invalidateContours();schedule();});
}
for(const btn of document.querySelectorAll('.mode'))btn.addEventListener('click',()=>setMode(btn.dataset.mode));
for(const btn of document.querySelectorAll('#scales button'))btn.addEventListener('click',()=>{$('scale').value=btn.dataset.scale;invalidateContours();schedule();});
$('findPlace').addEventListener('click',searchPlace);
$('searchText').addEventListener('keydown',e=>{if(e.key==='Enter')searchPlace();});
$('resetCenter').addEventListener('click',()=>{$('east').value=2693000;$('north').value=1231000;invalidateContours();schedule();});
$('zoomIn').addEventListener('click',()=>{$('scale').value=Math.max((mode==='karte'||mode==='grau')?10000:100,Math.round(cfg().scale/1.5/100)*100);invalidateContours();schedule();});
$('zoomOut').addEventListener('click',()=>{$('scale').value=Math.min((mode==='karte'||mode==='grau')?1000000:2500000,Math.round(cfg().scale*1.5/100)*100);invalidateContours();schedule();});
$('makeContours').addEventListener('click',()=>runTask(prepareContours));
$('pdfButton').addEventListener('click',downloadPdf);
$('contourBooklet').addEventListener('change',updateContourPdfLabel);
$('svgAll').addEventListener('click',downloadSvg);
$('zipLevels').addEventListener('click',downloadStageZip);
$('cancel').addEventListener('click',()=>aborter?.abort());
$('heightFiles').addEventListener('change',()=>{invalidateContours();status(`${$('heightFiles').files.length} lokale GeoTIFF-Datei(en) ausgewählt.`);schedule();});
let drag=null;
canvas.addEventListener('pointerdown',e=>{if(working)return;drag={x:e.clientX,y:e.clientY,e:cfg().e,n:cfg().n};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(!drag)return;
  const l=layout(cfg());const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  const metersPerPx=l.w*l.scale/(1000*Math.max(1,canvas.clientWidth));
  $('east').value=Math.round(drag.e-dx*metersPerPx);$('north').value=Math.round(drag.n+dy*metersPerPx);
  invalidateContours();schedule(false);
});
for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>drag=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();$('scale').value=Math.max((mode==='karte'||mode==='grau')?10000:100,Math.min((mode==='karte'||mode==='grau')?1000000:2500000,Math.round(cfg().scale*(e.deltaY>0?1.18:1/1.18)/100)*100));invalidateContours();schedule();},{passive:false});
window.addEventListener('resize',()=>schedule());
schedule(false);
