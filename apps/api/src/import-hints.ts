import './config/load-env.js';
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HintBackfill } from './importer/hints/backfill.service.js';

/**
 * Fills the empty hints and partial answers of the imported cards (see the README):
 *   pnpm --filter @closeup/api import:hints [--dry-run]
 * People from Wikidata, the dataset's characters from DATASET_DIR (default data/celebrities),
 * things from their class. Never touches what was written by hand; a rerun does nothing more.
 */
const dryRun = process.argv.includes('--dry-run');
const datasetDir = process.env.DATASET_DIR ?? 'data/celebrities';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const result = await app
    .get(HintBackfill)
    .run(
      { dryRun, datasetDir: existsSync(`${datasetDir}/manifest.json`) ? datasetDir : undefined },
      (line) =>
        console.log(
          `${line.slug.padEnd(22)} ${line.answer.slice(0, 26).padEnd(26)} → ${line.hint ?? '—'}${
            line.secondary ? ` (+${line.secondary} partielles)` : ''
          }`,
        ),
    );
  console.log(
    `\n${dryRun ? 'À blanc : ' : ''}${result.filled} carte(s) complétée(s), ${result.skipped} sans rien à ajouter.`,
  );
} finally {
  await app.close();
}
