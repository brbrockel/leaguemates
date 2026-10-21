import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, count, eq, gt, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import {
  authAttempts,
  invites,
  leagueMemberships,
  magicLinkTokens,
  players,
  sessions,
  users,
} from '../db/schema.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { SiteSettingsService } from '../site/site-settings.js';
import { SessionService } from './session.service.js';
import { issueSignInLink } from './sign-in-link.js';
import type { SessionUser } from './decorators.js';
import { assertGoodPassword, hashPassword, verifyPassword } from './password.js';
import { hashToken, normalizeEmail } from './tokens.js';
import {
  decryptSecret,
  encryptSecret,
  hashRecovery,
  matchTotp,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUrl,
} from './totp.js';

const WINDOW_MS = 15 * 60 * 1000;

/** An account cooling down after too many wrong passwords. */
export class LockedException extends HttpException {
  constructor(until: Date) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    super(
      `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an admin to unlock your account.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export class TooManyRequestsException extends HttpException {
  constructor() {
    super('Too many sign-in attempts. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly site: SiteSettingsService,
  ) {}

  /**
   * Emails a sign-in link if the address belongs to a user or has an open invite.
   * The caller gets the same response either way, so it can't be used to find out
   * who is in a league. The email is sent in the background for the same reason.
   */
  async requestMagicLink(rawEmail: string, ip: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    await this.checkIpLimit('magic_link', ip, this.config.MAGIC_LINK_LIMIT_PER_IP, email);

    const since = new Date(Date.now() - WINDOW_MS);
    const [{ recent } = { recent: 0 }] = await this.db
      .select({ recent: count() })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.kind, 'magic_link'),
          eq(authAttempts.email, email),
          gt(authAttempts.createdAt, since),
        ),
      );
    if (recent > this.config.MAGIC_LINK_LIMIT_PER_EMAIL) return; // quietly drop; don't reveal anything

    if (!(await this.canSignIn(email))) return;

    const { link } = await issueSignInLink(
      this.db,
      this.config.APP_URL,
      email,
      this.config.MAGIC_LINK_TTL_MINUTES * 60 * 1000,
    );
    this.mailer
      .send({
        to: email,
        subject: 'Your LeagueMates sign-in link',
        text: [
          'Use this link to sign in to LeagueMates:',
          '',
          link,
          '',
          `It works once and expires in ${this.config.MAGIC_LINK_TTL_MINUTES} minutes.`,
          "If you didn't ask for it, you can ignore this email.",
        ].join('\n'),
      })
      .catch((err: unknown) => this.log.error(`Sign-in email to ${email} failed: ${String(err)}`));
  }

  /**
   * Uses a sign-in token (once) and starts a session. A first sign-in from an
   * invite creates the user and their league memberships.
   */
  async verifyMagicLink(token: string, ip: string, userAgent: string | undefined) {
    await this.checkIpLimit('verify', ip, this.config.MAGIC_LINK_LIMIT_PER_IP * 2);

    return this.db.transaction(async (tx) => {
      const [used] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, hashToken(token)),
            eq(magicLinkTokens.purpose, 'sign_in'),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, new Date()),
          ),
        )
        .returning({ email: magicLinkTokens.email });
      if (!used) {
        const [known] = await tx
          .select({ usedAt: magicLinkTokens.usedAt })
          .from(magicLinkTokens)
          .where(eq(magicLinkTokens.tokenHash, hashToken(token)))
          .limit(1);
        throw new UnauthorizedException(
          known?.usedAt
            ? 'This link was already used to sign in. Each link works once. If you are not signed in here, it was probably opened in a different browser or app. Ask for a new link, or use testing mode.'
            : known
              ? 'This sign-in link has expired. Ask for a new one.'
              : 'This sign-in link is not valid. Check that the whole link was copied.',
        );
      }

      const user = await this.acceptInvites(tx, used.email);
      await tx.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.record(
        {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          after: { method: 'email link', ip },
        },
        tx,
      );
      const session = await this.sessions.create(user.id, userAgent, tx);
      return { user, ...session };
    });
  }

  /**
   * The user for an email from a valid link, created on first use from an open invite,
   * with any open invites accepted (league memberships and player links).
   */
  private async acceptInvites(tx: Tx, email: string) {
    let [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    const openInvites = await tx
      .select()
      .from(invites)
      .where(and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)));

    if (!user) {
      if (openInvites.length === 0)
        throw new UnauthorizedException('This link is invalid or has expired.');
      [user] = await tx.insert(users).values({ email }).returning();
    }
    if (!user || user.disabledAt) throw new UnauthorizedException('This account is disabled.');

    for (const invite of openInvites) {
      await tx
        .insert(leagueMemberships)
        .values({ leagueId: invite.leagueId, userId: user.id, role: invite.role })
        .onConflictDoUpdate({
          target: [leagueMemberships.leagueId, leagueMemberships.userId],
          set: { role: invite.role },
        });
      if (invite.playerId) {
        await tx.update(players).set({ userId: user.id }).where(eq(players.id, invite.playerId));
      }
      await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
      await this.audit.record(
        {
          leagueId: invite.leagueId,
          actorUserId: user.id,
          action: 'invite.accept',
          entityType: 'invite',
          entityId: invite.id,
        },
        tx,
      );
    }
    return user;
  }

  // ---- Passwords ----

  /**
   * Email + password (+ authenticator code when the account has one). Wrong passwords count
   * toward a cooldown: after LOGIN_MAX_FAILURES, the account is locked for LOGIN_LOCK_MINUTES,
   * doubling with each lockout in a row (up to a day). The message never says whether the
   * email has an account.
   */
  async login(
    input: { email: string; password: string; code?: string | undefined },
    ip: string,
    userAgent: string | undefined,
  ) {
    const email = normalizeEmail(input.email);
    await this.checkIpLimit('login', ip, this.config.LOGIN_LIMIT_PER_IP, email);
    const wrong = new UnauthorizedException('Email or password is incorrect.');

    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !user.passwordHash || user.disabledAt) {
      await verifyPassword(null, input.password);
      throw wrong;
    }
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw new LockedException(user.lockedUntil);
    // Each try uses up one of the allowed attempts before the (slow) password check, so a
    // burst of parallel guesses can't get past the limit.
    const attempt = await this.reserveAttempt(user.id);
    if (attempt === null) throw new TooManyRequestsException();
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.failedLogin(user, attempt, ip);
      throw wrong;
    }

    let totpStep: number | null = null;
    let recovery = user.totpRecovery;
    if (user.totpEnabledAt && user.totpSecret) {
      if (!input.code) {
        // The right password without a code yet isn't a wrong try.
        await this.db
          .update(users)
          .set({ failedLogins: sql`greatest(${users.failedLogins} - 1, 0)` })
          .where(eq(users.id, user.id));
        return { needsCode: true as const };
      }
      totpStep = matchTotp(this.decrypt(user.totpSecret), input.code, user.totpLastStep);
      if (totpStep === null) {
        const h = hashRecovery(input.code);
        if (!recovery?.includes(h)) {
          await this.failedLogin(user, attempt, ip);
          throw new UnauthorizedException('That code is not right.');
        }
        recovery = recovery.filter((x) => x !== h);
      }
    }

    return this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          failedLogins: 0,
          lockouts: 0,
          lockedUntil: null,
          lastSignInAt: new Date(),
          ...(totpStep !== null ? { totpLastStep: totpStep } : {}),
          ...(recovery !== user.totpRecovery ? { totpRecovery: recovery } : {}),
        })
        .where(eq(users.id, user.id));
      await this.audit.record(
        {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          after: { method: user.totpEnabledAt ? 'password + authenticator' : 'password', ip },
        },
        tx,
      );
      if (recovery !== user.totpRecovery)
        await this.audit.record(
          {
            actorUserId: user.id,
            action: 'auth.recovery_code',
            entityType: 'user',
            entityId: user.id,
            after: { left: recovery?.length ?? 0 },
          },
          tx,
        );
      const session = await this.sessions.create(user.id, userAgent, tx);
      return { user, ...session };
    });
  }

  /**
   * Takes one attempt for the account: the attempt's number, or null if none are left (the
   * account is cooling down, or other tries in flight have used them up).
   */
  private async reserveAttempt(userId: string): Promise<number | null> {
    const [row] = await this.db
      .update(users)
      .set({ failedLogins: sql`${users.failedLogins} + 1` })
      .where(
        and(
          eq(users.id, userId),
          lt(users.failedLogins, this.config.LOGIN_MAX_FAILURES),
          or(isNull(users.lockedUntil), lte(users.lockedUntil, new Date())),
        ),
      )
      .returning({ failedLogins: users.failedLogins });
    return row?.failedLogins ?? null;
  }

  /** A wrong password or code on `attempt`: the last allowed one starts a cooldown. */
  private async failedLogin(user: typeof users.$inferSelect, attempt: number, ip: string) {
    if (attempt < this.config.LOGIN_MAX_FAILURES) return;
    const minutes = Math.min(this.config.LOGIN_LOCK_MINUTES * 2 ** user.lockouts, 24 * 60);
    const until = new Date(Date.now() + minutes * 60_000);
    await this.db
      .update(users)
      .set({ failedLogins: 0, lockouts: user.lockouts + 1, lockedUntil: until })
      .where(eq(users.id, user.id));
    await this.audit.record({
      actorUserId: null,
      action: 'auth.lockout',
      entityType: 'user',
      entityId: user.id,
      after: { email: user.email, minutes, until: until.toISOString(), ip },
    });
  }

  /** What a password link is for, without using it up (the form shows the email). */
  async checkPasswordLink(token: string) {
    const [link] = await this.db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.tokenHash, hashToken(token)),
          eq(magicLinkTokens.purpose, 'set_password'),
        ),
      )
      .limit(1);
    if (!link)
      throw new UnauthorizedException(
        'This link is not valid. Check that the whole link was copied.',
      );
    if (link.usedAt)
      throw new UnauthorizedException('This link was already used. Ask an admin for a new one.');
    if (link.expiresAt <= new Date())
      throw new UnauthorizedException('This link has expired. Ask an admin for a new one.');
    const [user] = await this.db
      .select({ name: users.name, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, link.email))
      .limit(1);
    return {
      email: link.email,
      name: user?.name ?? null,
      hasPassword: Boolean(user?.passwordHash),
    };
  }

  /**
   * Sets the password from an admin's link (first time or reset), signs out the account's
   * other sessions, clears any lockout, and signs in here. An account with authenticator codes
   * isn't signed in: it answers { needsCode: true } and the person signs in with the new
   * password and a code, so a link alone never gets past the authenticator.
   */
  async setPasswordWithLink(
    token: string,
    password: string,
    ip: string,
    userAgent: string | undefined,
  ) {
    await this.checkIpLimit('verify', ip, this.config.MAGIC_LINK_LIMIT_PER_IP * 2);
    const { email } = await this.checkPasswordLink(token);
    assertGoodPassword(password, email);
    const passwordHash = await hashPassword(password);

    return this.db.transaction(async (tx) => {
      const [used] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, hashToken(token)),
            eq(magicLinkTokens.purpose, 'set_password'),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, new Date()),
          ),
        )
        .returning({ email: magicLinkTokens.email });
      if (!used)
        throw new UnauthorizedException('This link was already used. Ask an admin for a new one.');
      const user = await this.acceptInvites(tx, used.email);
      await tx
        .update(users)
        .set({
          passwordHash,
          passwordSetAt: new Date(),
          failedLogins: 0,
          lockouts: 0,
          lockedUntil: null,
          ...(user.totpEnabledAt ? {} : { lastSignInAt: new Date() }),
        })
        .where(eq(users.id, user.id));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      await this.audit.record(
        {
          actorUserId: user.id,
          action: 'auth.password_set',
          entityType: 'user',
          entityId: user.id,
        },
        tx,
      );
      if (user.totpEnabledAt) return { needsCode: true as const };
      const session = await this.sessions.create(user.id, userAgent, tx);
      return { user, ...session };
    });
  }

  /** Changes your own password; your other sessions are signed out. */
  async changePassword(user: SessionUser, current: string, next: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (row!.passwordHash && !(await verifyPassword(row!.passwordHash, current)))
      throw new UnauthorizedException('Your current password is not right.');
    assertGoodPassword(next, row!.email);
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(next), passwordSetAt: new Date() })
      .where(eq(users.id, user.id));
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          ne(sessions.id, user.sessionId),
        ),
      );
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_change',
      entityType: 'user',
      entityId: user.id,
    });
    return { ok: true };
  }

  // ---- Authenticator app (optional) ----

  private get appSecret(): string {
    if (!this.config.APP_SECRET)
      throw new BadRequestException('Authenticator codes are not set up on this server yet.');
    return this.config.APP_SECRET;
  }
  private decrypt(stored: string) {
    return decryptSecret(stored, this.appSecret);
  }

  async security(user: SessionUser) {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    return {
      hasPassword: Boolean(row!.passwordHash),
      passwordSetAt: row!.passwordSetAt,
      totpEnabled: Boolean(row!.totpEnabledAt),
      recoveryCodesLeft: row!.totpEnabledAt ? (row!.totpRecovery?.length ?? 0) : null,
      totpAvailable: Boolean(this.config.APP_SECRET),
    };
  }

  /** Starts setup: a new secret for the app to scan. It only takes effect once a code is confirmed. */
  async totpStart(user: SessionUser) {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (row!.totpEnabledAt) throw new BadRequestException('Authenticator codes are already on.');
    const secret = newTotpSecret();
    await this.db
      .update(users)
      .set({ totpSecret: encryptSecret(secret, this.appSecret), totpLastStep: null })
      .where(eq(users.id, user.id));
    return { secret, url: otpauthUrl(secret, row!.email) };
  }

  /** Confirms setup with a code from the app; returns one-time recovery codes (shown once). */
  async totpEnable(user: SessionUser, code: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (row!.totpEnabledAt || !row!.totpSecret)
      throw new BadRequestException('Start authenticator setup first.');
    const step = matchTotp(this.decrypt(row!.totpSecret), code, null);
    if (step === null)
      throw new BadRequestException(
        'That code is not right. Check the time on your phone and try the next one.',
      );
    const codes = newRecoveryCodes();
    await this.db
      .update(users)
      .set({ totpEnabledAt: new Date(), totpLastStep: step, totpRecovery: codes.map(hashRecovery) })
      .where(eq(users.id, user.id));
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.totp_on',
      entityType: 'user',
      entityId: user.id,
    });
    return { recoveryCodes: codes };
  }

  /** Turns authenticator codes off (needs your password). */
  async totpDisable(user: SessionUser, password: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!(await verifyPassword(row!.passwordHash, password)))
      throw new UnauthorizedException('Your password is not right.');
    await this.db
      .update(users)
      .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: null })
      .where(eq(users.id, user.id));
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.totp_off',
      entityType: 'user',
      entityId: user.id,
    });
    return { ok: true };
  }

  /**
   * Testing mode: with the shared access code, signs in as any email, creating
   * the account (as a user in the testing league) if it doesn't exist. Never
   * creates admins, and never signs in as one (site or league) or as an account with
   * authenticator codes: those sign in with their password. Only works while a site
   * admin has testing mode switched on.
   */
  async testLogin(
    input: { email: string; code: string; name?: string | undefined },
    ip: string,
    userAgent: string | undefined,
  ) {
    if (!(await this.site.testLoginActive())) throw new NotFoundException();
    await this.checkIpLimit('test_login', ip, this.config.MAGIC_LINK_LIMIT_PER_IP, input.email);
    if (!(await this.site.checkTestCode(input.code))) {
      throw new UnauthorizedException('That test access code is not right.');
    }
    const leagueId = await this.site.testLoginLeagueId();
    const email = normalizeEmail(input.email);

    return this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      if (user?.disabledAt) throw new ForbiddenException('This account is disabled.');
      if (user) {
        const [adminOf] = await tx
          .select({ leagueId: leagueMemberships.leagueId })
          .from(leagueMemberships)
          .where(and(eq(leagueMemberships.userId, user.id), eq(leagueMemberships.role, 'admin')))
          .limit(1);
        if (user.isSiteAdmin || adminOf || user.totpEnabledAt)
          throw new ForbiddenException(
            "Test sign-in isn't for admins or accounts with authenticator codes. Sign in with your password.",
          );
      }
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({ email, name: input.name?.trim() || null })
          .returning();
        await this.audit.record(
          {
            actorUserId: user!.id,
            action: 'user.create',
            entityType: 'user',
            entityId: user!.id,
            after: { email, via: 'test_login' },
          },
          tx,
        );
        if (leagueId) {
          await tx
            .insert(leagueMemberships)
            .values({ leagueId, userId: user!.id, role: 'user' })
            .onConflictDoNothing();
          await this.audit.record(
            {
              leagueId,
              actorUserId: user!.id,
              action: 'member.add',
              entityType: 'user',
              entityId: user!.id,
              after: { role: 'user', via: 'test_login' },
            },
            tx,
          );
        }
      }
      await tx.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user!.id));
      await this.audit.record(
        {
          actorUserId: user!.id,
          action: 'auth.test_login',
          entityType: 'user',
          entityId: user!.id,
          after: { ip },
        },
        tx,
      );
      const session = await this.sessions.create(user!.id, userAgent, tx);
      return { user: user!, ...session };
    });
  }

  private async canSignIn(email: string): Promise<boolean> {
    const [user] = await this.db
      .select({ disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (user) return !user.disabledAt;
    const [invite] = await this.db
      .select({ id: invites.id })
      .from(invites)
      .where(and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .limit(1);
    return Boolean(invite);
  }

  /**
   * Records this attempt, then refuses it if it's over the per-IP limit. Recording first means
   * a burst of parallel requests can't all pass a count taken before any of them landed.
   */
  private async checkIpLimit(
    kind: 'magic_link' | 'verify' | 'test_login' | 'login',
    ip: string,
    limit: number,
    email?: string,
  ) {
    await this.db.insert(authAttempts).values({ kind, ip, ...(email ? { email } : {}) });
    const since = new Date(Date.now() - WINDOW_MS);
    const [{ recent } = { recent: 0 }] = await this.db
      .select({ recent: count() })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.kind, kind),
          eq(authAttempts.ip, ip),
          gt(authAttempts.createdAt, since),
        ),
      );
    if (recent > limit) throw new TooManyRequestsException();
  }
}
