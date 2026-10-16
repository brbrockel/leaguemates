import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MembershipService } from './membership.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, MembershipService],
  exports: [SessionService, MembershipService],
})
export class AuthModule {}
