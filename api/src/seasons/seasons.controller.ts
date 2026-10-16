import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';
import { SeasonsService } from './seasons.service.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const CreateSeason = z.object({
  name: z.string().trim().min(1).max(40),
  startDate: IsoDate,
  courseId: z.uuid().optional(),
  /** Nines to rotate through, in order. */
  layoutIds: z.array(z.uuid()).min(1).max(8).optional(),
});
const Generate = z.object({ seed: z.number().int().positive().optional() });
const Swap = z.object({ playerA: z.uuid(), playerB: z.uuid() });
const TeeOrder = z.object({ groupId: z.uuid(), direction: z.enum(['up', 'down']) });
const Regroup = z.object({ matchA: z.uuid(), matchB: z.uuid() });
const Roster = z.object({ playerIds: z.array(z.uuid()).max(64) });
const Cover = z.object({ photoId: z.uuid().nullable() });
const Uuid = new ParseUUIDPipe();

@Controller()
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get('me/this-week')
  thisWeek(@CurrentUser() user: SessionUser) {
    return this.seasons.thisWeek(user);
  }

  @Get('leagues/:leagueId/seasons')
  @UseGuards(LeagueGuard)
  list(@Param('leagueId') leagueId: string) {
    return this.seasons.list(leagueId);
  }

  @Post('leagues/:leagueId/seasons')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  create(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(CreateSeason)) body: z.infer<typeof CreateSeason>,
  ) {
    return this.seasons.create(user, leagueId, body);
  }

  @Get('leagues/:leagueId/seasons/:seasonId')
  @UseGuards(LeagueGuard)
  get(@Param('leagueId') leagueId: string, @Param('seasonId', Uuid) seasonId: string) {
    return this.seasons.schedule(leagueId, seasonId);
  }

  @Post('leagues/:leagueId/seasons/:seasonId/generate')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  generate(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Body(new ZodPipe(Generate)) body: z.infer<typeof Generate>,
  ) {
    return this.seasons.generate(user, leagueId, seasonId, body.seed);
  }

  @Post('leagues/:leagueId/seasons/:seasonId/lock')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  lock(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
  ) {
    return this.seasons.setLocked(user, leagueId, seasonId, true);
  }

  @Post('leagues/:leagueId/seasons/:seasonId/unlock')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  unlock(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
  ) {
    return this.seasons.setLocked(user, leagueId, seasonId, false);
  }

  @Delete('leagues/:leagueId/seasons/:seasonId')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  @HttpCode(204)
  remove(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
  ) {
    return this.seasons.remove(user, leagueId, seasonId);
  }

  @Post('leagues/:leagueId/seasons/:seasonId/weeks/:weekId/skip')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  skip(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
  ) {
    return this.seasons.skip(user, leagueId, seasonId, weekId);
  }

  @Post('leagues/:leagueId/seasons/:seasonId/weeks/:weekId/swap')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  swap(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Body(new ZodPipe(Swap)) body: z.infer<typeof Swap>,
  ) {
    return this.seasons.swap(user, leagueId, seasonId, weekId, body.playerA, body.playerB);
  }

  /** Game day: move a foursome up or down the tee order (admins and players in the round). */
  @Post('leagues/:leagueId/seasons/:seasonId/weeks/:weekId/tee-order')
  @UseGuards(LeagueGuard)
  teeOrder(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Body(new ZodPipe(TeeOrder)) body: z.infer<typeof TeeOrder>,
  ) {
    return this.seasons.teeOrder(user, leagueId, seasonId, weekId, body.groupId, body.direction);
  }

  /** Game day: two matches trade foursomes (admins and players in the round). */
  @Post('leagues/:leagueId/seasons/:seasonId/weeks/:weekId/regroup')
  @UseGuards(LeagueGuard)
  regroup(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
    @Body(new ZodPipe(Regroup)) body: z.infer<typeof Regroup>,
  ) {
    return this.seasons.regroup(user, leagueId, seasonId, weekId, body.matchA, body.matchB);
  }

  @Post('leagues/:leagueId/seasons/:seasonId/weeks/:weekId/rainout')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  rainout(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('weekId', Uuid) weekId: string,
  ) {
    return this.seasons.rainout(user, leagueId, seasonId, weekId);
  }

  @Put('leagues/:leagueId/seasons/:seasonId/roster')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  setRoster(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Body(new ZodPipe(Roster)) body: z.infer<typeof Roster>,
  ) {
    return this.seasons.setRoster(user, leagueId, seasonId, body.playerIds);
  }

  @Put('leagues/:leagueId/seasons/:seasonId/cover')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  setCover(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Body(new ZodPipe(Cover)) body: z.infer<typeof Cover>,
  ) {
    return this.seasons.setCover(user, leagueId, seasonId, body.photoId);
  }
}
