import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import sharp from 'sharp';
import { z } from 'zod';
import { CurrentUser, forGuest, GuestOk, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { LeagueGuard } from '../leagues/league.guard.js';
import { PhotosService } from '../photos/photos.js';
import { CardReaderService } from './card-reader.js';
import { PlayerStatsService } from './player-stats.service.js';
import { ScorecardsService } from './scorecards.service.js';

const Uuid = new ParseUUIDPipe();
const SaveCard = z.object({
  layoutId: z.uuid(),
  version: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
  rounds: z
    .array(
      z.object({
        playerId: z.uuid(),
        handicap: z.number().int().min(0).max(54).optional(),
        attendance: z.enum(['played', 'absent']),
        subName: z.string().trim().max(60).nullable().optional(),
        holeScores: z.array(z.number().int().min(1).max(15).nullable()).min(1).max(18),
      }),
    )
    .min(2)
    .max(8),
});
const Dispute = z.object({ note: z.string().trim().min(3).max(500) });

/** Routes for one group's card: /leagues/:l/seasons/:s/weeks/:w/groups/:g/scorecard */
@Controller('leagues/:leagueId/seasons/:seasonId')
@UseGuards(LeagueGuard)
export class ScorecardsController {
  constructor(
    private readonly cards: ScorecardsService,
    private readonly stats: PlayerStatsService,
    private readonly photos: PhotosService,
    private readonly reader: CardReaderService,
  ) {}

  @Get('standings')
  @GuestOk()
  standings(@Param('leagueId') leagueId: string, @Param('seasonId', Uuid) seasonId: string) {
    return this.cards.standings(leagueId, seasonId);
  }

  @Get('stats')
  @GuestOk()
  seasonStats(@Param('leagueId') leagueId: string, @Param('seasonId', Uuid) seasonId: string) {
    return this.stats.seasonStats(leagueId, seasonId);
  }

  @Get('results')
  @GuestOk()
  async results(@Param('leagueId') leagueId: string, @Param('seasonId', Uuid) seasonId: string) {
    return (await this.cards.seasonResults(leagueId, seasonId)).groups;
  }

  @Get('weeks/:weekId/groups/:groupId/scorecard')
  @GuestOk()
  async view(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Param('groupId', Uuid) groupId: string,
  ) {
    const v = await this.cards.view(user, leagueId, seasonId, weekId, groupId);
    // Guests don't see who entered the card or what a dispute said.
    return user.isGuest && v.card
      ? { ...v, card: { ...v.card, enteredBy: null, dispute: null } }
      : v;
  }

  /**
   * A photo of the paper card: kept in the season's Scorecards album and read into suggested
   * scores (Claude, or local OCR as a fallback). Nothing is saved to the card itself; the
   * person checks the suggestions and saves as usual.
   */
  /**
   * One scan button per round: reads a card against every foursome you can enter in this
   * round and works out which one it is from the names, then stores the photo with that
   * card. Returns which foursome it matched (or null if none clearly did).
   */
  @Post('weeks/:weekId/scan')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  async scanRound(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Take or choose a photo of the card.');
    const groupIds = await this.cards.groupIdsOf(leagueId, seasonId, weekId);
    const views = (
      await Promise.all(
        groupIds.map(async (groupId) => ({
          groupId,
          view: await this.cards.view(user, leagueId, seasonId, weekId, groupId),
        })),
      )
    ).filter((g) => g.view.permissions.canEdit);
    if (views.length === 0)
      throw new ForbiddenException('There are no cards in this round you can enter.');

    const jpeg = await sharp(file.buffer)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    const first = views[0]!.view;
    const reading = await this.reader.read(jpeg, {
      players: views.flatMap((g) => g.view.players.map((p) => ({ ...p, fullName: null }))),
      layouts: first.layouts,
      plannedLayoutId: first.card?.layoutId ?? first.plannedLayoutId,
    });

    // The foursome with the most of its players on the card.
    const counts = views.map((g) => ({
      groupId: g.groupId,
      players: new Set(g.view.players.map((p) => p.playerId)),
      hits: reading.rows.filter(
        (r) => r.playerId && g.view.players.some((p) => p.playerId === r.playerId),
      ).length,
    }));
    counts.sort((a, b) => b.hits - a.hits);
    const best = counts[0]!;
    const clear = best.hits > 0 && (counts[1]?.hits ?? 0) < best.hits;
    const groupId = clear ? best.groupId : null;
    // Names from other foursomes stay on the card as unmatched rows, for the person to sort out.
    const rows = groupId
      ? reading.rows.map((r) =>
          r.playerId && !best.players.has(r.playerId) ? { ...r, playerId: null } : r,
        )
      : reading.rows;

    // Two complete matches from different foursomes on one card: they were regrouped at the
    // course. Suggest swapping so both matches share the first one's foursome.
    let regroup: { matchA: string; matchB: string; groupId: string } | null = null;
    if (!groupId) {
      const onCard = new Set(reading.rows.flatMap((r) => (r.playerId ? [r.playerId] : [])));
      const all = await this.cards.matchesOf(weekId);
      const full = all.filter((m) => onCard.has(m.playerA) && onCard.has(m.playerB));
      if (full.length === 2 && full[0]!.groupId !== full[1]!.groupId) {
        const [keep, move] = full as [(typeof all)[number], (typeof all)[number]];
        const out = all.find((m) => m.groupId === keep.groupId && m.id !== keep.id);
        if (out) regroup = { matchA: out.id, matchB: move.id, groupId: keep.groupId };
      }
    }

    const photo = await this.photos.upload(user, leagueId, file, {
      kind: 'card',
      ...(groupId ? { groupId } : { seasonId }),
    });
    return {
      groupId,
      matchedPlayers: groupId ? best.hits : 0,
      photo,
      reading: { ...reading, rows },
      regroup,
    };
  }

  @Post('weeks/:weekId/groups/:groupId/scorecard/scan')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  async scan(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Param('groupId', Uuid) groupId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    const view = await this.cards.view(user, leagueId, seasonId, weekId, groupId);
    if (!view.permissions.canEdit)
      throw new ForbiddenException(
        'Only someone in this foursome or an admin can enter this card.',
      );
    if (!file?.buffer?.length) throw new BadRequestException('Take or choose a photo of the card.');
    const photo = await this.photos.upload(user, leagueId, file, { groupId, kind: 'card' });
    // Upright and a sensible size for reading.
    const jpeg = await sharp(file.buffer)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    const reading = await this.reader.read(jpeg, {
      players: view.players.map((p) => ({ ...p, fullName: null })),
      layouts: view.layouts,
      plannedLayoutId: view.card?.layoutId ?? view.plannedLayoutId,
    });
    return { photo, reading };
  }

  @Put('weeks/:weekId/groups/:groupId/scorecard')
  save(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Param('groupId', Uuid) groupId: string,
    @Body(new ZodPipe(SaveCard)) body: z.infer<typeof SaveCard>,
  ) {
    return this.cards.save(user, leagueId, seasonId, weekId, groupId, body);
  }

  @Post('weeks/:weekId/groups/:groupId/scorecard/submit')
  submit(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Param('groupId', Uuid) groupId: string,
  ) {
    return this.cards.submit(user, leagueId, seasonId, weekId, groupId);
  }

  @Post('weeks/:weekId/groups/:groupId/scorecard/dispute')
  dispute(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Param('groupId', Uuid) groupId: string,
    @Body(new ZodPipe(Dispute)) body: z.infer<typeof Dispute>,
  ) {
    return this.cards.dispute(user, leagueId, seasonId, weekId, groupId, body.note);
  }

  @Post('weeks/:weekId/groups/:groupId/scorecard/approve')
  approve(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Param('groupId', Uuid) groupId: string,
  ) {
    return this.cards.approve(user, leagueId, seasonId, weekId, groupId);
  }
}

const HoleQuery = z.object({
  seasonId: z.uuid().optional(),
  playerId: z.uuid().optional(),
});

/** /leagues/:leagueId/stats/holes: how each hole plays (EH-014). */
@Controller('leagues/:leagueId/stats')
@UseGuards(LeagueGuard)
export class LeagueStatsController {
  constructor(private readonly stats: PlayerStatsService) {}

  @Get('holes')
  @GuestOk()
  holes(
    @Param('leagueId') leagueId: string,
    @Query(new ZodPipe(HoleQuery)) q: z.infer<typeof HoleQuery>,
  ) {
    return this.stats.holes(leagueId, q.seasonId, q.playerId);
  }
}

/** /leagues/:leagueId/players/:playerId/history */
@Controller('leagues/:leagueId/players')
@UseGuards(LeagueGuard)
export class PlayerHistoryController {
  constructor(private readonly stats: PlayerStatsService) {}

  @Get(':playerId/history')
  @GuestOk()
  async history(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('playerId', Uuid) playerId: string,
  ) {
    const h = await this.stats.history(leagueId, playerId);
    return { ...h, player: forGuest(user, h.player) };
  }
}
