import { PREVIEW_WIDTH, type StoredCandidate, toCandidate } from './candidates.js';
import type { PersonFacts, SparqlRow, WikimediaApi } from './wikimedia.client.js';

/**
 * People as candidates: their description, their family name as an alias, the line of a name
 * search they answer. A person without a picture is listed, refused for want of a file. Shared
 * by the hand import (themes and names) and the mass import.
 */
export async function peopleCandidates(
  wikimedia: WikimediaApi,
  rows: SparqlRow[],
  queryOf: Map<string, string> = new Map(),
  known?: Map<string, PersonFacts>,
): Promise<StoredCandidate[]> {
  const facts = known ?? (await wikimedia.people(rows.map((row) => row.qid)));
  const familyQids = [
    ...new Set([...facts.values()].flatMap((f) => (f.familyNameQid ? [f.familyNameQid] : []))),
  ];
  const [entities, files, families] = await Promise.all([
    wikimedia.entities(rows.map((row) => row.qid)),
    wikimedia.files([...new Set(rows.map((row) => row.file).filter(Boolean))], PREVIEW_WIDTH),
    wikimedia.entities(familyQids),
  ]);
  return rows.map((row) => {
    const person = facts.get(row.qid);
    const family = person?.familyNameQid ? families.get(person.familyNameQid) : undefined;
    return toCandidate(row, entities.get(row.qid), row.file ? files.get(row.file) : undefined, {
      description: person?.description ?? null,
      familyName: { fr: family?.labels.fr, en: family?.labels.en },
      query: queryOf.get(row.qid) ?? null,
    });
  });
}
