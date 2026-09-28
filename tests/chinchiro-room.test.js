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

  it('最大10人のルームでカードを配らずに対戦を開始する', () => {
    const room = createPlayingRoom();

    expect(room.maxPlayers).toBe(10);
    expect(room.status).toBe('playing');
    expect(room.rules).toEqual({});
    expect(room.players.every(player => player.hand.length === 0)).toBe(true);
  });

  it('手番プレイヤーだけが振れ、3回目で順位と累計点を確定する', () => {
    const room = createPlayingRoom();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(false);
      for (let roll = 0; roll < 3; roll++) {
        expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);
      }
      expect(room.status).toBe('playing');
      for (let roll = 0; roll < 3; roll++) {
        expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(true);
      }

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