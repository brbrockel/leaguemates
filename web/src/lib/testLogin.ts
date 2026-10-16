/** Testing-mode conveniences remembered on this device only. */
const CODE_KEY = 'teemate-test-code';
const EMAILS_KEY = 'teemate-test-emails';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): nothing is remembered, which is fine.
  }
}

export const savedCode = () => read(CODE_KEY) ?? '';
export const saveCode = (code: string | null) => write(CODE_KEY, code);

export function recentEmails(): string[] {
  try {
    const list: unknown = JSON.parse(read(EMAILS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}
export function rememberEmail(email: string) {
  const e = email.trim().toLowerCase();
  write(EMAILS_KEY, JSON.stringify([e, ...recentEmails().filter((x) => x !== e)].slice(0, 6)));
}
export function forgetEmail(email: string) {
  write(EMAILS_KEY, JSON.stringify(recentEmails().filter((x) => x !== email)));
}
