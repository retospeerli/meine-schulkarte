import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedHeightTileCount,newHeightGrid,getHeightGrid} from '../heights.mjs';
import {computeContours} from '../contours.mjs';

const bounds={minE:2687197,maxE:2697447,minN:1221196,maxN:1235796};

test('A2 1:25k: height source count is 165, grid stays inside exact map bounds',()=>{
  assert.equal(estimatedHeightTileCount(bounds),165);
  const grid=newHeightGrid(bounds,10);
  assert.equal(grid.nx,1026);
  assert.equal(grid.ny,1461);
  assert.equal(grid.nx*grid.ny,1498986);
  assert.ok(Math.abs(grid.bounds.minE+(grid.nx-1)*grid.stepX-grid.bounds.maxE)<1e-9);
  assert.ok(Math.abs(grid.bounds.maxN-(grid.ny-1)*grid.stepY-grid.bounds.minN)<1e-9);
  const irregular={minE:2692000.2,maxE:2693011.1,minN:1230000,maxN:1231000.3};
  const g2=newHeightGrid(irregular,10);
  assert.ok(Math.abs(g2.bounds.minE+(g2.nx-1)*g2.stepX-irregular.maxE)<1e-8);
  assert.ok(Math.abs(g2.bounds.maxN-(g2.ny-1)*g2.stepY-irregular.minN)<1e-8);
});

test('full mock STAC + 165 COGs: no 160-tile cap, complete coverage',async()=>{
  const oldFetch=globalThis.fetch,oldGeoTIFF=globalThis.GeoTIFF;
  const features=[];
  for(let e=2687;e<=2697;e++)for(let n=1221;n<=1235;n++){
    const href=`https://data.geo.admin.ch/swissalti3d_2025_${e}-${n}_2_2056_5728.tif`;
    features.push({assets:{data:{href}}});
  }
  assert.equal(features.length,165);
  let opened=0,closed=0,calls=0;
  globalThis.fetch=async url=>{
    calls++;
    return {ok:true,json:async()=>({features:calls===1?features.slice(0,100):features.slice(100),links:calls===1?[{rel:'next',href:'https://example.invalid/next'}]:[]})};
  };
  globalThis.GeoTIFF={fromUrl:async href=>{
    opened++;
    const [,es,ns]=href.match(/_(\d{4})-(\d{4})_2_2056_5728\.tif$/) || [];
    const e=Number(es)*1000,n=Number(ns)*1000;
    return {
      getImage:async()=>({
        getSamplesPerPixel:()=>1,
        getBoundingBox:()=>[e,n,e+1000,n+1000],
        getWidth:()=>500,getHeight:()=>500,getGDALNoData:()=>null,
        readRasters:async({window:[x0,y0,x1,y1]})=>{
          const out=new Float32Array((x1-x0)*(y1-y0));
          out.fill(450+((e-2687000)+(n-1221000))/100);
          return out;
        }
      }),
      close:()=>{closed++;}
    };
  }};
  try{
    const msg=[];
    const grid=await getHeightGrid(bounds,10,{onProgress:s=>{if(s.includes('165'))msg.push(s);}});
    assert.equal(grid.sourceCount,165);
    assert.equal(grid.coverage,1);
    assert.ok(grid.values.every(Number.isFinite));
    assert.equal(opened,165);
    assert.equal(closed,165);
    assert.equal(calls,2);
    assert.ok(msg.some(s=>s.includes('165/165')));
  }finally{
    globalThis.fetch=oldFetch;
    globalThis.GeoTIFF=oldGeoTIFF;
  }
});

test('contour extraction uses precise stepX and stepY for noninteger widths',()=>{
  const b={minE:2687000,maxE:2687021,minN:1221000,maxN:1221027};
  const g=newHeightGrid(b,10);
  for(let y=0;y<g.ny;y++)for(let x=0;x<g.nx;x++)g.values[y*g.nx+x]=480+20*x;
  const c=computeContours(g,10);
  assert.equal(c.levels.length,6);
  const level=c.levels.find(x=>x.height===510);
  assert.ok(level);
  const pts=level.paths.flat();
  assert.ok(pts.length>1);
  assert.ok(pts.every(([x])=>Math.abs(x-(b.minE+1.5*g.stepX))<1e-7));
});
