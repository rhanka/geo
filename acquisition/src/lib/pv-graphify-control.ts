/**
 * Deterministic control selection for captured municipal minutes.
 *
 * A control sample must represent every municipality that actually occurs in
 * the eligible population. We draw one document per municipality per pass, in
 * stable slug/storage-key order. This keeps the per-city counts within one
 * whenever the available documents permit it.
 */

export interface PvControlCandidate {
  readonly slug: string;
  readonly storage_key: string;
}

function stableCandidates<T extends PvControlCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort((left, right) =>
    left.slug.localeCompare(right.slug) || left.storage_key.localeCompare(right.storage_key));
}

/**
 * Selects up to one candidate from every municipality on each pass.
 *
 * For 20 candidates across seven municipalities this yields a 3/3/3/3/3/3/2
 * allocation, subject to each municipality having enough eligible documents.
 */
export function selectBalancedPvControl<T extends PvControlCandidate>(
  candidates: readonly T[],
  count: number,
): T[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("la taille du lot de contrôle doit être un entier positif");
  }
  if (candidates.length < count) {
    throw new Error(`lot de contrôle impossible: ${count} PV exigés, ${candidates.length} éligibles`);
  }

  const byMunicipality = new Map<string, T[]>();
  for (const candidate of stableCandidates(candidates)) {
    const bucket = byMunicipality.get(candidate.slug) ?? [];
    bucket.push(candidate);
    byMunicipality.set(candidate.slug, bucket);
  }

  const slugs = [...byMunicipality.keys()].sort((left, right) => left.localeCompare(right));
  const selected: T[] = [];
  for (let pass = 0; selected.length < count; pass++) {
    let selectedThisPass = 0;
    for (const slug of slugs) {
      const candidate = byMunicipality.get(slug)?.[pass];
      if (!candidate) continue;
      selected.push(candidate);
      selectedThisPass++;
      if (selected.length === count) return selected;
    }
    if (selectedThisPass === 0) break;
  }

  throw new Error(`lot de contrôle impossible: ${count} PV exigés, ${selected.length} sélectionnables`);
}
