const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/**
 * A new player's nickname until someone changes it: first name and last initial
 * ("David Smith" -> "David S", "Richard Mirando Jr" -> "Richard M"); a single name as it is.
 */
export function defaultNickname(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIX.test(words[words.length - 1]!)) words.pop();
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!;
  return `${words[0]} ${words[words.length - 1]![0]!.toUpperCase()}`;
}
