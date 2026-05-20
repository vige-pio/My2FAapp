# Self-Built 2FA — Chrome拡張機能

完全ローカル動作のTOTP (RFC 6238) 2FAコード生成Chrome拡張機能。
マスターパスワードでアカウント情報を暗号化して保存し、ネットワーク通信は一切行わない。

## アーキテクチャ

Manifest V3、popupのみ（background/content scriptなし）。外部ライブラリ依存ゼロ、Web Crypto APIのみで完結。

```
manifest.json    — Manifest V3定義。permissionsは"storage"のみ、host_permissionsは空
popup.html       — UI骨格。3画面（setup / unlock / app）+ 追加モーダル
popup.css        — ダークテーマ単一CSS
popup.js         — 状態管理・イベントハンドラ・レンダリング
totp.js          — TOTP生成 (HMAC-SHA1/256/512) + Base32デコード + otpauth:// URIパース
crypto.js        — PBKDF2鍵導出 + AES-GCM暗号化/復号
storage.js       — chrome.storage.local のヴォールトCRUD
icons/           — 拡張機能アイコン (16/48/128)
```

スクリプトロード順は `popup.html` 末尾: `totp.js → crypto.js → storage.js → popup.js`。
モジュール化していないため、各ファイルはトップレベル関数をグローバルに公開する設計。

## ヴォールトデータ構造

`chrome.storage.local` に1つのキー `vault` だけ保存:

```js
{
  version: 1,
  salt: number[],                  // PBKDF2用 16バイト
  payload: {
    iv: number[],                  // AES-GCM用 12バイト
    ciphertext: number[]           // accounts配列のJSONを暗号化
  }
}
```

`accounts` (復号後):
```js
[
  {
    id: string,                    // crypto.randomUUID()
    type: 'totp',
    issuer: string,
    account: string,
    secret: string,                // Base32
    digits: number,                // 6-10
    period: number,                // 秒
    algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512',
    createdAt: number
  }
]
```

## セキュリティ設計の前提

これらは意図的な設計判断であり、変更時は影響を必ず検討すること:

- **PBKDF2 250,000回**: ポップアップ起動時の解錠速度（体感100-300ms）と総当たり耐性のバランス。下げない。
- **AES-GCM**: 認証付き暗号。復号失敗 = 改ざん or パスワード間違いとして同じエラーを返す（情報漏洩防止）。
- **CSP**: `manifest.json` で `script-src 'self'; object-src 'self'` を強制。インラインスクリプト/eval禁止。
- **メモリ揮発**: `cryptoKey`/`accounts` はpopup.jsのモジュールスコープ変数。ポップアップを閉じれば消える（永続化しない）。
- **セッション鍵キャッシュ**: 解錠した派生鍵を `chrome.storage.session` に最後の使用から8時間キャッシュ（`storage.js` の `SESSION_TTL_MS`）。session storageはブラウザ終了で消え、他拡張・Webページから読めないため、storage.localより一段揮発性が高い。利便性とセキュリティの妥協点。ロックボタン or ヴォールトリセットで即座にクリアされる。
- **`host_permissions: []`**: Webサイトへのアクセスは一切しない。secretをページから自動入力する機能を追加する場合は、設計レビューを行うこと。
- **クリップボードコピー**: TOTPコード本体は `navigator.clipboard.writeText` でコピーするが、secretは絶対にUIに表示しない/コピーさせない。

## 開発手順

このプロジェクトはビルドステップなし。直接ファイルを編集して読み込む。

### Chromeへの読み込み

1. Chrome で `chrome://extensions/` を開く
2. 「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択

### 変更の反映

- `popup.html` / `popup.css` / `popup.js` の変更: ポップアップを閉じて開き直すだけで反映
- `manifest.json` の変更: `chrome://extensions/` で「更新」ボタンが必要
- エラーが出たら `chrome://extensions/` の「エラー」リンク、または拡張機能のポップアップを右クリック→「検証」でDevToolsを開く

### 動作確認用シークレット

`JBSWY3DPEHPK3PXP` (RFC 6238テストベクトルの "Hello!\xde\xad\xbe\xef")。
Google Authenticator互換クライアントと比較して同じコードが出れば正しい。

## コーディング規約

- **新しい依存追加禁止**: npm/CDN含めゼロ依存を維持。Web Crypto APIで実装できないものだけ要相談。
- **モジュールシステム導入禁止**: 現状はグローバル関数前提。ESMに切り替える場合は `manifest.json` の `type: "module"` と script tag の `type="module"` の両方が必要 + ロード順制御の再設計が必要なため、相応のメリットがある時だけ。
- **ユーザー向け文言は日本語**: UI/エラーメッセージは日本語。
- **コメントは「なぜ」を書く**: 「何をしているか」はコードを読めば分かる。非自明な制約・選択理由のみコメント化。
- **innerHTMLに値を入れる時は `escapeHtml` 必須**: `popup.js` の `render()` 参照。XSS防止。
- **エラーは握りつぶさない**: try/catchするなら、ユーザーに見える形（モーダルやステータス領域）でエラー表示すること。

## よくある変更タスクと注意点

- **新しい認証アルゴリズム追加**: `totp.js` の `generateTOTP` は `crypto.subtle.importKey` の `hash` パラメータでSHA-1/256/512に対応済。HOTPは未対応（counter永続化が必要なため要設計）。
- **アカウント編集機能の追加**: 現在は追加/削除のみ。編集を足す場合、`persistAccounts` で同IDを置換すれば良い。secretの再表示は禁止（書き換える場合も新規入力させる）。
- **エクスポート/インポート (v1.3.0〜 WinAuth互換)**: `popup.js` の `onRunExport` / `onImportFileSelected` 周辺。形式は **WinAuthのPlain text export** に合わせた「1行1 `otpauth://` URI のテキストファイル(.txt)」。CRLF区切り、UTF-8。KeePass / Aegis / Bitwarden 等の主要ツールとも相互運用可能。エクスポートは暗号化されないため警告ダイアログ + 同意チェック必須。インポートは空行と `#` / `//` で始まるコメント行をスキップ。1行ごとに `parseOtpAuthUri` (totp.js) を通し、失敗行は件数だけ報告してスキップ。`buildOtpAuthUri` は totp.js 側、`parseOtpAuthUri` と対。取り込み時はid/createdAtを再採番し、既存アカウントに追記する(重複検出なし)。
- **アイコン差し替え**: `icons/` 配下の `icon16.png` / `icon48.png` / `icon128.png` を置き換えるだけ。manifest.json も合わせて確認。

## やってはいけないこと

- secretをログ/console出力する
- `host_permissions` を `<all_urls>` 等に拡げる（必要性が出たら必ず議論）
- マスターパスワード（平文）をstorageに保存する。派生鍵を `chrome.storage.session` にTTL付きでキャッシュするのは許容（v1.1.0〜）だが、 `chrome.storage.local` に派生鍵を保存するのは禁止（ディスクに永続化されてしまう）
- `eval` / `new Function` / インラインイベントハンドラの追加（CSP違反）
- 外部CDNからスクリプト読み込み（CSP違反 + サプライチェーン)
