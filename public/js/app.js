const socket = io();

let myRoomId = '';
let myId = '';
let myPlayerId = localStorage.getItem('daifugo-player-id-v1') || '';
let isHost = false;
let currentHand = [];
let selectedCardIds = new Set();
let pendingSideSelection = null;
let pendingExchangeSelection = null;
let activeJoinRequest = null;
let latestGameState = null;
let previousFieldCards = [];
let turnCountdownInterval = null;
let errorTimer = null;
const TABLE_SEAT_GAP = 20;

function clearSelectionState() {
  selectedCardIds.clear();
  pendingSideSelection = null;
}

const RECOVERY_KEY = 'daifugo-room-recovery-v1';

const RULE_LABELS = {
  eightCut: '8切り',
  revolution: '革命',
  suitLock: 'マーク縛り',
  spe3: 'スペ3返し',
  staircase: '階段',
  staircaseRevolution: '階段革命',
  elevenBack: 'Jバック',
  numberLock: '数字縛り',
  fiveSkip: '5飛び',
  sevenPass: '7渡し',
  tenDiscard: '10捨て',
  forbiddenFinish: '禁止上がり',
  miyakoOchi: '都落ち',
  dia3Start: '♢3スタート',
  includeJoker: 'ジョーカー'
};

const RULE_DETAILS = {
  eightCut: '8を含む出し方で場を流す',
  revolution: '4枚以上を同時に出すと、カードの強さが反転する',
  suitLock: '同じマークのカードだけが続けて出せるようになる',
  spe3: '♠3を使ってJOKERの場を返し、次の場を作り直す',
  staircase: '同じマークの連番を出せる',
  staircaseRevolution: '同じマークの連番4枚以上で革命を起こす',
  elevenBack: 'Jを含む出し方で、場が流れるまで強さが逆転する',
  numberLock: 'マークを問わず、同じ枚数で数字が連続した後は次の数字だけ出せる',
  fiveSkip: '5を含む出し方で飛ばし、人数超過時は自分の番に戻る',
  sevenPass: '7を出すと次の人へ枚数分を受け渡す',
  tenDiscard: '10を出すと、手札から1枚を捨てる',
  forbiddenFinish: '最後の1枚で上がるのは禁止',
  miyakoOchi: '前回の大富豪が失敗した場合、都落ちの判定が入る',
  dia3Start: '♦3を持つ人からスタートする',
  includeJoker: 'ジョーカーを含めてゲームを進行する'
};

const FIXED_RULE_KEYS = new Set([
  'eightCut',
  'revolution',
  'suitLock',
  'spe3',
  'forbiddenFinish',
  'miyakoOchi',
  'dia3Start',
  'includeJoker'
]);

const SWITCHABLE_RULE_KEYS = [
  'staircase',
  'staircaseRevolution',
  'elevenBack',
  'numberLock',
  'fiveSkip',
  'sevenPass',
  'tenDiscard'
];

const RULE_DISPLAY_ORDER = [
  'revolution',
  'suitLock',
  'spe3',
  'staircase',
  'staircaseRevolution',
  'forbiddenFinish',
  'miyakoOchi',
  'dia3Start',
  'includeJoker',
  'numberLock',
  'fiveSkip',
  'sevenPass',
  'eightCut',
  'tenDiscard',
  'elevenBack'
];

const RULE_DISPLAY_ORDER_INDEX = new Map(
  RULE_DISPLAY_ORDER.map((key, index) => [key, index])
);

function sortRulesForDisplay(items) {
  return [...items].sort((left, right) =>
    (RULE_DISPLAY_ORDER_INDEX.get(left.key ?? left) ?? Number.MAX_SAFE_INTEGER)
      - (RULE_DISPLAY_ORDER_INDEX.get(right.key ?? right) ?? Number.MAX_SAFE_INTEGER)
  );
}

const ROLE_CLASSES = {
  '大富豪': 'role-daifugo',
  '富豪': 'role-fugo',
  '平民': 'role-heimin',
  '貧民': 'role-hinmin',
  '大貧民': 'role-daihinmin'
};

const ROLE_POINTS = {
  '大富豪': 2,
  '富豪': 1,
  '平民': 0,
  '貧民': -1,
  '大貧民': -2
};

const CPU_DIFFICULTY_LABELS = {
  easy: 'かんたん',
  normal: 'ふつう',
  hard: '強い'
};

function getRoleBadge(role) {
  if (!role) return '';
  return `<span class="role-badge ${ROLE_CLASSES[role] || ''}">${role}</span>`;
}
function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function getOpponentSeatLayout(playerCount, index, stageWidth, seatWidth, stageHeight, fieldHeight, seatHeight) {
  const safeCount = Math.max(1, playerCount);
  const topRowCount = Math.ceil(safeCount / 2);
  const isTopRow = index < topRowCount;
  const rowIndex = isTopRow ? index : index - topRowCount;
  const rowCount = isTopRow ? topRowCount : safeCount - topRowCount;
  const edgePercent = (seatWidth / 2 / stageWidth) * 100;
  const rowOffsetPercent = ((fieldHeight + seatHeight) / 2 + TABLE_SEAT_GAP) / stageHeight * 100;
  const x = rowCount === 1
    ? 50
    : edgePercent + ((100 - edgePercent * 2) * rowIndex) / (rowCount - 1);

  return {
    x,
    y: isTopRow ? 50 - rowOffsetPercent : 50 + rowOffsetPercent
  };
}

socket.on('connect', () => {
  myId = socket.id;
  console.log('Socket接続成功: ID =', myId);
});

// エラー表示処理（アラートを使わずページ上に表示）
function showError(msg) {
  const isGameVisible = document.getElementById('game-container').style.display !== 'none';
  const targetElement = isGameVisible 
    ? document.getElementById('game-error') 
    : document.getElementById('lobby-error');

  if (!targetElement) return;

  targetElement.innerText = msg;
  targetElement.style.display = 'block';

  if (errorTimer) clearTimeout(errorTimer);

  errorTimer = setTimeout(() => {
    targetElement.style.display = 'none';
  }, 4000);
}

function clearError() {
  const gameError = document.getElementById('game-error');
  const lobbyError = document.getElementById('lobby-error');
  if (gameError) gameError.style.display = 'none';
  if (lobbyError) lobbyError.style.display = 'none';
  if (errorTimer) clearTimeout(errorTimer);
}

function saveRecoveryState() {
  const roomId = (myRoomId || '').trim();
  const playerName = (
    document.getElementById('join-player-name')?.value ||
    document.getElementById('create-player-name')?.value ||
    ''
  ).trim();

  if (!roomId || !playerName) return;

  if (!myPlayerId) {
    myPlayerId = localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);
  }

  localStorage.setItem(RECOVERY_KEY, JSON.stringify({ roomId, playerName, playerId: myPlayerId, savedAt: Date.now() }));
}

function clearRecoveryState() {
  localStorage.removeItem(RECOVERY_KEY);
}

function restoreRecoveryState() {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) return;

  try {
    const stored = JSON.parse(raw);
    if (!stored.roomId || !stored.playerName) return;

    myPlayerId = stored.playerId || localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);

    const joinNameInput = document.getElementById('join-player-name');
    const createNameInput = document.getElementById('create-player-name');

    if (joinNameInput) joinNameInput.value = stored.playerName;
    if (createNameInput) createNameInput.value = stored.playerName;

    const requestRestoreCheck = () => {
      socket.emit('check-room-exists', stored.roomId);
    };

    if (socket.connected) {
      requestRestoreCheck();
    } else {
      socket.once('connect', requestRestoreCheck);
    }
  } catch (error) {
    console.warn('復帰情報の読み込みに失敗しました:', error);
    clearRecoveryState();
  }
}

socket.on('room-exists', ({ roomId, exists }) => {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) return;

  try {
    const stored = JSON.parse(raw);
    if (!stored || !stored.roomId || stored.roomId !== roomId) return;

    if (!exists) {
      clearRecoveryState();
      return;
    }

    const shouldRestore = window.confirm('前回の部屋に再入室しますか？\n\n' + stored.roomId);
    if (shouldRestore) {
      socket.emit('join-room', { roomId: stored.roomId, playerName: stored.playerName, playerId: myPlayerId });
    } else {
      clearRecoveryState();
    }
  } catch (error) {
    console.warn('復帰確認に失敗しました:', error);
    clearRecoveryState();
  }
});

socket.on('error', (msg) => {
  console.warn('サーバーエラー受信:', msg);
  showError(msg);
});

function showJoinRequestModal(mode, data) {
  const modal = document.getElementById('join-request-modal');
  const title = document.getElementById('join-request-title');
  const message = document.getElementById('join-request-message');
  const actions = document.getElementById('join-request-actions');
  if (!modal || !title || !message || !actions) return;

  activeJoinRequest = data;
  title.innerText = mode === 'host' ? '途中参加の申請' : '途中参加を申請しました';
  message.innerText = mode === 'host'
    ? `${data.playerName} さんが途中参加を希望しています。`
    : data.message;
  actions.innerHTML = mode === 'host'
    ? '<button class="primary-btn" type="button" onclick="approveJoinRequest()">許可</button><button class="secondary-btn" type="button" onclick="rejectJoinRequest()">拒否</button>'
    : '<button class="secondary-btn" type="button" onclick="closeJoinRequestModal()">閉じる</button>';
  modal.style.display = 'flex';
}

function closeJoinRequestModal() {
  const modal = document.getElementById('join-request-modal');
  if (modal) modal.style.display = 'none';
  activeJoinRequest = null;
}

function approveJoinRequest() {
  if (!activeJoinRequest) return;
  socket.emit('approve-join-request', {
    roomId: activeJoinRequest.roomId,
    requestId: activeJoinRequest.requestId
  });
}

function rejectJoinRequest() {
  if (!activeJoinRequest) return;
  socket.emit('reject-join-request', {
    roomId: activeJoinRequest.roomId,
    requestId: activeJoinRequest.requestId
  });
}

socket.on('join-request-pending', (data) => {
  showJoinRequestModal('requester', data);
});

socket.on('join-request-received', (data) => {
  showJoinRequestModal('host', data);
});

socket.on('join-request-resolved', () => {
  closeJoinRequestModal();
});

socket.on('join-request-result', (data) => {
  showJoinRequestModal('requester', {
    message: data.message || '参加申請の結果を受信しました。'
  });
});

socket.on('turn-timer-paused', ({ roomId }) => {
  if (roomId !== myRoomId) return;
  if (latestGameState) latestGameState.turnDeadlineAt = null;
  renderTurnCountdown(null);
});

// タブ切り替え（ルーム作成 / ルーム参加）
function switchTab(tab) {
  clearError();
  const tabCreate = document.getElementById('tab-create');
  const tabJoin = document.getElementById('tab-join');
  const formCreate = document.getElementById('form-create');
  const formJoin = document.getElementById('form-join');

  if (tab === 'create') {
    tabCreate.classList.add('active');
    tabJoin.classList.remove('active');
    formCreate.style.display = 'flex';
    formJoin.style.display = 'none';
  } else {
    tabJoin.classList.add('active');
    tabCreate.classList.remove('active');
    formJoin.style.display = 'flex';
    formCreate.style.display = 'none';
  }
}

// ルーム作成
function createRoom() {
  clearError();
  const name = document.getElementById('create-player-name').value.trim();
  const roomId = document.getElementById('create-room-id').value.trim();
  const gameType = document.getElementById('game-type-select')?.value || 'daifugo';

  if (!name) {
    showError('プレイヤー名を入力してください');
    return;
  }
  if (!roomId) {
    showError('合言葉を入力してください');
    return;
  }

  const rules = {
    // 常時ON（固定ルール）
    revolution: true,
    suitLock: true,
    spe3: true,
    forbiddenFinish: true,
    miyakoOchi: true,
    dia3Start: true,
    includeJoker: true,
    eightCut: true,
    // 切り替え可能ルール
    staircase: document.getElementById('rule-staircase')?.checked ?? true,
    staircaseRevolution: document.getElementById('rule-staircaseRevolution')?.checked ?? true,
    elevenBack: document.getElementById('rule-elevenBack').checked,
    numberLock: document.getElementById('rule-numberLock')?.checked ?? true,
    fiveSkip: document.getElementById('rule-fiveSkip').checked,
    sevenPass: document.getElementById('rule-sevenPass')?.checked ?? true,
    tenDiscard: document.getElementById('rule-tenDiscard').checked
  };

  if (!myPlayerId) {
    myPlayerId = localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);
  }

  myRoomId = roomId;
  console.log('ルーム作成リクエスト送信:', { roomId, playerName: name, playerId: myPlayerId, gameType, rules });
  socket.emit('create-room', { roomId, playerName: name, playerId: myPlayerId, gameType, rules });
}

// ルーム参加
function joinRoom() {
  clearError();
  const name = document.getElementById('join-player-name').value.trim();
  const roomId = document.getElementById('join-room-id').value.trim();

  if (!name) {
    showError('プレイヤー名を入力してください');
    return;
  }
  if (!roomId) {
    showError('合言葉を入力してください');
    return;
  }

  if (!myPlayerId) {
    myPlayerId = localStorage.getItem('daifugo-player-id-v1') || crypto.randomUUID();
    localStorage.setItem('daifugo-player-id-v1', myPlayerId);
  }

  myRoomId = roomId;
  console.log('ルーム参加リクエスト送信:', { roomId, playerName: name, playerId: myPlayerId });
  socket.emit('join-room', { roomId, playerName: name, playerId: myPlayerId });
}

socket.on('room-joined', (data) => {
  console.log('ルーム入室完了:', data);
  myRoomId = data.room.roomId;
  myPlayerId = data.playerId || myPlayerId;
  isHost = data.isHost;
  saveRecoveryState();
  updateWaitingRoom(data.room);
});

function resetViewportLayout() {
  const gameContainer = document.getElementById('game-container');

  if (gameContainer) {
    gameContainer.style.transform = 'none';
    gameContainer.style.transformOrigin = '';
    gameContainer.style.width = '';
    gameContainer.style.margin = '';
    gameContainer.style.maxWidth = '';
    gameContainer.style.height = '';
  }
  document.body.style.overflow = 'auto';
}

function getRoomIdFromPath() {
  const rawPath = window.location.pathname || '/';
  const value = decodeURIComponent(rawPath.replace(/^\/+|\/+$/g, ''));
  return value && value !== 'index.html' ? value : '';
}

function syncRoomIdInputFromUrl() {
  const roomIdFromPath = getRoomIdFromPath();
  if (!roomIdFromPath) return;

  const createInput = document.getElementById('create-room-id');
  const joinInput = document.getElementById('join-room-id');
  if (createInput) createInput.value = roomIdFromPath;
  if (joinInput) joinInput.value = roomIdFromPath;
}

async function copyTextToClipboard(text, successMessage) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.left = '-9999px';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      document.body.removeChild(helper);
    }

    showError(successMessage);
    setTimeout(() => {
      clearError();
    }, 1400);
  } catch (error) {
    console.error('コピー失敗:', error);
    showError('コピーに失敗しました');
  }
}

function copyRoomId() {
  const roomId = myRoomId || document.getElementById('display-room-id')?.innerText?.trim() || '';
  if (!roomId) {
    showError('ルームIDが未設定です');
    return;
  }
  copyTextToClipboard(roomId, 'ルームIDをコピーしました');
}

function copyRoomShareLink() {
  const roomId = myRoomId || document.getElementById('create-room-id')?.value?.trim() || document.getElementById('join-room-id')?.value?.trim() || '';
  if (!roomId) {
    showError('共有するルームIDがありません');
    return;
  }

  const url = new URL(window.location.href);
  url.pathname = '/' + encodeURIComponent(roomId);
  url.search = '';
  url.hash = '';
  copyTextToClipboard(url.toString(), '共有URLをコピーしました');
}

function resetToLobbyView() {
  const lobbyContainer = document.getElementById('lobby-container');
  const waitingArea = document.getElementById('waiting-area');
  const lobbyFormArea = document.getElementById('lobby-form-area');
  const gameContainer = document.getElementById('game-container');
  const gameFinishedModal = document.getElementById('game-finished-modal');
  const rulesModal = document.getElementById('rules-modal');
  const overallRankingModal = document.getElementById('overall-ranking-modal');

  if (lobbyContainer) lobbyContainer.style.display = 'block';
  if (waitingArea) waitingArea.style.display = 'none';
  if (lobbyFormArea) {
    lobbyFormArea.style.display = 'flex';
    lobbyFormArea.style.flexDirection = 'column';
    lobbyFormArea.style.width = '100%';
  }
  if (gameContainer) gameContainer.style.display = 'none';
  if (gameFinishedModal) gameFinishedModal.style.display = 'none';
  if (rulesModal) rulesModal.style.display = 'none';
  if (overallRankingModal) overallRankingModal.style.display = 'none';
  renderTurnCountdown(null);
  document.body.classList.remove('revolution-mode');
  document.body.classList.remove('game-active');
  document.documentElement.classList.remove('revolution-mode');

  resetViewportLayout();

  clearSelectionState();
  pendingExchangeSelection = null;
  latestGameState = null;
  previousFieldCards = [];
  currentHand = [];
  selectedCardIds.clear();
}

socket.on('room-closed', ({ roomId }) => {
  clearRecoveryState();

  if (myRoomId === roomId) {
    myRoomId = '';
    isHost = false;
    resetToLobbyView();
  }

  showError('ホストがルームを閉じました。');
});

socket.on('room-updated', (roomData) => {
  console.log('ルーム更新通知:', roomData);
  updateWaitingRoom(roomData);
});

function updateWaitingRoom(room) {
  document.getElementById('lobby-form-area').style.display = 'none';
  document.getElementById('waiting-area').style.display = 'block';

  myRoomId = room.roomId;
  document.getElementById('display-room-id').innerText = room.roomId;
  document.getElementById('player-count').innerText = room.players.length;
  document.getElementById('room-max-players').innerText = room.maxPlayers || 8;
  const cpuCount = room.players.filter(player => player.isCpu).length;
  document.getElementById('cpu-count').innerText = cpuCount;

  renderRuleBadges('display-rules', room.rules);

  const currentSocketId = socket.id || myId;
  const playersList = document.getElementById('players-list');
  playersList.innerHTML = room.players.map(p => {
    const isMe = p.id === currentSocketId;
    const isRoomHost = p.id === room.hostId;
    return `
      <div class="player-item ${isMe ? 'is-me' : ''} ${p.isCpu ? 'is-cpu' : ''}">
        <span>${escapeHtml(p.name)} ${p.isCpu ? `<span class="cpu-tag">${CPU_DIFFICULTY_LABELS[p.difficulty] || 'ふつう'}</span>` : getRoleBadge(p.role)} ${isMe ? '<strong>(あなた)</strong>' : ''}</span>
        ${isRoomHost ? '<span class="host-tag">ホスト</span>' : ''}
      </div>
    `;
  }).join('');

  const hostControls = document.getElementById('host-controls');
  const guestMsg = document.getElementById('guest-waiting-msg');
  const startBtn = document.getElementById('start-btn');
  const startHint = document.getElementById('host-start-hint');
  const addCpuBtn = document.getElementById('add-cpu-btn');
  const removeCpuBtn = document.getElementById('remove-cpu-btn');
  const roomLockBtn = document.getElementById('room-lock-btn');
  const roomLockStatus = document.getElementById('room-lock-status');

  const amIHost = isHost || (room.hostId === currentSocketId);

  if (amIHost) {
    hostControls.style.display = 'block';
    guestMsg.style.display = 'none';
    addCpuBtn.disabled = room.players.length >= 8;
    removeCpuBtn.disabled = cpuCount === 0;
    roomLockBtn.dataset.locked = String(!!room.isLocked);
    roomLockBtn.innerText = room.isLocked ? 'ロック解除' : 'ルームをロック';
    roomLockStatus.style.display = room.isLocked ? 'block' : 'none';
    roomLockStatus.innerText = room.isLocked ? 'ロック中：新しい参加者は入室できません' : '';
    if (room.players.length >= 2) {
      startBtn.disabled = false;
      startHint.innerText = '準備完了！ゲームを開始できます。';
    } else {
      startBtn.disabled = true;
      startHint.innerText = '2人以上揃うとゲームを開始できます（現在1人）';
    }
  } else {
    hostControls.style.display = 'none';
    guestMsg.style.display = 'block';
  }
}

function addCpuPlayer() {
  if (myRoomId) {
    const difficulty = document.getElementById('cpu-difficulty-select')?.value || 'normal';
    socket.emit('add-cpu-player', { roomId: myRoomId, difficulty });
  }
}

function removeCpuPlayer() {
  if (myRoomId) socket.emit('remove-cpu-player', myRoomId);
}

function toggleRoomLock() {
  if (!myRoomId) return;
  const roomLockBtn = document.getElementById('room-lock-btn');
  socket.emit('set-room-lock', {
    roomId: myRoomId,
    isLocked: roomLockBtn.dataset.locked !== 'true'
  });
}

function renderRuleBadges(elementId, rules) {
  const container = document.getElementById(elementId);
  if (!container || !rules) return;

  const visibleKeys = sortRulesForDisplay(SWITCHABLE_RULE_KEYS.filter(k => rules[k]));
  const badges = visibleKeys.map(k => `<span class="badge">${RULE_LABELS[k] || k}</span>`);

  container.innerHTML = badges.length > 0 ? badges.join('') : '<span class="badge">ルール追加なし</span>';
}

function renderRulesModal(rules) {
  const modalBody = document.getElementById('rules-modal-body');
  if (!modalBody) return;

  const enabledRules = Object.keys(rules || {})
    .filter(k => rules[k])
    .map(k => ({ key: k, label: RULE_LABELS[k] || k, detail: RULE_DETAILS[k] || 'ルール適用中' }));

  const switchable = sortRulesForDisplay(enabledRules.filter(rule => SWITCHABLE_RULE_KEYS.includes(rule.key)));
  const fixed = sortRulesForDisplay(enabledRules.filter(rule => FIXED_RULE_KEYS.has(rule.key)));

  const renderSection = (title, items) => {
    if (items.length === 0) return '';
    return `
      <div class="rules-section-group">
        <h3>${title}</h3>
        ${items.map(rule => `
          <div class="rules-modal-item">
            <strong>${rule.label}</strong>
            <span>${rule.detail}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  if (enabledRules.length === 0) {
    modalBody.innerHTML = '<div class="rules-modal-item"><strong>有効ルール</strong>このゲームでは追加ルールが有効化されていません。</div>';
    return;
  }

  modalBody.innerHTML = `
    ${renderSection('選択中のルール', switchable)}
    ${renderSection('固定ルール', fixed)}
  `;
}

function closeCurrentRoom() {
  if (!myRoomId) return;

  const confirmClose = window.confirm('ホストがルームを閉じますか？\n\nこのルームに参加している人は全員退出します。');
  if (!confirmClose) return;

  socket.emit('close-room', myRoomId);
}

function toggleRulesModal(forceOpen) {
  const modal = document.getElementById('rules-modal');
  if (!modal) return;

  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : modal.style.display === 'none';
  modal.style.display = shouldOpen ? 'flex' : 'none';
}

function startGame() {
  clearError();
  console.log('ゲーム開始リクエスト送信:', myRoomId);
  socket.emit('start-game', myRoomId);
}

function nextRound() {
  document.getElementById('game-finished-modal').style.display = 'none';
  startGame();
}

// ゲーム開始通知
function applyViewportFit() {
  const gameContainer = document.getElementById('game-container');
  const isMobile = window.matchMedia('(max-width: 640px)').matches;

  if (!gameContainer || gameContainer.style.display === 'none' || isMobile) {
    if (gameContainer) {
      gameContainer.style.transform = 'none';
      gameContainer.style.width = '';
      gameContainer.style.margin = '';
      if (isMobile && document.body.classList.contains('game-active')) {
        gameContainer.style.display = 'flex';
      }
    }
    document.body.style.overflow = isMobile && document.body.classList.contains('game-active')
      ? 'hidden'
      : 'auto';
    return;
  }

  const naturalWidth = 820;
  const naturalHeight = 760;
  const maxScaleX = (window.innerWidth - 32) / naturalWidth;
  const maxScaleY = (window.innerHeight - 80) / naturalHeight;
  const scale = Math.min(1, maxScaleX, maxScaleY);

  if (scale < 1) {
    gameContainer.style.transform = `scale(${scale})`;
    gameContainer.style.transformOrigin = 'top center';
    gameContainer.style.width = `${naturalWidth * scale}px`;
    gameContainer.style.margin = '0 auto';
    document.body.style.overflow = 'hidden';
  } else {
    gameContainer.style.transform = 'none';
    gameContainer.style.width = '';
    gameContainer.style.margin = '';
    document.body.style.overflow = 'auto';
  }
}

socket.on('game-started', (data) => {
  console.log('ゲーム開始受信:', data);
  latestGameState = data;
  myRoomId = data.roomId;
  document.body.classList.add('game-active');
  previousFieldCards = [];
  document.getElementById('lobby-container').style.display = 'none';
  document.getElementById('game-container').style.display = window.matchMedia('(max-width: 640px)').matches
    ? 'flex'
    : 'block';
  document.getElementById('game-finished-modal').style.display = 'none';

  document.getElementById('game-room-id').innerText = data.roomId;
  renderRuleBadges('game-rules-badges', data.rules);
  renderRulesModal(data.rules);

  currentHand = data.hand || [];
  clearSelectionState();
  pendingExchangeSelection = null;

  if (data.status === 'waiting-exchange') {
    const requiredCount = data.exchangeRequirements?.[socket.id] || 0;
    if (requiredCount > 0) {
      pendingExchangeSelection = { required: requiredCount, selected: new Set() };
    }
  }

  saveRecoveryState();
  updateUI(data);
  updateHand(currentHand);
  applyViewportFit();
});

// ゲーム状態更新
socket.on('state-updated', (data) => {
  const oldFieldCards = latestGameState?.fieldCards || [];
  const newFieldCards = data.fieldCards || [];
  const fieldChanged = oldFieldCards.length !== newFieldCards.length
    || oldFieldCards.some((card, index) => card.id !== newFieldCards[index]?.id);

  if (newFieldCards.length === 0) {
    previousFieldCards = [];
  } else if (oldFieldCards.length > 0 && fieldChanged) {
    previousFieldCards = [...oldFieldCards];
  } else if (oldFieldCards.length === 0) {
    previousFieldCards = [];
  }

  latestGameState = data;
  clearSelectionState();
  if (data.status === 'waiting-exchange') {
    const requiredCount = data.exchangeRequirements?.[socket.id] || 0;
    if (requiredCount > 0 && (!pendingExchangeSelection || pendingExchangeSelection.required !== requiredCount)) {
      pendingExchangeSelection = { required: requiredCount, selected: new Set() };
    }
    if (requiredCount === 0) {
      pendingExchangeSelection = null;
    }
  } else {
    pendingExchangeSelection = null;
  }
  updateUI(data);
  updateHand(currentHand);
  applyViewportFit();
});

// 手札更新
socket.on('hand-updated', (hand) => {
  currentHand = hand;
  clearSelectionState();
  updateHand(hand);
});

function formatGameActionMessage(message) {
  return String(message || '')
    .replace(/【([^】]+)】/g, '$1 ')
    .replace(/[！!]+/g, '')
    .replace(/[。]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderTurnCountdown(deadlineAt) {
  const timer = document.getElementById('turn-timer');
  if (!timer) return;
  if (turnCountdownInterval) clearInterval(turnCountdownInterval);
  turnCountdownInterval = null;

  if (!deadlineAt) {
    timer.style.display = 'none';
    timer.classList.remove('is-urgent');
    timer.textContent = '';
    return;
  }

  const update = () => {
    const seconds = Math.max(0, Math.ceil((Number(deadlineAt) - Date.now()) / 1000));
    timer.textContent = `残り ${seconds}秒`;
    timer.classList.toggle('is-urgent', seconds <= 5);
    timer.style.display = 'inline-flex';
  };

  update();
  turnCountdownInterval = setInterval(update, 250);
}

function updateUI(data) {
  const currentSocketId = socket.id || myId;
  const isMyTurn = data.turnPlayerId === currentSocketId;
  const turnInfo = document.getElementById('turn-info');
  const turnDetail = document.getElementById('turn-detail');
  const turnControl = document.querySelector('.turn-control-section');
  renderTurnCountdown(data.turnDeadlineAt);

  if (data.status === 'waiting-exchange') {
    const requiredCount = data.exchangeRequirements?.[currentSocketId] || 0;
    turnInfo.innerText = 'カード交換';
    turnDetail.innerText = requiredCount > 0
      ? `${requiredCount}枚選んで確定してください`
      : '交換完了を待っています';
    turnControl.classList.add('is-exchanging');
    turnControl.classList.remove('is-my-turn');
  } else if (isMyTurn) {
    turnInfo.innerText = 'あなたの番';
    turnDetail.innerText = 'カードを選んで出すか、パスしてください';
    turnControl.classList.add('is-my-turn');
    turnControl.classList.remove('is-exchanging');
  } else {
    turnInfo.innerText = `${data.turnPlayerName || '相手'}の番`;
    turnDetail.innerText = '次のプレイを待っています';
    turnControl.classList.remove('is-my-turn', 'is-exchanging');
  }

  const statusBanner = document.getElementById('game-status-banner');
  const statusTags = document.getElementById('game-status-tags');
  const actionMessage = document.getElementById('game-action-message');
  statusTags.replaceChildren();

  const addStatusTag = (text, type = '') => {
    const tag = document.createElement('span');
    tag.className = `game-status-tag${type ? ` ${type}` : ''}`;
    tag.textContent = text;
    statusTags.appendChild(tag);
  };

  const body = document.body;
  const root = document.documentElement;

  if (data.status === 'waiting-exchange') {
    addStatusTag('カード交換中');
    statusBanner.classList.remove('revolution');
    body.classList.remove('revolution-mode');
    root.classList.remove('revolution-mode');
  } else if (data.isRevolution) {
    addStatusTag('革命中', 'is-revolution');
    statusBanner.classList.add('revolution');
    body.classList.add('revolution-mode');
    root.classList.add('revolution-mode');
  } else {
    statusBanner.classList.remove('revolution');
    body.classList.remove('revolution-mode');
    root.classList.remove('revolution-mode');
  }
  if (data.isElevenBack) {
    addStatusTag('Jバック中');
  }
  if (data.lockedSuit) {
    addStatusTag(`${data.lockedSuit}マーク縛り`);
  }
  if (data.lockedNumber) {
    const lockedNumbers = Array.isArray(data.lockedNumber) ? data.lockedNumber : [data.lockedNumber];
    addStatusTag(`数字縛り ${lockedNumbers.join(' → ')}`);
  }

  actionMessage.innerText = formatGameActionMessage(data.actionMessage);
  const hasStatus = statusTags.childElementCount > 0;
  const hasAction = actionMessage.innerText.length > 0;
  statusBanner.style.display = hasStatus || hasAction ? 'flex' : 'none';
  actionMessage.style.display = hasAction ? 'block' : 'none';

  // 場のカード表示
  const fieldEl = document.getElementById('field');
  const previousFieldEl = document.getElementById('previous-field-card');
  if (data.fieldCards && data.fieldCards.length > 0) {
    fieldEl.innerHTML = data.fieldCards.map(c => renderCard(c, false)).join('');
    if (previousFieldEl) {
      previousFieldEl.innerHTML = previousFieldCards.map(card => renderCard(card, false)).join('');
      previousFieldEl.style.display = previousFieldCards.length > 0 ? 'flex' : 'none';
    }
  } else {
    fieldEl.innerHTML = '<span style="color: #bbb;">（場は流れています。好きなカードを出せます）</span>';
    if (previousFieldEl) {
      previousFieldEl.innerHTML = '';
      previousFieldEl.style.display = 'none';
    }
  }

  // 他プレイヤー情報
  const othersEl = document.getElementById('other-players');
  const orderedOthers = data.players.filter(p => p.id !== currentSocketId);
  const seatOrder = orderedOthers.length > 0 ? orderedOthers : [];
  const tableStage = document.querySelector('.table-stage');
  const fieldSection = document.querySelector('.field-section');
  const seatCardHeight = 88;

  if (tableStage) {
    if (window.matchMedia('(max-width: 640px)').matches) {
      tableStage.style.height = '';
    } else {
      tableStage.style.height = '';
      const baseHeight = tableStage.clientHeight || 360;
      const fieldHeight = fieldSection?.offsetHeight || 120;
      const neededHeight = fieldHeight + 2 * (seatCardHeight + TABLE_SEAT_GAP);
      tableStage.style.height = `${Math.max(baseHeight, neededHeight)}px`;
    }
  }

  const stageWidth = tableStage?.clientWidth || 760;
  const stageHeight = tableStage?.clientHeight || 360;
  const fieldHeight = fieldSection?.offsetHeight || 120;

  othersEl.innerHTML = seatOrder.map((p, index) => {
    const isTurn = p.id === data.turnPlayerId;
    const totalCardCount = p.cardCount;
    const topRowCount = Math.ceil(seatOrder.length / 2);
    const seatGap = window.matchMedia('(max-width: 640px)').matches ? 5 : 12;
    const seatCardWidth = Math.min(112, (stageWidth - (topRowCount - 1) * seatGap) / Math.max(topRowCount, 1));
    const spacing = totalCardCount > 12 ? 2.2 : totalCardCount > 6 ? 2.7 : 3.2;
    const stackWidth = Math.max(62, Math.min(96, 42 + totalCardCount * 2.2));
    const stackCards = Array.from({ length: totalCardCount }, (_, idx) => {
      const angle = -24 + (idx * (48 / Math.max(totalCardCount - 1, 1)));
      const left = 12 + idx * spacing;
      const top = 0;
      return `
        <span class="mini-card" style="left:${left}px; top:${top}px; z-index:${totalCardCount - idx}; transform: rotate(${angle}deg);"></span>
      `;
    }).join('');
    const countBadge = `<span class="count-stack-total">${totalCardCount}</span>`;
    const winnerText = p.isWinner ? `<span class="winner-text">🎉 ${p.rank}位</span>` : '';
    const seatPos = getOpponentSeatLayout(
      seatOrder.length,
      index,
      stageWidth,
      seatCardWidth,
      stageHeight,
      fieldHeight,
      seatCardHeight
    );

    return `
      <div class="other-player-card ${isTurn ? 'active-turn' : ''}" data-seat="${index}" style="left:${seatPos.x}%; top:${seatPos.y}%; width:${seatCardWidth}px; height:${seatCardHeight}px; transform: translate(-50%, -50%);">
        <div class="player-name-row">
          <strong>${escapeHtml(p.name)}</strong>
        </div>
        <div class="count-stack" style="width:${stackWidth}px;" aria-label="${p.cardCount}枚残り">
          ${stackCards}
        </div>
        ${countBadge}
        ${winnerText || getRoleBadge(p.role)}
      </div>
    `;
  }).join('');

  if (data.status === 'finished') {
    showGameFinished(data);
  }

  updatePlayButton();
}

// --- ルール判定ヘルパー（スマートアシスト用） ---

function getNumericValue(card) {
  if (!card || card.id === 'JOKER') return null;
  const map = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15 };
  return map[String(card.num)] ?? null;
}

function isStraightSequence(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  const noJoker = cards.filter(c => c.id !== 'JOKER');
  if (noJoker.length < 3) return false;

  const suit = noJoker[0].suit;
  if (noJoker.some(c => c.suit !== suit)) return false;

  const values = noJoker
    .map(c => getNumericValue(c))
    .filter(v => v !== null)
    .sort((a, b) => a - b);

  if (values.length !== new Set(values).size) return false;
  const span = values[values.length - 1] - values[0];
  return span === values.length - 1;
}

function isValidCombination(cards, rules = {}) {
  if (!cards || cards.length === 0) return { valid: false, message: 'カードが選択されていません' };
  if (cards.length === 1) return { valid: true };

  const nonJokers = cards.filter(c => c.id !== 'JOKER');
  if (nonJokers.length === 0) return { valid: true };

  const baseNum = nonJokers[0].num;
  const allSame = nonJokers.every(c => c.num === baseNum);
  if (allSame) return { valid: true };

  if (rules.staircase && isStraightSequence(cards)) {
    return { valid: true };
  }

  return { valid: false, message: '複数枚出す場合は、同じ数字か、同じマークの連番の組み合わせにしてください' };
}

function getPlayStrength(cards) {
  if (cards.length === 1 && cards[0].id === 'JOKER') {
    return 14;
  }
  const nonJokers = cards.filter(c => c.id !== 'JOKER');
  if (nonJokers.length > 0) {
    return nonJokers[0].strength;
  }
  return 14;
}

function isValidPlayClient(playedCards, fieldCards, rules = {}, state = {}) {
  const comboCheck = isValidCombination(playedCards, rules);
  if (!comboCheck.valid) return comboCheck;

  const hasDiamondThree = (currentHand || []).some(c => c.id === '♦3');
  if (hasDiamondThree && !playedCards.some(c => c.id === '♦3')) {
    return { valid: false, message: '♦3を持っている場合は、♦3を含むカードを出してください。' };
  }

  if (!fieldCards || fieldCards.length === 0) {
    return { valid: true };
  }

  const currentCount = fieldCards.length;
  const playCount = playedCards.length;

  // スペ3返し
  if (
    rules.spe3 &&
    currentCount === 1 &&
    fieldCards[0].id === 'JOKER' &&
    playCount === 1 &&
    playedCards[0].id === '♠3'
  ) {
    return { valid: true, isSpe3: true };
  }

  // 枚数一致チェック
  if (playCount !== currentCount) {
    return {
      valid: false,
      message: `場に出ている枚数と同じ枚数（${currentCount}枚）で出してください！`
    };
  }

  // マーク縛り
  if (rules.suitLock && state.lockedSuit) {
    const isViolated = playedCards.some(
      c => c.id !== 'JOKER' && c.suit !== state.lockedSuit
    );
    if (isViolated) {
      return {
        valid: false,
        message: `マーク縛り中です！ [${state.lockedSuit}] のカードしか出せません。`
      };
    }
  }

  // 強さ判定
  const isReversed = (!!state.isRevolution) !== (!!state.isElevenBack);
  const playStrength = getPlayStrength(playedCards);
  const fieldStrength = getPlayStrength(fieldCards);

  const isFieldSingleJoker = currentCount === 1 && fieldCards[0].id === 'JOKER';
  const isPlaySingleJoker = playCount === 1 && playedCards[0].id === 'JOKER';

  if (isPlaySingleJoker) return { valid: true };
  if (isFieldSingleJoker) return { valid: false, message: 'ジョーカーより強いカードはありません！' };

  if (isReversed) {
    if (playStrength >= fieldStrength) {
      return { valid: false, message: '強さ逆転中です！場より弱いカードを出してください！' };
    }
  } else {
    if (playStrength <= fieldStrength) {
      return { valid: false, message: '場に出ているカードより強いカードを出してください！' };
    }
  }

  return { valid: true };
}

/**
 * 手札の各カードが「現在選択可能か」を判定する
 */
function isCardSelectable(card) {
  if (!latestGameState || latestGameState.status !== 'playing') return false;

  const currentSocketId = socket.id || myId;
  const isMyTurn = latestGameState.turnPlayerId === currentSocketId;
  if (!isMyTurn) return false;

  if (selectedCardIds.has(card.id)) return true;

  const fieldCards = latestGameState.fieldCards || [];
  const rules = latestGameState.rules || {};
  const selectedCards = currentHand.filter(c => selectedCardIds.has(c.id));

  const hasDiamondThree = currentHand.some(c => c.id === '♦3');
  if (hasDiamondThree && !selectedCards.some(c => c.id === '♦3') && card.id !== '♦3') {
    return false;
  }

  // --- パターン1: まだ1枚も選択されていないとき ---
  if (selectedCards.length === 0) {
    // 親（場が空）の場合: どのカードでも1枚目として選べる
    if (fieldCards.length === 0) {
      return true;
    }

    const targetCount = fieldCards.length;

    // 場が1枚出しの場合
    if (targetCount === 1) {
      return isValidPlayClient([card], fieldCards, rules, latestGameState).valid;
    }

    // 場が複数枚出しの場合 (targetCount >= 2)
    // このカードを手札と組み合わせて targetCount 枚の出せる手を作れるかチェック
    if (card.id === 'JOKER') {
      const nonJokers = currentHand.filter(c => c.id !== 'JOKER');
      const jokers = currentHand.filter(c => c.id === 'JOKER');
      const uniqueNums = [...new Set(nonJokers.map(c => c.num))];

      return uniqueNums.some(num => {
        const matching = nonJokers.filter(c => c.num === num);
        if (matching.length + jokers.length >= targetCount) {
          const sample = matching.slice(0, targetCount - 1);
          sample.push(card);
          return isValidPlayClient(sample, fieldCards, rules, latestGameState).valid;
        }
        return false;
      });
    } else {
      const sameNumCards = currentHand.filter(c => c.id !== 'JOKER' && c.num === card.num);
      const jokers = currentHand.filter(c => c.id === 'JOKER');

      if (sameNumCards.length + jokers.length < targetCount) {
        return false; // 枚数が足りない
      }

      // サンプル手を作成して判定
      const sample = [...sameNumCards];
      let jIdx = 0;
      while (sample.length < targetCount && jIdx < jokers.length) {
        sample.push(jokers[jIdx++]);
      }
      return isValidPlayClient(sample.slice(0, targetCount), fieldCards, rules, latestGameState).valid;
    }
  }

  // --- パターン2: すでに1枚以上選択されているとき (追加選択) ---
  const targetCount = fieldCards.length > 0 ? fieldCards.length : null;

  // 場の枚数に達している場合は追加選択不可
  if (targetCount && selectedCards.length >= targetCount) {
    return false;
  }
  // 場が空の場合でも最大4枚まで
  if (!targetCount && selectedCards.length >= 4) {
    return false;
  }

  const baseCard = selectedCards.find(c => c.id !== 'JOKER');

  if (card.id === 'JOKER') {
    // JOKERは任意の数字のペアに追加可能
    if (targetCount && selectedCards.length + 1 === targetCount) {
      const candidate = [...selectedCards, card];
      return isValidPlayClient(candidate, fieldCards, rules, latestGameState).valid;
    }
    return true;
  }

  if (baseCard) {
    // 基準カードと同じ数字のみ選択可能
    if (card.num !== baseCard.num) {
      return false;
    }
    if (targetCount && selectedCards.length + 1 === targetCount) {
      const candidate = [...selectedCards, card];
      return isValidPlayClient(candidate, fieldCards, rules, latestGameState).valid;
    }
    return true;
  } else {
    // JOKERのみが選ばれていた場合、最初の数字カードとして追加可能
    if (targetCount && selectedCards.length + 1 === targetCount) {
      const candidate = [...selectedCards, card];
      return isValidPlayClient(candidate, fieldCards, rules, latestGameState).valid;
    }
    return true;
  }
}

function renderCard(card, isClickable = true, isSelected = false, isSelectable = true) {
  const isJoker = card.id === 'JOKER';
  const isRed = card.suit === '♥' || card.suit === '♦';

  let classes = ['card'];
  if (isJoker) classes.push('joker');
  if (isRed) classes.push('red');
  if (isSelected) classes.push('selected');
  if (isClickable && !isSelectable && !isSelected) classes.push('disabled');

  const clickAttr = isClickable ? `onclick="handleCardClick('${card.id}')"` : '';
  const displayText = isJoker ? 'JOKER' : `${card.suit}${card.num}`;

  return `<div class="${classes.join(' ')}" ${clickAttr}><span>${displayText}</span></div>`;
}

// カードクリック処理
function handleCardClick(cardId) {
  clearError();

  if (pendingExchangeSelection) {
    const card = currentHand.find(c => c.id === cardId);
    if (!card) return;

    if (pendingExchangeSelection.selected.has(cardId)) {
      pendingExchangeSelection.selected.delete(cardId);
    } else if (pendingExchangeSelection.selected.size < pendingExchangeSelection.required) {
      pendingExchangeSelection.selected.add(cardId);
    } else {
      showError(`交換は${pendingExchangeSelection.required}枚までです`);
      return;
    }

    updateHand(currentHand);
    updatePlayButton();
    return;
  }

  if (pendingSideSelection) {
    const card = currentHand.find(c => c.id === cardId);
    if (!card || pendingSideSelection.playedCardIds.has(cardId)) return;

    const passSet = pendingSideSelection.passSelected;
    const discardSet = pendingSideSelection.discardSelected;
    const inPass = passSet.has(cardId);
    const inDiscard = discardSet.has(cardId);

    if (inPass || inDiscard) {
      passSet.delete(cardId);
      discardSet.delete(cardId);
    } else {
      const isPassStage = pendingSideSelection.required.pass > 0 && passSet.size < pendingSideSelection.required.pass;
      const isDiscardStage = pendingSideSelection.required.discard > 0 && discardSet.size < pendingSideSelection.required.discard;

      if (isPassStage && pendingSideSelection.required.pass > 0) {
        if (passSet.size >= pendingSideSelection.required.pass) {
          showError(`7渡しは${pendingSideSelection.required.pass}枚までです`);
          return;
        }
        passSet.add(cardId);
      } else if (isDiscardStage && pendingSideSelection.required.discard > 0) {
        if (discardSet.size >= pendingSideSelection.required.discard) {
          showError(`10捨ては${pendingSideSelection.required.discard}枚までです`);
          return;
        }
        discardSet.add(cardId);
      } else if (pendingSideSelection.required.pass > 0) {
        passSet.add(cardId);
      } else if (pendingSideSelection.required.discard > 0) {
        discardSet.add(cardId);
      }
    }

    updateHand(currentHand);
    updatePlayButton();
    return;
  }

  const currentSocketId = socket.id || myId;
  if (!latestGameState || latestGameState.turnPlayerId !== currentSocketId) {
    showError('あなたのターンではありません！');
    return;
  }

  const card = currentHand.find(c => c.id === cardId);
  if (!card) return;

  if (selectedCardIds.has(cardId)) {
    selectedCardIds.delete(cardId);
    updateHand(currentHand);
    updatePlayButton();
    return;
  }

  if (isCardSelectable(card)) {
    selectedCardIds.add(cardId);
    updateHand(currentHand);
    updatePlayButton();
  } else {
    const fieldCards = latestGameState.fieldCards || [];
    const selectedCards = currentHand.filter(c => selectedCardIds.has(c.id));

    if (selectedCards.length > 0) {
      const baseCard = selectedCards.find(c => c.id !== 'JOKER');
      if (baseCard && card.num !== baseCard.num && card.id !== 'JOKER') {
        showError(`複数枚出す場合は、同じ数字（${baseCard.num}）のカードを選択してください`);
        return;
      }
    }

    if (fieldCards.length > 1) {
      showError(`場が${fieldCards.length}枚出しのため、より強い${fieldCards.length}枚の組み合わせを選択してください`);
    } else if (fieldCards.length === 1) {
      showError('場に出ているカードより強いカードを選択してください');
    } else {
      showError('そのカードは現在選択できません');
    }
  }
}

function updatePlayButton() {
  const playBtn = document.getElementById('play-btn');
  const passBtn = document.getElementById('pass-btn');
  if (!playBtn) return;

  const currentSocketId = socket.id || myId;
  const isMyTurn = !!latestGameState && latestGameState.turnPlayerId === currentSocketId;
  const isHandSelection = !!latestGameState && (latestGameState.isHandSelection || latestGameState.isHandShuffling);

  if (pendingExchangeSelection) {
    const count = pendingExchangeSelection.selected.size;
    const required = pendingExchangeSelection.required;
    playBtn.innerText = `交換確定 (${count}/${required}枚)`;
    playBtn.disabled = count !== required;
    passBtn.style.visibility = 'hidden';
    return;
  }

  if (pendingSideSelection) {
    const passNeeded = pendingSideSelection.required.pass;
    const discardNeeded = pendingSideSelection.required.discard;
    const passCount = pendingSideSelection.passSelected.size;
    const discardCount = pendingSideSelection.discardSelected.size;
    const totalOk = passCount >= passNeeded && discardCount >= discardNeeded;
    playBtn.innerText = passNeeded > 0 && discardNeeded > 0
      ? `交換を確定 (${passCount}/${passNeeded} + ${discardCount}/${discardNeeded})`
      : passNeeded > 0
        ? `渡すカード確定 (${passCount}/${passNeeded})`
        : `捨てカード確定 (${discardCount}/${discardNeeded})`;
    playBtn.disabled = !totalOk;
    passBtn.style.visibility = 'hidden';
    return;
  }

  const count = selectedCardIds.size;
  playBtn.innerText = `出す (${count}枚)`;
  passBtn.classList.remove('is-lead-pass');
  passBtn.innerText = 'パスする';
  passBtn.removeAttribute('title');

  if (!latestGameState || !isMyTurn || count === 0) {
    playBtn.disabled = true;
  } else {
    const selectedCards = currentHand.filter(c => selectedCardIds.has(c.id));
    const fieldCards = latestGameState.fieldCards || [];
    const rules = latestGameState.rules || {};

    if (fieldCards.length > 0 && selectedCards.length !== fieldCards.length) {
      playBtn.disabled = true;
    } else {
      const validation = isValidPlayClient(selectedCards, fieldCards, rules, latestGameState);
      playBtn.disabled = !validation.valid;
    }
  }

  if (count > 0) {
    passBtn.style.visibility = 'hidden';
    return;
  }

  if (!latestGameState || !isMyTurn || isHandSelection) {
    passBtn.style.visibility = 'hidden';
    passBtn.disabled = true;
  } else {
    passBtn.style.visibility = 'visible';
    passBtn.disabled = false;
  }
}

function updateHand(hand) {
  const handEl = document.getElementById('hand');
  if (!handEl) return;

  if (hand.length === 0) {
    handEl.innerHTML = '<div style="color: #2ecc71; font-weight: bold; font-size: 18px;">あがり！おめでとうございます！</div>';
  } else {
    handEl.innerHTML = hand.map(c => {
      const isSelected = (pendingExchangeSelection && pendingExchangeSelection.selected.has(c.id))
        || (pendingSideSelection && (
          pendingSideSelection.passSelected.has(c.id) || pendingSideSelection.discardSelected.has(c.id)
        ))
        || selectedCardIds.has(c.id);

      const selectable = pendingExchangeSelection
        ? pendingExchangeSelection.selected.size < pendingExchangeSelection.required || pendingExchangeSelection.selected.has(c.id)
        : pendingSideSelection
          ? (!pendingSideSelection.playedCardIds.has(c.id)
            && !pendingSideSelection.passSelected.has(c.id)
            && !pendingSideSelection.discardSelected.has(c.id))
            || pendingSideSelection.passSelected.has(c.id)
            || pendingSideSelection.discardSelected.has(c.id)
          : isCardSelectable(c);

      return renderCard(c, true, isSelected, selectable);
    }).join('');
  }
  updatePlayButton();
}

function beginSideSelection(cardsToPlay) {
  const remainingCount = currentHand.length - cardsToPlay.length;
  const passCount = Math.min(cardsToPlay.filter(c => c.num === 7).length, remainingCount);
  const discardCount = Math.min(
    cardsToPlay.filter(c => c.num === 10).length,
    remainingCount - passCount
  );

  if (passCount === 0 && discardCount === 0) {
    return { discardCards: [], passedCards: [] };
  }

  selectedCardIds = new Set(cardsToPlay.map(c => c.id));
  pendingSideSelection = {
    required: { pass: passCount, discard: discardCount },
    passSelected: new Set(),
    discardSelected: new Set(),
    playedCardIds: new Set(cardsToPlay.map(c => c.id)),
    target: passCount > 0 ? 'pass' : 'discard'
  };

  updateHand(currentHand);
  return null;
}

function finalizeSideSelection() {
  if (!pendingSideSelection) {
    return { discardCards: [], passedCards: [] };
  }

  const passCards = currentHand.filter(c => pendingSideSelection.passSelected.has(c.id));
  const discardCards = currentHand.filter(c => pendingSideSelection.discardSelected.has(c.id));

  if (pendingSideSelection.required.pass > 0 && passCards.length !== pendingSideSelection.required.pass) {
    showError(`7渡しは${pendingSideSelection.required.pass}枚選んでください`);
    return null;
  }
  if (pendingSideSelection.required.discard > 0 && discardCards.length !== pendingSideSelection.required.discard) {
    showError(`10捨ては${pendingSideSelection.required.discard}枚選んでください`);
    return null;
  }

  const cardsToPlay = currentHand.filter(c => pendingSideSelection.playedCardIds.has(c.id));
  selectedCardIds = new Set(cardsToPlay.map(c => c.id));
  pendingSideSelection = null;
  return { discardCards: discardCards.map(c => c.id), passedCards: passCards.map(c => c.id), cardsToPlay };
}

function submitPlayCards() {
  clearError();

  if (pendingExchangeSelection) {
    const cards = currentHand.filter(c => pendingExchangeSelection.selected.has(c.id));
    socket.emit('exchange-cards', {
      roomId: myRoomId,
      cards
    });
    return;
  }

  if (pendingSideSelection) {
    const completed = finalizeSideSelection();
    if (!completed) return;

    socket.emit('play-cards', {
      roomId: myRoomId,
      cards: completed.cardsToPlay,
      discardCards: completed.discardCards,
      passedCards: completed.passedCards
    });
    return;
  }

  if (selectedCardIds.size === 0) {
    showError('出すカードを選択してください');
    return;
  }

  const cardsToPlay = currentHand.filter(c => selectedCardIds.has(c.id));
  const extraSelection = beginSideSelection(cardsToPlay);
  if (extraSelection === null) {
    socket.emit('pause-turn-timer', {
      roomId: myRoomId,
      cards: cardsToPlay.map(card => card.id)
    });
    renderTurnCountdown(null);
    return;
  }

  socket.emit('play-cards', {
    roomId: myRoomId,
    cards: cardsToPlay,
    discardCards: extraSelection.discardCards,
    passedCards: extraSelection.passedCards
  });
}

// パス
function passTurn() {
  clearError();

  if (!latestGameState) return;
  const currentSocketId = socket.id || myId;
  const isMyTurn = latestGameState.turnPlayerId === currentSocketId;
  const isHandSelection = !!(latestGameState.isHandSelection || latestGameState.isHandShuffling);

  if (selectedCardIds.size > 0) {
    showError('カード選択中はパスできません');
    return;
  }

  if (!isMyTurn || isHandSelection) {
    showError('自分のターン中だけパスできます');
    return;
  }

  selectedCardIds.clear();
  updateHand(currentHand);
  socket.emit('pass-turn', myRoomId);
}

// ゲーム終了表示
function renderOverallRanking(listElement, roundsElement, data) {
  const currentSocketId = socket.id || myId;
  const players = [...(data.players || [])].sort((a, b) =>
    (b.totalPoints || 0) - (a.totalPoints || 0)
    || (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER)
    || a.name.localeCompare(b.name, 'ja')
  );

  roundsElement.innerText = data.completedRounds
    ? `${data.completedRounds}戦終了 · 役職ポイント累計`
    : '1戦目 · 対局中';
  listElement.replaceChildren();

  players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = `overall-ranking-item ${player.id === currentSocketId ? 'is-me' : ''}`;

    const rank = document.createElement('span');
    rank.className = 'overall-rank-number';
    rank.textContent = String(index + 1);

    const name = document.createElement('span');
    name.className = 'overall-player-name';
    name.textContent = player.name;

    const role = document.createElement('span');
    role.className = 'overall-player-role';
    role.textContent = player.role || (player.isCpu ? 'CPU' : '');

    const points = document.createElement('strong');
    points.className = 'overall-points';
    points.append(document.createTextNode(String(player.totalPoints || 0)));
    const unit = document.createElement('small');
    unit.textContent = 'pt';
    points.appendChild(unit);

    row.append(rank, name, role, points);
    listElement.appendChild(row);
  });
}

function toggleOverallRanking(forceOpen) {
  const modal = document.getElementById('overall-ranking-modal');
  const shouldOpen = forceOpen ?? modal.style.display !== 'flex';
  if (!shouldOpen) {
    modal.style.display = 'none';
    return;
  }
  if (!latestGameState) return;

  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  renderOverallRanking(
    document.getElementById('live-overall-ranking-list'),
    document.getElementById('live-overall-ranking-rounds'),
    latestGameState
  );
  modal.style.display = 'flex';
}

function showGameFinished(data) {
  const modal = document.getElementById('game-finished-modal');
  document.getElementById('overall-ranking-modal').style.display = 'none';
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  const rankingList = document.getElementById('ranking-list');
  const overallRankingList = document.getElementById('overall-ranking-list');
  const overallRankingRounds = document.getElementById('overall-ranking-rounds');
  const nextGameBtn = document.getElementById('next-game-btn');
  const guestNextHint = document.getElementById('guest-next-hint');

  const sortedPlayers = [...data.players].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return a.cardCount - b.cardCount;
  });

  rankingList.innerHTML = sortedPlayers.map((p, idx) => {
    const rankTitle = p.rank ? `${p.rank}位` : `${idx + 1}位`;
    const roundPoints = ROLE_POINTS[p.role] ?? 0;
    const roundPointsLabel = roundPoints > 0 ? `+${roundPoints}` : String(roundPoints);
    const isMe = p.id === currentSocketId;
    return `
      <div class="ranking-item rank-${p.rank || idx + 1}${isMe ? ' is-me' : ''}">
        <span class="ranking-place">${rankTitle}</span>
        <span class="ranking-player"><strong>${escapeHtml(p.name)}</strong>${getRoleBadge(p.role)}</span>
        <span class="ranking-result-meta"><strong>${roundPointsLabel}</strong><small>pt</small></span>
      </div>
    `;
  }).join('');

  renderOverallRanking(overallRankingList, overallRankingRounds, data);

  const currentSocketId = socket.id || myId;
  const amIHost = isHost || (data.hostId === currentSocketId);

  if (amIHost) {
    nextGameBtn.style.display = 'inline-block';
    guestNextHint.style.display = 'none';
  } else {
    nextGameBtn.style.display = 'none';
    guestNextHint.style.display = 'block';
  }

  modal.style.display = 'flex';
}

// Enterキーでの送信対応
document.addEventListener('DOMContentLoaded', () => {
  const createInputs = ['create-player-name', 'create-room-id'];
  createInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createRoom();
      });
    }
  });

  const joinInputs = ['join-player-name', 'join-room-id'];
  joinInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinRoom();
      });
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!myRoomId) return;

    saveRecoveryState();
    const message = '部屋に入っている状態です。閉じると再開時に復帰できます。';
    event.preventDefault();
    event.returnValue = message;
    return message;
  });

  window.addEventListener('resize', applyViewportFit);
window.addEventListener('load', () => {
  syncRoomIdInputFromUrl();
});
  restoreRecoveryState();
});
