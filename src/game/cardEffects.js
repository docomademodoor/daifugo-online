/**
 * 特殊カード役および効果の適用ハンドラー
 */

/**
 * カードプレイ時の特殊効果を判定して適用する
 * @param {Object} room - ルームオブジェクト
 * @param {Object} currentPlayer - カードを出したプレイヤー
 * @param {Array} playedCards - 出されたカード配列
 * @param {Object} validation - isValidPlayの判定結果
 * @returns {Object} { clearField: boolean, skipCount: number, actionLogs: string[] }
 */
function applyCardEffects(room, currentPlayer, playedCards, validation) {
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

  // 3-2. 階段革命判定 (一般的なローカルルール: 同じマークの連番4枚以上で革命)
  if (room.rules.staircaseRevolution && room.rules.staircase && playedCards.length >= 4) {
    const nonJokers = playedCards.filter(c => c.id !== 'JOKER');
    if (nonJokers.length >= 4) {
      const suit = nonJokers[0].suit;
      const values = nonJokers.map(c => Number(c.num) || { J: 11, Q: 12, K: 13, A: 14, 2: 15 }[c.num]).sort((a, b) => a - b);
      const isSameSuit = nonJokers.every(c => c.suit === suit);
      const isUnique = new Set(values).size === values.length;
      const isStraight = values.every((n, idx, arr) => idx === 0 || arr[idx - 1] + 1 === n);

      if (isSameSuit && isUnique && isStraight) {
        room.isRevolution = !room.isRevolution;
        actionLogs.push(
          room.isRevolution
            ? '【階段革命！】カードの強さが反転しました。'
            : '【階段革命解除！】通常の強さに戻りました。'
        );
      }
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
  if (room.rules.tenDiscard && playedCards.some(c => c.num === 10)) {
    const discardCount = playedCards.filter(c => c.num === 10).length;
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

  // 8. 連番縛り判定 (同じマークの連番を出したら、その連番の範囲を含むカードで出させる)
  if (room.rules.numberLock && playedCards.length > 0) {
    const nonJokers = playedCards.filter(c => c.id !== 'JOKER');
    if (nonJokers.length >= 3) {
      const valueMap = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14, '2': 15 };
      const values = nonJokers.map(c => valueMap[String(c.num)] ?? Number(c.num)).sort((a, b) => a - b);
      const isSameSuit = nonJokers.every(c => c.suit === nonJokers[0].suit);
      const isUnique = new Set(values).size === values.length;
      const isConsecutive = values.every((n, idx, arr) => idx === 0 || arr[idx - 1] + 1 === n);

      if (isSameSuit && isUnique && isConsecutive) {
        room.lockedNumber = values;
        actionLogs.push(`【連番縛り発動！】以降 [${values.join('→')}] を含むカードで出してください`);
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
    prevDaifugo.hand = [];
    prevDaifugo.isWinner = false;
    prevDaifugo.rank = room.players.length;
    prevDaifugo.role = '大貧民';
    return `【都落ち！】大富豪だった ${prevDaifugo.name} は防衛失敗により大貧民に転落しました！`;
  }

  return null;
}

module.exports = {
  applyCardEffects,
  checkMiyakoOchi
};

