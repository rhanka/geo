/**
 * Prove-before-scale (WP3 scaling) : la fixture de scaling
 * `work/coverage/reglement-lifecycle-scaling-inputs-20260830.json` passe le VRAI émetteur
 * (`buildReglementEvent` + `validateZoningEvent`, PR #294) — PAS seulement la réplique
 * early-check (`scripts/validate-lifecycle-fixture.mjs`). L'émetteur réel fait foi ; ce test
 * ferme tout drift réplique-vs-réel avant que le runner-scaling serve les events.
 *
 * Il DOUBLE le test de propagation §11 de l'émetteur, sur la donnée RÉELLE : les 8 agenda-tier
 * doivent émettre `decision_state='planned'` (jamais un drop silencieux → faussement décidé).
 * geo n'INTERPRÈTE pas ; l'émetteur canonicalise (type_instrument) et valide (§1/§6/§10/§11).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  buildReglementEvent,
  validateZoningEvent,
  type ReglementLifecycleInput,
} from "./zoning-events-emit.js";

const FIXTURE = new URL(
  "../../work/coverage/reglement-lifecycle-scaling-inputs-20260830.json",
  import.meta.url,
);
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  inputs: ReglementLifecycleInput[];
  pending_backfill: unknown[];
};

describe("reglement scaling fixture → VRAI émetteur (#294, prove-before-scale)", () => {
  it("partition 45 = 40 inputs runner-ready + 5 pending capture-bound", () => {
    expect(fixture.inputs.length).toBe(40);
    expect(fixture.pending_backfill.length).toBe(5);
  });

  it("les 40 inputs passent buildReglementEvent + validateZoningEvent (aucune exception §1/§6/§10/§11)", () => {
    for (const input of fixture.inputs) {
      const event = buildReglementEvent(input);
      expect(() => validateZoningEvent(event)).not.toThrow();
    }
  });

  it("§6 : chaque event émis porte une preuve v2 réelle (sha256 + retrieved_at non vides)", () => {
    for (const input of fixture.inputs) {
      const event = buildReglementEvent(input);
      expect(event.provenance.sha256).toBeTruthy();
      expect(event.provenance.retrieved_at).toBeTruthy();
    }
  });

  it("§11 propagation LOAD-BEARING : decision_state='planned' survit input→event sur les 8 agenda-tier", () => {
    const planned = fixture.inputs.filter((i) => i.decision_state === "planned");
    expect(planned.length).toBe(8);
    for (const input of planned) {
      const event = buildReglementEvent(input);
      // pas de drop silencieux : l'ODJ planifié ne doit JAMAIS émettre nu (= faussement décidé)
      expect(event.decision_state).toBe("planned");
    }
  });

  it("anti-invention : aucun input 'planned' n'émet 'decided' par omission", () => {
    for (const input of fixture.inputs) {
      const event = buildReglementEvent(input);
      if (input.decision_state === "planned") expect(event.decision_state).not.toBe("decided");
    }
  });
});
