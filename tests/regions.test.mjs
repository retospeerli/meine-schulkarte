import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUNICIPAL_LAYER, WATER_LAYER, LAKE_AREA_LAYER,
  parseSearchRegionResults,parseFindRegionResults,
  searchRegions,getRegionGeometry,normalizeGeometry,
  getAdjacentLakeGeometry, mergeGeometries, geometriesTouchOrOverlap, geometryArea, geometryContainsPoint, highlightParts
} from '../regions.mjs';

const response=data=>({ok:true,status:200,json:async()=>data});
const originalFetch=globalThis.fetch;
function fakeFetch(handler){globalThis.fetch=async (url)=>handler(new URL(url));}
function restore(){globalThis.fetch=originalFetch;}
const searchSample={results:[{
  id:1777,attrs:{origin:'gg25',featureId:'258-2026',label:'<b>Wädenswil (ZH)</b>'}
}]};

test('Wädenswil: gültige API-Gemeinde ohne optionales layerBodId wird gefunden',()=>{
  assert.deepEqual(parseSearchRegionResults(searchSample),[{id:'258-2026',name:'Wädenswil (ZH)',origin:'gg25'}]);
});
test('Suche ignoriert fremde origins oder layer und interne SearchServer IDs',()=>{
  const data={results:[
    {id:5,attrs:{origin:'zipcode',featureId:'55',label:'Wädenswil 8820'}},
    {id:9,attrs:{origin:'gg25',label:'Wädenswil'}},
    {id:10,attrs:{origin:'gg25',layerBodId:'fremd',featureId:'9',label:'Wädenswil'}},
    {id:11,attrs:{origin:'gg25',layerBodId:MUNICIPAL_LAYER,featureId:'99',label:'Wädenswil'}}
  ]};
  assert.deepEqual(parseSearchRegionResults(data),[{id:'99',name:'Wädenswil',origin:'gg25'}]);
});
test('Fallback map/find: Wädenswil nur aktuell, nie historische Grenzversion',()=>{
 const data={results:[
   {featureId:'4711-1850',layerBodId:MUNICIPAL_LAYER,attributes:{gemname:'Wädenswil',jahr:1850,is_current_jahr:false}},
   {featureId:'4711-2026',layerBodId:MUNICIPAL_LAYER,attributes:{gemname:'Wädenswil',jahr:2026,is_current_jahr:true,objektart_lookup:'politische_gemeinde'}}
 ]};
 assert.deepEqual(parseFindRegionResults(data,'gemeinde','Wädenswil'),[{id:'4711-2026',name:'Wädenswil',origin:'gg25'}]);
});
test('Wädenswil: Such-Endpunkt liefert Treffer, keine unnötige Fallback-Abfrage',async()=>{
 let calls=[];
 fakeFetch(u=>{calls.push(u);return response(searchSample);});
 try{
  const r=await searchRegions('Wädenswil');
  assert.equal(r[0].name,'Wädenswil (ZH)');
  assert.equal(calls.length,1);
  assert.equal(calls[0].searchParams.get('origins'),'gg25');
  assert.equal(calls[0].searchParams.get('searchText'),'Wädenswil');
 }finally{restore();}
});
test('Wädenswil: Ersatzsuche per MapServer/find falls die erste Antwort keine Feature-ID hat',async()=>{
 const calls=[];
 fakeFetch(u=>{
  calls.push(u);
  if(u.pathname.endsWith('SearchServer'))return response({results:[{attrs:{origin:'gg25',label:'Wädenswil'}}]});
  if(u.pathname.endsWith('MapServer/find'))return response({results:[{featureId:'258-2026',attributes:{gemname:'Wädenswil',is_current_jahr:true}}]});
  throw new Error('Unexpected endpoint');
 });
 try{
  const records=await searchRegions('Wädenswil');
  assert.deepEqual(records,[{id:'258-2026',name:'Wädenswil',origin:'gg25'}]);
  assert.equal(calls.length,2);
  assert.equal(calls[1].searchParams.get('searchField'),'gemname');
  assert.equal(calls[1].searchParams.get('layer'),MUNICIPAL_LAYER);
 }finally{restore();}
});
test('Wädenswil: direkter GeoJSON Grenzabruf in LV95',async()=>{
 const polygon={type:'Polygon',coordinates:[[[2693000,1231000],[2693100,1231000],[2693100,1231100],[2693000,1231000]]]};
 fakeFetch(u=>{
  assert.equal(u.searchParams.get('sr'),'2056');
  assert.equal(u.searchParams.get('geometryFormat'),'geojson');
  assert.ok(u.pathname.includes('258-2026'));
  return response({feature:{type:'Feature',geometry:polygon}});
 });
 try{
  const g=await getRegionGeometry('258-2026');
  assert.equal(g.points,4);
  assert.deepEqual(g.bounds,{minE:2693000,minN:1231000,maxE:2693100,maxN:1231100});
 }finally{restore();}
});

const rect=(minE,minN,maxE,maxN)=>({type:'Polygon',coordinates:[[[minE,minN],[maxE,minN],[maxE,maxN],[minE,maxN],[minE,minN]]]});
test('Wädenswil: Zürichsee UND Hüttnersee aus echten SeeFLÄCHEN, Uferlinie und Fluss nicht',async()=>{
  const municipality=normalizeGeometry(rect(2690000,1226000,2694000,1231000));
  const zürichsee=rect(2689500,1230000,2691500,1233000);
  const hüttnersee=rect(2693500,1226200,2694350,1226650);
  const river=rect(2692000,1227000,2692100,1229100);
  const callLayers=[];
  fakeFetch(u=>{
    assert.ok(u.pathname.endsWith('MapServer/identify'));
    assert.equal(u.searchParams.get('limit'),'200');
    assert.equal(u.searchParams.get('geometryFormat'),'geojson');
    const layer=u.searchParams.get('layers').replace('all:','');
    callLayers.push(layer);
    if(layer===LAKE_AREA_LAYER)return response({results:[
      {layerBodId:layer,properties:{name:'Zürichsee'},geometry:zürichsee},
      {layerBodId:layer,properties:{name:'Hüttnersee'},geometry:hüttnersee}
    ]});
    if(layer===WATER_LAYER)return response({results:[
      {layerBodId:layer,properties:{name:'Hüttnersee',objektart:'Seeufer'},geometry:{type:'LineString',coordinates:[[2693500,1226200],[2694350,1226200],[2694350,1226650]]}},
      {layerBodId:layer,properties:{name:'Aabach',objektart:'Fliessgewässer'},geometry:river}
    ]});
    throw Error('Unexpected layer');
  });
  try{
    const extra=await getAdjacentLakeGeometry(municipality);
    assert.ok(callLayers.includes(LAKE_AREA_LAYER));
    assert.ok(callLayers.includes(WATER_LAYER));
    assert.deepEqual(new Set(extra.lakes),new Set(['Zürichsee','Hüttnersee']));
    assert.equal(extra.geometries.length,2);
    const region={geometry:municipality,lakeGeometries:extra.geometries};
    const parts=highlightParts(region);
    assert.equal(parts.length,3); // THREE independent clipping passes, not XOR
    // Hüttnersee on the OUTER SIDE of municipal boundary must still be highlighted.
    const hPoint=[2694250,1226400];
    assert.equal(geometryContainsPoint(municipality,hPoint),false);
    assert.equal(parts.some(g=>geometryContainsPoint(g,hPoint)),true);
    // River is never selected just because it is large.
    assert.equal(extra.lakes.includes('Aabach'),false);
  }finally{restore();}
});
test('See darf bei Geometrieabweichung bis 35m ans Gemeindeufer grenzen',()=>{
 const municipality=normalizeGeometry(rect(2693000,1226000,2694000,1227000));
 const lake=normalizeGeometry(rect(2694020,1226200,2694500,1226600));
 assert.equal(geometriesTouchOrOverlap(municipality,lake,0),false);
 assert.equal(geometriesTouchOrOverlap(municipality,lake,35),true);
});
test('Auch nach Begrenzung mit 200 Treffern wird eine weitere API-Seite geladen',async()=>{
 const municipality=normalizeGeometry(rect(2693000,1226000,2694000,1227000));
 const h=rect(2693500,1226200,2694200,1226600);
 const calls=[];
 fakeFetch(u=>{
  const layer=u.searchParams.get('layers').replace('all:','');
  const offset=Number(u.searchParams.get('offset'));
  calls.push([layer,offset]);
  if(layer===LAKE_AREA_LAYER&&offset===0)return response({results:Array.from({length:200},(_,i)=>({
    layerBodId:layer,featureId:i,properties:{name:'Fernsee'},geometry:rect(2680000+i*2,1210000,2680010+i*2,1210010)
  }))});
  if(layer===LAKE_AREA_LAYER&&offset===200)return response({results:[{
    layerBodId:layer,featureId:201,properties:{name:'Hüttnersee'},geometry:h
  }]});
  return response({results:[]});
 });
 try{
  const result=await getAdjacentLakeGeometry(municipality);
  assert.ok(calls.some(([layer,offset])=>layer===LAKE_AREA_LAYER&&offset===200));
  assert.ok(result.lakes.includes('Hüttnersee'));
 }finally{restore();}
});
