import { beforeEach, describe, expect, it } from 'vitest';
import roomChatModule from '../src/game/roomChat.js';

const { RoomChat } = roomChatModule;

describe('ルームチャット', () => {
  let roomChat;
  let memberSocket;

  beforeEach(() => {
    const roomManager = {
      rooms: {
        '12345': {
          players: [{ id: 'socket-a', name: 'プレイヤーA' }]
        }
      }
    };
    roomChat = new RoomChat(roomManager);
    memberSocket = {
      id: 'socket-a',
      rooms: new Set(['socket-a', '12345']),
      data: {}
    };
  });

  it('参加者の名前を使い、空白を除いたメッセージを保存する', () => {
    const result = roomChat.send(memberSocket, '12345', '  こんにちは  ', 1000);

    expect(result).toMatchObject({
      success: true,
      message: {
        senderName: 'プレイヤーA',
        text: 'こんにちは',
        sentAt: 1000
      }
    });
  });

  it('ルーム未参加者の送信と履歴取得を拒否する', () => {
    const outsider = { id: 'socket-b', rooms: new Set(['socket-b']), data: {} };

    expect(roomChat.send(outsider, '12345', 'こんにちは', 1000).success).toBe(false);
    expect(roomChat.getHistory(outsider, '12345').success).toBe(false);
  });

  it('200文字までは受け付け、超過分は拒否する', () => {
    expect(roomChat.send(memberSocket, '12345', 'あ'.repeat(199) + '😀', 1000).success).toBe(true);
    expect(roomChat.send(memberSocket, '12345', 'あ'.repeat(201), 2000).success).toBe(false);
  });

  it('同じ送信者は1秒以内に再送できない', () => {
    expect(roomChat.send(memberSocket, '12345', '一通目', 1000).success).toBe(true);
    expect(roomChat.send(memberSocket, '12345', '早すぎる', 1999).success).toBe(false);
    expect(roomChat.send(memberSocket, '12345', '二通目', 2000).success).toBe(true);
  });

  it('履歴は新しい50件だけ保持し、ルーム削除時に消去する', () => {
    for (let index = 0; index < 51; index++) {
      roomChat.send(memberSocket, '12345', `メッセージ${index}`, index * 1000);
    }

    expect(roomChat.getHistory(memberSocket, '12345').messages).toHaveLength(50);
    expect(roomChat.getHistory(memberSocket, '12345').messages[0].text).toBe('メッセージ1');
    roomChat.deleteRoom('12345');
    expect(roomChat.getHistory(memberSocket, '12345').messages).toEqual([]);
  });
});