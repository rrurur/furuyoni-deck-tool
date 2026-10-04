const LEGACY_TO_CURRENT_ASSET = {
  "na_04_tokoyo_o_n_2":"na_04_tokoyo_o_n_3",
  "na_04_tokoyo_o_n_3":"na_04_tokoyo_o_n_2",
  "na_04_tokoyo_a2_n_2":"na_04_tokoyo_a2_n_3",
  "na_05_oboro_o_n_3":"na_05_oboro_o_n_4",
  "na_05_oboro_o_n_4":"na_05_oboro_o_n_5",
  "na_05_oboro_o_n_5":"na_05_oboro_o_n_6",
  "na_05_oboro_o_n_6":"na_05_oboro_o_n_3",
  "na_05_oboro_a1_n_3":"na_05_oboro_a1_n_4",
  "na_08_hagane_a1_n_2":"na_08_hagane_a1_n_7"
};

const CHAR_ID_TO_BASE = {
  1:"yurina",2:"saine",3:"himika",4:"tokoyo",5:"oboro",6:"yukihi_a",7:"shinra",8:"hagane",
  9:"chikage",10:"kururu",11:"thallya",12:"raira",13:"utsuro",14:"honoka",15:"korunu",16:"yatsuha",
  17:"hatsumi",18:"mizuki",19:"megumi",20:"kanawe",21:"kamuwi",22:"renri",23:"akina",24:"shisui",
  25:"misora",26:"innealra_nornir_1"
};

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
  const r=new MsgpackReader(buffer);
  const data=r.unpack();
  if(!data || typeof data!=="object" || !data.Records || !data.InitData) throw new Error("invalid reply");
  return data;
}

function cardCodeToPath(code){
  if(!code) return "";
  let s=String(code).trim().toLowerCase().replaceAll("-","_");
  if(s.startsWith("re_")) return `images/na_${s.slice(3)}.png`;
  const base=s.replace(/_s\d+(?:_\d+)?$/i,"");
  if(LEGACY_TO_CURRENT_ASSET[base]) return `images/${LEGACY_TO_CURRENT_ASSET[base]}.png`;
  return `images/${s}.png`;
}

function firstGameState(data){
  for(const record of data?.Records||[]){
    if(record?.GameState && typeof record.GameState==="object") return record.GameState;
  }
  return null;
}

function playerDeckPaths(data, playerId){
  const init=data?.InitData||{};
  const all=init.AllCardsData||{};
  const normalZones=new Set(), specialZones=new Set();
  for(const z of init.CardZones||[]){
    if(Number(z.PlayerId)!==Number(playerId)) continue;
    if(Number(z.Type)===257) normalZones.add(Number(z.ID));
    if(Number(z.Type)===261) specialZones.add(Number(z.ID));
  }
  const gs=firstGameState(data);
  if(!gs) return [];
  const normals=[], specials=[];
  for(const card of gs.CardsStatus||[]){
    if(Number(card.OwnerId)!==Number(playerId)) continue;
    const code=all[String(card.ID)] ?? all[card.ID] ?? all[String(card.CardTextId)] ?? all[card.CardTextId];
    const path=cardCodeToPath(code);
    if(!path) continue;
    const zone=Number(card.Zone);
    if(normalZones.has(zone) && Number(card.Type)===1) normals.push(path);
    else if(specialZones.has(zone) && Number(card.Type)===2) specials.push(path);
  }
  return [...normals.slice(0,7),...specials.slice(0,3)];
}

function candidateCharIdsForPlayer(data, playerId, local){
  const top=local ? data?.CharaIds : data?.OpponentCharaIds;
  if(Array.isArray(top) && top.length) return top.slice(0,3).map(Number).filter(Number.isFinite);
  const pd=(data?.InitData?.PlayersData||[]).find(x=>Number(x.ID)===Number(playerId));
  return Array.isArray(pd?.CharaIds) ? pd.CharaIds.slice(0,3).map(Number).filter(Number.isFinite) : [];
}

function selectedCharIdsForPlayer(data, playerId){
  const pd=(data?.InitData?.PlayersData||[]).find(x=>Number(x.ID)===Number(playerId));
  return Array.isArray(pd?.CharaIds) ? pd.CharaIds.slice(0,3).map(Number).filter(Number.isFinite) : [];
}

function orderedCharSelection(data, playerId, local){
  const candidates=candidateCharIdsForPlayer(data,playerId,local);
  const selected=selectedCharIdsForPlayer(data,playerId);
  if(!selected.length) return {candidates,selected:[],banned:[]};
  const selectedSet=new Set(selected);
  const kept=candidates.filter(id=>selectedSet.has(id));
  const banned=candidates.filter(id=>!selectedSet.has(id));
  return {candidates:[...kept,...banned],selected:kept,banned};
}

function baseCandidates(base, tarotData){
  if(!base) return [];
  if(base==="yukihi_a") return tarotData.filter(t=>t?.name==="yukihi_a" || t?.name==="yukihi_a1");
  if(base==="innealra_nornir_1") return tarotData.filter(t=>String(t?.name||"").startsWith("innealra_nornir_"));
  return tarotData.filter(t=>t?.name===base || String(t?.name||"").startsWith(base+"_"));
}

function inferTarotName(base, deckPaths, tarotData){
  const candidates=baseCandidates(base,tarotData);
  if(!candidates.length) return base;
  let best=candidates[0], bestScore=-1;
  const deck=new Set(deckPaths||[]);
  for(const t of candidates){
    let score=0;
    for(const p of t.cards||[]) if(deck.has(p)) score++;
    if(score>bestScore){ best=t; bestScore=score; }
  }
  return best?.name || base;
}

function resultKind(data){
  if(data?.IsDraw || data?.IsInterrupted) return "other";
  if(data?.Result===true) return "win";
  if(data?.Result===false) return "loss";
  return "other";
}

function tarotNamesForIds(ids,deckPaths,tarotData){
  return (ids||[])
    .map(id=>inferTarotName(CHAR_ID_TO_BASE[id]||String(id),deckPaths,tarotData))
    .filter(Boolean);
}

export function extractReplayFormData(data, tarotData){
  const localId=Number(data?.LocalPlayerId)||1;
  const oppId=localId===1?2:1;
  const myDeckPaths=playerDeckPaths(data,localId);
  const oppDeckPaths=playerDeckPaths(data,oppId);
  const mySelection=orderedCharSelection(data,localId,true);
  const oppSelection=orderedCharSelection(data,oppId,false);

  const myTarotNames=tarotNamesForIds(mySelection.candidates,myDeckPaths,tarotData);
  const oppTarotNames=tarotNamesForIds(oppSelection.candidates,oppDeckPaths,tarotData);
  const mySelectedTarotNames=tarotNamesForIds(mySelection.selected,myDeckPaths,tarotData);
  const oppSelectedTarotNames=tarotNamesForIds(oppSelection.selected,oppDeckPaths,tarotData);

  return {
    myTarotNames,
    oppTarotNames,
    mySelectedTarotNames,
    oppSelectedTarotNames,
    myBannedCharIds:mySelection.banned,
    oppBannedCharIds:oppSelection.banned,
    myDeckPaths,
    oppDeckPaths,
    resultKind:resultKind(data)
  };
}
