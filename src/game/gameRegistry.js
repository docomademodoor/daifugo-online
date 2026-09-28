const GameRegistry = require('../core/gameRegistry');

const gameRegistry = new GameRegistry([
  {
    id: 'daifugo',
    label: '大富豪',
    maxPlayers: 8
  }
]);

module.exports = gameRegistry;
