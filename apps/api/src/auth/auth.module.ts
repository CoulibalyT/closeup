import { Global, Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AdminGuard],
  exports: [AuthService, AdminGuard],
})
export class AuthModule {}
