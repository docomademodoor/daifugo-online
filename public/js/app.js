const socket = io();
const daifugoRules = window.DaifugoRules;

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
let previousFieldCardsTimer = null;
let turnCountdownInterval = null;
let diceRollAnimationTimer = null;
let diceRollAnimationInterval = null;
let isDiceRollAnimating = false;
let isChinchiroRollPressed = false;
let chinchiroAwaitingRollResult = false;
let ignoreNextChinchiroRollClick = false;
let ignoreNextChinchiroRollClickTimer = null;
let animatedChinchiroPlayerId = null;
let animatedDiceResult = null;
let revealedChinchiroRollId = null;
let revealedChinchiroRollTimer = null;
let errorTimer = null;
let roomChatLoadedFor = '';
let roomChatUnreadCount = 0;
const TABLE_SEAT_GAP = 20;
const CHINCHIRO_ROLL_ANIMATION_MS = 2000;
const CHINCHIRO_RESULT_REVEAL_MS = 2500;
const ROOM_CHAT_MAX_LENGTH = 200;
let chinchiroResultTimer = null;

function clearPreviousFieldCards() {
  if (previousFieldCardsTimer) clearTimeout(previousFieldCardsTimer);
  previousFieldCardsTimer = null;
  previousFieldCards = [];
  document.getElementById('previous-field-card')?.classList.remove('is-recent-clear');
  document.getElementById('field')?.classList.remove('is-recent-clear');
  document.getElementById('field')?.classList.remove('is-large-group');
}

function clearSelectionState() {
  selectedCardIds.clear();
  pendingSideSelection = null;
}

function updateRoomChatUnread() {
  const badge = document.getElementById('room-chat-unread');
  if (!badge) return;
  badge.hidden = roomChatUnreadCount === 0;
  badge.textContent = roomChatUnreadCount > 99 ? '99+' : String(roomChatUnreadCount);
}

function updateRoomChatRecent() {
  const preview = document.getElementById('room-chat-recent');
  const list = document.getElementById('room-chat-messages');
  if (!preview || !list) return;

  preview.replaceChildren();
  [...list.querySelectorAll('.room-chat-message')].slice(-2).forEach(message => {
    const senderName = message.querySelector('.room-chat-message-meta strong')?.textContent || '';
    const messageText = message.querySelector('p')?.textContent || '';
    const item = document.createElement('li');
    item.title = `${senderName}: ${messageText}`;
    const sender = document.createElement('strong');
    sender.textContent = senderName;
    const text = document.createElement('span');
    text.textContent = messageText;
    item.append(sender, text);
    preview.appendChild(item);
  });
}

function updateRoomChatPosition() {
  const root = document.getElementById('room-chat-root');
  const turnControls = document.querySelector('.turn-control-section');
  const chinchiroControls = document.querySelector('#chinchiro-board .chinchiro-controls');
  const handSection = document.querySelector('.hand-section');
  if (!root || root.hidden) return;

  if (!document.body.classList.contains('game-active')) {
    root.style.bottom = '';
    root.style.removeProperty('--room-chat-max-panel-height');
    return;
  }

  const turnActions = turnControls?.querySelector('.control-actions');
  const isActionDock = window.matchMedia('(max-width: 640px)').matches
    && !document.body.classList.contains('chinchiro-mode')
    && turnControls
    && getComputedStyle(turnControls).display !== 'none'
    && turnActions;
  root.classList.toggle('is-action-dock', !!isActionDock);

  if (isActionDock) {
    const sectionRect = turnControls.getBoundingClientRect();
    const actionsRect = turnActions.getBoundingClientRect();
    const rootControlsHeight = document.querySelector('.room-chat-controls')?.getBoundingClientRect().height || 44;
    root.style.left = 'auto';
    root.style.right = `${Math.max(8, window.innerWidth - sectionRect.right + 10)}px`;
    root.style.bottom = `${Math.max(8, window.innerHeight - actionsRect.bottom)}px`;
    root.style.setProperty('--room-chat-max-panel-height', `${Math.max(160, Math.floor(actionsRect.top - rootControlsHeight - 24))}px`);
    return;
  }

  root.classList.remove('is-action-dock');
  root.style.left = '';
  root.style.right = '';

  const controlSection = document.body.classList.contains('chinchiro-mode')
    ? chinchiroControls
    : turnControls;
  const anchorTop = controlSection && getComputedStyle(controlSection).display !== 'none'
    ? controlSection.getBoundingClientRect().top
    : handSection?.getBoundingClientRect().top;
  if (anchorTop === undefined) {
    root.style.bottom = '';
    root.style.removeProperty('--room-chat-max-panel-height');
    return;
  }

  const controlsHeight = document.querySelector('.room-chat-controls')?.getBoundingClientRect().height || 48;
  const maxPanelHeight = Math.max(160, Math.floor(anchorTop - controlsHeight - 32));
  root.style.setProperty('--room-chat-max-panel-height', `${maxPanelHeight}px`);
  root.style.bottom = `${Math.max(8, window.innerHeight - anchorTop + 12)}px`;
}

function scheduleRoomChatPosition() {
  window.requestAnimationFrame(updateRoomChatPosition);
}

function setRoomChatOpen(isOpen) {
  const panel = document.getElementById('room-chat-panel');
  const toggle = document.getElementById('room-chat-toggle');
  if (!panel || !toggle) return;

  panel.hidden = !isOpen;
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'チャットを閉じる' : 'チャットを開く');
  toggle.title = isOpen ? 'チャットを閉じる' : 'チャットを開く';
  if (isOpen) {
    roomChatUnreadCount = 0;
    updateRoomChatUnread();
    const messages = document.getElementById('room-chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    document.getElementById('room-chat-input')?.focus({ preventScroll: true });
  }
  scheduleRoomChatPosition();
}

function setRoomChatRoom(roomId) {
  const root = document.getElementById('room-chat-root');
  if (!root) return;
  if (!roomId) {
    root.hidden = true;
    setRoomChatOpen(false);
    roomChatLoadedFor = '';
    roomChatUnreadCount = 0;
    updateRoomChatUnread();
    document.getElementById('room-chat-messages')?.replaceChildren();
    document.getElementById('room-chat-recent')?.replaceChildren();
    document.getElementById('room-chat-status').textContent = '';
    return;
  }

  root.hidden = false;
  if (roomChatLoadedFor === roomId) return;
  setRoomChatOpen(false);
  roomChatLoadedFor = roomId;
  roomChatUnreadCount = 0;
  updateRoomChatUnread();
  document.getElementById('room-chat-room-label').textContent = `ルーム ${roomId}`;
  document.getElementById('room-chat-messages')?.replaceChildren();
  document.getElementById('room-chat-recent')?.replaceChildren();
  document.getElementById('room-chat-status').textContent = '';
  socket.emit('room-chat-history-request', roomId);
  scheduleRoomChatPosition();
}

function appendRoomChatMessage(message) {
  const list = document.getElementById('room-chat-messages');
  if (!list) return;

  const item = document.createElement('li');
  item.className = `room-chat-message${message.senderId === socket.id ? ' is-mine' : ''}`;
  const meta = document.createElement('div');
  meta.className = 'room-chat-message-meta';
  const sender = document.createElement('strong');
  sender.textContent = message.senderName;
  const time = document.createElement('time');
  const timestamp = new Date(Number(message.sentAt) || Date.now());
  time.dateTime = timestamp.toISOString();
  time.textContent = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('p');
  text.textContent = message.text;
  meta.append(sender, time);
  item.append(meta, text);
  list.appendChild(item);
  while (list.children.length > 50) list.firstElementChild.remove();
  list.scrollTop = list.scrollHeight;
  updateRoomChatRecent();
}

function updateRoomChatComposer() {
  const input = document.getElementById('room-chat-input');
  const submit = document.getElementById('room-chat-submit');
  const count = document.getElementById('room-chat-count');
  if (!input || !submit || !count) return;
  const characterCount = Array.from(input.value.trim()).length;
  count.textContent = `${characterCount} / ${ROOM_CHAT_MAX_LENGTH}`;
  submit.disabled = characterCount === 0 || characterCount > ROOM_CHAT_MAX_LENGTH;
  document.getElementById('room-chat-status').textContent = '';
}

function submitRoomChat(event) {
  event.preventDefault();
  const input = document.getElementById('room-chat-input');
  const status = document.getElementById('room-chat-status');
  const text = input?.value.trim() || '';
  const characterCount = Array.from(text).length;
  if (!myRoomId || !text || characterCount > ROOM_CHAT_MAX_LENGTH) return;
  socket.emit('room-chat-send', { roomId: myRoomId, text });
  input.value = '';
  updateRoomChatComposer();
  input.focus({ preventScroll: true });
  if (status) status.textContent = '';
}

document.getElementById('room-chat-toggle')?.addEventListener('click', () => {
  setRoomChatOpen(document.getElementById('room-chat-panel').hidden);
});
document.getElementById('room-chat-close')?.addEventListener('click', () => setRoomChatOpen(false));
document.getElementById('room-chat-form')?.addEventListener('submit', submitRoomChat);
document.getElementById('room-chat-input')?.addEventListener('input', updateRoomChatComposer);
document.getElementById('room-chat-input')?.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('room-chat-form').requestSubmit();
  }
});

socket.on('room-chat-history', ({ roomId, messages = [] } = {}) => {
  if (roomId !== myRoomId || roomChatLoadedFor !== roomId) return;
  const list = document.getElementById('room-chat-messages');
  list.replaceChildren();
  messages.forEach(appendRoomChatMessage);
});

socket.on('room-chat-message', message => {
  if (message.roomId !== myRoomId) return;
  appendRoomChatMessage(message);
  if (document.getElementById('room-chat-panel').hidden && message.senderId !== socket.id) {
    roomChatUnreadCount++;
    updateRoomChatUnread();
  }
});

socket.on('room-chat-error', message => {
  document.getElementById('room-chat-status').textContent = message;
});

window.addEventListener('resize', scheduleRoomChatPosition);
if (typeof ResizeObserver !== 'undefined') {
  const roomChatPositionObserver = new ResizeObserver(scheduleRoomChatPosition);
  ['.turn-control-section', '.chinchiro-controls', '.hand-section'].forEach(selector => {
    const section = document.querySelector(selector);
    if (section) roomChatPositionObserver.observe(section);
  });
}

const RECOVERY_KEY = 'daifugo-room-recovery-v1';
let hasSocketConnected = false;
let roomSyncSocketId = '';

function rejoinActiveRoom() {
  if (!socket.connected || !myRoomId || !myPlayerId || roomSyncSocketId === socket.id) return;

  let recovery = {};
  try {
    recovery = JSON.parse(localStorage.getItem(RECOVERY_KEY) || '{}');
  } catch (error) {
    console.warn('再接続情報の読み込みに失敗しました:', error);
  }

  const playerName = recovery.roomId === myRoomId
    ? recovery.playerName
    : document.getElementById('join-player-name')?.value
      || document.getElementById('create-player-name')?.value;
  if (!playerName) return;

  roomSyncSocketId = socket.id;
  socket.emit('join-room', { roomId: myRoomId, playerName, playerId: myPlayerId });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) rejoinActiveRoom();
});

window.addEventListener('pageshow', rejoinActiveRoom);

const RULE_LABELS = {
  eightCut: '8切り',
  revolution: '革命',
  suitLock: 'マーク縛り',
  spe3: 'スペ3返し',
  staircase: '階段',
  staircaseRevolution: '階段革命',
  elevenBack: 'Jバック',
  numberLock: '数字縛り',
  completeLock: '完縛り',
  fiveSkip: '5飛び',
  sevenPass: '7渡し',
  tenDiscard: '10捨て',
  forbiddenFinish: '禁止上がり',
  miyakoOchi: '都落ち',
  dia3Start: '♢3スタート',
  includeJoker: 'ジョーカー'
};

const RULE_DETAILS = {
  eightCut: '8を含むカードを出すと場が流れ、出した人から再開します。',
  revolution: '4枚以上を同時に出すと、カードの強さが逆転します。',
  suitLock: '同じマークが続くと、場が流れるまで同じマークでしか出せません。',
  spe3: 'ジョーカー1枚の場に♠3を出すと、場を流せます。',
  staircase: '同じマークの連続した数字を3枚以上まとめて出せます。',
  staircaseRevolution: '同じマークの階段を4枚以上出すと、革命が起きます。',
  elevenBack: 'Jを出すと、場が流れるまでカードの強さが反転します。',
  numberLock: '同じ枚数で数字が連続すると、次の数字だけ出せます。',
  completeLock: '数字縛りに加えて、続く出し札は同じマーク構成にします。',
  fiveSkip: '5を出した枚数分、次の人を飛ばします。全員を飛ばすと自分に戻ります。',
  sevenPass: '7を出すと、出した枚数分の手札を次の人へ渡します。',
  tenDiscard: '10を出した枚数分、手札から選んで捨てます。',
  forbiddenFinish: 'ルールで指定された禁止カードで上がると、反則になります。',
  miyakoOchi: '前回の大富豪が次のゲームでトップを取れないと、大貧民に転落します。',
  dia3Start: '初回は♦3を持っている人から始まります。',
  includeJoker: 'ジョーカーを1枚加えてゲームを行います。'
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
  'completeLock',
  'numberLock',
  'fiveSkip',
  'sevenPass',
  'tenDiscard',
  'elevenBack'
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
  'completeLock',
  'numberLock',
  'fiveSkip',
  'sevenPass',
  'tenDiscard',
  'elevenBack',
  'eightCut'
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

function updateLockRuleSelection(ruleKey) {
  const otherRuleKey = ruleKey === 'numberLock' ? 'completeLock' : 'numberLock';
  const selectedRule = document.getElementById(`rule-${ruleKey}`);
  const otherRule = document.getElementById(`rule-${otherRuleKey}`);
  if (selectedRule?.checked && otherRule) otherRule.checked = false;
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
  hard: '強い',
  strongest: '最強（記憶）'
};

const GAME_LABELS = {
  daifugo: '大富豪',
  chinchiro: 'チンチロ'
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
  const preferredRowOffset = ((fieldHeight + seatHeight) / 2 + TABLE_SEAT_GAP) / stageHeight * 100;
  const maximumRowOffset = 50 - ((seatHeight / 2 + 8) / stageHeight) * 100;
  const rowOffsetPercent = window.matchMedia('(max-width: 640px)').matches
    ? Math.min(preferredRowOffset, maximumRowOffset)
    : preferredRowOffset;
  const x = rowCount === 1
    ? 50
    : edgePercent + ((100 - edgePercent * 2) * (isTopRow ? rowIndex : rowCount - rowIndex - 1)) / (rowCount - 1);

  return {
    x,
    y: isTopRow ? 50 - rowOffsetPercent : 50 + rowOffsetPercent
  };
}

function getClockwiseOpponentOrder(players, currentPlayerId) {
  const currentPlayerIndex = players.findIndex(player => player.id === currentPlayerId);
  if (currentPlayerIndex < 0) return players.filter(player => player.id !== currentPlayerId);

  return [
    ...players.slice(currentPlayerIndex + 1),
    ...players.slice(0, currentPlayerIndex)
  ];
}

socket.on('connect', () => {
  const isReconnect = hasSocketConnected;
  hasSocketConnected = true;
  myId = socket.id;
  roomSyncSocketId = '';
  console.log('Socket接続成功: ID =', myId);
  if (isReconnect) rejoinActiveRoom();
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
  const notice = document.getElementById('join-request-notice');
  const noticeMessage = document.getElementById('join-request-notice-message');
  const noticeActions = document.getElementById('join-request-notice-actions');
  if (!modal || !title || !message || !actions || !notice || !noticeMessage || !noticeActions) return;

  activeJoinRequest = data;
  title.innerText = mode === 'host' ? '途中参加の申請' : '途中参加を申請しました';
  const requestMessage = mode === 'host'
    ? `${data.playerName} さんが途中参加を希望しています。`
    : data.message;
  message.innerText = requestMessage;
  actions.innerHTML = mode === 'host'
    ? '<button class="primary-btn" type="button" onclick="approveJoinRequest()">許可</button><button class="secondary-btn" type="button" onclick="rejectJoinRequest()">拒否</button>'
    : '<button class="secondary-btn" type="button" onclick="closeJoinRequestModal()">閉じる</button>';

  if (mode === 'host' && document.body.classList.contains('game-active')) {
    noticeMessage.textContent = requestMessage;
    noticeActions.innerHTML = '<button class="primary-btn" type="button" onclick="approveJoinRequest()">許可</button><button class="secondary-btn" type="button" onclick="rejectJoinRequest()">拒否</button>';
    notice.hidden = false;
    modal.style.display = 'none';
    return;
  }

  notice.hidden = true;
  modal.style.display = 'flex';
}

function closeJoinRequestModal() {
  const modal = document.getElementById('join-request-modal');
  const notice = document.getElementById('join-request-notice');
  if (modal) modal.style.display = 'none';
  if (notice) notice.hidden = true;
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

function getSelectedGameType() {
  return document.querySelector('input[name="gameType"]:checked')?.value || 'daifugo';
}

function updateGameSetup() {
  const gameType = getSelectedGameType();
  const rulesSection = document.getElementById('daifugo-rules-section');
  const chinchiroRules = document.getElementById('chinchiro-rules-section');
  if (rulesSection) rulesSection.style.display = gameType === 'daifugo' ? 'block' : 'none';
  if (chinchiroRules) chinchiroRules.style.display = gameType === 'chinchiro' ? 'block' : 'none';
}

// ルーム作成
function createRoom() {
  clearError();
  const name = document.getElementById('create-player-name').value.trim();
  const roomId = document.getElementById('create-room-id').value.trim();
  const gameType = getSelectedGameType();

  if (!name) {
    showError('プレイヤー名を入力してください');
    return;
  }
  if (!/^\d{5}$/.test(roomId)) {
    showError('ルームIDは5桁の数字で入力してください');
    return;
  }

  const daifugoRules = {
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
    completeLock: document.getElementById('rule-completeLock')?.checked ?? false,
    fiveSkip: document.getElementById('rule-fiveSkip').checked,
    sevenPass: document.getElementById('rule-sevenPass')?.checked ?? true,
    tenDiscard: document.getElementById('rule-tenDiscard').checked
  };
  const rules = gameType === 'daifugo' ? daifugoRules : {};

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
  if (!/^\d{5}$/.test(roomId)) {
    showError('ルームIDは5桁の数字で入力してください');
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
  setRoomChatRoom(myRoomId);
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
  return /^\d{5}$/.test(value) ? value : '';
}

function syncRoomIdInputFromUrl() {
  const roomIdFromPath = getRoomIdFromPath();
  if (!roomIdFromPath) return;

  const createInput = document.getElementById('create-room-id');
  const joinInput = document.getElementById('join-room-id');
  if (createInput) createInput.value = roomIdFromPath;
  if (joinInput) joinInput.value = roomIdFromPath;
}

function sanitizeRoomIdInput(input) {
  const selectionStart = input.selectionStart;
  const sanitized = input.value.replace(/\D/g, '').slice(0, 5);
  if (input.value === sanitized) return;
  input.value = sanitized;
  const cursor = Math.min(selectionStart ?? sanitized.length, sanitized.length);
  input.setSelectionRange(cursor, cursor);
}

function generateRoomId() {
  const input = document.getElementById('create-room-id');
  if (!input) return;
  input.value = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  input.focus();
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
  setRoomChatRoom('');
  latestGameState = null;
  clearPreviousFieldCards();
  currentHand = [];
  selectedCardIds.clear();
}

socket.on('room-closed', ({ roomId }) => {
  clearRecoveryState();
  myRoomId = '';
  isHost = false;
  if (getRoomIdFromPath() === roomId) window.history.replaceState({}, '', '/');
  ['create-room-id', 'join-room-id'].forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input?.value.trim() === roomId) input.value = '';
  });
  resetToLobbyView();
  showError('ルームが閉じられました。ロビーに戻りました。');
});

socket.on('room-updated', (roomData) => {
  console.log('ルーム更新通知:', roomData);
  updateWaitingRoom(roomData);
});

function updateWaitingRoom(room) {
  document.getElementById('lobby-form-area').style.display = 'none';
  document.getElementById('waiting-area').style.display = 'block';

  myRoomId = room.roomId;
  setRoomChatRoom(myRoomId);
  document.getElementById('display-room-id').innerText = room.roomId;
  document.getElementById('display-game-type').innerText = GAME_LABELS[room.gameType] || GAME_LABELS.daifugo;
  document.getElementById('player-count').innerText = room.players.length;
  document.getElementById('room-max-players').innerText = room.maxPlayers || 8;
  const cpuCount = room.players.filter(player => player.isCpu).length;
  document.getElementById('cpu-count').innerText = cpuCount;

  const displayRules = document.getElementById('display-rules');
  displayRules.style.display = room.gameType === 'chinchiro' ? 'none' : 'flex';
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
  const cpuDifficultyControl = document.querySelector('.cpu-difficulty-control');
  const cpuActions = document.querySelector('.host-cpu-actions');
  const hasCpuDifficulty = room.gameType === 'daifugo';
  cpuDifficultyControl.style.display = hasCpuDifficulty ? 'flex' : 'none';
  cpuActions.classList.toggle('without-difficulty', !hasCpuDifficulty);

  const amIHost = isHost || (room.hostId === currentSocketId);

  if (amIHost) {
    hostControls.style.display = 'grid';
    guestMsg.style.display = 'none';
    addCpuBtn.disabled = room.players.length >= (room.maxPlayers || 8);
    removeCpuBtn.disabled = cpuCount === 0;
    roomLockBtn.dataset.locked = String(!!room.isLocked);
    roomLockBtn.innerText = room.isLocked ? '新規参加ロックを解除' : '新規参加をロック';
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

  scheduleRoomChatPosition();
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

function renderRulesModal(rules, gameType = 'daifugo') {
  const modalBody = document.getElementById('rules-modal-body');
  if (!modalBody) return;

  if (gameType === 'chinchiro') {
    modalBody.innerHTML = `
      <div class="rules-section-group">
        <h3>チンチロの遊び方</h3>
        <div class="rules-modal-item"><strong>サイコロ</strong><span>3個を振り、1ターン最大3回まで挑戦できます。</span></div>
        <div class="rules-modal-item"><strong>確定</strong><span>3回目の前に「この役で確定」を選ぶと次の人へ進みます。</span></div>
        <div class="rules-modal-item"><strong>役の強さ</strong><span>ピンゾロ、シゴロ、ゾロ目、ペア、役なし、ヒフミの順です。</span></div>
        <div class="rules-modal-item"><strong>得点</strong><span>順位に応じて1点から人数分まで加算し、同じ役は同順位です。</span></div>
      </div>
    `;
    return;
  }

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
    document.body.style.overflow = isMobile
      && document.body.classList.contains('game-active')
      && !document.body.classList.contains('chinchiro-mode')
      ? 'hidden'
      : 'auto';
    return;
  }

  gameContainer.style.display = 'block';
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
  clearRevealedChinchiroRoll();
  if (chinchiroResultTimer) clearTimeout(chinchiroResultTimer);
  chinchiroResultTimer = null;
  latestGameState = data;
  myRoomId = data.roomId;
  setRoomChatRoom(myRoomId);
  document.body.classList.add('game-active');
  clearPreviousFieldCards();
  document.getElementById('lobby-container').style.display = 'none';
  document.getElementById('game-container').style.display = window.matchMedia('(max-width: 640px)').matches
    ? 'flex'
    : 'block';
  document.getElementById('game-finished-modal').style.display = 'none';

  document.getElementById('game-room-id').innerText = data.roomId;
  document.getElementById('game-rules-badges').style.display = data.gameType === 'chinchiro' ? 'none' : 'flex';
  renderRuleBadges('game-rules-badges', data.rules);
  renderRulesModal(data.rules, data.gameType);

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
  scheduleRoomChatPosition();
});

// ゲーム状態更新
socket.on('state-updated', (data) => {
  const oldFieldCards = latestGameState?.fieldCards || [];
  const previousRollId = latestGameState?.chinchiroHistory?.at(-1)?.id || 0;
  const latestChinchiroRoll = data.chinchiroHistory?.at(-1);
  const didRollChinchiroDice = data.gameType === 'chinchiro'
    && latestChinchiroRoll
    && latestChinchiroRoll.id > previousRollId;
  const animatedPlayer = data.players.find(player => player.id === animatedChinchiroPlayerId);
  const didConfirmAnimatedRoll = data.gameType === 'chinchiro'
    && isDiceRollAnimating
    && !didRollChinchiroDice
    && animatedPlayer?.chinchiroFinished;
  const newFieldCards = data.fieldCards || [];
  const clearedFieldCards = data.clearedFieldCards || [];
  const fieldChanged = oldFieldCards.length !== newFieldCards.length
    || oldFieldCards.some((card, index) => card.id !== newFieldCards[index]?.id);

  if (newFieldCards.length > 0) {
    clearPreviousFieldCards();
    if (oldFieldCards.length > 0 && fieldChanged) {
      previousFieldCards = [...oldFieldCards];
    }
  } else {
    const cardsToShow = clearedFieldCards.length > 0 ? clearedFieldCards : oldFieldCards;
    if (cardsToShow.length > 0) {
      if (previousFieldCardsTimer) clearTimeout(previousFieldCardsTimer);
      previousFieldCards = [...cardsToShow];
      previousFieldCardsTimer = setTimeout(() => {
        previousFieldCardsTimer = null;
        if ((latestGameState?.fieldCards || []).length > 0) return;
        previousFieldCards = [];
        const fieldEl = document.getElementById('field');
        if (fieldEl) {
          fieldEl.innerHTML = '<span style="color: #bbb;">（場は流れています。好きなカードを出せます）</span>';
          fieldEl.classList.remove('is-recent-clear');
          fieldEl.classList.remove('is-large-group');
        }
        const previousFieldEl = document.getElementById('previous-field-card');
        if (previousFieldEl) {
          previousFieldEl.innerHTML = '';
          previousFieldEl.style.display = 'none';
          previousFieldEl.classList.remove('is-recent-clear');
        }
      }, 1800);
    } else if (!previousFieldCardsTimer) {
      previousFieldCards = [];
    }
  }

  if (didRollChinchiroDice) {
    const latestRoll = data.chinchiroHistory?.at(-1);
    const currentSocketId = socket.id || myId;
    if (chinchiroAwaitingRollResult && latestRoll?.playerId === currentSocketId) {
      chinchiroAwaitingRollResult = false;
      isChinchiroRollPressed = false;
      if (diceRollAnimationTimer) clearTimeout(diceRollAnimationTimer);
      animatedDiceResult = [...latestRoll.dice];
      finishChinchiroDiceAnimation(data);
    } else {
      startChinchiroDiceAnimation(latestRoll?.dice, latestRoll?.playerId);
    }
  }

  latestGameState = data;
  if (didConfirmAnimatedRoll) finishChinchiroDiceAnimation(data);
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
  scheduleRoomChatPosition();
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
  if (data.gameType === 'chinchiro') {
    document.body.classList.add('chinchiro-mode');
    document.getElementById('game-status-banner').style.display = 'none';
    document.getElementById('game-action-message').textContent = '';
    updateChinchiroUI(data);
    return;
  }

  document.body.classList.remove('chinchiro-mode');
  document.getElementById('chinchiro-board').style.display = 'none';
  document.querySelector('.table-stage').style.display = '';
  document.querySelector('.turn-control-section').style.display = '';
  document.querySelector('.hand-section').style.display = '';
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
    if (data.rules?.completeLock) {
      const lockedSuits = (data.lockedNumberSuits || []).join('・');
      addStatusTag(`完縛り ${lockedNumbers.join(' → ')}${lockedSuits ? ` ${lockedSuits}` : ''}`);
    } else {
      addStatusTag(`数字縛り ${lockedNumbers.join(' → ')}`);
    }
  }

  actionMessage.innerText = formatGameActionMessage(data.actionMessage);
  const hasStatus = statusTags.childElementCount > 0;
  const hasAction = actionMessage.innerText.length > 0;
  statusBanner.style.display = hasStatus ? 'flex' : 'none';
  actionMessage.style.display = hasAction ? 'block' : 'none';

  // 場のカード表示
  const fieldEl = document.getElementById('field');
  const previousFieldEl = document.getElementById('previous-field-card');
  const displayedFieldCards = data.fieldCards?.length > 0 ? data.fieldCards : previousFieldCards;
  fieldEl.classList.toggle('is-large-group', displayedFieldCards.length > 4);
  if (data.fieldCards && data.fieldCards.length > 0) {
    fieldEl.innerHTML = data.fieldCards.map(c => renderCard(c, false)).join('');
    fieldEl.classList.remove('is-recent-clear');
    if (previousFieldEl) {
      previousFieldEl.innerHTML = previousFieldCards.map(card => renderCard(card, false)).join('');
      previousFieldEl.style.display = previousFieldCards.length > 0 ? 'flex' : 'none';
      previousFieldEl.classList.remove('is-recent-clear');
    }
  } else {
    fieldEl.innerHTML = previousFieldCards.length > 0
      ? previousFieldCards.map(card => renderCard(card, false)).join('')
      : '<span style="color: #bbb;">（場は流れています。好きなカードを出せます）</span>';
    fieldEl.classList.toggle('is-recent-clear', previousFieldCards.length > 0);
    if (previousFieldEl) {
      previousFieldEl.innerHTML = '';
      previousFieldEl.style.display = 'none';
      previousFieldEl.classList.remove('is-recent-clear');
    }
  }

  // 他プレイヤー情報
  const othersEl = document.getElementById('other-players');
  const seatOrder = getClockwiseOpponentOrder(data.players, currentSocketId);
  const seatLayoutPlayerCount = data.players.length;
  const tableStage = document.querySelector('.table-stage');
  const fieldSection = document.querySelector('.field-section');
  const isMobileTable = window.matchMedia('(max-width: 640px)').matches;
  const seatCardHeight = isMobileTable ? 62 : 122;

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
    const topRowCount = Math.ceil(seatLayoutPlayerCount / 2);
    const seatGap = isMobileTable ? 5 : 12;
    const seatCardWidth = Math.min(112, (stageWidth - (topRowCount - 1) * seatGap) / Math.max(topRowCount, 1));
    const preferredSpacing = isTurn
      ? totalCardCount > 12 ? 3.2 : totalCardCount > 6 ? 4 : 4.5
      : totalCardCount > 12 ? 1.3 : 1.7;
    const stackMaxWidth = isMobileTable ? Math.max(40, seatCardWidth - 12) : 96;
    const stackWidth = Math.min(stackMaxWidth, Math.max(62, 42 + totalCardCount * 2.2));
    const miniCardWidth = isMobileTable ? 14 : 18;
    const miniCardHeight = isMobileTable ? 18 : 24;
    const stackHeight = isMobileTable ? 18 : 38;
    const spacing = Math.min(
      preferredSpacing,
      Math.max(0, (stackWidth - miniCardWidth) / Math.max(totalCardCount - 1, 1))
    );
    const fanWidth = miniCardWidth + Math.max(0, totalCardCount - 1) * spacing;
    const fanStart = Math.max(0, (stackWidth - fanWidth) / 2);
    const stackCards = Array.from({ length: totalCardCount }, (_, idx) => {
      const fanAngle = isMobileTable ? 24 : 48;
      const angle = -fanAngle / 2 + (idx * (fanAngle / Math.max(totalCardCount - 1, 1)));
      const left = fanStart + idx * spacing;
      const top = Math.round((stackHeight - miniCardHeight) / 2);
      return `
        <span class="mini-card" style="left:${left}px; top:${top}px; z-index:${totalCardCount - idx}; transform: rotate(${angle}deg);"></span>
      `;
    }).join('');
    const countBadge = `<span class="count-stack-total">${totalCardCount}</span>`;
    const winnerText = p.isWinner ? `<span class="winner-text">🎉 ${p.rank}位</span>` : '';
    const seatPos = getOpponentSeatLayout(
      seatLayoutPlayerCount,
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

function updateChinchiroUI(data) {
  const currentSocketId = socket.id || myId;
  const isMyTurn = data.status === 'playing' && data.turnPlayerId === currentSocketId;
  const currentPlayer = data.players.find(player => player.id === data.turnPlayerId);
  const currentRound = data.status === 'finished'
    ? data.completedRounds
    : (data.completedRounds || 0) + 1;
  const roundHistory = (data.chinchiroHistory || [])
    .filter(entry => entry.round === currentRound);
  const latestRoll = roundHistory.at(-1);
  const latestRollPlayer = latestRoll
    ? data.players.find(player => player.id === latestRoll.playerId)
    : null;
  const animatedPlayer = isDiceRollAnimating && animatedChinchiroPlayerId
    ? data.players.find(player => player.id === animatedChinchiroPlayerId)
    : null;
  const activePlayerRoll = currentPlayer
    ? [...roundHistory].reverse().find(entry => entry.playerId === currentPlayer.id)
    : null;
  const revealedRoll = !animatedPlayer && revealedChinchiroRollId !== null
    ? roundHistory.find(entry => entry.id === revealedChinchiroRollId)
    : null;
  const revealedPlayer = revealedRoll
    ? data.players.find(player => player.id === revealedRoll.playerId)
    : null;
  const isShowingPreviousResult = !!revealedRoll
    && !!revealedPlayer
    && revealedPlayer.id !== currentPlayer?.id
    && !activePlayerRoll;
  const displayedPlayer = animatedPlayer
    || (isShowingPreviousResult ? revealedPlayer : currentPlayer)
    || latestRollPlayer;
  const displayedRoll = [...roundHistory].reverse()
    .find(entry => entry.playerId === displayedPlayer?.id && (!isShowingPreviousResult || entry.id === revealedRoll.id));
  const board = document.getElementById('chinchiro-board');
  const rollButton = document.getElementById('chinchiro-roll-btn');
  const holdButton = document.getElementById('chinchiro-hold-btn');
  rollButton.textContent = isChinchiroRollPressed
    ? '振っています…'
    : chinchiroAwaitingRollResult
      ? '目を確定中…'
      : 'サイコロを振る';
  const dice = animatedDiceResult || displayedRoll?.dice || displayedPlayer?.dice || [];
  const visibleRollsUsed = displayedRoll?.rollNumber || displayedPlayer?.rollsUsed || 0;
  const currentRollsUsed = currentPlayer?.rollsUsed || 0;

  document.querySelector('.table-stage').style.display = 'none';
  document.querySelector('.turn-control-section').style.display = 'none';
  document.querySelector('.hand-section').style.display = 'none';
  board.style.display = 'block';
  document.getElementById('chinchiro-round').textContent = `${data.completedRounds || 0} ラウンド終了`;
  document.getElementById('chinchiro-history-open').textContent = `履歴 (${data.chinchiroHistory?.length || 0})`;
  document.getElementById('chinchiro-turn-status').textContent = data.status === 'finished'
    ? '全員の役が確定しました。次のラウンドを始められます。'
    : isMyTurn
      ? 'あなたの番です。3個のサイコロを振ってください。'
      : `${currentPlayer?.name || '相手'}の番です`;
  document.getElementById('chinchiro-dice').innerHTML = Array.from({ length: 3 }, (_, index) => {
    const face = dice[index] || '·';
    return `<span class="chinchiro-die${dice.length ? ' has-result' : ''}" aria-label="${face}の目">${face}</span>`;
  }).join('');
  if (!isDiceRollAnimating) renderBowlDice(dice);
  document.getElementById('chinchiro-hand-label').textContent = isShowingPreviousResult
    ? `${displayedPlayer.name}の前の結果：${displayedRoll.label}`
    : displayedRoll?.label || displayedPlayer?.chinchiroHand?.label || 'サイコロを振ってください';
  document.getElementById('chinchiro-roll-count').textContent = isShowingPreviousResult
    ? `前の結果 ${visibleRollsUsed} / 3 回`
    : `${visibleRollsUsed} / 3 回`;
  rollButton.disabled = !isMyTurn || currentRollsUsed >= 3 || isDiceRollAnimating || isShowingPreviousResult;
  holdButton.disabled = !isMyTurn || currentRollsUsed === 0 || isDiceRollAnimating || isShowingPreviousResult;

  const sortedPlayers = [...data.players].sort((left, right) => {
    if (left.rank && right.rank) return left.rank - right.rank;
    if (left.rank) return -1;
    if (right.rank) return 1;
    if (left.chinchiroFinished !== right.chinchiroFinished) return left.chinchiroFinished ? -1 : 1;
    return left.name.localeCompare(right.name, 'ja');
  });
  document.getElementById('chinchiro-player-list').innerHTML = sortedPlayers.map(player => {
    const isRolling = isDiceRollAnimating && player.id === animatedChinchiroPlayerId;
    const status = isRolling
      ? '振っています…'
      : data.status === 'finished'
      ? `${player.rank}位`
      : player.chinchiroFinished
        ? '確定'
        : player.rollsUsed > 0
          ? `${player.rollsUsed}/3回`
          : '待機';
    const role = isRolling ? '振っています…' : player.chinchiroHand?.label || '—';
    const roundPoints = player.roundPoints > 0 ? `+${player.roundPoints}` : '—';
    return `
      <div class="chinchiro-player-row ${player.id === currentPlayer?.id ? 'is-turn' : ''} ${player.id === currentSocketId ? 'is-me' : ''}">
        <span class="chinchiro-player-name"><strong>${escapeHtml(player.name)}</strong>${player.id === currentSocketId ? '<small>あなた</small>' : ''}</span>
        <span class="chinchiro-player-role">${escapeHtml(role)}</span>
        <span class="chinchiro-player-points">${roundPoints}<small>今回</small></span>
        <span class="chinchiro-player-total">${player.totalPoints || 0}<small>累計</small></span>
        <span class="chinchiro-player-status">${status}</span>
      </div>
    `;
  }).join('');

  renderChinchiroHistory(data.chinchiroHistory || [], isDiceRollAnimating);

  if (data.status === 'finished') toggleChinchiroHistory(false);
  if (data.status === 'finished' && !isDiceRollAnimating) {
    if (chinchiroResultTimer) clearTimeout(chinchiroResultTimer);
    chinchiroResultTimer = setTimeout(() => {
      chinchiroResultTimer = null;
      if (latestGameState?.gameType === 'chinchiro' && latestGameState.status === 'finished') {
        showGameFinished(latestGameState);
      }
    }, CHINCHIRO_RESULT_REVEAL_MS);
  } else if (chinchiroResultTimer) {
    clearTimeout(chinchiroResultTimer);
    chinchiroResultTimer = null;
  }
}

function pressChinchiroRoll(event) {
  const isKeyboardEvent = event?.type === 'keydown';
  if (isKeyboardEvent && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
  if (isKeyboardEvent && event.repeat) return;
  event?.preventDefault?.();

  if (event?.type === 'pointerdown' && event.currentTarget?.setPointerCapture) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  const currentSocketId = socket.id || myId;
  const currentPlayer = latestGameState?.players?.find(player => player.id === currentSocketId);
  if (!myRoomId || !latestGameState || latestGameState.status !== 'playing'
    || latestGameState.turnPlayerId !== currentSocketId
    || currentPlayer?.rollsUsed >= 3
    || isDiceRollAnimating
    || revealedChinchiroRollId !== null
    || chinchiroAwaitingRollResult) return;

  isChinchiroRollPressed = true;
  startChinchiroDiceAnimation(null, currentSocketId, true);
  updateChinchiroUI(latestGameState);
}

function releaseChinchiroRoll(event) {
  const isKeyboardEvent = event?.type === 'keyup';
  if (isKeyboardEvent && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
  event?.preventDefault?.();
  if (!isChinchiroRollPressed || !myRoomId) return;

  isChinchiroRollPressed = false;
  chinchiroAwaitingRollResult = true;
  updateChinchiroUI(latestGameState);
  if (diceRollAnimationInterval) clearInterval(diceRollAnimationInterval);
  diceRollAnimationInterval = null;
  document.getElementById('chinchiro-bowl')?.classList.remove('is-shaking');

  ignoreNextChinchiroRollClick = true;
  if (ignoreNextChinchiroRollClickTimer) clearTimeout(ignoreNextChinchiroRollClickTimer);
  ignoreNextChinchiroRollClickTimer = setTimeout(() => {
    ignoreNextChinchiroRollClick = false;
    ignoreNextChinchiroRollClickTimer = null;
  }, 500);

  if (diceRollAnimationTimer) clearTimeout(diceRollAnimationTimer);
  diceRollAnimationTimer = setTimeout(() => {
    if (!chinchiroAwaitingRollResult) return;
    chinchiroAwaitingRollResult = false;
    finishChinchiroDiceAnimation(latestGameState);
    if (latestGameState?.gameType === 'chinchiro') updateUI(latestGameState);
    showError('出目を受信できませんでした。もう一度お試しください。');
  }, 8000);

  socket.emit('roll-chinchiro', myRoomId);
}

function cancelChinchiroRoll() {
  if (!isChinchiroRollPressed) return;
  isChinchiroRollPressed = false;
  finishChinchiroDiceAnimation(latestGameState);
  if (latestGameState?.gameType === 'chinchiro') updateUI(latestGameState);
}

window.addEventListener('blur', cancelChinchiroRoll);

function rollChinchiro(event) {
  if (ignoreNextChinchiroRollClick) {
    ignoreNextChinchiroRollClick = false;
    if (ignoreNextChinchiroRollClickTimer) clearTimeout(ignoreNextChinchiroRollClickTimer);
    ignoreNextChinchiroRollClickTimer = null;
    return;
  }
  if (isChinchiroRollPressed) return;

  pressChinchiroRoll({ type: 'keydown', key: 'Enter', preventDefault() {} });
  releaseChinchiroRoll({ type: 'keyup', key: 'Enter', preventDefault() {} });
}

function renderBowlDice(dice = []) {
  const pipSlots = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };
  document.querySelectorAll('.bowl-die').forEach((die, index) => {
    const face = dice[index];
    die.classList.toggle('is-empty', !pipSlots[face]);
    die.setAttribute('aria-label', pipSlots[face] ? `${face}の目` : 'サイコロ');
    if (!pipSlots[face]) {
      die.innerHTML = '<span class="bowl-die-placeholder">?</span>';
      return;
    }
    const activeSlots = new Set(pipSlots[face]);
    die.innerHTML = Array.from({ length: 9 }, (_, slot) =>
      `<i class="bowl-die-pip${activeSlots.has(slot) ? ' is-visible' : ''}"></i>`
    ).join('');
  });
}

function renderChinchiroHistory(history, isRolling) {
  const list = document.getElementById('chinchiro-history-list');
  const visibleHistory = [...history].slice(-12);
  if (isRolling && visibleHistory.length > 0) visibleHistory.pop();
  if (visibleHistory.length === 0) {
    list.innerHTML = '<p class="chinchiro-history-empty">サイコロを振ると履歴が表示されます</p>';
    return;
  }

  list.innerHTML = visibleHistory.reverse().map(entry => `
    <div class="chinchiro-history-row">
      <span class="chinchiro-history-round">R${entry.round}</span>
      <strong class="chinchiro-history-player">${escapeHtml(entry.playerName)}</strong>
      <span class="chinchiro-history-dice">${entry.dice.map(face => `<i>${face}</i>`).join('')}</span>
      <span class="chinchiro-history-result"><strong>${escapeHtml(entry.label)}</strong><small>${entry.rollNumber}回目${entry.confirmed ? ' · 確定' : ''}</small></span>
    </div>
  `).join('');
}

function toggleChinchiroHistory(forceOpen) {
  const modal = document.getElementById('chinchiro-history-modal');
  if (!modal) return;

  const shouldOpen = forceOpen ?? modal.style.display !== 'flex';
  if (!shouldOpen) {
    modal.style.display = 'none';
    return;
  }

  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  renderChinchiroHistory(latestGameState?.chinchiroHistory || [], false);
  modal.style.display = 'flex';
}

function clearRevealedChinchiroRoll() {
  if (revealedChinchiroRollTimer) clearTimeout(revealedChinchiroRollTimer);
  revealedChinchiroRollTimer = null;
  revealedChinchiroRollId = null;
}

function finishChinchiroDiceAnimation(data = latestGameState) {
  if (diceRollAnimationInterval) clearInterval(diceRollAnimationInterval);
  if (diceRollAnimationTimer) clearTimeout(diceRollAnimationTimer);
  diceRollAnimationInterval = null;
  diceRollAnimationTimer = null;
  document.querySelector('.chinchiro-dice-panel')?.classList.remove('is-rolling');
  document.getElementById('chinchiro-bowl')?.classList.remove('is-shaking');

  const animatedPlayerId = animatedChinchiroPlayerId;
  const currentRound = data?.status === 'finished'
    ? data.completedRounds
    : (data?.completedRounds || 0) + 1;
  const lastRoll = [...(data?.chinchiroHistory || [])].reverse()
    .find(entry => entry.round === currentRound && entry.playerId === animatedPlayerId);
  renderBowlDice(animatedDiceResult || lastRoll?.dice || []);
  animatedDiceResult = null;
  animatedChinchiroPlayerId = null;
  isDiceRollAnimating = false;

  if (data?.status === 'playing' && lastRoll && data.turnPlayerId !== animatedPlayerId) {
    clearRevealedChinchiroRoll();
    revealedChinchiroRollId = lastRoll.id;
    revealedChinchiroRollTimer = setTimeout(() => {
      clearRevealedChinchiroRoll();
      if (latestGameState?.gameType === 'chinchiro') updateUI(latestGameState);
    }, CHINCHIRO_RESULT_REVEAL_MS);
  }
}

function startChinchiroDiceAnimation(finalDice = null, playerId = null, waitForServerResult = false) {
  clearRevealedChinchiroRoll();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isDiceRollAnimating) {
    if (Array.isArray(finalDice)) animatedDiceResult = [...finalDice];
    if (playerId) animatedChinchiroPlayerId = playerId;
    if (reducedMotion && Array.isArray(finalDice)) renderBowlDice(finalDice);
    return;
  }
  const dicePanel = document.querySelector('.chinchiro-dice-panel');
  const bowl = document.getElementById('chinchiro-bowl');
  if (!dicePanel || !bowl) return;

  isDiceRollAnimating = true;
  animatedChinchiroPlayerId = playerId || latestGameState?.turnPlayerId || null;
  animatedDiceResult = Array.isArray(finalDice) ? [...finalDice] : null;
  dicePanel.classList.add('is-rolling');
  bowl.classList.remove('is-shaking');
  void bowl.offsetWidth;
  bowl.classList.add('is-shaking');

  if (!reducedMotion) {
    renderBowlDice(Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1));
    diceRollAnimationInterval = setInterval(() => {
      renderBowlDice(Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1));
    }, 90);
  }
  if (!waitForServerResult) {
    diceRollAnimationTimer = setTimeout(() => {
      const data = latestGameState;
      finishChinchiroDiceAnimation(data);
      if (data?.gameType === 'chinchiro') updateUI(data);
    }, CHINCHIRO_ROLL_ANIMATION_MS);
  }
}

function holdChinchiro() {
  if (myRoomId && revealedChinchiroRollId === null) socket.emit('hold-chinchiro', myRoomId);
}

function isValidPlayClient(playedCards, fieldCards, rules = {}, state = {}) {
  const hasDiamondThree = (currentHand || []).some(c => c.id === '♦3');
  if (state.mustPlayDiamondThree && hasDiamondThree && !playedCards.some(c => c.id === '♦3')) {
    return { valid: false, message: '♦3を持っている場合は、♦3を含むカードを出してください。' };
  }
  return daifugoRules.isValidPlay(playedCards, fieldCards, rules, state);
}

/**
 * 手札の各カードが「現在選択可能か」を判定する
 */
function isCardSelectable(card) {
  if (!latestGameState || latestGameState.status !== 'playing') return false;

  const currentSocketId = socket.id || myId;
  const isMyTurn = latestGameState.turnPlayerId === currentSocketId;
  const selectedCards = currentHand.filter(c => selectedCardIds.has(c.id));
  const hasDiamondThree = currentHand.some(c => c.id === '♦3');
  if (latestGameState.mustPlayDiamondThree && hasDiamondThree
    && !selectedCards.some(c => c.id === '♦3') && card.id !== '♦3') {
    return false;
  }

  return daifugoRules.isCardSelectable(
    card,
    currentHand,
    selectedCards,
    latestGameState.fieldCards || [],
    latestGameState.rules || {},
    latestGameState,
    isMyTurn
  );
}

function renderCard(card, isClickable = true, isSelected = false, isSelectable = true) {
  const isJoker = card.id === 'JOKER';
  const isRed = card.suit === '♥' || card.suit === '♦';

  let classes = ['card'];
  if (isClickable) classes.push('hand-card');
  if (isJoker) classes.push('joker');
  if (isRed) classes.push('red');
  if (isSelected) classes.push('selected');
  if (isClickable && !isSelectable && !isSelected) classes.push('disabled');

  const clickAttr = isClickable ? `onclick="handleCardClick('${card.id}')"` : '';
  const display = isJoker
    ? '<span class="card-joker-label">JOKER</span>'
    : `
      <span class="card-corner">
        <span class="card-corner-suit">${escapeHtml(card.suit)}</span>
        <strong class="card-corner-rank">${escapeHtml(card.num)}</strong>
      </span>
      <span class="card-center-suit" aria-hidden="true">${escapeHtml(card.suit)}</span>
    `;

  return `<div class="${classes.join(' ')}" ${clickAttr}>${display}</div>`;
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
    updatePlayButton();
    updateHand(currentHand);
    return;
  }

  if (isCardSelectable(card)) {
    selectedCardIds.add(cardId);
    updatePlayButton();
    updateHand(currentHand);
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
    passBtn.disabled = true;
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
    passBtn.disabled = true;
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
    passBtn.disabled = true;
    passBtn.style.visibility = 'visible';
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

  const handSection = handEl.closest('.hand-section');
  const currentSocketId = socket.id || myId;
  const canAct = !!latestGameState && (
    !!pendingExchangeSelection
    || !!pendingSideSelection
    || (latestGameState.status === 'playing' && latestGameState.turnPlayerId === currentSocketId)
  );
  handSection?.classList.toggle('is-my-turn', canAct);
  handSection?.classList.toggle('is-waiting', !!latestGameState && !canAct);
  handEl.classList.toggle('is-multi-row', canAct && hand.length > 13);

  if (hand.length === 0) {
    handEl.innerHTML = '<div style="color: #2ecc71; font-weight: bold; font-size: 18px;">あがり！おめでとうございます！</div>';
  } else {
    const renderedCards = hand.map(c => {
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
    });
    const rowSizes = renderedCards.length === 27
      ? [13, 14]
      : Array.from({ length: Math.ceil(renderedCards.length / 13) }, (_, rowIndex) => (
        Math.min(13, renderedCards.length - rowIndex * 13)
      ));
    let cardOffset = 0;
    handEl.innerHTML = rowSizes.map(rowSize => {
      const rowClass = rowSize === 14 ? ' hand-row--14' : '';
      const rowCards = renderedCards.slice(cardOffset, cardOffset + rowSize);
      cardOffset += rowSize;
      return `<div class="hand-row${rowClass}">${rowCards.join('')}</div>`;
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
    ? `${data.completedRounds}戦終了 · ${data.gameType === 'chinchiro' ? '順位ポイント' : '役職ポイント'}累計`
    : '1戦目 · 対局中';
  listElement.replaceChildren();

  players.forEach((player, index) => {
    const isChinchiro = data.gameType === 'chinchiro';
    const row = document.createElement('div');
    row.className = `overall-ranking-item ${isChinchiro ? 'is-chinchiro' : ''} ${player.id === currentSocketId ? 'is-me' : ''}`;

    const rank = document.createElement('span');
    rank.className = 'overall-rank-number';
    rank.textContent = String(index + 1);

    const name = document.createElement('span');
    name.className = 'overall-player-name';
    name.textContent = player.name;

    const points = document.createElement('strong');
    points.className = 'overall-points';
    points.append(document.createTextNode(String(player.totalPoints || 0)));
    const unit = document.createElement('small');
    unit.textContent = 'pt';
    points.appendChild(unit);

    row.append(rank, name, points);
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

function returnToRoomLobby() {
  const room = latestGameState;
  if (!room) {
    myRoomId = '';
    isHost = false;
    clearRecoveryState();
    resetToLobbyView();
    return;
  }

  document.getElementById('lobby-container').style.display = 'block';
  document.getElementById('game-container').style.display = 'none';
  document.getElementById('game-finished-modal').style.display = 'none';
  document.getElementById('rules-modal').style.display = 'none';
  document.getElementById('overall-ranking-modal').style.display = 'none';
  document.body.classList.remove('game-active', 'revolution-mode', 'chinchiro-mode');
  document.documentElement.classList.remove('revolution-mode');
  renderTurnCountdown(null);
  resetViewportLayout();
  clearSelectionState();
  pendingExchangeSelection = null;
  currentHand = [];
  updateWaitingRoom(room);
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
  const currentSocketId = socket.id || myId;
  document.querySelector('.result-summary').textContent = data.gameType === 'chinchiro'
    ? '今回の順位ポイントと累計スコア'
    : '今回の順位と役職ポイント';

  const sortedPlayers = [...data.players].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return a.cardCount - b.cardCount;
  });

  rankingList.innerHTML = sortedPlayers.map((p, idx) => {
    const rankTitle = p.rank ? `${p.rank}位` : `${idx + 1}位`;
    const roundPoints = data.gameType === 'chinchiro'
      ? (p.roundPoints || 0)
      : (ROLE_POINTS[p.role] ?? 0);
    const roundPointsLabel = roundPoints > 0 ? `+${roundPoints}` : String(roundPoints);
    const isMe = p.id === currentSocketId;
    return `
      <div class="ranking-item rank-${p.rank || idx + 1}${isMe ? ' is-me' : ''}${data.gameType === 'chinchiro' ? ' is-chinchiro' : ''}">
        <span class="ranking-place">${rankTitle}</span>
        <span class="ranking-player"><strong>${escapeHtml(p.name)}</strong></span>
        ${data.gameType === 'chinchiro'
          ? `<span class="ranking-role"><span class="chinchiro-result-badge">${escapeHtml(p.chinchiroHand?.label || p.role || '—')}</span></span>`
          : `<span class="ranking-role">${getRoleBadge(p.role)}</span>`}
        <span class="ranking-result-meta"><strong>${roundPointsLabel}</strong><small>pt</small></span>
      </div>
    `;
  }).join('');

  renderOverallRanking(overallRankingList, overallRankingRounds, data);

  const amIHost = isHost || (data.hostId === currentSocketId);

  if (amIHost) {
    nextGameBtn.style.display = 'inline-block';
    nextGameBtn.innerText = data.gameType === 'chinchiro'
      ? '次のラウンドを開始'
      : '次のゲームを開始（カード交換あり）';
    guestNextHint.style.display = 'none';
  } else {
    nextGameBtn.style.display = 'none';
    guestNextHint.style.display = 'block';
  }

  modal.style.display = 'flex';
}

// Enterキーでの送信対応
document.addEventListener('DOMContentLoaded', () => {
  ['create-room-id', 'join-room-id'].forEach(id => {
    const input = document.getElementById(id);
    input?.addEventListener('input', () => sanitizeRoomIdInput(input));
  });

  const createInputs = ['create-player-name', 'create-room-id'];
  updateGameSetup();
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
