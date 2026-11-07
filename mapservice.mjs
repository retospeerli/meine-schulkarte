/** Fixed-source swisstopo WMS requests in LV95.
 * WMS GetMap accepts any requested extent/resolution, unlike WMTS layers whose
 * TileMatrixSets/zoom ranges vary by product. Never rescale a WMTS style from
 * an unsupported level. This is the on-screen + fast-PDF map renderer only;
 * the high-resolution default output still uses Swiss Map Raster GeoTIFFs.
 */
export const WMS_ENDPOINT='https://wms.geo.admin.ch/';
export function wmsGetMapUrl(layer,bounds,width,height,format='image/jpeg'){
  if(!/^ch\.swisstopo\.[a-zA-Z0-9_.-]+$/.test(layer))throw new Error('Ungültiger swisstopo-Kartenlayer.');
  const {minE,minN,maxE,maxN}=bounds;
  if(![minE,minN,maxE,maxN].every(Number.isFinite)||minE>=maxE||minN>=maxN)
    throw new Error('Ungültiger Kartenausschnitt.');
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>4096||height>4096)
    throw new Error('WMS-Bildmasse müssen zwischen 1 und 4096 Pixel liegen.');
  if(!['image/jpeg','image/png'].includes(format))throw new Error('Ungültiges WMS-Bildformat.');
  const q=new URLSearchParams({
    SERVICE:'WMS',REQUEST:'GetMap',VERSION:'1.3.0',
    LAYERS:layer,STYLES:'default',CRS:'EPSG:2056',
    BBOX:[minE,minN,maxE,maxN].join(','),WIDTH:String(width),HEIGHT:String(height),
    FORMAT:format,TRANSPARENT:'false'
  });
  return `${WMS_ENDPOINT}?${q}`;
}
/** World rectangle corresponding exactly to each printed raster block. */
export function printedBlockBounds(layout,total,x0,y0,w,h){
  return {
    minE:layout.b.minE + x0/total.width*layout.groundW,
    maxE:layout.b.minE + (x0+w)/total.width*layout.groundW,
    maxN:layout.b.maxN - y0/total.height*layout.groundH,
    minN:layout.b.maxN - (y0+h)/total.height*layout.groundH
  };
}
