// ポップアップ全体の状態管理とUIロジック
// 画面遷移: setup → app  または  unlock → app

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// メモリのみに保持。ポップアップを閉じると失われる（再解錠が必要）
let cryptoKey = null;
let accounts = [];
let updateTimer = null;

// ---------- 初期化 ----------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    if (await hasVault()) {
      // セッション鍵が生きていれば自動解錠
      const sessionKey = await loadSessionKey();
      if (sessionKey) {
        try {
          const vault = await loadVault();
          const plaintext = await decryptString(sessionKey, vault.payload);
          cryptoKey = sessionKey;
          accounts = JSON.parse(plaintext);
          enterApp();
          bindGlobalHandlers();
          return;
        } catch (e) {
          // 鍵不一致(ヴォールト再作成等) や 破損 → セッションを捨てて通常解錠へ
          await clearSessionKey();
        }
      }
      showScreen('unlock');
      $('#unlockPassword').focus();
    } else {
      showScreen('setup');
      $('#setupPassword').focus();
    }
  } catch (e) {
    alert('初期化エラー: ' + e.message);
  }
  bindGlobalHandlers();
});

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.add('hidden'));
  if (name === 'setup') $('#setupScreen').classList.remove('hidden');
  else if (name === 'unlock') $('#unlockScreen').classList.remove('hidden');
  else if (name === 'app') $('#appScreen').classList.remove('hidden');
}

// ---------- 画面別ハンドラ ----------

function bindGlobalHandlers() {
  // セットアップ画面
  $('#setupBtn').addEventListener('click', onSetup);
  $('#setupPasswordConfirm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSetup();
  });

  // 解錠画面
  $('#unlockBtn').addEventListener('click', onUnlock);
  $('#unlockPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onUnlock();
  });
  $('#resetBtn').addEventListener('click', onReset);

  // メイン画面
  $('#lockBtn').addEventListener('click', onLock);
  $('#addBtn').addEventListener('click', openAddModal);

  // モーダル
  $('#cancelBtn').addEventListener('click', closeAddModal);
  $('#saveBtn').addEventListener('click', onSaveAccount);
  $('#addModal').addEventListener('click', (e) => {
    if (e.target === $('#addModal')) closeAddModal();
  });
  $$('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });
}

async function onSetup() {
  const errEl = $('#setupError');
  errEl.textContent = '';
  const pw = $('#setupPassword').value;
  const pw2 = $('#setupPasswordConfirm').value;

  if (pw.length < 8) {
    errEl.textContent = 'パスワードは8文字以上にしてください';
    return;
  }
  if (pw !== pw2) {
    errEl.textContent = 'パスワードが一致しません';
    return;
  }

  try {
    $('#setupBtn').disabled = true;
    $('#setupBtn').textContent = '設定中...';
    cryptoKey = await createVault(pw);
    accounts = [];
    await saveSessionKey(cryptoKey);
    // パスワードフィールドをクリア
    $('#setupPassword').value = '';
    $('#setupPasswordConfirm').value = '';
    enterApp();
  } catch (e) {
    errEl.textContent = '設定失敗: ' + e.message;
  } finally {
    $('#setupBtn').disabled = false;
    $('#setupBtn').textContent = '設定する';
  }
}

async function onUnlock() {
  const errEl = $('#unlockError');
  errEl.textContent = '';
  const pw = $('#unlockPassword').value;
  if (!pw) {
    errEl.textContent = 'パスワードを入力してください';
    return;
  }

  try {
    $('#unlockBtn').disabled = true;
    $('#unlockBtn').textContent = '解除中...';
    const result = await unlockVault(pw);
    cryptoKey = result.key;
    accounts = result.accounts;
    await saveSessionKey(cryptoKey);
    $('#unlockPassword').value = '';
    enterApp();
  } catch (e) {
    errEl.textContent = e.message;
    $('#unlockPassword').select();
  } finally {
    $('#unlockBtn').disabled = false;
    $('#unlockBtn').textContent = '解除';
  }
}

async function onReset() {
  if (!confirm('本当にヴォールトをリセットしますか？\n保存されている全アカウント情報が削除されます。')) {
    return;
  }
  if (!confirm('最終確認: この操作は取り消せません。本当に削除しますか？')) {
    return;
  }
  await destroyVault();
  cryptoKey = null;
  accounts = [];
  showScreen('setup');
  $('#setupPassword').focus();
}

async function onLock() {
  // 明示的なロック → セッションキャッシュも破棄して次回パスワード必須にする
  cryptoKey = null;
  accounts = [];
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  await clearSessionKey();
  showScreen('unlock');
  $('#unlockPassword').focus();
}

function enterApp() {
  showScreen('app');
  render();
  if (!updateTimer) {
    updateTimer = setInterval(updateCodes, 1000);
  }
}

// ---------- アカウント一覧描画 ----------

function render() {
  const list = $('#accountList');
  if (accounts.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <p>アカウントがまだ登録されていません。</p>
        <p>右上の「+」から追加してください。</p>
      </div>
    `;
    return;
  }

  list.innerHTML = accounts.map(acc => `
    <div class="account-card" data-id="${escapeHtml(acc.id)}">
      <div class="account-header">
        <div class="account-info">
          <div class="issuer">${escapeHtml(acc.issuer || '(unnamed)')}</div>
          <div class="account">${escapeHtml(acc.account || '')}</div>
        </div>
        <button class="delete-btn" data-id="${escapeHtml(acc.id)}" title="削除">×</button>
      </div>
      <div class="code-row">
        <div class="code" data-code-for="${escapeHtml(acc.id)}">------</div>
        <div class="progress-ring">
          <svg width="32" height="32">
            <circle cx="16" cy="16" r="14" class="ring-bg"/>
            <circle cx="16" cy="16" r="14" class="ring-fg" data-ring-for="${escapeHtml(acc.id)}"/>
          </svg>
          <span class="seconds" data-seconds-for="${escapeHtml(acc.id)}"></span>
        </div>
      </div>
    </div>
  `).join('');

  $$('.code').forEach(el => {
    el.addEventListener('click', () => copyCode(el));
  });
  $$('.delete-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onDeleteAccount(el.dataset.id);
    });
  });

  updateCodes();
}

async function updateCodes() {
  if (!cryptoKey) return; // ロック中
  const now = Date.now();
  for (const acc of accounts) {
    const codeEl = document.querySelector(`[data-code-for="${acc.id}"]`);
    try {
      const code = await generateTOTP(acc.secret, {
        digits: acc.digits,
        period: acc.period,
        algorithm: acc.algorithm,
        timestamp: now,
      });
      if (codeEl) {
        codeEl.classList.remove('error');
        // 半分で区切って読みやすく
        const half = Math.floor(code.length / 2);
        const formatted = code.slice(0, half) + ' ' + code.slice(half);
        // .copied表示中は上書きしない
        if (!codeEl.classList.contains('copied')) {
          codeEl.textContent = formatted;
          codeEl.dataset.rawCode = code;
        }
      }
    } catch (e) {
      if (codeEl) {
        codeEl.textContent = 'ERROR';
        codeEl.classList.add('error');
        codeEl.title = e.message;
      }
    }

    // プログレスリング更新
    const elapsed = (now / 1000) % acc.period;
    const remaining = acc.period - elapsed;
    const ratio = remaining / acc.period;
    const circumference = 2 * Math.PI * 14;
    const ring = document.querySelector(`[data-ring-for="${acc.id}"]`);
    if (ring) {
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference * (1 - ratio));
      ring.classList.toggle('warning', remaining <= 5);
    }
    const sec = document.querySelector(`[data-seconds-for="${acc.id}"]`);
    if (sec) sec.textContent = Math.ceil(remaining);
  }
}

async function copyCode(el) {
  const code = el.dataset.rawCode || el.textContent.replace(/\s/g, '');
  try {
    await navigator.clipboard.writeText(code);
    el.classList.add('copied');
    const orig = el.textContent;
    el.textContent = 'コピーしました';
    setTimeout(() => {
      el.textContent = orig;
      el.classList.remove('copied');
    }, 800);
  } catch (e) {
    alert('クリップボードへのコピーに失敗しました: ' + e.message);
  }
}

async function onDeleteAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  if (!confirm(`「${acc.issuer || acc.account || '(unnamed)'}」を削除しますか？\nこの操作は取り消せません。`)) {
    return;
  }
  accounts = accounts.filter(a => a.id !== id);
  try {
    await persistAccounts(cryptoKey, accounts);
    render();
  } catch (e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

// ---------- 追加モーダル ----------

function openAddModal() {
  $('#addModal').classList.remove('hidden');
  $('#addError').textContent = '';
  $('#uriInput').value = '';
  $('#manualIssuer').value = '';
  $('#manualAccount').value = '';
  $('#manualSecret').value = '';
  switchTab('uri');
  $('#uriInput').focus();
}

function closeAddModal() {
  $('#addModal').classList.add('hidden');
}

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== name));
  const focusEl = name === 'uri' ? $('#uriInput') : $('#manualIssuer');
  if (focusEl) focusEl.focus();
}

async function onSaveAccount() {
  const errEl = $('#addError');
  errEl.textContent = '';

  const activeTab = document.querySelector('.tab.active').dataset.tab;
  let account;

  try {
    if (activeTab === 'uri') {
      const uri = $('#uriInput').value.trim();
      if (!uri) throw new Error('URIを入力してください');
      account = parseOtpAuthUri(uri);
    } else {
      const secret = $('#manualSecret').value.trim();
      if (!secret) throw new Error('シークレットを入力してください');
      const algoVal = $('#manualAlgo').value; // SHA1 / SHA256 / SHA512
      account = {
        type: 'totp',
        issuer: $('#manualIssuer').value.trim(),
        account: $('#manualAccount').value.trim(),
        secret,
        digits: parseInt($('#manualDigits').value, 10),
        period: parseInt($('#manualPeriod').value, 10),
        algorithm: algoVal.replace('SHA', 'SHA-'),
      };
      if (!account.issuer && !account.account) {
        throw new Error('サービス名またはアカウント名のいずれかを入力してください');
      }
    }

    if (!Number.isFinite(account.digits) || account.digits < 6 || account.digits > 10) {
      throw new Error('桁数は6〜10の範囲で指定してください');
    }
    if (!Number.isFinite(account.period) || account.period < 1) {
      throw new Error('周期は1秒以上で指定してください');
    }

    // 妥当性確認のため一度生成してみる
    await generateTOTP(account.secret, {
      digits: account.digits,
      period: account.period,
      algorithm: account.algorithm,
    });

    account.id = crypto.randomUUID();
    account.createdAt = Date.now();
    accounts.push(account);
    await persistAccounts(cryptoKey, accounts);
    closeAddModal();
    render();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ---------- ユーティリティ ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
