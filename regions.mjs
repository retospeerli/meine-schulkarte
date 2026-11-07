/** Amtliche swissBOUNDARIES3D-Gebietsabfrage (LV95 / EPSG:2056).
 * Der SearchServer liefert je nach Treffer nicht sämtliche optionalen Attribute.
 * Deshalb darf layerBodId NICHT zwingend verlangt werden. */
export const MUNICIPAL_LAYER='ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill';
export const CANTON_LAYER='ch.swisstopo.swissboundaries3d-kanton-flaeche.fill';
export const WATER_LAYER='ch.swisstopo.swisstlm3d-gewaessernetz';
// The federal BAFU lake layer provides actual *areas*, unlike many
// swissTLM3D Gewaessernetz features, which are lake shore *lines*.
export const LAKE_AREA_LAYER='ch.bafu.vec25-seen';
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
const LAKE_MIN_AREA_M2=50000;
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
function geometryFromFeatureLike(hit){
  return hit?.geometry||hit?.feature?.geometry||hit?.feature?.features?.[0]?.geometry||hit?.features?.[0]?.geometry||null;
}
function attrsFromFeatureLike(hit){return hit?.attributes||hit?.attrs||hit?.properties||hit?.feature?.properties||{};}
function boundsIntersect(a,b){return a.minE<=b.maxE&&a.maxE>=b.minE&&a.minN<=b.maxN&&a.maxN>=b.minN;}
function closeLoop(ring){
  if(!ring?.length)return [];
  const out=ring.map(p=>[+p[0],+p[1]]);
  const a=out[0],b=out[out.length-1];
  if(a[0]!==b[0]||a[1]!==b[1])out.push([a[0],a[1]]);
  return out;
}
function pointOnSegment(p,a,b,eps=1e-9){
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const len2=dx*dx+dy*dy;
  // A closed polygon contains a duplicate first/last vertex: the degenerate
  // segment must NOT report every point on Earth as being on its boundary.
  if(len2<=eps*eps)return (p[0]-a[0])**2+(p[1]-a[1])**2<=eps*eps;
  const cross=dx*(p[1]-a[1])-dy*(p[0]-a[0]);
  if(Math.abs(cross)>eps*Math.sqrt(len2))return false;
  const dot=(p[0]-a[0])*dx+(p[1]-a[1])*dy;
  return dot>=-eps&&dot<=len2+eps;
}
function orient(a,b,c){return Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));}
function segmentsIntersect(a,b,c,d){
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  if(o1===0&&pointOnSegment(c,a,b))return true;
  if(o2===0&&pointOnSegment(d,a,b))return true;
  if(o3===0&&pointOnSegment(a,c,d))return true;
  if(o4===0&&pointOnSegment(b,c,d))return true;
  return o1!==o2&&o3!==o4;
}
function pointInRing(point,ring){
  const pts=closeLoop(ring); if(pts.length<4)return false;
  let inside=false;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1];
    if(pointOnSegment(point,a,b))return true;
    const intersect=((a[1]>point[1])!==(b[1]>point[1])) &&
      (point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1]||Number.EPSILON)+a[0]);
    if(intersect)inside=!inside;
  }
  return inside;
}
export function geometryContainsPoint(geom,point){
  for(const poly of geom.coordinates){
    if(!pointInRing(point,poly[0]))continue;
    let inHole=false;
    for(let i=1;i<poly.length;i++)if(pointInRing(point,poly[i])){inHole=true;break;}
    if(!inHole)return true;
  }
  return false;
}
function polygonArea(poly){
  const ringArea=ring=>{
    const pts=closeLoop(ring); let s=0;
    for(let i=0;i<pts.length-1;i++)s+=pts[i][0]*pts[i+1][1]-pts[i+1][0]*pts[i][1];
    return Math.abs(s)/2;
  };
  let area=ringArea(poly[0]);
  for(let i=1;i<poly.length;i++)area-=ringArea(poly[i]);
  return Math.max(0,area);
}
export function geometryArea(geom){return geom.coordinates.reduce((sum,poly)=>sum+polygonArea(poly),0);}
/** Tests overlap or shoreline adjacency. At a municipal water boundary,
 * independently surveyed datasets can differ by some metres. */
function distPointSegment2(p,u,v){
  const dx=v[0]-u[0],dy=v[1]-u[1],ll=dx*dx+dy*dy;
  const t=ll?Math.max(0,Math.min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dy)/ll)):0;
  const x=u[0]+t*dx,y=u[1]+t*dy;return (p[0]-x)**2+(p[1]-y)**2;
}
function geometrySegments(geom){
  const segments=[];
  for(const poly of geom.coordinates)for(const ring of poly){
    for(let i=0;i<ring.length-1;i++){
      const u=ring[i],v=ring[i+1];
      segments.push({u,v,minE:Math.min(u[0],v[0]),maxE:Math.max(u[0],v[0]),minN:Math.min(u[1],v[1]),maxN:Math.max(u[1],v[1])});
    }
  }
  return segments;
}
/** Overlap or near-contact, accelerated using a temporary segment grid. */
export function geometriesTouchOrOverlap(a,b,tolerance=0){
  const A=a.bounds,B=b.bounds,tol=Math.max(0,Number(tolerance)||0);
  if(A.maxE+tol<B.minE||B.maxE+tol<A.minE||A.maxN+tol<B.minN||B.maxN+tol<A.minN)return false;
  // Very common case: a lake lies partly or wholly within the municipality.
  for(const pa of a.coordinates)for(const r of pa)if(r.length&&geometryContainsPoint(b,r[0]))return true;
  for(const pb of b.coordinates)for(const r of pb)if(r.length&&geometryContainsPoint(a,r[0]))return true;
  const left=geometrySegments(a),right=geometrySegments(b);
  const cell=Math.max(100,Math.min(1000,Math.max(B.maxE-B.minE,B.maxN-B.minN)/40));
  const grid=new Map();
  const cells=seg=>{
    const xmin=Math.floor((seg.minE-tol)/cell),xmax=Math.floor((seg.maxE+tol)/cell);
    const ymin=Math.floor((seg.minN-tol)/cell),ymax=Math.floor((seg.maxN+tol)/cell);
    const result=[];
    for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++)result.push(`${x}:${y}`);
    return result;
  };
  right.forEach((seg,i)=>{
    for(const k of cells(seg)){
      if(!grid.has(k))grid.set(k,[]);
      grid.get(k).push(i);
    }
  });
  const tol2=tol*tol;
  for(const one of left){
    const visited=new Set();
    for(const k of cells(one))for(const i of grid.get(k)||[]){
      if(visited.has(i))continue;visited.add(i);
      const two=right[i];
      if(one.maxE+tol<two.minE||one.minE-tol>two.maxE||one.maxN+tol<two.minN||one.minN-tol>two.maxN)continue;
      if(segmentsIntersect(one.u,one.v,two.u,two.v))return true;
      if(tol && Math.min(
        distPointSegment2(one.u,two.u,two.v),distPointSegment2(one.v,two.u,two.v),
        distPointSegment2(two.u,one.u,one.v),distPointSegment2(two.v,one.u,one.v)
      )<=tol2)return true;
    }
  }
  return false;
}
function waterNameAndType(attrs,hit){
  const name=clean(attrs.name||attrs.label||attrs.objname||attrs.gewaessername||attrs.display_name||hit?.label);
  const type=clean([
    attrs.objektart,attrs.objektart_lookup,attrs.typ,attrs.type,attrs.class,
    attrs.class_name,attrs.naturart,attrs.kategorie,attrs.category,attrs.layerName
  ].filter(Boolean).join(' '));
  return {name,type};
}
function isLakeLike(attrs,geom,hit){
  const {name,type}=waterNameAndType(attrs,hit);
  const typeText=type.toLocaleLowerCase('de-CH');
  const nameText=name.toLocaleLowerCase('de-CH');
  // The object class is authoritative: a broad river polygon is not a lake.
  if(/fliess|fluss|bach|river|stream|kanal|suone/.test(typeText))return {ok:false,name};
  if(/stehend|seeufer|see|lake|lac|lago|weiher|teich/.test(typeText))return {ok:true,name};
  if(/(?:see|weiher|teich|laghetto|reservoir)$|\b(?:lac|lago|lake|bassin)\b/.test(nameText))return {ok:true,name};
  if(/(?:bach|fluss|kanal)$/.test(nameText))return {ok:false,name};
  return {ok:geometryArea(geom)>=LAKE_MIN_AREA_M2,name};
}
export function mergeGeometries(geometries=[]){
  const valid=geometries.filter(Boolean);if(!valid.length)throw new Error('Keine Geometrien zum Zusammenführen.');
  const coordinates=[];let minE=Infinity,minN=Infinity,maxE=-Infinity,maxN=-Infinity,points=0;
  for(const g of valid){
    coordinates.push(...g.coordinates);points+=g.points||0;
    minE=Math.min(minE,g.bounds.minE);minN=Math.min(minN,g.bounds.minN);
    maxE=Math.max(maxE,g.bounds.maxE);maxN=Math.max(maxN,g.bounds.maxN);
  }
  return {type:'MultiPolygon',coordinates,bounds:{minE,minN,maxE,maxN},points};
}

/** Each polygon source must be clipped separately. A concatenated MultiPolygon
 * with evenodd would XOR overlapping lake and municipality polygons. */
export function highlightParts(region){
  if(!region)return [];
  if(Array.isArray(region.lakeGeometries))return [region.geometry,...region.lakeGeometries].filter(Boolean);
  return [region.maskGeometry||region.geometry].filter(Boolean);
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
function toWaterPolygon(raw){
  if(!raw)return null;
  if(raw.type==='Polygon'||raw.type==='MultiPolygon')return normalizeGeometry(raw);
  // The official swissTLM3D hydro layer may yield a CLOSED shoreline as a line.
  // Convert only a truly closed perimeter; never guess across an open river line.
  const lines=raw.type==='LineString'?[raw.coordinates]:raw.type==='MultiLineString'?raw.coordinates:[];
  const polygons=[];
  for(const line of lines){
    if(!Array.isArray(line)||line.length<4)continue;
    const first=line[0],last=line[line.length-1];
    if(Math.hypot(first[0]-last[0],first[1]-last[1])>8)continue;
    const closed=line.map(p=>[p[0],p[1]]);
    closed[closed.length-1]=[first[0],first[1]];
    polygons.push([closed]);
  }
  return polygons.length?normalizeGeometry({type:'MultiPolygon',coordinates:polygons}):null;
}
export function parseWaterIdentifyResults(data,regionGeom,layer){
  const items=[];
  for(const hit of data?.results||[]){
    if(hit.layerBodId&&hit.layerBodId!==layer)continue;
    const rawGeom=geometryFromFeatureLike(hit);if(!rawGeom)continue;
    let geom;try{geom=toWaterPolygon(rawGeom);}catch{continue;}
    if(!geom)continue;
    const attrs=attrsFromFeatureLike(hit);
    if(layer===WATER_LAYER){
      const lake=isLakeLike(attrs,geom,hit);if(!lake.ok)continue;
    }
    // Area source is already restricted to standing lakes; keep small lakes too.
    if(!geometriesTouchOrOverlap(regionGeom,geom,35))continue;
    const name=waterNameAndType(attrs,hit).name;
    items.push({name,geometry:geom,area:geometryArea(geom),source:layer});
  }
  return items;
}
function bboxTiles(b,maxSide=6500){
  const pad=60,minE=b.minE-pad,maxE=b.maxE+pad,minN=b.minN-pad,maxN=b.maxN+pad;
  const nx=Math.ceil((maxE-minE)/maxSide),ny=Math.ceil((maxN-minN)/maxSide);
  if(nx*ny>60)throw new Error('Gemeinde zu gross für den Browser-Abruf der Seegeometrien.');
  const tiles=[];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)tiles.push({
    minE:minE+(maxE-minE)*x/nx,maxE:minE+(maxE-minE)*(x+1)/nx,
    minN:minN+(maxN-minN)*y/ny,maxN:minN+(maxN-minN)*(y+1)/ny
  });
  return tiles;
}
async function identifyWaterFeatures(layer,tile,signal){
  const params=new URLSearchParams({
    layers:`all:${layer}`,
    geometryType:'esriGeometryEnvelope',
    geometry:`${tile.minE},${tile.minN},${tile.maxE},${tile.maxN}`,
    mapExtent:`${tile.minE},${tile.minN},${tile.maxE},${tile.maxN}`,
    imageDisplay:'1200,1200,96',tolerance:'0',
    returnGeometry:'true',geometryFormat:'geojson',sr:'2056',limit:'200'
  });
  const results=[];
  for(let page=0;page<4;page++){
    if(signal?.aborted)throw new DOMException('Abgebrochen','AbortError');
    params.set('offset',String(page*200));
    const data=await jsonRequest(`${API}MapServer/identify?${params}`,signal);
    const batch=Array.isArray(data?.results)?data.results:[];
    results.push(...batch);
    if(batch.length<200)return results;
  }
  throw new Error('Mehr als 800 Gewässerobjekte im Teilgebiet; Abruf begrenzt.');
}
function boundsOverlap(a,b,tol=20){
  return a.maxE+tol>=b.minE&&b.maxE+tol>=a.minE&&a.maxN+tol>=b.minN&&b.maxN+tol>=a.minN;
}
function dedupeLakes(items){
  const result=[];
  // Prefer the more detailed, recent swissTLM polygon if it is available.
  for(const item of items.sort((a,b)=>Number(b.source===WATER_LAYER)-Number(a.source===WATER_LAYER))){
    if(result.some(old=>
      boundsOverlap(item.geometry.bounds,old.geometry.bounds)&&
      geometriesTouchOrOverlap(item.geometry,old.geometry)&&
      ((item.name&&old.name&&key(item.name)===key(old.name))||
       Math.abs(item.area-old.area)<Math.max(item.area,old.area)*.35)))continue;
    result.push(item);
  }
  return result;
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
/** Retrieve lake SURFACE polygons, not merely water/shoreline centrelines.
 * Split municipal bbox to avoid identify's 50-result default and use limit+offset.
 * Falls back to the other official layer when one service fails. */
export async function getAdjacentLakeGeometry(regionGeom,signal){
  const tiles=bboxTiles(regionGeom.bounds);
  const candidates=[],warnings=[];
  for(const layer of [LAKE_AREA_LAYER,WATER_LAYER]){
    let hadSuccess=false;
    // Sequential requests keep load bounded and behave better with public APIs.
    for(const tile of tiles){
      try{
        const hits=await identifyWaterFeatures(layer,tile,signal);
        hadSuccess=true;
        candidates.push(...parseWaterIdentifyResults({results:hits},regionGeom,layer));
      }catch(e){
        if(signal?.aborted)throw e;
        warnings.push(`${layer}: ${e.message}`);
      }
    }
    if(!hadSuccess)warnings.push(`${layer}: keine Antwort`);
  }
  const unique=dedupeLakes(candidates);
  if(!unique.length)return {geometry:null,geometries:[],lakes:[],warnings};
  return {
    geometry:mergeGeometries(unique.map(x=>x.geometry)),
    geometries:unique.map(x=>x.geometry),
    lakes:unique.map(x=>x.name).filter(Boolean),
    warnings
  };
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
