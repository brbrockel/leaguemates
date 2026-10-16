import { bestFoursomes, groupMateCounts, type Group } from './foursomes.js';
import { createRng, shuffle } from './random.js';
import { seasonRounds, type Pairing } from './roundRobin.js';

export interface SeasonOptions {
  players: string[];
  /** Regular-season rounds. Defaults to a single round-robin (players − 1, e.g. 15 for 16). */
  weeks?: number;
  /** Date of round 1, YYYY-MM-DD. Later rounds are a week apart. */
  startDate: string;
  /** Layout ids used in rotation, e.g. ['front', 'back'] to alternate nines. */
  layouts: string[];
  /** First tee time, HH:MM (24-hour). */
  firstTeeTime: string;
  intervalMinutes: number;
  /** Same seed and options always give the same schedule. */
  seed: number;
}

export interface ScheduledGroup {
  /** 0 = first off the tee. */
  slot: number;
  teeTime: string;
  matches: Pairing[];
}

export interface ScheduledWeek {
  round: number;
  date: string;
  layout: string;
  groups: ScheduledGroup[];
  bye?: string;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function teeTime(first: string, slot: number, intervalMinutes: number): string {
  const [h, m] = first.split(':').map(Number);
  const total = h! * 60 + m! + slot * intervalMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Orders a week's groups so tee positions rotate: players who have teed off
 * late most often go first.
 */
function orderGroups(groups: Group[], slotTotals: Map<string, number>): Group[] {
  const lateness = (g: Group) => {
    const players = g.flat();
    return players.reduce((s, p) => s + (slotTotals.get(p) ?? 0), 0) / players.length;
  };
  return [...groups].sort((x, y) => lateness(y) - lateness(x));
}

/** Builds the full regular-season schedule. */
export function generateSeason(options: SeasonOptions): ScheduledWeek[] {
  const { players, startDate, layouts, firstTeeTime, intervalMinutes, seed } = options;
  if (layouts.length === 0) throw new Error('At least one layout is required');
  const weeks = options.weeks ?? (players.length % 2 === 0 ? players.length - 1 : players.length);
  const rng = createRng(seed);

  const rounds = seasonRounds(shuffle(players, rng), weeks);
  const groupsByWeek = bestFoursomes(
    rounds.map((r) => r.pairings),
    rng,
  );

  const slotTotals = new Map<string, number>();
  return rounds.map((round, w) => {
    const ordered = orderGroups(groupsByWeek[w]!, slotTotals);
    ordered.forEach((g, slot) =>
      g.flat().forEach((p) => slotTotals.set(p, (slotTotals.get(p) ?? 0) + slot)),
    );
    return {
      round: w + 1,
      date: addDays(startDate, 7 * w),
      layout: layouts[w % layouts.length]!,
      groups: ordered.map((matches, slot) => ({
        slot,
        teeTime: teeTime(firstTeeTime, slot, intervalMinutes),
        matches,
      })),
      ...(round.bye ? { bye: round.bye } : {}),
    };
  });
}

export interface DiversityReport {
  /** Distinct opponent pairs that meet at least once, out of all possible pairs. */
  pairsMet: number;
  possiblePairs: number;
  neverMet: [string, string][];
  /** Most times any two players face each other. */
  maxOpponentRepeats: number;
  /** Most times any two non-opponents share a foursome. */
  maxGroupMateRepeats: number;
  /** For each player: [earliest, latest] tee slot over the season. */
  teeSlotRange: Record<string, [number, number]>;
}

/** Summarises how well a schedule mixes the group, for the commissioner's review. */
export function diversityReport(players: string[], season: ScheduledWeek[]): DiversityReport {
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const opponents = new Map<string, number>();
  const teeSlotRange: Record<string, [number, number]> = {};
  for (const week of season)
    for (const group of week.groups)
      for (const [x, y] of group.matches) {
        opponents.set(key(x, y), (opponents.get(key(x, y)) ?? 0) + 1);
        for (const p of [x, y]) {
          const [lo, hi] = teeSlotRange[p] ?? [group.slot, group.slot];
          teeSlotRange[p] = [Math.min(lo, group.slot), Math.max(hi, group.slot)];
        }
      }

  const neverMet: [string, string][] = [];
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++)
      if (!opponents.has(key(players[i]!, players[j]!))) neverMet.push([players[i]!, players[j]!]);

  const mates = groupMateCounts(season.map((w) => w.groups.map((g) => g.matches)));
  return {
    pairsMet: opponents.size,
    possiblePairs: (players.length * (players.length - 1)) / 2,
    neverMet,
    maxOpponentRepeats: Math.max(0, ...opponents.values()),
    maxGroupMateRepeats: Math.max(0, ...mates.values()),
    teeSlotRange,
  };
}
