const { createDeck } = require('../utils/deck');
const { isValidPlay, checkForbiddenFinish, countEffectiveRank } = require('./rules');
const { applyCardEffects, checkMiyakoOchi } = require('./cardEffects');

const ROLE_POINTS = {
  '大富豪': 2,
  '富豪': 1,
  '平民': 0,
  '貧民': -1,
  '大貧民': -2
};

class RoomManager {
  constructor() {
    this.rooms = {};
  }

  createRoom(socket, { roomId, playerName, playerId, rules }) {
    if (!roomId || !roomId.trim()) {
      return { success: false, message: '合言葉（ルームID）を入力してください' };
    }

    const trimmedId = roomId.trim();
    if (this.rooms[trimmedId]) {
      return { success: false, message: 'その合言葉は既に使用されています。別の合言葉を指定してください。' };
    }

    const newRoom = {
      id: trimmedId,
      hostId: socket.id,
      rules: {
        eightCut: rules?.eightCut ?? true,
        revolution: rules?.revolution ?? true,
        suitLock: rules?.suitLock ?? true,
        spe3: rules?.spe3 ?? true,
        staircase: rules?.staircase ?? true,
        staircaseRevolution: rules?.staircaseRevolution ?? true,
        elevenBack: rules?.elevenBack ?? true,
        numberLock: rules?.numberLock ?? true,
        fiveSkip: rules?.fiveSkip ?? true,
        sevenPass: rules?.sevenPass ?? true,
        tenDiscard: rules?.tenDiscard ?? true,
        dia3Start: rules?.dia3Start ?? true,
        miyakoOchi: rules?.miyakoOchi ?? true,
        forbiddenFinish: rules?.forbiddenFinish ?? true,
        includeJoker: rules?.includeJoker ?? true,
      },
      players: [
        {
          id: socket.id,
          playerId: playerId || socket.id,
          name: (playerName && playerName.trim()) || 'ホスト',
          hand: [],
          isWinner: false,
          rank: null,
          role: null,
          connected: true,
          isCpu: false,
          totalPoints: 0
        }
      ],
      fieldCards: [],
      turnIndex: 0,
      passCount: 0,
      lastPlayedIndex: 0,
      status: 'waiting',
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      actionMessage: 'ルームが作成されました',
      winners: [],
      previousRoles: null,
      isLocked: false,
      nextCpuNumber: 1,
      completedRounds: 0,
      firstTurnExemptPlayerId: null,
      turnDeadlineAt: null,
      pendingSideSelection: null
    };

    this.rooms[trimmedId] = newRoom;
    return { success: true, room: newRoom };
  }

  joinRoom(socket, { roomId, playerName, playerId }) {
    if (!roomId || !roomId.trim()) {
      return { success: false, message: '合言葉（ルームID）を入力してください' };
    }

    const trimmedId = roomId.trim();
    const room = this.rooms[trimmedId];
    if (!room) {
      return { success: false, message: 'ルームが見つかりません。合言葉を確認するか、新規作成してください。' };
    }

    if (room.status !== 'waiting' && room.status !== 'finished') {
      return { success: false, message: 'このゲームは現在プレイ中です' };
    }

    const existingPlayer = room.players.find(p => p.playerId === (playerId || socket.id));
    if (existingPlayer) {
      const previousSocketId = existingPlayer.id;
      existingPlayer.id = socket.id;
      existingPlayer.connected = true;
      existingPlayer.name = (playerName && playerName.trim()) || existingPlayer.name || `プレイヤー${room.players.length + 1}`;
      if (room.hostId === previousSocketId) {
        room.hostId = socket.id;
      }
      return { success: true, room, playerId: existingPlayer.playerId };
    }

    if (room.isLocked) {
      return { success: false, message: 'このルームはロックされています' };
    }

    this.resetSeriesForRosterChange(room);

    if (room.players.length >= 8) {
      let cpuIndex = -1;
      for (let index = room.players.length - 1; index >= 0; index--) {
        if (room.players[index].isCpu) {
          cpuIndex = index;
          break;
        }
      }
      if (cpuIndex === -1) {
        return { success: false, message: '部屋が満員です（最大8人まで参加可能）' };
      }
      room.players.splice(cpuIndex, 1);
    }

    const newPlayer = {
      id: socket.id,
      playerId: playerId || socket.id,
      name: (playerName && playerName.trim()) || `プレイヤー${room.players.length + 1}`,
      hand: [],
      isWinner: false,
      rank: null,
      role: null,
      connected: true,
      isCpu: false,
      totalPoints: 0
    };
    room.players.push(newPlayer);

    return { success: true, room, playerId: newPlayer.playerId };
  }

  addCpuPlayer(socketId, roomId, difficulty = 'normal') {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみCPUを追加できます' };
    if (room.status !== 'waiting' && room.status !== 'finished') {
      return { success: false, message: 'ゲーム中はCPUを変更できません' };
    }
    if (room.players.length >= 8) return { success: false, message: '参加人数は最大8人です' };

    this.resetSeriesForRosterChange(room);

    const cpuNumber = room.nextCpuNumber++;
    const cpuId = `cpu-${room.id}-${cpuNumber}`;
    const cpuDifficulty = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
    room.players.push({
      id: cpuId,
      playerId: cpuId,
      name: `CPU ${cpuNumber}`,
      hand: [],
      isWinner: false,
      rank: null,
      role: null,
      connected: true,
      isCpu: true,
      difficulty: cpuDifficulty,
      totalPoints: 0
    });
    room.actionMessage = `CPU ${cpuNumber}が参加しました`;
    return { success: true, room };
  }

  removeCpuPlayer(socketId, roomId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみCPUを削除できます' };
    if (room.status !== 'waiting' && room.status !== 'finished') {
      return { success: false, message: 'ゲーム中はCPUを変更できません' };
    }

    const cpuIndex = room.players.findLastIndex(player => player.isCpu);
    if (cpuIndex === -1) return { success: false, message: '削除できるCPUがいません' };

    this.resetSeriesForRosterChange(room);
    const [removedCpu] = room.players.splice(cpuIndex, 1);
    room.actionMessage = `${removedCpu.name}が退出しました`;
    return { success: true, room };
  }

  resetSeriesForRosterChange(room) {
    if (!room.completedRounds) return;

    room.completedRounds = 0;
    room.previousRoles = null;
    room.winners = [];
    room.players.forEach(player => {
      player.totalPoints = 0;
      player.rank = null;
      player.role = null;
      player.previousRole = null;
    });
  }

  setRoomLock(socketId, roomId, isLocked) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };
    if (room.hostId !== socketId) return { success: false, message: 'ホストのみロックを変更できます' };
    if (room.status !== 'waiting' && room.status !== 'finished') {
      return { success: false, message: 'ゲーム中はロックを変更できません' };
    }

    room.isLocked = !!isLocked;
    room.actionMessage = room.isLocked ? 'ルームをロックしました' : 'ルームのロックを解除しました';
    return { success: true, room };
  }

  startGame(socketId, roomId) {
    const room = this.rooms[roomId];
    if (!room) return { success: false, message: 'ルームが存在しません' };

    if (room.hostId !== socketId) {
      return { success: false, message: 'ルーム作成者（ホスト）のみがゲームを開始できます' };
    }

    if (room.players.length < 2) {
      return { success: false, message: 'ゲームを開始するには2人以上のプレイヤーが必要です' };
    }

    room.fieldCards = [];
    room.passCount = 0;
    room.lastPlayedIndex = 0;
    room.isRevolution = false;
    room.isElevenBack = false;
    room.lockedSuit = null;
    room.lockedNumber = null;
    room.winners = [];
    room.exchangeRequirements = {};
    room.exchangeSelections = {};
    room.turnDeadlineAt = null;
    room.firstTurnExemptPlayerId = null;
    room.pendingSideSelection = null;

    const deck = createDeck(room.rules.includeJoker);
    room.players.forEach(p => {
      p.hand = [];
      p.isWinner = false;
      p.rank = null;
    });

    deck.forEach((card, index) => {
      const playerIndex = index % room.players.length;
      room.players[playerIndex].hand.push(card);
    });

    room.players.forEach(p => p.hand.sort((a, b) => a.strength - b.strength));

    for (let i = room.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    }
    room.turnIndex = Math.floor(Math.random() * room.players.length);
    this.selectStartingPlayer(room);

    const exchangePlan = this.buildExchangePlan(room);
    if (exchangePlan.length > 0) {
      room.status = 'waiting-exchange';
      room.exchangeRequirements = exchangePlan.reduce((acc, pair) => {
        acc[pair.fromId] = pair.count;
        return acc;
      }, {});
      room.actionMessage = 'カード交換のカードを選んでください';
      return { success: true, room };
    }

    room.status = 'playing';
    room.actionMessage = 'ゲーム開始！カードを配りました。';

    return { success: true, room };
  }

  selectStartingPlayer(room) {
    if (!room.previousRoles && room.rules.dia3Start) {
      const dia3HolderIndex = room.players.findIndex(p =>
        p.hand.some(c => c.suit === '♦' && c.num === 3)
      );
      if (dia3HolderIndex !== -1) {
        room.turnIndex = dia3HolderIndex;
        room.actionMessage = `【♢3スタート】♦3を持っている ${room.players[dia3HolderIndex].name} からターン開始です！`;
      }
    } else if (room.previousRoles) {
      const lowestRole = room.players.length <= 3 ? '貧民' : '大貧民';
      const lowRankIndex = room.players.findIndex(p => p.role === lowestRole);
      if (lowRankIndex !== -1) {
        room.turnIndex = lowRankIndex;
        room.actionMessage = `${room.players[lowRankIndex].role}の ${room.players[lowRankIndex].name} からスタートです！`;
      }
    }

    room.firstTurnExemptPlayerId = room.players[room.turnIndex]?.id || null;
  }

  buildExchangePlan(room) {
    if (room.players.length < 4) return [];

    const daifugo = room.players.find(p => p.role === '大富豪');
    const fugo = room.players.find(p => p.role === '富豪');
    const hinmin = room.players.find(p => p.role === '貧民');
    const daihinmin = room.players.find(p => p.role === '大貧民');
    const pairs = [];

    if (daifugo && daihinmin) pairs.push({ fromId: daifugo.id, toId: daihinmin.id, count: 2 });
    if (fugo && hinmin) pairs.push({ fromId: fugo.id, toId: hinmin.id, count: 1 });

    return pairs;
  }

  handleCardExchange(room, selections = {}) {
    const exchangePlan = this.buildExchangePlan(room);
    if (exchangePlan.length === 0) return;

    const exchangeLog = [];

    for (const pair of exchangePlan) {
      const from = room.players.find(p => p.id === pair.fromId);
      const to = room.players.find(p => p.id === pair.toId);
      const chosen = Array.isArray(selections[pair.fromId]) ? selections[pair.fromId] : [];

      if (!from || !to || chosen.length !== pair.count) continue;

      const chosenIds = chosen.map(card => typeof card === 'string' ? card : card?.id);
      if (chosenIds.some(id => typeof id !== 'string') || new Set(chosenIds).size !== chosen.length) continue;
      const canonicalCards = chosenIds.map(id => from.hand.find(card => card.id === id));
      if (canonicalCards.some(card => !card)) continue;

      const chosenIdSet = new Set(chosenIds);
      from.hand = from.hand.filter(card => !chosenIdSet.has(card.id));
      to.hand.push(...canonicalCards);
      to.hand.sort((a, b) => a.strength - b.strength);
      exchangeLog.push(`${from.name} が ${to.name} に ${pair.count}枚交換`);
    }

    room.players.forEach(p => p.hand.sort((a, b) => a.strength - b.strength));
    if (exchangeLog.length > 0) {
      room.actionMessage = exchangeLog.join('、') + 'しました！';
    }
  }

  getNextTurnIndex(room, currentIndex, skipCount = 1) {
    let nextIdx = currentIndex;
    let counted = 0;

    for (let i = 1; i <= room.players.length * 2; i++) {
      const candidateIdx = (currentIndex + i) % room.players.length;
      if (room.players[candidateIdx].hand.length > 0) {
        counted++;
        nextIdx = candidateIdx;
        if (counted >= skipCount) {
          return nextIdx;
        }
      }
    }
    return nextIdx;
  }

  submitExchangeCards(socketId, { roomId, cards }) {
    const room = this.rooms[roomId];
    if (!room) {
      return { success: false, message: 'ルームが存在しません' };
    }

    if (room.status !== 'waiting-exchange') {
      return { success: false, message: 'カード交換の準備ができていません' };
    }

    const requiredCount = room.exchangeRequirements?.[socketId];
    if (!requiredCount) {
      return { success: false, message: 'あなたはカード交換の対象ではありません' };
    }

    const selected = Array.isArray(cards) ? cards : [cards];
    if (selected.length !== requiredCount) {
      return { success: false, message: `${requiredCount}枚を選んで交換してください` };
    }

    const player = room.players.find(p => p.id === socketId);
    if (!player) {
      return { success: false, message: 'プレイヤーが見つかりません' };
    }

    const selectedIds = selected.map(card => typeof card === 'string' ? card : card?.id);
    if (selectedIds.some(id => typeof id !== 'string') || new Set(selectedIds).size !== selected.length) {
      return { success: false, message: '交換するカードを重複なく選んでください' };
    }
    const canonicalCards = selectedIds.map(id => player.hand.find(card => card.id === id));
    if (canonicalCards.some(card => !card)) {
      return { success: false, message: '選んだカードはあなたの手札にありません' };
    }

    room.exchangeSelections = room.exchangeSelections || {};
    room.exchangeSelections[socketId] = canonicalCards;

    const allSubmitted = Object.keys(room.exchangeRequirements || {}).every(playerId =>
      room.exchangeSelections[playerId] && room.exchangeSelections[playerId].length === room.exchangeRequirements[playerId]
    );

    if (!allSubmitted) {
      room.actionMessage = 'カード交換の選択待ちです…';
      return { success: true, room, completed: false };
    }

    this.handleCardExchange(room, room.exchangeSelections);
    room.status = 'playing';
    room.exchangeRequirements = {};
    room.exchangeSelections = {};
    room.actionMessage = 'カード交換が完了しました。ゲームを開始します。';

    return { success: true, room, completed: true };
  }

  getSideSelectionRequirements(room, player, playedCards) {
    const playedIds = new Set(playedCards.map(card => card.id));
    const remainingCount = player.hand.filter(card => !playedIds.has(card.id)).length;
    const sevenCount = room.rules.sevenPass === false ? 0 : countEffectiveRank(playedCards, 7);
    const tenCount = room.rules.tenDiscard === false ? 0 : countEffectiveRank(playedCards, 10);
    const pass = Math.min(sevenCount, remainingCount);
    const discard = Math.min(tenCount, remainingCount - pass);
    return { pass, discard };
  }

  playCards(socketId, { roomId, cards, discardCards = [], passedCards = [] }) {
    const room = this.rooms[roomId];
    if (!room || room.status !== 'playing') {
      return { success: false, message: 'ゲーム中ではありません' };
    }

    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== socketId) {
      return { success: false, message: 'あなたのターンではありません！' };
    }

    const requestedCards = Array.isArray(cards) ? cards : [cards];
    if (requestedCards.length === 0) {
      return { success: false, message: '出すカードを選択してください' };
    }
    const playedIds = requestedCards.map(card => typeof card === 'string' ? card : card?.id);
    if (playedIds.some(id => typeof id !== 'string') || new Set(playedIds).size !== requestedCards.length) {
      return { success: false, message: '出すカードを重複なく選んでください' };
    }
    const cardsById = new Map(currentPlayer.hand.map(card => [card.id, card]));
    const playedCards = playedIds.map(id => cardsById.get(id));
    if (playedCards.some(card => !card)) {
      return { success: false, message: '指定されたカードを所持していません' };
    }

    if (room.pendingSideSelection?.playerId === currentPlayer.id) {
      const pendingIds = [...room.pendingSideSelection.cardIds].sort();
      const submittedIds = [...playedIds].sort();
      if (pendingIds.length !== submittedIds.length || pendingIds.some((id, index) => id !== submittedIds[index])) {
        return { success: false, message: '追加カード選択中は、最初に選んだカードを出してください。' };
      }
    }

    const playedIdSet = new Set(playedIds);
    const hasSevenPass = room.rules.sevenPass !== false && countEffectiveRank(playedCards, 7) > 0;
    const hasTenDiscard = room.rules.tenDiscard !== false && countEffectiveRank(playedCards, 10) > 0;
    const { pass: passRequired, discard: discardRequired } = this.getSideSelectionRequirements(
      room,
      currentPlayer,
      playedCards
    );

    const hasDiamondThree = currentPlayer.hand.some(c => c.id === '♦3');
    if (hasDiamondThree && !playedCards.some(c => c.id === '♦3')) {
      return { success: false, message: '♦3を持っている場合は、♦3を含むカードを出してください。' };
    }

    const discardIds = Array.isArray(discardCards) ? discardCards : [];
    const passIds = Array.isArray(passedCards) ? passedCards : [];

    if (discardIds.some(id => typeof id !== 'string') || new Set(discardIds).size !== discardIds.length) {
      return { success: false, message: '捨てるカードを重複なく選んでください。' };
    }
    if (passIds.some(id => typeof id !== 'string') || new Set(passIds).size !== passIds.length) {
      return { success: false, message: '渡すカードを重複なく選んでください。' };
    }
    if (!hasTenDiscard && discardIds.length > 0) {
      return { success: false, message: '10捨ての効果がないカードは捨てられません。' };
    }
    if (!hasSevenPass && passIds.length > 0) {
      return { success: false, message: '7渡しの効果がないカードは渡せません。' };
    }

    if (hasTenDiscard) {
      if (discardIds.length !== discardRequired) {
        return { success: false, message: `10捨てでは、捨てるカードを${discardRequired}枚選んでください。` };
      }

      const validDiscard = discardIds.every(id =>
        currentPlayer.hand.some(card => card.id === id) && !playedCards.some(card => card.id === id)
      );
      if (!validDiscard) {
        return { success: false, message: '捨てるカードは自分の手札から選んでください。' };
      }
    }

    if (hasSevenPass) {
      if (passRequired !== passIds.length) {
        return { success: false, message: `7渡しでは、渡すカードを${passRequired}枚選んでください。` };
      }

      const validPass = passIds.every(id =>
        currentPlayer.hand.some(card => card.id === id) && !playedCards.some(card => card.id === id)
      );
      if (!validPass) {
        return { success: false, message: '7渡しのカードは手札から選んでください。' };
      }
    }

    if (passIds.some(id => discardIds.includes(id))) {
      return { success: false, message: '渡すカードと捨てるカードは別々に選んでください。' };
    }

    const validation = isValidPlay(playedCards, room.fieldCards, room.rules, {
      isRevolution: room.isRevolution,
      isElevenBack: room.isElevenBack,
      lockedSuit: room.lockedSuit,
      lockedNumber: room.lockedNumber
    });

    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    room.firstTurnExemptPlayerId = null;
    room.pendingSideSelection = null;

    const finishCheck = checkForbiddenFinish(
      playedCards,
      currentPlayer.hand.length,
      room.rules,
      {
        isRevolution: room.isRevolution,
        isElevenBack: room.isElevenBack,
        isSpe3: validation.isSpe3
      }
    );

    if (finishCheck.isForbidden) {
      currentPlayer.hand = [];
      currentPlayer.isWinner = false;
      currentPlayer.rank = this.getLastAvailableRank(room);
      currentPlayer.role = '大貧民';

      room.fieldCards = [];
      room.isElevenBack = false;
      room.lockedSuit = null;
      room.lockedNumber = null;
      room.passCount = 0;
      room.actionMessage = `【禁止上がり！】${currentPlayer.name} は ${finishCheck.reason} 反則負けで最下位になりました！`;

      room.turnIndex = this.getNextTurnIndex(room, room.turnIndex);
      this.checkGameCompletion(room);

      return { success: true, room, updatedHand: [] };
    }

    const discardSet = new Set(discardIds);
    const passSet = new Set(passIds);
    const passedCardsList = currentPlayer.hand.filter(c => passSet.has(c.id));
    const discardedCardsList = currentPlayer.hand.filter(c => discardSet.has(c.id));

    currentPlayer.hand = currentPlayer.hand.filter(c => !playedIdSet.has(c.id));
    currentPlayer.hand = currentPlayer.hand.filter(c => !discardSet.has(c.id));
    currentPlayer.hand = currentPlayer.hand.filter(c => !passSet.has(c.id));

    if (currentPlayer.hand.length === 0) {
      currentPlayer.isWinner = true;
      currentPlayer.rank = this.getNextAvailableRank(room);
      if (!room.winners.some(winner => winner.id === currentPlayer.id)) {
        room.winners.push(currentPlayer);
      }

      const miyakoMsg = checkMiyakoOchi(room, currentPlayer);
      if (miyakoMsg) {
        room.actionMessage = miyakoMsg;
      }
    }

    const effects = applyCardEffects(room, currentPlayer, playedCards, validation, {
      discardedCards: discardedCardsList
    });

    if (room.rules.sevenPass !== false && countEffectiveRank(playedCards, 7) > 0 && passedCardsList.length > 0) {
      const nextIndex = this.getNextTurnIndex(room, room.turnIndex);
      const nextPlayer = room.players[nextIndex];
      nextPlayer.hand.push(...passedCardsList);
      nextPlayer.hand.sort((a, b) => a.strength - b.strength);
      effects.actionLogs.push(`【7渡し！】${currentPlayer.name} が ${passedCardsList.map(c => `${c.suit}${c.num}`).join('・')} を ${nextPlayer.name} に渡しました。`);
    }

    if (effects.clearField) {
      room.fieldCards = [];
      room.passCount = 0;
      room.isElevenBack = false;
      room.lockedSuit = null;
      room.lockedNumber = null;
      if (currentPlayer.hand.length === 0) {
        room.turnIndex = this.getNextTurnIndex(room, room.turnIndex);
      }
    } else {
      room.fieldCards = playedCards;
      room.lastPlayedIndex = room.turnIndex;
      room.passCount = 0;
      room.turnIndex = this.getNextTurnIndex(room, room.turnIndex, effects.skipCount);
    }

    room.actionMessage = effects.actionLogs.join(' ');
    this.checkGameCompletion(room);

    return { success: true, room, updatedHand: currentPlayer.hand };
  }

  passTurn(socketId, roomId) {
    const room = this.rooms[roomId];
    if (!room || room.status !== 'playing') {
      return { success: false, message: 'ゲーム中ではありません' };
    }

    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== socketId) {
      return { success: false, message: 'あなたのターンではありません！' };
    }

    if (room.pendingSideSelection?.playerId === currentPlayer.id) {
      return { success: false, message: 'カードの捨て渡し選択を完了してください。' };
    }

    room.firstTurnExemptPlayerId = null;

    if (room.fieldCards.length === 0) {
      room.passCount = 0;
      room.turnIndex = this.getNextTurnIndex(room, room.turnIndex);
      room.actionMessage = `${currentPlayer.name} がパスしました。`;
      return { success: true, room };
    }

    const activePlayers = room.players.filter(p => p.hand.length > 0);
    room.passCount++;

    if (room.passCount >= activePlayers.length - 1) {
      room.fieldCards = [];
      room.isElevenBack = false;
      room.lockedSuit = null;
      room.lockedNumber = null;
      room.passCount = 0;

      const lastPlayer = room.players[room.lastPlayedIndex];
      if (lastPlayer && lastPlayer.hand.length > 0) {
        room.turnIndex = room.lastPlayedIndex;
      } else {
        room.turnIndex = this.getNextTurnIndex(room, room.lastPlayedIndex);
      }
      room.actionMessage = '全員がパスしたため、場が流れました。';
    } else {
      room.turnIndex = this.getNextTurnIndex(room, room.turnIndex);
      room.actionMessage = `${currentPlayer.name} がパスしました。`;
    }

    return { success: true, room };
  }

  getNextAvailableRank(room) {
    const usedRanks = new Set(room.players.map(player => player.rank).filter(Number.isInteger));
    for (let rank = 1; rank <= room.players.length; rank++) {
      if (!usedRanks.has(rank)) return rank;
    }
    return room.players.length;
  }

  getLastAvailableRank(room) {
    const usedRanks = new Set(room.players.map(player => player.rank).filter(Number.isInteger));
    for (let rank = room.players.length; rank >= 1; rank--) {
      if (!usedRanks.has(rank)) return rank;
    }
    return room.players.length;
  }

  checkGameCompletion(room) {
    if (room.status === 'finished') return;
    const activePlayers = room.players.filter(p => p.hand.length > 0);

    if (activePlayers.length <= 1) {
      room.status = 'finished';

      if (activePlayers.length === 1) {
        const lastPlayer = activePlayers[0];
        if (!Number.isInteger(lastPlayer.rank)) {
          lastPlayer.rank = this.getNextAvailableRank(room);
        }
        if (!room.winners.some(winner => winner.id === lastPlayer.id)) {
          room.winners.push(lastPlayer);
        }
      }

      this.assignRoles(room);
      room.completedRounds = (room.completedRounds || 0) + 1;
      room.players.forEach(player => {
        player.totalPoints = (player.totalPoints || 0) + (ROLE_POINTS[player.role] ?? 0);
      });
      room.actionMessage = 'ゲーム終了！順位と階級が決定しました！';
    }
  }

  assignRoles(room) {
    const sorted = [...room.players].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    const count = sorted.length;
    const roleTables = {
      2: ['富豪', '貧民'],
      3: ['富豪', '平民', '貧民'],
      4: ['大富豪', '富豪', '貧民', '大貧民'],
      5: ['大富豪', '富豪', '平民', '貧民', '大貧民'],
      6: ['大富豪', '富豪', '平民', '平民', '貧民', '大貧民']
    };

    sorted.forEach(player => {
      const roleTable = roleTables[count];
      if (roleTable) {
        player.role = roleTable[player.rank - 1] || '平民';
      } else if (player.rank === 1) player.role = '大富豪';
      else if (player.rank === count) player.role = '大貧民';
      else if (player.rank === 2) player.role = '富豪';
      else if (player.rank === count - 1) player.role = '貧民';
      else player.role = '平民';
    });

    room.previousRoles = {};
    sorted.forEach(p => {
      p.previousRole = p.role;
      room.previousRoles[p.id] = p.role;
    });
  }

  getPublicState(room) {
    return {
      roomId: room.id,
      hostId: room.hostId,
      status: room.status,
      fieldCards: room.fieldCards,
      turnPlayerId: room.players[room.turnIndex]?.id,
      turnPlayerName: room.players[room.turnIndex]?.name,
      turnDeadlineAt: room.turnDeadlineAt || null,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        isCpu: !!p.isCpu,
        difficulty: p.difficulty || null,
        cardCount: p.hand.length,
        totalPoints: p.totalPoints || 0,
        isWinner: p.isWinner || false,
        rank: p.rank || null,
        role: p.role || null
      })),
      rules: room.rules,
      isLocked: !!room.isLocked,
      completedRounds: room.completedRounds || 0,
      exchangeRequirements: room.exchangeRequirements || {},
      isRevolution: room.isRevolution,
      isElevenBack: room.isElevenBack,
      isReversed: (!!room.isRevolution) !== (!!room.isElevenBack),
      lockedSuit: room.lockedSuit,
      lockedNumber: room.lockedNumber,
      actionMessage: room.actionMessage,
      winners: room.winners.map(w => ({ name: w.name, rank: w.rank, role: w.role }))
    };
  }

  closeRoom(socketId, roomId) {
    const room = this.rooms[roomId];
    if (!room) {
      return { success: false, message: 'ルームが存在しません' };
    }

    if (room.hostId !== socketId) {
      return { success: false, message: 'ルーム作成者のみが閉じられます' };
    }

    delete this.rooms[roomId];
    return { success: true, roomId };
  }

  leaveRoom(socketId, playerId = null) {
    for (const roomId in this.rooms) {
      const room = this.rooms[roomId];
      const playerIdx = room.players.findIndex(p => p.id === socketId || (playerId && p.playerId === playerId));
      if (playerIdx !== -1) {
        const leavingPlayer = room.players[playerIdx];

        if (playerId && leavingPlayer.playerId === playerId) {
          leavingPlayer.connected = false;
          leavingPlayer.id = socketId;
          room.actionMessage = `${leavingPlayer.name} が再接続待ちです`;
          return room;
        }

        room.players.splice(playerIdx, 1);

        if (room.players.length === 0) {
          delete this.rooms[roomId];
          return null;
        }

        if (room.hostId === socketId) {
          room.hostId = room.players[0].id;
        }

        if (room.turnIndex >= room.players.length) {
          room.turnIndex = 0;
        }

        room.actionMessage = `${leavingPlayer.name} が退出しました`;
        return room;
      }
    }
    return null;
  }
}

module.exports = new RoomManager();

