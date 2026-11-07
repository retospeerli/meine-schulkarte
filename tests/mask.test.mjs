import test from 'node:test';
import assert from 'node:assert/strict';
import {colourizeBlock} from '../rasterexport.mjs';
import {normalizeGeometry} from '../regions.mjs';

const rect=(x,y,X,Y)=>normalizeGeometry({type:'Polygon',coordinates:[[[x,y],[X,y],[X,Y],[x,Y],[x,y]]]});

test('Originaldruck: Gemeinde und überlappender Hüttnersee erhalten ZWEI getrennte Clip-Durchgänge',()=>{
  const saved=globalThis.document;
  const commands=[];
  const ctx=new Proxy({
    beginPath:()=>commands.push('beginPath'),
    moveTo:()=>{},lineTo:()=>{},closePath:()=>{},
    clip:rule=>commands.push('clip:'+rule),
    drawImage:()=>commands.push('drawImage'),
    fillRect:()=>{},save:()=>{},restore:()=>{}
  },{set(target,key,value){target[key]=value;return true;}});
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
  const region={
    geometry:rect(2693000,1226000,2694000,1227000),
    lakeGeometries:[rect(2693900,1226500,2694300,1226800)]
  };
  const l={b:{minE:2693000,maxN:1227000},groundW:1500,groundH:1000};
  try{
    colourizeBlock({},150,100,region,l,{width:150,height:100},0,0,'karte');
    assert.deepEqual(commands.filter(x=>x==='clip:evenodd'),['clip:evenodd','clip:evenodd']);
    assert.equal(commands.filter(x=>x==='drawImage').length,3);
  }finally{globalThis.document=saved;}
});
