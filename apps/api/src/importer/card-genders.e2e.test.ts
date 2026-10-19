import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { CardGenders } from './card-genders.js';
import { WIKIMEDIA } from './wikimedia.client.js';

// Against the Compose Postgres (CI has it as a service).
describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('card genders', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  const asked: string[][] = [];
  const run = randomUUID().slice(0, 8);
  // Fresh QIDs per run: the cards live in a shared test database.
  const q = (n: number) => `Q9${run.replace(/\D/g, '').slice(0, 5)}${n}`;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      QUEUE_PREFIX: `test-${randomUUID()}`,
    });
    const fake = {
      async genders(qids: string[]) {
        asked.push(qids);
        const known: Record<string, 'MALE' | 'FEMALE'> = { [q(1)]: 'MALE', [q(2)]: 'FEMALE' };
        return new Map(qids.filter((id) => known[id]).map((id) => [id, known[id]!]));
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WIKIMEDIA)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    const card = (slug: string) => ({
      slug,
      category: 'CELEBRITY' as const,
      source: 'WIKIMEDIA' as const,
      isPerson: true,
    });
    await prisma.pack.create({
      data: {
        titleFr: `Genres ${run}`,
        titleEn: `Genders ${run}`,
        category: 'CELEBRITY',
        restricted: true,
        cards: {
          create: [
            card(`wd-${q(1)}`),
            card(`wd-${q(2)}-p2`),
            card(`wd-${q(3)}`),
            card(`ds-${run}`),
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma?.pack.deleteMany({ where: { titleFr: `Genres ${run}` } });
    await app?.close();
  });

  const genders = async () =>
    Object.fromEntries(
      (
        await prisma.card.findMany({
          where: { pack: { titleFr: `Genres ${run}` } },
          select: { slug: true, gender: true },
        })
      ).map((c) => [c.slug, c.gender]),
    );

  it('reads each person’s gender from the QID in the card’s slug, extra photos included', async () => {
    const result = await app.get(CardGenders).fill();
    expect(result.filled).toBeGreaterThanOrEqual(2);
    expect(await genders()).toEqual({
      [`wd-${q(1)}`]: 'MALE',
      [`wd-${q(2)}-p2`]: 'FEMALE',
      [`wd-${q(3)}`]: null,
      [`ds-${run}`]: null,
    });
    expect(asked.flat()).toEqual(expect.arrayContaining([q(1), q(2), q(3)]));
  });

  it('asks again only for the cards still without a gender', async () => {
    asked.length = 0;
    await app.get(CardGenders).fill();
    expect(asked.flat()).not.toContain(q(1));
    expect(asked.flat()).toContain(q(3));
  });
});
