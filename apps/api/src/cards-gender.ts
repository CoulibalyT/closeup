import './config/load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { CardGenders } from './importer/card-genders.js';

/**
 * Reads the gender of every people card still without one from Wikidata:
 *   pnpm --filter @closeup/api cards:gender
 * Multiple-choice options then stay within the answer's gender. A rerun only asks for the rest.
 */
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const { cards, filled } = await app.get(CardGenders).fill();
  console.log(`${filled} carte(s) sur ${cards} ont maintenant un genre.`);
} finally {
  await app.close();
}
