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
    expect(roomManager.rooms['flow-room'].firstTurnExemptPlayerId)
      .toBe(roomManager.rooms['flow-room'].players[roomManager.rooms['flow-room'].turnIndex].id);
  });

  it('プレイ中のプレイヤーが安定IDで再接続できる', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'old-host' }, { roomId: 'reconnect-playing', playerName: 'A', playerId: 'stable-a', rules: {} });
    roomManager.joinRoom({ id: 'guest' }, { roomId: 'reconnect-playing', playerName: 'B', playerId: 'stable-b' });
    const room = roomManager.rooms['reconnect-playing'];
    room.status = 'playing';
    room.players[0].hand = [{ id: 'a-card', suit: '♥', num: 3, strength: 1 }];

    const result = roomManager.joinRoom({ id: 'new-host' }, {
      roomId: 'reconnect-playing',
      playerName: 'A',
      playerId: 'stable-a'
    });

    expect(result.success).toBe(true);
    expect(result.room.players.find(player => player.playerId === 'stable-a').id).toBe('new-host');
    expect(result.room.players.find(player => player.playerId === 'stable-a').hand).toEqual([
      { id: 'a-card', suit: '♥', num: 3, strength: 1 }
    ]);
  });

  it('交換中に再接続すると交換要求を新しいSocket IDへ移す', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'old-host' }, { roomId: 'reconnect-exchange', playerName: 'A', playerId: 'stable-a', rules: {} });
    roomManager.joinRoom({ id: 'guest' }, { roomId: 'reconnect-exchange', playerName: 'B', playerId: 'stable-b' });
    const room = roomManager.rooms['reconnect-exchange'];
    room.status = 'waiting-exchange';
    room.exchangeRequirements = { 'old-host': 1 };

    roomManager.leaveRoom('old-host', 'stable-a');
    const result = roomManager.joinRoom({ id: 'new-host' }, {
      roomId: 'reconnect-exchange',
      playerName: 'A',
      playerId: 'stable-a'
    });

    expect(result.success).toBe(true);
    expect(result.room.exchangeRequirements).toEqual({ 'new-host': 1 });
  });

  it('ゲーム中の途中参加はホスト許可後に平民0ポイントで追加される', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'late-join', playerName: 'Host', playerId: 'host-player', rules: {} });
    roomManager.joinRoom({ id: 'guest' }, { roomId: 'late-join', playerName: 'Guest', playerId: 'guest-player' });
    const room = roomManager.rooms['late-join'];
    room.status = 'playing';

    const request = roomManager.requestJoin({ id: 'late-socket' }, {
      roomId: 'late-join',
      playerName: 'Late',
      playerId: 'late-player'
    });
    const result = roomManager.approveJoinRequest('host', 'late-join', request.request.requestId);
    const player = result.room.players.find(candidate => candidate.playerId === 'late-player');

    expect(result.success).toBe(true);
    expect(player.role).toBe('平民');
    expect(player.totalPoints).toBe(0);
    expect(player.isLateJoiner).toBe(true);
    expect(player.hand).toEqual([]);
  });

  it('カード交換がある次ラウンドは交換後も大貧民から先に始める', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'exchange-starter', playerName: 'A', playerId: 'a', rules: {} });
    roomManager.joinRoom({ id: 'b' }, { roomId: 'exchange-starter', playerName: 'B', playerId: 'b' });
    roomManager.joinRoom({ id: 'c' }, { roomId: 'exchange-starter', playerName: 'C', playerId: 'c' });
    roomManager.joinRoom({ id: 'd' }, { roomId: 'exchange-starter', playerName: 'D', playerId: 'd' });
    const room = roomManager.rooms['exchange-starter'];
    room.players[0].role = '大富豪';
    room.players[1].role = '富豪';
    room.players[2].role = '貧民';
    room.players[3].role = '大貧民';
    room.previousRoles = Object.fromEntries(room.players.map(player => [player.id, player.role]));

    const originalRandom = Math.random;
    Math.random = () => 0;
    let result;
    try {
      result = roomManager.startGame('host', 'exchange-starter');
    } finally {
      Math.random = originalRandom;
    }

    expect(result.room.status).toBe('waiting-exchange');
    expect(result.room.players[result.room.turnIndex].role).toBe('大貧民');
  });

  it('3人戦の富豪・平民・貧民では富豪から貧民へ1枚交換する', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'a' }, { roomId: 'three-role-round', playerName: 'A', playerId: 'a', rules: {} });
    roomManager.joinRoom({ id: 'b' }, { roomId: 'three-role-round', playerName: 'B', playerId: 'b' });
    roomManager.joinRoom({ id: 'c' }, { roomId: 'three-role-round', playerName: 'C', playerId: 'c' });
    const room = roomManager.rooms['three-role-round'];
    room.players[0].role = '富豪';
    room.players[1].role = '平民';
    room.players[2].role = '貧民';
    room.previousRoles = Object.fromEntries(room.players.map(player => [player.id, player.role]));

    expect(roomManager.buildExchangePlan(room)).toEqual([
      { fromId: room.players[0].id, toId: room.players[2].id, count: 1 }
    ]);

    const originalRandom = Math.random;
    Math.random = () => 0;
    let started;
    try {
      started = roomManager.startGame('a', 'three-role-round');
    } finally {
      Math.random = originalRandom;
    }

    expect(started.room.status).toBe('waiting-exchange');
    const fugo = started.room.players.find(player => player.role === '富豪');
    expect(started.room.exchangeRequirements[fugo.id]).toBe(1);
    expect(started.room.players[started.room.turnIndex].role).toBe('貧民');
  });

  it('2人戦の2ゲーム目も富豪から貧民へ1枚交換する', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'a' }, { roomId: 'two-role-round', playerName: 'A', playerId: 'a', rules: {} });
    roomManager.joinRoom({ id: 'b' }, { roomId: 'two-role-round', playerName: 'B', playerId: 'b' });
    const room = roomManager.rooms['two-role-round'];
    room.players[0].role = '富豪';
    room.players[1].role = '貧民';
    room.previousRoles = Object.fromEntries(room.players.map(player => [player.id, player.role]));

    const started = roomManager.startGame('a', 'two-role-round');

    expect(started.room.status).toBe('waiting-exchange');
    const fugo = started.room.players.find(player => player.role === '富豪');
    expect(started.room.exchangeRequirements[fugo.id]).toBe(1);
    expect(started.room.players[started.room.turnIndex].role).toBe('貧民');
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

  it('場が空でもパスでき、次のプレイヤーへ手番を渡す', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'p1' }, { roomId: 'empty-pass-room', playerName: 'A', playerId: 'a', rules: {} });
    roomManager.joinRoom({ id: 'p2' }, { roomId: 'empty-pass-room', playerName: 'B', playerId: 'b' });

    const room = roomManager.rooms['empty-pass-room'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [{ id: 'a-card' }];
    room.players[1].hand = [{ id: 'b-card' }];
    room.firstTurnExemptPlayerId = 'p1';

    const result = roomManager.passTurn('p1', 'empty-pass-room');

    expect(result.success).toBe(true);
    expect(room.fieldCards).toEqual([]);
    expect(room.turnIndex).toBe(1);
    expect(room.firstTurnExemptPlayerId).toBe(null);
  });
});

describe('CPU seats and room lock', () => {
  it('ホストが選んだCPU難易度を保持する', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'cpu-difficulty', playerName: 'Host', playerId: 'host-player', rules: {} });

    const result = roomManager.addCpuPlayer('host', 'cpu-difficulty', 'hard');

    expect(result.success).toBe(true);
    expect(result.room.players[1].difficulty).toBe('hard');
    expect(roomManager.getPublicState(result.room).players[1].difficulty).toBe('hard');
  });

  it('空席がある場合はCPUを残したまま人間が参加する', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'cpu-replace', playerName: 'Host', playerId: 'host-player', rules: {} });
    roomManager.addCpuPlayer('host', 'cpu-replace');
    roomManager.addCpuPlayer('host', 'cpu-replace');

    const joined = roomManager.joinRoom({ id: 'guest' }, {
      roomId: 'cpu-replace',
      playerName: 'Guest',
      playerId: 'guest-player'
    });

    expect(joined.success).toBe(true);
    expect(joined.room.players).toHaveLength(4);
    expect(joined.room.players.filter(player => player.isCpu)).toHaveLength(2);
    expect(joined.room.players.some(player => player.playerId === 'guest-player')).toBe(true);
  });

  it('8人で満員の場合だけ人間参加時にCPUを1体置き換える', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'cpu-full-replace', playerName: 'Host', playerId: 'host-player', rules: {} });
    for (let count = 0; count < 7; count++) roomManager.addCpuPlayer('host', 'cpu-full-replace');

    const joined = roomManager.joinRoom({ id: 'guest' }, {
      roomId: 'cpu-full-replace',
      playerName: 'Guest',
      playerId: 'guest-player'
    });

    expect(joined.success).toBe(true);
    expect(joined.room.players).toHaveLength(8);
    expect(joined.room.players.filter(player => player.isCpu)).toHaveLength(6);
    expect(joined.room.players.some(player => player.playerId === 'guest-player')).toBe(true);
  });

  it('最大8人までCPUを追加でき、ホストはCPUを削除できる', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'cpu-cap', playerName: 'Host', playerId: 'host-player', rules: {} });

    for (let count = 0; count < 7; count++) {
      expect(roomManager.addCpuPlayer('host', 'cpu-cap').success).toBe(true);
    }
    expect(roomManager.rooms['cpu-cap'].players).toHaveLength(8);
    expect(roomManager.addCpuPlayer('host', 'cpu-cap').success).toBe(false);
    expect(roomManager.removeCpuPlayer('host', 'cpu-cap').success).toBe(true);
    expect(roomManager.rooms['cpu-cap'].players).toHaveLength(7);
    expect(roomManager.removeCpuPlayer('not-host', 'cpu-cap').success).toBe(false);
  });

  it('累積順位中に参加者構成が変わると順位シリーズをリセットする', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'cpu-series-reset', playerName: 'Host', playerId: 'host-player', rules: {} });
    const room = roomManager.rooms['cpu-series-reset'];
    room.completedRounds = 3;
    room.players[0].totalPoints = 12;
    room.players[0].role = '大富豪';
    room.players[0].previousRole = '大富豪';

    const result = roomManager.addCpuPlayer('host', 'cpu-series-reset');

    expect(result.success).toBe(true);
    expect(room.completedRounds).toBe(0);
    expect(room.players.every(player => player.totalPoints === 0)).toBe(true);
    expect(room.players.every(player => player.previousRole == null)).toBe(true);
  });

  it('ロック中は新規参加を拒否するが既存メンバーの再接続は許可する', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'locked-room', playerName: 'Host', playerId: 'host-player', rules: {} });
    roomManager.addCpuPlayer('host', 'locked-room');
    expect(roomManager.setRoomLock('host', 'locked-room', true).success).toBe(true);

    const rejected = roomManager.joinRoom({ id: 'new-guest' }, {
      roomId: 'locked-room',
      playerName: 'Guest',
      playerId: 'guest-player'
    });
    expect(rejected.success).toBe(false);
    expect(rejected.message).toContain('ロック');

    const reconnect = roomManager.joinRoom({ id: 'host-reconnected' }, {
      roomId: 'locked-room',
      playerName: 'Host',
      playerId: 'host-player'
    });
    expect(reconnect.success).toBe(true);
    expect(reconnect.room.hostId).toBe('host-reconnected');
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

  it('通常時の2のペアは8切りと同じく場を流せる', () => {
    const room = {
      rules: { eightCut: false, revolution: false, staircaseRevolution: false, suitLock: false, numberLock: false, elevenBack: false, fiveSkip: false, tenDiscard: false, sevenPass: false },
      fieldCards: [{ id: 'h5', suit: '♥', num: 5, strength: 5 }, { id: 's5', suit: '♠', num: 5, strength: 5 }],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };
    const result = applyCardEffects(room, { name: 'A', hand: [] }, [
      { id: 'h2', suit: '♥', num: 2, strength: 15 },
      { id: 's2', suit: '♠', num: 2, strength: 15 }
    ], { valid: true });

    expect(result.clearField).toBe(true);
    expect(result.actionLogs.join(' ')).toContain('最強手');
  });

  it('JQK階段はQKAで返せるため最強手ではない', () => {
    const room = {
      rules: { eightCut: false, revolution: false, staircase: true, staircaseRevolution: false, suitLock: false, numberLock: false, elevenBack: false, fiveSkip: false, tenDiscard: false, sevenPass: false },
      fieldCards: [{ id: 'h5', suit: '♥', num: 5, strength: 5 }, { id: 'h6', suit: '♥', num: 6, strength: 6 }, { id: 'h7', suit: '♥', num: 7, strength: 7 }],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };
    const result = applyCardEffects(room, { name: 'A', hand: [] }, [
      { id: 'hJ', suit: '♥', num: 'J', strength: 11 },
      { id: 'hQ', suit: '♥', num: 'Q', strength: 12 },
      { id: 'hK', suit: '♥', num: 'K', strength: 13 }
    ], { valid: true });

    expect(result.clearField).toBe(false);
  });

  it('K-A-2階段はより強い階段がないため場を流す', () => {
    const room = {
      rules: { eightCut: false, revolution: false, staircase: true, staircaseRevolution: false, suitLock: false, numberLock: false, elevenBack: false, fiveSkip: false, tenDiscard: false, sevenPass: false },
      fieldCards: [{ id: 'h5', suit: '♥', num: 5, strength: 5 }, { id: 'h6', suit: '♥', num: 6, strength: 6 }, { id: 'h7', suit: '♥', num: 7, strength: 7 }],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };
    const result = applyCardEffects(room, { name: 'A', hand: [] }, [
      { id: 'hK', suit: '♥', num: 'K', strength: 11 },
      { id: 'hA', suit: '♥', num: 'A', strength: 12 },
      { id: 'h2', suit: '♥', num: 2, strength: 13 }
    ], { valid: true });

    expect(result.clearField).toBe(true);
    expect(result.actionLogs.join(' ')).toContain('最強手');
  });

  it('革命中の2のペアは最強手として場を流さない', () => {
    const room = {
      rules: { eightCut: false, revolution: true, staircaseRevolution: false, suitLock: false, numberLock: false, elevenBack: false, fiveSkip: false, tenDiscard: false, sevenPass: false },
      fieldCards: [{ id: 'h5', suit: '♥', num: 5, strength: 5 }, { id: 's5', suit: '♠', num: 5, strength: 5 }],
      isRevolution: true,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };
    const result = applyCardEffects(room, { name: 'A', hand: [] }, [
      { id: 'h2', suit: '♥', num: 2, strength: 15 },
      { id: 's2', suit: '♠', num: 2, strength: 15 }
    ], { valid: true });

    expect(result.clearField).toBe(false);
  });

  it('5飛びでスキップ数が増える', () => {
    const room = {
      rules: { eightCut: false, revolution: false, staircaseRevolution: false, suitLock: false, numberLock: false, elevenBack: false, fiveSkip: true, tenDiscard: false, sevenPass: false },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: [],
      players: [
        { id: 'p1', name: 'A', hand: [{ id: 'a1', suit: '♥', num: 7, strength: 7 }] },
        { id: 'p2', name: 'B', hand: [{ id: 'b1', suit: '♠', num: 8, strength: 8 }] }
      ]
    };
    const currentPlayer = { id: 'p2', name: 'B', hand: [{ id: 'b1', suit: '♠', num: 8, strength: 8 }] };
    const result = applyCardEffects(room, currentPlayer, [{ id: 's5', suit: '♠', num: 5, strength: 5 }], { valid: true });

    expect(result.skipCount).toBe(2);
      expect(result.clearField).toBe(true);
    expect(result.actionLogs.join(' ')).toContain('5飛び');
  });
});
