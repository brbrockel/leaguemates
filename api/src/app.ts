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
  if (config.corsOrigins.length > 0) {
    express.enableCors({ origin: config.corsOrigins, credentials: true });
  }
  if (config.WEB_DIST) serveWebApp(express, config.WEB_DIST);
  express.enableShutdownHooks();
}

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
        res.setHeader(
          'Cache-Control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
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
