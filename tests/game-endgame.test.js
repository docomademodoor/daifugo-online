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

  it('5人戦の順位に応じて5種類の役割を割り当てる', () => {
    const room = {
      players: [
        { id: 'p1', name: 'A', hand: [], rank: 1, role: null },
        { id: 'p2', name: 'B', hand: [], rank: 2, role: null },
        { id: 'p3', name: 'C', hand: [], rank: 3, role: null },
        { id: 'p4', name: 'D', hand: [], rank: 4, role: null },
        { id: 'p5', name: 'E', hand: [], rank: 5, role: null }
      ],
      winners: [],
      previousRoles: {}
    };

    roomManager.assignRoles(room);

    expect(room.players.map(player => player.role)).toEqual([
      '大富豪', '富豪', '平民', '貧民', '大貧民'
    ]);
  });

  it('都落ちで最下位を予約済みなら最後のプレイヤーへ未使用順位を割り当てる', () => {
    roomManager.rooms = {};
    const room = {
      status: 'playing',
      players: [
        { id: 'previous-daifugo', name: 'A', hand: [], rank: 5, role: '大貧民' },
        { id: 'first', name: 'B', hand: [], rank: 1, role: null },
        { id: 'second', name: 'C', hand: [], rank: 2, role: null },
        { id: 'third', name: 'D', hand: [], rank: 3, role: null },
        { id: 'last', name: 'E', hand: [{ id: 'remaining-card' }], rank: null, role: null }
      ],
      winners: [],
      previousRoles: {}
    };

    roomManager.checkGameCompletion(room);

    expect(room.status).toBe('finished');
    expect(room.players.find(player => player.id === 'last').rank).toBe(4);
    expect(room.players.map(player => player.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('役職別ポイントを累積し、同じラウンドを二重加算しない', () => {
    const room = {
      status: 'playing',
      players: [
        { id: 'first', name: 'A', hand: [], rank: 1, totalPoints: 4 },
        { id: 'second', name: 'B', hand: [], rank: 2, totalPoints: 3 },
        { id: 'third', name: 'C', hand: [], rank: 3, totalPoints: 2 },
        { id: 'fourth', name: 'D', hand: [], rank: 4, totalPoints: 1 },
        { id: 'last', name: 'E', hand: [{ id: 'remaining' }], rank: null, totalPoints: 0 }
      ],
      winners: [],
      previousRoles: null,
      completedRounds: 1
    };

    roomManager.checkGameCompletion(room);
    roomManager.checkGameCompletion(room);

    expect(room.completedRounds).toBe(2);
    expect(room.players.map(player => player.totalPoints)).toEqual([6, 4, 2, 0, -2]);
  });
});
