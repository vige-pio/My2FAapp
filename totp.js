// TOTP (RFC 6238) 実装。外部依存なし。Web Crypto APIのみ使用。

// Base32デコード (RFC 4648アルファベット: A-Z, 2-7)
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  const bytes = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val < 0) throw new Error('不正なBase32文字: ' + char);
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

// TOTPコード生成
async function generateTOTP(secretBase32, options = {}) {
  const {
    digits = 6,
    period = 30,
    algorithm = 'SHA-1',
    timestamp = Date.now(),
  } = options;

  const counter = Math.floor(timestamp / 1000 / period);

  // カウンタを8バイトBig-Endianに変換
  const counterBytes = new ArrayBuffer(8);
  const view = new DataView(counterBytes);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter % 0x100000000, false);

  const keyBytes = base32Decode(secretBase32);
  if (keyBytes.length === 0) throw new Error('シークレットが空です');

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));

  // 動的トランケーション (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % Math.pow(10, digits)).toString().padStart(digits, '0');
}

// otpauth:// URIをパースしてアカウント情報オブジェクトに変換
function parseOtpAuthUri(uri) {
  if (!uri.startsWith('otpauth://')) {
    throw new Error('otpauth:// で始まるURIを入力してください');
  }
  const url = new URL(uri);
  const type = url.host;
  if (type !== 'totp') throw new Error('TOTPのみサポートしています (HOTPは未対応)');

  // ラベル: "Issuer:account" または "account" 形式
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  let issuer = '';
  let account = label;
  if (label.includes(':')) {
    const idx = label.indexOf(':');
    issuer = label.slice(0, idx).trim();
    account = label.slice(idx + 1).trim();
  }

  const params = url.searchParams;
  const secret = params.get('secret');
  if (!secret) throw new Error('secretパラメータが必要です');

  // issuerクエリパラメータがあれば優先
  const paramIssuer = params.get('issuer');
  if (paramIssuer) issuer = paramIssuer;

  const algoRaw = (params.get('algorithm') || 'SHA1').toUpperCase();
  const algorithm = algoRaw.startsWith('SHA-') ? algoRaw : algoRaw.replace('SHA', 'SHA-');

  return {
    type: 'totp',
    issuer,
    account,
    secret,
    digits: parseInt(params.get('digits') || '6', 10),
    period: parseInt(params.get('period') || '30', 10),
    algorithm,
  };
}

// アカウントオブジェクト → otpauth:// URI
// WinAuth / KeePass / Aegis 等が出力する「1行1 otpauth URI」形式のエクスポート/インポートで使う。
// 仕様: https://github.com/google/google-authenticator/wiki/Key-Uri-Format
function buildOtpAuthUri(acc) {
  if (acc.type && acc.type !== 'totp') {
    throw new Error('TOTPのみエクスポート対応です: ' + acc.type);
  }
  // ラベル部 ("Issuer:account" or "account")。両方URIエンコードした上で ":" で連結。
  const labelParts = [];
  if (acc.issuer) labelParts.push(encodeURIComponent(acc.issuer));
  labelParts.push(encodeURIComponent(acc.account || ''));
  const label = labelParts.join(':');

  const params = new URLSearchParams();
  params.set('secret', acc.secret);
  if (acc.issuer) params.set('issuer', acc.issuer);
  // digits/period/algorithmはデフォルト値以外のときだけ含める (URIが短くなり、Authenticator互換性も上がる)
  if (acc.digits && acc.digits !== 6) params.set('digits', String(acc.digits));
  if (acc.period && acc.period !== 30) params.set('period', String(acc.period));
  if (acc.algorithm && acc.algorithm !== 'SHA-1' && acc.algorithm !== 'SHA1') {
    // otpauthのalgorithmはハイフンなし表記が一般的 (SHA1/SHA256/SHA512)
    params.set('algorithm', acc.algorithm.replace('SHA-', 'SHA'));
  }

  return `otpauth://totp/${label}?${params.toString()}`;
}
