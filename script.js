/* script.js - 修正版（入れ替え・プレビュー・桜色出力） */
const baseFolder = "S10-1";

let tarotData = [];
let selectedTarots = [];
let deckCards = new Set(); // デッキに入っているカードのパス集合

// ---------------- JSON読み込み ----------------
fetch("characters_tarot.json")
  .then(res => res.json())
  .then(data => {
    tarotData = data;
    renderTarots();
    setupDeck();
    // 注意: renderCards は選択時に呼ばれます
  })
  .catch(err => console.error("JSON読み込みエラー:", err));

// ---------------- タロット表示 ----------------
function renderTarots() {
  const container = document.getElementById("tarotContainer");
  container.innerHTML = "";

  tarotData.forEach(tarot => {
    const tarotImg = document.createElement("img");
    tarotImg.src = tarot.img; // JSONのimgを使用（元の仕様を保持）
    tarotImg.dataset.name = tarot.name;
    tarotImg.alt = tarot.name;
    tarotImg.style.cursor = "pointer";

    tarotImg.addEventListener("click", () => handleTarotClick(tarot, tarotImg));
    container.appendChild(tarotImg);
  });
}

// ---------------- タロットクリック（2つまで選択） ----------------
function handleTarotClick(tarot, tarotImg) {
  const allImgs = document.querySelectorAll("#tarotContainer img");

  if (selectedTarots.includes(tarot)) {
    selectedTarots = selectedTarots.filter(t => t !== tarot);
    tarotImg.classList.remove("selected");
  } else {
    if (selectedTarots.length >= 2) {
      const removed = selectedTarots.shift();
      allImgs.forEach(img => {
        if (img.dataset.name === removed.name) img.classList.remove("selected");
      });
    }
    selectedTarots.push(tarot);
    tarotImg.classList.add("selected");
  }

  renderCards();
}

// ---------------- カード一覧表示（キャラごとに1行、カード間の余白なし） ----------------
function renderCards() {
  const container = document.getElementById("cardContainer");
  container.innerHTML = "";

  selectedTarots.forEach(tarot => {
    const row = document.createElement("div");
    row.className = "card-row";
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "0"; // カード間の余白はゼロ

    // 先に通常カード（_s_ を含まない）
    tarot.cards.filter(c => !c.includes("_s_")).forEach(cardPath => {
      const cardImg = createCardImg(cardPath);
      cardImg.style.margin = "0"; // 余白を消す
      row.appendChild(cardImg);
    });

    // 次に切り札（_s_ を含む）
    tarot.cards.filter(c => c.includes("_s_")).forEach(cardPath => {
      const cardImg = createCardImg(cardPath);
      cardImg.style.margin = "0";
      row.appendChild(cardImg);
    });

    // キャラ毎に改行（rowを縦に並べる）
    container.appendChild(row);
  });
}

// ---------------- カード要素生成（クリックでデッキ追加/削除・クリックでプレビュー更新） ----------------
function createCardImg(cardPath) {
  const img = document.createElement("img");
  img.src = cardPath;
  img.alt = "カード";
  img.style.width = "80px"; // 適当なサムネイルサイズ（必要ならCSSで調整）
  img.style.height = "auto";
  img.style.cursor = "pointer";
  img.dataset.cardPath = cardPath;

  img.addEventListener("click", (e) => {
    // まずプレビュー更新（クリックでプレビューが更新される仕様）
  const preview = document.getElementById("preview-image");
  if (preview) {
    preview.src = cardPath || "";
    preview.alt = cardPath || "";
    preview.style.background = cardPath ? "#fff" : "transparent"; // カード未選択時は透明
  }


    // デッキへの追加/削除処理（元の挙動を保持）
    const deck = document.getElementById("deck");
    const isTrump = cardPath.includes("_s_");
    const slots = deck.querySelectorAll(".slot");
    let targetSlot = null;

    // 既にデッキにあるなら削除
    if (deckCards.has(cardPath)) {
      deckCards.delete(cardPath);
      // 対応するslotの画像を削除（srcが末尾にcardPathと一致するもの）
      slots.forEach(slot => {
        const slotImg = slot.querySelector("img");
        if (slotImg && slotImg.src.endsWith(cardPath)) slot.innerHTML = "";
      });
      img.classList.remove("in-deck");
      return;
    }

    // 空きスロットを探す（トランプは右下3、通常は0..6）
    if (isTrump) {
      targetSlot = slots[7].innerHTML === "" ? slots[7]
                  : slots[8].innerHTML === "" ? slots[8]
                  : slots[9].innerHTML === "" ? slots[9]
                  : null;
    } else {
      for (let i = 0; i < 7; i++) {
        if (slots[i].innerHTML === "") {
          targetSlot = slots[i];
          break;
        }
      }
    }

    if (!targetSlot) return; // 上限超えたら無視

    deckCards.add(cardPath);

    const deckImg = document.createElement("img");
    deckImg.src = cardPath;
    deckImg.alt = "デッキカード";
    deckImg.style.width = "100%";
    deckImg.style.height = "auto";
    deckImg.draggable = true;
    deckImg.dataset.type = isTrump ? "trump" : "normal";

    // クリックでスロットから取り外す
    deckImg.addEventListener("click", () => {
      deckCards.delete(cardPath);
      // slotを空にする（このdeckImgが属する親slotを空に）
      const parentSlot = deckImg.parentElement;
      if (parentSlot) parentSlot.innerHTML = "";
      // 元の一覧のサムネイルから in-deck を削除（もしあれば）
      const matchThumbs = document.querySelectorAll(`#cardContainer img`);
      matchThumbs.forEach(t => {
        if (t.dataset.cardPath === cardPath) t.classList.remove("in-deck");
      });
    });

    // ドラッグ開始：デッキ内順序入れ替え用
    deckImg.addEventListener("dragstart", (ev) => {
      // fromIndex を保存
      const parent = deckImg.parentElement;
      const idx = [...document.getElementById("deck").children].indexOf(parent);
      ev.dataTransfer.setData("fromIndex", String(idx));
      ev.dataTransfer.effectAllowed = "move";
    });

    // slotに追加
    targetSlot.innerHTML = "";
    targetSlot.appendChild(deckImg);

    // 元一覧のサムネに in-deck クラスをつける
    img.classList.add("in-deck");
  });

  return img;
}

// ---------------- デッキ枠作成（10スロット） ----------------
function setupDeck() {
  const deck = document.getElementById("deck");
  deck.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.dataset.index = i;
    slot.style.width = "80px";
    slot.style.height = "120px";
    slot.style.border = "1px dashed #ccc";
    slot.style.display = "inline-block";
    slot.style.verticalAlign = "top";
    slot.style.marginRight = "2px";
    slot.style.boxSizing = "border-box";
    slot.style.overflow = "hidden";
    slot.style.padding = "0";

    // ドラッグオーバー許可
    slot.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    // ドロップ：スロット間での入れ替え（切り札と通常のゾーン違いは拒否）
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      const fromIndexStr = e.dataTransfer.getData("fromIndex");
      if (!fromIndexStr) return;
      const fromIndex = parseInt(fromIndexStr, 10);
      const toIndex = parseInt(slot.dataset.index, 10);
      if (isNaN(fromIndex) || isNaN(toIndex)) return;

      const fromIsTrumpZone = fromIndex >= 7;
      const toIsTrumpZone = toIndex >= 7;
      if (fromIsTrumpZone !== toIsTrumpZone) return; // ゾーン違いは無効

      const deckEl = document.getElementById("deck");
      const fromSlot = deckEl.children[fromIndex];
      const toSlot = deckEl.children[toIndex];

      // 入れ替え（HTMLごと）
      const tmp = toSlot.innerHTML;
      toSlot.innerHTML = fromSlot.innerHTML;
      fromSlot.innerHTML = tmp;
    });

    deck.appendChild(slot);
  }
}

// ---------------- デッキ画像出力（背景桜色 #f7edf1 を反映） ----------------
document.getElementById("exportDeck").addEventListener("click", () => {
  const deck = document.getElementById("deck");
  const deckNameInput = document.getElementById("deckName") ? document.getElementById("deckName").value.trim() : "";
  const memoInput = document.getElementById("deckMemo") ? document.getElementById("deckMemo").value.trim() : "";
  const filename = deckNameInput ? `${deckNameInput}.png` : "deck.png";

  const canvas = document.getElementById("deckCanvas");
  const ctx = canvas.getContext("2d");

  const slots = deck.querySelectorAll(".slot");
  const cols = 5;
  const rows = 2;
  if (slots.length === 0) return;

  const slotWidth = slots[0].offsetWidth || 80;
  const slotHeight = slots[0].offsetHeight || 120;

  const deckNameHeight = deckNameInput ? 40 : 0;
  const memoHeight = memoInput ? 50 : 0;

  const leftMargin = 1;
  const rightMargin = 2;
  const hGap = 1;
  const scale = 3; // 高解像度

  canvas.width = (slotWidth * cols + leftMargin + rightMargin) * scale;
  canvas.height = (deckNameHeight + slotHeight * rows + memoHeight + hGap * 2) * scale;

  // 背景を桜色
  ctx.fillStyle = "#f7edf1";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 外枠
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4 * scale;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);

  // デッキ名（上部）
  if (deckNameInput) {
    ctx.fillStyle = "#000000";
    ctx.font = `${24 * scale}px 'Noto Serif JP', serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(deckNameInput, leftMargin * scale, 10 * scale);

    // 下線
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(0, deckNameHeight * scale);
    ctx.lineTo(canvas.width, deckNameHeight * scale);
    ctx.stroke();
  }

  // カード描画（slotの順番どおりに）
  const promises = [];
  slots.forEach((slot, i) => {
    const imgEl = slot.querySelector("img");
    if (imgEl) {
      promises.push(new Promise(resolve => {
        const tmp = new Image();
        tmp.src = imgEl.src;
        tmp.onload = () => {
          const x = (i % cols) * slotWidth * scale + leftMargin * scale;
          const y = Math.floor(i / cols) * slotHeight * scale + deckNameHeight * scale + hGap * scale;
          ctx.drawImage(tmp, x, y, slotWidth * scale, slotHeight * scale);
          resolve();
        };
        tmp.onerror = () => resolve(); // 画像失敗でも続行
      }));
    }
  });

  // メモ描画（画像出力時のみ折返し）
  if (memoInput) {
    const memoX = leftMargin * scale;
    const memoY = (deckNameHeight + slotHeight * rows + hGap) * scale;
    const memoWidth = slotWidth * cols * scale;
    const memoHeightInner = memoHeight * scale;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(memoX, memoY, memoWidth, memoHeightInner);

    ctx.fillStyle = "#000000";
    ctx.font = `${7 * scale}px 'HGMaruGothicMPRO', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const chars = memoInput.split("");
    let line = "";
    let yOffset = 5 * scale;
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > memoWidth - 10 * scale) {
        ctx.fillText(line, memoX + 5 * scale, memoY + yOffset);
        line = chars[i];
        yOffset += 9 * scale;
      } else {
        line = testLine;
      }
      if (i === chars.length - 1) {
        ctx.fillText(line, memoX + 5 * scale, memoY + yOffset);
      }
    }
  }

Promise.all(promises).then(async () => {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();

    try {
        // ユーザー名の決定
        function generateRandomName(length = 8) {
            const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let result = "";
            for (let i = 0; i < length; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return "@" + result;
        }

        let username = document.getElementById("userName")?.value.trim();
        if (!username) {
            if (!localStorage.getItem("deckUserName")) {
                const randName = generateRandomName(8);
                localStorage.setItem("deckUserName", randName);
            }
            username = localStorage.getItem("deckUserName");
        }

        // デッキハッシュ計算
        const deckCardsArray = [...deckCards];
        const deckString = deckCardsArray.join(",");
        const deckHash = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(deckString)
        ).then(buf =>
            Array.from(new Uint8Array(buf))
                .map(b => b.toString(16).padStart(2, "0"))
                .join("")
        );

        const postsRef = firebase.firestore().collection("posts");
        const lastPostQuery = await postsRef
            .where("userId", "==", username)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        if (!lastPostQuery.empty) {
            const lastPost = lastPostQuery.docs[0].data();
            if (lastPost.deckHash === deckHash) return;
        }

        const storageRef = firebase.storage().ref();
        const baseFolder = "S10-1";

        // 1. サムネイル生成
        const thumbWidth = 160, thumbHeight = 240;
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = thumbWidth;
        thumbCanvas.height = thumbHeight;
        const thumbCtx = thumbCanvas.getContext("2d");
        thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);

        const thumbBlob = await new Promise(resolve =>
            thumbCanvas.toBlob(resolve, "image/jpeg", 0.7)
        );
        const thumbRef = storageRef.child(`${baseFolder}/thumbs/${Date.now()}_${username}.jpg`);
        await thumbRef.put(thumbBlob);
        const thumbUrl = await thumbRef.getDownloadURL();

        // 2. フルサイズアップロード
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const fileRef = storageRef.child(`${baseFolder}/${Date.now()}_${username}.png`);
        await fileRef.put(blob);
        const imageUrl = await fileRef.getDownloadURL();

        // 3. Firestoreに投稿
        const deckNameInput = document.getElementById("deckName")?.value.trim() || "";
        const memoInput = document.getElementById("deckMemo")?.value.trim() || "";
        await postsRef.add({
            userId: username,
            deckHash: deckHash,
            deckName: deckNameInput,
            memo: memoInput,
            imageUrl: imageUrl,
            thumbnailUrl: thumbUrl, // サムネイルURLも保存
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        console.log("Firebase投稿完了:", imageUrl, "サムネイル:", thumbUrl);

    } catch (err) {
        console.error("Firebase投稿エラー:", err);
        
    }
});
});  
  


