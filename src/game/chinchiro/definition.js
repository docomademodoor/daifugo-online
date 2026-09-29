const engine = require('./engine');

module.exports = {
  id: 'chinchiro',
  label: 'チンチロ',
  maxPlayers: 8,
  createRules() {
    return {};
  },
  createInitialState() {
    return {
      fieldCards: [],
      turnIndex: 0,
      actionMessage: 'ルームが作成されました',
      winners: [],
      completedRounds: 0,
      chinchiroHistory: []
    };
  },
  engine
};