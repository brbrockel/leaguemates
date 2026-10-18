import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  address: string | null;
  /** Wants notices by email (rainouts, skips, ones an admin emails). */
  noticeEmails: boolean;
  isSiteAdmin: boolean;
  sessionId: string;
  csrfToken: string;
  /** Looking around without an account: read-only, public leagues only, no personal details. */
  isGuest?: boolean;
}

/** The stand-in user for a guest: an id that matches nobody, so nothing is "theirs". */
export const GUEST_USER: SessionUser = {
  id: '00000000-0000-0000-0000-000000000000',
  email: '',
  name: null,
  nickname: 'Guest',
  phone: null,
  address: null,
  noticeEmails: false,
  isSiteAdmin: false,
  sessionId: '',
  csrfToken: '',
  isGuest: true,
};

export type AuthedRequest = Request & { user?: SessionUser };

export const IS_PUBLIC = 'teemate:public';
/** Route needs no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SITE_ADMIN = 'teemate:site-admin';
/** Route is limited to site admins. */
export const SiteAdminOnly = () => SetMetadata(SITE_ADMIN, true);

export const GUEST_OK = 'teemate:guest-ok';
/**
 * Guests may use this route. Everything else is closed to them, so a new route never shows
 * guests anything by accident. Routes marked here must leave out personal details for guests.
 * Guests only read; `{ post: true }` is for signing out, the one thing a guest can do.
 */
export const GuestOk = (opts: { post?: boolean } = {}) =>
  SetMetadata(GUEST_OK, opts.post ? 'post' : 'read');

/** A player as guests may see them: nickname and golf, no full name or account link. */
export function forGuest<T extends { fullName?: string | null; userId?: string | null }>(
  user: SessionUser,
  p: T,
): T {
  return user.isGuest ? { ...p, fullName: null, userId: null } : p;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new Error('CurrentUser used on a public route');
    return user;
  },
);
