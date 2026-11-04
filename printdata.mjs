/** Official high-resolution swisstopo STAC GeoTIFF product discovery, EPSG:2056. */
import {stacBbox} from './core.mjs';

export const MAP_SERIES = Object.freeze([
  {scale:10000,collection:'ch.swisstopo.landeskarte-farbe-10'},
  {scale:25000,collection:'ch.swisstopo.pixelkarte-farbe-pk25.noscale'},
  {scale:50000,collection:'ch.swisstopo.pixelkarte-farbe-pk50.noscale'},
  {scale:100000,collection:'ch.swisstopo.pixelkarte-farbe-pk100.noscale'},
  {scale:200000,collection:'ch.swisstopo.pixelkarte-farbe-pk200.noscale'},
  {scale:500000,collection:'ch.swisstopo.pixelkarte-farbe-pk500.noscale'}
]);
export const ORTHO_COLLECTION='ch.swisstopo.swissimage-dop10';
export function choosePrintProduct(scale,mode='karte'){
  if(mode==='luftbild')return {collection:ORTHO_COLLECTION,scale:null,expectedGsd:.1,description:'SWISSIMAGE Orthofoto (10 cm / regional 25 cm)'};
  let selection=MAP_SERIES[0];
  for(const series of MAP_SERIES)if(series.scale<=Number(scale))selection=series;
  return {...selection,expectedGsd:selection.scale/20000,description:`Swiss Map Raster 1:${selection.scale.toLocaleString('de-CH')} (508 dpi in Originalgrösse)`};
}
export function expectedNativeDpi(scale,sourceGsd){return Number(scale)*.0254/sourceGsd;}
export function selectPrintAssets(features,{mode='karte',collection='',preferMeters=.1}={}){
  const all=[];
  for(const item of features){
    for(const [assetKey,a] of Object.entries(item.assets||{})){
      const href=a?.href||'';
      if(!/^https:\/\//i.test(href)||!/\.tiff?(?:\?|$)/i.test(href))continue;
      const path=decodeURIComponent(href.split('?')[0]).split('/').pop()||'';
      const lower=(assetKey+' '+path).toLowerCase();
      // swisstopo STAC uses both smrx-xxx-YEAR-2056-krel-GSD.tiff
      // and SWISSIMAGE_YYYY_XXXX-YYYY_0.1_2056.tif naming styles.
      const year=Number(path.match(/(?:^|[-_])(20\d{2})(?=[-_])/i)?.[1]||0);
      if(mode==='luftbild'){
        const m=path.match(/(?:^|[_-])(0\.1|0\.25|2)(?=[_.-])/);
        const gsd=Number(a.gsd||m?.[1]);
        if(![.1,.25,2].includes(gsd))continue;
        const key=path.replace(/([-_])20\d{2}(?=[_-])/,'$1YEAR')
          .replace(/([-_])(?:0\.1|0\.25|2)(?=[_.-])/,'$1GSD');
        all.push({href,year,gsd,key,itemId:item.id});
      }else{
        // Only KREL is the relief-bearing coloured Swiss Map print sheet.
        if(!/(?:^|[_-])krel(?:[_\-.]|$)/i.test(lower))continue;
        if(/preview|thumbnail|overview/i.test(lower))continue;
        const gsd=Number(a.gsd||path.match(/(?:_|-)(0\.5|1\.25|2\.5|5|10|25)(?=\.tiff?$)/)?.[1]);
        const key=path.replace(/([-_])20\d{2}(?=[_-])/,'$1YEAR');
        all.push({href,year,gsd,key,itemId:item.id});
      }
    }
  }
  const chosen=new Map();
  for(const a of all){
    const current=chosen.get(a.key);
    if(!current || (mode==='luftbild'&&a.gsd<current.gsd) ||
      (a.gsd===current.gsd&&a.year>current.year) || (mode!=='luftbild'&&a.year>current.year)) chosen.set(a.key,a);
  }
  return [...chosen.values()];
}
export async function discoverPrintAssets(bounds,{mode='karte',scale=25000,signal,onProgress=()=>{},limit=1000}={}){
  const product=choosePrintProduct(scale,mode);
  const bbox=stacBbox(bounds).join(',');
  let url=`https://data.geo.admin.ch/api/stac/v1/collections/${encodeURIComponent(product.collection)}/items?bbox=${bbox}&limit=100`;
  let features=[];const visited=new Set();
  for(let page=0;url&&page<22;page++){
    if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
    if(visited.has(url))throw new Error('STAC-Paginierung fehlerhaft.');visited.add(url);
    onProgress(`Suche Original-GeoTIFFs (${product.description}), Seite ${page+1} …`);
    const r=await fetch(url,{signal});if(!r.ok)throw new Error(`STAC-Dienst ${product.collection}: HTTP ${r.status}`);
    const j=await r.json();features.push(...(j.features||[]));
    if(features.length>2200)throw new Error('Zu viele Quellenkacheln; Ausschnitt verkleinern.');
    const next=j.links?.find(v=>v.rel==='next');url=next?new URL(next.href,url).href:null;
  }
  if(url)throw new Error('STAC-Suche überschreitet 22 Seiten; Ausschnitt verkleinern.');
  const assets=selectPrintAssets(features,{mode,collection:product.collection});
  if(!assets.length)throw new Error(`Keine originalen GeoTIFF-Quelldaten für ${product.description} gefunden. Wähle einen anderen Kartenausschnitt oder lade lokale GeoTIFFs.`);
  if(assets.length>limit)throw new Error(`${assets.length} Datenkacheln gefunden (Browsergrenze ${limit}). Ausschnitt verkleinern oder lokal vorbereitete GeoTIFFs verwenden.`);
  return {product,assets};
}
/** Exact print raster pixel dimensions; independent of map source's native GSD. */
export function printPixels(layout){
  const width=Math.max(1,Math.round(layout.innerW/25.4*layout.dpi));
  const height=Math.max(1,Math.round(layout.innerH/25.4*layout.dpi));
  return {width,height,total:width*height,blocks:Math.ceil(width/512)*Math.ceil(height/512)};
}
/** Exact rectangle union coverage by a horizontal sweep, no sampling gaps. */
export function containsRect(b,e,n){return e>=b[0]&&e<=b[2]&&n>=b[1]&&n<=b[3];}
export function verifyTileCoverage(bounds,sourceBoxes){
  if(!sourceBoxes.length)return false;
  const clipped=sourceBoxes.map(bb=>[Math.max(bb[0],bounds.minE),Math.max(bb[1],bounds.minN),Math.min(bb[2],bounds.maxE),Math.min(bb[3],bounds.maxN)])
    .filter(bb=>bb[2]>bb[0]&&bb[3]>bb[1]);
  const xs=[bounds.minE,bounds.maxE,...clipped.flatMap(bb=>[bb[0],bb[2]])].sort((a,b)=>a-b);
  const eps=1e-6;
  for(let i=0;i<xs.length-1;i++){
    if(xs[i+1]-xs[i]<=eps)continue;
    const x=(xs[i]+xs[i+1])/2;
    const ys=clipped.filter(bb=>bb[0]<=x&&x<=bb[2]).map(bb=>[bb[1],bb[3]]).sort((a,b)=>a[0]-b[0]);
    let top=bounds.minN;
    for(const [low,high] of ys){if(low>top+eps)return false;top=Math.max(top,high);if(top>=bounds.maxN-eps)break;}
    if(top<bounds.maxN-eps)return false;
  }
  return true;
}
