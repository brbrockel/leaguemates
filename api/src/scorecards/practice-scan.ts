import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, asc, count, desc, eq, gt, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { DB, type Database } from '../db/db.js';
import { auditLog, courses, leagueMemberships, players, seasons } from '../db/schema.js';
import { CardReaderService } from './card-reader.js';
import { ScorecardsService } from './scorecards.service.js';

const PRACTICE_PER_DAY = 10;

/**
 * Practice scanning: anyone can try reading a photo of a card to see what the reader gets.
 * Nothing is saved (no photo, no card). It reads against the players and course of the
 * person's league, so name matching works as it would on game day.
 */
@Controller('me/card-scan')
export class PracticeScanController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cards: ScorecardsService,
    private readonly reader: CardReaderService,
    private readonly audit: AuditService,
  ) {}

  @Post('practice')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  async practice(
    @CurrentUser() user: SessionUser,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Take or choose a photo of a card.');
    // Each read can use the (paid) AI reader, so practice is capped; the audit log counts it.
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actorUserId, user.id),
          eq(auditLog.action, 'card.practice_scan'),
          gt(auditLog.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
        ),
      );
    if (n >= PRACTICE_PER_DAY)
      throw new HttpException(
        `That's ${PRACTICE_PER_DAY} practice scans today. Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );

    let jpeg: Buffer;
    try {
      jpeg = await sharp(file.buffer, { limitInputPixels: 80_000_000 })
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
    } catch {
      throw new BadRequestException("That file isn't a photo we can read. Try a JPEG or PNG.");
    }

    // Their leagues' players, and the course of their league's latest season.
    const leagueIds = (
      await this.db
        .select({ id: leagueMemberships.leagueId })
        .from(leagueMemberships)
        .where(eq(leagueMemberships.userId, user.id))
    ).map((l) => l.id);
    const roster = leagueIds.length
      ? await this.db
          .select({
            playerId: players.id,
            nickname: players.nickname,
            fullName: players.fullName,
            handicap: players.handicap,
          })
          .from(players)
          .where(and(inArray(players.leagueId, leagueIds), eq(players.active, true)))
      : [];
    const [latest] = leagueIds.length
      ? await this.db
          .select({ courseId: seasons.courseId })
          .from(seasons)
          .where(inArray(seasons.leagueId, leagueIds))
          .orderBy(desc(seasons.startDate))
          .limit(1)
      : [];
    const [fallback] = await this.db
      .select({ id: courses.id })
      .from(courses)
      .orderBy(asc(courses.createdAt))
      .limit(1);
    const courseId = latest?.courseId ?? fallback?.id;
    if (!courseId) throw new BadRequestException('There is no course to read the card against.');
    const layouts = (await this.cards.courseLayouts(courseId)).filter((l) => !l.retired);
    if (!layouts.length) throw new BadRequestException('That course has no nines set up.');

    const reading = await this.reader.read(jpeg, {
      players: roster,
      layouts,
      plannedLayoutId: layouts[0]!.id,
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'card.practice_scan',
      entityType: 'user',
      entityId: user.id,
      after: { provider: reading.provider, rows: reading.rows.length },
    });
    const names = new Map(roster.map((p) => [p.playerId, p.nickname]));
    const layout = layouts.find((l) => l.id === reading.layoutId) ?? layouts[0]!;
    return {
      ...reading,
      layout: {
        name: layout.name,
        holes: layout.holes.map((h) => ({ number: h.number, par: h.par })),
      },
      rows: reading.rows.map((r) => ({
        ...r,
        player: r.playerId ? (names.get(r.playerId) ?? null) : null,
      })),
      left: PRACTICE_PER_DAY - n - 1,
      /** The league players to pick from when a name is matched wrong. */
      players: roster
        .map((p) => ({ playerId: p.playerId, nickname: p.nickname, handicap: p.handicap }))
        .sort((x, y) => x.nickname.localeCompare(y.nickname)),
    };
  }
}
