import './config/load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  type DatasetLine,
  DatasetImporter,
  type DatasetSummary,
} from './importer/dataset/dataset-importer.service.js';
import { DATASET_CATEGORIES, type DatasetCategory } from './importer/dataset/manifest.js';

/**
 * The owner's dataset into the game (see the README):
 *   OWNER_EMAIL=me@example.org pnpm --filter @closeup/api import:dataset \
 *     [--only acteur] [--limit 20] [--dry-run] [--status]
 * DATASET_DIR defaults to data/celebrities. A rerun only adds what is missing.
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = value('only') as DatasetCategory | undefined;
if (only && !DATASET_CATEGORIES.includes(only)) {
  console.error(`--only: one of ${DATASET_CATEGORIES.join(', ')}`);
  process.exit(1);
}
const limit = value('limit') ? Number(value('limit')) : undefined;
if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
  console.error('--limit: a positive whole number');
  process.exit(1);
}

const WORDS: Record<string, string> = {
  created: 'créée',
  exists: 'déjà là',
  remade: 'refaite',
};
const say = (line: DatasetLine) => {
  const outcome = line.outcome.startsWith('refused:')
    ? `écartée (${line.outcome.slice('refused:'.length)})`
    : `${WORDS[line.outcome]}${line.detail ? ` (${line.detail})` : ''}`;
  const width = String(line.total).length;
  console.log(
    `[${String(line.index).padStart(width)}/${line.total}] ${line.name.padEnd(28)} → ${line.pack.padEnd(12)} ${outcome}`,
  );
};
const table = (title: string, summary: DatasetSummary) => {
  console.log(`\n${title}`);
  for (const [pack, counts] of Object.entries(summary)) {
    const parts = Object.entries(counts).map(([key, n]) => {
      const word = key.startsWith('refused:') ? `écartée (${key.slice(8)})` : (WORDS[key] ?? key);
      return `${word} ${n}`;
    });
    console.log(`  ${pack.padEnd(12)} ${parts.join(' · ')}`);
  }
};

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const importer = app.get(DatasetImporter);
try {
  if (flag('status')) {
    table('État des packs du dataset :', await importer.status());
  } else {
    const summary = await importer.run(
      {
        dir: process.env.DATASET_DIR ?? 'data/celebrities',
        ownerEmail: process.env.OWNER_EMAIL,
        only,
        limit,
        dryRun: flag('dry-run'),
        onWait: () => console.log('… en attente du worker'),
      },
      say,
    );
    table(flag('dry-run') ? 'Résumé (à blanc, rien d’écrit) :' : 'Résumé :', summary);
    if (!flag('dry-run')) {
      console.log('\nLes photos passent dans le worker : suis-les avec --status.');
    }
  }
} catch (error) {
  console.error(`\n${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
