const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const roomManager = require('./game/roomManager');
const { chooseCpuAction, chooseCpuExchangeCards } = require('./game/cpuPlayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});
const cpuTurnTimers = new Map();
const CPU_TURN_DELAY_MS = Math.max(0, Number(process.env.CPU_TURN_DELAY_MS) || 550);
const humanTurnTimers = new Map();
const TURN_SELECTION_TIMEOUT_MS = Math.max(100, Number(process.env.TURN_SELECTION_TIMEOUT_MS) || 30000);

app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/socket.io')) {
    return res.status(404).end();
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

function broadcastRoomUpdate(room) {
  io.to(room.id).emit('room-updated', roomManager.getPublicState(room));
}

function clearHumanTurnTimer(roomId) {
  const timer = humanTurnTimers.get(roomId);
  if (timer) clearTimeout(timer);
  humanTurnTimers.delete(roomId);
  const room = roomManager.rooms[roomId];
  if (room) room.turnDeadlineAt = null;
}

function scheduleHumanTurnTimer(roomId) {
  clearHumanTurnTimer(roomId);
  const room = roomManager.rooms[roomId];
  const player = room?.players[room.turnIndex];
  if (!room || room.status !== 'playing' || !player || player.isCpu
    || player.id === room.firstTurnExemptPlayerId) return;

  const currentPlayerId = player.id;
  room.turnDeadlineAt = Date.now() + TURN_SELECTION_TIMEOUT_MS;
  const timer = setTimeout(() => {
    humanTurnTimers.delete(roomId);
    const currentRoom = roomManager.rooms[roomId];
    const currentPlayer = currentRoom?.players[currentRoom.turnIndex];
    if (!currentRoom || currentRoom.status !== 'playing') return;
    if (!currentPlayer || currentPlayer.id !== currentPlayerId) {
      scheduleHumanTurnTimer(roomId);
      return;
    }

    currentRoom.turnDeadlineAt = null;
    const action = currentRoom.fieldCards.length === 0
      ? { type: 'pass' }
      : chooseCpuAction(currentRoom, currentPlayer);
    let result = action.type === 'play'
      ? roomManager.playCards(currentPlayer.id, {
        roomId,
        cards: action.cards,
        discardCards: action.discardCards,
        passedCards: action.passedCards
      })
      : roomManager.passTurn(currentPlayer.id, roomId);

    if (!result.success && currentRoom.fieldCards.length > 0) {
      result = roomManager.passTurn(currentPlayer.id, roomId);
    }

    if (!result.success) {
      currentRoom.actionMessage = `${currentPlayer.name} は時間切れです。${result.message}`;
      scheduleHumanTurnTimer(roomId);
      io.to(roomId).emit('state-updated', roomManager.getPublicState(currentRoom));
      return;
    }

    const actionMessage = result.room.actionMessage || '';
    result.room.actionMessage = `${currentPlayer.name} は時間切れのため自動で${action.type === 'pass' ? 'パスしました' : 'プレイしました'}。 ${actionMessage}`.trim();
    scheduleHumanTurnTimer(roomId);
    io.to(roomId).emit('state-updated', roomManager.getPublicState(result.room));
    if (result.updatedHand) io.to(currentPlayer.id).emit('hand-updated', result.updatedHand);
    scheduleCpuTurn(roomId);
  }, TURN_SELECTION_TIMEOUT_MS);

  humanTurnTimers.set(roomId, timer);
}

function broadcastGameStarted(room) {
  const publicState = roomManager.getPublicState(room);
  room.players.filter(player => !player.isCpu).forEach(player => {
    io.to(player.id).emit('game-started', {
      ...publicState,
      hand: player.hand
    });
  });
}

function completeCardExchange(room) {
  scheduleHumanTurnTimer(room.id);
  const publicState = roomManager.getPublicState(room);
  io.to(room.id).emit('state-updated', publicState);
  broadcastGameStarted(room);
  scheduleCpuTurn(room.id);
}

function submitCpuExchangeSelections(roomId) {
  const room = roomManager.rooms[roomId];
  if (!room || room.status !== 'waiting-exchange') return;

  for (const player of room.players) {
    const requiredCount = room.exchangeRequirements?.[player.id] || 0;
    if (!player.isCpu || !requiredCount || room.exchangeSelections?.[player.id]) continue;

    const cards = chooseCpuExchangeCards(player.hand, requiredCount, player.difficulty);
    const result = roomManager.submitExchangeCards(player.id, { roomId, cards });
    if (!result.success) {
      console.error(`CPU card exchange failed for ${player.name}: ${result.message}`);
      return;
    }
    if (result.completed) {
      completeCardExchange(room);
      return;
    }
  }
}

function scheduleCpuTurn(roomId) {
  const room = roomManager.rooms[roomId];
  const player = room?.players[room.turnIndex];
  if (!room || room.status !== 'playing' || !player?.isCpu || cpuTurnTimers.has(roomId)) return;
  clearHumanTurnTimer(roomId);

  const scheduledPlayerId = player.id;
  const timer = setTimeout(() => {
    cpuTurnTimers.delete(roomId);
    const currentRoom = roomManager.rooms[roomId];
    const currentPlayer = currentRoom?.players[currentRoom.turnIndex];
    if (!currentRoom || currentRoom.status !== 'playing' || currentPlayer?.id !== scheduledPlayerId) {
      scheduleCpuTurn(roomId);
      return;
    }

    const action = chooseCpuAction(currentRoom, currentPlayer);
    let result = action.type === 'play'
      ? roomManager.playCards(currentPlayer.id, {
        roomId,
        cards: action.cards,
        discardCards: action.discardCards,
        passedCards: action.passedCards
      })
      : roomManager.passTurn(currentPlayer.id, roomId);

    if (!result.success && currentRoom.fieldCards.length > 0) {
      console.warn(`CPU action failed for ${currentPlayer.name}: ${result.message}`);
      result = roomManager.passTurn(currentPlayer.id, roomId);
    }

    if (!result.success) {
      console.error(`CPU could not act for ${currentPlayer.name}: ${result.message}`);
      return;
    }

    scheduleHumanTurnTimer(roomId);
    io.to(roomId).emit('state-updated', roomManager.getPublicState(result.room));
    scheduleCpuTurn(roomId);
  }, CPU_TURN_DELAY_MS);

  cpuTurnTimers.set(roomId, timer);
}

io.on('connection', (socket) => {
  console.log('ユーザー接続:', socket.id);

  // ルーム新規作成
  socket.on('create-room', ({ roomId, playerName, playerId, rules }) => {
    socket.data.playerId = playerId || socket.id;
    const result = roomManager.createRoom(socket, { roomId, playerName, playerId: socket.data.playerId, rules });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    socket.join(result.room.id);
    const publicState = roomManager.getPublicState(result.room);
    socket.emit('room-joined', { room: publicState, isHost: true, playerId: socket.data.playerId });
    io.to(result.room.id).emit('room-updated', publicState);
  });

  socket.on('add-cpu-player', ({ roomId, difficulty }) => {
    const result = roomManager.addCpuPlayer(socket.id, roomId, difficulty);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }
    broadcastRoomUpdate(result.room);
  });

  socket.on('remove-cpu-player', (roomId) => {
    const result = roomManager.removeCpuPlayer(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }
    broadcastRoomUpdate(result.room);
  });

  socket.on('set-room-lock', ({ roomId, isLocked }) => {
    const result = roomManager.setRoomLock(socket.id, roomId, isLocked);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }
    broadcastRoomUpdate(result.room);
  });

  // 既存ルーム参加
  socket.on('join-room', ({ roomId, playerName, playerId }) => {
    const stablePlayerId = playerId || socket.id;
    socket.data.playerId = stablePlayerId;
    const result = roomManager.joinRoom(socket, { roomId, playerName, playerId: stablePlayerId });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    socket.join(result.room.id);
    const publicState = roomManager.getPublicState(result.room);
    const isHost = result.room.hostId === socket.id;
    socket.emit('room-joined', { room: publicState, isHost, playerId: stablePlayerId });
    io.to(result.room.id).emit('room-updated', publicState);
  });

  socket.on('check-room-exists', (roomId) => {
    const targetRoomId = String(roomId || '').trim();
    const exists = !!roomManager.rooms[targetRoomId];
    socket.emit('room-exists', { roomId: targetRoomId, exists });
  });

  // ゲーム開始（次ゲーム再開にも対応）
  socket.on('start-game', (roomId) => {
    const result = roomManager.startGame(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    const { room } = result;
    scheduleHumanTurnTimer(roomId);
    broadcastGameStarted(room);
    submitCpuExchangeSelections(roomId);
    scheduleCpuTurn(roomId);
  });

  socket.on('close-room', (roomId) => {
    const result = roomManager.closeRoom(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    io.to(roomId).emit('room-closed', { roomId });
    io.in(roomId).socketsLeave(roomId);
    const timer = cpuTurnTimers.get(roomId);
    if (timer) clearTimeout(timer);
    cpuTurnTimers.delete(roomId);
    clearHumanTurnTimer(roomId);
  });

  socket.on('exchange-cards', ({ roomId, cards }) => {
    const result = roomManager.submitExchangeCards(socket.id, { roomId, cards });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    if (result.completed) completeCardExchange(result.room);
    else io.to(roomId).emit('state-updated', roomManager.getPublicState(result.room));
    submitCpuExchangeSelections(roomId);
  });

  socket.on('pause-turn-timer', (roomId) => {
    const room = roomManager.rooms[roomId];
    const currentPlayer = room?.players[room.turnIndex];
    if (!room || room.status !== 'playing' || currentPlayer?.id !== socket.id || currentPlayer.isCpu) return;

    clearHumanTurnTimer(roomId);
    socket.emit('turn-timer-paused', { roomId });
  });

  // カードを出す (複数枚出し・ペア・革命対応)
  socket.on('play-cards', ({ roomId, cards, discardCards = [], passedCards = [] }) => {
    const result = roomManager.playCards(socket.id, { roomId, cards, discardCards, passedCards });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    scheduleHumanTurnTimer(roomId);
    const publicState = roomManager.getPublicState(result.room);
    io.to(roomId).emit('state-updated', publicState);
    socket.emit('hand-updated', result.updatedHand);
    scheduleCpuTurn(roomId);
  });

  // 1枚出し後方互換
  socket.on('play-card', ({ roomId, card }) => {
    const result = roomManager.playCards(socket.id, { roomId, cards: [card] });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    scheduleHumanTurnTimer(roomId);
    const publicState = roomManager.getPublicState(result.room);
    io.to(roomId).emit('state-updated', publicState);
    socket.emit('hand-updated', result.updatedHand);
    scheduleCpuTurn(roomId);
  });

  // パスする
  socket.on('pass-turn', (roomId) => {
    const result = roomManager.passTurn(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    scheduleHumanTurnTimer(roomId);
    const publicState = roomManager.getPublicState(result.room);
    io.to(roomId).emit('state-updated', publicState);
    scheduleCpuTurn(roomId);
  });

  // 切断処理
  socket.on('disconnect', () => {
    console.log('ユーザー切断:', socket.id);
    const playerId = socket.data.playerId || null;
    const updatedRoom = roomManager.leaveRoom(socket.id, playerId);
    if (updatedRoom) {
      const publicState = roomManager.getPublicState(updatedRoom);
      io.to(updatedRoom.id).emit('room-updated', publicState);
      io.to(updatedRoom.id).emit('state-updated', publicState);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
