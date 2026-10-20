import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma/prisma.module.js';
import type { WikimediaApi } from '../wikimedia.client.js';
import { WIKIMEDIA } from '../wikimedia.client.js';
import { type HintLine, HintBackfill } from './backfill.service.js';

const run = randomUUID().slice(0, 6);

// Made-up items far above real ones: the dev database holds real catalogue cards.
const fakeWikimedia = {
  async personFacts(qids: string[], locale: 'fr' | 'en') {
    return new Map(
      qids.map((qid) => [
        qid,
        qid === 'Q996001'
          ? {
              occupation: locale === 'fr' ? 'actrice' : 'actress',
              works: ['Barbie', 'Le Loup de Wall Street', `Robbie ${run}: une vie`],
            }
          : { occupation: null, works: [] },
      ]),
    );
  },
  async subjects(qids: string[]) {
    return new Map(
      qids.map((qid) => [
        qid,
        {
          instanceOf: ['Q39367'],
          subclassOf: [],
          taxonName: null,
          description: { fr: null, en: null },
        },
      ]),
    );
  },
  async entities(qids: string[]) {
    return new Map(
      qids.map((qid) => [
        qid,
        {
          labels: qid === 'Q39367' ? { fr: 'race de chien', en: 'dog breed' } : {},
          aliases: { fr: [], en: [] },
        },
      ]),
    );
  },
} as unknown as WikimediaApi;

describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('hint backfill', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let backfill: HintBackfill;
  let dir: string;
  let packId = '';

  const card = (slug: string, fr: string, extra: Record<string, unknown> = {}) =>
    prisma.card.create({
      data: {
        packId,
        slug,
        category: 'OTHER',
        source: 'WIKIMEDIA',
        status: 'LIVE',
        answers: {
          create: [
            {
              locale: 'fr',
              text: fr,
              aliases: [],
              ...(extra.frHint ? { hint: extra.frHint as string } : {}),
            },
            { locale: 'en', text: fr, aliases: [] },
          ],
        },
        ...(extra.isPerson ? { isPerson: true, category: 'CELEBRITY' as const } : {}),
        ...(extra.character ? { category: 'CHARACTER' as const } : {}),
      },
      include: { answers: true },
    });
  const answers = (slug: string) =>
    prisma.cardAnswer.findMany({ where: { card: { slug, packId } }, orderBy: { locale: 'asc' } });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'closeup-hints-'));
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          id: `alex${run}`,
          name: `Alex ${run} (Totally Spies)`,
          category: 'fiction',
          image: 'images/fiction/alex.jpg',
          source: 'fandom',
          wiki: 'totallyspies',
          universe: 'Totally Spies !',
          source_url: 'https://static.wikia.nocookie.net/x.png',
          page_url: 'https://totallyspies.fandom.com/wiki/Alex',
          page_title: 'Alex',
        },
      ]),
    );
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      QUEUE_PREFIX: `test-${randomUUID()}`,
      BULK_RUNNER: 'off',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WIKIMEDIA)
      .useValue(fakeWikimedia)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    backfill = app.get(HintBackfill);
    const pack = await prisma.pack.create({
      data: { titleFr: `Indices ${run}`, titleEn: `Hints ${run}`, category: 'OTHER' },
    });
    packId = pack.id;
    await card('wd-Q996001', `Margot Robbie ${run}`, { isPerson: true });
    await card('wd-Q996002', `Beagle ${run}`);
    await card(`ds-alex${run}`, `Alex ${run}`, { character: true });
    await card('wd-Q996003', `Laika ${run}`, { frHint: 'Chienne de l’espace' });
  });

  afterAll(async () => {
    await prisma.pack.deleteMany({ where: { id: { in: [packId].filter(Boolean) } } });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('fills empty hints and partial answers, never what the owner wrote, and only once', async () => {
    const lines: HintLine[] = [];
    const first = await backfill.run({ datasetDir: dir, packIds: [packId] }, (l) => lines.push(l));
    // Four cards: Laika keeps its French hint and gets the English one it lacked.
    expect(first.filled).toBe(4);

    const [en, fr] = await answers('wd-Q996001');
    expect(fr).toMatchObject({
      hint: 'Actrice',
      secondary: ['Barbie', 'Le Loup de Wall Street'],
    });
    expect(en!.hint).toBe('Actress');
    expect((await answers('wd-Q996002'))[1]).toMatchObject({
      hint: 'Race de chien',
      secondary: [],
    });
    expect((await answers(`ds-alex${run}`))[1]).toMatchObject({
      hint: 'Totally Spies !',
      secondary: ['Totally Spies !'],
    });
    // The owner's own hint stays.
    const [laikaEn, laikaFr] = await answers('wd-Q996003');
    expect(laikaFr!.hint).toBe('Chienne de l’espace');
    expect(laikaEn!.hint).toBe('Dog breed');

    const second = await backfill.run({ datasetDir: dir, packIds: [packId] }, () => {});
    expect(second.filled).toBe(0);
  });

  it('writes nothing on a dry run', async () => {
    await prisma.cardAnswer.updateMany({
      where: { card: { packId, slug: 'wd-Q996002' } },
      data: { hint: null },
    });
    const dry = await backfill.run({ datasetDir: dir, packIds: [packId], dryRun: true }, () => {});
    expect(dry.filled).toBe(1);
    expect((await answers('wd-Q996002'))[1]!.hint).toBeNull();
  });
});
