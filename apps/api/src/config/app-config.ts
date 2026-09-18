import { Global, Injectable, Module } from '@nestjs/common';
import { type Env, parseEnv } from './env.js';

@Injectable()
export class AppConfig {
  readonly env: Env = parseEnv(process.env);
}

@Global()
@Module({ providers: [AppConfig], exports: [AppConfig] })
export class ConfigModule {}
