import { z } from 'zod';

/** Validation for league settings updates (shape: LeagueSettings in @teemate/shared). */
export const LeagueSettingsInput = z.object({
  points: z.object({
    win: z.number().int().min(0).max(10),
    tie: z.number().int().min(0).max(10),
    loss: z.number().int().min(0).max(10),
  }),
  handicap: z
    .object({
      rounds: z.number().int().min(1).max(40),
      best: z.number().int().min(0).max(40),
      allowance: z.number().int().min(50).max(100),
      base: z.number().int().min(27).max(45),
      rounding: z.enum(['down', 'nearest']),
      max: z.number().int().min(1).max(36),
      minimumRounds: z.number().int().min(1).max(40),
      includeLeagueId: z.uuid().nullable(),
    })
    .refine((h) => h.best <= h.rounds, { message: 'Best rounds can’t exceed rounds looked at.' }),
  season: z.object({ regularSeasonWeeks: z.number().int().min(1).max(40) }),
  teeTimes: z.object({
    firstTeeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)'),
    intervalMinutes: z.number().int().min(5).max(30),
  }),
  nines: z.enum(['alternate', 'front', 'back']),
  playoffs: z.object({
    format: z.enum(['knockout', 'final_foursome', 'none']),
    tiebreak: z.enum(['standard', 'par5s_first']),
  }),
  scorecards: z.object({ disputeWindowHours: z.number().int().min(0).max(168) }),
  scramble: z.object({
    teamSize: z.number().int().min(2).max(6),
    allowance: z.array(z.number().int().min(0).max(100)).min(1).max(8),
  }),
});

export const UpdateLeague = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    settings: LeagueSettingsInput.optional(),
    visibility: z.enum(['private', 'public']).optional(),
  })
  .refine((b) => b.name !== undefined || b.settings !== undefined || b.visibility !== undefined, {
    message: 'Nothing to update.',
  });
