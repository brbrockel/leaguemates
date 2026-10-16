import { Module } from '@nestjs/common';
import { LeagueGuard } from './league.guard.js';
import { LeaguesController } from './leagues.controller.js';
import { LeaguesService } from './leagues.service.js';

@Module({
  controllers: [LeaguesController],
  providers: [LeaguesService, LeagueGuard],
})
export class LeaguesModule {}
