// chrome.storage.local を使ったヴォールト永続化処理
// 保存形式:
// {
//   vault: {
//     version: 1,
//     salt: number[],            // PBKDF2用ソルト
//     payload: { iv, ciphertext } // 暗号化されたアカウント配列(JSON)
//   }
// }

const VAULT_KEY = 'vault';

// セッション鍵キャッシュ (chrome.storage.session = ブラウザ終了で消える揮発ストレージ)
// パスワード入力の手間を減らすため、解錠後 SESSION_TTL_MS の間は自動解錠する。
// session storage は他拡張・Webページから読めない & ディスクに書かれないため、
// 暗号化された storage.local より一段揮発性の高い場所として安全側に倒している。
const SESSION_KEY_RAW = 'sessionKeyRaw';   // AES-GCM鍵のraw bytes (number[])
const SESSION_EXPIRES = 'sessionExpiresAt'; // unix ms
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8時間。最後のアクセスから (sliding window)

async function loadVault() {
  const r = await chrome.storage.local.get(VAULT_KEY);
  return r[VAULT_KEY] || null;
}

async function saveVault(vault) {
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
}

async function hasVault() {
  return (await loadVault()) !== null;
}

// 新規ヴォールトを作成。空のアカウント配列を暗号化して保存し、鍵を返す。
async function createVault(password) {
  const salt = generateSalt();
  const key = await deriveKey(password, salt);
  const payload = await encryptString(key, JSON.stringify([]));
  await saveVault({
    version: 1,
    salt: Array.from(salt),
    payload,
  });
  return key;
}

// パスワードでヴォールトを解錠。鍵とアカウント配列を返す。
async function unlockVault(password) {
  const vault = await loadVault();
  if (!vault) throw new Error('ヴォールトが存在しません');
  const salt = new Uint8Array(vault.salt);
  const key = await deriveKey(password, salt);
  let plaintext;
  try {
    plaintext = await decryptString(key, vault.payload);
  } catch (e) {
    // 復号失敗 = パスワード不一致 or データ破損
    throw new Error('パスワードが違います');
  }
  const accounts = JSON.parse(plaintext);
  return { key, accounts };
}

// 既存ヴォールトのpayloadを更新（同じソルト・鍵を保持）
async function persistAccounts(key, accounts) {
  const vault = await loadVault();
  if (!vault) throw new Error('ヴォールトが存在しません');
  vault.payload = await encryptString(key, JSON.stringify(accounts));
  await saveVault(vault);
}

// ヴォールトを完全削除（パスワード忘れた時の最終手段）
async function destroyVault() {
  await chrome.storage.local.remove(VAULT_KEY);
  await clearSessionKey();
}

// ---------- セッション鍵キャッシュ ----------

// 解錠した鍵をセッションに保存。次回ポップアップ起動時のパスワード入力をスキップさせる。
async function saveSessionKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.session.set({
    [SESSION_KEY_RAW]: Array.from(new Uint8Array(raw)),
    [SESSION_EXPIRES]: Date.now() + SESSION_TTL_MS,
  });
}

// セッションから鍵を復元。期限切れ or 不在ならnull。
// 復元成功時は sliding window として有効期限を再延長する。
async function loadSessionKey() {
  const r = await chrome.storage.session.get([SESSION_KEY_RAW, SESSION_EXPIRES]);
  const raw = r[SESSION_KEY_RAW];
  const expiresAt = r[SESSION_EXPIRES];
  if (!raw || !expiresAt) return null;
  if (Date.now() > expiresAt) {
    await clearSessionKey();
    return null;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(raw),
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  // 使われた = まだアクティブなので期限を延長
  await chrome.storage.session.set({
    [SESSION_EXPIRES]: Date.now() + SESSION_TTL_MS,
  });
  return key;
}

async function clearSessionKey() {
  await chrome.storage.session.remove([SESSION_KEY_RAW, SESSION_EXPIRES]);
}
