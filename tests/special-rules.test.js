import { describe, it, expect } from 'vitest';
import roomManager from '../src/game/roomManager.js';
import { applyCardEffects } from '../src/game/cardEffects.js';
import { checkForbiddenFinish } from '../public/js/rules.js';

describe('特殊効果テスト', () => {
  it('7渡しで次の人にカードが移る', () => {
    roomManager.rooms = {};

    roomManager.createRoom({ id: 'host' }, {
      roomId: 'seven-room',
      playerName: 'A',
      playerId: 'p1',
      rules: {}
    });
    roomManager.joinRoom({ id: 'guest' }, {
      roomId: 'seven-room',
      playerName: 'B',
      playerId: 'p2'
    });

    const room = roomManager.rooms['seven-room'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: 'played-7', suit: '♥', num: 7, strength: 7 },
      { id: 'pass-7', suit: '♠', num: 7, strength: 7 },
      { id: 'keep-3', suit: '♣', num: 3, strength: 3 }
    ];
    room.players[1].hand = [{ id: 'reply-5', suit: '♦', num: 5, strength: 5 }];

    const result = roomManager.playCards('host', {
      roomId: 'seven-room',
      cards: [{ id: 'played-7', suit: '♥', num: 7, strength: 7 }],
      passedCards: ['pass-7']
    });

    expect(result.success).toBe(true);
    expect(room.players[1].hand.some(c => c.id === 'pass-7')).toBe(true);
    expect(room.actionMessage).toContain('7渡し');
  });

  it('8×3 + JOKER でも革命が発生する', () => {
    const room = {
      rules: {
        eightCut: true,
        revolution: true,
        staircaseRevolution: false,
        suitLock: false,
        numberLock: false,
        elevenBack: false,
        fiveSkip: false,
        tenDiscard: false,
        sevenPass: false
      },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: [],
      players: [
        { id: 'p1', name: 'A', hand: [] },
        { id: 'p2', name: 'B', hand: [{ id: 'b1', suit: '♠', num: 3, strength: 3 }] },
        { id: 'p3', name: 'C', hand: [{ id: 'c1', suit: '♦', num: 4, strength: 4 }] }
      ]
    };

    const currentPlayer = { name: 'A', hand: [], id: 'p1' };
    const playedCards = [
      { id: 'h8', suit: '♥', num: 8, strength: 8 },
      { id: 'd8', suit: '♦', num: 8, strength: 8 },
      { id: 's8', suit: '♠', num: 8, strength: 8 },
      { id: 'JOKER', suit: 'JOKER', num: null, strength: 15 }
    ];

    const result = applyCardEffects(room, currentPlayer, playedCards, { valid: true });

    expect(room.isRevolution).toBe(true);
    expect(result.actionLogs.join(' ')).toContain('革命');
  });

  it('5飛びは自分以外の人数分以上で自分のターンに戻る', () => {
    const room = {
      rules: {
        eightCut: false,
        revolution: false,
        staircaseRevolution: false,
        suitLock: false,
        numberLock: false,
        elevenBack: false,
        fiveSkip: true,
        tenDiscard: false,
        sevenPass: false
      },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: [],
      players: [
        { id: 'p1', name: 'A', hand: [{ id: 'a5', suit: '♠', num: 5, strength: 5 }] },
        { id: 'p2', name: 'B', hand: [{ id: 'b1', suit: '♥', num: 7, strength: 7 }] },
        { id: 'p3', name: 'C', hand: [{ id: 'c1', suit: '♦', num: 8, strength: 8 }] }
      ]
    };

    const currentPlayer = room.players[0];
    const result = applyCardEffects(room, currentPlayer, [
      { id: 'a5', suit: '♠', num: 5, strength: 5 },
      { id: 'a6', suit: '♣', num: 5, strength: 5 }
    ], { valid: true });

    expect(result.skipCount).toBe(3);
    expect(result.actionLogs.join(' ')).toContain('5飛び');
  });

  it('10捨てで指定枚数だけ捨てられる', () => {
    const room = {
      rules: {
        eightCut: false,
        revolution: false,
        staircaseRevolution: false,
        suitLock: false,
        numberLock: false,
        elevenBack: false,
        fiveSkip: false,
        tenDiscard: true,
        sevenPass: false
      },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };

    const currentPlayer = {
      name: 'A',
      hand: [
        { id: 'h10', suit: '♥', num: 10, strength: 10 },
        { id: 'h10b', suit: '♦', num: 10, strength: 10 },
        { id: 'h3', suit: '♠', num: 3, strength: 3 },
        { id: 'h4', suit: '♣', num: 4, strength: 4 }
      ]
    };

    const result = applyCardEffects(room, currentPlayer, [
      { id: 'h10', suit: '♥', num: 10, strength: 10 },
      { id: 'h10b', suit: '♦', num: 10, strength: 10 }
    ], { valid: true });

    expect(result.actionLogs.join(' ')).toContain('10捨て');
    expect(currentPlayer.hand.length).toBe(2);
  });

  it('禁止上がりで反則扱いになる', () => {
    const result = checkForbiddenFinish(
      [{ id: 'h8', suit: '♥', num: 8, strength: 8 }],
      1,
      { forbiddenFinish: true, eightCut: true },
      { isRevolution: false, isElevenBack: false, isSpe3: false }
    );

    expect(result.isForbidden).toBe(true);
    expect(result.reason).toContain('8切り');
  });
});
