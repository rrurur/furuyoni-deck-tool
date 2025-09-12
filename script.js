/* script.js - Firebase投稿ツール */

// ---------------- Firebase 初期化 ----------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "furuyoni-diary.firebaseapp.com",
  projectId: "furuyoni-diary",
  storageBucket: "furuyoni-diary.firebasestorage.app",
  messagingSenderId: "XXXXXXX",
  appId: "XXXXXXX"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------------- 匿名ID生成（ブラウザごと固定） ----------------
function getAnonId() {
  let anonId = localStorage.getItem("anonId");
  if (!anonId) {
    anonId = Math.random().toString(36).substring(2, 8); // ランダム6文字
    localStorage.setItem("anonId", anonId);
  }
  return anonId;
}
const anonId = getAnonId();

// ---------------- 投稿処理 ----------------
async function submitDeck(deckName, deckCards, notes, userNameInput) {
  const userId = userNameInput?.trim() ? userNameInput.trim() : anonId;
  const season = "S10-1"; // 今シーズン（固定）

  // デッキのユニークキー（カード構成＋メモ）
  const deckKey = JSON.stringify(deckCards) + "|" + notes;

  // 直前のデッキと同じなら保存しない（エラーは出さない）
  const lastDeck = localStorage.getItem("lastDeck");
  if (lastDeck === deckKey) {
    console.log("同じデッキの連続投稿はスキップしました。");
    return;
  }
  localStorage.setItem("lastDeck", deckKey);

  // Firestore に保存
  try {
    await addDoc(collection(db, "decks"), {
      deckName,
      cards: deckCards,   // カード1枚ごと保存
      notes,
      userId,             // @〇〇
      season,
      createdAt: serverTimestamp()
    });
    console.log("デッキを保存しました！");
  } catch (error) {
    console.error("Firebase投稿エラー:", error);
  }
}

// ---------------- タイムライン取得 ----------------
async function loadTimeline() {
  const q = query(collection(db, "decks"), orderBy("createdAt", "desc"));
  const querySnapshot = await getDocs(q);

  const timeline = document.getElementById("timeline");
  timeline.innerHTML = "";

  querySnapshot.forEach((doc) => {
    const data = doc.data();

    const card = document.createElement("div");
    card.className = "deck-card";

    // デッキ画像部分（仮）
    const img = document.createElement("div");
    img.className = "deck-image";
    img.innerText = `[ ${data.deckName} ]`;
    card.appendChild(img);

    // デッキ名・ユーザーID・シーズン（右側に小さく）
    const caption = document.createElement("div");
    caption.className = "deck-caption";
    caption.innerHTML = `
      <div class="deck-name">${data.deckName}</div>
      <div class="deck-meta">@${data.userId}　${data.season}</div>
    `;
    card.appendChild(caption);

    timeline.appendChild(card);
  });
}

// ---------------- ページ読み込み時 ----------------
window.addEventListener("DOMContentLoaded", () => {
  loadTimeline();

  document.getElementById("submitBtn").addEventListener("click", () => {
    const deckName = document.getElementById("deckName").value;
    const notes = document.getElementById("notes").value;
    const userNameInput = document.getElementById("userName").value; // ユーザー名入力欄

    // サンプル: カード配列
    const deckCards = ["card1", "card2", "card3", "special1"];

    submitDeck(deckName, deckCards, notes, userNameInput).then(() => {
      loadTimeline();
    });
  });
});
