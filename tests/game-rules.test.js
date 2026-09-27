import { describe, it, expect } from 'vitest';
import { isValidPlay } from '../public/js/rules.js';
import RoomManager from '../src/game/roomManager.js';

describe('カードルール判定', () => {
  it('同じ数字のペアは空場で出せる', () => {
    const cards = [
      { id: 'h1', suit: '♥', num: 10, strength: 10 },
      { id: 'h2', suit: '♦', num: 10, strength: 10 }
    ];

    const result = isValidPlay(cards, [], {}, {});
    expect(result.valid).toBe(true);
  });

  it('マーク縛り中は違うマークを出せない', () => {
    const field = [
      { id: 's2', suit: '♠', num: 2, strength: 2 },
      { id: 's3', suit: '♠', num: 3, strength: 3 }
    ];

    const valid = isValidPlay([
      { id: 's1', suit: '♠', num: 5, strength: 5 },
      { id: 's2b', suit: '♠', num: 5, strength: 5 }
    ], field, { suitLock: true }, { lockedSuit: '♠' });
    expect(valid.valid).toBe(true);

    const invalid = isValidPlay([
      { id: 'h1', suit: '♥', num: 5, strength: 5 },
      { id: 'h2', suit: '♥', num: 5, strength: 5 }
    ], field, { suitLock: true }, { lockedSuit: '♠' });

    expect(invalid.valid).toBe(false);
    expect(invalid.message).toContain('マーク縛り');
  });

  it('連番縛り中は指定した番号を含むカードでないと出せない', () => {
    const field = [
      { id: 'd2', suit: '♦', num: 2, strength: 2 },
      { id: 'd3', suit: '♦', num: 3, strength: 3 }
    ];

    const valid = isValidPlay([
      { id: 'c1', suit: '♣', num: 4, strength: 4 },
      { id: 'c2', suit: '♣', num: 4, strength: 4 }
    ], field, { numberLock: true }, { lockedNumber: [4, 5] });
    expect(valid.valid).toBe(true);

    const invalid = isValidPlay([
      { id: 's1', suit: '♠', num: 7, strength: 7 },
      { id: 's2', suit: '♠', num: 7, strength: 7 }
    ], field, { numberLock: true }, { lockedNumber: [4, 5] });

    expect(invalid.valid).toBe(false);
    expect(invalid.message).toContain('連番縛り');
  });
});

describe('RoomManager 10捨て', () => {
  it('10を2枚出したときは捨てるカードも2枚必須', () => {
    const roomManager = RoomManager;
    const socketA = { id: 'sA' };
    const socketB = { id: 'sB' };

    roomManager.rooms = {};
    roomManager.createRoom(socketA, { roomId: 'ten-test', playerName: 'A', playerId: 'p1', rules: {} });
    roomManager.joinRoom(socketB, { roomId: 'ten-test', playerName: 'B', playerId: 'p2' });

    const room = roomManager.rooms['ten-test'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: 'h1', suit: '♥', num: 10, strength: 10 },
      { id: 'h2', suit: '♦', num: 10, strength: 10 },
      { id: 'h3', suit: '♠', num: 3, strength: 3 },
      { id: 'h4', suit: '♣', num: 4, strength: 4 }
    ];
    room.players[1].hand = [{ id: 'x1', suit: '♠', num: 5, strength: 5 }];

    const missingDiscard = roomManager.playCards('sA', {
      roomId: 'ten-test',
      cards: [room.players[0].hand[0], room.players[0].hand[1]],
      discardCards: ['h3']
    });

    expect(missingDiscard.success).toBe(false);
    expect(missingDiscard.message).toContain('2枚');

    const valid = roomManager.playCards('sA', {
      roomId: 'ten-test',
      cards: [room.players[0].hand[0], room.players[0].hand[1]],
      discardCards: ['h3', 'h4']
    });

    expect(valid.success).toBe(true);
    expect(room.players[0].hand.length).toBe(0);
  });
});
