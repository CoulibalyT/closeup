import './config/load-env.js';
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DatasetCorrections } from './importer/dataset/corrections.js';
import {
  type DatasetLine,
  DatasetImporter,
  type DatasetSummary,
} from './importer/dataset/dataset-importer.service.js';
import { DATASET_CATEGORIES, type DatasetCategory } from './importer/dataset/manifest.js';

/**
 * The owner's dataset into the game (see the README):
 *   OWNER_EMAIL=me@example.org pnpm --filter @closeup/api import:dataset \
 *     [--only acteur] [--limit 20] [--dry-run] [--status] [--replace-changed]
 *     [--export-corrections] [--apply-corrections]   (the owner's review, in DATASET_DIR/corrections.json)
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
  const corrections = `${process.env.DATASET_DIR ?? 'data/celebrities'}/corrections.json`;
  if (flag('export-corrections')) {
    const { cards } = await app.get(DatasetCorrections).export(corrections);
    // The catalogue's review travels too, in its own file next to it.
    const bulkFile = corrections.replace(/corrections\.json$/, 'corrections-catalogue.json');
    const bulk = await app.get(DatasetCorrections).export(bulkFile, 'bulk');
    console.log(`${cards} cartes écrites dans ${corrections}, ${bulk.cards} dans ${bulkFile}`);
  } else if (flag('apply-corrections')) {
    const r = await app.get(DatasetCorrections).apply(corrections, process.env.OWNER_EMAIL);
    const bulkFile = corrections.replace(/corrections\.json$/, 'corrections-catalogue.json');
    const b = existsSync(bulkFile)
      ? await app.get(DatasetCorrections).apply(bulkFile, process.env.OWNER_EMAIL, 'bulk')
      : null;
    if (b) {
      console.log(
        `Catalogue : ${b.cards} cartes trouvées · points ${b.points} · niveaux ${b.difficulty} · retirées ${b.off} · absentes de cette base ${b.missing}`,
      );
    }
    console.log(
      `${r.cards} cartes lues · points replacés ${r.points} · niveaux changés ${r.difficulty} · retirées ${r.off} · remises en jeu ${r.on} · introuvables ${r.missing} · photo changée depuis ${r.stale}`,
    );
  } else if (flag('status')) {
    table('État des packs du dataset :', await importer.status());
  } else {
    const summary = await importer.run(
      {
        dir: process.env.DATASET_DIR ?? 'data/celebrities',
        ownerEmail: process.env.OWNER_EMAIL,
        only,
        limit,
        dryRun: flag('dry-run'),
        replaceChanged: flag('replace-changed'),
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
