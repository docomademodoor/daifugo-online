const { evaluateChinchiro, rollDice } = require('./rules');

function startRound(roomManager, room) {
  room.status = 'playing';
  room.turnIndex = (room.completedRounds || 0) % room.players.length;
  room.chinchiroHistory = room.chinchiroHistory || [];
  room.winners = [];
  room.players.forEach(player => {
    player.hand = [];
    player.dice = [];
    player.chinchiroHand = null;
    player.rollsUsed = 0;
    player.chinchiroFinished = false;
    player.isWinner = false;
    player.rank = null;
    player.role = null;
    player.roundPoints = 0;
  });
  room.actionMessage = `${room.players[room.turnIndex].name}から開始します。最大3回まで振れます。`;
  return { success: true, room };
}

function roll(room, socketId) {
  if (!room || room.gameType !== 'chinchiro' || room.status !== 'playing') {
    return { success: false, message: 'チンチロのゲーム中ではありません' };
  }

  const player = room.players[room.turnIndex];
  if (!player || player.id !== socketId) return { success: false, message: 'あなたの番ではありません' };
  if (player.rollsUsed >= 3) return { success: false, message: 'このターンは3回振り終わっています' };

  player.dice = rollDice();
  player.chinchiroHand = evaluateChinchiro(player.dice);
  player.rollsUsed++;
  const round = (room.completedRounds || 0) + 1;
  const rollId = (room.chinchiroHistory.at(-1)?.id || 0) + 1;
  room.chinchiroHistory.push({
    id: rollId,
    round,
    playerId: player.id,
    playerName: player.name,
    dice: [...player.dice],
    label: player.chinchiroHand.label,
    rollNumber: player.rollsUsed,
    confirmed: false
  });
  if (room.chinchiroHistory.length > 60) room.chinchiroHistory.shift();
  room.actionMessage = `${player.name}：${player.chinchiroHand.label}（${player.rollsUsed}/3回目）`;
  return { success: true, room };
}

function hold(room, socketId) {
  if (!room || room.gameType !== 'chinchiro' || room.status !== 'playing') {
    return { success: false, message: 'チンチロのゲーム中ではありません' };
  }

  const player = room.players[room.turnIndex];
  if (!player || player.id !== socketId) return { success: false, message: 'あなたの番ではありません' };
  if (player.rollsUsed === 0) return { success: false, message: '先にサイコロを振ってください' };

  const currentRound = (room.completedRounds || 0) + 1;
  const previousRoll = [...(room.chinchiroHistory || [])].reverse().find(entry =>
    entry.playerId === player.id && entry.round === currentRound && !entry.confirmed
  );
  if (previousRoll) previousRoll.confirmed = true;
  room.actionMessage = `${player.name}は「${player.chinchiroHand.label}」で確定しました`;
  finishTurn(room, player);
  return { success: true, room };
}

function finishTurn(room, player) {
  player.chinchiroFinished = true;
  const nextIndex = room.players.findIndex((candidate, index) =>
    index !== room.turnIndex && !candidate.chinchiroFinished
  );

  if (nextIndex !== -1) {
    room.turnIndex = nextIndex;
    room.actionMessage += `。次は${room.players[nextIndex].name}の番です`;
    return;
  }

  const ranked = [...room.players].sort((left, right) =>
    right.chinchiroHand.strength - left.chinchiroHand.strength
  );
  let previousStrength = null;
  let previousRank = 0;
  ranked.forEach((rankedPlayer, index) => {
    if (rankedPlayer.chinchiroHand.strength !== previousStrength) {
      previousRank = index + 1;
      previousStrength = rankedPlayer.chinchiroHand.strength;
    }
    rankedPlayer.rank = previousRank;
    rankedPlayer.role = rankedPlayer.chinchiroHand.label;
    rankedPlayer.roundPoints = room.players.length - previousRank + 1;
    rankedPlayer.totalPoints = (rankedPlayer.totalPoints || 0) + rankedPlayer.roundPoints;
    rankedPlayer.isWinner = previousRank === 1;
  });

  room.winners = ranked.filter(rankedPlayer => rankedPlayer.rank === 1);
  room.status = 'finished';
  room.completedRounds = (room.completedRounds || 0) + 1;
  room.actionMessage = '全員の役が確定しました。ラウンド終了！';
}

function getPublicPlayerState(player) {
  return {
    dice: player.dice || [],
    chinchiroHand: player.chinchiroHand || null,
    rollsUsed: player.rollsUsed || 0,
    chinchiroFinished: !!player.chinchiroFinished,
    roundPoints: player.roundPoints || 0
  };
}

function getPublicState(room) {
  return {
    fieldCards: [],
    isRevolution: false,
    isElevenBack: false,
    isReversed: false,
    lockedSuit: null,
    lockedNumber: null,
    exchangeRequirements: {},
    chinchiroHistory: room.chinchiroHistory || []
  };
}

module.exports = {
  startRound,
  roll,
  hold,
  finishTurn,
  actions: { roll, hold },
  getPublicPlayerState,
  getPublicState
};