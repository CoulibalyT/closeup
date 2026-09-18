import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { MediaTokens } from './media-tokens.js';
import { STORAGE, type StorageDriver } from './storage.js';

@Controller('media')
export class MediaController {
  constructor(
    private readonly tokens: MediaTokens,
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  /**
   * Serves a crop or a reveal image. Every failure is the same 404: an expired token, a forged
   * one and a missing file must be indistinguishable from outside.
   */
  @Get(':token')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'private, max-age=60')
  @Header('X-Content-Type-Options', 'nosniff')
  async serve(@Param('token') token: string): Promise<StreamableFile> {
    const opened = this.tokens.open(token, Date.now());
    if (!opened) throw new NotFoundException();

    const key =
      opened.kind === 'crop'
        ? (await this.prisma.crop.findUnique({ where: { id: opened.id } }))?.storageKey
        : (await this.prisma.imageAsset.findUnique({ where: { id: opened.id } }))?.revealKey;
    if (!key || !(await this.storage.exists(key))) throw new NotFoundException();

    return new StreamableFile(this.storage.stream(key));
  }
}
