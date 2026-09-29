/**
 * 大富豪 共通ルール＆スマートアシスト判定モジュール
 * Node.js (CommonJS) とブラウザ（window.DaifugoRules）の両対応
 */
(function (exports) {
  /**
   * カードの組み合わせ判定（1枚、または同数ペア、JOKERワイルドカード対応）
   */
  function getNumericValue(card) {
    if (!card || card.id === 'JOKER') return null;
    const map = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15 };
    return map[String(card.num)] ?? null;
  }

  function countEffectiveRank(cards, rank) {
    const targetValue = getNumericValue({ num: rank });
    const nonJokers = cards.filter(card => card.id !== 'JOKER');
    const hasMatchingRank = nonJokers.length > 0 && nonJokers.every(card => getNumericValue(card) === targetValue);
    return hasMatchingRank ? cards.length : nonJokers.filter(card => getNumericValue(card) === targetValue).length;
  }

  function isStraightSequence(cards) {
    const noJoker = cards.filter(c => c.id !== 'JOKER');
    const jokerCount = cards.length - noJoker.length;
    if (noJoker.length < (jokerCount > 0 ? 2 : 3)) return false;
    if (cards.length > 13) return false;

    const suit = noJoker[0].suit;
    if (noJoker.some(c => c.suit !== suit)) return false;

    const values = noJoker.map(c => getNumericValue(c)).filter(v => v !== null).sort((a, b) => a - b);
    if (values.length < 3) return false;

    const unique = [...new Set(values)];
    if (unique.length !== values.length) return false;

    for (let start = 3; start <= 15 - cards.length + 1; start++) {
      const end = start + cards.length - 1;
      if (unique.every(value => value >= start && value <= end)) return true;
    }

    return false;
  }

  function canCompleteStaircaseSelection(selectedCards, card, hand, rules = {}) {
    if (!rules.staircase) return false;
    const candidate = [...selectedCards, card];
    if (candidate.length >= 3) return isStraightSequence(candidate);

    const selectedIds = new Set(candidate.map(selected => selected.id));
    return hand.some(nextCard =>
      !selectedIds.has(nextCard.id) && isStraightSequence([...candidate, nextCard])
    );
  }

  function getStraightHigh(cards) {
    const length = cards.length;
    const values = cards
      .filter(card => card.id !== 'JOKER')
      .map(card => getNumericValue(card));
    let highest = null;
    for (let start = 3; start <= 15 - length + 1; start++) {
      const end = start + length - 1;
      if (values.every(value => value >= start && value <= end)) highest = end;
    }
    return highest;
  }

  function createTheoreticalCard(value, suit, id) {
    const labels = { 14: 'A', 11: 'J', 12: 'Q', 13: 'K', 15: '2' };
    return {
      id,
      suit,
      num: labels[value] || value,
      strength: value - 2
    };
  }

  function getStrongerCandidates(playedCards, rules, state) {
    const candidates = [];
    const count = playedCards.length;
    const suits = state.lockedSuit ? [state.lockedSuit] : ['♠', '♥', '♦', '♣'];
    const includeJoker = rules.includeJoker !== false;
    const addCandidate = candidate => {
      if (isValidPlay(candidate, playedCards, rules, state).valid) candidates.push(candidate);
    };

    const nonJokers = playedCards.filter(card => card.id !== 'JOKER');
    const isGroup = nonJokers.length > 0 && nonJokers.every(card => card.num === nonJokers[0].num);
    if (isGroup) {
      for (let value = 3; value <= 15; value++) {
        for (const jokerCount of includeJoker ? [0, 1] : [0]) {
          const regularCount = count - jokerCount;
          if (regularCount < 1 || regularCount > 4) continue;
          const candidate = Array.from({ length: regularCount }, (_, index) =>
            createTheoreticalCard(value, suits[index % suits.length], `theory-${value}-${index}`)
          );
          if (jokerCount) candidate.push({ id: 'JOKER', suit: '★', num: 'JOKER', strength: 14 });
          addCandidate(candidate);
        }
      }
      return candidates;
    }

    if (rules.staircase && count >= 3) {
      for (let start = 3; start <= 15 - count + 1; start++) {
        for (const suit of suits) {
          addCandidate(Array.from({ length: count }, (_, index) =>
            createTheoreticalCard(start + index, suit, `theory-${start}-${suit}-${index}`)
          ));

          if (includeJoker) {
            for (let missing = 0; missing < count; missing++) {
              const candidate = [];
              for (let index = 0; index < count; index++) {
                if (index === missing) {
                  candidate.push({ id: 'JOKER', suit: '★', num: 'JOKER', strength: 14 });
                } else {
                  candidate.push(createTheoreticalCard(start + index, suit, `theory-${start}-${suit}-${index}`));
                }
              }
              addCandidate(candidate);
            }
          }
        }
      }
    }

    return candidates;
  }

  function isUnbeatablePlay(playedCards, rules = {}, state = {}) {
    return getStrongerCandidates(playedCards, rules, state).length === 0;
  }

  function isValidCombination(cards, rules = {}) {
    if (!cards || cards.length === 0) {
      return { valid: false, message: 'カードが選択されていません' };
    }
    if (cards.length === 1) {
      return { valid: true };
    }

    const nonJokers = cards.filter(c => c.id !== 'JOKER');
    if (nonJokers.length === 0) {
      return { valid: true };
    }

    const baseNum = nonJokers[0].num;
    const allSame = nonJokers.every(c => c.num === baseNum);
    if (allSame) {
      return { valid: true, baseCard: nonJokers[0] };
    }

    if (rules.staircase && isStraightSequence(cards)) {
      return { valid: true, baseCard: nonJokers[0] };
    }

    return { valid: false, message: '複数枚出す場合は、同じ数字か連番の組み合わせにしてください' };
  }

  /**
   * 出したカード群の代表強さを取得
   */
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

  /**
   * カードが出せるかどうかの判定
   */
  function isValidPlay(playedCards, fieldCards, rules = {}, state = {}) {
    const comboCheck = isValidCombination(playedCards, rules);
    if (!comboCheck.valid) {
      return comboCheck;
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

    if (rules.numberLock && state.lockedNumber) {
      const lockedValue = getNumericValue({ num: state.lockedNumber });
      const hasLockedNumber = playedCards.every(c => getNumericValue(c) === lockedValue);
      if (!hasLockedNumber) {
        return { valid: false, message: `数字縛り中です！ [${state.lockedNumber}] のカードで出してください。` };
      }
    }

    // マーク縛り判定
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

    if (rules.staircase && isStraightSequence(playedCards) && isStraightSequence(fieldCards)) {
      const playHigh = getStraightHigh(playedCards);
      const fieldHigh = getStraightHigh(fieldCards);
      if (isReversed) {
        if (playHigh >= fieldHigh) {
          return { valid: false, message: '階段革命中です！場より弱い階段を出してください。' };
        }
      } else if (playHigh <= fieldHigh) {
        return { valid: false, message: '場より強い階段を出してください。' };
      }
      return { valid: true };
    }

    const isFieldSingleJoker = currentCount === 1 && fieldCards[0].id === 'JOKER';
    const isPlaySingleJoker = playCount === 1 && playedCards[0].id === 'JOKER';

    if (isPlaySingleJoker) return { valid: true };
    if (isFieldSingleJoker) return { valid: false, message: 'ジョーカーより強いカードはありません！' };

    if (isReversed) {
      if (playStrength >= fieldStrength) {
        return {
          valid: false,
          message: '強さ逆転中です！場より弱いカードを出してください！'
        };
      }
    } else {
      if (playStrength <= fieldStrength) {
        return {
          valid: false,
          message: '場に出ているカードより強いカードを出してください！'
        };
      }
    }

    return { valid: true };
  }

  /**
   * 禁止上がり判定
   */
  function checkForbiddenFinish(playedCards, playerHandCount, rules = {}, state = {}) {
    if (!rules.forbiddenFinish) {
      return { isForbidden: false };
    }

    if (playerHandCount !== playedCards.length) {
      return { isForbidden: false };
    }

    const isReversed = (!!state.isRevolution) !== (!!state.isElevenBack);

    if (rules.eightCut && playedCards.some(c => c.num === 8)) {
      return { isForbidden: true, reason: '8切りでの上がりは禁止です！' };
    }

    if (playedCards.some(c => c.id === 'JOKER')) {
      return { isForbidden: true, reason: 'ジョーカーでの上がりは禁止です！' };
    }

    if (rules.spe3 && playedCards.length === 1 && playedCards[0].id === '♠3' && state.isSpe3) {
      return { isForbidden: true, reason: 'スペ3返しでの上がりは禁止です！' };
    }

    if (!isReversed && playedCards.some(c => c.num === 2)) {
      return { isForbidden: true, reason: '最強カード（2）での上がりは禁止です！' };
    }
    if (isReversed && playedCards.some(c => c.num === 3)) {
      return { isForbidden: true, reason: '逆転時の最強カード（3）での上がりは禁止です！' };
    }

    return { isForbidden: false };
  }

  /**
   * スマートアシスト: 手札のカードが現在選択可能かを判定
   */
  function isCardSelectable(card, hand, selectedCards, fieldCards, rules = {}, state = {}, isMyTurn = true) {
    if (!isMyTurn) return false;

    // すでに選択されているカードは選択解除のためにクリック可能
    if (selectedCards.some(c => c.id === card.id)) return true;

    const currentField = fieldCards || [];

    // --- 1枚も選択されていない場合 ---
    if (selectedCards.length === 0) {
      // 場が空の場合はどのカードでも1枚目として選べる
      if (currentField.length === 0) {
        return true;
      }

      const targetCount = currentField.length;

      // 1枚出しの場
      if (targetCount === 1) {
        return isValidPlay([card], currentField, rules, state).valid;
      }

      // 複数枚出しの場 (2枚以上)
      if (card.id === 'JOKER') {
        const nonJokers = hand.filter(c => c.id !== 'JOKER');
        const jokers = hand.filter(c => c.id === 'JOKER');
        const uniqueNums = [...new Set(nonJokers.map(c => c.num))];

        return uniqueNums.some(num => {
          const matching = nonJokers.filter(c => c.num === num);
          if (matching.length + jokers.length >= targetCount) {
            const sample = matching.slice(0, targetCount - 1);
            sample.push(card);
            return isValidPlay(sample, currentField, rules, state).valid;
          }
          return false;
        });
      } else {
        const sameNumCards = hand.filter(c => c.id !== 'JOKER' && c.num === card.num);
        const jokers = hand.filter(c => c.id === 'JOKER');

        if (sameNumCards.length + jokers.length < targetCount) {
          return false;
        }

        const sample = [...sameNumCards];
        let jIdx = 0;
        while (sample.length < targetCount && jIdx < jokers.length) {
          sample.push(jokers[jIdx++]);
        }
        return isValidPlay(sample.slice(0, targetCount), currentField, rules, state).valid;
      }
    }

    // --- すでに1枚以上選択されている場合 ---
    const targetCount = currentField.length > 0 ? currentField.length : null;

    if (targetCount && selectedCards.length >= targetCount) return false;
    if (!targetCount && selectedCards.length >= 4) return false;

    const baseCard = selectedCards.find(c => c.id !== 'JOKER');

    if (card.id === 'JOKER') {
      if (targetCount && selectedCards.length + 1 === targetCount) {
        const candidate = [...selectedCards, card];
        return isValidPlay(candidate, currentField, rules, state).valid;
      }
      return true;
    }

    if (baseCard) {
      if (card.num !== baseCard.num) {
        return !targetCount && canCompleteStaircaseSelection(selectedCards, card, hand, rules);
      }
      if (targetCount && selectedCards.length + 1 === targetCount) {
        const candidate = [...selectedCards, card];
        return isValidPlay(candidate, currentField, rules, state).valid;
      }
      return true;
    } else {
      if (targetCount && selectedCards.length + 1 === targetCount) {
        const candidate = [...selectedCards, card];
        return isValidPlay(candidate, currentField, rules, state).valid;
      }
      return true;
    }
  }

  // エクスポート設定 (Node.js とブラウザ両用)
  exports.isValidCombination = isValidCombination;
  exports.countEffectiveRank = countEffectiveRank;
  exports.isStraightSequence = isStraightSequence;
  exports.isUnbeatablePlay = isUnbeatablePlay;
  exports.getPlayStrength = getPlayStrength;
  exports.isValidPlay = isValidPlay;
  exports.checkForbiddenFinish = checkForbiddenFinish;
  exports.isCardSelectable = isCardSelectable;

})(typeof exports === 'undefined' ? (this.DaifugoRules = {}) : exports);

