export type Pairing = [string, string];

export interface RoundRobinRound {
  pairings: Pairing[];
  /** Player sitting out this round (odd number of players only). */
  bye?: string;
}

/**
 * Round-robin by the circle method: with n players (n even), n-1 rounds in
 * which every pair meets exactly once. With an odd count, each round one
 * player has a bye.
 */
export function roundRobin(players: string[]): RoundRobinRound[] {
  if (new Set(players).size !== players.length) throw new Error('Player ids must be unique');
  if (players.length < 2) throw new Error('A round-robin needs at least 2 players');
  const BYE = '\u0000bye';
  const ring = players.length % 2 === 0 ? [...players] : [...players, BYE];
  const n = ring.length;
  const rounds: RoundRobinRound[] = [];

  for (let r = 0; r < n - 1; r++) {
    const round: RoundRobinRound = { pairings: [] };
    for (let i = 0; i < n / 2; i++) {
      const x = ring[i]!;
      const y = ring[n - 1 - i]!;
      if (x === BYE || y === BYE) round.bye = x === BYE ? y : x;
      // Alternate sides so nobody is always listed first.
      else round.pairings.push(r % 2 === 0 ? [x, y] : [y, x]);
    }
    rounds.push(round);
    // Keep the first player fixed and rotate the rest one place.
    ring.splice(1, 0, ring.pop()!);
  }
  return rounds;
}

/**
 * Rounds for a season of `weeks` weeks: the round-robin repeated as needed.
 * Repeating the full cycle keeps any rematch as far apart as possible.
 */
export function seasonRounds(players: string[], weeks: number): RoundRobinRound[] {
  const cycle = roundRobin(players);
  return Array.from({ length: weeks }, (_, w) => cycle[w % cycle.length]!);
}
