/** Print and WMTS math in Swiss LV95 (metres). No network dependencies. */
export const PAPER = Object.freeze({
  A5:[148,210], A4:[210,297], A3:[297,420],
  A2:[420,594], A1:[594,841], A0:[841,1189]
});
export const ORIGIN = Object.freeze([2420000,1350000]);
export const TILE_PX=256;
export const RESOLUTIONS=Object.freeze([
  4000,3750,3500,3250,3000,2750,2500,2250,2000,1750,1500,1250,
  1000,750,650,500,250,100,50,20,10,5,2.5,2,/*24 unavailable*/null,1,.5,.25,.1
]);
export const SOURCES = Object.freeze({
  karte: {id:'ch.swisstopo.pixelkarte-farbe',label:'Landeskarte (farbig)',ext:'jpeg',lastZoom:23},
  grau: {id:'ch.swisstopo.pixelkarte-grau',label:'Landeskarte (grau)',ext:'jpeg',lastZoom:23},
  luftbild: {id:'ch.swisstopo.swissimage',label:'SWISSIMAGE Luftbild',ext:'jpeg',lastZoom:28}
});
export function dimensions(paper='A4',orientation='quer') {
  const p=PAPER[paper]; if(!p) throw new Error('Ungültiges Papierformat');
  return orientation==='quer'?[p[1],p[0]]:[p[0],p[1]];
}
export function layout(config) {
  const [w,h]=dimensions(config.paper,config.orientation);
  const margin=Number(config.margin), scale=Number(config.scale), dpi=Number(config.dpi);
  const e=Number(config.e),n=Number(config.n);
  if(!(Number.isFinite(margin)&&margin>=0&&margin*2<Math.min(w,h))) throw new Error('Ungültiger Seitenrand');
  if(!(Number.isFinite(scale)&&scale>=100&&scale<=2500000)) throw new Error('Massstab ausserhalb 1:100 bis 1:2 500 000');
  if(!(Number.isFinite(e)&&Number.isFinite(n)&&e>1800000&&e<3300000&&n>750000&&n<1700000)) throw new Error('Ungültige LV95-Koordinaten');
  if(!(dpi>=72&&dpi<=600)) throw new Error('Ungültige Druckauflösung');
  const innerW=w-2*margin,innerH=h-2*margin;
  const groundW=innerW*scale/1000,groundH=innerH*scale/1000;
  const b={minE:e-groundW/2,maxE:e+groundW/2,minN:n-groundH/2,maxN:n+groundH/2};
  return {w,h,margin,innerW,innerH,scale,dpi,e,n,groundW,groundH,b,targetResolution:scale*0.0254/dpi};
}
export function resolutionZoom(target,source='karte') {
  const maxZ=SOURCES[source]?.lastZoom??23;
  let z=14;
  for(let i=14;i<=maxZ;i++) if(RESOLUTIONS[i]!=null&&RESOLUTIONS[i]>=target) z=i;
  // Choose the first level with equal/finer pixel size; at the source's native detail cap, stop.
  if(RESOLUTIONS[z]>target) for(let i=z+1;i<=maxZ;i++) {
    if(RESOLUTIONS[i]!=null) {z=i;break;}
  }
  return z;
}
export function tileSpan(z) {const r=RESOLUTIONS[z];if(!r)throw new Error('Ungültige Kachelauflösung');return r*TILE_PX;}
export function enumerateTiles(bounds,z) {
  const s=tileSpan(z),[e0,n0]=ORIGIN;
  const x0=Math.floor((bounds.minE-e0)/s),x1=Math.floor((bounds.maxE-e0-1e-7)/s);
  const y0=Math.floor((n0-bounds.maxN)/s),y1=Math.floor((n0-bounds.minN-1e-7)/s);
  const arr=[];
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) arr.push({x,y,z,minE:e0+x*s,maxN:n0-y*s});
  return arr;
}
export function tileUrl(source,z,x,y) {
  const s=SOURCES[source];if(!s)throw new Error('Unbekannte Kartenquelle');
  return `https://wmts.geo.admin.ch/1.0.0/${s.id}/default/current/2056/${z}/${x}/${y}.${s.ext}`;
}
export function tilePlan(config) {
  const l=layout(config), z=resolutionZoom(l.targetResolution,config.source);
  const tiles=enumerateTiles(l.b,z),r=RESOLUTIONS[z];
  return {...l,z,resolution:r,actualDpi:config.scale*0.0254/r,tiles};
}
export function toPaper(l,e,n) {
  return [l.margin+(e-l.b.minE)*1000/l.scale, l.margin+(l.b.maxN-n)*1000/l.scale];
}
/** Approximate CH1903+ LV95 -> WGS84, sufficient for padded STAC discovery ONLY. */
export function lv95ToWgs84(e,n) {
  let y=(e-2600000)/1e6,x=(n-1200000)/1e6;
  const lat=16.9023892+3.238272*x-.270978*y*y-.002528*x*x-.0447*y*y*x-.0140*x*x*x;
  const lon=2.6779094+4.728982*y+.791484*y*x+.1306*y*x*x-.0436*y*y*y;
  return [lon*100/36,lat*100/36];
}
export function stacBbox(b) {
  const points=[[b.minE,b.minN],[b.minE,b.maxN],[b.maxE,b.minN],[b.maxE,b.maxN]].map(([e,n])=>lv95ToWgs84(e,n));
  return [Math.min(...points.map(p=>p[0]))-.004,Math.min(...points.map(p=>p[1]))-.004,
          Math.max(...points.map(p=>p[0]))+.004,Math.max(...points.map(p=>p[1]))+.004];
}
