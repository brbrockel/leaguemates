import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { GUEST_OK, GUEST_USER, IS_PUBLIC, SITE_ADMIN, type AuthedRequest } from './decorators.js';
import { GUEST_COOKIE, SESSION_COOKIE, SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';

function flag(reflector: Reflector, key: string, ctx: ExecutionContext): boolean {
  return reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]) ?? false;
}

/**
 * Runs on every route (registered globally, in order):
 * 1. a valid session is required unless the route is @Public(); without one, a guest (the
 *    guest cookie) gets only @GuestOk() routes, and only to read;
 * 2. state-changing requests must echo the session's CSRF token in X-CSRF-Token;
 * 3. @SiteAdminOnly() routes need a site admin.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (flag(this.reflector, IS_PUBLIC, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user = typeof token === 'string' ? await this.sessions.resolve(token) : null;
    if (!user) {
      if (req.cookies?.[GUEST_COOKIE] !== '1')
        throw new UnauthorizedException('Sign in to continue.');
      req.user = { ...GUEST_USER };
      const ok = this.reflector.getAllAndOverride<'read' | 'post' | undefined>(GUEST_OK, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (!ok || (ok === 'read' && !SAFE_METHODS.has(req.method)))
        throw new ForbiddenException('Sign in to do that. Guests can only look.');
      return true;
    }
    req.user = user;

    if (!SAFE_METHODS.has(req.method)) {
      const sent = req.header(CSRF_HEADER) ?? '';
      const expected = user.csrfToken;
      const ok =
        sent.length === expected.length &&
        timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
      if (!ok) throw new ForbiddenException('Missing or invalid CSRF token.');
    }

    if (flag(this.reflector, SITE_ADMIN, ctx) && !user.isSiteAdmin) {
      throw new ForbiddenException('Site admins only.');
    }
    return true;
  }
}
