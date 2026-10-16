import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import type { AuthedRequest } from '../auth/decorators.js';
import {
  MembershipService,
  type LeagueAccess,
  type LeagueRole,
} from '../auth/membership.service.js';

const LEAGUE_ROLE = 'teemate:league-role';
/** Route requires this role in the :leagueId league (default: any member). */
export const RequireLeagueRole = (role: LeagueRole) => SetMetadata(LEAGUE_ROLE, role);

export type LeagueRequest = AuthedRequest & { leagueRole?: LeagueAccess };

const Uuid = z.uuid();

/**
 * Guards routes under /leagues/:leagueId. Anyone who can't see the league gets a 404, so
 * the existence of private leagues isn't revealed. Non-members of a public league may
 * only read (GET); every change needs membership.
 */
@Injectable()
export class LeagueGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<LeagueRequest>();
    const leagueId = req.params.leagueId;
    if (!req.user || typeof leagueId !== 'string' || !Uuid.safeParse(leagueId).success) {
      throw new NotFoundException();
    }
    const role = await this.memberships.roleIn(req.user, leagueId);
    if (!role) throw new NotFoundException();
    if (role === 'viewer' && !['GET', 'HEAD'].includes(req.method)) {
      throw new ForbiddenException('Only members of this league can do that.');
    }

    const needed = this.reflector.getAllAndOverride<LeagueRole | undefined>(LEAGUE_ROLE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (needed === 'admin' && role !== 'admin') {
      throw new ForbiddenException('Admins only.');
    }
    req.leagueRole = role;
    return true;
  }
}
