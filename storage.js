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
}
