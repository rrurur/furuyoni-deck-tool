import { playerName, charaName, cardName, cardImageUrl } from "./replay-core.js";

export function firstPlayer(model){
  for(const record of model.data?.Records||[]){
    const action=record.Action;
    if(Number(action?.ActionType)===11){
      const turn=Number(action.Payload?.[1]?.Turn);
      const player=Number(action.PlayerId);
      if(turn>0 && [1,2].includes(player)) return turn%2===1 ? player : 3-player;
    }
    const board=record.GameState?.BoardStatus;
    const turn=Number(board?.Turn), player=Number(board?.TurnPlayer);
    if(turn>0 && [1,2].includes(player)) return turn%2===1 ? player : 3-player;
  }
  return null;
}

export function createReplayBoard(model,dict,seasonConfig){
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
  deck.setAttribute("aria-label", `山札 ${count}枚`);
  const base=String(seasonConfig.assetBaseUrl||"https://furuyoni-diary-1918f.web.app/assets").replace(/\/+$/,"");
  const folder=seasonConfig.currentAssetFolder||"replay";
  for(let layer=0;layer<Math.min(count,3);layer++){
    const image=document.createElement("img");
    image.src=`${base}/${folder}/images/cardback_normal.png`;
    image.alt="";
    image.style.setProperty("--layer",layer);
    deck.append(image);
  }
  const number=document.createElement("span");
  number.className="deckCount";
  number.textContent=String(count);
  deck.append(number);
  return deck;
}
function makeDiscardStack(pid,ids){
  const wrap=document.createElement("div");
  wrap.className="discardStack";
  wrap.setAttribute("aria-label","捨て札");
  for(const cid of ids||[]) wrap.appendChild(cardNode(pid,cid,{small:true}));
  return wrap;
}
function makeFacedownStack(pid,ids){
  const wrap=document.createElement("div");
  wrap.className="facedownStack";
  wrap.setAttribute("aria-label","伏せ札");
  for(const cid of ids||[]) wrap.appendChild(cardNode(pid,cid,{facedown:true}));
  return wrap;
}
function playerPanel(pid,st){
  const wrap=document.createDocumentFragment();

  const info=document.createElement("div");
  info.className="playerInfo";
  const n=document.createElement("div");
  n.className="playerName";
  const first = firstPlayer(model);
  n.textContent=`${playerName(model,pid)} (${first ? (pid===first ? "先行" : "後行") : "手番不明"})`;
  const ch=document.createElement("div");
  ch.className="charas";
  ch.textContent=(model.chosenCharas[pid]||[]).map(charaName).join(" / ");
  const rg=document.createElement("div");
  rg.className="resGrid";
  for(const [key,label] of [["life","ライフ"],["aura","オーラ"],["flare","フレア"]]){
    const r=document.createElement("div");
    r.className=`res ${key}`;
    r.innerHTML=`<b>${Number(st[`p${pid}_${key}`])||0}</b><span>${label}</span>`;
    rg.appendChild(r);
  }
  info.append(n,ch,rg);

  const play=document.createElement("div");
  play.className="playerPlay";

  const main=document.createElement("div");
  main.className="mainZones";
  const handZone=zone("手札",pid,st[`p${pid}_hand`]||[]);
  handZone.classList.add("handZone");
  main.append(handZone);

  const specials=st[`p${pid}_special`]||[];
  const specialZone=zone("切札",pid,[]);
  specialZone.classList.add("specialZone");
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
function renderUsing(pid,st,target,step){
  target.innerHTML="";
  const actor=Number(step.actor)||Number(step.turnPlayer);
  const isCardAction=["カード使用","攻撃"].includes(step.kind);

  if(!isCardAction){
    if(actor===pid || (![1,2].includes(actor) && pid===model.localPlayer)){
      const text=document.createElement("div");
      text.className="actionText";
      text.textContent=step.title||step.kind||"処理中";
      target.append(text);
    }
    return;
  }

  let ids=st[`p${pid}_using`]||[];
  if(!ids.length && actor===pid){
    ids=(step.raw||[]).flatMap(action=>{
      const payload=action.Payload?.[1]||{};
      const cardId=Number(payload.CardId||payload.SourceCardId);
      return cardId>0 && model.data?.InitData?.AllCardsData?.[cardId] ? [cardId] : [];
    });
    ids=[...new Set(ids)];
  }
  if(!ids.length) return;

  const cards=document.createElement("div");
  cards.className="cards";
  appendCards(cards,pid,ids,{large:true});
  target.append(cards);
}

  return {playerPanel,renderUsing};
}
