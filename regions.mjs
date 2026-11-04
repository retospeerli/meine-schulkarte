/** SwissBOUNDARIES3D Polygon/MultiPolygon in LV95; rings include holes. */
export const MUNICIPAL_LAYER='ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill';
export const CANTON_LAYER='ch.swisstopo.swissboundaries3d-kanton-flaeche.fill';
export const CANTONS=Object.freeze([
 ['AG','Aargau'],['AI','Appenzell Innerrhoden'],['AR','Appenzell Ausserrhoden'],
 ['BE','Bern'],['BL','Basel-Landschaft'],['BS','Basel-Stadt'],['FR','Freiburg'],
 ['GE','Genf'],['GL','Glarus'],['GR','Graubünden'],['JU','Jura'],['LU','Luzern'],
 ['NE','Neuenburg'],['NW','Nidwalden'],['OW','Obwalden'],['SG','St. Gallen'],
 ['SH','Schaffhausen'],['SO','Solothurn'],['SZ','Schwyz'],['TG','Thurgau'],
 ['TI','Tessin'],['UR','Uri'],['VD','Waadt'],['VS','Wallis'],['ZG','Zug'],['ZH','Zürich']]);
export function normalizeGeometry(g){
  if(!g||!['Polygon','MultiPolygon'].includes(g.type))throw new Error('Grenzdaten sind keine Polygongeometrie.');
  const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  if(!Array.isArray(polys)||!polys.length)throw new Error('Leere Grenzgeometrie.');
  const coordinates=polys.map(poly=>poly.map(ring=>ring.map(p=>[+p[0],+p[1]])));
  let minE=Infinity,minN=Infinity,maxE=-Infinity,maxN=-Infinity,points=0;
  for(const poly of coordinates)for(const ring of poly)for(const p of ring){
    if(!Number.isFinite(p[0])||!Number.isFinite(p[1])||p[0]<1800000||p[0]>3300000||p[1]<700000||p[1]>1700000)
      throw new Error('Grenzgeometrie nicht in LV95 / EPSG:2056.');
    minE=Math.min(minE,p[0]);maxE=Math.max(maxE,p[0]);minN=Math.min(minN,p[1]);maxN=Math.max(maxN,p[1]);points++;
  }
  if(points<4||!Number.isFinite(minE))throw new Error('Grenzgeometrie unvollständig.');
  return {type:'MultiPolygon',coordinates,bounds:{minE,minN,maxE,maxN},points};
}
export async function searchRegions(term,kind='gemeinde',signal){
  const orig=kind==='kanton'?'kantone':'gg25';
  const u='https://api3.geo.admin.ch/rest/services/ech/SearchServer?type=locations&sr=2056&origins='+orig+'&limit=30&searchText='+encodeURIComponent(term);
  const r=await fetch(u,{signal});if(!r.ok)throw new Error('Gebietssuche HTTP '+r.status);
  const data=await r.json();
  return (data.results||[]).filter(x=>x.attrs?.featureId&&x.attrs?.layerBodId===(kind==='kanton'?CANTON_LAYER:MUNICIPAL_LAYER))
    .map(x=>({id:String(x.attrs.featureId),name:String(x.attrs.label||x.attrs.detail||term).replace(/<[^>]+>/g,''),origin:orig}));
}
export async function getRegionGeometry(id,kind='gemeinde',signal){
  const layer=kind==='kanton'?CANTON_LAYER:MUNICIPAL_LAYER;
  const u=`https://api3.geo.admin.ch/rest/services/ech/MapServer/${layer}/${encodeURIComponent(id)}?sr=2056&geometryFormat=geojson&returnGeometry=true`;
  const r=await fetch(u,{signal});if(!r.ok)throw new Error('Grenzabruf HTTP '+r.status);
  const j=await r.json();const feature=j.feature||j.features?.[0]||j;
  return normalizeGeometry(feature.geometry);
}
export function applyGeometryPath(ctx,geom,transform){
  // evenodd fill rule keeps internal holes (e.g. lakes / enclaves) correctly unselected.
  ctx.beginPath();
  for(const poly of geom.coordinates)for(const ring of poly){
    for(let i=0;i<ring.length;i++){
      const [x,y]=transform(ring[i][0],ring[i][1]);
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }ctx.closePath();
  }
}
export function fitRegion(geom,innerW,innerH,pad=1.12){
  const b=geom.bounds;
  return {e:(b.minE+b.maxE)/2,n:(b.minN+b.maxN)/2,
    scale:Math.max(100,Math.min(2500000,Math.ceil(Math.max((b.maxE-b.minE)*1000/innerW,(b.maxN-b.minN)*1000/innerH)*pad/100)*100))};
}
