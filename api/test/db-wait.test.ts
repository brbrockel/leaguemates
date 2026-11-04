import { describe, expect, it } from 'vitest';
import { isTransientDbError, waitFor } from '../src/db/migrate.js';

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}
const err = (code: string, message = code) => Object.assign(new Error(message), { code });

describe('waitFor (database startup)', () => {
  it('retries while Postgres is starting up, then succeeds', async () => {
    const c = clock();
    let calls = 0;
    await waitFor(
      async () => {
        if (++calls < 4) throw err('57P03', 'the database system is starting up');
      },
      { ...c, log: () => {} },
    );
    expect(calls).toBe(4);
  });

  it('gives up after the timeout and rethrows the last error', async () => {
    const c = clock();
    await expect(
      waitFor(
        async () => {
          throw err('ECONNREFUSED');
        },
        { ...c, timeoutMs: 10_000, intervalMs: 2_000, log: () => {} },
      ),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(c.now()).toBeLessThanOrEqual(10_000);
  });

  it('does not retry real errors such as a bad password', async () => {
    let calls = 0;
    await expect(
      waitFor(
        async () => {
          calls++;
          throw err('28P01', 'password authentication failed');
        },
        { ...clock(), log: () => {} },
      ),
    ).rejects.toMatchObject({ code: '28P01' });
    expect(calls).toBe(1);
  });

  it('classifies errors', () => {
    expect(isTransientDbError(err('57P03'))).toBe(true);
    expect(isTransientDbError(err('ENOTFOUND'))).toBe(true);
    expect(isTransientDbError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDbError(err('42P01'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});
