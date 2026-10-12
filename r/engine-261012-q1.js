const PRIVATE_OPPONENT_ZONES = new Set(["hand","deck","facedown","outside","special"]);
const PUBLIC_OPPONENT_ZONES = ["discard","enhancement","using"];
const OWN_ZONES = ["hand","facedown","discard","special","enhancement","using","outside"];

const REPLAY_ACTION_SUPPORT = {
  1:{name:"カード移動系",area:"カード/コスト",replay:"補助情報を参照",selfPlay:"未実装"},
  2:{name:"トークン移動",area:"盤面資源",replay:"資源状態へ反映",selfPlay:"未実装"},
  5:{name:"基本動作",area:"基本動作",replay:"基本動作として抽出",selfPlay:"実装済み"},
  11:{name:"ターン/フェイズ",area:"進行",replay:"ターン・フェイズへ反映",selfPlay:"未実装"},
  12:{name:"属性変更",area:"状態値",replay:"集中力を一部反映",selfPlay:"未実装"},
  200:{name:"攻撃開始",area:"攻撃",replay:"攻撃コンテキスト開始",selfPlay:"未実装"},
  202:{name:"攻撃終了",area:"攻撃",replay:"攻撃コンテキスト終了",selfPlay:"未実装"},
  205:{name:"カード使用",area:"カード",replay:"非攻撃カード使用を抽出",selfPlay:"未実装"},
  300:{name:"攻撃",area:"攻撃",replay:"攻撃情報を抽出",selfPlay:"未実装"},
  301:{name:"ダメージ選択",area:"ダメージ",replay:"受け方・再構成・焦燥を抽出",selfPlay:"未実装"},
  303:{name:"選択",area:"選択",replay:"選択内容を抽出",selfPlay:"未実装"}
};

function clone(v){
  if(v==null) return v;
  return globalThis.structuredClone ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
function n(v){ const x=Number(v); return Number.isFinite(x)?x:0; }
function arr(v){ return Array.isArray(v)?v.slice():[]; }
function payload(action){
  return Array.isArray(action?.Payload) && action.Payload[1] && typeof action.Payload[1]==="object" ? action.Payload[1] : {};
}
function cardIdFromStep(step){
  const direct=Number(step?.attackDisplay?.cardId)||0;
  if(direct>0) return direct;
  for(const action of step?.raw||[]){
    const p=payload(action),t=Number(action?.ActionType);
    const cid=t===300||t===200 ? Number(p.SourceCardId)||0 : Number(p.CardId)||0;
    if(cid>0) return cid;
  }
  return 0;
}
function basicTypeFromStep(step){
  for(const action of step?.raw||[]){
    if(Number(action?.ActionType)===5){
      const p=payload(action);
      if(Number.isFinite(Number(p.Type))) return Number(p.Type);
    }
  }
  return null;
}
function damageChoiceFromStep(step){
  for(const action of step?.raw||[]){
    if(Number(action?.ActionType)===301){
      const p=payload(action);
      if(Number.isFinite(Number(p.DamageChoose))) return Number(p.DamageChoose);
    }
  }
  return null;
}
export function actionFromReplayStep(step){
  return {
    actor:Number(step?.actor)||Number(step?.turnPlayer)||0,
    kind:String(step?.kind||""),
    label:String(step?.title||""),
    cardId:cardIdFromStep(step)||null,
    basicAction:basicTypeFromStep(step),
    damageChoice:damageChoiceFromStep(step)
  };
}


const BASIC_ACTION_NAMES = {1:"前進",2:"後退",3:"纏い",4:"宿し",5:"離脱"};
const BASIC_RULE_DEFAULTS = {masterDistance:2,auraLimit:5,distanceLimit:10};

function coreRuleOptions(options={}){
  return {
    masterDistance:Number.isFinite(Number(options.masterDistance))?Number(options.masterDistance):BASIC_RULE_DEFAULTS.masterDistance,
    auraLimit:Number.isFinite(Number(options.auraLimit))?Number(options.auraLimit):BASIC_RULE_DEFAULTS.auraLimit,
    distanceLimit:Number.isFinite(Number(options.distanceLimit))?Number(options.distanceLimit):BASIC_RULE_DEFAULTS.distanceLimit
  };
}
function standardBasicCosts(state,playerId){
  const pid=Number(playerId);
  const costs=[];
  if(n(state?.[`p${pid}_focus`])>=1) costs.push({type:"focus"});
  for(const cardId of arr(state?.[`p${pid}_hand`])){
    if(isChikagePoisonCard(state,pid,cardId)) continue;
    costs.push({type:"facedown",cardId});
  }
  return costs;
}
function auraHasRoom(state,playerId,options){
  const pid=Number(playerId);
  return n(state?.[`p${pid}_aura`])+n(state?.[`p${pid}_freeze`])<options.auraLimit;
}
function activeEnhancementRowsBySlug(state,slug,playerId=null){
  const target=normalizeCardSlug(slug);
  const pids=playerId==null?[1,2]:[Number(playerId)];
  const out=[];
  for(const pid of pids){
    for(const cardId of arr(state?.[`p${pid}_enhancement`])){
      if(stateCardSlug(state,pid,cardId)!==target) continue;
      const status=state?.[`p${pid}_card_status`]?.[String(cardId)]||{};
      const tokenCharges=positiveTokenChargeMap(status)||{};
      const total=Object.keys(tokenCharges).length
        ? Object.values(tokenCharges).reduce((sum,x)=>sum+n(x),0)
        : Math.max(0,n(status.Charge));
      if(total>0) out.push({playerId:pid,cardId,status,total});
    }
  }
  return out;
}
function effectiveMasterDistance(state,options){
  const base=Number.isFinite(Number(options?.masterDistance))?Number(options.masterDistance):BASIC_RULE_DEFAULTS.masterDistance;
  return base+activeEnhancementRowsBySlug(state,"re_02_saine_o_n_5").length+megumiReedSeedCount(state);
}
function basicMoveAvailable(state,playerId,basicAction,options){
  const pid=Number(playerId);
  const distance=effectiveCurrentDistance(state),dust=n(state?.dust),aura=n(state?.[`p${pid}_aura`]),freeze=n(state?.[`p${pid}_freeze`]);
  if(String(state?.[`p${pid}_thallya_form`]||"")==="YAKSHA" && n(state?.[`p${pid}_thallya_machine`])<=0) return false;
  const masterDistance=effectiveMasterDistance(state,options);
  const opponent=pid===1?2:1;
  if(basicAction===1 && state?.[`p${pid}_chikage_no_basic_advance`]) return false;
  if((basicAction===2||basicAction===5) && activeEnhancementRowsBySlug(state,"re_09_chikage_o_n_7",opponent).length) return false;
  if(basicAction===1) return distance>masterDistance && distance>0 && auraHasRoom(state,pid,options);
  if(basicAction===2) return aura>0 && distance<options.distanceLimit;
  if(basicAction===3) return dust>0 && auraHasRoom(state,pid,options);
  if(basicAction===4){
    const opponent=pid===1?2:1;
    if(activeEnhancementRowsBySlug(state,"re_15_korunu_o_n_6",opponent).length) return false;
    return freeze>0 || aura>0;
  }
  if(basicAction===5) return dust>0 && distance<=masterDistance && distance<options.distanceLimit;
  return false;
}
function basicRuleActionKey(action){
  return JSON.stringify({
    basicAction:Number(action?.basicAction)||0,
    costType:String(action?.cost?.type||""),
    costCard:action?.cost?.type==="facedown"?String(action?.cost?.cardId??""):""
  });
}

export function generateStandardBasicActions(state,playerId,options={}){
  const pid=Number(playerId);
  if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
  const rule=coreRuleOptions(options);
  const costs=standardBasicCosts(state,pid);
  if(!costs.length) return [];
  const actions=[];
  for(const basicAction of [1,2,3,4,5]){
    if(!basicMoveAvailable(state,pid,basicAction,rule)) continue;
    for(const cost of costs){
      actions.push({
        actor:pid,
        kind:"基本動作",
        label:BASIC_ACTION_NAMES[basicAction],
        basicAction,
        cost:clone(cost),
        rule:"core-standard-basic"
      });
    }
  }
  return actions;
}

export function applyStandardBasicAction(state,playerId,action,options={}){
  const pid=Number(playerId);
  if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
  const legal=generateStandardBasicActions(state,pid,options);
  const key=basicRuleActionKey(action);
  const chosen=legal.find(x=>basicRuleActionKey(x)===key);
  if(!chosen) throw new Error("illegal standard basic action");
  const next=clone(state||{});
  const handKey=`p${pid}_hand`,facedownKey=`p${pid}_facedown`;
  next[handKey]=arr(next[handKey]);
  next[facedownKey]=arr(next[facedownKey]);
  if(chosen.cost.type==="focus"){
    next[`p${pid}_focus`]=Math.max(0,n(next[`p${pid}_focus`])-1);
  }else{
    const index=next[handKey].findIndex(x=>String(x)===String(chosen.cost.cardId));
    if(index<0) throw new Error("basic action cost card is not in hand");
    const [cardId]=next[handKey].splice(index,1);
    next[facedownKey].push(cardId);
  }
  const type=Number(chosen.basicAction);
  if(type===1){
    next.distance=n(next.distance)-1;
    next[`p${pid}_aura`]=n(next[`p${pid}_aura`])+1;
    triggerMegumiWildThornAfterDistanceMove(next,pid,1,coreRuleOptions(options));
  }else if(type===2){
    next[`p${pid}_aura`]=n(next[`p${pid}_aura`])-1;
    next.distance=n(next.distance)+1;
  }else if(type===3){
    next.dust=n(next.dust)-1;
    next[`p${pid}_aura`]=n(next[`p${pid}_aura`])+1;
  }else if(type===4){
    if(n(next[`p${pid}_freeze`])>0) next[`p${pid}_freeze`]=n(next[`p${pid}_freeze`])-1;
    else {
      next[`p${pid}_aura`]=n(next[`p${pid}_aura`])-1;
      next[`p${pid}_flare`]=n(next[`p${pid}_flare`])+1;
    }
  }else if(type===5){
    next.dust=n(next.dust)-1;
    next.distance=n(next.distance)+1;
  }
  return next;
}

function previewEffectBasicAction(state,playerId,basicAction,options={}){
  const pid=Number(playerId),type=Number(basicAction),rule=coreRuleOptions(options);
  if(!basicMoveAvailable(state,pid,type,rule)) return null;
  const next=clone(state||{}),masterDistance=effectiveMasterDistance(next,rule);
  if(type===1){
    if(n(next.distance)>masterDistance && auraHasRoom(next,pid,rule)){
      next.distance=n(next.distance)-1;
      next[`p${pid}_aura`]=n(next[`p${pid}_aura`])+1;
    }
  }else if(type===2){
    if(n(next[`p${pid}_aura`])>0 && n(next.distance)<rule.distanceLimit){
      next[`p${pid}_aura`]=n(next[`p${pid}_aura`])-1;
      next.distance=n(next.distance)+1;
    }
  }else if(type===3){
    if(n(next.dust)>0 && auraHasRoom(next,pid,rule)){
      next.dust=n(next.dust)-1;
      next[`p${pid}_aura`]=n(next[`p${pid}_aura`])+1;
    }
  }else if(type===4){
    if(n(next[`p${pid}_freeze`])>0) next[`p${pid}_freeze`]=n(next[`p${pid}_freeze`])-1;
    else if(n(next[`p${pid}_aura`])>0){
      next[`p${pid}_aura`]=n(next[`p${pid}_aura`])-1;
      next[`p${pid}_flare`]=n(next[`p${pid}_flare`])+1;
    }
  }else if(type===5){
    if(n(next.dust)>0 && n(next.distance)<=masterDistance && n(next.distance)<rule.distanceLimit){
      next.dust=n(next.dust)-1;
      next.distance=n(next.distance)+1;
    }
  }
  return next;
}
function mondoDefenderRepeatPreview(state,attacker,defender,basicAction,options={}){
  const first=previewEffectBasicAction(state,attacker,basicAction,options);
  if(!first) return {canRepeat:false,auraDelta:0};
  const beforeAura=n(first?.[`p${Number(defender)}_aura`]);
  const second=previewEffectBasicAction(first,defender,basicAction,options);
  if(!second) return {canRepeat:false,auraDelta:0};
  return {
    canRepeat:true,
    auraDelta:n(second?.[`p${Number(defender)}_aura`])-beforeAura
  };
}

export class CoreBasicActionRules{
  constructor(options={}){ this.options=coreRuleOptions(options); }
  legalActions(state,playerId){ return generateStandardBasicActions(state,playerId,this.options); }
  apply(state,playerId,action){ return applyStandardBasicAction(state,playerId,action,this.options); }
}


const SANDBOX_END_TURN = "sandbox-end-turn";

function endTurnAction(playerId){
  return {
    actor:Number(playerId),
    kind:"ターン終了",
    label:"ターン終了",
    rule:SANDBOX_END_TURN
  };
}
function sandboxActionKey(action){
  if(action?.rule===SANDBOX_END_TURN) return SANDBOX_END_TURN;
  return basicRuleActionKey(action);
}
function assertSandboxState(state){
  const errors=[];
  if(n(state?.distance)<0) errors.push("distance<0");
  if(n(state?.dust)<0) errors.push("dust<0");
  for(const pid of [1,2]){
    for(const key of ["life","aura","flare","freeze","focus"]){
      if(n(state?.[`p${pid}_${key}`])<0) errors.push(`p${pid}_${key}<0`);
    }
    if(n(state?.[`p${pid}_focus`])>2) errors.push(`p${pid}_focus>2`);
    if(n(state?.[`p${pid}_aura`])+n(state?.[`p${pid}_freeze`])>5) errors.push(`p${pid}_aura+freeze>5`);
  }
  return errors;
}

export class BasicActionSandboxEnvironment{
  constructor(initialState,options={}){
    this.initialState=clone(initialState||{});
    this.ruleExtensions=normalizeRuleExtensions(options.ruleExtensions);
    this.options={
      ...coreRuleOptions(options),
      startingPlayer:Number(options.startingPlayer)===2?2:1,
      maxTurns:Math.max(1,Number(options.maxTurns)||12)
    };
    this.reset();
  }
  reset(){
    this.state=clone(this.initialState);
    this.turnPlayer=this.options.startingPlayer;
    this.turnNumber=1;
    this.completedTurns=0;
    this.actionsInTurn=0;
    this.done=false;
    this.doneReason="";
    this.history=[];
    return this.snapshot();
  }
  currentPlayer(){ return this.done?null:this.turnPlayer; }
  observe(playerId){
    const pid=Number(playerId);
    if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
    return observationForPlayer(this.state,pid,{
      turn:this.turnNumber,
      rawTurn:this.turnNumber,
      turnPlayer:this.turnPlayer,
      phase:"メイン"
    });
  }
  legalActions(playerId=this.turnPlayer){
    if(this.done) return [];
    const pid=Number(playerId);
    if(pid!==this.turnPlayer) return [];
    return [
      ...generateStandardBasicActions(this.state,pid,this.options),
      endTurnAction(pid)
    ];
  }
  beginNextTurn(){
    this.completedTurns++;
    if(this.completedTurns>=this.options.maxTurns){
      this.done=true;
      this.doneReason="turn-limit";
      return;
    }
    this.turnPlayer=this.turnPlayer===1?2:1;
    this.turnNumber++;
    const focusKey=`p${this.turnPlayer}_focus`;
    this.state[focusKey]=Math.min(2,n(this.state[focusKey])+1);
    this.actionsInTurn=0;
  }
  step(action){
    if(this.done) throw new Error("sandbox is already finished");
    const actor=this.turnPlayer;
    const turnBefore=this.turnNumber;
    const legal=this.legalActions(actor);
    const key=sandboxActionKey(action);
    const chosen=legal.find(x=>sandboxActionKey(x)===key);
    if(!chosen) throw new Error("illegal sandbox action");
    const before=clone(this.state);
    if(chosen.rule===SANDBOX_END_TURN) this.beginNextTurn();
    else {
      this.state=applyStandardBasicAction(this.state,actor,chosen,this.options);
      this.actionsInTurn++;
    }
    const invariantErrors=assertSandboxState(this.state);
    if(invariantErrors.length) throw new Error(`sandbox invariant failed: ${invariantErrors.join(", ")}`);
    const entry={
      index:this.history.length,
      turn:turnBefore,
      actor,
      action:clone(chosen),
      before,
      after:clone(this.state),
      endedTurn:chosen.rule===SANDBOX_END_TURN
    };
    this.history.push(entry);
    return {
      ...entry,
      done:this.done,
      doneReason:this.doneReason,
      nextPlayer:this.currentPlayer()
    };
  }
  snapshot(){
    return {
      state:clone(this.state),
      turnPlayer:this.turnPlayer,
      turnNumber:this.turnNumber,
      completedTurns:this.completedTurns,
      done:this.done,
      doneReason:this.doneReason,
      history:clone(this.history)
    };
  }
}

function seededUnit(seed){
  let x=(Number(seed)||1)>>>0;
  return ()=>{
    x=(Math.imul(x,1664525)+1013904223)>>>0;
    return x/4294967296;
  };
}

export class RandomBasicActionAgent{
  constructor(seed=1,endTurnRate=0.22){
    this.random=seededUnit(seed);
    this.endTurnRate=Math.max(0,Math.min(1,Number(endTurnRate)||0));
  }
  chooseAction(context){
    const legal=Array.isArray(context?.legalActions)?context.legalActions:[];
    if(!legal.length) throw new Error("random basic agent received no legal action");
    const end=legal.find(x=>x?.rule===SANDBOX_END_TURN);
    const basics=legal.filter(x=>x?.rule!==SANDBOX_END_TURN);
    if(!basics.length) return clone(end||legal[0]);
    if(end && this.random()<this.endTurnRate) return clone(end);
    return clone(basics[Math.floor(this.random()*basics.length)]);
  }
}


const TURN_RECONSTRUCT = "turn-reconstruct";
const TURN_SKIP_RECONSTRUCT = "turn-skip-reconstruct";
const TURN_FATIGUE_AURA = "turn-fatigue-aura";
const TURN_FATIGUE_LIFE = "turn-fatigue-life";
const TURN_CARD_CHOICE = "turn-card-choice";
const TURN_ATTACK_PASS = "turn-attack-pass";
const TURN_ATTACK_DAMAGE = "turn-attack-damage";
const TURN_ATTACK_RESPOND = "turn-attack-respond";
const TURN_RESPONSE_EFFECT_CHOICE = "turn-response-effect-choice";
const TURN_USE_CARD = "turn-use-card";
const TURN_MAIN_STANDARD = "turn-main-standard";
const TURN_MAIN_FULLPOWER = "turn-main-fullpower";
const TURN_MAIN_ENHANCEMENT_CHOICE = "turn-main-enhancement-choice";
const TURN_MAIN_EFFECT_BASIC = "turn-main-effect-basic";
const TURN_MAIN_EFFECT_CHOICE = "turn-main-effect-choice";
const TURN_RECONSTRUCT_INSTALL = "turn-reconstruct-install";
const TURN_MAIN_ENHANCEMENT_EFFECT_CHOICE = "turn-main-enhancement-effect-choice";
const TURN_SHINRA_PLAN_CHOICE = "turn-shinra-plan-choice";
const TURN_ATTACK_POST_RESPONSE_CHOICE = "turn-attack-post-response-choice";
const TURN_YUKIHI_END_TOGGLE_CHOICE = "turn-yukihi-end-toggle-choice";
const TURN_THALLYA_EXTRA_BASIC = "turn-thallya-extra-basic";
const TURN_KURURU_TRIGGER_BASIC = "turn-kururu-trigger-basic";
const TURN_KURURU_DRAIN_REUSE = "turn-kururu-drain-reuse";

function shuffleWith(random,values){
  const out=arr(values);
  for(let i=out.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}
function startDecisionAction(playerId,rule,label){
  return {actor:Number(playerId),kind:"開始フェイズ",label,rule};
}
function mainModeAction(playerId,rule,label){
  return {actor:Number(playerId),kind:"メインフェイズ開始",label,rule};
}
function turnActionKey(action){
  const rule=String(action?.rule||"");
  if(rule===TURN_CARD_CHOICE){
    return JSON.stringify({
      rule,
      choiceKind:String(action?.choiceKind||""),
      sourceCardId:String(action?.sourceCardId??""),
      choiceCardId:String(action?.choiceCardId??""),
      rairaGauge:String(action?.rairaGauge||"")
    });
  }
  if(rule===TURN_ATTACK_DAMAGE){
    return JSON.stringify({
      rule,
      damageChoice:String(action?.damageChoice||""),
      silentWallUse:Math.max(0,Math.floor(Number(action?.silentWallUse)||0))
    });
  }
  if(rule===TURN_ATTACK_RESPOND){
    return JSON.stringify({rule,cardId:String(action?.cardId??""),rairaGauge:String(action?.rairaGauge||"")});
  }
  if(rule===TURN_RESPONSE_EFFECT_CHOICE){
    return JSON.stringify({rule,choice:String(action?.choice||""),rairaGauge:String(action?.rairaGauge||"")});
  }
  if(rule===TURN_USE_CARD){
    return JSON.stringify({rule,cardId:String(action?.cardId??""),rairaGauge:String(action?.rairaGauge||"")});
  }
  if(rule===TURN_MAIN_ENHANCEMENT_CHOICE){
    return JSON.stringify({rule,choice:String(action?.choice||"")});
  }
  if(rule===TURN_MAIN_EFFECT_BASIC){
    return JSON.stringify({
      rule,
      basicAction:Number(action?.basicAction)||0,
      thallyaBasic:String(action?.thallyaBasic||""),
      finish:!!action?.finish
    });
  }
  if(rule===TURN_MAIN_EFFECT_CHOICE){
    return JSON.stringify({rule,choice:String(action?.choice||""),rairaGauge:String(action?.rairaGauge||"")});
  }
  if(rule===TURN_RECONSTRUCT_INSTALL){
    return JSON.stringify({rule,installMode:String(action?.installMode||""),cardId:String(action?.cardId??""),skip:!!action?.skip,rairaGauge:String(action?.rairaGauge||"")});
  }
  if(rule===TURN_MAIN_ENHANCEMENT_EFFECT_CHOICE){
    return JSON.stringify({rule,choice:String(action?.choice||"")});
  }
  if(rule===TURN_SHINRA_PLAN_CHOICE){
    return JSON.stringify({rule,choice:String(action?.choice||"")});
  }
  if(rule===TURN_ATTACK_POST_RESPONSE_CHOICE){
    return JSON.stringify({rule,choice:String(action?.choice||"")});
  }
  if(rule===TURN_YUKIHI_END_TOGGLE_CHOICE){
    return JSON.stringify({rule,choice:String(action?.choice||"")});
  }
  if(rule===TURN_THALLYA_EXTRA_BASIC){
    return JSON.stringify({
      rule,
      thallyaBasic:String(action?.thallyaBasic||""),
      costType:String(action?.cost?.type||""),
      costCard:action?.cost?.type==="facedown"?String(action?.cost?.cardId??""):""
    });
  }
  if(rule===TURN_KURURU_TRIGGER_BASIC){
    return JSON.stringify({rule,basicAction:Number(action?.basicAction)||0,skip:!!action?.skip});
  }
  if(rule===TURN_KURURU_DRAIN_REUSE){
    return JSON.stringify({rule,use:!!action?.use,rairaGauge:String(action?.rairaGauge||"")});
  }
  if([TURN_MAIN_STANDARD,TURN_MAIN_FULLPOWER,TURN_RECONSTRUCT,TURN_SKIP_RECONSTRUCT,TURN_FATIGUE_AURA,TURN_FATIGUE_LIFE,TURN_ATTACK_PASS,SANDBOX_END_TURN].includes(rule)) return rule;
  return basicRuleActionKey(action);
}
function applyLifeDamage(state,playerId,amount=1){
  const pid=Number(playerId),next=state;
  const value=Math.min(Math.max(0,n(next[`p${pid}_life`])),Math.max(0,n(amount)));
  next[`p${pid}_life`]=Math.max(0,n(next[`p${pid}_life`])-value);
  next[`p${pid}_flare`]=n(next[`p${pid}_flare`])+value;
  return value;
}
function applyAuraDamage(state,playerId,amount=1){
  const pid=Number(playerId),next=state;
  const value=Math.min(Math.max(0,n(next[`p${pid}_aura`])),Math.max(0,n(amount)));
  next[`p${pid}_aura`]=Math.max(0,n(next[`p${pid}_aura`])-value);
  next.dust=n(next.dust)+value;
  return value;
}

function normalizeDamageValue(value){
  if(value==null||value==="-"||value==="－") return null;
  const x=Number(value);
  return Number.isFinite(x)?Math.max(0,Math.floor(x)):null;
}
function normalizeAttackSpec(spec={}){
  return {
    label:String(spec.label||"生成攻撃"),
    sourceCardId:spec.sourceCardId??null,
    sourceSlug:normalizeCardSlug(spec.sourceSlug||""),
    sourceOwnerId:[1,2].includes(Number(spec.sourceOwnerId))?Number(spec.sourceOwnerId):Number(spec.attacker),
    classification:spec.classification==="special"?"special":(spec.classification==="normal"?"normal":null),
    subtype:spec.subtype==="response"?"response":(spec.subtype==="fullpower"?"fullpower":null),
    attacker:Number(spec.attacker),
    defender:Number(spec.defender),
    range:[...new Set(arr(spec.range).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b),
    auraDamage:normalizeDamageValue(spec.auraDamage),
    lifeDamage:normalizeDamageValue(spec.lifeDamage),
    damageMode:spec.damageMode==="both"?"both":"choice",
    damageReplacement:clone(spec.damageReplacement||null),
    shinraDamageSwapped:!!spec.shinraDamageSwapped,
    usedFromFacedown:!!spec.usedFromFacedown,
    unavoidable:!!spec.unavoidable,
    uncancelable:!!spec.uncancelable,
    overcome:!!spec.overcome,
    responseForbidden:!!spec.responseForbidden,
    responseForbiddenAtDistances:[...new Set(arr(spec.responseForbiddenAtDistances).map(Number).filter(Number.isFinite))],
    responseForbiddenClassifications:[...new Set(arr(spec.responseForbiddenClassifications)
      .map(x=>String(x||"").toLowerCase())
      .filter(x=>["normal","special"].includes(x)))],
    canceled:!!spec.canceled,
    damageCanceled:!!spec.damageCanceled,
    attackAfterCanceled:!!spec.attackAfterCanceled,
    dynamicModifiers:arr(spec.dynamicModifiers),
    dynamicModifiersApplied:!!spec.dynamicModifiersApplied,
    afterEachResponseEffects:arr(spec.afterEachResponseEffects),
    afterEffects:arr(spec.afterEffects),
    damageDestination:String(spec.damageDestination||""),
    chikageAnkiFullPower:!!spec.chikageAnkiFullPower,
    thallyaSteamCannonFullPower:!!spec.thallyaSteamCannonFullPower,
    ...(spec.yurinaShinzawatariX==null?{}:{yurinaShinzawatariX:Math.max(0,n(spec.yurinaShinzawatariX))})
  };
}
function megumiReedSeedCount(state,playerId=null){
  return activeEnhancementRowsBySlug(state,"re_19_megumi_o_n_4",playerId)
    .reduce((sum,row)=>sum+Math.max(0,n(row?.status?.TokenCharges?.["19"])),0);
}
function effectiveCurrentDistance(state){
  const reduction=activeEnhancementRowsBySlug(state,"re_09_chikage_o_n_6").length*2;
  const reedIncrease=megumiReedSeedCount(state);
  return Math.max(0,n(state?.distance)-reduction+reedIncrease);
}
function attackInRange(state,attack){
  return arr(attack?.range).map(Number).includes(effectiveCurrentDistance(state));
}
function applyRangeExpansion(attack,near=0,far=0){
  if(!attack) return attack;
  const range=[...new Set(arr(attack.range).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(!range.length) return attack;
  const min=range[0],max=range[range.length-1];
  for(let i=1;i<=Math.max(0,n(near));i++) range.push(min-i);
  for(let i=1;i<=Math.max(0,n(far));i++) range.push(max+i);
  attack.range=[...new Set(range.filter(x=>x>=0))].sort((a,b)=>a-b);
  return attack;
}
function attackSourceMegamiFromSlug(slug){
  const value=normalizeCardSlug(slug);
  const m=/^re_\d+_([a-z0-9]+)(?:_[a-z0-9]+)?_(?:[ons]|tf)_\d+(?:_[a-z0-9]+)*$/i.exec(value);
  return m?String(m[1]).toLowerCase():"";
}
function attackSourceIsYurina(attack){
  return attackSourceMegamiFromSlug(attack?.sourceSlug)==="yurina";
}
function responseCandidates(state,playerId){
  const pid=Number(playerId),status=state?.[`p${pid}_card_status`]||{},specialStatus=state?.[`p${pid}_special_status`]||{};
  const hand=arr(state?.[`p${pid}_hand`]).filter(cardId=>Number(status[String(cardId)]?.SubType)===1);
  const special=arr(state?.[`p${pid}_special`]).filter(cardId=>
    Number(status[String(cardId)]?.SubType)===1 && Number(specialStatus[String(cardId)]||0)!==2
  );
  return [...hand,...special];
}

function cardSourceZoneForResponse(state,playerId,cardId){
  const pid=Number(playerId),id=String(cardId);
  if(arr(state?.[`p${pid}_hand`]).some(x=>String(x)===id)) return "hand";
  if(arr(state?.[`p${pid}_special`]).some(x=>String(x)===id)) return "special";
  return null;
}
function responseCardClassification(state,playerId,cardId){
  const zone=cardSourceZoneForResponse(state,playerId,cardId);
  if(zone==="special") return "special";
  if(zone==="hand") return "normal";
  return null;
}
function attackAllowsResponseClassification(attack,classification){
  if(!attack||attack.responseForbidden) return false;
  const cls=String(classification||"");
  return !arr(attack.responseForbiddenClassifications).map(String).includes(cls);
}

function moveCardToUsingFromZone(state,playerId,cardId,sourceZone){
  const pid=Number(playerId),id=String(cardId),zone=String(sourceZone||"");
  if(!["hand","special","facedown","discard"].includes(zone)) throw new Error("unsupported card source zone");
  const fromKey=`p${pid}_${zone}`,usingKey=`p${pid}_using`;
  state[fromKey]=arr(state[fromKey]);
  state[usingKey]=arr(state[usingKey]);
  const index=state[fromKey].findIndex(x=>String(x)===id);
  if(index<0) throw new Error("card source zone changed");
  const [moved]=state[fromKey].splice(index,1);
  state[usingKey].push(moved);
  if(zone==="special"){
    if(!state[`p${pid}_special_status`]||typeof state[`p${pid}_special_status`]!=="object") state[`p${pid}_special_status`]={};
    state[`p${pid}_special_status`][id]=1;
  }
  return {playerId:pid,cardId:moved,sourceZone:zone};
}
function moveResponseCardToUsing(state,playerId,cardId){
  const pid=Number(playerId),sourceZone=cardSourceZoneForResponse(state,pid,cardId);
  if(!sourceZone) throw new Error("response card is not in hand or special");
  return moveCardToUsingFromZone(state,pid,cardId,sourceZone);
}

function rairaWrapCostReduction(state,playerId,cardId){
  const pid=Number(playerId),id=String(cardId??"");
  if(!id || !arr(state?.[`p${pid}_special`]).some(x=>String(x)===id)) return 0;
  const statusMap=state?.[`p${pid}_special_status`]||{};
  for(const specialId of arr(state?.[`p${pid}_special`])){
    if(Number(statusMap[String(specialId)]||0)!==2) continue;
    if(stateCardSlug(state,pid,specialId)==="re_12_raira_o_s_3_ex2") return 1;
  }
  return 0;
}
function responseCardCost(state,playerId,rule,cardId=null){
  const pid=Number(playerId),cost=rule?.cost;
  if(!cost) return {kind:"none",amount:0};
  const kind=String(cost.kind||"none");
  const baseAmount=Math.max(0,Math.floor(Number(cost.amount)||0));
  let result;
  if(kind==="flare-minus-opponent-aura"){
    const opponent=pid===1?2:1;
    const reduction=Math.max(0,n(state?.[`p${opponent}_aura`]));
    result={kind:"flare",amount:Math.max(0,baseAmount-reduction),baseAmount,reduction,sourceKind:kind};
  }else if(kind==="all-flare"){
    const amount=Math.max(0,n(state?.[`p${pid}_flare`]));
    result={kind:"flare",amount,baseAmount:amount,x:amount,sourceKind:kind};
  }else if(kind==="thallya-transform-count"){
    const amount=Math.max(0,n(state?.[`p${pid}_thallya_transform_count`]));
    result={kind:"flare",amount,baseAmount:amount,x:amount,sourceKind:kind};
  }else result={kind,amount:baseAmount};
  const wrapReduction=result.kind==="flare"?rairaWrapCostReduction(state,pid,cardId):0;
  if(wrapReduction>0){
    result={...result,amount:Math.max(0,n(result.amount)-wrapReduction),rairaWrapReduction:wrapReduction};
  }
  return result;
}
function canPayResponseCardCost(state,playerId,rule,cardId=null){
  const pid=Number(playerId),cost=responseCardCost(state,pid,rule,cardId);
  if(cost.kind==="none"||cost.amount===0) return true;
  if(cost.kind==="flare") return n(state?.[`p${pid}_flare`])>=cost.amount;
  return false;
}
function payResponseCardCost(state,playerId,rule,cardId=null){
  const pid=Number(playerId),cost=responseCardCost(state,pid,rule,cardId);
  if(cost.kind==="none"||cost.amount===0) return {kind:cost.kind,amount:0};
  if(cost.kind==="flare"){
    if(!canPayResponseCardCost(state,pid,rule,cardId)) throw new Error("insufficient flare for response card");
    state[`p${pid}_flare`]=n(state[`p${pid}_flare`])-cost.amount;
    state.dust=n(state.dust)+cost.amount;
    return clone(cost);
  }
  throw new Error(`unsupported response card cost: ${cost.kind}`);
}
function finishResponseCardUse(state,cardUse){
  const pid=Number(cardUse?.playerId),id=String(cardUse?.cardId),usingKey=`p${pid}_using`;
  state[usingKey]=arr(state[usingKey]);
  const index=state[usingKey].findIndex(x=>String(x)===id);
  if(index<0) return {moved:false,destination:"effect-moved"};
  const [moved]=state[usingKey].splice(index,1);
  const status=state?.[`p${pid}_card_status`]?.[id]||state?.[`p${pid===1?2:1}_card_status`]?.[id]||{};
  const poisonSlug=normalizeCardSlug(status?.Slug||"");
  if(!status?.KururuDuplicate && ["re_09_chikage_o_p_1","re_09_chikage_o_p_2"].includes(poisonSlug)){
    const bagOwner=Number(status?.PoisonBagOwner);
    if(bagOwner===1||bagOwner===2){
      const bagKey=`p${bagOwner}_poison_bag`;
      state[bagKey]=arr(state[bagKey]);
      state[bagKey].push(moved);
      return {moved:true,destination:"poison-bag",ownerId:bagOwner};
    }
  }
  if(cardUse?.sourceZone==="special"){
    const specialKey=`p${pid}_special`;
    state[specialKey]=arr(state[specialKey]);
    if(!state[specialKey].some(x=>String(x)===id)) state[specialKey].push(moved);
    if(!state[`p${pid}_special_status`]||typeof state[`p${pid}_special_status`]!=="object") state[`p${pid}_special_status`]={};
    state[`p${pid}_special_status`][id]=2;
    return {moved:true,destination:"special-used"};
  }
  const discardKey=`p${pid}_discard`;
  state[discardKey]=arr(state[discardKey]);
  state[discardKey].push(moved);
  return {moved:true,destination:"discard"};
}

function enhancementPlacementOptions(state,playerId,charge,growth=0,{germinate=false}={}){
  const pid=Number(playerId);
  const maxCharge=Math.max(0,Math.floor(Number(charge)||0));
  const growthLimit=Math.max(0,Math.floor(Number(growth)||0));
  const dust=Math.max(0,n(state?.dust));
  const aura=Math.max(0,n(state?.[`p${pid}_aura`]));
  const bloomed=Math.max(0,n(state?.[`p${pid}_megumi_soil_bloomed`]))+(germinate&&n(state?.[`p${pid}_megumi_soil_unbloomed`])>0?1:0);
  const basePlaced=Math.min(maxCharge,dust+aura+bloomed);
  const minSeedBase=Math.max(0,basePlaced-(dust+aura));
  const maxSeedBase=Math.min(bloomed,basePlaced);
  const out=[];
  for(let seedBaseUsed=minSeedBase;seedBaseUsed<=maxSeedBase;seedBaseUsed++){
    const sakuraPlaced=basePlaced-seedBaseUsed;
    const minDust=Math.max(0,sakuraPlaced-aura);
    const maxDust=Math.min(dust,sakuraPlaced);
    const maxGrowthSeed=Math.min(growthLimit,bloomed-seedBaseUsed);
    for(let growthSeedUsed=0;growthSeedUsed<=maxGrowthSeed;growthSeedUsed++){
      for(let dustUsed=minDust;dustUsed<=maxDust;dustUsed++){
        const seedUsed=seedBaseUsed+growthSeedUsed;
        out.push({dustUsed,auraUsed:sakuraPlaced-dustUsed,seedUsed,seedBaseUsed,growthSeedUsed,placed:basePlaced+growthSeedUsed});
      }
    }
  }
  return out.length?out:[{dustUsed:0,auraUsed:0,seedUsed:0,seedBaseUsed:0,growthSeedUsed:0,placed:0}];
}
function enhancementPlacementKey(option){
  const base=`enhance:d${Math.max(0,n(option?.dustUsed))}:a${Math.max(0,n(option?.auraUsed))}`;
  const seed=Math.max(0,n(option?.seedUsed));
  return seed>0?`${base}:s${seed}`:base;
}
function parseEnhancementPlacementKey(value){
  const m=/^enhance:d(\d+):a(\d+)(?::s(\d+))?$/.exec(String(value||""));
  if(!m) return null;
  const dustUsed=Number(m[1]),auraUsed=Number(m[2]),seedUsed=Number(m[3]||0);
  return {dustUsed,auraUsed,seedUsed,placed:dustUsed+auraUsed+seedUsed};
}
function deployResponseEnhancement(state,cardUse,placement){
  const pid=Number(cardUse?.playerId),id=String(cardUse?.cardId),usingKey=`p${pid}_using`,enhKey=`p${pid}_enhancement`;
  state[usingKey]=arr(state[usingKey]);
  state[enhKey]=arr(state[enhKey]);
  const index=state[usingKey].findIndex(x=>String(x)===id);
  if(index<0) throw new Error("enhancement response card is not in using");
  const [moved]=state[usingKey].splice(index,1);
  const dustUsed=Math.max(0,n(placement?.dustUsed)),auraUsed=Math.max(0,n(placement?.auraUsed)),seedUsed=Math.max(0,n(placement?.seedUsed));
  if(dustUsed>n(state.dust)||auraUsed>n(state[`p${pid}_aura`])||seedUsed>n(state?.[`p${pid}_megumi_soil_bloomed`])) throw new Error("invalid enhancement crystal placement");
  state.dust=n(state.dust)-dustUsed;
  state[`p${pid}_aura`]=n(state[`p${pid}_aura`])-auraUsed;
  state[`p${pid}_megumi_soil_bloomed`]=Math.max(0,n(state[`p${pid}_megumi_soil_bloomed`])-seedUsed);
  state[enhKey].push(moved);
  const status=state?.[`p${pid}_card_status`]?.[id];
  if(!status) throw new Error("missing enhancement response card status");
  status.Charge=dustUsed+auraUsed+seedUsed;
  status.TokenCharges={"1":dustUsed+auraUsed,"19":seedUsed};
  return {playerId:pid,cardId:moved,placed:status.Charge,dustUsed,auraUsed,seedUsed};
}
function triggerMegumiWildThornAfterDistanceMove(state,moverId,moved,options={}){
  const pid=Number(moverId);
  if((pid!==1&&pid!==2)||n(moved)<=0) return 0;
  const owner=pid===1?2:1;
  if(!activeEnhancementRowsBySlug(state,"re_19_megumi_o_n_6",owner).length) return 0;
  const flag=`p${owner}_megumi_wild_triggered_turn`;
  if(state?.[flag]) return 0;
  state[flag]=true;
  const room=Math.max(0,n(options.distanceLimit??10)-n(state.distance));
  const amount=Math.min(1,Math.max(0,n(state.dust)),room);
  if(amount>0){
    state.dust=n(state.dust)-amount;
    state.distance=n(state.distance)+amount;
  }
  return amount;
}
function applyArrowAsMuchAsPossible(state,playerId,kind,count,options={}){
  const pid=Number(playerId);
  const amount=Math.max(0,Math.floor(Number(count)||0));
  const auraKey=`p${pid}_aura`,flareKey=`p${pid}_flare`;
  const auraRoom=Math.max(0,n(options.auraLimit??5)-n(state[auraKey])-n(state?.[`p${pid}_freeze`]));
  const distanceRoom=Math.max(0,n(options.distanceLimit??10)-n(state.distance));
  let moved=0;
  if(kind==="dust-to-distance"){
    moved=Math.min(amount,Math.max(0,n(state.dust)),distanceRoom);
    state.dust=n(state.dust)-moved;
    state.distance=n(state.distance)+moved;
    return moved;
  }
  if(kind==="distance-to-dust"){
    moved=Math.min(amount,Math.max(0,n(state.distance)));
    state.distance=n(state.distance)-moved;
    state.dust=n(state.dust)+moved;
    triggerMegumiWildThornAfterDistanceMove(state,pid,moved,options);
    return moved;
  }
  if(kind==="opponent-aura-to-distance"){
    const opponent=pid===1?2:1;
    const opponentAuraKey=`p${opponent}_aura`;
    moved=Math.min(amount,Math.max(0,n(state[opponentAuraKey])),distanceRoom);
    state[opponentAuraKey]=n(state[opponentAuraKey])-moved;
    state.distance=n(state.distance)+moved;
    return moved;
  }
  if(kind==="distance-to-opponent-aura"){
    const opponent=pid===1?2:1;
    const opponentAuraKey=`p${opponent}_aura`;
    const opponentAuraRoom=Math.max(0,n(options.auraLimit??5)-n(state[opponentAuraKey])-n(state?.[`p${opponent}_freeze`]));
    moved=Math.min(amount,Math.max(0,n(state.distance)),opponentAuraRoom);
    state.distance=n(state.distance)-moved;
    state[opponentAuraKey]=n(state[opponentAuraKey])+moved;
    triggerMegumiWildThornAfterDistanceMove(state,pid,moved,options);
    return moved;
  }
  if(kind==="opponent-aura-to-flare"){
    const opponent=pid===1?2:1;
    const opponentAuraKey=`p${opponent}_aura`,opponentFlareKey=`p${opponent}_flare`;
    moved=Math.min(amount,Math.max(0,n(state[opponentAuraKey])));
    state[opponentAuraKey]=n(state[opponentAuraKey])-moved;
    state[opponentFlareKey]=n(state[opponentFlareKey])+moved;
    return moved;
  }
  if(kind==="opponent-flare-to-aura"){
    const opponent=pid===1?2:1;
    const opponentAuraKey=`p${opponent}_aura`,opponentFlareKey=`p${opponent}_flare`;
    const opponentAuraRoom=Math.max(0,n(options.auraLimit??5)-n(state[opponentAuraKey])-n(state?.[`p${opponent}_freeze`]));
    moved=Math.min(amount,Math.max(0,n(state[opponentFlareKey])),opponentAuraRoom);
    state[opponentFlareKey]=n(state[opponentFlareKey])-moved;
    state[opponentAuraKey]=n(state[opponentAuraKey])+moved;
    return moved;
  }
  if(kind==="opponent-flare-to-distance"){
    const opponent=pid===1?2:1;
    const opponentFlareKey=`p${opponent}_flare`;
    moved=Math.min(amount,Math.max(0,n(state[opponentFlareKey])),distanceRoom);
    state[opponentFlareKey]=n(state[opponentFlareKey])-moved;
    state.distance=n(state.distance)+moved;
    return moved;
  }
  if(kind==="opponent-flare-to-own-aura"){
    const opponent=pid===1?2:1;
    const opponentFlareKey=`p${opponent}_flare`;
    moved=Math.min(amount,Math.max(0,n(state[opponentFlareKey])),auraRoom);
    state[opponentFlareKey]=n(state[opponentFlareKey])-moved;
    state[auraKey]=n(state[auraKey])+moved;
    return moved;
  }
  if(kind==="distance-to-flare"){
    moved=Math.min(amount,Math.max(0,n(state.distance)));
    state.distance=n(state.distance)-moved;
    state[flareKey]=n(state[flareKey])+moved;
    triggerMegumiWildThornAfterDistanceMove(state,pid,moved,options);
    return moved;
  }
  if(kind==="distance-to-life"){
    moved=Math.min(amount,Math.max(0,n(state.distance)));
    state.distance=n(state.distance)-moved;
    state[`p${pid}_life`]=n(state[`p${pid}_life`])+moved;
    triggerMegumiWildThornAfterDistanceMove(state,pid,moved,options);
    return moved;
  }
  if(kind==="dust-to-flare"){
    moved=Math.min(amount,Math.max(0,n(state.dust)));
    state.dust=n(state.dust)-moved;
    state[flareKey]=n(state[flareKey])+moved;
    return moved;
  }
  if(kind==="dust-to-life"){
    moved=Math.min(amount,Math.max(0,n(state.dust)));
    state.dust=n(state.dust)-moved;
    state[`p${pid}_life`]=n(state[`p${pid}_life`])+moved;
    return moved;
  }
  if(kind==="aura-to-distance"){
    moved=Math.min(amount,Math.max(0,n(state[auraKey])),distanceRoom);
    state[auraKey]=n(state[auraKey])-moved;
    state.distance=n(state.distance)+moved;
    return moved;
  }
  if(kind==="distance-to-aura"){
    moved=Math.min(amount,Math.max(0,n(state.distance)),auraRoom);
    state.distance=n(state.distance)-moved;
    state[auraKey]=n(state[auraKey])+moved;
    triggerMegumiWildThornAfterDistanceMove(state,pid,moved,options);
    return moved;
  }
  if(kind==="flare-to-aura"){
    moved=Math.min(amount,Math.max(0,n(state[flareKey])),auraRoom);
    state[flareKey]=n(state[flareKey])-moved;
    state[auraKey]=n(state[auraKey])+moved;
    return moved;
  }
  if(kind==="aura-to-flare"){
    moved=Math.min(amount,Math.max(0,n(state[auraKey])));
    state[auraKey]=n(state[auraKey])-moved;
    state[flareKey]=n(state[flareKey])+moved;
    return moved;
  }
  if(kind==="dust-to-aura"){
    moved=Math.min(amount,Math.max(0,n(state.dust)),auraRoom);
    state.dust=n(state.dust)-moved;
    state[auraKey]=n(state[auraKey])+moved;
    return moved;
  }
  if(kind==="aura-to-dust"){
    moved=Math.min(amount,Math.max(0,n(state[auraKey])));
    state[auraKey]=n(state[auraKey])-moved;
    state.dust=n(state.dust)+moved;
    return moved;
  }
  throw new Error(`unsupported arrow effect: ${kind}`);
}
function baselineResourceOnlyStateChanged(before,after){
  const strip=value=>{
    const row=clone(value||{});
    for(const key of ["distance","dust"]) delete row[key];
    for(const pid of [1,2]){
      for(const key of ["aura","flare","freeze"]) delete row[`p${pid}_${key}`];
    }
    return row;
  };
  return JSON.stringify(strip(before))!==JSON.stringify(strip(after));
}
function baselineResourceOutcomeAp(before,after,playerId){
  const pid=Number(playerId),opp=pid===1?2:1;
  let gain=0,spend=0;
  const ownAura=n(after?.[`p${pid}_aura`])-n(before?.[`p${pid}_aura`]);
  const ownFlare=n(after?.[`p${pid}_flare`])-n(before?.[`p${pid}_flare`]);
  const oppAura=n(after?.[`p${opp}_aura`])-n(before?.[`p${opp}_aura`]);
  const oppFlare=n(after?.[`p${opp}_flare`])-n(before?.[`p${opp}_flare`]);
  const ownFreeze=n(after?.[`p${pid}_freeze`])-n(before?.[`p${pid}_freeze`]);
  const oppFreeze=n(after?.[`p${opp}_freeze`])-n(before?.[`p${opp}_freeze`]);
  if(ownAura>=0) gain+=ownAura; else spend+=-ownAura;
  if(ownFlare>=0) gain+=ownFlare*2; else spend+=(-ownFlare)*2;
  if(oppAura<=0) gain+=-oppAura; else spend+=oppAura;
  if(oppFlare<=0) gain+=(-oppFlare)*2; else spend+=oppFlare*2;
  if(ownFreeze<=0) gain+=-ownFreeze; else spend+=ownFreeze;
  if(oppFreeze>=0) gain+=oppFreeze; else spend+=-oppFreeze;
  const resourceNet=gain-spend;
  const distanceDelta=Math.abs(n(after?.distance)-n(before?.distance));
  const dustDelta=Math.abs(n(after?.dust)-n(before?.dust));
  const spacingEquivalent=Math.max(distanceDelta,dustDelta);
  return Math.max(resourceNet,spacingEquivalent);
}
function baselineApplyResourceArrowBranch(state,playerId,arrow,options){
  const next=clone(state);
  try{
    applyArrowAsMuchAsPossible(next,playerId,String(arrow?.kind||""),arrow?.count??1,options);
  }catch{
    return null;
  }
  if(baselineResourceOnlyStateChanged(state,next)) return null;
  return next;
}
function baselineResourceOnlyMainActionApCeiling(state,playerId,rule,options={}){
  if(rule?.kind!=="action-card") return null;
  if(n(rule?.burn)>0) return null;
  const effects=arr(rule?.effects);
  if(!effects.length) return null;
  const cost=rule?.cost||null;
  if(cost && String(cost.kind||"")!=="flare") return null;
  const costAp=cost?Math.max(0,n(cost.amount))*2:0;
  let branches=[clone(state)];
  const branchArrow=(rows,arrow,optional=false)=>{
    const out=[];
    for(const row of rows){
      if(optional) out.push(clone(row));
      const next=baselineApplyResourceArrowBranch(row,playerId,arrow,options);
      if(!next) return null;
      out.push(next);
    }
    return out;
  };
  for(const effect of effects){
    const kind=String(effect?.kind||"");
    let nextBranches=null;
    if(kind==="choose-arrows"){
      const arrows=arr(effect.arrows);
      if(!arrows.length) return null;
      nextBranches=[];
      for(const row of branches){
        for(const arrow of arrows){
          const next=baselineApplyResourceArrowBranch(row,playerId,arrow,options);
          if(!next) return null;
          nextBranches.push(next);
        }
      }
    }else if(kind==="optional-arrow-if-opponent-aura-no-space"){
      const opponent=Number(playerId)===1?2:1;
      const full=n(state?.[`p${opponent}_aura`])+n(state?.[`p${opponent}_freeze`])>=n(options.auraLimit??5);
      nextBranches=full?branchArrow(branches,effect.arrow,true):branches.map(clone);
      if(!nextBranches) return null;
    }else if(kind==="arrow-if-distance-at-least"){
      nextBranches=n(state?.distance)>=n(effect.value)
        ? branchArrow(branches,effect.arrow,false)
        : branches.map(clone);
      if(!nextBranches) return null;
    }else if(kind==="arrow-if-opponent-flare-at-least"){
      const opponent=Number(playerId)===1?2:1;
      nextBranches=n(state?.[`p${opponent}_flare`])>=n(effect.value)
        ? branchArrow(branches,effect.arrow,false)
        : branches.map(clone);
      if(!nextBranches) return null;
    }else if(kind==="hagane-recoil"){
      nextBranches=[];
      for(const row of branches){
        const arrow={kind:n(row.distance)>=5?"opponent-flare-to-distance":"distance-to-flare",count:1};
        const next=baselineApplyResourceArrowBranch(row,playerId,arrow,options);
        if(!next) return null;
        nextBranches.push(next);
      }
    }else if(kind==="yukihi-step"){
      const umbrellaOpen=!!state?.[`p${Number(playerId)}_yukihi_umbrella_open`];
      nextBranches=branchArrow(branches,{kind:umbrellaOpen?"distance-to-dust":"dust-to-distance",count:1},false);
      if(!nextBranches) return null;
    }else if(kind==="korunu-retarulera-main"){
      const opponent=Number(playerId)===1?2:1;
      const full=n(state?.[`p${opponent}_aura`])+n(state?.[`p${opponent}_freeze`])>=n(options.auraLimit??5);
      nextBranches=full
        ? branches.map(clone)
        : branchArrow(branches,{kind:"distance-to-opponent-aura",count:1},false);
      if(!nextBranches) return null;
    }else{
      return null;
    }
    branches=nextBranches;
  }
  if(!branches.length) return null;
  return Math.max(...branches.map(after=>baselineResourceOutcomeAp(state,after,playerId)-costAp));
}
function baselineBackwardEnablesAttack(state,playerId,action,registry,options={}){
  if(action?.rule!=="core-standard-basic"||Number(action?.basicAction)!==2) return false;
  let next;
  try{ next=applyStandardBasicAction(state,playerId,action,options); }catch{ return false; }
  const pid=Number(playerId);
  const currentDistance=effectiveCurrentDistance(state),nextDistance=effectiveCurrentDistance(next);
  if(nextDistance===currentDistance) return false;
  const specialStatus=next?.[`p${pid}_special_status`]||{};
  const candidates=[
    ...arr(next?.[`p${pid}_hand`]),
    ...arr(next?.[`p${pid}_special`]).filter(cardId=>Number(specialStatus[String(cardId)]||0)!==2)
  ];
  for(const cardId of candidates){
    const slug=stateCardSlug(next,pid,cardId),rule=registry?.get(slug)?.mainUse;
    if(rule?.kind!=="attack-card"||rule.fullPower) continue;
    if(!canPayResponseCardCost(next,pid,rule,cardId)) continue;
    const range=arr(rule?.attack?.range).map(Number).filter(Number.isFinite);
    if(!range.length) continue;
    if(!range.includes(currentDistance)&&range.includes(nextDistance)) return true;
  }
  return false;
}

function baselineBackwardMondoComboTarget(state,playerId,action,registry,options={}){
  if(action?.rule!=="core-standard-basic"||Number(action?.basicAction)!==2) return 0;
  let next;
  try{ next=applyStandardBasicAction(state,playerId,action,options); }catch{ return 0; }
  const pid=Number(playerId);
  const currentDistance=effectiveCurrentDistance(state),nextDistance=effectiveCurrentDistance(next);
  if(currentDistance>=4 || nextDistance<=currentDistance || nextDistance>5) return 0;
  const hand=arr(next?.[`p${pid}_hand`]);
  const mondoId=hand.find(cardId=>stateCardSlug(next,pid,cardId)==="re_01_yurina_a2_n_3");
  if(mondoId==null) return 0;
  const mondoRule=registry?.get("re_01_yurina_a2_n_3")?.mainUse;
  if(mondoRule?.kind!=="attack-card" || !canPayResponseCardCost(next,pid,mondoRule,mondoId)) return 0;
  const mondoRange=new Set(arr(mondoRule?.attack?.range).map(Number));

  const specialStatus=next?.[`p${pid}_special_status`]||{};
  const candidates=[
    ...hand,
    ...arr(next?.[`p${pid}_special`]).filter(cardId=>Number(specialStatus[String(cardId)]||0)!==2)
  ];
  const partnerRanges=[];
  for(const cardId of candidates){
    if(String(cardId)===String(mondoId)) continue;
    const slug=stateCardSlug(next,pid,cardId);
    if(/^re_01_yurina_/.test(slug)) continue;
    const rule=registry?.get(slug)?.mainUse;
    if(rule?.kind!=="attack-card"||rule.fullPower) continue;
    if(!canPayResponseCardCost(next,pid,rule,cardId)) continue;
    partnerRanges.push(new Set(arr(rule?.attack?.range).map(Number)));
  }
  for(const target of [4,5]){
    if(target<nextDistance || !mondoRange.has(target)) continue;
    if(partnerRanges.some(range=>range.has(target))) return target;
  }
  return 0;
}

function applyDistanceDustArrow(state,kind,count,options={}){
  return applyArrowAsMuchAsPossible(state,0,kind,count,options);
}
function silentWallSources(state,playerId){
  return activeEnhancementRowsBySlug(state,"re_02_saine_o_n_7",playerId)
    .map(row=>{
      const tokenCharges=positiveTokenChargeMap(row.status);
      const sakura=tokenCharges
        ? Math.max(0,n(tokenCharges["1"]))
        : Math.max(0,n(row.status?.Charge));
      return {...row,sakura};
    })
    .filter(row=>row.sakura>0);
}
function auraDamageOptions(state,playerId,amount,required){
  const pid=Number(playerId),requested=Math.max(0,n(amount));
  const realAura=Math.max(0,n(state?.[`p${pid}_aura`]));
  const wallTotal=silentWallSources(state,pid).reduce((sum,row)=>sum+n(row.sakura),0);
  const available=realAura+wallTotal;
  if(required && available<requested) return [];
  const target=Math.min(requested,available);
  const minWall=Math.max(0,target-realAura);
  const maxWall=Math.min(target,wallTotal);
  const out=[];
  for(let silentWallUse=minWall;silentWallUse<=maxWall;silentWallUse++){
    out.push({choice:"aura",silentWallUse});
  }
  return out.length?out:[{choice:"aura",silentWallUse:0}];
}
function attackDamageOptions(state,attack){
  const defender=Number(attack?.defender),aura=normalizeDamageValue(attack?.auraDamage),life=normalizeDamageValue(attack?.lifeDamage);
  if(aura==null&&life==null) return [];
  if(attack?.damageMode==="both"){
    if(aura==null) return [{choice:"both",silentWallUse:0}];
    return auraDamageOptions(state,defender,aura,false).map(option=>({...option,choice:"both"}));
  }
  if(aura==null) return [{choice:"life",silentWallUse:0}];
  if(life==null) return auraDamageOptions(state,defender,aura,false);
  return [
    ...auraDamageOptions(state,defender,aura,true),
    {choice:"life",silentWallUse:0}
  ];
}
function normalZoneCards(state,playerId){
  const pid=Number(playerId);
  return ["hand","deck","facedown","discard","enhancement","using","outside"]
    .flatMap(z=>arr(state?.[`p${pid}_${z}`]).map(cardId=>({zone:z,cardId:String(cardId)})));
}
function cardZoneInvariantErrors(state){
  const errors=[];
  for(const pid of [1,2]){
    const seen=new Map();
    for(const item of normalZoneCards(state,pid)){
      if(seen.has(item.cardId)) errors.push(`p${pid} card ${item.cardId} in ${seen.get(item.cardId)} and ${item.zone}`);
      else seen.set(item.cardId,item.zone);
    }
  }
  return errors;
}
function hasActiveEnhancement(state,playerId){
  return arr(state?.[`p${Number(playerId)}_enhancement`]).length>0;
}

function positiveTokenChargeMap(status){
  const src=status?.TokenCharges;
  if(!src||typeof src!=="object"||Array.isArray(src)) return null;
  const out={};
  for(const [tokenType,value] of Object.entries(src)){
    const count=Math.max(0,Math.floor(Number(value)||0));
    if(count>0) out[String(tokenType)]=count;
  }
  return out;
}
function enhancementChargeInfo(state,playerId,cardId){
  const pid=Number(playerId),status=state?.[`p${pid}_card_status`]?.[String(cardId)]||{};
  const tokenCharges=positiveTokenChargeMap(status);
  const charaIds=state?.[`p${pid}_chara_ids`];
  const charasKnown=Array.isArray(charaIds);
  const hasMegumi=charasKnown&&charaIds.map(Number).includes(19);
  if(tokenCharges){
    const sakura=Math.max(0,Number(tokenCharges["1"])||0);
    const total=Object.values(tokenCharges).reduce((sum,x)=>sum+n(x),0);
    const special=Object.entries(tokenCharges).filter(([type,value])=>type!=="1"&&n(value)>0)
      .map(([type,value])=>({tokenType:type,count:n(value)}));
    return {known:true,source:"token-types",sakura,total,special,status};
  }
  const charge=Math.max(0,n(status?.Charge));
  if(charge<=0) return {known:true,source:"charge-zero",sakura:0,total:0,special:[],status};
  if(!charasKnown) return {known:false,source:"unknown-character-set",sakura:0,total:charge,special:[],status};
  if(hasMegumi) return {known:false,source:"megumi-charge-ambiguous",sakura:0,total:charge,special:[],status};
  return {known:true,source:"legacy-sakura-only",sakura:charge,total:charge,special:[],status};
}
function planStandardEnhancementTick(state,playerId){
  const pid=Number(playerId),cards=arr(state?.[`p${pid}_enhancement`]);
  const plan=[],unsupported=[];
  for(const cardId of cards){
    const info=enhancementChargeInfo(state,pid,cardId);
    if(!info.known){
      unsupported.push({cardId,reason:info.source});
      continue;
    }
    if(info.total<=0){
      unsupported.push({cardId,reason:"enhancement-without-charge"});
      continue;
    }
    const seed=Math.max(0,n(info?.status?.TokenCharges?.["19"]));
    if(info.sakura<=0 && seed<=0){
      unsupported.push({cardId,reason:"special-token-required",special:clone(info.special)});
      continue;
    }
    const tokenType=info.sakura>0?"1":"19";
    const expires=info.total===1;
    plan.push({
      cardId,
      tokenType,
      seedChoiceRequired:info.sakura>0&&seed>0,
      seedChoiceResolved:!(info.sakura>0&&seed>0),
      beforeCharge:info.total,
      afterCharge:Math.max(0,info.total-1),
      expires,
      source:info.source
    });
  }
  return {playerId:pid,cards,plan,unsupported};
}
function applyStandardEnhancementTick(state,tickPlan,options={}){
  const pid=Number(tickPlan?.playerId);
  const expired=[],retained=[];
  let movedToDust=0,movedToDistance=0,redirectedToFruit=0;
  const fruit=activeEnhancementRowsBySlug(state,"re_19_megumi_o_s_3",pid)[0]||null;
  const distanceLimit=Number.isFinite(Number(options?.distanceLimit))?Number(options.distanceLimit):BASIC_RULE_DEFAULTS.distanceLimit;
  for(const item of tickPlan?.plan||[]){
    const status=state?.[`p${pid}_card_status`]?.[String(item.cardId)];
    if(!status) throw new Error(`missing card status for enhancement ${item.cardId}`);
    const isKengiki=stateCardSlug(state,pid,item.cardId)==="re_02_saine_o_n_5";
    if(isKengiki && n(state.distance)>=distanceLimit){
      retained.push(item.cardId);
      continue;
    }
    const tokenCharges=positiveTokenChargeMap(status)||{};
    const tokenType=String(item.tokenType||"1");
    const beforeToken=Object.prototype.hasOwnProperty.call(tokenCharges,tokenType) ? n(tokenCharges[tokenType]) : (tokenType==="1"?n(status.Charge):0);
    tokenCharges[tokenType]=Math.max(0,beforeToken-1);
    status.TokenCharges=tokenCharges;
    status.Charge=Math.max(0,n(status.Charge||item.beforeCharge)-1);
    const redirectToFruit=!!fruit && String(fruit.cardId)!==String(item.cardId) && !isKengiki;
    if(redirectToFruit){
      const fruitStatus=state?.[`p${pid}_card_status`]?.[String(fruit.cardId)]||fruit.status;
      const fruitCharges=positiveTokenChargeMap(fruitStatus)||{};
      fruitCharges[tokenType]=Math.max(0,n(fruitCharges[tokenType]))+1;
      fruitStatus.TokenCharges=fruitCharges;
      fruitStatus.Charge=Math.max(0,n(fruitStatus.Charge))+1;
      redirectedToFruit++;
    }else if(tokenType==="19"){
      returnMegumiSeedsToSoil(state,pid,1);
    }else if(isKengiki){
      state.distance=n(state.distance)+1;
      movedToDistance++;
    }else{
      state.dust=n(state.dust)+1;
      movedToDust++;
    }
    if(n(status.Charge)<=0) expired.push(item.cardId);
  }
  return {movedToDust,movedToDistance,redirectedToFruit,retained,expired};
}
function finishEnhancementDiscard(state,playerId,cardId){
  const pid=Number(playerId),id=String(cardId),enhKey=`p${pid}_enhancement`;
  state[enhKey]=arr(state[enhKey]);
  const index=state[enhKey].findIndex(x=>String(x)===id);
  if(index<0) return {moved:false,destination:"effect-moved"};
  const status=state?.[`p${pid}_card_status`]?.[id]||{};
  const tokenCharges=positiveTokenChargeMap(status)||{};
  const total=Object.keys(tokenCharges).length
    ? Object.values(tokenCharges).reduce((sum,x)=>sum+n(x),0)
    : Math.max(0,n(status.Charge));
  if(total>0) return {moved:false,destination:"enhancement"};
  const [moved]=state[enhKey].splice(index,1);
  const poisonSlug=normalizeCardSlug(status?.Slug||"");
  if(poisonSlug==="re_09_chikage_o_p_3"){
    const bagOwner=Number(status?.PoisonBagOwner);
    if(bagOwner===1||bagOwner===2){
      const bagKey=`p${bagOwner}_poison_bag`;
      state[bagKey]=arr(state[bagKey]);
      state[bagKey].push(moved);
      return {moved:true,destination:"poison-bag",ownerId:bagOwner};
    }
  }
  const borrowedOwner=Number(status?.BorrowedOwner);
  if((borrowedOwner===1||borrowedOwner===2) && borrowedOwner!==pid){
    const ownerDiscard=`p${borrowedOwner}_discard`;
    state[ownerDiscard]=arr(state[ownerDiscard]);
    state[ownerDiscard].push(moved);
    delete state[`p${pid}_card_status`]?.[id];
    return {moved:true,destination:"borrowed-owner-discard",ownerId:borrowedOwner};
  }
  if(status.IsSpecial){
    const specialKey=`p${pid}_special`;
    state[specialKey]=arr(state[specialKey]);
    if(!state[specialKey].some(x=>String(x)===id)) state[specialKey].push(moved);
    if(!state[`p${pid}_special_status`]||typeof state[`p${pid}_special_status`]!=="object") state[`p${pid}_special_status`]={};
    state[`p${pid}_special_status`][id]=2;
    return {moved:true,destination:"special-used"};
  }
  const discardKey=`p${pid}_discard`;
  state[discardKey]=arr(state[discardKey]);
  state[discardKey].push(moved);
  return {moved:true,destination:"discard"};
}
function reconstructNormalDeck(state,playerId,random){
  const pid=Number(playerId),deckKey=`p${pid}_deck`,discardKey=`p${pid}_discard`,facedownKey=`p${pid}_facedown`;
  const pool=[...arr(state[deckKey]),...arr(state[discardKey]),...arr(state[facedownKey])];
  const shuffled=shuffleWith(random,pool);
  const poisons=shuffleWith(random,shuffled.filter(cardId=>isChikagePoisonCard(state,pid,cardId)));
  const normals=shuffled.filter(cardId=>!isChikagePoisonCard(state,pid,cardId));
  state[deckKey]=[...poisons,...normals];
  state[`p${pid}_known_deck_top`]=[];
  state[discardKey]=[];
  state[facedownKey]=[];
}
function drawTopCard(state,playerId){
  const pid=Number(playerId),deckKey=`p${pid}_deck`,handKey=`p${pid}_hand`,knownKey=`p${pid}_known_deck_top`;
  state[deckKey]=arr(state[deckKey]);
  state[handKey]=arr(state[handKey]);
  state[knownKey]=arr(state[knownKey]);
  if(!state[deckKey].length) return null;
  const cardId=state[deckKey].shift();
  if(state[knownKey].length){
    if(String(state[knownKey][0])===String(cardId)) state[knownKey].shift();
    else state[knownKey]=[];
  }
  state[handKey].push(cardId);
  return cardId;
}

function normalizeRuleExtensions(value){
  return (Array.isArray(value)?value:[]).filter(x=>x&&typeof x==="object");
}
function callRuleExtensions(extensions,hook,context){
  let handled=false;
  const results=[];
  for(const extension of normalizeRuleExtensions(extensions)){
    const fn=extension?.[hook];
    if(typeof fn!=="function") continue;
    const result=fn(context);
    if(result&&typeof result.then==="function") throw new Error(`async rule extension is not supported: ${hook}`);
    if(result?.handled) handled=true;
    results.push({id:String(extension.id||""),result:clone(result||{})});
    if(result?.stop) return {handled,stop:true,results};
  }
  return {handled,stop:false,results};
}

export function createCoreRuleExtension(id,hooks={}){
  return {id:String(id||""),...hooks};
}


function normalizeCardSlug(value){
  return String(value||"").trim().toLowerCase().replaceAll("-","_");
}
function isChikagePoisonSlug(slug){
  return /^re_09_chikage_o_p_[1-4]$/.test(normalizeCardSlug(slug));
}
function isChikagePoisonCard(state,playerId,cardId){
  const pid=Number(playerId),id=String(cardId);
  const row=state?.[`p${pid}_card_status`]?.[id]||state?.[`p${pid===1?2:1}_card_status`]?.[id]||{};
  return !row?.KururuDuplicate && isChikagePoisonSlug(row?.Slug||row?.slug||"");
}
function stateHasChikage(state,playerId){
  const pid=Number(playerId),charas=state?.[`p${pid}_chara_ids`];
  if(Array.isArray(charas)&&charas.map(Number).includes(9)) return true;
  const status=state?.[`p${pid}_card_status`]||{};
  return Object.values(status).some(row=>normalizeCardSlug(row?.Slug||row?.slug||"").includes("_chikage_"));
}
function initializeChikagePoisonBag(state,playerId){
  const pid=Number(playerId),bagKey=`p${pid}_poison_bag`,statusKey=`p${pid}_card_status`;
  state[bagKey]=arr(state[bagKey]);
  if(!stateHasChikage(state,pid)) return;
  if(!state[statusKey]||typeof state[statusKey]!=="object") state[statusKey]={};
  const found=[];
  for(const owner of [1,2]){
    const st=state?.[`p${owner}_card_status`]||{};
    for(const [cardId,row] of Object.entries(st)){
      if(isChikagePoisonSlug(row?.Slug||row?.slug||"") && Number(row?.PoisonBagOwner||owner)===pid) found.push(String(cardId));
    }
  }
  if(found.length) return;
  const defs=[
    ["p1","re_09_chikage_o_p_1"],["p2","re_09_chikage_o_p_2"],["p3","re_09_chikage_o_p_3"],
    ["p4a","re_09_chikage_o_p_4"],["p4b","re_09_chikage_o_p_4"]
  ];
  for(const [suffix,slug] of defs){
    const cardId=`chikage-poison-${pid}-${suffix}`;
    state[bagKey].push(cardId);
    state[statusKey][cardId]={Slug:slug,SubType:0,IsSpecial:false,PoisonBagOwner:pid,Charge:0,TokenCharges:{}};
  }
}

function stateHasKururu(state,playerId){
  const pid=Number(playerId),charas=state?.[`p${pid}_chara_ids`];
  if(Array.isArray(charas)&&charas.map(Number).includes(10)) return true;
  const status=state?.[`p${pid}_card_status`]||{};
  return Object.values(status).some(row=>normalizeCardSlug(row?.Slug||row?.slug||"").includes("_kururu_"));
}
function kururuCardTraits(state,playerId,cardId,registry){
  const pid=Number(playerId),id=String(cardId),status=state?.[`p${pid}_card_status`]?.[id]||{};
  const slug=stateCardSlug(state,pid,id),entry=registry?.get(slug)||{},rule=entry.mainUse||{};
  const mainType=Number(status.MainType);
  const kind=String(rule.kind||"");
  return {
    attack:mainType===1||kind==="attack-card",
    action:mainType===2||kind==="action-card",
    enhancement:mainType===3||kind==="enhancement-card",
    response:Number(status.SubType)===1||!!entry.response,
    fullpower:Number(status.SubType)===2||!!rule.fullPower
  };
}
function kururuGearCounts(state,playerId,registry){
  const pid=Number(playerId),ids=[];
  for(const zone of ["discard","enhancement","using"]) ids.push(...arr(state?.[`p${pid}_${zone}`]));
  const specialStatus=state?.[`p${pid}_special_status`]||{};
  for(const cardId of arr(state?.[`p${pid}_special`])){
    if(Number(specialStatus[String(cardId)]||0)===2) ids.push(cardId);
  }
  const counts={attack:0,action:0,enhancement:0,response:0,fullpower:0};
  for(const cardId of ids){
    const traits=kururuCardTraits(state,pid,cardId,registry);
    for(const key of Object.keys(counts)) if(traits[key]) counts[key]++;
  }
  return counts;
}
function kururuGearReady(state,playerId,registry,requirements={}){
  const counts=kururuGearCounts(state,playerId,registry);
  return Object.entries(requirements||{}).every(([key,value])=>n(counts[key])>=n(value));
}

function stateHasThallya(state,playerId){
  const pid=Number(playerId),charas=state?.[`p${pid}_chara_ids`];
  if(Array.isArray(charas)&&charas.map(Number).includes(11)) return true;
  const status=state?.[`p${pid}_card_status`]||{};
  return Object.values(status).some(row=>normalizeCardSlug(row?.Slug||row?.slug||"").includes("_thallya_"));
}
function stateHasRaira(state,playerId){
  const pid=Number(playerId),charas=state?.[`p${pid}_chara_ids`];
  if(Array.isArray(charas)&&charas.map(Number).includes(12)) return true;
  const status=state?.[`p${pid}_card_status`]||{};
  return Object.values(status).some(row=>normalizeCardSlug(row?.Slug||row?.slug||"").includes("_raira_"));
}
function stateHasMegumi(state,playerId){
  const pid=Number(playerId),charas=state?.[`p${pid}_chara_ids`];
  if(Array.isArray(charas)&&charas.map(Number).includes(19)) return true;
  const status=state?.[`p${pid}_card_status`]||{};
  return Object.values(status).some(row=>normalizeCardSlug(row?.Slug||row?.slug||"").includes("_megumi_"));
}
function megumiSeedCountOnEnhancements(state,playerId){
  const pid=Number(playerId);
  return arr(state?.[`p${pid}_enhancement`]).reduce((sum,cardId)=>{
    const row=state?.[`p${pid}_card_status`]?.[String(cardId)]||{};
    return sum+Math.max(0,n(row?.TokenCharges?.["19"]));
  },0);
}
function megumiSeedCountOutsideSoil(state,playerId){
  const pid=Number(playerId),status=state?.[`p${pid}_card_status`]||{};
  return Object.values(status).reduce((sum,row)=>sum+Math.max(0,n(row?.TokenCharges?.["19"])),0);
}
function germinateMegumiSeeds(state,playerId,count=1){
  const pid=Number(playerId),requested=Math.max(0,Math.floor(n(count)));
  const unKey=`p${pid}_megumi_soil_unbloomed`,blKey=`p${pid}_megumi_soil_bloomed`;
  const moved=Math.min(requested,Math.max(0,n(state?.[unKey])));
  state[unKey]=Math.max(0,n(state?.[unKey])-moved);
  state[blKey]=Math.max(0,n(state?.[blKey])+moved);
  return moved;
}
function returnMegumiSeedsToSoil(state,playerId,count=1){
  const pid=Number(playerId),returned=Math.max(0,Math.floor(n(count)));
  const unKey=`p${pid}_megumi_soil_unbloomed`;
  state[unKey]=Math.max(0,n(state?.[unKey])+returned);
  return returned;
}

export class CardRuleRegistry{
  constructor(entries={}){
    this.rules=new Map();
    for(const [slug,rule] of Object.entries(entries||{})) this.register(slug,rule);
  }
  register(slug,rule){
    const key=normalizeCardSlug(slug);
    if(!key) throw new Error("card rule slug is required");
    this.rules.set(key,clone(rule||{}));
    return this;
  }
  get(slug){
    return this.rules.get(normalizeCardSlug(slug))||null;
  }
  has(slug){
    return this.rules.has(normalizeCardSlug(slug));
  }
}

export function createDefaultCardRuleRegistry(){
  return new CardRuleRegistry({
    "re_01_yurina_o_n_1":{
      name:"斬",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"斬",
          classification:"normal",
          range:[3,4],
          auraDamage:3,
          lifeDamage:1
        }
      }
    },
    "re_01_yurina_o_n_2":{
      name:"一閃",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"一閃",
          classification:"normal",
          range:[3,4],
          auraDamage:2,
          lifeDamage:2,
          dynamicModifiers:[
            {kind:"if-attacker-life-at-most",value:3,auraDelta:1,lifeDelta:0,label:"決死"}
          ]
        }
      }
    },
    "re_01_yurina_o_n_3":{
      name:"柄打ち",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"柄打ち",
          classification:"normal",
          range:[1,2],
          auraDamage:2,
          lifeDamage:1,
          afterEffects:[
            {kind:"grant-next-attack-if-attacker-life-at-most",value:3,auraDelta:1,lifeDelta:0,label:"決死"}
          ]
        }
      }
    },
    "re_01_yurina_o_n_4":{
      name:"居合",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        attack:{
          label:"居合",
          classification:"normal",
          subtype:"fullpower",
          range:[2,3,4],
          auraDamage:4,
          lifeDamage:3,
          dynamicModifiers:[
            {kind:"if-distance-at-most",value:2,auraDelta:-1,lifeDelta:-1,label:"近距離補正"}
          ]
        }
      }
    },
    "re_01_yurina_o_s_1":{
      name:"月影落",
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:7},
        attack:{
          label:"月影落",
          classification:"special",
          range:[3,4],
          auraDamage:4,
          lifeDamage:4
        }
      }
    },
    "re_01_yurina_o_s_2":{
      name:"浦波嵐",
      terminal:true,
      response:{
        kind:"attack-card",
        cost:{kind:"flare",amount:3},
        attack:{
          label:"浦波嵐",
          classification:"special",
          subtype:"response",
          range:[0,1,2,3,4,5,6,7,8,9,10],
          auraDamage:2,
          lifeDamage:null,
          afterEffects:[{kind:"modify-parent-damage",auraDelta:-2,lifeDelta:0}]
        }
      }
    },
    "re_01_yurina_o_s_3":{
      name:"浮舟宿",
      instantRecharge:{kind:"self-life-cross-at-most",value:3},
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:2},
        effects:[{kind:"arrow",arrow:{kind:"dust-to-aura",count:5}}]
      }
    },
    "re_01_yurina_o_s_4":{
      name:"天音揺波の底力",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        useCondition:{kind:"self-life-at-most",value:3},
        cost:{kind:"flare",amount:5},
        attack:{
          label:"天音揺波の底力",
          classification:"special",
          subtype:"fullpower",
          range:[1,2,3,4],
          auraDamage:5,
          lifeDamage:5
        }
      }
    },
    "re_01_yurina_o_n_5":{
      name:"体捌き",
      mainUse:{
        kind:"action-card",
        effects:[
          {kind:"queue-next-attack-range",far:1,source:"体捌き"},
          {kind:"basic-actions-if-life-lower",count:2}
        ]
      }
    },
    "re_01_yurina_o_n_6":{
      name:"圧気",
      gap:true,
      mainUse:{
        kind:"enhancement-card",
        charge:2
      },
      enhancementDiscard:{
        kind:"generated-attack",
        attack:{label:"圧気",classification:null,range:[1,2,3],auraDamage:3,lifeDamage:null}
      }
    },
    "re_01_yurina_o_n_7":{
      name:"気炎万丈",
      mainUse:{
        kind:"enhancement-card",
        fullPower:true,
        charge:4
      },
      enhancementDiscard:{kind:"none"}
    },
    "re_01_yurina_a2_n_3":{
      name:"問答",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"問答",
          classification:"normal",
          range:[2,3,4,5],
          auraDamage:3,
          lifeDamage:0,
          afterEffects:[{kind:"yurina-mondo"}]
        }
      }
    },
    "re_01_yurina_a2_n_7":{
      name:"阿吽",
      mainUse:{
        kind:"enhancement-card",
        charge:3
      },
      enhancementDiscard:{kind:"none"}
    },
    "re_01_yurina_a2_s_1":{
      name:"神座渡",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        cost:{kind:"all-flare"},
        attack:{
          label:"神座渡",
          classification:"special",
          subtype:"fullpower",
          range:[0,1,2,3,4,5],
          auraDamage:0,
          lifeDamage:2,
          responseForbidden:true,
          afterEffects:[{kind:"yurina-shinzawatari"}]
        }
      }
    },
    "re_02_saine_o_n_1":{
      name:"八方振り",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"八方振り",
          classification:"normal",
          range:[4,5],
          auraDamage:2,
          lifeDamage:1,
          afterEffects:[
            {
              kind:"generated-attack-if-attacker-aura-at-most",
              value:1,
              attack:{
                label:"八方振り（八相）",
                classification:null,
                range:[4,5],
                auraDamage:2,
                lifeDamage:1
              }
            }
          ]
        }
      }
    },
    "re_02_saine_o_n_2":{
      name:"薙斬り",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"薙斬り",
          classification:"normal",
          range:[4,5],
          auraDamage:3,
          lifeDamage:1
        }
      },
      response:{
        kind:"attack-card",
        attack:{
          label:"薙斬り",
          classification:"normal",
          subtype:"response",
          range:[4,5],
          auraDamage:3,
          lifeDamage:1
        }
      }
    },
    "re_02_saine_o_n_3":{
      name:"石突",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"石突",
          classification:"normal",
          range:[2,3],
          auraDamage:2,
          lifeDamage:1,
          afterEffects:[
            {
              kind:"arrow-if-attacker-aura-at-most",
              value:1,
              arrow:{kind:"dust-to-distance",count:1},
              label:"八相"
            }
          ]
        }
      },
      response:{
        kind:"attack-card",
        attack:{
          label:"石突",
          classification:"normal",
          subtype:"response",
          range:[2,3],
          auraDamage:2,
          lifeDamage:1,
          afterEffects:[
            {
              kind:"arrow-if-attacker-aura-at-most",
              value:1,
              arrow:{kind:"dust-to-distance",count:1},
              label:"八相"
            }
          ]
        }
      }
    },
    "re_02_saine_o_n_4":{
      name:"見切り",
      mainUse:{
        kind:"action-card",
        effects:[
          {
            kind:"choose-arrows",
            arrows:[
              {kind:"distance-to-dust",count:1},
              {kind:"dust-to-distance",count:1}
            ]
          }
        ]
      },
      response:{
        kind:"action-card",
        grantedResponse:{kind:"aura-at-most",value:1},
        effect:{
          kind:"choose-arrows",
          arrows:[
            {kind:"distance-to-dust",count:1},
            {kind:"dust-to-distance",count:1}
          ]
        }
      }
    },
    "re_02_saine_o_n_5":{
      name:"圏域",
      mainUse:{
        kind:"enhancement-card",
        charge:2
      },
      enhancementDiscard:{kind:"none"}
    },
    "re_02_saine_o_n_6":{
      name:"衝音晶",
      mainUse:{
        kind:"enhancement-card",
        charge:1
      },
      response:{
        kind:"enhancement-card",
        charge:1,
        deployEffects:[{kind:"modify-parent-damage",auraDelta:-1,lifeDelta:0}]
      },
      enhancementDiscard:{
        kind:"generated-attack-then-arrow",
        attack:{
          label:"衝音晶",
          classification:null,
          range:[0,1,2,3,4,5,6,7,8,9,10],
          auraDamage:1,
          lifeDamage:null,
          responseForbidden:true
        },
        arrow:{kind:"dust-to-distance",count:1}
      }
    },
    "re_02_saine_o_n_7":{
      name:"無音壁",
      mainUse:{
        kind:"enhancement-card",
        fullPower:true,
        charge:5
      },
      enhancementDiscard:{kind:"none"}
    },
    "re_02_saine_o_s_1":{
      name:"律動弧戟",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:6},
        effects:[
          {kind:"generated-attack",attack:{label:"律動弧戟①",classification:null,range:[3,4],auraDamage:1,lifeDamage:1}},
          {kind:"generated-attack",attack:{label:"律動弧戟②",classification:null,range:[4,5],auraDamage:1,lifeDamage:1}},
          {kind:"generated-attack",attack:{label:"律動弧戟③",classification:null,range:[3,4,5],auraDamage:2,lifeDamage:2}}
        ]
      }
    },
    "re_02_saine_o_s_2":{
      name:"響鳴共振",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare-minus-opponent-aura",amount:8},
        effects:[
          {kind:"arrow",arrow:{kind:"opponent-aura-to-distance",count:2}}
        ]
      }
    },
    "re_02_saine_o_s_3":{
      name:"音無砕氷",
      recharge:{kind:"self-aura-at-most",value:1},
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:2},
        attack:{
          label:"音無砕氷",
          classification:"special",
          range:[0,1,2,3,4,5,6,7,8,9,10],
          auraDamage:1,
          lifeDamage:1
        }
      },
      response:{
        kind:"attack-card",
        cost:{kind:"flare",amount:2},
        attack:{
          label:"音無砕氷",
          classification:"special",
          subtype:"response",
          range:[0,1,2,3,4,5,6,7,8,9,10],
          auraDamage:1,
          lifeDamage:1,
          afterEffects:[{kind:"modify-parent-damage",auraDelta:-1,lifeDelta:-1}]
        }
      }
    },
    "re_02_saine_o_s_4":{
      name:"氷雨細音の果ての果て",
      response:{
        kind:"attack-card",
        responseCondition:{kind:"parent-classification-is",value:"special"},
        cost:{kind:"flare",amount:5},
        attack:{
          label:"氷雨細音の果ての果て",
          classification:"special",
          subtype:"response",
          range:[1,2,3,4,5],
          auraDamage:5,
          lifeDamage:5
        }
      }
    },
    "re_03_himika_o_n_1":{
      name:"シュート",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"シュート",
          classification:"normal",
          range:[4,5,6,7,8,9,10],
          auraDamage:2,
          lifeDamage:1
        }
      }
    },
    "re_03_himika_o_n_2":{
      name:"ラピッドファイア",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"ラピッドファイア",
          classification:"normal",
          range:[6,7,8],
          auraDamage:2,
          lifeDamage:1,
          dynamicModifiers:[
            {kind:"if-card-use-count-at-least",value:3,auraDelta:1,lifeDelta:1,label:"連火"}
          ]
        }
      }
    },
    "re_03_himika_o_n_3":{
      name:"リコイルバーン",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"リコイルバーン",
          classification:"normal",
          range:[2,3,4,5,6,7,8],
          auraDamage:2,
          lifeDamage:2,
          afterEffects:[
            {kind:"self-life-to-distance",count:1}
          ]
        }
      }
    },
    "re_03_himika_o_n_4":{
      name:"フルバースト",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        attack:{
          label:"フルバースト",
          classification:"normal",
          subtype:"fullpower",
          range:[5,6,7,8,9],
          auraDamage:3,
          lifeDamage:1,
          damageMode:"both"
        }
      }
    },
    "re_03_himika_o_n_5":{
      name:"バックステップ",
      mainUse:{
        kind:"action-card",
        effects:[
          {kind:"draw",count:1},
          {kind:"arrow",arrow:{kind:"dust-to-distance",count:1}}
        ]
      }
    },
    "re_03_himika_o_n_6":{
      name:"バックドラフト",
      mainUse:{
        kind:"action-card",
        effects:[
          {kind:"intimidate-opponent"},
          {
            kind:"queue-next-other-megami-attack-if-card-use-count-at-least",
            value:3,
            excludedMegami:"himika",
            auraDelta:1,
            lifeDelta:1,
            source:"バックドラフト"
          }
        ]
      }
    },
    "re_03_himika_o_n_7":{
      name:"リローディング",
      mainUse:{
        kind:"enhancement-card",
        charge:3
      },
      enhancementDiscard:{kind:"none"},
      endPhaseEffect:{kind:"draw-if-hand-empty",count:1}
    },
    "re_03_himika_o_s_1":{
      name:"レッドバレット",
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:0},
        attack:{
          label:"レッドバレット",
          classification:"special",
          range:[5,6,7,8,9,10],
          auraDamage:3,
          lifeDamage:1
        }
      }
    },
    "re_03_himika_o_s_2":{
      name:"クリムゾンゼロ",
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:5},
        attack:{
          label:"クリムゾンゼロ",
          classification:"special",
          range:[0,1,2],
          auraDamage:2,
          lifeDamage:2,
          damageMode:"both",
          responseForbiddenAtDistances:[0]
        }
      }
    },
    "re_03_himika_o_s_3":{
      name:"スカーレットイマジン",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:3},
        effects:[
          {kind:"draw",count:2},
          {kind:"hand-to-facedown",count:1}
        ]
      }
    },
    "re_03_himika_o_s_4":{
      name:"ヴァーミリオンフィールド",
      recharge:{kind:"self-hand-empty"},
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:2},
        effects:[
          {
            kind:"arrow-if-card-use-count-at-least",
            value:3,
            arrow:{kind:"dust-to-distance",count:2},
            label:"連火"
          }
        ]
      }
    },
    "re_04_tokoyo_o_n_1":{
      name:"梳流し",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"梳流し",
          classification:"normal",
          range:[4],
          auraDamage:null,
          lifeDamage:1,
          afterEffects:[{kind:"return-source-to-deck-top-if-focus-is",value:2}]
        }
      }
    },
    "re_04_tokoyo_o_n_2":{
      name:"跳ね兎",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"跳ね兎",
          classification:"normal",
          range:[0,1,2,3],
          auraDamage:1,
          lifeDamage:0,
          dynamicModifiers:[
            {kind:"if-attacker-focus-is",value:2,auraDelta:0,lifeDelta:1,label:"境地"}
          ],
          afterEffects:[
            {kind:"arrow",arrow:{kind:"dust-to-distance",count:2}}
          ]
        }
      }
    },
    "re_04_tokoyo_o_n_3":{
      name:"雅打ち",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"雅打ち",
          classification:"normal",
          range:[2,3,4],
          auraDamage:2,
          lifeDamage:1,
          afterEffects:[{kind:"cancel-parent-if-focus-2-and-parent-not-special"}]
        }
      },
      response:{
        kind:"attack-card",
        attack:{
          label:"雅打ち",
          classification:"normal",
          subtype:"response",
          range:[2,3,4],
          auraDamage:2,
          lifeDamage:1,
          afterEffects:[{kind:"cancel-parent-if-focus-2-and-parent-not-special"}]
        }
      }
    },
    "re_04_tokoyo_o_n_4":{
      name:"詩舞",
      mainUse:{
        kind:"action-card",
        effects:[
          {
            kind:"choose-arrows",
            arrows:[
              {kind:"aura-to-distance",count:1},
              {kind:"flare-to-aura",count:1}
            ]
          },
          {kind:"focus-gain",count:1}
        ]
      },
      response:{
        kind:"action-card",
        effect:{
          kind:"choose-arrows",
          arrows:[
            {kind:"aura-to-distance",count:1},
            {kind:"flare-to-aura",count:1}
          ],
          afterEffects:[{kind:"focus-gain",count:1}]
        }
      }
    },
    "re_04_tokoyo_o_n_5":{
      name:"要返し",
      mainUse:{
        kind:"action-card",
        fullPower:true,
        effects:[
          {kind:"choose-own-discard-or-facedown-to-deck-bottom",maxCount:2},
          {kind:"arrow",arrow:{kind:"dust-to-aura",count:2}}
        ]
      }
    },
    "re_04_tokoyo_o_n_6":{
      name:"風舞台",
      mainUse:{
        kind:"enhancement-card",
        charge:2,
        deployEffects:[
          {kind:"arrow",arrow:{kind:"distance-to-aura",count:2}}
        ]
      },
      enhancementDiscard:{
        kind:"arrow",
        arrow:{kind:"aura-to-distance",count:2}
      }
    },
    "re_04_tokoyo_o_n_7":{
      name:"晴舞台",
      terminal:true,
      mainUse:{
        kind:"enhancement-card",
        charge:2,
        deployEffects:[
          {kind:"set-focus",value:2}
        ]
      },
      enhancementDiscard:{
        kind:"generated-attack",
        attack:{
          label:"晴舞台",
          classification:null,
          range:[3,4,5,6],
          auraDamage:null,
          lifeDamage:1
        }
      }
    },
    "re_04_tokoyo_o_s_1":{
      name:"久遠ノ花",
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:5},
        attack:{
          label:"久遠ノ花",
          classification:"special",
          range:[0,1,2,3,4,5,6,7,8,9,10],
          auraDamage:null,
          lifeDamage:1,
          afterEffects:[{kind:"cancel-parent-attack"}]
        }
      },
      response:{
        kind:"attack-card",
        cost:{kind:"flare",amount:5},
        attack:{
          label:"久遠ノ花",
          classification:"special",
          subtype:"response",
          range:[0,1,2,3,4,5,6,7,8,9,10],
          auraDamage:null,
          lifeDamage:1,
          afterEffects:[{kind:"cancel-parent-attack"}]
        }
      }
    },
    "re_04_tokoyo_o_s_2":{
      name:"千歳ノ鳥",
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:2},
        attack:{
          label:"千歳ノ鳥",
          classification:"special",
          range:[3,4],
          auraDamage:3,
          lifeDamage:1,
          afterEffects:[{kind:"reconstruct-self-no-damage"}]
        }
      }
    },
    "re_04_tokoyo_o_s_3":{
      name:"無窮ノ風",
      recharge:{kind:"self-focus-is",value:2},
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:1},
        attack:{
          label:"無窮ノ風",
          classification:"special",
          range:[3,4,5,6,7,8],
          auraDamage:1,
          lifeDamage:1,
          responseForbidden:true,
          afterEffects:[{kind:"opponent-discard-one-non-attack-or-reveal"}]
        }
      }
    },
    "re_04_tokoyo_o_s_4":{
      name:"常世ノ月",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:2},
        effects:[
          {kind:"set-focus",value:2},
          {kind:"set-opponent-focus",value:0},
          {kind:"intimidate-opponent"}
        ]
      }
    },
    "re_08_hagane_o_n_1":{
      name:"遠心撃",
      terminal:true,
      centrifugal:true,
      mainUse:{
        kind:"attack-card",
        useCondition:{kind:"centrifugal"},
        attack:{
          label:"遠心撃",
          classification:"normal",
          range:[2,3,4,5,6],
          auraDamage:5,
          lifeDamage:3
        }
      }
    },
    "re_08_hagane_o_n_2":{
      name:"砂風塵",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"砂風塵",
          classification:"normal",
          range:[0,1,2,3,4,5,6],
          auraDamage:1,
          lifeDamage:null,
          afterEffects:[{kind:"opponent-discard-one-if-distance-delta-at-least",value:2}]
        }
      }
    },
    "re_08_hagane_o_n_3":{
      name:"大地砕き",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        attack:{
          label:"大地砕き",
          classification:"normal",
          subtype:"fullpower",
          range:[0,1,2,3],
          auraDamage:2,
          lifeDamage:null,
          responseForbidden:true,
          afterEffects:[
            {kind:"set-opponent-focus",value:0},
            {kind:"intimidate-opponent"}
          ]
        }
      }
    },
    "re_08_hagane_o_n_4":{
      name:"超反動",
      mainUse:{
        kind:"action-card",
        effects:[{kind:"hagane-recoil"}]
      }
    },
    "re_08_hagane_o_n_5":{
      name:"円舞錬",
      centrifugal:true,
      mainUse:{
        kind:"action-card",
        useCondition:{kind:"centrifugal"},
        effects:[{kind:"arrow-if-opponent-flare-at-least",value:3,arrow:{kind:"opponent-flare-to-own-aura",count:1}}]
      }
    },
    "re_08_hagane_o_n_6":{
      name:"鐘鳴らし",
      centrifugal:true,
      mainUse:{
        kind:"action-card",
        useCondition:{kind:"centrifugal"},
        effects:[{kind:"choose-hagane-next-attack-buff"}]
      }
    },
    "re_08_hagane_o_n_7":{
      name:"引力場",
      mainUse:{
        kind:"enhancement-card",
        charge:2,
        deployEffects:[{kind:"arrow",arrow:{kind:"distance-to-aura",count:1}}]
      },
      response:{
        kind:"enhancement-card",
        charge:2,
        deployEffects:[{kind:"arrow",arrow:{kind:"distance-to-aura",count:1}}]
      },
      enhancementDiscard:{kind:"arrow",arrow:{kind:"aura-to-distance",count:1}}
    },
    "re_08_hagane_o_s_1":{
      name:"大天空クラッシュ",
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:4},
        attack:{
          label:"大天空クラッシュ",
          classification:"special",
          range:[0,1,2,3,4,5,6,7,8,9,10],
          auraDamage:0,
          lifeDamage:0,
          overcome:true,
          dynamicModifiers:[{kind:"distance-delta-as-damage",label:"大天空クラッシュ"}]
        }
      }
    },
    "re_08_hagane_o_s_2":{
      name:"大破鐘メガロベル",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:2},
        effects:[{kind:"megalobell"}]
      },
      response:{
        kind:"action-card",
        cost:{kind:"flare",amount:2},
        effect:{kind:"megalobell"}
      }
    },
    "re_08_hagane_o_s_3":{
      name:"大重力アトラクト",
      recharge:{kind:"used-centrifugal-this-turn"},
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:5},
        effects:[{kind:"arrow",arrow:{kind:"distance-to-flare",count:3}}]
      }
    },
    "re_08_hagane_o_s_4":{
      name:"大山脈リスペクト",
      centrifugal:true,
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:3},
        useCondition:{kind:"centrifugal"},
        effects:[{kind:"hagane-respect",maxCount:2}]
      }
    },
    "re_07_shinra_o_n_1":{
      name:"立論",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"立論",
          classification:"normal",
          range:[2,3,4,5,6,7],
          auraDamage:2,
          lifeDamage:null,
          damageReplacement:{kind:"opponent-deck-to-facedown-if-at-least",deckCount:2,count:2}
        }
      }
    },
    "re_07_shinra_o_n_2":{
      name:"反論",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"反論",
          classification:"normal",
          range:[2,3,4,5,6,7],
          auraDamage:1,
          lifeDamage:null,
          afterEffects:[{kind:"opponent-draw",count:1}]
        }
      },
      response:{
        kind:"attack-card",
        attack:{
          label:"反論",
          classification:"normal",
          subtype:"response",
          range:[2,3,4,5,6,7],
          auraDamage:1,
          lifeDamage:null,
          afterEffects:[
            {kind:"cancel-parent-damage-if-aura-present-and-parent-not-special"},
            {kind:"opponent-draw",count:1}
          ]
        }
      }
    },
    "re_07_shinra_o_n_3":{
      name:"詭弁",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        attack:{
          label:"詭弁",
          classification:"normal",
          subtype:"fullpower",
          range:[3,4,5,6,7,8],
          auraDamage:null,
          lifeDamage:1,
          afterEffects:[{
            kind:"shinra-plan",
            planEffects:{
              "神算":{kind:"opponent-deck-to-facedown",count:3},
              "鬼謀":{kind:"use-opponent-discard-card",optional:true}
            }
          }]
        }
      }
    },
    "re_07_shinra_o_n_4":{
      name:"引用",
      mainUse:{
        kind:"action-card",
        effects:[{kind:"shinra-quote"}]
      }
    },
    "re_07_shinra_o_n_5":{
      name:"煽動",
      mainUse:{
        kind:"action-card",
        effects:[{
          kind:"shinra-plan",
          planEffects:{
            "神算":{kind:"arrow",arrow:{kind:"dust-to-distance",count:1}},
            "鬼謀":{kind:"arrow",arrow:{kind:"distance-to-opponent-aura",count:1}}
          }
        }]
      },
      response:{
        kind:"action-card",
        effect:{
          kind:"shinra-plan",
          planEffects:{
            "神算":{kind:"arrow",arrow:{kind:"dust-to-distance",count:1}},
            "鬼謀":{kind:"arrow",arrow:{kind:"distance-to-opponent-aura",count:1}}
          }
        }
      }
    },
    "re_07_shinra_o_n_6":{
      name:"壮語",
      mainUse:{kind:"enhancement-card",charge:2},
      enhancementDiscard:{
        kind:"shinra-plan",
        planEffects:{
          "神算":{kind:"gain-focus-and-return-self-deck-top",count:1},
          "鬼謀":{kind:"opponent-hand-low-draw-three-facedown-two",handAtMost:1}
        }
      }
    },
    "re_07_shinra_o_n_7":{
      name:"論破",
      mainUse:{
        kind:"enhancement-card",
        charge:3,
        deployEffects:[
          {kind:"opponent-top-deck-to-discard",count:1},
          {kind:"seal-opponent-discard-under-self"}
        ]
      },
      response:{
        kind:"enhancement-card",
        charge:3,
        deployEffects:[
          {kind:"opponent-top-deck-to-discard",count:1},
          {kind:"seal-opponent-discard-under-self"}
        ]
      },
      enhancementDiscard:{kind:"return-sealed-to-owner-discard"}
    },
    "re_07_shinra_o_s_1":{
      name:"完全論破",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:2},
        effects:[{kind:"seal-opponent-discard-permanently"}]
      }
    },
    "re_07_shinra_o_s_2":{
      name:"皆式理解",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:2},
        effects:[{
          kind:"shinra-plan",
          planEffects:{
            "神算":{kind:"use-own-used-special-enhancement-free"},
            "鬼謀":{kind:"destroy-opponent-nonspecial-enhancement"}
          }
        }]
      }
    },
    "re_07_shinra_o_s_3":{
      name:"天地反駁",
      shinraDamageSwap:true,
      mainUse:{
        kind:"enhancement-card",
        fullPower:true,
        cost:{kind:"flare",amount:2},
        charge:5
      },
      enhancementDiscard:{kind:"none"}
    },
    "re_07_shinra_o_s_4":{
      name:"森羅判証",
      shinraAdjudication:true,
      mainUse:{
        kind:"enhancement-card",
        cost:{kind:"flare",amount:6},
        charge:6,
        deployEffects:[{kind:"arrow",arrow:{kind:"dust-to-life",count:2}}]
      },
      enhancementDiscard:{kind:"lose-game"}
    },
    "re_09_chikage_o_n_1":{
      name:"飛苦無",
      mainUse:{kind:"attack-card",attack:{label:"飛苦無",classification:"normal",range:[4,5],auraDamage:2,lifeDamage:2}}
    },
    "re_09_chikage_o_n_2":{
      name:"毒針",
      mainUse:{kind:"attack-card",attack:{label:"毒針",classification:"normal",range:[4],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"chikage-send-poison",allowed:["re_09_chikage_o_p_1","re_09_chikage_o_p_2","re_09_chikage_o_p_3"],destination:"deck-top"}]}}
    },
    "re_09_chikage_o_n_3":{
      name:"遁術",
      mainUse:{kind:"attack-card",attack:{label:"遁術",classification:"normal",range:[1,2,3],auraDamage:1,lifeDamage:null,afterEffects:[{kind:"arrow",arrow:{kind:"aura-to-distance",count:1}},{kind:"arrow",arrow:{kind:"dust-to-distance",count:1}},{kind:"chikage-block-basic-advance"}]}},
      response:{kind:"attack-card",attack:{label:"遁術",classification:"normal",subtype:"response",range:[1,2,3],auraDamage:1,lifeDamage:null,afterEffects:[{kind:"arrow",arrow:{kind:"aura-to-distance",count:1}},{kind:"arrow",arrow:{kind:"dust-to-distance",count:1}},{kind:"chikage-block-basic-advance"}]}}
    },
    "re_09_chikage_o_n_4":{
      name:"暗器",
      mainUse:{kind:"attack-card",fullPowerize:true,attack:{label:"暗器",classification:"normal",range:[1,2,3,4,5],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"chikage-anki"}]}},
      response:{kind:"attack-card",attack:{label:"暗器",classification:"normal",subtype:"response",range:[1,2,3,4,5],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"chikage-anki"}]}}
    },
    "re_09_chikage_o_n_5":{
      name:"毒霧",
      mainUse:{kind:"action-card",effects:[{kind:"chikage-main-send-poison",allowed:["re_09_chikage_o_p_1","re_09_chikage_o_p_2","re_09_chikage_o_p_3"],destination:"hand"}]}
    },
    "re_09_chikage_o_n_6":{name:"抜き足",gap:true,mainUse:{kind:"enhancement-card",charge:4},enhancementDiscard:{kind:"none"}},
    "re_09_chikage_o_n_7":{name:"泥濘",mainUse:{kind:"enhancement-card",charge:2},enhancementDiscard:{kind:"none"}},
    "re_09_chikage_o_s_1":{
      name:"滅灯の魂毒",
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:3},effects:[{kind:"chikage-main-send-poison",allowed:["re_09_chikage_o_p_4"],destination:"deck-top"}]}
    },
    "re_09_chikage_o_s_2":{name:"叛旗の纏毒",mainUse:{kind:"enhancement-card",cost:{kind:"flare",amount:3},charge:3},enhancementDiscard:{kind:"none"}},
    "re_09_chikage_o_s_3":{
      name:"流転の霞毒",recharge:{kind:"opponent-hand-at-least",value:2},
      mainUse:{kind:"attack-card",cost:{kind:"flare",amount:1},attack:{label:"流転の霞毒",classification:"special",range:[3,4,5,6,7],auraDamage:1,lifeDamage:2}}
    },
    "re_09_chikage_o_s_4":{
      name:"闇昏千影の生きる道",
      mainUse:{kind:"enhancement-card",fullPower:true,cost:{kind:"flare",amount:5},charge:4},
      enhancementDiscard:{kind:"chikage-living-way-win"}
    },
    "re_09_chikage_o_p_1":{name:"麻痺毒",terminal:true,mainUse:{kind:"action-card",useCondition:{kind:"no-basic-actions-this-turn"},effects:[]}},
    "re_09_chikage_o_p_2":{name:"幻覚毒",mainUse:{kind:"action-card",effects:[{kind:"chikage-flare-to-dust",count:2}]}},
    "re_09_chikage_o_p_3":{name:"弛緩毒",mainUse:{kind:"enhancement-card",charge:3},enhancementDiscard:{kind:"none"}},
    "re_09_chikage_o_p_4":{name:"滅灯毒",mainUse:{kind:"action-card",effects:[{kind:"arrow",arrow:{kind:"aura-to-dust",count:3}}]}},
    "re_06_yukihi_o_n_1":{
      name:"しこみばり/ふくみばり",
      mainUse:{kind:"attack-card",attack:{label:"しこみばり/ふくみばり",classification:"normal",yukihiFaces:{
        closed:{label:"しこみばり",range:[4,5,6],auraDamage:3,lifeDamage:1},
        open:{label:"ふくみばり",range:[0,1,2],auraDamage:1,lifeDamage:2}
      }}}
    },
    "re_06_yukihi_o_n_2":{
      name:"しこみび/ねこだまし",
      mainUse:{kind:"attack-card",attack:{label:"しこみび/ねこだまし",classification:"normal",yukihiFaces:{
        closed:{label:"しこみび",range:[5,6],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"yukihi-shikomibi-return-toggle"}]},
        open:{label:"ねこだまし",range:[0,1,2],auraDamage:1,lifeDamage:1}
      }}}
    },
    "re_06_yukihi_o_n_3":{
      name:"ふりはらい/たぐりよせ",
      mainUse:{kind:"attack-card",attack:{label:"ふりはらい/たぐりよせ",classification:"normal",yukihiFaces:{
        closed:{label:"ふりはらい",range:[2,3,4,5],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"yukihi-furiharai-move",open:false}]},
        open:{label:"たぐりよせ",range:[0,1,2],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"yukihi-furiharai-move",open:true}]}
      }}}
    },
    "re_06_yukihi_o_n_4":{
      name:"ふりまわし/つきさし",
      mainUse:{kind:"attack-card",fullPower:true,attack:{label:"ふりまわし/つきさし",classification:"normal",subtype:"fullpower",yukihiFaces:{
        closed:{label:"ふりまわし",range:[4,5,6],auraDamage:5,lifeDamage:null},
        open:{label:"つきさし",range:[0,1,2],auraDamage:null,lifeDamage:2}
      }}}
    },
    "re_06_yukihi_o_n_5":{name:"かさまわし",mainUse:{kind:"action-card",effects:[{kind:"yukihi-toggle-matoi",source:"かさまわし"}]}},
    "re_06_yukihi_o_n_6":{
      name:"ひきあし/もぐりこみ",
      mainUse:{kind:"action-card",effects:[{kind:"yukihi-step"}]},
      response:{kind:"action-card",effect:{kind:"yukihi-step"}}
    },
    "re_06_yukihi_o_n_7":{
      name:"えんむすび",
      mainUse:{kind:"enhancement-card",charge:2,deployEffects:[{kind:"yukihi-enmusubi-deploy"}]},
      enhancementDiscard:{kind:"yukihi-enmusubi-discard"}
    },
    "re_06_yukihi_o_s_1":{
      name:"はらりゆき",
      mainUse:{kind:"attack-card",cost:{kind:"flare",amount:2},attack:{label:"はらりゆき",classification:"special",yukihiFaces:{
        closed:{label:"はらりゆき",range:[4,5],auraDamage:3,lifeDamage:1,afterEffects:[{kind:"focus-gain",count:1}]},
        open:{label:"はらりゆき",range:[0,1,2],auraDamage:0,lifeDamage:0,afterEffects:[{kind:"focus-gain",count:1}]}
      }}}
    },
    "re_06_yukihi_o_s_2":{
      name:"ゆらりび",
      mainUse:{kind:"attack-card",cost:{kind:"flare",amount:5},attack:{label:"ゆらりび",classification:"special",yukihiFaces:{
        closed:{label:"ゆらりび",range:[0],auraDamage:0,lifeDamage:0},
        open:{label:"ゆらりび",range:[0],auraDamage:4,lifeDamage:5}
      }}}
    },
    "re_06_yukihi_o_s_3":{
      name:"どろりうら",terminal:true,
      mainUse:{kind:"enhancement-card",cost:{kind:"flare",amount:2},charge:5},
      enhancementDiscard:{kind:"none"}
    },
    "re_06_yukihi_o_s_4":{
      name:"くるりみ",
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:1},effects:[{kind:"yukihi-toggle-matoi",source:"くるりみ"}]},
      response:{kind:"action-card",cost:{kind:"flare",amount:1},effect:{kind:"yukihi-toggle-matoi",source:"くるりみ"}}
    },
    "re_10_kururu_o_n_1":{
      name:"えれきてる",
      mainUse:{kind:"action-card",effects:[{kind:"kururu-direct-life",count:1,gear:{action:3,response:2},source:"えれきてる"}]}
    },
    "re_10_kururu_o_n_2":{
      name:"あくせらー",
      mainUse:{kind:"action-card",effects:[{kind:"kururu-accelerator",gear:{action:2,enhancement:1}}]}
    },
    "re_10_kururu_o_n_3":{
      name:"くるるーん",
      response:{kind:"action-card",grantedResponse:{kind:"always"},effect:{kind:"kururu-kururu-n"}}
    },
    "re_10_kururu_o_n_4":{
      name:"とるねーど",
      mainUse:{kind:"action-card",fullPower:true,effects:[{kind:"kururu-tornado"}]}
    },
    "re_10_kururu_o_n_5":{
      name:"りげいなー",
      allowMainFromFacedown:true,
      mainUse:{kind:"action-card",fullPower:true,effects:[{kind:"kururu-regainer",gear:{enhancement:1,response:1}}]}
    },
    "re_10_kururu_o_n_6":{
      name:"もじゅるー",
      kururuModule:true,
      mainUse:{kind:"enhancement-card",charge:3},
      enhancementDiscard:{kind:"none"}
    },
    "re_10_kururu_o_n_7":{
      name:"りふれくた",
      kururuReflector:true,
      mainUse:{kind:"enhancement-card",charge:0,deployEffects:[{kind:"kururu-reflector-charge",gear:{attack:1,response:1},count:4}]},
      enhancementDiscard:{kind:"none"}
    },
    "re_10_kururu_o_s_1":{
      name:"どれーんでびる",
      kururuDrainDevil:true,
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:3},effects:[{kind:"kururu-drain-devil"}]},
      response:{kind:"action-card",cost:{kind:"flare",amount:3},grantedResponse:{kind:"always"},effect:{kind:"kururu-drain-devil-response"}}
    },
    "re_10_kururu_o_s_2":{
      name:"びっぐごーれむ",
      kururuBigGolem:true,
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:4},effects:[]}
    },
    "re_10_kururu_o_s_3":{
      name:"いんだすとりあ",
      kururuIndustria:true,
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:1},effects:[{kind:"kururu-industria"}]}
    },
    "re_10_kururu_o_s_4":{
      name:"神渉装置：枢式",
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:3},effects:[{kind:"kururu-kansu"}]}
    },
    "re_12_raira_o_n_1":{
      name:"獣爪",
      mainUse:{kind:"attack-card",attack:{label:"獣爪",classification:"normal",range:[1,2],auraDamage:3,lifeDamage:1}}
    },
    "re_12_raira_o_n_2":{
      name:"風雷撃",
      mainUse:{kind:"attack-card",attack:{label:"風雷撃",classification:"normal",range:[1,2],auraDamage:0,lifeDamage:2}}
    },
    "re_12_raira_o_n_3":{
      name:"流転爪",
      mainUse:{kind:"attack-card",attack:{label:"流転爪",classification:"normal",range:[1,2],auraDamage:2,lifeDamage:1,afterEffects:[{kind:"raira-flow-return"}]}}
    },
    "re_12_raira_o_n_4":{
      name:"風走り",
      mainUse:{kind:"action-card",effects:[{kind:"arrow-if-distance-at-least",value:3,arrow:{kind:"distance-to-dust",count:2}}]}
    },
    "re_12_raira_o_n_5":{
      name:"風雷の知恵",
      mainUse:{kind:"action-card",effects:[{kind:"focus-gain",count:1},{kind:"raira-wisdom"}]}
    },
    "re_12_raira_o_n_6":{
      name:"呼び声",
      mainUse:{kind:"action-card",fullPower:true,effects:[{kind:"raira-call"}]}
    },
    "re_12_raira_o_n_7":{
      name:"空駆け",
      mainUse:{kind:"action-card",fullPower:true,effects:[{kind:"choose-arrows",arrows:[{kind:"distance-to-dust",count:3},{kind:"dust-to-distance",count:3}]}]}
    },
    "re_12_raira_o_s_1":{
      name:"雷螺風神爪",
      recharge:{kind:"raira-wind-at-least",value:4},
      mainUse:{kind:"attack-card",cost:{kind:"flare",amount:3},attack:{label:"雷螺風神爪",classification:"special",range:[1,2],auraDamage:2,lifeDamage:2}}
    },
    "re_12_raira_o_s_2":{
      name:"天雷召喚陣",
      mainUse:{kind:"action-card",fullPower:true,cost:{kind:"flare",amount:6},effects:[{kind:"raira-heavenly-array"}]}
    },
    "re_12_raira_o_s_3":{
      name:"風魔招来孔",
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:2},effects:[{kind:"raira-summon-extras"}]}
    },
    "re_12_raira_o_s_3_ex1":{
      name:"風魔旋風",
      mainUse:{kind:"attack-card",cost:{kind:"flare",amount:1},attack:{label:"風魔旋風",classification:"special",range:[1,2,3],auraDamage:1,lifeDamage:2}}
    },
    "re_12_raira_o_s_3_ex2":{
      name:"風魔纏廻",
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:1},effects:[{kind:"raira-wrap-ready-special"}]}
    },
    "re_12_raira_o_s_3_ex3":{
      name:"風魔天狗道",
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:4},effects:[{kind:"raira-tengu-step"}]},
      response:{kind:"action-card",cost:{kind:"flare",amount:4},effect:{kind:"raira-tengu-step"}}
    },
    "re_12_raira_o_s_4":{
      name:"円環輪廻旋",
      response:{kind:"enhancement-card",cost:{kind:"flare",amount:2},charge:2},
      enhancementDiscard:{kind:"none"}
    },
    "re_19_megumi_o_n_1":{name:"空閃",mainUse:{kind:"attack-card",attack:{label:"空閃",classification:"normal",range:[4,5,6,7,8],auraDamage:2,lifeDamage:1,dynamicModifiers:[{kind:"megumi-if-soil-unbloomed-empty",auraDelta:1,lifeDelta:1,label:"種結晶なし"}]}}},
    "re_19_megumi_o_n_2":{name:"打擲",mainUse:{kind:"attack-card",attack:{label:"打擲",classification:"normal",range:[4,5],auraDamage:2,lifeDamage:1,dynamicModifiers:[{kind:"megumi-if-seed-on-enhancement",auraDelta:1,lifeDelta:1,label:"種結晶"}]}}},
    "re_19_megumi_o_n_3":{name:"殻打ち",mainUse:{kind:"attack-card",attack:{label:"殻打ち",classification:"normal",range:[3,4,5],auraDamage:2,lifeDamage:1,afterEffects:[{kind:"megumi-shell-growth",count:2}]}}},
    "re_19_megumi_o_n_4":{name:"葦",mainUse:{kind:"enhancement-card",charge:1,growth:1,deployEffects:[{kind:"arrow",arrow:{kind:"dust-to-distance",count:1}}]},enhancementDiscard:{kind:"none"}},
    "re_19_megumi_o_n_5":{name:"鳳仙花",gap:true,mainUse:{kind:"enhancement-card",charge:1,growth:2},enhancementDiscard:{kind:"intimidate-opponent"}},
    "re_19_megumi_o_n_6":{name:"野茨",mainUse:{kind:"enhancement-card",fullPower:true,charge:0,growth:2,deployEffects:[{kind:"megumi-basic-action"}]},enhancementDiscard:{kind:"none"}},
    "re_19_megumi_o_n_7":{name:"棹穿ち",mainUse:{kind:"attack-card",attack:{label:"棹穿ち",classification:"normal",range:[2,3,4],auraDamage:1,lifeDamage:1,damageDestination:"distance",afterEffects:[{kind:"megumi-cancel-next-basic-if-enhancement"}]}}},
    "re_19_megumi_o_s_1":{name:"因果律の根",recharge:{kind:"megumi-no-bloomed-soil"},mainUse:{kind:"attack-card",cost:{kind:"flare",amount:1},attack:{label:"因果律の根",classification:"special",range:[3,4,5,6,7],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"megumi-germinate",count:1}]}}},
    "re_19_megumi_o_s_2":{name:"可能性の枝",response:{kind:"enhancement-card",cost:{kind:"flare",amount:4},charge:2,growth:1,deployEffects:[{kind:"megumi-branch-reduce-parent"}]},enhancementDiscard:{kind:"none"}},
    "re_19_megumi_o_s_3":{name:"結末の果実",mainUse:{kind:"enhancement-card",cost:{kind:"flare",amount:4},charge:2},enhancementDiscard:{kind:"none"}},
    "re_19_megumi_o_s_4":{name:"瀧河希の掌",mainUse:{kind:"enhancement-card",cost:{kind:"flare",amount:3},charge:0,growth:5},enhancementDiscard:{kind:"none"}},
    "re_11_thallya_o_n_1":{
      name:"Burning Steam",
      mainUse:{kind:"attack-card",attack:{label:"Burning Steam",classification:"normal",range:[3,4,5,6,7],auraDamage:2,lifeDamage:1,afterEffects:[{kind:"thallya-ride",optional:false,source:"Burning Steam"}]}}
    },
    "re_11_thallya_o_n_2":{
      name:"Waving Edge",
      mainUse:{kind:"attack-card",burn:1,attack:{label:"Waving Edge",classification:"normal",range:[1,2,3],auraDamage:3,lifeDamage:1,afterEffects:[{kind:"thallya-ride",optional:false,source:"Waving Edge"}]}}
    },
    "re_11_thallya_o_n_3":{
      name:"Shield Charge",
      mainUse:{kind:"attack-card",burn:1,attack:{label:"Shield Charge",classification:"normal",range:[1],auraDamage:3,lifeDamage:2,damageDestination:"distance"}}
    },
    "re_11_thallya_o_n_4":{
      name:"Steam Cannon",
      mainUse:{kind:"attack-card",burn:1,fullPowerize:true,attack:{label:"Steam Cannon",classification:"normal",range:[3,4,5,6,7],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"thallya-steam-cannon-recover"}]}}
    },
    "re_11_thallya_o_n_5":{
      name:"Dual Action",
      mainUse:{kind:"attack-card",fullPower:true,attack:{label:"Dual Action",classification:"normal",subtype:"fullpower",range:[2,3,4,5,6,7],auraDamage:1,lifeDamage:1,afterEffects:[{kind:"thallya-dual-action"}]}}
    },
    "re_11_thallya_a1_n_5":{
      name:"Quick Change",
      mainUse:{kind:"action-card",effects:[{kind:"thallya-quick-change"}]}
    },
    "re_11_thallya_o_n_6":{
      name:"Roaring",
      mainUse:{kind:"action-card",effects:[{kind:"thallya-roaring"}]}
    },
    "re_11_thallya_o_n_7":{
      name:"Turbo Switch",
      mainUse:{kind:"action-card",burn:1,effects:[{kind:"thallya-ride-main"}]},
      response:{kind:"action-card",burn:1,effect:{kind:"thallya-ride-response"}}
    },
    "re_11_thallya_o_s_1":{
      name:"Alpha-Edge",
      mainUse:{kind:"attack-card",cost:{kind:"flare",amount:1},attack:{label:"Alpha-Edge",classification:"special",range:[1,3,5,7],auraDamage:1,lifeDamage:1}}
    },
    "re_11_thallya_a1_s_1":{
      name:"BlackBox NEO",
      terminal:true,
      recharge:{kind:"thallya-neo"},
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:1},effects:[{kind:"thallya-blackbox-neo"}]}
    },
    "re_11_thallya_a1_s_2":{
      name:"OMNIS-Blaster",
      mainUse:{kind:"attack-card",cost:{kind:"thallya-transform-count"},attack:{label:"OMNIS-Blaster",classification:"special",range:[3,4,5,6,7,8,9,10],auraDamage:0,lifeDamage:0}}
    },
    "re_11_thallya_o_s_2":{
      name:"Omega-Burst",
      mainUse:{kind:"action-card",cost:{kind:"flare",amount:4},effects:[{kind:"thallya-recover-all"}]},
      response:{kind:"action-card",cost:{kind:"flare",amount:4},effect:{kind:"thallya-omega-response"}}
    },
    "re_11_thallya_o_s_3":{
      name:"Thallya's Masterpiece",
      mainUse:{kind:"enhancement-card",cost:{kind:"flare",amount:2},charge:3},
      enhancementDiscard:{kind:"none"},
      thallyaMasterpiece:true
    },
    "re_11_thallya_o_s_4":{
      name:"Julia's BlackBox",
      mainUse:{kind:"action-card",fullPower:true,cost:{kind:"flare",amount:2},effects:[{kind:"thallya-blackbox"}]}
    },
    "re_15_korunu_o_n_1":{
      name:"雪刃",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"雪刃",classification:"normal",range:[3,4,5,6],auraDamage:1,lifeDamage:1,
          afterEffects:[{kind:"freeze-opponent",count:1}]
        }
      }
    },
    "re_15_korunu_o_n_2":{
      name:"旋回刃",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"旋回刃",classification:"normal",range:[2,3],auraDamage:2,lifeDamage:2,
          afterEachResponseEffects:[{kind:"choose-distance-dust",count:2}]
        }
      }
    },
    "re_15_korunu_o_n_3":{
      name:"剣の舞",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"剣の舞",classification:"normal",range:[4,5],auraDamage:2,lifeDamage:1,
          dynamicModifiers:[{kind:"if-defender-aura-no-space",auraDelta:1,lifeDelta:1,label:"剣の舞"}]
        }
      }
    },
    "re_15_korunu_o_n_4":{
      name:"雪渡り",
      mainUse:{
        kind:"action-card",
        effects:[
          {kind:"choose-arrows",arrows:[{kind:"distance-to-dust",count:1},{kind:"dust-to-distance",count:1}]},
          {kind:"optional-arrow-if-opponent-aura-no-space",arrow:{kind:"dust-to-distance",count:1}}
        ]
      }
    },
    "re_15_korunu_o_n_5":{
      name:"絶対零度",
      mainUse:{
        kind:"action-card",
        fullPowerize:true,
        effects:[{kind:"korunu-absolute-zero"}]
      },
      response:{
        kind:"action-card",
        effect:{kind:"korunu-absolute-zero"}
      }
    },
    "re_15_korunu_o_n_6":{
      name:"かじかみ",
      mainUse:{
        kind:"enhancement-card",charge:2,
        deployEffects:[{kind:"freeze-opponent",count:1}]
      },
      enhancementDiscard:{kind:"none"}
    },
    "re_15_korunu_o_n_7":{
      name:"霜の茨",
      mainUse:{kind:"enhancement-card",charge:2},
      enhancementDiscard:{kind:"none"},
      korunuFrostThorn:true
    },
    "re_15_korunu_o_s_1":{
      name:"コンルルヤンペ",
      mainUse:{
        kind:"attack-card",cost:{kind:"flare",amount:4},
        attack:{
          label:"コンルルヤンペ",classification:"special",range:[3,4,5],auraDamage:2,lifeDamage:3,
          afterEffects:[{kind:"freeze-opponent-if-aura-damage-chosen",untilFull:true}]
        }
      }
    },
    "re_15_korunu_o_s_2":{
      name:"レタルレラ",
      mainUse:{
        kind:"action-card",cost:{kind:"flare",amount:2},
        effects:[{kind:"korunu-retarulera-main"}]
      },
      response:{
        kind:"action-card",cost:{kind:"flare",amount:2},
        effect:{kind:"korunu-retarulera-response"}
      }
    },
    "re_15_korunu_o_s_3":{
      name:"ウパシトゥム",
      instantRecharge:{kind:"opponent-aura-space-to-none"},
      mainUse:{
        kind:"attack-card",cost:{kind:"flare",amount:0},
        attack:{
          label:"ウパシトゥム",classification:"special",range:[3,4,5,6],auraDamage:0,lifeDamage:null,
          afterEffects:[{kind:"freeze-opponent",count:1}]
        }
      }
    },
    "re_15_korunu_o_s_4":{
      name:"ポルチャルトー",
      mainUse:{
        kind:"enhancement-card",cost:{kind:"flare",amount:2},charge:1,
        deployEffects:[{kind:"korunu-porucharto"}]
      },
      response:{
        kind:"enhancement-card",cost:{kind:"flare",amount:4},charge:1,
        grantedResponse:{kind:"always"},
        deployEffects:[{kind:"korunu-porucharto"}]
      },
      enhancementDiscard:{kind:"korunu-porucharto-redeploy",charge:4,cost:2}
    },
    "re_05_oboro_o_n_1":{
      name:"鋼糸",
      install:true,
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"鋼糸",
          classification:"normal",
          range:[3,4,5],
          auraDamage:2,
          lifeDamage:1,
          dynamicModifiers:[
            {kind:"if-used-from-facedown",auraDelta:0,lifeDelta:1,label:"設置"}
          ]
        }
      }
    },
    "re_05_oboro_o_n_2":{
      name:"影菱",
      install:true,
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"影菱",
          classification:"normal",
          range:[2,3],
          auraDamage:2,
          lifeDamage:1,
          responseForbidden:true,
          afterEffects:[
            {kind:"intimidate-opponent-if-used-from-facedown"}
          ]
        }
      }
    },
    "re_05_oboro_o_n_3":{
      name:"分身の術",
      mainUse:{
        kind:"attack-card",
        attack:{
          label:"分身の術",
          classification:"normal",
          range:[3,4],
          auraDamage:2,
          lifeDamage:1,
          afterEffects:[
            {
              kind:"optional-hand-facedown-then-generated-attack-and-matoi",
              attack:{label:"分身の術（分身）",classification:null,range:[3,4],auraDamage:1,lifeDamage:1}
            }
          ]
        }
      }
    },
    "re_05_oboro_o_n_4":{
      name:"斬撃乱舞",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        attack:{
          label:"斬撃乱舞",
          classification:"normal",
          subtype:"fullpower",
          range:[2,3,4],
          auraDamage:3,
          lifeDamage:2,
          dynamicModifiers:[
            {kind:"if-defender-aura-damaged-this-turn",auraDelta:1,lifeDelta:1,label:"斬撃乱舞"}
          ]
        }
      }
    },
    "re_05_oboro_o_n_5":{
      name:"忍歩",
      install:true,
      mainUse:{
        kind:"action-card",
        effects:[
          {kind:"choose-arrows",arrows:[{kind:"dust-to-distance",count:1}]},
          {kind:"use-install-from-facedown-if-source-facedown"}
        ]
      }
    },
    "re_05_oboro_o_n_6":{
      name:"誘導",
      install:true,
      mainUse:{
        kind:"action-card",
        effects:[
          {
            kind:"choose-arrows",
            arrows:[
              {kind:"distance-to-opponent-aura",count:1},
              {kind:"opponent-aura-to-flare",count:1}
            ]
          }
        ]
      },
      response:{
        kind:"action-card",
        effect:{
          kind:"choose-arrows",
          arrows:[
            {kind:"distance-to-opponent-aura",count:1},
            {kind:"opponent-aura-to-flare",count:1}
          ]
        }
      }
    },
    "re_05_oboro_o_n_7":{
      name:"生体活性",
      install:true,
      gap:true,
      mainUse:{
        kind:"enhancement-card",
        charge:4
      },
      enhancementDiscard:{kind:"ready-one-used-special"}
    },
    "re_05_oboro_o_s_1":{
      name:"熊介",
      mainUse:{
        kind:"attack-card",
        fullPower:true,
        cost:{kind:"flare",amount:4},
        attack:{
          label:"熊介",
          classification:"special",
          subtype:"fullpower",
          range:[3,4],
          auraDamage:2,
          lifeDamage:2,
          afterEffects:[
            {
              kind:"repeat-generated-attack-own-facedown-count",
              attack:{label:"熊介（追加）",classification:null,range:[3,4],auraDamage:2,lifeDamage:2}
            }
          ]
        }
      }
    },
    "re_05_oboro_o_s_2":{
      name:"鳶影",
      mainUse:{
        kind:"action-card",
        cost:{kind:"flare",amount:4},
        effects:[{kind:"use-facedown-non-fullpower"}]
      },
      response:{
        kind:"action-card",
        cost:{kind:"flare",amount:4},
        effect:{kind:"use-facedown-non-fullpower"}
      }
    },
    "re_05_oboro_o_s_3":{
      name:"虚魚",
      mainUse:{
        kind:"enhancement-card",
        cost:{kind:"flare",amount:2},
        charge:3,
        deployEffects:[{kind:"move-any-discard-to-facedown"}]
      },
      enhancementDiscard:{kind:"none"},
      oboroUro:true
    },
    "re_05_oboro_o_s_4":{
      name:"壬蔓",
      recharge:{kind:"self-flare-is",value:0},
      mainUse:{
        kind:"attack-card",
        cost:{kind:"flare",amount:0},
        attack:{
          label:"壬蔓",
          classification:"special",
          range:[3,4,5,6,7],
          auraDamage:1,
          lifeDamage:1,
          afterEffects:[{kind:"arrow",arrow:{kind:"dust-to-flare",count:1}}]
        }
      }
    },
  });
}

const YURINA_A2_REPLACEMENTS={
  "re_01_yurina_o_n_3":"re_01_yurina_a2_n_3",
  "re_01_yurina_o_n_7":"re_01_yurina_a2_n_7",
  "re_01_yurina_o_s_1":"re_01_yurina_a2_s_1"
};
export function yurinaA2ReplacementSlug(slug){
  const key=normalizeCardSlug(slug);
  return YURINA_A2_REPLACEMENTS[key]||key;
}
export function applyYurinaA2CardReplacements(state,playerId){
  const pid=Number(playerId);
  if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
  const next=clone(state||{});
  const status=next?.[`p${pid}_card_status`]||{};
  for(const row of Object.values(status)){
    const replacement=YURINA_A2_REPLACEMENTS[normalizeCardSlug(row?.Slug||row?.slug||"")];
    if(replacement) row.Slug=replacement;
  }
  return next;
}

const THALLYA_A1_REPLACEMENTS={
  "re_11_thallya_o_n_5":"re_11_thallya_a1_n_5",
  "re_11_thallya_o_s_1":"re_11_thallya_a1_s_1",
  "re_11_thallya_o_s_2":"re_11_thallya_a1_s_2"
};
export function thallyaA1ReplacementSlug(slug){
  const key=normalizeCardSlug(slug);
  return THALLYA_A1_REPLACEMENTS[key]||key;
}
export function applyThallyaA1CardReplacements(state,playerId){
  const pid=Number(playerId);
  if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
  const next=clone(state||{});
  const status=next?.[`p${pid}_card_status`]||{};
  for(const row of Object.values(status)){
    const replacement=THALLYA_A1_REPLACEMENTS[normalizeCardSlug(row?.Slug||row?.slug||"")];
    if(replacement) row.Slug=replacement;
  }
  return next;
}

function stateCardSlug(state,playerId,cardId){
  const pid=Number(playerId),id=String(cardId);
  let row=state?.[`p${pid}_card_status`]?.[id];
  if(!row){
    const other=pid===1?2:1;
    const candidate=state?.[`p${other}_card_status`]?.[id];
    if(candidate&&isChikagePoisonSlug(candidate?.Slug||candidate?.slug||"")) row=candidate;
  }
  return normalizeCardSlug(row?.Slug||"");
}
function usedSpecialCandidates(state,playerId){
  const pid=Number(playerId),statusMap=state?.[`p${pid}_special_status`]||{};
  return arr(state?.[`p${pid}_special`])
    .filter(cardId=>Number(statusMap[String(cardId)])===2);
}
function readySpecialCard(state,playerId,cardId){
  const pid=Number(playerId),id=String(cardId);
  if(!arr(state?.[`p${pid}_special`]).some(x=>String(x)===id)) throw new Error("special card is not in special zone");
  if(Number(state?.[`p${pid}_special_status`]?.[id])!==2) throw new Error("special card is not used");
  if(!state[`p${pid}_special_status`]||typeof state[`p${pid}_special_status`]!=="object") state[`p${pid}_special_status`]={};
  state[`p${pid}_special_status`][id]=0;
}

export class CoreTurnSandboxEnvironment{
  constructor(initialState,options={}){
    this.initialState=clone(initialState||{});
    this.ruleExtensions=normalizeRuleExtensions(options.ruleExtensions);
    this.cardRuleRegistry=options.cardRuleRegistry instanceof CardRuleRegistry
      ? options.cardRuleRegistry
      : createDefaultCardRuleRegistry();
    this.options={
      ...coreRuleOptions(options),
      startingPlayer:Number(options.startingPlayer)===2?2:1,
      maxTurns:Math.max(1,Number(options.maxTurns)||12),
      chanceSeed:Number(options.chanceSeed)||246813579,
      randomizeHiddenDecks:options.randomizeHiddenDecks!==false,
      openingSetup:options.openingSetup===true,
      openingMulliganChoices:options.openingMulliganChoices==null?null:clone(options.openingMulliganChoices),
      openingMulliganRate:Math.max(0,Math.min(1,Number.isFinite(Number(options.openingMulliganRate))?Number(options.openingMulliganRate):0.35)),
      opponentBeliefMode:String(options.opponentBeliefMode||"decklist-known"),
      opponentBeliefPriors:clone(options.opponentBeliefPriors||{}),
      turnsTaken:{
        1:Math.max(0,Number(options.turnsTaken?.[1] ?? options.turnsTaken?.["1"] ?? (options.openingSetup===true?0:1))||0),
        2:Math.max(0,Number(options.turnsTaken?.[2] ?? options.turnsTaken?.["2"] ?? (options.openingSetup===true?0:1))||0)
      },
      attackCountsThisTurn:{
        1:Math.max(0,Number(options.attackCountsThisTurn?.[1] ?? options.attackCountsThisTurn?.["1"] ?? 0)||0),
        2:Math.max(0,Number(options.attackCountsThisTurn?.[2] ?? options.attackCountsThisTurn?.["2"] ?? 0)||0)
      },
      cardUseCountsThisTurn:{
        1:Math.max(0,Number(options.cardUseCountsThisTurn?.[1] ?? options.cardUseCountsThisTurn?.["1"] ?? 0)||0),
        2:Math.max(0,Number(options.cardUseCountsThisTurn?.[2] ?? options.cardUseCountsThisTurn?.["2"] ?? 0)||0)
      },
      turnStartDistance:Number.isFinite(Number(options.turnStartDistance))?Math.max(0,Number(options.turnStartDistance)):null
    };
    this.reset();
  }
  reset(){
    this.state=clone(this.initialState);
    for(const pid of [1,2]){
      for(const zone of ["hand","deck","facedown","discard","special","enhancement","using","outside"]){
        this.state[`p${pid}_${zone}`]=arr(this.state[`p${pid}_${zone}`]);
      }
      this.state[`p${pid}_poison_bag`]=arr(this.state[`p${pid}_poison_bag`]);
      this.state[`p${pid}_chikage_no_basic_advance`]=!!this.state[`p${pid}_chikage_no_basic_advance`];
      if(stateHasKururu(this.state,pid)) this.state[`p${pid}_kururu_known_opponent_specials`]=arr(this.state[`p${pid}_kururu_known_opponent_specials`]);
      if(stateHasRaira(this.state,pid)){
        const wind=Number(this.state[`p${pid}_raira_wind`]);
        const thunder=Number(this.state[`p${pid}_raira_thunder`]);
        this.state[`p${pid}_raira_wind`]=Math.max(0,Math.min(20,Number.isFinite(wind)?Math.floor(wind):0));
        this.state[`p${pid}_raira_thunder`]=Math.max(0,Math.min(20,Number.isFinite(thunder)?Math.floor(thunder):0));
      }
      if(stateHasMegumi(this.state,pid)){
        this.state[`p${pid}_megumi_wild_triggered_turn`]=false;
        const outside=megumiSeedCountOutsideSoil(this.state,pid);
        const rawUn=Number(this.state[`p${pid}_megumi_soil_unbloomed`]);
        const rawBl=Number(this.state[`p${pid}_megumi_soil_bloomed`]);
        this.state[`p${pid}_megumi_soil_unbloomed`]=Number.isFinite(rawUn)?Math.max(0,Math.floor(rawUn)):Math.max(0,5-outside);
        this.state[`p${pid}_megumi_soil_bloomed`]=Number.isFinite(rawBl)?Math.max(0,Math.floor(rawBl)):0;
      }
      if(stateHasThallya(this.state,pid)){
        if(!Number.isFinite(Number(this.state[`p${pid}_thallya_machine`]))) this.state[`p${pid}_thallya_machine`]=5;
        if(!Number.isFinite(Number(this.state[`p${pid}_thallya_burned`]))) this.state[`p${pid}_thallya_burned`]=0;
        this.state[`p${pid}_thallya_ride_tokens`]=arr(this.state[`p${pid}_thallya_ride_tokens`]);
        this.state[`p${pid}_thallya_form`]=String(this.state[`p${pid}_thallya_form`]||"");
        this.state[`p${pid}_thallya_draw_limit_once`]=Math.max(0,n(this.state[`p${pid}_thallya_draw_limit_once`]));
      }
    }
    for(const pid of [1,2]) initializeChikagePoisonBag(this.state,pid);
    this.random=seededUnit(this.options.chanceSeed);
    for(const pid of [1,2]) this.state[`p${pid}_known_deck_top`]=arr(this.state[`p${pid}_known_deck_top`]);
    this.openingSetup=null;
    if(this.options.openingSetup){
      const first=this.options.startingPlayer;
      const second=first===1?2:1;
      const players=[first,second];
      const mulligans={};
      for(const pid of [1,2]){
        const handKey=`p${pid}_hand`,deckKey=`p${pid}_deck`;
        const pool=[...arr(this.state[handKey]),...arr(this.state[deckKey])];
        const shuffled=shuffleWith(this.random,pool);
        this.state[handKey]=shuffled.slice(0,3);
        this.state[deckKey]=shuffled.slice(3);
        this.state[`p${pid}_known_deck_top`]=[];
      }
      for(const pid of players){
        const handKey=`p${pid}_hand`,deckKey=`p${pid}_deck`;
        const before=arr(this.state[handKey]);
        const selected=this.options.openingMulliganChoices?.[pid] ?? this.options.openingMulliganChoices?.[String(pid)];
        const keepSelected=Array.isArray(selected)?new Set(selected.map(String)):null;
        const returned=keepSelected?before.filter(cardId=>keepSelected.has(String(cardId))):before.filter(()=>this.random()<this.options.openingMulliganRate);
        const returnedSet=new Set(returned.map(String));
        this.state[handKey]=before.filter(cardId=>!returnedSet.has(String(cardId)));
        this.state[deckKey]=arr(this.state[deckKey]);
        this.state[deckKey].push(...returned);
        const drawn=[];
        for(let i=0;i<returned.length;i++){
          const cardId=this.state[deckKey].shift();
          if(cardId==null) break;
          this.state[handKey].push(cardId);
          drawn.push(cardId);
        }
        mulligans[pid]={
          playerId:pid,
          before:clone(before),
          returned:clone(returned),
          drawn:clone(drawn),
          after:clone(this.state[handKey])
        };
      }
      for(const pid of [1,2]) this.state[`p${pid}_flare`]=0;
      this.state[`p${first}_focus`]=0;
      this.state[`p${second}_focus`]=1;
      this.openingSetup={
        firstPlayer:first,
        secondPlayer:second,
        mulliganOrder:players,
        mulligans
      };
    }else if(this.options.randomizeHiddenDecks){
      for(const pid of [1,2]){
        this.state[`p${pid}_deck`]=shuffleWith(this.random,this.state[`p${pid}_deck`]);
        this.state[`p${pid}_known_deck_top`]=[];
      }
    }
    this.openingState=clone(this.state);
    this.opponentBeliefs={};
    for(const observerId of [1,2]){
      const prior=this.options.opponentBeliefPriors?.[observerId]||this.options.opponentBeliefPriors?.[String(observerId)]||{};
      this.opponentBeliefs[observerId]=createOpponentBeliefTrackerFromState(this.state,observerId,{
        mode:this.options.opponentBeliefMode,
        cardPool:arr(prior.cardPool),
        locationPriors:arr(prior.locationPriors),
        behaviorEvidence:arr(prior.behaviorEvidence),
        likelyHeld:arr(prior.likelyHeld),
        expectedPlayMissing:arr(prior.expectedPlayMissing)
      });
    }
    this.turnPlayer=this.options.startingPlayer;
    this.turnNumber=1;
    this.completedTurns=0;
    this.turnsTaken={1:this.options.turnsTaken[1],2:this.options.turnsTaken[2]};
    this.phase="main";
    this.pendingDraws=0;
    this.pendingEnhancementDiscards=[];
    this.pendingEnhancementDiscardSelected=null;
    this.pendingEnhancementDiscardOwner=null;
    this.pendingEnhancementTickPlayers=[];
    this.enhancementTickOwner=null;
    this.skipFirstStartEnhancementRest=false;
    this.pendingCardDecision=null;
    this.pendingAttack=null;
    this.attackStack=[];
    this.pendingEffectFatigue=null;
    this.pendingResponseCard=null;
    this.pendingMainCard=null;
    this.pendingMainCardStack=[];
    this.pendingReconstruction=null;
    this.mainMode=null;
    this.fullPowerCardUsed=false;
    this.nextAttackModifiers={1:[],2:[]};
    this.nextOtherMegamiAttackModifiers={1:[],2:[]};
    this.nextOtherMegamiGrowthBonus={1:0,2:0};
    for(const pid of [1,2]){
      this.state["p"+pid+"_intimidated"]=!!this.state["p"+pid+"_intimidated"];
      this.state["p"+pid+"_yukihi_umbrella_open"]=!!this.state["p"+pid+"_yukihi_umbrella_open"];
    }
    this.attackCountsThisTurn={1:this.options.attackCountsThisTurn[1],2:this.options.attackCountsThisTurn[2]};
    this.nonSpecialAttackCountsThisTurn={1:0,2:0};
    this.cardUseCountsThisTurn={1:this.options.cardUseCountsThisTurn[1],2:this.options.cardUseCountsThisTurn[2]};
    this.basicActionsThisTurn={1:0,2:0};
    this.auraDamageTakenThisTurn={1:false,2:false};
    this.turnStartDistance=Math.max(0,n(this.options.turnStartDistance??this.state.distance));
    this.attackPerformedInPhase={1:false,2:false};
    this.centrifugalUsedThisTurn={1:false,2:false};
    this.shinraPlan={1:"神算",2:"神算"};
    this.pendingShinraPlan=null;
    this.pendingAttackPostResponseChoice=null;
    this.pendingYukihiEndToggle=null;
    this.pendingKururuBasic=null;
    this.pendingKururuDrainReuse=null;
    this.pendingYurinaAunTriggers=[];
    this.pendingMegumiMainStartAttacks=null;
    this.nextRairaGaugeChoice={1:null,2:null};
    this.megumiPalmUsedThisTurn={1:false,2:false};
    this.terminalLocked={1:false,2:false};
    this.done=false;
    this.doneReason="";
    this.winner=null;
    this.history=[];
    return this.snapshot();
  }
  currentPlayer(){
    if(this.done) return null;
    if(this.phase==="effect-fatigue" && this.pendingEffectFatigue) return Number(this.pendingEffectFatigue.playerId);
    if(this.phase==="response-card-choice" && this.pendingResponseCard) return Number(this.pendingResponseCard.playerId);
    if(this.phase==="start-card-choice" && this.pendingCardDecision?.playerId) return Number(this.pendingCardDecision.playerId);
    if(this.phase==="reconstruction-install-choice" && this.pendingReconstruction) return Number(this.pendingReconstruction.playerId);
    if(this.phase==="shinra-plan-choice" && this.pendingShinraPlan) return Number(this.pendingShinraPlan.playerId);
    if(this.phase==="attack-post-response-choice" && this.pendingAttackPostResponseChoice) return Number(this.pendingAttackPostResponseChoice.playerId);
    if(this.phase==="yukihi-end-toggle-choice" && this.pendingYukihiEndToggle) return Number(this.pendingYukihiEndToggle.playerId);
    if(this.phase==="kururu-trigger-basic" && this.pendingKururuBasic) return Number(this.pendingKururuBasic.playerId);
    if(this.phase==="kururu-drain-reuse" && this.pendingKururuDrainReuse?.entries?.length) return Number(this.pendingKururuDrainReuse.entries[0].playerId);
    if(["main-effect-choice","main-effect-basic","main-enhancement-choice","main-enhancement-effect-choice"].includes(this.phase) && this.pendingMainCard) return Number(this.pendingMainCard.playerId);
    if(this.pendingAttack && ["attack-response","attack-damage-choice"].includes(this.phase)) return Number(this.pendingAttack.defender);
    return this.turnPlayer;
  }
  _ruleHook(hook,extra={}){
    return callRuleExtensions(this.ruleExtensions,hook,{
      environment:this,
      state:this.state,
      playerId:this.turnPlayer,
      phase:this.phase,
      turnNumber:this.turnNumber,
      ...extra
    });
  }
  observe(playerId){
    const pid=Number(playerId);
    if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
    const opponentId=pid===1?2:1;
    const belief=this.opponentBeliefs?.[pid]?.snapshot(this.state,opponentId,[1,2])||null;
    return observationForPlayer(this.state,pid,{
      turn:this.turnNumber,
      rawTurn:this.turnNumber,
      turnPlayer:this.turnPlayer,
      phase:this.phase,
      opponentBelief:belief,
      pendingAttack:this.pendingAttack?clone(this.pendingAttack):null,
      terminalLocked:clone(this.terminalLocked),
      mainMode:this.mainMode,
      fullPowerCardUsed:this.fullPowerCardUsed,
      fullPowerMainCardAvailable:this.phase==="main" && !this.mainMode
        ? this._fullPowerMainCardAvailable(pid)
        : null,
      attackCountsThisTurn:clone(this.attackCountsThisTurn),
      nonSpecialAttackCountsThisTurn:clone(this.nonSpecialAttackCountsThisTurn),
      cardUseCountsThisTurn:clone(this.cardUseCountsThisTurn),
      nextOtherMegamiAttackModifiers:clone(this.nextOtherMegamiAttackModifiers),
      selfTurnNumber:Math.max(1,n(this.turnsTaken?.[pid])+1),
      pendingMainChoiceKind:String(this.pendingMainCard?.pendingChoice?.kind||""),
      selfShinraPlan:this._hasShinra(pid)?(this.shinraPlan?.[pid]||"神算"):null,
      intimidated:{
        1:!!this.state.p1_intimidated,
        2:!!this.state.p2_intimidated
      }
    });
  }
  applyOpponentBehaviorEvidence(observerId,cardId,evidence={}){
    const observer=Number(observerId);
    if(observer!==1&&observer!==2) throw new Error("observerId must be 1 or 2");
    this.opponentBeliefs?.[observer]?.applyBehaviorEvidence(cardId,evidence);
    return this.opponentBeliefs?.[observer]||null;
  }
  noteOpponentExpectedPlayMissing(observerId,cardId,strength=0.65,reason="expected-play-missing"){
    return this.opponentBeliefs?.[Number(observerId)]?.noteExpectedPlayMissing(cardId,strength,reason)||null;
  }
  noteOpponentLikelyHeld(observerId,cardId,strength=0.65,reason="likely-held"){
    return this.opponentBeliefs?.[Number(observerId)]?.noteLikelyHeld(cardId,strength,reason)||null;
  }
  legalActions(playerId=this.currentPlayer()){
    if(this.done) return [];
    const pid=Number(playerId),active=this.currentPlayer();
    if(pid!==active) return [];
    if(this.phase==="main"){
      if(this.terminalLocked?.[pid]) return [endTurnAction(pid)];
      if(!this.mainMode){
        return [
          mainModeAction(pid,TURN_MAIN_STANDARD,"標準行動"),
          mainModeAction(pid,TURN_MAIN_FULLPOWER,"全力行動")
        ];
      }
      if(this.mainMode==="fullpower"){
        if(this.fullPowerCardUsed) return [endTurnAction(pid)];
        return [...this._registeredMainCardActions(pid),endTurnAction(pid)];
      }
      const standardBasics=generateStandardBasicActions(this.state,pid,this.options).map(action=>{
        if(Number(action?.basicAction)!==2) return action;
        const attackEnable=baselineBackwardEnablesAttack(this.state,pid,action,this.cardRuleRegistry,this.options);
        const mondoComboTarget=baselineBackwardMondoComboTarget(this.state,pid,action,this.cardRuleRegistry,this.options);
        const nextState=mondoComboTarget?applyStandardBasicAction(this.state,pid,action,this.options):null;
        const mondoComboReady=!!mondoComboTarget && effectiveCurrentDistance(nextState)===mondoComboTarget;
        return {
          ...action,
          baselineEnablesAttack:attackEnable||!!mondoComboTarget,
          ...(mondoComboTarget?{
            baselineMondoComboSpacing:true,
            baselineMondoComboTarget:mondoComboTarget,
            baselineMondoComboReady:mondoComboReady
          }: {})
        };
      });
      return [
        ...this._registeredMainCardActions(pid),
        ...standardBasics,
        ...this._registeredThallyaExtraBasicActions(pid),
        endTurnAction(pid)
      ];
    }
    if(this.phase==="kururu-drain-reuse" && this.pendingKururuDrainReuse?.entries?.length){
      const actions=[
        {actor:pid,kind:"再使用",label:"どれーんでびるを再使用しない",rule:TURN_KURURU_DRAIN_REUSE,use:false},
        {actor:pid,kind:"再使用",label:"どれーんでびるを再使用",rule:TURN_KURURU_DRAIN_REUSE,use:true}
      ];
      return this._rairaUseActionVariants(pid,actions,action=>action.use?"re_10_kururu_o_s_1":"");
    }
    if(this.phase==="kururu-trigger-basic" && this.pendingKururuBasic){
      const out=[{actor:pid,kind:"機巧基本動作",label:"基本動作を行わない",rule:TURN_KURURU_TRIGGER_BASIC,skip:true}];
      for(const basicAction of this._effectBasicActions(pid)){
        out.push({actor:pid,kind:"機巧基本動作",label:BASIC_ACTION_NAMES[basicAction],rule:TURN_KURURU_TRIGGER_BASIC,basicAction});
      }
      return out;
    }
    if(this.phase==="start-reconstruct"){
      return [
        startDecisionAction(pid,TURN_RECONSTRUCT,"再構成"),
        startDecisionAction(pid,TURN_SKIP_RECONSTRUCT,"再構成しない")
      ];
    }
    if(this.phase==="reconstruction-install-choice" && this.pendingReconstruction){
      const out=[];
      for(const mode of ["normal","uro"]){
        if(!this.pendingReconstruction.remaining?.[mode]) continue;
        const candidates=this._installCandidates(pid,mode);
        if(!candidates.length) continue;
        out.push({actor:pid,kind:"設置",label:"設置しない",rule:TURN_RECONSTRUCT_INSTALL,installMode:mode,skip:true});
        for(const cardId of candidates){
          const slug=stateCardSlug(this.state,pid,cardId);
          out.push({
            actor:pid,
            kind:"設置",
            label:this.cardRuleRegistry?.get(slug)?.name||slug||String(cardId),
            rule:TURN_RECONSTRUCT_INSTALL,
            installMode:mode,
            cardId
          });
        }
      }
      return this._rairaUseActionVariants(pid,out,action=>
        action.skip?"":stateCardSlug(this.state,pid,action.cardId)
      );
    }
    if(this.phase==="shinra-plan-choice" && this.pendingShinraPlan){
      return ["神算","鬼謀"].map(choice=>({
        actor:pid,
        kind:"計略準備",
        label:choice,
        rule:TURN_SHINRA_PLAN_CHOICE,
        choice
      }));
    }
    if(this.phase==="attack-post-response-choice" && this.pendingAttackPostResponseChoice){
      return ["distance-to-dust","dust-to-distance"].map(choice=>({
        actor:pid,
        kind:"対応解決後",
        label:choice==="distance-to-dust"?"間合→ダスト":"ダスト→間合",
        rule:TURN_ATTACK_POST_RESPONSE_CHOICE,
        choice
      }));
    }
    if(this.phase==="yukihi-end-toggle-choice" && this.pendingYukihiEndToggle){
      return ["keep","toggle"].map(choice=>({actor:pid,kind:"傘の開閉",label:choice==="toggle"?"傘を開閉":"開閉しない",rule:TURN_YUKIHI_END_TOGGLE_CHOICE,choice}));
    }
    if(this.phase==="start-fatigue" || this.phase==="effect-fatigue"){
      const out=[startDecisionAction(pid,TURN_FATIGUE_LIFE,"焦燥：ライフ")];
      if(n(this.state[`p${pid}_aura`])>=1) out.unshift(startDecisionAction(pid,TURN_FATIGUE_AURA,"焦燥：オーラ"));
      return out;
    }
    if(this.phase==="start-card-choice" && this.pendingCardDecision){
      const d=this.pendingCardDecision;
      const nextSelfTurnNumber=Math.max(1,n(this.turnsTaken?.[pid])+2);
      const nextThallyaA1Cycle=nextSelfTurnNumber%3;
      const actions=arr(d.candidates).map(cardId=>{
        const id=String(cardId),slug=stateCardSlug(this.state,pid,id),entry=this.cardRuleRegistry?.get(slug)||{};
        let baselineDiscardScore=0;
        if(d.kind==="end-hand-limit-discard"){
          const lowValueAp=baselineResourceOnlyMainActionApCeiling(this.state,pid,entry.mainUse,this.options);
          if(Number.isFinite(lowValueAp) && lowValueAp<=1) baselineDiscardScore+=100;
          if(entry.response) baselineDiscardScore-=40;
          if(this._hasThallyaA1(pid)){
            if(nextThallyaA1Cycle===2){
              if(slug==="re_11_thallya_o_n_6") baselineDiscardScore-=80;
              else if(n(entry?.mainUse?.burn)>0) baselineDiscardScore-=40;
            }else if(nextThallyaA1Cycle===0){
              if(slug==="re_11_thallya_o_n_4") baselineDiscardScore-=80;
              else if(slug==="re_11_thallya_o_n_6") baselineDiscardScore-=30;
            }
          }
        }
        return {
          actor:pid,
          kind:"選択",
          label:`${d.label||"カード選択"}: ${cardId}`,
          rule:TURN_CARD_CHOICE,
          choiceKind:String(d.kind||""),
          sourceCardId:d.sourceCardId,
          choiceCardId:cardId,
          ...(d.kind==="end-hand-limit-discard"?{baselineDiscardScore}: {}),
          ...(d.kind==="yurina-mondo-basic"?(()=>{
            const preview=mondoDefenderRepeatPreview(this.state,pid,Number(d.defender),Number(cardId),this.options);
            return {
              baselineMondoDefenderCanRepeat:preview.canRepeat,
              baselineMondoDefenderAuraDelta:preview.auraDelta
            };
          })(): {})
        };
      });
      return this._rairaUseActionVariants(pid,actions,action=>{
        const choice=String(action.choiceCardId??"");
        if(d.kind==="thallya-dual-discard") return choice==="skip"?"":stateCardSlug(this.state,pid,choice);
        if(d.kind==="shinra-plan-use-opponent-discard-card"){
          if(choice==="done") return "";
          const owner=Number(d.shinraOwner),opponent=owner===1?2:1;
          return stateCardSlug(this.state,opponent,choice);
        }
        if(d.kind==="shinra-plan-use-own-used-special-enhancement-free") return stateCardSlug(this.state,pid,choice);
        if(d.kind==="korunu-porucharto-redeploy") return choice==="redeploy"?String(d.slug||""):"";
        return "";
      });
    }
    if(this.phase==="attack-response" && this.pendingAttack){
      const responses=this._registeredResponseActions(pid);
      return [
        {
          actor:pid,
          kind:"対応",
          label:"対応しない",
          rule:TURN_ATTACK_PASS
        },
        ...responses
      ];
    }
    if(this.phase==="attack-damage-choice" && this.pendingAttack){
      return attackDamageOptions(this.state,this.pendingAttack).map(option=>({
        actor:pid,
        kind:"ダメージ選択",
        label:option.choice==="aura"?"オーラ受け":"ライフ受け",
        rule:TURN_ATTACK_DAMAGE,
        damageChoice:option.choice,
        silentWallUse:Math.max(0,n(option.silentWallUse))
      }));
    }
    if(this.phase==="response-card-choice" && this.pendingResponseCard){
      const pending=this.pendingResponseCard;
      const actions=arr(pending.choices).map(choice=>({
        actor:pid,
        kind:"選択",
        label:choice==="distance-to-dust"?"間合→ダスト":
          (choice==="dust-to-distance"?"ダスト→間合":
          (choice==="aura-to-distance"?"オーラ→間合":
          (choice==="distance-to-aura"?"間合→オーラ":
          (choice==="flare-to-aura"?"フレア→オーラ":
          (choice==="aura-to-flare"?"オーラ→フレア":
          (String(choice).startsWith("enhance:")?`付与: ${choice}`:String(choice))))))),
        rule:TURN_RESPONSE_EFFECT_CHOICE,
        choice
      }));
      return this._rairaUseActionVariants(pid,actions,action=>
        pending.kind==="use-facedown" && String(action.choice)!=="done"
          ? stateCardSlug(this.state,pid,action.choice)
          : ""
      );
    }
    if(this.phase==="main-enhancement-choice" && this.pendingMainCard){
      return arr(this.pendingMainCard.choices).map(choice=>({
        actor:pid,
        kind:"選択",
        label:`付与: ${choice}`,
        rule:TURN_MAIN_ENHANCEMENT_CHOICE,
        choice
      }));
    }
    if(this.phase==="main-enhancement-effect-choice" && this.pendingMainCard){
      return arr(this.pendingMainCard.choices).map(choice=>({
        actor:pid,
        kind:"選択",
        label:String(choice),
        rule:TURN_MAIN_ENHANCEMENT_EFFECT_CHOICE,
        choice
      }));
    }
    if(this.phase==="main-effect-choice" && this.pendingMainCard){
      const pending=this.pendingMainCard,choiceState=pending.pendingChoice||{};
      const actions=arr(pending.choices).map(choice=>({
        actor:pid,
        kind:"選択",
        label:choice==="distance-to-dust"?"間合→ダスト":
          (choice==="dust-to-distance"?"ダスト→間合":
          (choice==="aura-to-distance"?"オーラ→間合":
          (choice==="distance-to-aura"?"間合→オーラ":
          (choice==="flare-to-aura"?"フレア→オーラ":
          (choice==="aura-to-flare"?"オーラ→フレア":String(choice)))))),
        rule:TURN_MAIN_EFFECT_CHOICE,
        choice
      }));
      return this._rairaUseActionVariants(pid,actions,action=>{
        const choice=String(action.choice??""),kind=String(choiceState.kind||"");
        if(kind==="kururu-accelerator-card" && choice!=="done"){
          return stateCardSlug(this.state,pid,choice.replace(/^card:/,""));
        }
        if(kind==="kururu-regainer-mod") return String(choiceState.slug||"");
        if(kind==="kururu-kansu-use-special" && choice!=="skip"){
          const opponent=pid===1?2:1;
          return stateCardSlug(this.state,opponent,choice.replace(/^card:/,""));
        }
        if(kind==="shinra-quote-use" && choice==="use"){
          return stateCardSlug(this.state,Number(choiceState.opponent),String(choiceState.cardId));
        }
        if(kind==="hagane-respect" && choice.startsWith("card:")){
          return stateCardSlug(this.state,pid,choice.slice(5));
        }
        if((kind==="use-install-facedown"||kind==="use-facedown-non-fullpower") && choice!=="done"){
          return stateCardSlug(this.state,pid,choice);
        }
        return "";
      });
    }
    if(this.phase==="main-effect-basic" && this.pendingMainCard){
      const actions=this._effectBasicActions(pid);
      const thallya=this.pendingMainCard.allowThallyaExtraBasic
        ? this._thallyaExtraBasicKinds(pid)
        : [];
      return [
        ...actions.map(basicAction=>({
          actor:pid,
          kind:"効果による基本動作",
          label:BASIC_ACTION_NAMES[basicAction],
          rule:TURN_MAIN_EFFECT_BASIC,
          basicAction
        })),
        ...thallya.map(row=>({
          actor:pid,
          kind:"効果による追加基本動作",
          label:row.label,
          rule:TURN_MAIN_EFFECT_BASIC,
          thallyaBasic:row.kind
        })),
        {
          actor:pid,
          kind:"効果による基本動作",
          label:"ここで終了",
          rule:TURN_MAIN_EFFECT_BASIC,
          finish:true
        }
      ];
    }
    return [];
  }
  _setLossIfNeeded(playerId,reason){
    const pid=Number(playerId);
    if(n(this.state[`p${pid}_life`])>0) return false;
    this.done=true;
    this.doneReason=reason;
    this.winner=pid===1?2:1;
    return true;
  }

  _hasShinra(playerId){
    const pid=Number(playerId),charas=this.state?.[`p${pid}_chara_ids`];
    if(Array.isArray(charas)) return charas.map(Number).includes(7);
    const status=this.state?.[`p${pid}_card_status`]||{};
    return Object.values(status).some(row=>normalizeCardSlug(row?.Slug||row?.slug||"").includes("_shinra_"));
  }
  _hasKururu(playerId){ return stateHasKururu(this.state,playerId); }
  _kururuGearCounts(playerId){ return kururuGearCounts(this.state,Number(playerId),this.cardRuleRegistry); }
  _kururuGearReady(playerId,gear){ return kururuGearReady(this.state,Number(playerId),this.cardRuleRegistry,gear||{}); }
  _kururuDirectLife(playerId,targetPlayer,count,events,source=""){
    const pid=Number(playerId),target=Number(targetPlayer),damage=this._applyLifeDamageWithTriggers(target,count,events,source||"クルル");
    events.push({kind:"機巧ダメージ",playerId:pid,targetPlayer:target,zone:"life",damage,source:String(source||"")});
    this._setLossIfNeeded(target,"life-zero-kururu-effect");
    return damage;
  }
  _kururuDrain(playerId,events,source="どれーんでびる"){
    const pid=Number(playerId),opponent=pid===1?2:1;
    const room=Math.max(0,n(this.options.auraLimit??5)-n(this.state?.[`p${pid}_aura`])-n(this.state?.[`p${pid}_freeze`]));
    const moved=Math.min(1,room,n(this.state?.[`p${opponent}_aura`]));
    if(moved>0){
      this.state[`p${opponent}_aura`]=n(this.state[`p${opponent}_aura`])-moved;
      this.state[`p${pid}_aura`]=n(this.state[`p${pid}_aura`])+moved;
    }
    events.push({kind:"オーラ奪取",playerId:pid,targetPlayer:opponent,moved,source:String(source||"")});
    return moved;
  }
  _kururuTornado(playerId,events){
    const pid=Number(playerId),opponent=pid===1?2:1,counts=this._kururuGearCounts(pid);
    if(counts.attack>=2){
      const damage=applyAuraDamage(this.state,opponent,5);
      if(damage>0) this.auraDamageTakenThisTurn[opponent]=true;
      events.push({kind:"機巧ダメージ",playerId:pid,targetPlayer:opponent,zone:"aura",requested:5,damage,source:"とるねーど"});
    }
    if(counts.action>=2){
      const damage=Math.min(1,n(this.state?.[`p${opponent}_flare`]));
      this.state[`p${opponent}_flare`]=n(this.state[`p${opponent}_flare`])-damage;
      this.state.dust=n(this.state.dust)+damage;
      events.push({kind:"機巧ダメージ",playerId:pid,targetPlayer:opponent,zone:"flare",requested:1,damage,source:"とるねーど"});
    }
    if(counts.enhancement>=2){
      this._kururuDirectLife(pid,opponent,1,events,"とるねーど");
    }
  }
  _kururuBigGolemCard(playerId){
    const pid=Number(playerId),status=this.state?.[`p${pid}_special_status`]||{};
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      if(stateCardSlug(this.state,pid,cardId)==="re_10_kururu_o_s_2" && Number(status[String(cardId)]||0)===2) return String(cardId);
    }
    return null;
  }
  _kururuDrainDevilCard(playerId){
    const pid=Number(playerId),status=this.state?.[`p${pid}_special_status`]||{};
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      if(stateCardSlug(this.state,pid,cardId)==="re_10_kururu_o_s_1" && Number(status[String(cardId)]||0)===2) return String(cardId);
    }
    return null;
  }
  _resumeAfterKururuDrain(resume,events){
    const ctx=clone(resume||{});
    if(ctx.kind==="restore-phase"){ this.phase=String(ctx.phase||"main"); return; }
    if(ctx.kind==="thallya-ride"){ this._resumeAfterThallyaRide(ctx.rideResume,events); return; }
    if(ctx.kind==="reconstruction-complete"){
      if(ctx.resumeKind==="start-phase"){
        this.pendingDraws=Math.max(0,n(ctx.draws));
        this._advanceDraws(events);
        return;
      }
      if(ctx.resumeKind==="attack-after"){ this._resolveAttackAfterEffects(events); return; }
      if(ctx.resumeKind==="kururu-big-golem-end"){ this._continueEndTurnAfterKururu(events); return; }
      throw new Error("unsupported reconstruction after Drain Devil");
    }
    if(ctx.kind==="end-phase-after-recharge"){
      const pid=Number(ctx.playerId);
      if(!this._resolveEndPhaseEnhancementEffects(pid,events)) return;
      this._beginYukihiEndToggleChoice(pid,events);
      return;
    }
    throw new Error("unsupported Drain Devil resume");
  }
  _beginKururuDrainReuse(entries,resume,events){
    const rows=arr(entries).filter(x=>Math.max(0,n(x?.count))>0).map(x=>({playerId:Number(x.playerId),count:Math.max(0,n(x.count))}));
    if(!rows.length) return false;
    this.pendingKururuDrainReuse={entries:rows,resume:clone(resume||{kind:"restore-phase",phase:this.phase})};
    this.phase="kururu-drain-reuse";
    events.push({kind:"再使用選択待ち",source:"どれーんでびる",entries:clone(rows)});
    return true;
  }

  _resolveKururuDrainDevilFromStateTransition(before,events){
    if(this.pendingKururuDrainReuse) return false;
    const additions=[];
    for(const pid of [1,2]){
      if(this.terminalLocked?.[pid] || !this._kururuDrainDevilCard(pid)) continue;
      const beforeStatus=before?.[`p${pid}_special_status`]||{},afterStatus=this.state?.[`p${pid}_special_status`]||{};
      let count=0;
      for(const cardId of arr(this.state?.[`p${pid}_special`])){
        if(stateCardSlug(this.state,pid,cardId)==="re_10_kururu_o_s_1") continue;
        if(Number(beforeStatus[String(cardId)]||0)===2 && Number(afterStatus[String(cardId)]||0)!==2) count++;
      }
      if(count>0) additions.push({playerId:pid,count});
    }
    if(!additions.length) return false;
    return this._beginKururuDrainReuse(additions,{kind:"restore-phase",phase:String(this.phase||"main")},events);
  }
  _continueKururuDrainReuse(events){
    const pending=this.pendingKururuDrainReuse;
    if(!pending) return;
    while(pending.entries.length && n(pending.entries[0].count)<=0) pending.entries.shift();
    if(!pending.entries.length){
      const resume=clone(pending.resume||{kind:"restore-phase",phase:"main"});
      this.pendingKururuDrainReuse=null;
      this._resumeAfterKururuDrain(resume,events);
      return;
    }
    this.phase="kururu-drain-reuse";
    events.push({kind:"再使用選択待ち",playerId:pending.entries[0].playerId,source:"どれーんでびる",remaining:n(pending.entries[0].count)});
  }

  _kururuUsedBigGolem(playerId){
    return this._kururuBigGolemCard(playerId)!=null;
  }
  _kururuActiveModule(playerId){
    return this._activeEnhancementBySlug(Number(playerId),"re_10_kururu_o_n_6");
  }
  _kururuActiveReflector(playerId){
    return this._activeEnhancementBySlug(Number(playerId),"re_10_kururu_o_n_7");
  }
  _kururuIndustriaCard(playerId){
    const pid=Number(playerId),status=this.state?.[`p${pid}_special_status`]||{};
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      if(stateCardSlug(this.state,pid,cardId)==="re_10_kururu_o_s_3") return {cardId,status:Number(status[String(cardId)]||0)};
    }
    return null;
  }
  _kururuIndustriaSealed(playerId,hostCardId){
    const pid=Number(playerId),status=this.state?.[`p${pid}_card_status`]?.[String(hostCardId)]||{};
    return arr(status.SealedCards);
  }
  _kururuIndustriaSealCandidates(playerId){
    const pid=Number(playerId),out=[];
    for(const zone of ["hand","discard"]){
      for(const cardId of arr(this.state?.[`p${pid}_${zone}`])){
        const slug=stateCardSlug(this.state,pid,cardId),entry=this.cardRuleRegistry?.get(slug)||{};
        const kind=entry.mainUse?.kind;
        const status=this.state?.[`p${pid}_card_status`]?.[String(cardId)]||{};
        if(kind==="enhancement-card"||Number(status.MainType)===3) continue;
        out.push({zone,cardId:String(cardId)});
      }
    }
    return out;
  }
  _kururuSealIndustria(playerId,hostCardId,zone,cardId,events){
    const pid=Number(playerId),host=String(hostCardId),id=String(cardId),key=`p${pid}_${zone}`;
    this.state[key]=arr(this.state[key]);
    const index=this.state[key].findIndex(x=>String(x)===id);
    if(index<0) throw new Error("Industria seal target left zone");
    this.state[key].splice(index,1);
    const hostStatus=this.state?.[`p${pid}_card_status`]?.[host];
    if(!hostStatus) throw new Error("Industria host status missing");
    hostStatus.SealedCards=[{ownerId:pid,cardId:id,permanent:true,sourceZone:String(zone)}];
    const sourceStatus=clone(this.state?.[`p${pid}_card_status`]?.[id]||{}),sourceSlug=normalizeCardSlug(sourceStatus.Slug||"");
    for(const row of Object.values(this.state?.[`p${pid}_card_status`]||{})){
      if(!row?.KururuDuplicate || String(row?.DuplicateHost||"")!==host) continue;
      const keep={KururuDuplicate:true,DuplicateHost:host,OriginalCardId:id,IsSpecial:false,PoisonBagOwner:null};
      Object.assign(row,sourceStatus,keep,{Slug:sourceSlug});
    }
    events.push({kind:"封印",playerId:pid,hostCardId:host,ownerId:pid,cardId:id,permanent:true,sourceZone:String(zone)});
  }
  _kururuAddDuplicate(playerId,hostCardId,events){
    const pid=Number(playerId),host=String(hostCardId),statusMap=this.state?.[`p${pid}_card_status`]||{};
    const existing=Object.entries(statusMap).filter(([,row])=>row?.KururuDuplicate&&String(row?.DuplicateHost||"")===host);
    if(existing.length>=3){
      events.push({kind:"追加札",playerId:pid,source:"いんだすとりあ",result:"上限"});
      return null;
    }
    const sealed=this._kururuIndustriaSealed(pid,host)[0]||null;
    const originalId=sealed?String(sealed.cardId):"";
    const originalStatus=originalId?clone(statusMap[originalId]||{}):{};
    let serial=1;
    let cardId=`kururu-duplicate-${pid}-${serial}`;
    while(Object.prototype.hasOwnProperty.call(statusMap,cardId)){
      serial++;
      cardId=`kururu-duplicate-${pid}-${serial}`;
    }
    statusMap[cardId]={
      ...originalStatus,
      Slug:originalId?normalizeCardSlug(originalStatus.Slug||""):"re_10_kururu_o_ex_1",
      IsSpecial:false,
      KururuDuplicate:true,
      DuplicateHost:host,
      OriginalCardId:originalId,
      PoisonBagOwner:null
    };
    const deckKey=`p${pid}_deck`;this.state[deckKey]=arr(this.state[deckKey]);this.state[deckKey].push(cardId);
    events.push({kind:"追加札",playerId:pid,cardId,source:"いんだすとりあ",destination:"deck-bottom",copyOf:originalId||null});
    return cardId;
  }
  _kururuIndustriaRechargeAfterReconstruction(playerId,events){
    const pid=Number(playerId),row=this._kururuIndustriaCard(pid);
    if(!row||row.status!==2) return false;
    const status=this.state?.[`p${pid}_special_status`]||{};
    status[String(row.cardId)]=0;
    events.push({kind:"即再起",playerId:pid,cardId:row.cardId,slug:"re_10_kururu_o_s_3",condition:"reconstruction"});
    return true;
  }
  _kururuRegainerCandidates(playerId){
    const pid=Number(playerId),out=[];
    const add=(zone,cardId)=>{
      const id=String(cardId),slug=stateCardSlug(this.state,pid,id),entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
      if(!rule||rule.fullPower||attackSourceMegamiFromSlug(slug)==="kururu") return;
      out.push({zone,id,slug});
    };
    for(const zone of ["discard","facedown"]) for(const cardId of arr(this.state?.[`p${pid}_${zone}`])) add(zone,cardId);
    const specialStatus=this.state?.[`p${pid}_special_status`]||{};
    for(const cardId of arr(this.state?.[`p${pid}_special`])) if(Number(specialStatus[String(cardId)]||0)===2) add("special",cardId);
    return out;
  }
  _kururuRegainerModChoices(playerId,cardId){
    const pid=Number(playerId),slug=stateCardSlug(this.state,pid,cardId),rule=this.cardRuleRegistry?.get(slug)?.mainUse||{},out=["none"];
    if(rule.kind==="attack-card"){
      if(arr(rule.attack?.range).length){out.push("range:-1","range:+1");}
      if(rule.attack?.auraDamage!=null) out.push("aura:-1","aura:+1");
      if(rule.attack?.lifeDamage!=null) out.push("life:-1","life:+1");
    }else if(rule.kind==="enhancement-card"){
      out.push("charge:-1","charge:+1");
    }
    return out;
  }
  _kururuModifiedRule(rule,mod){
    const out=clone(rule||{}),m=String(mod||"none");
    if(m==="none") return out;
    const [kind,raw]=m.split(":"),delta=Number(raw)||0;
    if(kind==="range"&&out.attack){
      out.attack.range=[...new Set(arr(out.attack.range).map(x=>Math.max(0,n(x)+delta)))].sort((a,b)=>a-b);
    }else if(kind==="aura"&&out.attack&&out.attack.auraDamage!=null){
      out.attack.auraDamage=Math.max(0,n(out.attack.auraDamage)+delta);
    }else if(kind==="life"&&out.attack&&out.attack.lifeDamage!=null){
      out.attack.lifeDamage=Math.max(0,n(out.attack.lifeDamage)+delta);
    }else if(kind==="charge"&&out.kind==="enhancement-card"){
      out.charge=Math.max(0,n(out.charge)+delta);
    }
    return out;
  }
  _kururuKansuUsedOpponentSpecials(playerId){
    const pid=Number(playerId),opp=pid===1?2:1,status=this.state?.[`p${opp}_special_status`]||{};
    return arr(this.state?.[`p${opp}_special`]).filter(cardId=>
      Number(status[String(cardId)]||0)===2 && !!this.cardRuleRegistry?.get(stateCardSlug(this.state,opp,cardId))?.mainUse
    ).map(String);
  }

  _kururuOwnRuleLegal(playerId,cardId,zone,rule,{ignoreCost=false}={}){
    const pid=Number(playerId),id=String(cardId),sourceZone=String(zone||"");
    if(!arr(this.state?.[`p${pid}_${sourceZone}`]).some(x=>String(x)===id) || !rule) return false;
    const condition=rule.useCondition;
    if(condition?.kind==="self-life-at-most" && n(this.state?.[`p${pid}_life`])>n(condition.value)) return false;
    if(condition?.kind==="centrifugal" && !this._centrifugalLegal(pid)) return false;
    if(condition?.kind==="no-basic-actions-this-turn" && n(this.basicActionsThisTurn?.[pid])>0) return false;
    if(condition && !["self-life-at-most","centrifugal","no-basic-actions-this-turn"].includes(String(condition.kind||""))) return false;
    if(!ignoreCost && !canPayResponseCardCost(this.state,pid,rule,id)) return false;
    if(n(rule.burn)>0 && !this._thallyaCanBurn(pid,rule.burn)) return false;
    if(rule.kind==="attack-card"){
      if(this._chikageRelaxationActive(pid)) return false;
      const attack=normalizeAttackSpec(this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),sourceCardId:id,sourceSlug:stateCardSlug(this.state,pid,id),
        classification:sourceZone==="special"?"special":"normal",attacker:pid,defender:pid===1?2:1
      },pid));
      this._applyQueuedRangeModifierPreview(attack,pid);
      this._yukihiDororiuraRangePreview(attack,pid);
      return attackInRange(this.state,attack);
    }
    return rule.kind==="action-card"||rule.kind==="enhancement-card";
  }
  _resumeKururuOwnCard(context,events){
    const ctx=clone(context||{});
    if(ctx.restoreMainParent){
      this.pendingMainCard=this.pendingMainCardStack.pop()||null;
      if(!this.pendingMainCard) throw new Error("Kururu child parent missing");
    }
    const pending=this.pendingMainCard;
    if(!pending) throw new Error("Kururu child resume has no parent");
    this._continueMainActionCard(pending,events);
  }
  _finishKururuOwnChild(cardUse,slug,context,events){
    const moved=finishResponseCardUse(this.state,cardUse);
    events.push({kind:"機巧カード使用終了",playerId:cardUse?.playerId,cardId:cardUse?.cardId,slug,...moved});
    this._markResponseCardResolvedTraits(cardUse,slug,events);
    const rule=this.cardRuleRegistry?.get(slug)?.mainUse||{};
    this._beginKururuPostCardBasics(Number(cardUse?.playerId),rule,{kind:"kururu-own-resume",context:clone(context)},events);
  }
  _beginKururuOwnCardUse(playerId,cardId,zone,events,resumeContext,{ignoreCost=false,modifiedRule=null}={}){
    const pid=Number(playerId),id=String(cardId),sourceZone=String(zone||"");
    const slug=stateCardSlug(this.state,pid,id),entry=this.cardRuleRegistry?.get(slug)||{},rule=clone(modifiedRule||entry.mainUse);
    if(!this._kururuOwnRuleLegal(pid,id,sourceZone,rule,{ignoreCost})) throw new Error("illegal Kururu child card use");
    const ctx={...clone(resumeContext||{}),externalSource:"kururu-own"};
    if(this.pendingMainCard){
      this.pendingMainCardStack.push(this.pendingMainCard);
      this.pendingMainCard=null;
      ctx.restoreMainParent=true;
    }
    if(!ignoreCost){
      const paid=payResponseCardCost(this.state,pid,rule,id);
      if(paid.amount>0) events.push({kind:"消費",playerId:pid,cardId:id,slug,cost:clone(paid)});
    }
    if(n(rule.burn)>0) this._thallyaBurn(pid,rule.burn,events,slug);
    const cardUse=moveCardToUsingFromZone(this.state,pid,id,sourceZone);
    this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
    this._markCardUseTraits(pid,slug,events);
    events.push({kind:"機巧カード使用",playerId:pid,cardId:id,slug,sourceZone,ignoreCost:!!ignoreCost});
    if(rule.kind==="attack-card"){
      const attackSpec=this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),sourceCardId:id,sourceSlug:slug,
        classification:sourceZone==="special"?"special":"normal",attacker:pid,defender:pid===1?2:1
      },pid);
      const started=this._beginGeneratedAttack(attackSpec,events,{kind:"kururu-own-child",cardUse,slug,context:ctx});
      if(!started.pending&&!this.done) this._finishKururuOwnChild(cardUse,slug,ctx,events);
      return;
    }
    if(rule.kind==="action-card"){
      this._beginMainActionCard(rule,cardUse,slug,events,ctx);
      return;
    }
    if(rule.kind==="enhancement-card"){
      this._beginMainEnhancement(rule,cardUse,slug,events,ctx);
      return;
    }
    throw new Error("unsupported Kururu child kind");
  }
  _kururuKansuUnusedOpponentSpecials(playerId){
    const pid=Number(playerId),opp=pid===1?2:1,status=this.state?.[`p${opp}_special_status`]||{};
    return arr(this.state?.[`p${opp}_special`]).filter(cardId=>
      Number(status[String(cardId)]||0)!==2 && !!this.cardRuleRegistry?.get(stateCardSlug(this.state,opp,cardId))?.mainUse
    ).map(String);
  }
  _kururuBorrowedSpecialLegal(playerId,ownerId,cardId){
    const user=Number(playerId),owner=Number(ownerId),id=String(cardId);
    if(Number(this.state?.[`p${owner}_special_status`]?.[id]||0)!==2) return false;
    return this._borrowedCardRuleLegal(user,owner,id,"special",{ignoreCost:true});
  }

  _kururuPostCardBasicSources(playerId,rule){
    const pid=Number(playerId),sources=[];
    if(this.terminalLocked?.[pid]) return sources;
    if(rule?.kind==="action-card" && this._kururuActiveModule(pid)) sources.push("もじゅるー");
    if(rule?.fullPower && this._kururuUsedBigGolem(pid)) sources.push("びっぐごーれむ");
    return sources;
  }
  _resumeAfterKururuBasic(resume,events){
    const ctx=clone(resume||{});
    if(ctx.kind==="finish-main-action"){ this._finishMainAction(events); return; }
    if(ctx.kind==="finished-main-action-card"){
      const rc=clone(ctx.resumeContext||null);
      if(rc){
        if(rc.externalSource==="borrowed") this._resumeBorrowedCard(rc,events);
        else if(rc.externalSource==="kururu-own") this._resumeKururuOwnCard(rc,events);
        else this._resumeExternalCardUse(rc,events);
      }else if(ctx.endPhaseAfterResolution) this._endTurn(events);
      else this._finishMainAction(events);
      return;
    }
    if(ctx.kind==="finished-main-enhancement"){
      const rc=clone(ctx.resumeContext||null);
      if(rc){
        if(rc.externalSource==="borrowed") this._resumeBorrowedCard(rc,events);
        else if(rc.externalSource==="kururu-own") this._resumeKururuOwnCard(rc,events);
        else if(rc.kind==="shinra-plan-own-special") this._resumeOwnSpecialPlanUse(rc,events);
        else this._resumeExternalCardUse(rc,events);
      }else this._finishMainAction(events);
      return;
    }
    if(ctx.kind==="finished-response-action"){
      if(this._applyAttackPostResponseEffects(this.pendingAttack,events,ctx.slug||"","advance-parent")) return;
      this._advanceAttackAfterResponse(events);
      return;
    }
    if(ctx.kind==="kururu-own-resume"){ this._resumeKururuOwnCard(ctx.context,events); return; }
    if(ctx.kind==="borrowed-resume"){ this._resumeBorrowedCard(ctx.context,events); return; }
    if(ctx.kind==="restore-phase"){ this.phase=String(ctx.phase||"main"); return; }
    if(ctx.kind==="kururu-drain-reuse"){ this._continueKururuDrainReuse(events); return; }
    if(ctx.kind==="megumi-wild-deploy"){
      const pending=this.pendingMainCard;
      if(!pending||String(pending.cardId)!==String(ctx.cardId)) throw new Error("Wild Thorn deploy resume mismatch");
      this._completeMainEnhancementPlacement(pending,events);
      return;
    }
    if(ctx.kind==="megumi-wild-end"){
      this._beginYukihiEndToggleChoice(Number(ctx.playerId),events);
      return;
    }
    throw new Error("unsupported Kururu basic resume");
  }
  _advanceKururuBasic(events){
    const pending=this.pendingKururuBasic;
    if(!pending) throw new Error("missing Kururu basic trigger");
    if(!arr(pending.sources).length){
      const resume=clone(pending.resume||null);
      this.pendingKururuBasic=null;
      this._resumeAfterKururuBasic(resume,events);
      return;
    }
    this.phase="kururu-trigger-basic";
    events.push({kind:"基本動作選択待ち",playerId:pending.playerId,source:String(pending.sources[0])});
  }
  _beginKururuPostCardBasics(playerId,rule,resume,events){
    const pid=Number(playerId),sources=this._kururuPostCardBasicSources(pid,rule);
    if(!sources.length){ this._resumeAfterKururuBasic(resume,events); return false; }
    this.pendingKururuBasic={playerId:pid,sources:clone(sources),resume:clone(resume||null)};
    this._advanceKururuBasic(events);
    return true;
  }

  _continueKururuNResponse(events){
    const pending=this.pendingResponseCard;
    if(!pending || !String(pending.kind||"").startsWith("kururu-n")) throw new Error("missing Kururu-n response");
    const selected=arr(pending.kururuChosen).map(String);
    if(selected.length>=2){
      pending.kind="kururu-n-effect";
      pending.choices=[];
      this._finishActionResponseCard(events);
      return;
    }
    const effects=["draw","deck-bottom","opponent-discard"].filter(x=>!selected.includes(x));
    pending.kind="kururu-n-effect";
    pending.choices=["done",...effects];
    this.phase="response-card-choice";
    events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"くるるーん",choices:clone(pending.choices),selected:clone(selected)});
  }
  _applyKururuNEffect(choice,events){
    const pending=this.pendingResponseCard;
    if(!pending) throw new Error("missing Kururu-n response");
    const value=String(choice||"");
    if(value==="done"){
      this._finishActionResponseCard(events);
      return;
    }
    pending.kururuChosen=arr(pending.kururuChosen).map(String);
    if(pending.kururuChosen.includes(value)) throw new Error("Kururu-n effect already chosen");
    if(!["draw","deck-bottom","opponent-discard"].includes(value)) throw new Error("unknown Kururu-n effect");
    pending.kururuChosen.push(value);
    const pid=Number(pending.playerId);
    if(value==="draw"){
      const cardId=drawTopCard(this.state,pid);
      if(cardId==null){
        this.pendingEffectFatigue={playerId:pid,reason:"kururu-n-draw",resumeKind:"kururu-n-response"};
        this.phase="effect-fatigue";
        events.push({kind:"焦燥待ち",playerId:pid,reason:"くるるーんのドロー"});
        return;
      }
      events.push({kind:"ドロー",playerId:pid,cardId,reason:"くるるーん"});
      this._continueKururuNResponse(events);
      return;
    }
    if(value==="deck-bottom"){
      const candidates=arr(this.state?.[`p${pid}_facedown`]).map(String);
      if(!candidates.length){
        events.push({kind:"山札の底へ",playerId:pid,source:"くるるーん",moved:0});
        this._continueKururuNResponse(events);
        return;
      }
      pending.kind="kururu-n-facedown";
      pending.choices=clone(candidates);
      this.phase="response-card-choice";
      events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"くるるーん・伏せ札",choices:clone(candidates)});
      return;
    }
    const opponent=pid===1?2:1;
    const candidates=arr(this.state?.[`p${opponent}_hand`]).map(String);
    if(!candidates.length){
      events.push({kind:"手札破棄",playerId:opponent,source:"くるるーん",moved:0});
      this._continueKururuNResponse(events);
      return;
    }
    this.pendingCardDecision={
      kind:"kururu-n-opponent-discard",
      playerId:opponent,
      label:"くるるーん",
      sourceCardId:pending.cardId,
      slug:pending.slug,
      candidates:clone(candidates),
      responderId:pid
    };
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:opponent,cardId:pending.cardId,choice:"くるるーん・手札破棄",candidates:clone(candidates)});
  }

  _hasThallya(playerId){ return stateHasThallya(this.state,playerId); }
  _thallyaMasterpieceActive(playerId){
    const pid=Number(playerId);
    return arr(this.state?.[`p${pid}_enhancement`]).some(cardId=>{
      if(this._isEnhancementDiscardResolving(cardId)) return false;
      const entry=this.cardRuleRegistry?.get(stateCardSlug(this.state,pid,cardId))||{};
      if(!entry.thallyaMasterpiece) return false;
      const status=this.state?.[`p${pid}_card_status`]?.[String(cardId)]||{},charges=positiveTokenChargeMap(status)||{};
      const total=Object.keys(charges).length?Object.values(charges).reduce((sum,x)=>sum+n(x),0):Math.max(0,n(status.Charge));
      return total>0;
    });
  }
  _thallyaCanBurn(playerId,count=1){
    const pid=Number(playerId),amount=Math.max(0,Math.floor(n(count)));
    if(amount<=0) return true;
    if(!this._hasThallya(pid)) return false;
    return this._thallyaMasterpieceActive(pid)
      ? n(this.state?.[`p${pid}_thallya_burned`])>=amount
      : n(this.state?.[`p${pid}_thallya_machine`])>=amount;
  }
  _thallyaBurn(playerId,count,events=[],source=""){
    const pid=Number(playerId),amount=Math.max(0,Math.floor(n(count)));
    if(amount<=0) return 0;
    if(!this._thallyaCanBurn(pid,amount)) throw new Error("insufficient Thallya fuel");
    if(this._thallyaMasterpieceActive(pid)){
      this.state[`p${pid}_thallya_burned`]=n(this.state[`p${pid}_thallya_burned`])-amount;
      this.state[`p${pid}_thallya_machine`]=n(this.state[`p${pid}_thallya_machine`])+amount;
      events.push({kind:"燃焼反転",playerId:pid,count:amount,source:String(source||"")});
    }else{
      this.state[`p${pid}_thallya_machine`]=n(this.state[`p${pid}_thallya_machine`])-amount;
      this.state[`p${pid}_thallya_burned`]=n(this.state[`p${pid}_thallya_burned`])+amount;
      events.push({kind:"燃焼",playerId:pid,count:amount,source:String(source||"")});
    }
    return amount;
  }
  _thallyaRecover(playerId,count,events=[],source=""){
    const pid=Number(playerId),amount=Math.max(0,Math.floor(n(count))),moved=Math.min(amount,n(this.state?.[`p${pid}_thallya_burned`]));
    this.state[`p${pid}_thallya_burned`]=n(this.state[`p${pid}_thallya_burned`])-moved;
    this.state[`p${pid}_thallya_machine`]=n(this.state[`p${pid}_thallya_machine`])+moved;
    events.push({kind:"造花結晶回復",playerId:pid,requested:amount,moved,source:String(source||"")});
    return moved;
  }
  _thallyaRideChoices(playerId,{optional=false}={}){
    const pid=Number(playerId),out=optional?["skip"]:[];
    if(!this._hasThallya(pid)||n(this.state?.[`p${pid}_thallya_machine`])<=0) return out;
    if(n(this.state.distance)>0) out.push("forward");
    if(n(this.state.distance)<n(this.options.distanceLimit??10)) out.push("backward");
    return out;
  }
  _tryRechargeThallyaAlpha(playerId,events){
    const pid=Number(playerId),status=this.state?.[`p${pid}_special_status`]||{};
    let recharged=0;
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      if(Number(status[String(cardId)]||0)!==2||stateCardSlug(this.state,pid,cardId)!=="re_11_thallya_o_s_1") continue;
      status[String(cardId)]=0;
      recharged++;
      events.push({kind:"即再起",playerId:pid,cardId,slug:"re_11_thallya_o_s_1",condition:"ride-distance-change"});
    }
    return recharged;
  }
  _thallyaRide(playerId,direction,events=[],source=""){
    const pid=Number(playerId),dir=String(direction||"");
    if(!this._thallyaRideChoices(pid).includes(dir)) throw new Error("illegal Thallya ride");
    const delta=dir==="forward"?-1:1;
    this.state[`p${pid}_thallya_machine`]=n(this.state[`p${pid}_thallya_machine`])-1;
    this.state[`p${pid}_thallya_ride_tokens`]=arr(this.state[`p${pid}_thallya_ride_tokens`]);
    this.state[`p${pid}_thallya_ride_tokens`].push(delta);
    this.state.distance=n(this.state.distance)+delta;
    events.push({kind:"騎動",playerId:pid,direction:dir,delta,distance:n(this.state.distance),source:String(source||"")});
    return this._tryRechargeThallyaAlpha(pid,events);
  }
  _resumeAfterThallyaRide(resume,events){
    const ctx=clone(resume||{});
    if(ctx.kind==="attack-after"){ this._resolveAttackAfterEffects(events); return; }
    if(ctx.kind==="response-action"){ this._finishActionResponseCard(events); return; }
    if(ctx.kind==="main-action"){
      const pending=this.pendingMainCard;
      if(!pending||String(pending.cardId)!==String(ctx.cardId)) throw new Error("Thallya main ride resume mismatch");
      this._continueMainActionCard(pending,events); return;
    }
    if(ctx.kind==="dual-after-ride"){ this._beginThallyaDualDiscardChoice(Number(ctx.playerId),events); return; }
    if(!ctx.kind) return;
    throw new Error("unsupported Thallya ride resume");
  }
  _requestThallyaRide(playerId,events,resume,{optional=false,source=""}={}){
    const pid=Number(playerId),choices=this._thallyaRideChoices(pid,{optional}),moves=choices.filter(x=>x!=="skip");
    if(!choices.length||(!optional&&!moves.length)){ this._resumeAfterThallyaRide(resume,events); return false; }
    if(!optional&&moves.length===1){
      const recharged=this._thallyaRide(pid,moves[0],events,source);
      if(recharged>0 && this._kururuDrainDevilCard(pid) && !this.terminalLocked?.[pid]){
        this._beginKururuDrainReuse([{playerId:pid,count:recharged}],{kind:"thallya-ride",rideResume:clone(resume||null)},events);
        return true;
      }
      this._resumeAfterThallyaRide(resume,events);
      return false;
    }
    this.pendingCardDecision={
      kind:"thallya-ride",playerId:pid,label:String(source||"騎動"),sourceCardId:resume?.sourceCardId||"",slug:String(source||""),
      candidates:clone(choices),thallyaResume:clone(resume||null),thallyaSource:String(source||"")
    };
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:pid,choice:"騎動",candidates:clone(choices),source:String(source||"")});
    return true;
  }
  _thallyaStartCleanup(playerId,events){
    const pid=Number(playerId),tokens=arr(this.state?.[`p${pid}_thallya_ride_tokens`]);
    if(!tokens.length) return;
    this.state.distance=Math.max(0,n(this.state.distance)-tokens.reduce((sum,x)=>sum+n(x),0));
    this.state[`p${pid}_thallya_burned`]=n(this.state[`p${pid}_thallya_burned`])+tokens.length;
    this.state[`p${pid}_thallya_ride_tokens`]=[];
    events.push({kind:"騎動解除",playerId:pid,count:tokens.length,distance:n(this.state.distance)});
  }
  _thallyaStartDrawCount(playerId,events){
    const pid=Number(playerId),limit=Math.max(0,n(this.state?.[`p${pid}_thallya_draw_limit_once`]));
    if(limit>0){
      this.state[`p${pid}_thallya_draw_limit_once`]=0;
      events.push({kind:"ドロー枚数制限",playerId:pid,count:limit,source:"Form:YAKSHA"});
      return limit;
    }
    return 2;
  }
  _thallyaDualCandidates(playerId){
    const pid=Number(playerId);
    return arr(this.state?.[`p${pid}_discard`]).filter(cardId=>{
      const slug=stateCardSlug(this.state,pid,cardId),rule=this.cardRuleRegistry?.get(slug)?.mainUse;
      return rule?.kind==="attack-card"&&!rule.fullPower&&attackSourceMegamiFromSlug(slug)!=="thallya"&&this._discardUseLegal(pid,cardId,{nonFullpower:true});
    }).map(String);
  }
  _beginThallyaDualDiscardChoice(playerId,events){
    const pid=Number(playerId),attack=this.pendingAttack;
    if(!attack) throw new Error("Dual Action parent attack missing");
    const candidates=this._thallyaDualCandidates(pid);
    if(!candidates.length){ this._resolveAttackAfterEffects(events); return; }
    const choices=["skip",...candidates];
    this.pendingCardDecision={kind:"thallya-dual-discard",playerId:pid,label:"Dual Action",sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates:clone(choices)};
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:pid,choice:"Dual Action",candidates:clone(choices)});
  }
  _finishThallyaDualDiscardAttack(cardUse,slug,events){
    const pid=Number(cardUse?.playerId),id=String(cardUse?.cardId),usingKey=`p${pid}_using`,discardKey=`p${pid}_discard`;
    this.state[usingKey]=arr(this.state[usingKey]); this.state[discardKey]=arr(this.state[discardKey]);
    const index=this.state[usingKey].findIndex(x=>String(x)===id);
    if(index>=0) this.state[discardKey].push(this.state[usingKey].splice(index,1)[0]);
    events.push({kind:"Dual Action再使用終了",playerId:pid,cardId:id,slug});
    this.pendingAttack=this.attackStack.pop()||null;
    if(!this.pendingAttack) throw new Error("Dual Action parent attack missing after child");
    this._resolveAttackAfterEffects(events);
  }
  _beginThallyaDualDiscardAttack(playerId,cardId,events){
    const pid=Number(playerId),id=String(cardId),slug=stateCardSlug(this.state,pid,id),rule=this.cardRuleRegistry?.get(slug)?.mainUse;
    if(rule?.kind!=="attack-card"||rule.fullPower||attackSourceMegamiFromSlug(slug)==="thallya"||!this._discardUseLegal(pid,id,{nonFullpower:true})) throw new Error("illegal Dual Action discard attack");
    const paid=payResponseCardCost(this.state,pid,rule,id);
    if(paid.amount>0) events.push({kind:"消費",playerId:pid,cardId:id,slug,cost:clone(paid)});
    if(n(rule.burn)>0) this._thallyaBurn(pid,rule.burn,events,slug);
    const cardUse=moveCardToUsingFromZone(this.state,pid,id,"discard");
    this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
    this._markCardUseTraits(pid,slug,events);
    events.push({kind:"Dual Action再使用",playerId:pid,cardId:id,slug});
    this.attackStack.push(this.pendingAttack); this.pendingAttack=null;
    const spec=this._resolveYukihiAttackSpec({...(rule.attack||{}),sourceCardId:id,sourceSlug:slug,classification:"normal",attacker:pid,defender:pid===1?2:1},pid);
    const started=this._beginGeneratedAttack(spec,events,{kind:"thallya-dual-attack",cardUse,slug});
    if(!started.pending&&!this.done) this._finishThallyaDualDiscardAttack(cardUse,slug,events);
  }
  _hasThallyaA1(playerId){
    const pid=Number(playerId);
    return Object.values(this.state?.[`p${pid}_card_status`]||{}).some(row=>
      normalizeCardSlug(row?.Slug||row?.slug||"").startsWith("re_11_thallya_a1_")
    );
  }
  _thallyaA1Forms(playerId){
    return [...new Set(arr(this.state?.[`p${Number(playerId)}_thallya_a1_forms`]).map(String).filter(x=>["KINNARI","NAGA","ASURA","DEVA"].includes(x)))];
  }
  _thallyaA1AvailableForms(playerId){
    const active=new Set(this._thallyaA1Forms(playerId));
    return ["KINNARI","NAGA","ASURA","DEVA"].filter(x=>!active.has(x));
  }
  _addThallyaA1Form(playerId,form,events,{resolveEffect=true,source=""}={}){
    const pid=Number(playerId),value=String(form);
    if(!["KINNARI","NAGA","ASURA","DEVA"].includes(value)) throw new Error("invalid Thallya A1 form");
    const forms=this._thallyaA1Forms(pid);
    if(!forms.includes(value)) forms.push(value);
    this.state[`p${pid}_thallya_a1_forms`]=forms;
    events.push({kind:"TransForm",playerId:pid,form:value,a1:true,source:String(source||"")});
    if(!resolveEffect) return true;
    const opponent=pid===1?2:1;
    if(value==="KINNARI"){
      const deckKey=`p${opponent}_deck`,fdKey=`p${opponent}_facedown`;
      this.state[deckKey]=arr(this.state[deckKey]); this.state[fdKey]=arr(this.state[fdKey]);
      const moved=this.state[deckKey].splice(0);
      this.state[fdKey].push(...moved);
      this.state[`p${opponent}_known_deck_top`]=[];
      events.push({kind:"TransForm効果",playerId:pid,form:value,effect:"opponent-deck-to-facedown",count:moved.length});
    }else if(value==="NAGA"){
      const before=Math.max(0,n(this.state?.[`p${opponent}_flare`])),after=Math.min(before,2),moved=before-after;
      this.state[`p${opponent}_flare`]=after; this.state.dust=n(this.state.dust)+moved;
      events.push({kind:"TransForm効果",playerId:pid,form:value,movedFlareToDust:moved});
    }else if(value==="DEVA"){
      this._thallyaRecover(pid,2,events,"Form:DEVA");
      this._applyEffectMatoi(pid,events,"Form:DEVA");
      this._applyEffectMatoi(pid,events,"Form:DEVA");
    }
    return true;
  }
  _recordThallyaA1Transform(playerId,events,source=""){
    const pid=Number(playerId);
    this.state[`p${pid}_thallya_transform_count`]=Math.max(0,n(this.state?.[`p${pid}_thallya_transform_count`]))+1;
    this.state[`p${pid}_thallya_transformed_turn`]=true;
    events.push({kind:"TransForm回数",playerId:pid,count:this.state[`p${pid}_thallya_transform_count`],source:String(source||"")});
  }
  _beginThallyaA1TransformChoice(playerId,pending,events,source=""){
    const pid=Number(playerId),choices=this._thallyaA1AvailableForms(pid);
    this._recordThallyaA1Transform(pid,events,source);
    if(!choices.length){
      events.push({kind:"TransForm追加札なし",playerId:pid,source:String(source||"")});
      return false;
    }
    pending.pendingChoice={kind:"thallya-a1-transform",source:String(source||"")};
    pending.choices=clone(choices);
    this.phase="main-effect-choice";
    events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"TransForm",choices:clone(choices)});
    return true;
  }
  _beginThallyaA1AsuraDiscard(playerId,pending,events){
    const owner=Number(playerId),opponent=owner===1?2:1,candidates=arr(this.state?.[`p${opponent}_facedown`]).map(String);
    if(!candidates.length) return false;
    this.pendingCardDecision={
      kind:"thallya-a1-asura-discard",playerId:opponent,label:"ASURA",
      sourceCardId:pending?.cardId??null,slug:String(pending?.slug||""),
      candidates:clone(candidates),remaining:Math.min(2,candidates.length),ownerId:owner
    };
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:opponent,choice:"ASURA・伏せ札を捨て札",candidates:clone(candidates),remaining:this.pendingCardDecision.remaining});
    return true;
  }
  _thallyaExtraBasicKinds(playerId){
    const pid=Number(playerId),form=String(this.state?.[`p${pid}_thallya_form`]||""),a1Forms=this._thallyaA1Forms(pid);
    if(!this._hasThallya(pid)) return [];
    const kinds=[];
    if(form==="YAKSHA" && n(this.state?.[`p${pid}_thallya_machine`])>0) kinds.push({kind:"beta-edge",label:"Beta-Edge"});
    if(form==="NAGA") kinds.push({kind:"gamma-ray",label:"Gamma-Ray"});
    if(form==="GARUDA" && n(this.state.distance)<=7) kinds.push({kind:"delta-wing",label:"Delta-Wing"});
    if(a1Forms.includes("NAGA") && !kinds.some(x=>x.kind==="gamma-ray")) kinds.push({kind:"gamma-ray",label:"Gamma-Ray"});
    if(a1Forms.includes("ASURA") && !this.state?.[`p${pid}_thallya_asura_used_turn`]) kinds.push({kind:"sigma-drive",label:"Sigma-Drive"});
    return kinds;
  }
  _registeredThallyaExtraBasicActions(playerId){
    const pid=Number(playerId);
    const costs=standardBasicCosts(this.state,pid);
    if(!costs.length) return [];
    return this._thallyaExtraBasicKinds(pid)
      .flatMap(row=>costs.map(cost=>({actor:pid,kind:"追加基本動作",label:row.label,rule:TURN_THALLYA_EXTRA_BASIC,thallyaBasic:row.kind,cost:clone(cost)})));
  }
  _payThallyaBasicCost(playerId,cost){
    const pid=Number(playerId),c=cost||{};
    if(c.type==="focus"){
      if(n(this.state?.[`p${pid}_focus`])<1) throw new Error("insufficient focus for Thallya extra basic");
      this.state[`p${pid}_focus`]=n(this.state[`p${pid}_focus`])-1;
      return;
    }
    if(c.type==="facedown"){
      const id=String(c.cardId),handKey=`p${pid}_hand`,fdKey=`p${pid}_facedown`;
      this.state[handKey]=arr(this.state[handKey]); this.state[fdKey]=arr(this.state[fdKey]);
      const index=this.state[handKey].findIndex(x=>String(x)===id);
      if(index<0||isChikagePoisonCard(this.state,pid,id)) throw new Error("illegal Thallya extra basic card cost");
      this.state[fdKey].push(this.state[handKey].splice(index,1)[0]);
      return;
    }
    throw new Error("invalid Thallya extra basic cost");
  }
  _resolveThallyaExtraBasic(playerId,kind,events,resume={kind:"thallya-extra-basic"}){
    const pid=Number(playerId),value=String(kind||"");
    if(!this._thallyaExtraBasicKinds(pid).some(row=>row.kind===value)) throw new Error("illegal Thallya extra basic kind");
    this.basicActionsThisTurn[pid]=Math.max(0,n(this.basicActionsThisTurn?.[pid]))+1;
    if(value==="gamma-ray"){
      this._moveOpponentTopDeckToDiscard(pid,1,events,"Gamma-Ray");
      events.push({kind:"追加基本動作",playerId:pid,label:"Gamma-Ray"});
      return {pending:false};
    }
    if(value==="sigma-drive"){
      this.state[`p${pid}_thallya_asura_used_turn`]=true;
      events.push({kind:"追加基本動作",playerId:pid,label:"Sigma-Drive"});
      const started=this._beginGeneratedAttack({
        label:"Sigma-Drive",classification:null,range:[3,5],auraDamage:3,lifeDamage:2,
        sourceSlug:"re_11_thallya_a1_tf_asura",attacker:pid,
        afterEffects:[{kind:"intimidate-attacker",source:"Sigma-Drive"}]
      },events,clone(resume));
      return {pending:!!started.pending};
    }
    if(value==="delta-wing"){
      const moved=applyArrowAsMuchAsPossible(this.state,pid,"dust-to-distance",1,this.options);
      events.push({kind:"追加基本動作",playerId:pid,label:"Delta-Wing",moved});
      return {pending:false};
    }
    if(value==="beta-edge"){
      events.push({kind:"追加基本動作",playerId:pid,label:"Beta-Edge"});
      const started=this._beginGeneratedAttack({
        label:"Beta-Edge",classification:null,range:[2,4,6,8],auraDamage:2,lifeDamage:1,
        sourceSlug:"re_11_thallya_o_tf_1",attacker:pid,afterEffects:[{kind:"thallya-ride",optional:false,source:"Beta-Edge"}]
      },events,clone(resume));
      return {pending:!!started.pending};
    }
    throw new Error("unknown Thallya extra basic");
  }
  _applyThallyaExtraBasic(action,events){
    const pid=Number(this.turnPlayer),kind=String(action?.thallyaBasic||"");
    if(!this._registeredThallyaExtraBasicActions(pid).some(x=>turnActionKey(x)===turnActionKey(action))) throw new Error("illegal Thallya extra basic");
    this._payThallyaBasicCost(pid,action.cost);
    const result=this._resolveThallyaExtraBasic(pid,kind,events,{kind:"thallya-extra-basic"});
    if(!result.pending&&!this.done) this.phase="main";
  }

  _queueYurinaAunAuraChange(targetPlayerId,beforeAura,afterAura,events,source=""){
    const target=Number(targetPlayerId);
    if((target!==1&&target!==2) || n(beforeAura)===n(afterAura)) return false;
    const owner=target===1?2:1;
    const active=this._activeEnhancementBySlug(owner,"re_01_yurina_a2_n_7");
    if(!active || this.state?.[`p${owner}_yurina_aun_triggered_turn`]) return false;
    this.state[`p${owner}_yurina_aun_triggered_turn`]=true;
    this.pendingYurinaAunTriggers=arr(this.pendingYurinaAunTriggers);
    this.pendingYurinaAunTriggers.push({
      owner,target,sourceCardId:String(active.cardId),source:String(source||""),
      beforeAura:n(beforeAura),afterAura:n(afterAura)
    });
    events.push({
      kind:"阿吽誘発",playerId:owner,targetPlayer:target,cardId:String(active.cardId),
      source:String(source||""),beforeAura:n(beforeAura),afterAura:n(afterAura)
    });
    return true;
  }
  _resumeYurinaAun(resume,events){
    const ctx=clone(resume||{kind:"phase",phase:"main"});
    if(ctx.restoreParentAttack){
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("Aun parent attack missing");
    }
    if(ctx.kind==="phase"){
      this.phase=String(ctx.phase||"main");
    }else{
      throw new Error(`unsupported Aun resume: ${ctx.kind}`);
    }
    if(!this.done && !this.pendingCardDecision && arr(this.pendingYurinaAunTriggers).length){
      this._beginNextYurinaAunTrigger(events,{kind:"phase",phase:this.phase});
    }
  }
  _beginNextYurinaAunTrigger(events,resume=null){
    this.pendingYurinaAunTriggers=arr(this.pendingYurinaAunTriggers);
    if(!this.pendingYurinaAunTriggers.length) return false;
    const row=this.pendingYurinaAunTriggers.shift();
    const owner=Number(row.owner);
    const candidates=["skip"];
    if(this._effectBasicActions(owner).includes(3)) candidates.push("matoi");
    if(attackInRange(this.state,{range:[3,4,5]})) candidates.push("attack");
    const ctx=clone(resume||{kind:"phase",phase:this.phase});
    if(candidates.length===1){
      events.push({kind:"阿吽",playerId:owner,cardId:row.sourceCardId,choice:"skip"});
      this._resumeYurinaAun(ctx,events);
      return false;
    }
    this.pendingCardDecision={
      kind:"yurina-aun-choice",playerId:owner,label:"阿吽",
      sourceCardId:row.sourceCardId,slug:"re_01_yurina_a2_n_7",
      candidates:clone(candidates),yurinaResume:ctx
    };
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:owner,cardId:row.sourceCardId,choice:"阿吽",candidates:clone(candidates)});
    return true;
  }
  _beginYurinaAunAttack(playerId,sourceCardId,resume,events){
    const pid=Number(playerId),ctx=clone(resume||{kind:"phase",phase:"main"});
    if(this.pendingAttack){
      this.attackStack.push(this.pendingAttack);
      this.pendingAttack=null;
      ctx.restoreParentAttack=true;
    }
    const started=this._beginGeneratedAttack({
      label:"阿吽",classification:null,range:[3,4,5],auraDamage:2,lifeDamage:1,
      sourceCardId:String(sourceCardId),sourceSlug:"re_01_yurina_a2_n_7",attacker:pid
    },events,{kind:"yurina-aun-generated",context:ctx});
    if(!started.pending&&!this.done) this._resumeYurinaAun(ctx,events);
  }
  _beginYurinaShinzawatariChoice(attack,events){
    const state=attack?.yurinaShinzawatariState;
    if(!state) return false;
    const pid=Number(attack.attacker);
    if(n(state.remainingBasic)>0){
      const candidates=["done"];
      const basics=this._effectBasicActions(pid);
      if(basics.includes(3)) candidates.push("3");
      if(basics.includes(4)) candidates.push("4");
      if(candidates.length>1){
        this.pendingCardDecision={
          kind:"yurina-shinzawatari-basic",playerId:pid,label:"神座渡",
          sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates,
          remaining:n(state.remainingBasic)
        };
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:attack.sourceCardId,choice:"神座渡・基本動作",remaining:n(state.remainingBasic),candidates:clone(candidates)});
        return true;
      }
      state.remainingBasic=0;
    }
    if(n(state.remainingReady)>0){
      const used=usedSpecialCandidates(this.state,pid).map(String).filter(id=>String(id)!==String(attack.sourceCardId));
      if(used.length){
        const candidates=["done",...used];
        this.pendingCardDecision={
          kind:"yurina-shinzawatari-ready",playerId:pid,label:"神座渡",
          sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates,
          remaining:n(state.remainingReady)
        };
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:attack.sourceCardId,choice:"神座渡・切札再起",remaining:n(state.remainingReady),candidates:clone(candidates)});
        return true;
      }
      state.remainingReady=0;
    }
    return false;
  }

  _hasChikage(playerId){ return stateHasChikage(this.state,playerId); }
  _chikagePoisonBagCards(playerId,allowed=[]){
    const pid=Number(playerId),set=new Set(arr(allowed).map(normalizeCardSlug));
    return arr(this.state?.[`p${pid}_poison_bag`]).filter(cardId=>!set.size||set.has(stateCardSlug(this.state,pid,cardId)));
  }
  _chikageTransferPoison(bagOwner,targetPlayer,cardId,destination,events,source=""){
    const owner=Number(bagOwner),target=Number(targetPlayer),id=String(cardId),bagKey=`p${owner}_poison_bag`;
    this.state[bagKey]=arr(this.state[bagKey]);
    const index=this.state[bagKey].findIndex(x=>String(x)===id);
    if(index<0) throw new Error("poison card left poison bag");
    const moved=this.state[bagKey].splice(index,1)[0];
    const sourceStatus=clone(this.state?.[`p${owner}_card_status`]?.[id]||{});
    if(!this.state[`p${target}_card_status`]||typeof this.state[`p${target}_card_status`]!=="object") this.state[`p${target}_card_status`]={};
    this.state[`p${target}_card_status`][id]={...sourceStatus,PoisonBagOwner:owner,Charge:0,TokenCharges:{}};
    const zone=destination==="deck-top"?"deck":"hand",key=`p${target}_${zone}`;
    this.state[key]=arr(this.state[key]);
    if(destination==="deck-top") this.state[key].unshift(moved); else this.state[key].push(moved);
    if(destination==="deck-top") this.state[`p${target}_known_deck_top`]=[moved,...arr(this.state[`p${target}_known_deck_top`])];
    events.push({kind:"毒付与",playerId:owner,targetPlayer:target,cardId:moved,slug:stateCardSlug(this.state,target,moved),destination,source:String(source||"")});
    return moved;
  }
  _chikageHandHasPoison(playerId){const pid=Number(playerId);return arr(this.state?.[`p${pid}_hand`]).some(cardId=>isChikagePoisonCard(this.state,pid,cardId));}
  _chikageRelaxationActive(playerId){return !!this._activeEnhancementBySlug(Number(playerId),"re_09_chikage_o_p_3");}
  _chikageLivingWayActive(playerId){return this._activeEnhancementBySlug(Number(playerId),"re_09_chikage_o_s_4");}
  _failChikageLivingWayOnLifeDamage(playerId,events,reason=""){
    const pid=Number(playerId),row=this._chikageLivingWayActive(pid); if(!row) return false;
    const id=String(row.cardId),enhKey=`p${pid}_enhancement`,specialKey=`p${pid}_special`;
    this.state[enhKey]=arr(this.state[enhKey]); this.state[specialKey]=arr(this.state[specialKey]);
    const index=this.state[enhKey].findIndex(x=>String(x)===id); if(index<0) return false;
    const status=this.state?.[`p${pid}_card_status`]?.[id]||{},tokenCharges=positiveTokenChargeMap(status)||{};
    const crystals=Object.keys(tokenCharges).length?Object.values(tokenCharges).reduce((sum,x)=>sum+n(x),0):Math.max(0,n(status.Charge));
    const moved=this.state[enhKey].splice(index,1)[0]; if(!this.state[specialKey].some(x=>String(x)===id)) this.state[specialKey].push(moved);
    this.state.dust=n(this.state.dust)+crystals; status.Charge=0; status.TokenCharges={};
    if(!this.state[`p${pid}_special_status`]||typeof this.state[`p${pid}_special_status`]!=="object") this.state[`p${pid}_special_status`]={};
    this.state[`p${pid}_special_status`][id]=0;
    events.push({kind:"生きる道失敗",playerId:pid,cardId:id,crystalsToDust:crystals,reason:String(reason||"life-damage")}); return true;
  }
  _chikageLivingWayCanWin(playerId,sourceCardId){
    const pid=Number(playerId),source=String(sourceCardId),status=this.state?.[`p${pid}_special_status`]||{};
    return arr(this.state?.[`p${pid}_special`]).filter(cardId=>String(cardId)!==source).every(cardId=>Number(status[String(cardId)]||0)===2);
  }
  _hasYukihi(playerId){
    const pid=Number(playerId),charas=this.state?.["p"+pid+"_chara_ids"];
    if(Array.isArray(charas)) return charas.map(Number).includes(6);
    const status=this.state?.["p"+pid+"_card_status"]||{};
    return Object.values(status).some(row=>normalizeCardSlug(row?.Slug||row?.slug||"").includes("_yukihi_"));
  }
  _yukihiUmbrellaOpen(playerId){ return !!this.state?.["p"+Number(playerId)+"_yukihi_umbrella_open"]; }
  _yukihiCardOwner(cardUse,fallbackPlayerId){ const borrowed=Number(cardUse?.borrowedOwner); return [1,2].includes(borrowed)?borrowed:Number(fallbackPlayerId); }
  _resolveYukihiAttackSpec(spec,ownerId){
    const raw=clone(spec||{}),faces=raw.yukihiFaces,owner=[1,2].includes(Number(ownerId))?Number(ownerId):Number(raw.attacker);
    delete raw.yukihiFaces; raw.sourceOwnerId=owner;
    if(!faces) return raw;
    if(!this._hasYukihi(owner)){ raw.range=[]; raw.auraDamage=0; raw.lifeDamage=0; raw.afterEffects=[]; return raw; }
    return {...raw,...(clone(this._yukihiUmbrellaOpen(owner)?faces.open:faces.closed)||{}),sourceOwnerId:owner};
  }
  _yukihiDororiuraRangePreview(attack,attacker){
    const pid=Number(attacker);
    if(pid!==this.turnPlayer || Math.max(0,n(this.attackCountsThisTurn?.[pid]))!==0) return attack;
    const row=this._activeEnhancementBySlug(pid,"re_06_yukihi_o_s_3"); if(!row) return attack;
    const borrowed=Number(row.status?.BorrowedOwner),owner=[1,2].includes(borrowed)?borrowed:pid;
    if(!this._hasYukihi(owner)) return attack;
    if(this._yukihiUmbrellaOpen(owner)) applyRangeExpansion(attack,0,1); else applyRangeExpansion(attack,1,0);
    return attack;
  }
  _applyYukihiDororiuraFirstAttack(attack,events){
    const pid=Number(attack?.attacker);
    if(pid!==this.turnPlayer || Math.max(0,n(this.attackCountsThisTurn?.[pid]))!==0) return;
    const row=this._activeEnhancementBySlug(pid,"re_06_yukihi_o_s_3"); if(!row) return;
    const borrowed=Number(row.status?.BorrowedOwner),owner=[1,2].includes(borrowed)?borrowed:pid;
    if(!this._hasYukihi(owner)) return;
    const open=this._yukihiUmbrellaOpen(owner);
    attack.yukihiDororiura={sourceCardId:row.cardId,umbrellaOwner:owner,open,baseRange:clone(attack.range),baseAuraWasNull:attack.auraDamage==null,baseLifeWasNull:attack.lifeDamage==null};
    if(open){ applyRangeExpansion(attack,0,1); attack.auraDamage=attack.auraDamage==null?1:Math.max(0,n(attack.auraDamage)+1); }
    else { applyRangeExpansion(attack,1,0); attack.lifeDamage=attack.lifeDamage==null?1:Math.max(0,n(attack.lifeDamage)+1); }
    events.push({kind:"展開中攻撃修正",source:"どろりうら",sourceCardId:row.cardId,playerId:pid,target:attack.label,umbrella:open?"open":"closed",range:clone(attack.range),auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
  }
  _refreshYukihiDororiuraAttack(attack,events){
    const meta=attack?.yukihiDororiura; if(!meta) return;
    const nextOpen=this._yukihiUmbrellaOpen(meta.umbrellaOwner); if(nextOpen===!!meta.open) return;
    attack.range=clone(meta.baseRange);
    if(meta.open){ if(meta.baseAuraWasNull) attack.auraDamage=null; else if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)-1); }
    else { if(meta.baseLifeWasNull) attack.lifeDamage=null; else if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)-1); }
    if(nextOpen){ applyRangeExpansion(attack,0,1); attack.auraDamage=attack.auraDamage==null?1:Math.max(0,n(attack.auraDamage)+1); }
    else { applyRangeExpansion(attack,1,0); attack.lifeDamage=attack.lifeDamage==null?1:Math.max(0,n(attack.lifeDamage)+1); }
    meta.open=nextOpen;
    events.push({kind:"展開中攻撃修正更新",source:"どろりうら",sourceCardId:meta.sourceCardId,playerId:attack.attacker,target:attack.label,umbrella:nextOpen?"open":"closed",range:clone(attack.range),auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
  }
  _refreshAllYukihiDororiuraAttacks(ownerId,events){
    const owner=Number(ownerId);
    for(const attack of [this.pendingAttack,...arr(this.attackStack)]) if(Number(attack?.yukihiDororiura?.umbrellaOwner)===owner) this._refreshYukihiDororiuraAttack(attack,events);
  }
  _yukihiKasamawashiCardIds(playerId){
    const pid=Number(playerId);
    return arr(this.state?.["p"+pid+"_hand"]).filter(cardId=>stateCardSlug(this.state,pid,cardId)==="re_06_yukihi_o_n_5");
  }
  _continueYukihiKasamawashiReveals(playerId,remaining,resume,events){
    const pid=Number(playerId),ids=arr(remaining);
    if(!ids.length){ this._resumeAfterYukihiToggle(resume,events); return false; }
    const cardId=ids.shift();
    this.pendingCardDecision={
      kind:"yukihi-kasamawashi-reveal",playerId:pid,label:"かさまわし",
      sourceCardId:cardId,slug:"re_06_yukihi_o_n_5",candidates:["skip","reveal"],
      remainingKasamawashi:clone(ids),yukihiResume:clone(resume||null)
    };
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:pid,cardId,choice:"かさまわし公開",candidates:["skip","reveal"]});
    return true;
  }
  _tryRechargeHarariyuki(playerId,events){
    const pid=Number(playerId),status=this.state?.["p"+pid+"_special_status"]||{};
    for(const cardId of arr(this.state?.["p"+pid+"_special"])){
      if(Number(status[String(cardId)]||0)!==2 || stateCardSlug(this.state,pid,cardId)!=="re_06_yukihi_o_s_1") continue;
      status[String(cardId)]=0; events.push({kind:"即再起",playerId:pid,cardId,slug:"re_06_yukihi_o_s_1",condition:"umbrella-toggle"});
    }
  }
  _resumeAfterYukihiToggle(resume,events){
    const ctx=clone(resume||{}),matoiPid=Number(ctx.matoiPlayerId);
    if([1,2].includes(matoiPid)) this._applyEffectMatoi(matoiPid,events,String(ctx.matoiSource||"傘の開閉"));
    if(ctx.kind==="main-action"){ const pending=this.pendingMainCard; if(!pending || String(pending.cardId)!==String(ctx.cardId)) throw new Error("Yukihi main action resume mismatch"); this._continueMainActionCard(pending,events); return; }
    if(ctx.kind==="response-action"){ this._finishActionResponseCard(events); return; }
    if(ctx.kind==="attack-after"){ this._resolveAttackAfterEffects(events); return; }
    if(ctx.kind==="end-turn"){ this._beginEndHandLimit(Number(ctx.playerId||this.turnPlayer),events); return; }
    if(ctx.kind==="none"||!ctx.kind) return;
    throw new Error("unsupported Yukihi toggle resume");
  }
  _toggleYukihiUmbrella(playerId,events,source="",resume=null){
    const pid=Number(playerId);
    if(!this._hasYukihi(pid)){ this._resumeAfterYukihiToggle(resume,events); return false; }
    const open=!this._yukihiUmbrellaOpen(pid); this.state["p"+pid+"_yukihi_umbrella_open"]=open;
    events.push({kind:"傘の開閉",playerId:pid,state:open?"open":"closed",source:String(source||"")});
    this._tryRechargeHarariyuki(pid,events); this._refreshAllYukihiDororiuraAttacks(pid,events);
    const kasamawashi=this._yukihiKasamawashiCardIds(pid);
    if(kasamawashi.length) return this._continueYukihiKasamawashiReveals(pid,kasamawashi,resume,events);
    this._resumeAfterYukihiToggle(resume,events); return false;
  }
  _beginYukihiEndToggleChoice(playerId,events){
    const pid=Number(playerId);
    if(!this._hasYukihi(pid)){ this._beginEndHandLimit(pid,events); return; }
    this.pendingYukihiEndToggle={playerId:pid}; this.phase="yukihi-end-toggle-choice"; events.push({kind:"傘の開閉選択待ち",playerId:pid});
  }
  _requestShinraPlanPreparation(playerId,resume,events){
    const pid=Number(playerId);
    if(!this._hasShinra(pid)){
      events.push({kind:"計略なし",playerId:pid});
      this._resumeAfterShinraPlan(resume,events);
      return;
    }
    this.pendingShinraPlan={playerId:pid,resume:clone(resume||null)};
    this.phase="shinra-plan-choice";
    events.push({kind:"計略準備待ち",playerId:pid});
  }
  _resumeAfterShinraPlan(resume,events){
    const ctx=resume||{};
    if(ctx.kind==="attack-after"){
      this._resolveAttackAfterEffects(events);
      return;
    }
    if(ctx.kind==="main-action"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(ctx.cardId)) throw new Error("Shinra main action resume mismatch");
      if(ctx.endPhaseAfterPlan) pending.endPhaseAfterResolution=true;
      this._continueMainActionCard(pending,events);
      return;
    }
    if(ctx.kind==="response-action"){
      this._finishActionResponseCard(events);
      return;
    }
    if(ctx.kind==="forced-enhancement-discard-shinra"){
      this._finishForcedEnhancementDiscard(Number(ctx.playerId),ctx.cardId,events,ctx.caller);
      return;
    }
    if(ctx.kind==="enhancement-discard-shinra"){
      const pid=Number(ctx.playerId),source=this.pendingEnhancementDiscards[0];
      if(String(source)!==String(ctx.cardId)) throw new Error("Shinra enhancement discard queue mismatch");
      const moved=finishEnhancementDiscard(this.state,pid,source);
      events.push({kind:"付与札の破棄完了",playerId:pid,cards:[{cardId:source,...moved}]});
      this._onEnhancementDiscarded(pid,source,events);
      this.pendingEnhancementDiscards.shift();
      if(!this.done) this._advanceEnhancementDiscardQueue(events);
      return;
    }
    if(ctx.kind==="main-enhancement-discard-shinra"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(ctx.cardId)) throw new Error("Shinra immediate enhancement discard mismatch");
      if(!this.done) this._finishImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    if(ctx.kind==="phase"){
      this.phase=String(ctx.phase||"main");
      return;
    }
    throw new Error(`unsupported Shinra plan resume: ${ctx.kind}`);
  }
  _finishShinraPlanPreparation(choice,events){
    const pending=this.pendingShinraPlan;
    if(!pending) throw new Error("missing Shinra plan preparation");
    const plan=String(choice);
    if(!["神算","鬼謀"].includes(plan)) throw new Error("invalid Shinra plan");
    const pid=Number(pending.playerId),resume=clone(pending.resume||null);
    this.shinraPlan[pid]=plan;
    this.pendingShinraPlan=null;
    events.push({kind:"計略準備",playerId:pid});
    this._resumeAfterShinraPlan(resume,events);
  }
  _moveOpponentDeckToFacedown(playerId,count,events,source=""){
    const pid=Number(playerId),opponent=pid===1?2:1,deckKey=`p${opponent}_deck`,facedownKey=`p${opponent}_facedown`;
    this.state[deckKey]=arr(this.state[deckKey]);
    this.state[facedownKey]=arr(this.state[facedownKey]);
    let moved=0;
    while(moved<Math.max(0,n(count)) && this.state[deckKey].length){
      const cardId=this.state[deckKey][0];
      if(isChikagePoisonCard(this.state,opponent,cardId)) break;
      this.state[deckKey].shift();
      this.state[facedownKey].push(cardId);
      moved++;
    }
    this.state[`p${opponent}_known_deck_top`]=[];
    events.push({kind:"山札から伏せ札",playerId:opponent,count:moved,source});
    return moved;
  }
  _beginShinraSougoFacedown(context,events){
    const ctx=clone(context||{}),opponent=Number(ctx.opponent),owner=Number(ctx.shinraOwner);
    const candidates=arr(this.state?.[`p${opponent}_hand`]).filter(cardId=>!isChikagePoisonCard(this.state,opponent,cardId)).map(String);
    if(candidates.length){
      this.pendingCardDecision={
        kind:"shinra-sougo-facedown",
        playerId:opponent,
        label:"手札",
        sourceCardId:ctx.sourceCardId,
        slug:ctx.sourceSlug,
        candidates:clone(candidates),
        remaining:Math.min(2,candidates.length),
        shinraOwner:owner,
        planResume:clone(ctx.planResume||null)
      };
      this.phase="start-card-choice";
      events.push({kind:"選択待ち",playerId:opponent,choice:"伏せ札",candidates:clone(candidates)});
      return;
    }
    this._requestShinraPlanPreparation(owner,ctx.planResume,events);
  }
  _continueShinraSougoDraw(context,events){
    const ctx=clone(context||{}),opponent=Number(ctx.opponent);
    let remaining=Math.max(0,n(ctx.remainingDraws));
    while(remaining>0){
      const cardId=drawTopCard(this.state,opponent);
      remaining--;
      if(cardId==null){
        this.pendingEffectFatigue={
          playerId:opponent,
          reason:"shinra-sougo-draw",
          resumeKind:"shinra-sougo-draw",
          shinraOwner:Number(ctx.shinraOwner),
          opponent,
          sourceCardId:ctx.sourceCardId,
          sourceSlug:ctx.sourceSlug,
          remainingDraws:remaining,
          planResume:clone(ctx.planResume||null)
        };
        this.phase="effect-fatigue";
        events.push({kind:"焦燥待ち",playerId:opponent,reason:"壮語・鬼謀のドロー",remainingDraws:remaining});
        return;
      }
      events.push({kind:"ドロー",playerId:opponent,cardId,reason:"鬼謀"});
    }
    this._beginShinraSougoFacedown({...ctx,remainingDraws:0},events);
  }
  _beginShinraPlanEffect(playerId,sourceCardId,sourceSlug,planEffects,resume,events){
    const pid=Number(playerId);
    if(!this._hasShinra(pid)){
      events.push({kind:"計略なし",playerId:pid,cardId:sourceCardId,slug:sourceSlug});
      this._resumeAfterShinraPlan(resume,events);
      return;
    }
    const plan=String(this.shinraPlan?.[pid]||"神算");
    const effect=clone(planEffects?.[plan]||null);
    events.push({kind:"計略実行",playerId:pid,plan,cardId:sourceCardId,slug:sourceSlug});
    if(!effect){
      this._requestShinraPlanPreparation(pid,resume,events);
      return;
    }
    if(effect.kind==="arrow"){
      const arrow=effect.arrow||{};
      const moved=applyArrowAsMuchAsPossible(this.state,pid,String(arrow.kind||""),arrow.count??1,this.options);
      events.push({kind:"計略矢印",playerId:pid,plan,arrow:String(arrow.kind||""),moved});
      this._requestShinraPlanPreparation(pid,resume,events);
      return;
    }
    if(effect.kind==="opponent-deck-to-facedown"){
      this._moveOpponentDeckToFacedown(pid,effect.count??1,events,sourceSlug);
      this._requestShinraPlanPreparation(pid,resume,events);
      return;
    }
    if(effect.kind==="gain-focus-and-return-self-deck-top"){
      this._gainFocus(pid,effect.count??1,events,"神算");
      const enhKey=`p${pid}_enhancement`,deckKey=`p${pid}_deck`,id=String(sourceCardId);
      this.state[enhKey]=arr(this.state[enhKey]); this.state[deckKey]=arr(this.state[deckKey]);
      const index=this.state[enhKey].findIndex(cardId=>String(cardId)===id);
      if(index>=0){
        const [moved]=this.state[enhKey].splice(index,1);
        this.state[deckKey].unshift(moved);
        events.push({kind:"山札の上へ",playerId:pid,cardId:moved,source:sourceSlug});
      }
      this._requestShinraPlanPreparation(pid,resume,events);
      return;
    }
    if(effect.kind==="opponent-hand-low-draw-three-facedown-two"){
      const opponent=pid===1?2:1;
      if(arr(this.state?.[`p${opponent}_hand`]).length<=n(effect.handAtMost)){
        this.state[`p${opponent}_intimidated`]=true;
        events.push({kind:"畏縮",playerId:opponent,source:sourceSlug});
        this._continueShinraSougoDraw({
          shinraOwner:pid,
          opponent,
          sourceCardId,
          sourceSlug,
          remainingDraws:3,
          planResume:clone(resume||null)
        },events);
        return;
      }
      this._requestShinraPlanPreparation(pid,resume,events);
      return;
    }
    if(["use-opponent-discard-card","use-own-used-special-enhancement-free","destroy-opponent-nonspecial-enhancement"].includes(effect.kind)){
      this.pendingCardDecision={
        kind:`shinra-plan-${effect.kind}`,
        playerId:pid,
        label:"計略",
        sourceCardId,
        slug:sourceSlug,
        candidates:[],
        shinraOwner:pid,
        planEffect:clone(effect),
        planResume:clone(resume||null)
      };
      this._prepareShinraPlanCardDecision(events);
      return;
    }
    throw new Error(`unsupported Shinra plan effect: ${effect.kind}`);
  }
  _beginOwnUsedSpecialEnhancementFree(playerId,cardId,events,resumeContext){
    const pid=Number(playerId),id=String(cardId),slug=stateCardSlug(this.state,pid,id),entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
    if(rule?.kind!=="enhancement-card" || Number(this.state?.[`p${pid}_special_status`]?.[id]||0)!==2) throw new Error("illegal used special enhancement reuse");
    const ctx=clone(resumeContext||{});
    if(this.pendingMainCard){
      this.pendingMainCardStack.push(this.pendingMainCard);
      this.pendingMainCard=null;
      ctx.restoreMainParent=true;
    }
    const cardUse=moveCardToUsingFromZone(this.state,pid,id,"special");
    this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
    this._markCardUseTraits(pid,slug,events);
    events.push({kind:"切札再使用",playerId:pid,cardId:id,slug,costPaid:0});
    this._beginMainEnhancement(rule,cardUse,slug,events,ctx);
  }
  _resumeOwnSpecialPlanUse(context,events){
    const ctx=clone(context||{});
    if(ctx.restoreMainParent){
      this.pendingMainCard=this.pendingMainCardStack.pop()||null;
      if(!this.pendingMainCard) throw new Error("Shinra plan parent main action missing");
    }
    const resume=clone(ctx.planResume||null);
    if(ctx.endPhaseAfterPlan && resume?.kind==="main-action") resume.endPhaseAfterPlan=true;
    this._requestShinraPlanPreparation(Number(ctx.shinraOwner),resume,events);
  }
  _prepareShinraPlanCardDecision(events){
    const d=this.pendingCardDecision;
    if(!d || !String(d.kind||"").startsWith("shinra-plan-")) throw new Error("missing Shinra plan card decision");
    const pid=Number(d.shinraOwner),effect=d.planEffect||{},opponent=pid===1?2:1;
    if(effect.kind==="use-opponent-discard-card"){
      d.candidates=["done",...arr(this.state?.[`p${opponent}_discard`]).filter(cardId=>
        this._borrowedCardRuleLegal(pid,opponent,cardId,"discard")
      ).map(String)];
    }else if(effect.kind==="use-own-used-special-enhancement-free"){
      const status=this.state?.[`p${pid}_special_status`]||{};
      d.candidates=arr(this.state?.[`p${pid}_special`]).filter(cardId=>
        Number(status[String(cardId)]||0)===2 &&
        this.cardRuleRegistry?.get(stateCardSlug(this.state,pid,cardId))?.mainUse?.kind==="enhancement-card"
      ).map(String);
    }else if(effect.kind==="destroy-opponent-nonspecial-enhancement"){
      d.candidates=arr(this.state?.[`p${opponent}_enhancement`]).filter(cardId=>
        !this.state?.[`p${opponent}_card_status`]?.[String(cardId)]?.IsSpecial
      ).map(String);
    }else{
      throw new Error("unsupported Shinra plan card decision");
    }
    if(!d.candidates.length || (d.candidates.length===1 && d.candidates[0]==="done")){
      this.pendingCardDecision=null;
      this._requestShinraPlanPreparation(pid,d.planResume,events);
      return;
    }
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:pid,choice:"計略",candidates:clone(d.candidates)});
  }
  _resumeForcedEnhancementDiscardCaller(resume,events){
    const ctx=clone(resume||{});
    if(ctx.kind==="shinra-s2-destroy"){
      this._requestShinraPlanPreparation(Number(ctx.shinraOwner),ctx.planResume,events);
      return;
    }
    throw new Error(`unsupported forced enhancement caller: ${ctx.kind}`);
  }
  _finishForcedEnhancementDiscard(playerId,cardId,events,resume){
    const pid=Number(playerId),id=String(cardId);
    const moved=finishEnhancementDiscard(this.state,pid,id);
    events.push({kind:"付与札の破棄完了",playerId:pid,cards:[{cardId:id,...moved}]});
    this._onEnhancementDiscarded(pid,id,events);
    if(!this.done) this._resumeForcedEnhancementDiscardCaller(resume,events);
  }
  _beginForcedEnhancementDiscard(playerId,cardId,events,resume){
    const pid=Number(playerId),id=String(cardId),slug=stateCardSlug(this.state,pid,id);
    const effect=this.cardRuleRegistry?.get(slug)?.enhancementDiscard;
    if(!effect){
      this.done=true;
      this.doneReason="unsupported-enhancement-discard-effect";
      events.push({kind:"未対応",playerId:pid,reason:"強制付与札破棄時効果",cardId:id,slug});
      return;
    }
    if(effect.kind==="intimidate-opponent"){
      const opponent=pid===1?2:1;
      this.state[`p${opponent}_intimidated`]=true;
      events.push({kind:"畏縮",playerId:opponent,source:this.cardRuleRegistry?.get(slug)?.name||slug});
      this._finishForcedEnhancementDiscard(pid,id,events,resume);
      return;
    }
    if(effect.kind==="none"){
      this._finishForcedEnhancementDiscard(pid,id,events,resume);
      return;
    }
    if(effect.kind==="yukihi-enmusubi-discard"){
      const arrow=this._hasYukihi(pid)&&this._yukihiUmbrellaOpen(pid)?"distance-to-dust":"dust-to-distance";
      const moved=applyArrowAsMuchAsPossible(this.state,pid,arrow,1,this.options);
      events.push({kind:"破棄時矢印",playerId:pid,cardId:id,source:"えんむすび",arrow,moved});
      this._finishForcedEnhancementDiscard(pid,id,events,resume); return;
    }
    if(effect.kind==="arrow"){
      const arrow=effect.arrow||{};
      const moved=applyArrowAsMuchAsPossible(this.state,pid,String(arrow.kind||""),arrow.count??1,this.options);
      events.push({kind:"破棄時矢印",playerId:pid,cardId:id,arrow:String(arrow.kind||""),moved});
      this._finishForcedEnhancementDiscard(pid,id,events,resume);
      return;
    }
    if(effect.kind==="generated-attack" || effect.kind==="generated-attack-then-arrow"){
      const attackSpec={...(effect.attack||{}),sourceCardId:id,sourceSlug:slug,classification:null,attacker:pid};
      const started=this._beginGeneratedAttack(attackSpec,events,{
        kind:effect.kind==="generated-attack"?"forced-enhancement-discard":"forced-enhancement-discard-then-arrow",
        playerId:pid,
        cardId:id,
        arrow:clone(effect.arrow||null),
        caller:clone(resume||null)
      });
      if(!started.pending&&!this.done){
        if(effect.kind==="generated-attack-then-arrow" && effect.arrow){
          const moved=applyArrowAsMuchAsPossible(this.state,pid,String(effect.arrow.kind||""),effect.arrow.count??1,this.options);
          events.push({kind:"破棄時矢印",playerId:pid,cardId:id,arrow:String(effect.arrow.kind||""),moved});
        }
        this._finishForcedEnhancementDiscard(pid,id,events,resume);
      }
      return;
    }
    if(effect.kind==="ready-one-used-special"){
      const candidates=usedSpecialCandidates(this.state,pid);
      if(!candidates.length){
        events.push({kind:"破棄時効果",playerId:pid,cardId:id,slug,effect:"使用済切札なし"});
        this._finishForcedEnhancementDiscard(pid,id,events,resume);
        return;
      }
      if(candidates.length===1){
        readySpecialCard(this.state,pid,candidates[0]);
        events.push({kind:"破棄時効果",playerId:pid,cardId:id,slug,effect:"切札を未使用に戻す",targetCardId:candidates[0]});
        this._finishForcedEnhancementDiscard(pid,id,events,resume);
        return;
      }
      this.pendingCardDecision={
        kind:"forced-ready-used-special",
        playerId:pid,
        label:"切札を未使用に戻す",
        sourceCardId:id,
        slug,
        candidates:clone(candidates),
        forcedResume:clone(resume||null)
      };
      this.phase="start-card-choice";
      events.push({kind:"選択待ち",playerId:pid,cardId:id,slug,choice:"使用済切札",candidates:clone(candidates)});
      return;
    }
    if(effect.kind==="shinra-plan"){
      this._beginShinraPlanEffect(pid,id,slug,effect.planEffects,{
        kind:"forced-enhancement-discard-shinra",
        playerId:pid,
        cardId:id,
        caller:clone(resume||null)
      },events);
      return;
    }
    if(effect.kind==="return-sealed-to-owner-discard"){
      this._returnSealedCards(pid,id,events);
      this._finishForcedEnhancementDiscard(pid,id,events,resume);
      return;
    }
    if(effect.kind==="chikage-living-way-win"){
      if(this._chikageLivingWayCanWin(pid,id)){this.done=true;this.doneReason="chikage-living-way";this.winner=pid;events.push({kind:"勝利",playerId:pid,reason:"闇昏千影の生きる道"});return;}
      this._finishForcedEnhancementDiscard(pid,id,events,resume); return;
    }
    if(effect.kind==="lose-game"){
      this.done=true;
      this.doneReason="shinra-adjudication-expired";
      this.winner=pid===1?2:1;
      events.push({kind:"敗北",playerId:pid,reason:"森羅判証の破棄時"});
      return;
    }
    throw new Error(`unsupported forced enhancement discard effect: ${effect.kind}`);
  }
  _onEnhancementDiscarded(playerId,cardId,events){
    const pid=Number(playerId),discarded=String(cardId),opponent=pid===1?2:1;
    for(const sourceId of arr(this.state?.[`p${pid}_enhancement`])){
      if(String(sourceId)===discarded || this._isEnhancementDiscardResolving(sourceId)) continue;
      const slug=stateCardSlug(this.state,pid,sourceId);
      if(!this.cardRuleRegistry?.get(slug)?.shinraAdjudication) continue;
      const damage=this._applyLifeDamageWithTriggers(opponent,1,events,"森羅判証");
      events.push({kind:"森羅判証",playerId:pid,sourceCardId:sourceId,discardedCardId:cardId,damage});
      if(this._setLossIfNeeded(opponent,"life-zero-shinra-adjudication")) return;
    }
  }
  _shinraDamageSwapActive(playerId){
    const pid=Number(playerId);
    return arr(this.state?.[`p${pid}_enhancement`]).some(cardId=>{
      if(this._isEnhancementDiscardResolving(cardId)) return false;
      const slug=stateCardSlug(this.state,pid,cardId);
      return !!this.cardRuleRegistry?.get(slug)?.shinraDamageSwap;
    });
  }
  _applyShinraDamageSwap(attack,events){
    if(!attack || !this._shinraDamageSwapActive(attack.attacker)) return;
    const aura=attack.auraDamage,life=attack.lifeDamage;
    attack.auraDamage=life;
    attack.lifeDamage=aura;
    attack.shinraDamageSwapped=true;
    events.push({kind:"攻撃ダメージ入れ替え",playerId:attack.attacker,source:"天地反駁",label:attack.label,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
  }
  _sealCardUnder(playerId,hostCardId,ownerId,cardId,events,{permanent=false}={}){
    const pid=Number(playerId),owner=Number(ownerId),id=String(cardId),host=String(hostCardId);
    const discardKey=`p${owner}_discard`;
    this.state[discardKey]=arr(this.state[discardKey]);
    const index=this.state[discardKey].findIndex(x=>String(x)===id);
    if(index<0) throw new Error("seal target left discard");
    this.state[discardKey].splice(index,1);
    const status=this.state?.[`p${pid}_card_status`]?.[host];
    if(!status) throw new Error("seal host status missing");
    status.SealedCards=arr(status.SealedCards);
    status.SealedCards.push({ownerId:owner,cardId,permanent:!!permanent});
    events.push({kind:"封印",playerId:pid,hostCardId,ownerId:owner,cardId,permanent:!!permanent});
  }
  _returnSealedCards(playerId,hostCardId,events){
    const pid=Number(playerId),host=String(hostCardId),status=this.state?.[`p${pid}_card_status`]?.[host];
    const sealed=arr(status?.SealedCards),returned=[];
    if(status) status.SealedCards=[];
    for(const row of sealed){
      if(row?.permanent) continue;
      const owner=Number(row?.ownerId),cardId=row?.cardId;
      if(owner!==1&&owner!==2) continue;
      const discardKey=`p${owner}_discard`;
      this.state[discardKey]=arr(this.state[discardKey]);
      this.state[discardKey].push(cardId);
      returned.push({ownerId:owner,cardId});
    }
    if(returned.length) events.push({kind:"封印解除",playerId:pid,hostCardId,cards:clone(returned)});
    return returned;
  }
  _moveOpponentTopDeckToDiscard(playerId,count,events,source=""){
    const pid=Number(playerId),opponent=pid===1?2:1,deckKey=`p${opponent}_deck`,discardKey=`p${opponent}_discard`;
    this.state[deckKey]=arr(this.state[deckKey]); this.state[discardKey]=arr(this.state[discardKey]);
    let moved=0;
    while(moved<Math.max(0,n(count)) && this.state[deckKey].length){
      const cardId=this.state[deckKey].shift();
      this.state[discardKey].push(cardId);
      moved++;
    }
    this.state[`p${opponent}_known_deck_top`]=[];
    events.push({kind:"山札から捨て札",playerId:opponent,count:moved,source});
    return moved;
  }
  _borrowedCardRuleLegal(userId,ownerId,cardId,sourceZone,{attackOnly=false,enhancementOnly=false,ignoreCost=false}={}){
    const user=Number(userId),owner=Number(ownerId),id=String(cardId),zone=String(sourceZone||"");
    if(!arr(this.state?.[`p${owner}_${zone}`]).some(x=>String(x)===id)) return false;
    const slug=stateCardSlug(this.state,owner,id),entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
    if(!rule) return false;
    if(attackOnly && rule.kind!=="attack-card") return false;
    if(enhancementOnly && rule.kind!=="enhancement-card") return false;
    const condition=rule.useCondition;
    if(condition?.kind==="self-life-at-most" && n(this.state?.[`p${user}_life`])>n(condition.value)) return false;
    if(condition?.kind==="centrifugal" && !this._centrifugalLegal(user)) return false;
    if(condition?.kind==="no-basic-actions-this-turn" && n(this.basicActionsThisTurn?.[user])>0) return false;
    if(condition && !["self-life-at-most","centrifugal","no-basic-actions-this-turn"].includes(String(condition.kind||""))) return false;
    if(!ignoreCost && !canPayResponseCardCost(this.state,user,rule)) return false;
    if(n(rule.burn)>0&&!this._thallyaCanBurn(user,rule.burn)) return false;
    if(rule.kind==="attack-card"){
      if(this._chikageRelaxationActive(user)) return false;
      const attack=normalizeAttackSpec(this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),
        sourceCardId:id,sourceSlug:slug,
        classification:zone==="special"?"special":"normal",attacker:user,defender:user===1?2:1
      },owner));
      this._applyQueuedRangeModifierPreview(attack,user);
      this._yukihiDororiuraRangePreview(attack,user);
      return attackInRange(this.state,attack);
    }
    return rule.kind==="action-card"||rule.kind==="enhancement-card";
  }
  _moveBorrowedCardToUsing(userId,ownerId,cardId,sourceZone){
    const user=Number(userId),owner=Number(ownerId),id=String(cardId),zone=String(sourceZone);
    const fromKey=`p${owner}_${zone}`,usingKey=`p${user}_using`;
    this.state[fromKey]=arr(this.state[fromKey]); this.state[usingKey]=arr(this.state[usingKey]);
    const index=this.state[fromKey].findIndex(x=>String(x)===id);
    if(index<0) throw new Error("borrowed card source changed");
    const [moved]=this.state[fromKey].splice(index,1);
    this.state[usingKey].push(moved);
    const sourceStatus=clone(this.state?.[`p${owner}_card_status`]?.[id]||{});
    if(!this.state[`p${user}_card_status`]||typeof this.state[`p${user}_card_status`]!=="object") this.state[`p${user}_card_status`]={};
    this.state[`p${user}_card_status`][id]={...sourceStatus,BorrowedOwner:owner};
    return {playerId:user,cardId:moved,sourceZone:zone,borrowedOwner:owner};
  }
  _finishBorrowedUsingCard(cardUse,slug,events){
    const user=Number(cardUse?.playerId),owner=Number(cardUse?.borrowedOwner),id=String(cardUse?.cardId);
    const usingKey=`p${user}_using`,discardKey=`p${owner}_discard`,specialKey=`p${owner}_special`;
    this.state[usingKey]=arr(this.state[usingKey]); this.state[discardKey]=arr(this.state[discardKey]); this.state[specialKey]=arr(this.state[specialKey]);
    const index=this.state[usingKey].findIndex(x=>String(x)===id);
    let destination="discard";
    if(index>=0){
      const [moved]=this.state[usingKey].splice(index,1);
      if(String(cardUse?.sourceZone||"")==="special"){
        if(!this.state[specialKey].some(x=>String(x)===id)) this.state[specialKey].push(moved);
        if(!this.state[`p${owner}_special_status`]||typeof this.state[`p${owner}_special_status`]!=="object") this.state[`p${owner}_special_status`]={};
        this.state[`p${owner}_special_status`][id]=2;
        destination="special-used";
      }else this.state[discardKey].push(moved);
    }
    delete this.state[`p${user}_card_status`]?.[id];
    events.push({kind:"借用カード使用終了",playerId:user,ownerId:owner,cardId:cardUse?.cardId,slug,destination});
  }
  _restoreBorrowedContexts(context){
    const ctx=context||{};
    if(ctx.restoreParentAttack){
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("borrowed parent attack missing");
    }
    if(ctx.restoreMainParent){
      this.pendingMainCard=this.pendingMainCardStack.pop()||null;
      if(!this.pendingMainCard) throw new Error("borrowed main parent missing");
    }
  }
  _resumeBorrowedCard(context,events){
    const ctx=clone(context||{});
    this._restoreBorrowedContexts(ctx);
    if(ctx.kind==="shinra-plan-borrowed"){
      this._requestShinraPlanPreparation(Number(ctx.shinraOwner),ctx.planResume,events);
      return;
    }
    if(ctx.kind==="shinra-quote-borrowed"){
      const pending=this.pendingMainCard;
      if(!pending) throw new Error("quote parent missing");
      if(ctx.endPhaseAfterUse) pending.endPhaseAfterResolution=true;
      this._continueMainActionCard(pending,events);
      return;
    }
    if(ctx.kind==="kururu-kansu-borrowed"){
      const pending=this.pendingMainCard;
      if(!pending) throw new Error("Kansu parent missing");
      this._continueMainActionCard(pending,events);
      return;
    }
    throw new Error(`unsupported borrowed resume: ${ctx.kind}`);
  }
  _finishBorrowedAttack(cardUse,slug,context,events){
    this._finishBorrowedUsingCard(cardUse,slug,events);
    const rule=this.cardRuleRegistry?.get(slug)?.mainUse||{};
    this._beginKururuPostCardBasics(Number(cardUse?.playerId),rule,{kind:"borrowed-resume",context:clone(context)},events);
  }
  _beginBorrowedCardUse(userId,ownerId,cardId,sourceZone,events,resumeContext,{ignoreCost=false}={}){
    const user=Number(userId),owner=Number(ownerId),id=String(cardId),slug=stateCardSlug(this.state,owner,id);
    const entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
    if(!rule || !this._borrowedCardRuleLegal(user,owner,id,sourceZone,{ignoreCost})) throw new Error("illegal borrowed card use");
    const ctx=clone(resumeContext||{});
    if(this.pendingMainCard){
      this.pendingMainCardStack.push(this.pendingMainCard); this.pendingMainCard=null; ctx.restoreMainParent=true;
    }
    if(this.pendingAttack){
      this.attackStack.push(this.pendingAttack); this.pendingAttack=null; ctx.restoreParentAttack=true;
    }
    if(!ignoreCost){
      const paid=payResponseCardCost(this.state,user,rule);
      if(paid.amount>0) events.push({kind:"消費",playerId:user,cardId:id,slug,cost:clone(paid)});
      if(n(rule.burn)>0) this._thallyaBurn(user,rule.burn,events,slug);
    }
    const cardUse=this._moveBorrowedCardToUsing(user,owner,id,sourceZone);
    this.cardUseCountsThisTurn[user]=Math.max(0,n(this.cardUseCountsThisTurn?.[user]))+1;
    this._markCardUseTraits(user,slug,events);
    events.push({kind:"借用カード使用",playerId:user,ownerId:owner,cardId:id,slug,sourceZone});
    if(rule.kind==="attack-card"){
      const attackSpec=this._resolveYukihiAttackSpec({...(rule.attack||{}),sourceCardId:id,sourceSlug:slug,classification:sourceZone==="special"?"special":"normal",attacker:user,defender:user===1?2:1},owner);
      const started=this._beginGeneratedAttack(attackSpec,events,{kind:"borrowed-card",cardUse,slug,context:ctx});
      if(!started.pending&&!this.done) this._finishBorrowedAttack(cardUse,slug,ctx,events);
      return;
    }
    if(rule.kind==="action-card"){
      this._beginMainActionCard(rule,cardUse,slug,events,{...ctx,externalSource:"borrowed",borrowedOwner:owner});
      return;
    }
    if(rule.kind==="enhancement-card"){
      this._beginMainEnhancement(rule,cardUse,slug,events,{...ctx,externalSource:"borrowed",borrowedOwner:owner});
      return;
    }
    throw new Error("unsupported borrowed card kind");
  }
  _tryRechargeUpasitumForFullAura(targetPlayerId,wasFull,events){
    const target=Number(targetPlayerId);
    if(wasFull || !this._auraHasNoSpace(target)) return false;
    const owner=target===1?2:1,statusMap=this.state?.[`p${owner}_special_status`]||{};
    for(const cardId of arr(this.state?.[`p${owner}_special`])){
      if(Number(statusMap[String(cardId)]||0)!==2) continue;
      if(stateCardSlug(this.state,owner,cardId)!=="re_15_korunu_o_s_3") continue;
      statusMap[String(cardId)]=0;
      events.push({kind:"即再起",playerId:owner,cardId,slug:"re_15_korunu_o_s_3",condition:"opponent-aura-space-to-none"});
      return true;
    }
    return false;
  }
  _resolveUpasitumRechargeFromStateTransition(before,events){
    for(const target of [1,2]){
      const wasFull=n(before?.[`p${target}_aura`])+n(before?.[`p${target}_freeze`])>=n(this.options.auraLimit??5);
      if(wasFull || !this._auraHasNoSpace(target)) continue;
      const owner=target===1?2:1,beforeStatus=before?.[`p${owner}_special_status`]||{},afterStatus=this.state?.[`p${owner}_special_status`]||{};
      for(const cardId of arr(this.state?.[`p${owner}_special`])){
        if(stateCardSlug(this.state,owner,cardId)!=="re_15_korunu_o_s_3") continue;
        if(Number(beforeStatus[String(cardId)]||0)!==2 || Number(afterStatus[String(cardId)]||0)!==2) continue;
        afterStatus[String(cardId)]=0;
        events.push({kind:"即再起",playerId:owner,cardId,slug:"re_15_korunu_o_s_3",condition:"opponent-aura-space-to-none"});
        break;
      }
    }
  }
  _auraHasNoSpace(playerId,state=this.state){
    const pid=Number(playerId);
    return n(state?.[`p${pid}_aura`])+n(state?.[`p${pid}_freeze`])>=n(this.options.auraLimit??5);
  }
  _freezePlayer(playerId,count=1,events=[],source=""){
    const pid=Number(playerId),requested=Math.max(0,Math.floor(n(count)));
    const wasFull=this._auraHasNoSpace(pid);
    const room=Math.max(0,n(this.options.auraLimit??5)-n(this.state?.[`p${pid}_aura`])-n(this.state?.[`p${pid}_freeze`]));
    const moved=Math.min(requested,room);
    this.state[`p${pid}_freeze`]=n(this.state[`p${pid}_freeze`])+moved;
    events.push({kind:"凍結",playerId:pid,requested,moved,source:String(source||"")});
    this._tryRechargeUpasitumForFullAura(pid,wasFull,events);
    return moved;
  }
  _freezeUntilAuraFull(playerId,events=[],source=""){
    const pid=Number(playerId);
    const room=Math.max(0,n(this.options.auraLimit??5)-n(this.state?.[`p${pid}_aura`])-n(this.state?.[`p${pid}_freeze`]));
    return this._freezePlayer(pid,room,events,source);
  }
  _applyAttackPostResponseEffects(attack,events,source="",resumeKind="advance-parent"){
    if(!attack) return false;
    for(const effect of arr(attack.afterEachResponseEffects)){
      if(effect?.kind==="choose-distance-dust"){
        this.pendingAttackPostResponseChoice={
          playerId:Number(attack.attacker),
          attackLabel:String(attack.label||""),
          responseSource:String(source||""),
          count:Math.max(0,n(effect.count??1)),
          resumeKind:String(resumeKind||"advance-parent")
        };
        this.phase="attack-post-response-choice";
        events.push({kind:"選択待ち",playerId:attack.attacker,choice:"間合⇔ダスト",count:Math.max(0,n(effect.count??1)),source:attack.label});
        return true;
      }
      if(effect?.kind==="arrow"){
        const arrow=effect.arrow||{};
        const moved=applyArrowAsMuchAsPossible(this.state,attack.attacker,String(arrow.kind||""),arrow.count??1,this.options);
        events.push({kind:"対応解決後効果",source:attack.label,responseSource:String(source||""),arrow:String(arrow.kind||""),moved});
        continue;
      }
      throw new Error(`unsupported post-response attack effect: ${effect?.kind}`);
    }
    return false;
  }
  _finishAttackPostResponseChoice(choice,events){
    const pending=this.pendingAttackPostResponseChoice;
    if(!pending) throw new Error("missing post-response attack choice");
    const arrow=String(choice||"");
    if(!["distance-to-dust","dust-to-distance"].includes(arrow)) throw new Error("invalid post-response arrow");
    const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,arrow,pending.count,this.options);
    const resumeKind=String(pending.resumeKind||"advance-parent");
    events.push({kind:"対応解決後効果",source:pending.attackLabel,responseSource:pending.responseSource,arrow,moved});
    this.pendingAttackPostResponseChoice=null;
    if(resumeKind==="finish-action-response"){
      this._finishActionResponseCard(events);
      return;
    }
    if(resumeKind==="advance-parent"){
      this._advanceAttackAfterResponse(events);
      return;
    }
    throw new Error(`unsupported post-response resume: ${resumeKind}`);
  }
  _resetPhaseAttackTracking(){
    this.attackPerformedInPhase={1:false,2:false};
  }
  _centrifugalLegal(playerId){
    const pid=Number(playerId);
    return n(this.state.distance)>=n(this.turnStartDistance)+2 && !this.attackPerformedInPhase?.[pid];
  }
  _rairaUseActionVariants(playerId,actions,slugGetter){
    const pid=Number(playerId),out=[];
    for(const action of arr(actions)){
      const slug=normalizeCardSlug(typeof slugGetter==="function"?slugGetter(action):"");
      if(stateHasRaira(this.state,pid) && slug && attackSourceMegamiFromSlug(slug)!=="raira"){
        out.push({...action,rairaGauge:"wind"},{...action,rairaGauge:"thunder"});
      }else out.push(action);
    }
    return out;
  }
  _rairaGaugeValue(playerId,kind){
    const pid=Number(playerId),key=String(kind)==="thunder"?"thunder":"wind";
    return Math.max(0,Math.min(20,n(this.state?.[`p${pid}_raira_${key}`])));
  }
  _rairaGaugeTotal(playerId){
    const pid=Number(playerId);
    return this._rairaGaugeValue(pid,"wind")+this._rairaGaugeValue(pid,"thunder");
  }
  _rairaPutDiscardOnDeckTop(playerId,cardId,events,source=""){
    const pid=Number(playerId),id=String(cardId),discardKey=`p${pid}_discard`,deckKey=`p${pid}_deck`,knownKey=`p${pid}_known_deck_top`;
    this.state[discardKey]=arr(this.state[discardKey]); this.state[deckKey]=arr(this.state[deckKey]); this.state[knownKey]=arr(this.state[knownKey]);
    const index=this.state[discardKey].findIndex(x=>String(x)===id);
    if(index<0) throw new Error("Raira top-deck target left discard");
    const [moved]=this.state[discardKey].splice(index,1);
    this.state[deckKey].unshift(moved);
    this.state[knownKey].unshift(moved);
    events.push({kind:"山札の一番上へ",playerId:pid,cardId:moved,source:String(source||"")});
  }
  _rairaWisdomCandidates(playerId){
    const pid=Number(playerId);
    return arr(this.state?.[`p${pid}_discard`]).filter(cardId=>attackSourceMegamiFromSlug(stateCardSlug(this.state,pid,cardId))!=="raira").map(String);
  }
  _finishRairaWisdomAfterDraw(events){
    const pending=this.pendingMainCard;
    if(!pending || pending.slug!=="re_12_raira_o_n_5") throw new Error("Raira wisdom parent missing");
    const removed=this._removeUsingCardToOutside(pending.playerId,pending.cardId);
    events.push({kind:"取り除く",playerId:pending.playerId,cardId:pending.cardId,source:"風雷の知恵",removed});
    this._continueMainActionCard(pending,events);
  }
  _resumeRairaWisdomAfterReconstruction(events){
    const pending=this.pendingMainCard;
    if(!pending || pending.slug!=="re_12_raira_o_n_5") throw new Error("Raira wisdom reconstruction parent missing");
    const cardId=drawTopCard(this.state,pending.playerId);
    if(cardId==null){
      this.pendingEffectFatigue={playerId:pending.playerId,reason:"raira-wisdom-draw",resumeKind:"raira-wisdom-draw",cardId:pending.cardId};
      this.phase="effect-fatigue";
      events.push({kind:"焦燥待ち",playerId:pending.playerId,reason:"風雷の知恵のドロー"});
      return;
    }
    events.push({kind:"ドロー",playerId:pending.playerId,cardId,reason:"風雷の知恵"});
    this._finishRairaWisdomAfterDraw(events);
  }
  _continueRairaWisdom(pending,events){
    pending.pendingChoice=null; pending.choices=[];
    if(this._rairaGaugeTotal(pending.playerId)>=12){
      this._beginReconstructionSequence(pending.playerId,events,{takeLifeDamage:false,pendingDraws:1,resumeKind:"raira-wisdom"});
      return;
    }
    this._continueMainActionCard(pending,events);
  }
  _beginRairaHeavenlyAttack(pending,events){
    if(!pending || pending.slug!=="re_12_raira_o_s_2") throw new Error("Raira heavenly parent missing");
    const remaining=Math.max(0,n(pending.rairaHeavenlyRemaining));
    if(remaining<=0){ this._continueMainActionCard(pending,events); return; }
    pending.rairaHeavenlyRemaining=remaining-1;
    const attackSpec={label:"天雷召喚陣",classification:null,sourceCardClassification:"special",range:[0,1,2,3,4,5,6,7,8,9,10],auraDamage:1,lifeDamage:1,sourceCardId:pending.cardId,sourceSlug:pending.slug,attacker:pending.playerId};
    const started=this._beginGeneratedAttack(attackSpec,events,{kind:"raira-heavenly-array",cardId:pending.cardId});
    if(!started.pending&&!this.done) this._beginRairaHeavenlyAttack(pending,events);
  }
  _rairaGrantExtraSpecial(playerId,slug,events){
    const pid=Number(playerId),normalized=normalizeCardSlug(slug);
    const statusKey=`p${pid}_card_status`,specialKey=`p${pid}_special`,specialStatusKey=`p${pid}_special_status`;
    this.state[statusKey]=this.state[statusKey]&&typeof this.state[statusKey]==="object"?this.state[statusKey]:{};
    this.state[specialKey]=arr(this.state[specialKey]);
    this.state[specialStatusKey]=this.state[specialStatusKey]&&typeof this.state[specialStatusKey]==="object"?this.state[specialStatusKey]:{};
    for(const [id,row] of Object.entries(this.state[statusKey])){
      if(normalizeCardSlug(row?.Slug||row?.slug||"")===normalized){
        if(!this.state[specialKey].some(x=>String(x)===String(id)) && !arr(this.state?.[`p${pid}_outside`]).some(x=>String(x)===String(id))) this.state[specialKey].push(id);
        this.state[specialStatusKey][String(id)]=0;
        return String(id);
      }
    }
    const suffix=normalized.split("_").slice(-1)[0],id=`raira-extra-${pid}-${suffix}`;
    const type=normalized.endsWith("_ex1")?1:2,subType=normalized.endsWith("_ex3")?1:0;
    this.state[statusKey][id]={Slug:normalized,MainType:type,SubType:subType,IsSpecial:true,RairaExtra:true};
    this.state[specialKey].push(id);
    this.state[specialStatusKey][id]=0;
    events.push({kind:"追加札を得る",playerId:pid,cardId:id,slug:normalized,status:"unused"});
    return id;
  }
  _rairaTenguChoices(){
    const out=["skip"];
    for(const arrow of ["distance-to-dust","dust-to-distance"]) for(let count=1;count<=5;count++) out.push(`${arrow}:${count}`);
    return out;
  }
  _applyRairaTenguChoice(playerId,choice,events,source="風魔天狗道"){
    const pid=Number(playerId),value=String(choice);
    let moved=0,arrow="",count=0;
    if(value!=="skip"){
      const m=/^(distance-to-dust|dust-to-distance):([1-5])$/.exec(value);
      if(!m) throw new Error("invalid Raira Tengu choice");
      arrow=m[1]; count=Number(m[2]);
      moved=applyArrowAsMuchAsPossible(this.state,pid,arrow,count,this.options);
    }
    events.push({kind:"風魔天狗道",playerId:pid,source,arrow,count,moved});
  }
  _rairaCycleCard(playerId){
    const pid=Number(playerId);
    return arr(this.state?.[`p${pid}_enhancement`]).find(cardId=>stateCardSlug(this.state,pid,cardId)==="re_12_raira_o_s_4")||null;
  }
  _requestRairaCycleAfterAttack(attack,events){
    if(!attack || attack.rairaCycleChecked) return false;
    attack.rairaCycleChecked=true;
    const pid=Number(attack.defender),cardId=this._rairaCycleCard(pid);
    if(cardId==null) return false;
    const candidates=["skip","wind:distance-to-dust","wind:dust-to-distance","thunder:distance-to-dust","thunder:dust-to-distance"];
    this.pendingCardDecision={kind:"raira-cycle-after-attack",playerId:pid,label:"円環輪廻旋",sourceCardId:String(cardId),slug:"re_12_raira_o_s_4",candidates};
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:pid,cardId:String(cardId),choice:"円環輪廻旋",candidates:clone(candidates)});
    return true;
  }
  _raiseRairaGauge(playerId,kind,count,events,source=""){
    const pid=Number(playerId),key=String(kind)==="thunder"?"thunder":"wind",amount=Math.max(0,Math.floor(n(count)));
    const before=this._rairaGaugeValue(pid,key),after=Math.min(20,before+amount);
    this.state[`p${pid}_raira_${key}`]=after;
    events.push({kind:"風雷ゲージ",playerId:pid,gauge:key,before,after,source:String(source||"")});
    return after-before;
  }
  _markCardUseTraits(playerId,slug,events){
    const pid=Number(playerId),entry=this.cardRuleRegistry?.get(slug)||{};
    if(entry.centrifugal){
      this.centrifugalUsedThisTurn[pid]=true;
      events.push({kind:"遠心使用",playerId:pid,slug});
    }
    if(stateHasRaira(this.state,pid) && attackSourceMegamiFromSlug(slug)!=="raira"){
      let gauge=String(this.nextRairaGaugeChoice?.[pid]||"");
      if(!["wind","thunder"].includes(gauge)){
        gauge=this._rairaGaugeValue(pid,"wind")<=this._rairaGaugeValue(pid,"thunder")?"wind":"thunder";
      }
      this.nextRairaGaugeChoice[pid]=null;
      this._raiseRairaGauge(pid,gauge,1,events,slug);
    }
  }
  _allOtherSpecialsUsed(playerId,sourceCardId){
    const pid=Number(playerId),source=String(sourceCardId),status=this.state?.[`p${pid}_special_status`]||{};
    return arr(this.state?.[`p${pid}_special`])
      .filter(cardId=>String(cardId)!==source)
      .every(cardId=>Number(status[String(cardId)]||0)===2);
  }
  _removeUsingCardToOutside(playerId,cardId){
    const pid=Number(playerId),id=String(cardId),usingKey=`p${pid}_using`,outsideKey=`p${pid}_outside`;
    this.state[usingKey]=arr(this.state[usingKey]);
    this.state[outsideKey]=arr(this.state[outsideKey]);
    const index=this.state[usingKey].findIndex(cardId=>String(cardId)===id);
    if(index<0) return false;
    const [moved]=this.state[usingKey].splice(index,1);
    this.state[outsideKey].push(moved);
    if(!this.state[`p${pid}_special_status`]||typeof this.state[`p${pid}_special_status`]!=="object") this.state[`p${pid}_special_status`]={};
    this.state[`p${pid}_special_status`][id]=2;
    return true;
  }
  _uroActive(playerId){
    const pid=Number(playerId),specialStatus=this.state?.[`p${pid}_special_status`]||{};
    for(const cardId of arr(this.state?.[`p${pid}_enhancement`])){
      const slug=stateCardSlug(this.state,pid,cardId);
      if(this.cardRuleRegistry?.get(slug)?.oboroUro) return true;
    }
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      const slug=stateCardSlug(this.state,pid,cardId);
      if(this.cardRuleRegistry?.get(slug)?.oboroUro && Number(specialStatus[String(cardId)]||0)===2) return true;
    }
    return false;
  }
  _reverseArrowKind(kind){
    const pairs={
      "dust-to-distance":"distance-to-dust",
      "distance-to-dust":"dust-to-distance",
      "distance-to-opponent-aura":"opponent-aura-to-distance",
      "opponent-aura-to-distance":"distance-to-opponent-aura",
      "opponent-aura-to-flare":"opponent-flare-to-aura",
      "opponent-flare-to-aura":"opponent-aura-to-flare",
      "aura-to-distance":"distance-to-aura",
      "distance-to-aura":"aura-to-distance",
      "flare-to-aura":"aura-to-flare",
      "aura-to-flare":"flare-to-aura",
      "dust-to-aura":"aura-to-dust",
      "aura-to-dust":"dust-to-aura"
    };
    return pairs[String(kind||"")]||"";
  }
  _mainActionArrowVariants(pending,effect){
    const arrows=arr(effect?.arrows).map(x=>clone(x));
    if(pending?.cardUse?.sourceZone!=="facedown" || !this._uroActive(pending.playerId)) return arrows;
    const out=[...arrows];
    for(const arrow of arrows){
      const reverse=this._reverseArrowKind(arrow?.kind);
      if(reverse && !out.some(x=>String(x?.kind||"")===reverse)) out.push({...clone(arrow),kind:reverse});
    }
    return out;
  }
  _facedownUseLegal(playerId,cardId,{nonFullpower=false,installOnly=false,nonAttack=false}={}){
    const pid=Number(playerId),id=String(cardId);
    if(!arr(this.state?.[`p${pid}_facedown`]).some(x=>String(x)===id)) return false;
    const slug=stateCardSlug(this.state,pid,id),entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
    if(!rule) return false;
    if(rule.useCondition?.kind==="centrifugal" && !this._centrifugalLegal(pid)) return false;
    if(nonFullpower && rule.fullPower) return false;
    if(installOnly && !entry.install) return false;
    if(nonAttack && rule.kind==="attack-card") return false;
    if(!canPayResponseCardCost(this.state,pid,rule,id)) return false;
    if(n(rule.burn)>0&&!this._thallyaCanBurn(pid,rule.burn)) return false;
    if(rule.kind==="attack-card"){
      const attack=normalizeAttackSpec(this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),
        sourceCardId:id,
        sourceSlug:slug,
        classification:"normal",
        attacker:pid,
        defender:pid===1?2:1,
        usedFromFacedown:true
      },pid));
      this._applyQueuedRangeModifierPreview(attack,pid);
      this._yukihiDororiuraRangePreview(attack,pid);
      return attackInRange(this.state,attack);
    }
    return rule.kind==="action-card"||rule.kind==="enhancement-card";
  }
  _discardUseLegal(playerId,cardId,{nonFullpower=true}={}){
    const pid=Number(playerId),id=String(cardId);
    if(!arr(this.state?.[`p${pid}_discard`]).some(x=>String(x)===id)) return false;
    const slug=stateCardSlug(this.state,pid,id),entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
    if(!rule) return false;
    if(nonFullpower && rule.fullPower) return false;
    if(rule.useCondition?.kind==="centrifugal" && !this._centrifugalLegal(pid)) return false;
    if(!canPayResponseCardCost(this.state,pid,rule,id)) return false;
    if(n(rule.burn)>0&&!this._thallyaCanBurn(pid,rule.burn)) return false;
    if(rule.kind==="attack-card"){
      const attack=normalizeAttackSpec(this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),
        sourceCardId:id,
        sourceSlug:slug,
        classification:"normal",
        attacker:pid,
        defender:pid===1?2:1
      },pid));
      this._applyQueuedRangeModifierPreview(attack,pid);
      this._yukihiDororiuraRangePreview(attack,pid);
      return attackInRange(this.state,attack);
    }
    return rule.kind==="action-card"||rule.kind==="enhancement-card";
  }
  _finishExternalDiscardAttack(cardUse,slug,context,events){
    const pid=Number(cardUse?.playerId),id=String(cardUse?.cardId),usingKey=`p${pid}_using`,facedownKey=`p${pid}_facedown`;
    this.state[usingKey]=arr(this.state[usingKey]);
    this.state[facedownKey]=arr(this.state[facedownKey]);
    const index=this.state[usingKey].findIndex(cardId=>String(cardId)===id);
    let moved=false;
    if(index>=0){
      const [card]=this.state[usingKey].splice(index,1);
      this.state[facedownKey].push(card);
      moved=true;
    }
    events.push({kind:"カード使用終了",playerId:pid,cardId:cardUse?.cardId,slug,moved,destination:moved?"facedown":"effect-moved"});
    this._markResponseCardResolvedTraits(cardUse,slug,events);
    this._resumeExternalCardUse(context,events);
  }
  _beginDiscardCardUse(playerId,cardId,events,resumeContext){
    const pid=Number(playerId),id=String(cardId),slug=stateCardSlug(this.state,pid,id);
    const entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
    if(!rule || !this._discardUseLegal(pid,id,{nonFullpower:true})) throw new Error("illegal discard card use");
    const ctx={...clone(resumeContext||{}),externalSource:"discard"};
    if(this.pendingMainCard){
      this.pendingMainCardStack.push(this.pendingMainCard);
      this.pendingMainCard=null;
      ctx.restoreMainParent=true;
    }
    const paid=payResponseCardCost(this.state,pid,rule,id);
    if(paid.amount>0) events.push({kind:"消費",playerId:pid,cardId:id,slug,cost:clone(paid)});
    if(n(rule.burn)>0) this._thallyaBurn(pid,rule.burn,events,slug);
    const cardUse=moveCardToUsingFromZone(this.state,pid,id,"discard");
    this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
    this._markCardUseTraits(pid,slug,events);
    events.push({kind:"カード使用",playerId:pid,cardId:id,slug,sourceZone:"discard"});
    if(rule.kind==="attack-card"){
      const attackSpec=this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),
        sourceCardId:id,
        sourceSlug:slug,
        classification:"normal",
        attacker:pid,
        defender:pid===1?2:1
      },pid);
      const started=this._beginGeneratedAttack(attackSpec,events,{kind:"external-discard-card",cardUse,slug,context:ctx});
      if(!started.pending&&!this.done) this._finishExternalDiscardAttack(cardUse,slug,ctx,events);
      return;
    }
    if(rule.kind==="action-card"){
      this._beginMainActionCard(rule,cardUse,slug,events,ctx);
      return;
    }
    if(rule.kind==="enhancement-card"){
      this._beginMainEnhancement(rule,cardUse,slug,events,ctx);
      return;
    }
    throw new Error("unsupported discard card kind");
  }
  _installCandidates(playerId,mode="normal"){
    const pid=Number(playerId);
    return arr(this.state?.[`p${pid}_facedown`]).filter(cardId=>
      this._facedownUseLegal(pid,cardId,{
        installOnly:true,
        nonAttack:String(mode)==="uro"
      })
    );
  }
  _resumeCompletedReconstruction(resumeKind,draws,events){
    if(resumeKind==="start-phase"){
      this.pendingDraws=draws;
      this._advanceDraws(events);
      return;
    }
    if(resumeKind==="attack-after"){
      this._resolveAttackAfterEffects(events);
      return;
    }
    if(resumeKind==="kururu-big-golem-end"){
      this._continueEndTurnAfterKururu(events);
      return;
    }
    if(resumeKind==="raira-wisdom"){
      this._resumeRairaWisdomAfterReconstruction(events);
      return;
    }
    throw new Error(`unsupported reconstruction resume: ${resumeKind}`);
  }
  _beginThallyaA1KinnariAfterReconstruction(reconstructor,resumeKind,draws,industriaRecharged,events){
    const pid=Number(reconstructor),owner=pid===1?2:1;
    if(!this._thallyaA1Forms(owner).includes("KINNARI")) return false;
    const started=this._beginGeneratedAttack({
      label:"KINNARI",classification:null,range:[2,4,6],auraDamage:2,lifeDamage:2,
      sourceSlug:"re_11_thallya_a1_tf_kinnari",attacker:owner,defender:pid
    },events,{kind:"thallya-a1-kinnari-reconstruction",reconstructor:pid,resumeKind,draws,industriaRecharged:!!industriaRecharged});
    return !!started.pending;
  }
  _beginReconstructionSequence(playerId,events,{takeLifeDamage=true,pendingDraws=2,resumeKind="start-phase"}={}){
    const pid=Number(playerId);
    this.pendingReconstruction={
      playerId:pid,
      takeLifeDamage:!!takeLifeDamage,
      pendingDraws:Math.max(0,n(pendingDraws)),
      resumeKind:String(resumeKind||"start-phase"),
      remaining:{normal:true,uro:this._uroActive(pid)}
    };
    this._advanceReconstructionInstall(events);
  }
  _advanceReconstructionInstall(events){
    const pending=this.pendingReconstruction;
    if(!pending) throw new Error("missing reconstruction state");
    const pid=Number(pending.playerId);
    for(const mode of ["normal","uro"]){
      if(!pending.remaining?.[mode]) continue;
      if(!this._installCandidates(pid,mode).length) pending.remaining[mode]=false;
    }
    if(pending.remaining.normal||pending.remaining.uro){
      this.phase="reconstruction-install-choice";
      events.push({kind:"設置選択待ち",playerId:pid,normal:!!pending.remaining.normal,uro:!!pending.remaining.uro});
      return;
    }
    this._completePendingReconstruction(events);
  }
  _completePendingReconstruction(events){
    const pending=this.pendingReconstruction;
    if(!pending) throw new Error("missing reconstruction completion state");
    const pid=Number(pending.playerId);
    if(pending.takeLifeDamage){
      const damage=this._applyLifeDamageWithTriggers(pid,1,events,"reconstruction");
      events.push({kind:"再構成ダメージ",playerId:pid,damage});
      if(this._setLossIfNeeded(pid,"life-zero-reconstruction")){
        this.pendingReconstruction=null;
        return;
      }
    }
    const observer=pid===1?2:1;
    const publiclyKnownMixed=arr(this.state[`p${pid}_discard`]);
    const reconstructedCount=
      arr(this.state[`p${pid}_deck`]).length+
      arr(this.state[`p${pid}_discard`]).length+
      arr(this.state[`p${pid}_facedown`]).length;
    reconstructNormalDeck(this.state,pid,this.random);
    events.push({kind:"再構成",playerId:pid,deckCount:arr(this.state[`p${pid}_deck`]).length,damage:pending.takeLifeDamage?1:0});
    const industriaRecharged=this._kururuIndustriaRechargeAfterReconstruction(pid,events);
    this.opponentBeliefs?.[observer]?.recordReconstructionDraw(
      publiclyKnownMixed,
      reconstructedCount,
      Math.min(pending.pendingDraws,reconstructedCount),
      `turn-${this.turnNumber}-reconstruction`
    );
    const resumeKind=pending.resumeKind,draws=pending.pendingDraws;
    this.pendingReconstruction=null;
    if(this._beginThallyaA1KinnariAfterReconstruction(pid,resumeKind,draws,industriaRecharged,events)) return;
    if(industriaRecharged && this._kururuDrainDevilCard(pid) && !this.terminalLocked?.[pid]){
      this._beginKururuDrainReuse([{playerId:pid,count:1}],{kind:"reconstruction-complete",resumeKind,draws},events);
      return;
    }
    this._resumeCompletedReconstruction(resumeKind,draws,events);
  }
  _restoreExternalContexts(context){
    const ctx=context||{};
    if(ctx.restoreParentAttack){
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("external card parent attack missing");
    }
    if(ctx.restoreMainParent){
      this.pendingMainCard=this.pendingMainCardStack.pop()||null;
      if(!this.pendingMainCard) throw new Error("external card parent main action missing");
    }
  }
  _resumeExternalCardUse(context,events){
    const ctx=clone(context||{});
    this._restoreExternalContexts(ctx);
    if(ctx.kind==="reconstruction-install"){
      this._advanceReconstructionInstall(events);
      return;
    }
    if(ctx.kind==="ninpo"||ctx.kind==="tobi-main"){
      if(!this.pendingMainCard) throw new Error("nested main action parent missing");
      this._continueMainActionCard(this.pendingMainCard,events);
      return;
    }
    if(ctx.kind==="hagane-respect"){
      if(!this.pendingMainCard) throw new Error("Hagane Respect parent missing");
      this._refreshHaganeRespectChoice(this.pendingMainCard,events);
      return;
    }
    if(ctx.kind==="tobi-response"){
      if(this._applyAttackPostResponseEffects(this.pendingAttack,events,"鳶影で使用したカード","finish-action-response")) return;
      this._finishActionResponseCard(events);
      return;
    }
    throw new Error(`unsupported external card resume: ${ctx.kind}`);
  }
  _finishExternalFacedownAttack(cardUse,slug,context,events){
    const moved=finishResponseCardUse(this.state,cardUse);
    events.push({kind:"カード使用終了",playerId:cardUse?.playerId,cardId:cardUse?.cardId,slug,...moved});
    this._markResponseCardResolvedTraits(cardUse,slug,events);
    this._resumeExternalCardUse(context,events);
  }
  _beginFacedownCardUse(playerId,cardId,events,resumeContext,{asResponse=false}={}){
    const pid=Number(playerId),id=String(cardId),slug=stateCardSlug(this.state,pid,id);
    const entry=this.cardRuleRegistry?.get(slug)||{},rule=entry.mainUse;
    if(!rule || !this._facedownUseLegal(pid,id,{nonFullpower:!!asResponse})) throw new Error("illegal facedown card use");
    const ctx=clone(resumeContext||{});
    if(this.pendingMainCard){
      this.pendingMainCardStack.push(this.pendingMainCard);
      this.pendingMainCard=null;
      ctx.restoreMainParent=true;
    }
    const paid=payResponseCardCost(this.state,pid,rule,id);
    if(paid.amount>0) events.push({kind:"消費",playerId:pid,cardId:id,slug,cost:clone(paid)});
    if(n(rule.burn)>0) this._thallyaBurn(pid,rule.burn,events,slug);
    const cardUse=moveCardToUsingFromZone(this.state,pid,id,"facedown");
    this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
    this._markCardUseTraits(pid,slug,events);
    events.push({kind:"カード使用",playerId:pid,cardId:id,slug,sourceZone:"facedown"});
    if(rule.kind==="attack-card"){
      if(this.pendingAttack){
        this.attackStack.push(this.pendingAttack);
        this.pendingAttack=null;
        ctx.restoreParentAttack=true;
      }
      const attackSpec=this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),
        sourceCardId:id,
        sourceSlug:slug,
        classification:"normal",
        attacker:pid,
        defender:pid===1?2:1,
        usedFromFacedown:true,
        responseForbidden:asResponse?true:!!rule.attack?.responseForbidden
      },pid);
      const started=this._beginGeneratedAttack(attackSpec,events,{kind:"external-facedown-card",cardUse,slug,context:ctx});
      if(!started.pending&&!this.done) this._finishExternalFacedownAttack(cardUse,slug,ctx,events);
      return;
    }
    if(rule.kind==="action-card"){
      this._beginMainActionCard(
        rule,cardUse,slug,events,
        asResponse?{...ctx,forceStandardMode:true}:ctx
      );
      return;
    }
    if(rule.kind==="enhancement-card"){
      this._beginMainEnhancement(rule,cardUse,slug,events,ctx);
      return;
    }
    throw new Error("unsupported facedown card kind");
  }
  _effectBasicActions(playerId){
    const pid=Number(playerId),out=[];
    for(const basicAction of [1,2,3,4,5]){
      if(basicMoveAvailable(this.state,pid,basicAction,this.options)) out.push(basicAction);
    }
    return out;
  }
  _applyEffectBasicAction(playerId,basicAction,events){
    const pid=Number(playerId),type=Number(basicAction);
    if(!this._effectBasicActions(pid).includes(type)) throw new Error("illegal effect basic action");
    const beforeAura=n(this.state?.[`p${pid}_aura`]);
    const masterDistance=effectiveMasterDistance(this.state,this.options);
    if(type===1){
      if(n(this.state.distance)>masterDistance && auraHasRoom(this.state,pid,this.options)){
        this.state.distance=n(this.state.distance)-1;
        this.state[`p${pid}_aura`]=n(this.state[`p${pid}_aura`])+1;
      }
    }else if(type===2){
      if(n(this.state[`p${pid}_aura`])>0 && n(this.state.distance)<this.options.distanceLimit){
        this.state[`p${pid}_aura`]=n(this.state[`p${pid}_aura`])-1;
        this.state.distance=n(this.state.distance)+1;
      }
    }else if(type===3){
      if(n(this.state.dust)>0 && auraHasRoom(this.state,pid,this.options)){
        this.state.dust=n(this.state.dust)-1;
        this.state[`p${pid}_aura`]=n(this.state[`p${pid}_aura`])+1;
      }
    }else if(type===4){
      if(n(this.state[`p${pid}_freeze`])>0) this.state[`p${pid}_freeze`]=n(this.state[`p${pid}_freeze`])-1;
      else if(n(this.state[`p${pid}_aura`])>0){
        this.state[`p${pid}_aura`]=n(this.state[`p${pid}_aura`])-1;
        this.state[`p${pid}_flare`]=n(this.state[`p${pid}_flare`])+1;
      }
    }else if(type===5){
      if(n(this.state.dust)>0 && n(this.state.distance)<=masterDistance && n(this.state.distance)<this.options.distanceLimit){
        this.state.dust=n(this.state.dust)-1;
        this.state.distance=n(this.state.distance)+1;
      }
    }
    this.basicActionsThisTurn[pid]=Math.max(0,n(this.basicActionsThisTurn?.[pid]))+1;
    events.push({kind:"効果による基本動作",playerId:pid,basicAction:type,label:BASIC_ACTION_NAMES[type]});
    this._queueYurinaAunAuraChange(pid,beforeAura,n(this.state?.[`p${pid}_aura`]),events,`基本動作:${BASIC_ACTION_NAMES[type]||type}`);
  }
  _queueNextAttackRange(playerId,near,far,source,events){
    const pid=Number(playerId);
    this.nextAttackModifiers[pid]=arr(this.nextAttackModifiers?.[pid]);
    this.nextAttackModifiers[pid].push({
      kind:"range-expansion",
      rangeNear:Math.max(0,n(near)),
      rangeFar:Math.max(0,n(far)),
      source:String(source||"")
    });
    events.push({kind:"次の攻撃適正距離修正予約",playerId:pid,source:String(source||""),near:Math.max(0,n(near)),far:Math.max(0,n(far))});
  }
  _peekQueuedRangeModifier(playerId){
    const queue=arr(this.nextAttackModifiers?.[Number(playerId)]);
    return queue.find(x=>String(x?.kind||"damage")==="range-expansion")||null;
  }
  _applyQueuedRangeModifierPreview(attack,playerId){
    const mod=this._peekQueuedRangeModifier(playerId);
    if(!mod) return attack;
    return applyRangeExpansion(attack,mod.rangeNear,mod.rangeFar);
  }
  _consumeQueuedRangeModifier(attack,events){
    const pid=Number(attack?.attacker),queue=arr(this.nextAttackModifiers?.[pid]);
    const index=queue.findIndex(x=>String(x?.kind||"damage")==="range-expansion");
    if(index<0) return;
    const [mod]=queue.splice(index,1);
    this.nextAttackModifiers[pid]=queue;
    events.push({
      kind:"次の攻撃適正距離修正",
      playerId:pid,
      source:String(mod.source||""),
      target:attack.label,
      range:clone(attack.range)
    });
  }
  _finishMainActionCardUse(pending,events){
    const resumeContext=clone(pending?.resumeContext||null);
    const thallyaReadySelf=!!pending?.thallyaReadySelf;
    let moved;
    if(resumeContext?.externalSource==="borrowed"){
      this._finishBorrowedUsingCard(pending.cardUse,pending.slug,events);
      moved={moved:true,destination:"borrowed-owner-discard"};
    }else if(resumeContext?.externalSource==="discard"){
      const pid=Number(pending.playerId),id=String(pending.cardId),usingKey=`p${pid}_using`,facedownKey=`p${pid}_facedown`;
      this.state[usingKey]=arr(this.state[usingKey]); this.state[facedownKey]=arr(this.state[facedownKey]);
      const index=this.state[usingKey].findIndex(cardId=>String(cardId)===id);
      if(index>=0){
        const [card]=this.state[usingKey].splice(index,1); this.state[facedownKey].push(card);
        moved={moved:true,destination:"facedown"};
      }else moved={moved:false,destination:"effect-moved"};
    }else if(pending?.kururuRemoveSelf){
      const removed=this._removeUsingCardToOutside(pending.playerId,pending.cardId);
      moved={moved:removed,destination:removed?"outside":"effect-moved"};
      events.push({kind:"取り除く",playerId:pending.playerId,cardId:pending.cardId,source:"神渉装置：枢式",removed});
    }else{
      moved=finishResponseCardUse(this.state,pending.cardUse);
    }
    if(thallyaReadySelf && moved?.destination==="special-used"){
      const specialStatus=this.state?.[`p${pending.playerId}_special_status`]||{};
      specialStatus[String(pending.cardId)]=0;
      moved={...moved,destination:"special-ready"};
      events.push({kind:"未使用に戻す",playerId:pending.playerId,cardId:pending.cardId,slug:pending.slug});
    }
    events.push({kind:"カード使用終了",playerId:pending.playerId,cardId:pending.cardId,slug:pending.slug,...moved});
    this._markResponseCardResolvedTraits(pending.cardUse,pending.slug,events);
    const endPhaseAfterResolution=!!pending?.endPhaseAfterResolution;
    const usedRule=this.cardRuleRegistry?.get(pending.slug)?.mainUse||{};
    this.pendingMainCard=null;
    this._beginKururuPostCardBasics(
      Number(pending.playerId),usedRule,
      {kind:"finished-main-action-card",resumeContext:clone(resumeContext),endPhaseAfterResolution},
      events
    );
  }
  _applyMainActionArrowChoice(pending,choice,events){
    const choiceState=pending?.pendingChoice;
    if(!choiceState || choiceState.kind!=="arrow") throw new Error("missing main action arrow choice");
    const arrow=arr(choiceState.arrows).find(x=>String(x?.kind||"")===String(choice));
    if(!arrow) throw new Error("unknown main action arrow choice");
    const moved=applyArrowAsMuchAsPossible(
      this.state,
      pending.playerId,
      String(arrow.kind||""),
      arrow.count??1,
      this.options
    );
    events.push({
      kind:"行動札矢印",
      playerId:pending.playerId,
      cardId:pending.cardId,
      arrow:String(arrow.kind||""),
      requested:Math.max(0,n(arrow.count??1)),
      moved
    });
    pending.pendingChoice=null;
    pending.choices=[];
  }
  _applyMainActionHandToFacedown(pending,choice,events){
    const choiceState=pending?.pendingChoice;
    if(!choiceState || choiceState.kind!=="hand-to-facedown") throw new Error("missing main action hand-to-facedown choice");
    const pid=Number(pending.playerId),id=String(choice);
    if(isChikagePoisonCard(this.state,pid,id)) throw new Error("poison card cannot be made facedown");
    const handKey=`p${pid}_hand`,facedownKey=`p${pid}_facedown`;
    this.state[handKey]=arr(this.state[handKey]);
    this.state[facedownKey]=arr(this.state[facedownKey]);
    const index=this.state[handKey].findIndex(cardId=>String(cardId)===id);
    if(index<0) throw new Error("main action facedown target is not in hand");
    const [moved]=this.state[handKey].splice(index,1);
    this.state[facedownKey].push(moved);
    events.push({kind:"手札から伏せ札",playerId:pid,cardId:moved,source:pending.slug});
    pending.pendingChoice=null;
    pending.choices=[];
  }
  _applyMainActionDeckBottomChoice(pending,choice,events){
    const choiceState=pending?.pendingChoice;
    if(!choiceState || choiceState.kind!=="cards-to-deck-bottom") throw new Error("missing deck-bottom choice");
    const pid=Number(pending.playerId);
    if(String(choice)==="done"){
      pending.pendingChoice=null;
      pending.choices=[];
      return;
    }
    const id=String(choice);
    const discardKey=`p${pid}_discard`,facedownKey=`p${pid}_facedown`,deckKey=`p${pid}_deck`;
    this.state[discardKey]=arr(this.state[discardKey]);
    this.state[facedownKey]=arr(this.state[facedownKey]);
    this.state[deckKey]=arr(this.state[deckKey]);
    let moved=null,source="";
    for(const [key,label] of [[discardKey,"discard"],[facedownKey,"facedown"]]){
      const index=this.state[key].findIndex(cardId=>String(cardId)===id);
      if(index>=0){
        [moved]=this.state[key].splice(index,1);
        source=label;
        break;
      }
    }
    if(moved==null) throw new Error("deck-bottom target is not in discard/facedown");
    this.state[deckKey].push(moved);
    choiceState.selected=Math.max(0,n(choiceState.selected))+1;
    events.push({kind:"山札の底へ",playerId:pid,cardId:moved,from:source,sourceCardId:pending.cardId});
    const maxCount=Math.max(0,n(choiceState.maxCount));
    const candidates=[
      ...arr(this.state[discardKey]).map(String),
      ...arr(this.state[facedownKey]).map(String)
    ];
    if(choiceState.selected>=maxCount || !candidates.length){
      pending.pendingChoice=null;
      pending.choices=[];
      return;
    }
    pending.choices=["done",...candidates];
  }
  _refreshHaganeRespectChoice(pending,events){
    const choiceState=pending?.pendingChoice;
    if(!choiceState || choiceState.kind!=="hagane-respect") throw new Error("missing Hagane Respect choice");
    if(n(choiceState.remaining)<=0 || this.terminalLocked?.[pending.playerId]){
      pending.pendingChoice=null;
      pending.choices=[];
      this._continueMainActionCard(pending,events);
      return;
    }
    const candidates=arr(this.state?.[`p${pending.playerId}_discard`])
      .filter(cardId=>this._discardUseLegal(pending.playerId,cardId,{nonFullpower:true}))
      .map(cardId=>`card:${cardId}`);
    pending.choices=["done","discard-deck",...candidates];
    this.phase="main-effect-choice";
    events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"大山脈リスペクト",remaining:n(choiceState.remaining),choices:clone(pending.choices)});
  }
  _applyHaganeRespectChoice(pending,choice,events){
    const choiceState=pending?.pendingChoice;
    if(!choiceState || choiceState.kind!=="hagane-respect") throw new Error("missing Hagane Respect choice");
    const value=String(choice);
    if(value==="done"){
      pending.pendingChoice=null;
      pending.choices=[];
      this._continueMainActionCard(pending,events);
      return {nested:false};
    }
    choiceState.remaining=Math.max(0,n(choiceState.remaining)-1);
    if(value==="discard-deck"){
      const pid=Number(pending.playerId),deckKey=`p${pid}_deck`,discardKey=`p${pid}_discard`;
      this.state[deckKey]=arr(this.state[deckKey]); this.state[discardKey]=arr(this.state[discardKey]);
      const moved=this.state[deckKey].splice(0);
      this.state[discardKey].push(...moved);
      events.push({kind:"山札を全て捨て札",playerId:pid,count:moved.length,source:pending.slug});
      this._refreshHaganeRespectChoice(pending,events);
      return {nested:false};
    }
    if(value.startsWith("card:")){
      const cardId=value.slice(5);
      if(!this._discardUseLegal(pending.playerId,cardId,{nonFullpower:true})) throw new Error("illegal Hagane Respect card choice");
      pending.choices=[];
      this._beginDiscardCardUse(pending.playerId,cardId,events,{kind:"hagane-respect"});
      return {nested:true};
    }
    throw new Error("unknown Hagane Respect choice");
  }
  _drawForMainAction(pending,count,events){
    let remaining=Math.max(0,Math.floor(n(count)));
    while(remaining>0){
      const cardId=drawTopCard(this.state,pending.playerId);
      remaining--;
      if(cardId==null){
        this.pendingEffectFatigue={
          playerId:pending.playerId,
          reason:"main-action-draw",
          resumeKind:"main-action-draw",
          cardId:pending.cardId,
          remainingDraws:remaining
        };
        this.phase="effect-fatigue";
        events.push({kind:"焦燥待ち",playerId:pending.playerId,reason:"行動札のドロー"});
        return false;
      }
      events.push({kind:"ドロー",playerId:pending.playerId,cardId,reason:"行動札"});
    }
    return true;
  }
  _continueMainActionCard(pending,events){
    while(pending.effectIndex<pending.effects.length){
      const effect=pending.effects[pending.effectIndex++];
      if(effect?.kind==="kururu-direct-life"){
        if(this._kururuGearReady(pending.playerId,effect.gear)){
          this._kururuDirectLife(pending.playerId,pending.playerId===1?2:1,effect.count??1,events,effect.source||pending.slug);
          if(this.done) return;
        }else events.push({kind:"機巧不成立",playerId:pending.playerId,source:pending.slug,gear:clone(effect.gear||{})});
        continue;
      }
      if(effect?.kind==="kururu-accelerator"){
        if(!this._kururuGearReady(pending.playerId,effect.gear)){
          events.push({kind:"機巧不成立",playerId:pending.playerId,source:pending.slug,gear:clone(effect.gear||{})});
          continue;
        }
        const pid=Number(pending.playerId),candidates=arr(this.state?.[`p${pid}_hand`]).filter(cardId=>{
          const rule=this.cardRuleRegistry?.get(stateCardSlug(this.state,pid,cardId))?.mainUse;
          return !!rule?.fullPower && this._kururuOwnRuleLegal(pid,cardId,"hand",rule,{ignoreCost:false});
        }).map(String);
        if(!candidates.length) continue;
        pending.pendingChoice={kind:"kururu-accelerator-card"};
        pending.choices=["done",...candidates.map(id=>`card:${id}`)];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"あくせらー",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="kururu-tornado"){
        this._kururuTornado(pending.playerId,events);
        if(this.done) return;
        continue;
      }
      if(effect?.kind==="kururu-regainer"){
        if(!this._kururuGearReady(pending.playerId,effect.gear)){
          events.push({kind:"機巧不成立",playerId:pending.playerId,source:pending.slug,gear:clone(effect.gear||{})});
          continue;
        }
        const pid=Number(pending.playerId),candidates=this._kururuRegainerCandidates(pid).filter(row=>
          this._kururuRegainerModChoices(pid,row.id).some(mod=>
            this._kururuOwnRuleLegal(pid,row.id,row.zone,this._kururuModifiedRule(this.cardRuleRegistry?.get(row.slug)?.mainUse,mod),{ignoreCost:true})
          )
        );
        if(!candidates.length) continue;
        pending.pendingChoice={kind:"kururu-regainer-card",candidates:clone(candidates)};
        pending.choices=["done",...candidates.map(row=>`card:${row.zone}:${row.id}`)];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"りげいなー",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="kururu-drain-devil"){
        this._kururuDrain(pending.playerId,events,pending.slug);
        continue;
      }
      if(effect?.kind==="kururu-industria"){
        const pid=Number(pending.playerId),host=String(pending.cardId);
        if(this._kururuIndustriaSealed(pid,host).length){
          this._kururuAddDuplicate(pid,host,events);
          continue;
        }
        const candidates=this._kururuIndustriaSealCandidates(pid);
        if(!candidates.length){
          this._kururuAddDuplicate(pid,host,events);
          continue;
        }
        pending.pendingChoice={kind:"kururu-industria-seal",candidates:clone(candidates)};
        pending.choices=["done",...candidates.map(row=>`seal:${row.zone}:${row.cardId}`)];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:host,choice:"いんだすとりあ・封印",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="kururu-kansu"){
        const pid=Number(pending.playerId);
        pending.kururuRemoveSelf=true;
        if(this._kururuGearReady(pid,{attack:2,action:3,enhancement:2})){
          const opponent=pid===1?2:1;
          this.state[`p${pid}_kururu_known_opponent_specials`]=arr(this.state?.[`p${opponent}_special`]).map(String);
          events.push({kind:"切札確認",playerId:pid,targetPlayer:opponent,count:this.state[`p${pid}_kururu_known_opponent_specials`].length,source:"神渉装置：枢式"});
          const unused=this._kururuKansuUnusedOpponentSpecials(pid);
          if(unused.length){
            pending.pendingChoice={kind:"kururu-kansu-mark-used"};
            pending.choices=["skip",...unused.map(id=>`card:${id}`)];
            this.phase="main-effect-choice";
            events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"枢式・使用済みにする",choices:clone(pending.choices)});
            return;
          }
        }
        const opponent=pid===1?2:1,used=this._kururuKansuUsedOpponentSpecials(pid).filter(id=>this._kururuBorrowedSpecialLegal(pid,opponent,id));
        if(used.length){
          pending.pendingChoice={kind:"kururu-kansu-use-special"};
          pending.choices=["skip",...used.map(id=>`card:${id}`)];
          this.phase="main-effect-choice";
          events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"枢式・切札使用",choices:clone(pending.choices)});
          return;
        }
        continue;
      }
      if(effect?.kind==="yukihi-toggle-matoi"){
        this._toggleYukihiUmbrella(pending.playerId,events,String(effect.source||pending.slug),{kind:"main-action",cardId:pending.cardId,matoiPlayerId:pending.playerId,matoiSource:String(effect.source||pending.slug)});
        return;
      }
      if(effect?.kind==="yukihi-step"){
        const owner=this._yukihiCardOwner(pending.cardUse,pending.playerId);
        if(!this._hasYukihi(owner)) continue;
        const arrow=this._yukihiUmbrellaOpen(owner)?"distance-to-dust":"dust-to-distance";
        const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,arrow,1,this.options);
        events.push({kind:"行動札矢印",playerId:pending.playerId,cardId:pending.cardId,source:pending.slug,arrow,requested:1,moved});
        continue;
      }
      if(effect?.kind==="arrow-if-distance-at-least"){
        if(n(this.state.distance)>=n(effect.value)){
          const arrow=effect.arrow||{};
          const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,String(arrow.kind||""),arrow.count??1,this.options);
          events.push({kind:"行動札矢印",playerId:pending.playerId,cardId:pending.cardId,condition:"distance-at-least",value:n(effect.value),arrow:String(arrow.kind||""),requested:Math.max(0,n(arrow.count??1)),moved});
        }
        continue;
      }
      if(effect?.kind==="raira-wisdom"){
        const total=this._rairaGaugeTotal(pending.playerId),candidates=total>=4?this._rairaWisdomCandidates(pending.playerId):[];
        if(candidates.length){
          pending.pendingChoice={kind:"raira-wisdom-topdeck"};
          pending.choices=["done",...candidates];
          this.phase="main-effect-choice";
          events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"風雷の知恵",choices:clone(pending.choices)});
          return;
        }
        if(total>=12){
          this._beginReconstructionSequence(pending.playerId,events,{takeLifeDamage:false,pendingDraws:1,resumeKind:"raira-wisdom"});
          return;
        }
        continue;
      }
      if(effect?.kind==="raira-call"){
        pending.pendingChoice={kind:"raira-call"};
        pending.choices=["both","thunder-double"];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"呼び声",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="raira-heavenly-array"){
        pending.rairaHeavenlyRemaining=Math.ceil(this._rairaGaugeValue(pending.playerId,"thunder")/2);
        this._beginRairaHeavenlyAttack(pending,events);
        return;
      }
      if(effect?.kind==="raira-summon-extras"){
        const wind=this._rairaGaugeValue(pending.playerId,"wind");
        if(wind>=3) this._rairaGrantExtraSpecial(pending.playerId,"re_12_raira_o_s_3_ex1",events);
        if(wind>=7) this._rairaGrantExtraSpecial(pending.playerId,"re_12_raira_o_s_3_ex2",events);
        if(wind>=12) this._rairaGrantExtraSpecial(pending.playerId,"re_12_raira_o_s_3_ex3",events);
        const removed=this._removeUsingCardToOutside(pending.playerId,pending.cardId);
        events.push({kind:"取り除く",playerId:pending.playerId,cardId:pending.cardId,source:"風魔招来孔",removed});
        continue;
      }
      if(effect?.kind==="raira-wrap-ready-special"){
        const pid=Number(pending.playerId),status=this.state?.[`p${pid}_special_status`]||{};
        const candidates=arr(this.state?.[`p${pid}_special`]).filter(cardId=>Number(status[String(cardId)]||0)===2).map(String);
        if(!candidates.length) continue;
        pending.pendingChoice={kind:"raira-wrap-ready-special"};
        pending.choices=clone(candidates);
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"風魔纏廻",choices:clone(candidates)});
        return;
      }
      if(effect?.kind==="raira-tengu-step"){
        pending.pendingChoice={kind:"raira-tengu-step"};
        pending.choices=this._rairaTenguChoices();
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"風魔天狗道",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="queue-next-attack-range"){
        this._queueNextAttackRange(pending.playerId,effect.near,effect.far,effect.source||pending.slug,events);
        continue;
      }
      if(effect?.kind==="draw"){
        if(!this._drawForMainAction(pending,effect.count??1,events)) return;
        continue;
      }
      if(effect?.kind==="optional-arrow-if-opponent-aura-no-space"){
        const opponent=pending.playerId===1?2:1;
        if(!this._auraHasNoSpace(opponent)) continue;
        const arrow=effect.arrow||{};
        pending.pendingChoice={kind:"optional-arrow",arrow:clone(arrow)};
        pending.choices=["done",String(arrow.kind||"")];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"追加の矢印",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="korunu-absolute-zero"){
        const opponent=pending.playerId===1?2:1;
        this._applyEffectMatoi(pending.playerId,events,"絶対零度");
        if(n(this.state?.[`p${opponent}_freeze`])>=3) this._applyEffectMatoi(pending.playerId,events,"絶対零度");
        if(pending.useMode==="fullpower"){
          const attackSpec={
            label:"絶対零度",classification:null,range:[2,3,4,5],auraDamage:1,lifeDamage:2,
            sourceCardId:pending.cardId,sourceSlug:pending.slug,attacker:pending.playerId
          };
          const started=this._beginGeneratedAttack(attackSpec,events,{kind:"korunu-absolute-zero",cardId:pending.cardId,playerId:pending.playerId});
          if(started.pending||this.done) return;
          this._freezeUntilAuraFull(opponent,events,"絶対零度");
        }
        continue;
      }
      if(effect?.kind==="korunu-retarulera-main"){
        const opponent=pending.playerId===1?2:1;
        if(!this._auraHasNoSpace(opponent)){
          const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,"distance-to-opponent-aura",1,this.options);
          events.push({kind:"行動カード矢印",playerId:pending.playerId,source:"レタルレラ",arrow:"distance-to-opponent-aura",moved});
        }
        continue;
      }
      if(effect?.kind==="shinra-plan"){
        this._beginShinraPlanEffect(pending.playerId,pending.cardId,pending.slug,effect.planEffects,{kind:"main-action",cardId:pending.cardId},events);
        return;
      }
      if(effect?.kind==="shinra-quote"){
        const opponent=pending.playerId===1?2:1;
        const candidates=arr(this.state?.[`p${opponent}_hand`]).filter(cardId=>{
          const status=this.state?.[`p${opponent}_card_status`]?.[String(cardId)]||{};
          const rule=this.cardRuleRegistry?.get(stateCardSlug(this.state,opponent,cardId))?.mainUse;
          return Number(status.MainType)===1 || rule?.kind==="attack-card";
        });
        pending.pendingChoice={kind:"shinra-quote-select",opponent};
        pending.choices=["done",...candidates.map(id=>`card:${id}`)];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"引用",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="seal-opponent-discard-permanently"){
        const opponent=pending.playerId===1?2:1,candidates=arr(this.state?.[`p${opponent}_discard`]);
        if(!candidates.length) continue;
        pending.pendingChoice={kind:"shinra-complete-refute",opponent};
        pending.choices=candidates.map(id=>String(id));
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"完全論破",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="hagane-respect"){
        pending.pendingChoice={kind:"hagane-respect",remaining:Math.max(0,n(effect.maxCount??2))};
        this._refreshHaganeRespectChoice(pending,events);
        return;
      }
      if(effect?.kind==="hagane-recoil"){
        const kind=n(this.state.distance)>=5?"opponent-flare-to-distance":"distance-to-flare";
        const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,kind,1,this.options);
        events.push({kind:"行動札矢印",playerId:pending.playerId,cardId:pending.cardId,arrow:kind,requested:1,moved});
        continue;
      }
      if(effect?.kind==="arrow-if-opponent-flare-at-least"){
        const opponent=pending.playerId===1?2:1;
        if(n(this.state?.[`p${opponent}_flare`])>=n(effect.value)){
          const arrow=effect.arrow||{};
          const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,String(arrow.kind||""),arrow.count??1,this.options);
          events.push({kind:"行動札矢印",playerId:pending.playerId,cardId:pending.cardId,condition:"opponent-flare-at-least",arrow:String(arrow.kind||""),requested:Math.max(0,n(arrow.count??1)),moved});
        }
        continue;
      }
      if(effect?.kind==="choose-hagane-next-attack-buff"){
        pending.pendingChoice={kind:"hagane-next-attack-buff"};
        pending.choices=["damage","response-lock-range"];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"鐘鳴らし",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="megalobell"){
        if(this._allOtherSpecialsUsed(pending.playerId,pending.cardId)){
          const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,"distance-to-life",1,this.options);
          events.push({kind:"行動札矢印",playerId:pending.playerId,cardId:pending.cardId,arrow:"distance-to-life",requested:1,moved});
        }
        const removed=this._removeUsingCardToOutside(pending.playerId,pending.cardId);
        events.push({kind:"取り除く",playerId:pending.playerId,cardId:pending.cardId,removed});
        continue;
      }
      if(effect?.kind==="thallya-quick-change"){
        const pid=Number(pending.playerId),active=this._thallyaA1Forms(pid);
        if(active.length){
          pending.pendingChoice={kind:"thallya-quick-change-remove"};
          pending.choices=clone(active);
          this.phase="main-effect-choice";
          events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"Quick Change・戻すTransForm",choices:clone(active)});
          return;
        }
        pending.pendingChoice={kind:"thallya-quick-change-after"};
        const after=[];
        if(n(this.state?.[`p${pid}_thallya_burned`])>0) after.push("recover");
        if(this._effectBasicActions(pid).length) after.push("basic");
        if(!after.length) continue;
        pending.choices=after;
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"Quick Change",choices:clone(after)});
        return;
      }
      if(effect?.kind==="focus-gain"){
        this._gainFocus(pending.playerId,effect.count??1,events,"行動札");
        continue;
      }
      if(effect?.kind==="set-focus"){
        this.state[`p${pending.playerId}_focus`]=Math.max(0,Math.min(2,n(effect.value)));
        events.push({kind:"集中力",playerId:pending.playerId,value:this.state[`p${pending.playerId}_focus`],reason:"行動札"});
        continue;
      }
      if(effect?.kind==="set-opponent-focus"){
        const opponent=pending.playerId===1?2:1;
        this.state[`p${opponent}_focus`]=Math.max(0,Math.min(2,n(effect.value)));
        events.push({kind:"集中力",playerId:opponent,value:this.state[`p${opponent}_focus`],reason:"相手カード効果"});
        continue;
      }
      if(effect?.kind==="choose-own-discard-or-facedown-to-deck-bottom"){
        const pid=Number(pending.playerId),maxCount=Math.max(0,n(effect.maxCount));
        const candidates=[
          ...arr(this.state?.[`p${pid}_discard`]).map(String),
          ...arr(this.state?.[`p${pid}_facedown`]).map(String)
        ];
        if(maxCount<=0 || !candidates.length) continue;
        pending.pendingChoice={kind:"cards-to-deck-bottom",maxCount,selected:0};
        pending.choices=["done",...candidates];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"山札の底",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="intimidate-opponent"){
        const opponent=pending.playerId===1?2:1;
        this.state[`p${opponent}_intimidated`]=true;
        events.push({kind:"畏縮",playerId:opponent,source:pending.slug});
        continue;
      }
      if(effect?.kind==="hand-to-facedown"){
        const count=Math.max(0,Math.floor(n(effect.count??1)));
        if(count<=0) continue;
        const choices=arr(this.state?.[`p${pending.playerId}_hand`]).filter(cardId=>!isChikagePoisonCard(this.state,pending.playerId,cardId)).map(String);
        if(!choices.length) continue;
        pending.pendingChoice={kind:"hand-to-facedown",remaining:count};
        pending.choices=clone(choices);
        if(choices.length===1){
          this._applyMainActionHandToFacedown(pending,choices[0],events);
          continue;
        }
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"手札から伏せ札",choices:clone(choices)});
        return;
      }
      if(effect?.kind==="use-install-from-facedown-if-source-facedown"){
        if(pending.cardUse?.sourceZone!=="facedown") continue;
        const candidates=this._installCandidates(pending.playerId,"normal");
        if(!candidates.length) continue;
        pending.pendingChoice={kind:"use-install-facedown"};
        pending.choices=["done",...candidates.map(String)];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"設置札",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="use-facedown-non-fullpower"){
        const candidates=arr(this.state?.[`p${pending.playerId}_facedown`]).filter(cardId=>
          this._facedownUseLegal(pending.playerId,cardId,{nonFullpower:true})
        );
        if(!candidates.length) continue;
        pending.pendingChoice={kind:"use-facedown-non-fullpower"};
        pending.choices=["done",...candidates.map(String)];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"伏せ札",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="chikage-main-send-poison"){
        const owner=Number(pending.playerId),target=owner===1?2:1,candidates=this._chikagePoisonBagCards(owner,effect.allowed);
        if(!candidates.length) continue;
        if(candidates.length===1){this._chikageTransferPoison(owner,target,candidates[0],effect.destination,events,pending.slug);continue;}
        pending.pendingChoice={kind:"chikage-poison",targetPlayer:target,destination:String(effect.destination||"hand")};
        pending.choices=clone(candidates); this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:owner,cardId:pending.cardId,choice:"毒",choices:clone(candidates)}); return;
      }
      if(effect?.kind==="chikage-flare-to-dust"){
        const pid=Number(pending.playerId),moved=Math.min(Math.max(0,n(effect.count??1)),Math.max(0,n(this.state?.[`p${pid}_flare`])));
        this.state[`p${pid}_flare`]=n(this.state[`p${pid}_flare`])-moved; this.state.dust=n(this.state.dust)+moved;
        events.push({kind:"毒効果",playerId:pid,source:pending.slug,effect:"フレアからダスト",moved}); continue;
      }
      if(effect?.kind==="thallya-ride-main"){
        this._requestThallyaRide(
          pending.playerId,events,
          {kind:"main-action",cardId:pending.cardId,sourceCardId:pending.cardId},
          {optional:false,source:pending.slug}
        );
        return;
      }
      if(effect?.kind==="thallya-recover-all"){
        this._thallyaRecover(pending.playerId,n(this.state?.[`p${pending.playerId}_thallya_burned`]),events,pending.slug);
        continue;
      }
      if(effect?.kind==="thallya-roaring"){
        const canBurn=this._thallyaCanBurn(pending.playerId,2);
        if(!canBurn && n(this.state?.[`p${pending.playerId}_focus`])<2) continue;
        pending.pendingChoice={kind:"thallya-roaring-burn"};
        pending.choices=canBurn?["skip","burn"]:["skip"];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"Roaring・燃焼",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="thallya-blackbox-neo"){
        const pid=Number(pending.playerId),status=this.state?.[`p${pid}_card_status`]?.[String(pending.cardId)];
        this._thallyaRecover(pid,1,events,"BlackBox NEO");
        if(status && n(this.state?.[`p${pid}_thallya_burned`])<=0 && n(this.state.dust)>0){
          this.state.dust=n(this.state.dust)-1;
          status.Charge=Math.max(0,n(status.Charge))+1;
          events.push({kind:"BlackBox NEO",playerId:pid,effect:"dust-to-card",charge:n(status.Charge)});
        }
        if(status && n(status.Charge)>=2){
          status.Charge=n(status.Charge)-2;
          this.state.dust=n(this.state.dust)+2;
          pending.effects.splice(pending.effectIndex,0,{kind:"thallya-blackbox-neo-after-transform"});
          if(this._beginThallyaA1TransformChoice(pid,pending,events,"BlackBox NEO")) return;
        }
        continue;
      }
      if(effect?.kind==="thallya-blackbox-neo-after-transform"){
        continue;
      }
      if(effect?.kind==="thallya-blackbox"){
        const pid=Number(pending.playerId);
        if(n(this.state?.[`p${pid}_thallya_machine`])>0){
          pending.thallyaReadySelf=true;
          events.push({kind:"BlackBox不成立",playerId:pid,cardId:pending.cardId});
          continue;
        }
        if(this._hasThallyaA1(pid)){
          pending.effects.splice(pending.effectIndex,0,{kind:"thallya-blackbox-recover"});
          if(this._beginThallyaA1TransformChoice(pid,pending,events,"Julia's BlackBox")) return;
          continue;
        }
        pending.pendingChoice={kind:"thallya-transform"};
        pending.choices=["YAKSHA","NAGA","GARUDA"];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"TransForm",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="thallya-blackbox-recover"){
        this._thallyaRecover(pending.playerId,2,events,"Julia's BlackBox");
        continue;
      }
      if(effect?.kind==="arrow-if-card-use-count-at-least"){
        const count=Math.max(0,n(this.cardUseCountsThisTurn?.[pending.playerId]));
        if(count>=n(effect.value)){
          const arrow=effect.arrow||{};
          const moved=applyArrowAsMuchAsPossible(
            this.state,
            pending.playerId,
            String(arrow.kind||""),
            arrow.count??1,
            this.options
          );
          events.push({
            kind:"行動札矢印",
            playerId:pending.playerId,
            cardId:pending.cardId,
            condition:String(effect.label||effect.kind),
            arrow:String(arrow.kind||""),
            requested:Math.max(0,n(arrow.count??1)),
            moved
          });
        }
        continue;
      }
      if(effect?.kind==="queue-next-other-megami-attack-if-card-use-count-at-least"){
        const count=Math.max(0,n(this.cardUseCountsThisTurn?.[pending.playerId]));
        if(count>=n(effect.value)){
          this.nextOtherMegamiAttackModifiers[pending.playerId]=arr(this.nextOtherMegamiAttackModifiers?.[pending.playerId]);
          this.nextOtherMegamiAttackModifiers[pending.playerId].push({
            excludedMegami:String(effect.excludedMegami||""),
            auraDelta:n(effect.auraDelta),
            lifeDelta:n(effect.lifeDelta),
            source:String(effect.source||pending.slug)
          });
        }
        continue;
      }
      if(effect?.kind==="basic-actions-if-life-lower"){
        if(n(this.state[`p${pending.playerId}_life`])<n(this.state[`p${pending.playerId===1?2:1}_life`])){
          pending.remainingBasicActions=Math.max(0,Math.floor(n(effect.count)));
          if(pending.remainingBasicActions>0){
            this.phase="main-effect-basic";
            events.push({kind:"基本動作選択待ち",playerId:pending.playerId,remaining:pending.remainingBasicActions});
            return;
          }
        }
        continue;
      }
      if(effect?.kind==="choose-arrows"){
        const arrowVariants=this._mainActionArrowVariants(pending,effect);
        const choices=arr(arrowVariants).map(x=>String(x?.kind||"")).filter(Boolean);
        if(!choices.length) continue;
        pending.pendingChoice={kind:"arrow",arrows:clone(arrowVariants)};
        pending.choices=clone(choices);
        if(choices.length===1){
          this._applyMainActionArrowChoice(pending,choices[0],events);
          continue;
        }
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"行動札矢印",choices:clone(choices)});
        return;
      }
      if(effect?.kind==="generated-attack"){
        const attackSpec={
          ...(effect.attack||{}),
          sourceCardId:pending.cardId,
          sourceSlug:pending.slug,
          classification:null,
          attacker:pending.playerId
        };
        const started=this._beginGeneratedAttack(attackSpec,events,{
          kind:"main-action-card",
          cardId:pending.cardId,
          slug:pending.slug
        });
        if(started.pending||this.done) return;
        continue;
      }
      if(effect?.kind==="arrow"){
        const arrow=effect.arrow||{};
        const moved=applyArrowAsMuchAsPossible(
          this.state,
          pending.playerId,
          String(arrow.kind||""),
          arrow.count??1,
          this.options
        );
        events.push({
          kind:"行動札矢印",
          playerId:pending.playerId,
          cardId:pending.cardId,
          arrow:String(arrow.kind||""),
          requested:Math.max(0,n(arrow.count??1)),
          moved
        });
        continue;
      }
      throw new Error(`unsupported main action effect: ${effect?.kind}`);
    }
    this._finishMainActionCardUse(pending,events);
  }
  _beginMainActionCard(rule,cardUse,slug,events,resumeContext=null){
    this.pendingMainCard={
      kind:"action-card",
      playerId:Number(cardUse.playerId),
      cardId:cardUse.cardId,
      slug,
      cardUse:clone(cardUse),
      effects:clone(rule.effects||[]),
      effectIndex:0,
      remainingBasicActions:0,
      pendingChoice:null,
      choices:[],
      resumeContext:resumeContext?clone(resumeContext):null,
      useMode:resumeContext?.forceStandardMode?"standard":this.mainMode
    };
    this._continueMainActionCard(this.pendingMainCard,events);
  }

  _mainUseRuleForCard(playerId,cardId){
    const slug=stateCardSlug(this.state,playerId,cardId);
    const rule=this.cardRuleRegistry?.get(slug)?.mainUse||null;
    return {slug,rule};
  }
  _mainCardUseLegal(playerId,cardId,mainRule){
    const pid=Number(playerId);
    if(!mainRule||this.terminalLocked?.[pid]||!this.mainMode) return false;
    if(this.mainMode==="standard" && mainRule.fullPower) return false;
    if(this.mainMode==="fullpower" && this.fullPowerCardUsed) return false;
    if(this.mainMode==="fullpower" && !mainRule.fullPower && !mainRule.fullPowerize) return false;
    const condition=mainRule.useCondition;
    if(condition?.kind==="self-life-at-most" && n(this.state?.[`p${pid}_life`])>n(condition.value)) return false;
    if(condition?.kind==="centrifugal" && !this._centrifugalLegal(pid)) return false;
    if(condition?.kind==="no-basic-actions-this-turn" && n(this.basicActionsThisTurn?.[pid])>0) return false;
    if(condition && !["self-life-at-most","centrifugal","no-basic-actions-this-turn"].includes(String(condition.kind||""))) return false;
    const slug=stateCardSlug(this.state,pid,cardId),entry=this.cardRuleRegistry?.get(slug)||{};
    let sourceZone=cardSourceZoneForResponse(this.state,pid,cardId);
    if(!sourceZone && entry.allowMainFromFacedown && arr(this.state?.[`p${pid}_facedown`]).some(x=>String(x)===String(cardId))) sourceZone="facedown";
    if(!sourceZone) return false;
    if(sourceZone==="special" && Number(this.state?.[`p${pid}_special_status`]?.[String(cardId)]||0)===2) return false;
    if(!canPayResponseCardCost(this.state,pid,mainRule,cardId)) return false;
    if(n(mainRule.burn)>0&&!this._thallyaCanBurn(pid,mainRule.burn)) return false;
    if(mainRule.kind==="attack-card"){
      if(this._chikageRelaxationActive(pid)) return false;
      const attack=normalizeAttackSpec(this._resolveYukihiAttackSpec({
        ...(mainRule.attack||{}),
        sourceCardId:cardId,
        sourceSlug:stateCardSlug(this.state,pid,cardId),
        classification:sourceZone==="special"?"special":"normal",
        attacker:pid,
        defender:pid===1?2:1
      },pid));
      this._applyQueuedRangeModifierPreview(attack,pid);
      this._yukihiDororiuraRangePreview(attack,pid);
      return attackInRange(this.state,attack);
    }
    if(mainRule.kind==="enhancement-card"||mainRule.kind==="action-card") return true;
    return false;
  }
  _registeredMainCardActions(playerId){
    const pid=Number(playerId),out=[];
    const specialStatus=this.state?.[`p${pid}_special_status`]||{};
    const facedownSpecial=arr(this.state?.[`p${pid}_facedown`]).filter(cardId=>
      !!this.cardRuleRegistry?.get(stateCardSlug(this.state,pid,cardId))?.allowMainFromFacedown
    );
    const candidates=[
      ...arr(this.state?.[`p${pid}_hand`]),
      ...arr(this.state?.[`p${pid}_special`]).filter(cardId=>Number(specialStatus[String(cardId)]||0)!==2),
      ...facedownSpecial
    ];
    for(const cardId of candidates){
      const {slug,rule}=this._mainUseRuleForCard(pid,cardId);
      if(!this._mainCardUseLegal(pid,cardId,rule)) continue;
      const cardName=this.cardRuleRegistry?.get(slug)?.name||slug||String(cardId);
      const lowValueApCeiling=baselineResourceOnlyMainActionApCeiling(this.state,pid,rule,this.options);
      const recoverHint=
        slug==="re_11_thallya_a1_n_5" ? 1 :
        (slug==="re_11_thallya_o_n_6" ? 3 :
        (slug==="re_11_thallya_o_n_4" && this.mainMode!=="fullpower" ? 2 : 0));
      const base={
        actor:pid,
        kind:"カード使用",
        label:cardName+(this.mainMode==="fullpower"?"(全力)":""),
        rule:TURN_USE_CARD,
        cardId,
        ...(n(rule?.burn)>0?{baselineThallyaBurn:n(rule.burn)}:{}),
        ...(recoverHint>0?{baselineThallyaRecover:recoverHint}:{}),
        ...(Number.isFinite(lowValueApCeiling)?{baselineResourceOnlyApCeiling:lowValueApCeiling}:{})
      };
      if(stateHasRaira(this.state,pid) && attackSourceMegamiFromSlug(slug)!=="raira"){
        out.push({...base,rairaGauge:"wind"},{...base,rairaGauge:"thunder"});
      }else out.push(base);
    }
    return out;
  }
  _fullPowerMainCardAvailable(playerId){
    const pid=Number(playerId),previousMode=this.mainMode;
    try{
      this.mainMode="fullpower";
      return this._registeredMainCardActions(pid).some(action=>{
        const slug=normalizeCardSlug(stateCardSlug(this.state,pid,action?.cardId));
        // 気炎万丈 only buffs another Megami's attack while Yurina life <=3.
        // At high life, spending the fullpower action to place it is usually
        // negative tempo; do not advertise it as a worthwhile opening.
        if(slug==="re_01_yurina_o_n_7" && n(this.state["p"+pid+"_life"])>3) return false;
        // 要返し is a fullpower action. With no discard/facedown cards,
        // its only possible effect is dust->aura (at most 2AP), less than
        // the ~3AP standard-action opportunity cost.
        if(slug==="re_04_tokoyo_o_n_5" &&
           !arr(this.state["p"+pid+"_discard"]).length &&
           !arr(this.state["p"+pid+"_facedown"]).length &&
           !arr(this.state["p"+pid+"_chara_ids"]).some(id=>[10,12].includes(Number(id)))) return false;
        return !(
          Number.isFinite(Number(action?.baselineResourceOnlyApCeiling)) &&
          Number(action.baselineResourceOnlyApCeiling)<=1
        );
      });
    }finally{
      this.mainMode=previousMode;
    }
  }
  _finishMainAction(events){
    if(this.mainMode==="fullpower"){
      this.fullPowerCardUsed=true;
      events.push({kind:"全力行動終了",playerId:this.turnPlayer});
      this._endTurn(events);
      return;
    }
    this.phase="main";
  }
  _finishMainCardUse(cardUse,slug,events){
    const moved=finishResponseCardUse(this.state,cardUse);
    events.push({kind:"カード使用終了",playerId:cardUse?.playerId,cardId:cardUse?.cardId,slug,...moved});
    this._markResponseCardResolvedTraits(cardUse,slug,events);
    const rule=this.cardRuleRegistry?.get(slug)?.mainUse||{};
    this._beginKururuPostCardBasics(Number(cardUse?.playerId),rule,{kind:"finish-main-action"},events);
  }
  _finishMainEnhancementUse(playerId,cardId,slug,events){
    const resumeContext=clone(this.pendingMainCard?.resumeContext||null);
    events.push({kind:"カード使用終了",playerId:Number(playerId),cardId,slug,destination:"enhancement"});
    this._markResponseCardResolvedTraits({playerId:Number(playerId),cardId},slug,events);
    const usedRule=this.cardRuleRegistry?.get(slug)?.mainUse||{};
    this.pendingMainCard=null;
    this._beginKururuPostCardBasics(
      Number(playerId),usedRule,
      {kind:"finished-main-enhancement",resumeContext:clone(resumeContext)},
      events
    );
  }
  _finishImmediateMainEnhancementDiscard(pending,events){
    const resumeContext=clone(pending?.resumeContext||null);
    const moved=finishEnhancementDiscard(this.state,pending.playerId,pending.cardId);
    events.push({kind:"付与札の破棄完了",playerId:pending.playerId,cards:[{cardId:pending.cardId,...moved}]});
    this._onEnhancementDiscarded(pending.playerId,pending.cardId,events);
    if(this.done) return;
    this._markResponseCardResolvedTraits({playerId:pending.playerId,cardId:pending.cardId},pending.slug,events);
    this.pendingMainCard=null;
    if(resumeContext){
      if(resumeContext.externalSource==="borrowed") this._resumeBorrowedCard(resumeContext,events);
      else if(resumeContext.externalSource==="kururu-own") this._resumeKururuOwnCard(resumeContext,events);
      else if(resumeContext.kind==="shinra-plan-own-special") this._resumeOwnSpecialPlanUse(resumeContext,events);
      else this._resumeExternalCardUse(resumeContext,events);
      return;
    }
    this._finishMainAction(events);
  }
  _resolveImmediateMainEnhancementDiscard(pending,events){
    const entry=this.cardRuleRegistry?.get(pending.slug)||{};
    const effect=entry.enhancementDiscard;
    if(!effect){
      this.done=true;
      this.doneReason="unsupported-enhancement-discard-effect";
      events.push({kind:"未対応",reason:"メインフェイズ付与の即時破棄",cardId:pending.cardId,slug:pending.slug});
      return;
    }
    if(effect.kind==="none"){
      this._finishImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    if(effect.kind==="shinra-plan"){
      this._beginShinraPlanEffect(pending.playerId,pending.cardId,pending.slug,effect.planEffects,{kind:"main-enhancement-discard-shinra",cardId:pending.cardId},events);
      return;
    }
    if(effect.kind==="return-sealed-to-owner-discard"){
      this._returnSealedCards(pending.playerId,pending.cardId,events);
      if(!this.done) this._finishImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    if(effect.kind==="chikage-living-way-win"){
      if(this._chikageLivingWayCanWin(pending.playerId,pending.cardId)){this.done=true;this.doneReason="chikage-living-way";this.winner=Number(pending.playerId);events.push({kind:"勝利",playerId:pending.playerId,reason:"闇昏千影の生きる道"});return;}
      this._finishImmediateMainEnhancementDiscard(pending,events); return;
    }
    if(effect.kind==="lose-game"){
      this.done=true;
      this.doneReason="shinra-adjudication-expired";
      this.winner=Number(pending.playerId)===1?2:1;
      events.push({kind:"敗北",playerId:pending.playerId,reason:"森羅判証の破棄時"});
      return;
    }
    if(effect.kind==="generated-attack"){
      const attackSpec={
        ...(effect.attack||{}),
        sourceCardId:pending.cardId,
        sourceSlug:pending.slug,
        classification:null,
        attacker:pending.playerId
      };
      const started=this._beginGeneratedAttack(attackSpec,events,{
        kind:"main-enhancement-discard",
        playerId:pending.playerId,
        cardId:pending.cardId,
        slug:pending.slug
      });
      if(!started.pending&&!this.done) this._finishImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    if(effect.kind==="generated-attack-then-arrow"){
      const attackSpec={
        ...(effect.attack||{}),
        sourceCardId:pending.cardId,
        sourceSlug:pending.slug,
        classification:null,
        attacker:pending.playerId
      };
      const started=this._beginGeneratedAttack(attackSpec,events,{
        kind:"main-enhancement-discard-then-arrow",
        playerId:pending.playerId,
        cardId:pending.cardId,
        slug:pending.slug,
        arrow:clone(effect.arrow||null)
      });
      if(!started.pending&&!this.done){
        if(effect.arrow){
          const moved=applyDistanceDustArrow(this.state,String(effect.arrow.kind),effect.arrow.count??1,this.options);
          events.push({kind:"破棄時矢印",playerId:pending.playerId,cardId:pending.cardId,arrow:effect.arrow.kind,moved});
        }
        this._finishImmediateMainEnhancementDiscard(pending,events);
      }
      return;
    }
    if(effect.kind==="yukihi-enmusubi-discard"){
      const pid=Number(pending.playerId),id=String(pending.cardId);
      const arrow=this._hasYukihi(pid)&&this._yukihiUmbrellaOpen(pid)?"distance-to-dust":"dust-to-distance";
      const moved=applyArrowAsMuchAsPossible(this.state,pid,arrow,1,this.options);
      events.push({kind:"破棄時矢印",playerId:pid,cardId:id,source:"えんむすび",arrow,moved});
      this._finishImmediateMainEnhancementDiscard(pending,events); return;
    }
    if(effect.kind==="arrow"){
      const arrow=effect.arrow||{};
      const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,String(arrow.kind||""),arrow.count??1,this.options);
      events.push({kind:"破棄時矢印",playerId:pending.playerId,cardId:pending.cardId,arrow:String(arrow.kind||""),moved});
      this._finishImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    if(effect.kind==="ready-one-used-special"){
      const candidates=usedSpecialCandidates(this.state,pending.playerId);
      if(!candidates.length){
        events.push({kind:"破棄時効果",playerId:pending.playerId,cardId:pending.cardId,slug:pending.slug,effect:"使用済切札なし"});
        this._finishImmediateMainEnhancementDiscard(pending,events);
        return;
      }
      if(candidates.length===1){
        readySpecialCard(this.state,pending.playerId,candidates[0]);
        events.push({kind:"破棄時効果",playerId:pending.playerId,cardId:pending.cardId,slug:pending.slug,effect:"切札を未使用に戻す",targetCardId:candidates[0]});
        this._finishImmediateMainEnhancementDiscard(pending,events);
        return;
      }
      this.pendingCardDecision={
        kind:"ready-used-special-immediate",
        playerId:pending.playerId,
        label:"切札を未使用に戻す",
        sourceCardId:pending.cardId,
        slug:pending.slug,
        candidates:clone(candidates)
      };
      this.phase="start-card-choice";
      events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,slug:pending.slug,choice:"使用済切札",candidates:clone(candidates)});
      return;
    }
    this.done=true;
    this.doneReason="unsupported-enhancement-discard-effect";
    events.push({kind:"未対応",reason:"メインフェイズ付与の即時破棄効果",cardId:pending.cardId,slug:pending.slug,effect:clone(effect)});
  }
  _completeMainEnhancementPlacement(pending,events){
    if(!pending) throw new Error("missing main enhancement completion");
    const placed=Math.max(0,n(pending.deployedPlaced));
    if(placed===0){
      this._resolveImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    this._finishMainEnhancementUse(pending.playerId,pending.cardId,pending.slug,events);
  }
  _applyMainEnhancementDiscardChoice(pending,choice,events){
    if(!pending?.deployChoice) throw new Error("missing enhancement deploy effect choice");
    if(pending.deployChoice.kind==="korunu-porucharto-arrow"){
      const arrow=String(choice);
      if(!["distance-to-dust","dust-to-distance"].includes(arrow)) throw new Error("invalid Porucharto arrow");
      const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,arrow,1,this.options);
      events.push({kind:"付与展開時矢印",playerId:pending.playerId,cardId:pending.cardId,arrow,moved});
      this._freezePlayer(pending.playerId===1?2:1,1,events,pending.slug);
      pending.deployChoice=null; pending.choices=[];
      this._completeMainEnhancementPlacement(pending,events);
      return;
    }
    if(pending.deployChoice.kind==="shinra-seal-opponent-discard"){
      const opponent=Number(pending.deployChoice.opponent),target=String(choice);
      this._sealCardUnder(pending.playerId,pending.cardId,opponent,target,events);
      pending.deployChoice=null; pending.choices=[];
      this._completeMainEnhancementPlacement(pending,events);
      return;
    }
    if(pending.deployChoice.kind!=="discard-to-facedown") throw new Error("unsupported enhancement deploy effect choice");
    if(String(choice)==="done"){
      pending.deployChoice=null;
      pending.choices=[];
      this._completeMainEnhancementPlacement(pending,events);
      return;
    }
    const pid=Number(pending.playerId),id=String(choice),discardKey=`p${pid}_discard`,facedownKey=`p${pid}_facedown`;
    this.state[discardKey]=arr(this.state[discardKey]);
    this.state[facedownKey]=arr(this.state[facedownKey]);
    const index=this.state[discardKey].findIndex(cardId=>String(cardId)===id);
    if(index<0) throw new Error("Uro deploy target left discard");
    const [moved]=this.state[discardKey].splice(index,1);
    this.state[facedownKey].push(moved);
    events.push({kind:"捨て札から伏せ札",playerId:pid,cardId:moved,sourceCardId:pending.cardId});
    const candidates=arr(this.state[discardKey]).map(String);
    if(!candidates.length){
      pending.deployChoice=null;
      pending.choices=[];
      this._completeMainEnhancementPlacement(pending,events);
      return;
    }
    pending.choices=["done",...candidates];
    this.phase="main-enhancement-effect-choice";
  }
  _applyMainEnhancementPlacement(choice,events){
    const pending=this.pendingMainCard;
    if(!pending||pending.kind!=="enhancement-placement") throw new Error("missing main enhancement placement");
    const placement=parseEnhancementPlacementKey(choice);
    if(!placement) throw new Error("invalid main enhancement placement choice");
    const legal=enhancementPlacementOptions(this.state,pending.playerId,pending.charge,pending.growth)
      .some(x=>enhancementPlacementKey(x)===String(choice));
    if(!legal) throw new Error("illegal main enhancement placement choice");
    const deployed=deployResponseEnhancement(this.state,pending.cardUse,placement);
    pending.deployedPlaced=deployed.placed;
    events.push({kind:"付与展開",playerId:pending.playerId,cardId:pending.cardId,...deployed});
    for(const effect of arr(pending.rule?.deployEffects)){
      if(effect?.kind==="megumi-basic-action"){
        this.pendingKururuBasic={playerId:Number(pending.playerId),sources:["野茨"],resume:{kind:"megumi-wild-deploy",cardId:String(pending.cardId)}};
        this._advanceKururuBasic(events);
        return;
      }
      if(effect?.kind==="kururu-reflector-charge"){
        if(this._kururuGearReady(pending.playerId,effect.gear)){
          const status=this.state?.[`p${pending.playerId}_card_status`]?.[String(pending.cardId)]||{};
          const moved=Math.min(Math.max(0,n(effect.count??4)),Math.max(0,n(this.state.dust)));
          this.state.dust=n(this.state.dust)-moved;
          status.Charge=Math.max(0,n(status.Charge))+moved;
          const charges=positiveTokenChargeMap(status)||{};charges["1"]=Math.max(0,n(charges["1"]))+moved;status.TokenCharges=charges;
          pending.deployedPlaced=Math.max(0,n(pending.deployedPlaced))+moved;
          events.push({kind:"機巧",playerId:pending.playerId,cardId:pending.cardId,source:"りふれくた",movedFromDust:moved});
        }
        continue;
      }
      if(effect?.kind==="yukihi-enmusubi-deploy"){
        const controller=Number(pending.playerId);
        const arrow=this._hasYukihi(controller)&&this._yukihiUmbrellaOpen(controller)?"dust-to-distance":"distance-to-dust";
        const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,arrow,1,this.options);
        events.push({kind:"付与展開時矢印",playerId:pending.playerId,cardId:pending.cardId,source:"えんむすび",arrow,moved});
        continue;
      }
      if(effect?.kind==="freeze-opponent"){
        const opponent=pending.playerId===1?2:1;
        this._freezePlayer(opponent,effect.count??1,events,pending.slug);
        continue;
      }
      if(effect?.kind==="korunu-porucharto"){
        pending.deployChoice={kind:"korunu-porucharto-arrow"};
        pending.choices=["distance-to-dust","dust-to-distance"];
        this.phase="main-enhancement-effect-choice";
        events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"間合⇔ダスト",choices:clone(pending.choices)});
        return;
      }
      if(effect?.kind==="arrow"){
        const arrow=effect.arrow||{};
        const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,String(arrow.kind||""),arrow.count??1,this.options);
        events.push({kind:"付与展開時矢印",playerId:pending.playerId,cardId:pending.cardId,arrow:String(arrow.kind||""),moved});
        continue;
      }
      if(effect?.kind==="set-focus"){
        this.state[`p${pending.playerId}_focus`]=Math.max(0,Math.min(2,n(effect.value)));
        events.push({kind:"集中力",playerId:pending.playerId,value:this.state[`p${pending.playerId}_focus`],reason:"付与展開時"});
        continue;
      }
      if(effect?.kind==="opponent-top-deck-to-discard"){
        this._moveOpponentTopDeckToDiscard(pending.playerId,effect.count??1,events,pending.slug);
        continue;
      }
      if(effect?.kind==="seal-opponent-discard-under-self"){
        const opponent=pending.playerId===1?2:1,candidates=arr(this.state?.[`p${opponent}_discard`]).map(String);
        if(candidates.length===1){
          this._sealCardUnder(pending.playerId,pending.cardId,opponent,candidates[0],events);
          continue;
        }
        if(candidates.length>1){
          pending.deployChoice={kind:"shinra-seal-opponent-discard",opponent};
          pending.choices=clone(candidates);
          this.phase="main-enhancement-effect-choice";
          events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"論破",choices:clone(candidates)});
          return;
        }
        continue;
      }
      if(effect?.kind==="move-any-discard-to-facedown"){
        const candidates=arr(this.state?.[`p${pending.playerId}_discard`]).map(String);
        if(candidates.length){
          pending.deployChoice={kind:"discard-to-facedown"};
          pending.choices=["done",...candidates];
          this.phase="main-enhancement-effect-choice";
          events.push({kind:"選択待ち",playerId:pending.playerId,cardId:pending.cardId,choice:"捨て札から伏せ札",choices:clone(pending.choices)});
          return;
        }
        continue;
      }
      throw new Error(`unsupported main enhancement deploy effect: ${effect?.kind}`);
    }
    this._completeMainEnhancementPlacement(pending,events);
  }
  _beginMainEnhancement(rule,cardUse,slug,events,resumeContext=null){
    const pid=Number(cardUse.playerId);
    if(stateHasMegumi(this.state,pid)){
      const germinated=germinateMegumiSeeds(this.state,pid,1);
      if(germinated>0) events.push({kind:"種結晶萌芽",playerId:pid,count:germinated,source:slug});
    }
    const otherMegami=attackSourceMegamiFromSlug(slug)!=="megumi";
    const bonus=otherMegami?Math.max(0,n(this.nextOtherMegamiGrowthBonus?.[pid])):0;
    if(bonus>0) this.nextOtherMegamiGrowthBonus[pid]=0;
    const growth=Math.max(0,n(rule.growth))+bonus;
    const options=enhancementPlacementOptions(this.state,pid,rule.charge,growth);
    this.pendingMainCard={
      kind:"enhancement-placement",
      playerId:pid,
      cardId:cardUse.cardId,
      slug,
      cardUse:clone(cardUse),
      rule:{...clone(rule),growth},
      charge:Math.max(0,n(rule.charge)),
      growth,
      choices:options.map(enhancementPlacementKey),
      resumeContext:resumeContext?clone(resumeContext):null,
      deployEffectIndex:0,
      deployChoice:null
    };
    if(options.length===1){
      this._applyMainEnhancementPlacement(enhancementPlacementKey(options[0]),events);
      return;
    }
    this.phase="main-enhancement-choice";
    events.push({kind:"選択待ち",playerId:pid,cardId:cardUse.cardId,choice:"付与の納め方",choices:clone(this.pendingMainCard.choices)});
  }
  _useMainCard(cardId,events){
    const pid=this.turnPlayer;
    const {slug,rule}=this._mainUseRuleForCard(pid,cardId);
    if(!this._mainCardUseLegal(pid,cardId,rule)) throw new Error("illegal registered main card");
    const paid=payResponseCardCost(this.state,pid,rule,cardId);
    const yurinaShinzawatariX=slug==="re_01_yurina_a2_s_1"
      ? Math.max(0,n(paid.x??paid.baseAmount??paid.amount))
      : null;
    if(paid.amount>0 || slug==="re_01_yurina_a2_s_1") events.push({kind:"消費",playerId:pid,cardId,slug,cost:clone(paid)});
    if(n(rule.burn)>0) this._thallyaBurn(pid,rule.burn,events,slug);
    const fromFacedown=arr(this.state?.[`p${pid}_facedown`]).some(x=>String(x)===String(cardId));
    const cardUse=fromFacedown
      ? moveCardToUsingFromZone(this.state,pid,cardId,"facedown")
      : moveResponseCardToUsing(this.state,pid,cardId);
    this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
    this._markCardUseTraits(pid,slug,events);
    events.push({kind:"カード使用",playerId:pid,cardId,slug});
    if(rule.kind==="attack-card"){
      const sourceZone=cardUse.sourceZone;
      const attackSpec=this._resolveYukihiAttackSpec({
        ...(rule.attack||{}),
        sourceCardId:cardId,
        sourceSlug:slug,
        classification:sourceZone==="special"?"special":"normal",
        attacker:pid,
        defender:pid===1?2:1
      },pid);
      if(slug==="re_01_yurina_a2_s_1"){
        attackSpec.auraDamage=Math.max(0,n(yurinaShinzawatariX));
        attackSpec.yurinaShinzawatariX=Math.max(0,n(yurinaShinzawatariX));
      }
      if(slug==="re_11_thallya_a1_s_2"){
        const x=Math.max(0,n(paid.x??paid.baseAmount??paid.amount));
        attackSpec.auraDamage=x;
        attackSpec.lifeDamage=x;
        attackSpec.thallyaOmnisX=x;
      }
      if(slug==="re_09_chikage_o_n_4" && this.mainMode==="fullpower"){
        if(attackSpec.auraDamage!=null) attackSpec.auraDamage=Math.max(0,n(attackSpec.auraDamage)+1);
        if(attackSpec.lifeDamage!=null) attackSpec.lifeDamage=Math.max(0,n(attackSpec.lifeDamage)+2);
        attackSpec.chikageAnkiFullPower=true;
      }
      if(slug==="re_11_thallya_o_n_4" && this.mainMode==="fullpower"){
        const expanded=applyRangeExpansion({range:arr(attackSpec.range)},1,1);
        attackSpec.range=arr(expanded.range);
        attackSpec.auraDamage=Math.max(0,n(attackSpec.auraDamage)+2);
        attackSpec.lifeDamage=Math.max(0,n(attackSpec.lifeDamage)+2);
        attackSpec.thallyaSteamCannonFullPower=true;
      }
      const started=this._beginGeneratedAttack(attackSpec,events,{kind:"main-card",cardUse,slug});
      if(!started.pending&&!this.done) this._finishMainCardUse(cardUse,slug,events);
      return;
    }
    if(rule.kind==="enhancement-card"){
      this._beginMainEnhancement(rule,cardUse,slug,events);
      return;
    }
    if(rule.kind==="action-card"){
      this._beginMainActionCard(rule,cardUse,slug,events);
      return;
    }
    throw new Error(`unsupported main card kind: ${rule.kind}`);
  }

  _responseRuleForCard(playerId,cardId){
    const slug=stateCardSlug(this.state,playerId,cardId);
    const rule=this.cardRuleRegistry?.get(slug)?.response||null;
    return {slug,rule};
  }
  _grantedResponseActive(playerId,responseRule){
    const granted=responseRule?.grantedResponse;
    if(!granted) return false;
    if(granted.kind==="always") return true;
    if(granted.kind==="aura-at-most"){
      return n(this.state?.[`p${Number(playerId)}_aura`])<=n(granted.value);
    }
    return false;
  }
  _allPotentialResponseCards(playerId){
    const pid=Number(playerId),status=this.state?.[`p${pid}_card_status`]||{},specialStatus=this.state?.[`p${pid}_special_status`]||{};
    const ids=new Set(responseCandidates(this.state,pid).map(String));
    for(const cardId of arr(this.state?.[`p${pid}_hand`])){
      const {rule}=this._responseRuleForCard(pid,cardId);
      if(rule?.grantedResponse && this._grantedResponseActive(pid,rule)) ids.add(String(cardId));
    }
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      if(Number(specialStatus[String(cardId)]||0)===2) continue;
      const {rule}=this._responseRuleForCard(pid,cardId);
      if(rule?.grantedResponse && this._grantedResponseActive(pid,rule)) ids.add(String(cardId));
    }
    const available=[...arr(this.state?.[`p${pid}_hand`]),...arr(this.state?.[`p${pid}_special`])];
    return available.filter(cardId=>ids.has(String(cardId)));
  }
  _responseRuleLegal(playerId,cardId,responseRule){
    if(!responseRule) return false;
    const sourceZone=cardSourceZoneForResponse(this.state,playerId,cardId);
    if(!sourceZone) return false;
    const classification=responseCardClassification(this.state,playerId,cardId);
    if(!attackAllowsResponseClassification(this.pendingAttack,classification)) return false;
    const responseCondition=responseRule?.responseCondition;
    if(responseCondition){
      if(responseCondition.kind==="parent-classification-is"){
        if(String(this.pendingAttack?.classification||"")!==String(responseCondition.value||"")) return false;
      }else{
        return false;
      }
    }
    if(this.terminalLocked?.[Number(playerId)]) return false;
    if(!canPayResponseCardCost(this.state,playerId,responseRule,cardId)) return false;
    if(n(responseRule.burn)>0&&!this._thallyaCanBurn(Number(playerId),responseRule.burn)) return false;
    const status=this.state?.[`p${Number(playerId)}_card_status`]?.[String(cardId)]||{};
    const inherent=Number(status.SubType)===1;
    const granted=this._grantedResponseActive(playerId,responseRule);
    if(!inherent&&!granted) return false;
    if(responseRule.kind==="attack-card"){
      if(this._chikageRelaxationActive(Number(playerId))) return false;
      const attack=normalizeAttackSpec(this._resolveYukihiAttackSpec({
        ...(responseRule.attack||{}),
        sourceCardId:cardId,
        sourceSlug:stateCardSlug(this.state,playerId,cardId),
        attacker:playerId,
        defender:playerId===1?2:1
      },playerId));
      return attackInRange(this.state,attack);
    }
    if(responseRule.kind==="action-card"||responseRule.kind==="enhancement-card") return true;
    return false;
  }
  _registeredResponseActions(playerId){
    const pid=Number(playerId);
    const out=[];
    for(const cardId of this._allPotentialResponseCards(pid)){
      const {slug,rule}=this._responseRuleForCard(pid,cardId);
      if(!this._responseRuleLegal(pid,cardId,rule)) continue;
      const base={
        actor:pid,
        kind:"対応",
        label:this.cardRuleRegistry?.get(slug)?.name||slug||String(cardId),
        rule:TURN_ATTACK_RESPOND,
        cardId
      };
      if(stateHasRaira(this.state,pid) && attackSourceMegamiFromSlug(slug)!=="raira"){
        out.push({...base,rairaGauge:"wind"},{...base,rairaGauge:"thunder"});
      }else out.push(base);
    }
    return out;
  }
  _unknownPotentiallyLegalResponses(playerId){
    const pid=Number(playerId),status=this.state?.[`p${pid}_card_status`]||{};
    if(this.terminalLocked?.[pid]) return [];
    const unknown=[];
    for(const cardId of responseCandidates(this.state,pid)){
      const classification=responseCardClassification(this.state,pid,cardId);
      if(!attackAllowsResponseClassification(this.pendingAttack,classification)) continue;
      const {rule}=this._responseRuleForCard(pid,cardId);
      if(rule) continue;
      const st=status[String(cardId)]||{};
      if(Number(st.MainType)===1 && Array.isArray(st.Distance) && st.Distance.length){
        if(!st.Distance.map(Number).includes(n(this.state.distance))) continue;
      }
      unknown.push(cardId);
    }
    return unknown;
  }
  _responseArrowChoices(effect){
    return arr(effect?.arrows).map(x=>String(x?.kind||"")).filter(Boolean);
  }
  _applyResponseArrow(playerId,effect,choice,events){
    const pid=Number(playerId),arrow=arr(effect?.arrows).find(x=>String(x?.kind||"")===String(choice));
    if(!arrow) throw new Error("unknown response arrow choice");
    const moved=applyArrowAsMuchAsPossible(this.state,pid,String(arrow.kind),arrow.count??1,this.options);
    events.push({kind:"対応矢印",playerId:pid,choice:String(choice),requested:Math.max(0,n(arrow.count??1)),moved});
  }
  _gainFocus(playerId,count,events,reason=""){
    const pid=Number(playerId),total=Math.max(0,Math.floor(n(count)));
    let gained=0;
    for(let i=0;i<total;i++){
      if(this.state[`p${pid}_intimidated`]){
        this.state[`p${pid}_intimidated`]=false;
        events.push({kind:"畏縮解除",playerId:pid,reason});
        continue;
      }
      const before=n(this.state[`p${pid}_focus`]);
      this.state[`p${pid}_focus`]=Math.min(2,before+1);
      gained+=this.state[`p${pid}_focus`]-before;
      events.push({kind:"集中力",playerId:pid,value:this.state[`p${pid}_focus`],delta:this.state[`p${pid}_focus`]-before,reason});
    }
    return gained;
  }
  _applyResponseActionAfterEffects(playerId,effect,events){
    const pid=Number(playerId);
    for(const after of arr(effect?.afterEffects)){
      if(after?.kind==="focus-gain"){
        this._gainFocus(pid,after.count??1,events,"対応カード");
        continue;
      }
      throw new Error(`unsupported response action after effect: ${after?.kind}`);
    }
  }
  _markResponseCardResolvedTraits(cardUse,slug,events){
    const pid=Number(cardUse?.playerId),entry=this.cardRuleRegistry?.get(slug)||{};
    if(entry.terminal){
      this.terminalLocked[pid]=true;
      events.push({kind:"終端",playerId:pid,cardId:cardUse?.cardId,slug});
    }
  }
  _finishActionResponseCard(events){
    const pending=this.pendingResponseCard;
    if(!pending) throw new Error("missing pending response card");
    const moved=finishResponseCardUse(this.state,pending.cardUse);
    events.push({kind:"対応カード解決終了",playerId:pending.playerId,cardId:pending.cardId,...moved});
    this._markResponseCardResolvedTraits(pending.cardUse,pending.slug,events);
    const responseRule=this.cardRuleRegistry?.get(pending.slug)?.response||{};
    const pid=Number(pending.playerId),slug=String(pending.slug||"");
    this.pendingResponseCard=null;
    this._beginKururuPostCardBasics(pid,responseRule,{kind:"finished-response-action",slug},events);
  }
  _resolveActionResponseCard(responseRule,cardUse,slug,events){
    const pid=Number(cardUse.playerId),effect=responseRule?.effect||{};
    this.pendingResponseCard={playerId:pid,cardId:cardUse.cardId,slug,cardUse:clone(cardUse),effect:clone(effect),choices:[]};
    if(effect.kind==="kururu-drain-devil-response"){
      this._kururuDrain(pid,events,slug);
      this._finishActionResponseCard(events);
      return;
    }
    if(effect.kind==="kururu-kururu-n"){
      this.pendingResponseCard.kind="kururu-n-effect";
      this.pendingResponseCard.kururuChosen=[];
      this._continueKururuNResponse(events);
      return;
    }
    if(effect.kind==="yukihi-step"){
      const owner=this._yukihiCardOwner(cardUse,pid);
      if(this._hasYukihi(owner)){
        const arrow=this._yukihiUmbrellaOpen(owner)?"distance-to-dust":"dust-to-distance";
        const moved=applyArrowAsMuchAsPossible(this.state,pid,arrow,1,this.options);
        events.push({kind:"対応矢印",playerId:pid,source:slug,arrow,moved});
      }
      this._finishActionResponseCard(events);
      return;
    }
    if(effect.kind==="yukihi-toggle-matoi"){
      this._toggleYukihiUmbrella(pid,events,String(effect.source||slug),{kind:"response-action",matoiPlayerId:pid,matoiSource:String(effect.source||slug)});
      return;
    }
    if(effect.kind==="korunu-absolute-zero"){
      const opponent=pid===1?2:1;
      this._applyEffectMatoi(pid,events,"絶対零度");
      if(n(this.state?.[`p${opponent}_freeze`])>=3) this._applyEffectMatoi(pid,events,"絶対零度");
      this._finishActionResponseCard(events);
      return;
    }
    if(effect.kind==="korunu-retarulera-response"){
      const opponent=pid===1?2:1;
      if(this._auraHasNoSpace(opponent)){
        this._tryCancelAttack(this.pendingAttack,"レタルレラ",events);
      }else{
        const moved=applyArrowAsMuchAsPossible(this.state,pid,"distance-to-opponent-aura",1,this.options);
        events.push({kind:"対応矢印",playerId:pid,source:"レタルレラ",arrow:"distance-to-opponent-aura",moved});
      }
      this._finishActionResponseCard(events);
      return;
    }

    if(effect.kind==="raira-tengu-step"){
      this.pendingResponseCard.kind="raira-tengu-step";
      this.pendingResponseCard.choices=this._rairaTenguChoices();
      this.phase="response-card-choice";
      events.push({kind:"選択待ち",playerId:pid,cardId:cardUse.cardId,choice:"風魔天狗道",choices:clone(this.pendingResponseCard.choices)});
      return;
    }

    if(effect.kind==="thallya-ride-response"){
      this._requestThallyaRide(pid,events,{kind:"response-action",sourceCardId:cardUse.cardId},{optional:false,source:slug});
      return;
    }
    if(effect.kind==="thallya-omega-response"){
      const recovered=this._thallyaRecover(pid,n(this.state?.[`p${pid}_thallya_burned`]),events,"Omega-Burst");
      const parent=this.pendingAttack;
      if(parent && (parent.auraDamage==null || n(parent.auraDamage)<=recovered)){
        this._tryCancelAttack(parent,"Omega-Burst",events);
      }
      this._finishActionResponseCard(events);
      return;
    }

    if(effect.kind==="choose-arrows"){
      const choices=this._responseArrowChoices(effect);
      this.pendingResponseCard.choices=clone(choices);
      if(!choices.length){
        events.push({kind:"対応カード効果",playerId:pid,cardId:cardUse.cardId,effect:"矢印なし"});
        this._applyResponseActionAfterEffects(pid,effect,events);
        this._finishActionResponseCard(events);
        return;
      }
      if(choices.length===1){
        this._applyResponseArrow(pid,effect,choices[0],events);
        this._applyResponseActionAfterEffects(pid,effect,events);
        this._finishActionResponseCard(events);
        return;
      }
      this.phase="response-card-choice";
      events.push({kind:"選択待ち",playerId:pid,cardId:cardUse.cardId,choice:"対応矢印",choices:clone(choices)});
      return;
    }
    if(effect.kind==="use-facedown-non-fullpower"){
      const candidates=arr(this.state?.[`p${pid}_facedown`]).filter(cardId=>
        this._facedownUseLegal(pid,cardId,{nonFullpower:true})
      );
      this.pendingResponseCard.kind="use-facedown";
      this.pendingResponseCard.choices=["done",...candidates.map(String)];
      if(!candidates.length){
        this._finishActionResponseCard(events);
        return;
      }
      this.phase="response-card-choice";
      events.push({kind:"選択待ち",playerId:pid,cardId:cardUse.cardId,choice:"伏せ札",choices:clone(this.pendingResponseCard.choices)});
      return;
    }
    if(effect.kind==="shinra-plan"){
      this._beginShinraPlanEffect(pid,cardUse.cardId,slug,effect.planEffects,{kind:"response-action"},events);
      return;
    }
    if(effect.kind==="megalobell"){
      if(this._allOtherSpecialsUsed(pid,cardUse.cardId)){
        const moved=applyArrowAsMuchAsPossible(this.state,pid,"distance-to-life",1,this.options);
        events.push({kind:"対応矢印",playerId:pid,choice:"distance-to-life",requested:1,moved});
      }
      const removed=this._removeUsingCardToOutside(pid,cardUse.cardId);
      events.push({kind:"取り除く",playerId:pid,cardId:cardUse.cardId,removed});
      this._finishActionResponseCard(events);
      return;
    }
    this.done=true;
    this.doneReason="unsupported-response-action-effect";
    events.push({kind:"未対応",reason:"対応行動カード効果",cardId:cardUse.cardId,slug,effect:clone(effect)});
  }

  _applyResponseEnhancementDeployEffects(rule,events,playerId=null){
    const parent=this.pendingAttack;
    const pendingPlayerId=playerId==null?null:Number(playerId);
    const pending=this.pendingResponseCard;
    if(!parent) throw new Error("enhancement response has no parent attack");
    for(const effect of arr(rule?.deployEffects)){
      if(effect?.kind==="freeze-opponent"){
        const pid=pendingPlayerId??parent.defender;
        this._freezePlayer(pid===1?2:1,effect.count??1,events,pending?.slug||"");
      }else if(effect?.kind==="korunu-porucharto"){
        const pid=pendingPlayerId??parent.defender;
        pending.kind="korunu-porucharto-arrow";
        pending.deployChoice={kind:"korunu-porucharto-arrow"};
        pending.choices=["distance-to-dust","dust-to-distance"];
        this.phase="response-card-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"間合⇔ダスト",choices:clone(pending.choices)});
        return true;
      }else if(effect?.kind==="megumi-branch-reduce-parent"){
        const pid=pendingPlayerId??parent.defender;
        const x=megumiSeedCountOutsideSoil(this.state,pid);
        if(parent.auraDamage!=null) parent.auraDamage=Math.max(0,n(parent.auraDamage)-x);
        events.push({kind:"対応付与展開時",effect:"可能性の枝",playerId:pid,x,target:parent.label,auraDamage:parent.auraDamage,lifeDamage:parent.lifeDamage});
      }else if(effect?.kind==="modify-parent-damage"){
        if(parent.auraDamage!=null) parent.auraDamage=Math.max(0,n(parent.auraDamage)+n(effect.auraDelta));
        if(parent.lifeDamage!=null) parent.lifeDamage=Math.max(0,n(parent.lifeDamage)+n(effect.lifeDelta));
        events.push({
          kind:"対応付与展開時",
          effect:"攻撃ダメージ修正",
          target:parent.label,
          auraDamage:parent.auraDamage,
          lifeDamage:parent.lifeDamage
        });
      }else if(effect?.kind==="arrow"){
        const arrow=effect.arrow||{};
        const moved=applyArrowAsMuchAsPossible(this.state,pendingPlayerId??parent.defender,String(arrow.kind||""),arrow.count??1,this.options);
        events.push({kind:"対応付与展開時",effect:"矢印",playerId:pendingPlayerId??parent.defender,arrow:String(arrow.kind||""),moved});
      }else if(effect?.kind==="opponent-top-deck-to-discard"){
        this._moveOpponentTopDeckToDiscard(pendingPlayerId??parent.defender,effect.count??1,events,pending?.slug||"");
      }else if(effect?.kind==="seal-opponent-discard-under-self"){
        const pid=pendingPlayerId??parent.defender,opponent=pid===1?2:1,candidates=arr(this.state?.[`p${opponent}_discard`]).map(String);
        if(candidates.length===1){
          this._sealCardUnder(pid,pending.cardId,opponent,candidates[0],events);
        }else if(candidates.length>1){
          pending.kind="enhancement-deploy-seal";
          pending.deployChoice={kind:"shinra-seal-opponent-discard",opponent};
          pending.choices=clone(candidates);
          this.phase="response-card-choice";
          events.push({kind:"選択待ち",playerId:pid,cardId:pending.cardId,choice:"論破",choices:clone(candidates)});
          return true;
        }
      }else{
        throw new Error(`unsupported response enhancement deploy effect: ${effect?.kind}`);
      }
    }
    return false;
  }
  _finishResponseEnhancementWithoutDiscard(pending,events){
    this.pendingResponseCard=null;
    events.push({
      kind:"対応付与展開完了",
      playerId:pending.playerId,
      cardId:pending.cardId,
      charge:n(this.state?.[`p${pending.playerId}_card_status`]?.[String(pending.cardId)]?.Charge)
    });
    if(this._applyAttackPostResponseEffects(this.pendingAttack,events,pending.slug,"advance-parent")) return;
    this._advanceAttackAfterResponse(events);
  }
  _finishImmediateResponseEnhancementDiscard(playerId,cardId,arrow,events){
    const pid=Number(playerId);
    if(arrow){
      const moved=applyDistanceDustArrow(this.state,String(arrow.kind),arrow.count??1,this.options);
      events.push({kind:"破棄時矢印",playerId:pid,cardId,arrow:arrow.kind,moved});
    }
    const moved=finishEnhancementDiscard(this.state,pid,cardId);
    events.push({kind:"付与札の破棄完了",playerId:pid,cards:[{cardId,...moved}]});
    this._onEnhancementDiscarded(pid,cardId,events);
    if(this.done) return;
    this.pendingResponseCard=null;
    this.pendingAttack=this.attackStack.pop()||null;
    if(!this.pendingAttack) throw new Error("response enhancement finished without parent attack");
    if(this._applyAttackPostResponseEffects(this.pendingAttack,events,"対応付与","advance-parent")) return;
    this._advanceAttackAfterResponse(events);
  }
  _resolveImmediateResponseEnhancementDiscard(pending,events){
    const entry=this.cardRuleRegistry?.get(pending.slug)||{};
    const effect=entry.enhancementDiscard;
    if(!effect){
      this.done=true;
      this.doneReason="unsupported-enhancement-discard-effect";
      events.push({kind:"未対応",reason:"対応付与の即時破棄",cardId:pending.cardId,slug:pending.slug});
      return;
    }
    if(effect.kind==="none"){
      events.push({kind:"破棄時効果なし",playerId:pending.playerId,cardId:pending.cardId,slug:pending.slug});
      const moved=finishEnhancementDiscard(this.state,pending.playerId,pending.cardId);
      events.push({kind:"付与札の破棄完了",playerId:pending.playerId,cards:[{cardId:pending.cardId,...moved}]});
      this._onEnhancementDiscarded(pending.playerId,pending.cardId,events);
      this.pendingResponseCard=null;
      if(!this.done) this._advanceAttackAfterResponse(events);
      return;
    }
    if(effect.kind==="arrow"){
      const arrow=effect.arrow||{};
      const movedCount=applyArrowAsMuchAsPossible(
        this.state,
        pending.playerId,
        String(arrow.kind||""),
        arrow.count??1,
        this.options
      );
      events.push({
        kind:"破棄時矢印",
        playerId:pending.playerId,
        cardId:pending.cardId,
        arrow:String(arrow.kind||""),
        moved:movedCount
      });
      const moved=finishEnhancementDiscard(this.state,pending.playerId,pending.cardId);
      events.push({kind:"付与札の破棄完了",playerId:pending.playerId,cards:[{cardId:pending.cardId,...moved}]});
      this._onEnhancementDiscarded(pending.playerId,pending.cardId,events);
      this.pendingResponseCard=null;
      if(!this.done) this._advanceAttackAfterResponse(events);
      return;
    }
    if(effect.kind==="korunu-porucharto-redeploy"){
      const cost=Math.max(0,n(effect.cost??2));
      if(n(this.state?.[`p${pending.playerId}_flare`])<cost){
        events.push({kind:"ポルチャルトー再使用不可",playerId:pending.playerId,cardId:pending.cardId,cost});
        const moved=finishEnhancementDiscard(this.state,pending.playerId,pending.cardId);
        events.push({kind:"付与札の破棄完了",playerId:pending.playerId,cards:[{cardId:pending.cardId,...moved}]});
        this._onEnhancementDiscarded(pending.playerId,pending.cardId,events);
        this.pendingResponseCard=null;
        if(!this.done) this._advanceAttackAfterResponse(events);
        return;
      }
      this.pendingCardDecision={
        kind:"korunu-porucharto-redeploy",
        playerId:pending.playerId,
        label:"ポルチャルトー",
        sourceCardId:pending.cardId,
        slug:pending.slug,
        candidates:["discard","redeploy"],
        charge:Math.max(0,n(effect.charge??4)),
        cost,
        resumeKind:"response-enhancement"
      };
      this.pendingResponseCard=null;
      this.phase="start-card-choice";
      events.push({
        kind:"選択待ち",
        playerId:pending.playerId,
        cardId:pending.cardId,
        choice:"ポルチャルトー再使用",
        candidates:["discard","redeploy"]
      });
      return;
    }
    if(effect.kind==="return-sealed-to-owner-discard"){
      this._returnSealedCards(pending.playerId,pending.cardId,events);
      const moved=finishEnhancementDiscard(this.state,pending.playerId,pending.cardId);
      events.push({kind:"付与札の破棄完了",playerId:pending.playerId,cards:[{cardId:pending.cardId,...moved}]});
      this._onEnhancementDiscarded(pending.playerId,pending.cardId,events);
      this.pendingResponseCard=null;
      if(!this.done) this._advanceAttackAfterResponse(events);
      return;
    }
    if(effect.kind==="generated-attack-then-arrow"){
      const parent=this.pendingAttack;
      if(!parent) throw new Error("response enhancement discard has no parent attack");
      this.attackStack.push(parent);
      this.pendingAttack=null;
      const attackSpec={
        ...(effect.attack||{}),
        sourceCardId:pending.cardId,
        sourceSlug:pending.slug,
        attacker:pending.playerId
      };
      const resume={
        kind:"response-enhancement-discard-then-arrow",
        playerId:pending.playerId,
        cardId:pending.cardId,
        arrow:clone(effect.arrow||null)
      };
      const started=this._beginGeneratedAttack(attackSpec,events,resume);
      if(!started.pending&&!this.done){
        this._finishImmediateResponseEnhancementDiscard(pending.playerId,pending.cardId,effect.arrow,events);
      }
      return;
    }
    this.done=true;
    this.doneReason="unsupported-enhancement-discard-effect";
    events.push({kind:"未対応",reason:"対応付与の即時破棄効果",cardId:pending.cardId,slug:pending.slug,effect:clone(effect)});
  }
  _applyResponseEnhancementPlacement(choice,events){
    const pending=this.pendingResponseCard;
    if(!pending||pending.kind!=="enhancement-placement") throw new Error("missing enhancement placement decision");
    const placement=parseEnhancementPlacementKey(choice);
    if(!placement) throw new Error("invalid enhancement placement choice");
    const legal=enhancementPlacementOptions(this.state,pending.playerId,pending.charge,pending.growth)
      .some(x=>enhancementPlacementKey(x)===String(choice));
    if(!legal) throw new Error("illegal enhancement placement choice");
    const deployed=deployResponseEnhancement(this.state,pending.cardUse,placement);
    pending.deployedPlaced=deployed.placed;
    events.push({kind:"付与展開",playerId:pending.playerId,cardId:pending.cardId,...deployed});
    if(this._applyResponseEnhancementDeployEffects(pending.rule,events,pending.playerId)) return;
    if(deployed.placed===0){
      this._resolveImmediateResponseEnhancementDiscard(pending,events);
      return;
    }
    this._finishResponseEnhancementWithoutDiscard(pending,events);
  }
  _beginResponseEnhancement(rule,cardUse,slug,events){
    const pid=Number(cardUse.playerId);
    if(stateHasMegumi(this.state,pid)){
      const germinated=germinateMegumiSeeds(this.state,pid,1);
      if(germinated>0) events.push({kind:"種結晶萌芽",playerId:pid,count:germinated,source:slug});
    }
    const otherMegami=attackSourceMegamiFromSlug(slug)!=="megumi";
    const bonus=otherMegami?Math.max(0,n(this.nextOtherMegamiGrowthBonus?.[pid])):0;
    if(bonus>0) this.nextOtherMegamiGrowthBonus[pid]=0;
    const growth=Math.max(0,n(rule.growth))+bonus;
    const options=enhancementPlacementOptions(this.state,pid,rule.charge,growth);
    this.pendingResponseCard={
      kind:"enhancement-placement",
      playerId:pid,
      cardId:cardUse.cardId,
      slug,
      cardUse:clone(cardUse),
      rule:{...clone(rule),growth},
      charge:Math.max(0,n(rule.charge)),
      growth,
      choices:options.map(enhancementPlacementKey)
    };
    if(options.length===1){
      this._applyResponseEnhancementPlacement(enhancementPlacementKey(options[0]),events);
      return;
    }
    this.phase="response-card-choice";
    events.push({
      kind:"選択待ち",
      playerId:pid,
      cardId:cardUse.cardId,
      choice:"付与の納め方",
      choices:clone(this.pendingResponseCard.choices)
    });
  }

  _useResponseCard(cardId,events){
    const parent=this.pendingAttack;
    if(!parent) throw new Error("no attack to respond to");
    const responder=Number(parent.defender);
    const {slug,rule}=this._responseRuleForCard(responder,cardId);
    if(!this._responseRuleLegal(responder,cardId,rule)) throw new Error("illegal registered response card");
    const paid=payResponseCardCost(this.state,responder,rule,cardId);
    if(paid.amount>0) events.push({kind:"消費",playerId:responder,cardId,slug,cost:clone(paid)});
    if(n(rule.burn)>0) this._thallyaBurn(responder,rule.burn,events,slug);
    const cardUse=moveResponseCardToUsing(this.state,responder,cardId);
    this.cardUseCountsThisTurn[responder]=Math.max(0,n(this.cardUseCountsThisTurn?.[responder]))+1;
    this._markCardUseTraits(responder,slug,events);
    parent.responded=true;
    events.push({kind:"対応カード使用",playerId:responder,cardId,slug});
    if(rule.kind==="enhancement-card"){
      this._beginResponseEnhancement(rule,cardUse,slug,events);
      return;
    }
    if(rule.kind==="action-card"){
      this._resolveActionResponseCard(rule,cardUse,slug,events);
      return;
    }
    if(rule.kind!=="attack-card") throw new Error("unsupported registered response kind");
    this.attackStack.push(parent);
    this.pendingAttack=null;
    const attackSpec=this._resolveYukihiAttackSpec({
      ...(rule.attack||{}),
      sourceCardId:cardId,
      sourceSlug:slug,
      responseForbidden:true,
      attacker:responder,
      defender:responder===1?2:1
    },responder);
    const started=this._beginGeneratedAttack(attackSpec,events,{kind:"response-card",cardUse,slug});
    if(!started.pending && !this.done){
      const moved=finishResponseCardUse(this.state,cardUse);
      events.push({kind:"対応カード解決終了",playerId:responder,cardId,...moved});
      this._markResponseCardResolvedTraits(cardUse,slug,events);
      this.pendingAttack=this.attackStack.pop()||null;
      if(this.pendingAttack){
        if(this._applyAttackPostResponseEffects(this.pendingAttack,events,slug,"advance-parent")) return;
        this._advanceAttackAfterResponse(events);
      }
    }
  }


  _finishPendingAttack(events){
    const attack=this.pendingAttack;
    if(!attack) return;
    if(this._requestRairaCycleAfterAttack(attack,events)) return;
    const resume=clone(attack.resume||null);
    events.push({kind:"攻撃解決終了",attacker:attack.attacker,defender:attack.defender,label:attack.label});
    this.pendingAttack=null;
    if(this.done) return;
    if(resume?.kind==="megumi-branch-start"){
      this._continueStartPhaseDefault(events);
      return;
    }
    if(resume?.kind==="megumi-main-start"){
      this._advanceMegumiMainStartAttacks(events);
      return;
    }
    if(resume?.kind==="megumi-fruit-end"){
      const pid=Number(resume.playerId);
      this._finishMegumiFruitEnd(pid,String(resume.cardId),events);
      if(this.done) return;
      if(!this._resolveEndPhaseEnhancementEffects(pid,events)) return;
      this._beginYukihiEndToggleChoice(pid,events);
      return;
    }
    if(resume?.kind==="forced-enhancement-discard" || resume?.kind==="forced-enhancement-discard-then-arrow"){
      const pid=Number(resume.playerId),id=String(resume.cardId);
      if(resume.kind==="forced-enhancement-discard-then-arrow" && resume.arrow){
        const moved=applyArrowAsMuchAsPossible(this.state,pid,String(resume.arrow.kind||""),resume.arrow.count??1,this.options);
        events.push({kind:"破棄時矢印",playerId:pid,cardId:id,arrow:String(resume.arrow.kind||""),moved});
      }
      this._finishForcedEnhancementDiscard(pid,id,events,resume.caller);
      return;
    }
    if(resume?.kind==="korunu-absolute-zero"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(resume.cardId)) throw new Error("Absolute Zero main action resume mismatch");
      const opponent=Number(resume.playerId)===1?2:1;
      this._freezeUntilAuraFull(opponent,events,"絶対零度");
      this._continueMainActionCard(pending,events);
      return;
    }
    if(resume?.kind==="enhancement-discard"){
      const source=this.pendingEnhancementDiscards[0];
      if(String(source)!==String(resume.cardId)) throw new Error("attack resume enhancement card mismatch");
      const owner=this.pendingEnhancementDiscardOwner||this.enhancementTickOwner||this.turnPlayer;
      const moved=finishEnhancementDiscard(this.state,owner,source);
      events.push({kind:"付与札の破棄完了",playerId:owner,cards:[{cardId:source,...moved}]});
      this._onEnhancementDiscarded(owner,source,events);
      if(this.done) return;
      this.pendingEnhancementDiscards.shift();
      this._advanceEnhancementDiscardQueue(events);
      return;
    }
    if(resume?.kind==="enhancement-discard-then-arrow"){
      const pid=Number(resume.playerId);
      const source=this.pendingEnhancementDiscards[0];
      if(String(source)!==String(resume.cardId)) throw new Error("attack resume enhancement card mismatch");
      if(resume.arrow){
        const movedCount=applyDistanceDustArrow(this.state,String(resume.arrow.kind),resume.arrow.count??1,this.options);
        events.push({kind:"破棄時矢印",playerId:pid,cardId:source,arrow:resume.arrow.kind,moved:movedCount});
      }
      const moved=finishEnhancementDiscard(this.state,pid,source);
      events.push({kind:"付与札の破棄完了",playerId:pid,cards:[{cardId:source,...moved}]});
      this._onEnhancementDiscarded(pid,source,events);
      if(this.done) return;
      this.pendingEnhancementDiscards.shift();
      this._advanceEnhancementDiscardQueue(events);
      return;
    }
    if(resume?.kind==="external-facedown-card"){
      this._finishExternalFacedownAttack(resume.cardUse,resume.slug,resume.context,events);
      return;
    }
    if(resume?.kind==="external-discard-card"){
      this._finishExternalDiscardAttack(resume.cardUse,resume.slug,resume.context,events);
      return;
    }
    if(resume?.kind==="borrowed-card"){
      this._finishBorrowedAttack(resume.cardUse,resume.slug,resume.context,events);
      return;
    }
    if(resume?.kind==="main-card"){
      this._finishMainCardUse(resume.cardUse,resume.slug,events);
      return;
    }
    if(resume?.kind==="main-action-card"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(resume.cardId)) throw new Error("main action generated attack resume mismatch");
      this._continueMainActionCard(pending,events);
      return;
    }
    if(resume?.kind==="main-enhancement-discard"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(resume.cardId)) throw new Error("main enhancement discard resume mismatch");
      this._finishImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    if(resume?.kind==="main-enhancement-discard-then-arrow"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(resume.cardId)) throw new Error("main enhancement discard arrow resume mismatch");
      if(resume.arrow){
        const moved=applyDistanceDustArrow(this.state,String(resume.arrow.kind),resume.arrow.count??1,this.options);
        events.push({kind:"破棄時矢印",playerId:pending.playerId,cardId:pending.cardId,arrow:resume.arrow.kind,moved});
      }
      this._finishImmediateMainEnhancementDiscard(pending,events);
      return;
    }
    if(resume?.kind==="raira-heavenly-array"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(resume.cardId)) throw new Error("Raira heavenly parent missing after attack");
      this._beginRairaHeavenlyAttack(pending,events);
      return;
    }
    if(resume?.kind==="response-card"){
      const moved=finishResponseCardUse(this.state,resume.cardUse);
      events.push({
        kind:"対応カード解決終了",
        playerId:resume.cardUse?.playerId,
        cardId:resume.cardUse?.cardId,
        ...moved
      });
      this._markResponseCardResolvedTraits(resume.cardUse,resume.slug,events);
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("response card finished without parent attack");
      if(this._applyAttackPostResponseEffects(this.pendingAttack,events,resume.slug,"advance-parent")) return;
      this._advanceAttackAfterResponse(events);
      return;
    }
    if(resume?.kind==="response-enhancement-discard-then-arrow"){
      this._finishImmediateResponseEnhancementDiscard(
        Number(resume.playerId),
        resume.cardId,
        resume.arrow,
        events
      );
      return;
    }
    if(resume?.kind==="kururu-own-child"){
      this._finishKururuOwnChild(resume.cardUse,resume.slug,resume.context,events);
      return;
    }
    if(resume?.kind==="thallya-dual-attack"){
      this._finishThallyaDualDiscardAttack(resume.cardUse,resume.slug,events);
      return;
    }
    if(resume?.kind==="yurina-aun-generated"){
      this._resumeYurinaAun(resume.context,events);
      return;
    }
    if(resume?.kind==="thallya-a1-kinnari-reconstruction"){
      const pid=Number(resume.reconstructor),resumeKind=String(resume.resumeKind||"start-phase"),draws=Math.max(0,n(resume.draws));
      if(resume.industriaRecharged && this._kururuDrainDevilCard(pid) && !this.terminalLocked?.[pid]){
        this._beginKururuDrainReuse([{playerId:pid,count:1}],{kind:"reconstruction-complete",resumeKind,draws},events);
        return;
      }
      this._resumeCompletedReconstruction(resumeKind,draws,events);
      return;
    }
    if(resume?.kind==="thallya-extra-basic"){
      this.phase="main";
      return;
    }
    if(resume?.kind==="thallya-effect-basic"){
      const pending=this.pendingMainCard;
      if(!pending || String(pending.cardId)!==String(resume.cardId)) throw new Error("Thallya effect basic resume mismatch");
      const pid=Number(pending.playerId);
      const hasMore=n(pending.remainingBasicActions)>0 && (
        this._effectBasicActions(pid).length ||
        (pending.allowThallyaExtraBasic && this._thallyaExtraBasicKinds(pid).length)
      );
      if(hasMore){
        this.phase="main-effect-basic";
        events.push({kind:"基本動作選択待ち",playerId:pid,remaining:n(pending.remainingBasicActions)});
      }else{
        pending.remainingBasicActions=0;
        pending.allowThallyaExtraBasic=false;
        this._continueMainActionCard(pending,events);
      }
      return;
    }
    if(resume?.kind==="bunshin-extra"){
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("bunshin parent attack missing");
      this._applyEffectMatoi(Number(resume.attacker),events,String(resume.sourceLabel||""));
      this._resolveAttackAfterEffects(events);
      return;
    }
    if(resume?.kind==="repeat-after-attack"){
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("repeat attack parent missing");
      this._beginNextRepeatedAttack(this.pendingAttack,events);
      return;
    }
    if(resume?.kind==="attack-after-generated"){
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("generated after-effect finished without parent attack");
      this._resolveAttackAfterEffects(events);
      return;
    }
    if(resume?.phase){
      this.phase=String(resume.phase);
      return;
    }
    this.phase="main";
  }
  _drawForAttackAfter(playerId,count,events){
    const pid=Number(playerId),total=Math.max(0,Math.floor(Number(count)||0));
    for(let i=0;i<total;i++){
      const before=this._ruleHook("beforeEffectDraw",{events,playerId:pid,reason:"attack-after"});
      if(before.stop||this.done) return false;
      const cardId=drawTopCard(this.state,pid);
      if(cardId==null){
        this.pendingEffectFatigue={playerId:pid,reason:"attack-after-draw"};
        this.phase="effect-fatigue";
        events.push({kind:"焦燥待ち",playerId:pid,reason:"攻撃後のドロー"});
        return false;
      }
      events.push({kind:"ドロー",playerId:pid,cardId,reason:"攻撃後"});
    }
    return true;
  }
  _applyEffectMatoi(playerId,events,source=""){
    const pid=Number(playerId);
    this.basicActionsThisTurn[pid]=Math.max(0,n(this.basicActionsThisTurn?.[pid]))+1;
    const moved=applyArrowAsMuchAsPossible(this.state,pid,"dust-to-aura",1,this.options);
    events.push({kind:"効果による基本動作",playerId:pid,basicAction:3,label:BASIC_ACTION_NAMES[3],source,moved});
    return moved;
  }
  _beginBunshinExtraAttack(parent,effect,events){
    const attacker=Number(parent.attacker);
    this.attackStack.push(parent);
    this.pendingAttack=null;
    const attackSpec={
      ...(effect.attack||{}),
      sourceCardId:parent.sourceCardId,
      sourceSlug:parent.sourceSlug,
      classification:null,
      attacker
    };
    const started=this._beginGeneratedAttack(attackSpec,events,{kind:"bunshin-extra",attacker,sourceLabel:parent.label});
    if(!started.pending&&!this.done){
      this.pendingAttack=this.attackStack.pop()||null;
      if(!this.pendingAttack) throw new Error("bunshin parent attack missing");
      this._applyEffectMatoi(attacker,events,parent.label);
      this._resolveAttackAfterEffects(events);
    }
  }
  _beginNextRepeatedAttack(parent,events){
    if(!parent?.repeatAttackState) throw new Error("missing repeat attack state");
    const state=parent.repeatAttackState;
    if(n(state.remaining)<=0){
      parent.repeatAttackState=null;
      this.pendingAttack=parent;
      this._resolveAttackAfterEffects(events);
      return;
    }
    state.remaining=Math.max(0,n(state.remaining)-1);
    this.attackStack.push(parent);
    this.pendingAttack=null;
    const attackSpec={
      ...(state.attack||{}),
      sourceCardId:parent.sourceCardId,
      sourceSlug:parent.sourceSlug,
      classification:null,
      attacker:parent.attacker
    };
    const started=this._beginGeneratedAttack(attackSpec,events,{kind:"repeat-after-attack"});
    if(!started.pending&&!this.done){
      const restored=this.attackStack.pop()||null;
      if(!restored) throw new Error("repeat attack parent missing");
      this.pendingAttack=restored;
      this._beginNextRepeatedAttack(restored,events);
    }
  }
  _tryCancelAttack(target,sourceLabel,events){
    if(!target) return false;
    if(target.uncancelable){
      events.push({kind:"攻撃打ち消し失敗",source:String(sourceLabel||""),target:target.label,reason:"打ち消されない"});
      return false;
    }
    target.canceled=true;
    events.push({kind:"攻撃打ち消し",source:String(sourceLabel||""),target:target.label});
    return true;
  }
  _tryCancelAttackDamage(target,sourceLabel,events){
    if(!target) return false;
    if(target.uncancelable){
      events.push({kind:"攻撃ダメージ打ち消し失敗",source:String(sourceLabel||""),target:target.label,reason:"打ち消されない"});
      return false;
    }
    target.damageCanceled=true;
    events.push({kind:"攻撃ダメージ打ち消し付与",source:String(sourceLabel||""),target:target.label});
    return true;
  }
  _tryCancelAttackAfterEffects(target,sourceLabel,events){
    if(!target) return false;
    if(target.uncancelable){
      events.push({kind:"攻撃後効果打ち消し失敗",source:String(sourceLabel||""),target:target.label,reason:"打ち消されない"});
      return false;
    }
    target.attackAfterCanceled=true;
    events.push({kind:"攻撃後効果打ち消し付与",source:String(sourceLabel||""),target:target.label});
    return true;
  }
  _resolveAttackAfterEffects(events){
    const attack=this.pendingAttack;
    if(!attack) throw new Error("missing pending attack");
    if(attack.attackAfterCanceled){
      events.push({kind:"攻撃後効果打ち消し",label:attack.label});
      this._finishPendingAttack(events);
      return;
    }
    if(!Number.isInteger(attack.afterEffectIndex)) attack.afterEffectIndex=0;
    const effects=arr(attack.afterEffects);
    while(attack.afterEffectIndex<effects.length){
      const effect=effects[attack.afterEffectIndex++];
      if(effect?.kind==="yurina-mondo"){
        if(String(attack.lastDamageChoice)!=="life") continue;
        this._moveOpponentDeckToFacedown(attack.attacker,3,events,"問答");
        const attacker=Number(attack.attacker),defender=Number(attack.defender),basics=this._effectBasicActions(attacker);
        if(!basics.length) continue;
        this.pendingCardDecision={
          kind:"yurina-mondo-basic",playerId:attacker,label:"問答",
          sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,
          candidates:basics.map(String),defender
        };
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:attacker,cardId:attack.sourceCardId,choice:"問答・基本動作",candidates:clone(this.pendingCardDecision.candidates)});
        return;
      }
      if(effect?.kind==="yurina-shinzawatari"){
        const pid=Number(attack.attacker),x=Math.max(0,n(attack.yurinaShinzawatariX));
        this.state[`p${pid}_yurina_hand_limit_bonus_turn`]=Math.max(0,n(this.state?.[`p${pid}_yurina_hand_limit_bonus_turn`]))+x;
        attack.yurinaShinzawatariState={remainingBasic:x,remainingReady:x};
        events.push({kind:"手札上限増加",playerId:pid,source:"神座渡",count:x});
        if(this._beginYurinaShinzawatariChoice(attack,events)) return;
        continue;
      }
      if(effect?.kind==="intimidate-attacker"){
        const attacker=Number(attack.attacker);
        this.state[`p${attacker}_intimidated`]=true;
        events.push({kind:"畏縮",playerId:attacker,source:String(effect.source||attack.label)});
        continue;
      }
      if(effect?.kind==="focus-gain"){
        this._gainFocus(attack.attacker,effect.count??1,events,"攻撃後");
        continue;
      }
      if(effect?.kind==="megumi-shell-growth"){
        const add=Math.max(0,n(effect.count??2));
        this.nextOtherMegamiGrowthBonus[attack.attacker]=Math.max(0,n(this.nextOtherMegamiGrowthBonus?.[attack.attacker]))+add;
        events.push({kind:"生育強化",playerId:attack.attacker,count:add,source:attack.label});
        continue;
      }
      if(effect?.kind==="megumi-germinate"){
        const moved=germinateMegumiSeeds(this.state,attack.attacker,effect.count??1);
        events.push({kind:"種結晶萌芽",playerId:attack.attacker,count:moved,source:attack.label});
        continue;
      }
      if(effect?.kind==="megumi-cancel-next-basic-if-enhancement"){
        if(hasActiveEnhancement(this.state,attack.attacker)){
          this.state[`p${attack.defender}_megumi_cancel_next_basic`]=true;
          events.push({kind:"基本動作無効予約",playerId:attack.defender,source:attack.label});
        }
        continue;
      }
      if(effect?.kind==="raira-flow-return"){
        const pid=Number(attack.attacker),candidates=arr(this.state?.[`p${pid}_discard`]).filter(cardId=>{
          const status=this.state?.[`p${pid}_card_status`]?.[String(cardId)]||{};
          const rule=this.cardRuleRegistry?.get(stateCardSlug(this.state,pid,cardId))?.mainUse;
          return Number(status.MainType)===1 || rule?.kind==="attack-card";
        }).map(String);
        if(!candidates.length) continue;
        this.pendingCardDecision={kind:"raira-flow-return",playerId:pid,label:"流転爪",sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates:["skip",...candidates]};
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:attack.sourceCardId,choice:"流転爪",candidates:clone(this.pendingCardDecision.candidates)});
        return;
      }
      if(effect?.kind==="arrow"){
        const arrow=effect.arrow||{},moved=applyArrowAsMuchAsPossible(this.state,attack.attacker,String(arrow.kind||""),arrow.count??1,this.options);
        events.push({kind:"攻撃後矢印",playerId:attack.attacker,source:attack.label,arrow:String(arrow.kind||""),requested:Math.max(0,n(arrow.count??1)),moved}); continue;
      }
      if(effect?.kind==="chikage-block-basic-advance"){
        this.state[`p${attack.defender}_chikage_no_basic_advance`]=true;
        events.push({kind:"基本動作制限",playerId:attack.defender,source:attack.label,basicAction:1}); continue;
      }
      if(effect?.kind==="chikage-send-poison"){
        const owner=Number(attack.attacker),target=Number(attack.defender),candidates=this._chikagePoisonBagCards(owner,effect.allowed);
        if(!candidates.length) continue;
        this.pendingCardDecision={kind:"chikage-attack-poison",playerId:owner,label:attack.label,sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates:clone(candidates),bagOwner:owner,targetPlayer:target,destination:String(effect.destination||"deck-top")};
        this.phase="start-card-choice"; events.push({kind:"選択待ち",playerId:owner,cardId:attack.sourceCardId,choice:"毒",candidates:clone(candidates)}); return;
      }
      if(effect?.kind==="chikage-anki"){
        const owner=Number(attack.attacker),target=Number(attack.defender);
        if(attack.chikageAnkiFullPower){
          const candidates=this._chikagePoisonBagCards(owner,[]);
          if(candidates.length){
            this.pendingCardDecision={kind:"chikage-anki-poison",playerId:target,label:attack.label,sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates:clone(candidates),bagOwner:owner,targetPlayer:target,destination:"hand"};
            this.phase="start-card-choice"; events.push({kind:"選択待ち",playerId:target,cardId:attack.sourceCardId,choice:"暗器・毒",candidates:clone(candidates)}); return;
          }
        }
        if(this._chikageHandHasPoison(target)) this._applyEffectMatoi(owner,events,"暗器");
        continue;
      }
      if(effect?.kind==="thallya-ride"){
        this._requestThallyaRide(
          attack.attacker,events,
          {kind:"attack-after",sourceCardId:attack.sourceCardId},
          {optional:!!effect.optional,source:String(effect.source||attack.label)}
        );
        return;
      }
      if(effect?.kind==="thallya-steam-cannon-recover"){
        if(!attack.thallyaSteamCannonFullPower) this._thallyaRecover(attack.attacker,2,events,"Steam Cannon");
        continue;
      }
      if(effect?.kind==="thallya-dual-action"){
        this._requestThallyaRide(
          attack.attacker,events,
          {kind:"dual-after-ride",playerId:attack.attacker,sourceCardId:attack.sourceCardId},
          {optional:true,source:"Dual Action"}
        );
        return;
      }
      if(effect?.kind==="yukihi-shikomibi-return-toggle"){
        const attacker=Number(attack.attacker),owner=[1,2].includes(Number(attack.sourceOwnerId))?Number(attack.sourceOwnerId):attacker;
        const id=String(attack.sourceCardId),usingKey="p"+attacker+"_using",handKey="p"+owner+"_hand";
        this.state[usingKey]=arr(this.state[usingKey]); this.state[handKey]=arr(this.state[handKey]);
        const index=this.state[usingKey].findIndex(cardId=>String(cardId)===id);
        if(index>=0){const moved=this.state[usingKey].splice(index,1)[0];this.state[handKey].push(moved);events.push({kind:"手札へ戻す",playerId:owner,cardId:moved,source:attack.label});}
        this._toggleYukihiUmbrella(attacker,events,attack.label,{kind:"attack-after"});
        return;
      }
      if(effect?.kind==="yukihi-furiharai-move"){
        if(effect.open){
          const moved=applyArrowAsMuchAsPossible(this.state,attack.attacker,"distance-to-dust",2,this.options);
          events.push({kind:"攻撃後矢印",playerId:attack.attacker,source:attack.label,arrow:"distance-to-dust",requested:2,moved});
          continue;
        }
        this.pendingCardDecision={kind:"yukihi-attack-after-arrow",playerId:Number(attack.attacker),label:"ふりはらい",sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates:["distance-to-dust","dust-to-distance"]};
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:attack.attacker,cardId:attack.sourceCardId,choice:"前進または後退",candidates:clone(this.pendingCardDecision.candidates)});
        return;
      }
      if(effect?.kind==="freeze-opponent"){
        this._freezePlayer(attack.defender,effect.count??1,events,attack.label);
        continue;
      }
      if(effect?.kind==="freeze-opponent-if-aura-damage-chosen"){
        if(String(attack.lastDamageChoice)==="aura"){
          if(effect.untilFull) this._freezeUntilAuraFull(attack.defender,events,attack.label);
          else this._freezePlayer(attack.defender,effect.count??1,events,attack.label);
        }
        continue;
      }
      if(effect?.kind==="shinra-plan"){
        this._beginShinraPlanEffect(attack.attacker,attack.sourceCardId,attack.sourceSlug,effect.planEffects,{kind:"attack-after"},events);
        return;
      }
      if(effect?.kind==="cancel-parent-attack"){
        const parent=this.attackStack.at(-1)||null;
        this._tryCancelAttack(parent,attack.label,events);
        continue;
      }
      if(effect?.kind==="cancel-parent-if-focus-2-and-parent-not-special"){
        const parent=this.attackStack.at(-1)||null;
        const focus=n(this.state?.[`p${attack.attacker}_focus`]);
        if(parent && focus===2 && parent.classification!=="special"){
          this._tryCancelAttack(parent,attack.label,events);
        }
        continue;
      }
      if(effect?.kind==="cancel-parent-damage-if-aura-present-and-parent-not-special"){
        const parent=this.attackStack.at(-1)||null;
        if(parent && parent.classification!=="special" && parent.auraDamage!=null){
          this._tryCancelAttackDamage(parent,attack.label,events);
        }
        continue;
      }
      if(effect?.kind==="modify-parent-damage"){
        const parent=this.attackStack.at(-1)||null;
        if(parent){
          if(parent.auraDamage!=null) parent.auraDamage=Math.max(0,n(parent.auraDamage)+n(effect.auraDelta));
          if(parent.lifeDamage!=null) parent.lifeDamage=Math.max(0,n(parent.lifeDamage)+n(effect.lifeDelta));
          events.push({
            kind:"対応攻撃後ダメージ修正",
            source:attack.label,
            target:parent.label,
            auraDamage:parent.auraDamage,
            lifeDamage:parent.lifeDamage
          });
        }
        continue;
      }
      if(effect?.kind==="grant-next-attack-if-attacker-life-at-most"){
        const life=n(this.state?.[`p${attack.attacker}_life`]);
        if(life<=n(effect.value)){
          this.nextAttackModifiers[attack.attacker]=arr(this.nextAttackModifiers?.[attack.attacker]);
          this.nextAttackModifiers[attack.attacker].push({
            auraDelta:n(effect.auraDelta),
            lifeDelta:n(effect.lifeDelta),
            source:attack.label,
            label:String(effect.label||"次の攻撃")
          });
          events.push({kind:"次の攻撃修正予約",playerId:attack.attacker,source:attack.label,auraDelta:n(effect.auraDelta),lifeDelta:n(effect.lifeDelta)});
        }
        continue;
      }
      if(effect?.kind==="generated-attack-if-attacker-aura-at-most"){
        const attacker=Number(attack.attacker);
        if(n(this.state?.[`p${attacker}_aura`])<=n(effect.value)){
          const parent=this.pendingAttack;
          this.attackStack.push(parent);
          this.pendingAttack=null;
          const attackSpec={
            ...(effect.attack||{}),
            sourceCardId:parent.sourceCardId,
            sourceSlug:parent.sourceSlug,
            classification:null,
            attacker
          };
          const started=this._beginGeneratedAttack(attackSpec,events,{kind:"attack-after-generated"});
          if(started.pending||this.done) return;
          this.pendingAttack=this.attackStack.pop()||null;
          if(!this.pendingAttack) throw new Error("generated after-effect finished without parent attack");
        }
        continue;
      }
      if(effect?.kind==="arrow-if-attacker-aura-at-most"){
        const attacker=Number(attack.attacker);
        if(n(this.state?.[`p${attacker}_aura`])<=n(effect.value)){
          const arrow=effect.arrow||{};
          const moved=applyArrowAsMuchAsPossible(
            this.state,
            attacker,
            String(arrow.kind||""),
            arrow.count??1,
            this.options
          );
          events.push({
            kind:"攻撃後矢印",
            playerId:attacker,
            source:attack.label,
            condition:String(effect.label||""),
            arrow:String(arrow.kind||""),
            requested:Math.max(0,n(arrow.count??1)),
            moved
          });
        }
        continue;
      }
      if(effect?.kind==="self-life-to-distance"){
        const attacker=Number(attack.attacker);
        const requested=Math.max(0,Math.floor(n(effect.count??1)));
        const room=Math.max(0,n(this.options.distanceLimit)-n(this.state.distance));
        const moved=Math.min(requested,Math.max(0,n(this.state?.[`p${attacker}_life`])),room);
        if(moved>0){
          this.state[`p${attacker}_life`]=n(this.state[`p${attacker}_life`])-moved;
          this.state.distance=n(this.state.distance)+moved;
        }
        events.push({kind:"攻撃後移動",playerId:attacker,source:attack.label,from:"life",to:"distance",requested,moved});
        if(this._setLossIfNeeded(attacker,"life-zero-effect-move")) return;
        continue;
      }
      if(effect?.kind==="return-source-to-deck-top-if-focus-is"){
        const attacker=Number(attack.attacker);
        if(n(this.state?.[`p${attacker}_focus`])===n(effect.value)){
          const usingKey=`p${attacker}_using`,deckKey=`p${attacker}_deck`,id=String(attack.sourceCardId);
          this.state[usingKey]=arr(this.state[usingKey]);
          this.state[deckKey]=arr(this.state[deckKey]);
          const index=this.state[usingKey].findIndex(cardId=>String(cardId)===id);
          if(index>=0){
            const [moved]=this.state[usingKey].splice(index,1);
            this.state[deckKey].unshift(moved);
            events.push({kind:"山札の上へ",playerId:attacker,cardId:moved,source:attack.label});
          }
        }
        continue;
      }
      if(effect?.kind==="arrow"){
        const arrow=effect.arrow||{};
        const moved=applyArrowAsMuchAsPossible(this.state,attack.attacker,String(arrow.kind||""),arrow.count??1,this.options);
        events.push({kind:"攻撃後矢印",playerId:attack.attacker,source:attack.label,arrow:String(arrow.kind||""),requested:Math.max(0,n(arrow.count??1)),moved});
        continue;
      }
      if(effect?.kind==="reconstruct-self-no-damage"){
        const attacker=Number(attack.attacker);
        this._beginReconstructionSequence(attacker,events,{takeLifeDamage:false,pendingDraws:0,resumeKind:"attack-after"});
        return;
      }
      if(effect?.kind==="opponent-discard-one-non-attack-or-reveal"){
        const opponent=Number(attack.defender);
        const candidates=arr(this.state?.[`p${opponent}_hand`]).filter(cardId=>{
          const st=this.state?.[`p${opponent}_card_status`]?.[String(cardId)]||{};
          return Number(st.MainType)!==1;
        });
        if(!candidates.length){
          events.push({kind:"手札公開",playerId:opponent,cards:clone(arr(this.state?.[`p${opponent}_hand`])),source:attack.label});
          continue;
        }
        this.pendingCardDecision={
          kind:"opponent-discard-non-attack",
          playerId:opponent,
          label:"非攻撃札",
          sourceCardId:attack.sourceCardId,
          slug:attack.sourceSlug,
          candidates:clone(candidates)
        };
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:opponent,choice:"非攻撃札",candidates:clone(candidates)});
        return;
      }
      if(effect?.kind==="opponent-discard-one-if-distance-delta-at-least"){
        const delta=Math.abs(n(this.state.distance)-n(this.turnStartDistance));
        if(delta>=n(effect.value)){
          const opponent=Number(attack.defender),hand=arr(this.state?.[`p${opponent}_hand`]);
          if(hand.length===1){
            const cardId=hand[0],handKey=`p${opponent}_hand`,discardKey=`p${opponent}_discard`;
            this.state[handKey]=arr(this.state[handKey]); this.state[discardKey]=arr(this.state[discardKey]);
            this.state[handKey].splice(0,1); this.state[discardKey].push(cardId);
            events.push({kind:"手札破棄",playerId:opponent,cardId,source:attack.label});
          }else if(hand.length>1){
            this.pendingCardDecision={kind:"opponent-discard-one",playerId:opponent,label:"手札",sourceCardId:attack.sourceCardId,slug:attack.sourceSlug,candidates:clone(hand)};
            this.phase="start-card-choice";
            events.push({kind:"選択待ち",playerId:opponent,choice:"手札破棄",candidates:clone(hand)});
            return;
          }
        }
        continue;
      }
      if(effect?.kind==="set-opponent-focus"){
        const opponent=Number(attack.defender);
        this.state[`p${opponent}_focus`]=Math.max(0,Math.min(2,n(effect.value)));
        events.push({kind:"集中力",playerId:opponent,value:this.state[`p${opponent}_focus`],reason:"攻撃後"});
        continue;
      }
      if(effect?.kind==="intimidate-opponent"){
        const opponent=Number(attack.defender);
        this.state[`p${opponent}_intimidated`]=true;
        events.push({kind:"畏縮",playerId:opponent,source:attack.label});
        continue;
      }
      if(effect?.kind==="intimidate-opponent-if-used-from-facedown"){
        if(attack.usedFromFacedown){
          this.state[`p${attack.defender}_intimidated`]=true;
          events.push({kind:"畏縮",playerId:attack.defender,source:attack.label});
        }
        continue;
      }
      if(effect?.kind==="optional-hand-facedown-then-generated-attack-and-matoi"){
        const attacker=Number(attack.attacker);
        const candidates=arr(this.state?.[`p${attacker}_hand`]).map(String);
        if(!candidates.length) continue;
        this.pendingCardDecision={
          kind:"bunshin-hand",
          playerId:attacker,
          label:"手札",
          sourceCardId:attack.sourceCardId,
          slug:attack.sourceSlug,
          candidates:["done",...candidates],
          effect:clone(effect)
        };
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:attacker,cardId:attack.sourceCardId,choice:"手札から伏せ札",candidates:clone(this.pendingCardDecision.candidates)});
        return;
      }
      if(effect?.kind==="repeat-generated-attack-own-facedown-count"){
        const attacker=Number(attack.attacker);
        const count=arr(this.state?.[`p${attacker}_facedown`]).length;
        if(count<=0) continue;
        attack.repeatAttackState={remaining:count,attack:clone(effect.attack||{})};
        events.push({kind:"追加攻撃回数",playerId:attacker,source:attack.label,count});
        this._beginNextRepeatedAttack(attack,events);
        return;
      }
      if(effect?.kind==="opponent-draw"){
        if(!this._drawForAttackAfter(attack.defender,effect.count??1,events)) return;
        continue;
      }
      const resolved=this._ruleHook("handleAttackAfterEffects",{events,attack:this.pendingAttack,afterEffects:[clone(effect)]});
      if(resolved.stop||this.done) return;
      if(!resolved.handled){
        this.done=true;
        this.doneReason="unsupported-attack-after-effect";
        events.push({kind:"未対応",reason:"攻撃後効果",label:attack.label,afterEffects:[clone(effect)]});
        return;
      }
    }
    this._finishPendingAttack(events);
  }
  _resolveInstantRechargeAfterLifeChange(playerId,beforeLife,afterLife,events){
    const pid=Number(playerId),before=n(beforeLife),after=n(afterLife);
    const statusMap=this.state?.[`p${pid}_special_status`]||{};
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      if(Number(statusMap[String(cardId)]||0)!==2) continue;
      const slug=stateCardSlug(this.state,pid,cardId);
      const recharge=this.cardRuleRegistry?.get(slug)?.instantRecharge;
      if(!recharge) continue;
      if(recharge.kind==="opponent-aura-space-to-none") continue;
      if(recharge.kind==="self-life-cross-at-most"){
        const threshold=n(recharge.value);
        if(before>threshold && after<=threshold){
          statusMap[String(cardId)]=0;
          events.push({
            kind:"即再起",
            playerId:pid,
            cardId,
            slug,
            condition:"life-cross-at-most",
            beforeLife:before,
            afterLife:after,
            threshold
          });
        }
        continue;
      }
      throw new Error(`unsupported instant recharge rule: ${recharge.kind}`);
    }
  }
  _applyLifeDamageWithTriggers(playerId,amount,events,reason=""){
    const pid=Number(playerId),before=n(this.state?.[`p${pid}_life`]);
    const applied=applyLifeDamage(this.state,pid,amount);
    const after=n(this.state?.[`p${pid}_life`]);
    if(applied>0){
      this._resolveInstantRechargeAfterLifeChange(pid,before,after,events);
      this._failChikageLivingWayOnLifeDamage(pid,events,reason);
    }
    return applied;
  }
  _resolveGapAfterLifeDamage(playerId,events){
    const pid=Number(playerId),enhKey=`p${pid}_enhancement`,facedownKey=`p${pid}_facedown`;
    this.state[enhKey]=arr(this.state[enhKey]);
    this.state[facedownKey]=arr(this.state[facedownKey]);
    const targets=this.state[enhKey].filter(cardId=>{
      if(this._isEnhancementDiscardResolving(cardId)) return false;
      const slug=stateCardSlug(this.state,pid,cardId);
      return !!this.cardRuleRegistry?.get(slug)?.gap;
    });
    for(const cardId of targets){
      const id=String(cardId),slug=stateCardSlug(this.state,pid,cardId),status=this.state?.[`p${pid}_card_status`]?.[id]||{};
      const tokenCharges=positiveTokenChargeMap(status)||{};
      const crystals=Object.keys(tokenCharges).length
        ? Object.values(tokenCharges).reduce((sum,x)=>sum+n(x),0)
        : Math.max(0,n(status.Charge));
      const seeds=Math.max(0,n(tokenCharges["19"]));
      const sakuraAndOther=Math.max(0,crystals-seeds);
      const index=this.state[enhKey].findIndex(x=>String(x)===id);
      if(index<0) continue;
      const [moved]=this.state[enhKey].splice(index,1);
      this.state[facedownKey].push(moved);
      if(sakuraAndOther>0) this.state.dust=n(this.state.dust)+sakuraAndOther;
      if(seeds>0) returnMegumiSeedsToSoil(this.state,pid,seeds);
      status.Charge=0;
      status.TokenCharges={};
      events.push({kind:"隙",playerId:pid,cardId,crystalsToDust:sakuraAndOther,seedsToSoil:seeds,destination:"facedown"});
      if(slug==="re_19_megumi_o_n_5"){
        const opponent=pid===1?2:1;
        this.state[`p${opponent}_intimidated`]=true;
        events.push({kind:"畏縮",playerId:opponent,source:"鳳仙花"});
      }
    }
  }
  _applyAuraDamageWithEnhancements(playerId,amount,option,events){
    const pid=Number(playerId),requested=Math.max(0,n(amount));
    const sources=silentWallSources(this.state,pid);
    const wallAvailable=sources.reduce((sum,row)=>sum+n(row.sakura),0);
    const wallUse=Math.min(Math.max(0,Math.floor(n(option?.silentWallUse))),wallAvailable,requested);
    const totalAvailable=n(this.state?.[`p${pid}_aura`])+wallAvailable;
    const target=Math.min(requested,totalAvailable);
    const auraUse=target-wallUse;
    if(auraUse<0 || auraUse>n(this.state?.[`p${pid}_aura`])) throw new Error("illegal silent wall damage allocation");
    this.state[`p${pid}_aura`]=n(this.state[`p${pid}_aura`])-auraUse;
    this.state.dust=n(this.state.dust)+auraUse;
    let remaining=wallUse;
    for(const row of sources){
      if(remaining<=0) break;
      const take=Math.min(remaining,n(row.sakura));
      const status=row.status;
      const tokenCharges=positiveTokenChargeMap(status)||{};
      const beforeSakura=Object.prototype.hasOwnProperty.call(tokenCharges,"1") ? n(tokenCharges["1"]) : n(status.Charge);
      if(take>beforeSakura) throw new Error("silent wall has insufficient Sakura crystals");
      tokenCharges["1"]=Math.max(0,beforeSakura-take);
      status.TokenCharges=tokenCharges;
      status.Charge=Math.max(0,n(status.Charge)-take);
      this.state.dust=n(this.state.dust)+take;
      remaining-=take;
      if(n(status.Charge)<=0){
        const moved=finishEnhancementDiscard(this.state,pid,row.cardId);
        events.push({kind:"付与札の破棄完了",playerId:pid,cards:[{cardId:row.cardId,...moved}]});
        this._onEnhancementDiscarded(pid,row.cardId,events);
      }
    }
    if(remaining!==0) throw new Error("silent wall damage allocation did not fully resolve");
    return {applied:auraUse+wallUse,silentWallUsed:wallUse};
  }
  _applyAttackDamage(option,events){
    const attack=this.pendingAttack;
    if(!attack) throw new Error("missing pending attack");
    const defender=Number(attack.defender),beforeDefenderAura=n(this.state?.[`p${defender}_aura`]);
    const damageOption=typeof option==="string"?{choice:option,silentWallUse:0}:(option||{});
    const choice=String(damageOption.choice||"");
    attack.lastDamageChoice=choice;
    let amount=0,silentWallUsed=0;
    if(choice==="aura"){
      if(attack.auraDamage!=null) this.auraDamageTakenThisTurn[defender]=true;
      const applied=attack.damageDestination==="distance"
        ? {applied:Math.min(Math.max(0,n(attack.auraDamage??0)),Math.max(0,n(this.state?.[`p${defender}_aura`]))),silentWallUsed:0}
        : this._applyAuraDamageWithEnhancements(defender,attack.auraDamage??0,damageOption,events);
      if(attack.damageDestination==="distance" && applied.applied>0){
        this.state[`p${defender}_aura`]=n(this.state[`p${defender}_aura`])-applied.applied;
        this.state.distance=n(this.state.distance)+applied.applied;
      }
      amount=applied.applied;
      silentWallUsed=applied.silentWallUsed;
      events.push({
        kind:"攻撃ダメージ",
        attacker:attack.attacker,
        defender,
        label:attack.label,
        choice:"aura",
        requested:attack.auraDamage,
        applied:amount,
        silentWallUsed
      });
    }else if(choice==="life"){
      if(attack.damageDestination==="distance"){
        const before=n(this.state?.[`p${defender}_life`]);
        amount=Math.min(before,Math.max(0,n(attack.lifeDamage??0)));
        this.state[`p${defender}_life`]=before-amount;
        this.state.distance=n(this.state.distance)+amount;
        if(amount>0){
          this._resolveInstantRechargeAfterLifeChange(defender,before,before-amount,events);
          this._failChikageLivingWayOnLifeDamage(defender,events,"attack");
        }
      }else{
        amount=this._applyLifeDamageWithTriggers(defender,attack.lifeDamage??0,events,"attack");
      }
      events.push({
        kind:"攻撃ダメージ",
        attacker:attack.attacker,
        defender,
        label:attack.label,
        choice:"life",
        requested:attack.lifeDamage,
        applied:amount,
        silentWallUsed:0
      });
    }else if(choice==="both"){
      if(attack.auraDamage!=null) this.auraDamageTakenThisTurn[defender]=true;
      const auraApplied=this._applyAuraDamageWithEnhancements(defender,attack.auraDamage??0,damageOption,events);
      events.push({
        kind:"攻撃ダメージ",
        attacker:attack.attacker,
        defender,
        label:attack.label,
        choice:"aura",
        requested:attack.auraDamage,
        applied:auraApplied.applied,
        silentWallUsed:auraApplied.silentWallUsed
      });
      const lifeApplied=this._applyLifeDamageWithTriggers(defender,attack.lifeDamage??0,events,"attack");
      events.push({
        kind:"攻撃ダメージ",
        attacker:attack.attacker,
        defender,
        label:attack.label,
        choice:"life",
        requested:attack.lifeDamage,
        applied:lifeApplied,
        silentWallUsed:0
      });
      amount={aura:auraApplied.applied,life:lifeApplied};
      silentWallUsed=auraApplied.silentWallUsed;
      if(this._setLossIfNeeded(defender,"life-zero-attack")) return;
      if(lifeApplied>0) this._resolveGapAfterLifeDamage(defender,events);
    }else{
      throw new Error("invalid attack damage choice");
    }
    if(choice==="life"){
      if(this._setLossIfNeeded(defender,"life-zero-attack")) return;
      if(amount>0) this._resolveGapAfterLifeDamage(defender,events);
    }
    this._queueYurinaAunAuraChange(defender,beforeDefenderAura,n(this.state?.[`p${defender}_aura`]),events,`攻撃ダメージ:${attack.label}`);
    const after=this._ruleHook("afterAttackDamage",{events,attack:this.pendingAttack,choice,applied:amount});
    if(after.stop||this.done) return;
    this._resolveAttackAfterEffects(events);
  }
  _applyDynamicAttackModifiers(attack,events){
    if(!attack||attack.dynamicModifiersApplied) return;
    for(const mod of arr(attack.dynamicModifiers)){
      if(mod?.kind==="megumi-if-soil-unbloomed-empty"){
        if(n(this.state?.[`p${attack.attacker}_megumi_soil_unbloomed`])<=0){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        }
        continue;
      }
      if(mod?.kind==="megumi-if-seed-on-enhancement"){
        if(megumiSeedCountOnEnhancements(this.state,attack.attacker)>0){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        }
        continue;
      }
      if(mod?.kind==="distance-delta-as-damage"){
        const delta=Math.abs(n(this.state.distance)-n(this.turnStartDistance));
        const addAura=Math.max(0,n(attack.auraDamage)),addLife=Math.max(0,n(attack.lifeDamage));
        const baseAura=attack.shinraDamageSwapped?Math.ceil(delta/2):delta;
        const baseLife=attack.shinraDamageSwapped?delta:Math.ceil(delta/2);
        attack.auraDamage=baseAura+addAura;
        attack.lifeDamage=baseLife+addLife;
        events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),distanceDelta:delta,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage,shinraDamageSwapped:!!attack.shinraDamageSwapped});
        continue;
      }
      if(mod?.kind==="raira-min-gauge-aura"){
        const wind=this._rairaGaugeValue(attack.attacker,"wind"),thunder=this._rairaGaugeValue(attack.attacker,"thunder");
        attack.auraDamage=Math.min(wind,thunder);
        events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),wind,thunder,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        continue;
      }
      if(mod?.kind==="if-raira-thunder-at-least"){
        const thunder=this._rairaGaugeValue(attack.attacker,"thunder");
        if(thunder>=n(mod.value)){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),thunder,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        }
        continue;
      }
      if(mod?.kind==="if-defender-aura-no-space"){
        const defender=Number(attack.defender);
        if(this._auraHasNoSpace(defender)){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),defenderAuraNoSpace:true,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        }
        continue;
      }
      if(mod?.kind==="if-attacker-life-at-most"){
        const life=n(this.state?.[`p${attack.attacker}_life`]);
        if(life<=n(mod.value)){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({
            kind:"攻撃常時修正",
            label:attack.label,
            condition:String(mod.label||mod.kind),
            attackerLife:life,
            auraDamage:attack.auraDamage,
            lifeDamage:attack.lifeDamage
          });
        }
        continue;
      }
      if(mod?.kind==="if-distance-at-most"){
        const distance=n(this.state.distance);
        if(distance<=n(mod.value)){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({
            kind:"攻撃常時修正",
            label:attack.label,
            condition:String(mod.label||mod.kind),
            distance,
            auraDamage:attack.auraDamage,
            lifeDamage:attack.lifeDamage
          });
        }
        continue;
      }
      if(mod?.kind==="if-used-from-facedown"){
        if(attack.usedFromFacedown){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),usedFromFacedown:true,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        }
        continue;
      }
      if(mod?.kind==="if-defender-aura-damaged-this-turn"){
        const defender=Number(attack.defender);
        if(!!this.auraDamageTakenThisTurn?.[defender]){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),defenderAuraDamagedThisTurn:true,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        }
        continue;
      }
      if(mod?.kind==="if-attacker-focus-is"){
        const focus=n(this.state?.[`p${attack.attacker}_focus`]);
        if(focus===n(mod.value)){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({kind:"攻撃常時修正",label:attack.label,condition:String(mod.label||mod.kind),attackerFocus:focus,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
        }
        continue;
      }
      if(mod?.kind==="if-card-use-count-at-least"){
        const count=Math.max(0,n(this.cardUseCountsThisTurn?.[attack.attacker]));
        if(count>=n(mod.value)){
          if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
          if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
          events.push({
            kind:"攻撃常時修正",
            label:attack.label,
            condition:String(mod.label||mod.kind),
            cardUseCount:count,
            auraDamage:attack.auraDamage,
            lifeDamage:attack.lifeDamage
          });
        }
        continue;
      }
      throw new Error(`unsupported dynamic attack modifier: ${mod?.kind}`);
    }
    attack.dynamicModifiersApplied=true;
  }
  _advanceAttackAfterResponse(events){
    const attack=this.pendingAttack;
    if(!attack) throw new Error("missing pending attack");
    if(attack.canceled){
      events.push({
        kind:"攻撃失敗",
        reason:"打ち消し",
        label:attack.label,
        skipped:["ダメージ","攻撃後効果"]
      });
      this._finishPendingAttack(events);
      return;
    }
    if(!attack.unavoidable && !attackInRange(this.state,attack)){
      events.push({kind:"攻撃失敗",reason:"対応後に適正距離外",label:attack.label,distance:n(this.state.distance)});
      this._finishPendingAttack(events);
      return;
    }
    this._applyDynamicAttackModifiers(attack,events);
    this._applyChikageBannerDamage(attack,events);
    this._applyAttackDamageBounds(attack,events);
    if(attack.damageCanceled){
      events.push({kind:"攻撃ダメージ打ち消し",label:attack.label});
      this._resolveAttackAfterEffects(events);
      return;
    }
    if(attack.damageReplacement?.kind==="opponent-deck-to-facedown-if-at-least"){
      const opponent=Number(attack.defender);
      if(arr(this.state?.[`p${opponent}_deck`]).length>=n(attack.damageReplacement.deckCount)){
        this._moveOpponentDeckToFacedown(attack.attacker,attack.damageReplacement.count??1,events,attack.label);
        events.push({kind:"攻撃ダメージ置換",label:attack.label,replacement:"山札から伏せ札"});
        this._resolveAttackAfterEffects(events);
        return;
      }
    }
    const choices=attackDamageOptions(this.state,attack);
    if(!choices.length){
      events.push({kind:"攻撃ダメージなし",label:attack.label});
      this._resolveAttackAfterEffects(events);
      return;
    }
    if(choices.length===1){
      this._applyAttackDamage(choices[0],events);
      return;
    }
    this.phase="attack-damage-choice";
    events.push({kind:"ダメージ選択待ち",defender:attack.defender,label:attack.label,choices:clone(choices)});
  }
  _isEnhancementDiscardResolving(cardId){
    const id=String(cardId);
    const attacks=[this.pendingAttack,...arr(this.attackStack)].filter(Boolean);
    const discardKinds=new Set([
      "enhancement-discard",
      "enhancement-discard-then-arrow",
      "main-enhancement-discard",
      "main-enhancement-discard-then-arrow",
      "response-enhancement-discard-then-arrow"
    ]);
    return attacks.some(attack=>{
      const resume=attack?.resume;
      return discardKinds.has(String(resume?.kind||"")) && String(resume?.cardId??"")===id;
    });
  }
  _activeEnhancementBySlug(playerId,slug){
    const pid=Number(playerId),target=normalizeCardSlug(slug);
    for(const cardId of arr(this.state?.[`p${pid}_enhancement`])){
      if(this._isEnhancementDiscardResolving(cardId)) continue;
      if(stateCardSlug(this.state,pid,cardId)!==target) continue;
      const status=this.state?.[`p${pid}_card_status`]?.[String(cardId)]||{};
      const tokenCharges=positiveTokenChargeMap(status)||{};
      const total=Object.keys(tokenCharges).length
        ? Object.values(tokenCharges).reduce((sum,x)=>sum+n(x),0)
        : Math.max(0,n(status.Charge));
      if(total>0) return {cardId,status,total};
    }
    return null;
  }
  _applyFirstAttackOngoingModifiers(attack,events){
    const attacker=Number(attack?.attacker),defender=Number(attack?.defender);
    const count=Math.max(0,n(this.attackCountsThisTurn?.[attacker]));
    if(count===0){
      const pressure=this._activeEnhancementBySlug(defender,"re_01_yurina_o_n_6");
      if(pressure){
        if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)-1);
        events.push({
          kind:"展開中攻撃修正",
          source:"圧気",
          sourceCardId:pressure.cardId,
          playerId:defender,
          target:attack.label,
          attacker,
          auraDamage:attack.auraDamage,
          lifeDamage:attack.lifeDamage
        });
      }
    }
    this.attackCountsThisTurn[attacker]=count+1;
    events.push({kind:"ターン内攻撃回数",playerId:attacker,count:this.attackCountsThisTurn[attacker]});
    if(count===1){
      const reflector=this._kururuActiveReflector(defender);
      if(reflector && this._tryCancelAttack(attack,"りふれくた",events)) attack.responseForbidden=true;
    }
  }
  _applyActiveEnhancementAttackModifiers(attack,events){
    const attacker=Number(attack?.attacker);
    const sourceMegami=attackSourceMegamiFromSlug(attack?.sourceSlug);
    const frost=this._activeEnhancementBySlug(attacker,"re_15_korunu_o_n_7");
    const nonSpecialCount=Math.max(0,n(this.nonSpecialAttackCountsThisTurn?.[attacker]));
    if(attack.classification!=="special" && attacker===this.turnPlayer){
      if(frost && nonSpecialCount===0){
        if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+1);
        if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+1);
        events.push({kind:"展開中攻撃修正",source:"霜の茨",sourceCardId:frost.cardId,playerId:attacker,target:attack.label,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
      }
      this.nonSpecialAttackCountsThisTurn[attacker]=nonSpecialCount+1;
      events.push({kind:"ターン内非切札攻撃回数",playerId:attacker,count:this.nonSpecialAttackCountsThisTurn[attacker]});
    }
    const kien=this._activeEnhancementBySlug(attacker,"re_01_yurina_o_n_7");
    if(kien && n(this.state?.[`p${attacker}_life`])<=3 && sourceMegami && !attackSourceIsYurina(attack)){
      if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+1);
      if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+1);
      attack.overcome=true;
      events.push({
        kind:"展開中攻撃修正",
        source:"気炎万丈",
        sourceCardId:kien.cardId,
        playerId:attacker,
        target:attack.label,
        sourceMegami,
        auraDamage:attack.auraDamage,
        lifeDamage:attack.lifeDamage,
        overcome:true
      });
    }
    const palm=this._activeEnhancementBySlug(attacker,"re_19_megumi_o_s_4");
    if(palm && !this.megumiPalmUsedThisTurn?.[attacker] && attack.auraDamage!=null && n(attack.auraDamage)<=3){
      attack.auraDamage=Math.max(0,n(attack.auraDamage)+1);
      if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+1);
      this.megumiPalmUsedThisTurn[attacker]=true;
      events.push({kind:"展開中攻撃修正",source:"瀧河希の掌",sourceCardId:palm.cardId,playerId:attacker,target:attack.label,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
    }
  }
  _applyChikageBannerDamage(attack,events){
    const hanki=activeEnhancementRowsBySlug(this.state,"re_09_chikage_o_s_2");
    if(hanki.length && attack?.lifeDamage!=null){
      attack.auraDamage=Math.max(0,n(attack.lifeDamage));
      events.push({kind:"展開中攻撃修正",source:"叛旗の纏毒",sourceCardId:hanki[0].cardId,target:attack.label,auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
    }
  }
  _applyAttackDamageBounds(attack,events){
    if(!attack) return;
    if(attack.auraDamage!=null){
      const before=n(attack.auraDamage);
      const after=attack.overcome?Math.max(0,before):Math.min(5,Math.max(0,before));
      attack.auraDamage=after;
      if(after!==before){
        events.push({kind:"攻撃ダメージ上限",label:attack.label,before,after,overcome:!!attack.overcome});
      }
    }
    if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage));
  }
  _applyQueuedAttackModifiers(attack,events){
    const pid=Number(attack?.attacker),queue=arr(this.nextAttackModifiers?.[pid]);
    if(!queue.length) return;
    const index=queue.findIndex(x=>String(x?.kind||"damage")!=="range-expansion");
    if(index<0) return;
    const [mod]=queue.splice(index,1);
    this.nextAttackModifiers[pid]=queue;
    if(mod.kind==="response-lock"){
      attack.responseForbiddenClassifications=[...new Set([...arr(attack.responseForbiddenClassifications),"normal"])];
      events.push({kind:"次の攻撃修正",playerId:pid,source:String(mod.source||""),target:attack.label,responseForbiddenClassifications:["normal"],range:clone(attack.range)});
      return;
    }
    if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
    if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
    events.push({
      kind:"次の攻撃修正",
      playerId:pid,
      source:String(mod.source||""),
      target:attack.label,
      auraDamage:attack.auraDamage,
      lifeDamage:attack.lifeDamage
    });
  }
  _applyNextOtherMegamiAttackModifiers(attack,events){
    const pid=Number(attack?.attacker),queue=arr(this.nextOtherMegamiAttackModifiers?.[pid]);
    if(!queue.length) return;
    const sourceMegami=attackSourceMegamiFromSlug(attack?.sourceSlug);
    if(!sourceMegami || attack.auraDamage==null) return;
    const matched=[],remaining=[];
    for(const mod of queue){
      if(String(mod.excludedMegami||"")===sourceMegami) remaining.push(mod);
      else matched.push(mod);
    }
    if(!matched.length) return;
    this.nextOtherMegamiAttackModifiers[pid]=remaining;
    for(const mod of matched){
      if(attack.auraDamage!=null) attack.auraDamage=Math.max(0,n(attack.auraDamage)+n(mod.auraDelta));
      if(attack.lifeDamage!=null) attack.lifeDamage=Math.max(0,n(attack.lifeDamage)+n(mod.lifeDelta));
      events.push({
        kind:"次の他メガミ攻撃修正",
        playerId:pid,
        source:String(mod.source||""),
        target:attack.label,
        sourceMegami,
        auraDamage:attack.auraDamage,
        lifeDamage:attack.lifeDamage
      });
    }
  }
  _beginGeneratedAttack(spec,events,resume){
    const attacker=Number(spec?.attacker||this.turnPlayer);
    const defender=attacker===1?2:1;
    let attack=normalizeAttackSpec({...spec,attacker,defender});
    const modify=this._ruleHook("modifyGeneratedAttack",{events,attack});
    if(modify.stop||this.done) return {handled:true,pending:true};
    for(const row of modify.results||[]){
      if(row?.result?.attack) attack=normalizeAttackSpec({...attack,...row.result.attack,attacker,defender});
    }
    if(attack.sourceSlug==="re_12_raira_o_n_2"){
      const wind=this._rairaGaugeValue(attacker,"wind"),thunder=this._rairaGaugeValue(attacker,"thunder");
      attack.auraDamage=Math.min(wind,thunder);
      events.push({kind:"攻撃値代入",label:attack.label,source:"風雷撃",wind,thunder,auraDamage:attack.auraDamage});
    }
    if(attack.sourceSlug==="re_12_raira_o_s_1" && this._rairaGaugeValue(attacker,"thunder")>=4){
      attack.auraDamage=Math.max(0,n(attack.auraDamage)+1);
      events.push({kind:"攻撃常時修正",label:attack.label,source:"雷螺風神爪",thunder:this._rairaGaugeValue(attacker,"thunder"),auraDamage:attack.auraDamage,lifeDamage:attack.lifeDamage});
    }
    this._applyShinraDamageSwap(attack,events);
    this._applyQueuedRangeModifierPreview(attack,attacker);
    this._applyYukihiDororiuraFirstAttack(attack,events);
    if(!attackInRange(this.state,attack)){
      events.push({kind:"効果による攻撃不正",label:attack.label,reason:"適正距離外",distance:n(this.state.distance),range:clone(attack.range)});
      return {handled:true,pending:false};
    }
    this._consumeQueuedRangeModifier(attack,events);
    this.attackPerformedInPhase[attacker]=true;
    this._applyFirstAttackOngoingModifiers(attack,events);
    this._applyQueuedAttackModifiers(attack,events);
    this._applyNextOtherMegamiAttackModifiers(attack,events);
    this._applyActiveEnhancementAttackModifiers(attack,events);
    if(arr(attack.responseForbiddenAtDistances).map(Number).includes(effectiveCurrentDistance(this.state))){
      attack.responseForbidden=true;
      events.push({kind:"対応不可",label:attack.label,distance:n(this.state.distance)});
    }
    if(!attack.responseForbidden){
      const unknown=this._unknownPotentiallyLegalResponses(defender);
      if(unknown.length){
        this.done=true;
        this.doneReason="unsupported-response-card";
        events.push({
          kind:"未対応",
          reason:"対応カード効果",
          playerId:defender,
          cardIds:clone(unknown),
          slugs:unknown.map(cardId=>stateCardSlug(this.state,defender,cardId))
        });
        return {handled:true,pending:true};
      }
    }
    this.pendingAttack={...attack,resume:clone(resume||null),responded:false};
    events.push({
      kind:"攻撃開始",
      attacker,
      defender,
      label:attack.label,
      range:clone(attack.range),
      auraDamage:attack.auraDamage,
      lifeDamage:attack.lifeDamage,
      responseForbidden:attack.responseForbidden,
      responseForbiddenAtDistances:clone(attack.responseForbiddenAtDistances),
      responseForbiddenClassifications:clone(attack.responseForbiddenClassifications)
    });
    if(attack.responseForbidden){
      this._advanceAttackAfterResponse(events);
      return {handled:true,pending:true};
    }
    this.phase="attack-response";
    return {handled:true,pending:true};
  }

  _continueStartAfterEnhancements(events){
    if(this.pendingEnhancementTickPlayers?.length){
      this._processNextStartEnhancementTick(events);
      return;
    }
    this.enhancementTickOwner=null;
    if(this.skipFirstStartEnhancementRest){
      this.skipFirstStartEnhancementRest=false;
      this._enterMainPhase(events);
      return;
    }
    this.phase="start-reconstruct";
    const beforeReconstruct=this._ruleHook("beforeReconstructionChoice",{events});
    if(beforeReconstruct.stop||this.done) return;
  }
  _resolveRegisteredEnhancementDiscard(cardId,events){
    const pid=this.pendingEnhancementDiscardOwner||this.enhancementTickOwner||this.turnPlayer;
    const slug=stateCardSlug(this.state,pid,cardId);
    const rule=this.cardRuleRegistry?.get(slug);
    const effect=rule?.enhancementDiscard;
    if(!effect) return {handled:false,pending:false};
    if(effect.kind==="none"){
      events.push({kind:"破棄時効果なし",playerId:pid,cardId,slug});
      return {handled:true,pending:false};
    }
    if(effect.kind==="intimidate-opponent"){
      const opponent=pid===1?2:1;
      this.state[`p${opponent}_intimidated`]=true;
      events.push({kind:"畏縮",playerId:opponent,source:rule?.name||slug});
      return {handled:true,pending:false};
    }
    if(effect.kind==="korunu-porucharto-redeploy"){
      const cost=Math.max(0,n(effect.cost??2));
      if(n(this.state?.[`p${pid}_flare`])<cost){
        events.push({kind:"ポルチャルトー再使用不可",playerId:pid,cardId,cost});
        return {handled:true,pending:false};
      }
      this.pendingCardDecision={
        kind:"korunu-porucharto-redeploy",
        playerId:pid,
        label:"ポルチャルトー",
        sourceCardId:cardId,
        slug,
        candidates:["discard","redeploy"],
        charge:Math.max(0,n(effect.charge??4)),
        cost
      };
      this.phase="start-card-choice";
      events.push({kind:"選択待ち",playerId:pid,cardId,choice:"ポルチャルトー再使用",candidates:["discard","redeploy"]});
      return {handled:true,pending:true};
    }
    if(effect.kind==="shinra-plan"){
      this._beginShinraPlanEffect(pid,cardId,slug,effect.planEffects,{kind:"enhancement-discard-shinra",playerId:pid,cardId},events);
      return {handled:true,pending:true};
    }
    if(effect.kind==="return-sealed-to-owner-discard"){
      this._returnSealedCards(pid,cardId,events);
      return {handled:true,pending:false};
    }
    if(effect.kind==="chikage-living-way-win"){
      if(this._chikageLivingWayCanWin(pid,cardId)){
        this.done=true; this.doneReason="chikage-living-way"; this.winner=pid;
        events.push({kind:"勝利",playerId:pid,reason:"闇昏千影の生きる道"});
      }
      return {handled:true,pending:false};
    }
    if(effect.kind==="lose-game"){
      this.done=true;
      this.doneReason="shinra-adjudication-expired";
      this.winner=pid===1?2:1;
      events.push({kind:"敗北",playerId:pid,reason:"森羅判証の破棄時"});
      return {handled:true,pending:false};
    }
    if(effect.kind==="yukihi-enmusubi-discard"){
      const arrow=this._hasYukihi(pid)&&this._yukihiUmbrellaOpen(pid)?"distance-to-dust":"dust-to-distance";
      const moved=applyArrowAsMuchAsPossible(this.state,pid,arrow,1,this.options);
      events.push({kind:"破棄時矢印",playerId:pid,cardId,source:"えんむすび",arrow,moved});
      return {handled:true,pending:false};
    }
    if(effect.kind==="arrow"){
      const arrow=effect.arrow||{};
      const moved=applyArrowAsMuchAsPossible(this.state,pid,String(arrow.kind||""),arrow.count??1,this.options);
      events.push({kind:"破棄時矢印",playerId:pid,cardId,arrow:String(arrow.kind||""),moved});
      return {handled:true,pending:false};
    }
    if(effect.kind==="generated-attack"){
      const sourceStatus=this.state?.[`p${pid}_card_status`]?.[String(cardId)]||{};
      const attackSpec={
        ...(effect.attack||{}),
        sourceCardId:cardId,
        sourceSlug:slug,
        classification:null,
        sourceCardClassification:sourceStatus.IsSpecial?"special":"normal",
        attacker:pid
      };
      const started=this._beginGeneratedAttack(attackSpec,events,{kind:"enhancement-discard",cardId});
      return {handled:true,pending:!!started.pending};
    }
    if(effect.kind==="generated-attack-then-arrow"){
      const attackSpec={
        ...(effect.attack||{}),
        sourceCardId:cardId,
        sourceSlug:slug,
        classification:null,
        attacker:pid
      };
      const started=this._beginGeneratedAttack(attackSpec,events,{
        kind:"enhancement-discard-then-arrow",
        playerId:pid,
        cardId,
        arrow:clone(effect.arrow||null)
      });
      if(!started.pending&&!this.done){
        const movedCount=effect.arrow?applyDistanceDustArrow(this.state,String(effect.arrow.kind),effect.arrow.count??1,this.options):0;
        if(effect.arrow) events.push({kind:"破棄時矢印",playerId:pid,cardId,arrow:effect.arrow.kind,moved:movedCount});
      }
      return {handled:true,pending:!!started.pending};
    }
    if(effect.kind==="ready-one-used-special"){
      const candidates=usedSpecialCandidates(this.state,pid);
      if(!candidates.length){
        events.push({kind:"破棄時効果",playerId:pid,cardId,slug,effect:"使用済切札なし"});
        return {handled:true,pending:false};
      }
      if(candidates.length===1){
        readySpecialCard(this.state,pid,candidates[0]);
        events.push({kind:"破棄時効果",playerId:pid,cardId,slug,effect:"切札を未使用に戻す",targetCardId:candidates[0]});
        return {handled:true,pending:false};
      }
      this.pendingCardDecision={
        kind:"ready-used-special",
        playerId:pid,
        label:rule?.name||"切札を未使用に戻す",
        sourceCardId:cardId,
        slug,
        candidates:clone(candidates)
      };
      this.phase="start-card-choice";
      events.push({kind:"選択待ち",playerId:pid,cardId,slug,choice:"使用済切札",candidates:clone(candidates)});
      return {handled:true,pending:true};
    }
    return {handled:false,pending:false};
  }
  _advanceEnhancementDiscardQueue(events){
    const pid=this.pendingEnhancementDiscardOwner||this.enhancementTickOwner||this.turnPlayer;
    while(this.pendingEnhancementDiscards.length){
      if(this.pendingEnhancementDiscards.length>1 && this.pendingEnhancementDiscardSelected==null){
        this.pendingCardDecision={
          kind:"enhancement-discard-order",
          playerId:pid,
          label:"付与札の破棄順",
          sourceCardId:null,
          slug:"",
          candidates:clone(this.pendingEnhancementDiscards)
        };
        this.phase="start-card-choice";
        events.push({
          kind:"選択待ち",
          playerId:pid,
          choice:"付与札の破棄順",
          candidates:clone(this.pendingEnhancementDiscards)
        });
        return;
      }
      const cardId=this.pendingEnhancementDiscards[0];
      if(this.pendingEnhancementDiscardSelected!=null && String(this.pendingEnhancementDiscardSelected)!==String(cardId)){
        throw new Error("selected enhancement discard is not at queue front");
      }
      this.pendingEnhancementDiscardSelected=null;
      const builtIn=this._resolveRegisteredEnhancementDiscard(cardId,events);
      if(builtIn.pending) return;
      if(this.done) return;
      let handled=builtIn.handled;
      if(!handled){
        const one=this._ruleHook("handleEnhancementDiscardCard",{events,cardId});
        if(one.stop||this.done) return;
        handled=one.handled;
      }
      if(!handled){
        const legacy=this._ruleHook("handleEnhancementDiscard",{events,cardIds:[cardId]});
        if(legacy.stop||this.done) return;
        handled=legacy.handled;
      }
      if(!handled){
        this.done=true;
        this.doneReason="unsupported-enhancement-discard-effect";
        events.push({kind:"未対応",playerId:pid,reason:"付与札の破棄時効果",cardIds:[cardId],slug:stateCardSlug(this.state,pid,cardId)});
        return;
      }
      const moved=finishEnhancementDiscard(this.state,pid,cardId);
      events.push({kind:"付与札の破棄完了",playerId:pid,cards:[{cardId,...moved}]});
      this._onEnhancementDiscarded(pid,cardId,events);
      if(this.done) return;
      this.pendingEnhancementDiscards.shift();
    }
    this.pendingEnhancementDiscardOwner=null;
    this._continueStartAfterEnhancements(events);
  }
  _enterMainPhase(events){
    const pid=this.turnPlayer,opponent=pid===1?2:1;
    this.phase="main-start-effects";
    this._resetPhaseAttackTracking();
    this.mainMode=null;
    this.fullPowerCardUsed=false;
    this.pendingMainCard=null;
    events.push({kind:"メインフェイズ開始",playerId:pid});
    const queue=[];
    const own=this._activeEnhancementBySlug(pid,"re_19_megumi_o_n_5");
    if(own) queue.push({controller:pid,cardId:String(own.cardId),range:[1,2,3]});
    const other=this._activeEnhancementBySlug(opponent,"re_19_megumi_o_n_5");
    if(other) queue.push({controller:opponent,cardId:String(other.cardId),range:[3,4,5]});
    this.pendingMegumiMainStartAttacks=queue;
    this._advanceMegumiMainStartAttacks(events);
  }
  _advanceMegumiMainStartAttacks(events){
    const queue=arr(this.pendingMegumiMainStartAttacks);
    while(queue.length){
      const row=queue.shift();
      this.pendingMegumiMainStartAttacks=queue;
      const active=this._activeEnhancementBySlug(Number(row.controller),"re_19_megumi_o_n_5");
      if(!active||String(active.cardId)!==String(row.cardId)) continue;
      const started=this._beginGeneratedAttack({
        label:"鳳仙花",sourceCardId:row.cardId,sourceSlug:"re_19_megumi_o_n_5",
        classification:null,range:clone(row.range),auraDamage:2,lifeDamage:1,attacker:Number(row.controller)
      },events,{kind:"megumi-main-start"});
      if(started.pending||this.done) return;
    }
    this.pendingMegumiMainStartAttacks=null;
    this.phase="main";
  }
  _advanceDraws(events){
    const pid=this.turnPlayer;
    while(this.pendingDraws>0){
      const cardId=drawTopCard(this.state,pid);
      if(cardId==null){
        this.phase="start-fatigue";
        events.push({kind:"焦燥待ち",playerId:pid,remainingDraws:this.pendingDraws});
        return;
      }
      this.pendingDraws--;
      events.push({kind:"ドロー",playerId:pid,cardId,remainingDraws:this.pendingDraws});
    }
    this._enterMainPhase(events);
  }
  _applyPreparedStartEnhancementTick(tickPlan,events){
    const pid=Number(tickPlan?.playerId);
    const applied=applyStandardEnhancementTick(this.state,tickPlan,this.options);
    events.push({
      kind:"付与札開始フェイズ既定処理",
      playerId:pid,
      movedToDust:applied.movedToDust,
      movedToDistance:applied.movedToDistance,
      retained:clone(applied.retained),
      expired:clone(applied.expired)
    });
    const afterTick=this._ruleHook("afterEnhancementDefaultTick",{events,tickPlan:clone(tickPlan),applied:clone(applied)});
    if(afterTick.stop||this.done) return;
    if(applied.expired.length){
      this.pendingEnhancementDiscardOwner=pid;
      this.pendingEnhancementDiscards=clone(applied.expired);
      this._advanceEnhancementDiscardQueue(events);
      return;
    }
    this._continueStartAfterEnhancements(events);
  }
  _maybeChooseMegumiSeedTick(tickPlan,events){
    const pid=Number(tickPlan?.playerId);
    const item=arr(tickPlan?.plan).find(row=>row?.seedChoiceRequired&&!row?.seedChoiceResolved);
    if(!item) return false;
    this.pendingCardDecision={
      kind:"megumi-seed-tick-choice",
      playerId:pid,
      label:"種結晶",
      sourceCardId:item.cardId,
      slug:stateCardSlug(this.state,pid,item.cardId),
      candidates:["sakura","seed"],
      tickPlan:clone(tickPlan)
    };
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:pid,cardId:item.cardId,choice:"付与札から移動する結晶",candidates:["sakura","seed"]});
    return true;
  }
  _maybeChooseFrostThornTick(tickPlan,events){
    const pid=Number(tickPlan?.playerId),opponent=pid===1?2:1;
    if(n(this.state?.[`p${opponent}_freeze`])<=0) return false;
    const frostItem=arr(tickPlan?.plan).find(item=>stateCardSlug(this.state,pid,item.cardId)==="re_15_korunu_o_n_7");
    if(!frostItem) return false;
    this.pendingCardDecision={
      kind:"korunu-frost-thorn-tick",
      playerId:pid,
      label:"霜の茨",
      sourceCardId:frostItem.cardId,
      slug:"re_15_korunu_o_n_7",
      candidates:["hold","tick"],
      tickPlan:clone(tickPlan)
    };
    this.phase="start-card-choice";
    events.push({kind:"選択待ち",playerId:pid,cardId:frostItem.cardId,choice:"霜の茨の結晶",candidates:["hold","tick"]});
    return true;
  }
  _beginStartPhase(events){
    const pid=this.turnPlayer;
    this._thallyaStartCleanup(pid,events);
    this.turnStartDistance=n(this.state.distance);
    this._resetPhaseAttackTracking();
    if(this.turnsTaken[pid]===0){
      events.push({kind:"最初のターン集中・ドロースキップ",playerId:pid});
      this.pendingEnhancementTickPlayers=[pid,pid===1?2:1];
      this.skipFirstStartEnhancementRest=true;
      this._processNextStartEnhancementTick(events);
      return;
    }
    this.phase="start-effects";
    const controller=pid===1?2:1;
    const branch=this._activeEnhancementBySlug(controller,"re_19_megumi_o_s_2");
    if(branch){
      const x=megumiSeedCountOutsideSoil(this.state,controller);
      const started=this._beginGeneratedAttack({
        label:"可能性の枝",sourceCardId:branch.cardId,sourceSlug:"re_19_megumi_o_s_2",
        classification:null,range:[1,2,3,4,5,6],auraDamage:x,lifeDamage:1,attacker:controller
      },events,{kind:"megumi-branch-start"});
      if(started.pending||this.done) return;
    }
    this._continueStartPhaseDefault(events);
  }
  _continueStartPhaseDefault(events){
    const pid=this.turnPlayer;
    const beforeDefault=this._ruleHook("beforeStartPhaseDefault",{events});
    if(beforeDefault.stop||this.done) return;
    if(this.turnsTaken[pid]===0){
      events.push({kind:"最初のターン開始フェイズ既定処理スキップ",playerId:pid});
      this._enterMainPhase(events);
      return;
    }
    this.phase="start-default";
    this._gainFocus(pid,1,events,"開始フェイズ");
    const afterFocus=this._ruleHook("afterFocusGain",{events});
    if(afterFocus.stop||this.done) return;
    // All active enhancement counters advance at the beginning of EACH player's turn.
    // Resolve current player's tick before the opponent's, retaining async discard choices.
    this.pendingEnhancementTickPlayers=[pid,pid===1?2:1];
    this._processNextStartEnhancementTick(events);
  }
  _processNextStartEnhancementTick(events){
    while(this.pendingEnhancementTickPlayers?.length){
      const pid=this.pendingEnhancementTickPlayers.shift();
      this.enhancementTickOwner=pid;
      if(!hasActiveEnhancement(this.state,pid))continue;
      const tickPlan=planStandardEnhancementTick(this.state,pid);
      if(tickPlan.unsupported.length){
        const special=this._ruleHook("handleEnhancementDefaultTick",{events,tickPlan:clone(tickPlan)});
        if(special.stop||this.done) return;
        if(!special.handled){
          const legacy=this._ruleHook("handleEnhancementStart",{
            events,
            enhancementCards:arr(this.state[`p${pid}_enhancement`]),
            tickPlan:clone(tickPlan)
          });
          if(legacy.stop||this.done) return;
          if(!legacy.handled){
            this.done=true;
            this.doneReason="unsupported-enhancement-token-rule";
            events.push({kind:"未対応",playerId:pid,reason:"付与札の特殊トークン処理",details:clone(tickPlan.unsupported)});
            return;
          }
        }
      }else{
        if(this._maybeChooseMegumiSeedTick(tickPlan,events)) return;
        if(this._maybeChooseFrostThornTick(tickPlan,events)) return;
        this._applyPreparedStartEnhancementTick(tickPlan,events);
        return;
      }
    }

    this._continueStartAfterEnhancements(events);
  }
  _resolveEndPhaseRecharge(playerId,events){
    const pid=Number(playerId),statusMap=this.state?.[`p${pid}_special_status`]||{};
    let recharged=0;
    for(const cardId of arr(this.state?.[`p${pid}_special`])){
      if(Number(statusMap[String(cardId)]||0)!==2) continue;
      const slug=stateCardSlug(this.state,pid,cardId);
      const recharge=this.cardRuleRegistry?.get(slug)?.recharge;
      if(!recharge) continue;
      if(recharge.kind==="self-aura-at-most"){
        if(n(this.state?.[`p${pid}_aura`])<=n(recharge.value)){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({
            kind:"再起",
            playerId:pid,
            cardId,
            slug,
            condition:"self-aura-at-most",
            value:n(recharge.value)
          });
        }
        continue;
      }
      if(recharge.kind==="opponent-hand-at-least"){
        const opponent=pid===1?2:1;
        if(arr(this.state?.[`p${opponent}_hand`]).length>=n(recharge.value)){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({kind:"再起",playerId:pid,cardId,slug,condition:"opponent-hand-at-least",value:n(recharge.value)});
        }
        continue;
      }
      if(recharge.kind==="self-hand-empty"){
        if(arr(this.state?.[`p${pid}_hand`]).length===0){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({
            kind:"再起",
            playerId:pid,
            cardId,
            slug,
            condition:"self-hand-empty"
          });
        }
        continue;
      }
      if(recharge.kind==="self-focus-is"){
        if(n(this.state?.[`p${pid}_focus`])===n(recharge.value)){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({kind:"再起",playerId:pid,cardId,slug,condition:"self-focus-is",value:n(recharge.value)});
        }
        continue;
      }
      if(recharge.kind==="self-flare-is"){
        if(n(this.state?.[`p${pid}_flare`])===n(recharge.value)){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({kind:"再起",playerId:pid,cardId,slug,condition:"self-flare-is",value:n(recharge.value)});
        }
        continue;
      }
      if(recharge.kind==="megumi-no-bloomed-soil"){
        if(n(this.state?.[`p${pid}_megumi_soil_bloomed`])<=0){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({kind:"再起",playerId:pid,cardId,slug,condition:"megumi-no-bloomed-soil"});
        }
        continue;
      }
      if(recharge.kind==="raira-wind-at-least"){
        if(this._rairaGaugeValue(pid,"wind")>=n(recharge.value)){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({kind:"再起",playerId:pid,cardId,slug,condition:"raira-wind-at-least",value:n(recharge.value)});
        }
        continue;
      }
      if(recharge.kind==="thallya-neo"){
        if(n(this.state?.[`p${pid}_thallya_machine`])<=3 || !!this.state?.[`p${pid}_thallya_transformed_turn`]){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({kind:"再起",playerId:pid,cardId,slug,condition:"thallya-neo"});
        }
        continue;
      }
      if(recharge.kind==="used-centrifugal-this-turn"){
        if(!!this.centrifugalUsedThisTurn?.[pid]){
          statusMap[String(cardId)]=0;
          recharged++;
          events.push({kind:"再起",playerId:pid,cardId,slug,condition:"used-centrifugal-this-turn"});
        }
        continue;
      }
      throw new Error(`unsupported recharge rule: ${recharge.kind}`);
    }
    return recharged;
  }
  _resolveEndPhaseEnhancementEffects(playerId,events){
    const pid=Number(playerId);
    const fruit=this._activeEnhancementBySlug(pid,"re_19_megumi_o_s_3");
    if(fruit){
      const status=this.state?.[`p${pid}_card_status`]?.[String(fruit.cardId)]||{};
      const seeds=Math.max(0,n(status?.TokenCharges?.["19"]));
      if(seeds>=5){
        const started=this._beginGeneratedAttack({
          label:"結末の果実",sourceCardId:fruit.cardId,sourceSlug:"re_19_megumi_o_s_3",
          classification:null,range:[5],auraDamage:5,lifeDamage:5,attacker:pid,unavoidable:true,uncancelable:true
        },events,{kind:"megumi-fruit-end",playerId:pid,cardId:String(fruit.cardId)});
        if(started.pending||this.done) return false;
        this._finishMegumiFruitEnd(pid,String(fruit.cardId),events);
      }
    }
    for(const cardId of arr(this.state?.[`p${pid}_enhancement`])){
      if(this._isEnhancementDiscardResolving(cardId)) continue;
      const slug=stateCardSlug(this.state,pid,cardId);
      const effect=this.cardRuleRegistry?.get(slug)?.endPhaseEffect;
      if(!effect) continue;
      if(effect.kind==="draw-if-hand-empty"){
        if(arr(this.state?.[`p${pid}_hand`]).length!==0) continue;
        const count=Math.max(0,Math.floor(n(effect.count??1)));
        for(let i=0;i<count;i++){
          const drawn=drawTopCard(this.state,pid);
          if(drawn==null){
            this.pendingEffectFatigue={
              playerId:pid,
              reason:"end-phase-draw",
              resumeKind:"end-turn"
            };
            this.phase="effect-fatigue";
            events.push({kind:"焦燥待ち",playerId:pid,reason:"終了フェイズのドロー"});
            return false;
          }
          events.push({kind:"ドロー",playerId:pid,cardId:drawn,reason:"終了フェイズ"});
        }
        continue;
      }
      throw new Error(`unsupported end phase enhancement effect: ${effect.kind}`);
    }
    const wild=this._activeEnhancementBySlug(pid,"re_19_megumi_o_n_6");
    if(wild){
      this.pendingKururuBasic={playerId:pid,sources:["野茨"],resume:{kind:"megumi-wild-end",playerId:pid}};
      this._advanceKururuBasic(events);
      return false;
    }
    return true;
  }
  _finishMegumiFruitEnd(playerId,cardId,events){
    const pid=Number(playerId),id=String(cardId),status=this.state?.[`p${pid}_card_status`]?.[id];
    if(!status) return;
    const charges=positiveTokenChargeMap(status)||{};
    const seeds=Math.max(0,n(charges["19"]));
    const total=Object.keys(charges).length?Object.values(charges).reduce((sum,x)=>sum+n(x),0):Math.max(0,n(status.Charge));
    const toDust=Math.max(0,total-seeds);
    if(toDust>0) this.state.dust=n(this.state.dust)+toDust;
    if(seeds>0) returnMegumiSeedsToSoil(this.state,pid,seeds);
    status.Charge=0; status.TokenCharges={};
    const moved=finishEnhancementDiscard(this.state,pid,id);
    events.push({kind:"結末の果実終了",playerId:pid,cardId:id,crystalsToDust:toDust,seedsToSoil:seeds,...moved});
  }
  _resolveThallyaA1DevaFromStateTransition(before,events){
    for(const owner of [1,2]){
      if(!this._thallyaA1Forms(owner).includes("DEVA")) continue;
      const opponent=owner===1?2:1,beforeCount=arr(before?.[`p${opponent}_discard`]).length,afterCount=arr(this.state?.[`p${opponent}_discard`]).length;
      if(afterCount<=beforeCount) continue;
      const gains=Math.floor(afterCount/2)-Math.floor(beforeCount/2);
      if(gains>0) this._gainFocus(owner,gains,events,"Form:DEVA");
    }
  }
  _beginEndHandLimit(playerId,events){
    const pid=Number(playerId),handKey=`p${pid}_hand`;
    if(this.state?.[`p${pid}_thallya_no_hand_limit_turn`]){
      this._finishEndTurn(events);
      return;
    }
    const limit=2+Math.max(0,n(this.state?.[`p${pid}_yurina_hand_limit_bonus_turn`]));
    const hand=arr(this.state?.[handKey]);
    if(hand.length<=limit){
      this._finishEndTurn(events);
      return;
    }
    this.pendingCardDecision={
      kind:"end-hand-limit-discard",
      playerId:pid,
      label:"手札上限",
      sourceCardId:null,
      slug:"",
      candidates:hand.map(String),
      limit
    };
    this.phase="start-card-choice";
    events.push({kind:"手札上限選択待ち",playerId:pid,limit,handCount:hand.length,candidates:clone(this.pendingCardDecision.candidates)});
  }
  _finishEndTurn(events){
    const actor=this.turnPlayer;
    this.turnsTaken[actor]++;
    this.completedTurns++;
    events.push({kind:"ターン終了",playerId:actor});
    if(this.completedTurns>=this.options.maxTurns){
      this.done=true;
      this.doneReason="turn-limit";
      return;
    }
    this.terminalLocked={1:false,2:false};
    this.state.p1_megumi_wild_triggered_turn=false;
    this.state.p2_megumi_wild_triggered_turn=false;
    this.nextAttackModifiers[actor]=[];
    this.nextOtherMegamiAttackModifiers={1:[],2:[]};
    this.attackCountsThisTurn={1:0,2:0};
    this.nonSpecialAttackCountsThisTurn={1:0,2:0};
    this.megumiPalmUsedThisTurn={1:false,2:false};
    this.cardUseCountsThisTurn={1:0,2:0};
    this.basicActionsThisTurn={1:0,2:0};
    this.state[`p${actor}_chikage_no_basic_advance`]=false;
    this.state[`p${actor}_thallya_no_hand_limit_turn`]=false;
    for(const key of [`p${actor}_thallya_transformed_turn`,`p${actor}_thallya_asura_used_turn`]){
      if(Object.prototype.hasOwnProperty.call(this.state,key)) this.state[key]=false;
    }
    for(const pid of [1,2]){
      const aunKey=`p${pid}_yurina_aun_triggered_turn`;
      if(Object.prototype.hasOwnProperty.call(this.state,aunKey)) this.state[aunKey]=false;
    }
    const handLimitKey=`p${actor}_yurina_hand_limit_bonus_turn`;
    if(Object.prototype.hasOwnProperty.call(this.state,handLimitKey)) this.state[handLimitKey]=0;
    this.state[`p${actor}_megumi_cancel_next_basic`]=false;
    this.nextOtherMegamiGrowthBonus[actor]=0;
    this.auraDamageTakenThisTurn={1:false,2:false};
    this.centrifugalUsedThisTurn={1:false,2:false};
    this.mainMode=null;
    this.fullPowerCardUsed=false;
    this.pendingMainCard=null;
    this.turnPlayer=actor===1?2:1;
    this.turnNumber++;
    this._beginStartPhase(events);
  }
  _continueEndTurnAfterKururu(events){
    const actor=this.turnPlayer;
    this.phase="end-effects";
    this._resetPhaseAttackTracking();
    const recharged=this._resolveEndPhaseRecharge(actor,events);
    if(recharged>0 && this._kururuDrainDevilCard(actor) && !this.terminalLocked?.[actor]){
      this._beginKururuDrainReuse([{playerId:actor,count:recharged}],{kind:"end-phase-after-recharge",playerId:actor},events);
      return;
    }
    if(!this._resolveEndPhaseEnhancementEffects(actor,events)) return;
    this._beginYukihiEndToggleChoice(actor,events);
  }
  _endTurn(events){
    const actor=this.turnPlayer;
    this.phase="end-effects";
    const sourceCardId=this._kururuBigGolemCard(actor);
    if(sourceCardId && !this.terminalLocked?.[actor] && this._kururuGearReady(actor,{fullpower:2,response:1})){
      this.pendingCardDecision={
        kind:"kururu-big-golem-end",playerId:actor,label:"びっぐごーれむ",
        sourceCardId,slug:"re_10_kururu_o_s_2",candidates:["skip","use"]
      };
      this.phase="start-card-choice";
      events.push({kind:"選択待ち",playerId:actor,cardId:sourceCardId,choice:"びっぐごーれむ・終了フェイズ",candidates:["skip","use"]});
      return;
    }
    this._continueEndTurnAfterKururu(events);
  }
  step(action){
    if(this.done) throw new Error("turn sandbox is already finished");
    const actor=this.currentPlayer(),phaseBefore=this.phase,turnBefore=this.turnNumber;
    const legal=this.legalActions(actor);
    const key=turnActionKey(action);
    const chosen=legal.find(x=>turnActionKey(x)===key);
    if(!chosen) throw new Error(`illegal turn sandbox action in ${this.phase}`);
    this.nextRairaGaugeChoice[actor]=["wind","thunder"].includes(String(chosen.rairaGauge||""))?String(chosen.rairaGauge):null;
    const before=clone(this.state),events=[];
    const commitStep=()=>{
      this._resolveUpasitumRechargeFromStateTransition(before,events);
      this._resolveThallyaA1DevaFromStateTransition(before,events);
      this._resolveKururuDrainDevilFromStateTransition(before,events);
      if(
        !this.done &&
        arr(this.pendingYurinaAunTriggers).length &&
        !this.pendingCardDecision &&
        !this.pendingResponseCard &&
        this.phase!=="start-card-choice"
      ){
        this._beginNextYurinaAunTrigger(events,{kind:"phase",phase:this.phase});
      }
      const invariantErrors=[...assertSandboxState(this.state),...cardZoneInvariantErrors(this.state)];
      if(invariantErrors.length) throw new Error(`turn sandbox invariant failed: ${invariantErrors.join(", ")}`);
      const entry={
        index:this.history.length,
        turn:turnBefore,
        actor,
        phase:phaseBefore,
        action:clone(chosen),
        events:clone(events),
        before,
        after:clone(this.state),
        nextPhase:this.phase,
        done:this.done,
        doneReason:this.doneReason,
        winner:this.winner
      };
      this.history.push(entry);
      return clone(entry);
    };
    if(this.phase==="kururu-drain-reuse"){
      if(chosen.rule!==TURN_KURURU_DRAIN_REUSE || !this.pendingKururuDrainReuse?.entries?.length) throw new Error("invalid Drain Devil reuse choice");
      const row=this.pendingKururuDrainReuse.entries[0],pid=Number(row.playerId);
      row.count=Math.max(0,n(row.count)-1);
      if(chosen.use){
        this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
        this._markCardUseTraits(pid,"re_10_kururu_o_s_1",events);
        this._kururuDrain(pid,events,"どれーんでびる（再使用）");
        events.push({kind:"切札再使用",playerId:pid,slug:"re_10_kururu_o_s_1",cost:0});
        if(this._kururuActiveModule(pid) && !this.terminalLocked?.[pid]){
          this._beginKururuPostCardBasics(pid,{kind:"action-card"},{kind:"kururu-drain-reuse"},events);
        }else this._continueKururuDrainReuse(events);
      }else{
        events.push({kind:"切札再使用なし",playerId:pid,slug:"re_10_kururu_o_s_1"});
        this._continueKururuDrainReuse(events);
      }
    }else if(this.phase==="kururu-trigger-basic"){
      if(chosen.rule!==TURN_KURURU_TRIGGER_BASIC || !this.pendingKururuBasic) throw new Error("invalid Kururu basic trigger choice");
      if(!chosen.skip) this._applyEffectBasicAction(actor,chosen.basicAction,events);
      else events.push({kind:"効果による基本動作を行わない",playerId:actor,source:String(this.pendingKururuBasic.sources?.[0]||"")});
      this.pendingKururuBasic.sources.shift();
      this._advanceKururuBasic(events);
    }else if(this.phase==="shinra-plan-choice"){
      if(chosen.rule!==TURN_SHINRA_PLAN_CHOICE) throw new Error("invalid Shinra plan choice");
      this._finishShinraPlanPreparation(String(chosen.choice),events);
    }else if(this.phase==="yukihi-end-toggle-choice"){
      if(chosen.rule!==TURN_YUKIHI_END_TOGGLE_CHOICE || !this.pendingYukihiEndToggle) throw new Error("invalid Yukihi end toggle choice");
      const choice=String(chosen.choice);
      this.pendingYukihiEndToggle=null;
      if(choice==="toggle") this._toggleYukihiUmbrella(actor,events,"終了フェイズ",{kind:"end-turn"});
      else if(choice==="keep"){
        events.push({kind:"傘の開閉なし",playerId:actor,source:"終了フェイズ"});
        this._beginEndHandLimit(actor,events);
      }else throw new Error("invalid Yukihi end toggle value");
    }else if(this.phase==="attack-post-response-choice"){
      if(chosen.rule!==TURN_ATTACK_POST_RESPONSE_CHOICE) throw new Error("invalid post-response attack choice");
      this._finishAttackPostResponseChoice(String(chosen.choice),events);
    }else if(this.phase==="main"){
      if(chosen.rule===TURN_MAIN_STANDARD){
        this.mainMode="standard";
        events.push({kind:"メインフェイズ行動選択",playerId:actor,mode:"standard"});
      }else if(chosen.rule===TURN_MAIN_FULLPOWER){
        this.mainMode="fullpower";
        this.fullPowerCardUsed=false;
        events.push({kind:"メインフェイズ行動選択",playerId:actor,mode:"fullpower"});
      }else if(chosen.rule===SANDBOX_END_TURN) this._endTurn(events);
      else if(chosen.rule===TURN_USE_CARD) this._useMainCard(chosen.cardId,events);
      else if(chosen.rule===TURN_THALLYA_EXTRA_BASIC){
        if(this.mainMode!=="standard") throw new Error("Thallya extra basic is only legal in standard main mode");
        this._applyThallyaExtraBasic(chosen,events);
      }else {
        if(this.mainMode!=="standard") throw new Error("basic action is only legal in standard main mode");
        const beforeBasic=clone(this.state);
        const resolved=applyStandardBasicAction(this.state,actor,chosen,this.options);
        if(beforeBasic?.[`p${actor}_megumi_cancel_next_basic`]){
          const kept=clone(beforeBasic);
          kept[`p${actor}_focus`]=resolved[`p${actor}_focus`];
          kept[`p${actor}_hand`]=arr(resolved[`p${actor}_hand`]);
          kept[`p${actor}_facedown`]=arr(resolved[`p${actor}_facedown`]);
          kept[`p${actor}_megumi_cancel_next_basic`]=false;
          this.state=kept;
          events.push({kind:"基本動作効果無効",playerId:actor,basicAction:chosen.basicAction,source:"棹穿ち"});
        }else{
          this.state=resolved;
          events.push({kind:"基本動作",playerId:actor,basicAction:chosen.basicAction});
        }
        this.basicActionsThisTurn[actor]=Math.max(0,n(this.basicActionsThisTurn?.[actor]))+1;
        this._queueYurinaAunAuraChange(actor,n(beforeBasic?.[`p${actor}_aura`]),n(this.state?.[`p${actor}_aura`]),events,`基本動作:${BASIC_ACTION_NAMES[Number(chosen.basicAction)]||chosen.basicAction}`);
      }
    }else if(this.phase==="reconstruction-install-choice"){
      if(chosen.rule!==TURN_RECONSTRUCT_INSTALL) throw new Error("invalid reconstruction install choice");
      const pending=this.pendingReconstruction;
      if(!pending || Number(pending.playerId)!==actor) throw new Error("missing reconstruction install state");
      const mode=String(chosen.installMode||"");
      if(!["normal","uro"].includes(mode) || !pending.remaining?.[mode]) throw new Error("illegal reconstruction install mode");
      const candidates=this._installCandidates(actor,mode).map(String);
      pending.remaining[mode]=false;
      if(chosen.skip){
        this._advanceReconstructionInstall(events);
      }else{
        if(!candidates.includes(String(chosen.cardId))) throw new Error("illegal reconstruction install card");
        this._beginFacedownCardUse(actor,chosen.cardId,events,{kind:"reconstruction-install"});
      }
    }else if(this.phase==="main-enhancement-choice"){
      if(chosen.rule!==TURN_MAIN_ENHANCEMENT_CHOICE) throw new Error("invalid main enhancement choice");
      const pending=this.pendingMainCard;
      if(!pending || Number(pending.playerId)!==actor) throw new Error("missing main enhancement choice");
      if(!arr(pending.choices).includes(String(chosen.choice))) throw new Error("illegal main enhancement choice");
      this._applyMainEnhancementPlacement(String(chosen.choice),events);
    }else if(this.phase==="main-enhancement-effect-choice"){
      if(chosen.rule!==TURN_MAIN_ENHANCEMENT_EFFECT_CHOICE) throw new Error("invalid enhancement effect choice");
      const pending=this.pendingMainCard;
      if(!pending || pending.kind!=="enhancement-placement" || Number(pending.playerId)!==actor) throw new Error("missing enhancement effect choice");
      if(!arr(pending.choices).includes(String(chosen.choice))) throw new Error("illegal enhancement effect choice");
      this._applyMainEnhancementDiscardChoice(pending,String(chosen.choice),events);
    }else if(this.phase==="main-effect-choice"){
      if(chosen.rule!==TURN_MAIN_EFFECT_CHOICE) throw new Error("invalid main effect choice");
      const pending=this.pendingMainCard;
      if(!pending || pending.kind!=="action-card" || Number(pending.playerId)!==actor) throw new Error("missing main action choice state");
      if(!arr(pending.choices).includes(String(chosen.choice))) throw new Error("illegal main action choice");
      if(pending.pendingChoice?.kind==="arrow"){
        this._applyMainActionArrowChoice(pending,String(chosen.choice),events);
      }else if(pending.pendingChoice?.kind==="optional-arrow"){
        const choice=String(chosen.choice),arrow=pending.pendingChoice.arrow||{};
        if(choice!=="done"){
          if(choice!==String(arrow.kind||"")) throw new Error("illegal optional arrow choice");
          const moved=applyArrowAsMuchAsPossible(this.state,actor,String(arrow.kind||""),arrow.count??1,this.options);
          events.push({kind:"追加矢印",playerId:actor,source:pending.slug,arrow:String(arrow.kind||""),moved});
        }
        pending.pendingChoice=null; pending.choices=[];
      }else if(pending.pendingChoice?.kind==="kururu-accelerator-card"){
        const value=String(chosen.choice);
        pending.pendingChoice=null; pending.choices=[];
        if(value!=="done"){
          const id=value.replace(/^card:/,"");
          this._beginKururuOwnCardUse(actor,id,"hand",events,{kind:"kururu-accelerator"},{ignoreCost:false});
        }
      }else if(pending.pendingChoice?.kind==="kururu-regainer-card"){
        const value=String(chosen.choice),choiceState=clone(pending.pendingChoice);
        if(value==="done"){
          pending.pendingChoice=null; pending.choices=[];
        }else{
          const m=/^card:([^:]+):(.+)$/.exec(value);
          if(!m) throw new Error("invalid Regainer card choice");
          const zone=m[1],id=m[2],row=arr(choiceState.candidates).find(x=>String(x.zone)===zone&&String(x.id)===id);
          if(!row) throw new Error("Regainer card candidate missing");
          const baseRule=this.cardRuleRegistry?.get(row.slug)?.mainUse;
          const mods=this._kururuRegainerModChoices(actor,id).filter(mod=>
            this._kururuOwnRuleLegal(actor,id,zone,this._kururuModifiedRule(baseRule,mod),{ignoreCost:true})
          );
          pending.pendingChoice={kind:"kururu-regainer-mod",zone,id,slug:row.slug};
          pending.choices=mods;
          this.phase="main-effect-choice";
          events.push({kind:"選択待ち",playerId:actor,cardId:pending.cardId,choice:"りげいなー・数値変更",choices:clone(mods)});
          return;
        }
      }else if(pending.pendingChoice?.kind==="kururu-regainer-mod"){
        const choiceState=clone(pending.pendingChoice),mod=String(chosen.choice);
        const baseRule=this.cardRuleRegistry?.get(choiceState.slug)?.mainUse;
        const modified=this._kururuModifiedRule(baseRule,mod);
        pending.pendingChoice=null; pending.choices=[];
        this._beginKururuOwnCardUse(actor,choiceState.id,choiceState.zone,events,{kind:"kururu-regainer"},{ignoreCost:true,modifiedRule:modified});
      }else if(pending.pendingChoice?.kind==="kururu-industria-seal"){
        const value=String(chosen.choice);
        if(value!=="done"){
          const m=/^seal:([^:]+):(.+)$/.exec(value);
          if(!m) throw new Error("invalid Industria seal choice");
          this._kururuSealIndustria(actor,pending.cardId,m[1],m[2],events);
        }
        this._kururuAddDuplicate(actor,pending.cardId,events);
        pending.pendingChoice=null; pending.choices=[];
      }else if(pending.pendingChoice?.kind==="kururu-kansu-mark-used"){
        const value=String(chosen.choice),opponent=actor===1?2:1;
        if(value!=="skip"){
          const id=value.replace(/^card:/,"");
          if(Number(this.state?.[`p${opponent}_special_status`]?.[id]||0)===2) throw new Error("Kansu mark target already used");
          this.state[`p${opponent}_special_status`][id]=2;
          events.push({kind:"切札を使用済みにする",playerId:actor,targetPlayer:opponent,cardId:id,source:"神渉装置：枢式"});
        }
        const used=this._kururuKansuUsedOpponentSpecials(actor).filter(id=>this._kururuBorrowedSpecialLegal(actor,opponent,id));
        pending.pendingChoice={kind:"kururu-kansu-use-special"};
        pending.choices=["skip",...used.map(id=>`card:${id}`)];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:actor,cardId:pending.cardId,choice:"枢式・切札使用",choices:clone(pending.choices)});
        return;
      }else if(pending.pendingChoice?.kind==="kururu-kansu-use-special"){
        const value=String(chosen.choice),opponent=actor===1?2:1;
        pending.pendingChoice=null; pending.choices=[];
        if(value!=="skip"){
          const id=value.replace(/^card:/,"");
          if(!this._kururuBorrowedSpecialLegal(actor,opponent,id)) throw new Error("illegal Kansu special choice");
          this._beginBorrowedCardUse(actor,opponent,id,"special",events,{kind:"kururu-kansu-borrowed"},{ignoreCost:true});
        }
      }else if(pending.pendingChoice?.kind==="raira-wisdom-topdeck"){
        const value=String(chosen.choice);
        if(value!=="done") this._rairaPutDiscardOnDeckTop(actor,value,events,"風雷の知恵");
        this._continueRairaWisdom(pending,events);
        return;
      }else if(pending.pendingChoice?.kind==="raira-call"){
        const value=String(chosen.choice);
        pending.pendingChoice=null; pending.choices=[];
        if(value==="both"){
          this._raiseRairaGauge(actor,"wind",1,events,"呼び声");
          this._raiseRairaGauge(actor,"thunder",1,events,"呼び声");
          const opponent=actor===1?2:1;
          this.state[`p${opponent}_intimidated`]=true;
          events.push({kind:"畏縮",playerId:opponent,source:"呼び声"});
        }else if(value==="thunder-double"){
          const thunder=this._rairaGaugeValue(actor,"thunder");
          this._raiseRairaGauge(actor,"thunder",thunder,events,"呼び声");
        }else throw new Error("invalid Raira call choice");
        if(this._rairaGaugeTotal(actor)>=12){
          pending.remainingBasicActions=2;
          this.phase="main-effect-basic";
          events.push({kind:"基本動作選択待ち",playerId:actor,remaining:2});
          return;
        }
      }else if(pending.pendingChoice?.kind==="raira-wrap-ready-special"){
        const id=String(chosen.choice),status=this.state?.[`p${actor}_special_status`]||{};
        if(Number(status[id]||0)!==2) throw new Error("Raira wrap target is not used");
        status[id]=0;
        events.push({kind:"切札を未使用に戻す",playerId:actor,cardId:id,source:"風魔纏廻"});
        pending.pendingChoice=null; pending.choices=[];
      }else if(pending.pendingChoice?.kind==="raira-tengu-step"){
        this._applyRairaTenguChoice(actor,String(chosen.choice),events);
        const removed=this._removeUsingCardToOutside(actor,pending.cardId);
        events.push({kind:"取り除く",playerId:actor,cardId:pending.cardId,source:"風魔天狗道",removed});
        pending.pendingChoice=null; pending.choices=[];
      }else if(pending.pendingChoice?.kind==="thallya-a1-transform"){
        const form=String(chosen.choice),source=String(pending.pendingChoice.source||"");
        pending.pendingChoice=null; pending.choices=[];
        this._addThallyaA1Form(actor,form,events,{resolveEffect:true,source});
        if(form==="ASURA" && this._beginThallyaA1AsuraDiscard(actor,pending,events)) return commitStep();
      }else if(pending.pendingChoice?.kind==="thallya-quick-change-remove"){
        const form=String(chosen.choice),forms=this._thallyaA1Forms(actor),index=forms.indexOf(form);
        if(index<0) throw new Error("Quick Change remove form missing");
        forms.splice(index,1); this.state[`p${actor}_thallya_a1_forms`]=forms;
        events.push({kind:"Quick Change",playerId:actor,returnedForm:form,transformEffect:false});
        const add=this._thallyaA1AvailableForms(actor);
        pending.pendingChoice={kind:"thallya-quick-change-add"};
        pending.choices=clone(add);
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:actor,cardId:pending.cardId,choice:"Quick Change・置くTransForm",choices:clone(add)});
        return commitStep();
      }else if(pending.pendingChoice?.kind==="thallya-quick-change-add"){
        const form=String(chosen.choice);
        if(!this._thallyaA1AvailableForms(actor).includes(form)) throw new Error("Quick Change add form unavailable");
        this._addThallyaA1Form(actor,form,events,{resolveEffect:false,source:"Quick Change"});
        pending.pendingChoice={kind:"thallya-quick-change-after"};
        const after=[];
        if(n(this.state?.[`p${actor}_thallya_burned`])>0) after.push("recover");
        if(this._effectBasicActions(actor).length||this._thallyaExtraBasicKinds(actor).length) after.push("basic");
        pending.choices=after;
        if(!after.length){ pending.pendingChoice=null; pending.choices=[]; }
        else{
          this.phase="main-effect-choice";
          events.push({kind:"選択待ち",playerId:actor,cardId:pending.cardId,choice:"Quick Change",choices:clone(after)});
          return commitStep();
        }
      }else if(pending.pendingChoice?.kind==="thallya-quick-change-after"){
        const choice=String(chosen.choice),pid=Number(actor);
        pending.pendingChoice=null;
        pending.choices=[];
        if(choice==="recover"){
          this._thallyaRecover(pid,1,events,"Quick Change");
        }else if(choice==="basic"){
          pending.remainingBasicActions=1;
          pending.allowThallyaExtraBasic=true;
          const basics=this._effectBasicActions(pid);
          const extras=this._thallyaExtraBasicKinds(pid);
          if(basics.length||extras.length){
            this.phase="main-effect-basic";
            events.push({kind:"基本動作選択待ち",playerId:pid,remaining:1,source:"Quick Change"});
            return commitStep();
          }
          pending.allowThallyaExtraBasic=false;
        }else throw new Error("invalid Quick Change follow-up");
      }else if(pending.pendingChoice?.kind==="thallya-roaring-burn"){
        const choice=String(chosen.choice);
        if(choice==="burn"){
          this._thallyaBurn(actor,2,events,"Roaring");
          this._gainFocus(actor,1,events,"Roaring");
          const opponent=actor===1?2:1,moved=Math.min(1,n(this.state?.[`p${opponent}_flare`]));
          this.state[`p${opponent}_flare`]=n(this.state[`p${opponent}_flare`])-moved;
          this.state.dust=n(this.state.dust)+moved;
          events.push({kind:"Roaring",playerId:actor,effect:"相手フレアからダスト",moved});
        }else if(choice!=="skip"){
          throw new Error("invalid Roaring burn choice");
        }
        pending.pendingChoice={kind:"thallya-roaring-recover"};
        pending.choices=n(this.state?.[`p${actor}_focus`])>=2?["skip","recover"]:["skip"];
        this.phase="main-effect-choice";
        events.push({kind:"選択待ち",playerId:actor,cardId:pending.cardId,choice:"Roaring・回復",choices:clone(pending.choices)});
        return commitStep();
      }else if(pending.pendingChoice?.kind==="thallya-roaring-recover"){
        const choice=String(chosen.choice);
        if(choice==="recover"){
          if(n(this.state?.[`p${actor}_focus`])<2) throw new Error("insufficient focus for Roaring recovery");
          this.state[`p${actor}_focus`]=n(this.state[`p${actor}_focus`])-2;
          this._thallyaRecover(actor,3,events,"Roaring");
        }else if(choice!=="skip"){
          throw new Error("invalid Roaring recovery choice");
        }
        pending.pendingChoice=null;
        pending.choices=[];
      }else if(pending.pendingChoice?.kind==="thallya-transform"){
        const form=String(chosen.choice),opponent=actor===1?2:1;
        if(!["YAKSHA","NAGA","GARUDA"].includes(form)) throw new Error("invalid Thallya transform");
        this.state[`p${actor}_thallya_form`]=form;
        events.push({kind:"TransForm",playerId:actor,form});
        if(form==="YAKSHA"){
          this.state[`p${opponent}_thallya_draw_limit_once`]=1;
          this.state[`p${opponent}_intimidated`]=true;
          events.push({kind:"畏縮",playerId:opponent,source:"Form:YAKSHA"});
        }else if(form==="NAGA"){
          const moved=Math.max(0,n(this.state?.[`p${opponent}_flare`])-2);
          if(moved>0){
            this.state[`p${opponent}_flare`]=n(this.state[`p${opponent}_flare`])-moved;
            this.state.dust=n(this.state.dust)+moved;
          }
          events.push({kind:"TransForm効果",playerId:actor,form,movedFlareToDust:moved});
        }
        pending.pendingChoice=null;
        pending.choices=[];
        pending.effects.splice(pending.effectIndex,0,{kind:"thallya-blackbox-recover"});
        if(form==="GARUDA"){
          this.state[`p${actor}_thallya_no_hand_limit_turn`]=true;
          if(!this._drawForMainAction(pending,2,events)) return;
        }
      }else if(pending.pendingChoice?.kind==="chikage-poison"){
        const target=Number(pending.pendingChoice.targetPlayer),destination=String(pending.pendingChoice.destination||"hand");
        this._chikageTransferPoison(actor,target,String(chosen.choice),destination,events,pending.slug);
        pending.pendingChoice=null; pending.choices=[];
      }else if(pending.pendingChoice?.kind==="hand-to-facedown"){
        this._applyMainActionHandToFacedown(pending,String(chosen.choice),events);
      }else if(pending.pendingChoice?.kind==="cards-to-deck-bottom"){
        this._applyMainActionDeckBottomChoice(pending,String(chosen.choice),events);
      }else if(pending.pendingChoice?.kind==="shinra-quote-select"){
        const value=String(chosen.choice);
        if(value==="done"){
          pending.pendingChoice=null; pending.choices=[];
        }else{
          const cardId=value.startsWith("card:")?value.slice(5):value;
          const opponent=Number(pending.pendingChoice.opponent);
          if(!arr(this.state?.[`p${opponent}_hand`]).some(x=>String(x)===cardId)) throw new Error("quote target left hand");
          const canUse=this._borrowedCardRuleLegal(actor,opponent,cardId,"hand",{attackOnly:true});
          pending.pendingChoice={kind:"shinra-quote-use",opponent,cardId};
          pending.choices=canUse?["use","facedown"]:["facedown"];
          this.phase="main-effect-choice";
          events.push({kind:"選択待ち",playerId:actor,cardId:pending.cardId,choice:"引用した札",choices:clone(pending.choices)});
        }
      }else if(pending.pendingChoice?.kind==="shinra-quote-use"){
        const mode=String(chosen.choice),opponent=Number(pending.pendingChoice.opponent),cardId=String(pending.pendingChoice.cardId);
        if(mode==="facedown"){
          const handKey=`p${opponent}_hand`,facedownKey=`p${opponent}_facedown`;
          this.state[handKey]=arr(this.state[handKey]); this.state[facedownKey]=arr(this.state[facedownKey]);
          const index=this.state[handKey].findIndex(x=>String(x)===cardId);
          if(index<0) throw new Error("quote facedown target left hand");
          const [moved]=this.state[handKey].splice(index,1); this.state[facedownKey].push(moved);
          const ownerRule=this.cardRuleRegistry?.get(stateCardSlug(this.state,opponent,cardId))?.mainUse;
          if(ownerRule?.fullPower) pending.endPhaseAfterResolution=true;
          events.push({kind:"引用伏せ札",playerId:actor,ownerId:opponent,cardId:moved});
          pending.pendingChoice=null; pending.choices=[];
        }else if(mode==="use"){
          const ownerRule=this.cardRuleRegistry?.get(stateCardSlug(this.state,opponent,cardId))?.mainUse;
          const endPhaseAfterUse=!!ownerRule?.fullPower;
          pending.pendingChoice=null; pending.choices=[];
          this._beginBorrowedCardUse(actor,opponent,cardId,"hand",events,{kind:"shinra-quote-borrowed",endPhaseAfterUse});
    this._resolveUpasitumRechargeFromStateTransition(before,events);
          this._resolveThallyaA1DevaFromStateTransition(before,events);
          this._resolveKururuDrainDevilFromStateTransition(before,events);
          const invariantErrors=[...assertSandboxState(this.state),...cardZoneInvariantErrors(this.state)];
          if(invariantErrors.length) throw new Error(`turn sandbox invariant failed: ${invariantErrors.join(", ")}`);
          const entry={index:this.history.length,turn:turnBefore,actor,phase:phaseBefore,action:clone(chosen),events:clone(events),before,after:clone(this.state),nextPhase:this.phase,done:this.done,doneReason:this.doneReason,winner:this.winner};
          this.history.push(entry);
          return clone(entry);
        }else throw new Error("unknown quote choice");
      }else if(pending.pendingChoice?.kind==="shinra-complete-refute"){
        const opponent=Number(pending.pendingChoice.opponent),cardId=String(chosen.choice);
        this._sealCardUnder(actor,pending.cardId,opponent,cardId,events,{permanent:true});
        pending.pendingChoice=null; pending.choices=[];
      }else if(pending.pendingChoice?.kind==="hagane-respect"){
        const result=this._applyHaganeRespectChoice(pending,String(chosen.choice),events);
        if(result.nested){
          this._resolveUpasitumRechargeFromStateTransition(before,events);
          this._resolveThallyaA1DevaFromStateTransition(before,events);
          this._resolveKururuDrainDevilFromStateTransition(before,events);
          const invariantErrors=[...assertSandboxState(this.state),...cardZoneInvariantErrors(this.state)];
          if(invariantErrors.length) throw new Error(`turn sandbox invariant failed: ${invariantErrors.join(", ")}`);
          const entry={index:this.history.length,turn:turnBefore,actor,phase:phaseBefore,action:clone(chosen),events:clone(events),before,after:clone(this.state),nextPhase:this.phase,done:this.done,doneReason:this.doneReason,winner:this.winner};
          this.history.push(entry);
          return clone(entry);
        }
      }else if(pending.pendingChoice?.kind==="hagane-next-attack-buff"){
        const choice=String(chosen.choice);
        this.nextAttackModifiers[actor]=arr(this.nextAttackModifiers?.[actor]);
        if(choice==="damage"){
          this.nextAttackModifiers[actor].push({kind:"damage",auraDelta:1,lifeDelta:1,source:"鐘鳴らし"});
        }else if(choice==="response-lock-range"){
          this.nextAttackModifiers[actor].push({kind:"range-expansion",rangeNear:0,rangeFar:1,source:"鐘鳴らし"});
          this.nextAttackModifiers[actor].push({kind:"response-lock",source:"鐘鳴らし"});
        }else{
          throw new Error("unknown Kane Narashi choice");
        }
        events.push({kind:"次の攻撃修正予約",playerId:actor,source:"鐘鳴らし",choice});
        pending.pendingChoice=null;
        pending.choices=[];
      }else if(pending.pendingChoice?.kind==="use-install-facedown"){
        if(String(chosen.choice)==="done"){
          pending.pendingChoice=null;
          pending.choices=[];
        }else{
          const cardId=String(chosen.choice);
          pending.pendingChoice=null;
          pending.choices=[];
          this._beginFacedownCardUse(actor,cardId,events,{kind:"ninpo"});
          this._resolveUpasitumRechargeFromStateTransition(before,events);
          this._resolveThallyaA1DevaFromStateTransition(before,events);
          this._resolveKururuDrainDevilFromStateTransition(before,events);
          const invariantErrors=[...assertSandboxState(this.state),...cardZoneInvariantErrors(this.state)];
          if(invariantErrors.length) throw new Error(`turn sandbox invariant failed: ${invariantErrors.join(", ")}`);
          const entry={
            index:this.history.length,turn:turnBefore,actor,phase:phaseBefore,action:clone(chosen),
            events:clone(events),before,after:clone(this.state),nextPhase:this.phase,
            done:this.done,doneReason:this.doneReason,winner:this.winner
          };
          this.history.push(entry);
          return clone(entry);
        }
      }else if(pending.pendingChoice?.kind==="use-facedown-non-fullpower"){
        if(String(chosen.choice)==="done"){
          pending.pendingChoice=null;
          pending.choices=[];
        }else{
          const cardId=String(chosen.choice);
          pending.pendingChoice=null;
          pending.choices=[];
          this._beginFacedownCardUse(actor,cardId,events,{kind:"tobi-main"});
          this._resolveUpasitumRechargeFromStateTransition(before,events);
          this._resolveThallyaA1DevaFromStateTransition(before,events);
          this._resolveKururuDrainDevilFromStateTransition(before,events);
          const invariantErrors=[...assertSandboxState(this.state),...cardZoneInvariantErrors(this.state)];
          if(invariantErrors.length) throw new Error(`turn sandbox invariant failed: ${invariantErrors.join(", ")}`);
          const entry={
            index:this.history.length,turn:turnBefore,actor,phase:phaseBefore,action:clone(chosen),
            events:clone(events),before,after:clone(this.state),nextPhase:this.phase,
            done:this.done,doneReason:this.doneReason,winner:this.winner
          };
          this.history.push(entry);
          return clone(entry);
        }
      }else{
        throw new Error("unsupported main action choice state");
      }
      if(pending.pendingChoice?.kind==="cards-to-deck-bottom" && pending.choices.length){
        this.phase="main-effect-choice";
      }else if(["hagane-respect","shinra-quote-select","shinra-quote-use","kururu-regainer-card","kururu-regainer-mod","kururu-kansu-mark-used","kururu-kansu-use-special"].includes(String(pending.pendingChoice?.kind||""))){
        this.phase="main-effect-choice";
      }else if(this.pendingMainCard===pending){
        this._continueMainActionCard(pending,events);
      }
    }else if(this.phase==="main-effect-basic"){
      if(chosen.rule!==TURN_MAIN_EFFECT_BASIC) throw new Error("invalid effect basic action choice");
      const pending=this.pendingMainCard;
      if(!pending || pending.kind!=="action-card" || Number(pending.playerId)!==actor) throw new Error("missing action-card basic action state");
      if(chosen.finish){
        pending.remainingBasicActions=0;
        pending.allowThallyaExtraBasic=false;
        events.push({kind:"効果による基本動作終了",playerId:actor});
        this._continueMainActionCard(pending,events);
      }else if(chosen.thallyaBasic){
        pending.remainingBasicActions=Math.max(0,n(pending.remainingBasicActions)-1);
        const result=this._resolveThallyaExtraBasic(actor,String(chosen.thallyaBasic),events,{
          kind:"thallya-effect-basic",
          cardId:String(pending.cardId)
        });
        if(!result.pending&&!this.done){
          const hasMore=pending.remainingBasicActions>0 && (
            this._effectBasicActions(actor).length ||
            (pending.allowThallyaExtraBasic && this._thallyaExtraBasicKinds(actor).length)
          );
          if(hasMore){
            this.phase="main-effect-basic";
            events.push({kind:"基本動作選択待ち",playerId:actor,remaining:pending.remainingBasicActions});
          }else{
            pending.remainingBasicActions=0;
            pending.allowThallyaExtraBasic=false;
            this._continueMainActionCard(pending,events);
          }
        }
      }else{
        this._applyEffectBasicAction(actor,chosen.basicAction,events);
        pending.remainingBasicActions=Math.max(0,n(pending.remainingBasicActions)-1);
        const hasMore=pending.remainingBasicActions>0 && (
          this._effectBasicActions(actor).length ||
          (pending.allowThallyaExtraBasic && this._thallyaExtraBasicKinds(actor).length)
        );
        if(hasMore){
          events.push({kind:"基本動作選択待ち",playerId:actor,remaining:pending.remainingBasicActions});
        }else{
          pending.remainingBasicActions=0;
          pending.allowThallyaExtraBasic=false;
          this._continueMainActionCard(pending,events);
        }
      }
    }else if(this.phase==="start-reconstruct"){
      if(chosen.rule===TURN_RECONSTRUCT){
        const override=this._ruleHook("handleReconstruction",{events,action:clone(chosen)});
        if(!override.handled&&!override.stop){
          this._beginReconstructionSequence(actor,events,{takeLifeDamage:true,pendingDraws:this._thallyaStartDrawCount(actor,events),resumeKind:"start-phase"});
        }
      }else{
        const override=this._ruleHook("handleSkipReconstruction",{events,action:clone(chosen)});
        if(!override.handled&&!override.stop){
          events.push({kind:"再構成しない",playerId:actor});
          this.pendingDraws=this._thallyaStartDrawCount(actor,events);
          this._advanceDraws(events);
        }
      }
    }else if(this.phase==="start-fatigue"){
      const override=this._ruleHook("handleFatigue",{events,action:clone(chosen)});
      if(!override.handled&&!override.stop){
        if(chosen.rule===TURN_FATIGUE_AURA){
          applyAuraDamage(this.state,actor,1);
          this.auraDamageTakenThisTurn[actor]=true;
          events.push({kind:"焦燥",playerId:actor,choice:"aura"});
        }else{
          this._applyLifeDamageWithTriggers(actor,1,events,"fatigue");
          events.push({kind:"焦燥",playerId:actor,choice:"life"});
        }
        this.pendingDraws=Math.max(0,this.pendingDraws-1);
        if(!this._setLossIfNeeded(actor,"life-zero-fatigue")) this._advanceDraws(events);
      }
    }else if(this.phase==="effect-fatigue"){
      const pending=this.pendingEffectFatigue;
      if(!pending || Number(pending.playerId)!==actor) throw new Error("invalid effect fatigue owner");
      const override=this._ruleHook("handleFatigue",{events,action:clone(chosen),reason:pending.reason});
      if(!override.handled&&!override.stop){
        if(chosen.rule===TURN_FATIGUE_AURA){
          applyAuraDamage(this.state,actor,1);
          this.auraDamageTakenThisTurn[actor]=true;
          events.push({kind:"焦燥",playerId:actor,choice:"aura",reason:pending.reason});
        }else{
          this._applyLifeDamageWithTriggers(actor,1,events,pending.reason||"effect-fatigue");
          events.push({kind:"焦燥",playerId:actor,choice:"life",reason:pending.reason});
        }
        this.pendingEffectFatigue=null;
        if(!this._setLossIfNeeded(actor,"life-zero-fatigue")){
          if(pending.resumeKind==="main-action-draw"){
            const main=this.pendingMainCard;
            if(!main || String(main.cardId)!==String(pending.cardId)) throw new Error("main action draw resume mismatch");
            const completed=n(pending.remainingDraws)<=0 || this._drawForMainAction(main,pending.remainingDraws,events);
            if(completed) this._continueMainActionCard(main,events);
          }else if(pending.resumeKind==="shinra-sougo-draw"){
            this._continueShinraSougoDraw({
              shinraOwner:Number(pending.shinraOwner),
              opponent:Number(pending.opponent),
              sourceCardId:pending.sourceCardId,
              sourceSlug:pending.sourceSlug,
              remainingDraws:n(pending.remainingDraws),
              planResume:clone(pending.planResume||null)
            },events);
          }else if(pending.resumeKind==="end-turn"){
            this._beginYukihiEndToggleChoice(actor,events);
          }else if(pending.resumeKind==="kururu-n-response"){
            this._continueKururuNResponse(events);
          }else if(pending.resumeKind==="raira-wisdom-draw"){
            this._finishRairaWisdomAfterDraw(events);
          }else{
            this._resolveAttackAfterEffects(events);
          }
        }
      }
    }else if(this.phase==="attack-response"){
      if(chosen.rule===TURN_ATTACK_PASS){
        events.push({kind:"対応しない",playerId:actor,label:this.pendingAttack?.label||""});
        const hook=this._ruleHook("afterResponsePass",{events,attack:this.pendingAttack,defender:actor});
        if(!hook.stop&&!this.done) this._advanceAttackAfterResponse(events);
      }else if(chosen.rule===TURN_ATTACK_RESPOND){
        this._useResponseCard(chosen.cardId,events);
      }else{
        throw new Error("unsupported response action");
      }
    }else if(this.phase==="attack-damage-choice"){
      if(chosen.rule!==TURN_ATTACK_DAMAGE) throw new Error("invalid attack damage action");
      const choices=attackDamageOptions(this.state,this.pendingAttack);
      const selected=choices.find(option=>
        String(option.choice)===String(chosen.damageChoice) &&
        Math.max(0,n(option.silentWallUse))===Math.max(0,n(chosen.silentWallUse))
      );
      if(!selected) throw new Error("illegal attack damage choice");
      this._applyAttackDamage(selected,events);
    }else if(this.phase==="response-card-choice"){
      if(chosen.rule!==TURN_RESPONSE_EFFECT_CHOICE) throw new Error("invalid response effect choice");
      const pending=this.pendingResponseCard;
      if(!pending || Number(pending.playerId)!==actor) throw new Error("missing response card choice");
      if(!arr(pending.choices).includes(String(chosen.choice))) throw new Error("illegal response effect choice");
      if(pending.kind==="raira-tengu-step"){
        this._applyRairaTenguChoice(actor,String(chosen.choice),events);
        const removed=this._removeUsingCardToOutside(actor,pending.cardId);
        events.push({kind:"取り除く",playerId:actor,cardId:pending.cardId,source:"風魔天狗道",removed});
        this._finishActionResponseCard(events);
      }else if(pending.kind==="kururu-n-effect"){
        this._applyKururuNEffect(String(chosen.choice),events);
      }else if(pending.kind==="kururu-n-facedown"){
        const pid=Number(pending.playerId),id=String(chosen.choice);
        const fdKey=`p${pid}_facedown`,deckKey=`p${pid}_deck`;
        this.state[fdKey]=arr(this.state[fdKey]);
        this.state[deckKey]=arr(this.state[deckKey]);
        const index=this.state[fdKey].findIndex(x=>String(x)===id);
        if(index<0) throw new Error("Kururu-n facedown target missing");
        const moved=this.state[fdKey].splice(index,1)[0];
        this.state[deckKey].push(moved);
        events.push({kind:"山札の底へ",playerId:pid,cardId:moved,source:"くるるーん"});
        this._continueKururuNResponse(events);
      }else if(pending.kind==="enhancement-placement"){
        this._applyResponseEnhancementPlacement(String(chosen.choice),events);
      }else if(pending.kind==="korunu-porucharto-arrow"){
        const arrow=String(chosen.choice);
        if(!["distance-to-dust","dust-to-distance"].includes(arrow)) throw new Error("invalid Porucharto response arrow");
        const moved=applyArrowAsMuchAsPossible(this.state,pending.playerId,arrow,1,this.options);
        events.push({kind:"対応付与展開時",effect:"矢印",playerId:pending.playerId,arrow,moved});
        this._freezePlayer(pending.playerId===1?2:1,1,events,pending.slug);
        pending.kind="enhancement-placement";
        pending.deployChoice=null; pending.choices=[];
        if(n(pending.deployedPlaced)===0) this._resolveImmediateResponseEnhancementDiscard(pending,events);
        else this._finishResponseEnhancementWithoutDiscard(pending,events);
      }else if(pending.kind==="enhancement-deploy-seal"){
        const opponent=Number(pending.deployChoice?.opponent),target=String(chosen.choice);
        this._sealCardUnder(pending.playerId,pending.cardId,opponent,target,events);
        pending.kind="enhancement-placement";
        pending.deployChoice=null; pending.choices=[];
        if(n(pending.deployedPlaced)===0) this._resolveImmediateResponseEnhancementDiscard(pending,events);
        else this._finishResponseEnhancementWithoutDiscard(pending,events);
      }else if(pending.kind==="use-facedown"){
        if(String(chosen.choice)==="done"){
          this._finishActionResponseCard(events);
        }else{
          const cardId=String(chosen.choice);
          pending.choices=[];
          this._beginFacedownCardUse(actor,cardId,events,{kind:"tobi-response"},{asResponse:true});
        }
      }else{
        this._applyResponseArrow(actor,pending.effect,String(chosen.choice),events);
        this._applyResponseActionAfterEffects(actor,pending.effect,events);
        this._finishActionResponseCard(events);
      }
    }else if(this.phase==="start-card-choice"){
      const d=this.pendingCardDecision;
      if(!d) throw new Error("missing pending card decision");
      if(String(chosen.choiceKind)!==String(d.kind) || String(chosen.sourceCardId)!==String(d.sourceCardId)){
        throw new Error("card choice does not match pending decision");
      }
      if(!arr(d.candidates).some(x=>String(x)===String(chosen.choiceCardId))) throw new Error("card choice target is not a candidate");
      if(d.kind==="yurina-mondo-basic"){
        const basic=Number(chosen.choiceCardId),defender=Number(d.defender);
        this.pendingCardDecision=null;
        this._applyEffectBasicAction(actor,basic,events);
        if(this._effectBasicActions(defender).includes(basic)){
          this._applyEffectBasicAction(defender,basic,events);
          events.push({kind:"問答・同じ基本動作",playerId:defender,basicAction:basic,label:BASIC_ACTION_NAMES[basic]});
        }else{
          events.push({kind:"問答・同じ基本動作不可",playerId:defender,basicAction:basic,label:BASIC_ACTION_NAMES[basic]});
        }
        this._resolveAttackAfterEffects(events);
      }else if(d.kind==="yurina-aun-choice"){
        const choice=String(chosen.choiceCardId),resume=clone(d.yurinaResume||{kind:"phase",phase:"main"}),sourceCardId=String(d.sourceCardId);
        this.pendingCardDecision=null;
        events.push({kind:"阿吽",playerId:actor,cardId:sourceCardId,choice});
        if(choice==="attack"){
          this._beginYurinaAunAttack(actor,sourceCardId,resume,events);
        }else if(choice==="matoi"){
          this._applyEffectBasicAction(actor,3,events);
          if(this._effectBasicActions(actor).includes(4)){
            this.pendingCardDecision={
              kind:"yurina-aun-yadoshi",playerId:actor,label:"阿吽",
              sourceCardId,slug:"re_01_yurina_a2_n_7",candidates:["skip","4"],yurinaResume:resume
            };
            this.phase="start-card-choice";
            events.push({kind:"選択待ち",playerId:actor,cardId:sourceCardId,choice:"阿吽・宿し",candidates:["skip","4"]});
          }else this._resumeYurinaAun(resume,events);
        }else if(choice==="skip"){
          this._resumeYurinaAun(resume,events);
        }else throw new Error("invalid Aun choice");
      }else if(d.kind==="yurina-aun-yadoshi"){
        const choice=String(chosen.choiceCardId),resume=clone(d.yurinaResume||{kind:"phase",phase:"main"});
        this.pendingCardDecision=null;
        if(choice==="4") this._applyEffectBasicAction(actor,4,events);
        else if(choice!=="skip") throw new Error("invalid Aun Yadoshi choice");
        this._resumeYurinaAun(resume,events);
      }else if(d.kind==="yurina-shinzawatari-basic"){
        const attack=this.pendingAttack;
        if(!attack?.yurinaShinzawatariState) throw new Error("Shinzawatari basic state missing");
        const choice=String(chosen.choiceCardId);
        this.pendingCardDecision=null;
        if(choice==="done"){
          attack.yurinaShinzawatariState.remainingBasic=0;
        }else{
          const basic=Number(choice);
          if(![3,4].includes(basic)) throw new Error("invalid Shinzawatari basic choice");
          this._applyEffectBasicAction(actor,basic,events);
          attack.yurinaShinzawatariState.remainingBasic=Math.max(0,n(attack.yurinaShinzawatariState.remainingBasic)-1);
        }
        if(!this._beginYurinaShinzawatariChoice(attack,events)) this._resolveAttackAfterEffects(events);
      }else if(d.kind==="yurina-shinzawatari-ready"){
        const attack=this.pendingAttack;
        if(!attack?.yurinaShinzawatariState) throw new Error("Shinzawatari ready state missing");
        const choice=String(chosen.choiceCardId);
        this.pendingCardDecision=null;
        if(choice==="done"){
          attack.yurinaShinzawatariState.remainingReady=0;
        }else{
          readySpecialCard(this.state,actor,choice);
          attack.yurinaShinzawatariState.remainingReady=Math.max(0,n(attack.yurinaShinzawatariState.remainingReady)-1);
          events.push({kind:"切札を未使用に戻す",playerId:actor,cardId:choice,source:"神座渡"});
        }
        if(!this._beginYurinaShinzawatariChoice(attack,events)) this._resolveAttackAfterEffects(events);
      }else if(d.kind==="raira-cycle-after-attack"){
        const value=String(chosen.choiceCardId);
        this.pendingCardDecision=null;
        if(value!=="skip"){
          const m=/^(wind|thunder):(distance-to-dust|dust-to-distance)$/.exec(value);
          if(!m) throw new Error("invalid Raira cycle choice");
          const moved=applyArrowAsMuchAsPossible(this.state,actor,m[2],1,this.options);
          events.push({kind:"円環輪廻旋",playerId:actor,arrow:m[2],moved});
          if(stateHasRaira(this.state,actor)) this._raiseRairaGauge(actor,m[1],1,events,"円環輪廻旋");
        }
        this._finishPendingAttack(events);
      }else if(d.kind==="raira-flow-return"){
        const choice=String(chosen.choiceCardId);
        this.pendingCardDecision=null;
        if(choice!=="skip") this._rairaPutDiscardOnDeckTop(actor,choice,events,"流転爪");
        this._finishPendingAttack(events);
      }else if(d.kind==="kururu-big-golem-end"){
        const choice=String(chosen.choiceCardId);
        this.pendingCardDecision=null;
        if(choice==="skip"){
          this._continueEndTurnAfterKururu(events);
        }else if(choice==="use"){
          const opponent=actor===1?2:1;
          this._kururuDirectLife(actor,opponent,1,events,"びっぐごーれむ");
          if(!this.done) this._beginReconstructionSequence(actor,events,{takeLifeDamage:false,pendingDraws:0,resumeKind:"kururu-big-golem-end"});
        }else throw new Error("invalid Big Golem end choice");
      }else if(d.kind==="kururu-n-opponent-discard"){
        const pid=Number(d.playerId),id=String(chosen.choiceCardId);
        const handKey=`p${pid}_hand`,discardKey=`p${pid}_discard`;
        this.state[handKey]=arr(this.state[handKey]);
        this.state[discardKey]=arr(this.state[discardKey]);
        const index=this.state[handKey].findIndex(x=>String(x)===id);
        if(index<0) throw new Error("Kururu-n discard target missing");
        const moved=this.state[handKey].splice(index,1)[0];
        this.state[discardKey].push(moved);
        events.push({kind:"手札破棄",playerId:pid,cardId:moved,source:"くるるーん"});
        this.pendingCardDecision=null;
        this._continueKururuNResponse(events);
      }else if(d.kind==="yukihi-kasamawashi-reveal"){
        const choice=String(chosen.choiceCardId),resume=clone(d.yukihiResume||null),remaining=clone(d.remainingKasamawashi||[]);
        if(choice==="reveal"){
          events.push({kind:"公開",playerId:actor,cardId:d.sourceCardId,slug:d.slug,source:"傘の開閉"});
          this._applyEffectMatoi(actor,events,"かさまわし");
        }else if(choice!=="skip") throw new Error("invalid Kasamawashi reveal choice");
        this.pendingCardDecision=null;
        this._continueYukihiKasamawashiReveals(actor,remaining,resume,events);
      }else if(d.kind==="thallya-ride"){
        const choice=String(chosen.choiceCardId),resume=clone(d.thallyaResume||null);
        let recharged=0;
        if(choice!=="skip") recharged=this._thallyaRide(actor,choice,events,d.thallyaSource||d.label);
        this.pendingCardDecision=null;
        if(recharged>0 && this._kururuDrainDevilCard(actor) && !this.terminalLocked?.[actor]){
          this._beginKururuDrainReuse([{playerId:actor,count:recharged}],{kind:"thallya-ride",rideResume:resume},events);
        }else this._resumeAfterThallyaRide(resume,events);
      }else if(d.kind==="thallya-dual-discard"){
        const cardId=String(chosen.choiceCardId);
        this.pendingCardDecision=null;
        if(cardId==="skip") this._resolveAttackAfterEffects(events);
        else this._beginThallyaDualDiscardAttack(actor,cardId,events);
      }else if(d.kind==="chikage-attack-poison"||d.kind==="chikage-anki-poison"){
        const bagOwner=Number(d.bagOwner),target=Number(d.targetPlayer),kind=String(d.kind);
        this._chikageTransferPoison(bagOwner,target,String(chosen.choiceCardId),String(d.destination||"hand"),events,d.slug);
        this.pendingCardDecision=null;
        if(kind==="chikage-anki-poison"&&this._chikageHandHasPoison(target)) this._applyEffectMatoi(bagOwner,events,"暗器");
        this._resolveAttackAfterEffects(events);
      }else if(d.kind==="yukihi-attack-after-arrow"){
        const arrow=String(chosen.choiceCardId);
        if(!["distance-to-dust","dust-to-distance"].includes(arrow)) throw new Error("invalid Yukihi attack-after arrow");
        const moved=applyArrowAsMuchAsPossible(this.state,actor,arrow,1,this.options);
        events.push({kind:"攻撃後矢印",playerId:actor,source:d.label||"ふりはらい",arrow,requested:1,moved});
        this.pendingCardDecision=null;
        this._resolveAttackAfterEffects(events);
      }else if(d.kind==="korunu-porucharto-redeploy"){
        const choice=String(chosen.choiceCardId),pid=Number(d.playerId),source=String(d.sourceCardId);
        if(choice==="discard"){
          this.pendingCardDecision=null;
          const moved=finishEnhancementDiscard(this.state,pid,source);
          events.push({kind:"付与札の破棄完了",playerId:pid,cards:[{cardId:source,...moved}]});
          this._onEnhancementDiscarded(pid,source,events);
          if(!this.done){
            if(d.resumeKind==="response-enhancement"){
              this._advanceAttackAfterResponse(events);
            }else{
              this.pendingEnhancementDiscards.shift();
              this._advanceEnhancementDiscardQueue(events);
            }
          }
        }else if(choice==="redeploy"){
          const cost=Math.max(0,n(d.cost)),charge=Math.max(0,n(d.charge));
          if(n(this.state?.[`p${pid}_flare`])<cost) throw new Error("insufficient flare for Porucharto redeploy");
          this.state[`p${pid}_flare`]=n(this.state[`p${pid}_flare`])-cost;
          this.state.dust=n(this.state.dust)+cost;
          this.cardUseCountsThisTurn[pid]=Math.max(0,n(this.cardUseCountsThisTurn?.[pid]))+1;
          this._markCardUseTraits(pid,String(d.slug||""),events);
          const placements=enhancementPlacementOptions(this.state,pid,charge);
          events.push({kind:"カード再使用",playerId:pid,cardId:source,slug:d.slug,cost:{kind:"flare",amount:cost},charge});
          this.pendingCardDecision={
            kind:"korunu-porucharto-redeploy-placement",
            playerId:pid,
            label:"ポルチャルトー",
            sourceCardId:source,
            slug:d.slug,
            candidates:placements.map(enhancementPlacementKey),
            charge,
            resumeKind:d.resumeKind||null
          };
          this.phase="start-card-choice";
          events.push({kind:"選択待ち",playerId:pid,cardId:source,choice:"付与の納め方",candidates:clone(this.pendingCardDecision.candidates)});
        }else throw new Error("invalid Porucharto redeploy choice");
      }else if(d.kind==="korunu-porucharto-redeploy-placement"){
        const pid=Number(d.playerId),source=String(d.sourceCardId),placement=parseEnhancementPlacementKey(chosen.choiceCardId);
        if(!placement) throw new Error("invalid Porucharto redeploy placement");
        const legal=enhancementPlacementOptions(this.state,pid,d.charge).some(x=>enhancementPlacementKey(x)===String(chosen.choiceCardId));
        if(!legal) throw new Error("illegal Porucharto redeploy placement");
        if(placement.dustUsed>n(this.state.dust)||placement.auraUsed>n(this.state[`p${pid}_aura`])) throw new Error("Porucharto redeploy resource mismatch");
        this.state.dust=n(this.state.dust)-placement.dustUsed;
        this.state[`p${pid}_aura`]=n(this.state[`p${pid}_aura`])-placement.auraUsed;
        const status=this.state?.[`p${pid}_card_status`]?.[source];
        if(!status) throw new Error("Porucharto status missing");
        status.Charge=placement.placed;
        status.TokenCharges={"1":placement.placed};
        events.push({kind:"付与展開",playerId:pid,cardId:source,placed:placement.placed,dustUsed:placement.dustUsed,auraUsed:placement.auraUsed,reuse:true});
        this.pendingCardDecision={
          kind:"korunu-porucharto-redeploy-arrow",
          playerId:pid,
          label:"ポルチャルトー",
          sourceCardId:source,
          slug:d.slug,
          candidates:["distance-to-dust","dust-to-distance"],
          resumeKind:d.resumeKind||null
        };
        this.phase="start-card-choice";
        events.push({kind:"選択待ち",playerId:pid,cardId:source,choice:"間合⇔ダスト",candidates:["distance-to-dust","dust-to-distance"]});
      }else if(d.kind==="korunu-porucharto-redeploy-arrow"){
        const pid=Number(d.playerId),source=String(d.sourceCardId),arrow=String(chosen.choiceCardId);
        if(!["distance-to-dust","dust-to-distance"].includes(arrow)) throw new Error("invalid Porucharto redeploy arrow");
        const moved=applyArrowAsMuchAsPossible(this.state,pid,arrow,1,this.options);
        events.push({kind:"付与展開時矢印",playerId:pid,cardId:source,arrow,moved});
        this._freezePlayer(pid===1?2:1,1,events,d.slug);
        this.pendingCardDecision=null;
        if(d.resumeKind==="response-enhancement"){
          this._advanceAttackAfterResponse(events);
        }else{
          this.pendingEnhancementDiscards.shift();
          this._advanceEnhancementDiscardQueue(events);
        }
      }else if(d.kind==="megumi-seed-tick-choice"){
        const choice=String(chosen.choiceCardId),plan=clone(d.tickPlan||{});
        const item=arr(plan.plan).find(row=>String(row.cardId)===String(d.sourceCardId)&&row.seedChoiceRequired&&!row.seedChoiceResolved);
        if(!item) throw new Error("Megumi seed tick choice target missing");
        if(choice==="sakura") item.tokenType="1";
        else if(choice==="seed") item.tokenType="19";
        else throw new Error("invalid Megumi seed tick choice");
        item.seedChoiceResolved=true;
        this.pendingCardDecision=null;
        if(this._maybeChooseMegumiSeedTick(plan,events)) return;
        if(this._maybeChooseFrostThornTick(plan,events)) return;
        this._applyPreparedStartEnhancementTick(plan,events);
      }else if(d.kind==="korunu-frost-thorn-tick"){
        const choice=String(chosen.choiceCardId),plan=clone(d.tickPlan||{});
        if(choice==="hold"){
          plan.plan=arr(plan.plan).filter(item=>String(item.cardId)!==String(d.sourceCardId));
          events.push({kind:"霜の茨",playerId:actor,cardId:d.sourceCardId,effect:"結晶を移動しない"});
        }else if(choice!=="tick"){
          throw new Error("invalid Frost Thorn tick choice");
        }
        this.pendingCardDecision=null;
        this._applyPreparedStartEnhancementTick(plan,events);
      }else if(d.kind==="forced-ready-used-special"){
        const pid=Number(d.playerId),source=String(d.sourceCardId),resume=clone(d.forcedResume||null);
        readySpecialCard(this.state,pid,chosen.choiceCardId);
        events.push({kind:"破棄時効果",playerId:pid,cardId:source,slug:d.slug,effect:"切札を未使用に戻す",targetCardId:chosen.choiceCardId});
        this.pendingCardDecision=null;
        this._finishForcedEnhancementDiscard(pid,source,events,resume);
      }else       if(d.kind==="shinra-sougo-facedown"){
        const pid=Number(d.playerId),handKey=`p${pid}_hand`,facedownKey=`p${pid}_facedown`,target=String(chosen.choiceCardId);
        this.state[handKey]=arr(this.state[handKey]); this.state[facedownKey]=arr(this.state[facedownKey]);
        const index=this.state[handKey].findIndex(x=>String(x)===target);
        if(index<0) throw new Error("Sougo target left hand");
        const [moved]=this.state[handKey].splice(index,1); this.state[facedownKey].push(moved);
        d.remaining=Math.max(0,n(d.remaining)-1);
        events.push({kind:"手札から伏せ札",playerId:pid,cardId:moved,source:d.slug});
        const remain=arr(this.state[handKey]).filter(cardId=>!isChikagePoisonCard(this.state,pid,cardId)).map(String);
        if(d.remaining>0 && remain.length){
          d.candidates=remain;
          this.phase="start-card-choice";
          events.push({kind:"選択待ち",playerId:pid,choice:"伏せ札",candidates:clone(remain)});
        }else{
          const owner=Number(d.shinraOwner),resume=clone(d.planResume||null);
          this.pendingCardDecision=null;
          this._requestShinraPlanPreparation(owner,resume,events);
        }
      }else if(d.kind==="shinra-plan-use-opponent-discard-card"){
        const owner=Number(d.shinraOwner),opponent=owner===1?2:1,target=String(chosen.choiceCardId),resume=clone(d.planResume||null);
        this.pendingCardDecision=null;
        if(target==="done"){
          this._requestShinraPlanPreparation(owner,resume,events);
        }else{
          this._beginBorrowedCardUse(owner,opponent,target,"discard",events,{kind:"shinra-plan-borrowed",shinraOwner:owner,planResume:resume});
        }
      }else if(d.kind==="shinra-plan-use-own-used-special-enhancement-free"){
        const owner=Number(d.shinraOwner),target=String(chosen.choiceCardId),resume=clone(d.planResume||null);
        const rule=this.cardRuleRegistry?.get(stateCardSlug(this.state,owner,target))?.mainUse;
        this.pendingCardDecision=null;
        this._beginOwnUsedSpecialEnhancementFree(owner,target,events,{
          kind:"shinra-plan-own-special",
          shinraOwner:owner,
          planResume:resume,
          endPhaseAfterPlan:!!rule?.fullPower
        });
      }else if(d.kind==="shinra-plan-destroy-opponent-nonspecial-enhancement"){
        const owner=Number(d.shinraOwner),opponent=owner===1?2:1,target=String(chosen.choiceCardId),resume=clone(d.planResume||null);
        this.pendingCardDecision=null;
        const status=this.state?.[`p${opponent}_card_status`]?.[target];
        if(!status) throw new Error("target enhancement status missing");
        const tokenCharges=positiveTokenChargeMap(status)||{};
        const total=Object.keys(tokenCharges).length?Object.values(tokenCharges).reduce((sum,x)=>sum+n(x),0):Math.max(0,n(status.Charge));
        this.state.dust=n(this.state.dust)+total;
        status.Charge=0; status.TokenCharges={};
        events.push({kind:"付与札結晶除去",playerId:opponent,cardId:target,count:total,source:d.slug});
        this._beginForcedEnhancementDiscard(opponent,target,events,{
          kind:"shinra-s2-destroy",
          shinraOwner:owner,
          planResume:resume
        });
      }else       if(d.kind==="opponent-discard-one"){
        const pid=Number(d.playerId),handKey=`p${pid}_hand`,discardKey=`p${pid}_discard`;
        this.state[handKey]=arr(this.state[handKey]); this.state[discardKey]=arr(this.state[discardKey]);
        const index=this.state[handKey].findIndex(cardId=>String(cardId)===String(chosen.choiceCardId));
        if(index<0) throw new Error("opponent discard target left hand");
        const [moved]=this.state[handKey].splice(index,1); this.state[discardKey].push(moved);
        events.push({kind:"手札破棄",playerId:pid,cardId:moved,source:d.slug});
        this.pendingCardDecision=null;
        this._resolveAttackAfterEffects(events);
      }else       if(d.kind==="bunshin-hand"){
        const parent=this.pendingAttack;
        if(!parent) throw new Error("bunshin parent attack missing");
        const choice=String(chosen.choiceCardId);
        const effect=clone(d.effect||{});
        this.pendingCardDecision=null;
        if(choice==="done"){
          this._resolveAttackAfterEffects(events);
        }else{
          const handKey=`p${actor}_hand`,facedownKey=`p${actor}_facedown`;
          this.state[handKey]=arr(this.state[handKey]);
          this.state[facedownKey]=arr(this.state[facedownKey]);
          const index=this.state[handKey].findIndex(cardId=>String(cardId)===choice);
          if(index<0) throw new Error("bunshin hand card left hand");
          const [moved]=this.state[handKey].splice(index,1);
          this.state[facedownKey].push(moved);
          events.push({kind:"手札から伏せ札",playerId:actor,cardId:moved,source:d.slug});
          this._beginBunshinExtraAttack(parent,effect,events);
        }
      }else       if(d.kind==="ready-used-special-immediate"){
        readySpecialCard(this.state,actor,chosen.choiceCardId);
        events.push({kind:"破棄時効果",playerId:actor,cardId:d.sourceCardId,slug:d.slug,effect:"切札を未使用に戻す",targetCardId:chosen.choiceCardId});
        this.pendingCardDecision=null;
        const pending=this.pendingMainCard;
        if(!pending || String(pending.cardId)!==String(d.sourceCardId)) throw new Error("immediate enhancement discard state changed");
        this._finishImmediateMainEnhancementDiscard(pending,events);
      }else       if(d.kind==="ready-used-special"){
        readySpecialCard(this.state,actor,chosen.choiceCardId);
        events.push({
          kind:"破棄時効果",
          playerId:actor,
          cardId:d.sourceCardId,
          slug:d.slug,
          effect:"切札を未使用に戻す",
          targetCardId:chosen.choiceCardId
        });
        this.pendingCardDecision=null;
        const source=this.pendingEnhancementDiscards[0];
        if(String(source)!==String(d.sourceCardId)) throw new Error("pending enhancement discard queue changed unexpectedly");
        const owner=this.pendingEnhancementDiscardOwner||actor;
        const moved=finishEnhancementDiscard(this.state,owner,source);
        events.push({kind:"付与札の破棄完了",playerId:owner,cards:[{cardId:source,...moved}]});
        this._onEnhancementDiscarded(owner,source,events);
        if(this.done) return;
        this.pendingEnhancementDiscards.shift();
        this._advanceEnhancementDiscardQueue(events);
      }else if(d.kind==="opponent-discard-non-attack"){
        const pid=Number(d.playerId),handKey=`p${pid}_hand`,discardKey=`p${pid}_discard`;
        this.state[handKey]=arr(this.state[handKey]);
        this.state[discardKey]=arr(this.state[discardKey]);
        const index=this.state[handKey].findIndex(cardId=>String(cardId)===String(chosen.choiceCardId));
        if(index<0) throw new Error("opponent discard target left hand");
        const [moved]=this.state[handKey].splice(index,1);
        this.state[discardKey].push(moved);
        events.push({kind:"手札破棄",playerId:pid,cardId:moved,source:d.slug});
        this.pendingCardDecision=null;
        this._resolveAttackAfterEffects(events);
      }else if(d.kind==="thallya-a1-asura-discard"){
        const pid=Number(d.playerId),id=String(chosen.choiceCardId),fdKey=`p${pid}_facedown`,discardKey=`p${pid}_discard`;
        this.state[fdKey]=arr(this.state[fdKey]); this.state[discardKey]=arr(this.state[discardKey]);
        const index=this.state[fdKey].findIndex(x=>String(x)===id);
        if(index<0) throw new Error("ASURA discard target left facedown");
        const [moved]=this.state[fdKey].splice(index,1); this.state[discardKey].push(moved);
        d.remaining=Math.max(0,n(d.remaining)-1);
        events.push({kind:"TransForm効果",playerId:Number(d.ownerId),form:"ASURA",effect:"facedown-to-discard",targetPlayer:pid,cardId:moved});
        if(d.remaining>0 && this.state[fdKey].length){
          d.candidates=this.state[fdKey].map(String);
          this.phase="start-card-choice";
          events.push({kind:"選択待ち",playerId:pid,choice:"ASURA・伏せ札を捨て札",candidates:clone(d.candidates),remaining:d.remaining});
        }else{
          this.pendingCardDecision=null;
          const pending=this.pendingMainCard;
          if(pending) this._continueMainActionCard(pending,events);
          else this.phase="main";
        }
      }else if(d.kind==="end-hand-limit-discard"){
        const pid=Number(d.playerId),id=String(chosen.choiceCardId),handKey=`p${pid}_hand`,discardKey=`p${pid}_discard`;
        this.state[handKey]=arr(this.state[handKey]);
        this.state[discardKey]=arr(this.state[discardKey]);
        const index=this.state[handKey].findIndex(x=>String(x)===id);
        if(index<0) throw new Error("hand-limit discard target left hand");
        const [moved]=this.state[handKey].splice(index,1);
        this.state[discardKey].push(moved);
        events.push({kind:"手札破棄",playerId:pid,cardId:moved,source:"手札上限"});
        const limit=Math.max(0,n(d.limit));
        if(this.state[handKey].length>limit){
          d.candidates=this.state[handKey].map(String);
          this.phase="start-card-choice";
          events.push({kind:"手札上限選択待ち",playerId:pid,limit,handCount:this.state[handKey].length,candidates:clone(d.candidates)});
        }else{
          this.pendingCardDecision=null;
          this._finishEndTurn(events);
        }
      }else if(d.kind==="enhancement-discard-order"){
        const targetIndex=this.pendingEnhancementDiscards.findIndex(x=>String(x)===String(chosen.choiceCardId));
        if(targetIndex<0) throw new Error("selected enhancement discard is not pending");
        const [selected]=this.pendingEnhancementDiscards.splice(targetIndex,1);
        this.pendingEnhancementDiscards.unshift(selected);
        this.pendingEnhancementDiscardSelected=selected;
        this.pendingCardDecision=null;
        events.push({kind:"付与札の破棄順選択",playerId:actor,cardId:selected});
        this._advanceEnhancementDiscardQueue(events);
      }else{
        throw new Error(`unsupported pending card decision: ${d.kind}`);
      }
    }
    return commitStep();
  }
  snapshot(){
    return {
      state:clone(this.state),
      openingState:clone(this.openingState),
      openingSetup:clone(this.openingSetup),
      turnPlayer:this.turnPlayer,
      turnNumber:this.turnNumber,
      completedTurns:this.completedTurns,
      turnsTaken:clone(this.turnsTaken),
      phase:this.phase,
      pendingDraws:this.pendingDraws,
      pendingEnhancementDiscards:clone(this.pendingEnhancementDiscards),
      pendingEnhancementDiscardSelected:this.pendingEnhancementDiscardSelected,
      pendingCardDecision:clone(this.pendingCardDecision),
      pendingAttack:clone(this.pendingAttack),
      attackStack:clone(this.attackStack),
      pendingEffectFatigue:clone(this.pendingEffectFatigue),
      pendingResponseCard:clone(this.pendingResponseCard),
      pendingMainCard:clone(this.pendingMainCard),
      pendingMainCardStack:clone(this.pendingMainCardStack),
      pendingReconstruction:clone(this.pendingReconstruction),
      mainMode:this.mainMode,
      fullPowerCardUsed:this.fullPowerCardUsed,
      nextAttackModifiers:clone(this.nextAttackModifiers),
      nextOtherMegamiAttackModifiers:clone(this.nextOtherMegamiAttackModifiers),
      intimidated:{1:!!this.state.p1_intimidated,2:!!this.state.p2_intimidated},
      attackCountsThisTurn:clone(this.attackCountsThisTurn),
      cardUseCountsThisTurn:clone(this.cardUseCountsThisTurn),
      auraDamageTakenThisTurn:clone(this.auraDamageTakenThisTurn),
      turnStartDistance:this.turnStartDistance,
      attackPerformedInPhase:clone(this.attackPerformedInPhase),
      centrifugalUsedThisTurn:clone(this.centrifugalUsedThisTurn),
      shinraPlan:clone(this.shinraPlan),
      pendingShinraPlan:clone(this.pendingShinraPlan),
      pendingAttackPostResponseChoice:clone(this.pendingAttackPostResponseChoice),
      pendingYukihiEndToggle:clone(this.pendingYukihiEndToggle),
      pendingKururuBasic:clone(this.pendingKururuBasic),
      pendingKururuDrainReuse:clone(this.pendingKururuDrainReuse),
      pendingYurinaAunTriggers:clone(this.pendingYurinaAunTriggers),
      terminalLocked:clone(this.terminalLocked),
      done:this.done,
      doneReason:this.doneReason,
      winner:this.winner,
      history:clone(this.history)
    };
  }
}

export let baselineAttackRuleRegistry=null;
function baselineNormalAttackScore(action,status,opponent){
  if(!baselineAttackRuleRegistry) baselineAttackRuleRegistry=createDefaultCardRuleRegistry();
  const slug=normalizeCardSlug(status?.Slug||status?.slug||"");
  const rule=baselineAttackRuleRegistry.get(slug);
  const attack=rule?.mainUse?.attack||{};
  const life=Number(attack.lifeDamage),aura=Number(attack.auraDamage);
  const hasLife=Number.isFinite(life),hasAura=Number.isFinite(aura);
  if(!hasLife && !hasAura) return 0;
  const oppAura=Math.max(0,n(opponent?.aura));
  // Favor attacks with meaningful unavoidable life damage or large aura pressure.
  // This is an ordering heuristic, not a substitute for defensive-response search.
  const lifeThreat=hasLife ? Math.max(0,life)*4 : 0;
  const auraPressure=hasAura ? Math.max(0,aura)*Math.min(1,Math.max(0,oppAura)/Math.max(1,aura)) : 0;
  const forcedLife=hasLife&&hasAura&&aura>oppAura ? life*2 : 0;
  return lifeThreat+auraPressure+forcedLife;
}
export class BaselineCoreTurnAgent{
  constructor(seed=1,endTurnRate=0.25){
    this.random=seededUnit(seed);
    this.endTurnRate=Math.max(0,Math.min(1,Number(endTurnRate)||0));
    this.previousDecision=null;
    this.mondoAuraSetupPending=false;
    this.mondoPartnerFollowUpPending=false;
  }
  chooseAction(context){
    const observation=context?.observation||{};
    const actor=Number(context?.playerId)||Number(observation?.turnPlayer)||0;
    const turn=Number(observation?.turn)||0;
    const actionIndex=Math.max(0,Number(context?.actionIndex)||0);
    if(actionIndex===0){
      this.previousDecision=null;
      this.mondoAuraSetupPending=false;
      this.mondoPartnerFollowUpPending=false;
    }

    let legal=Array.isArray(context?.legalActions)?context.legalActions:[];
    if(!legal.length) throw new Error("baseline core turn agent received no legal action");

    const previous=this.previousDecision;
    if(
      previous &&
      previous.actor===actor &&
      previous.turn===turn &&
      previous.action?.rule==="core-standard-basic"
    ){
      const previousBasic=Number(previous.action.basicAction);
      const oppositeBasics=previousBasic===1
        ? new Set([2,5])
        : ((previousBasic===2||previousBasic===5)?new Set([1]):new Set());
      if(oppositeBasics.size){
        const filtered=legal.filter(action=>!(
          action?.rule==="core-standard-basic" &&
          oppositeBasics.has(Number(action?.basicAction))
        ));
        if(filtered.length) legal=filtered;
      }
    }

    const remember=action=>{
      const selected=clone(action);
      this.previousDecision={actor,turn,action:clone(selected)};
      return selected;
    };

    // Enhancement placement is a resource choice, not a random tie break.
    // Preserve aura whenever the same number of tokens can come from dust.
    const enhancementChoices=legal.filter(action=>action?.rule===TURN_MAIN_ENHANCEMENT_CHOICE);
    if(enhancementChoices.length){
      const parse=action=>parseEnhancementPlacementKey(action.choice)||{dustUsed:0,auraUsed:999,seedUsed:0,placed:0};
      const best=enhancementChoices.slice().sort((a,b)=>{
        const x=parse(a),y=parse(b);
        return (y.placed-x.placed)||(x.auraUsed-y.auraUsed)||(y.dustUsed-x.dustUsed);
      })[0];
      return remember(best);
    }

    const templateSelf=observation?.self||{};
    const templateStatus=templateSelf.cardStatus||{};
    const yurinaAunActive=arr(templateSelf.enhancement).some(cardId=>
      normalizeCardSlug(templateStatus?.[String(cardId)]?.Slug||"")==="re_01_yurina_a2_n_7"
    );
    const templateSpecialStatus=templateSelf.specialStatus||{};
    const templateSelfTurn=Math.max(1,n(observation?.selfTurnNumber||1));
    const templateCycle=templateSelfTurn%3;
    const templateA1=Object.values(templateStatus).some(row=>
      normalizeCardSlug(row?.Slug||row?.slug||"").startsWith("re_11_thallya_a1_")
    );
    const templateCardIdBySlug=slug=>{
      for(const [cardId,row] of Object.entries(templateStatus)){
        if(normalizeCardSlug(row?.Slug||row?.slug||"")===slug) return String(cardId);
      }
      return "";
    };
    const templateNeoId=templateCardIdBySlug("re_11_thallya_a1_s_1");
    const templateNeoCharge=Math.max(0,n(templateStatus?.[templateNeoId]?.Charge));
    const templateNeoReady=!!templateNeoId &&
      arr(templateSelf.special).map(String).includes(templateNeoId) &&
      Number(templateSpecialStatus?.[templateNeoId]||0)!==2 &&
      n(templateSelf.flare)>=1;
    const templateActionBySlug=slug=>legal.find(action=>{
      if(action?.rule!==TURN_USE_CARD || action?.cardId==null) return false;
      return normalizeCardSlug(templateStatus?.[String(action.cardId)]?.Slug||"")===slug;
    });
    const templateNeoAction=templateActionBySlug("re_11_thallya_a1_s_1");
    const templateQuickChange=templateActionBySlug("re_11_thallya_a1_n_5");
    const templateSteamCannon=templateActionBySlug("re_11_thallya_o_n_4");
    const templateRoaring=templateActionBySlug("re_11_thallya_o_n_6");
    const templateBurned=Math.max(0,n(templateSelf.thallyaBurned));
    const templateForms=arr(templateSelf.thallyaA1Forms).map(String);
    const templateOpponent=observation?.opponent||{};
    const templateOpponentCharacters=arr(templateOpponent.characters).map(Number);
    const templateDistance=n(observation?.distance);
    const templateOpponentDeck=Math.max(0,n(templateOpponent.deckCount));
    const templateOpponentDiscard=arr(templateOpponent.discard).length;
    const templateChoiceKind=String(observation?.pendingMainChoiceKind||"");
    const templateKinnariGood=templateOpponentDeck>0 &&
      [2,4,6].includes(templateDistance) &&
      n(templateOpponent.life)>1 &&
      !templateOpponentCharacters.includes(5);
    const templateChoice=value=>legal.find(action=>
      action?.rule===TURN_MAIN_EFFECT_CHOICE &&
      String(action?.choice||"")===String(value)
    );
    const templatePreferredExtra=(kind,actions=legal)=>{
      const matches=actions.filter(action=>String(action?.thallyaBasic||"")===String(kind));
      return matches.find(action=>String(action?.cost?.type||"")==="focus") || matches[0] || null;
    };

    const cardChoiceKind=String(legal.find(action=>action?.rule===TURN_CARD_CHOICE)?.choiceKind||"");
    if(cardChoiceKind==="yurina-mondo-basic"){
      const repeatable=legal.filter(action=>
        action?.rule===TURN_CARD_CHOICE &&
        action?.baselineMondoDefenderCanRepeat===true
      );
      if(repeatable.length){
        if(yurinaAunActive){
          const auraChanging=repeatable.filter(action=>n(action?.baselineMondoDefenderAuraDelta)!==0);
          const yadoshi=auraChanging.find(action=>String(action?.choiceCardId||"")==="4");
          const matoi=auraChanging.find(action=>String(action?.choiceCardId||"")==="3");
          if(yadoshi||matoi) return remember(yadoshi||matoi);
          if(auraChanging.length) return remember(auraChanging[0]);
        }
        return remember(repeatable[Math.floor(this.random()*repeatable.length)]);
      }
    }
    if(cardChoiceKind==="yurina-aun-choice"){
      const useful=legal.filter(action=>
        action?.rule===TURN_CARD_CHOICE &&
        ["matoi","attack"].includes(String(action?.choiceCardId||""))
      );
      if(useful.length){
        const attack=useful.find(action=>String(action?.choiceCardId)==="attack");
        const matoi=useful.find(action=>String(action?.choiceCardId)==="matoi");
        if(attack && (n(observation?.opponent?.aura)<=1 || n(observation?.opponent?.life)<=2)) return remember(attack);
        return remember(matoi||attack||useful[0]);
      }
    }
    if(cardChoiceKind==="yurina-aun-yadoshi"){
      const skip=legal.find(action=>String(action?.choiceCardId)==="skip");
      if(skip) return remember(skip);
    }
    if(cardChoiceKind==="yurina-shinzawatari-basic"){
      const matoi=legal.find(action=>String(action?.choiceCardId)==="3");
      if(matoi) return remember(matoi);
      const done=legal.find(action=>String(action?.choiceCardId)==="done");
      if(done) return remember(done);
    }
    if(cardChoiceKind==="yurina-shinzawatari-ready"){
      const ready=legal.filter(action=>
        action?.rule===TURN_CARD_CHOICE &&
        String(action?.choiceCardId||"")!=="done"
      );
      if(ready.length) return remember(ready[Math.floor(this.random()*ready.length)]);
    }

    const handLimitDiscards=legal.filter(action=>
      action?.rule===TURN_CARD_CHOICE &&
      String(action?.choiceKind||"")==="end-hand-limit-discard"
    );
    if(handLimitDiscards.length){
      const best=Math.max(...handLimitDiscards.map(action=>Number(action?.baselineDiscardScore)||0));
      const candidates=handLimitDiscards.filter(action=>(Number(action?.baselineDiscardScore)||0)===best);
      return remember(candidates[Math.floor(this.random()*candidates.length)]);
    }

    if(templateA1){
      const burnChoice=legal.find(action=>String(action?.choice||"")==="burn");
      const skipChoice=legal.find(action=>String(action?.choice||"")==="skip");
      const recoverChoice=legal.find(action=>String(action?.choice||"")==="recover");

      if(templateCycle===2){
        if(burnChoice && templateBurned<2) return remember(burnChoice);
        if(skipChoice && recoverChoice && templateBurned>=2) return remember(skipChoice);
      }
      if(templateCycle===0 && templateNeoCharge===1){
        if(skipChoice && burnChoice && templateBurned>1) return remember(skipChoice);
        if(recoverChoice && templateBurned>1) return remember(recoverChoice);
      }

      if(templateChoiceKind==="thallya-a1-transform"){
        const naga=templateChoice("NAGA");
        const deva=templateChoice("DEVA");
        const asura=templateChoice("ASURA");
        const kinnari=templateChoice("KINNARI");
        if(naga && n(templateOpponent.flare)>=3) return remember(naga);
        if(!templateForms.length){
          if(kinnari && templateKinnariGood) return remember(kinnari);
          if(deva) return remember(deva);
        }
        if(deva && !templateForms.includes("DEVA")) return remember(deva);
        if(asura && templateForms.includes("DEVA") && [3,5].includes(templateDistance)) return remember(asura);
        if(kinnari && templateKinnariGood) return remember(kinnari);
        if(asura && templateForms.includes("DEVA")) return remember(asura);
        return remember(deva||kinnari||asura||naga||legal[0]);
      }

      if(templateChoiceKind==="thallya-quick-change-remove"){
        const removeDeva=templateChoice("DEVA");
        if(removeDeva && !templateForms.includes("ASURA") && [3,5].includes(templateDistance)) return remember(removeDeva);
        const removeNaga=templateChoice("NAGA");
        if(removeNaga && !templateForms.includes("KINNARI") && templateKinnariGood) return remember(removeNaga);
      }

      if(templateChoiceKind==="thallya-quick-change-add"){
        const addAsura=templateChoice("ASURA");
        if(addAsura && [3,5].includes(templateDistance)) return remember(addAsura);
        const addKinnari=templateChoice("KINNARI");
        if(addKinnari && templateKinnariGood) return remember(addKinnari);
        const addNaga=templateChoice("NAGA");
        if(addNaga && n(templateOpponent.flare)>=3) return remember(addNaga);
        const addDeva=templateChoice("DEVA");
        if(addDeva) return remember(addDeva);
      }

      if(templateChoiceKind==="thallya-quick-change-after"){
        const basicChoice=templateChoice("basic");
        if(basicChoice && templateForms.includes("ASURA") && [3,5].includes(templateDistance)) return remember(basicChoice);
        if(
          basicChoice &&
          templateForms.includes("NAGA") &&
          templateOpponentDeck>0 &&
          (
            n(templateOpponent.life)<=1 ||
            templateOpponentDeck<=1 ||
            (templateForms.includes("DEVA") && templateOpponentDiscard%2===1)
          )
        ) return remember(basicChoice);
        if(recoverChoice && templateBurned>0) return remember(recoverChoice);
        if(basicChoice) return remember(basicChoice);
      }

      const effectSigma=legal.find(action=>
        action?.rule===TURN_MAIN_EFFECT_BASIC &&
        String(action?.thallyaBasic||"")==="sigma-drive"
      );
      if(effectSigma && [3,5].includes(templateDistance)) return remember(effectSigma);
      const effectGamma=legal.find(action=>
        action?.rule===TURN_MAIN_EFFECT_BASIC &&
        String(action?.thallyaBasic||"")==="gamma-ray"
      );
      if(
        effectGamma &&
        templateOpponentDeck>0 &&
        (
          n(templateOpponent.life)<=1 ||
          templateOpponentDeck<=1 ||
          (templateForms.includes("DEVA") && templateOpponentDiscard%2===1)
        )
      ) return remember(effectGamma);

      const normalSigma=templatePreferredExtra("sigma-drive");
      if(
        normalSigma &&
        normalSigma.rule===TURN_THALLYA_EXTRA_BASIC &&
        [3,5].includes(templateDistance) &&
        (n(templateOpponent.aura)<=2 || n(templateOpponent.life)<=2)
      ) return remember(normalSigma);
      const normalGamma=templatePreferredExtra("gamma-ray");
      if(
        normalGamma &&
        normalGamma.rule===TURN_THALLYA_EXTRA_BASIC &&
        templateOpponentDeck>0 &&
        (
          n(templateOpponent.life)<=1 ||
          templateOpponentDeck<=1 ||
          (templateForms.includes("DEVA") && templateOpponentDiscard%2===1)
        )
      ) return remember(normalGamma);

      const filtered=legal.filter(action=>!(
        String(action?.thallyaBasic||"")==="sigma-drive" &&
        ![3,5].includes(templateDistance)
      ) && !(
        String(action?.thallyaBasic||"")==="gamma-ray" &&
        templateOpponentDeck<=0
      ));
      if(filtered.length) legal=filtered;
    }

    const reconstruct=legal.find(x=>x.rule===TURN_RECONSTRUCT);
    const skip=legal.find(x=>x.rule===TURN_SKIP_RECONSTRUCT);
    if(reconstruct||skip){
      const self=observation?.self||{};
      const deckCount=n(self.deckCount);
      const recycle=arr(self.discard).length+arr(self.facedown).length;
      if(reconstruct && deckCount<2 && recycle>0 && n(self.life)>1) return remember(reconstruct);
      return remember(skip||reconstruct);
    }
    const fatigueAura=legal.find(x=>x.rule===TURN_FATIGUE_AURA);
    const fatigueLife=legal.find(x=>x.rule===TURN_FATIGUE_LIFE);
    if(fatigueAura||fatigueLife) return remember(fatigueAura||fatigueLife);
    const auraDamageChoices=legal
      .filter(x=>x.rule===TURN_ATTACK_DAMAGE && String(x.damageChoice)==="aura")
      .sort((a,b)=>n(a.silentWallUse)-n(b.silentWallUse));
    const lifeDamageChoice=legal.find(x=>
      x.rule===TURN_ATTACK_DAMAGE && String(x.damageChoice)==="life"
    );
    if(auraDamageChoices.length && lifeDamageChoice){
      const selfLife=n(observation?.self?.life);
      const lifeDamage=Number(observation?.pendingAttack?.lifeDamage);
      if(selfLife>0 && Number.isFinite(lifeDamage) && lifeDamage>=selfLife){
        return remember(auraDamageChoices[0]);
      }
    }
    const standardMode=legal.find(x=>x.rule===TURN_MAIN_STANDARD);
    const fullPowerMode=legal.find(x=>x.rule===TURN_MAIN_FULLPOWER);
    if(templateA1 && standardMode && fullPowerMode){
      if((templateCycle===1 && templateNeoReady) || templateCycle===2 || (templateCycle===0 && templateNeoCharge===1)){
        return remember(standardMode);
      }
    }
    if(standardMode && fullPowerMode && observation?.fullPowerMainCardAvailable===false){
      return remember(standardMode);
    }
    const end=legal.find(x=>x.rule===SANDBOX_END_TURN);
    let basics=legal.filter(x=>x.rule!==SANDBOX_END_TURN);
    if(!basics.length) return remember(end||legal[0]);

    basics=basics.filter(action=>!(
      action?.rule===TURN_USE_CARD &&
      Number.isFinite(Number(action?.baselineResourceOnlyApCeiling)) &&
      Number(action.baselineResourceOnlyApCeiling)<=1
    ));
    if(!basics.length) return remember(end||legal[0]);

    // Megalobell is removed from the game on use, and has no effect until
    // every OTHER special has been used. Never spend 2 flare for a 0-effect
    // play just because it is legal; retain the response option until primed.
    const unprimedMegalobell=action=>{
      if(action?.rule!==TURN_USE_CARD || action?.cardId==null) return false;
      const cardId=String(action.cardId);
      const slug=normalizeCardSlug(templateStatus?.[cardId]?.Slug||"");
      if(slug!=="re_08_hagane_o_s_2") return false;
      return !arr(templateSelf.special).filter(id=>String(id)!==cardId)
        .every(id=>Number(templateSpecialStatus?.[String(id)]||0)===2);
    };
    basics=basics.filter(action=>!unprimedMegalobell(action));
    basics=basics.filter(action=>!(
      action?.rule===TURN_USE_CARD &&
      normalizeCardSlug(templateStatus?.[String(action.cardId)]?.Slug||"")==="re_04_tokoyo_o_n_5" &&
      !arr(templateSelf.discard).length && !arr(templateSelf.facedown).length &&
      !arr(templateSelf.characters).some(id=>[10,12].includes(Number(id)))
    ));
    // A fullpower 気炎万丈 at life>3 supplies no current attack bonus.
    // Preserve 3AP of standard actions instead of speculative turn-one setup.
    basics=basics.filter(action=>!(
      action?.rule===TURN_USE_CARD &&
      normalizeCardSlug(templateStatus?.[String(action.cardId)]?.Slug||"")==="re_01_yurina_o_n_7" &&
      n(templateSelf.life)>3
    ));
    if(!basics.length) return remember(end||legal[0]);

    if(observation?.mainMode==="fullpower"){
      return remember(basics[Math.floor(this.random()*basics.length)]);
    }

    if(templateA1 && observation?.mainMode==="standard"){
      if(templateCycle===1 && templateNeoAction) return remember(templateNeoAction);
      if(templateCycle===2 && templateBurned<2){
        if(templateRoaring) return remember(templateRoaring);
        const burns=basics
          .filter(action=>n(action?.baselineThallyaBurn)>0)
          .sort((a,b)=>n(b.baselineThallyaBurn)-n(a.baselineThallyaBurn));
        if(burns.length) return remember(burns[0]);
      }
      if(templateCycle===0 && templateNeoCharge===1){
        if(templateBurned<=1 && templateNeoAction) return remember(templateNeoAction);
        if(templateBurned>1){
          if(templateSteamCannon) return remember(templateSteamCannon);
          if(templateRoaring && n(templateSelf.focus)>=2) return remember(templateRoaring);
          const recoveries=basics
            .filter(action=>
              n(action?.baselineThallyaRecover)>0 &&
              normalizeCardSlug(templateStatus?.[String(action?.cardId)]?.Slug||"")!=="re_11_thallya_a1_n_5"
            )
            .sort((a,b)=>n(a.baselineThallyaRecover)-n(b.baselineThallyaRecover));
          if(recoveries.length) return remember(recoveries[0]);
        }
      }
      if(
        templateQuickChange &&
        templateForms.includes("DEVA") &&
        !templateForms.includes("ASURA") &&
        [3,5].includes(templateDistance)
      ) return remember(templateQuickChange);
      if(
        templateQuickChange &&
        templateForms.includes("NAGA") &&
        !templateForms.includes("KINNARI") &&
        templateKinnariGood
      ) return remember(templateQuickChange);
    }

    // Player feedback regression: poison is a harmful card, not generic AP.
    // Do not play it merely to empty the hand. In particular 滅灯毒
    // removes aura and pollutes the subsequent deck; defer until forced.
    const isPoisonUse=action=>action?.rule===TURN_USE_CARD &&
      /^re_09_chikage_o_p_/.test(normalizeCardSlug(templateStatus?.[String(action.cardId)]?.Slug||""));
    const nonPoisonAlternatives=basics.filter(action=>!isPoisonUse(action));
    if(nonPoisonAlternatives.length) basics=nonPoisonAlternatives;

    const selfCharacters=arr(observation?.self?.characters).map(Number);
    const selfFocus=n(observation?.self?.focus);
    const selfHand=arr(observation?.self?.hand).map(String);
    const selfHandIds=new Set(selfHand);
    const poisonHandIds=new Set(selfHand.filter(cardId=>
      /^re_09_chikage_o_p_/.test(normalizeCardSlug(templateStatus?.[String(cardId)]?.Slug||""))
    ));
    const shouldReduceHandBeforeEnd=selfHand.length>=3 || (poisonHandIds.size>0 && selfHand.length>=2);
    const reserveEarlyHand=turn<=4 && selfHand.length<=2;
    const legalAttackCardIds=new Set(
      basics
        .filter(action=>
          action?.rule===TURN_USE_CARD &&
          action?.cardId!=null &&
          Number(observation?.self?.cardStatus?.[String(action.cardId)]?.MainType)===1
        )
        .map(action=>String(action.cardId))
    );
    if(selfFocus>=2 && !selfCharacters.includes(5)){
      const focusBasicTypes=new Set(
        basics
          .filter(action=>
            action?.rule==="core-standard-basic" &&
            action?.cost?.type==="focus"
          )
          .map(action=>Number(action.basicAction))
      );
      if(focusBasicTypes.size){
        basics=basics.filter(action=>!(
          action?.rule==="core-standard-basic" &&
          action?.cost?.type==="facedown" &&
          focusBasicTypes.has(Number(action.basicAction))
        ));
      }
    }
    if(legalAttackCardIds.size && !selfCharacters.includes(5)){
      basics=basics.filter(action=>!(
        action?.rule==="core-standard-basic" &&
        action?.cost?.type==="facedown" &&
        legalAttackCardIds.has(String(action.cost.cardId))
      ));
    }
    if(!basics.length) return remember(end||legal[0]);

    const mondoAction=basics.find(action=>
      action?.rule===TURN_USE_CARD &&
      action?.cardId!=null &&
      normalizeCardSlug(templateStatus?.[String(action.cardId)]?.Slug||"")==="re_01_yurina_a2_n_3"
    );
    const mondoPartnerAttacks=basics.filter(action=>{
      if(action?.rule!==TURN_USE_CARD || action?.cardId==null) return false;
      if(!legalAttackCardIds.has(String(action.cardId))) return false;
      const slug=normalizeCardSlug(templateStatus?.[String(action.cardId)]?.Slug||"");
      return !!slug && !/^re_01_yurina_/.test(slug);
    });

    if(this.mondoAuraSetupPending && observation?.mainMode==="standard"){
      if(n(templateOpponent.aura)<=2 && mondoAction){
        this.mondoAuraSetupPending=false;
        this.mondoPartnerFollowUpPending=true;
        return remember(mondoAction);
      }
      if(n(templateOpponent.aura)>=3 && mondoPartnerAttacks.length){
        return remember(mondoPartnerAttacks[Math.floor(this.random()*mondoPartnerAttacks.length)]);
      }
      this.mondoAuraSetupPending=false;
      if(mondoAction){
        this.mondoPartnerFollowUpPending=true;
        return remember(mondoAction);
      }
    }

    if(this.mondoPartnerFollowUpPending && observation?.mainMode==="standard"){
      if(mondoPartnerAttacks.length){
        this.mondoPartnerFollowUpPending=false;
        return remember(mondoPartnerAttacks[Math.floor(this.random()*mondoPartnerAttacks.length)]);
      }
      this.mondoPartnerFollowUpPending=false;
    }

    if(!yurinaAunActive && [4,5].includes(templateDistance) && mondoAction && mondoPartnerAttacks.length){
      if(n(templateOpponent.aura)>=3){
        this.mondoAuraSetupPending=true;
        return remember(mondoPartnerAttacks[Math.floor(this.random()*mondoPartnerAttacks.length)]);
      }
      this.mondoPartnerFollowUpPending=true;
      return remember(mondoAction);
    }

    if(!yurinaAunActive && templateDistance<4){
      const mondoSpacing=basics.filter(action=>
        action?.rule==="core-standard-basic" &&
        Number(action?.basicAction)===2 &&
        action?.baselineMondoComboSpacing===true
      );
      if(mondoSpacing.length){
        const focusSpacing=mondoSpacing.find(action=>String(action?.cost?.type||"")==="focus");
        return remember(focusSpacing||mondoSpacing[0]);
      }
    }

    if(
      previous &&
      previous.actor===actor &&
      previous.turn===turn &&
      previous.action?.rule==="core-standard-basic" &&
      Number(previous.action?.basicAction)===2 &&
      previous.action?.baselineMondoComboSpacing===true
    ){
      if(previous.action?.baselineMondoComboReady!==true){
        const continueBackward=basics.find(action=>
          action?.rule==="core-standard-basic" &&
          Number(action?.basicAction)===2 &&
          action?.baselineMondoComboSpacing===true &&
          Number(action?.baselineMondoComboTarget)===Number(previous.action?.baselineMondoComboTarget) &&
          String(action?.cost?.type||"")==="focus"
        ) || basics.find(action=>
          action?.rule==="core-standard-basic" &&
          Number(action?.basicAction)===2 &&
          action?.baselineMondoComboSpacing===true &&
          Number(action?.baselineMondoComboTarget)===Number(previous.action?.baselineMondoComboTarget)
        );
        if(continueBackward) return remember(continueBackward);
      }
      if(mondoAction){
        if(n(templateOpponent.aura)>=3 && mondoPartnerAttacks.length){
          this.mondoAuraSetupPending=true;
          return remember(mondoPartnerAttacks[Math.floor(this.random()*mondoPartnerAttacks.length)]);
        }
        this.mondoPartnerFollowUpPending=true;
        return remember(mondoAction);
      }
    }

    if(
      previous &&
      previous.actor===actor &&
      previous.turn===turn &&
      previous.action?.rule==="core-standard-basic" &&
      Number(previous.action?.basicAction)===2 &&
      previous.action?.baselineEnablesAttack===true &&
      legalAttackCardIds.size
    ){
      const followUpAttacks=basics.filter(action=>
        action?.rule===TURN_USE_CARD &&
        action?.cardId!=null &&
        legalAttackCardIds.has(String(action.cardId))
      );
      if(followUpAttacks.length){
        return remember(followUpAttacks[Math.floor(this.random()*followUpAttacks.length)]);
      }
    }

    const focusMatoi=selfFocus>=2
      ? basics.find(action=>
          action?.rule==="core-standard-basic" &&
          Number(action?.basicAction)===3 &&
          action?.cost?.type==="focus"
        )
      : null;
    const handReductionBasics=basics
      .filter(action=>
        action?.rule==="core-standard-basic" &&
        action?.cost?.type==="facedown" &&
        action?.cost?.cardId!=null &&
        selfHandIds.has(String(action.cost.cardId)) &&
        !poisonHandIds.has(String(action.cost.cardId))
      )
      .sort((a,b)=>{
        const priority=action=>{
          const type=Number(action?.basicAction);
          if(type===3) return 0; // 纏い
          if(type===4) return 1; // 宿し
          if(type===1) return 2; // 前進
          if(type===5) return 3; // 離脱
          if(type===2 && action?.baselineEnablesAttack===true) return 4;
          return 5; // 通常の後退は最後
        };
        return priority(a)-priority(b);
      });
    // Never bury an immediately playable attack merely to reduce hand size.
    // Response and damage selection remain in the normal rule resolution.
    const playableAttacks=basics.filter(action=>{
      if(action?.rule!==TURN_USE_CARD || action?.cardId==null ||
         !legalAttackCardIds.has(String(action.cardId))) return false;
      const card=templateStatus?.[String(action.cardId)]||{};
      // The user heuristic applies to normal, non-fullpower attacks only.
      if(!selfHandIds.has(String(action.cardId)) ||
         card.IsSpecial===true || Number(card.SubType)===2) return false;
      // An attack needing an explicit movement payment is not a free attack.
      if(action?.cost?.type==="movement" || n(action?.baselineRequiredMovement)>0) return false;
      return true;
    });
    if(playableAttacks.length && observation?.mainMode==="standard"){
      const ordered=playableAttacks.slice().sort((a,b)=>{
        const ax=baselineNormalAttackScore(a,templateStatus?.[String(a.cardId)],templateOpponent);
        const bx=baselineNormalAttackScore(b,templateStatus?.[String(b.cardId)],templateOpponent);
        return bx-ax;
      });
      return remember(ordered[0]);
    }
    if(shouldReduceHandBeforeEnd && end && handReductionBasics.length){
      return remember(handReductionBasics[0]);
    }
    if(end && !legalAttackCardIds.size && focusMatoi) return remember(focusMatoi);
    if(end && !legalAttackCardIds.size && !shouldReduceHandBeforeEnd && this.random()<this.endTurnRate) return remember(end);

    const spendsReservedEarlyHand=action=>{
      if(!reserveEarlyHand) return false;
      if(
        action?.rule===TURN_USE_CARD &&
        action?.cardId!=null &&
        selfHandIds.has(String(action.cardId))
      ) return true;
      return (
        action?.rule==="core-standard-basic" &&
        action?.cost?.type==="facedown" &&
        action?.cost?.cardId!=null &&
        selfHandIds.has(String(action.cost.cardId))
      );
    };
    const hasNonSpendingAlternative=basics.some(action=>!spendsReservedEarlyHand(action));
    if(
      reserveEarlyHand &&
      end &&
      !legalAttackCardIds.size &&
      !hasNonSpendingAlternative
    ) return remember(end);

    const ordinaryBackward=action=>(
      action?.rule==="core-standard-basic" &&
      Number(action?.basicAction)===2 &&
      action?.baselineEnablesAttack!==true
    );
    const hasNonBackwardAlternative=basics.some(action=>!ordinaryBackward(action));
    const weights=basics.map(action=>{
      if(ordinaryBackward(action) && hasNonBackwardAlternative) return 0;
      if(spendsReservedEarlyHand(action)){
        if(hasNonSpendingAlternative){
          return action?.rule===TURN_USE_CARD &&
            action?.cardId!=null &&
            legalAttackCardIds.has(String(action.cardId))
              ? 0.5
              : 0;
        }
        return 0.5;
      }
      return 1;
    });
    const total=weights.reduce((sum,value)=>sum+value,0);
    let pick=this.random()*total;
    for(let i=0;i<basics.length;i++){
      pick-=weights[i];
      if(pick<0) return remember(basics[i]);
    }
    return remember(basics[basics.length-1]);
  }
}

function replayPriorNumberBucket(value,cuts,labels){
  const valueNumber=Number(value);
  if(!Number.isFinite(valueNumber)) return "unknown";
  for(let i=0;i<cuts.length;i++){
    if(valueNumber<=cuts[i]) return labels[i];
  }
  return labels[labels.length-1];
}
function replayPriorLifeBucket(value){
  return replayPriorNumberBucket(value,[3,6],["critical","mid","high"]);
}
function replayPriorAuraBucket(value){
  return replayPriorNumberBucket(value,[0,2],["empty","low","high"]);
}
function replayPriorCountBucket(value){
  return replayPriorNumberBucket(value,[0,2],["zero","low","many"]);
}
function replayPriorDistanceBucket(value){
  return replayPriorNumberBucket(value,[2,4,6],["close","mid","far","very-far"]);
}
function replayPriorCharacters(value){
  return arr(value).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
}
function replayPriorActionSignature(observation,action){
  const row=action||{};
  if(Number.isFinite(Number(row.basicAction))) return `basic:${Number(row.basicAction)}`;
  if(Number.isFinite(Number(row.damageChoice))) return `damage:${Number(row.damageChoice)}`;
  if(row.cardId!=null){
    const cardId=String(row.cardId);
    const slug=String(observation?.self?.cardStatus?.[cardId]?.Slug||"").trim();
    if(slug) return `card:${slug}`;
  }
  const kind=String(row.kind||"unknown").trim()||"unknown";
  const label=String(row.label||"").trim();
  return label ? `kind:${kind}|label:${label}` : `kind:${kind}`;
}
function replayPriorCanonicalPhase(value){
  const raw=String(value||"").trim();
  const lower=raw.toLowerCase();
  if(["初期","準備","setup","initial"].includes(lower)) return "setup";
  if(raw==="開始" || lower==="start" || lower.startsWith("start-")) return "start";
  if(raw==="終了" || lower==="end" || lower==="end-effects" || lower==="yukihi-end-toggle-choice") return "end";
  if(
    raw==="メイン" ||
    lower==="main" ||
    lower.startsWith("main-") ||
    lower.startsWith("attack-") ||
    lower.startsWith("response-") ||
    lower.startsWith("kururu-") ||
    lower==="effect-fatigue"
  ) return "main";
  return lower||"unknown";
}
function replayPriorDecisionClassFromLegal(observation,legalActions){
  const phase=String(observation?.phase||"");
  const legal=arr(legalActions);
  const rules=new Set(legal.map(action=>String(action?.rule||"")));
  if(
    phase==="start-reconstruct" ||
    rules.has(TURN_RECONSTRUCT) ||
    rules.has(TURN_SKIP_RECONSTRUCT)
  ) return "reconstruct";
  if(
    phase==="start-fatigue" ||
    phase==="effect-fatigue" ||
    rules.has(TURN_FATIGUE_AURA) ||
    rules.has(TURN_FATIGUE_LIFE)
  ) return "fatigue";
  if(
    phase==="attack-damage-choice" ||
    rules.has(TURN_ATTACK_DAMAGE)
  ) return "attack-damage";
  if(
    ["attack-response","response-card-choice","attack-post-response-choice"].includes(phase) ||
    rules.has(TURN_ATTACK_PASS) ||
    rules.has(TURN_ATTACK_RESPOND) ||
    rules.has(TURN_RESPONSE_EFFECT_CHOICE)
  ) return "attack-response";
  if(
    [
      "start-card-choice",
      "reconstruction-install-choice",
      "shinra-plan-choice",
      "main-effect-choice",
      "main-enhancement-choice",
      "main-enhancement-effect-choice",
      "kururu-drain-reuse",
      "kururu-trigger-basic",
      "attack-post-response-choice",
      "yukihi-end-toggle-choice"
    ].includes(phase) ||
    rules.has(TURN_CARD_CHOICE) ||
    rules.has(TURN_MAIN_ENHANCEMENT_CHOICE) ||
    rules.has(TURN_MAIN_EFFECT_CHOICE) ||
    rules.has(TURN_MAIN_ENHANCEMENT_EFFECT_CHOICE) ||
    rules.has(TURN_SHINRA_PLAN_CHOICE) ||
    rules.has(TURN_KURURU_DRAIN_REUSE)
  ) return "effect-choice";
  if(replayPriorCanonicalPhase(phase)==="end") return "end";
  return "main";
}
function replayPriorContextFeatures(observation,legalActions=[]){
  const self=observation?.self||{},opponent=observation?.opponent||{};
  return {
    selfCharacters:replayPriorCharacters(self.characters),
    opponentCharacters:replayPriorCharacters(opponent.characters),
    phase:replayPriorCanonicalPhase(observation?.phase),
    decision:replayPriorDecisionClassFromLegal(observation,legalActions),
    distance:replayPriorDistanceBucket(observation?.distance),
    selfLife:replayPriorLifeBucket(self.life),
    selfAura:replayPriorAuraBucket(self.aura),
    selfHand:replayPriorCountBucket(arr(self.hand).length),
    selfDeck:replayPriorCountBucket(self.deckCount),
    opponentLife:replayPriorLifeBucket(opponent.life),
    opponentAura:replayPriorAuraBucket(opponent.aura),
    pendingAttack:!!observation?.pendingAttack
  };
}
function replayPriorExactKey(features){
  return [
    `self=${arr(features.selfCharacters).join(",")}`,
    `opp=${arr(features.opponentCharacters).join(",")}`,
    `phase=${features.phase}`,
    `decision=${features.decision}`,
    `dist=${features.distance}`,
    `selfLife=${features.selfLife}`,
    `selfAura=${features.selfAura}`,
    `selfHand=${features.selfHand}`,
    `selfDeck=${features.selfDeck}`,
    `oppLife=${features.opponentLife}`,
    `oppAura=${features.opponentAura}`,
    `attack=${features.pendingAttack?1:0}`
  ].join("|");
}
function replayPriorCharacterPhaseKey(features){
  return [
    `self=${arr(features.selfCharacters).join(",")}`,
    `opp=${arr(features.opponentCharacters).join(",")}`,
    `phase=${features.phase}`,
    `decision=${features.decision}`
  ].join("|");
}
function replayPriorCharacterKey(features){
  return [
    `self=${arr(features.selfCharacters).join(",")}`,
    `opp=${arr(features.opponentCharacters).join(",")}`
  ].join("|");
}
function replayPriorFindRow(rows,key){
  return arr(rows).find(row=>String(row?.key||"")===String(key||""))||null;
}
function replayPriorActionFrequency(row,signature){
  const action=arr(row?.actions).find(item=>String(item?.action||"")===String(signature||""));
  return {
    count:Math.max(0,n(action?.count)),
    total:Math.max(0,n(row?.total)),
    frequency:Math.max(0,Number(action?.frequency)||0)
  };
}
export function replayPriorEvaluatorDefaults(options={}){
  return {
    minReplayCount:Math.max(1,Number(options.minReplayCount)||3),
    minMatchupSamples:Math.max(1,Number(options.minMatchupSamples)||30),
    minContextSamples:Math.max(1,Number(options.minContextSamples)||8),
    minContextReplayCount:Math.max(1,Number(options.minContextReplayCount)||2),
    minActionCount:Math.max(1,Number(options.minActionCount)||2),
    minFrequencyGap:Math.max(0,Math.min(1,Number(options.minFrequencyGap)||0.15)),
    allowCharacterPhase:options.allowCharacterPhase!==false
  };
}

export function evaluateReplayPriorLegalActions(context,prior,options={}){
  const legal=arr(context?.legalActions);
  const observation=context?.observation||{};
  const settings=replayPriorEvaluatorDefaults(options);
  const base={
    usable:false,
    reason:"",
    level:"none",
    settings,
    coverage:{replayCount:0,matchupSamples:0,outcomes:{win:0,loss:0,draw:0,unknown:0}},
    contextTotal:0,
    ranked:[]
  };
  if(!prior || prior.kind!=="furuyoni-recorded-replay-behavior-prior"){
    return {...base,reason:"missing-or-invalid-prior"};
  }
  if(legal.length<2) return {...base,reason:"fewer-than-two-legal-actions"};

  const features=replayPriorContextFeatures(observation,legal);
  if(features.selfCharacters.length<2 || features.opponentCharacters.length<2){
    return {...base,reason:"missing-character-context"};
  }

  const matchupKey=replayPriorCharacterKey(features);
  const matchup=replayPriorFindRow(prior.characterMatchups,matchupKey);
  const coverage={
    replayCount:Math.max(0,n(matchup?.replayCount)),
    matchupSamples:Math.max(0,n(matchup?.total)),
    outcomes:clone(matchup?.outcomes||{win:0,loss:0,draw:0,unknown:0})
  };
  if(!matchup){
    return {...base,reason:"unseen-matchup",coverage};
  }
  if(coverage.replayCount<settings.minReplayCount){
    return {...base,reason:"insufficient-replay-count",coverage};
  }
  if(coverage.matchupSamples<settings.minMatchupSamples){
    return {...base,reason:"insufficient-matchup-samples",coverage};
  }

  const levels=[
    ["exact",prior.exactContexts,replayPriorExactKey(features)]
  ];
  if(settings.allowCharacterPhase){
    levels.push(["character-phase",prior.characterPhases,replayPriorCharacterPhaseKey(features)]);
  }

  let level="none",row=null;
  let sawSampleQualifiedContext=false;
  let sawReplaySparseContext=false;
  for(const candidate of levels){
    const found=replayPriorFindRow(candidate[1],candidate[2]);
    if(!found || n(found.total)<settings.minContextSamples) continue;
    sawSampleQualifiedContext=true;
    if(n(found.replayCount)<settings.minContextReplayCount){
      sawReplaySparseContext=true;
      continue;
    }
    level=candidate[0];
    row=found;
    break;
  }
  if(!row){
    return {
      ...base,
      reason:sawSampleQualifiedContext && sawReplaySparseContext
        ? "insufficient-context-replay-count"
        : "insufficient-context-samples",
      coverage
    };
  }

  const grouped=new Map();
  legal.forEach((action,index)=>{
    const signature=replayPriorActionSignature(observation,action);
    if(!grouped.has(signature)) grouped.set(signature,[]);
    grouped.get(signature).push({index,action:clone(action)});
  });

  const ranked=[...grouped.entries()].map(([signature,entries])=>{
    const observed=replayPriorActionFrequency(row,signature);
    return {
      signature,
      legalActionCount:entries.length,
      action:entries.length===1?clone(entries[0].action):null,
      observed
    };
  }).sort((a,b)=>
    b.observed.frequency-a.observed.frequency ||
    b.observed.count-a.observed.count ||
    a.signature.localeCompare(b.signature)
  );

  const top=ranked[0],second=ranked[1];
  if(!top || top.observed.count<settings.minActionCount){
    return {...base,reason:"insufficient-top-action-count",level,coverage,contextTotal:n(row.total),contextReplayCount:n(row.replayCount),ranked};
  }
  if(top.legalActionCount!==1){
    return {...base,reason:"ambiguous-top-action",level,coverage,contextTotal:n(row.total),contextReplayCount:n(row.replayCount),ranked};
  }
  const secondFrequency=second?.observed?.frequency||0;
  const gap=top.observed.frequency-secondFrequency;
  if(gap<settings.minFrequencyGap){
    return {...base,reason:"frequency-gap-too-small",level,coverage,contextTotal:n(row.total),contextReplayCount:n(row.replayCount),ranked};
  }

  return {
    usable:true,
    reason:"replay-prior-preference",
    level,
    settings,
    coverage,
    contextTotal:n(row.total),
    contextReplayCount:n(row.replayCount),
    frequencyGap:gap,
    top:clone(top),
    ranked
  };
}

export class ReplayPriorGuidedAgent{
  constructor(prior,options={},fallbackAgent=null){
    this.prior=prior||null;
    this.options=clone(options||{});
    this.fallbackAgent=fallbackAgent||new BaselineCoreTurnAgent(
      options?.fallbackSeed??1,
      options?.fallbackEndTurnRate??0.25
    );
    this.lastEvaluation=null;
    this.replayPriorSelections=0;
    this.fallbackSelections=0;
  }
  chooseAction(context){
    const evaluation=evaluateReplayPriorLegalActions(context,this.prior,this.options);
    this.lastEvaluation=clone(evaluation);
    if(evaluation.usable && evaluation.top?.action){
      this.replayPriorSelections++;
      return clone(evaluation.top.action);
    }
    this.fallbackSelections++;
    return this.fallbackAgent.chooseAction(context);
  }
}

function replayPriorActionsAgree(observation,a,b){
  if(!a||!b) return false;
  const signatureA=replayPriorActionSignature(observation,a);
  const signatureB=replayPriorActionSignature(observation,b);
  if(signatureA!==signatureB) return false;
  const stableFields=["rule","kind","basicAction","damageChoice","cardId","choice","choiceCardId"];
  for(const key of stableFields){
    if(a[key]===undefined && b[key]===undefined) continue;
    if(String(a[key]??"")!==String(b[key]??"")) return false;
  }
  return true;
}

export class ReplayPriorShadowAgent{
  constructor(prior,options={},fallbackAgent=null){
    this.prior=prior||null;
    this.options=clone(options||{});
    this.fallbackAgent=fallbackAgent||new BaselineCoreTurnAgent(
      options?.fallbackSeed??1,
      options?.fallbackEndTurnRate??0.25
    );
    this.lastEvaluation=null;
    this.shadowEvaluations=0;
    this.shadowEligible=0;
    this.shadowAgreements=0;
    this.shadowDisagreements=0;
    this.fallbackSelections=0;
    this.reasonCounts={};
    this.disagreementExamples=[];
  }
  chooseAction(context){
    const evaluation=evaluateReplayPriorLegalActions(context,this.prior,this.options);
    this.lastEvaluation=clone(evaluation);
    this.shadowEvaluations++;
    const reason=String(evaluation?.reason||"unknown");
    this.reasonCounts[reason]=(this.reasonCounts[reason]||0)+1;

    const selected=this.fallbackAgent.chooseAction(context);
    this.fallbackSelections++;

    if(evaluation.usable && evaluation.top?.action){
      this.shadowEligible++;
      if(replayPriorActionsAgree(context?.observation,evaluation.top.action,selected)){
        this.shadowAgreements++;
      }else{
        this.shadowDisagreements++;
        if(this.disagreementExamples.length<20){
          this.disagreementExamples.push({
            playerId:Number(context?.playerId)||null,
            actionIndex:Number(context?.actionIndex)||0,
            phase:String(context?.observation?.phase||""),
            recommended:clone(evaluation.top.action),
            selected:clone(selected),
            evaluation:clone(evaluation)
          });
        }
      }
    }

    return clone(selected);
  }
}

function defaultCoreTurnAgent(options,playerId){
  const pid=Number(playerId)===2?2:1;
  const seed=pid===1 ? (options.seed1??101) : (options.seed2??202);
  if(options.replayPrior){
    const replayOptions={
      ...(options.replayPriorOptions||{}),
      fallbackSeed:seed,
      fallbackEndTurnRate:options.endTurnRate
    };
    const mode=String(options.replayPriorMode||"shadow").toLowerCase();
    if(mode==="guided"){
      return new ReplayPriorGuidedAgent(options.replayPrior,replayOptions);
    }
    if(mode==="shadow"){
      return new ReplayPriorShadowAgent(options.replayPrior,replayOptions);
    }
  }
  return new BaselineCoreTurnAgent(seed,options.endTurnRate);
}

function coreTurnAgentDiagnostics(agent){
  if(agent instanceof ReplayPriorGuidedAgent){
    return {
      kind:"replay-prior-guided",
      replayPriorSelections:agent.replayPriorSelections,
      fallbackSelections:agent.fallbackSelections,
      lastEvaluation:clone(agent.lastEvaluation)
    };
  }
  if(agent instanceof ReplayPriorShadowAgent){
    return {
      kind:"replay-prior-shadow",
      replayPriorSelections:0,
      fallbackSelections:agent.fallbackSelections,
      shadowEvaluations:agent.shadowEvaluations,
      shadowEligible:agent.shadowEligible,
      shadowAgreements:agent.shadowAgreements,
      shadowDisagreements:agent.shadowDisagreements,
      agreementRate:agent.shadowEligible>0
        ? agent.shadowAgreements/agent.shadowEligible
        : null,
      reasonCounts:clone(agent.reasonCounts),
      disagreementExamples:clone(agent.disagreementExamples),
      lastEvaluation:clone(agent.lastEvaluation)
    };
  }
  return {
    kind:agent?.constructor?.name||"agent",
    replayPriorSelections:0,
    fallbackSelections:null,
    lastEvaluation:null
  };
}

export function runCoreTurnSandbox(initialState,options={}){
  const environment=new CoreTurnSandboxEnvironment(initialState,options);
  const agents={
    1:options.agent1||defaultCoreTurnAgent(options,1),
    2:options.agent2||defaultCoreTurnAgent(options,2)
  };
  const maxActions=Math.max(1,Number(options.maxActions)||300);
  environment.reset();
  while(!environment.done){
    if(environment.history.length>=maxActions){
      environment.done=true;
      environment.doneReason="action-limit";
      break;
    }
    const actor=environment.currentPlayer();
    const legalActions=environment.legalActions(actor);
    if(!legalActions.length){
      environment.done=true;
      environment.doneReason="no-legal-action";
      break;
    }
    const selected=agents[actor].chooseAction({
      playerId:actor,
      observation:environment.observe(actor),
      legalActions:clone(legalActions),
      actionIndex:environment.history.length
    });
    environment.step(selected);
  }
  const failed=String(environment.doneReason||"").startsWith("unsupported")
    || ["action-limit","no-legal-action"].includes(environment.doneReason);
  return {
    ok:!failed,
    actions:environment.history.length,
    completedTurns:environment.completedTurns,
    doneReason:environment.doneReason,
    winner:environment.winner,
    invariantErrors:[...assertSandboxState(environment.state),...cardZoneInvariantErrors(environment.state)],
    openingState:clone(environment.openingState),
    openingSetup:clone(environment.openingSetup),
    finalState:clone(environment.state),
    history:clone(environment.history),
    agentDiagnostics:{
      1:coreTurnAgentDiagnostics(agents[1]),
      2:coreTurnAgentDiagnostics(agents[2])
    }
  };
}

function coreTurnSandboxStateSupported(state){
  const registry=createDefaultCardRuleRegistry();
  for(const pid of [1,2]){
    for(const cardId of arr(state?.[`p${pid}_enhancement`])){
      const slug=stateCardSlug(state,pid,cardId);
      const rule=registry.get(slug);
      if(!rule || rule?.mainUse?.kind!=="enhancement-card") return false;
    }
  }
  return true;
}
function findCoreTurnSandboxStart(model){
  const steps=Array.isArray(model?.steps)?model.steps:[];
  const candidates=[];
  for(let i=0;i<steps.length;i++){
    const step=steps[i],state=step?.state||{};
    const pid=Number(step?.turnPlayer ?? state?.turn_player);
    if((pid===1||pid===2) && String(step?.phase||"")==="メイン" && n(step?.rawTurn)>=3 && coreTurnSandboxStateSupported(state)){
      candidates.push({index:i,playerId:pid,state:clone(state)});
    }
  }
  return candidates[0]||null;
}

export function probeCoreTurnSandboxFromReplay(model,options={}){
  const start=findCoreTurnSandboxStart(model);
  if(!start) return {ok:false,startStep:null,doneReason:"no-compatible-main-phase",invariantErrors:[]};
  try{
    const run=runCoreTurnSandbox(start.state,{
      ...options,
      startingPlayer:start.playerId,
      turnsTaken:{1:1,2:1},
      maxTurns:options.maxTurns??8,
      maxActions:options.maxActions??180,
      chanceSeed:options.chanceSeed??97531,
      seed1:options.seed1??13579,
      seed2:options.seed2??24680
    });
    return {
      ok:run.ok&&run.invariantErrors.length===0,
      startStep:start.index,
      startingPlayer:start.playerId,
      actions:run.actions,
      completedTurns:run.completedTurns,
      doneReason:run.doneReason,
      winner:run.winner,
      invariantErrors:run.invariantErrors
    };
  }catch(error){
    return {
      ok:false,
      startStep:start.index,
      startingPlayer:start.playerId,
      actions:0,
      completedTurns:0,
      doneReason:"error",
      winner:null,
      invariantErrors:[String(error?.message||error)]
    };
  }
}

export function runBasicActionSandbox(initialState,options={}){
  const environment=new BasicActionSandboxEnvironment(initialState,options);
  const agents={
    1:options.agent1||new RandomBasicActionAgent(options.seed1??1,options.endTurnRate),
    2:options.agent2||new RandomBasicActionAgent(options.seed2??2,options.endTurnRate)
  };
  const maxActions=Math.max(1,Number(options.maxActions)||200);
  environment.reset();
  while(!environment.done){
    if(environment.history.length>=maxActions){
      environment.done=true;
      environment.doneReason="action-limit";
      break;
    }
    const actor=environment.currentPlayer();
    const legalActions=environment.legalActions(actor);
    const agent=agents[actor];
    const selected=agent.chooseAction({
      playerId:actor,
      observation:environment.observe(actor),
      legalActions:clone(legalActions),
      actionIndex:environment.history.length
    });
    environment.step(selected);
  }
  const basics=environment.history.filter(x=>x.action?.rule!=="sandbox-end-turn");
  return {
    ok:true,
    actions:environment.history.length,
    basicActions:basics.length,
    completedTurns:environment.completedTurns,
    doneReason:environment.doneReason,
    invariantErrors:assertSandboxState(environment.state),
    finalState:clone(environment.state),
    history:clone(environment.history)
  };
}

function findSandboxStartStep(model){
  const steps=Array.isArray(model?.steps)?model.steps:[];
  const candidates=[];
  for(let i=0;i<steps.length;i++){
    const step=steps[i];
    const pid=Number(step?.turnPlayer ?? step?.state?.turn_player);
    if((pid===1||pid===2) && String(step?.phase||"")==="メイン"){
      const state=step?.state||{};
      const hasCost=n(state?.[`p${pid}_focus`])>0 || arr(state?.[`p${pid}_hand`]).length>0;
      if(hasCost) candidates.push({index:i,playerId:pid,rawTurn:n(step?.rawTurn),state:clone(state)});
    }
  }
  return candidates.find(x=>x.rawTurn>=3) || candidates[0] || null;
}

export function probeBasicActionSandboxFromReplay(model,options={}){
  const start=findSandboxStartStep(model);
  if(!start) return {ok:false,startStep:null,error:"メインフェイズの開始局面を取得できませんでした"};
  try{
    const run=runBasicActionSandbox(start.state,{
      ...options,
      startingPlayer:start.playerId,
      maxTurns:options.maxTurns??8,
      maxActions:options.maxActions??120,
      seed1:options.seed1??12345,
      seed2:options.seed2??67890
    });
    return {
      ok:run.ok && run.invariantErrors.length===0,
      startStep:start.index,
      startingPlayer:start.playerId,
      actions:run.actions,
      basicActions:run.basicActions,
      completedTurns:run.completedTurns,
      doneReason:run.doneReason,
      invariantErrors:run.invariantErrors
    };
  }catch(error){
    return {
      ok:false,
      startStep:start.index,
      startingPlayer:start.playerId,
      actions:0,
      basicActions:0,
      completedTurns:0,
      doneReason:"error",
      invariantErrors:[String(error?.message||error)]
    };
  }
}

function replayBasicCost(step){
  const cost=step?.basicCost;
  if(cost?.type==="focus") return {type:"focus"};
  if(cost?.type==="facedown") return {type:"facedown",cardId:cost.cardId};
  return null;
}
function basicTransitionMismatches(expected,actual,playerId){
  const pid=Number(playerId),keys=["distance","dust",`p${pid}_aura`,`p${pid}_flare`,`p${pid}_freeze`,`p${pid}_focus`];
  const mismatches=[];
  for(const key of keys) if(n(expected?.[key])!==n(actual?.[key])) mismatches.push(key);
  const expectedHand=arr(expected?.[`p${pid}_hand`]).map(String).sort();
  const actualHand=arr(actual?.[`p${pid}_hand`]).map(String).sort();
  const expectedFacedown=arr(expected?.[`p${pid}_facedown`]).map(String).sort();
  const actualFacedown=arr(actual?.[`p${pid}_facedown`]).map(String).sort();
  if(JSON.stringify(expectedHand)!==JSON.stringify(actualHand)) mismatches.push("hand");
  if(JSON.stringify(expectedFacedown)!==JSON.stringify(actualFacedown)) mismatches.push("facedown");
  return mismatches;
}

export function validateReplayBasicActions(model,options={}){
  const rows=[];
  let legalMatches=0,transitionMatches=0;
  for(let i=1;i<(model?.steps||[]).length;i++){
    const step=model.steps[i];
    if(step?.kind!=="基本動作") continue;
    const previous=model.steps[i-1]||{};
    const actor=replayActorForStep(step,previous);
    const before=clone(step?.beforeState||previous?.state||{});
    const basicAction=basicTypeFromStep(step);
    const cost=replayBasicCost(step);
    const recorded={actor,kind:"基本動作",label:BASIC_ACTION_NAMES[basicAction]||String(step?.title||""),basicAction,cost};
    const legal=cost?generateStandardBasicActions(before,actor,options):[];
    const legalMatch=!!cost && legal.some(x=>basicRuleActionKey(x)===basicRuleActionKey(recorded));
    let mismatches=[];
    if(legalMatch){
      legalMatches++;
      const expected=applyStandardBasicAction(before,actor,recorded,options);
      mismatches=basicTransitionMismatches(expected,step?.state||{},actor);
      if(!mismatches.length) transitionMatches++;
    }
    rows.push({
      step:i,
      actor,
      basicAction,
      actionName:BASIC_ACTION_NAMES[basicAction]||String(step?.title||""),
      cost:clone(cost),
      legalMatch,
      transitionMatch:legalMatch&&mismatches.length===0,
      mismatches
    });
  }
  return {
    total:rows.length,
    legalMatches,
    transitionMatches,
    needsSpecialRule:rows.length-legalMatches,
    transitionOverrides:legalMatches-transitionMatches,
    rows
  };
}

export function renderBasicActionValidation(report,summaryEl,bodyEl){
  const metric=(label,val)=>{
    const d=document.createElement("div"),b=document.createElement("b"),sp=document.createElement("span");
    d.className="metric";b.textContent=String(val);sp.textContent=label;d.append(b,sp);return d;
  };
  summaryEl.replaceChildren(
    metric("基本動作",report?.total??0),
    metric("合法手一致",report?.legalMatches??0),
    metric("遷移一致",report?.transitionMatches??0),
    metric("追加ルール要",report?.needsSpecialRule??0)
  );
  bodyEl.replaceChildren();
  const rows=Array.isArray(report?.rows)?report.rows:[];
  if(!rows.length){
    const tr=document.createElement("tr");
    tr.innerHTML='<td colspan="7" class="empty">基本動作がありません。</td>';
    bodyEl.append(tr);
    return;
  }
  for(const row of rows){
    const cost=row.cost?.type==="focus"?"集中力":row.cost?.type==="facedown"?`伏せ札 ${row.cost.cardId}`:"不明";
    const vals=[
      row.step,
      row.actor===1?"P1":"P2",
      row.actionName||"-",
      cost,
      row.legalMatch?"OK":"要追加ルール",
      row.transitionMatch?"OK":row.legalMatch?"差分あり":"-",
      row.mismatches.join(", ")||"-"
    ];
    const tr=document.createElement("tr");
    vals.forEach((value,index)=>{
      const td=document.createElement("td");td.textContent=String(value);if(index===0)td.className="num";tr.append(td);
    });
    bodyEl.append(tr);
  }
}


function publicCardStatus(state,pid,zoneNames){
  const src=state?.[`p${pid}_card_status`]||{};
  const ids=new Set();
  for(const z of zoneNames) for(const cid of arr(state?.[`p${pid}_${z}`])) ids.add(String(cid));
  const out={};
  for(const id of ids) if(src[id]) out[id]=clone(src[id]);
  return out;
}

function cardSortKey(value){
  const nValue=Number(value);
  return Number.isFinite(nValue) ? `0:${String(nValue).padStart(12,"0")}` : `1:${String(value)}`;
}
function sortedCardPool(values){
  return arr(values).slice().sort((a,b)=>cardSortKey(a).localeCompare(cardSortKey(b)));
}
function countCardCopies(values){
  const counts=new Map();
  for(const cardId of values){
    const key=String(cardId);
    counts.set(key,(counts.get(key)||0)+1);
  }
  return counts;
}
function removeKnownCards(pool,knownTop){
  const remaining=arr(pool);
  for(const cardId of knownTop){
    const index=remaining.findIndex(x=>String(x)===String(cardId));
    if(index>=0) remaining.splice(index,1);
  }
  return remaining;
}
function chooseCount(nValue,kValue){
  const n=Math.max(0,Math.floor(Number(nValue)||0));
  const k=Math.max(0,Math.floor(Number(kValue)||0));
  if(k>n) return 0;
  const kk=Math.min(k,n-k);
  let out=1;
  for(let i=1;i<=kk;i++) out=(out*(n-kk+i))/i;
  return out;
}
function probabilityAtLeastOne(total,copies,draws){
  const n=Math.max(0,Math.floor(Number(total)||0));
  const m=Math.max(0,Math.min(n,Math.floor(Number(copies)||0)));
  const d=Math.max(0,Math.min(n,Math.floor(Number(draws)||0)));
  if(m===0||d===0) return 0;
  if(d>=n) return 1;
  return 1-(chooseCount(n-m,d)/chooseCount(n,d));
}

export function buildOwnDeckKnowledge(state,playerId,drawWindows=[1,2]){
  const pid=Number(playerId);
  if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
  const deck=arr(state?.[`p${pid}_deck`]);
  const explicitKnownTop=arr(state?.[`p${pid}_known_deck_top`]).slice(0,deck.length);
  const knownTop=[];
  const remainingCheck=arr(deck);
  for(const cardId of explicitKnownTop){
    const index=remainingCheck.findIndex(x=>String(x)===String(cardId));
    if(index<0) break;
    knownTop.push(cardId);
    remainingCheck.splice(index,1);
  }
  const pool=sortedCardPool(deck);
  const randomPool=removeKnownCards(pool,knownTop);
  const totalCounts=countCardCopies(pool);
  const randomCounts=countCardCopies(randomPool);
  const windows=[...new Set(arr(drawWindows).map(x=>Math.max(0,Math.floor(Number(x)||0))).filter(x=>x>0))].sort((a,b)=>a-b);
  const drawOdds=windows.map(draws=>{
    const d=Math.min(draws,pool.length);
    const knownDraws=knownTop.slice(0,d);
    const randomDrawCount=Math.max(0,d-knownDraws.length);
    const knownCounts=countCardCopies(knownDraws);
    const cards=[...totalCounts.entries()].map(([cardId,copies])=>{
      const knownHit=(knownCounts.get(cardId)||0)>0;
      const randomCopies=randomCounts.get(cardId)||0;
      const probability=knownHit ? 1 : probabilityAtLeastOne(randomPool.length,randomCopies,randomDrawCount);
      return {
        cardId,
        copies,
        probability:Number(probability.toFixed(8))
      };
    }).sort((a,b)=>cardSortKey(a.cardId).localeCompare(cardSortKey(b.cardId)));
    return {draws:d,cards};
  });
  return {
    count:pool.length,
    pool,
    knownTop:clone(knownTop),
    unknownCount:randomPool.length,
    drawOdds
  };
}

export function sampleDeckOrderFromKnowledge(knowledge,seedOrRandom=1){
  const random=typeof seedOrRandom==="function" ? seedOrRandom : seededUnit(seedOrRandom);
  const pool=arr(knowledge?.pool);
  const knownTop=arr(knowledge?.knownTop);
  const randomPool=removeKnownCards(pool,knownTop);
  return [...knownTop,...shuffleWith(random,randomPool)];
}


const OPPONENT_HIDDEN_LOCATIONS=["hand","deck","facedown","outside"];

function clampProbability(value){
  const x=Number(value);
  return Number.isFinite(x)?Math.max(0,Math.min(1,x)):0;
}
function opponentNormalCardPool(state,opponentId){
  const pid=Number(opponentId);
  return sortedCardPool(["hand","deck","facedown","discard","enhancement","using","outside"]
    .flatMap(zone=>arr(state?.[`p${pid}_${zone}`])));
}
function publicOpponentCardZones(state,opponentId){
  const pid=Number(opponentId),out=new Map();
  for(const zone of PUBLIC_OPPONENT_ZONES){
    for(const cardId of arr(state?.[`p${pid}_${zone}`])) out.set(String(cardId),zone);
  }
  return out;
}
function hiddenOpponentCounts(state,opponentId){
  const pid=Number(opponentId);
  const out={};
  for(const zone of OPPONENT_HIDDEN_LOCATIONS) out[zone]=arr(state?.[`p${pid}_${zone}`]).length;
  return out;
}
function normalizeLocationProbabilities(values){
  const out={};
  let total=0;
  for(const zone of OPPONENT_HIDDEN_LOCATIONS){
    const v=Math.max(0,Number(values?.[zone])||0);
    out[zone]=v;
    total+=v;
  }
  if(total<=0) return Object.fromEntries(OPPONENT_HIDDEN_LOCATIONS.map(zone=>[zone,0]));
  for(const zone of OPPONENT_HIDDEN_LOCATIONS) out[zone]/=total;
  return out;
}

export class OpponentBeliefTracker{
  constructor(cardPool=[],options={}){
    this.mode=String(options.mode||"prior");
    this.cardPool=sortedCardPool(cardPool);
    this.cardSet=new Set(this.cardPool.map(String));
    this.weights=new Map();
    this.posteriors=new Map();
    this.evidence=[];
  }
  _ensure(cardId){
    const key=String(cardId);
    if(!this.cardSet.has(key)){
      this.cardPool=sortedCardPool([...this.cardPool,cardId]);
      this.cardSet.add(key);
    }
    if(!this.weights.has(key)){
      this.weights.set(key,{hand:1,deck:1,facedown:1,outside:1});
    }
    return key;
  }
  applyBehaviorEvidence(cardId,evidence={}){
    const key=this._ensure(cardId),weights=this.weights.get(key);
    const likelihoods={
      hand:Math.max(0.0001,Number(evidence.handLikelihood)||1),
      deck:Math.max(0.0001,Number(evidence.deckLikelihood)||1),
      facedown:Math.max(0.0001,Number(evidence.facedownLikelihood)||1),
      outside:Math.max(0.0001,Number(evidence.outsideLikelihood)||1)
    };
    for(const zone of OPPONENT_HIDDEN_LOCATIONS) weights[zone]*=likelihoods[zone];
    const posterior=this.posteriors.get(key);
    if(posterior){
      this.posteriors.set(key,normalizeLocationProbabilities(
        Object.fromEntries(OPPONENT_HIDDEN_LOCATIONS.map(zone=>[zone,(posterior[zone]||0)*likelihoods[zone]]))
      ));
    }
    this.evidence.push({
      cardId:key,
      kind:String(evidence.kind||"behavior"),
      reason:String(evidence.reason||""),
      likelihoods:clone(likelihoods)
    });
    return this;
  }
  noteExpectedPlayMissing(cardId,strength=0.65,reason="expected-play-missing"){
    const s=Math.max(0,Math.min(1,Number(strength)||0));
    return this.applyBehaviorEvidence(cardId,{
      kind:"expected-play-missing",
      reason,
      handLikelihood:Math.max(0.05,1-0.8*s),
      deckLikelihood:1+1.5*s,
      facedownLikelihood:1+0.5*s,
      outsideLikelihood:1
    });
  }
  noteLikelyHeld(cardId,strength=0.65,reason="likely-held"){
    const s=Math.max(0,Math.min(1,Number(strength)||0));
    return this.applyBehaviorEvidence(cardId,{
      kind:"likely-held",
      reason,
      handLikelihood:1+2*s,
      deckLikelihood:Math.max(0.1,1-0.55*s),
      facedownLikelihood:Math.max(0.1,1-0.35*s),
      outsideLikelihood:1
    });
  }
  recordReconstructionDraw(cardIds,totalCards,draws=2,reason="reconstruction-draw"){
    const total=Math.max(0,Math.floor(Number(totalCards)||0));
    const drawn=Math.max(0,Math.min(total,Math.floor(Number(draws)||0)));
    if(total<=0) return this;
    const pHand=drawn/total,pDeck=(total-drawn)/total;
    for(const cardId of arr(cardIds)){
      const key=this._ensure(cardId);
      this.posteriors.set(key,{hand:pHand,deck:pDeck,facedown:0,outside:0});
      this.evidence.push({
        cardId:key,
        kind:"reconstruction-draw",
        reason,
        totalCards:total,
        draws:drawn,
        handProbability:pHand,
        deckProbability:pDeck
      });
    }
    return this;
  }
  clearPosterior(cardId,reason="public-reveal"){
    const key=String(cardId);
    this.posteriors.delete(key);
    this.evidence.push({cardId:key,kind:"posterior-cleared",reason});
    return this;
  }
  setLocationPosterior(cardId,probabilities={},reason="location-prior"){
    const key=this._ensure(cardId);
    const posterior=normalizeLocationProbabilities(probabilities);
    this.posteriors.set(key,posterior);
    this.evidence.push({cardId:key,kind:"location-prior",reason,posterior:clone(posterior)});
    return this;
  }
  snapshot(state,opponentId,drawWindows=[1,2]){
    const pid=Number(opponentId);
    const publicZones=publicOpponentCardZones(state,pid);
    const counts=hiddenOpponentCounts(state,pid);
    const hiddenTotal=Object.values(counts).reduce((sum,x)=>sum+n(x),0);
    const windows=[...new Set(arr(drawWindows).map(x=>Math.max(0,Math.floor(Number(x)||0))).filter(x=>x>0))].sort((a,b)=>a-b);
    const cards=[];
    for(const rawCardId of this.cardPool){
      const cardId=String(rawCardId);
      const publicZone=publicZones.get(cardId);
      if(publicZone){
        cards.push({
          cardId,
          publicZone,
          posteriorSource:"public",
          handProbability:0,
          deckProbability:0,
          facedownProbability:0,
          outsideProbability:0,
          nextDrawOdds:windows.map(draws=>({draws,probability:0})),
          reasons:["public-zone"]
        });
        continue;
      }
      const base={};
      for(const zone of OPPONENT_HIDDEN_LOCATIONS) base[zone]=hiddenTotal>0?counts[zone]/hiddenTotal:0;
      const direct=this.posteriors.get(cardId);
      const weights=this.weights.get(cardId)||{hand:1,deck:1,facedown:1,outside:1};
      const source=direct||base;
      const probs=normalizeLocationProbabilities(
        Object.fromEntries(OPPONENT_HIDDEN_LOCATIONS.map(zone=>[zone,(source[zone]||0)*(weights[zone]||1)]))
      );
      const nextDrawOdds=windows.map(draws=>{
        const drawCount=Math.min(Math.max(0,Math.floor(draws)),counts.deck);
        const chance=counts.deck>0?probs.deck*(drawCount/counts.deck):0;
        return {draws:drawCount,probability:Number(clampProbability(chance).toFixed(8))};
      });
      const reasons=this.evidence.filter(x=>String(x.cardId)===cardId).slice(-8).map(x=>x.reason||x.kind);
      cards.push({
        cardId,
        publicZone:null,
        posteriorSource:direct?"explicit":"count-prior",
        handProbability:Number(clampProbability(probs.hand).toFixed(8)),
        deckProbability:Number(clampProbability(probs.deck).toFixed(8)),
        facedownProbability:Number(clampProbability(probs.facedown).toFixed(8)),
        outsideProbability:Number(clampProbability(probs.outside).toFixed(8)),
        nextDrawOdds,
        reasons
      });
    }
    return {
      mode:this.mode,
      assumedDeckKnown:this.mode==="decklist-known",
      handCount:counts.hand,
      deckCount:counts.deck,
      facedownCount:counts.facedown,
      outsideCount:counts.outside,
      cards,
      evidenceCount:this.evidence.length
    };
  }
}

export function createOpponentBeliefTrackerFromState(state,observerId,options={}){
  const observer=Number(observerId);
  if(observer!==1&&observer!==2) throw new Error("observerId must be 1 or 2");
  const opponent=observer===1?2:1;
  const mode=String(options.mode||"decklist-known");
  const priorCards=arr(options.cardPool);
  const publicCards=[...publicOpponentCardZones(state,opponent).keys()];
  const pool=mode==="decklist-known"
    ? opponentNormalCardPool(state,opponent)
    : sortedCardPool([...priorCards,...publicCards]);
  const tracker=new OpponentBeliefTracker(pool,{mode});
  for(const item of arr(options.locationPriors)){
    tracker.setLocationPosterior(item?.cardId,item?.probabilities||{},item?.reason||"initial-location-prior");
  }
  for(const item of arr(options.behaviorEvidence)){
    tracker.applyBehaviorEvidence(item?.cardId,item||{});
  }
  for(const item of arr(options.likelyHeld)){
    tracker.noteLikelyHeld(item?.cardId,item?.strength??0.65,item?.reason||"initial-likely-held");
  }
  for(const item of arr(options.expectedPlayMissing)){
    tracker.noteExpectedPlayMissing(item?.cardId,item?.strength??0.65,item?.reason||"initial-expected-play-missing");
  }
  return tracker;
}


function weightedChoiceIndex(weights,random){
  const safe=weights.map(x=>Math.max(0,Number(x)||0));
  const total=safe.reduce((a,b)=>a+b,0);
  if(total<=0) return Math.floor(random()*safe.length);
  let target=random()*total;
  for(let i=0;i<safe.length;i++){
    target-=safe[i];
    if(target<=0) return i;
  }
  return safe.length-1;
}

export function sampleOpponentHiddenStateFromBelief(belief,seedOrRandom=1){
  const random=typeof seedOrRandom==="function" ? seedOrRandom : seededUnit(seedOrRandom);
  const cards=arr(belief?.cards).filter(x=>!x?.publicZone);
  const slots=[];
  for(const zone of OPPONENT_HIDDEN_LOCATIONS){
    const count=Math.max(0,Math.floor(Number(belief?.[`${zone}Count`])||0));
    for(let i=0;i<count;i++) slots.push(zone);
  }
  if(cards.length!==slots.length){
    return {
      ok:false,
      error:`hidden card/slot mismatch: cards=${cards.length}, slots=${slots.length}`,
      hand:[],deck:[],facedown:[],outside:[],assignments:{}
    };
  }
  const explicit=shuffleWith(random,cards.filter(x=>x?.posteriorSource==="explicit"));
  const uncertain=shuffleWith(random,cards.filter(x=>x?.posteriorSource!=="explicit"));
  const orderedCards=[...explicit,...uncertain];
  const assignments={};
  const zones={hand:[],deck:[],facedown:[],outside:[]};
  for(const card of orderedCards){
    const weights=slots.map(zone=>Number(card?.[`${zone}Probability`])||0);
    const index=weightedChoiceIndex(weights,random);
    const zone=slots.splice(index,1)[0];
    const cardId=String(card.cardId);
    assignments[cardId]=zone;
    zones[zone].push(cardId);
  }
  zones.deck=shuffleWith(random,zones.deck);
  return {
    ok:true,
    assignments,
    hand:zones.hand,
    deck:zones.deck,
    facedown:zones.facedown,
    outside:zones.outside
  };
}

export function sampleOpponentBeliefWorlds(belief,count=16,seed=1){
  const total=Math.max(1,Math.floor(Number(count)||1));
  const random=seededUnit(seed);
  const worlds=[];
  for(let i=0;i<total;i++) worlds.push(sampleOpponentHiddenStateFromBelief(belief,random));
  return worlds;
}
function sideObservation(state,pid,isSelf){
  const out={
    characters:arr(state?.[`p${pid}_chara_ids`]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b),
    life:n(state?.[`p${pid}_life`]),
    aura:n(state?.[`p${pid}_aura`]),
    flare:n(state?.[`p${pid}_flare`]),
    freeze:n(state?.[`p${pid}_freeze`]),
    focus:n(state?.[`p${pid}_focus`]),
    intimidated:!!state?.[`p${pid}_intimidated`],
    umbrellaOpen:!!state?.[`p${pid}_yukihi_umbrella_open`],
    thallyaMachine:n(state?.[`p${pid}_thallya_machine`]),
    thallyaBurned:n(state?.[`p${pid}_thallya_burned`]),
    thallyaRideTokens:arr(state?.[`p${pid}_thallya_ride_tokens`]),
    thallyaForm:String(state?.[`p${pid}_thallya_form`]||""),
    thallyaA1Forms:arr(state?.[`p${pid}_thallya_a1_forms`]).map(String),
    thallyaTransformCount:Math.max(0,n(state?.[`p${pid}_thallya_transform_count`])),
    thallyaDrawLimitOnce:Math.max(0,n(state?.[`p${pid}_thallya_draw_limit_once`])),
    thallyaNoHandLimitTurn:!!state?.[`p${pid}_thallya_no_hand_limit_turn`]
  };
  if(isSelf){
    for(const z of OWN_ZONES) out[z]=arr(state?.[`p${pid}_${z}`]);
    out.deckCount=arr(state?.[`p${pid}_deck`]).length;
    out.deckKnowledge=buildOwnDeckKnowledge(state,pid,[1,2]);
    out.cardStatus=clone(state?.[`p${pid}_card_status`]||{});
    out.specialStatus=clone(state?.[`p${pid}_special_status`]||{});
    out.knownOpponentSpecials=arr(state?.[`p${pid}_kururu_known_opponent_specials`]);
  }else{
    out.handCount=arr(state?.[`p${pid}_hand`]).length;
    out.deckCount=arr(state?.[`p${pid}_deck`]).length;
    out.facedownCount=arr(state?.[`p${pid}_facedown`]).length;
    out.outsideCount=arr(state?.[`p${pid}_outside`]).length;
    out.specialCount=arr(state?.[`p${pid}_special`]).length;
    for(const z of PUBLIC_OPPONENT_ZONES) out[z]=arr(state?.[`p${pid}_${z}`]);
    out.cardStatus=publicCardStatus(state,pid,PUBLIC_OPPONENT_ZONES);
  }
  return out;
}

export function observationForPlayer(state,playerId,meta={}){
  const me=Number(playerId),opp=me===1?2:1;
  if(![1,2].includes(me)) throw new Error("playerId must be 1 or 2");
  const opponent=sideObservation(state,opp,false);
  if(meta?.opponentBelief) opponent.belief=clone(meta.opponentBelief);
  return {
    turn:n(meta?.turn ?? state?.turn),
    rawTurn:n(meta?.rawTurn ?? state?.rawTurn),
    turnPlayer:n(meta?.turnPlayer ?? state?.turn_player ?? state?.turnPlayer),
    selfTurnNumber:Math.max(1,n(meta?.selfTurnNumber ?? state?.selfTurnNumber ?? 1)),
    pendingMainChoiceKind:String(meta?.pendingMainChoiceKind ?? state?.pendingMainChoiceKind ?? ""),
    phase:String(meta?.phase ?? state?.phase ?? ""),
    distance:n(state?.distance),
    dust:n(state?.dust),
    pendingAttack:meta?.pendingAttack?clone(meta.pendingAttack):null,
    terminalLocked:clone(meta?.terminalLocked||{1:false,2:false}),
    mainMode:meta?.mainMode==null?null:String(meta.mainMode),
    fullPowerCardUsed:!!meta?.fullPowerCardUsed,
    fullPowerMainCardAvailable:meta?.fullPowerMainCardAvailable==null
      ? null
      : !!meta.fullPowerMainCardAvailable,
    attackCountsThisTurn:clone(meta?.attackCountsThisTurn||{1:0,2:0}),
    shinraPlan:meta?.selfShinraPlan==null?null:String(meta.selfShinraPlan),
    self:sideObservation(state,me,true),
    opponent
  };
}

function inferWinner(model){
  const last=model?.steps?.at?.(-1)?.state || model?.steps?.[model.steps.length-1]?.state || {};
  const l1=n(last.p1_life),l2=n(last.p2_life);
  if(l1<=0 && l2>0) return 2;
  if(l2<=0 && l1>0) return 1;

  const replay=model?.data||{};
  if(replay.IsDraw===true) return null;

  const result=replay.Result;
  if(typeof result==="boolean"){
    const local=Number(replay.LocalPlayerId);
    if(local===1||local===2) return result ? local : (local===1?2:1);
  }
  if([1,2].includes(Number(result))) return Number(result);
  if(result && typeof result==="object"){
    for(const k of ["WinnerId","winnerId","Winner","winner"]){
      if([1,2].includes(Number(result[k]))) return Number(result[k]);
    }
  }
  return null;
}

function transitionReward(winner,actor,isTerminal){
  if(!isTerminal || !winner || ![1,2].includes(actor)) return 0;
  return winner===actor ? 1 : -1;
}
function replayTrainingObservationMeta(step){
  const meta={...(step||{})};
  const pending=step?.pendingAttack || step?.pendingAttackDisplay || step?.attackDisplay || null;
  if(pending) meta.pendingAttack=clone(pending);
  return meta;
}

export function buildReplayTrainingData(model){
  if(!model?.steps?.length) return {schemaVersion:1,winner:null,samples:[]};
  const winner=inferWinner(model);
  const samples=[];
  for(let i=1;i<model.steps.length;i++){
    const step=model.steps[i],before=model.steps[i-1]?.state||{},after=step?.state||{};
    const action=actionFromReplayStep(step);
    const actor=[1,2].includes(action.actor)?action.actor:(Number(step?.turnPlayer)||1);
    const terminal=i===model.steps.length-1;
    samples.push({
      index:i-1,
      replayStep:i,
      actor,
      observation:observationForPlayer(before,actor,replayTrainingObservationMeta(model.steps[i-1])),
      action,
      nextObservation:observationForPlayer(after,actor,replayTrainingObservationMeta(step)),
      terminal,
      reward:transitionReward(winner,actor,terminal)
    });
  }
  return {schemaVersion:1,winner,samples};
}

function findHiddenLeak(observation){
  const opp=observation?.opponent||{},self=observation?.self||{};
  const leaks=[];
  for(const z of PRIVATE_OPPONENT_ZONES){
    if(Array.isArray(opp[z]) && opp[z].length) leaks.push(`opponent.${z}`);
  }
  if(Array.isArray(self.deck)) leaks.push("self.deck");
  if(Array.isArray(self.deckKnowledge?.pool) && self.deckKnowledge.pool.length!==Number(self.deckCount||0)) leaks.push("self.deckKnowledge.count");
  return leaks;
}
function validateResourceState(obs,label,errors){
  for(const sideName of ["self","opponent"]){
    const side=obs?.[sideName]||{};
    for(const key of ["life","aura","flare","freeze","focus"]){
      const v=Number(side[key]);
      if(!Number.isFinite(v)) errors.push(`${label}: ${sideName}.${key} が数値ではありません`);
      else if(v<0) errors.push(`${label}: ${sideName}.${key} が負数です (${v})`);
    }
  }
  for(const key of ["distance","dust"]){
    const v=Number(obs?.[key]);
    if(!Number.isFinite(v)) errors.push(`${label}: ${key} が数値ではありません`);
    else if(v<0) errors.push(`${label}: ${key} が負数です (${v})`);
  }
}
export function validateReplayTrainingData(dataset){
  const errors=[],warnings=[];
  let hiddenLeakCount=0;
  const samples=Array.isArray(dataset?.samples)?dataset.samples:[];
  for(let i=0;i<samples.length;i++){
    const s=samples[i];
    if(Number(s.index)!==i) warnings.push(`sample index が連続していません: expected ${i}, got ${s.index}`);
    if(![1,2].includes(Number(s.actor))) errors.push(`sample ${i}: actor が不正です`);
    for(const [label,obs] of [["before",s.observation],["after",s.nextObservation]]){
      const leaks=findHiddenLeak(obs);
      if(leaks.length){ hiddenLeakCount+=leaks.length; errors.push(`sample ${i} ${label}: 相手非公開領域が露出しています: ${leaks.join(",")}`); }
      validateResourceState(obs,`sample ${i} ${label}`,errors);
      const opp=obs?.opponent||{};
      for(const k of ["handCount","deckCount","facedownCount","outsideCount","specialCount"]){
        if(Number(opp[k])<0) errors.push(`sample ${i} ${label}: opponent.${k} が負数です`);
      }
    }
  }
  return {
    ok:errors.length===0,
    samples:samples.length,
    hiddenLeakCount,
    errors,
    warnings,
    winner:dataset?.winner??null
  };
}

export class ReplayHeadlessEnvironment{
  constructor(model,playerId=1){
    this.model=model;
    this.playerId=Number(playerId)===2?2:1;
    this.reset();
  }
  reset(){
    this.index=0;
    this.done=!(this.model?.steps?.length>1);
    return this.observe();
  }
  observe(){
    const state=this.model?.steps?.[this.index]?.state||{};
    return observationForPlayer(state,this.playerId,this.model?.steps?.[this.index]||{});
  }
  peekRecordedAction(){
    if(this.done) return null;
    return actionFromReplayStep(this.model.steps[this.index+1]);
  }
  step(){
    if(this.done) return {observation:this.observe(),action:null,reward:0,done:true};
    const next=this.model.steps[this.index+1],action=actionFromReplayStep(next);
    this.index++;
    this.done=this.index>=this.model.steps.length-1;
    const winner=this.done?inferWinner(this.model):null;
    const reward=this.done&&winner?(winner===this.playerId?1:-1):0;
    return {observation:this.observe(),action,reward,done:this.done};
  }
}


function replayActorForStep(step,previousStep){
  const candidates=[
    Number(step?.actor),
    Number(step?.turnPlayer),
    Number(step?.state?.turn_player),
    Number(previousStep?.state?.turn_player),
    Number(previousStep?.turnPlayer)
  ];
  return candidates.find(v=>v===1||v===2) || 1;
}
function actionKey(action){
  const a=action||{};
  return JSON.stringify({
    actor:Number(a.actor)||0,
    kind:String(a.kind||""),
    label:String(a.label||""),
    cardId:Number(a.cardId)||null,
    basicAction:Number.isFinite(Number(a.basicAction))?Number(a.basicAction):null,
    damageChoice:Number.isFinite(Number(a.damageChoice))?Number(a.damageChoice):null
  });
}

export class ReplaySelfPlayEnvironment{
  constructor(model){
    this.model=model;
    this.reset();
  }
  reset(){
    this.index=0;
    this.done=!(this.model?.steps?.length>1);
    this.winner=this.done?inferWinner(this.model):null;
    return this.snapshot();
  }
  currentPlayer(){
    if(this.done) return null;
    return replayActorForStep(this.model.steps[this.index+1],this.model.steps[this.index]);
  }
  observe(playerId){
    const pid=Number(playerId);
    if(pid!==1&&pid!==2) throw new Error("playerId must be 1 or 2");
    const step=this.model?.steps?.[this.index]||{};
    return observationForPlayer(step.state||{},pid,step);
  }
  legalActions(playerId=this.currentPlayer()){
    if(this.done) return [];
    const actor=this.currentPlayer();
    if(Number(playerId)!==actor) return [];
    const action=actionFromReplayStep(this.model.steps[this.index+1]);
    action.actor=actor;
    return [clone(action)];
  }
  snapshot(){
    return {
      index:this.index,
      done:this.done,
      winner:this.winner,
      currentPlayer:this.currentPlayer(),
      observations:{
        1:this.observe(1),
        2:this.observe(2)
      }
    };
  }
  step(action){
    if(this.done) throw new Error("match is already finished");
    const actor=this.currentPlayer();
    const legal=this.legalActions(actor);
    const expected=legal[0];
    if(!expected) throw new Error(`no legal action at replay step ${this.index+1}`);
    if(actionKey(action)!==actionKey(expected)){
      throw new Error(`illegal replay action at step ${this.index+1}`);
    }
    this.index++;
    this.done=this.index>=this.model.steps.length-1;
    this.winner=this.done?inferWinner(this.model):null;
    return {
      actor,
      action:clone(expected),
      index:this.index,
      done:this.done,
      winner:this.winner,
      observations:{
        1:this.observe(1),
        2:this.observe(2)
      },
      rewards:{
        1:this.done&&this.winner?(this.winner===1?1:-1):0,
        2:this.done&&this.winner?(this.winner===2?1:-1):0
      }
    };
  }
}

export class RecordedReplayAgent{
  chooseAction(context){
    const legal=Array.isArray(context?.legalActions)?context.legalActions:[];
    if(!legal.length) throw new Error("recorded agent received no legal action");
    return clone(legal[0]);
  }
}

export function runHeadlessMatch(environment,agents={},options={}){
  const maxActions=Math.max(1,Number(options.maxActions)||10000);
  const history=[];
  environment.reset();
  while(!environment.done){
    if(history.length>=maxActions) throw new Error(`headless match exceeded ${maxActions} actions`);
    const actor=environment.currentPlayer();
    if(actor!==1&&actor!==2) throw new Error("headless match has no active player");
    const legalActions=environment.legalActions(actor);
    if(!legalActions.length) throw new Error(`player ${actor} has no legal action`);
    const agent=agents[actor]||agents[String(actor)];
    if(!agent||typeof agent.chooseAction!=="function") throw new Error(`agent for player ${actor} is missing`);
    const observation=environment.observe(actor);
    const selected=agent.chooseAction({
      playerId:actor,
      observation:clone(observation),
      legalActions:clone(legalActions),
      actionIndex:history.length
    });
    if(selected&&typeof selected.then==="function") throw new Error("async agents are not supported by runHeadlessMatch");
    history.push(environment.step(selected));
  }
  return {
    actions:history.length,
    winner:environment.winner,
    history,
    final:environment.snapshot()
  };
}

export function verifyReplayHeadless(model){
  const errors=[];
  if(!model?.steps?.length) return {ok:false,actions:0,winner:null,errors:["replay has no steps"]};
  try{
    const environment=new ReplaySelfPlayEnvironment(model);
    const result=runHeadlessMatch(
      environment,
      {1:new RecordedReplayAgent(),2:new RecordedReplayAgent()},
      {maxActions:Math.max(100,model.steps.length+10)}
    );
    const expectedActions=Math.max(0,model.steps.length-1);
    if(result.actions!==expectedActions) errors.push(`action count mismatch: expected ${expectedActions}, got ${result.actions}`);
    const expectedWinner=inferWinner(model);
    if(expectedWinner&&result.winner!==expectedWinner) errors.push(`winner mismatch: expected ${expectedWinner}, got ${result.winner}`);
    return {ok:errors.length===0,actions:result.actions,winner:result.winner,errors};
  }catch(error){
    errors.push(String(error?.message||error));
    return {ok:false,actions:0,winner:null,errors};
  }
}


function supportForActionType(type){
  return REPLAY_ACTION_SUPPORT[Number(type)] || {
    name:`未分類 ActionType ${Number(type)}`,
    area:"未分類",
    replay:"未分類",
    selfPlay:"未実装"
  };
}
function sortedNumericEntries(map){
  return [...map.entries()].sort((a,b)=>Number(a[0])-Number(b[0]));
}
export function analyzeReplayRuleCoverage(model){
  const byType=new Map();
  const stepKinds=new Map();
  let rawActions=0;
  for(const step of model?.steps||[]){
    const kind=String(step?.kind||"不明");
    stepKinds.set(kind,(stepKinds.get(kind)||0)+1);
  }
  for(let i=0;i<(model?.data?.Records||[]).length;i++){
    const record=model.data.Records[i];
    const action=record?.Action;
    if(!action) continue;
    rawActions++;
    const type=Number(action.ActionType);
    const key=Number.isFinite(type)?type:-1;
    if(!byType.has(key)){
      byType.set(key,{
        actionType:key,
        count:0,
        reasons:new Map(),
        payloadKeys:new Set(),
        players:new Set(),
        examples:[]
      });
    }
    const row=byType.get(key);
    row.count++;
    const reason=Number(action.ActionReason);
    const reasonKey=Number.isFinite(reason)?reason:0;
    row.reasons.set(reasonKey,(row.reasons.get(reasonKey)||0)+1);
    const p=payload(action);
    Object.keys(p).forEach(k=>row.payloadKeys.add(k));
    const pid=Number(action.PlayerId);
    if(pid===1||pid===2) row.players.add(pid);
    if(row.examples.length<5){
      row.examples.push({
        recordIndex:Number(record?.Index ?? i),
        group:String(action?.Group ?? ""),
        playerId:pid===1||pid===2?pid:null,
        reason:reasonKey
      });
    }
  }
  const actionTypes=sortedNumericEntries(byType).map(([,row])=>{
    const support=supportForActionType(row.actionType);
    return {
      actionType:row.actionType,
      name:support.name,
      area:support.area,
      count:row.count,
      reasons:sortedNumericEntries(row.reasons).map(([reason,count])=>({reason:Number(reason),count})),
      payloadKeys:[...row.payloadKeys].sort(),
      players:[...row.players].sort(),
      examples:row.examples,
      replayHandling:support.replay,
      selfPlayHandling:support.selfPlay,
      classified:!!REPLAY_ACTION_SUPPORT[row.actionType]
    };
  });
  const unclassified=actionTypes.filter(x=>!x.classified);
  return {
    schemaVersion:1,
    rawActions,
    actionTypeCount:actionTypes.length,
    unclassifiedTypeCount:unclassified.length,
    unclassifiedActionCount:unclassified.reduce((sum,x)=>sum+x.count,0),
    freeSelfPlayRuleCount:actionTypes.filter(x=>x.selfPlayHandling==="実装済み").length,
    actionTypes,
    stepKinds:[...stepKinds.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"ja")).map(([kind,count])=>({kind,count}))
  };
}

export function renderAIRuleCoverage(coverage,summaryEl,bodyEl){
  const metric=(label,val)=>{
    const d=document.createElement("div"),b=document.createElement("b"),sp=document.createElement("span");
    d.className="metric";b.textContent=String(val);sp.textContent=label;d.append(b,sp);return d;
  };
  summaryEl.replaceChildren(
    metric("生Action",coverage?.rawActions??0),
    metric("ActionType",coverage?.actionTypeCount??0),
    metric("未分類Type",coverage?.unclassifiedTypeCount??0),
    metric("自由対戦ルール",coverage?.freeSelfPlayRuleCount??0)
  );
  bodyEl.replaceChildren();
  const rows=Array.isArray(coverage?.actionTypes)?coverage.actionTypes:[];
  if(!rows.length){
    const tr=document.createElement("tr");
    tr.innerHTML='<td colspan="8" class="empty">Actionデータがありません。</td>';
    bodyEl.append(tr);
    return;
  }
  for(const row of rows){
    const tr=document.createElement("tr");
    const reasons=row.reasons.map(x=>`${x.reason}×${x.count}`).join(", ")||"-";
    const values=[
      row.actionType,
      row.name,
      row.area,
      row.count,
      reasons,
      row.payloadKeys.join(", ")||"-",
      row.replayHandling,
      row.selfPlayHandling
    ];
    values.forEach((value,index)=>{
      const td=document.createElement("td");
      td.textContent=String(value);
      if(index===0||index===3) td.className="num";
      tr.append(td);
    });
    bodyEl.append(tr);
  }
}

export function analyzeReplayForAI(model){
  const dataset=buildReplayTrainingData(model);
  const validation=validateReplayTrainingData(dataset);
  const headless=verifyReplayHeadless(model);
  const coverage=analyzeReplayRuleCoverage(model);
  const basicActions=validateReplayBasicActions(model);
  const basicSandbox=probeBasicActionSandboxFromReplay(model);
  const coreSandbox=probeCoreTurnSandboxFromReplay(model);
  if(!headless.ok){
    validation.errors.push(...headless.errors.map(x=>`headless: ${x}`));
    validation.ok=false;
  }
  if(!basicSandbox.ok){
    const details=arr(basicSandbox.invariantErrors);
    validation.warnings.push(...(details.length?details:[basicSandbox.error||basicSandbox.doneReason||"failed"]).map(x=>`basic-sandbox: ${x}`));
  }
  if(!coreSandbox.ok){
    const details=arr(coreSandbox.invariantErrors);
    validation.warnings.push(...(details.length?details:[coreSandbox.doneReason||"failed"]).map(x=>`core-sandbox: ${x}`));
  }
  return {dataset,validation,headless,coverage,basicActions,basicSandbox,coreSandbox};
}

export function renderAIReplayReport(model,report,summaryEl,bodyEl){
  const metric=(label,val)=>{
    const d=document.createElement("div"),b=document.createElement("b"),s=document.createElement("span");
    d.className="metric";b.textContent=String(val);s.textContent=label;d.append(b,s);return d;
  };
  const v=report.validation;
  summaryEl.replaceChildren(
    metric("リプレイ手数",model.steps.length),
    metric("学習遷移",v.samples),
    metric("非公開情報漏れ",v.hiddenLeakCount),
    metric("検証エラー",v.errors.length)
  );
  bodyEl.replaceChildren();
  const rows=report.dataset.samples.slice(0,200);
  if(!rows.length){
    const tr=document.createElement("tr");
    tr.innerHTML='<td colspan="5" class="empty">学習用の遷移を作成できませんでした。</td>';
    bodyEl.append(tr);
    return;
  }
  for(const s of rows){
    const tr=document.createElement("tr");
    const vals=[
      s.replayStep,
      s.actor===1?"P1":"P2",
      s.action.label||s.action.kind||"-",
      s.terminal?"終局":"継続",
      v.ok?"OK":"要確認"
    ];
    vals.forEach((x,i)=>{const td=document.createElement("td");td.textContent=String(x);if(i===0)td.className="num";tr.append(td);});
    bodyEl.append(tr);
  }
}
