---
status: incomplete
review-kind: substitute-2-lens-claude-hosted
formal-harness-review: selection-failed
observed-failure: h2a `h2a_run` MCP disconnected → cannot dispatch a host-complementary Codex leg for a Claude-hosted author (harness-review contract requires reviewer.host != author.host). No consensus verdict claimed.
target-ref: PR #269 / ship/zones-copyobject-getput-20260825 @ 11323d9c (origin/main..HEAD)
substitute-legs:
  - path: (in-process Agent) leg-A correctness/semantics
    host: claude
    verdict: GO-with-nonblocking
  - path: (in-process Agent) leg-B robustness/missed-paths/metadata
    host: claude
    verdict: GO-with-nonblocking
substitute-consensus: GO-with-nonblocking (2/2 Claude-hosted, NOT host-complementary — weaker than formal)
---

# PR #269 review dossier — copyObject/copyObjectIfMatch → GET+PUT (OVH-BHS 501 fix)

⚠ **FORMAL harness-review = selection-failed** : `h2a_run` MCP down → aucun leg codex host-complémentaire dispatchable pour un author claude. Per contrat harness-review = pas de consensus formel. Substitut = 2 legs Claude-hosted, lenses distincts (NON host-complémentaire, flaggé à geo-socle).

## Reconciled findings (2 legs Claude-hosted)

**Core `copyObject` GET+PUT (live path, 2 production callers = capture-s3.ts:76 + zonage-proof.ts:1061) = SOUND.** Mirrors l'OVH-proven `rekeyObjectIfAbsentOrEqual` (GET→putBytes). Corrige le rollback-loss réel (OVH 501 sur CopyObject server-side). Aucun bloquant.

NON-BLOCKING (loggés, owner + status) :
- **F4 (TOP) — copyObjectIfMatch GET-If-Match non prouvé sur OVH** : le guard révision (IfMatch sur GetObject) n'a PAS de probe d'enforcement committé (le sibling `rekeyObjectIfAbsentOrEqual` en a un pour IfNoneMatch). Si OVH ignorait silencieusement le GET If-Match → backup off-révision silencieux (le CAS-fail que la primitive prévient) + le test unit passe (il mocke le 412). **Non-bloquant CAR copyObjectIfMatch a ZÉRO caller production** (grep : tests + 1 @link doc). Owner=zones+socle. Status=DEFERRED → **lander un probe OVH `GET If-Match → 412` AVANT de câbler un caller** ; traiter la primitive comme unproven jusque-là. (Aligné CLAUDE.md « vert par omission = rouge ».)
- **F3 — résidu CopyObject server-side** : `scripts/geo-preprod-sync.mjs:115` émet encore `new CopyObjectCommand` (gated streamMode=hasSourceCreds ; 501 si endpoint OVH). Hors scope PR (outil sync PROD↔PREPROD cross-bucket, a une alt GET→PUT streamMode). Owner=geo-socle. Status=FOLLOW-UP.
- **F2 — mémoire** : `Buffer.concat` ~2× taille objet = identique à getBytes (déjà utilisé sur ces objets) + rekey OVH-proven ; MB-range trivial (rouyn 48MB, plafond PUT 5GB). Soft-caution : copyObject aussi sur cadastres (plus gros) → `getObject→putStream` size-agnostic un jour. Status=NON-BLOCKING/log.
- **F1 — metadata parity** : REFUTÉ (fine). Grep : aucun objet ne porte user-metadata/ContentEncoding/etc. — tout via putBytes (Body+ContentType only) ; la preuve vit DANS le body geojson (byte-preserved). ContentType = seule metadata, préservée. Rien à perdre.
- Autres vérifiés corrects : 412 propagé jamais de PUT ; guards pré-I/O ; body-read==getBytes ; putBytes signature ; idempotence overwrite inchangée ; CopyObjectCommand import retiré proprement.

## Verdict substitut : GO-with-nonblocking (green pour merge du live path).
copyObject (live) sound. copyObjectIfMatch bundlé mais 0 caller → F4 non-bloquant, à fermer par un probe avant tout caller. Merge séquencé par geo-socle (slot-2). geo-socle review le delta copyObjectIfMatch de son côté (ajoute la perspective host-complémentaire manquante).
