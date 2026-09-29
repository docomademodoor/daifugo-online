import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const roomManager = require('../src/game/roomManager.js');

describe('チンチロのルーム進行', () => {
  const roomId = 'chinchiro-test-room';
  const host = { id: 'host' };
  const guest = { id: 'guest' };

  beforeEach(() => {
    delete roomManager.rooms[roomId];
  });

  function createPlayingRoom() {
    roomManager.createRoom(host, {
      roomId,
      playerName: 'ホスト',
      gameType: 'chinchiro'
    });
    roomManager.joinRoom(guest, {
      roomId,
      playerName: 'ゲスト'
    });
    return roomManager.startGame(host.id, roomId).room;
  }

  it('最大8人のルームでカードを配らずに対戦を開始する', () => {
    const room = createPlayingRoom();

    expect(room.maxPlayers).toBe(8);
    expect(room.status).toBe('playing');
    expect(room.rules).toEqual({});
    expect(room.players.every(player => player.hand.length === 0)).toBe(true);
  });

  it('履歴が60件に達した後もロールIDが一意に増加する', () => {
    const room = createPlayingRoom();
    room.chinchiroHistory = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      round: 0,
      playerId: 'previous-player',
      playerName: '前ラウンド',
      dice: [1, 2, 3],
      label: '役なし',
      rollNumber: 1,
      confirmed: false
    }));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);
      expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);

      expect(room.chinchiroHistory).toHaveLength(60);
      expect(room.chinchiroHistory.slice(-2).map(entry => entry.id)).toEqual([61, 62]);
      expect(new Set(room.chinchiroHistory.map(entry => entry.id)).size).toBe(60);
    } finally {
      random.mockRestore();
    }
  });

  it('8人までは参加でき、9人目は拒否する', () => {
    roomManager.createRoom(host, { roomId, playerName: 'ホスト', gameType: 'chinchiro' });
    for (let player = 2; player <= 8; player++) {
      expect(roomManager.joinRoom({ id: `guest-${player}` }, {
        roomId,
        playerName: `ゲスト${player}`
      }).success).toBe(true);
    }

    const ninthPlayer = roomManager.joinRoom({ id: 'guest-9' }, {
      roomId,
      playerName: 'ゲスト9'
    });

    expect(roomManager.rooms[roomId].players).toHaveLength(8);
    expect(ninthPlayer).toMatchObject({ success: false });
    expect(ninthPlayer.message).toContain('最大8人');
  });

  it('3投目後も手番を維持し、確定操作後に順位と累計点を確定する', () => {
    const room = createPlayingRoom();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(false);
      for (let roll = 0; roll < 3; roll++) {
        expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);
      }
      expect(room.status).toBe('playing');
      expect(room.players[0].rollsUsed).toBe(3);
      expect(room.players[0].chinchiroFinished).toBe(false);
      expect(room.chinchiroHistory.at(-1).confirmed).toBe(false);
      expect(room.players[room.turnIndex].id).toBe(host.id);
      expect(roomManager.performGameAction(host.id, roomId, 'hold').success).toBe(true);
      expect(room.players[0].chinchiroFinished).toBe(true);
      expect(room.chinchiroHistory.at(-1).confirmed).toBe(true);
      for (let roll = 0; roll < 3; roll++) {
        expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(true);
      }

      expect(room.status).toBe('playing');
      expect(room.players[1].rollsUsed).toBe(3);
      expect(room.players[room.turnIndex].id).toBe(guest.id);
      expect(roomManager.performGameAction(guest.id, roomId, 'hold').success).toBe(true);
      expect(room.status).toBe('finished');
      expect(room.completedRounds).toBe(1);
      expect(room.players.every(player => player.rank === 1 && player.totalPoints === 2)).toBe(true);
      expect(room.chinchiroHistory).toHaveLength(6);
      expect(room.chinchiroHistory.at(-1)).toMatchObject({
        playerId: guest.id,
        rollNumber: 3,
        confirmed: true
      });
    } finally {
      random.mockRestore();
    }
  });

  it('一度も振らずに役を確定できない', () => {
    createPlayingRoom();

    expect(roomManager.performGameAction(host.id, roomId, 'hold')).toMatchObject({
      success: false,
      message: '先にサイコロを振ってください'
    });
  });

  it('途中で役を確定すると次のプレイヤーへ手番が移る', () => {
    const room = createPlayingRoom();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    try {
      expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);
      expect(roomManager.performGameAction(host.id, roomId, 'hold').success).toBe(true);
      expect(room.turnIndex).toBe(1);
      expect(room.players[0].chinchiroFinished).toBe(true);
      expect(room.players[0].rollsUsed).toBe(1);
      expect(room.chinchiroHistory[0].confirmed).toBe(true);
    } finally {
      random.mockRestore();
    }
  });
});