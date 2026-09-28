/**
 * 特殊カード役および効果の適用ハンドラー
 */

const { countEffectiveRank, isStraightSequence, isUnbeatablePlay } = require('./rules');
const RANK_VALUES = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14, '2': 15 };

function getUniformRank(cards) {
  if (!cards.length || cards.some(card => card.id === 'JOKER')) return null;
  const ranks = cards.map(card => RANK_VALUES[String(card.num)]);
  return ranks.every(rank => rank !== undefined && rank === ranks[0]) ? ranks[0] : null;
}

function getRankLabel(value) {
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' })[value] || String(value);
}

/**
 * カードプレイ時の特殊効果を判定して適用する
 * @param {Object} room - ルームオブジェクト
 * @param {Object} currentPlayer - カードを出したプレイヤー
 * @param {Array} playedCards - 出されたカード配列
 * @param {Object} validation - isValidPlayの判定結果
 * @returns {Object} { clearField: boolean, skipCount: number, actionLogs: string[] }
 */
function applyCardEffects(room, currentPlayer, playedCards, validation, selections = {}) {
  let clearField = false;
  let skipCount = 1;
  const actionLogs = [];

  // 1. スペ3返し (JOKER単体を ♠3 で流す)
  if (validation.isSpe3) {
    clearField = true;
    actionLogs.push(`【スペ3返し！】${currentPlayer.name} が場を流しました！`);
    return { clearField, skipCount, actionLogs };
  }

  // 2. 革命判定 (4枚以上の同時出し)
  // 8切りより先に反転を処理することで、8×3 + JOKER のようなケースでも革命が発生する。
  if (room.rules.revolution && playedCards.length >= 4) {
    room.isRevolution = !room.isRevolution;
    actionLogs.push(
      room.isRevolution
        ? '【革命発動！】カードの強さが反転しました！（3が最強）'
        : '【革命返し！】通常の強さに戻りました！'
    );
  }

  // 3. 8切り (8を含むカードで場を流す)
  if (room.rules.eightCut && playedCards.some(c => c.num === 8)) {
    clearField = true;
    actionLogs.push(`【8切り！】${currentPlayer.name} が場を流しました！`);
    return { clearField, skipCount, actionLogs };
  }

  // 通常時の最強手（2の複数枚出し、同一スートのJQK階段）は場を流す。
  if (isUnbeatablePlay(playedCards, room.rules, {
    isRevolution: room.isRevolution,
    isElevenBack: room.isElevenBack,
    lockedSuit: room.lockedSuit,
    lockedNumber: room.lockedNumber
  })) {
    clearField = true;
    actionLogs.push(`【最強手！】${currentPlayer.name} が場を流しました！`);
    return { clearField, skipCount, actionLogs };
  }

  // 3-2. 階段革命判定 (一般的なローカルルール: 同じマークの連番4枚以上で革命)
  if (room.rules.staircaseRevolution && room.rules.staircase && playedCards.length >= 4) {
    const nonJokers = playedCards.filter(c => c.id !== 'JOKER');
    if (nonJokers.length >= 2 && isStraightSequence(playedCards)) {
      room.isRevolution = !room.isRevolution;
      actionLogs.push(
        room.isRevolution
          ? '【階段革命！】カードの強さが反転しました。'
          : '【階段革命解除！】通常の強さに戻りました。'
      );
    }
  }

  // 4. Jバック (11バック: Jを含む出し方で一時反転)
  if (room.rules.elevenBack && playedCards.some(c => c.num === 'J')) {
    room.isElevenBack = !room.isElevenBack;
    actionLogs.push(
      room.isElevenBack
        ? '【Jバック発動！】場が流れるまで強さ逆転（3が最強）'
        : '【Jバック解除！】通常に戻りました'
    );
  }

  // 5. 5飛び
  // 5の枚数が自分以外のアクティブ人数以上になったら、自分のターンに戻る。
  if (room.rules.fiveSkip && playedCards.some(c => c.num === 5)) {
    const players = Array.isArray(room.players) ? room.players : [];
    const otherActivePlayers = players.filter(p => p.id !== currentPlayer.id && p.hand.length > 0).length;
    skipCount = Math.min(playedCards.length + 1, otherActivePlayers + 1);
    const selfTurnNote = skipCount >= otherActivePlayers + 1 ? '（人数超過で自分の番に戻る）' : '';
    actionLogs.push(`【5飛び！】${playedCards.length}枚分、${skipCount - 1}人スキップ${selfTurnNote}！`);
  }

  // 6. 10捨て (10を出した枚数分だけ、手札から不要なカードを破棄)
  const tenCount = countEffectiveRank(playedCards, 10);
  if (room.rules.tenDiscard && tenCount > 0) {
    if (Array.isArray(selections.discardedCards)) {
      selections.discardedCards.forEach(discarded => {
        actionLogs.push(`【10捨て！】${currentPlayer.name} は ${discarded.suit}${discarded.num} を捨てました。`);
      });
    } else {
      const discardCount = tenCount;
      for (let i = 0; i < discardCount && currentPlayer.hand.length > 0; i++) {
        const discarded = currentPlayer.hand.shift();
        actionLogs.push(`【10捨て！】手札から ${discarded.suit}${discarded.num} を捨てました！`);
      }
      if (currentPlayer.hand.length === 0) {
        currentPlayer.isWinner = true;
        room.winners.push(currentPlayer);
        currentPlayer.rank = room.winners.length;
      }
    }
  }

  // 7. マーク縛り判定 (同じマークが連続した場合)
  if (room.rules.suitLock && room.fieldCards.length > 0) {
    const prevCard = room.fieldCards[0];
    const currentSuit = playedCards[0].suit;
    if (
      prevCard.suit === currentSuit &&
      playedCards[0].id !== 'JOKER' &&
      prevCard.id !== 'JOKER'
    ) {
      room.lockedSuit = currentSuit;
      actionLogs.push(`【マーク縛り発動！】以降 [${currentSuit}] のみ出せます`);
    }
  }

  // 8. 数字縛り (同じ枚数の同ランク出しが1つずつ続いたら、次のランクを要求)
  if (room.rules.numberLock && room.fieldCards.length === playedCards.length) {
    const previousRank = getUniformRank(room.fieldCards);
    const playedRank = getUniformRank(playedCards);
    const startsLock = !room.lockedNumber && room.passCount === 0 &&
      previousRank !== null && playedRank === previousRank + 1;
    const continuesLock = room.lockedNumber && getRankLabel(playedRank) === String(room.lockedNumber);

    if (startsLock || continuesLock) {
      const nextRank = playedRank < 15 ? getRankLabel(playedRank + 1) : null;
      room.lockedNumber = nextRank;
      if (nextRank) {
        actionLogs.push(`【数字縛り！】次は [${nextRank}] のカードで出してください`);
      }
    }
  }

  if (actionLogs.length === 0) {
    const cardDisplay = playedCards.map(c => `${c.suit}${c.num}`).join(' ');
    actionLogs.push(`${currentPlayer.name} が ${cardDisplay} を出しました`);
  }

  return { clearField, skipCount, actionLogs };
}

/**
 * 都落ち判定
 */
function checkMiyakoOchi(room, winnerPlayer) {
  if (!room.rules.miyakoOchi || !room.previousRoles || room.winners.length !== 1) {
    return null;
  }

  const prevDaifugo = room.players.find(p => p.previousRole === '大富豪');
  if (prevDaifugo && prevDaifugo.id !== winnerPlayer.id) {
    const usedRanks = new Set(room.players
      .filter(player => player.id !== prevDaifugo.id && Number.isInteger(player.rank))
      .map(player => player.rank));
    let lastAvailableRank = room.players.length;
    while (lastAvailableRank > 1 && usedRanks.has(lastAvailableRank)) {
      lastAvailableRank--;
    }
    prevDaifugo.hand = [];
    prevDaifugo.isWinner = false;
    prevDaifugo.rank = lastAvailableRank;
    prevDaifugo.role = '大貧民';
    return `【都落ち！】大富豪だった ${prevDaifugo.name} は防衛失敗により大貧民に転落しました！`;
  }

  return null;
}

module.exports = {
  applyCardEffects,
  checkMiyakoOchi
};

