/** Incremental RGB/JPEG PDF 1.4 writer, without an in-memory full-page canvas.
 * One A0 page with thousands of individually positioned 512px JPEG blocks.
 * This is a valid, precisely-sized print PDF, NOT a certified PDF/X file.
 * Writing via File System Access keeps the finished PDF off the JS heap.
 */
const encoder=new TextEncoder();
const mmToPt=mm=>mm*72/25.4;
const safeString=s=>String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\x00-\x1f\x7f-\uffff]/g,'?');
const num=n=>{if(!Number.isFinite(n))throw new Error('Ungültige PDF-Koordinate');return Number(n.toFixed(7)).toString();};
const bytes=b=>typeof b==='string'?encoder.encode(b):b instanceof Uint8Array?b:new Uint8Array(b);

export class IncrementalA0Pdf {
  constructor(sink,{pageWidthMm,pageHeightMm,title='SWISSIMAGE Luftbild',scale=25000}={}){
    if(!sink?.write||!sink?.close||!sink?.abort)throw new Error('PDF-Ausgabestrom fehlt.');
    if(!(pageWidthMm>0&&pageHeightMm>0))throw new Error('Ungültige PDF-Seitengrösse.');
    this.sink=sink;this.w=mmToPt(pageWidthMm);this.h=mmToPt(pageHeightMm);
    this.title=title;this.scale=scale;this.offset=0;
    this.xref=new Map();this.images=[];this.commands=[];this.nextObject=7;
    this.closed=false;this.done=false;
  }
  async write(data){
    const b=bytes(data);
    await this.sink.write(b);
    this.offset+=b.byteLength;
  }
  async start(){await this.write('%PDF-1.4\n%SWISSIMAGE-RGB\n');return this;}
  async beginObject(id){this.xref.set(id,this.offset);await this.write(`${id} 0 obj\n`);}
  async endObject(){await this.write('endobj\n');}
  async imageJpeg(jpeg,{width,height,xMm,yMm,widthMm,heightMm}){
    if(this.closed||this.done)throw new Error('PDF ist bereits abgeschlossen.');
    const raw=bytes(jpeg);
    if(raw.length<4||raw[0]!==255||raw[1]!==216||raw[raw.length-2]!==255||raw[raw.length-1]!==217)
      throw new Error('Ungültiger JPEG-Datenblock (PDF-Export abgebrochen).');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)
      throw new Error('Ungültige Bildblockabmessung.');
    const id=this.nextObject++,name=`Im${this.images.length+1}`;
    this.images.push({id,name});
    await this.beginObject(id);
    await this.write(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${raw.length} >>\nstream\n`);
    await this.write(raw);
    await this.write('\nendstream\n');await this.endObject();
    const pw=mmToPt(widthMm),ph=mmToPt(heightMm);
    const x=mmToPt(xMm),y=this.h-mmToPt(yMm)-ph;
    this.commands.push(`q ${num(pw)} 0 0 ${num(ph)} ${num(x)} ${num(y)} cm /${name} Do Q\n`);
    return id;
  }
  async imageCanvas(canvas,box,{quality=.97}={}){
    if(typeof canvas?.toBlob!=='function')throw new Error('Browser unterstützt den JPEG-Export nicht.');
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('JPEG-Konvertierung fehlgeschlagen.')),'image/jpeg',quality));
    if(blob.type!=='image/jpeg')throw new Error('Bild konnte nicht als JPEG gespeichert werden.');
    return this.imageJpeg(await blob.arrayBuffer(),{width:canvas.width,height:canvas.height,...box});
  }
  async finish(){
    if(this.done||this.closed)throw new Error('PDF bereits abgeschlossen.');
    // Reserve objects 1-6 (catalog, pages, page, contents, metadata, font); images start at 7.
    const resources=this.images.map(({name,id})=>`/${name} ${id} 0 R`).join(' ');
    const content=`q 1 1 1 rg 0 0 ${num(this.w)} ${num(this.h)} re f Q\n`+this.commands.join('')+
      `BT /F1 7 Tf 0.15 0.18 0.2 rg 1 0 0 1 ${num(Math.max(6,this.w-145))} 6 Tm (\\251 swisstopo - 1:${this.scale}) Tj ET\n`;
    const contentBytes=bytes(content);
    await this.beginObject(4);
    await this.write(`<< /Length ${contentBytes.length} >>\nstream\n`);
    await this.write(contentBytes);
    await this.write('\nendstream\n');await this.endObject();
    await this.beginObject(1);await this.write('<< /Type /Catalog /Pages 2 0 R >>\n');await this.endObject();
    await this.beginObject(2);await this.write('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');await this.endObject();
    await this.beginObject(3);
    await this.write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.w)} ${num(this.h)}] /Resources << /ProcSet [/PDF /ImageC] /Font << /F1 6 0 R >> /XObject << ${resources} >> >> /Contents 4 0 R >>\n`);
    await this.endObject();
    await this.beginObject(5);
    await this.write(`<< /Title (${safeString(this.title)}) /Producer (Schweizer Kartengenerator - A0-Streaming) /Subject (SWISSIMAGE 1:${this.scale} RGB) >>\n`);
    await this.endObject();
    await this.beginObject(6);await this.write('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n');await this.endObject();
    const xrefOffset=this.offset;
    await this.write(`xref\n0 ${this.nextObject}\n0000000000 65535 f \n`);
    for(let i=1;i<this.nextObject;i++){
      const off=this.xref.get(i);
      if(off==null)throw new Error(`Fehlendes PDF-Objekt ${i}`);
      if(off>=10000000000)throw new Error('PDF überschreitet die unterstützte Dateigrösse.');
      await this.write(`${String(off).padStart(10,'0')} 00000 n \n`);
    }
    await this.write(`trailer\n<< /Size ${this.nextObject} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    this.done=true;await this.sink.close();this.closed=true;
    return {bytes:this.offset,images:this.images.length};
  }
  async abort(){
    if(this.closed)return;
    this.closed=true;
    await this.sink.abort();
  }
}

/** Native disk streaming in Chromium, OPFS backing store in other modern browsers.
 * The save dialog MUST be called synchronously from the export click (before network work).
 */
export async function openLargePdfOutput(fileName,{host=globalThis,onProgress=()=>{}}={}){
  if(typeof host.showSaveFilePicker==='function'){
    const handle=await host.showSaveFilePicker({
      suggestedName:fileName,
      types:[{description:'Druck-PDF',accept:{'application/pdf':['.pdf']}}]
    });
    const sink=await handle.createWritable();
    return {sink,method:'disk',fileName:handle.name||fileName};
  }
  if(typeof host.navigator?.storage?.getDirectory==='function'){
    onProgress('Dateidialog im Browser nicht verfügbar – sichere, temporäre Datei im Browser-Speicher wird aufgebaut.');
    const root=await host.navigator.storage.getDirectory();
    const tempName=`kartenexport-${Date.now()}-${Math.floor(Math.random()*1e8)}.pdf`;
    const handle=await root.getFileHandle(tempName,{create:true});
    const writable=await handle.createWritable();
    let finished=false;
    const sink={
      write:data=>writable.write(data),
      async close(){await writable.close();finished=true;},
      async abort(){try{await writable.abort();}finally{await root.removeEntry(tempName).catch(()=>{});}}
    };
    const reveal=async()=>{
      if(!finished)throw new Error('PDF noch nicht fertig geschrieben.');
      const file=await handle.getFile();
      const url=URL.createObjectURL(file);
      const a=host.document.createElement('a');a.href=url;a.download=fileName;
      host.document.body.appendChild(a);a.click();a.remove();
      // Keep objectURL alive until the browser had time to begin reading.
      setTimeout(async()=>{URL.revokeObjectURL(url);await root.removeEntry(tempName).catch(()=>{});},120000);
    };
    return {sink,method:'opfs',reveal,fileName};
  }
  throw new Error('Für den A0-Luftbildexport wird Chrome/Edge mit Dateispeicherung oder ein Browser mit OPFS benötigt. Der Export findet ohne Server statt.');
}
