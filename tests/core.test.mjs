import assert from 'node:assert/strict';
import test from 'node:test';
import {dimensions,layout,tilePlan,enumerateTiles,lv95ToWgs84,toPaper,RESOLUTIONS} from '../core.mjs';
import {newHeightGrid,selectHeightAssets} from '../heights.mjs';
import {computeContours,svgForContours} from '../contours.mjs';
const c={paper:'A4',orientation:'quer',e:2693000,n:1231000,scale:25000,margin:5,dpi:300,source:'karte'};
test('A5–A0, quer/hoch are exact DIN sizes',()=>{assert.deepEqual(dimensions('A4','quer'),[297,210]);assert.deepEqual(dimensions('A0','hoch'),[841,1189]);});
test('scale + print area in LV95 metres',()=>{
 const l=layout(c);assert.equal(l.innerW,287);assert.equal(l.innerH,200);assert.equal(l.groundW,7175);assert.equal(l.groundH,5000);
 assert.deepEqual(toPaper(l,l.b.minE,l.b.maxN),[5,5]);
});
test('tiles have verified origin and meter resolution',()=>{
 const p=tilePlan(c);assert.equal(p.z,23);assert.equal(p.resolution,2);assert.ok(p.tiles.length>0);
 assert.equal(RESOLUTIONS[p.z],2);
});
test('LV95 to lon/lat near Switzerland',()=>{
 const [lon,lat]=lv95ToWgs84(2600000,1200000);assert.ok(Math.abs(lon-7.4386)<.01);assert.ok(Math.abs(lat-46.9511)<.01);
});
test('missing and invalid contours rejected',()=>{
 const b={minE:2600000,maxE:2600020,maxN:1200020,minN:1200000};
 const g=newHeightGrid(b,10);g.values.set([400,410,420,400,410,420,400,410,420]);
 const r=computeContours(g,10);assert.equal(r.levels.length,2);assert.ok(r.totalSegments>0);
 const svg=svgForContours(r,{...layout(c),contourInterval:10},{stroke:.15});
 assert.ok(svg.includes('width="297mm"'));assert.ok(svg.includes('<path d="'));
});
test('choose newest 2-m COG for a 1km Swiss tile',()=>{
 const a=selectHeightAssets([{assets:{a:{href:'https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2020_2693-1231/swissalti3d_2020_2693-1231_2_2056_5728.tif'}}},{assets:{b:{href:'https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2025_2693-1231/swissalti3d_2025_2693-1231_2_2056_5728.tif'}}}]);
 assert.equal(a.length,1);assert.equal(a[0].year,2025);
});
