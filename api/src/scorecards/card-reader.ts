import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Worker } from 'tesseract.js';
import { CONFIG, type Config } from '../config.js';

/** Who's in the foursome and which nines the card could be, so the reader can match them. */
export interface CardContext {
  players: {
    playerId: string;
    nickname: string;
    fullName: string | null;
    handicap: number | null;
  }[];
  layouts: { id: string; name: string; holes: { number: number; par: number }[] }[];
  plannedLayoutId: string;
}

export interface CardRow {
  /** The foursome player this row is, or null if the name couldn't be matched. */
  playerId: string | null;
  nameOnCard: string;
  /** One per hole of the layout, in playing order; null where nothing could be read. */
  holeScores: (number | null)[];
  /** Positions (0-based) of scores to double-check. */
  uncertain: number[];
  absent: boolean;
  /** The total written on the card for these holes, if any: a check on the hole scores. */
  writtenTotal: number | null;
}

export interface CardReading {
  provider: 'claude' | 'ocr';
  layoutId: string;
  rows: CardRow[];
  notes: string[];
}

/** Lower-case letters only, for comparing names. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length]![b.length]!;
}

/**
 * The foursome player a handwritten name most likely is: nickname, full name, first or last
 * name, or an initial-style abbreviation ("Mike B."), allowing a typo or two.
 */
export function matchPlayer(written: string, players: CardContext['players']): string | null {
  const w = norm(written);
  if (w.length < 2) return null;
  let best: { id: string; score: number } | null = null;
  for (const p of players) {
    const names = [p.nickname, p.fullName ?? '', ...(p.fullName ?? '').split(/\s+/)]
      .map(norm)
      .filter(Boolean);
    for (const n of names) {
      const score =
        n === w
          ? 0
          : n.startsWith(w) || w.startsWith(n)
            ? 0.5
            : distance(n, w) / Math.max(n.length, 1);
      if (score <= 0.34 && (!best || score < best.score)) best = { id: p.playerId, score };
    }
  }
  return best?.id ?? null;
}

/** The layout whose hole numbers are on the card (e.g. 10-18 = the back nine). */
function layoutFor(holeNumbers: number[] | undefined, ctx: CardContext): string {
  if (holeNumbers?.length) {
    const want = [...holeNumbers].sort((a, b) => a - b).join();
    const hit = ctx.layouts.find(
      (l) =>
        l.holes
          .map((h) => h.number)
          .sort((a, b) => a - b)
          .join() === want,
    );
    if (hit) return hit.id;
  }
  return ctx.plannedLayoutId;
}

const validScore = (n: unknown): number | null =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 15 ? n : null;

/** Reads the card with Claude's vision model, answering through a tool so the output is structured. */
export async function readWithClaude(
  client: Anthropic,
  model: string,
  jpeg: Buffer,
  ctx: CardContext,
): Promise<CardReading> {
  const roster = ctx.players
    .map((p) => `- id ${p.playerId}: "${p.nickname}"${p.fullName ? ` (${p.fullName})` : ''}`)
    .join('\n');
  const nines = ctx.layouts
    .map(
      (l) =>
        `- ${l.name}: holes ${l.holes.map((h) => h.number).join(', ')}; pars ${l.holes.map((h) => h.par).join(', ')}`,
    )
    .join('\n');
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [
      {
        name: 'record_scores',
        description: 'Record the gross hole scores read from a golf scorecard photo.',
        input_schema: {
          type: 'object',
          properties: {
            holeNumbers: {
              type: 'array',
              items: { type: 'integer' },
              description: 'The hole numbers that have scores written in, e.g. [1..9] or [10..18].',
            },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  nameOnCard: { type: 'string' },
                  playerId: {
                    type: ['string', 'null'],
                    description:
                      'The id of the player from the list this row belongs to, or null if none fits.',
                  },
                  scores: {
                    type: 'array',
                    items: { type: ['integer', 'null'] },
                    description:
                      'Gross strokes per hole in hole order; null where blank or unreadable.',
                  },
                  uncertain: {
                    type: 'array',
                    items: { type: 'integer' },
                    description: '0-based positions in scores that were hard to read.',
                  },
                  absent: {
                    type: 'boolean',
                    description: 'True if the row is marked absent / no show.',
                  },
                  writtenTotal: {
                    type: ['integer', 'null'],
                    description:
                      'The total the player wrote for these holes (Out, In or Tot box), exactly as written; null if none is written. Never add it up yourself.',
                  },
                },
                required: ['nameOnCard', 'playerId', 'scores', 'uncertain', 'absent'],
              },
            },
            notes: { type: 'string', description: 'Anything a person should check.' },
          },
          required: ['holeNumbers', 'rows'],
        },
      },
    ],
    // Newer models don't accept a forced tool; the prompt asks for the tool call instead.
    tool_choice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') },
          },
          {
            type: 'text',
            text: [
              'This is a photo of a golf league scorecard for one foursome playing nine holes.',
              'Read the handwritten gross score for each player on each hole that was played.',
              'Players in this foursome (match each handwritten name to one of these ids; names may be nicknames, initials or misspelled):',
              roster,
              'The nine could be one of:',
              nines,
              "Ignore printed rows such as yardages, par and handicap; only read the players' handwritten scores.",
              "Also read each player's handwritten total for the nine (the Out, In or Tot box) into writtenTotal, as written, even if it doesn't match the holes. It is a check on the hole scores, so read it independently.",
              'If a digit is ambiguous, give your best reading and list its position in uncertain. Never guess a score for a blank box.',
              'Answer only by calling the record_scores tool.',
            ].join('\n'),
          },
        ],
      },
    ],
  });
  const tool = res.content.find((c) => c.type === 'tool_use');
  let input: unknown = tool?.type === 'tool_use' ? tool.input : undefined;
  if (input === undefined) {
    // Fall back to a JSON object in a text answer.
    const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (json) input = JSON.parse(json);
  }
  if (!input) throw new Error('No structured answer from the model.');
  const out = input as {
    holeNumbers?: number[];
    rows?: {
      nameOnCard?: string;
      playerId?: string | null;
      scores?: unknown[];
      uncertain?: number[];
      absent?: boolean;
      writtenTotal?: unknown;
    }[];
    notes?: string;
  };
  const layoutId = layoutFor(out.holeNumbers, ctx);
  const holes = ctx.layouts.find((l) => l.id === layoutId)!.holes.length;
  const ids = new Set(ctx.players.map((p) => p.playerId));
  const rows: CardRow[] = (out.rows ?? []).map((r) => {
    const playerId =
      r.playerId && ids.has(r.playerId) ? r.playerId : matchPlayer(r.nameOnCard ?? '', ctx.players);
    const scores = Array.from({ length: holes }, (_, i) => validScore(r.scores?.[i]));
    return {
      playerId,
      nameOnCard: r.nameOnCard ?? '',
      holeScores: scores,
      uncertain: [
        ...new Set([
          ...(r.uncertain ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < holes),
          ...scores.flatMap((s, i) => (s === null && !r.absent ? [i] : [])),
        ]),
      ],
      absent: Boolean(r.absent),
      writtenTotal: writtenTotal(r.writtenTotal, holes),
    };
  });
  return {
    provider: 'claude',
    layoutId,
    rows,
    notes: [...(out.notes ? [out.notes] : []), ...totalNotes(rows, ctx)],
  };
}

/**
 * Fallback: OCR the card and pick out lines that start with a player's name followed by
 * scores. Handwriting reads poorly, so every score is marked to check.
 */
export function parseOcrText(text: string, ctx: CardContext): CardRow[] {
  const holes = ctx.layouts.find((l) => l.id === ctx.plannedLayoutId)!.holes.length;
  const rows: CardRow[] = [];
  for (const line of text.split('\n')) {
    const name = line.match(/^[^\d]*/)![0].trim();
    const playerId = matchPlayer(name.split(/\s{2,}|\|/)[0] ?? name, ctx.players);
    if (!playerId || rows.some((r) => r.playerId === playerId)) continue;
    const tokens = line.slice(line.match(/^[^\d]*/)![0].length).match(/\d+/g) ?? [];
    // Single digits run together ("544356345") when there's no gap between boxes.
    const digits = tokens.flatMap((t) =>
      t.length === 1 || (t.length === 2 && Number(t) <= 15) ? [t] : t.split(''),
    );
    const holeScores = Array.from({ length: holes }, (_, i) => validScore(Number(digits[i])));
    rows.push({
      playerId,
      nameOnCard: name,
      holeScores,
      uncertain: holeScores.map((_, i) => i),
      absent: false,
      writtenTotal: null,
    });
  }
  return rows;
}

@Injectable()
export class CardReaderService implements OnModuleDestroy {
  private readonly log = new Logger(CardReaderService.name);
  private readonly client: Anthropic | null;
  private worker: Promise<Worker> | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.client = config.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 })
      : null;
  }

  get claudeAvailable() {
    return this.client !== null;
  }

  /** Claude when it's configured and answers; otherwise local OCR. */
  async read(jpeg: Buffer, ctx: CardContext): Promise<CardReading> {
    const notes: string[] = [];
    if (this.client) {
      try {
        return await readWithClaude(this.client, this.config.CARD_SCAN_MODEL, jpeg, ctx);
      } catch (e) {
        this.log.warn(`Claude couldn't read the card, using OCR: ${String(e)}`);
        notes.push('The AI reader was unavailable, so basic text recognition was used instead.');
      }
    } else {
      notes.push(
        'Basic text recognition was used (the AI reader is not set up). Check every score.',
      );
    }
    const text = await this.ocr(jpeg);
    return { provider: 'ocr', layoutId: ctx.plannedLayoutId, rows: parseOcrText(text, ctx), notes };
  }

  private async ocr(image: Buffer): Promise<string> {
    if (!this.worker) {
      const require = createRequire(import.meta.url);
      const { createWorker } = require('tesseract.js') as typeof import('tesseract.js');
      const langPath = join(
        dirname(require.resolve('@tesseract.js-data/eng/package.json')),
        '4.0.0_best_int',
      );
      this.worker = createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true });
    }
    const { data } = await (await this.worker).recognize(image);
    return data.text;
  }

  async onModuleDestroy() {
    if (this.worker) await (await this.worker).terminate();
  }
}

/** A plausible total for a nine (or 18), else null. */
function writtenTotal(v: unknown, holes: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= holes && v <= holes * 15 ? v : null;
}

/**
 * The written totals checked against the hole scores: a total that doesn't add up means a
 * misread (or a mistake on the card), and a card without totals has nothing to check against.
 */
export function totalNotes(rows: CardRow[], ctx: CardContext): string[] {
  const name = (r: CardRow) =>
    ctx.players.find((p) => p.playerId === r.playerId)?.nickname ?? (r.nameOnCard || 'A row');
  const played = rows.filter((r) => !r.absent);
  const notes: string[] = [];
  for (const r of played) {
    if (r.writtenTotal === null || r.holeScores.some((s) => s === null)) continue;
    const sum = r.holeScores.reduce<number>((t, s) => t + s!, 0);
    if (sum !== r.writtenTotal)
      notes.push(
        `${name(r)}: the holes add up to ${sum}, but the card's total says ${r.writtenTotal}. Check the holes against the card.`,
      );
  }
  const without = played.filter((r) => r.writtenTotal === null);
  if (played.length && without.length === played.length)
    notes.push('No totals are written on the card. Adding them helps catch a misread score.');
  else if (without.length) notes.push(`No total written for ${without.map(name).join(', ')}.`);
  return notes;
}
