import type { Request } from 'express';

/**
 * The visitor's IP for rate limiting. Behind Cloudflare every request arrives
 * from the tunnel, so the real address comes from a header the edge sets.
 */
export function clientIp(req: Request, header: string): string {
  const fromHeader = header ? req.header(header) : undefined;
  return (fromHeader?.split(',')[0]?.trim() || req.ip) ?? 'unknown';
}
