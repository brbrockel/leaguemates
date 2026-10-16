import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { sessions, users } from '../db/schema.js';
import type { SessionUser } from './decorators.js';
import { hashToken, newToken } from './tokens.js';

export const SESSION_COOKIE = 'teemate_session';

type Executor = Pick<Database, 'insert'>;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  get ttlMs(): number {
    return this.config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  /** Creates a session; returns the cookie value (never stored) and the CSRF token. */
  async create(userId: string, userAgent: string | undefined, tx: Executor = this.db) {
    const token = newToken();
    const csrfToken = newToken();
    await tx.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      csrfToken,
      userAgent: userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + this.ttlMs),
    });
    return { token, csrfToken };
  }

  /** The signed-in user for a cookie value, or null if the session is missing, expired, revoked or disabled. */
  async resolve(token: string): Promise<SessionUser | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        nickname: users.nickname,
        phone: users.phone,
        address: users.address,
        isSiteAdmin: users.isSiteAdmin,
        sessionId: sessions.id,
        csrfToken: sessions.csrfToken,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          isNull(users.disabledAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
