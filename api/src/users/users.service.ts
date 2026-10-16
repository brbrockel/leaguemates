import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.js';
import type { SessionUser } from '../auth/decorators.js';
import type { LeagueRole } from '../auth/membership.service.js';
import { SessionService } from '../auth/session.service.js';
import { issuePasswordLink } from '../auth/sign-in-link.js';
import { normalizeEmail } from '../auth/tokens.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { leagueMemberships, leagues, players, users } from '../db/schema.js';
import { MAILER, MailSettingsService, maskEmail, type Mailer } from '../mail/mailer.js';

type User = typeof users.$inferSelect;
type Membership = { leagueId: string; userId: string; role: LeagueRole };

export interface PersonInput {
  email: string;
  name?: string | undefined;
  /** What they go by (optional; their first name is used without one). */
  nickname?: string | undefined;
  /** Add them to this league too (optional: people can exist without a league). */
  leagueId?: string | undefined;
  role?: LeagueRole | undefined;
  /** Link them to this existing player in the league. */
  playerId?: string | undefined;
  /** Or make them a new player in the league, with this nickname (default: theirs). */
  newPlayer?: { nickname?: string | undefined } | undefined;
}

/**
 * People management. Site admins manage everyone. A league admin manages the
 * people in leagues they administer, but never a site admin or another admin
 * (so nobody can take over an account with more access than their own).
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly mail: MailSettingsService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Leagues where the actor is an admin (every league for a site admin). */
  private async adminLeagueIds(actor: SessionUser): Promise<string[]> {
    if (actor.isSiteAdmin)
      return (await this.db.select({ id: leagues.id }).from(leagues)).map((l) => l.id);
    const rows = await this.db
      .select({ id: leagueMemberships.leagueId })
      .from(leagueMemberships)
      .where(and(eq(leagueMemberships.userId, actor.id), eq(leagueMemberships.role, 'admin')));
    return rows.map((r) => r.id);
  }

  private async membershipsOf(userId: string): Promise<Membership[]> {
    return this.db
      .select({
        leagueId: leagueMemberships.leagueId,
        userId: leagueMemberships.userId,
        role: leagueMemberships.role,
      })
      .from(leagueMemberships)
      .where(eq(leagueMemberships.userId, userId));
  }

  private async getUser(userId: string): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException();
    return user;
  }

  /**
   * Throws unless the actor may manage the target; returns the target. Unknown or out-of-scope
   * users are 404. Account-wide actions (password links, details, sign-outs) need `account`:
   * a league admin then manages only people whose every league is one they run, so adding
   * someone to your league never hands you their account elsewhere.
   */
  private async manageable(
    actor: SessionUser,
    userId: string,
    { account = true }: { account?: boolean } = {},
  ): Promise<User> {
    const target = await this.getUser(userId);
    if (actor.isSiteAdmin) return target;
    const adminOf = new Set(await this.adminLeagueIds(actor));
    const memberships = await this.membershipsOf(userId);
    if (!memberships.some((m) => adminOf.has(m.leagueId))) throw new NotFoundException();
    if (target.isSiteAdmin || memberships.some((m) => m.role === 'admin')) {
      throw new ForbiddenException('Only a site admin can manage admins.');
    }
    if (account && memberships.some((m) => !adminOf.has(m.leagueId))) {
      throw new ForbiddenException(
        "This person is also in a league you don't run. Ask a site admin.",
      );
    }
    return target;
  }

  private async requireLeagueAdmin(actor: SessionUser, leagueId: string): Promise<void> {
    if (!(await this.adminLeagueIds(actor)).includes(leagueId)) {
      throw new ForbiddenException('Only admins of this league can do that.');
    }
  }

  async list(actor: SessionUser) {
    const adminOf = await this.adminLeagueIds(actor);
    if (!actor.isSiteAdmin && adminOf.length === 0) throw new ForbiddenException('Admins only.');

    const memberRows = adminOf.length
      ? await this.db
          .select({
            userId: leagueMemberships.userId,
            leagueId: leagueMemberships.leagueId,
            leagueName: leagues.name,
            role: leagueMemberships.role,
          })
          .from(leagueMemberships)
          .innerJoin(leagues, eq(leagues.id, leagueMemberships.leagueId))
          .where(inArray(leagueMemberships.leagueId, adminOf))
          .orderBy(asc(leagues.name))
      : [];
    const spotRows = adminOf.length
      ? await this.db
          .select({
            userId: players.userId,
            leagueId: players.leagueId,
            playerId: players.id,
            nickname: players.nickname,
          })
          .from(players)
          .where(inArray(players.leagueId, adminOf))
      : [];

    const visibleIds = new Set(memberRows.map((m) => m.userId));
    const people = actor.isSiteAdmin
      ? await this.db.select().from(users).orderBy(asc(users.email))
      : visibleIds.size
        ? await this.db
            .select()
            .from(users)
            .where(inArray(users.id, [...visibleIds]))
            .orderBy(asc(users.email))
        : [];

    return people.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      nickname: u.nickname,
      phone: u.phone,
      address: u.address,
      isSiteAdmin: u.isSiteAdmin,
      disabled: Boolean(u.disabledAt),
      lastSignInAt: u.lastSignInAt,
      hasPassword: Boolean(u.passwordHash),
      lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null,
      totpEnabled: Boolean(u.totpEnabledAt),
      createdAt: u.createdAt,
      isSelf: u.id === actor.id,
      leagues: memberRows
        .filter((m) => m.userId === u.id)
        .map((m) => {
          const spot = spotRows.find((p) => p.userId === u.id && p.leagueId === m.leagueId);
          return {
            leagueId: m.leagueId,
            leagueName: m.leagueName,
            role: m.role,
            player: spot ? { id: spot.playerId, nickname: spot.nickname } : null,
          };
        }),
    }));
  }

  /**
   * Adds a person. Creating an account is for site admins; a league admin can add someone
   * who already has an account to their league. Optionally they also play in the league,
   * linked to an existing player or as a new one. No email is sent.
   */
  async create(actor: SessionUser, input: PersonInput) {
    const email = normalizeEmail(input.email);
    if (input.leagueId) await this.requireLeagueAdmin(actor, input.leagueId);
    else if (!actor.isSiteAdmin)
      throw new ForbiddenException('Only site admins can add people outside a league.');

    return this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        if (!actor.isSiteAdmin)
          throw new ForbiddenException(
            `${email} doesn't have an account yet. A site admin adds new people; then you can add them here.`,
          );
        [user] = await tx
          .insert(users)
          .values({
            email,
            name: input.name?.trim() || null,
            ...(input.nickname?.trim() ? { nickname: input.nickname.trim() } : {}),
          })
          .returning();
        await this.audit.record(
          {
            actorUserId: actor.id,
            action: 'user.create',
            entityType: 'user',
            entityId: user!.id,
            after: { email },
          },
          tx,
        );
      } else if (!input.leagueId) {
        throw new ConflictException(`${email} already has an account.`);
      }
      if (!input.leagueId) return { id: user!.id, email: user!.email };

      const leagueId = input.leagueId;
      const [existing] = await tx
        .select()
        .from(leagueMemberships)
        .where(
          and(eq(leagueMemberships.userId, user!.id), eq(leagueMemberships.leagueId, leagueId)),
        )
        .limit(1);
      if (existing) throw new ConflictException(`${email} is already in this league.`);
      const role = input.role ?? 'user';
      await tx.insert(leagueMemberships).values({ leagueId, userId: user!.id, role });

      let playerId: string | null = null;
      if (input.playerId) {
        const [p] = await tx
          .update(players)
          .set({ userId: user!.id, active: true })
          .where(
            and(
              eq(players.id, input.playerId),
              eq(players.leagueId, leagueId),
              isNull(players.userId),
            ),
          )
          .returning();
        if (!p) throw new BadRequestException('That player is already linked to someone.');
        playerId = p.id;
      } else if (input.newPlayer) {
        const fullName = user!.name ?? input.name?.trim() ?? null;
        const nickname =
          input.newPlayer.nickname?.trim() ||
          user!.nickname ||
          fullName?.split(/\s+/)[0] ||
          email.split('@')[0]!;
        const [p] = await tx
          .insert(players)
          .values({ leagueId, nickname, fullName, userId: user!.id })
          .returning()
          .catch((err: unknown) => {
            if ((err as { cause?: { code?: string } }).cause?.code === '23505')
              throw new ConflictException(
                `"${nickname}" is already a player in this league. Pick that player instead, or use another nickname.`,
              );
            throw err;
          });
        playerId = p!.id;
      }
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'member.add',
          entityType: 'user',
          entityId: user!.id,
          after: { role, playerId },
        },
        tx,
      );
      return { id: user!.id, email: user!.email };
    });
  }

  /** Everyone with an account (names and emails only), for admins choosing league members. */
  async directory(actor: SessionUser) {
    if (!actor.isSiteAdmin && (await this.adminLeagueIds(actor)).length === 0)
      throw new ForbiddenException('Admins only.');
    return this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(isNull(users.disabledAt))
      .orderBy(asc(users.name), asc(users.email));
  }

  async update(
    actor: SessionUser,
    userId: string,
    input: {
      name?: string | null | undefined;
      nickname?: string | null | undefined;
      phone?: string | null | undefined;
      address?: string | null | undefined;
      disabled?: boolean | undefined;
      isSiteAdmin?: boolean | undefined;
    },
  ) {
    const before = await this.manageable(actor, userId);
    if ((input.disabled !== undefined || input.isSiteAdmin !== undefined) && !actor.isSiteAdmin) {
      throw new ForbiddenException('Only a site admin can do that.');
    }
    if (userId === actor.id && (input.disabled || input.isSiteAdmin === false)) {
      throw new BadRequestException(
        "You can't disable yourself or remove your own site admin access.",
      );
    }
    const changes = {
      ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
      ...(input.nickname !== undefined ? { nickname: input.nickname?.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.disabled !== undefined
        ? { disabledAt: input.disabled ? (before.disabledAt ?? new Date()) : null }
        : {}),
      ...(input.isSiteAdmin !== undefined ? { isSiteAdmin: input.isSiteAdmin } : {}),
    };
    const [after] = await this.db
      .update(users)
      .set(changes)
      .where(eq(users.id, userId))
      .returning();
    if (input.disabled) await this.sessions.revokeAllForUser(userId);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.update',
      entityType: 'user',
      entityId: userId,
      before: {
        name: before.name,
        nickname: before.nickname,
        disabled: Boolean(before.disabledAt),
        isSiteAdmin: before.isSiteAdmin,
      },
      after: {
        name: after!.name,
        nickname: after!.nickname,
        disabled: Boolean(after!.disabledAt),
        isSiteAdmin: after!.isSiteAdmin,
      },
    });
    return { id: after!.id };
  }

  /** A person updating their own name and contact details. */
  async updateSelf(
    actor: SessionUser,
    input: {
      name?: string | null | undefined;
      nickname?: string | null | undefined;
      phone?: string | null | undefined;
      address?: string | null | undefined;
    },
  ) {
    const before = await this.getUser(actor.id);
    const changes = {
      ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
      ...(input.nickname !== undefined ? { nickname: input.nickname?.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
    };
    const [after] = await this.db
      .update(users)
      .set(changes)
      .where(eq(users.id, actor.id))
      .returning();
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.update_self',
      entityType: 'user',
      entityId: actor.id,
      before: {
        name: before.name,
        nickname: before.nickname,
        phone: before.phone,
        address: before.address,
      },
      after: {
        name: after!.name,
        nickname: after!.nickname,
        phone: after!.phone,
        address: after!.address,
      },
    });
    return {
      id: after!.id,
      name: after!.name,
      nickname: after!.nickname,
      phone: after!.phone,
      address: after!.address,
    };
  }

  /**
   * A single-use link to set or reset the person's password, for the admin to copy and
   * send (by text, say). Nothing is emailed. Lasts ADMIN_LINK_TTL_HOURS.
   */
  async passwordLink(actor: SessionUser, userId: string) {
    const target = await this.manageable(actor, userId);
    if (target.disabledAt) throw new BadRequestException('This account is disabled.');
    const link = await issuePasswordLink(
      this.db,
      this.config.APP_URL,
      target.email,
      this.config.ADMIN_LINK_TTL_HOURS * 3600 * 1000,
    );
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.password_link',
      entityType: 'user',
      entityId: userId,
    });
    return link;
  }

  /**
   * Site admins: emails the person a single-use link to set their password and sign in.
   * The mail guard still applies: when it would hold the email back, nothing is sent (and
   * no link is made) and the answer says so.
   */
  async emailPasswordLink(actor: SessionUser, userId: string) {
    if (!actor.isSiteAdmin) throw new ForbiddenException('Only site admins can email links.');
    const target = await this.getUser(userId);
    if (target.disabledAt) throw new BadRequestException('This account is disabled.');
    const to = maskEmail(target.email);
    if (!(await this.mail.allows(target.email))) return { sent: false as const, to };
    const hours = this.config.ADMIN_LINK_TTL_HOURS;
    const { link } = await issuePasswordLink(
      this.db,
      this.config.APP_URL,
      target.email,
      hours * 3600 * 1000,
    );
    await this.mailer.send({
      to: target.email,
      subject: 'Sign in to TeeMate',
      text: [
        `${target.name ? `Hi ${target.name.split(' ')[0]},\n\n` : ''}Use this link to set your TeeMate password and sign in:`,
        '',
        link,
        '',
        `It works once and expires in ${hours} hours. After that, sign in with your email and password.`,
        "If you weren't expecting this, you can ignore it.",
      ].join('\n'),
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.password_link',
      entityType: 'user',
      entityId: userId,
      after: { emailed: true },
    });
    return { sent: true as const, to };
  }

  /**
   * Site admins: a password link to text from their own phone. Returns the link and the
   * person's phone; the app opens Messages with both filled in, and nothing is sent from
   * the server.
   */
  async textPasswordLink(actor: SessionUser, userId: string) {
    if (!actor.isSiteAdmin) throw new ForbiddenException('Only site admins can text links.');
    const target = await this.getUser(userId);
    if (target.disabledAt) throw new BadRequestException('This account is disabled.');
    if (!target.phone) throw new BadRequestException('There is no phone number for them yet.');
    const { link } = await issuePasswordLink(
      this.db,
      this.config.APP_URL,
      target.email,
      this.config.ADMIN_LINK_TTL_HOURS * 3600 * 1000,
    );
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.password_link',
      entityType: 'user',
      entityId: userId,
      after: { texted: true },
    });
    return {
      link,
      phone: target.phone,
      hours: this.config.ADMIN_LINK_TTL_HOURS,
      greeting: target.nickname?.trim() || target.name?.trim().split(/\s+/)[0] || null,
    };
  }

  /** Ends a cooldown after too many wrong passwords. */
  async unlock(actor: SessionUser, userId: string) {
    await this.manageable(actor, userId);
    await this.db
      .update(users)
      .set({ failedLogins: 0, lockouts: 0, lockedUntil: null })
      .where(eq(users.id, userId));
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.unlock',
      entityType: 'user',
      entityId: userId,
    });
  }

  /** Turns off someone's authenticator codes (a lost phone). Site admins only. */
  async resetTotp(actor: SessionUser, userId: string) {
    if (!actor.isSiteAdmin) throw new ForbiddenException('Only site admins can do this.');
    await this.getUser(userId);
    await this.db
      .update(users)
      .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: null })
      .where(eq(users.id, userId));
    await this.sessions.revokeAllForUser(userId);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.totp_reset',
      entityType: 'user',
      entityId: userId,
    });
  }

  async signOutEverywhere(actor: SessionUser, userId: string) {
    await this.manageable(actor, userId);
    await this.sessions.revokeAllForUser(userId);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'user.sign_out_everywhere',
      entityType: 'user',
      entityId: userId,
    });
  }

  async setRole(actor: SessionUser, leagueId: string, userId: string, role: LeagueRole) {
    await this.requireLeagueAdmin(actor, leagueId);
    if (userId === actor.id) throw new BadRequestException("You can't change your own role.");
    const [m] = await this.db
      .update(leagueMemberships)
      .set({ role })
      .where(and(eq(leagueMemberships.leagueId, leagueId), eq(leagueMemberships.userId, userId)))
      .returning();
    if (!m) throw new NotFoundException();
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'member.role',
      entityType: 'user',
      entityId: userId,
      after: { role },
    });
  }

  async removeFromLeague(actor: SessionUser, leagueId: string, userId: string) {
    await this.requireLeagueAdmin(actor, leagueId);
    if (userId === actor.id) throw new BadRequestException("You can't remove yourself.");
    if (!actor.isSiteAdmin) await this.manageable(actor, userId, { account: false });
    await this.db.transaction(async (tx) => {
      const [m] = await tx
        .delete(leagueMemberships)
        .where(and(eq(leagueMemberships.leagueId, leagueId), eq(leagueMemberships.userId, userId)))
        .returning();
      if (!m) throw new NotFoundException();
      await tx
        .update(players)
        .set({ userId: null })
        .where(and(eq(players.leagueId, leagueId), eq(players.userId, userId)));
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'member.remove',
          entityType: 'user',
          entityId: userId,
        },
        tx,
      );
    });
  }
}
