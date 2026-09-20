import { Global, Module } from '@nestjs/common';
import { AdminGuard, SessionGuard } from './admin.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AdminGuard, SessionGuard],
  exports: [AuthService, AdminGuard, SessionGuard],
})
export class AuthModule {}
