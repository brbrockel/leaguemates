import { hash, verify } from '@node-rs/argon2';
import { BadRequestException } from '@nestjs/common';
import { COMMON_PASSWORDS } from './common-passwords.js';

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

/** Argon2id (algorithm 2) with the library defaults: 19 MiB, 2 passes (OWASP's minimum). */
export const hashPassword = (password: string) => hash(password, { algorithm: 2 });

/** A real hash to check against when there's no account, so both cases take the same time. */
const DUMMY = hashPassword('not-a-real-password-just-for-timing');

export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (!stored) {
    await verify(await DUMMY, password).catch(() => false);
    return false;
  }
  return verify(stored, password).catch(() => false);
}

/**
 * Length and a blocklist, no composition rules (NIST SP 800-63B): at least 10 characters,
 * not a common or breached password, not the email address, not one character repeated.
 */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower))
    return 'That password is too common. A few unrelated words make a strong one.';
  const local = email.split('@')[0]!.toLowerCase();
  if (lower === email.toLowerCase() || (local.length >= 4 && lower.includes(local)))
    return "Don't use your email address in your password.";
  if (/^(.)\1+$/.test(password)) return "Don't repeat one character.";
  return null;
}

export function assertGoodPassword(password: string, email: string) {
  const why = passwordProblem(password, email);
  if (why) throw new BadRequestException(why);
}
