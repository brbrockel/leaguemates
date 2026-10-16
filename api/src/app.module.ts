import { Controller, Get, Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { clientIp } from './common/client-ip.js';
import { AnnouncementsModule } from './announcements/announcements.js';
import { AuditModule } from './audit/audit.js';
import { AuthModule } from './auth/auth.module.js';
import { BugReportsModule } from './bugs/bug-reports.js';
import { Public } from './auth/decorators.js';
import { SessionGuard } from './auth/guards.js';
import { CONFIG, type Config } from './config.js';
import { CoursesModule } from './courses/courses.module.js';
import { DbModule } from './db/db.module.js';
import { HandicapsModule } from './handicaps/handicaps.js';
import { LeaguesModule } from './leagues/leagues.module.js';
import { MailModule } from './mail/mailer.js';
import { PhotosModule } from './photos/photos.js';
import { PlayoffsModule } from './playoffs/playoffs.module.js';
import { ScorecardsModule } from './scorecards/scorecards.module.js';
import { ScrambleModule } from './scramble/scramble.controller.js';
import { SeasonsModule } from './seasons/seasons.module.js';
import { SiteSettingsModule } from './site/site-settings.js';
import { UsersModule } from './users/users.module.js';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true };
  }
}

@Global()
@Module({})
class ConfigModule {
  static with(config: Config): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}

/** Rate-limits by the real visitor IP (see CLIENT_IP_HEADER). */
class ClientIpThrottlerGuard extends ThrottlerGuard {
  static header = '';
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(clientIp(req as unknown as Request, ClientIpThrottlerGuard.header));
  }
}

@Module({})
export class AppModule {
  static with(config: Config): DynamicModule {
    ClientIpThrottlerGuard.header = config.CLIENT_IP_HEADER;
    return {
      module: AppModule,
      imports: [
        ConfigModule.with(config),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }]),
        DbModule,
        MailModule,
        AuditModule,
        SiteSettingsModule,
        AuthModule,
        LeaguesModule,
        UsersModule,
        CoursesModule,
        SeasonsModule,
        ScorecardsModule,
        PlayoffsModule,
        AnnouncementsModule,
        BugReportsModule,
        HandicapsModule,
        ScrambleModule,
        PhotosModule,
      ],
      controllers: [HealthController],
      providers: [
        // Order matters: rate limit first, then session/CSRF/admin checks.
        { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
      ],
    };
  }
}
