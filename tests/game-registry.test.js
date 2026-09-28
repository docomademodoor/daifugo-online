import { describe, expect, it } from 'vitest';
import GameRegistry from '../src/core/gameRegistry.js';
import gameRegistry from '../src/game/gameRegistry.js';

describe('ゲームRegistry', () => {
  it('ゲーム定義を登録して最大人数を解決できる', () => {
    const registry = new GameRegistry([
      { id: 'daifugo', label: '大富豪', maxPlayers: 8 },
      { id: 'chinchiro', label: 'チンチロ', maxPlayers: 10 }
    ]);

    expect(registry.get('chinchiro')).toMatchObject({
      id: 'chinchiro',
      label: 'チンチロ',
      maxPlayers: 10
    });
    expect(registry.list()).toHaveLength(2);
  });

  it('未登録ゲームは解決できない', () => {
    const registry = new GameRegistry();

    expect(registry.get('unknown')).toBeNull();
    expect(registry.has('unknown')).toBe(false);
  });

  it('登録済みゲームは個別ルールとengine契約を持つ', () => {
    expect(gameRegistry.list().map(game => game.id)).toEqual(['daifugo', 'chinchiro']);
    gameRegistry.list().forEach(game => {
      expect(game.createInitialState).toBeTypeOf('function');
      expect(game.engine.startRound).toBeTypeOf('function');
      expect(game.engine.getPublicState).toBeTypeOf('function');
      expect(game.engine.getPublicPlayerState).toBeTypeOf('function');
    });
    expect(gameRegistry.get('daifugo').createRules(null).includeJoker).toBe(true);
    expect(gameRegistry.get('chinchiro').createRules(null)).toEqual({});
  });
});
