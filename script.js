/* script.js — 匿名ID、JPG出力、Firestore/Storage投稿、タイムライン対応 */


// --- 設定 ---
const SEASON = 'S10-1'; // 表示と保存フォルダ名（必要に応じて書き換え）
const JPG_QUALITY = 0.85; // JPEG品質（0.0〜1.0）


let tarotData = [];
let selectedTarots = [];
let deckCards = new Set();


// ------------------ ユーティリティ ------------------
function makeAnonId() {
// localStorage に anonId がなければ作る
let id = localStorage.getItem('anonId');
if (!id) {
id = 'u' + Math.random().toString(36).slice(2, 10);
localStorage.setItem('anonId', id);
}
return id;
}


function updateDeckMetaDisplay() {
const id = makeAnonId();
const meta = document.getElementById('deckMeta');
if (meta) meta.textContent = `@${id} | ${SEASON}`;
}


async function sha256Hex(str) {
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}


// ---------------- JSON読み込み ----------------
fetch('characters_tarot.json')
.then(res => res.json())
.then(data => { tarotData = data; renderTarots(); setupDeck(); updateDeckMetaDisplay(); })
.catch(err => console.error('JSON読み込みエラー:', err));
/* script.js — 匿名ID、JPG出力、Firestore/Storage投稿、タイムライン対応 */


// ---------------- 既存のレンダリング/操作関数（オリジナルを基本そのまま） ----------------
function renderTarots() { /*... 同じ内容 ...*/
const container = document.getElementById('tarotContainer');
container.innerHTML = '';
tarotData.forEach(tarot => {
const tarotImg = document.createElement('img');
tarotImg.src = tarot.img;
tarotImg.dataset.name = tarot.name;
tarotImg.alt = tarot.name;
tarotImg.style.cursor = 'pointer';
tarotImg.addEventListener('click', () => handleTarotClick(tarot, tarotImg));
container.appendChild(tarotImg);
});
}


function handleTarotClick(tarot, tarotImg) {
const allImgs = document.querySelectorAll('#tarotContainer img');
if (selectedTarots.includes(tarot)) {
selectedTarots = selectedTarots.filter(t => t !== tarot);
tarotImg.classList.remove('selected');
} else {
if (selectedTarots.length >= 2) {
const removed = selectedTarots.shift();
allImgs.forEach(img => { if (img.dataset.name === removed.name) img.classList.remove('selected'); });
}
selectedTarots.push(tarot);
tarotImg.classList.add('selected');
}
renderCards();
}


function renderCards() {
const container = document.getElementById('cardContainer');
container.innerHTML = '';
selectedTarots.forEach(tarot => {
const row = document.createElement('div'); row.className = 'card-row'; row.style.display='flex'; row.style.flexWrap='wrap'; row.style.gap='0';
tarot.cards.filter(c => !c.includes('_s_')).forEach(cardPath => { const cardImg = createCardImg(cardPath); cardImg.style.margin='0'; row.appendChild(cardImg); });
tarot.cards.filter(c => c.includes('_s_')).forEach(cardPath => { const cardImg = createCardImg(cardPath); cardImg.style.margin='0'; row.appendChild(cardImg); });
container.appendChild(row);
});
}


function createCardImg(cardPath) {
const img = document.createElement('img');
img.src = cardPath; img.alt = 'カード'; img.style.width='80px'; img.style.height='auto'; img.style.cursor='pointer'; img.dataset.cardPath = cardPath;
img.addEventListener('click', (e) => {
const preview = document.getElementById('preview-image');
if (preview) { preview.src = cardPath || ''; preview.alt = cardPath || ''; preview.style.background = cardPath ? '#fff' : 'transparent'; }


const deck = document.getElementById('deck');
const isTrump = cardPath.includes('_s_');
const slots = deck.querySelectorAll('.slot');
let targetSlot = null;


if (deckCards.has(cardPath)) {
deckCards.delete(cardPath);
slots.forEach(slot => { const slotImg = slot.querySelector('img'); if (slotImg && slotImg.src.endsWith(cardPath)) slot.innerHTML = ''; });
img.classList.remove('in-deck');
return;
}


if (isTrump) {
targetSlot = slots[7].innerHTML === '' ? slots[7] : slots[8].innerHTML === '' ? slots[8] : slots[9].innerHTML === '' ? slots[9] : null;
} else {
for (let i = 0; i < 7; i++) { if (slots[i].innerHTML === '') { targetSlot = slots[i]; break; } }
}
if (!targetSlot) return;


deckCards.add(cardPath);
const deckImg = document.createElement('img'); deckImg.src = cardPath; deckImg.alt = 'デッキカード'; deckImg.style.width='100%'; deckImg.style.height='auto'; deckImg.draggable=true; deckImg.dataset.type = isTrump ? 'trump' : 'normal';
deckImg.addEventListener('click', () => { deckCards.delete(cardPath); const parentSlot = deckImg.parentElement; if (parentSlot) parentSlot.innerHTML = ''; const matchThumbs = document.querySelectorAll('#cardContainer img'); matchThumbs.forEach(t => { if (t.dataset.cardPath === cardPath) t.classList.remove('in-deck'); }); });
deckImg.addEventListener('dragstart', (ev) => { const parent = deckImg.parentElement; const idx = [...document.getElementById('deck').children].indexOf(parent); ev.dataTransfer.setData('fromIndex', String(idx)); ev.dataTransfer.effectAllowed = 'move'; });
targetSlot.innerHTML = ''; targetSlot.appendChild(deckImg); img.classList.add('in-deck');
});
return img;
}


function setupDeck() {
const deck = document.getElementById('deck'); deck.innerHTML = '';
for (let i = 0; i < 10; i++) {
const slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.index = i; slot.style.width='80px'; slot.style.height='120px'; slot.style.border='1px dashed #ccc'; slot.style.display='inline-block'; slot.style.verticalAlign='top'; slot.style.marginRight='2px'; slot.style.boxSizing='border-box'; slot.style.overflow='hidden'; slot.style.padding='0';
slot.addEventListener('dragover', (e) => { e.preventDefault(); });
slot.addEventListener('drop', (e) => {
e.preventDefault(); const fromIndexStr = e.dataTransfer.getData('fromIndex'); if (!fromIndexStr) return; const fromIndex = parseInt(fromIndexStr,10); const toIndex = parseInt(slot.dataset.index,10); if (isNaN(fromIndex)||isNaN(toIndex)) return; const fromIsTrumpZone = fromIndex >=7; const toIsTrumpZone = toIndex >=7; if (fromIsTrumpZone !== toIsTrumpZone) return; const deckEl = document.getElementById('deck'); const fromSlot = deckEl.children[fromIndex]; const toSlot = deckEl.children[toIndex]; const tmp = toSlot.innerHTML; toSlot.innerHTML = fromSlot.innerHTML; fromSlot.innerHTML = tmp; });
deck.appendChild(slot);
}
}


// ---------------- デッキ画像出力 & Firebase 投稿 ----------------
document.getElementById('exportDeck').addEventListener('click', async () => {
const deck = document.getElementById('deck');
const deckNameInput = document.getElementById('deckName') ? document.getElementById('deckName').value.trim() : '';
const memoInput = document.getElementById('deckMemo') ? document.getElementById('deckMemo').value.trim() : '';
const filenameBase = deckNameInput ? deckNameInput : 'deck';


const canvas = document.getElementById('deckCanvas');
const ctx = canvas.getContext('2d');

