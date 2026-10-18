import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.url(),
  /** Public URL of the web app; sign-in links point here. */
  APP_URL: z.url(),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(11025),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_APP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(1),

  /**
   * Outbound email guard. 'allowlist' (default) only sends to MAIL_ALLOWLIST;
   * 'off' sends nothing; 'all' sends to anyone and must only be set with the
   * league owner's consent.
   */
  MAIL_MODE: z.enum(['allowlist', 'off', 'all']).default('allowlist'),
  /** Comma-separated addresses or *@domain patterns allowed in 'allowlist' mode. */
  MAIL_ALLOWLIST: z.string().default(''),

  /** Comma-separated origins allowed to call the API cross-origin. Empty: same origin only. */
  CORS_ORIGINS: z.string().default(''),
  /** Number of proxies in front of the API (Cloudflare + Traefik + nginx in production). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  /**
   * Header carrying the real client IP, set by the edge proxy (Cloudflare: cf-connecting-ip).
   * Used for rate limits; empty means use the connection address.
   */
  CLIENT_IP_HEADER: z.string().default(''),
  /** Built web app to serve alongside the API (production image); empty in development. */
  WEB_DIST: z.string().default(''),
  /** Where match photos are stored (a private volume in production; never served directly). */
  PHOTOS_DIR: z.string().default('data/photos'),

  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Lifetime of sign-in links that an admin copies and shares (they still work only once). */
  /** Password setup/reset links that admins share (single use). */
  ADMIN_LINK_TTL_HOURS: z.coerce.number().int().positive().default(72),
  /**
   * Encrypts authenticator-app secrets at rest (32+ random characters; a Docker secret in
   * production via APP_SECRET_FILE). Without it, authenticator codes can't be turned on.
   */
  APP_SECRET: z.string().min(32).optional(),
  /**
   * Reading photos of paper scorecards: Claude (Anthropic API) when this key is set
   * (ANTHROPIC_API_KEY_FILE in production), else local OCR. The owner consented to sending
   * card photos to Anthropic for this (2026-10-16).
   */
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  CARD_SCAN_MODEL: z.string().default('claude-sonnet-5-5'),
  /**
   * "Report a problem" files a GitHub issue with this token (GITHUB_TOKEN_FILE in production:
   * a fine-grained token limited to Issues on GITHUB_ISSUES_REPO). Without it, reports are
   * only kept in the app.
   */
  GITHUB_TOKEN: z.string().min(20).optional(),
  GITHUB_ISSUES_REPO: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default('brbrockel/teemate'),
  /**
   * Push notifications (web push): the VAPID key pair, from `npx web-push generate-vapid-keys`.
   * The private key is a Docker secret in production (VAPID_PRIVATE_KEY_FILE). Without both,
   * push is off and the Account page says so.
   */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  /** Shown on problem reports; set at image build time (the git commit). */
  APP_VERSION: z.string().default('dev'),
  /** Wrong passwords before an account cools down, and the first cooldown (doubles each time). */
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  /** Password attempts allowed per IP address in a 15-minute window, across all accounts. */
  LOGIN_LIMIT_PER_IP: z.coerce.number().int().positive().default(30),
  /** Sign-in link requests allowed per email, and per IP address, in a 15-minute window. */
  MAGIC_LINK_LIMIT_PER_EMAIL: z.coerce.number().int().positive().default(3),
  MAGIC_LINK_LIMIT_PER_IP: z.coerce.number().int().positive().default(10),
  /** General API requests allowed per IP per minute. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof EnvSchema> & {
  cookieSecure: boolean;
  corsOrigins: string[];
};

export const CONFIG = Symbol('CONFIG');

/**
 * Docker secrets: FOO_FILE=/run/secrets/foo sets FOO from the file's contents,
 * so passwords never appear in the stack file or environment listings.
 */
export function resolveFileVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const [key, path] of Object.entries(env)) {
    if (key.endsWith('_FILE') && path && out[key.slice(0, -5)] === undefined) {
      out[key.slice(0, -5)] = readFileSync(path, 'utf8').trim();
    }
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(resolveFileVars(env));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const c = parsed.data;
  return {
    ...c,
    cookieSecure: c.NODE_ENV === 'production',
    corsOrigins: c.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
