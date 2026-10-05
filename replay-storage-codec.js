const GZIP_MAGIC_0=0x1f;
const GZIP_MAGIC_1=0x8b;

function asUint8Array(bytes){
  if(bytes instanceof Uint8Array) return bytes;
  if(bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if(ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return new Uint8Array(bytes||0);
}

export function replayChunkPrefix(storage){
  const value=String(storage||"");
  const marker="firestore-gzip:";
  return value.startsWith(marker) ? value.slice(marker.length) : "";
}

export function replayChunkId(prefix,index){
  const base=String(index).padStart(4,"0");
  return prefix ? `${prefix}_${base}` : base;
}

export function makeReplayChunkPrefix(){
  const random=new Uint8Array(6);
  crypto.getRandomValues(random);
  return `g2${Date.now().toString(36)}${[...random].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
}

export async function encodeReplayForStorage(bytes){
  const raw=asUint8Array(bytes);
  if(typeof CompressionStream!=="function"){
    return {bytes:raw,version:1,contentType:"application/octet-stream",compressed:false};
  }
  const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
  const gzip=new Uint8Array(await new Response(stream).arrayBuffer());
  if(!gzip.length || gzip.length>=raw.length){
    return {bytes:raw,version:1,contentType:"application/octet-stream",compressed:false};
  }
  return {bytes:gzip,version:2,contentType:"application/gzip",compressed:true};
}

export async function decodeStoredReplayBytes(bytes,replayVersion=0){
  const view=asUint8Array(bytes);
  const gzip=view.length>=2 && view[0]===GZIP_MAGIC_0 && view[1]===GZIP_MAGIC_1;
  if(Number(replayVersion)<2 && !gzip) return view;
  if(typeof DecompressionStream!=="function"){
    throw new Error("このブラウザは圧縮リプレイの展開に対応していません。");
  }
  const stream=new Blob([view]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
