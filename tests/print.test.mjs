import test from 'node:test';import assert from 'node:assert/strict';
import {layout} from '../core.mjs';
import {choosePrintProduct,expectedNativeDpi,printPixels,selectPrintAssets,verifyTileCoverage} from '../printdata.mjs';
import {normalizeGeometry,fitRegion} from '../regions.mjs';

const base={paper:'A4',orientation:'quer',margin:5,dpi:508,scale:25000,e:2693000,n:1231000};
test('508 dpi A4 has 20 pixels/mm of inner map, exact 1:25k',()=>{
 const l=layout(base),px=printPixels(l);
 assert.equal(px.width,5740);assert.equal(px.height,4000);
 assert.equal(l.groundW,7175);assert.equal(l.groundH,5000);
 assert.equal(expectedNativeDpi(25000,1.25),508);
 assert.equal(px.blocks,12*8);
});
test('source picks the largest map scale not coarser than output',()=>{
 assert.equal(choosePrintProduct(15000).scale,10000);
 assert.equal(choosePrintProduct(25000).scale,25000);
 assert.equal(choosePrintProduct(40000).scale,25000);
 assert.equal(choosePrintProduct(250000).scale,200000);
 assert.equal(choosePrintProduct(1000000).scale,500000);
 assert.equal(choosePrintProduct(25000,'luftbild').expectedGsd,.1);
});
test('STAC only original KREL TIFF, never grey or JPEG preview',()=>{
 const prefix='https://data.geo.admin.ch/ch.swisstopo.pixelkarte-farbe-pk25.noscale/';
 const f=[{id:'a',assets:{a:{href:prefix+'smr25_2025_1112_2056_krel_1.25.tif'},b:{href:prefix+'smr25_2025_1112_2056_kgrs_1.25.tif'},c:{href:prefix+'smr25_2025_1112_2056_krel_1.25.jpg'}}}];
 const a=selectPrintAssets(f,{mode:'karte',collection:'ch.swisstopo.pixelkarte-farbe-pk25.noscale'});
 assert.equal(a.length,1);assert.match(a[0].href,/_krel_/);
});
test('official hyphenated SMR filenames: prefer latest edition per map sheet',()=>{
 const root='https://data.geo.admin.ch/ch.swisstopo.pixelkarte-farbe-pk50.noscale/';
 const f=[
  {id:'smr50-263-2016',assets:{a:{href:root+'smr50-263-2016-2056-krel-2.5.tiff'},b:{href:root+'smr50-263-2016-2056-kgrs-2.5.tiff'}}},
  {id:'smr50-263-2025',assets:{a:{href:root+'smr50-263-2025-2056-krel-2.5.tiff'}}},
  {id:'smr50-264-2022',assets:{a:{href:root+'smr50-264-2022-2056-krel-2.5.tiff'}}}
 ];
 const a=selectPrintAssets(f,{mode:'karte'});
 assert.equal(a.length,2);assert.ok(a.some(v=>v.href.includes('263-2025')));
 assert.ok(!a.some(v=>v.href.includes('263-2016')));
 assert.equal(a.find(v=>v.href.includes('263-2025')).gsd,2.5);
});
test('SWISSIMAGE selects original 10cm asset rather than 2m',()=>{
 const f=[{id:'x',assets:{a:{href:'https://data.geo.admin.ch/swissimage_2025_2693-1231_2_2056_5728.tif'},b:{href:'https://data.geo.admin.ch/swissimage_2025_2693-1231_0.1_2056_5728.tif'}}}];
 const assets=selectPrintAssets(f,{mode:'luftbild'});
 assert.equal(assets.length,1);assert.equal(assets[0].gsd,.1);
});
test('multi-polygon and holes, LV95 geometry bounds preserved',()=>{
 const e=2693000,n=1231000;
 const geometry=normalizeGeometry({type:'Polygon',coordinates:[
 [[e,n],[e+1000,n],[e+1000,n+800],[e,n+800],[e,n]],
 [[e+100,n+100],[e+120,n+100],[e+120,n+120],[e+100,n+100]]
 ]});
 assert.equal(geometry.points,9);assert.equal(geometry.coordinates[0].length,2);
 assert.deepEqual(geometry.bounds,{minE:e,maxE:e+1000,minN:n,maxN:n+800});
 const f=fitRegion(geometry,287,200);
 assert.equal(f.e,e+500);assert.equal(f.n,n+400);assert.ok(f.scale>4000);
 assert.throws(()=>normalizeGeometry({type:'Polygon',coordinates:[[[8.5,47.4],[8,47.1],[8.5,47.4]]]}),/LV95/);
});
test('source bbox gaps are detected',()=>{
 const b={minE:0,maxE:100,minN:0,maxN:50};
 assert.equal(verifyTileCoverage(b,[[0,0,49,50],[49,0,100,50]]),true);
 assert.equal(verifyTileCoverage(b,[[0,0,49,50],[51,0,100,50]]),false);
});
