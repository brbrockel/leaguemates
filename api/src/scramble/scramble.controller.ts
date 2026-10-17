import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, GuestOk, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';
import { ScrambleService } from './scramble.service.js';

const Allowance = z.array(z.number().int().min(0).max(100)).min(1).max(8);
const Setup = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  layoutId: z.uuid(),
  teamSize: z.number().int().min(2).max(6),
  allowance: Allowance,
  playerIds: z.array(z.uuid()).min(2).max(64),
  seed: z.number().int().positive().optional(),
});
const Teams = z.object({ teams: z.array(z.array(z.uuid()).min(1).max(8)).min(1).max(32) });
const Regenerate = z.object({ seed: z.number().int().positive().optional() });
const Scores = z.object({
  holeScores: z.array(z.number().int().min(1).max(15).nullable()).min(9).max(18),
  version: z.number().int().min(0),
});
const Uuid = new ParseUUIDPipe();

/** The post-season team scramble: /leagues/:leagueId/seasons/:seasonId/scramble */
@Controller('leagues/:leagueId/seasons/:seasonId/scramble')
@UseGuards(LeagueGuard)
export class ScrambleController {
  constructor(private readonly svc: ScrambleService) {}

  @Get()
  @GuestOk()
  view(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
  ) {
    return this.svc.view(user, leagueId, seasonId);
  }

  @Post()
  @RequireLeagueRole('admin')
  create(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Body(new ZodPipe(Setup)) body: z.infer<typeof Setup>,
  ) {
    return this.svc.create(user, leagueId, seasonId, body);
  }

  @Put('teams')
  @RequireLeagueRole('admin')
  setTeams(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Body(new ZodPipe(Teams)) body: z.infer<typeof Teams>,
  ) {
    return this.svc.setTeams(user, leagueId, seasonId, body.teams);
  }

  @Post('regenerate')
  @RequireLeagueRole('admin')
  regenerate(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Body(new ZodPipe(Regenerate)) body: z.infer<typeof Regenerate>,
  ) {
    return this.svc.regenerate(user, leagueId, seasonId, body.seed);
  }

  @Put('teams/:teamId/scores')
  scores(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
    @Param('teamId', Uuid) teamId: string,
    @Body(new ZodPipe(Scores)) body: z.infer<typeof Scores>,
  ) {
    return this.svc.saveScores(user, leagueId, seasonId, teamId, body);
  }

  @Delete()
  @RequireLeagueRole('admin')
  remove(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('seasonId', Uuid) seasonId: string,
  ) {
    return this.svc.remove(user, leagueId, seasonId);
  }
}

@Module({
  controllers: [ScrambleController],
  providers: [ScrambleService, LeagueGuard],
})
export class ScrambleModule {}
