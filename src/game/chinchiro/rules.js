function evaluateChinchiro(dice) {
  if (!Array.isArray(dice) || dice.length !== 3
    || dice.some(value => !Number.isInteger(value) || value < 1 || value > 6)) {
    throw new RangeError('チンチロの出目は1から6の整数を3個指定してください');
  }

  const sortedDice = [...dice].sort((left, right) => left - right);
  const [first, second, third] = sortedDice;

  if (first === 1 && second === 1 && third === 1) {
    return { type: 'pinzoro', label: 'ピンゾロ', strength: 5000, dice: sortedDice };
  }
  if (first === 4 && second === 5 && third === 6) {
    return { type: 'shigoro', label: 'シゴロ', strength: 4000, dice: sortedDice };
  }
  if (first === third) {
    return { type: 'triple', label: `${first}のゾロ目`, strength: 3000 + first, dice: sortedDice };
  }
  if (first === second) {
    return { type: 'pair', label: `${third}の目`, strength: 2000 + third, dice: sortedDice };
  }
  if (second === third) {
    return { type: 'pair', label: `${first}の目`, strength: 2000 + first, dice: sortedDice };
  }
  if (first === 1 && second === 2 && third === 3) {
    return { type: 'hifumi', label: 'ヒフミ', strength: 0, dice: sortedDice };
  }

  return { type: 'no-hand', label: '役なし', strength: 1000, dice: sortedDice };
}

function rollDice(random = Math.random) {
  return Array.from({ length: 3 }, () => Math.floor(random() * 6) + 1);
}

module.exports = { evaluateChinchiro, rollDice };