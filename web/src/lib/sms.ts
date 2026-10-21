/**
 * sms: links (RFC 5724) that open the phone's own Messages app with the recipients and text
 * filled in; the person reviews it and sends it themselves. Nothing is sent by LeagueMates.
 * iPhones and Android phones read the recipients and body slightly differently.
 */
export function isApple(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

export function smsHref(phones: string[], body: string, apple = isApple()): string {
  const to = phones.join(',');
  const text = encodeURIComponent(body);
  if (!apple) return `sms:${to}?body=${text}`;
  // iOS: a group needs the "open?addresses=" form; one person takes "&body=".
  return phones.length > 1 ? `sms://open?addresses=${to}&body=${text}` : `sms:${to}&body=${text}`;
}
