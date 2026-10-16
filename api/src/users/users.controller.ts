import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { EmailInput } from '../common/email.js';
import { AddressInput, PhoneInput } from '../common/phone.js';
import { ZodPipe } from '../common/validation.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';
import { UsersService } from './users.service.js';

const Role = z.enum(['admin', 'user']);
const CreatePerson = z.object({
  email: EmailInput,
  name: z.string().trim().max(80).optional(),
  nickname: z.string().trim().max(30).optional(),
  leagueId: z.uuid().optional(),
  role: Role.optional(),
  playerId: z.uuid().optional(),
  newPlayer: z.object({ nickname: z.string().trim().max(30).optional() }).optional(),
});
const UpdatePerson = z
  .object({
    name: z.string().trim().max(80).nullable().optional(),
    /** Empty clears it (their first name is used instead). */
    nickname: z.string().trim().max(30).nullable().optional(),
    phone: PhoneInput.optional(),
    address: AddressInput.optional(),
    disabled: z.boolean().optional(),
    isSiteAdmin: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });
const SetRole = z.object({ role: Role });
const UpdateSelf = z
  .object({
    name: z.string().trim().max(80).nullable().optional(),
    /** Empty clears it (their first name is used instead). */
    nickname: z.string().trim().max(30).nullable().optional(),
    phone: PhoneInput.optional(),
    address: AddressInput.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  list(@CurrentUser() actor: SessionUser) {
    return this.users.list(actor);
  }

  @Get('users/directory')
  directory(@CurrentUser() actor: SessionUser) {
    return this.users.directory(actor);
  }

  @Post('users')
  create(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodPipe(CreatePerson)) body: z.infer<typeof CreatePerson>,
  ) {
    return this.users.create(actor, body);
  }

  @Patch('me')
  updateSelf(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodPipe(UpdateSelf)) body: z.infer<typeof UpdateSelf>,
  ) {
    return this.users.updateSelf(actor, body);
  }

  @Patch('users/:userId')
  update(
    @CurrentUser() actor: SessionUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(UpdatePerson)) body: z.infer<typeof UpdatePerson>,
  ) {
    return this.users.update(actor, userId, body);
  }

  @Post('users/:userId/password-link')
  passwordLink(
    @CurrentUser() actor: SessionUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.users.passwordLink(actor, userId);
  }

  /** Site admins: emails the person a password link instead of handing it over. */
  @Post('users/:userId/password-link/email')
  emailPasswordLink(
    @CurrentUser() actor: SessionUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.users.emailPasswordLink(actor, userId);
  }

  @Post('users/:userId/unlock')
  @HttpCode(204)
  unlock(@CurrentUser() actor: SessionUser, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.users.unlock(actor, userId);
  }

  @Post('users/:userId/reset-authenticator')
  @HttpCode(204)
  resetTotp(
    @CurrentUser() actor: SessionUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.users.resetTotp(actor, userId);
  }

  @Post('users/:userId/sign-out-everywhere')
  @HttpCode(204)
  signOutEverywhere(
    @CurrentUser() actor: SessionUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.users.signOutEverywhere(actor, userId);
  }

  @Put('leagues/:leagueId/members/:userId')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  @HttpCode(204)
  setRole(
    @CurrentUser() actor: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(SetRole)) body: z.infer<typeof SetRole>,
  ) {
    return this.users.setRole(actor, leagueId, userId, body.role);
  }

  @Delete('leagues/:leagueId/members/:userId')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  @HttpCode(204)
  remove(
    @CurrentUser() actor: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.users.removeFromLeague(actor, leagueId, userId);
  }
}
