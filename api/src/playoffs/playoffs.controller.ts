import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';
import { PlayoffsService } from './playoffs.service.js';

const Uuid = new ParseUUIDPipe();
const Decide = z.object({ winnerId: z.uuid(), reason: z.string().trim().min(3).max(300) });

@Controller('leagues/:leagueId/seasons/:seasonId/playoffs')
@UseGuards(LeagueGuard)
export class PlayoffsController {
  constructor(private readonly playoffs: PlayoffsService) {}

  @Get()
  bracket(@Param('leagueId') leagueId: string, @Param('seasonId', Uuid) seasonId: string) {
    return this.playoffs.bracket(leagueId, seasonId);
  }

  @Post('start')
  @RequireLeagueRole('admin')
  start(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
  ) {
    return this.playoffs.start(user, leagueId, seasonId);
  }

  @Post('advance')
  @RequireLeagueRole('admin')
  advance(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
  ) {
    return this.playoffs.advance(user, leagueId, seasonId);
  }

  @Post('matches/:matchId/decide')
  @RequireLeagueRole('admin')
  decide(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('matchId', Uuid) matchId: string,
    @Body(new ZodPipe(Decide)) body: z.infer<typeof Decide>,
  ) {
    return this.playoffs.decide(user, leagueId, seasonId, matchId, body.winnerId, body.reason);
  }
}
