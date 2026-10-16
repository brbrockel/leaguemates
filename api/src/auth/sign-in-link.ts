import type { Database } from '../db/db.js';
import { magicLinkTokens } from '../db/schema.js';
import { hashToken, newToken } from './tokens.js';

export interface SignInLink {
  link: string;
  expiresAt: Date;
}

/**
 * Creates a single-use sign-in link. The token goes in the URL fragment, which
 * browsers never send to servers or in Referer headers; only its hash is stored.
 */
export async function issueSignInLink(
  db: Pick<Database, 'insert'>,
  appUrl: string,
  email: string,
  ttlMs: number,
): Promise<SignInLink> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(magicLinkTokens).values({ email, tokenHash: hashToken(token), expiresAt });
  return { link: `${appUrl}/sign-in/verify#token=${token}`, expiresAt };
}

/**
 * A single-use link to set (or reset) a password, for an admin to pass on. Opening it
 * shows a form; the token is only used up when the password is saved.
 */
export async function issuePasswordLink(
  db: Pick<Database, 'insert'>,
  appUrl: string,
  email: string,
  ttlMs: number,
): Promise<SignInLink> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db
    .insert(magicLinkTokens)
    .values({ email, tokenHash: hashToken(token), expiresAt, purpose: 'set_password' });
  return { link: `${appUrl}/set-password#token=${token}`, expiresAt };
}
