import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  address: string | null;
  isSiteAdmin: boolean;
  sessionId: string;
  csrfToken: string;
}

export type AuthedRequest = Request & { user?: SessionUser };

export const IS_PUBLIC = 'teemate:public';
/** Route needs no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SITE_ADMIN = 'teemate:site-admin';
/** Route is limited to site admins. */
export const SiteAdminOnly = () => SetMetadata(SITE_ADMIN, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new Error('CurrentUser used on a public route');
    return user;
  },
);
