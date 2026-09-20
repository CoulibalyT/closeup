import './config/load-env.js';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loginSchema, PASSWORD } from '@closeup/shared';
import { AuthService } from './auth/auth.service.js';
import { ConfigModule } from './config/app-config.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

/**
 * Creates the owner's admin account, or resets its password (which ends its sessions):
 *   ADMIN_EMAIL=me@example.org ADMIN_PASSWORD='a long passphrase' pnpm admin:create
 * There is no sign-up form for admins and no default account: this command is the only way in.
 */

@Module({ imports: [ConfigModule, PrismaModule, RedisModule], providers: [AuthService] })
class CreateAdminModule {}

const { ADMIN_EMAIL = '', ADMIN_PASSWORD = '' } = process.env;
const account = loginSchema.safeParse({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (!account.success || ADMIN_PASSWORD.length < PASSWORD.minLength) {
  console.error(
    `Set ADMIN_EMAIL to a valid address and ADMIN_PASSWORD to at least ${PASSWORD.minLength} characters.`,
  );
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(CreateAdminModule, {
  logger: ['error', 'warn'],
});
const user = await app.get(AuthService).upsertAdmin(account.data.email, account.data.password);
console.log(`Admin ready: ${user.email}`);
await app.close();
