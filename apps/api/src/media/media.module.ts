import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { MediaController } from './media.controller.js';
import { MediaTokens } from './media-tokens.js';
import { LocalStorage, STORAGE } from './storage.js';

/** Long enough to load an image on a slow phone, short enough that a shared URL is dead. */
const MEDIA_URL_TTL_MS = 45_000;

/** Storage and URL tokens. No `sharp` here: both the API and the worker import this. */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new LocalStorage(config.env.MEDIA_DIR),
    },
    {
      provide: MediaTokens,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new MediaTokens(config.env.MEDIA_SECRET, MEDIA_URL_TTL_MS),
    },
  ],
  exports: [STORAGE, MediaTokens],
})
export class MediaModule {}

/** The HTTP side, for the API only. */
@Module({ controllers: [MediaController] })
export class MediaHttpModule {}
