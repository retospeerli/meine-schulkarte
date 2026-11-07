/** One canonical cartographic product selection for preview, WMTS-PDF and COG-PDF.
 * Each national map is graphically generalised for its *native* print scale.
 * Free intermediate print scales remain accurate, but cannot be called a native
 * swisstopo standard: the closest legible source series is reported openly.
 */
export const OFFICIAL_MAP_SERIES=Object.freeze([
  {scale:10000,collection:'ch.swisstopo.landeskarte-farbe-10',wmts:'ch.swisstopo.landeskarte-farbe-10'},
  {scale:25000,collection:'ch.swisstopo.pixelkarte-farbe-pk25.noscale',wmts:'ch.swisstopo.pixelkarte-farbe-pk25.noscale'},
  {scale:50000,collection:'ch.swisstopo.pixelkarte-farbe-pk50.noscale',wmts:'ch.swisstopo.pixelkarte-farbe-pk50.noscale'},
  {scale:100000,collection:'ch.swisstopo.pixelkarte-farbe-pk100.noscale',wmts:'ch.swisstopo.pixelkarte-farbe-pk100.noscale'},
  {scale:200000,collection:'ch.swisstopo.pixelkarte-farbe-pk200.noscale',wmts:'ch.swisstopo.pixelkarte-farbe-pk200.noscale'},
  {scale:500000,collection:'ch.swisstopo.pixelkarte-farbe-pk500.noscale',wmts:'ch.swisstopo.pixelkarte-farbe-pk500.noscale'},
  {scale:1000000,collection:'ch.swisstopo.pixelkarte-farbe-pk1000.noscale',wmts:'ch.swisstopo.pixelkarte-farbe-pk1000.noscale'}
]);
export const fmtScale=s=>Number(s).toLocaleString('de-CH');
export function cartographyForScale(scale){
  const target=Number(scale);
  if(!Number.isFinite(target)||target<10000||target>1000000)
    throw new Error('Für amtliche Landeskarten ist nur 1:10’000 bis 1:1’000’000 verfügbar. Luftbild und Höhenlinien erlauben weiterhin freie Massstäbe.');
  // A smaller-print-scale series has been cartographically generalised more.
  // Avoid shrinking fine-scale lettering when a reasonably close coarser
  // series exists. Do NOT silently alter the requested physical print scale.
  let selected=OFFICIAL_MAP_SERIES[0],best=Infinity;
  for(const item of OFFICIAL_MAP_SERIES){
    const distance=Math.abs(Math.log(item.scale/target));
    const penalty=item.scale<target?1.45:1.0;
    const score=distance*penalty;
    if(score<best-1e-12){selected=item;best=score;}
  }
  return {...selected,exact:target===selected.scale,
    printScale:target,
    enlargement: selected.scale/target,
    label:`Landeskarte 1:${fmtScale(selected.scale)}`};
}
export function cartographyDescription(style){
  if(style.exact)return `${style.label} · amtliche Signaturen und Beschriftung im Nennmassstab`;
  const pct=Math.round(style.enlargement*100);
  return `${style.label} bei Druckmassstab 1:${fmtScale(style.printScale)} · Bildgrösse ${pct} % des Originals. Zwischenmassstab ohne eigene amtliche Kartengrafik.`;
}
