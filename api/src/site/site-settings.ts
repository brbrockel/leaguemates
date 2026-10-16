import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Global,
  Inject,
  Injectable,
  HttpCode,
  Module,
  Post,
  Put,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, SiteAdminOnly, type SessionUser } from '../auth/decorators.js';
import { encryptSecret } from '../auth/totp.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { leagues, siteSettings, type StoredMailSettings } from '../db/schema.js';
import { MailSettingsService, sendWith } from '../mail/mailer.js';

const hash = (code: string) => createHash('sha256').update(code.trim()).digest('hex');

/** A readable code like "TEE-4827-9315". */
export function generateTestCode(): string {
  const part = () => String(randomInt(0, 10_000)).padStart(4, '0');
  return `TEE-${part()}-${part()}`;
}

@Injectable()
export class SiteSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    private readonly audit: AuditService,
    private readonly mail: MailSettingsService,
  ) {}

  async get() {
    const [row] = await this.db.select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1);
    return (
      row ?? {
        id: 1,
        testLoginEnabled: false,
        testLoginCodeHash: null,
        testLoginLeagueId: null,
        mail: null,
      }
    );
  }

  /** Test sign-in is usable only when switched on, a code is set, and email isn't fully on. */
  async testLoginActive(): Promise<boolean> {
    const s = await this.get();
    return (
      s.testLoginEnabled &&
      Boolean(s.testLoginCodeHash) &&
      (await this.mail.current()).mode !== 'all'
    );
  }

  async checkTestCode(code: string): Promise<boolean> {
    const s = await this.get();
    if (!s.testLoginCodeHash) return false;
    return timingSafeEqual(Buffer.from(hash(code)), Buffer.from(s.testLoginCodeHash));
  }

  async testLoginLeagueId(): Promise<string | null> {
    return (await this.get()).testLoginLeagueId;
  }

  /** What site admins see; never includes the code. */
  async view() {
    const s = await this.get();
    const m = await this.mail.current();
    return {
      mailMode: m.mode,
      mail: {
        source: m.source,
        mode: m.mode,
        allowlist: m.allowlist,
        host: m.host,
        port: m.port,
        secure: m.secure,
        user: m.user,
        hasPassword: Boolean(m.password),
        from: m.from,
        /** Saving a password needs APP_SECRET (it's stored encrypted). */
        canStorePassword: Boolean(this.config.APP_SECRET),
      },
      testLogin: {
        enabled: s.testLoginEnabled,
        active: await this.testLoginActive(),
        hasCode: Boolean(s.testLoginCodeHash),
        leagueId: s.testLoginLeagueId,
      },
    };
  }

  /**
   * Turns testing mode on or off, sets a new code (returned once, never stored),
   * and chooses the league new test accounts join. Audited without the code.
   */
  async updateTestLogin(
    actor: SessionUser,
    input: {
      enabled?: boolean | undefined;
      code?: string | undefined;
      generateCode?: boolean | undefined;
      leagueId?: string | null | undefined;
    },
  ) {
    const before = await this.get();
    const newCode = input.generateCode ? generateTestCode() : input.code?.trim();
    const codeHash = newCode ? hash(newCode) : before.testLoginCodeHash;
    const enabled = input.enabled ?? before.testLoginEnabled;

    if (enabled && !codeHash)
      throw new BadRequestException('Set an access code before turning testing mode on.');
    if (enabled && (await this.mail.current()).mode === 'all') {
      throw new BadRequestException(
        'Testing mode cannot be on while email goes to everyone. Change Email first.',
      );
    }
    if (input.leagueId) {
      const [l] = await this.db
        .select({ id: leagues.id })
        .from(leagues)
        .where(eq(leagues.id, input.leagueId))
        .limit(1);
      if (!l) throw new BadRequestException('Unknown league.');
    }

    const values = {
      id: 1,
      testLoginEnabled: enabled,
      testLoginCodeHash: codeHash,
      testLoginLeagueId: input.leagueId === undefined ? before.testLoginLeagueId : input.leagueId,
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    await this.db
      .insert(siteSettings)
      .values(values)
      .onConflictDoUpdate({ target: siteSettings.id, set: values });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'site.test_login',
      entityType: 'site',
      entityId: '1',
      before: {
        enabled: before.testLoginEnabled,
        leagueId: before.testLoginLeagueId,
        hasCode: Boolean(before.testLoginCodeHash),
      },
      after: { enabled, leagueId: values.testLoginLeagueId, codeChanged: Boolean(newCode) },
    });
    return { ...(await this.view()), ...(newCode ? { code: newCode } : {}) };
  }

  /**
   * Saves the email settings in the app; from then on they're used instead of the server's.
   * The password is kept unless a new one is given (null removes it), is stored encrypted,
   * and never leaves the server. Audited without the password.
   */
  async updateMail(actor: SessionUser, input: z.infer<typeof UpdateMail>) {
    const before = await this.get();
    const kept = before.mail?.passwordEncrypted ?? null;
    let passwordEncrypted = kept;
    if (input.password === null) passwordEncrypted = null;
    else if (input.password) {
      if (!this.config.APP_SECRET)
        throw new BadRequestException(
          "The server has no APP_SECRET, so it can't store a password safely.",
        );
      passwordEncrypted = encryptSecret(input.password, this.config.APP_SECRET);
    }
    const mail: StoredMailSettings = {
      mode: input.mode,
      allowlist: input.allowlist,
      host: input.host,
      port: input.port,
      secure: input.secure,
      user: input.user || null,
      passwordEncrypted,
      from: input.from,
    };
    if (mail.mode === 'all' && before.testLoginEnabled)
      throw new BadRequestException('Turn testing mode off before sending email to everyone.');
    await this.db
      .insert(siteSettings)
      .values({ id: 1, mail, updatedBy: actor.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: siteSettings.id,
        set: { mail, updatedBy: actor.id, updatedAt: new Date() },
      });
    const shown = (m: StoredMailSettings | null) =>
      m && { ...m, passwordEncrypted: undefined, hasPassword: Boolean(m.passwordEncrypted) };
    await this.audit.record({
      actorUserId: actor.id,
      action: 'site.mail',
      entityType: 'site',
      entityId: '1',
      before: shown(before.mail),
      after: { ...shown(mail), passwordChanged: passwordEncrypted !== kept },
    });
    return this.view();
  }

  /**
   * Sends a test email to the site admin's own address with the settings in force, whatever
   * the mode, and reports what the mail server said.
   */
  async sendTestMail(actor: SessionUser) {
    const s = await this.mail.current();
    try {
      await sendWith(s, {
        to: actor.email,
        subject: 'TeeMate test email',
        text: [
          'This is a test email from TeeMate.',
          '',
          `Sent through ${s.host}:${s.port} as ${s.from}.`,
          'If you can read this, email works.',
        ].join('\n'),
      });
      return { ok: true as const, to: actor.email };
    } catch (err) {
      return { ok: false as const, to: actor.email, error: (err as Error).message };
    }
  }
}

const UpdateMail = z.object({
  mode: z.enum(['off', 'allowlist', 'all']),
  allowlist: z.string().trim().max(2000),
  host: z.string().trim().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(200).nullable(),
  /** Omit to keep the saved one; null removes it. */
  password: z.string().max(200).nullable().optional(),
  from: z.string().trim().min(3).max(200),
});

const UpdateTestLogin = z.object({
  enabled: z.boolean().optional(),
  code: z.string().trim().min(8, 'Use at least 8 characters.').max(64).optional(),
  generateCode: z.boolean().optional(),
  leagueId: z.uuid().nullable().optional(),
});

@Controller('site-settings')
@SiteAdminOnly()
export class SiteSettingsController {
  constructor(private readonly settings: SiteSettingsService) {}

  @Get()
  view() {
    return this.settings.view();
  }

  @Put('test-login')
  update(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodPipe(UpdateTestLogin)) body: z.infer<typeof UpdateTestLogin>,
  ) {
    return this.settings.updateTestLogin(actor, body);
  }

  @Put('mail')
  updateMail(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodPipe(UpdateMail)) body: z.infer<typeof UpdateMail>,
  ) {
    return this.settings.updateMail(actor, body);
  }

  @Post('mail/test')
  @HttpCode(200)
  testMail(@CurrentUser() actor: SessionUser) {
    return this.settings.sendTestMail(actor);
  }
}

@Global()
@Module({
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
