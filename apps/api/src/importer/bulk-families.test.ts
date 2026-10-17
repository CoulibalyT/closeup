import { BULK_FAMILIES } from '@closeup/shared';
import { describe, expect, it } from 'vitest';
import { bandsOf, BULK_CLASSES, bulkQuery } from './bulk-families.js';

describe('BULK_CLASSES', () => {
  it('gives every family at least one class, people in celebrity packs, kids made easy', () => {
    for (const family of BULK_FAMILIES) expect(BULK_CLASSES[family].length).toBeGreaterThan(0);
    for (const cls of BULK_CLASSES.people) expect(cls.pack.category).toBe('CELEBRITY');
    for (const cls of BULK_CLASSES.kids) expect(cls.difficulty).toBe(1);
    const keys = Object.values(BULK_CLASSES)
      .flat()
      .map((cls) => cls.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('bulkQuery', () => {
  it('asks for one popularity band and one page, humans and politicians handled', () => {
    const tools = BULK_CLASSES.objects.find((cls) => cls.key === 'tools')!;
    const query = bulkQuery(tools, { min: 80, max: 149 }, 2);
    expect(query).toContain('FILTER(?links >= 80 && ?links <= 149)');
    expect(query).toContain('LIMIT 120 OFFSET 240');
    expect(query).toContain('FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }');

    const people = BULK_CLASSES.people[0]!;
    const q2 = bulkQuery(people, { min: 150, max: null }, 0);
    expect(q2).toContain('FILTER(?links >= 150)');
    expect(q2).toContain('wdt:P31 wd:Q5');
    expect(q2).toContain('FILTER NOT EXISTS { ?item wdt:P106 wd:Q82955 }');
    expect(q2).toContain('fr.wikipedia.org');
  });
});

describe('bandsOf', () => {
  it('walks the bands best known first, and stops early for kids', () => {
    const tools = BULK_CLASSES.objects.find((cls) => cls.key === 'tools')!;
    expect(bandsOf(tools)).toEqual([
      { min: 150, max: null },
      { min: 80, max: 149 },
      { min: 40, max: 79 },
      { min: 25, max: 39 },
    ]);
    const kids = BULK_CLASSES.kids.find((cls) => cls.key === 'kids-animals')!;
    expect(bandsOf(kids)).toHaveLength(2);
  });
});
