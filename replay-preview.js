import { decodeReply, buildReplayModel, halfName } from "./replay-core.js";

import { createReplayBoard } from "./replay-board.js";

let board;
const el=id=>document.getElementById(id);
let dict={}, seasonConfig={}, model=null, index=0;

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open("furuyoni-deck-tool",1);
    req.onupgradeneeded=()=>req.result.createObjectStore("replayPreview");
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function readPreviewFile(){
  const db=await openDb();
  return await new Promise((resolve,reject)=>{
    const tx=db.transaction("replayPreview","readonly");
    const req=tx.objectStore("replayPreview").get("current");
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}
function renderStep(i){
  if(!model?.steps?.length) return;
  index=Math.max(0,Math.min(model.steps.length-1,i));
  const step=model.steps[index],st=step.state||{},local=model.localPlayer,opp=local===1?2:1;
  el("topPlayer").replaceChildren(board.playerPanel(opp,st));
  el("bottomPlayer").replaceChildren(board.playerPanel(local,st));
  board.renderUsing(opp,st,el("topUsing"),step);
  board.renderUsing(local,st,el("bottomUsing"),step);
  el("turnText").textContent=step.turn?`T${step.turn} ${halfName(step.rawTurn)}`:"初期局面";
  el("distanceText").textContent=`間合 ${st.distance??"-"}`;
  el("dustText").textContent=`ダスト ${st.dust??"-"}`;
  el("counter").textContent=`${index} / ${model.steps.length-1}`;
  el("stepSlider").value=String(index);
  el("firstBtn").disabled=index===0;
  el("prevBtn").disabled=index===0;
  el("back10Btn").disabled=index===0;
  const last=index===model.steps.length-1;
  el("nextBtn").disabled=last;
  el("forward10Btn").disabled=last;
  el("lastBtn").disabled=last;
}
function showError(error){
  console.error(error);el("viewer").style.display="none";const box=el("error");box.style.display="block";box.textContent=String(error?.message||error);
}
async function load(){
  const [file,dct,sc]=await Promise.all([
    readPreviewFile(),
    fetch("./official_cards.json",{cache:"no-store"}).then(r=>r.json()),
    fetch("./season_config.json",{cache:"no-store"}).then(r=>r.json())
  ]);
  if(!file) throw new Error("リプレイがありません。");
  dict=dct||{};seasonConfig=sc||{};
  const bytes=new Uint8Array(await file.arrayBuffer());
  model=buildReplayModel(decodeReply(bytes),dict);
  board=createReplayBoard(model,dict,seasonConfig);
  el("stepSlider").max=String(Math.max(0,model.steps.length-1));
  renderStep(0);
}
el("firstBtn").addEventListener("click",()=>renderStep(0));
el("prevBtn").addEventListener("click",()=>renderStep(index-1));
el("nextBtn").addEventListener("click",()=>renderStep(index+1));
el("back10Btn").addEventListener("click",()=>renderStep(index-10));
el("forward10Btn").addEventListener("click",()=>renderStep(index+10));
el("lastBtn").addEventListener("click",()=>model&&renderStep(model.steps.length-1));
el("stepSlider").addEventListener("input",e=>renderStep(Number(e.target.value)));
window.addEventListener("keydown",e=>{
  if(e.key==="ArrowLeft"){e.preventDefault();renderStep(index-1);}
  else if(e.key==="ArrowRight"){e.preventDefault();renderStep(index+1);}
  else if(e.key==="Home"){e.preventDefault();renderStep(0);}
  else if(e.key==="End"&&model){e.preventDefault();renderStep(model.steps.length-1);}
});
load().catch(showError);
