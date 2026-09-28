import { describe, expect, it } from 'vitest';
import { chooseCpuAction, chooseCpuExchangeCards } from '../src/game/cpuPlayer.js';

const baseRules = {
  eightCut: true,
  revolution: false,
  suitLock: false,
  spe3: true,
  staircase: true,
  staircaseRevolution: false,
  elevenBack: false,
  numberLock: false,
  fiveSkip: false,
  sevenPass: false,
  tenDiscard: false,
  forbiddenFinish: false
};

describe('CPU player decisions', () => {
  it('場が空なら最も弱い合法カードを出す', () => {
    const hand = [
      { id: 'high', suit: '♥', num: 10, strength: 8 },
      { id: 'low', suit: '♠', num: 3, strength: 1 }
    ];
    const room = { rules: baseRules, fieldCards: [], isRevolution: false, isElevenBack: false };

    expect(chooseCpuAction(room, { hand })).toMatchObject({ type: 'play', cards: [{ id: 'low' }] });
  });

  it('かんたんCPUは合法手からランダムに選ぶ', () => {
    const hand = [
      { id: 'low', suit: '♠', num: 3, strength: 1 },
      { id: 'high', suit: '♥', num: 10, strength: 8 }
    ];
    const room = { rules: baseRules, fieldCards: [], isRevolution: false, isElevenBack: false };

    expect(chooseCpuAction(room, { hand, difficulty: 'easy', random: () => 0.99 }))
      .toMatchObject({ type: 'play', cards: [{ id: 'high' }] });
  });

  it('強いCPUは場が空なら手札のペアを維持しながら複数枚を出す', () => {
    const hand = [
      { id: 'pair-a', suit: '♠', num: 3, strength: 1 },
      { id: 'pair-b', suit: '♥', num: 3, strength: 1 },
      { id: 'single', suit: '♣', num: 10, strength: 8 }
    ];
    const room = { rules: baseRules, fieldCards: [], isRevolution: false, isElevenBack: false };

    expect(chooseCpuAction(room, { hand, difficulty: 'hard' })).toMatchObject({
      type: 'play',
      cards: [{ id: 'pair-a' }, { id: 'pair-b' }]
    });
  });

  it('10を出したら残りから10捨て対象を選ぶ', () => {
    const hand = [
      { id: 'ten', suit: '♥', num: 10, strength: 8 },
      { id: 'discard', suit: '♣', num: 5, strength: 3 }
    ];
    const room = {
      rules: { ...baseRules, tenDiscard: true },
      fieldCards: [{ id: 'nine', suit: '♠', num: 9, strength: 7 }],
      isRevolution: false,
      isElevenBack: false
    };

    expect(chooseCpuAction(room, { hand })).toMatchObject({
      type: 'play',
      cards: [{ id: 'ten' }],
      discardCards: ['discard']
    });
  });

  it('7渡しを使い、革命中は最弱の渡し札を選ぶ', () => {
    const hand = [
      { id: 'seven', suit: '♥', num: 7, strength: 5 },
      { id: 'pass', suit: '♣', num: 10, strength: 8 }
    ];
    const room = {
      rules: { ...baseRules, sevenPass: true },
      fieldCards: [{ id: 'eight', suit: '♠', num: 8, strength: 6 }],
      isRevolution: true,
      isElevenBack: false
    };

    expect(chooseCpuAction(room, { hand })).toMatchObject({
      type: 'play',
      cards: [{ id: 'seven' }],
      passedCards: ['pass']
    });
  });

  it('カード交換では必要枚数分の弱いカードを選ぶ', () => {
    const hand = [
      { id: 'strong', suit: '♠', num: 2, strength: 13 },
      { id: 'weak-a', suit: '♥', num: 3, strength: 1 },
      { id: 'weak-b', suit: '♦', num: 4, strength: 2 }
    ];

    expect(chooseCpuExchangeCards(hand, 2).map(card => card.id)).toEqual(['weak-a', 'weak-b']);
  });

  it('かんたんCPUは交換札もランダムに選ぶ', () => {
    const hand = [
      { id: 'weak', suit: '♥', num: 3, strength: 1 },
      { id: 'strong', suit: '♠', num: 2, strength: 13 }
    ];

    expect(chooseCpuExchangeCards(hand, 1, 'easy', () => 0.99).map(card => card.id)).toEqual(['strong']);
  });
});
