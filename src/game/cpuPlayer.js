const { checkForbiddenFinish, countEffectiveRank, getPlayStrength, isValidCombination, isValidPlay } = require('./rules');

const CARD_VALUES = {
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  '2': 15
};

function getCardValue(card) {
  return CARD_VALUES[String(card.num)] ?? null;
}

function getSubsets(cards, count) {
  if (count < 0 || count > cards.length) return [];
  if (count === 0) return [[]];

  const results = [];
  const visit = (startIndex, selected) => {
    if (selected.length === count) {
      results.push(selected);
      return;
    }

    for (let index = startIndex; index <= cards.length - (count - selected.length); index++) {
      visit(index + 1, [...selected, cards[index]]);
    }
  };

  visit(0, []);
  return results;
}

function getPlayCandidates(hand, playCount, rules) {
  if (playCount === 1) return hand.map(card => [card]);

  const candidates = [];
  const seen = new Set();
  const joker = hand.find(card => card.id === 'JOKER');
  const regularCards = hand.filter(card => card.id !== 'JOKER');
  const addCandidate = cards => {
    if (cards.length !== playCount || !isValidCombination(cards, rules).valid) return;
    const key = cards.map(card => card.id).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(cards);
  };

  const groups = new Map();
  regularCards.forEach(card => {
    const key = String(card.num);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });

  for (const group of groups.values()) {
    for (const jokerCount of joker ? [0, 1] : [0]) {
      const regularCount = playCount - jokerCount;
      getSubsets(group, regularCount).forEach(subset => {
        addCandidate(jokerCount ? [...subset, joker] : subset);
      });
    }
  }

  if (rules.staircase && playCount >= 3) {
    const suits = [...new Set(regularCards.map(card => card.suit))];
    for (const suit of suits) {
      const suitedCards = regularCards
        .filter(card => card.suit === suit && getCardValue(card) !== null)
        .sort((a, b) => getCardValue(a) - getCardValue(b));

      for (const jokerCount of joker ? [0, 1] : [0]) {
        const regularCount = playCount - jokerCount;
        if (regularCount < 3) continue;

        getSubsets(suitedCards, regularCount).forEach(subset => {
          const values = subset.map(getCardValue).sort((a, b) => a - b);
          const isConsecutive = values.every((value, index) => index === 0 || values[index - 1] + 1 === value);
          if (isConsecutive || jokerCount) addCandidate(jokerCount ? [...subset, joker] : subset);
        });
      }
    }
  }

  return candidates;
}

function getPreservedGroupScore(hand, playedCards) {
  const playedIds = new Set(playedCards.map(card => card.id));
  const remainingGroups = new Map();
  hand.filter(card => !playedIds.has(card.id) && card.id !== 'JOKER').forEach(card => {
    const key = String(card.num);
    remainingGroups.set(key, (remainingGroups.get(key) || 0) + 1);
  });

  return [...remainingGroups.values()].reduce((score, count) => {
    if (count >= 3) return score + 45;
    if (count === 2) return score + 25;
    return score;
  }, 0);
}

function pickRandom(items, random) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function chooseCpuAction(room, player) {
  const hand = player.hand || [];
  const rules = room.rules || {};
  const fieldCards = room.fieldCards || [];
  const playCount = fieldCards.length || 1;
  const difficulty = ['easy', 'normal', 'hard'].includes(player.difficulty) ? player.difficulty : 'normal';
  const random = typeof player.random === 'function' ? player.random : Math.random;
  const mustPlayDiamondThree = hand.some(card => card.id === '♦3');
  const state = {
    isRevolution: room.isRevolution,
    isElevenBack: room.isElevenBack,
    lockedSuit: room.lockedSuit,
    lockedNumber: room.lockedNumber
  };
  const playCounts = fieldCards.length === 0 && difficulty === 'hard'
    ? Array.from({ length: Math.min(4, hand.length) }, (_, index) => index + 1)
    : [playCount];
  const candidates = playCounts.flatMap(count => getPlayCandidates(hand, count, rules))
    .filter(cards => !mustPlayDiamondThree || cards.some(card => card.id === '♦3'));
  const legalCandidates = candidates.filter(cards => isValidPlay(cards, fieldCards, rules, state).valid);
  const nonForbiddenFinishes = legalCandidates.filter(cards => !checkForbiddenFinish(
    cards,
    hand.length,
    rules,
    { ...state, isSpe3: false }
  ).isForbidden);

  if (nonForbiddenFinishes.length === 0 && fieldCards.length > 0) {
    return { type: 'pass' };
  }

  const choices = nonForbiddenFinishes.length > 0 ? nonForbiddenFinishes : legalCandidates;
  if (choices.length === 0) {
    return fieldCards.length > 0 ? { type: 'pass' } : { type: 'play', cards: hand.slice(0, 1), passedCards: [], discardCards: [] };
  }

  const isReversed = (!!room.isRevolution) !== (!!room.isElevenBack);
  if (difficulty === 'easy') {
    const cards = pickRandom(choices, random);
    return buildPlayAction(cards, hand, rules);
  }

  choices.sort((left, right) => {
    if (difficulty === 'hard') {
      const leftScore = left.length * 100 + getPreservedGroupScore(hand, left);
      const rightScore = right.length * 100 + getPreservedGroupScore(hand, right);
      if (leftScore !== rightScore) return rightScore - leftScore;
    }
    const strengthDifference = getPlayStrength(left) - getPlayStrength(right);
    return isReversed ? -strengthDifference : strengthDifference;
  });

  return buildPlayAction(choices[0], hand, rules);
}

function buildPlayAction(cards, hand, rules) {
  const playedIds = new Set(cards.map(card => card.id));
  const remaining = hand
    .filter(card => !playedIds.has(card.id))
    .sort((a, b) => a.strength - b.strength);
  const sevenCount = rules.sevenPass === false ? 0 : cards.filter(card => card.num === 7).length;
  const tenCount = rules.tenDiscard === false ? 0 : countEffectiveRank(cards, 10);
  const passCount = Math.min(sevenCount, remaining.length);
  const passedCards = remaining.splice(0, passCount).map(card => card.id);
  const discardCount = Math.min(tenCount, remaining.length);
  const discardCards = remaining.splice(0, discardCount).map(card => card.id);

  return { type: 'play', cards, passedCards, discardCards };
}

function chooseCpuExchangeCards(hand, count, difficulty = 'normal', random = Math.random) {
  if (difficulty === 'easy') {
    return getSubsets(hand, count).length
      ? pickRandom(getSubsets(hand, count), random)
      : [];
  }

  const cards = [...hand].sort((a, b) => a.strength - b.strength);
  if (difficulty !== 'hard') return cards.slice(0, count);

  return cards.sort((a, b) => {
    const aGroupCount = hand.filter(card => card.id !== a.id && card.num === a.num).length;
    const bGroupCount = hand.filter(card => card.id !== b.id && card.num === b.num).length;
    const aScore = a.strength + (aGroupCount > 0 ? 100 : 0);
    const bScore = b.strength + (bGroupCount > 0 ? 100 : 0);
    return aScore - bScore;
  }).slice(0, count);
}

module.exports = {
  chooseCpuAction,
  chooseCpuExchangeCards
};
