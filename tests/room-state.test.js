import { describe, expect, it } from 'vitest';
import {
  createCpuPlayer,
  createHumanPlayer,
  createJoinRequest,
  createRoomState,
  consumeJoinRequest,
  rebindPlayerConnection,
  ROOM_STATUS
} from '../src/core/roomState.js';

describe('共通ルーム状態', () => {
  it('ゲーム固有のルールを受け取ってルームを初期化できる', () => {
    const host = createHumanPlayer({ id: 'socket-a', playerId: 'player-a', name: 'A' });
    const room = createRoomState({
      id: 'room-a',
      hostId: 'socket-a',
      rules: { maxPlayers: 4 },
      hostPlayer: host,
      initialState: { gameState: 'custom-initial-state' }
    });

    expect(room.status).toBe(ROOM_STATUS.WAITING);
    expect(room.rules).toEqual({ maxPlayers: 4 });
    expect(room.players).toEqual([host]);
    expect(room.gameState).toBe('custom-initial-state');
  });

  it('人間とCPUのプレイヤー形状を共通化できる', () => {
    const human = createHumanPlayer({ id: 'socket-a', name: 'A' });
    const cpu = createCpuPlayer({ id: 'cpu-a', name: 'CPU A', difficulty: 'hard' });

    expect(human).toMatchObject({ isCpu: false, connected: true, totalPoints: 0 });
    expect(cpu).toMatchObject({ isCpu: true, difficulty: 'hard', playerId: 'cpu-a' });
  });

  it('再接続時にSocket依存の状態を新しいIDへ移せる', () => {
    const player = createHumanPlayer({ id: 'old-socket', playerId: 'stable-a', name: 'A' });
    const room = createRoomState({ id: 'room-a', hostId: 'old-socket', rules: {}, hostPlayer: player });
    room.exchangeRequirements = { 'old-socket': 1 };
    room.exchangeSelections = { 'old-socket': [{ id: 'card-a' }] };
    room.pendingSideSelection = { playerId: 'old-socket', cardIds: ['card-a'] };

    rebindPlayerConnection(room, player, 'new-socket', 'A2');

    expect(room.hostId).toBe('new-socket');
    expect(player.id).toBe('new-socket');
    expect(player.name).toBe('A2');
    expect(room.exchangeRequirements).toEqual({ 'new-socket': 1 });
    expect(room.exchangeSelections).toEqual({ 'new-socket': [{ id: 'card-a' }] });
    expect(room.pendingSideSelection.playerId).toBe('new-socket');
  });

  it('参加申請を保留して一度だけ消費できる', () => {
    const room = createRoomState({
      id: 'room-a',
      hostId: 'host',
      rules: {},
      hostPlayer: createHumanPlayer({ id: 'host', name: 'Host' })
    });
    const request = createJoinRequest({ socketId: 'guest', playerId: 'stable-guest', playerName: 'Guest' });
    room.joinRequests[request.requestId] = request;

    expect(consumeJoinRequest(room, request.requestId)).toEqual(request);
    expect(consumeJoinRequest(room, request.requestId)).toBeNull();
  });
});
