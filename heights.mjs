import {stacBbox} from './core.mjs';
const STAC='https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissalti3d/items';

function idFor(href) {
  const m=href.match(/(?:swissalti3d_)(\d{4})_(\d{4}-\d{4})_2_2056_5728\.tif/i);
  return m?{year:Number(m[1]),tile:m[2]}:null;
}
export function selectHeightAssets(features) {
  const found=new Map();
  for(const item of features){
    for(const a of Object.values(item.assets||{})) {
      const href=a?.href||'';
      if(!/https:\/\//i.test(href)||!/_2_2056_5728\.tif(?:\?|$)/i.test(href))continue;
      const identity=idFor(href), key=identity?.tile??href;
      const year=identity?.year??0;
      if(!found.has(key)||found.get(key).year<year)found.set(key,{href,year,key});
    }
  }
  return [...found.values()];
}
export async function discoverHeightAssets(bounds,progress=()=>{},signal) {
  const b=stacBbox(bounds);
  let url=STAC+'?bbox='+b.join(',')+'&limit=100',all=[];
  const visited=new Set();
  for(let page=0;url&&page<18;page++){
    if(visited.has(url))throw new Error('STAC-Paginierung wiederholt dieselbe Seite');visited.add(url);
    progress(`STAC-Metadaten: Seite ${page+1} …`);
    const r=await fetch(url,{signal});if(!r.ok)throw new Error(`swisstopo STAC: HTTP ${r.status}`);
    const j=await r.json();all.push(...(j.features||[]));
    if(all.length>1600)throw new Error('Gebiet zu gross für automatischen STAC-Bezug. Bitte kleineres Papiergebiet wählen.');
    const next=j.links?.find(x=>x.rel==='next');url=next?new URL(next.href,url).href:null;
  }
  const assets=selectHeightAssets(all).filter(a=>{
    const m=a.key.match(/^(\d{4})-(\d{4})$/);if(!m)return true;
    const e=Number(m[1])*1000,n=Number(m[2])*1000;
    return e<bounds.maxE+10&&e+1000>bounds.minE-10&&n<bounds.maxN+10&&n+1000>bounds.minN-10;
  });
  if(!assets.length)throw new Error('Keine passenden swissALTI3D-COG-Daten (2 m) gefunden.');
  return assets;
}
export function newHeightGrid(bounds,step,maxPoints=1600000) {
  const nx=Math.ceil((bounds.maxE-bounds.minE)/step)+1;
  const ny=Math.ceil((bounds.maxN-bounds.minN)/step)+1;
  if(nx*ny>maxPoints)throw new Error(`Das Höhenraster hätte ${(nx*ny).toLocaleString('de-CH')} Punkte. Rasterabstand erhöhen oder Papiergebiet verkleinern.`);
  const values=new Float32Array(nx*ny);values.fill(NaN);
  return {values,nx,ny,step,bounds};
}
export async function overlayTiff(grid,geotiff,progress=()=>{}) {
  const image=await geotiff.getImage();
  const samples=image.getSamplesPerPixel();
  if(samples!==1)throw new Error('Höhen-GeoTIFF benötigt genau einen Rasterkanal (keine RGB-Karte).');
  const bb=image.getBoundingBox();
  if(!bb?.every(Number.isFinite))throw new Error('GeoTIFF ohne gültige LV95-Georeferenzierung.');
  if(bb[0]<1800000||bb[2]>3300000||bb[1]<700000||bb[3]>1700000)throw new Error('GeoTIFF liegt nicht in EPSG:2056 (LV95).');
  const {step,nx,ny,bounds,values}=grid;
  const x0=Math.max(0,Math.ceil((bb[0]-bounds.minE)/step)), x1=Math.min(nx-1,Math.floor((bb[2]-bounds.minE-1e-7)/step));
  const y0=Math.max(0,Math.ceil((bounds.maxN-bb[3])/step)), y1=Math.min(ny-1,Math.floor((bounds.maxN-bb[1]-1e-7)/step));
  if(x0>x1||y0>y1)return 0;
  const xres=(bb[2]-bb[0])/image.getWidth(),yres=(bb[3]-bb[1])/image.getHeight();
  // Read only the intersecting, cropped GeoTIFF window. Pixel registration is
  // handled explicitly by sampling at the centre of the relevant source pixel.
  const minWorldE=bounds.minE+x0*step,maxWorldE=bounds.minE+x1*step;
  const maxWorldN=bounds.maxN-y0*step,minWorldN=bounds.maxN-y1*step;
  const c0=Math.max(0,Math.floor((minWorldE-bb[0])/xres)-2),
        c1=Math.min(image.getWidth(),Math.ceil((maxWorldE-bb[0])/xres)+2),
        r0=Math.max(0,Math.floor((bb[3]-maxWorldN)/yres)-2),
        r1=Math.min(image.getHeight(),Math.ceil((bb[3]-minWorldN)/yres)+2);
  const w=c1-c0,h=r1-r0;
  if(w<1||h<1)return 0;
  const raster=await image.readRasters({window:[c0,r0,c1,r1],interleave:true});
  const nodata=Number(image.getGDALNoData());
  const hasNoData=image.getGDALNoData()!=null&&Number.isFinite(nodata);
  let copied=0;
  for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){
    const x=bounds.minE+i*step,y=bounds.maxN-j*step;
    const col=Math.max(0,Math.min(w-1,Math.round((x-bb[0])/xres-0.5)-c0));
    const row=Math.max(0,Math.min(h-1,Math.round((bb[3]-y)/yres-0.5)-r0));
    const value=Number(raster[row*w+col]);
    if(Number.isFinite(value)&&(!hasNoData||value!==nodata)){
      values[j*nx+i]=value;copied++;
    }
  }
  progress(`Höhenkachel gelesen: ${copied.toLocaleString('de-CH')} Rasterwerte`);
  return copied;
}
export async function getHeightGrid(bounds,step,{files=[],onProgress=()=>{},signal,assetLimit=160}={}){
  if(!globalThis.GeoTIFF?.fromUrl)throw new Error('GeoTIFF-Bibliothek nicht geladen. Internetverbindung/CDN überprüfen.');
  const grid=newHeightGrid(bounds,step);
  const items=files.length?files.map(file=>({file})):await discoverHeightAssets(bounds,onProgress,signal);
  if(items.length>assetLimit)throw new Error(`Es wären ${items.length} COG-Höhenkacheln nötig (Browsergrenze ${assetLimit}). Kleineren Ausschnitt wählen oder lokale GeoTIFFs verwenden.`);
  const failures=[];
  for(let i=0;i<items.length;i++){
    if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
    onProgress(`Höhenmodell: ${i+1}/${items.length} Kacheln …`);
    try {
      const tif=items[i].file?await GeoTIFF.fromBlob(items[i].file):await GeoTIFF.fromUrl(items[i].href,{allowFullFile:false});
      await overlayTiff(grid,tif);
      tif.close?.();
    }catch(e){failures.push(`${items[i].file?.name||items[i].href?.split('/').pop()}: ${e.message}`);}
  }
  let valid=0;for(const v of grid.values)if(Number.isFinite(v))valid++;
  const coverage=valid/grid.values.length;
  if(coverage<1)throw new Error(`Höhenraster unvollständig: ${(coverage*100).toFixed(2)}% gedeckt. Keine Höhenlinien exportiert. ${failures.slice(0,3).join(' | ')}`);
  onProgress(`Höhenraster vollständig (${(coverage*100).toFixed(2)}%) – ${items.length} Quelle(n).`);
  return {...grid,sourceCount:items.length,coverage};
}
