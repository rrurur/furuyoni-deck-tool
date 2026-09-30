const TARGET="https://furuyoni-diary-1918f.web.app/replay.html?source=deck-tool";
const TARGET_ORIGIN=new URL(TARGET).origin;

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open("furuyoni-deck-tool",1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("replayPreview")) db.createObjectStore("replayPreview");
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function readLegacyPreview(){
  const db=await openDb();
  return await new Promise((resolve,reject)=>{
    if(!db.objectStoreNames.contains("replayPreview")){ resolve(null); return; }
    const tx=db.transaction("replayPreview","readonly");
    const req=tx.objectStore("replayPreview").get("current");
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}
async function main(){
  const file=await readLegacyPreview();
  if(!file){ location.replace("./"); return; }

  let popup=null;
  let buffer=await file.arrayBuffer();

  const onReady=(event)=>{
    if(event.origin!==TARGET_ORIGIN || event.source!==popup) return;
    if(event.data?.type!=="furuyoni-replay-ready") return;
    window.removeEventListener("message",onReady);
    popup.postMessage({
      type:"furuyoni-replay-data",
      name:String(file.name||"replay.reply"),
      buffer
    },TARGET_ORIGIN,[buffer]);
    buffer=null;
    try{ window.close(); }catch{}
  };

  window.addEventListener("message",onReady);
  popup=window.open(TARGET,"_blank");
  if(!popup){
    window.removeEventListener("message",onReady);
    location.replace("./");
  }
}
main().catch(()=>location.replace("./"));
