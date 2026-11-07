import test from 'node:test';
import assert from 'node:assert/strict';
import {cartographyForScale,cartographyDescription,OFFICIAL_MAP_SERIES} from '../cartography.mjs';
import {tileUrl,tilePlan} from '../core.mjs';
import {choosePrintProduct} from '../printdata.mjs';

const cfg={paper:'A4',orientation:'quer',e:2693000,n:1231000,scale:25000,margin:5,dpi:508,source:'karte'};
test('alle sieben offiziellen Druckmassstäbe verwenden dieselbe Serie in WMTS und GeoTIFF',()=>{
 for(const style of OFFICIAL_MAP_SERIES){
  const chosen=cartographyForScale(style.scale);
  assert.equal(chosen.exact,true);
  assert.equal(chosen.collection,style.collection);
  assert.equal(chosen.wmts,style.wmts);
  const p=choosePrintProduct(style.scale,'karte');
  const plan=tilePlan({...cfg,scale:style.scale});
  assert.equal(p.collection,style.collection);
  assert.equal(plan.style.wmts,style.wmts);
  assert.ok(tileUrl('karte',18,3,4,style.scale).includes(style.wmts));
  assert.ok(tileUrl('grau',18,3,4,style.scale).includes(style.wmts));
 }
});
test('1:25k und 1:50k sind keine skalierten Varianten derselben Quelle',()=>{
 assert.notEqual(tileUrl('karte',18,10,12,25000),tileUrl('karte',18,10,12,50000));
 assert.match(tileUrl('karte',18,10,12,25000),/pk25\.noscale/);
 assert.match(tileUrl('karte',18,10,12,50000),/pk50\.noscale/);
});
test('benutzerdefinierter Druckmassstab 1:40k bleibt exakt und meldet LK50 als vergrösserte Vorlage',()=>{
 const style=cartographyForScale(40000);
 const plan=tilePlan({...cfg,scale:40000});
 assert.equal(style.scale,50000);
 assert.equal(style.enlargement,1.25);
 assert.equal(plan.groundW,11480);
 assert.match(cartographyDescription(style),/125 %/);
});
test('unter 1:10k und über 1:1 Mio keine irreführende Landeskarte, aber Luftbild bleibt möglich',()=>{
 assert.throws(()=>cartographyForScale(5000),/1:10/);
 assert.throws(()=>choosePrintProduct(2000000),/1:10/);
 assert.ok(tilePlan({...cfg,source:'luftbild',scale:5000}).tiles.length>0);
 assert.equal(choosePrintProduct(5000,'luftbild').scale,null);
});
test('Grau-Version verwendet denselben festen Kartenstil; Luftbild weiterhin eigene Quelle',()=>{
 assert.equal(tileUrl('grau',18,20,22,100000),tileUrl('karte',18,20,22,100000));
 assert.match(tileUrl('luftbild',18,20,22,25000),/swissimage/);
});
