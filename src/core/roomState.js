const ROOM_STATUS = Object.freeze({
  WAITING: 'waiting',
  PLAYING: 'playing',
  WAITING_EXCHANGE: 'waiting-exchange',
  FINISHED: 'finished'
});

function createHumanPlayer({ id, playerId = id, name = 'Player' }) {
  return {
    id,
    playerId,
    name,
    hand: [],
    isWinner: false,
    rank: null,
    role: null,
    connected: true,
    isCpu: false,
    totalPoints: 0
  };
}

function createCpuPlayer({ id, name, difficulty = 'normal' }) {
  return {
    ...createHumanPlayer({ id, playerId: id, name }),
    isCpu: true,
    difficulty,
  };
}

function createRoomState({ id, hostId, gameType, maxPlayers, rules, hostPlayer, initialState = {} }) {
  return {
    id,
    hostId,
    gameType,
    maxPlayers,
    rules,
    players: [hostPlayer],
    status: ROOM_STATUS.WAITING,
    isLocked: false,
    nextCpuNumber: 1,
    joinRequests: {},
    ...initialState
  };
}

function rebindPlayerConnection(room, player, socketId, playerName) {
  const previousSocketId = player.id;
  player.id = socketId;
  player.connected = true;
  player.name = playerName || player.name;

  if (room.hostId === previousSocketId) room.hostId = socketId;
  if (room.exchangeRequirements?.[previousSocketId] !== undefined) {
    room.exchangeRequirements[socketId] = room.exchangeRequirements[previousSocketId];
    delete room.exchangeRequirements[previousSocketId];
  }
  if (room.exchangeSelections?.[previousSocketId]) {
    room.exchangeSelections[socketId] = room.exchangeSelections[previousSocketId];
    delete room.exchangeSelections[previousSocketId];
  }
  if (room.pendingSideSelection?.playerId === previousSocketId) {
    room.pendingSideSelection.playerId = socketId;
  }

  return previousSocketId;
}

function createJoinRequest({ socketId, playerId = socketId, playerName }) {
  return {
    requestId: `join-${Date.now()}-${socketId}`,
    socketId,
    playerId,
    playerName
  };
}

function consumeJoinRequest(room, requestId) {
  const request = room.joinRequests?.[requestId];
  if (!request) return null;
  delete room.joinRequests[requestId];
  return request;
}

module.exports = {
  ROOM_STATUS,
  createHumanPlayer,
  createCpuPlayer,
  createRoomState,
  rebindPlayerConnection,
  createJoinRequest,
  consumeJoinRequest
};
