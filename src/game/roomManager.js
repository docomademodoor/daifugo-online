const { createDeck } = require('../utils/deck');
const { isValidPlay, checkForbiddenFinish } = require('./rules');
const { applyCardEffects, checkMiyakoOchi } = require('./cardEffects');

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
          connected: true
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
      previousRoles: null
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

    if (room.players.length >= 8) {
      return { success: false, message: '部屋が満員です（最大8人まで参加可能）' };
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

    const newPlayer = {
      id: socket.id,
      playerId: playerId || socket.id,
      name: (playerName && playerName.trim()) || `プレイヤー${room.players.length + 1}`,
      hand: [],
      isWinner: false,
      rank: null,
      role: null,
      connected: true
    };
    room.players.push(newPlayer);

    return { success: true, room, playerId: newPlayer.playerId };
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

    if (!room.previousRoles && room.rules.dia3Start) {
      const dia3HolderIndex = room.players.findIndex(p =>
        p.hand.some(c => c.suit === '♦' && c.num === 3)
      );
      if (dia3HolderIndex !== -1) {
        room.turnIndex = dia3HolderIndex;
        room.actionMessage = `【♢3スタート】♦3を持っている ${room.players[dia3HolderIndex].name} からターン開始です！`;
      }
    } else if (room.previousRoles) {
      const daihinminIndex = room.players.findIndex(p => p.role === '大貧民');
      if (daihinminIndex !== -1) {
        room.turnIndex = daihinminIndex;
        room.actionMessage = `大貧民の ${room.players[daihinminIndex].name} からスタートです！`;
      }
    }

    return { success: true, room };
  }

  buildExchangePlan(room) {
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

      const chosenIds = new Set(chosen.map(c => c.id || c));
      if (!chosen.every(card => from.hand.some(h => h.id === (card.id || card)))) continue;

      from.hand = from.hand.filter(card => !chosenIds.has(card.id));
      to.hand.push(...chosen);
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

    const hasCards = selected.every(card =>
      player.hand.some(h => h.id === card.id)
    );
    if (!hasCards) {
      return { success: false, message: '選んだカードはあなたの手札にありません' };
    }

    room.exchangeSelections = room.exchangeSelections || {};
    room.exchangeSelections[socketId] = selected;

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

  playCards(socketId, { roomId, cards, discardCards = [], passedCards = [] }) {
    const room = this.rooms[roomId];
    if (!room || room.status !== 'playing') {
      return { success: false, message: 'ゲーム中ではありません' };
    }

    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== socketId) {
      return { success: false, message: 'あなたのターンではありません！' };
    }

    const playedCards = Array.isArray(cards) ? cards : [cards];
    if (playedCards.length === 0) {
      return { success: false, message: '出すカードを選択してください' };
    }

    const hasDiamondThree = currentPlayer.hand.some(c => c.id === '♦3');
    if (hasDiamondThree && !playedCards.some(c => c.id === '♦3')) {
      return { success: false, message: '♦3を持っている場合は、♦3を含むカードを出してください。' };
    }

    const discardIds = Array.isArray(discardCards) ? discardCards : [];
    const passIds = Array.isArray(passedCards) ? passedCards : [];

    if (room.rules.tenDiscard !== false && playedCards.some(c => c.num === 10)) {
      if (discardIds.length !== 1) {
        return { success: false, message: '10捨てでは、捨てるカードを1枚選んでください。' };
      }

      const validDiscard = discardIds.every(id =>
        currentPlayer.hand.some(card => card.id === id) && !playedCards.some(card => card.id === id)
      );
      if (!validDiscard) {
        return { success: false, message: '捨てるカードは自分の手札から選んでください。' };
      }
    }

    if (room.rules.sevenPass !== false && playedCards.some(c => c.num === 7)) {
      const passCount = playedCards.filter(c => c.num === 7).length;
      if (passCount !== passIds.length) {
        return { success: false, message: `7渡しでは、7の枚数分（${passCount}枚）を次の順番の人に渡してください。` };
      }

      const validPass = passIds.every(id =>
        currentPlayer.hand.some(card => card.id === id) && !playedCards.some(card => card.id === id)
      );
      if (!validPass) {
        return { success: false, message: '7渡しのカードは手札から選んでください。' };
      }
    }

    const hasAllCards = playedCards.every(c =>
      currentPlayer.hand.some(h => h.id === c.id)
    );
    if (!hasAllCards) {
      return { success: false, message: '指定されたカードを所持していません' };
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
      currentPlayer.rank = room.players.length;
      currentPlayer.role = '大貧民';

      room.fieldCards = [];
      room.isElevenBack = false;
      room.lockedSuit = null;
      room.passCount = 0;
      room.actionMessage = `【禁止上がり！】${currentPlayer.name} は ${finishCheck.reason} 反則負けで最下位になりました！`;

      room.turnIndex = this.getNextTurnIndex(room, room.turnIndex);
      this.checkGameCompletion(room);

      return { success: true, room, updatedHand: [] };
    }

    const playedIds = new Set(playedCards.map(c => c.id));
    const discardSet = new Set(discardIds);
    const passSet = new Set(passIds);
    const passedCardsList = currentPlayer.hand.filter(c => passSet.has(c.id));
    const discardedCardsList = currentPlayer.hand.filter(c => discardSet.has(c.id));

    currentPlayer.hand = currentPlayer.hand.filter(c => !playedIds.has(c.id));
    currentPlayer.hand = currentPlayer.hand.filter(c => !discardSet.has(c.id));
    currentPlayer.hand = currentPlayer.hand.filter(c => !passSet.has(c.id));

    if (currentPlayer.hand.length === 0) {
      currentPlayer.isWinner = true;
      room.winners.push(currentPlayer);
      currentPlayer.rank = room.winners.length;

      const miyakoMsg = checkMiyakoOchi(room, currentPlayer);
      if (miyakoMsg) {
        room.actionMessage = miyakoMsg;
      }
    }

    const effects = applyCardEffects(room, currentPlayer, playedCards, validation);

    if (room.rules.tenDiscard !== false && playedCards.some(c => c.num === 10) && discardedCardsList.length > 0) {
      const discardedCard = discardedCardsList[0];
      effects.actionLogs.push(`【10捨て！】${currentPlayer.name} は ${discardedCard.suit}${discardedCard.num} を捨てました。`);
    }

    if (room.rules.sevenPass !== false && playedCards.some(c => c.num === 7) && passedCardsList.length > 0) {
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

    if (room.fieldCards.length === 0) {
      return { success: false, message: '誰もカードを出していない状態ではパスできません！' };
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

  checkGameCompletion(room) {
    const activePlayers = room.players.filter(p => p.hand.length > 0);

    if (activePlayers.length <= 1) {
      room.status = 'finished';

      if (activePlayers.length === 1) {
        const lastPlayer = activePlayers[0];
        lastPlayer.rank = room.players.length;
        room.winners.push(lastPlayer);
      }

      this.assignRoles(room);
      room.actionMessage = 'ゲーム終了！順位と階級が決定しました！';
    }
  }

  assignRoles(room) {
    const sorted = [...room.players].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    const count = sorted.length;

    if (count === 4) {
      sorted[0].role = '大富豪';
      sorted[1].role = '富豪';
      sorted[2].role = '貧民';
      sorted[3].role = '大貧民';
    } else if (count === 3) {
      sorted[0].role = '大富豪';
      sorted[1].role = '平民';
      sorted[2].role = '大貧民';
    } else if (count === 2) {
      sorted[0].role = '大富豪';
      sorted[1].role = '大貧民';
    }

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
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        isWinner: p.isWinner || false,
        rank: p.rank || null,
        role: p.role || null
      })),
      rules: room.rules,
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

