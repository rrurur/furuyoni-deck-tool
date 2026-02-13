import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,

} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { firebaseConfig } from "./firebaseConfig.js";

/* （未使用でもOK：将来の保存先用） */
const baseFolder = "S10-1";

/* =========================================================
   シーズン（ここだけ手動で更新しやすい）
========================================================= */
const CURRENT_SEASON = "10-2";
const PAST_SEASONS = ["10-1", "10-0"];

/* ---------------- Firebase ---------------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------------- 永続化（ローカル） ---------------- */
const LS_KEY = "decktool_prefs_v8";
const DEFAULT_PREFS = {
  handle: "",
  matchType: "origin",
  myPicksByMode: { origin: [], complete: [], paradox: [] }
};

function loadLocalPrefs(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_PREFS);
    const obj = JSON.parse(raw);
    return {
      handle: typeof obj.handle === "string" ? obj.handle : "",
      matchType: ["origin","complete","paradox"].includes(obj.matchType) ? obj.matchType : "origin",
      myPicksByMode: {
        origin: Array.isArray(obj?.myPicksByMode?.origin) ? obj.myPicksByMode.origin : [],
        complete: Array.isArray(obj?.myPicksByMode?.complete) ? obj.myPicksByMode.complete : [],
        paradox: Array.isArray(obj?.myPicksByMode?.paradox) ? obj.myPicksByMode.paradox : []
      }
    };
  }catch{
    return structuredClone(DEFAULT_PREFS);
  }
}
function saveLocalPrefs(p){
  localStorage.setItem(LS_KEY, JSON.stringify(p));
}
let prefs = loadLocalPrefs();

/* ---------------- 匿名時の履歴保存（Firestoreを触らない） ---------------- */
const LS_PLAYS_KEY = "decktool_local_plays_v1";
function loadLocalPlays(){
  try{
    const raw = localStorage.getItem(LS_PLAYS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}
function saveLocalPlays(arr){
  try{
    localStorage.setItem(LS_PLAYS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
  }catch{}
}
function makeLocalId(){
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function isCloudUser(user){
  return !!(user && !user.isAnonymous);
}

/* ---------------- 状態 ---------------- */
let tarotData = [];
let tarotIndexByName = new Map();
let cardIdByPath = new Map();
let cardPathById = [];

let matchType = prefs.matchType || "origin";
const MAX_PICK = 3;

let mySelected = [];
let oppSelected = [];

const deckSlots = Array(10).fill(null);

let recordKind = "win"; // win / loss / other
let userPlays = []; // {id, createdAtMs, matchTypeNum, resultTypeNum, season, myTarotIdx, oppTarotIdx, deckName, memo, cardIds}

// ---- 履歴ホバー/編集 ----
let editingPlayId = null;  // nullなら通常、セットされている間は「保存」で上書き
let hoverSnapshot = null;  // ホバー前の左デッキ状態退避
let handlePrompted = false;

/* ---------------- DOM ---------------- */
const elMatchToggle = document.getElementById("matchToggle");
const elRuleStatsLine = document.getElementById("ruleStatsLine");
const elDownloadBtn = document.getElementById("downloadBtn");

const elMyTarotList = document.getElementById("myTarotList");
const elMySelectedSlots = document.getElementById("mySelectedSlots");
const elPairStatLine = document.getElementById("pairStatLine");

const elOppTarotList = document.getElementById("oppTarotList");
const elOppSelectedSlots = document.getElementById("oppSelectedSlots");

const elCardContainer = document.getElementById("cardContainer");
const elCardPreview = document.getElementById("preview-image");

const elDeck = document.getElementById("deck");
const elDeckName = document.getElementById("deckName");
const elMemo = document.getElementById("deckMemo");
const elAnonName = document.getElementById("anonName");

const elAuthIdText = document.getElementById("authIdText");
const elLoginBtn = document.getElementById("loginBtn");
const elSaveBtn = document.getElementById("saveBtn");
const elResetBtn = document.getElementById("resetBtn");
const elRearrangeBtn = document.getElementById("rearrangeBtn");

const elResultToggle = document.getElementById("resultToggle");

const elFilterPeriod = document.getElementById("filterPeriod");
const elFilterMatchType = document.getElementById("filterMatchType");
const elFilterSeason = document.getElementById("filterSeason");

const elHistoryCanvas = document.getElementById("historyCanvas");
const elHistoryList = document.getElementById("historyList");

/* ---------------- ユーティリティ ---------------- */
function pct(n, d, fallback=0){
  if (!d || d <= 0) return fallback;
  return Math.round((n / d) * 100);
}

function normalizeHandle(v){
  return (v || "").trim().replace(/^@+/, "");
}

function getTarotNo(tarot){
  const m = String(tarot?.img || "").match(/tarot_(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

function displayName(tarot){
  return String(tarot?.weapon || tarot?.name || "");
}
function displayNameByIdx(idx){
  const t = tarotData[idx];
  return displayName(t) || String(idx);
}

function matchTypeToRange(type){
  if (type === "origin") return [1, 12];
  if (type === "paradox") return [13, 26];
  return [1, 26];
}
function filteredTarots(){
  const [lo, hi] = matchTypeToRange(matchType);
  return tarotData.filter(t => {
    const n = getTarotNo(t);
    return n >= lo && n <= hi;
  });
}
function findIndexByName(arr, name){
  return arr.findIndex(t => t && t.name === name);
}
function compact(arr){
  return arr.filter(Boolean);
}
function updateMatchUI(){
  if (!elMatchToggle) return;
  [...elMatchToggle.querySelectorAll(".pill")].forEach(p => {
    p.classList.toggle("active", p.dataset.type === matchType);
  });
}

/* ---------------- ログイン表示（右上） ---------------- */
function updateAuthBar(user){
  const logged = isCloudUser(user);

  if (elLoginBtn){
    elLoginBtn.style.display = logged ? "none" : "inline-flex";
  }
  if (!elAuthIdText) return;

  if (!logged){
    elAuthIdText.textContent = "";
    return;
  }

  const h = normalizeHandle(prefs.handle);
  elAuthIdText.textContent = h ? `@${h}` : "@未設定";
}

function syncHandleToInput(){
  if (!elAnonName) return;
  elAnonName.value = normalizeHandle(prefs.handle);
}

/* ---------------- 実行状態のリセット（ログイン時にリセットするもの） ---------------- */
function resetRunState(){
  if (elDeckName) elDeckName.value = "";
  if (elMemo) elMemo.value = "";
  oppSelected = [];
  deckSlots.fill(null);

  if (elCardPreview){
    elCardPreview.src = "";
    elCardPreview.alt = "";
    elCardPreview.style.background = "transparent";
  }

  editingPlayId = null;
  hoverSnapshot = null;
}

/* ---------------- Firebase: ユーザードック（失敗しても継続） ---------------- */
async function safeGetUserDoc(uid){
  try{
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }catch{
    return null;
  }
}
async function safeSetUserDoc(uid, data){
  try{
    const ref = doc(db, "users", uid);
    await setDoc(ref, data, { merge: true });
  }catch{}
}

/* ---------------- 永続化（ローカル＋ログイン時のみFirestore） ---------------- */
function persistHandle(){
  if (!elAnonName) return;
  prefs.handle = normalizeHandle(elAnonName.value);
  saveLocalPrefs(prefs);

  const u = auth.currentUser;
  if (isCloudUser(u)) safeSetUserDoc(u.uid, { handle: prefs.handle });

  updateAuthBar(auth.currentUser);
}

function persistMatchAndMyPicks(){
  prefs.matchType = matchType;
  prefs.myPicksByMode[matchType] = mySelected.map(t => t.name).slice(0, MAX_PICK);
  saveLocalPrefs(prefs);

  const u = auth.currentUser;
  if (isCloudUser(u)) {
    safeSetUserDoc(u.uid, {
      handle: prefs.handle,
      prefs: { matchType: prefs.matchType, myPicksByMode: prefs.myPicksByMode },
      updatedAt: serverTimestamp()
    });
  }
}
function clampMyPickToMode(){
  const ok = new Set(filteredTarots().map(t => t.name));
  mySelected = mySelected.filter(t => ok.has(t.name));
}
function clampOppPickToMode(){
  const ok = new Set(filteredTarots().map(t => t.name));
  oppSelected = oppSelected.filter(t => ok.has(t.name));
}

/* ---------------- 初回ログイン時：handle入力 ---------------- */
async function ensureHandleOnFirstLogin(user, userDoc){
  if (!isCloudUser(user)) return;

  const docHandle = normalizeHandle(userDoc?.handle);
  const localHandle = normalizeHandle(prefs.handle);

  // すでにFirestoreにあるならそれを採用
  if (docHandle){
    if (docHandle !== localHandle){
      prefs.handle = docHandle;
      saveLocalPrefs(prefs);
    }
    return;
  }

  // Firestoreに無いがローカルにあるなら、それを紐付け（ポップアップ不要）
  if (localHandle){
    await safeSetUserDoc(user.uid, { handle: localHandle });
    return;
  }

  // 両方無い＝初回 → ポップアップ
  if (handlePrompted) return;
  handlePrompted = true;

  const def = normalizeHandle(user.displayName || "");
  while (true){
    const raw = prompt("初回ログイン：アカウント名(@)を入力してください（Gmailは表示に使いません）", def);
    if (raw === null) break;
    const h = normalizeHandle(raw);
    if (!h) { alert("空欄は不可です。"); continue; }
    prefs.handle = h;
    saveLocalPrefs(prefs);
    await safeSetUserDoc(user.uid, { handle: h });
    break;
  }
}

/* ---------------- 認証 ---------------- */
async function initAuth(){
  onAuthStateChanged(auth, async (user) => {
    updateAuthBar(user);

    if (!user) {
      try { await signInAnonymously(auth); } catch(e){ console.error(e); }
      return;
    }

    // 匿名（未ログイン扱い）：右上はログインボタン、履歴はローカル
    if (!isCloudUser(user)){
      syncHandleToInput();

      matchType = prefs.matchType || "origin";
      updateMatchUI();

      const names = prefs.myPicksByMode[matchType] || [];
      mySelected = names.map(n => tarotData.find(t => t.name === n)).filter(Boolean).slice(0, MAX_PICK);
      clampMyPickToMode();

      resetRunState();
      userPlays = loadLocalPlays().slice().sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0));
      renderAll();
      return;
    }

    // ログイン済み：ユーザードック取得→初回handle設定→同期
    const data = await safeGetUserDoc(user.uid);
    await ensureHandleOnFirstLogin(user, data);

    // prefs の反映（prefsがdocにあれば優先）
    if (data?.prefs?.matchType && data?.prefs?.myPicksByMode) {
      const mt = data.prefs.matchType;
      if (["origin","complete","paradox"].includes(mt)) prefs.matchType = mt;

      const mp = data.prefs.myPicksByMode;
      prefs.myPicksByMode = {
        origin: Array.isArray(mp.origin) ? mp.origin : [],
        complete: Array.isArray(mp.complete) ? mp.complete : [],
        paradox: Array.isArray(mp.paradox) ? mp.paradox : []
      };
    }

    // handleはFirestore優先（ensureHandleで入ってる可能性もある）
    const data2 = await safeGetUserDoc(user.uid);
    if (normalizeHandle(data2?.handle)) prefs.handle = normalizeHandle(data2.handle);

    saveLocalPrefs(prefs);
    syncHandleToInput();
    updateAuthBar(user);

    matchType = prefs.matchType || "origin";
    updateMatchUI();

    const names = prefs.myPicksByMode[matchType] || [];
    mySelected = names.map(n => tarotData.find(t => t.name === n)).filter(Boolean).slice(0, MAX_PICK);
    clampMyPickToMode();

    resetRunState();
    await refreshUserPlays();

    renderAll();
    persistMatchAndMyPicks();
  });
}

async function doLogin(){
  const provider = new GoogleAuthProvider();
  try{
    await signInWithPopup(auth, provider);
    // UI更新は onAuthStateChanged 側でOK
  }catch(e){
    console.error(e);
  }
}

/* ---------------- 対戦形式 ---------------- */
function setMatchType(type){
  if (!["origin","complete","paradox"].includes(type)) return;
  if (type === matchType) return;

  persistMatchAndMyPicks();

  matchType = type;
  updateMatchUI();

  const names = prefs.myPicksByMode[matchType] || [];
  mySelected = names.map(n => tarotData.find(t => t.name === n)).filter(Boolean).slice(0, MAX_PICK);
  clampMyPickToMode();

  resetRunState();
  persistMatchAndMyPicks();

  renderAll();
}

/* ---------------- タロット一覧（左） ---------------- */
function renderTarotList(container, selectedArr, onToggle){
  if (!container) return;
  container.innerHTML = "";
  filteredTarots().forEach(t => {
    const img = document.createElement("img");
    img.src = t.img;
    img.alt = displayName(t);
    if (findIndexByName(selectedArr, t.name) >= 0) img.classList.add("selected");
    img.addEventListener("click", () => onToggle(t));
    container.appendChild(img);
  });
}

/* ---------------- 選択枠（右） ---------------- */
function renderSelectedSlots(container, selectedArr, onRemoveAt, onSwapOrMove){
  if (!container) return;
  container.innerHTML = "";

  const count = selectedArr.length;
  container.classList.toggle("has-selection", count > 0);
  if (count === 0) return;

  const inner = document.createElement("div");
  inner.className = "selected-slots-inner";

  for (let i = 0; i < count; i++) {
    const slot = document.createElement("div");
    slot.className = "sel-slot";
    slot.dataset.index = String(i);

    if (count === 3 && i === 2) slot.classList.add("disabled");

    const tarot = selectedArr[i];
    const img = document.createElement("img");

    img.src = tarot.img;
    img.alt = displayName(tarot);

    img.draggable = true;

    img.addEventListener("click", () => onRemoveAt(i));

    img.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("fromIndex", String(i));
      ev.dataTransfer.effectAllowed = "move";
    });

    slot.appendChild(img);

    slot.addEventListener("dragover", (e) => e.preventDefault());
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      const fromStr = e.dataTransfer.getData("fromIndex");
      if (!fromStr) return;
      const from = parseInt(fromStr, 10);
      const to = i;
      if (Number.isNaN(from) || Number.isNaN(to)) return;
      onSwapOrMove(from, to);
    });

    inner.appendChild(slot);
  }

  container.appendChild(inner);
}

/* ---------------- 選択ロジック ---------------- */
function togglePick(arr, tarot){
  const idx = findIndexByName(arr, tarot.name);
  if (idx >= 0) {
    arr.splice(idx, 1);
    return compact(arr);
  }
  if (arr.length >= MAX_PICK) return arr;
  arr.push(tarot);
  return arr;
}
function removeAt(arr, idx){
  arr.splice(idx, 1);
  return compact(arr);
}
function swapOrMove(arr, from, to){
  if (from === to) return arr;
  const a = arr[from] || null;
  const b = arr[to] || null;
  if (!a) return arr;
  arr[to] = a;
  arr[from] = b;
  return arr;
}

/* ---------------- カード一覧（自分の左2人だけ、各キャラは横一列） ---------------- */
function renderCards(){
  if (!elCardContainer) return;
  elCardContainer.innerHTML = "";

  const targets = mySelected.slice(0, 2);
  targets.forEach(tarot => {
    const row = document.createElement("div");
    row.className = "card-row";

    const normals = (tarot.cards || []).filter(p => !p.includes("_s_"));
    const trumps  = (tarot.cards || []).filter(p =>  p.includes("_s_"));

    [...normals, ...trumps].forEach(cardPath => {
      const img = document.createElement("img");
      img.src = cardPath;
      img.alt = cardPath;

      if (deckSlots.includes(cardPath)) img.classList.add("in-deck");

      img.addEventListener("click", () => {
        if (elCardPreview){
          elCardPreview.src = cardPath;
          elCardPreview.alt = cardPath;
          elCardPreview.style.background = "#fff";
        }

        if (deckSlots.includes(cardPath)) removeCardFromDeck(cardPath);
        else addCardToDeck(cardPath);

        renderDeck();
        renderCards();
      });

      row.appendChild(img);
    });

    elCardContainer.appendChild(row);
  });
}

/* ---------------- デッキ ---------------- */
function setupDeck(){
  if (!elDeck) return;
  elDeck.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const slot = document.createElement("div");
    slot.className = "deck-slot";
    slot.dataset.index = String(i);

    slot.addEventListener("dragover", (e) => e.preventDefault());
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      const fromStr = e.dataTransfer.getData("fromIndex");
      if (!fromStr) return;
      const from = parseInt(fromStr, 10);
      const to = i;
      if (Number.isNaN(from) || Number.isNaN(to)) return;

      const fromIsTrump = from >= 7;
      const toIsTrump = to >= 7;
      if (fromIsTrump !== toIsTrump) return;

      const tmp = deckSlots[to];
      deckSlots[to] = deckSlots[from];
      deckSlots[from] = tmp;

      renderDeck();
      renderCards();
    });

    elDeck.appendChild(slot);
  }
  renderDeck();
}
function renderDeck(){
  if (!elDeck) return;
  const slots = elDeck.querySelectorAll(".deck-slot");
  slots.forEach((slotEl, i) => {
    slotEl.innerHTML = "";
    const cardPath = deckSlots[i];
    if (!cardPath) return;

    const img = document.createElement("img");
    img.src = cardPath;
    img.alt = cardPath;
    img.draggable = true;

    img.addEventListener("click", () => {
      removeCardFromDeck(cardPath);
      renderDeck();
      renderCards();
    });

    img.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("fromIndex", String(i));
      ev.dataTransfer.effectAllowed = "move";
    });

    slotEl.appendChild(img);
  });
}
function isTrumpCard(cardPath){
  return String(cardPath).includes("_s_");
}
function addCardToDeck(cardPath){
  if (deckSlots.includes(cardPath)) return;

  const trump = isTrumpCard(cardPath);
  if (trump) {
    for (let i = 7; i <= 9; i++) {
      if (!deckSlots[i]) { deckSlots[i] = cardPath; return; }
    }
  } else {
    for (let i = 0; i <= 6; i++) {
      if (!deckSlots[i]) { deckSlots[i] = cardPath; return; }
    }
  }
}
function removeCardFromDeck(cardPath){
  for (let i = 0; i < deckSlots.length; i++) {
    if (deckSlots[i] === cardPath) { deckSlots[i] = null; break; }
  }
}

/* 再配置 */
function parseCardKey(cardPath){
  const s = String(cardPath);
  const mChar = s.match(/na_(\d+)_/);
  const charNo = mChar ? parseInt(mChar[1], 10) : 999;

  const mType = s.match(/_(n|s)_([0-9]+)/);
  const type = mType ? mType[1] : "n";
  const num = mType ? parseInt(mType[2], 10) : 999;

  const typeOrder = (type === "n") ? 0 : 1;
  return [charNo, typeOrder, num];
}
function deckRearrange(){
  const normals = [];
  const trumps = [];
  for (let i = 0; i < 10; i++) {
    const p = deckSlots[i];
    if (!p) continue;
    (isTrumpCard(p) ? trumps : normals).push(p);
  }
  normals.sort((a,b)=>{
    const ka=parseCardKey(a), kb=parseCardKey(b);
    for (let i=0;i<3;i++){ if (ka[i]!==kb[i]) return ka[i]-kb[i]; }
    return 0;
  });
  trumps.sort((a,b)=>{
    const ka=parseCardKey(a), kb=parseCardKey(b);
    for (let i=0;i<3;i++){ if (ka[i]!==kb[i]) return ka[i]-kb[i]; }
    return 0;
  });

  deckSlots.fill(null);
  for (let i = 0; i < 7; i++) deckSlots[i] = normals[i] || null;
  for (let i = 0; i < 3; i++) deckSlots[7+i] = trumps[i] || null;

  renderDeck();
  renderCards();
}
function deckReset(){
  deckSlots.fill(null);
  renderDeck();
  renderCards();
}

/* ---------------- PNG出力 ---------------- */
function safeFilename(s){
  const name = (s || "").trim() || "deck";
  return name.replace(/[\\\/:*?"<>|]/g, "_").slice(0, 60);
}
function loadImg(src){
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("image load failed: " + src));
    im.src = src;
  });
}
async function exportDeckPng(){
  try{
    const cols = 5, rows = 2;

    const slotW = 240;
    const slotH = 336;

    const gap = 12;
    const pad = 18;
    const scale = 2;

    const w = pad * 2 + cols * slotW + (cols - 1) * gap;
    const h = pad * 2 + rows * slotH + (rows - 1) * gap;

    const canvas = document.createElement("canvas");
    canvas.width  = Math.floor(w * scale);
    canvas.height = Math.floor(h * scale);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++){
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = pad + c * (slotW + gap);
      const y = pad + r * (slotH + gap);
      ctx.strokeRect(x, y, slotW, slotH);
    }

    const tasks = [];
    for (let i = 0; i < 10; i++){
      const p = deckSlots[i];
      if (!p) continue;
      tasks.push(loadImg(p).then(img => ({ i, img })).catch(() => null));
    }
    const loaded = (await Promise.all(tasks)).filter(Boolean);

    for (const it of loaded){
      const i = it.i;
      const img = it.img;

      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = pad + c * (slotW + gap);
      const y = pad + r * (slotH + gap);

      const s = Math.min(slotW / img.width, slotH / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      const dx = x + (slotW - dw) / 2;
      const dy = y + (slotH - dh) / 2;

      ctx.drawImage(img, dx, dy, dw, dh);
    }

    const dn = safeFilename(elDeckName?.value);
    const stamp = new Date();
    const y = stamp.getFullYear();
    const mo = String(stamp.getMonth() + 1).padStart(2, "0");
    const da = String(stamp.getDate()).padStart(2, "0");
    const hh = String(stamp.getHours()).padStart(2, "0");
    const mm = String(stamp.getMinutes()).padStart(2, "0");
    const ss = String(stamp.getSeconds()).padStart(2, "0");

    const a = document.createElement("a");
    a.download = `${dn}_${y}${mo}${da}_${hh}${mm}${ss}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }catch(e){
    console.error(e);
    alert("PNG出力に失敗しました（画像パス/配置を確認してください）");
  }
}

/* ---------------- IDマップ ---------------- */
function buildIdMaps(){
  tarotIndexByName = new Map();
  tarotData.forEach((t, idx) => tarotIndexByName.set(t.name, idx));

  const all = [];
  tarotData.forEach(t => (t.cards || []).forEach(p => all.push(p)));

  const uniq = [];
  const seen = new Set();
  for (const p of all) {
    if (seen.has(p)) continue;
    seen.add(p);
    uniq.push(p);
  }

  cardIdByPath = new Map();
  cardPathById = uniq.slice();
  uniq.forEach((p, i) => cardIdByPath.set(p, i));
}

/* ---------------- 勝敗他トグル ---------------- */
function setRecordKind(kind){
  recordKind = kind;
  if (!elResultToggle) return;
  const btns = [...elResultToggle.querySelectorAll("button[data-result]")];
  btns.forEach(b => b.classList.toggle("active", b.dataset.result === kind));
}

/* ---------------- 保存（履歴にも使う） ---------------- */
function matchTypeId(type){
  if (type === "origin") return 0;
  if (type === "complete") return 1;
  return 2;
}
function matchTypeFromId(num){
  if (num === 0) return "origin";
  if (num === 1) return "complete";
  return "paradox";
}
function resultTypeId(kind){
  if (kind === "win") return 0;
  if (kind === "loss") return 1;
  return 2;
}
function resultKindFromId(num){
  if (num === 0) return "win";
  if (num === 1) return "loss";
  return "other";
}
function resultLabel(num){
  if (num === 0) return "勝";
  if (num === 1) return "敗";
  return "他";
}

/* ---------------- 履歴ホバー/編集：適用 ---------------- */
function snapshotLeft(){
  return {
    deckName: elDeckName ? elDeckName.value : "",
    memo: elMemo ? elMemo.value : "",
    deckSlots: deckSlots.slice(),
    previewSrc: elCardPreview ? elCardPreview.src : "",
    previewAlt: elCardPreview ? elCardPreview.alt : "",
    previewBg: elCardPreview ? elCardPreview.style.background : "transparent"
  };
}
function restoreLeft(s){
  if (!s) return;
  if (elDeckName) elDeckName.value = s.deckName || "";
  if (elMemo) elMemo.value = s.memo || "";
  for (let i=0;i<10;i++) deckSlots[i] = s.deckSlots[i] || null;
  if (elCardPreview){
    elCardPreview.src = s.previewSrc || "";
    elCardPreview.alt = s.previewAlt || "";
    elCardPreview.style.background = s.previewBg || "transparent";
  }
}
function applyDeckFromCardIds(cardIds){
  deckSlots.fill(null);
  const arr = Array.isArray(cardIds) ? cardIds : [];
  for (let i=0;i<10;i++){
    const id = arr[i];
    if (typeof id !== "number" || id < 0) { deckSlots[i] = null; continue; }
    deckSlots[i] = cardPathById[id] || null;
  }
}
function startHover(play){
  if (editingPlayId) return;
  if (!play) return;
  if (!hoverSnapshot) hoverSnapshot = snapshotLeft();

  if (elDeckName) elDeckName.value = play.deckName || "";
  if (elMemo) elMemo.value = play.memo || "";
  applyDeckFromCardIds(play.cardIds);

  renderDeck();
  renderCards();
}
function endHover(){
  if (editingPlayId) return;
  if (!hoverSnapshot) return;

  restoreLeft(hoverSnapshot);
  hoverSnapshot = null;

  renderDeck();
  renderCards();
}
function beginEdit(play){
  if (!play) return;
  hoverSnapshot = null;
  editingPlayId = play.id;

  matchType = matchTypeFromId(play.matchTypeNum);
  updateMatchUI();

  setRecordKind(resultKindFromId(play.resultTypeNum));

  mySelected = (Array.isArray(play.myTarotIdx)? play.myTarotIdx: [])
    .map(i => tarotData[i]).filter(Boolean).slice(0, MAX_PICK);
  oppSelected = (Array.isArray(play.oppTarotIdx)? play.oppTarotIdx: [])
    .map(i => tarotData[i]).filter(Boolean).slice(0, MAX_PICK);

  clampMyPickToMode();
  clampOppPickToMode();

  if (elDeckName) elDeckName.value = play.deckName || "";
  if (elMemo) elMemo.value = play.memo || "";
  applyDeckFromCardIds(play.cardIds);

  if (elCardPreview){
    elCardPreview.src = "";
    elCardPreview.alt = "";
    elCardPreview.style.background = "transparent";
  }

  persistMatchAndMyPicks();
  renderAll();
}

/* ---------------- 保存（匿名はローカル、ログイン時はFirestore） ---------------- */
async function saveDeck(){
  const deckName = (elDeckName ? elDeckName.value : "").trim();
  const memo = (elMemo ? elMemo.value : "").trim();
  const season = CURRENT_SEASON;

  const cardIds = deckSlots.map(p => {
    if (!p) return -1;
    const id = cardIdByPath.get(p);
    return (typeof id === "number") ? id : -1;
  });

  const myTarotIdx = mySelected.map(t => tarotIndexByName.get(t.name)).filter(n => typeof n === "number");
  const oppTarotIdx = oppSelected.map(t => tarotIndexByName.get(t.name)).filter(n => typeof n === "number");

  const basePayload = {
    matchType: matchTypeId(matchType),
    resultType: resultTypeId(recordKind),
    season,
    deckName,
    memo,
    myTarotIdx,
    oppTarotIdx,
    cardIds,
    updatedAtMs: Date.now()
  };

  const u = auth.currentUser;

  // 匿名（未ログイン扱い）ならローカル保存
  if (!isCloudUser(u)){
    const nowMs = Date.now();
    if (editingPlayId){
      const i = userPlays.findIndex(p => p.id === editingPlayId);
      if (i >= 0){
        userPlays[i] = { ...userPlays[i], ...basePayload };
      }
      editingPlayId = null;
    } else {
      userPlays.unshift({
        id: makeLocalId(),
        createdAtMs: nowMs,
        matchTypeNum: basePayload.matchType,
        resultTypeNum: basePayload.resultType,
        season,
        myTarotIdx,
        oppTarotIdx,
        deckName,
        memo,
        cardIds
      });
    }
    saveLocalPlays(userPlays);
    renderRightStatsAndHistory();
    return;
  }

  // ログイン済みはFirestore
  const cloudPayload = {
    matchType: basePayload.matchType,
    resultType: basePayload.resultType,
    season,
    deckName,
    memo,
    myTarotIdx,
    oppTarotIdx,
    cardIds,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now()
  };

  try {
    if (editingPlayId) {
      await updateDoc(doc(db, "decks", editingPlayId), cloudPayload);
      editingPlayId = null;
    } else {
      await addDoc(collection(db, "decks"), {
        ...cloudPayload,
        ownerUid: auth.currentUser.uid,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
        likeCount: 0,  
 
      });
    }
  } catch (e) {
    console.error(e);
    return;
  }

  await refreshUserPlays();
  renderRightStatsAndHistory();
}

/* ---------------- 履歴の取得（doc id も保持） ---------------- */
async function refreshUserPlays(){
  const u = auth.currentUser;

  if (!isCloudUser(u)){
    userPlays = loadLocalPlays().slice().sort((a,b) => (b.createdAtMs||0)-(a.createdAtMs||0));
    return;
  }

  userPlays = [];
  if (!u) return;

  try{
    const qy = query(collection(db, "decks"), where("ownerUid", "==", u.uid));
    const snap = await getDocs(qy);

    const rows = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();

      const mt = typeof d.matchType === "number" ? d.matchType : null;
      const rt = typeof d.resultType === "number" ? d.resultType : null;
      const season = typeof d.season === "string" ? d.season : "";

      let ms = 0;
      if (typeof d.createdAtMs === "number") ms = d.createdAtMs;
      else if (d.createdAt && typeof d.createdAt.toMillis === "function") ms = d.createdAt.toMillis();

      rows.push({
        id: docSnap.id,
        createdAtMs: ms,
        matchTypeNum: mt,
        resultTypeNum: rt,
        season,
        myTarotIdx: Array.isArray(d.myTarotIdx) ? d.myTarotIdx : [],
        oppTarotIdx: Array.isArray(d.oppTarotIdx) ? d.oppTarotIdx : [],
        deckName: typeof d.deckName === "string" ? d.deckName : "",
        memo: typeof d.memo === "string" ? d.memo : "",
        cardIds: Array.isArray(d.cardIds) ? d.cardIds.map(n => (typeof n==="number"? n : -1)) : Array(10).fill(-1)
      });
    });

    rows.sort((a,b) => (b.createdAtMs||0) - (a.createdAtMs||0));
    userPlays = rows;

  }catch(e){
    console.warn("history read skipped:", e?.code || e);
    userPlays = [];
  }
}

async function deletePlay(playId){
  if (!playId) return;

  const u = auth.currentUser;

  // 匿名はローカル削除
  if (!isCloudUser(u)){
    if (editingPlayId === playId) editingPlayId = null;
    userPlays = userPlays.filter(p => p.id !== playId);
    saveLocalPlays(userPlays);
    renderRightStatsAndHistory();
    return;
  }

  try{
    await deleteDoc(doc(db, "decks", playId));
  }catch(e){
    console.error("delete failed:", e);
    return;
  }
  if (editingPlayId === playId) editingPlayId = null;
  userPlays = userPlays.filter(p => p.id !== playId);
  renderRightStatsAndHistory();
}

/* ---------------- フィルタ（期間/方式/シーズン） ---------------- */
function periodToMs(v){
  const day = 24*60*60*1000;
  if (v === "1d") return 1*day;
  if (v === "1w") return 7*day;
  if (v === "1m") return 30*day;
  if (v === "3m") return 90*day;
  if (v === "1y") return 365*day;
  return null;
}

function filterBaseByPeriodAndSeason(){
  const now = Date.now();
  const dur = periodToMs(elFilterPeriod ? elFilterPeriod.value : "1d");
  const seasonSel = (elFilterSeason ? elFilterSeason.value : "all") || "all";

  return userPlays.filter(p => {
    if (seasonSel !== "all") {
      if (!p.season || p.season !== seasonSel) return false;
    }
    if (dur) {
      if (!p.createdAtMs) return false;
      if (p.createdAtMs < (now - dur)) return false;
    }
    return true;
  });
}

function filterForRuleStats(){
  return filterBaseByPeriodAndSeason().filter(p => p.resultTypeNum === 0 || p.resultTypeNum === 1);
}

function filterForPairStat(){
  const mtNum = matchTypeId(matchType);
  return filterBaseByPeriodAndSeason().filter(p =>
    (p.resultTypeNum === 0 || p.resultTypeNum === 1) && p.matchTypeNum === mtNum
  );
}

function filterForChart(){
  const base = filterBaseByPeriodAndSeason();
  const mt = elFilterMatchType ? elFilterMatchType.value : "all";
  const mtNum = (mt === "origin") ? 0 : (mt === "complete") ? 1 : (mt === "paradox") ? 2 : null;

  return base.filter(p => {
    if (p.resultTypeNum !== 0 && p.resultTypeNum !== 1) return false;
    if (mtNum === null) return true;
    return p.matchTypeNum === mtNum;
  });
}

/* ---------------- 右上：ルール統計 ---------------- */
function updateRuleStatsLine(){
  if (!elRuleStatsLine) return;
  const plays = filterForRuleStats();
  const total = plays.length;

  const by = {
    0: {w:0,l:0,t:0},
    1: {w:0,l:0,t:0},
    2: {w:0,l:0,t:0}
  };

  for (const p of plays) {
    const k = (p.matchTypeNum === 0 || p.matchTypeNum === 1 || p.matchTypeNum === 2) ? p.matchTypeNum : null;
    if (k === null) continue;
    by[k].t++;
    if (p.resultTypeNum === 0) by[k].w++;
    if (p.resultTypeNum === 1) by[k].l++;
  }

  const sel0 = pct(by[0].t, total, 0);
  const sel1 = pct(by[1].t, total, 0);
  const sel2 = pct(by[2].t, total, 0);

  const wr0 = pct(by[0].w, by[0].w + by[0].l, 50);
  const wr1 = pct(by[1].w, by[1].w + by[1].l, 50);
  const wr2 = pct(by[2].w, by[2].w + by[2].l, 50);

  elRuleStatsLine.textContent = "";

  const mk = (label, sel, wr) => {
    const s = document.createElement("span");
    s.textContent = `${label} ${sel}% 勝率${wr}%`;
    return s;
  };

  elRuleStatsLine.appendChild(mk("起源戦", sel0, wr0));
  elRuleStatsLine.appendChild(mk("完全戦", sel1, wr1));
  elRuleStatsLine.appendChild(mk("逆理戦", sel2, wr2));
}

/* ---------------- 右：ペア統計 ---------------- */
function updatePairStatLine(){
  if (!elPairStatLine) return;
  elPairStatLine.innerHTML = "";

  const idxs = mySelected
    .map(t => tarotIndexByName.get(t.name))
    .filter(n => typeof n === "number");

  if (idxs.length < 2) return;

  idxs.sort((i1, i2) => getTarotNo(tarotData[i1]) - getTarotNo(tarotData[i2]));

  const plays = filterForPairStat();
  const total = plays.length;

  const pairs = [];
  if (idxs.length >= 3) {
    const A = idxs[0], B = idxs[1], C = idxs[2];
    pairs.push([A,B], [B,C], [A,C]);
  } else {
    pairs.push([idxs[0], idxs[1]]);
  }

  for (const [A, B] of pairs) {
    let t=0, w=0, l=0;
    for (const p of plays) {
      const s = new Set(p.myTarotIdx || []);
      if (s.has(A) && s.has(B)) {
        t++;
        if (p.resultTypeNum === 0) w++;
        if (p.resultTypeNum === 1) l++;
      }
    }

    const use = pct(t, total, 0);
    const wr  = pct(w, w + l, 0);

    const nameA = displayNameByIdx(A);
    const nameB = displayNameByIdx(B);

    const div = document.createElement("div");
    div.className = "pair-row";
    div.textContent = `${nameA}${nameB} 使用率${use}% 勝率${wr}%`;
    elPairStatLine.appendChild(div);
  }
}

/* ---------------- 右：履歴グラフ ---------------- */
function drawHistoryChart(){
  if (!elHistoryCanvas) return;

  const playsRaw = filterForChart();
  const canvas = elHistoryCanvas;
  const wrap = canvas.parentElement;

  const cssW = Math.max(200, wrap ? wrap.clientWidth : 400);
  const cssH = Math.max(180, wrap ? wrap.clientHeight : 240);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);

  const padL = 38, padR = 12, padT = 12, padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.font = "12px system-ui";
  ctx.fillText("勝率(%)", 4, padT + 12);

  const ticksY = [0,50,100];
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.font = "11px system-ui";
  for (const t of ticksY) {
    const y = padT + (1 - t/100) * h;
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + w, y);
    ctx.stroke();
    ctx.fillText(String(t), 10, y + 4);
  }

  const period = elFilterPeriod ? elFilterPeriod.value : "1d";

  if (period === "1d") {
    const startToday = new Date();
    startToday.setHours(0,0,0,0);
    const startT = startToday.getTime();
    const endT = Date.now();

    const plays = playsRaw
      .filter(p => (p.createdAtMs || 0) >= startT && (p.createdAtMs || 0) <= endT)
      .slice()
      .sort((a,b) => (a.createdAtMs||0) - (b.createdAtMs||0));

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.font = "12px system-ui";
    ctx.fillText("対戦回数(今日)", padL + w - 78, cssH - 8);

    if (plays.length === 0) {
      const y50 = padT + (1 - 0.5) * h;
      ctx.strokeStyle = "rgba(0,119,204,0.35)";
      ctx.beginPath();
      ctx.moveTo(padL, y50);
      ctx.lineTo(padL + w, y50);
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = "12px system-ui";
      ctx.fillText("対戦回数: 0", padL + 8, padT + 18);
      ctx.fillText("勝率: 50%", padL + 8, padT + 34);
      return;
    }

    const maxX = plays.length;
    const nx = Math.min(5, maxX);

    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = "11px system-ui";

    for (let i=0;i<nx;i++){
      const xCount = (nx === 1) ? 1 : Math.round(1 + (maxX - 1) * (i/(nx-1)));
      const x = padL + ((xCount - 1) / Math.max(1, (maxX - 1))) * w;

      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + h);
      ctx.stroke();

      ctx.fillText(String(xCount), x - 4, padT + h + 18);
    }

    function xToPxCount(xCount){
      if (maxX <= 1) return padL;
      return padL + ((xCount - 1) / (maxX - 1)) * w;
    }
    function yToPx(y){
      return padT + (1 - y/100) * h;
    }

    let wins = 0, losses = 0;
    const pts = [];
    for (let i=0; i<plays.length; i++){
      const p = plays[i];
      if (p.resultTypeNum === 0) wins++;
      if (p.resultTypeNum === 1) losses++;
      const n = wins + losses;
      const wr = n > 0 ? (wins / n) * 100 : 50;
      pts.push({ x: i+1, y: wr });
    }

    ctx.strokeStyle = "rgba(0,119,204,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i=0; i<pts.length; i++){
      const px = xToPxCount(pts[i].x);
      const py = yToPx(pts[i].y);
      if (i===0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(0,119,204,0.9)";
    for (const p of pts){
      const px = xToPxCount(p.x);
      const py = yToPx(p.y);
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI*2);
      ctx.fill();
    }
    return;
  }

  const xMode =
    (period === "1w" || period === "1m") ? "day" :
    "month";

  const xLabel = (xMode === "day") ? "日" : "月";
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.font = "12px system-ui";
  ctx.fillText(xLabel, padL + w - 18, cssH - 8);

  const now = Date.now();
  const dur = periodToMs(period);

  const plays = playsRaw
    .filter(p => (p.createdAtMs || 0) > 0)
    .slice()
    .sort((a,b) => (a.createdAtMs||0) - (b.createdAtMs||0));

  const endT = now;
  const startT = dur ? (now - dur) : (plays.length ? plays[0].createdAtMs : now);
  const span = Math.max(1, endT - startT);

  function tToPx(t){
    return padL + ((t - startT) / span) * w;
  }
  function yToPx(y){
    return padT + (1 - y/100) * h;
  }

  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.font = "11px system-ui";

  const nx = 5;
  for (let i=0;i<nx;i++){
    const t = startT + span * (i/(nx-1));
    const x = tToPx(t);

    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + h);
    ctx.stroke();

    const d = new Date(t);
    const label =
      (xMode === "day") ? `${d.getMonth()+1}/${d.getDate()}` :
      `${d.getFullYear()}/${d.getMonth()+1}`;

    ctx.fillText(label, x - 10, padT + h + 18);
  }

  if (plays.length === 0) {
    const y50 = yToPx(50);
    ctx.strokeStyle = "rgba(0,119,204,0.35)";
    ctx.beginPath();
    ctx.moveTo(padL, y50);
    ctx.lineTo(padL + w, y50);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.font = "12px system-ui";
    ctx.fillText("対戦回数: 0", padL + 8, padT + 18);
    ctx.fillText("勝率: 50%", padL + 8, padT + 34);
    return;
  }

  let wins = 0, losses = 0;
  const pts = [];
  for (const p of plays) {
    const t = p.createdAtMs || 0;
    if (t < startT || t > endT) continue;

    if (p.resultTypeNum === 0) wins++;
    if (p.resultTypeNum === 1) losses++;
    const n = wins + losses;
    const wr = n > 0 ? (wins / n) * 100 : 50;
    pts.push({ t, wr });
  }

  if (pts.length === 0) {
    const y50 = yToPx(50);
    ctx.strokeStyle = "rgba(0,119,204,0.35)";
    ctx.beginPath();
    ctx.moveTo(padL, y50);
    ctx.lineTo(padL + w, y50);
    ctx.stroke();
    return;
  }

  ctx.strokeStyle = "rgba(0,119,204,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i=0; i<pts.length; i++){
    const x = tToPx(pts[i].t);
    const y = yToPx(pts[i].wr);
    if (i===0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(0,119,204,0.9)";
  for (const p of pts){
    const x = tToPx(p.t);
    const y = yToPx(p.wr);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI*2);
    ctx.fill();
  }
}

function fmtDateTime(ms){
  const d = new Date(ms || Date.now());
  return d.toLocaleString("ja-JP", {
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit"
  });
}

/* ---------------- 右：対戦履歴（ホバーで左にプレビュー） ---------------- */
function makeNamesSpanNoSpace(idxs){
  const wrap = document.createElement("span");
  wrap.className = "names";

  const arr = (Array.isArray(idxs) ? idxs : []).slice(0,3);
  for (let i=0;i<arr.length;i++){
    const s = document.createElement("span");
    s.textContent = displayNameByIdx(arr[i]);
    if (i === 2) s.classList.add("dim");
    wrap.appendChild(s);
  }
  return wrap;
}

function renderHistoryList(){
  if (!elHistoryList) return;

  const base = filterBaseByPeriodAndSeason();
  elHistoryList.innerHTML = "";
  if (base.length === 0) return;

  for (const p of base) {
    const row = document.createElement("div");
    row.className = "hrow";

    row.addEventListener("mouseenter", () => startHover(p));
    row.addEventListener("mouseleave", () => endHover());

    const left = document.createElement("div");
    left.className = "hleft";

    left.appendChild(makeNamesSpanNoSpace(p.myTarotIdx));
    const hy = document.createElement("span");
    hy.textContent = " - ";
    left.appendChild(hy);
    left.appendChild(makeNamesSpanNoSpace(p.oppTarotIdx));

    const date = document.createElement("div");
    date.className = "hdate";
    date.textContent = fmtDateTime(p.createdAtMs);

    const right = document.createElement("div");
    right.className = "hright";

    const r = document.createElement("span");
    r.textContent = resultLabel(p.resultTypeNum);
    if (p.resultTypeNum === 0) r.classList.add("res-win");
    right.appendChild(r);

    const edit = document.createElement("button");
    edit.className = "editbtn";
    edit.type = "button";
    edit.textContent = "編集";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      beginEdit(p);
    });
    right.appendChild(edit);

    const del = document.createElement("button");
    del.className = "delbtn";
    del.type = "button";
    del.textContent = "削除";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deletePlay(p.id);
    });
    right.appendChild(del);

    row.appendChild(left);
    row.appendChild(date);
    row.appendChild(right);
    elHistoryList.appendChild(row);
  }
}

/* ---------------- 右側まとめ更新 ---------------- */
function renderRightStatsAndHistory(){
  updateRuleStatsLine();
  updatePairStatLine();
  drawHistoryChart();
  renderHistoryList();
}

/* ---------------- 全体描画 ---------------- */
function renderAll(){
  updateMatchUI();

  renderTarotList(elMyTarotList, mySelected, (tarot) => {
    mySelected = togglePick(mySelected, tarot);
    clampMyPickToMode();
    persistMatchAndMyPicks();
    renderAll();
  });

  renderTarotList(elOppTarotList, oppSelected, (tarot) => {
    oppSelected = togglePick(oppSelected, tarot);
    clampOppPickToMode();
    renderAll();
  });

  renderSelectedSlots(
    elMySelectedSlots,
    mySelected,
    (idx) => {
      mySelected = removeAt(mySelected, idx);
      clampMyPickToMode();
      persistMatchAndMyPicks();
      renderAll();
    },
    (from,to) => {
      mySelected = swapOrMove(mySelected, from, to);
      clampMyPickToMode();
      persistMatchAndMyPicks();
      renderAll();
    }
  );

  renderSelectedSlots(
    elOppSelectedSlots,
    oppSelected,
    (idx) => { oppSelected = removeAt(oppSelected, idx); clampOppPickToMode(); renderAll(); },
    (from,to) => { oppSelected = swapOrMove(oppSelected, from, to); clampOppPickToMode(); renderAll(); }
  );

  renderCards();
  renderDeck();
  renderRightStatsAndHistory();
}

/* ---------------- シーズンSelect ---------------- */
function setupSeasonSelect(){
  if (!elFilterSeason) return;
  elFilterSeason.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "すべて";
  elFilterSeason.appendChild(optAll);

  const cur = document.createElement("option");
  cur.value = CURRENT_SEASON;
  cur.textContent = CURRENT_SEASON;
  elFilterSeason.appendChild(cur);

  for (const v of PAST_SEASONS) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    elFilterSeason.appendChild(o);
  }

  elFilterSeason.value = CURRENT_SEASON;
}

/* ---------------- 初期化 ---------------- */
async function main(){
  if (elAnonName){
    syncHandleToInput();
    elAnonName.addEventListener("input", persistHandle);
  }

  setupSeasonSelect();

  if (elMatchToggle){
    elMatchToggle.addEventListener("click", (e) => {
      const pill = e.target.closest(".pill");
      if (!pill) return;
      setMatchType(pill.dataset.type);
    });
  }

  if (elLoginBtn) elLoginBtn.addEventListener("click", doLogin);
  if (elSaveBtn) elSaveBtn.addEventListener("click", saveDeck);

  if (elResetBtn) elResetBtn.addEventListener("click", deckReset);
  if (elRearrangeBtn) elRearrangeBtn.addEventListener("click", deckRearrange);
  if (elDownloadBtn) elDownloadBtn.addEventListener("click", exportDeckPng);

  if (elResultToggle){
    elResultToggle.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-result]");
      if (!btn) return;
      setRecordKind(btn.dataset.result);
    });
  }

  [elFilterPeriod, elFilterMatchType, elFilterSeason].forEach(el => {
    if (!el) return;
    el.addEventListener("change", () => renderRightStatsAndHistory());
  });

  try {
    const res = await fetch("./characters_tarot.json", { cache: "no-store" });
    tarotData = await res.json();
  } catch (e) {
    console.error("JSON読み込みエラー:", e);
    return;
  }

  buildIdMaps();
  setupDeck();

  matchType = prefs.matchType || "origin";
  updateMatchUI();

  const names = prefs.myPicksByMode[matchType] || [];
  mySelected = names.map(n => tarotData.find(t => t.name === n)).filter(Boolean).slice(0, MAX_PICK);
  clampMyPickToMode();

  resetRunState();
  setRecordKind("win");

  renderAll();
  await initAuth();

  window.addEventListener("resize", () => drawHistoryChart());
}

main();