import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CurrentUser,
  forGuest,
  GuestOk,
  SiteAdminOnly,
  type SessionUser,
} from '../auth/decorators.js';
import { MembershipService } from '../auth/membership.service.js';
import { EmailInput } from '../common/email.js';
import { ZodPipe } from '../common/validation.js';
import { LeagueGuard, RequireLeagueRole, type LeagueRequest } from './league.guard.js';
import { LeaguesService } from './leagues.service.js';
import { UpdateLeague } from './settings.js';

const CreateLeague = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60)
    .optional(),
});
const Nickname = z.string().trim().min(1).max(30);
const FullName = z.string().trim().max(80);
const AddPlayer = z
  .object({ nickname: Nickname.optional(), fullName: FullName.optional() })
  .refine((b) => b.nickname || b.fullName, { message: 'Enter a nickname or a full name.' });
const UpdatePlayer = z
  .object({
    nickname: Nickname.optional(),
    fullName: FullName.optional(),
    /** false = a past player: kept for history, not offered for new rosters. */
    active: z.boolean().optional(),
    handicap: z.number().int().min(0).max(54).nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Nothing to update.',
  });
const CreateInvite = z.object({
  email: EmailInput,
  role: z.enum(['admin', 'user']).default('user'),
  playerId: z.uuid().optional(),
});

@Controller('leagues')
export class LeaguesController {
  constructor(
    private readonly leagues: LeaguesService,
    private readonly memberships: MembershipService,
  ) {}

  @Get()
  @GuestOk()
  mine(@CurrentUser() user: SessionUser) {
    return this.memberships.leaguesFor(user);
  }

  @Post()
  @SiteAdminOnly()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(CreateLeague)) body: z.infer<typeof CreateLeague>,
  ) {
    return this.leagues.create(user, body.name, body.slug);
  }

  @Get(':leagueId')
  @GuestOk()
  @UseGuards(LeagueGuard)
  async get(@Param('leagueId') leagueId: string, @Req() req: LeagueRequest) {
    return { ...(await this.leagues.get(leagueId)), role: req.leagueRole };
  }

  @Patch(':leagueId')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  update(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(UpdateLeague)) body: z.infer<typeof UpdateLeague>,
  ) {
    return this.leagues.update(user, leagueId, body);
  }

  @Get(':leagueId/members')
  @GuestOk()
  @UseGuards(LeagueGuard)
  async members(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Req() req: LeagueRequest,
  ) {
    const r = await this.leagues.members(leagueId, req.leagueRole === 'viewer');
    // Guests see the players by nickname, and no accounts at all.
    return user.isGuest ? { members: [], players: r.players.map((p) => forGuest(user, p)) } : r;
  }

  @Post(':leagueId/players')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  addPlayer(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(AddPlayer)) body: z.infer<typeof AddPlayer>,
  ) {
    return this.leagues.addPlayer(user, leagueId, body);
  }

  @Patch(':leagueId/players/:playerId')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  updatePlayer(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('playerId', new ParseUUIDPipe()) playerId: string,
    @Body(new ZodPipe(UpdatePlayer)) body: z.infer<typeof UpdatePlayer>,
  ) {
    return this.leagues.updatePlayer(user, leagueId, playerId, body);
  }

  @Get(':leagueId/invites')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  invites(@Param('leagueId') leagueId: string) {
    return this.leagues.openInvites(leagueId);
  }

  @Post(':leagueId/invites')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  invite(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(CreateInvite)) body: z.infer<typeof CreateInvite>,
  ) {
    return this.leagues.invite(user, leagueId, body);
  }

  @Delete(':leagueId/invites/:inviteId')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  @HttpCode(204)
  revokeInvite(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ) {
    return this.leagues.revokeInvite(user, leagueId, inviteId);
  }
}
