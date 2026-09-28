import { describe, expect, it } from 'vitest';
import GameRegistry from '../src/core/gameRegistry.js';

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
});
