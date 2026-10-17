import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.js';
import { leagueMemberships, leagues } from '../db/schema.js';
import type { SessionUser } from './decorators.js';

export type LeagueRole = 'admin' | 'user';
/** A member's role, or 'viewer' for someone outside a public league, or a guest (read-only). */
export type LeagueAccess = LeagueRole | 'viewer';

@Injectable()
export class MembershipService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The user's role in a league; 'viewer' if they aren't a member but the league is public;
   * null if they can't see it. Site admins act as admin. Guests see public leagues only.
   */
  async roleIn(user: SessionUser, leagueId: string): Promise<LeagueAccess | null> {
    const [m] = await this.db
      .select({ role: leagueMemberships.role })
      .from(leagueMemberships)
      .where(and(eq(leagueMemberships.leagueId, leagueId), eq(leagueMemberships.userId, user.id)))
      .limit(1);
    if (m) return m.role;
    const [league] = await this.db
      .select({ id: leagues.id, visibility: leagues.visibility })
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);
    if (!league) return null;
    if (user.isSiteAdmin) return 'admin';
    return league.visibility === 'public' ? 'viewer' : null;
  }

  /** Whether any league is public, so a guest has something to see (sign-in offers it only then). */
  async guestsWelcome(): Promise<boolean> {
    const [row] = await this.db
      .select({ id: leagues.id })
      .from(leagues)
      .where(eq(leagues.visibility, 'public'))
      .limit(1);
    return Boolean(row);
  }

  /** Leagues the user belongs to (all leagues for a site admin). */
  async leaguesFor(user: SessionUser) {
    const mine = await this.db
      .select({
        id: leagues.id,
        name: leagues.name,
        slug: leagues.slug,
        role: leagueMemberships.role,
      })
      .from(leagueMemberships)
      .innerJoin(leagues, eq(leagues.id, leagueMemberships.leagueId))
      .where(eq(leagueMemberships.userId, user.id))
      .orderBy(asc(leagues.name));
    if (!user.isSiteAdmin) {
      // Plus public leagues they aren't in, to view.
      const open = await this.db
        .select({ id: leagues.id, name: leagues.name, slug: leagues.slug })
        .from(leagues)
        .where(eq(leagues.visibility, 'public'))
        .orderBy(asc(leagues.name));
      const ids = new Set(mine.map((l) => l.id));
      return [
        ...mine.map((l) => ({ ...l, role: l.role as LeagueAccess })),
        ...open.filter((l) => !ids.has(l.id)).map((l) => ({ ...l, role: 'viewer' as const })),
      ];
    }

    const all = await this.db
      .select({ id: leagues.id, name: leagues.name, slug: leagues.slug })
      .from(leagues)
      .orderBy(asc(leagues.name));
    const roles = new Map(mine.map((l) => [l.id, l.role]));
    return all.map((l) => ({ ...l, role: roles.get(l.id) ?? ('admin' as const) }));
  }
}
