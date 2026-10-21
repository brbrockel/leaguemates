import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, SiteAdminOnly, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { bugReports, users } from '../db/schema.js';

/** Where reports become issues. Swapped out in tests. */
export interface IssueTracker {
  create(issue: { title: string; body: string; labels: string[] }): Promise<{
    number: number;
    url: string;
  }>;
}
export const ISSUE_TRACKER = Symbol('ISSUE_TRACKER');

/** GitHub Issues with a fine-grained token, or nothing when there's no token. */
export function githubIssues(c: Config): IssueTracker | null {
  if (!c.GITHUB_TOKEN) return null;
  return {
    async create(issue) {
      const res = await fetch(`https://api.github.com/repos/${c.GITHUB_ISSUES_REPO}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'LeagueMates',
        },
        body: JSON.stringify(issue),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { number: number; html_url: string };
      return { number: body.number, url: body.html_url };
    },
  };
}

const REPORTS_PER_DAY = 5;

const Report = z.object({
  title: z.string().trim().min(3).max(120),
  happened: z.string().trim().min(1).max(4000),
  expected: z.string().trim().max(2000).optional(),
  page: z.string().trim().max(300).optional(),
});

/** What the public issue calls the reporter: nickname, else first name. Never more. */
export function reporterLabel(u: { nickname: string | null; name: string | null }): string {
  return u.nickname?.trim() || u.name?.trim().split(/\s+/)[0] || 'a LeagueMates user';
}

/** Stops "@someone" in a report from pinging GitHub users. */
const quiet = (text: string) => text.replace(/@/g, '@​');

@Injectable()
export class BugReportsService {
  private readonly log = new Logger('BugReports');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(ISSUE_TRACKER) private readonly tracker: IssueTracker | null,
    private readonly audit: AuditService,
  ) {}

  async report(user: SessionUser, input: z.infer<typeof Report>, userAgent: string | undefined) {
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(bugReports)
      .where(
        and(
          eq(bugReports.userId, user.id),
          gt(bugReports.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
        ),
      );
    if (n >= REPORTS_PER_DAY)
      throw new HttpException(
        `That's ${REPORTS_PER_DAY} reports today. Thanks! Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const version = this.config.APP_VERSION;
    const body = [
      '**What happened**',
      '',
      quiet(input.happened),
      ...(input.expected ? ['', '**What they expected**', '', quiet(input.expected)] : []),
      '',
      '---',
      `Reported in the app by ${quiet(reporterLabel(user))}`,
      `Page: \`${(input.page ?? '?').replace(/`/g, '')}\` · Version: \`${version}\``,
      `Browser: ${quiet((userAgent ?? 'unknown').slice(0, 300))}`,
    ].join('\n');

    let issue: { number: number; url: string } | null = null;
    let issueError: string | null = null;
    if (!this.tracker) issueError = 'No GitHub token set; kept in the app only.';
    else {
      try {
        issue = await this.tracker.create({
          title: quiet(input.title),
          body,
          labels: ['bug'],
        });
      } catch (err) {
        issueError = (err as Error).message.slice(0, 500);
        this.log.error(`Couldn't file a GitHub issue: ${issueError}`);
      }
    }

    const [row] = await this.db
      .insert(bugReports)
      .values({
        userId: user.id,
        title: input.title,
        happened: input.happened,
        expected: input.expected || null,
        page: input.page || null,
        userAgent: userAgent?.slice(0, 300) ?? null,
        appVersion: version,
        issueNumber: issue?.number ?? null,
        issueUrl: issue?.url ?? null,
        issueError,
      })
      .returning();
    await this.audit.record({
      actorUserId: user.id,
      action: 'bug.report',
      entityType: 'bug_report',
      entityId: row!.id,
      after: { title: input.title, issueNumber: issue?.number ?? null },
    });
    return { id: row!.id, issueUrl: issue?.url ?? null, issueNumber: issue?.number ?? null };
  }

  /** Site admins: recent reports with who sent them. */
  list() {
    return this.db
      .select({
        id: bugReports.id,
        title: bugReports.title,
        happened: bugReports.happened,
        page: bugReports.page,
        appVersion: bugReports.appVersion,
        issueNumber: bugReports.issueNumber,
        issueUrl: bugReports.issueUrl,
        issueError: bugReports.issueError,
        createdAt: bugReports.createdAt,
        reporterName: users.name,
        reporterEmail: users.email,
      })
      .from(bugReports)
      .leftJoin(users, eq(users.id, bugReports.userId))
      .orderBy(desc(bugReports.createdAt))
      .limit(50);
  }
}

@Controller('bug-reports')
export class BugReportsController {
  constructor(private readonly reports: BugReportsService) {}

  @Post()
  report(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(Report)) body: z.infer<typeof Report>,
    @Req() req: Request,
  ) {
    return this.reports.report(user, body, req.header('user-agent'));
  }

  @Get()
  @SiteAdminOnly()
  list() {
    return this.reports.list();
  }
}

@Module({
  controllers: [BugReportsController],
  providers: [
    BugReportsService,
    { provide: ISSUE_TRACKER, inject: [CONFIG], useFactory: (c: Config) => githubIssues(c) },
  ],
})
export class BugReportsModule {}
