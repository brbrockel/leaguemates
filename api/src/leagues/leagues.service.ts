import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { withDefaults, type LeagueSettings, defaultNickname } from '@leaguemates/shared';
import { AuditService } from '../audit/audit.js';
import type { SessionUser } from '../auth/decorators.js';
import { MembershipService, type LeagueRole } from '../auth/membership.service.js';
import { normalizeEmail } from '../auth/tokens.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { invites, leagueMemberships, leagues, players, users } from '../db/schema.js';
import { MAILER, type Mailer } from '../mail/mailer.js';

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && 'cause' in err
    ? (err.cause as { code?: string } | undefined)?.code === '23505'
    : (err as { code?: string } | null)?.code === '23505';

export interface PlayerNames {
  nickname?: string | undefined;
  fullName?: string | undefined;
}

/** The nickname defaults to first name and last initial ("Sam Example" -> "Sam E"). */
export function resolveNames(input: PlayerNames): { nickname: string; fullName: string | null } {
  const fullName = input.fullName?.trim() || null;
  const nickname = input.nickname?.trim() || defaultNickname(fullName);
  if (!nickname) throw new BadRequestException('Enter a nickname or a full name.');
  return { nickname, fullName };
}

const nicknameTaken = (nickname: string) =>
  new ConflictException(
    `"${nickname}" is already on the roster. Use a different nickname, e.g. with a last initial.`,
  );

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'league'
  );
}

@Injectable()
export class LeaguesService {
  private readonly log = new Logger(LeaguesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly memberships: MembershipService,
  ) {}

  async create(actor: SessionUser, name: string, slug = slugify(name)) {
    try {
      return await this.db.transaction(async (tx) => {
        const [league] = await tx.insert(leagues).values({ name, slug }).returning();
        await this.audit.record(
          {
            leagueId: league!.id,
            actorUserId: actor.id,
            action: 'league.create',
            entityType: 'league',
            entityId: league!.id,
            after: league,
          },
          tx,
        );
        return league!;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException(`A league with slug "${slug}" already exists.`);
      throw err;
    }
  }

  async get(leagueId: string) {
    const [league] = await this.db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
    if (!league) throw new NotFoundException();
    return { ...league, settings: withDefaults(league.settings as Partial<LeagueSettings>) };
  }

  /** Renames a league and/or replaces its rules; every change is audited with before and after. */
  async update(
    actor: SessionUser,
    leagueId: string,
    input: {
      name?: string | undefined;
      settings?: LeagueSettings | undefined;
      visibility?: 'private' | 'public' | undefined;
    },
  ) {
    const include = input.settings?.handicap.includeLeagueId;
    if (include) {
      // Counting another league's rounds shows its scores here, so the admin must belong to it.
      if (include === leagueId) throw new BadRequestException('Pick a different league.');
      const role = await this.memberships.roleIn(actor, include);
      if (role !== 'admin' && role !== 'user')
        throw new BadRequestException('You can only count rounds from a league you belong to.');
    }
    const before = await this.get(leagueId);
    const [after] = await this.db
      .update(leagues)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.settings !== undefined ? { settings: input.settings } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      })
      .where(eq(leagues.id, leagueId))
      .returning();
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'league.update',
      entityType: 'league',
      entityId: leagueId,
      before: { name: before.name, visibility: before.visibility, settings: before.settings },
      after: {
        name: after!.name,
        visibility: after!.visibility,
        settings: withDefaults(after!.settings as Partial<LeagueSettings>),
      },
    });
    return this.get(leagueId);
  }

  /** Members and players. Viewers (outside a public league) see names only, no contact details. */
  async members(leagueId: string, viewer = false) {
    const memberRows = await this.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        phone: users.phone,
        address: users.address,
        role: leagueMemberships.role,
      })
      .from(leagueMemberships)
      .innerJoin(users, eq(users.id, leagueMemberships.userId))
      .where(eq(leagueMemberships.leagueId, leagueId))
      .orderBy(asc(users.email));
    const roster = await this.db
      .select({
        id: players.id,
        nickname: players.nickname,
        fullName: players.fullName,
        handicap: players.handicap,
        userId: players.userId,
        active: players.active,
      })
      .from(players)
      .where(eq(players.leagueId, leagueId))
      .orderBy(desc(players.active), asc(players.nickname));
    return {
      members: viewer
        ? memberRows.map((m) => ({ ...m, email: '', phone: null, address: null }))
        : memberRows,
      players: roster,
    };
  }

  /** Adds a player to the league's directory; season rosters pick from it. */
  async addPlayer(actor: SessionUser, leagueId: string, input: PlayerNames) {
    const names = resolveNames(input);
    try {
      return await this.db.transaction(async (tx) => {
        const [player] = await tx
          .insert(players)
          .values({ leagueId, ...names })
          .returning();
        await this.audit.record(
          {
            leagueId,
            actorUserId: actor.id,
            action: 'player.create',
            entityType: 'player',
            entityId: player!.id,
            after: player,
          },
          tx,
        );
        return player!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw nicknameTaken(names.nickname);
      throw err;
    }
  }

  /** Edits a player's names, current handicap, or whether they're still playing. */
  async updatePlayer(
    actor: SessionUser,
    leagueId: string,
    playerId: string,
    input: Partial<PlayerNames> & {
      active?: boolean | undefined;
      handicap?: number | null | undefined;
    },
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(players)
          .where(and(eq(players.id, playerId), eq(players.leagueId, leagueId)));
        if (!before) throw new NotFoundException();

        const changes = {
          ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
          ...(input.fullName !== undefined ? { fullName: input.fullName || null } : {}),
          ...(input.handicap !== undefined ? { handicap: input.handicap } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        };

        const [after] = Object.keys(changes).length
          ? await tx.update(players).set(changes).where(eq(players.id, playerId)).returning()
          : await tx.select().from(players).where(eq(players.id, playerId));
        await this.audit.record(
          {
            leagueId,
            actorUserId: actor.id,
            action: 'player.update',
            entityType: 'player',
            entityId: playerId,
            before,
            after,
          },
          tx,
        );
        return after!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw nicknameTaken(input.nickname ?? '');
      throw err;
    }
  }

  async invite(
    actor: SessionUser,
    leagueId: string,
    input: { email: string; role: LeagueRole; playerId?: string | undefined },
  ) {
    const email = normalizeEmail(input.email);
    const league = await this.get(leagueId);
    if (input.playerId) {
      const [p] = await this.db
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.id, input.playerId), eq(players.leagueId, leagueId)))
        .limit(1);
      if (!p) throw new NotFoundException('Player not found in this league.');
    }
    const [existing] = await this.db
      .select({ userId: leagueMemberships.userId })
      .from(leagueMemberships)
      .innerJoin(users, eq(users.id, leagueMemberships.userId))
      .where(and(eq(leagueMemberships.leagueId, leagueId), eq(users.email, email)))
      .limit(1);
    if (existing) throw new ConflictException(`${email} is already a member of this league.`);

    let invite;
    try {
      [invite] = await this.db
        .insert(invites)
        .values({
          leagueId,
          email,
          role: input.role,
          playerId: input.playerId ?? null,
          invitedBy: actor.id,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException(`${email} already has an open invite.`);
      throw err;
    }
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'invite.create',
      entityType: 'invite',
      entityId: invite!.id,
      after: invite,
    });

    this.mailer
      .send({
        to: email,
        subject: `You're invited to ${league.name} on LeagueMates`,
        text: [
          `You've been invited to join ${league.name} on LeagueMates.`,
          '',
          `Sign in with this email address (${email}) at:`,
          `${this.config.APP_URL}/sign-in`,
        ].join('\n'),
      })
      .catch((err: unknown) => this.log.error(`Invite email to ${email} failed: ${String(err)}`));
    return invite!;
  }

  async openInvites(leagueId: string) {
    return this.db
      .select()
      .from(invites)
      .where(
        and(eq(invites.leagueId, leagueId), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
      )
      .orderBy(asc(invites.email));
  }

  async revokeInvite(actor: SessionUser, leagueId: string, inviteId: string) {
    const [invite] = await this.db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invites.id, inviteId),
          eq(invites.leagueId, leagueId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      )
      .returning();
    if (!invite) throw new NotFoundException();
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'invite.revoke',
      entityType: 'invite',
      entityId: invite.id,
    });
  }
}
