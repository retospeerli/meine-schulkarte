/** Isoline extraction from an LV95-aligned sampled elevation grid. */
import {toPaper} from './core.mjs';

export function computeContours(grid,interval,{maxLevels=350,maxSegments=550000}={}) {
  const {values,nx,ny,step,bounds}=grid;
  if(!(nx>=2&&ny>=2&&values.length===nx*ny))throw new Error('Ungültiges Höhenraster');
  if(!(interval>0&&Number.isFinite(interval)))throw new Error('Ungültige Äquidistanz');
  let zMin=Infinity,zMax=-Infinity;
  for(const z of values)if(Number.isFinite(z)){zMin=Math.min(zMin,z);zMax=Math.max(zMax,z);}
  if(!Number.isFinite(zMin))throw new Error('Keine gültigen Höhenwerte');
  const lo=Math.ceil(zMin/interval)*interval,hi=Math.floor(zMax/interval)*interval;
  if((hi-lo)/interval+1>maxLevels)throw new Error(`Zu viele Höhenstufen. Äquidistanz erhöhen (maximal ${maxLevels}).`);
  const all=[];let totalSegments=0;
  for(let h=lo;h<=hi+interval/2;h+=interval){
    const nodes=new Map();let segments=0;
    function node(k,x,y){let q=nodes.get(k);if(!q){q={k,x,y,links:new Set()};nodes.set(k,q);}return q;}
    function edgePoint(row,col,id,v){
      // top (0), right (1), bottom (2), left (3)
      const sides=[[0,1],[1,2],[3,2],[0,3]],ab=sides[id];
      const xs=[col,col+1,col+1,col],ys=[row,row,row+1,row+1];
      const t=Math.min(1,Math.max(0,(h-v[ab[0]])/(v[ab[1]]-v[ab[0]])));
      const xx=xs[ab[0]]+(xs[ab[1]]-xs[ab[0]])*t, yy=ys[ab[0]]+(ys[ab[1]]-ys[ab[0]])*t;
      const key= id===0?`h:${row}:${col}`:id===1?`v:${row}:${col+1}`:id===2?`h:${row+1}:${col}`:`v:${row}:${col}`;
      return node(key,bounds.minE+xx*step,bounds.maxN-yy*step);
    }
    function link(a,b){a.links.add(b.k);b.links.add(a.k);segments++;totalSegments++;if(totalSegments>maxSegments)throw new Error('Zu viele Höhenliniensegmente. Höhenraster gröber oder Gebiet kleiner wählen.');}
    for(let row=0;row<ny-1;row++) for(let col=0;col<nx-1;col++){
      const i=row*nx+col;let v=[values[i],values[i+1],values[i+nx+1],values[i+nx]];
      if(!v.every(Number.isFinite))continue;
      const active=[];
      for(let j=0;j<4;j++){const k=(j+1)%4;if((v[j]>=h)!==(v[k]>=h))active.push(j);}
      if(active.length===2){link(edgePoint(row,col,active[0],v),edgePoint(row,col,active[1],v));}
      else if(active.length===4){
        const center=(v[0]+v[1]+v[2]+v[3])/4;
        const pairs=(center>=h)===(v[0]>=h)?[[0,1],[2,3]]:[[0,3],[1,2]];
        for(const [a,b] of pairs)link(edgePoint(row,col,a,v),edgePoint(row,col,b,v));
      }
    }
    const visited=new Set(),paths=[];
    const edgeId=(a,b)=>a<b?`${a}|${b}`:`${b}|${a}`;
    function walk(first,second){
      const path=[[nodes.get(first).x,nodes.get(first).y]];let last=first,here=second;
      for(let limit=0;limit<=nodes.size;limit++){
        const k=edgeId(last,here);if(visited.has(k))break;visited.add(k);
        const cur=nodes.get(here);path.push([cur.x,cur.y]);
        let nxt=null;for(const cand of cur.links){if(cand!==last&&!visited.has(edgeId(here,cand))){nxt=cand;break;}}
        if(nxt===null)break;
        last=here;here=nxt;
      }
      if(path.length>=2)paths.push(path);
    }
    for(const q of nodes.values()) if(q.links.size!==2) for(const next of q.links)if(!visited.has(edgeId(q.k,next)))walk(q.k,next);
    for(const q of nodes.values()) for(const next of q.links)if(!visited.has(edgeId(q.k,next)))walk(q.k,next);
    if(paths.length)all.push({height:+h.toFixed(6),paths,segments});
  }
  return {levels:all,min:zMin,max:zMax,totalSegments};
}
export function svgForContours(result,l,{level=null,stroke=0.16,majorEvery=5}={}){
  const levels=level==null?result.levels:result.levels.filter(x=>x.height===level);
  const txt=[`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l.w}mm" height="${l.h}mm" viewBox="0 0 ${l.w} ${l.h}">`,
    `<title>Höhenlinien 1:${l.scale} · EPSG:2056</title>`,
    `<desc>Vektordaten aus swisstopo Höhenmodellen. Format ${l.w} × ${l.h} mm. Beim Druck 100 Prozent, keine Anpassung.</desc>`,
    `<rect x="0" y="0" width="${l.w}" height="${l.h}" fill="white"/>`,
    `<defs><clipPath id="karte"><rect x="${l.margin}" y="${l.margin}" width="${l.innerW}" height="${l.innerH}"/></clipPath></defs>`,
    `<g clip-path="url(#karte)" fill="none" stroke="#111111" stroke-linejoin="round" stroke-linecap="round">`];
  levels.forEach((lev,idx)=>{
    const big=majorEvery>0&&Math.abs(Math.round(lev.height/(majorEvery*l.contourInterval))-lev.height/(majorEvery*l.contourInterval))<1e-8;
    txt.push(`<g id="hoehe-${String(lev.height).replace(/[^0-9-]/g,'_')}m" data-hoehe-m="${lev.height}" stroke-width="${big?(stroke*1.45).toFixed(3):stroke}">`);
    for(const path of lev.paths){
      let d='';for(let i=0;i<path.length;i++){
        const [x,y]=toPaper(l,path[i][0],path[i][1]);d+=(i?'L':'M')+x.toFixed(3)+' '+y.toFixed(3);
      }txt.push(`<path d="${d}"/>`);
    }txt.push('</g>');
  });
  txt.push('</g>','</svg>');return txt.join('\n');
}
