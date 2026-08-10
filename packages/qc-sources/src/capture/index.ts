/**
 * CAPTURE — surface publique du chokepoint (SPEC_CAPTURE_ON_CLUSTER.md §5.1).
 *
 * Tout appel réseau sortant vers une source tierce DOIT passer par `capturedFetch`
 * (règle C-0). Un gate de test refuse tout NOUVEAU `fetch(` nu dans
 * `acquisition/src` : voir `acquisition/src/lib/naked-fetch-gate.test.ts`.
 */
export * from "./manifest.js";
export * from "./capture-run.js";
export * from "./capturedFetch.js";
export * from "./worklist.js";
export * from "./normes.js";
