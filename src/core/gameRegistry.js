class GameRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    definitions.forEach(definition => this.register(definition));
  }

  register(definition) {
    if (!definition?.id || !Number.isInteger(definition.maxPlayers)) {
      throw new Error('A game definition requires id and maxPlayers');
    }
    this.definitions.set(definition.id, Object.freeze({ ...definition }));
    return this;
  }

  get(gameType) {
    return this.definitions.get(gameType) || null;
  }

  has(gameType) {
    return this.definitions.has(gameType);
  }

  list() {
    return [...this.definitions.values()];
  }
}

module.exports = GameRegistry;
