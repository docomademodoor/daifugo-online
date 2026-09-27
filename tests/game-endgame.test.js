import { describe, it, expect } from 'vitest';
import roomManager from '../src/game/roomManager.js';

describe('勝敗・役割判定', () => {
  it('1人残ったときにゲーム終了状態になる', () => {
    roomManager.rooms = {};

    const host = { id: 'host' };
    roomManager.createRoom(host, {
      roomId: 'endgame-room',
      playerName: 'A',
      playerId: 'a',
      rules: {}
    });

    const room = roomManager.rooms['endgame-room'];
    room.status = 'playing';
    room.players.push({
      id: 'guest',
      playerId: 'b',
      name: 'B',
      hand: [],
      isWinner: false,
      rank: null,
      role: null,
      connected: true
    });

    room.players[0].hand = [{ id: 'h1', suit: '♥', num: 1, strength: 1 }];
    room.players[1].hand = [];

    roomManager.checkGameCompletion(room);

    expect(room.status).toBe('finished');
  });

  it('順位が付与され、役割が決まる', () => {
    const room = {
      players: [
        { id: 'p1', name: 'A', hand: [{ id: 'x' }], rank: 1, role: null },
        { id: 'p2', name: 'B', hand: [{ id: 'y' }], rank: 2, role: null },
        { id: 'p3', name: 'C', hand: [{ id: 'z' }], rank: 3, role: null },
        { id: 'p4', name: 'D', hand: [{ id: 'w' }], rank: 4, role: null }
      ],
      winners: [],
      previousRoles: {}
    };

    roomManager.assignRoles(room);

    expect(room.players[0].role).toBe('大富豪');
    expect(room.players[1].role).toBe('富豪');
    expect(room.players[2].role).toBe('貧民');
    expect(room.players[3].role).toBe('大貧民');
  });
});
