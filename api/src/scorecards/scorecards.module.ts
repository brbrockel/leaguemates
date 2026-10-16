import { Module } from '@nestjs/common';
import { LeagueGuard } from '../leagues/league.guard.js';
import { PhotosModule } from '../photos/photos.js';
import { CardReaderService } from './card-reader.js';
import {
  LeagueStatsController,
  PlayerHistoryController,
  ScorecardsController,
} from './scorecards.controller.js';
import { PracticeScanController } from './practice-scan.js';
import { PlayerStatsService } from './player-stats.service.js';
import { ScorecardsService } from './scorecards.service.js';

@Module({
  imports: [PhotosModule],
  controllers: [
    ScorecardsController,
    PlayerHistoryController,
    PracticeScanController,
    LeagueStatsController,
  ],
  providers: [ScorecardsService, PlayerStatsService, CardReaderService, LeagueGuard],
  exports: [ScorecardsService],
})
export class ScorecardsModule {}
