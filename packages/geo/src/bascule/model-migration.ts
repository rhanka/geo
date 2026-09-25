/**
 * Post-restore S3-model migration gate — the geo delivery requirement equivalent
 * to immo's post-restore db-migrate (#751). geo preprod is S3-only (no PG to
 * restore), so the hook governs the SERVED / CAS object model: when the restored
 * set's model version differs from the model the current code expects, a
 * registered migration chain MUST cover the transition. It is FAIL-CLOSED — an
 * unregistered, ambiguous, or cyclic model change throws and halts the cycle
 * rather than serving a stale/incompatible model. Iso-prod must apply later model
 * evolutions on the geo side just like immo does.
 *
 * This is the pure decision core; the entrypoint executes the resolved chain
 * (transforming served/CAS objects) and tracks the model change like #751.
 */
export interface ModelMigration {
  /** Stable migration id (also the track reference). */
  readonly id: string;
  readonly fromModel: string;
  readonly toModel: string;
}

export interface ModelMigrationPlan {
  readonly status: "up-to-date" | "migrate";
  readonly from: string;
  readonly to: string;
  /** Ordered migrations to apply; empty when already up-to-date. */
  readonly chain: readonly ModelMigration[];
}

/**
 * Resolve the ordered migration chain from `restoredModel` to `expectedModel`
 * over a linear registry (one migration per source model), fail-closed:
 * - equal versions → `up-to-date`, empty chain;
 * - a walkable path → `migrate` with the ordered chain;
 * - a gap (no migration out of the current model before reaching the target),
 *   an ambiguous fork (two migrations from one model), or a cycle → throws.
 */
export function resolveModelMigrationChain(
  restoredModel: string,
  expectedModel: string,
  registry: readonly ModelMigration[],
): ModelMigrationPlan {
  if (!restoredModel) throw new Error("model-migration: restoredModel manquant");
  if (!expectedModel) throw new Error("model-migration: expectedModel manquant");
  if (restoredModel === expectedModel) {
    return { status: "up-to-date", from: restoredModel, to: expectedModel, chain: [] };
  }
  const byFrom = new Map<string, ModelMigration>();
  for (const m of registry) {
    if (byFrom.has(m.fromModel)) {
      throw new Error(`model-migration: fork ambigu depuis le modele ${m.fromModel}`);
    }
    byFrom.set(m.fromModel, m);
  }
  const chain: ModelMigration[] = [];
  const visited = new Set<string>();
  let current = restoredModel;
  while (current !== expectedModel) {
    if (visited.has(current)) throw new Error(`model-migration: cycle detecte a ${current}`);
    visited.add(current);
    const next = byFrom.get(current);
    if (!next) {
      throw new Error(
        `model-migration: changement de modele NON couvert ${restoredModel} -> ${expectedModel} (bloque a ${current}) — fail-closed`,
      );
    }
    chain.push(next);
    current = next.toModel;
  }
  return { status: "migrate", from: restoredModel, to: expectedModel, chain };
}
