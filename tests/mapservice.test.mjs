import test from 'node:test';
import assert from 'node:assert/strict';
import {layout} from '../core.mjs';
import {cartographyForScale,OFFICIAL_MAP_SERIES} from '../cartography.mjs';
import {wmsGetMapUrl,printedBlockBounds} from '../mapservice.mjs';

const base={source:'karte',paper:'A0',orientation:'hoch',margin:5,scale:10000,dpi:508,e:2693000,n:1231000};
test('A0 hoch 1:10k, correct extent and swisstopo WMS 2056, no WMTS zoom 19',()=>{
  const l=layout(base),style=cartographyForScale(l.scale);
  assert.equal(l.groundW,8310);assert.equal(l.groundH,11790);
  assert.equal(style.wmts,'ch.swisstopo.landeskarte-farbe-10');
  const u=new URL(wmsGetMapUrl(style.wmts,l.b,900,1277));
  assert.equal(u.hostname,'wms.geo.admin.ch');
  assert.equal(u.searchParams.get('SERVICE'),'WMS');
  assert.equal(u.searchParams.get('REQUEST'),'GetMap');
  assert.equal(u.searchParams.get('CRS'),'EPSG:2056');
  assert.equal(u.searchParams.get('LAYERS'),'ch.swisstopo.landeskarte-farbe-10');
  assert.equal(u.searchParams.get('BBOX'),[l.b.minE,l.b.minN,l.b.maxE,l.b.maxN].join(','));
  assert.ok(!u.pathname.includes('/19/'));
});
test('all official map scales select their explicit layer for WMS',()=>{
  for(const source of OFFICIAL_MAP_SERIES){
    const item=cartographyForScale(source.scale);
    const u=new URL(wmsGetMapUrl(item.wmts,{minE:2690000,minN:1230000,maxE:2700000,maxN:1240000},1024,1024));
    assert.equal(u.searchParams.get('LAYERS'),item.wmts);
  }
});
test('print blocks partition map without seam or extent inflation',()=>{
  const l=layout(base),total={width:16620,height:23580};
  const left=printedBlockBounds(l,total,0,0,1024,1024);
  const right=printedBlockBounds(l,total,1024,0,1024,1024);
  assert.equal(left.maxE,right.minE);
  const bottom=printedBlockBounds(l,total,0,total.height-512,1024,512);
  assert.equal(bottom.minN,l.b.minN);
  assert.equal(left.maxN,l.b.maxN);
});
test('WMS rejects impossible dimensions and invalid coordinates',()=>{
  const bounds={minE:1,minN:2,maxE:3,maxN:4};
  assert.throws(()=>wmsGetMapUrl('ch.swisstopo.landeskarte-farbe-10',bounds,10000,300));
  assert.throws(()=>wmsGetMapUrl('ch.swisstopo.landeskarte-farbe-10',{...bounds,maxE:1},1200,300));
});
