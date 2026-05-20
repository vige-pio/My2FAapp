// マスターパスワードベースの暗号化処理
// PBKDF2-SHA256でパスワードから鍵を導出し、AES-GCM 256bitで暗号化する。

const PBKDF2_ITERATIONS = 250000; // 安全性とポップアップ起動時の解錠速度のバランス
const SALT_LENGTH = 16;           // 128bit
const IV_LENGTH = 12;             // AES-GCM推奨の96bit

// パスワード + ソルト → AES-GCM鍵
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // exportable: chrome.storage.session に raw bytes でキャッシュするため必要
    ['encrypt', 'decrypt']
  );
}

// 平文文字列を暗号化。IVは毎回ランダム生成。
async function encryptString(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(cipher)),
  };
}

// 暗号文を復号。鍵が違う/データ改ざんでは例外発生。
async function decryptString(key, payload) {
  const iv = new Uint8Array(payload.iv);
  const ciphertext = new Uint8Array(payload.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plain);
}

function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}
