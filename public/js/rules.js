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

  function isStraightSequence(cards) {
    const noJoker = cards.filter(c => c.id !== 'JOKER');
    if (noJoker.length < 3) return false;

    const suit = noJoker[0].suit;
    if (noJoker.some(c => c.suit !== suit)) return false;

    const values = noJoker.map(c => getNumericValue(c)).filter(v => v !== null).sort((a, b) => a - b);
    if (values.length < 3) return false;

    const unique = [...new Set(values)];
    if (unique.length !== values.length) return false;

    const span = unique[unique.length - 1] - unique[0];
    if (span !== unique.length - 1) return false;

    return true;
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
      const lockedNumbers = Array.isArray(state.lockedNumber) ? state.lockedNumber : [state.lockedNumber];
      const hasLockedNumber = playedCards.some(c => lockedNumbers.some(n => String(c.num) === String(n)));
      if (!hasLockedNumber) {
        const lockedLabel = lockedNumbers.join('→');
        return { valid: false, message: `連番縛り中です！ [${lockedLabel}] を含むカードで出してください。` };
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
      const playHigh = Math.max(...playedCards.filter(c => c.id !== 'JOKER').map(c => getNumericValue(c) || 0));
      const fieldHigh = Math.max(...fieldCards.filter(c => c.id !== 'JOKER').map(c => getNumericValue(c) || 0));
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
      if (card.num !== baseCard.num) return false;
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
  exports.getPlayStrength = getPlayStrength;
  exports.isValidPlay = isValidPlay;
  exports.checkForbiddenFinish = checkForbiddenFinish;
  exports.isCardSelectable = isCardSelectable;

})(typeof exports === 'undefined' ? (this.DaifugoRules = {}) : exports);

