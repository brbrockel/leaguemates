import { Module } from '@nestjs/common';
import { LeagueGuard } from '../leagues/league.guard.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, LeagueGuard],
})
export class UsersModule {}
