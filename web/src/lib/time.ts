const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 days ago", "yesterday", "just now". */
export function timeAgo(iso: string | Date): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "2027-04-21" -> "Wed, Apr 21" (dates are calendar days, not instants). */
export function formatDay(isoDate: string, withYear = false): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** "16:30" -> "4:30 PM". */
export function formatTeeTime(hhmm: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Today's date as YYYY-MM-DD in the viewer's time zone. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/** Tee times are planned from the first tee and interval, so they're shown as estimates. */
export function aboutTeeTime(hhmm: string): string {
  const t = formatTeeTime(hhmm);
  return t ? `about ${t}` : '';
}
