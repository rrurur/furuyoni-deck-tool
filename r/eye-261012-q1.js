import {createDefaultCardRuleRegistry,CoreTurnSandboxEnvironment,runCoreTurnSandbox,BaselineCoreTurnAgent} from "./engine-261012-q1.js";

const $=id=>document.getElementById(id);
const reg=createDefaultCardRuleRegistry();
const sides={1:[4,8],2:[1,2]};
const labels={1:["トコヨ","ハガネ"],2:["ユリナ","サイネ"]};
const kinds={n:"normal",s:"special"};
const decks={1:{n:new Set(),s:new Set()},2:{n:new Set(),s:new Set()}};
let game=null,stepIndex=0,engine=null,agent=null,playTimer=null,mode="replay",human=1,reviews={};
let mulliganSession=null,pendingFoldCard=null,pendingBasic=null,pendingFullPowerCard=null,enhanceSelectedKey=null;
const ZONES=["hand","deck","discard","facedown","special","enhancement","using","outside"];
const KEY="furuyoni-private-match-261012";
const clone=v=>JSON.parse(JSON.stringify(v));
const safeNum=(v,fall=0)=>Number.isFinite(Number(v))?Number(v):fall;
function cardPool(player,kind){
  const ids=sides[player];
  return [...reg.rules.keys()].filter(slug=>ids.some(id=>slug.startsWith("re_"+String(id).padStart(2,"0")+"_"))&&new RegExp("_o_"+kind+"_[0-9]+$").test(slug)).sort((a,b)=>{
    const ai=ids.findIndex(id=>a.startsWith("re_"+String(id).padStart(2,"0")+"_"));
    const bi=ids.findIndex(id=>b.startsWith("re_"+String(id).padStart(2,"0")+"_"));
    return ai-bi||Number(a.match(/_(\d+)$/)[1])-Number(b.match(/_(\d+)$/)[1]);
  });
}
function cardName(slug){return reg.get(slug)?.name||slug;}
function imageFor(slug){return "https://furuyoni-diary-1918f.web.app/assets/replay/images/"+(slug.startsWith("re_")?"na_"+slug.slice(3):slug)+".png";}
function imgCard(slug,small=false){
  const img=document.createElement("img");img.src=imageFor(slug);img.alt=cardName(slug);img.loading="lazy";
  img.addEventListener("error",()=>{const fallback=document.createElement("span");fallback.className="fallback";fallback.textContent=cardName(slug);img.replaceWith(fallback);},{once:true});
  if(!small)img.className="cardImage";
  return img;
}
function selectCard(player,kind,slug){
  const chosen=decks[player][kind],cap=kind==="n"?7:3;
  if(chosen.has(slug))chosen.delete(slug);
  else if(chosen.size<cap)chosen.add(slug);
  else{$("buildError").textContent=(kind==="n"?"通常札7枚":"切札3枚")+"を超えて選択できません。";return;}
  $("buildError").textContent="";refreshDeck();
}
function renderDeckChoices(player){
  const parent=$("choices"+player);parent.replaceChildren();
  for(const kind of ["n","s"]){
    const box=document.createElement("section");box.className="deckGroup";
    const title=document.createElement("div");title.className="deckGroupTitle";title.textContent=kind==="n"?"通常札（7枚選択）":"切札（3枚選択）";box.append(title);
    const grid=document.createElement("div");grid.className="choiceGrid";
    for(const slug of cardPool(player,kind)){
      const button=document.createElement("button");button.type="button";button.className="choice";
      if(decks[player][kind].has(slug))button.classList.add("selected");
      button.setAttribute("aria-pressed",String(decks[player][kind].has(slug)));
      button.append(imgCard(slug));
      const sub=document.createElement("span");sub.className="cardName";sub.textContent=cardName(slug);button.append(sub);
      const source=document.createElement("span");source.className="kind";
      source.textContent=labels[player][sides[player].findIndex(id=>slug.startsWith("re_"+String(id).padStart(2,"0")+"_"))]||"";button.append(source);
      button.addEventListener("click",()=>selectCard(player,kind,slug));grid.append(button);
    }
    box.append(grid);parent.append(box);
  }
}
function refreshDeck(){
  for(const p of [1,2]){
    $("count"+p).textContent="通常札 "+decks[p].n.size+"/7 ｜ 切札 "+decks[p].s.size+"/3";
    renderDeckChoices(p);
  }
  const ready=[1,2].every(p=>decks[p].n.size===7&&decks[p].s.size===3);
  $("startAIVsAI").disabled=$("startHumanVsAI").disabled=!ready;
}
function setPreset(pid){
  // An optional reproducible O/O example; unlike old sampled variants, it
  // does not silently choose the negative-tempo opening 気炎万丈.
  const pick=pid===1?{
    n:["re_04_tokoyo_o_n_2","re_04_tokoyo_o_n_3","re_04_tokoyo_o_n_4","re_08_hagane_o_n_3","re_08_hagane_o_n_4","re_08_hagane_o_n_5","re_08_hagane_o_n_6"],
    s:["re_04_tokoyo_o_s_2","re_08_hagane_o_s_1","re_08_hagane_o_s_3"]
  }:{
    n:["re_01_yurina_o_n_1","re_01_yurina_o_n_2","re_01_yurina_o_n_3","re_01_yurina_o_n_4","re_01_yurina_o_n_5","re_02_saine_o_n_2","re_02_saine_o_n_3"],
    s:["re_01_yurina_o_s_1","re_01_yurina_o_s_2","re_02_saine_o_s_1"]
  };
  for(const kind of ["n","s"]){
    const pool=new Set(cardPool(pid,kind));
    if(pick[kind].some(x=>!pool.has(x)))throw Error("構築例のカードが登録されていません。");
    decks[pid][kind]=new Set(pick[kind]);
  }
  refreshDeck();
}
function selectedDecks(){return [1,2].map(p=>({n:[...decks[p].n],s:[...decks[p].s]}));}
function options(first,seed){
  return {startingPlayer:first,turnsTaken:{1:0,2:0},openingSetup:true,maxTurns:96,maxActions:3500,
    openingMulliganRate:.35,randomizeHiddenDecks:true,chanceSeed:seed,
    seed1:seed*3+1,seed2:seed*3+2,endTurnRate:.18};
}
function initializeState(chosen){
  const state={distance:10,dust:0};
  for(const pid of [1,2]){
    const prefix="p"+pid+"_";const deck=chosen[pid-1];
    if(deck.n.length!==7||deck.s.length!==3||new Set([...deck.n,...deck.s]).size!==10)
      throw Error("各プレイヤーは通常札7枚・切札3枚を選択してください。");
    for(const zone of ZONES)state[prefix+zone]=[];
    for(const key of ["flare","focus","freeze"])state[prefix+key]=0;
    state[prefix+"life"]=10;state[prefix+"aura"]=3;
    state[prefix+"chara_ids"]=sides[pid];
    state[prefix+"card_status"]={};state[prefix+"special_status"]={};
    for(const kind of ["n","s"])deck[kind].forEach((slug,i)=>{
      if(!cardPool(pid,kind).includes(slug))throw Error("選択できないカード: "+slug);
      const rule=reg.get(slug);
      const id="p"+pid+kind+i,p=prefix;
      state[p+"card_status"][id]={Slug:slug,
        MainType:rule?.mainUse?.kind==="attack-card"?1:rule?.mainUse?.kind==="enhancement-card"?3:2,
        SubType:rule?.response?1:0,IsSpecial:kind==="s",Charge:0,TokenCharges:{}};
      if(kind==="s"){state[p+"special"].push(id);state[p+"special_status"][id]=0;}
      else state[p+(i<3?"hand":"deck")].push(id);
    });
  }
  return state;
}
function configuration(){
  const chosen=selectedDecks(),first=Number($("firstPlayer").value);
  const seed=Number($("seed").value);
  if(!Number.isInteger(seed)||seed<1||seed>999999999)throw Error("山札乱数は1～999999999の整数で指定してください。");
  return {chosen,first,seed};
}
function signature(g){
  return JSON.stringify({chosen:g.config.chosen,first:g.config.first,seed:g.config.seed,
    mulliganChoices:g.config.mulliganChoices||null});
}
function makeGame(config){
  const state=initializeState(config.chosen);
  const opts={...options(config.first,config.seed),
    openingMulliganChoices:config.mulliganChoices||null};
  return {config:clone(config),initial:state,opts,openingState:null,history:[],done:false,doneReason:"",winner:null,mode:"replay"};
}
function setView(){
  $("builder").classList.add("hidden");$("mulliganPane").classList.add("hidden");
  $("replayPane").classList.remove("hidden");
  $("revealOpponent").checked=false;$("playError").textContent="";
  pendingFoldCard=null;pendingBasic=null;
}
function prepareMulligan(kind){
  try{
    stopReplay();$("buildError").textContent="";$("mulliganError").textContent="";
    const config=configuration();
    const previewOpts={...options(config.first,config.seed),
      openingMulliganChoices:{1:[],2:[]}};
    const env=new CoreTurnSandboxEnvironment(initializeState(config.chosen),previewOpts);
    mulliganSession={kind,config,preview:env.openingState,selected:{1:new Set(),2:new Set()}};
    human=Number($("humanSide").value)||1;
    $("builder").classList.add("hidden");$("replayPane").classList.add("hidden");
    $("mulliganPane").classList.remove("hidden");
    renderMulligan();
  }catch(error){$("buildError").textContent=String(error.message||error);}
}
function renderMulligan(){
  if(!mulliganSession)return;
  for(const pid of [1,2]){
    const view=$("mulliganCards"+pid);
    view.replaceChildren();
    const selected=mulliganSession.selected[pid];
    const cards=mulliganSession.preview["p"+pid+"_hand"]||[];
    const hidden=mulliganSession.kind==="human"&&pid!==human;
    $("mulliganCount"+pid).textContent=hidden?"相手が自動で交換":
      "交換 "+selected.size+" 枚 / 手札 3 枚";
    if(hidden){
      for(const cardId of cards){
        const el=document.createElement("span");el.className="mulliganCard";
        const img=document.createElement("img");img.alt="非公開";
        img.src="https://furuyoni-diary-1918f.web.app/assets/replay/images/cardback_normal.png";
        el.append(img);view.append(el);
      }
      continue;
    }
    for(const id of cards){
      const slug=cardOf(mulliganSession.preview,pid,id),btn=document.createElement("button");
      btn.type="button";btn.className="mulliganCard"+(selected.has(id)?" selected":"");
      btn.setAttribute("aria-pressed",String(selected.has(id)));
      btn.title=selected.has(id)?"交換する札（クリックで解除）":"残す札（クリックで交換対象）";
      btn.append(imgCard(slug));
      const label=document.createElement("span");label.className="cardName";label.textContent=cardName(slug);
      btn.append(label);
      btn.addEventListener("click",()=>{
        selected.has(id)?selected.delete(id):selected.add(id);
        renderMulligan();
      });
      view.append(btn);
    }
  }
}
function confirmMulligan(){
  if(!mulliganSession)return;
  try{
    const config=clone(mulliganSession.config),kind=mulliganSession.kind;
    config.mulliganChoices={
      1:kind==="human"&&human!==1?null:[...mulliganSession.selected[1]],
      2:kind==="human"&&human!==2?null:[...mulliganSession.selected[2]]
    };
    const g=makeGame(config);
    if(kind==="ai"){
      const result=runCoreTurnSandbox(g.initial,g.opts);
      if(!result.ok||result.invariantErrors.length||![1,2].includes(result.winner))
        throw Error("AI対戦処理が正常に決着しませんでした: "+result.doneReason);
      g.history=result.history;g.openingState=result.openingState;
      g.done=true;g.winner=result.winner;g.doneReason=result.doneReason;g.actions=result.actions;
      game=g;engine=null;mode="replay";
    }else{
      const env=new CoreTurnSandboxEnvironment(g.initial,g.opts);
      g.openingState=clone(env.openingState);game=g;engine=env;mode="human";
      agent=new BaselineCoreTurnAgent(g.config.seed*3+999,.18);
    }
    mulliganSession=null;stepIndex=0;setView();reviews={};
    if(kind==="human")advanceAI();
    stepIndex=kind==="ai"?0:game.history.length;render();
  }catch(error){$("mulliganError").textContent=String(error.message||error);}
}
function beginAIMatch(){prepareMulligan("ai");}
function beginHumanMatch(){prepareMulligan("human");}
function stepRows(){return game?[{turn:0,actor:0,phase:"initial",action:null,after:game.openingState,events:[]},...game.history]:[];}
function cardOf(state,pid,id){
  const slug=state["p"+pid+"_card_status"]?.[String(id)]?.Slug;
  return slug||"";
}
function canControl(pid){
  return !!engine&&!engine.done&&engine.currentPlayer()===pid&&
    (mode==="manual"||(mode==="human"&&pid===human))&&
    stepIndex===game.history.length;
}
function makeSmallCard(state,pid,id,{mask=false,used=false,enh=false,zone=""}={}){
  const span=document.createElement("div");
  span.className="smallCard"+(used?" used":"");
  if(mask){
    const img=document.createElement("img");img.alt="非公開";
    img.src="https://furuyoni-diary-1918f.web.app/assets/replay/images/cardback_normal.png";span.append(img);
  }else{
    const slug=cardOf(state,pid,id);
    if(slug)span.append(imgCard(slug,true));
    else{const div=document.createElement("span");div.className="fallback";div.textContent="?";span.append(div);}
    span.title=slug?cardName(slug):"";
    if(enh){
      const charge=Number(state["p"+pid+"_card_status"]?.[String(id)]?.Charge||0);
      if(charge){const t=document.createElement("div");t.className="charge";t.textContent="● "+charge;span.append(t);}
    }
  }
  if(zone==="hand"&&pendingFoldCard===id)span.classList.add("pendingCost");
  if(zone==="facedown")span.classList.add("zoneFacedown");
  const interactive=!mask&&canControl(pid)&&["hand","special"].includes(zone);
  if(interactive){
    span.draggable=true;span.classList.add("cardPlayable","cardClickable");
    span.title=(span.title||"")+"：使用欄へドラッグ（クリックでも使用）";
    span.addEventListener("dragstart",e=>{
      e.dataTransfer?.setData("text/plain",pid+":"+id);
      if(e.dataTransfer)e.dataTransfer.effectAllowed="move";
    });
    span.addEventListener("click",()=>useCard(pid,id));
  }
  return span;
}
function addZone(target,name,ids,state,pid,{mask=false,enh=false,special=false,zone=""}={}){
  const label=document.createElement("div");label.className="zoneHeading";
  label.textContent=name+" "+ids.length;target.append(label);
  const area=document.createElement("div");area.className="zoneCards";
  for(const id of ids){
    const used=special&&Number(state["p"+pid+"_special_status"]?.[String(id)]||0)===2;
    area.append(makeSmallCard(state,pid,id,{mask:mask&&!used,used,enh,zone}));
  }
  target.append(area);return area;
}
function makeDropZone(pid,type){
  const box=document.createElement("div");box.className="dropArea "+(type==="fold"?"facedown":"");
  if(!canControl(pid))box.classList.add("disabledDrop");
  const title=document.createElement("span");title.textContent=type==="play"?"ここへドラッグして使用":"ここへドラッグして伏せる";box.append(title);
  const hint=document.createElement("span");hint.className="dropHint";
  hint.textContent=type==="play"?"通常札・切札を使う":"伏せる札を選び、基本動作を実行";box.append(hint);
  if(type==="fold"&&pendingFoldCard&&engine?.state?.["p"+pid+"_card_status"]?.[pendingFoldCard]){
    const slug=cardOf(engine.state,pid,pendingFoldCard);
    title.textContent="伏せ札："+cardName(slug);
    const note=document.createElement("span");note.className="dropHint";note.textContent="基本動作ボタンを押して確定";box.append(note);
    box.classList.add("pendingFoldDrop");
  }
  box.addEventListener("dragover",e=>{
    if(!canControl(pid))return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect="move";
    box.classList.add("dragOver");
  });
  box.addEventListener("dragleave",()=>box.classList.remove("dragOver"));
  box.addEventListener("drop",e=>{
    e.preventDefault();box.classList.remove("dragOver");
    const payload=e.dataTransfer?.getData("text/plain")||"";
    const [sourcePid,cardId]=payload.split(":");
    if(Number(sourcePid)!==pid||!cardId)return;
    if(type==="play")useCard(pid,cardId);
    else foldCard(pid,cardId);
  });
  return box;
}
function sideBoard(target,st,pid,current,hidden=false){
  target.replaceChildren();target.classList.toggle("active",current===pid);
  const head=document.createElement("div");head.className="sideTitle";
  head.textContent=(pid===1?"扇槌（トコヨ・ハガネ）":"刀薙（ユリナ・サイネ）");
  const turnInfo=document.createElement("span");turnInfo.className="counts";
  turnInfo.textContent=current===pid?"行動中":"";
  head.append(turnInfo);target.append(head);
  const layout=document.createElement("div");layout.className="playerLayout";
  const hand=document.createElement("div");hand.className="handDock";
  addZone(hand,"手札",(st["p"+pid+"_hand"]||[]).filter(id=>!(canControl(pid)&&pendingFoldCard===id)),st,pid,{mask:hidden,zone:"hand"});
  const special=document.createElement("div");special.className="specialInHand";
  addZone(special,"切札",st["p"+pid+"_special"]||[],st,pid,{mask:hidden,special:true,zone:"special"});
  hand.append(special);
  const discard=document.createElement("div");discard.className="discardDock";
  discard.append(makeDropZone(pid,"play"));
  const discardGroup=document.createElement("div");discardGroup.className="cardStackMini";
  addZone(discardGroup,"捨て札",st["p"+pid+"_discard"]||[],st,pid,{zone:"discard"});
  discard.append(discardGroup);
  const enhancement=document.createElement("div");enhancement.className="cardStackMini";
  addZone(enhancement,"展開中",st["p"+pid+"_enhancement"]||[],st,pid,{enh:true,zone:"enhancement"});
  discard.append(enhancement);
  const facedown=document.createElement("div");facedown.className="facedownDock";
  facedown.append(makeDropZone(pid,"fold"));
  const facedownIds=[...(st["p"+pid+"_facedown"]||[])];
  if(canControl(pid)&&pendingFoldCard)facedownIds.push(pendingFoldCard);
  addZone(facedown,"伏せ札",facedownIds,st,pid,{mask:true,zone:"facedown"});
  const deck=document.createElement("div");deck.className="zoneHeading";
  deck.className="deckBack";
  const back=document.createElement("img");back.src="https://furuyoni-diary-1918f.web.app/assets/replay/images/cardback_normal.png";back.alt="山札の裏面";deck.append(back);
  const count=document.createElement("strong");count.textContent=String((st["p"+pid+"_deck"]||[]).length)+"枚";deck.append(count);
  facedown.append(deck);
  const resources=document.createElement("div");resources.className="resourceDock";
  const resourceGrid=document.createElement("div");resourceGrid.className="resourceGrid";
  for(const [key,name] of [["focus","集中力"],["flare","フレア"],["aura","オーラ"],["life","ライフ"]]){
    const item=document.createElement("div");item.className="resourceStat "+key;
    const label=document.createElement("span");label.className="resourceName";label.textContent=name;
    const value=document.createElement("strong");value.className="resourceNum";value.textContent=String(Number(st["p"+pid+"_"+key]||0));
    item.append(label,value);resourceGrid.append(item);
  }
  resources.append(resourceGrid);
  const freeze=document.createElement("div");freeze.className="resourceExtra";
  freeze.textContent="凍結 "+Number(st["p"+pid+"_freeze"]||0);resources.append(freeze);
  layout.append(hand,discard,facedown,resources);
  target.append(layout);
}
function eventText(e,st){
  const pieces=[String(e?.kind||e||"")];
  if(e?.cardId!=null){const id=String(e.cardId),pid=id.startsWith("p1")?1:2;const s=cardOf(st,pid,id);if(s)pieces.push(cardName(s));}
  if(e?.choice!=null)pieces.push("選択: "+String(e.choice));
  if(e?.moved!=null)pieces.push("移動: "+String(e.moved));
  if(e?.amount!=null)pieces.push("量: "+String(e.amount));
  if(e?.auraDamage!=null||e?.lifeDamage!=null)pieces.push(String(e.auraDamage??"-")+"/"+String(e.lifeDamage??"-"));
  return pieces.join(" / ");
}
function pendingAttackDisplay(rows,selected,st){
  const responseRules=new Set(["turn-attack-respond","turn-attack-pass","turn-attack-damage","turn-response-effect-choice","turn-use-response"]);
  if(!responseRules.has(String(rows[selected]?.action?.rule||"")))return null;
  for(let i=selected;i>=0;i--){
    const events=rows[i]?.events||[];
    for(let j=events.length-1;j>=0;j--){
      const e=events[j];
      if(e?.kind!=="攻撃開始")continue;
      const attacker=Number(e.attacker);
      const statuses=st["p"+attacker+"_card_status"]||{};
      const found=Object.entries(statuses).find(([,v])=>cardName(v.Slug)===e.label);
      return {pid:attacker,id:found?.[0]||null,label:String(e.label||"攻撃")};
    }
  }
  return null;
}
function render(){
  if(!game)return;
  const rows=stepRows();stepIndex=Math.max(0,Math.min(rows.length-1,stepIndex));
  const entry=rows[stepIndex],st=entry.after,actor=entry.actor;
  const hiddenSide=mode==="human"?3-human:2,hide=!$("revealOpponent").checked;
  sideBoard($("topSide"),st,2,actor,hide&&hiddenSide===2);
  sideBoard($("bottomSide"),st,1,actor,hide&&hiddenSide===1);
  const rawTurn=Number(entry.turn)||0;
  $("position").textContent="間合 "+st.distance+"　ダスト "+st.dust;
  $("moveTitle").textContent=(rawTurn?"T"+Math.ceil(rawTurn/2)+"／"+(rawTurn%2?"先行":"後攻"):"初期局面")+
    "　"+String(entry.action?.label||"マリガン");
  const source=entry.action?.cardId,cardId=String(source??""),pid=cardId.startsWith("p1")?1:2;
  $("currentCard").replaceChildren();
  const attacking=pendingAttackDisplay(rows,stepIndex,st);
  if(attacking){
    const attack=document.createElement("div");attack.className="activeAttackPreview";
    const label=document.createElement("span");label.textContent="処理中の攻撃："+attacking.label;attack.append(label);
    if(attacking.id)attack.append(makeSmallCard(st,attacking.pid,attacking.id));
    $("currentCard").append(attack);
  }
  if(source && cardOf(st,pid,source)){
    const item=document.createElement("div");item.className="activeCardPreview";
    if(attacking){const tag=document.createElement("span");tag.textContent="対応札";item.append(tag);}
    item.append(makeSmallCard(st,pid,source));$("currentCard").append(item);
  }
  $("eventLog").textContent=(entry.events||[]).map(e=>eventText(e,st)).join("\n");
  const full=game.done?("勝者: "+(game.winner===1?"扇槌":"刀薙")+" ／ "+game.doneReason):"対戦途中";
  $("matchSummary").textContent=full+" ／ "+game.history.length+"操作 ／ 初期間合10・ダスト0・手札3";
  $("stepCount").textContent=stepIndex+"/"+(rows.length-1);
  $("prevStep").disabled=$("firstStep").disabled=stepIndex<=0;
  $("nextStep").disabled=$("lastStep").disabled=stepIndex===rows.length-1;
  $("history").replaceChildren();
  rows.forEach((row,i)=>{
    const btn=document.createElement("button");btn.type="button";btn.className="stepLink"+(i===stepIndex?" current":"");
    btn.textContent=i+" | "+(row.turn?"T"+Math.ceil(row.turn/2)+" ":"")+String(row.action?.label||"初期局面");
    btn.addEventListener("click",()=>{stopReplay();stepIndex=i;render()});$("history").append(btn);
  });
  $("history").querySelector(".current")?.scrollIntoView({block:"nearest"});
  refreshActions();
  loadCurrentReview();
  refreshSaved();
}
function legalForControl(){
  if(!engine||engine.done||stepIndex!==game.history.length)return [];
  if(mode==="human"&&engine.currentPlayer()!==human)return [];
  if(mode!=="human"&&mode!=="manual")return [];
  return engine.legalActions();
}
function setHint(message){$("operationHint").textContent=message;}
function describeAction(action){
  let label=String(action.label||action.kind||action.rule||"");
  if(action.cost?.type==="facedown"&&action.cost.cardId!=null){
    const pid=engine.currentPlayer(),slug=cardOf(engine.state,pid,action.cost.cardId);
    label+="（"+cardName(slug)+"を伏せる）";
  }else if(action.cost?.type==="focus")label+="（集中力）";
  if(action.rule==="turn-main-enhancement-choice"){
    const found=/^d(\d+):a(\d+)$/.exec(String(action.choice||""));
    if(found)label="付与：ダスト"+Number(found[1])+"・オーラ"+Number(found[2]);
  }
  if(action.rule==="turn-use-card"&&action.cardId!=null){
    const slug=cardOf(engine.state,engine.currentPlayer(),action.cardId);label="カード使用："+cardName(slug);
  }
  if(action.rule==="turn-attack-respond"&&action.cardId!=null){
    const slug=cardOf(engine.state,engine.currentPlayer(),action.cardId);label="対応："+cardName(slug);
  }
  return label;
}
function refreshActions(){
  const legal=legalForControl(),active=legal.length>0;
  $("legalAction").replaceChildren();
  for(const [i,action] of legal.entries()){
    const option=document.createElement("option");option.value=String(i);
    option.textContent=describeAction(action);$("legalAction").append(option);
  }
  $("legalAction").disabled=$("performAction").disabled=!active;
  const phaseBtns=[["phaseStandard","turn-main-standard"],["phaseFull","turn-main-fullpower"],["phaseEnd","sandbox-end-turn"]];
  for(const [id,rule]of phaseBtns){
    const button=$(id),can=legal.some(x=>x.rule===rule);button.disabled=!can;
    button.classList.toggle("available",can);
  }
  for(const [id,choice] of [["damageAura","aura"],["damageLife","life"]]){
    const button=$(id),available=legal.some(a=>a.rule==="turn-attack-damage"&&a.damageChoice===choice);
    button.disabled=!available;button.classList.toggle("available",available);
  }
  for(const button of $("basicToolbar").querySelectorAll("button[data-basic]")){
    const kind=Number(button.dataset.basic);
    const available=legal.some(a=>a.rule==="core-standard-basic"&&Number(a.basicAction)===kind)||
      legal.some(a=>a.rule==="turn-main-standard");
    button.disabled=!available;
    button.classList.toggle("available",available);
    button.classList.toggle("pending",pendingBasic===kind);
  }
}
function synchronizeFromEngine(){
  if(!engine)return;
  game.history=clone(engine.history);
  game.done=engine.done;game.winner=engine.winner;game.doneReason=engine.doneReason;
  if(mode==="human")advanceAI();
  stepIndex=game.history.length;
  render();
}
function commitAction(action){
  if(!engine||!action)throw Error("実行可能な行動がありません");
  engine.step(action);
  pendingFoldCard=null;pendingBasic=null;
  $("playError").textContent="";
  setHint("基本動作はボタン、カードは手札から使用欄へドラッグ。伏せ札へのドラッグ後は基本動作を選択してください。");
  synchronizeFromEngine();
}
function playPhase(rule){
  const found=legalForControl().find(a=>a.rule===rule);
  if(!found){$("playError").textContent="現在このフェイズ行動は実行できません。";return;}
  try{commitAction(found)}catch(e){$("playError").textContent=String(e.message||e);}
}
function previewWithPhase(phase,matching){
  const sim=new CoreTurnSandboxEnvironment(game.initial,game.opts);
  for(const entry of engine.history)sim.step(entry.action);
  sim.step(phase);
  return sim.legalActions().find(matching)||null;
}
function performBasic(kind,cardId=null){
  if(!engine||!legalForControl().length)return false;
  let choices=legalForControl(),wanted=choices.find(a=>a.rule==="core-standard-basic"&&
    Number(a.basicAction)===kind&&(
      cardId!=null ? a.cost?.type==="facedown"&&String(a.cost.cardId)===String(cardId)
                   : a.cost?.type==="focus"
    ));
  const phase=choices.find(a=>a.rule==="turn-main-standard");
  try{
    if(!wanted&&phase){
      wanted=previewWithPhase(phase,a=>a.rule==="core-standard-basic"&&
        Number(a.basicAction)===kind&&(
          cardId!=null?a.cost?.type==="facedown"&&String(a.cost.cardId)===String(cardId)
                      :a.cost?.type==="focus"
        ));
      if(wanted){
        engine.step(phase);
        wanted=engine.legalActions().find(a=>a.rule==="core-standard-basic"&&
          Number(a.basicAction)===kind&&
          (cardId!=null?a.cost?.type==="facedown"&&String(a.cost.cardId)===String(cardId):a.cost?.type==="focus"));
      }
    }
    if(!wanted)return false;
    commitAction(wanted);return true;
  }catch(error){$("playError").textContent=String(error.message||error);return false;}
}
function clickBasic(kind){
  if(!legalForControl().length)return;
  if(pendingFoldCard){
    if(performBasic(kind,pendingFoldCard))return;
    $("playError").textContent="このカードを伏せて「"+({1:"前進",2:"後退",3:"纏い",4:"宿し",5:"離脱"}[kind]||kind)+"」は実行できません。";
    return;
  }
  if(performBasic(kind))return;
  const phase=legalForControl().find(a=>a.rule==="turn-main-standard");
  let facedownLegal=legalForControl().some(a=>a.rule==="core-standard-basic"&&Number(a.basicAction)===kind&&a.cost?.type==="facedown");
  if(!facedownLegal&&phase)facedownLegal=!!previewWithPhase(phase,a=>a.rule==="core-standard-basic"&&Number(a.basicAction)===kind&&a.cost?.type==="facedown");
  if(facedownLegal){
    pendingBasic=kind;$("playError").textContent="";
    setHint("「"+({1:"前進",2:"後退",3:"纏い",4:"宿し",5:"離脱"}[kind]||kind)+"」を選択中です。伏せる手札を右端の伏せ札欄へドラッグしてください。");
    refreshActions();
  }else $("playError").textContent="この基本動作は現在実行できません。";
}
function foldCard(pid,id){
  if(!canControl(pid))return;
  if(!(engine.state["p"+pid+"_hand"]||[]).includes(id)){
    $("playError").textContent="手札からのみ伏せられます。";return;
  }
  if(pendingBasic){
    if(performBasic(pendingBasic,id))return;
    $("playError").textContent="この札を伏せた場合、選んだ基本動作は実行できません。";
    return;
  }
  const legal=legalForControl();
  const usable=legal.some(a=>a.rule==="core-standard-basic"&&a.cost?.type==="facedown"&&String(a.cost.cardId)===id)||
    legal.some(a=>a.rule==="turn-main-standard");
  if(!usable){$("playError").textContent="現在、この手札を伏せて基本動作を行えません。";return;}
  pendingFoldCard=id;$("playError").textContent="";
  const slug=cardOf(engine.state,pid,id);
  setHint("「"+cardName(slug)+"」を伏せる札に指定しました。上の基本動作ボタンを押すと伏せ札に移して実行します。");
  render();
}
function useCard(pid,id){
  if(!canControl(pid))return;
  if(!(engine.state["p"+pid+"_hand"]||[]).includes(id)&&
     !(engine.state["p"+pid+"_special"]||[]).includes(id)){
    $("playError").textContent="手札または切札から使用してください。";return;
  }
  const slug=cardOf(engine.state,pid,id),rule=reg.get(slug)?.mainUse;
  if(!rule){$("playError").textContent="使用できないカードです。";return;}
  const legal=legalForControl();
  let move=legal.find(a=>["turn-use-card","turn-attack-respond"].includes(a.rule)&&String(a.cardId)===id);
  const phaseRule=rule.fullPower?"turn-main-fullpower":"turn-main-standard";
  const phase=legal.find(a=>a.rule===phaseRule);
  try{
    if(!move &&phase){
      const candidate=previewWithPhase(phase,a=>a.rule==="turn-use-card"&&String(a.cardId)===id);
      if(candidate){
        engine.step(phase);
        move=engine.legalActions().find(a=>a.rule==="turn-use-card"&&String(a.cardId)===id);
      }
    }
    if(!move){$("playError").textContent="「"+cardName(slug)+"」は現在使用できません（間合・コスト・行動種類を確認）。";return;}
    commitAction(move);
  }catch(e){$("playError").textContent=String(e.message||e);}
}
function chooseMove(){
  const legal=legalForControl();
  const action=legal[Number($("legalAction").value)];
  if(!action){$("playError").textContent="合法手を選択してください。";return;}
  try{commitAction(action)}catch(e){$("playError").textContent=String(e.message||e);}
}
function advanceAI(){
  if(!engine)return;
  let iterations=0;
  while(!engine.done && engine.currentPlayer()!==human && mode==="human"){
    if(++iterations>400){$("playError").textContent="AIの連続手数上限です";break;}
    const pid=engine.currentPlayer(),legal=engine.legalActions();
    if(!legal.length)throw Error("AIの合法手がありません");
    const chosen=agent.chooseAction({playerId:pid,observation:engine.observe(pid),legalActions:clone(legal),actionIndex:engine.history.length});
    engine.step(chosen);
  }
  game.history=clone(engine.history);game.done=engine.done;game.winner=engine.winner;game.doneReason=engine.doneReason;
}
function branchAt(step,branchMode){
  try{
    stopReplay();if(!game)throw Error("対戦データがありません");
    const rows=stepRows(),selected=rows[Math.max(0,Math.min(rows.length-1,step))];
    const env=new CoreTurnSandboxEnvironment(game.initial,game.opts);
    if(JSON.stringify(env.openingState)!==JSON.stringify(game.openingState))throw Error("初期局面を再現できません");
    for(const prev of game.history.slice(0,step))env.step(prev.action);
    if(JSON.stringify(env.state)!==JSON.stringify(selected.after))throw Error("指定局面の状態に一致しません");
    engine=env;mode=branchMode;human=Number($("humanSide").value)||1;
    agent=new BaselineCoreTurnAgent(game.config.seed*3+999,.18);
    game.history=clone(env.history);game.done=env.done;game.winner=env.winner;game.doneReason=env.doneReason;
    if(mode==="human")advanceAI();
    stepIndex=game.history.length;$("playError").textContent="";render();
  }catch(e){$("playError").textContent=String(e.message||e);}
}
function advanceStep(offset){stopReplay();stepIndex=Math.max(0,Math.min(stepRows().length-1,stepIndex+offset));render();}
function stopReplay(){if(playTimer){clearInterval(playTimer);playTimer=null;$("autoReplay").textContent="自動再生";}}
function download(name,data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2500);
}
function legacySignature(g){return JSON.stringify({chosen:g.config.chosen,first:g.config.first,seed:g.config.seed});}
function storageKey(){return KEY+":"+signature(game);}
function oldStorageKey(){return KEY+":"+legacySignature(game);}
function readSavedList(key){try{const data=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(data)?data:[];}catch{return [];}}
function stored(){
  // Preserve earlier saved branches after extending the game key with manual mulligan choices.
  const entries=[...readSavedList(oldStorageKey()),...readSavedList(storageKey())];
  return [...new Map(entries.filter(x=>typeof x?.id==="string").map(x=>[x.id,x])).values()];
}
function refreshSaved(){
  if(!game)return;
  const previous=$("savedBranches").value;$("savedBranches").replaceChildren();
  for(const node of stored()){const opt=document.createElement("option");opt.value=node.id;opt.textContent=(node.config?.mulliganChoices==null?"旧対戦 / ":"")+node.id+" / "+node.actions.length+"手";$("savedBranches").append(opt);}
  if([...$("savedBranches").options].some(x=>x.value===previous))$("savedBranches").value=previous;
}
function saveBranch(){
  if(!game)return;
  try{
    const list=stored();const at=engine?game.history.length:stepIndex;
    const actions=game.history.slice(0,at).map(x=>clone(x.action));
    const lastState=at?game.history[at-1].after:game.openingState;
    const item={id:String(Date.now())+"-"+Math.floor(Math.random()*1000),config:game.config,
      actions,mode,human,signature:JSON.stringify(lastState),createdAt:new Date().toISOString()};
    list.push(item);localStorage.setItem(storageKey(),JSON.stringify(list));refreshSaved();$("savedBranches").value=item.id;
    $("playError").textContent="分岐を保存しました";
  }catch(e){$("playError").textContent=String(e.message||e);}
}
function openBranch(node){
  if(!node||!Array.isArray(node.actions)||node.actions.length>3500)throw Error("分岐の行動数が不正です");
  const g=makeGame(node.config),env=new CoreTurnSandboxEnvironment(g.initial,g.opts);g.openingState=clone(env.openingState);
  for(const action of node.actions)env.step(action);
  if(JSON.stringify(env.state)!==node.signature)throw Error("保存した分岐と再計算した局面が異なります");
  game=g;engine=env;mode=node.mode==="manual"?"manual":node.mode==="human"?"human":"manual";
  human=Number(node.human)||1;g.history=clone(env.history);g.done=env.done;g.winner=env.winner;g.doneReason=env.doneReason;
  agent=new BaselineCoreTurnAgent(g.config.seed*3+999,.18);
  stepIndex=g.history.length;setView();render();
}
function exportBranches(){
  if(!game)return;
  if(!stored().length)saveBranch();
  download("furuyoni_eye_branches.json",{kind:"furuyoni-eye-branches",version:1,config:game.config,branches:stored()});
}
async function importBranches(file){
  try{
    const json=JSON.parse(await file.text());
    if(json.kind!=="furuyoni-eye-branches"||json.version!==1||!Array.isArray(json.branches))
      throw Error("この画面の分岐JSONではありません");
    const first=json.branches[0];
    if(first && JSON.stringify(first.config)!==JSON.stringify(json.config))throw Error("構築が一致しません");
    if(!game || signature(game)!==JSON.stringify({chosen:json.config.chosen,first:json.config.first,seed:json.config.seed,mulliganChoices:json.config.mulliganChoices||null})){
      for(const pid of [1,2]){decks[pid].n=new Set(json.config.chosen[pid-1].n);decks[pid].s=new Set(json.config.chosen[pid-1].s);}
      $("firstPlayer").value=String(json.config.first);$("seed").value=String(json.config.seed);refreshDeck();
      game=makeGame(json.config);
    }
    const list=stored(),seen=new Set(list.map(x=>x.id));
    for(const node of json.branches){
      if(node.actions?.length>3500||!Array.isArray(node.actions))throw Error("行動データが不正です");
      // Replay through the rules before retaining any imported branch.
      const g=makeGame(node.config),env=new CoreTurnSandboxEnvironment(g.initial,g.opts);
      for(const action of node.actions)env.step(action);
      if(JSON.stringify(env.state)!==node.signature)throw Error("状態が一致しない分岐が含まれています");
      if(!seen.has(node.id)){list.push(node);seen.add(node.id);}
    }
    localStorage.setItem(storageKey(),JSON.stringify(list));openBranch(list.at(-1));$("playError").textContent="読込完了";
  }catch(e){$("playError").textContent=String(e.message||e);}
}
function feedbackKey(){return KEY+":reviews:"+signature(game);}
function feedbackLoad(){
  const read=(key)=>{try{const data=JSON.parse(localStorage.getItem(key)||"{}");return data&&typeof data==="object"&&!Array.isArray(data)?data:{};}catch{return {}}};
  const legacy=game?.config?.mulliganChoices==null?read(KEY+":reviews:"+legacySignature(game)):{};
  return {...legacy,...read(feedbackKey())};
}
function loadCurrentReview(){
  if(!game)return;
  reviews=feedbackLoad();const v=reviews[stepIndex]||{};
  $("reviewNote").value=String(v.note||"");
}
function review(verdict){
  if(!game)return;
  reviews=feedbackLoad();
  reviews[stepIndex]={verdict:verdict??reviews[stepIndex]?.verdict??"",note:$("reviewNote").value,
    turn:stepRows()[stepIndex]?.turn,action:stepRows()[stepIndex]?.action?.label||"初期局面"};
  localStorage.setItem(feedbackKey(),JSON.stringify(reviews));
}
function exportFeedback(){if(!game)return;review();download("furuyoni_eye_feedback.json",
  {kind:"furuyoni-eye-feedback",version:1,config:game.config,review:feedbackLoad()});}

$("preset1").addEventListener("click",()=>setPreset(1));$("preset2").addEventListener("click",()=>setPreset(2));
for(const p of [1,2])$("clear"+p).addEventListener("click",()=>{decks[p].n.clear();decks[p].s.clear();refreshDeck()});
$("startAIVsAI").addEventListener("click",beginAIMatch);
$("startHumanVsAI").addEventListener("click",beginHumanMatch);
$("confirmMulligan").addEventListener("click",confirmMulligan);
$("backToBuilder").addEventListener("click",()=>{$("mulliganPane").classList.add("hidden");$("builder").classList.remove("hidden");});

$("backToDeck").addEventListener("click",()=>{stopReplay();$("replayPane").classList.add("hidden");$("builder").classList.remove("hidden");});
$("revealOpponent").addEventListener("change",render);
$("firstStep").addEventListener("click",()=>{stopReplay();stepIndex=0;render()});
$("prevStep").addEventListener("click",()=>advanceStep(-1));
$("nextStep").addEventListener("click",()=>advanceStep(1));
$("lastStep").addEventListener("click",()=>{stopReplay();stepIndex=stepRows().length-1;render()});
$("autoReplay").addEventListener("click",()=>{
  if(playTimer){stopReplay();return;}
  if(stepIndex>=stepRows().length-1)stepIndex=0;
  $("autoReplay").textContent="停止";
  playTimer=setInterval(()=>{if(stepIndex>=stepRows().length-1){stopReplay();return}stepIndex++;render()},600);
});
$("branchManual").addEventListener("click",()=>branchAt(stepIndex,"manual"));
$("branchHumanAI").addEventListener("click",()=>branchAt(stepIndex,"human"));
$("performAction").addEventListener("click",chooseMove);
$("phaseStandard").addEventListener("click",()=>playPhase("turn-main-standard"));
$("phaseFull").addEventListener("click",()=>playPhase("turn-main-fullpower"));
$("phaseEnd").addEventListener("click",()=>playPhase("sandbox-end-turn"));
for(const [id,choice] of [["damageAura","aura"],["damageLife","life"]]){
  $(id).addEventListener("click",()=>{
    const move=legalForControl().find(a=>a.rule==="turn-attack-damage"&&a.damageChoice===choice);
    if(move)try{commitAction(move)}catch(e){$("playError").textContent=String(e.message||e);}
  });
}

for(const button of $("basicToolbar").querySelectorAll("button[data-basic]")){
  button.addEventListener("click",()=>clickBasic(Number(button.dataset.basic)));
}

$("saveBranch").addEventListener("click",saveBranch);
$("loadBranch").addEventListener("click",()=>{try{const node=stored().find(x=>x.id===$("savedBranches").value);if(node)openBranch(node)}catch(e){$("playError").textContent=String(e.message||e)}});
$("exportBranch").addEventListener("click",exportBranches);
$("importBranch").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",async e=>{if(e.target.files?.[0])await importBranches(e.target.files[0]);e.target.value=""});
for(const [id,val]of [["good","ok"],["bad","bad"],["unsure","uncertain"]])$(id).addEventListener("click",()=>review(val));
$("saveReview").addEventListener("click",()=>review());
$("exportReview").addEventListener("click",exportFeedback);
window.addEventListener("keydown",e=>{
  if(["INPUT","TEXTAREA","SELECT"].includes(e.target?.tagName)||!game||$("replayPane").classList.contains("hidden"))return;
  if(e.key==="ArrowLeft"){e.preventDefault();advanceStep(-1);}
  if(e.key==="ArrowRight"){e.preventDefault();advanceStep(1);}
});
refreshDeck();
