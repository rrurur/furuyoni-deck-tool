"use strict";
// Run: node r/replay-editor-regression.cjs
// Replay editor acceptance contract: editable mulligan, AP/basic buttons,
// card drag, branch round-trip, and no public AI navigation.
const assert=require("assert").strict,fs=require("fs"),path=require("path");
const root=__dirname;
const main=fs.readFileSync(path.join(root,"eye-261012-q1.js"),"utf8");
const html=fs.readFileSync(path.join(root,"eye-261012-q1.html"),"utf8");
const css=fs.readFileSync(path.join(root,"replay-editor-shared.css"),"utf8");
const core=fs.readFileSync(path.join(root,"engine-261012-q1.js"),"utf8");
const api=new Function(core.replace(/\bexport\s+/g,"")+"\nreturn {createDefaultCardRuleRegistry,CoreTurnSandboxEnvironment,runCoreTurnSandbox,BaselineCoreTurnAgent};")();
const requiredIds=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
assert.equal(requiredIds.length,new Set(requiredIds).size,"Duplicate HTML IDs");
for(const m of main.matchAll(/\$\("([^"]+)"\)/g))assert(requiredIds.includes(m[1]),"Unmatched UI node "+m[1]);
for(const item of ["mulliganPane","basicToolbar","mulliganCards1","mulliganCards2","revealOpponent","reconstructPanel","enhancePlacement","attackDecision","fullPowerChoice","enhanceConfirm","responsePass","phaseEnd"])assert(requiredIds.includes(item));
for(const selector of [".playerLayout",".resourceDock",".dropArea",".mulliganCard",".pendingFoldDrop",".deckBack",".smallCard.zoneFacedown",".resourceStat.flare .resourceNum",".resourceStat.life .resourceNum"])assert(css.includes(selector),selector);
const page=fs.readFileSync(path.join(root,"..","index.html"),"utf8");
assert(!page.includes("eye-261012-q1.html"),"A development-only entrance leaked to public index");
class ClassList{
 constructor(){this.set=new Set()}
 add(n){this.set.add(n)}remove(n){this.set.delete(n)}contains(n){return this.set.has(n)}
 toggle(n,on){if(on)this.add(n);else this.remove(n)}
}
class Node{
 constructor(tag="div",id=""){this.id=id;this.tagName=tag.toUpperCase();this.listeners={};this.children=[];this.options=[];this.style={};this.dataset={};this.classList=new ClassList();this.checked=false;this.disabled=false;this.textContent="";this.value=id==="seed"?"30506":(["firstPlayer","humanSide"].includes(id)?"1":"");}
 append(...nodes){for(const node of nodes){this.children.push(node);if(this.tagName==="SELECT"){this.options.push(node);if(this.options.length===1)this.value=node.value||"";}}}
 replaceChildren(...items){this.children=[];this.options=[];this.append(...items)}
 addEventListener(event,handler){this.listeners[event]=handler}
 querySelector(which){return which===".current"?this.children.find(c=>c.classList.contains("current"))||null:null}
 querySelectorAll(which){return which==="button[data-basic]"?this.buttons||[]:[]}
 scrollIntoView(){}setAttribute(){}replaceWith(){}remove(){}
}
function mount(){
 const nodes=new Map(requiredIds.map(id=>[id,new Node("div",id)]));
 for(const id of ["seed","firstPlayer","humanSide","savedBranches","legalAction"])nodes.get(id).tagName=id==="seed"?"INPUT":"SELECT";
 nodes.get("basicToolbar").buttons=Array.from({length:5},(_,i)=>{const b=new Node("button");b.dataset.basic=String(i+1);return b});
 const document={getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),body:new Node("body")};
 const stored=new Map(),localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
 const fn=new Function("createDefaultCardRuleRegistry","CoreTurnSandboxEnvironment","runCoreTurnSandbox","BaselineCoreTurnAgent","document","window","localStorage","setInterval","clearInterval","URL","Blob",
   main.replace(/^import [^\n]*\n/g,"")+"\nreturn {setPreset,prepareMulligan,confirmMulligan,mulliganState:()=>mulliganSession,engineState:()=>engine,gameState:()=>game,stepIndexState:()=>stepIndex,clickBasic,foldCard,branchAt,makeDropZone,saveBranch,stored,openBranch,pendingAttackDisplay,parseEnhanceAction,useCard,
     injectFixture:(env)=>{game={config:{chosen:[{n:[],s:[]},{n:[],s:[]}],first:1,seed:99},initial:env.initialState,opts:env.options,openingState:env.openingState,history:clone(env.history),done:false,winner:null,doneReason:""};engine=env;mode="manual";stepIndex=env.history.length;render();}};");
 const app=fn(api.createDefaultCardRuleRegistry,api.CoreTurnSandboxEnvironment,api.runCoreTurnSandbox,api.BaselineCoreTurnAgent,
   document,{addEventListener(){}},localStorage,()=>1,()=>{},{createObjectURL(){},revokeObjectURL(){}},class BlobStub{});
 app.setPreset(1);app.setPreset(2);
 return {app,nodes};
}
{
 const {app,nodes}=mount();
 app.prepareMulligan("ai");
 nodes.get("mulliganCards1").children[1].listeners.click();
 nodes.get("mulliganCards2").children[0].listeners.click();
 app.confirmMulligan();
 const game=app.gameState();
 assert(game.done&&game.history.length>0,"AI game did not finish");
 assert.equal(app.stepIndexState(),0,"Replay should open on initial position");
 assert.equal(game.config.mulliganChoices[1].length,1);
 assert.equal(game.config.mulliganChoices[2].length,1);
 const damageIndex=game.history.findIndex(e=>e.action?.rule==="turn-attack-damage");
 if(damageIndex>=0){
   const rows=[{action:null,after:game.openingState,events:[]},...game.history];
   const attacker=app.pendingAttackDisplay(rows,damageIndex+1,rows[damageIndex+1].after);
   assert(attacker?.label,"Attack card should stay identifiable during aura/life decision");
 }
 assert(requiredIds.includes("damageAura")&&requiredIds.includes("damageLife"),"Missing one-click damage buttons");
 const index=game.history.findIndex(e=>e.action?.rule==="turn-use-card"&&e.phase==="main"&&Number(e.actor)===1);
 assert(index>=0,"No testable card action found");
 const used=game.history[index].action;
 app.branchAt(index,"manual");
 assert.equal(app.engineState().history.length,index);
 const drop=app.makeDropZone(1,"play");
 drop.listeners.drop({preventDefault(){},dataTransfer:{getData:()=> "1:"+used.cardId}});
 assert.equal(app.gameState().history[index].action.cardId,used.cardId,"Drag to play did not perform legal card use");
 app.saveBranch();
 assert(app.stored().length);
 const count=app.gameState().history.length;
 app.openBranch(app.stored()[0]);
 assert.equal(app.gameState().history.length,count,"Saved branch did not restore");
}
{
 const {app,nodes}=mount();
 app.prepareMulligan("human");
 const initial=app.mulliganState().preview.p1_hand.slice();
 nodes.get("mulliganCards1").children[0].listeners.click();
 app.confirmMulligan();
 assert(!app.gameState().openingState.p1_hand.includes(initial[0]),"Selected card was not mulliganed");
 const env=app.engineState(),card=env.state.p1_hand[0];
 app.clickBasic(1);
 assert.equal(env.history.length,0,"First turn focus=0 should require choosing a hand card");
 app.foldCard(1,card);
 assert.equal(env.history.at(-1).action.label,"前進");
 assert(env.state.p1_facedown.includes(card),"Cost card must move to facedown");
}
{
 const {app,nodes}=mount();
 nodes.get("firstPlayer").value="2";
 app.prepareMulligan("human");app.confirmMulligan();
 const env=app.engineState(),before=env.history.length,focus=env.state.p1_focus;
 assert.equal(focus,1);
 app.clickBasic(1);
 assert.equal(env.history.length,before+2,"Focus button must auto-select standard mode and advance");
 assert.equal(env.state.p1_focus,focus-1);
}
// Contextual enhancement decision uses "enhance:d#:a#" wire keys, not raw d#:a#.
assert.equal(main.includes('$("phaseStandard")'),false,"Do not show explicit standard/fullpower mode buttons");
{
 const {app,nodes}=mount();
 assert.equal(app.parseEnhanceAction({rule:"turn-main-enhancement-choice",choice:"enhance:d2:a0"}).dust,2);
 const state={distance:7,dust:2};
 for(const pid of [1,2]){
   const p="p"+pid+"_";
   for(const zone of ["hand","deck","discard","facedown","special","enhancement","using","outside"])state[p+zone]=[];
   state[p+"card_status"]={};state[p+"special_status"]={};
   Object.assign(state,{[p+"life"]:10,[p+"aura"]:3,[p+"flare"]:0,[p+"focus"]:0,[p+"freeze"]:0,[p+"chara_ids"]:pid===1?[4,8]:[1,2]});
 }
 state.p1_hand=["p1n0"];
 state.p1_card_status.p1n0={Slug:"re_04_tokoyo_o_n_7",MainType:3,SubType:0,IsSpecial:false,Charge:0,TokenCharges:{}};
 const env=new api.CoreTurnSandboxEnvironment(state,{startingPlayer:1,openingSetup:false,turnsTaken:{1:1,2:1},randomizeHiddenDecks:false,maxTurns:12});
 env.step(env.legalActions().find(x=>x.rule==="turn-main-standard"));
 env.step(env.legalActions().find(x=>x.rule==="turn-use-card"&&x.cardId==="p1n0"));
 app.injectFixture(env);
 assert.equal(nodes.get("enhancePlacement").classList.contains("hidden"),false);
 assert.equal(nodes.get("enhanceDust").textContent,"2","Must default to maximum available dust");
 assert.equal(nodes.get("enhanceAura").textContent,"0");
 nodes.get("enhanceLessDust").listeners.click();
 assert.equal(nodes.get("enhanceDust").textContent,"1");
 nodes.get("enhanceConfirm").listeners.click();
 assert.equal(env.state.dust,1);
 assert.equal(env.state.p1_aura,2);
}
{
 const {app,nodes}=mount();
 app.prepareMulligan("ai");app.confirmMulligan();
 const g=app.gameState(),idx=g.history.findIndex(x=>x.action?.rule==="turn-reconstruct");
 assert(idx>=0,"Fixture must contain a reconstruction");
 app.branchAt(idx,"manual");
 assert.equal(nodes.get("reconstructPanel").classList.contains("hidden"),false);
 const before=app.engineState().history.length;
 nodes.get("reconstructNo").listeners.click();
 assert.equal(app.engineState().history.length,before+1);
}
{
 const {app,nodes}=mount();
 const state={distance:5,dust:0};
 for(const pid of [1,2]){
   const p="p"+pid+"_";
   for(const zone of ["hand","deck","discard","facedown","special","enhancement","using","outside"])state[p+zone]=[];
   state[p+"card_status"]={};state[p+"special_status"]={};
   Object.assign(state,{[p+"life"]:10,[p+"aura"]:3,[p+"flare"]:0,[p+"focus"]:0,[p+"freeze"]:0,[p+"chara_ids"]:pid===1?[15,1]:[1,2]});
 }
 state.p1_hand=["p1n0"];state.p1_card_status.p1n0={Slug:"re_15_korunu_o_n_5",MainType:2,SubType:1,IsSpecial:false,Charge:0,TokenCharges:{}};
 const env=new api.CoreTurnSandboxEnvironment(state,{startingPlayer:1,openingSetup:false,turnsTaken:{1:1,2:1},randomizeHiddenDecks:false,maxTurns:12});
 app.injectFixture(env);app.useCard(1,"p1n0");
 assert.equal(nodes.get("fullPowerChoice").classList.contains("hidden"),false,"Only fullPowerize text opens a mode choice");
 nodes.get("fullPowerNormal").listeners.click();
 assert(env.history.some(x=>x.action.rule==="turn-main-standard"),"Normal Korunu card selects standard action implicitly");
}
console.log("PASS replay editor: manual mulligan, focus and facedown basics, drag play, saved branch and private placement");
