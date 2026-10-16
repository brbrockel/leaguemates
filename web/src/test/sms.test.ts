import { describe, expect, it } from 'vitest';
import { isApple, smsHref } from '@/lib/sms';

describe('sms links', () => {
  it('one person: iPhone uses &body=, Android ?body=', () => {
    expect(smsHref(['+18605551234'], 'Hi there', true)).toBe('sms:+18605551234&body=Hi%20there');
    expect(smsHref(['+18605551234'], 'Hi there', false)).toBe('sms:+18605551234?body=Hi%20there');
  });

  it('a group: iPhone uses open?addresses=, Android a comma list', () => {
    const phones = ['+18605551234', '+18605550000'];
    expect(smsHref(phones, 'Rained out', true)).toBe(
      'sms://open?addresses=+18605551234,+18605550000&body=Rained%20out',
    );
    expect(smsHref(phones, 'Rained out', false)).toBe(
      'sms:+18605551234,+18605550000?body=Rained%20out',
    );
  });

  it('encodes links and new lines in the message', () => {
    expect(smsHref(['+1'], 'a\nhttps://x.org/p#token=1&b', false)).toBe(
      'sms:+1?body=a%0Ahttps%3A%2F%2Fx.org%2Fp%23token%3D1%26b',
    );
  });

  it('spots iPhones and iPads (including iPad desktop mode)', () => {
    expect(isApple('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isApple('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isApple('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isApple('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5)).toBe(false);
  });
});
