import { Module } from '@nestjs/common';
import { LeagueGuard } from '../leagues/league.guard.js';
import { ScorecardsModule } from '../scorecards/scorecards.module.js';
import { PlayoffsController } from './playoffs.controller.js';
import { PlayoffsService } from './playoffs.service.js';

@Module({
  imports: [ScorecardsModule],
  controllers: [PlayoffsController],
  providers: [PlayoffsService, LeagueGuard],
})
export class PlayoffsModule {}
