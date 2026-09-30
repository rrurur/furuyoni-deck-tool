const CHARA_NAMES = {
  1:"ユリナ",2:"サイネ",3:"ヒミカ",4:"トコヨ",5:"オボロ",6:"ユキヒ",7:"シンラ",8:"ハガネ",
  9:"チカゲ",10:"クルル",11:"サリヤ",12:"ライラ",13:"ウツロ",14:"ホノカ",15:"コルヌ",16:"ヤツハ",
  17:"ハツミ",18:"ミズキ",19:"メグミ",20:"カナヱ",21:"カムヰ",22:"レンリ",23:"アキナ",24:"シスイ",25:"ミソラ"
};
const PHASE_NAMES = {0:"?",1:"準備",2:"開始",3:"メイン",4:"終了"};
const BASIC_ACTIONS = {1:"前進",2:"後退",3:"纏い",4:"宿し",5:"離脱"};
const MAIN_TYPES = {1:"攻撃",2:"付与",3:"行動",4:"不定"};
const SUB_TYPES = {0:"",1:"対応",2:"全力"};
const RESOURCE_ZONE = {
  1001:["board","distance"],1002:["board","dust"],
  1005:[1,"life"],1006:[1,"aura"],1007:[1,"flare"],
  1008:[2,"life"],1009:[2,"aura"],1010:[2,"flare"]
};
const LEGACY_TO_RE_CARD = {
  "na_04_tokoyo_o_n_2":"re_04_tokoyo_o_n_3",
  "na_04_tokoyo_o_n_3":"re_04_tokoyo_o_n_2",
  "na_04_tokoyo_a2_n_2":"re_04_tokoyo_a2_n_3",
  "na_05_oboro_o_n_3":"re_05_oboro_o_n_4",
  "na_05_oboro_o_n_4":"re_05_oboro_o_n_5",
  "na_05_oboro_o_n_5":"re_05_oboro_o_n_6",
  "na_05_oboro_o_n_6":"re_05_oboro_o_n_3",
  "na_05_oboro_a1_n_3":"re_05_oboro_a1_n_4",
  "na_08_hagane_a1_n_2":"re_08_hagane_a1_n_7"
};
const OBORO_SETUP_CODES = new Set([
  "re_05_oboro_o_n_1","re_05_oboro_o_n_2","re_05_oboro_o_n_5","re_05_oboro_o_n_6","re_05_oboro_o_n_7"
]);

class MsgpackReader {
  constructor(buffer){
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.index = 0;
    this.decoder = new TextDecoder("utf-8");
  }
  readBytes(n){
    if(this.index+n>this.bytes.length) throw new Error("unexpected end of msgpack data");
    const out=this.bytes.subarray(this.index,this.index+n); this.index+=n; return out;
  }
  u8(){ return this.readBytes(1)[0]; }
  u16(){ const v=this.view.getUint16(this.index,false); this.index+=2; return v; }
  u32(){ const v=this.view.getUint32(this.index,false); this.index+=4; return v; }
  i8(){ const v=this.view.getInt8(this.index); this.index+=1; return v; }
  i16(){ const v=this.view.getInt16(this.index,false); this.index+=2; return v; }
  i32(){ const v=this.view.getInt32(this.index,false); this.index+=4; return v; }
  u64(){ const v=this.view.getBigUint64(this.index,false); this.index+=8; return Number(v); }
  i64(){ const v=this.view.getBigInt64(this.index,false); this.index+=8; return Number(v); }
  f32(){ const v=this.view.getFloat32(this.index,false); this.index+=4; return v; }
  f64(){ const v=this.view.getFloat64(this.index,false); this.index+=8; return v; }
  str(n){ return this.decoder.decode(this.readBytes(n)); }
  map(n){ const o={}; for(let i=0;i<n;i++){ const k=this.unpack(); o[String(k)]=this.unpack(); } return o; }
  arr(n){ return Array.from({length:n},()=>this.unpack()); }
  unpack(){
    const code=this.u8();
    if(code<=0x7f) return code;
    if(code>=0xe0) return code-256;
    if(code>=0xa0 && code<=0xbf) return this.str(code&0x1f);
    if(code>=0x90 && code<=0x9f) return this.arr(code&0x0f);
    if(code>=0x80 && code<=0x8f) return this.map(code&0x0f);
    switch(code){
      case 0xc0:return null; case 0xc2:return false; case 0xc3:return true;
      case 0xcc:return this.u8(); case 0xcd:return this.u16(); case 0xce:return this.u32(); case 0xcf:return this.u64();
      case 0xd0:return this.i8(); case 0xd1:return this.i16(); case 0xd2:return this.i32(); case 0xd3:return this.i64();
      case 0xca:return this.f32(); case 0xcb:return this.f64();
      case 0xd9:return this.str(this.u8()); case 0xda:return this.str(this.u16()); case 0xdb:return this.str(this.u32());
      case 0xdc:return this.arr(this.u16()); case 0xdd:return this.arr(this.u32());
      case 0xde:return this.map(this.u16()); case 0xdf:return this.map(this.u32());
      case 0xc4:return this.readBytes(this.u8()).slice();
      case 0xc5:return this.readBytes(this.u16()).slice();
      case 0xc6:return this.readBytes(this.u32()).slice();
      default: throw new Error(`unsupported msgpack code 0x${code.toString(16).padStart(2,"0")}`);
    }
  }
}

export function decodeReply(buffer){
  const r=new MsgpackReader(buffer); const data=r.unpack();
  if(r.index!==r.bytes.length) throw new Error(`unread trailing bytes: ${r.bytes.length-r.index}`);
  if(!data || typeof data!=="object" || !data.Records || !data.InitData) throw new Error("対応する .reply 形式ではありません。");
  return data;
}

export function stripStateSuffix(slug){
  return String(slug||"").toLowerCase().trim().replaceAll("-","_").replace(/_s\d+(?:_\d+)?$/i,"");
}
export function currentCardSlug(slug){
  const base=stripStateSuffix(slug);
  if(LEGACY_TO_RE_CARD[base]) return LEGACY_TO_RE_CARD[base];
  if(base.startsWith("na_")) return `re_${base.slice(3)}`;
  return base;
}
export function assetCardSlug(slug){
  const s=currentCardSlug(slug);
  return s.startsWith("re_") ? `na_${s.slice(3)}` : s;
}
export function rawCardSlug(data,cardId){
  const all=(data?.InitData?.AllCardsData)||{};
  return String(all[String(cardId)] ?? all[cardId] ?? "");
}
export function cardNameFromSlug(slug,dict={}){
  let s=String(slug||"").trim().toLowerCase().replaceAll("-","_");
  if(!s) return "不明カード";
  s=currentCardSlug(s);
  const overrides=Object.fromEntries(Object.entries(dict.overrides||{}).map(([k,v])=>[String(k).toLowerCase(),v]));
  const legacy=Object.fromEntries(Object.entries(dict.legacy_overrides||{}).map(([k,v])=>[String(k).toLowerCase(),v]));
  if(overrides[s]) return overrides[s];
  let base=s;
  const parts=base.split("_");
  if(parts.length>=2 && /^s\d+$/.test(parts.at(-2)) && /^\d+$/.test(parts.at(-1))) base=parts.slice(0,-2).join("_");
  else if(/^s\d+$/.test(parts.at(-1))) base=parts.slice(0,-1).join("_");
  if(String(slug).toLowerCase().startsWith("na_") && legacy[base]) return legacy[base];
  const m=s.match(/^(?:na|re)_(\d{2})_([a-z]+)_([oa]\d?|o)_(n|s|p)_(\d+)/);
  if(!m) return overrides[s] || `未登録カード名（${s}）`;
  const [,no,roman,version,kind,idxText]=m; const idx=Number(idxText);
  const info=(dict.megami||{})[`${no}_${roman}`];
  if(!info) return `未登録カード名（${s}）`;
  if(version!=="o"){
    if(overrides[s]) return overrides[s];
    const kname={n:"通常札",s:"切札",p:"追加札"}[kind]||"カード";
    return `${info.name||"?"}${version.toUpperCase()}差替${kname}`;
  }
  const arr=info[{n:"normal",s:"special",p:"poison"}[kind]]||[];
  return (idx>=1 && idx<=arr.length) ? arr[idx-1] : `未登録カード名（${s}）`;
}
export function cardName(data,cardId,dict={}){ return cardNameFromSlug(rawCardSlug(data,cardId),dict); }
export function charaName(id){ return CHARA_NAMES[Number(id)] || `ID:${id}`; }
export function roundFromRawTurn(rawTurn){ const n=Number(rawTurn)||0; return n>0?Math.floor((n+1)/2):0; }
export function halfName(rawTurn){ const n=Number(rawTurn)||0; return n<=0?"":(n%2===1?"先行":"後攻"); }

function payloadDict(action){ const p=action?.Payload; return Array.isArray(p)&&p.length>=2&&p[1]&&typeof p[1]==="object"?p[1]:{}; }
function initialResourceState(data){
  const vals={distance:0,dust:0,p1_life:0,p1_aura:0,p1_flare:0,p2_life:0,p2_aura:0,p2_flare:0};
  for(const z of data?.InitData?.TokenZones||[]){
    const map=RESOURCE_ZONE[Number(z.ID)]; if(!map) continue;
    const [owner,name]=map; const count=Object.values(z.Tokens||{}).reduce((a,v)=>a+(Number(v)||0),0);
    vals[owner==="board"?name:`p${owner}_${name}`]=count;
  }
  return vals;
}
function applyTokenMove(resources,action){
  if(Number(action?.ActionType)!==2) return;
  const p=payloadDict(action), n=Number(p.MoveCount)||0;
  for(const [zid,sign] of [[Number(p.OriginZoneId),-1],[Number(p.TargetZoneId),1]]){
    const map=RESOURCE_ZONE[zid]; if(!map) continue;
    const [owner,name]=map, key=owner==="board"?name:`p${owner}_${name}`;
    resources[key]=(Number(resources[key])||0)+sign*n;
  }
}
function zoneMaps(data){
  const zidToType={};
  for(const z of data?.InitData?.CardZones||[]) zidToType[Number(z.ID)]=Number(z.Type);
  return zidToType;
}
function clone(v){ return globalThis.structuredClone ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
function stateFromGameState(gs,zidToType,resources){
  const b=gs?.BoardStatus||{};
  const out={turn:b.Turn,turn_player:b.TurnPlayer,distance:b.RealDistance ?? resources.distance,dust:b.Dust ?? resources.dust};
  for(const pid of [1,2]){
    for(const r of ["life","aura","flare"]) out[`p${pid}_${r}`]=Number(resources[`p${pid}_${r}`])||0;
    for(const z of ["hand","deck","facedown","discard","special","enhancement","using","outside"]) out[`p${pid}_${z}`]=[];
    out[`p${pid}_special_status`]={}; out[`p${pid}_card_status`]={};
  }
  const typeToKey={257:"deck",258:"hand",259:"facedown",260:"discard",261:"special",262:"enhancement",263:"using",264:"outside"};
  for(const c of gs?.CardsStatus||[]){
    const pid=Number(c.OwnerId), cid=Number(c.ID), zid=Number(c.Zone);
    if(![1,2].includes(pid)||!Number.isInteger(cid)||cid<=0) continue;
    const key=typeToKey[zidToType[zid]];
    if(key){
      out[`p${pid}_${key}`].push(cid);
      out[`p${pid}_card_status`][String(cid)]={};
      for(const k of ["Type","MainType","SubType","Status","CanUse","Distance","AuraDamage","LifeDamage","Cost","Charge","UmbrellaState"])
        out[`p${pid}_card_status`][String(cid)][k]=clone(c[k]);
      if(key==="special") out[`p${pid}_special_status`][String(cid)]=Number(c.Status)||0;
    }
  }
  return out;
}

export function buildReplayModel(data,dict={}){
  const players=data.PlayersMeta||{};
  const localPlayer=Number(data.LocalPlayerId)||1;
  const zidToType=zoneMaps(data);
  const cardMeta={}; const seen={1:new Set(),2:new Set()}; const chosenCharas={1:[],2:[]};
  for(const pd of data?.InitData?.PlayersData||[]){ const pid=Number(pd.ID); if([1,2].includes(pid)) chosenCharas[pid]=[...(pd.CharaIds||[])]; }
  for(const r of data.Records||[]){
    const gs=r.GameState; if(!gs) continue;
    for(const c of gs.CardsStatus||[]){
      const pid=Number(c.OwnerId), cid=Number(c.ID);
      if([1,2].includes(pid)&&Number.isInteger(cid)&&cid>0){
        if(!cardMeta[cid]) cardMeta[cid]=clone(c);
        if(rawCardSlug(data,cid)) seen[pid].add(cid);
      }
    }
  }
  const decks={1:[...seen[1]].sort((a,b)=>a-b),2:[...seen[2]].sort((a,b)=>a-b)};
  const cardType=(cid)=>{
    const c=cardMeta[cid]||{}, parts=[MAIN_TYPES[Number(c.MainType)]||"?"];
    const sub=SUB_TYPES[Number(c.SubType)]||""; if(sub) parts.push(sub);
    if(OBORO_SETUP_CODES.has(currentCardSlug(rawCardSlug(data,cid)))) parts.push("設置");
    return parts.filter(Boolean).join("・");
  };
  const resources=initialResourceState(data); let lastGs=null,rawTurn=0,tp=-1,phase="初期",current=null,lastNonattack=null;
  const steps=[];
  const standardBasicGroups=new Set(),reconstructionGroups=new Set(),fatigueGroups=new Set();
  for(const rr of data.Records||[]){
    const aa=rr.Action; if(!aa) continue;
    const t=Number(aa.ActionType), reason=Number(aa.ActionReason), group=aa.Group;
    if(reason===3 && [1,12].includes(t)) standardBasicGroups.add(String(group));
    if(t===2 && reason===10003) reconstructionGroups.add(String(group));
    if(t===2 && reason===10002) fatigueGroups.add(String(group));
    if(t===1 && reason===6) reconstructionGroups.add(String(group));
  }
  const snapshot=()=>{
    if(!lastGs){
      const st={turn:0,turn_player:-1,distance:resources.distance,dust:resources.dust};
      for(const pid of [1,2]){
        for(const rr of ["life","aura","flare"]) st[`p${pid}_${rr}`]=resources[`p${pid}_${rr}`];
        for(const z of ["hand","deck","facedown","discard","special","enhancement","using","outside"]) st[`p${pid}_${z}`]=[];
        st[`p${pid}_special_status`]={}; st[`p${pid}_card_status`]={};
      }
      return st;
    }
    return stateFromGameState(lastGs,zidToType,resources);
  };
  const makeStep=(recordIndex,actor,kind,title,detail="",raw=[])=>({step:0,recordIndex,turn:roundFromRawTurn(rawTurn),rawTurn,turnPlayer:tp,phase,actor,kind,title,detail,state:{},raw});
  const finalize=()=>{ if(current){ current.state=snapshot(); current.step=steps.length; steps.push(current); current=null; } };
  const addTurnEnd=(recordIndex)=>{ if(rawTurn<=0)return; const st=snapshot(); steps.push({step:steps.length,recordIndex,turn:roundFromRawTurn(rawTurn),rawTurn,turnPlayer:tp,phase:"終了",actor:tp,kind:"ターンエンド",title:"ターンエンド",detail:`${halfName(rawTurn)}の手番終了`,state:st,raw:[]}); };
  steps.push({step:0,recordIndex:-1,turn:0,rawTurn:0,turnPlayer:-1,phase:"初期",actor:0,kind:"初期",title:"初期局面",detail:"",state:snapshot(),raw:[]});
  for(let ri=0;ri<(data.Records||[]).length;ri++){
    const r=data.Records[ri], a=r.Action;
    if(a){
      applyTokenMove(resources,a);
      const t=Number(a.ActionType), p=payloadDict(a), actor=Number(a.PlayerId)||0, group=String(a.Group);
      if(t===11){
        const newPhase=PHASE_NAMES[Number(p.PhaseType)]||String(p.PhaseType);
        const newRaw=Number(p.Turn)||rawTurn||0;
        if(rawTurn>0&&newRaw>0&&newRaw!==rawTurn){ finalize(); addTurnEnd(Number(r.Index ?? ri)); }
        rawTurn=newRaw; tp=actor; phase=newPhase;
      } else if(t===5){
        if(standardBasicGroups.has(group)){
          finalize(); const typ=Number(p.Type)||0, nm=BASIC_ACTIONS[typ]||`基本動作${typ}`;
          current=makeStep(Number(r.Index ?? ri),tp,"基本動作",nm,"",[a]); lastNonattack=null;
        } else if(current?.kind==="カード使用") current.raw.push(a);
      } else if(t===205){
        const cid=Number(p.CardId)||0, meta=cardMeta[cid]||{};
        if(Number(meta.MainType)!==1){
          finalize(); const suffix=Number(a.ActionReason)===11?"（対応）":""; const nm=cardName(data,cid,dict);
          current=makeStep(Number(r.Index ?? ri),Number(p.UserId)||actor,"カード使用",`${nm}${suffix} 使用`,cardType(cid),[a]); lastNonattack=current;
        }
      } else if(t===300){
        finalize(); const cid=Number(p.SourceCardId)||0, owner=Number(p.OwnerId)||actor, nm=cid?cardName(data,cid,dict):"生成攻撃";
        const ad=Number.isInteger(p.AuraDamage)&&p.AuraDamage>=0?String(p.AuraDamage):"-";
        const ld=Number.isInteger(p.LifeDamage)&&p.LifeDamage>=0?String(p.LifeDamage):"-";
        const dist=(p.Distance||[]).join("-");
        current=makeStep(Number(r.Index ?? ri),owner,"攻撃",`${nm} 攻撃 ${ad}/${ld}`,`適正距離: ${dist}`,[a]); lastNonattack=null;
      } else if(t===301){
        finalize(); const ch=Number(p.DamageChoose)||0, receive={1:"オーラ受け",2:"ライフ受け"}[ch]||`受け方${ch}`;
        if(reconstructionGroups.has(group)) current=makeStep(Number(r.Index ?? ri),actor,"再構成","再構成",`ライフ1ダメージ（${receive}）`,[a]);
        else if(fatigueGroups.has(group)) current=makeStep(Number(r.Index ?? ri),actor,"焦燥",`焦燥：${receive}`,"山札から引けなかったことによる1/1ダメージ",[a]);
        else current=makeStep(Number(r.Index ?? ri),actor,"ダメージ選択",receive,"",[a]);
        lastNonattack=null;
      } else if(t===303){
        const choose=p.Choose||[];
        if(choose.length){
          const idx=Number(choose[0]); const letter=(idx>=0&&idx<26)?String.fromCharCode(65+idx):String(idx+1);
          if(current?.kind==="カード使用"){ current.title+=`：効果選択${letter}`; current.raw.push(a); }
          else if(lastNonattack){ lastNonattack.title+=`：効果選択${letter}`; lastNonattack.raw.push(a); }
          else { finalize(); current=makeStep(Number(r.Index ?? ri),actor,"選択",`効果選択${letter}`,"",[a]); }
        }
      }
    }
    if(r.GameState){ lastGs=r.GameState; if(current) current.state=snapshot(); }
  }
  finalize(); steps.forEach((s,i)=>s.step=i);
  return {data,players,localPlayer,zidToType,cardMeta,decks,chosenCharas,steps};
}

export function playerName(model,pid){ return String(model.players?.[String(pid)] ?? model.players?.[pid] ?? `P${pid}`); }
export function cardImageUrl(data,cardId,seasonConfig={}){
  const raw=rawCardSlug(data,cardId); if(!raw) return "";
  const slug=assetCardSlug(raw);
  const base=String(seasonConfig.assetBaseUrl||"https://furuyoni-diary-1918f.web.app/assets").replace(/\/+$/,"");
  const folder=seasonConfig.currentAssetFolder||"replay";
  const v=seasonConfig.assetVersion?`?v=${encodeURIComponent(seasonConfig.assetVersion)}`:"";
  return `${base}/${folder}/images/${slug}.png${v}`;
}
