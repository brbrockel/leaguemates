import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { static as expressStatic, type NextFunction, type Request, type Response } from 'express';
import { join } from 'node:path';
import helmet from 'helmet';
import type { Config } from './config.js';

/** Settings shared by the real server and the tests. */
export function configureApp(app: INestApplication, config: Config): void {
  const express = app as NestExpressApplication;
  express.setGlobalPrefix('api');
  express.set('trust proxy', config.TRUST_PROXY_HOPS);
  express.disable('x-powered-by');
  express.use(helmet());
  express.use(cookieParser());
  if (config.movedFrom.length > 0) redirectMovedHosts(express, config);
  if (config.corsOrigins.length > 0) {
    express.enableCors({ origin: config.corsOrigins, credentials: true });
  }
  if (config.WEB_DIST) serveWebApp(express, config.WEB_DIST);
  express.enableShutdownHooks();
}

/**
 * The app's old addresses (MOVED_FROM) send everything to APP_URL. Phones that installed the
 * app there keep a service worker serving a cached copy, which a redirect can't replace, so
 * the old address's /sw.js is one that clears that copy, removes itself and opens the new
 * address.
 */
function redirectMovedHosts(app: NestExpressApplication, config: Config): void {
  const to = new URL(config.APP_URL).origin;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!config.movedFrom.includes(req.hostname.toLowerCase())) return next();
    if (req.path === '/sw.js') {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('application/javascript').send(movedWorker(to));
      return;
    }
    // 308 keeps the method and body for anything but a plain page or file load.
    res.redirect(req.method === 'GET' || req.method === 'HEAD' ? 301 : 308, to + req.originalUrl);
  });
}

const movedWorker = (to: string) => `// This address has moved to ${to}.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      await self.registration.unregister();
      for (const c of await self.clients.matchAll({ type: 'window' })) {
        const u = new URL(c.url);
        c.navigate(${JSON.stringify(to)} + u.pathname + u.search + u.hash);
      }
    })(),
  );
});
`;

/**
 * Serves the built web app from the same origin as the API. Hashed assets are
 * cached for a year; index.html, the service worker and the manifest are always
 * revalidated so updates reach phones promptly. Unknown paths get index.html so
 * client-side routes work on reload.
 */
function serveWebApp(app: NestExpressApplication, dir: string): void {
  const index = join(dir, 'index.html');
  app.use(
    expressStatic(dir, {
      index: false,
      setHeaders(res, path) {
        if (path.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
          // Cloudflare caches .js, .svg, .png and .ico by extension regardless of
          // Cache-Control, which held back sw.js (new versions) and the icons for hours.
          // This header is for its edge only, and it honours it.
          res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
        }
      },
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    } else next();
  });
}
