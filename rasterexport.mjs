import {toPaper} from './core.mjs?v=2.7';
import {choosePrintProduct,discoverPrintAssets,printPixels,expectedNativeDpi,verifyTileCoverage} from './printdata.mjs?v=2.7';
import {applyGeometryPath,highlightParts} from './regions.mjs?v=2.7';
const MASK_LIGHTEN_ALPHA=.26;

function intersection(a,b){
  const minE=Math.max(a.minE,b.minE),maxE=Math.min(a.maxE,b.maxE);
  const minN=Math.max(a.minN,b.minN),maxN=Math.min(a.maxN,b.maxN);
  return minE<maxE&&minN<maxN?{minE,maxE,minN,maxN}:null;
}
function sourceBounds(bb){return {minE:bb[0],minN:bb[1],maxE:bb[2],maxN:bb[3]};}
function createCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function transformToBlock(l,total,x0,y0,e,n){
  return [(e-l.b.minE)/l.groundW*total.width-x0,(l.b.maxN-n)/l.groundH*total.height-y0];
}
/** Render only the area of a COG intersecting this 512-pixel print block. */
export async function paintSourceBlock(ctx,source,rect,l,total,x0,y0,signal){
  const overlap=intersection(rect,source.bounds);if(!overlap)return false;
  if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
  const {image,bb}=source;
  const rx=(bb[2]-bb[0])/image.getWidth(),ry=(bb[3]-bb[1])/image.getHeight();
  const c0=Math.max(0,Math.floor((overlap.minE-bb[0])/rx)-1);
  const c1=Math.min(image.getWidth(),Math.ceil((overlap.maxE-bb[0])/rx)+1);
  const r0=Math.max(0,Math.floor((bb[3]-overlap.maxN)/ry)-1);
  const r1=Math.min(image.getHeight(),Math.ceil((bb[3]-overlap.minN)/ry)+1);
  if(c1<=c0||r1<=r0)return false;
  const srcMinE=bb[0]+c0*rx,srcMaxN=bb[3]-r0*ry;
  const srcW=(c1-c0)*rx,srcH=(r1-r0)*ry;
  const destWidth=srcW/l.groundW*total.width;
  const destHeight=srcH/l.groundH*total.height;
  // COG server range access: request downsampled pixels, never decode full map sheets.
  const readW=Math.max(1,Math.min(1024,Math.ceil(destWidth)));
  const readH=Math.max(1,Math.min(1024,Math.ceil(destHeight)));
  const rgb=await image.readRGB({window:[c0,r0,c1,r1],width:readW,height:readH,enableAlpha:true,interleave:true,resampleMethod:'bilinear',pool:null,signal});
  if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
  const samples=rgb.length/(readW*readH);
  if(samples!==3&&samples!==4)throw new Error('COG-Decoder hat unerwartete Farbkanäle geliefert.');
  const patch=createCanvas(readW,readH),pctx=patch.getContext('2d');
  const data=pctx.createImageData(readW,readH);
  for(let i=0,j=0;i<rgb.length;i+=samples,j+=4){
    data.data[j]=rgb[i];data.data[j+1]=rgb[i+1];data.data[j+2]=rgb[i+2];
    data.data[j+3]=samples===4?rgb[i+3]:255;
  }
  pctx.putImageData(data,0,0);
  const [px,py]=transformToBlock(l,total,x0,y0,srcMinE,srcMaxN);
  ctx.drawImage(patch,px,py,destWidth,destHeight);
  return true;
}
/** If a canton or commune is selected: gray outside, full colour inside, including polygon holes. */
export function colourizeBlock(raw,w,h,region,l,total,x0,y0,mode){
  if(mode!=='grau'&&!region)return raw;
  const out=createCanvas(w,h),ctx=out.getContext('2d');
  ctx.filter='grayscale(1)';ctx.drawImage(raw,0,0);ctx.filter='none';
  if(region&&mode!=='grau'){
    ctx.fillStyle=`rgba(255,255,255,${MASK_LIGHTEN_ALPHA})`;
    ctx.fillRect(0,0,w,h);
    // Union the highlighted shapes by rendering separate clips, avoiding
    // evenodd cancellation where a lake overlaps the municipal polygon.
    for(const geometry of highlightParts(region)){
      ctx.save();
      applyGeometryPath(ctx,geometry,(e,n)=>transformToBlock(l,total,x0,y0,e,n));
      ctx.clip('evenodd');ctx.drawImage(raw,0,0);ctx.restore();
    }
  }
  return out;
}
/** Open TIFFs by Range requests, then draw and embed one page at 508 dpi in 512x512 chunks. */
export async function createOriginalRasterPdf(l,mode,region,localFiles,{signal,onProgress=()=>{},freshPdf,addAttribution,maxSources=12000,streamPdf=null}={}){
  if(!globalThis.GeoTIFF?.fromUrl)throw new Error('GeoTIFF.js nicht geladen. Internet/CDN prüfen.');
  if(!streamPdf&&!globalThis.jspdf?.jsPDF)throw new Error('PDF-Bibliothek nicht geladen.');
  const total=printPixels(l);
  if(total.blocks>12000)throw new Error(`${total.blocks} Druckbildblöcke übersteigen die begrenzte Browserkapazität. Druckmassstab oder DPI anpassen.`);
  onProgress(`Druckraster: ${total.width.toLocaleString('de-CH')} × ${total.height.toLocaleString('de-CH')} Pixel (${l.dpi} dpi) …`);
  let assets,product=choosePrintProduct(l.scale,mode);
  if(localFiles.length){
    assets=localFiles.map(file=>({file,href:'',year:0}));
    if(assets.length>maxSources)throw new Error(`Zu viele lokale Dateien (maximal ${maxSources}).`);
  }else{
    const found=await discoverPrintAssets(l.b,{mode,scale:l.scale,signal,onProgress,limit:maxSources});
    assets=found.assets;product=found.product;
  }
  // SWISSIMAGE consists of 1-km GeoTIFFs. Open on demand to support A0 without
  // holding hundreds of 10cm TIFF directories in browser memory simultaneously.
  const tileBounds=asset=>{
    const m=(asset.href||'').match(/_(\d{4})-(\d{4})_(?:0\.1|0\.25|2)_2056(?:[_.-]|$)/);
    if(!m)return null;
    const e=Number(m[1])*1000,n=Number(m[2])*1000;
    return {minE:e,minN:n,maxE:e+1000,maxN:n+1000};
  };
  const lazy=mode==='luftbild'&&!localFiles.length&&assets.every(a=>tileBounds(a));
  const opened=[],active=new Map();
  let nativeDpi=Infinity;
  const openAsset=async asset=>{
    if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
    const tif=asset.file?await GeoTIFF.fromBlob(asset.file):await GeoTIFF.fromUrl(asset.href,{allowFullFile:false,blockSize:32768,cacheSize:64,maxRanges:0});
    const original=await tif.getImage(),nativeBounds=original.getBoundingBox();
    if(!nativeBounds?.every(Number.isFinite)||nativeBounds[0]<1800000||nativeBounds[2]>3300000||nativeBounds[1]<700000||nativeBounds[3]>1700000)
      throw new Error('GeoTIFF muss in CH1903+/LV95 (EPSG:2056) georeferenziert sein.');
    const nativeX=(nativeBounds[2]-nativeBounds[0])/original.getWidth();
    const nativeY=(nativeBounds[3]-nativeBounds[1])/original.getHeight();
    if(nativeX<=0||nativeY<=0)throw new Error('GeoTIFF besitzt ungültige Pixelauflösung.');
    // A user-supplied TIFF may depict the *wrong* national map series.
    // Check native 508dpi swisstopo pixel spacing (e.g. SMR25 = 1.25m).
    // Unlike output PDF dpi, this validates the underlying cartography.
    if(mode==='karte'||mode==='grau'){
      const expected=product.scale/20000;
      if(Math.abs(nativeX/expected-1)>.06 || Math.abs(nativeY/expected-1)>.06)
        throw new Error(`Die GeoTIFF-Quelle hat ${nativeX.toFixed(3)} × ${nativeY.toFixed(3)} m/Pixel, erwartet werden ca. ${expected} m/Pixel für Landeskarte 1:${product.scale.toLocaleString('de-CH')}. Keine fremde Kartenserie als normgerechten Druck ausgeben.`);
    }
    nativeDpi=Math.min(nativeDpi,expectedNativeDpi(l.scale,Math.max(nativeX,nativeY)));
    // Read through the COG's internal overviews. At A0/1:10k, a 0.1-m
    // original should be decoded through the ~0.4-m overview (if provided),
    // not by expanding ~25 times more native pixels than the page needs.
    let image=original,bb=nativeBounds,sourceGsd=Math.max(nativeX,nativeY);
    const requiredGsd=l.scale*.0254/l.dpi;
    if(mode==='luftbild'&&sourceGsd<requiredGsd*.7){
      try{
        const count=Math.min(await tif.getImageCount(),16);
        for(let j=1;j<count;j++){
          const candidate=await tif.getImage(j);
          if(candidate.getWidth()>=image.getWidth()||candidate.getHeight()>=image.getHeight())continue;
          let candidateBbox;
          try{candidateBbox=candidate.getBoundingBox();}catch{continue;}
          if(!candidateBbox?.every(Number.isFinite))continue;
          const pixel=Math.max((candidateBbox[2]-candidateBbox[0])/candidate.getWidth(),
            (candidateBbox[3]-candidateBbox[1])/candidate.getHeight());
          if(pixel<=sourceGsd||pixel>requiredGsd*1.01)continue;
          if(candidateBbox.some((v,k)=>Math.abs(v-nativeBounds[k])>Math.max(1,pixel*2)))continue;
          if((candidate.fileDirectory?.SamplesPerPixel??3)<3)continue;
          image=candidate;bb=candidateBbox;sourceGsd=pixel;
        }
      }catch(e){console.warn('COG-Übersichten nicht verfügbar; Originalauflösung wird verwendet:',e);}
    }
    return {image,tif,bb,bounds:sourceBounds(bb),nativeX,nativeY,sourceGsd,asset};
  };
  try{
    if(!lazy)for(let i=0;i<assets.length;i++){
      if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
      onProgress(`Öffne Originaldaten: ${i+1} / ${assets.length} – ${product.description} …`);
      opened.push(await openAsset(assets[i]));
    }
    if(!lazy&&!opened.length)throw new Error('Keine Druckquellen geladen.');
    if(lazy)onProgress(`${assets.length} Orthofoto-Kacheln entdeckt. Sie werden platzsparend bei Bedarf geöffnet.`);
    else onProgress(`${product.description}: Originalauflösung mindestens ca. ${Math.round(nativeDpi)} effektive dpi, PDF ${l.dpi} dpi.`);
    const pdf=streamPdf||freshPdf(l);
    const chunk=512;
    const xs=Math.ceil(total.width/chunk),ys=Math.ceil(total.height/chunk);
    let count=0;
    for(let iy=0;iy<ys;iy++)for(let ix=0;ix<xs;ix++){
      if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
      const x0=ix*chunk,y0=iy*chunk,w=Math.min(chunk,total.width-x0),h=Math.min(chunk,total.height-y0);
      const rect={minE:l.b.minE+x0/total.width*l.groundW,
        maxE:l.b.minE+(x0+w)/total.width*l.groundW,
        maxN:l.b.maxN-y0/total.height*l.groundH,
        minN:l.b.maxN-(y0+h)/total.height*l.groundH};
      let sources;
      if(lazy){
        const required=assets.filter(asset=>intersection(tileBounds(asset),rect));
        sources=[];
        for(const asset of required){
          let entry=active.get(asset.href);
          if(entry){active.delete(asset.href);active.set(asset.href,entry);} // LRU
          else{
            entry=await openAsset(asset);active.set(asset.href,entry);
          }
          if(intersection(entry.bounds,rect))sources.push(entry);
        }
        while(active.size>14){const [first,entry]=active.entries().next().value;active.delete(first);entry.tif.close?.();}
      }else sources=opened.filter(s=>intersection(s.bounds,rect));
      if(!verifyTileCoverage(rect,sources.map(s=>s.bb)))
        throw new Error(`Originalkarten nicht lückenlos: Block ${ix+1}/${xs}, ${iy+1}/${ys}. Keine unvollständige PDF ausgegeben.`);
      const raw=createCanvas(w,h),ctx=raw.getContext('2d');
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      // Old first, newer file on top if maps overlap.
      for(const source of sources)await paintSourceBlock(ctx,source,rect,l,total,x0,y0,signal);
      // Reject missing alpha coverage; a TIFF with no data must not become a white area.
      const pixels=ctx.getImageData(0,0,w,h).data;
      for(let p=3;p<pixels.length;p+=4){if(pixels[p]<250)
        throw new Error(`Unvollständige GeoTIFF-Abdeckung im PDF-Bildblock ${ix+1}/${iy+1} (Transparenz).`);
      }
      const out=colourizeBlock(raw,w,h,region,l,total,x0,y0,mode);
      const pdfX=l.margin+x0/total.width*l.innerW;
      const pdfY=l.margin+y0/total.height*l.innerH;
      const pdfW=w/total.width*l.innerW,pdfH=h/total.height*l.innerH;
      // Stream the JPEG block to disk immediately: no full A0 PDF in memory.
      if(streamPdf){
        await streamPdf.imageCanvas(out,{xMm:pdfX,yMm:pdfY,widthMm:pdfW,heightMm:pdfH},{quality:.98});
      }else if(mode==='luftbild')pdf.addImage(out.toDataURL('image/jpeg',.98),'JPEG',pdfX,pdfY,pdfW,pdfH,undefined,'NONE');
      else pdf.addImage(out.toDataURL('image/png'),'PNG',pdfX,pdfY,pdfW,pdfH);
      count++;
      if(count%4===0||count===total.blocks){
        onProgress(`${l.dpi}-dpi-Originaldruck: ${count}/${total.blocks} Blöcke · Quelle ca. ${Math.round(nativeDpi)} dpi · ${product.description}`);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    if(!streamPdf)addAttribution(pdf,l);
    return {pdf,product,nativeDpi,blocks:total.blocks};
  }finally{for(const entry of [...opened,...active.values()])try{entry.tif.close?.();}catch{}}
}
