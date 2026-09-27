import { describe, it, expect } from 'vitest';
import roomManager from '../src/game/roomManager.js';
import { applyCardEffects } from '../src/game/cardEffects.js';

describe('RoomManager flow', () => {
  it('部屋作成と参加、開始まで進む', () => {
    roomManager.rooms = {};

    const host = { id: 'host-socket' };
    const guest = { id: 'guest-socket' };

    const created = roomManager.createRoom(host, {
      roomId: 'flow-room',
      playerName: 'ホスト',
      playerId: 'p-host',
      rules: {}
    });

    expect(created.success).toBe(true);

    const joined = roomManager.joinRoom(guest, {
      roomId: 'flow-room',
      playerName: 'ゲスト',
      playerId: 'p-guest'
    });

    expect(joined.success).toBe(true);
    expect(roomManager.rooms['flow-room'].players.length).toBe(2);

    const started = roomManager.startGame('host-socket', 'flow-room');
    expect(started.success).toBe(true);
    expect(roomManager.rooms['flow-room'].status).toBe('playing');
    expect(roomManager.rooms['flow-room'].players.every(p => p.hand.length > 0)).toBe(true);
  });

  it('全員がパスしたら場を流して最後に出した人のターンへ戻る', () => {
    roomManager.rooms = {};

    const host = { id: 'p1' };
    const guest = { id: 'p2' };
    roomManager.createRoom(host, { roomId: 'pass-room', playerName: 'A', playerId: 'a', rules: {} });
    roomManager.joinRoom(guest, { roomId: 'pass-room', playerName: 'B', playerId: 'b' });

    const room = roomManager.rooms['pass-room'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.lastPlayedIndex = 1;
    room.fieldCards = [{ id: 'h9', suit: '♥', num: 9, strength: 9 }];
    room.players[0].hand = [{ id: 'h2', suit: '♥', num: 2, strength: 2 }];
    room.players[1].hand = [{ id: 's3', suit: '♠', num: 3, strength: 3 }];

    const result = roomManager.passTurn('p1', 'pass-room');
    expect(result.success).toBe(true);
    expect(room.fieldCards.length).toBe(0);
    expect(room.turnIndex).toBe(1);
  });
});

describe('Card effects', () => {
  it('8切りで場を流せる', () => {
    const room = {
      rules: { eightCut: true, revolution: false, staircaseRevolution: false, suitLock: false, numberLock: false, elevenBack: false, fiveSkip: false, tenDiscard: false, sevenPass: false },
      fieldCards: [{ id: 'h5', suit: '♥', num: 5, strength: 5 }],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };
    const currentPlayer = { name: 'A', hand: [] };
    const result = applyCardEffects(room, currentPlayer, [{ id: 'h8', suit: '♥', num: 8, strength: 8 }], { valid: true });

    expect(result.clearField).toBe(true);
    expect(result.actionLogs.join(' ')).toContain('8切り');
  });

  it('5飛びでスキップ数が増える', () => {
    const room = {
      rules: { eightCut: false, revolution: false, staircaseRevolution: false, suitLock: false, numberLock: false, elevenBack: false, fiveSkip: true, tenDiscard: false, sevenPass: false },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };
    const currentPlayer = { name: 'B', hand: [] };
    const result = applyCardEffects(room, currentPlayer, [{ id: 's5', suit: '♠', num: 5, strength: 5 }], { valid: true });

    expect(result.skipCount).toBe(2);
    expect(result.actionLogs.join(' ')).toContain('5飛び');
  });
});
