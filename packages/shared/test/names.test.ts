import { describe, expect, it } from 'vitest';
import { defaultNickname } from '../src/index.js';

describe('defaultNickname', () => {
  it('is the first name and last initial', () => {
    expect(defaultNickname('David Smith')).toBe('David S');
    expect(defaultNickname('  David M. Rinaldi ')).toBe('David R');
    expect(defaultNickname('richard mirando jr')).toBe('richard M');
  });
  it('keeps a single name, and is empty without one', () => {
    expect(defaultNickname('Doc')).toBe('Doc');
    expect(defaultNickname('')).toBe('');
    expect(defaultNickname(null)).toBe('');
  });
});
