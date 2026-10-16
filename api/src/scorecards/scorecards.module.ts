import { Module } from '@nestjs/common';
import { LeagueGuard } from '../leagues/league.guard.js';
import { PhotosModule } from '../photos/photos.js';
import { CardReaderService } from './card-reader.js';
import { PlayerHistoryController, ScorecardsController } from './scorecards.controller.js';
import { PlayerStatsService } from './player-stats.service.js';
import { ScorecardsService } from './scorecards.service.js';

@Module({
  imports: [PhotosModule],
  controllers: [ScorecardsController, PlayerHistoryController],
  providers: [ScorecardsService, PlayerStatsService, CardReaderService, LeagueGuard],
  exports: [ScorecardsService],
})
export class ScorecardsModule {}
