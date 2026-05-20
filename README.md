# Self-Built 2FA

ローカル動作のTOTP (RFC 6238) 2段階認証コード生成 Chrome 拡張機能。
ネットワーク通信は一切行わず、アカウント情報はマスターパスワードで暗号化して `chrome.storage.local` に保存します。

## 特徴

- **完全ローカル**: 通信なし。`host_permissions: []`、`permissions: ["storage"]` のみ。
- **暗号化保存**: PBKDF2-SHA256 (250,000回) でマスターパスワードから派生した鍵で AES-GCM 256bit 暗号化。
- **セッションキャッシュ**: 解錠後は最後の操作から8時間自動解錠（`chrome.storage.session` に派生鍵を保持。ブラウザ終了で揮発）。
- **WinAuth互換のインポート/エクスポート**: 1行1 `otpauth://` URI のテキスト形式。
- **外部依存ゼロ**: ライブラリやCDN読み込みは一切なし。Web Crypto APIのみ使用。

## インストール

1. このリポジトリをクローン or ZIPダウンロード
   ```sh
   git clone https://github.com/vige-pio/My2FAapp.git
   ```
2. Chrome で `chrome://extensions/` を開く
3. 右上の **デベロッパーモード** をオン
4. **パッケージ化されていない拡張機能を読み込む** をクリックし、クローンしたフォルダを選択
5. ツールバーにカギアイコンが表示されれば成功

## 使い方

### 初回セットアップ

ポップアップを開くと「初回セットアップ」画面が表示されます。マスターパスワードを設定してください（8文字以上推奨）。

> ⚠️ マスターパスワードは復元できません。忘れた場合は「ヴォールトをリセット」で全データを削除して再セットアップする必要があります。

### アカウント追加

メイン画面右上の **「＋」** ボタンから:

- **URI貼り付け**: サービス側のQRコードを別端末で読み取って得た `otpauth://totp/...` をペースト
- **手入力**: Issuer / アカウント名 / Base32シークレットを入力。詳細設定で桁数・周期・アルゴリズムも変更可

### コードのコピー

メイン画面のコード（青色の数字）をクリックすると、コード本体がクリップボードにコピーされます。残り秒数のリングと数字も表示されます。

### ロック

ヘッダーの 🔒 ボタンで即座にロック。セッションキャッシュも破棄され、次回はパスワード入力が必要です。

## インポート / エクスポート

ヘッダーの ↑ ↓ ボタンから操作できます。

ファイル形式は **WinAuthのPlain text export** と同じ「1行1 `otpauth://` URI」のテキストファイル (`.txt`、UTF-8、CRLF区切り)。

```
otpauth://totp/Google:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Google
otpauth://totp/GitHub:user@example.com?secret=KRSXG5BAONUGCZBA&issuer=GitHub&algorithm=SHA256&digits=8
otpauth://totp/AWS?secret=ABCDEFGHIJKLMNOP&issuer=AWS&period=60
```

- 空行と `#` / `//` で始まる行はインポート時に無視されます
- インポートしたアカウントは既存アカウントに追記されます（重複検出は行いません）
- インポート前に各エントリで一度TOTP生成を試行し、不正なBase32は検出してスキップします

> ⚠️ エクスポート時の `.txt` ファイルは **暗号化されていません**。流出すると全アカウントの2FAが突破されます。書き出し後は速やかに安全な場所（暗号化ボリューム等）へ移動し、ダウンロードフォルダから削除してください。

### 他ツールとの相互運用

| ツール | 本拡張へインポート | 本拡張からエクスポート |
|---|:---:|:---:|
| [WinAuth](https://winauth.github.io/winauth/) (Plain text) | ✅ | ✅ |
| [Aegis Authenticator](https://getaegis.app/) (Export ▸ Plain text URI) | ✅ | ✅ |
| [KeePass](https://keepass.info/) + KeeOtp / 2FAuth プラグイン | ✅ | ✅ |
| Bitwarden (otpauth URIをコピー → 1行ずつ並べる) | ✅ | ✅ |
| 任意のテキストエディタ + 手書きの `otpauth://` URI 列 | ✅ | ✅ |
| Google Authenticator | ❌ (専用QR migration形式のみ) | ❌ |
| Microsoft Authenticator | ❌ (クラウド同期のみ) | ❌ |

`otpauth://` URI は [Google が公開する Key Uri Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) に準拠する事実上の標準フォーマットで、多くの2FAツールでエクスポート/インポート対応されています。

## セキュリティ設計

| 項目 | 仕様 |
|---|---|
| 鍵導出 | PBKDF2-HMAC-SHA256, 250,000 iterations, 16バイトソルト |
| 対称暗号 | AES-GCM 256bit, 12バイトIV (毎回ランダム生成) |
| 保存場所 | `chrome.storage.local` (ヴォールト) / `chrome.storage.session` (派生鍵、8時間TTL) |
| メモリ揮発 | popupを閉じると `cryptoKey` / `accounts` はメモリから消える |
| CSP | `script-src 'self'; object-src 'self'` (インライン/eval禁止) |
| 通信 | なし (`host_permissions: []`) |
| 外部依存 | なし (Web Crypto APIのみ) |

詳細な設計判断と「やってはいけないこと」は [CLAUDE.md](./CLAUDE.md) を参照。

## ファイル構成

```
manifest.json    Manifest V3 定義
popup.html       UI (setup / unlock / app の3画面 + 2モーダル)
popup.css        ダークテーマ単一CSS
popup.js         状態管理・イベントハンドラ・レンダリング
totp.js          TOTP生成 + Base32デコード + otpauth:// URIパース/ビルド
crypto.js        PBKDF2鍵導出 + AES-GCM暗号化/復号
storage.js       chrome.storage.local / .session のCRUD
icons/           拡張機能アイコン (16/48/128 px)
CLAUDE.md        Claude Code 用のプロジェクト指示書
```

ビルドステップなし。ファイルを直接編集し、`chrome://extensions/` で「更新」ボタンを押すだけで反映されます。

## ライセンス

このリポジトリは個人用ツールとして公開しています。利用は自己責任でお願いします。
