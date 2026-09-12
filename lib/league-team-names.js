const { randomInt } = require('node:crypto');

const adjectives = [
  'Royal', 'Golden', 'Crimson', 'Midnight', 'Electric', 'Neon',
  'Imperial', 'Shadow', 'Turbo', 'Vienna', 'Cosmic', 'Sapphire',
  'Solar', 'Silver', 'Velvet', 'Storm', 'Foam'
];
const mascots = [
  'Ricochets', 'Griffins', 'Rockets', 'Phantoms', 'Vipers', 'Falcons',
  'Comets', 'Guardians', 'Foxes', 'Raptors', 'Knights', 'Mavericks',
  'Rebels', 'Voltage', 'Cyclones', 'Titans', 'Phoenixes', 'Ninjas',
  'Aces', 'Legends'
];

function generateTeamNames(count, randomIndex = randomInt) {
  const pool = adjectives.flatMap(adjective => mascots.map(mascot => `${adjective} ${mascot}`));
  if (!Number.isInteger(count) || count < 1 || count > pool.length) {
    throw new RangeError(`Team-name count must be between 1 and ${pool.length}.`);
  }
  for (let index = 0; index < count; index++) {
    const pick = randomIndex(index, pool.length);
    if (!Number.isInteger(pick) || pick < index || pick >= pool.length) {
      throw new RangeError('The random name selection was outside the available pool.');
    }
    [pool[index], pool[pick]] = [pool[pick], pool[index]];
  }
  return pool.slice(0, count);
}

module.exports = { generateTeamNames };
