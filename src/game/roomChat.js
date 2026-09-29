const CHAT_MAX_LENGTH = 200;
const CHAT_COOLDOWN_MS = 1000;
const CHAT_HISTORY_LIMIT = 50;

class RoomChat {
  constructor(roomManager) {
    this.roomManager = roomManager;
    this.histories = new Map();
  }

  getHistory(socket, roomId) {
    if (!this.getMember(socket, roomId)) {
      return { success: false, message: 'このルームのチャットを表示できません。' };
    }

    return { success: true, messages: [...(this.histories.get(roomId) || [])] };
  }

  send(socket, roomId, text, now = Date.now()) {
    const member = this.getMember(socket, roomId);
    if (!member) {
      return { success: false, message: 'このルームには参加していません。' };
    }

    if (typeof text !== 'string') {
      return { success: false, message: 'メッセージを入力してください。' };
    }

    const normalizedText = text.replace(/\r\n?/g, '\n').trim();
    const characterCount = Array.from(normalizedText).length;
    if (characterCount === 0) {
      return { success: false, message: 'メッセージを入力してください。' };
    }
    if (characterCount > CHAT_MAX_LENGTH) {
      return { success: false, message: `メッセージは${CHAT_MAX_LENGTH}文字以内で入力してください。` };
    }

    const lastSentAt = socket.data?.roomChatLastSentAt;
    if (lastSentAt !== undefined && now - lastSentAt < CHAT_COOLDOWN_MS) {
      return { success: false, message: '送信は1秒に1回までです。' };
    }

    socket.data ||= {};
    socket.data.roomChatLastSentAt = now;
    const message = {
      roomId,
      senderId: socket.id,
      senderName: member.name,
      text: normalizedText,
      sentAt: now
    };
    const history = this.histories.get(roomId) || [];
    history.push(message);
    if (history.length > CHAT_HISTORY_LIMIT) history.shift();
    this.histories.set(roomId, history);

    return { success: true, message };
  }

  deleteRoom(roomId) {
    this.histories.delete(roomId);
  }

  getMember(socket, roomId) {
    if (typeof roomId !== 'string' || !/^\d{5}$/.test(roomId)) return null;
    const room = this.roomManager.rooms[roomId];
    if (!room || !socket?.rooms?.has(roomId)) return null;
    return room.players.find(player => player.id === socket.id) || null;
  }
}

module.exports = {
  RoomChat,
  CHAT_MAX_LENGTH,
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_LIMIT
};