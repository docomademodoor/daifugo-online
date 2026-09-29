const engine = require('./engine');

module.exports = {
  id: 'daifugo',
  label: '大富豪',
  maxPlayers: 8,
  createRules(rules = {}) {
    const completeLock = rules?.completeLock ?? false;
    return {
      eightCut: rules?.eightCut ?? true,
      revolution: rules?.revolution ?? true,
      suitLock: rules?.suitLock ?? true,
      spe3: rules?.spe3 ?? true,
      staircase: rules?.staircase ?? true,
      staircaseRevolution: rules?.staircaseRevolution ?? true,
      elevenBack: rules?.elevenBack ?? true,
      numberLock: completeLock ? false : rules?.numberLock ?? true,
      completeLock,
      fiveSkip: rules?.fiveSkip ?? true,
      sevenPass: rules?.sevenPass ?? true,
      tenDiscard: rules?.tenDiscard ?? true,
      dia3Start: rules?.dia3Start ?? true,
      miyakoOchi: rules?.miyakoOchi ?? true,
      forbiddenFinish: rules?.forbiddenFinish ?? true,
      includeJoker: rules?.includeJoker ?? true
    };
  },
  createInitialState() {
    return {
      fieldCards: [],
      turnIndex: 0,
      passCount: 0,
      lastPlayedIndex: 0,
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      lockedNumberSuits: null,
      actionMessage: 'ルームが作成されました',
      winners: [],
      previousRoles: null,
      completedRounds: 0,
      firstTurnExemptPlayerId: null,
      turnDeadlineAt: null,
      pendingSideSelection: null,
      exchangeRequirements: {},
      exchangeSelections: {}
    };
  },
  engine
};