import { Module } from '@nestjs/common';
import { LeagueGuard } from '../leagues/league.guard.js';
import { SeasonsController } from './seasons.controller.js';
import { SeasonsService } from './seasons.service.js';

@Module({
  controllers: [SeasonsController],
  providers: [SeasonsService, LeagueGuard],
})
export class SeasonsModule {}
