import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { decryptSecret } from '../auth/totp.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { siteSettings } from '../db/schema.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** Everything needed to send: the guard and the SMTP server. */
export interface MailSettings {
  /** 'site': set in the app (Site settings → Email); 'server': the MAIL_* and SMTP_* settings. */
  source: 'site' | 'server';
  mode: Config['MAIL_MODE'];
  allowlist: string;
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
}

/**
 * The email settings in force: the ones saved in the app, else the server's. Read for every
 * email, so a change in Site settings applies straight away.
 */
@Injectable()
export class MailSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async current(): Promise<MailSettings> {
    const [row] = await this.db
      .select({ mail: siteSettings.mail })
      .from(siteSettings)
      .where(eq(siteSettings.id, 1))
      .limit(1);
    const m = row?.mail;
    if (m) {
      const { passwordEncrypted, ...rest } = m;
      const password =
        passwordEncrypted && this.config.APP_SECRET
          ? decryptSecret(passwordEncrypted, this.config.APP_SECRET)
          : null;
      return { source: 'site', ...rest, password };
    }
    const c = this.config;
    return {
      source: 'server',
      mode: c.MAIL_MODE,
      allowlist: c.MAIL_ALLOWLIST,
      host: c.SMTP_HOST,
      port: c.SMTP_PORT,
      secure: c.SMTP_SECURE,
      user: c.SMTP_USER ?? null,
      password: c.SMTP_APP_PASSWORD ?? null,
      from: c.MAIL_FROM,
    };
  }

  /** Whether the guard would let an email to `to` through right now. */
  async allows(to: string): Promise<boolean> {
    const s = await this.current();
    return mailAllowed(to, { MAIL_MODE: s.mode, MAIL_ALLOWLIST: s.allowlist });
  }
}

const transports = new Map<string, Transporter>();

/** Sends with these SMTP settings, ignoring the guard (callers check it). */
export async function sendWith(s: MailSettings, mail: Mail): Promise<void> {
  const key = JSON.stringify([s.host, s.port, s.secure, s.user, s.password]);
  let transport = transports.get(key);
  if (!transport) {
    transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      // A wrong host or port fails in seconds instead of hanging the request.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      ...(s.user ? { auth: { user: s.user, pass: s.password ?? '' } } : {}),
    });
    transports.set(key, transport);
  }
  await transport.sendMail({ from: s.from, ...mail });
}

/** True if `email` matches an allowlist entry: an exact address or `*@domain`. */
export function isAllowed(email: string, allowlist: string): boolean {
  const address = email.trim().toLowerCase();
  return allowlist
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) =>
      entry.startsWith('*@') ? address.endsWith(entry.slice(1)) : address === entry,
    );
}

/** Whether the guard lets an email to `to` through (see guardedMailer). */
export function mailAllowed(to: string, c: Pick<Config, 'MAIL_MODE' | 'MAIL_ALLOWLIST'>): boolean {
  return c.MAIL_MODE === 'all' || (c.MAIL_MODE === 'allowlist' && isAllowed(to, c.MAIL_ALLOWLIST));
}

/** Masks an address for logs: jerry@example.com -> j***@example.com. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

/**
 * Wraps a mailer so nothing reaches league members without the owner's consent:
 * in 'allowlist' mode only listed addresses get mail, 'off' sends nothing, and
 * only 'all' sends freely. Blocked emails are logged, never sent.
 */
export function guardedMailer(
  inner: Mailer,
  c: Pick<Config, 'MAIL_MODE' | 'MAIL_ALLOWLIST'>,
  log = new Logger('Mail'),
): Mailer {
  return {
    async send(mail) {
      if (!mailAllowed(mail.to, c)) {
        log.warn(
          `Blocked email to ${maskEmail(mail.to)} ("${mail.subject}"): MAIL_MODE=${c.MAIL_MODE}`,
        );
        return;
      }
      await inner.send(mail);
    },
  };
}

/** The app's mailer: the guard and SMTP server in force for each email. */
export function siteMailer(settings: MailSettingsService, log = new Logger('Mail')): Mailer {
  return {
    async send(mail) {
      const s = await settings.current();
      const guard = { MAIL_MODE: s.mode, MAIL_ALLOWLIST: s.allowlist };
      await guardedMailer({ send: (m) => sendWith(s, m) }, guard, log).send(mail);
    },
  };
}

@Global()
@Module({
  providers: [
    MailSettingsService,
    {
      provide: MAILER,
      inject: [MailSettingsService],
      useFactory: (s: MailSettingsService) => siteMailer(s),
    },
  ],
  exports: [MAILER, MailSettingsService],
})
export class MailModule {}
