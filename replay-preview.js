import { decodeReply, buildReplayModel, playerName, charaName, halfName, cardName, cardImageUrl } from "./replay-core.js";

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
function cardNode(pid,cid,{small=false,facedown=false,used=false,large=false}={}){
  const box=document.createElement("div");
  box.className=`card${small?" small":""}${facedown?" facedown":""}${used?" used":""}${large?" large":""}`;
  const img=document.createElement("img");
  img.alt=cardName(model.data,cid,dict);
  img.src=cardImageUrl(model.data,cid,seasonConfig);
  img.loading="lazy";
  img.addEventListener("error",()=>{
    const f=document.createElement("div");
    f.className="fallback";
    f.textContent=img.alt;
    img.replaceWith(f);
  },{once:true});
  box.appendChild(img);
  return box;
}
function appendCards(container,pid,ids,opts={}){
  container.innerHTML="";
  for(const cid of ids||[]) container.appendChild(cardNode(pid,cid,opts));
}
function zone(title,pid,ids,opts={}){
  const z=document.createElement("div");
  z.className="zone";
  const t=document.createElement("div");
  t.className="zoneTitle";
  t.textContent=`${title} ${ids?.length||0}`;
  const cards=document.createElement("div");
  cards.className="cards";
  appendCards(cards,pid,ids,opts);
  z.append(t,cards);
  return z;
}
function makeDeckStack(count){
  const deck=document.createElement("div");
  deck.className="deckStack";
  deck.textContent=String(count||0);
  return deck;
}
function makeDiscardStack(pid,ids){
  const wrap=document.createElement("div");
  wrap.className="discardStack";
  (ids||[]).slice(-8).forEach((cid,i)=>{
    const card=cardNode(pid,cid,{small:true});
    card.style.top=`${i*16}px`;
    wrap.appendChild(card);
  });
  return wrap;
}
function makeFacedownStack(pid,ids){
  const wrap=document.createElement("div");
  wrap.className="facedownStack";
  for(const cid of (ids||[]).slice(0,8)) wrap.appendChild(cardNode(pid,cid,{facedown:true}));
  return wrap;
}
function playerPanel(pid,st){
  const wrap=document.createDocumentFragment();

  const info=document.createElement("div");
  info.className="playerInfo";
  const n=document.createElement("div");
  n.className="playerName";
  n.textContent=playerName(model,pid);
  const ch=document.createElement("div");
  ch.className="charas";
  ch.textContent=(model.chosenCharas[pid]||[]).map(charaName).join(" / ");
  const rg=document.createElement("div");
  rg.className="resGrid";
  for(const [key,label] of [["life","ライフ"],["aura","オーラ"],["flare","フレア"]]){
    const r=document.createElement("div");
    r.className="res";
    r.innerHTML=`<b>${Number(st[`p${pid}_${key}`])||0}</b><span>${label}</span>`;
    rg.appendChild(r);
  }
  info.append(n,ch,rg);

  const play=document.createElement("div");
  play.className="playerPlay";

  const main=document.createElement("div");
  main.className="mainZones";
  main.append(zone("手札",pid,st[`p${pid}_hand`]||[]));

  const specials=st[`p${pid}_special`]||[];
  const specialZone=zone("切札",pid,[]);
  specialZone.querySelector(".zoneTitle").textContent=`切札 ${specials.length}`;
  const specialCards=specialZone.querySelector(".cards");
  const statusMap=st[`p${pid}_special_status`]||{};
  for(const cid of specials) specialCards.appendChild(cardNode(pid,cid,{used:Number(statusMap[String(cid)])===2}));
  main.append(specialZone);

  const side=document.createElement("div");
  side.className="sideStacks";
  side.appendChild(makeDeckStack(st[`p${pid}_deck`]?.length||0));
  side.appendChild(makeFacedownStack(pid,st[`p${pid}_facedown`]||[]));
  side.appendChild(makeDiscardStack(pid,st[`p${pid}_discard`]||[]));

  play.append(main,side);
  wrap.append(info,play);
  return wrap;
}
function renderUsing(pid,st,target){
  target.innerHTML="";
  const ids=st[`p${pid}_using`]||[];
  if(!ids.length) return;
  const cards=document.createElement("div");
  cards.className="cards";
  appendCards(cards,pid,ids,{large:true});
  target.append(cards);
}
function renderStep(i){
  if(!model?.steps?.length) return;
  index=Math.max(0,Math.min(model.steps.length-1,i));
  const step=model.steps[index],st=step.state||{},local=model.localPlayer,opp=local===1?2:1;
  el("topPlayer").replaceChildren(playerPanel(opp,st));
  el("bottomPlayer").replaceChildren(playerPanel(local,st));
  renderUsing(opp,st,el("topUsing"));
  renderUsing(local,st,el("bottomUsing"));
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