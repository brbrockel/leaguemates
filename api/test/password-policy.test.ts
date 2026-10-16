import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from '../src/auth/common-passwords.js';
import { passwordProblem } from '../src/auth/password.js';

describe('password rules', () => {
  it('has the whole blocklist loaded', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThan(2000);
    for (const p of ['qwertyuiop', 'password1234', '1234567890', 'timberlingolf'])
      expect(COMMON_PASSWORDS.has(p)).toBe(true);
  });

  it('wants 10+ characters, nothing common, not the email, not one repeated character', () => {
    const email = 'jerry@example.com';
    expect(passwordProblem('short pw', email)).toMatch(/at least 10/);
    expect(passwordProblem('QWERTYUIOP', email)).toMatch(/too common/);
    expect(passwordProblem('jerry-golf-2027', email)).toMatch(/email/);
    expect(passwordProblem('%%%%%%%%%%%%', email)).toMatch(/repeat/);
    expect(passwordProblem('x'.repeat(129), email)).toMatch(/at most/);
    expect(passwordProblem('four fairways and a green', email)).toBeNull();
  });
});
