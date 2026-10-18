import './config/load-env.js';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from './config/app-config.js';
import { CropService } from './media/crop.service.js';
import { MediaModule } from './media/media.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/**
 * Cuts again the zoom views of every card with a detected face:
 *   pnpm --filter @closeup/api crops:faces
 * To run once after a change in how a face's views are framed. Cards keep their status.
 */
@Module({ imports: [ConfigModule, PrismaModule, MediaModule], providers: [CropService] })
class CropsModule {}

const app = await NestFactory.createApplicationContext(CropsModule, { logger: ['error', 'warn'] });
try {
  let n = 0;
  const result = await app.get(CropService).recutFaces((slug) => {
    n++;
    if (n % 25 === 0) console.log(`${n} cartes… (${slug})`);
  });
  console.log(`${result.cards} carte(s) redécoupée(s).`);
} finally {
  await app.close();
}
