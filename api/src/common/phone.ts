import { z } from 'zod';

/**
 * Normalises a phone number to E.164. US numbers can be typed any way
 * ("860-555-1234", "(860) 555 1234", "1 860 555 1234"); others need a leading +.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+'))
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Optional phone field: empty string clears it, anything else must be a valid number. */
export const PhoneInput = z
  .string()
  .max(30)
  .transform((v, ctx) => {
    if (!v.trim()) return null;
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a 10-digit phone number, or an international one starting with +',
      });
      return z.NEVER;
    }
    return p;
  });

export const AddressInput = z
  .string()
  .max(200)
  .transform((v) => v.trim() || null);
