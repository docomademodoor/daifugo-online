function createDeck(includeJoker = true) {
  const suits = ['♠', '♥', '♦', '♣'];
  const deck = [];

  for (let suit of suits) {
    for (let num = 1; num <= 13; num++) {
      let strength = num - 2;
      if (strength <= 0) strength += 13; 

      let displayNum = num;
      if (num === 1) displayNum = 'A';
      if (num === 11) displayNum = 'J';
      if (num === 12) displayNum = 'Q';
      if (num === 13) displayNum = 'K';

      deck.push({ 
        suit, 
        num: displayNum, 
        strength, 
        id: `${suit}${num}` 
      });
    }
  }

  if (includeJoker) {
    deck.push({
      suit: '★',
      num: 'JOKER',
      strength: 14,
      id: 'JOKER'
    });
  }

  return deck.sort(() => Math.random() - 0.5);
}

module.exports = { createDeck };
