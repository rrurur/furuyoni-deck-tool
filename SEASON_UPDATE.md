# シーズン更新手順

次シーズンで同様の更新を行うための作業メモです。

表に表示されるシーズン名、ルール名、メガミ名、武器名は日本語表記を維持します。表に出ないフォルダ名やスクリプト名は英字でも構いません。

## 更新の中心

次回は主に以下を更新します。

- `season_config.json`
  - 現在シーズン、過去シーズン、完全戦対象メガミ、表示名補正を集約しています。
  - TL側も公開されたこのファイルを優先して読みます。
- `characters_tarot.json`
  - メガミ、武器名、カードパスの本体です。
- `legacy_id_map.json`
  - 旧投稿の数値カードID・メガミIDを復元する固定表です。
  - **次シーズン更新時に再生成・並べ替え・削除しません。**
- `images/`
  - 現在環境のカードに加え、古典戦で必要な旧カードを保持します。
- `tarots/`
  - 現在環境のタロットに加え、古典戦で必要な旧タロットを保持します。
- `images_シーズン名/`
  - 投稿済み旧デッキを表示するための画像スナップショットです。
- `E:\自作ｐｙ\furutl\public\season_config.json`
  - TL側のローカル確認用フォールバックです。
- `E:\自作ｐｙ\furutl\public\legacy_id_map.json`
  - TL側で旧投稿を復元する固定表です。

## 公式素材の場所

公式サイトから毎回新規ダウンロードしたコモンズ一式を、次の場所に展開する想定です。

```text
C:\Users\fragi\Desktop\furuyoni_commons_re\furuyoni_re
```

利用するフォルダは次の2つです。

- `cards/`
  - 例: `19_megumi_a1_n_2.png`
  - 公開側では `images/na_19_megumi_a1_n_2.png` として使います。
- `tarots/`
  - 例: `tarot_19_megumi_a1.png`
  - 公開側では `tarots/tarot_19_a1.png` として使います。

公式の `cards/` は毎回新規一式ですが、公開側の `images/` は削除しません。古典戦で再演に存在しない旧メガミのカードを残す必要があるためです。

## 基本手順

### 1. 作業状態を確認

```powershell
git -C E:\furuyoni-deck-tool status --short --branch
```

未コミット変更がある場合は、内容を確認してから進めます。

### 2. 公式素材を事前確認

まず `-PlanOnly` 付きで、件数・不足カード・未登録タロットだけ確認します。ファイル変更は行いません。

```powershell
pwsh -ExecutionPolicy Bypass -File E:\furuyoni-deck-tool\tools\import_official_assets.ps1 `
  -CommonsRoot "C:\Users\fragi\Desktop\furuyoni_commons_re\furuyoni_re" `
  -ArchiveSeason "再演" `
  -NewSeason "次のシーズン名" `
  -PlanOnly
```

### 3. 公式素材を取り込む

```powershell
pwsh -ExecutionPolicy Bypass -File E:\furuyoni-deck-tool\tools\import_official_assets.ps1 `
  -CommonsRoot "C:\Users\fragi\Desktop\furuyoni_commons_re\furuyoni_re" `
  -ArchiveSeason "再演" `
  -NewSeason "次のシーズン名"
```

このスクリプトは次を行います。

- 現在の `images/` を `images_再演/` などへ保存
- 現在の `tarots/` を `tarots_再演/` などへ保存
- 公式 `cards/*.png` を `images/na_*.png` として上書き・追加
- `characters_tarot.json` が参照する旧互換名にも画像をコピー
  - 例: `_s8` 付きの公開名を、公式の接尾辞なし画像から作成
- 公式タロット名を公開側の短い名前へ変換
  - 例: `tarot_19_megumi_a1.png` → `tarot_19_a1.png`
- 公式 `tarots/` と `characters_tarot.json` を照合し、完全戦対象の `replayTarotNames` を自動更新
- `season_config.json` のシーズン名と旧画像フォルダ対応を更新
- TL側の `E:\自作ｐｙ\furutl\public\season_config.json` へ設定を同期
- 固定済みの `legacy_id_map.json` をTL側へ同期

アーカイブ先がすでに存在する場合、誤って古い内容を使わないよう処理を停止します。
内容を確認済みで既存アーカイブを再利用する場合だけ
`-ReuseExistingArchive` を付けます。

### 4. メガミとカード定義を更新

`characters_tarot.json` を新シーズンに合わせて更新します。

- 新規・変更メガミを追加または修正
- 表示される `weapon` は日本語名にする
- カードパスは `images/na_...png` 形式にする
- 完全戦対象の `replayTarotNames` は取り込みスクリプトが公式タロット一覧から更新する
- 新規メガミが `characters_tarot.json` に未登録の場合は警告が出るため、追加後に再実行する
- 起源戦では名前末尾が `_a1`, `_a2` のメガミが除外される
- 古典戦では全メガミを表示する

### 5. シーズン設定を確認

`season_config.json` の主な項目です。

```json
{
  "currentSeason": "表に表示する新シーズン名",
  "pastSeasons": ["直前シーズン", "それ以前"],
  "imageFoldersBySeason": {
    "直前シーズン": "images_直前シーズン"
  },
  "replayTarotNames": [],
  "weaponLabelOverrides": {}
}
```

- `currentSeason`
  - 公開画面に表示する日本語シーズン名
- `pastSeasons`
  - 履歴検索に表示する過去シーズン
- `imageFoldersBySeason`
  - 投稿済み旧デッキを表示する画像フォルダ対応
- `replayTarotNames`
  - 完全戦で表示するメガミの内部名
- `matchTypeLabels`
  - `完全戦`, `起源戦`, `古典戦` などの日本語表示
- `weaponLabelOverrides`
  - JSON上の旧名を画面上だけ別名表示する場合に使用

### 6. TL側の予備設定を確認

取り込みスクリプトが自動同期します。公開TLはデッキツール側の設定を優先しますが、ローカル確認や一時的な通信失敗に備えて、両ファイルが一致していることを確認します。

### 7. 検証

```powershell
node --check E:\furuyoni-deck-tool\script.js
node --check E:\自作ｐｙ\furutl\public\script.js
node -e "JSON.parse(require('fs').readFileSync('E:/furuyoni-deck-tool/season_config.json','utf8')); JSON.parse(require('fs').readFileSync('E:/furuyoni-deck-tool/characters_tarot.json','utf8')); JSON.parse(require('fs').readFileSync('E:/furuyoni-deck-tool/legacy_id_map.json','utf8')); console.log('json ok')"
```

確認項目:

- 完全戦で対象メガミだけ表示される
- 起源戦で `_a1`, `_a2` が除外される
- 古典戦で全メガミが表示される
- 新カードを選ぶとデッキ欄にも表示される
- 投稿済み旧デッキの画像が表示される
- TL側の対戦形式、環境、武器名が正しい
- クレジットが両サイトに残っている

### 8. 公開

デッキツール:

```powershell
git -C E:\furuyoni-deck-tool add .
git -C E:\furuyoni-deck-tool commit -m "Update season assets"
git -C E:\furuyoni-deck-tool push origin main
```

TL:

```powershell
Set-Location E:\自作ｐｙ\furutl
npx --yes firebase-tools deploy --only hosting --project furuyoni-diary-1918f
```

## 注意事項

- `images/` と `tarots/` の既存ファイルを一括削除しない
- 投稿済みデッキ用の旧シーズン画像フォルダを削除しない
- `legacy_id_map.json` を次シーズンのJSONから再生成しない
- 表に見える日本語名を英語へ変更しない
- クレジットを削除しない

クレジット:

```text
ふるよに再演コモンズ/BakaFire,TOKIAME（ふるよにコモンズ作成）
https://furuyoni.sekiseiro.com/re/add-contents/commons/
```
