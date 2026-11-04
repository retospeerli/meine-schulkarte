/** Amtliche swissBOUNDARIES3D-Gebietsabfrage (LV95 / EPSG:2056).
 * Der SearchServer liefert je nach Treffer nicht sämtliche optionalen Attribute.
 * Deshalb darf layerBodId NICHT zwingend verlangt werden. */
export const MUNICIPAL_LAYER='ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill';
export const CANTON_LAYER='ch.swisstopo.swissboundaries3d-kanton-flaeche.fill';
export const CANTONS=Object.freeze([
 ['AG','Aargau'],['AI','Appenzell Innerrhoden'],['AR','Appenzell Ausserrhoden'],
 ['BE','Bern'],['BL','Basel-Landschaft'],['BS','Basel-Stadt'],['FR','Freiburg'],
 ['GE','Genf'],['GL','Glarus'],['GR','Graubünden'],['JU','Jura'],['LU','Luzern'],
 ['NE','Neuenburg'],['NW','Nidwalden'],['OW','Obwalden'],['SG','St. Gallen'],
 ['SH','Schaffhausen'],['SO','Solothurn'],['SZ','Schwyz'],['TG','Thurgau'],
 ['TI','Tessin'],['UR','Uri'],['VD','Waadt'],['VS','Wallis'],['ZG','Zug'],['ZH','Zürich']]);
const API='https://api3.geo.admin.ch/rest/services/ech/';
const layerFor=kind=>kind==='kanton'?CANTON_LAYER:MUNICIPAL_LAYER;
const originFor=kind=>kind==='kanton'?'kantone':'gg25';
const clean=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const key=s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de-CH');
function isCurrent(v){return v===true||v===1||v==='true'||v==='1';}
function isOld(v){return v===false||v===0||v==='false'||v==='0';}

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

/** Normalisiert die echten SearchServer-Felder. layerBodId und featureId sind optional. */
export function parseSearchRegionResults(data,kind='gemeinde'){
  const origin=originFor(kind),layer=layerFor(kind);
  const items=Array.isArray(data?.results)?data.results:[];
  return items.flatMap(hit=>{
    const a=hit.attrs||hit.properties||{};
    if(a.origin && a.origin!==origin)return [];
    if(a.layerBodId && a.layerBodId!==layer)return [];
    // SearchServer.id ist eine interne Treffer-ID, *keine* Feature-ID.
    const id=a.featureId??a.feature_id??hit.featureId;
    if(id==null||String(id).trim()==='')return [];
    const name=clean(a.label||a.name||hit.label||a.detail);
    if(!name)return [];
    return [{id:String(id),name,origin}];
  });
}

/** Fallback: sucht direkt in der Gemeindeflächen-Ebene nach gemname.
 * Filtert historische Versionen, sofern der Dienst die Jahresmerkmale liefert. */
export function parseFindRegionResults(data,kind='gemeinde',term=''){
  const layer=layerFor(kind),all=[];
  for(const hit of data?.results||[]){
    if(hit.layerBodId && hit.layerBodId!==layer)continue;
    const a=hit.attributes||hit.properties||{};
    if(kind==='gemeinde'&&a.objektart_lookup&&a.objektart_lookup!=='politische_gemeinde')continue;
    const id=hit.featureId??hit.feature_id;
    const name=clean(a.gemname||a.name||a.label||hit.label);
    if(id==null||!name)continue;
    const current=a.is_current_jahr,year=Number(a.jahr)||0;
    all.push({id:String(id),name,origin:originFor(kind),current,year});
  }
  // Falls vorhanden nur derzeit gültige Gemeinden, nicht historische Grenzen.
  const present=all.some(x=>isCurrent(x.current));
  const items=present?all.filter(x=>isCurrent(x.current)):all.filter(x=>!isOld(x.current));
  // Wenn keine historische Information verfügbar ist, neueste Version pro Name.
  const valid=items.length?items:all;
  const byName=new Map();
  for(const x of valid){
    const k=key(x.name),old=byName.get(k);
    if(!old||x.year>old.year)byName.set(k,x);
  }
  return [...byName.values()].sort((a,b)=>{
    const exactA=key(a.name)===key(term),exactB=key(b.name)===key(term);
    return Number(exactB)-Number(exactA)||a.name.localeCompare(b.name,'de-CH');
  }).map(({id,name,origin})=>({id,name,origin}));
}
async function jsonRequest(url,signal){
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error(`swisstopo-API HTTP ${response.status}`);
  return response.json();
}
export async function searchRegions(term,kind='gemeinde',signal){
  const q=clean(term);if(!q)return [];
  const params=new URLSearchParams({type:'locations',sr:'2056',origins:originFor(kind),limit:'50',searchText:q});
  let firstError=null;
  try{
    const data=await jsonRequest(`${API}SearchServer?${params}`,signal);
    const matches=parseSearchRegionResults(data,kind);
    if(matches.length)return matches;
  }catch(e){if(signal?.aborted)throw e;firstError=e;}
  // Zweiter offizieller API-Weg, wenn die Ortssuche keine verwertbare featureId liefert.
  // Die politische Gemeinde Wädenswil wird über das Attribut gemname gesucht.
  const f=new URLSearchParams({layer:layerFor(kind),searchText:q,
    searchField:kind==='gemeinde'?'gemname':'name',contains:'true',returnGeometry:'false',sr:'2056'});
  try{
    const data=await jsonRequest(`${API}MapServer/find?${f}`,signal);
    return parseFindRegionResults(data,kind,q);
  }catch(e){if(signal?.aborted)throw e;
    throw new Error(`Gebietssuche nicht möglich (${firstError?.message||'Ortssuche ohne Treffer'}; Ersatzsuche: ${e.message}).`);
  }
}
export async function getRegionGeometry(id,kind='gemeinde',signal){
  const layer=layerFor(kind);
  const u=`${API}MapServer/${layer}/${encodeURIComponent(id)}?sr=2056&geometryFormat=geojson&returnGeometry=true`;
  const data=await jsonRequest(u,signal);
  const feature=data.feature||data.features?.[0]||data;
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
