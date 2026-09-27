const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const roomManager = require('./game/roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, '../public')));

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
    const publicState = roomManager.getPublicState(room);

    room.players.forEach(player => {
      io.to(player.id).emit('game-started', {
        ...publicState,
        hand: player.hand
      });
    });
  });

  socket.on('close-room', (roomId) => {
    const result = roomManager.closeRoom(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    io.to(roomId).emit('room-closed', { roomId });
    io.in(roomId).socketsLeave(roomId);
  });

  socket.on('exchange-cards', ({ roomId, cards }) => {
    const result = roomManager.submitExchangeCards(socket.id, { roomId, cards });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    const publicState = roomManager.getPublicState(result.room);
    io.to(roomId).emit('state-updated', publicState);
    if (result.completed) {
      roomManager.getPublicState(result.room).players.forEach(player => {
        io.to(player.id).emit('game-started', {
          ...publicState,
          hand: roomManager.rooms[roomId].players.find(p => p.id === player.id)?.hand || []
        });
      });
    }
  });

  // カードを出す (複数枚出し・ペア・革命対応)
  socket.on('play-cards', ({ roomId, cards, discardCards = [], passedCards = [] }) => {
    const result = roomManager.playCards(socket.id, { roomId, cards, discardCards, passedCards });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    const publicState = roomManager.getPublicState(result.room);
    io.to(roomId).emit('state-updated', publicState);
    socket.emit('hand-updated', result.updatedHand);
  });

  // 1枚出し後方互換
  socket.on('play-card', ({ roomId, card }) => {
    const result = roomManager.playCards(socket.id, { roomId, cards: [card] });
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    const publicState = roomManager.getPublicState(result.room);
    io.to(roomId).emit('state-updated', publicState);
    socket.emit('hand-updated', result.updatedHand);
  });

  // パスする
  socket.on('pass-turn', (roomId) => {
    const result = roomManager.passTurn(socket.id, roomId);
    if (!result.success) {
      socket.emit('error', result.message);
      return;
    }

    const publicState = roomManager.getPublicState(result.room);
    io.to(roomId).emit('state-updated', publicState);
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
