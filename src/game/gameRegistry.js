const GameRegistry = require('../core/gameRegistry');
const daifugo = require('./daifugo/definition');
const chinchiro = require('./chinchiro/definition');

const gameRegistry = new GameRegistry([
  daifugo,
  chinchiro
]);

module.exports = gameRegistry;
