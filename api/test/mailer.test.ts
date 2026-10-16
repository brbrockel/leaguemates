import { describe, expect, it } from 'vitest';
import { guardedMailer, isAllowed, maskEmail, type Mail, type Mailer } from '../src/mail/mailer.js';

const capture = () => {
  const sent: Mail[] = [];
  const inner: Mailer = { send: async (m) => void sent.push(m) };
  return { sent, inner };
};
const quietLog = { warn: () => {} } as never;
const mail = (to: string): Mail => ({ to, subject: 'Hi', text: 'x' });

describe('mail guard', () => {
  it('allowlist mode only sends to listed addresses and *@domain patterns', async () => {
    const { sent, inner } = capture();
    const m = guardedMailer(
      inner,
      { MAIL_MODE: 'allowlist', MAIL_ALLOWLIST: 'Owner@Mail.com, *@example.com' },
      quietLog,
    );
    await m.send(mail('owner@mail.com'));
    await m.send(mail('jerry@example.com'));
    await m.send(mail('teammate@gmail.com'));
    await m.send(mail('x@notexample.com'));
    expect(sent.map((s) => s.to)).toEqual(['owner@mail.com', 'jerry@example.com']);
  });

  it('an empty allowlist sends nothing', async () => {
    const { sent, inner } = capture();
    await guardedMailer(inner, { MAIL_MODE: 'allowlist', MAIL_ALLOWLIST: '' }, quietLog).send(
      mail('a@b.com'),
    );
    expect(sent).toEqual([]);
  });

  it('off sends nothing, even to listed addresses', async () => {
    const { sent, inner } = capture();
    await guardedMailer(inner, { MAIL_MODE: 'off', MAIL_ALLOWLIST: 'a@b.com' }, quietLog).send(
      mail('a@b.com'),
    );
    expect(sent).toEqual([]);
  });

  it('all sends to anyone', async () => {
    const { sent, inner } = capture();
    await guardedMailer(inner, { MAIL_MODE: 'all', MAIL_ALLOWLIST: '' }, quietLog).send(
      mail('a@b.com'),
    );
    expect(sent).toHaveLength(1);
  });

  it('helpers', () => {
    expect(isAllowed(' Jerry@Example.com ', '*@example.com')).toBe(true);
    expect(maskEmail('jerry@example.com')).toBe('j***@example.com');
  });
});

describe('default configuration', () => {
  it('defaults to allowlist mode with an empty list', async () => {
    const { loadConfig } = await import('../src/config.js');
    const c = loadConfig({
      DATABASE_URL: 'postgres://x@localhost/x',
      APP_URL: 'http://x.test',
      MAIL_FROM: 'x',
    });
    expect(c.MAIL_MODE).toBe('allowlist');
    expect(c.MAIL_ALLOWLIST).toBe('');
  });
});
